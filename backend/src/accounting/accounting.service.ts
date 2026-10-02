import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { Versement } from './entities/versement.entity';
import { DriverSalary } from './entities/driver-salary.entity';
import { CashEntry } from './entities/cash-entry.entity';
import { ExpenseCategory } from './entities/expense-category.entity';
import { ClientEntry } from './entities/client-entry.entity';
import { DriverPayment } from './entities/driver-payment.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, In, Repository, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import {
  ClientRecord,
  DriverRecord,
  TripEntry,
  VehicleAccountingSummary,
  VehicleExpenseCategory,
  VehicleExpenseEntry,
  VehicleInvestmentEntry,
  VehicleInvestmentKind,
} from '../common/types';
import { Client } from './entities/client.entity';
import { Driver } from './entities/driver.entity';
import { Trip } from './entities/trip.entity';
import { TripContainer } from './entities/trip-container.entity';
import { VehicleExpense } from './entities/vehicle-expense.entity';
import { VehicleInvestment } from './entities/vehicle-investment.entity';
import { MaintenanceLog } from '../maintenance/entities/maintenance-log.entity';

export interface ContainerInput {
  containerNumber?: string | null;
  size: '20' | '40';
  loaded?: boolean;
  notes?: string | null;
}

export interface TripInput {
  vehicleId: string;
  driverId: string;
  clientId: string;
  startedAt: Date;
  endedAt?: Date | null;
  origin?: string | null;
  destination?: string | null;
  amount: number;
  paid?: boolean;
  notes?: string | null;
  containers: ContainerInput[];
}

export interface TripFilter {
  vehicleId?: string;
  clientId?: string;
  driverId?: string;
  from?: Date;
  to?: Date;
}

/**
 * Volet financier par camion : référentiels (clients, chauffeurs), voyages
 * facturés et leurs conteneurs, charges et investissements.
 *
 * Contrairement à VehiclesService/GeofenceService/FuelService, ces données
 * ne sont pas relues à chaque trame de chaque camion — un cache en mémoire
 * n'apporterait rien ici, seulement de la synchronisation à gérer en plus.
 */
@Injectable()
export class AccountingService implements OnModuleInit {
  constructor(
    @InjectRepository(Client) private readonly clientsRepo: Repository<Client>,
    @InjectRepository(Driver) private readonly driversRepo: Repository<Driver>,
    @InjectRepository(DriverPayment) private readonly paymentsRepo: Repository<DriverPayment>,
    @InjectRepository(ClientEntry) private readonly clientEntriesRepo: Repository<ClientEntry>,
    @InjectRepository(ExpenseCategory) private readonly categoriesRepo: Repository<ExpenseCategory>,
    @InjectRepository(CashEntry) private readonly cashRepo: Repository<CashEntry>,
    @InjectRepository(DriverSalary) private readonly salariesRepo: Repository<DriverSalary>,
    @InjectRepository(Versement) private readonly versementsRepo: Repository<Versement>,
    @InjectRepository(Trip) private readonly tripsRepo: Repository<Trip>,
    @InjectRepository(TripContainer) private readonly containersRepo: Repository<TripContainer>,
    @InjectRepository(VehicleExpense) private readonly expensesRepo: Repository<VehicleExpense>,
    @InjectRepository(VehicleInvestment) private readonly investmentsRepo: Repository<VehicleInvestment>,
    @InjectRepository(MaintenanceLog) private readonly maintenanceLogsRepo: Repository<MaintenanceLog>,
  ) {}

  /* --- référentiels ------------------------------------------------------ */

  /** Solde du par client : voyages + ecritures debit - ecritures credit. */
  private async clientBalances(): Promise<Map<string, number>> {
    const [trips, entries] = await Promise.all([
      this.tripsRepo.createQueryBuilder('t').select('t.clientId', 'id').addSelect('COALESCE(SUM(t.amount),0)', 'total').where('t.paid = 0').groupBy('t.clientId').getRawMany<{ id: string; total: string }>(),
      this.clientEntriesRepo.createQueryBuilder('e').select('e.clientId', 'id').addSelect("COALESCE(SUM(CASE WHEN e.kind='debit' THEN e.amount ELSE -e.amount END),0)", 'total').groupBy('e.clientId').getRawMany<{ id: string; total: string }>(),
    ]);
    const m = new Map<string, number>();
    for (const r of [...trips, ...entries]) m.set(r.id, (m.get(r.id) ?? 0) + Number(r.total));
    return m;
  }

  /** Reste du a chaque chauffeur : primes - paiements. */
  private async driverBalances(): Promise<Map<string, number>> {
    const [fees, pays] = await Promise.all([
      this.expensesRepo.createQueryBuilder('x').select('x.driverId', 'id').addSelect('COALESCE(SUM(x.amount),0)', 'total').where('x.driverId IS NOT NULL').groupBy('x.driverId').getRawMany<{ id: string; total: string }>(),
      this.paymentsRepo.createQueryBuilder('p').select('p.driverId', 'id').addSelect('COALESCE(SUM(p.amount),0)', 'total').groupBy('p.driverId').getRawMany<{ id: string; total: string }>(),
    ]);
    const sals = await this.salariesRepo.createQueryBuilder('s').select('s.driverId', 'id').addSelect('COALESCE(SUM(s.amount),0)', 'total').groupBy('s.driverId').getRawMany<{ id: string; total: string }>();
    const m = new Map<string, number>();
    for (const r of fees) m.set(r.id, (m.get(r.id) ?? 0) + Number(r.total));
    for (const r of sals) m.set(r.id, (m.get(r.id) ?? 0) + Number(r.total));
    for (const r of pays) m.set(r.id, (m.get(r.id) ?? 0) - Number(r.total));
    return m;
  }

  /* --- synthese comptable (bandeau Comptabilite) --------------------------- */
  async overview(range?: DateRange) {
    const d = dateWhere(range);
    const sumOf = async (qb: Promise<{ total: string | null } | undefined>) => Number((await qb)?.total ?? 0);
    const between = (alias: string, col: string) => (d ? `${alias}.${col} BETWEEN :from AND :to` : '1=1');
    const params = d ? { from: range?.from ? new Date(range.from) : new Date(0), to: range?.to ? new Date(`${range.to}T23:59:59.999`) : new Date(8.64e15) } : {};
    const [revenue, driverPays, truckExpenses, maintenance, investments, versements] = await Promise.all([
      sumOf(this.tripsRepo.createQueryBuilder('t').select('COALESCE(SUM(t.amount),0)', 'total').where(between('t', 'startedAt'), params).getRawOne()),
      sumOf(this.paymentsRepo.createQueryBuilder('p').select('COALESCE(SUM(p.amount),0)', 'total').where(between('p', 'at'), params).getRawOne()),
      sumOf(this.expensesRepo.createQueryBuilder('x').select('COALESCE(SUM(x.amount),0)', 'total').where(between('x', 'at'), params).andWhere("x.category <> 'driver'").getRawOne()),
      sumOf(this.maintenanceLogsRepo.createQueryBuilder('m').select('COALESCE(SUM(m.cost),0)', 'total').where(between('m', 'at'), params).getRawOne()),
      sumOf(this.investmentsRepo.createQueryBuilder('i').select('COALESCE(SUM(i.amount),0)', 'total').where(between('i', 'at'), params).getRawOne()),
      sumOf(this.versementsRepo.createQueryBuilder('v').select('COALESCE(SUM(v.amount),0)', 'total').where(between('v', 'at'), params).getRawOne()),
    ]);
    const truck = truckExpenses + maintenance;
    const afterCharges = revenue - driverPays - truck;
    return {
      revenue,
      driverCharges: driverPays,
      truckCharges: truck,
      afterCharges,
      versements,
      afterVersements: afterCharges - versements,
      investments,
      afterInvestments: investments - versements,
    };
  }

  async versements(range?: DateRange) {
    const d = dateWhere(range);
    const rows = await this.versementsRepo.find({ where: d ? { at: d } : {}, order: { at: 'DESC' }, take: 1000 });
    return rows.map((v) => ({ id: v.id, at: v.at.toISOString(), amount: Number(v.amount), label: v.label, createdBy: v.createdBy }));
  }

  async addVersement(input: { amount: number; at: Date; label: string }, createdBy: string) {
    if (input.amount <= 0) throw new BadRequestException('Le montant doit être positif');
    const v = await this.versementsRepo.save(this.versementsRepo.create({ amount: input.amount.toFixed(2), at: input.at, label: input.label.trim(), createdBy }));
    return { id: v.id, at: v.at.toISOString(), amount: Number(v.amount), label: v.label, createdBy: v.createdBy };
  }

  async removeVersement(id: string): Promise<{ ok: true }> {
    await this.versementsRepo.delete({ id });
    return { ok: true };
  }

  /* --- salaires automatiques --------------------------------------------- */
  private readonly log = new Logger('Salaires');

  onModuleInit(): void {
    // Verification quotidienne ; premiere passe 2 min apres le demarrage.
    setTimeout(() => void this.autoDeclareSalaries(), 2 * 60_000);
    setInterval(() => void this.autoDeclareSalaries(), 24 * 3600_000);
  }

  /**
   * Declare le salaire du mois pour chaque chauffeur actif (salaire > 0) :
   * le mois courant a partir de son dernier jour, et le mois precedent en rattrapage.
   */
  async autoDeclareSalaries(): Promise<void> {
    try {
      const now = new Date();
      const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const targets = [ym(new Date(now.getFullYear(), now.getMonth() - 1, 1))];
      if (now.getDate() >= lastDay) targets.push(ym(now));
      const drivers = await this.driversRepo.find({ where: { active: true } });
      let created = 0;
      for (const d of drivers) {
        const salary = Number(d.monthlySalary ?? 0);
        if (salary <= 0) continue;
        for (const month of targets) {
          // Pas de rattrapage avant l'entree du chauffeur dans le systeme
          if (d.createdAt && month < ym(d.createdAt)) continue;
          const exists = await this.salariesRepo.findOne({ where: { driverId: d.id, month } });
          if (exists) continue;
          await this.salariesRepo.save(this.salariesRepo.create({ driverId: d.id, month, amount: salary.toFixed(2), driverPaymentId: null, createdBy: 'system' }));
          created++;
        }
      }
      if (created > 0) this.log.log(`${created} salaire(s) declare(s) automatiquement`);
    } catch (e) {
      this.log.warn(`declaration automatique des salaires : ${(e as Error).message}`);
    }
  }

  /* --- journal de caisse ------------------------------------------------ */
  /**
   * Debit (entrees) : paiements recus des clients (ecritures credit client + voyages payes comptant) + debits manuels.
   * Credit (sorties) : paiements aux chauffeurs + credits manuels.
   */
  async cashJournal(range?: DateRange) {
    const d = dateWhere(range);
    const [clientCredits, paidTrips, driverPays, manual, vers, clients, drivers] = await Promise.all([
      this.clientEntriesRepo.find({ where: { kind: 'credit', ...(d ? { at: d } : {}) }, take: 2000 }),
      this.tripsRepo.find({ where: { paid: true, ...(d ? { startedAt: d } : {}) }, take: 2000 }),
      this.paymentsRepo.find({ where: d ? { at: d } : {}, take: 2000 }),
      this.cashRepo.find({ where: d ? { at: d } : {}, take: 2000 }),
      this.versementsRepo.find({ where: d ? { at: d } : {}, take: 2000 }),
      this.clientsRepo.find(),
      this.driversRepo.find(),
    ]);
    const cname = new Map(clients.map((c) => [c.id, c.name]));
    const dname = new Map(drivers.map((x) => [x.id, x.fullName]));
    const lines = [
      ...clientCredits.map((e) => ({ id: `cc:${e.id}`, kind: 'debit' as const, at: e.at.toISOString(), amount: Number(e.amount), label: `${cname.get(e.clientId) ?? e.clientId} — ${e.label}`, source: 'client' as const, deletable: false })),
      ...paidTrips.map((t) => ({ id: `pt:${t.id}`, kind: 'debit' as const, at: t.startedAt.toISOString(), amount: Number(t.amount), label: `${cname.get(t.clientId) ?? t.clientId} — voyage ${t.vehicleId} (comptant)`, source: 'client' as const, deletable: false })),
      ...driverPays.map((p) => ({ id: `dp:${p.id}`, kind: 'credit' as const, at: p.at.toISOString(), amount: Number(p.amount), label: `${dname.get(p.driverId) ?? p.driverId} — ${p.notes ?? 'paiement chauffeur'}`, source: 'driver' as const, deletable: false })),
      ...manual.map((m) => ({ id: m.id, kind: m.kind, at: m.at.toISOString(), amount: Number(m.amount), label: m.label, source: 'manual' as const, deletable: true })),
      ...vers.map((v) => ({ id: `vs:${v.id}`, kind: 'credit' as const, at: v.at.toISOString(), amount: Number(v.amount), label: `Versement — ${v.label}`, source: 'versement' as const, deletable: false })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const sum = (k: string) => lines.filter((l) => l.kind === k).reduce((a, l) => a + l.amount, 0);
    const debit = sum('debit'), credit = sum('credit');
    // Solde global toutes periodes (solde de caisse reel), par agregats
    const num = async (q: Promise<{ total: string | null } | undefined>) => Number((await q)?.total ?? 0);
    const [allCc, allPt, allDp, allMd, allMc, allVs] = await Promise.all([
      num(this.clientEntriesRepo.createQueryBuilder('e').select('COALESCE(SUM(e.amount),0)', 'total').where("e.kind = 'credit'").getRawOne()),
      num(this.tripsRepo.createQueryBuilder('t').select('COALESCE(SUM(t.amount),0)', 'total').where('t.paid = 1').getRawOne()),
      num(this.paymentsRepo.createQueryBuilder('p').select('COALESCE(SUM(p.amount),0)', 'total').getRawOne()),
      num(this.cashRepo.createQueryBuilder('m').select('COALESCE(SUM(m.amount),0)', 'total').where("m.kind = 'debit'").getRawOne()),
      num(this.cashRepo.createQueryBuilder('m').select('COALESCE(SUM(m.amount),0)', 'total').where("m.kind = 'credit'").getRawOne()),
      num(this.versementsRepo.createQueryBuilder('v').select('COALESCE(SUM(v.amount),0)', 'total').getRawOne()),
    ]);
    const allDebit = allCc + allPt + allMd, allCredit = allDp + allMc + allVs;
    return { period: { debit, credit, balance: debit - credit }, overall: { debit: allDebit, credit: allCredit, balance: allDebit - allCredit }, lines };
  }

  async addCashEntry(input: { kind: 'debit' | 'credit'; amount: number; at: Date; label: string }, createdBy: string) {
    if (input.amount <= 0) throw new BadRequestException('Le montant doit être positif');
    const e = await this.cashRepo.save(this.cashRepo.create({ kind: input.kind, amount: input.amount.toFixed(2), at: input.at, label: input.label.trim(), createdBy }));
    return { id: e.id, kind: e.kind, at: e.at.toISOString(), amount: Number(e.amount), label: e.label };
  }

  async removeCashEntry(id: string): Promise<{ ok: true }> {
    await this.cashRepo.delete({ id });
    return { ok: true };
  }

  /* --- catalogue des charges ------------------------------------------- */
  async expenseCategories(includeInactive = false): Promise<ExpenseCategory[]> {
    return this.categoriesRepo.find({ where: includeInactive ? {} : { active: true }, order: { sortOrder: 'ASC', labelFr: 'ASC' } });
  }

  async assertCategory(id: string): Promise<void> {
    const c = await this.categoriesRepo.findOne({ where: { id } });
    if (!c || !c.active) throw new BadRequestException('Catégorie de charge inconnue ou désactivée');
  }

  async saveExpenseCategory(input: { id?: string; labelFr: string; labelEn?: string | null; labelAr?: string | null; active?: boolean; sortOrder?: number }): Promise<ExpenseCategory> {
    const id = (input.id ?? input.labelFr).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'cat';
    const existing = await this.categoriesRepo.findOne({ where: { id } });
    if (existing?.system) throw new BadRequestException('Catégorie système non modifiable');
    const row = existing ?? this.categoriesRepo.create({ id, system: false, active: true, sortOrder: 100 });
    row.labelFr = input.labelFr.trim();
    row.labelEn = input.labelEn?.trim() || null;
    row.labelAr = input.labelAr?.trim() || null;
    if (input.active !== undefined) row.active = input.active;
    if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder;
    return this.categoriesRepo.save(row);
  }

  /** Suppression : refusee si des charges l'utilisent (desactiver a la place). */
  async deleteExpenseCategory(id: string): Promise<{ ok: true }> {
    const c = await this.categoriesRepo.findOne({ where: { id } });
    if (!c) return { ok: true };
    if (c.system) throw new BadRequestException('Catégorie système non supprimable');
    const used = await this.expensesRepo.count({ where: { category: id } });
    if (used > 0) throw new BadRequestException(`Catégorie utilisée par ${used} charge(s) : désactivez-la plutôt`);
    await this.categoriesRepo.delete({ id });
    return { ok: true };
  }

  async clients(): Promise<ClientRecord[]> {
    const rows = await this.clientsRepo.find({ order: { name: 'ASC' } });
    const bal = await this.clientBalances();
    return rows.map((r) => ({ ...toClientRecord(r), balance: bal.get(r.id) ?? 0 }));
  }

  async createClient(data: { name: string; contact?: string | null; notes?: string | null }): Promise<ClientRecord> {
    const saved = await this.clientsRepo.save(
      this.clientsRepo.create({
        name: data.name,
        contact: data.contact ?? null,
        notes: data.notes ?? null,
        active: true,
      }),
    );
    return toClientRecord(saved);
  }

  async updateClient(
    id: string,
    patch: { name?: string; contact?: string | null; notes?: string | null; active?: boolean },
  ): Promise<ClientRecord> {
    const client = await this.clientsRepo.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Client inconnu');
    Object.assign(client, patch);
    return toClientRecord(await this.clientsRepo.save(client));
  }

  async drivers(): Promise<DriverRecord[]> {
    const rows = await this.driversRepo.find({ order: { fullName: 'ASC' } });
    const bal = await this.driverBalances();
    return rows.map((r) => ({ ...toDriverRecord(r), balance: bal.get(r.id) ?? 0 }));
  }

  async createDriver(data: {
    fullName: string;
    phone?: string | null;
    licenseNumber?: string | null;
    tripFee?: number;
    monthlySalary?: number;
    vehicleId?: string | null;
  }): Promise<DriverRecord> {
    const saved = await this.driversRepo.save(
      this.driversRepo.create({
        fullName: data.fullName,
        phone: data.phone ?? null,
        licenseNumber: data.licenseNumber ?? null,
        tripFee: (data.tripFee ?? 0).toFixed(2),
        monthlySalary: (data.monthlySalary ?? 0).toFixed(2),
        vehicleId: data.vehicleId ?? null,
        active: true,
      }),
    );
    return toDriverRecord(saved);
  }

  async updateDriver(
    id: string,
    patch: { fullName?: string; phone?: string | null; licenseNumber?: string | null; tripFee?: number; monthlySalary?: number; vehicleId?: string | null; active?: boolean },
  ): Promise<DriverRecord> {
    const driver = await this.driversRepo.findOne({ where: { id } });
    if (!driver) throw new NotFoundException('Chauffeur inconnu');
    const { tripFee, monthlySalary, ...rest } = patch;
    Object.assign(driver, rest);
    if (tripFee !== undefined) driver.tripFee = tripFee.toFixed(2);
    if (monthlySalary !== undefined) driver.monthlySalary = monthlySalary.toFixed(2);
    return toDriverRecord(await this.driversRepo.save(driver));
  }

  /* --- voyages ------------------------------------------------------------ */

  async trips(filter: TripFilter = {}, limit = 200): Promise<TripEntry[]> {
    const where: FindOptionsWhere<Trip> = {};
    if (filter.vehicleId) where.vehicleId = filter.vehicleId;
    if (filter.clientId) where.clientId = filter.clientId;
    if (filter.driverId) where.driverId = filter.driverId;
    if (filter.from && filter.to) where.startedAt = Between(filter.from, filter.to);

    const rows = await this.tripsRepo.find({ where, order: { startedAt: 'DESC' }, take: limit });
    return this.toEntries(rows);
  }

  async createTrip(input: TripInput, createdBy: string): Promise<TripEntry> {
    if (input.containers.length === 0) {
      throw new BadRequestException('Un voyage doit porter au moins un conteneur');
    }
    if (input.amount < 0) throw new BadRequestException('Le montant ne peut pas être négatif');

    const trip = await this.tripsRepo.save(
      this.tripsRepo.create({
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        clientId: input.clientId,
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? null,
        origin: input.origin ?? null,
        destination: input.destination ?? null,
        amount: input.amount.toFixed(2),
        paid: input.paid ?? false,
        notes: input.notes ?? null,
        createdBy,
      }),
    );

    await this.containersRepo.save(
      input.containers.map((c) =>
        this.containersRepo.create({
          tripId: trip.id,
          containerNumber: c.containerNumber ?? null,
          size: c.size,
          loaded: c.loaded ?? true,
          notes: c.notes ?? null,
        }),
      ),
    );

    // Prime chauffeur : figee au moment de la confirmation (un changement ulterieur
    // du tarif du chauffeur ne modifie pas les voyages passes).
    const driver = await this.driversRepo.findOne({ where: { id: input.driverId } });
    const fee = Number(driver?.tripFee ?? 0);
    if (driver && fee > 0) {
      await this.expensesRepo.save(
        this.expensesRepo.create({
          vehicleId: input.vehicleId,
          category: 'driver' as VehicleExpenseCategory,
          amount: fee.toFixed(2),
          at: input.startedAt,
          reference: `Prime chauffeur — ${driver.fullName}`,
          notes: null,
          tripId: trip.id,
          driverId: driver.id,
          createdBy,
        }),
      );
    }

    const [entry] = await this.toEntries([trip]);
    return entry;
  }

  async updateTrip(
    id: string,
    patch: {
      driverId?: string;
      clientId?: string;
      startedAt?: Date;
      containers?: ContainerInput[];
      endedAt?: Date | null;
      origin?: string | null;
      destination?: string | null;
      amount?: number;
      paid?: boolean;
      notes?: string | null;
    },
  ): Promise<TripEntry> {
    const trip = await this.tripsRepo.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('Voyage inconnu');

    if (patch.clientId !== undefined) {
      if (!(await this.clientsRepo.findOne({ where: { id: patch.clientId } }))) throw new BadRequestException('Client inconnu');
      trip.clientId = patch.clientId;
    }
    if (patch.driverId !== undefined) {
      if (!(await this.driversRepo.findOne({ where: { id: patch.driverId } }))) throw new BadRequestException('Chauffeur inconnu');
      trip.driverId = patch.driverId;
    }
    if (patch.startedAt !== undefined) trip.startedAt = patch.startedAt;
    if (patch.endedAt !== undefined) trip.endedAt = patch.endedAt;
    if (patch.origin !== undefined) trip.origin = patch.origin;
    if (patch.destination !== undefined) trip.destination = patch.destination;
    if (patch.notes !== undefined) trip.notes = patch.notes;
    if (patch.paid !== undefined) trip.paid = patch.paid;
    if (patch.amount !== undefined) {
      if (patch.amount < 0) throw new BadRequestException('Le montant ne peut pas être négatif');
      trip.amount = patch.amount.toFixed(2);
    }

    const saved = await this.tripsRepo.save(trip);

    // Les conteneurs sont remplacés en bloc : la liste du formulaire fait foi.
    if (patch.containers !== undefined) {
      if (patch.containers.length === 0) throw new BadRequestException('Un voyage doit porter au moins un conteneur');
      await this.containersRepo.delete({ tripId: id });
      await this.containersRepo.save(
        patch.containers.map((c) =>
          this.containersRepo.create({
            tripId: id,
            containerNumber: c.containerNumber ?? null,
            size: c.size,
            loaded: c.loaded ?? true,
            notes: c.notes ?? null,
          }),
        ),
      );
    }

    const [entry] = await this.toEntries([saved]);
    return entry;
  }

  /* --- charges -------------------------------------------------------------- */

  async expensesFor(vehicleId: string, limit = 200, range?: DateRange): Promise<VehicleExpenseEntry[]> {
    const d = dateWhere(range);
    const rows = await this.expensesRepo.find({
      where: { vehicleId, ...(d ? { at: d } : {}) },
      order: { at: 'DESC' },
      take: limit,
    });
    return rows.map(toExpenseEntry);
  }

  async addExpense(
    vehicleId: string,
    data: {
      category: VehicleExpenseCategory;
      amount: number;
      at: Date;
      reference?: string | null;
      notes?: string | null;
    },
    createdBy: string,
  ): Promise<VehicleExpenseEntry> {
    if (data.amount < 0) throw new BadRequestException('Le montant ne peut pas être négatif');
    const saved = await this.expensesRepo.save(
      this.expensesRepo.create({
        vehicleId,
        category: data.category,
        amount: data.amount.toFixed(2),
        at: data.at,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        createdBy,
      }),
    );
    return toExpenseEntry(saved);
  }

  /* --- investissements -------------------------------------------------- */

  async investmentsFor(vehicleId: string, limit = 200, range?: DateRange): Promise<VehicleInvestmentEntry[]> {
    const d = dateWhere(range);
    const rows = await this.investmentsRepo.find({
      where: { vehicleId, ...(d ? { at: d } : {}) },
      order: { at: 'DESC' },
      take: limit,
    });
    return rows.map(toInvestmentEntry);
  }

  async addInvestment(
    vehicleId: string,
    data: { kind: VehicleInvestmentKind; amount: number; at: Date; description?: string | null },
    createdBy: string,
  ): Promise<VehicleInvestmentEntry> {
    if (data.amount < 0) throw new BadRequestException('Le montant ne peut pas être négatif');
    const saved = await this.investmentsRepo.save(
      this.investmentsRepo.create({
        vehicleId,
        kind: data.kind,
        amount: data.amount.toFixed(2),
        at: data.at,
        description: data.description ?? null,
        createdBy,
      }),
    );
    return toInvestmentEntry(saved);
  }

  async updateExpense(
    id: string,
    patch: {
      category?: VehicleExpenseCategory;
      amount?: number;
      at?: Date;
      reference?: string | null;
      notes?: string | null;
    },
  ): Promise<VehicleExpenseEntry> {
    const row = await this.expensesRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Charge inconnue');
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.at !== undefined) row.at = patch.at;
    if (patch.reference !== undefined) row.reference = patch.reference;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.amount !== undefined) {
      if (patch.amount < 0) throw new BadRequestException('Le montant ne peut pas être négatif');
      row.amount = patch.amount.toFixed(2);
    }
    return toExpenseEntry(await this.expensesRepo.save(row));
  }

  /** Suppression définitive — réservée à l'admin côté contrôleur. */
  async deleteExpense(id: string): Promise<void> {
    const result = await this.expensesRepo.delete({ id });
    if (!result.affected) throw new NotFoundException('Charge inconnue');
  }

  async updateInvestment(
    id: string,
    patch: { kind?: VehicleInvestmentKind; amount?: number; at?: Date; description?: string | null },
  ): Promise<VehicleInvestmentEntry> {
    const row = await this.investmentsRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Investissement inconnu');
    if (patch.kind !== undefined) row.kind = patch.kind;
    if (patch.at !== undefined) row.at = patch.at;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.amount !== undefined) {
      if (patch.amount < 0) throw new BadRequestException('Le montant ne peut pas être négatif');
      row.amount = patch.amount.toFixed(2);
    }
    return toInvestmentEntry(await this.investmentsRepo.save(row));
  }

  async deleteInvestment(id: string): Promise<void> {
    const result = await this.investmentsRepo.delete({ id });
    if (!result.affected) throw new NotFoundException('Investissement inconnu');
  }

  /** Les conteneurs partent avec le voyage : ils n'ont pas de sens seuls. */
  async deleteTrip(id: string): Promise<void> {
    const trip = await this.tripsRepo.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('Voyage inconnu');
    await this.containersRepo.delete({ tripId: id });
    await this.tripsRepo.delete({ id });
  }

  /* --- synthèse ------------------------------------------------------------ */

  /** Journal d'un client : voyages (debit auto) + ecritures manuelles, solde periode et global. */
  async clientLedger(clientId: string, range?: DateRange) {
    const d = dateWhere(range);
    const [trips, entries, allTrips, allEntries] = await Promise.all([
      this.tripsRepo.find({ where: { clientId, ...(d ? { startedAt: d } : {}) }, order: { startedAt: 'DESC' }, take: 1000 }),
      this.clientEntriesRepo.find({ where: { clientId, ...(d ? { at: d } : {}) }, order: { at: 'DESC' }, take: 1000 }),
      this.tripsRepo.find({ where: { clientId } }),
      this.clientEntriesRepo.find({ where: { clientId } }),
    ]);
    const containers = trips.length > 0 ? await this.containersRepo.find({ where: { tripId: In(trips.map((t) => t.id)) } }) : [];
    const byTrip = new Map<string, typeof containers>();
    for (const c of containers) byTrip.set(c.tripId, [...(byTrip.get(c.tripId) ?? []), c]);
    const tripLabel = (t: Trip) => {
      const cs = byTrip.get(t.id) ?? [];
      const sizes = Array.from(new Set(cs.map((c) => String(c.size)))).map((sz) => `${cs.filter((c) => String(c.size) === sz).length}× ${sz}'`).join(' + ');
      const nums = cs.map((c) => c.containerNumber).filter((n): n is string => !!n).join(', ');
      const route = t.origin || t.destination ? ` · ${t.origin ?? '—'} → ${t.destination ?? '—'}` : '';
      return `Voyage ${t.vehicleId}${sizes ? ' · ' + sizes : ''}${nums ? ' (' + nums + ')' : ''}${route}`;
    };
    const lines = [
      ...trips.map((t) => ({ id: `trip:${t.id}`, type: 'trip' as const, kind: 'debit' as const, at: t.startedAt.toISOString(), amount: Number(t.amount), label: tripLabel(t), tripId: t.id, vehicleId: t.vehicleId, deletable: false })),
      ...trips.filter((t) => t.paid).map((t) => ({ id: `paid:${t.id}`, type: 'trip' as const, kind: 'credit' as const, at: t.startedAt.toISOString(), amount: Number(t.amount), label: `Paiement comptant — voyage ${t.vehicleId}`, tripId: t.id, vehicleId: t.vehicleId, deletable: false })),
      ...entries.map((e) => ({ id: e.id, type: 'entry' as const, kind: e.kind, at: e.at.toISOString(), amount: Number(e.amount), label: e.label, tripId: null, vehicleId: null, deletable: true })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const sum = (rows: { kind: string; amount: number }[], kind: string) => rows.filter((r) => r.kind === kind).reduce((a, r) => a + r.amount, 0);
    const periodDebit = sum(lines, 'debit'), periodCredit = sum(lines, 'credit');
    const allDebit = allTrips.reduce((a, t) => a + Number(t.amount), 0) + allEntries.filter((e) => e.kind === 'debit').reduce((a, e) => a + Number(e.amount), 0);
    const allCredit = allTrips.filter((t) => t.paid).reduce((a, t) => a + Number(t.amount), 0) + allEntries.filter((e) => e.kind === 'credit').reduce((a, e) => a + Number(e.amount), 0);
    return {
      clientId,
      period: { debit: periodDebit, credit: periodCredit, balance: periodDebit - periodCredit },
      overall: { debit: allDebit, credit: allCredit, balance: allDebit - allCredit },
      lines,
    };
  }

  async addClientEntry(clientId: string, input: { kind: 'debit' | 'credit'; amount: number; at: Date; label: string }, createdBy: string) {
    if (input.amount <= 0) throw new BadRequestException('Le montant doit être positif');
    const e = await this.clientEntriesRepo.save(this.clientEntriesRepo.create({ clientId, kind: input.kind, amount: input.amount.toFixed(2), at: input.at, label: input.label.trim(), createdBy }));
    return { id: e.id, kind: e.kind, at: e.at.toISOString(), amount: Number(e.amount), label: e.label };
  }

  async removeClientEntry(id: string): Promise<{ ok: true }> {
    await this.clientEntriesRepo.delete({ id });
    return { ok: true };
  }

  /** Releve complet : primes, salaires, paiements (par type), solde = primes + salaires - paiements. */
  async driverLedger(driverId: string, range?: DateRange) {
    const fees = await this.driverFees(driverId, range);
    const d = dateWhere(range);
    const [payments, salaries, allFees, allPays, allSal] = await Promise.all([
      this.paymentsRepo.find({ where: { driverId, ...(d ? { at: d } : {}) }, order: { at: 'DESC' }, take: 500 }),
      this.salariesRepo.find({ where: { driverId }, order: { month: 'DESC' }, take: 120 }),
      this.driverFees(driverId),
      this.paymentsRepo.find({ where: { driverId } }),
      this.salariesRepo.find({ where: { driverId } }),
    ]);
    const inRange = (m: string) => (!range?.from || m >= range.from.slice(0, 7)) && (!range?.to || m <= range.to.slice(0, 7));
    const periodSal = salaries.filter((x) => inRange(x.month));
    const sumP = (rows: { amount: string }[]) => rows.reduce((a, p) => a + Number(p.amount), 0);
    const paid = sumP(payments), salTotal = sumP(periodSal);
    const allPaid = sumP(allPays), allSalTotal = sumP(allSal);
    return {
      driverId,
      period: { fees: fees.total, feesCount: fees.count, salaries: salTotal, paid, balance: fees.total + salTotal - paid },
      overall: { fees: allFees.total, salaries: allSalTotal, paid: allPaid, balance: allFees.total + allSalTotal - allPaid },
      fees: fees.items,
      salaries: salaries.map((x) => ({ id: x.id, month: x.month, amount: Number(x.amount), paid: x.driverPaymentId !== null })),
      payments: payments.map((p) => ({ id: p.id, kind: p.kind, at: p.at.toISOString(), amount: Number(p.amount), notes: p.notes, createdBy: p.createdBy })),
    };
  }

  async declareDriverSalary(driverId: string, input: { month: string; amount?: number }, createdBy: string) {
    const driver = await this.driversRepo.findOne({ where: { id: driverId } });
    if (!driver) throw new BadRequestException('Chauffeur inconnu');
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw new BadRequestException('Mois invalide (YYYY-MM)');
    const amount = input.amount ?? Number(driver.monthlySalary ?? 0);
    if (amount <= 0) throw new BadRequestException('Montant du salaire requis');
    const existing = await this.salariesRepo.findOne({ where: { driverId, month: input.month } });
    if (existing) throw new BadRequestException(`Salaire ${input.month} déjà déclaré`);
    const row = await this.salariesRepo.save(this.salariesRepo.create({ driverId, month: input.month, amount: amount.toFixed(2), driverPaymentId: null, createdBy }));
    return { id: row.id, month: row.month, amount: Number(row.amount), paid: false };
  }

  async removeDriverSalary(id: string): Promise<{ ok: true }> {
    const row = await this.salariesRepo.findOne({ where: { id } });
    if (row?.driverPaymentId) throw new BadRequestException('Salaire déjà payé : supprimez d’abord le paiement');
    await this.salariesRepo.delete({ id });
    return { ok: true };
  }

  async addDriverPayment(driverId: string, input: { amount?: number; feeIds?: string[]; salaryId?: string; kind?: 'fee' | 'salary' | 'advance' | 'other'; at: Date; notes?: string }, createdBy: string) {
    const driver = await this.driversRepo.findOne({ where: { id: driverId } });
    if (!driver) throw new BadRequestException('Chauffeur inconnu');
    // Paiement d'un salaire declare
    if (input.salaryId) {
      const sal = await this.salariesRepo.findOne({ where: { id: input.salaryId, driverId } });
      if (!sal) throw new BadRequestException('Salaire inconnu');
      if (sal.driverPaymentId) throw new BadRequestException('Salaire déjà payé');
      const p = await this.paymentsRepo.save(this.paymentsRepo.create({ driverId, kind: 'salary', amount: sal.amount, at: input.at, notes: input.notes ?? `Salaire ${sal.month}`, createdBy }));
      await this.salariesRepo.update({ id: sal.id }, { driverPaymentId: p.id });
      return { id: p.id, kind: p.kind, at: p.at.toISOString(), amount: Number(p.amount), notes: p.notes, createdBy: p.createdBy };
    }
    // Selection de primes : le montant est la somme des primes encore dues, et elles sont marquees reglees.
    let fees: VehicleExpense[] = [];
    if (input.feeIds && input.feeIds.length > 0) {
      fees = await this.expensesRepo.find({ where: { id: In(input.feeIds), driverId } });
      fees = fees.filter((f) => f.driverPaymentId === null);
      if (fees.length === 0) throw new BadRequestException('Aucune prime due dans la sélection');
    }
    const amount = fees.length > 0 ? fees.reduce((a, f) => a + Number(f.amount), 0) : Number(input.amount ?? 0);
    if (amount <= 0) throw new BadRequestException('Le montant doit être positif');
    const notes = input.notes ?? (fees.length > 0 ? `Règlement de ${fees.length} prime(s)` : null);
    const kind = fees.length > 0 ? 'fee' : input.kind ?? 'other';
    const p = await this.paymentsRepo.save(this.paymentsRepo.create({ driverId, kind, amount: amount.toFixed(2), at: input.at, notes, createdBy }));
    if (fees.length > 0) await this.expensesRepo.update({ id: In(fees.map((f) => f.id)) }, { driverPaymentId: p.id });
    return { id: p.id, kind: p.kind, at: p.at.toISOString(), amount: Number(p.amount), notes: p.notes, createdBy: p.createdBy };
  }

  async removeDriverPayment(id: string): Promise<{ ok: true }> {
    await this.expensesRepo.update({ driverPaymentId: id }, { driverPaymentId: null });
    await this.salariesRepo.update({ driverPaymentId: id }, { driverPaymentId: null });
    await this.paymentsRepo.delete({ id });
    return { ok: true };
  }

  /** Primes d'un chauffeur : une ligne par voyage confirme, avec total. */
  async driverFees(driverId: string, range?: DateRange) {
    const d = dateWhere(range);
    const rows = await this.expensesRepo.find({ where: { driverId, ...(d ? { at: d } : {}) }, order: { at: 'DESC' }, take: 500 });
    const trips = rows.length > 0 ? await this.tripsRepo.find({ where: { id: In(rows.map((r) => r.tripId ?? '')) } }) : [];
    const byTrip = new Map(trips.map((t) => [t.id, t]));
    const containers = trips.length > 0 ? await this.containersRepo.find({ where: { tripId: In(trips.map((t) => t.id)) } }) : [];
    const contByTrip = new Map<string, string>();
    for (const c of containers) contByTrip.set(c.tripId, [contByTrip.get(c.tripId), `${c.containerNumber ?? '?'} (${c.size}')`].filter(Boolean).join(' · '));
    const items = rows.map((r) => {
      const t = r.tripId ? byTrip.get(r.tripId) : undefined;
      return { expenseId: r.id, tripId: r.tripId, vehicleId: r.vehicleId, at: r.at.toISOString(), amount: Number(r.amount), origin: t?.origin ?? null, destination: t?.destination ?? null, containers: r.tripId ? contByTrip.get(r.tripId) ?? '' : '', paid: r.driverPaymentId !== null };
    });
    return { driverId, count: items.length, total: items.reduce((a, b) => a + b.amount, 0), items };
  }

  async summaryFor(vehicleId: string, range?: DateRange): Promise<VehicleAccountingSummary> {
    const [summary] = await this.summaryForMany([vehicleId], range);
    return summary;
  }

  /**
   * Synthèse par camion, calculée en une seule passe par table plutôt qu'une
   * requête par véhicule — le tableau flotte entière ne doit pas déclencher
   * N x 4 requêtes SQL.
   */
  async summaryForMany(vehicleIds: string[], range?: DateRange): Promise<VehicleAccountingSummary[]> {
    if (vehicleIds.length === 0) return [];
    const d = dateWhere(range);

    const [trips, expenses, maintenanceLogs, investments] = await Promise.all([
      this.tripsRepo.find({ where: { vehicleId: In(vehicleIds), ...(d ? { startedAt: d } : {}) } }),
      this.expensesRepo.find({ where: { vehicleId: In(vehicleIds), ...(d ? { at: d } : {}) } }),
      this.maintenanceLogsRepo.find({ where: { vehicleId: In(vehicleIds), ...(d ? { at: d } : {}) } }),
      this.investmentsRepo.find({ where: { vehicleId: In(vehicleIds), ...(d ? { at: d } : {}) } }),
    ]);

    return vehicleIds.map((vehicleId) => {
      const revenue = sum(trips.filter((t) => t.vehicleId === vehicleId).map((t) => Number(t.amount)));
      const tripsCount = trips.filter((t) => t.vehicleId === vehicleId).length;
      const generalExpenses = sum(
        expenses.filter((e) => e.vehicleId === vehicleId).map((e) => Number(e.amount)),
      );
      const maintenanceCost = sum(
        maintenanceLogs
          .filter((m) => m.vehicleId === vehicleId && m.cost !== null)
          .map((m) => Number(m.cost)),
      );
      const investmentTotal = sum(
        investments.filter((i) => i.vehicleId === vehicleId).map((i) => Number(i.amount)),
      );
      const expensesTotal = generalExpenses + maintenanceCost;

      return {
        vehicleId,
        tripsCount,
        revenue,
        expenses: expensesTotal,
        maintenanceCost,
        investments: investmentTotal,
        netResult: revenue - expensesTotal - investmentTotal,
      };
    });
  }

  /* --- interne ------------------------------------------------------------ */

  private async toEntries(trips: Trip[]): Promise<TripEntry[]> {
    if (trips.length === 0) return [];

    const [containers, clients, drivers] = await Promise.all([
      this.containersRepo.find({ where: { tripId: In(trips.map((t) => t.id)) } }),
      this.clientsRepo.find({ where: { id: In([...new Set(trips.map((t) => t.clientId))]) } }),
      this.driversRepo.find({ where: { id: In([...new Set(trips.map((t) => t.driverId))]) } }),
    ]);

    const clientById = new Map(clients.map((c) => [c.id, c]));
    const driverById = new Map(drivers.map((d) => [d.id, d]));
    const containersByTrip = new Map<string, TripContainer[]>();
    for (const c of containers) {
      const list = containersByTrip.get(c.tripId) ?? [];
      list.push(c);
      containersByTrip.set(c.tripId, list);
    }

    return trips.map((trip) => ({
      paid: Boolean(trip.paid),
      id: trip.id,
      vehicleId: trip.vehicleId,
      driverId: trip.driverId,
      driverName: driverById.get(trip.driverId)?.fullName ?? 'Chauffeur inconnu',
      clientId: trip.clientId,
      clientName: clientById.get(trip.clientId)?.name ?? 'Client inconnu',
      startedAt: trip.startedAt.toISOString(),
      endedAt: trip.endedAt?.toISOString() ?? null,
      origin: trip.origin,
      destination: trip.destination,
      amount: Number(trip.amount),
      containers: (containersByTrip.get(trip.id) ?? []).map((c) => ({
        id: c.id,
        containerNumber: c.containerNumber,
        size: c.size,
        loaded: c.loaded,
        notes: c.notes,
      })),
      notes: trip.notes,
      createdBy: trip.createdBy,
    }));
  }
}

function sum(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

function toClientRecord(row: Client): ClientRecord {
  return { id: row.id, name: row.name, contact: row.contact, notes: row.notes, active: row.active };
}

function toDriverRecord(row: Driver): DriverRecord {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    licenseNumber: row.licenseNumber,
    tripFee: Number(row.tripFee ?? 0),
    monthlySalary: Number(row.monthlySalary ?? 0),
    vehicleId: row.vehicleId ?? null,
    active: row.active,
  };
}

function toExpenseEntry(row: VehicleExpense): VehicleExpenseEntry {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    category: row.category,
    amount: Number(row.amount),
    at: row.at.toISOString(),
    reference: row.reference,
    notes: row.notes,
    createdBy: row.createdBy,
  };
}

function toInvestmentEntry(row: VehicleInvestment): VehicleInvestmentEntry {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    kind: row.kind,
    amount: Number(row.amount),
    at: row.at.toISOString(),
    description: row.description,
    createdBy: row.createdBy,
  };
}

/** Plage de dates optionnelle (bornes incluses, format YYYY-MM-DD). */
export interface DateRange {
  from?: string;
  to?: string;
}

/** Condition TypeORM pour un champ date selon la plage ; undefined si aucune borne. */
export function dateWhere(range?: DateRange) {
  const from = range?.from ? new Date(`${range.from}T00:00:00`) : undefined;
  const to = range?.to ? new Date(`${range.to}T23:59:59.999`) : undefined;
  if (from && to) return Between(from, to);
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThanOrEqual(to);
  return undefined;
}
