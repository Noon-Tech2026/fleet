import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, In, Repository } from 'typeorm';
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
  }): Promise<DriverRecord> {
    const saved = await this.driversRepo.save(
      this.driversRepo.create({
        fullName: data.fullName,
        phone: data.phone ?? null,
        licenseNumber: data.licenseNumber ?? null,
        active: true,
      }),
    );
    return toDriverRecord(saved);
  }

  async updateDriver(
    id: string,
    patch: { fullName?: string; phone?: string | null; licenseNumber?: string | null; active?: boolean },
  ): Promise<DriverRecord> {
    const driver = await this.driversRepo.findOne({ where: { id } });
    if (!driver) throw new NotFoundException('Chauffeur inconnu');
    Object.assign(driver, patch);
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

    const [entry] = await this.toEntries([trip]);
    return entry;
  }

  async updateTrip(
    id: string,
    patch: {
      endedAt?: Date | null;
      origin?: string | null;
      destination?: string | null;
      amount?: number;
      notes?: string | null;
    },
  ): Promise<TripEntry> {
    const trip = await this.tripsRepo.findOne({ where: { id } });
    if (!trip) throw new NotFoundException('Voyage inconnu');

    if (patch.endedAt !== undefined) trip.endedAt = patch.endedAt;
    if (patch.origin !== undefined) trip.origin = patch.origin;
    if (patch.destination !== undefined) trip.destination = patch.destination;
    if (patch.notes !== undefined) trip.notes = patch.notes;
    if (patch.amount !== undefined) {
      if (patch.amount < 0) throw new BadRequestException('Le montant ne peut pas être négatif');
      trip.amount = patch.amount.toFixed(2);
    }

    const saved = await this.tripsRepo.save(trip);
    const [entry] = await this.toEntries([saved]);
    return entry;
  }

  /* --- charges -------------------------------------------------------------- */

  async expensesFor(vehicleId: string, limit = 200): Promise<VehicleExpenseEntry[]> {
    const rows = await this.expensesRepo.find({
      where: { vehicleId },
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

  async investmentsFor(vehicleId: string, limit = 200): Promise<VehicleInvestmentEntry[]> {
    const rows = await this.investmentsRepo.find({
      where: { vehicleId },
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

  /* --- synthèse ------------------------------------------------------------ */

  async summaryFor(vehicleId: string): Promise<VehicleAccountingSummary> {
    const [summary] = await this.summaryForMany([vehicleId]);
    return summary;
  }

  /**
   * Synthèse par camion, calculée en une seule passe par table plutôt qu'une
   * requête par véhicule — le tableau flotte entière ne doit pas déclencher
   * N x 4 requêtes SQL.
   */
  async summaryForMany(vehicleIds: string[]): Promise<VehicleAccountingSummary[]> {
    if (vehicleIds.length === 0) return [];

    const [trips, expenses, maintenanceLogs, investments] = await Promise.all([
      this.tripsRepo.find({ where: { vehicleId: In(vehicleIds) } }),
      this.expensesRepo.find({ where: { vehicleId: In(vehicleIds) } }),
      this.maintenanceLogsRepo.find({ where: { vehicleId: In(vehicleIds) } }),
      this.investmentsRepo.find({ where: { vehicleId: In(vehicleIds) } }),
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
