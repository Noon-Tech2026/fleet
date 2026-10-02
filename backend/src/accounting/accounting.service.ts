import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
export class AccountingService {
  constructor(
    @InjectRepository(Client) private readonly clientsRepo: Repository<Client>,
    @InjectRepository(Driver) private readonly driversRepo: Repository<Driver>,
    @InjectRepository(DriverPayment) private readonly paymentsRepo: Repository<DriverPayment>,
    @InjectRepository(ClientEntry) private readonly clientEntriesRepo: Repository<ClientEntry>,
    @InjectRepository(Trip) private readonly tripsRepo: Repository<Trip>,
    @InjectRepository(TripContainer) private readonly containersRepo: Repository<TripContainer>,
    @InjectRepository(VehicleExpense) private readonly expensesRepo: Repository<VehicleExpense>,
    @InjectRepository(VehicleInvestment) private readonly investmentsRepo: Repository<VehicleInvestment>,
    @InjectRepository(MaintenanceLog) private readonly maintenanceLogsRepo: Repository<MaintenanceLog>,
  ) {}

  /* --- référentiels ------------------------------------------------------ */

  async clients(): Promise<ClientRecord[]> {
    const rows = await this.clientsRepo.find({ order: { name: 'ASC' } });
    return rows.map(toClientRecord);
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
    return rows.map(toDriverRecord);
  }

  async createDriver(data: {
    fullName: string;
    phone?: string | null;
    licenseNumber?: string | null;
    tripFee?: number;
  }): Promise<DriverRecord> {
    const saved = await this.driversRepo.save(
      this.driversRepo.create({
        fullName: data.fullName,
        phone: data.phone ?? null,
        licenseNumber: data.licenseNumber ?? null,
        tripFee: (data.tripFee ?? 0).toFixed(2),
        active: true,
      }),
    );
    return toDriverRecord(saved);
  }

  async updateDriver(
    id: string,
    patch: { fullName?: string; phone?: string | null; licenseNumber?: string | null; tripFee?: number; active?: boolean },
  ): Promise<DriverRecord> {
    const driver = await this.driversRepo.findOne({ where: { id } });
    if (!driver) throw new NotFoundException('Chauffeur inconnu');
    const { tripFee, ...rest } = patch;
    Object.assign(driver, rest);
    if (tripFee !== undefined) driver.tripFee = tripFee.toFixed(2);
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
    const lines = [
      ...trips.map((t) => ({ id: `trip:${t.id}`, type: 'trip' as const, kind: 'debit' as const, at: t.startedAt.toISOString(), amount: Number(t.amount), label: `Voyage ${t.vehicleId} — ${t.origin ?? '—'} → ${t.destination ?? '—'}`, tripId: t.id, vehicleId: t.vehicleId, deletable: false })),
      ...entries.map((e) => ({ id: e.id, type: 'entry' as const, kind: e.kind, at: e.at.toISOString(), amount: Number(e.amount), label: e.label, tripId: null, vehicleId: null, deletable: true })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const sum = (rows: { kind: string; amount: number }[], kind: string) => rows.filter((r) => r.kind === kind).reduce((a, r) => a + r.amount, 0);
    const periodDebit = sum(lines, 'debit'), periodCredit = sum(lines, 'credit');
    const allDebit = allTrips.reduce((a, t) => a + Number(t.amount), 0) + allEntries.filter((e) => e.kind === 'debit').reduce((a, e) => a + Number(e.amount), 0);
    const allCredit = allEntries.filter((e) => e.kind === 'credit').reduce((a, e) => a + Number(e.amount), 0);
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

  /** Releve complet : primes, paiements, solde (periode optionnelle sur les deux). */
  async driverLedger(driverId: string, range?: DateRange) {
    const fees = await this.driverFees(driverId, range);
    const d = dateWhere(range);
    const payments = await this.paymentsRepo.find({ where: { driverId, ...(d ? { at: d } : {}) }, order: { at: 'DESC' }, take: 500 });
    const paid = payments.reduce((a, p) => a + Number(p.amount), 0);
    // Solde global (toutes periodes) pour afficher ce qui reste du reellement
    const allFees = await this.driverFees(driverId);
    const allPaid = (await this.paymentsRepo.find({ where: { driverId } })).reduce((a, p) => a + Number(p.amount), 0);
    return {
      driverId,
      period: { fees: fees.total, feesCount: fees.count, paid, balance: fees.total - paid },
      overall: { fees: allFees.total, paid: allPaid, balance: allFees.total - allPaid },
      fees: fees.items,
      payments: payments.map((p) => ({ id: p.id, at: p.at.toISOString(), amount: Number(p.amount), notes: p.notes, createdBy: p.createdBy })),
    };
  }

  async addDriverPayment(driverId: string, input: { amount: number; at: Date; notes?: string }, createdBy: string) {
    if (input.amount <= 0) throw new BadRequestException('Le montant doit être positif');
    const driver = await this.driversRepo.findOne({ where: { id: driverId } });
    if (!driver) throw new BadRequestException('Chauffeur inconnu');
    const p = await this.paymentsRepo.save(this.paymentsRepo.create({ driverId, amount: input.amount.toFixed(2), at: input.at, notes: input.notes ?? null, createdBy }));
    return { id: p.id, at: p.at.toISOString(), amount: Number(p.amount), notes: p.notes, createdBy: p.createdBy };
  }

  async removeDriverPayment(id: string): Promise<{ ok: true }> {
    await this.paymentsRepo.delete({ id });
    return { ok: true };
  }

  /** Primes d'un chauffeur : une ligne par voyage confirme, avec total. */
  async driverFees(driverId: string, range?: DateRange) {
    const d = dateWhere(range);
    const rows = await this.expensesRepo.find({ where: { driverId, ...(d ? { at: d } : {}) }, order: { at: 'DESC' }, take: 500 });
    const trips = rows.length > 0 ? await this.tripsRepo.find({ where: { id: In(rows.map((r) => r.tripId ?? '')) } }) : [];
    const byTrip = new Map(trips.map((t) => [t.id, t]));
    const items = rows.map((r) => {
      const t = r.tripId ? byTrip.get(r.tripId) : undefined;
      return { expenseId: r.id, tripId: r.tripId, vehicleId: r.vehicleId, at: r.at.toISOString(), amount: Number(r.amount), origin: t?.origin ?? null, destination: t?.destination ?? null };
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
