import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MaintenanceKind,
  MaintenanceLogEntry,
  MaintenancePlanState,
  MaintenanceStatus,
  VehicleState,
} from '../common/types';
import { MaintenancePlan } from './entities/maintenance-plan.entity';
import { MaintenanceLog } from './entities/maintenance-log.entity';
import { MAINTENANCE_CATALOG, labelOf, taskOf } from './maintenance.catalog';

/** Part de l'intervalle a partir de laquelle l'echeance est annoncee. */
const SOON_RATIO = 0.85;

const DAY_MS = 24 * 3600 * 1000;

export interface ServiceRecord {
  at: Date;
  odometer: number | null;
  engineHours: number | null;
  partReference: string | null;
  cost: number | null;
  notes: string | null;
}

/**
 * Suivi de l'entretien : vidanges, cartouches et controles periodiques.
 *
 * Le cache suit la regle des autres services de reference : les echeances
 * sont relues a chaque trame de chaque camion par le moteur de regles.
 * Toute ecriture appelle reload().
 */
@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly log = new Logger(MaintenanceService.name);

  /** Echeances actives, groupees par vehicule. */
  private plans = new Map<string, MaintenancePlan[]>();

  /**
   * Dernier etat signale par echeance. Les regles tournent a chaque
   * trame : sans cette memoire, un camion en retard de vidange produirait
   * une alerte toutes les dix secondes.
   */
  private readonly notified = new Map<string, MaintenanceStatus>();

  constructor(
    @InjectRepository(MaintenancePlan) private readonly plansRepo: Repository<MaintenancePlan>,
    @InjectRepository(MaintenanceLog) private readonly logsRepo: Repository<MaintenanceLog>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.plansRepo.find({ where: { active: true } });
    const grouped = new Map<string, MaintenancePlan[]>();
    for (const plan of rows) {
      const list = grouped.get(plan.vehicleId) ?? [];
      list.push(plan);
      grouped.set(plan.vehicleId, list);
    }
    this.plans = grouped;
    this.log.log(`${rows.length} echeances d'entretien chargees`);
  }

  /* --- lecture ---------------------------------------------------------- */

  /**
   * Echeances d'un camion, triees de la plus urgente a la plus lointaine.
   * `current` peut manquer : un camion dont aucune trame n'est arrivee
   * garde ses echeances calendaires, pas ses echeances kilometriques.
   */
  stateFor(vehicleId: string, current?: VehicleState): MaintenancePlanState[] {
    const plans = this.plans.get(vehicleId) ?? [];
    return plans
      .map((plan) => this.computeState(plan, current))
      .sort((a, b) => b.usage - a.usage);
  }

  /** Toutes les echeances de la flotte, les plus urgentes d'abord. */
  overview(vehicles: VehicleState[]): MaintenancePlanState[] {
    const byId = new Map(vehicles.map((v) => [v.id, v]));
    const all: MaintenancePlanState[] = [];

    for (const [vehicleId, plans] of this.plans) {
      const current = byId.get(vehicleId);
      for (const plan of plans) all.push(this.computeState(plan, current));
    }

    return all.sort((a, b) => b.usage - a.usage);
  }

  async logs(vehicleId?: string, limit = 200): Promise<MaintenanceLogEntry[]> {
    const rows = await this.logsRepo.find({
      where: vehicleId ? { vehicleId } : {},
      order: { at: 'DESC' },
      take: limit,
    });
    return rows.map(toLogEntry);
  }

  /* --- moteur de regles -------------------------------------------------- */

  /**
   * Echeances qui viennent de basculer vers « a prevoir » ou « depassee ».
   *
   * Deux silences volontaires :
   *
   * — le retour a l'etat normal est memorise sans rien signaler, c'est le
   *   franchissement qui interesse l'exploitant, pas l'etat permanent ;
   *
   * — la premiere evaluation d'une echeance ne declenche rien. Au demarrage
   *   de l'API, un parc dont la moitie des vidanges est en retard noierait
   *   le fil d'evenements sous quarante alertes qui ne racontent aucun
   *   evenement. Cet etat-la se lit dans l'onglet Entretien, qui existe
   *   pour ca ; le fil ne recoit que ce qui vient de changer.
   */
  detectTransitions(current: VehicleState): MaintenancePlanState[] {
    const crossed: MaintenancePlanState[] = [];

    for (const state of this.stateFor(current.id, current)) {
      const key = `${state.vehicleId}:${state.kind}`;
      const before = this.notified.get(key);
      if (before === state.status) continue;

      this.notified.set(key, state.status);
      if (before === undefined) continue;

      if (state.status === 'soon' || state.status === 'overdue') crossed.push(state);
    }

    return crossed;
  }

  /* --- ecriture ---------------------------------------------------------- */

  /**
   * Enregistre un entretien realise et repousse l'echeance.
   *
   * Le plan est cree a la volee s'il n'existe pas : un atelier qui change
   * une cartouche ne doit pas avoir a definir une periodicite d'abord.
   */
  async recordService(
    vehicleId: string,
    kind: MaintenanceKind,
    record: ServiceRecord,
    performedBy: string,
    current?: VehicleState,
  ): Promise<MaintenancePlanState> {
    if (!taskOf(kind)) throw new BadRequestException(`Operation d'entretien inconnue : ${kind}`);

    const plan = await this.ensurePlan(vehicleId, kind);

    await this.logsRepo.save(
      this.logsRepo.create({
        vehicleId,
        kind,
        at: record.at,
        odometer: record.odometer,
        engineHours: record.engineHours,
        partReference: record.partReference,
        cost: record.cost === null ? null : record.cost.toFixed(2),
        performedBy,
        notes: record.notes,
      }),
    );

    // Un releve absent ne doit pas effacer le precedent : sans compteur
    // saisi, l'axe kilometrique reste sur le dernier point connu.
    plan.lastServiceAt = record.at;
    if (record.odometer !== null) plan.lastServiceOdometer = record.odometer;
    if (record.engineHours !== null) plan.lastServiceHours = record.engineHours;

    const saved = await this.plansRepo.save(plan);
    await this.reload();

    // L'echeance repart a zero : le prochain franchissement doit alerter
    // meme si l'ancien etait deja signale.
    this.notified.delete(`${vehicleId}:${kind}`);

    return this.computeState(saved, current);
  }

  /** Cree ou met a jour la periodicite d'une operation pour un camion. */
  async savePlan(
    vehicleId: string,
    kind: MaintenanceKind,
    intervals: { intervalKm: number | null; intervalHours: number | null; intervalDays: number | null },
    notes: string | null,
    current?: VehicleState,
  ): Promise<MaintenancePlanState> {
    if (!taskOf(kind)) throw new BadRequestException(`Operation d'entretien inconnue : ${kind}`);

    if (intervals.intervalKm === null && intervals.intervalHours === null && intervals.intervalDays === null) {
      throw new BadRequestException('Definissez au moins une periodicite : kilometres, heures ou jours');
    }

    const plan = await this.ensurePlan(vehicleId, kind);
    plan.intervalKm = intervals.intervalKm;
    plan.intervalHours = intervals.intervalHours;
    plan.intervalDays = intervals.intervalDays;
    plan.notes = notes;
    plan.active = true;

    const saved = await this.plansRepo.save(plan);
    await this.reload();
    this.notified.delete(`${vehicleId}:${kind}`);

    return this.computeState(saved, current);
  }

  /** Retire une operation du suivi d'un camion, sans toucher a son journal. */
  async deactivatePlan(id: string): Promise<{ ok: true }> {
    const plan = await this.plansRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Echeance inconnue');

    plan.active = false;
    await this.plansRepo.save(plan);
    await this.reload();
    this.notified.delete(`${plan.vehicleId}:${plan.kind}`);
    return { ok: true };
  }

  /** Installe le catalogue de reference sur un camion qui n'a rien. */
  async applyCatalog(vehicleId: string): Promise<MaintenancePlanState[]> {
    for (const task of MAINTENANCE_CATALOG) {
      const existing = await this.plansRepo.findOne({ where: { vehicleId, kind: task.kind } });
      if (existing) continue;

      await this.plansRepo.save(
        this.plansRepo.create({
          vehicleId,
          kind: task.kind,
          intervalKm: task.intervalKm,
          intervalHours: task.intervalHours,
          intervalDays: task.intervalDays,
          lastServiceOdometer: null,
          lastServiceHours: null,
          lastServiceAt: null,
          active: true,
          notes: null,
        }),
      );
    }

    await this.reload();
    return this.stateFor(vehicleId);
  }

  /* --- interne ----------------------------------------------------------- */

  private async ensurePlan(vehicleId: string, kind: MaintenanceKind): Promise<MaintenancePlan> {
    const existing = await this.plansRepo.findOne({ where: { vehicleId, kind } });
    if (existing) return existing;

    const task = taskOf(kind)!;
    return this.plansRepo.create({
      vehicleId,
      kind,
      intervalKm: task.intervalKm,
      intervalHours: task.intervalHours,
      intervalDays: task.intervalDays,
      lastServiceOdometer: null,
      lastServiceHours: null,
      lastServiceAt: null,
      active: true,
      notes: null,
    });
  }

  /**
   * Trois axes, trois comptes a rebours. Le plus avance decide du statut :
   * une vidange due au kilometrage l'est meme si le delai calendaire, lui,
   * laisse encore six mois.
   */
  private computeState(plan: MaintenancePlan, current?: VehicleState): MaintenancePlanState {
    const axes: number[] = [];

    const remainingKm =
      plan.intervalKm !== null && plan.lastServiceOdometer !== null && current
        ? plan.lastServiceOdometer + plan.intervalKm - current.odometer
        : null;
    if (remainingKm !== null && plan.intervalKm) {
      axes.push((plan.intervalKm - remainingKm) / plan.intervalKm);
    }

    const remainingHours =
      plan.intervalHours !== null && plan.lastServiceHours !== null && current
        ? plan.lastServiceHours + plan.intervalHours - current.engineHours
        : null;
    if (remainingHours !== null && plan.intervalHours) {
      axes.push((plan.intervalHours - remainingHours) / plan.intervalHours);
    }

    const remainingDays =
      plan.intervalDays !== null && plan.lastServiceAt !== null
        ? Math.ceil(
            (plan.lastServiceAt.getTime() + plan.intervalDays * DAY_MS - Date.now()) / DAY_MS,
          )
        : null;
    if (remainingDays !== null && plan.intervalDays) {
      axes.push((plan.intervalDays - remainingDays) / plan.intervalDays);
    }

    const usage = axes.length > 0 ? Math.max(...axes) : 0;

    let status: MaintenanceStatus;
    if (axes.length === 0) status = 'unknown';
    else if (usage >= 1) status = 'overdue';
    else if (usage >= SOON_RATIO) status = 'soon';
    else status = 'ok';

    return {
      id: plan.id,
      vehicleId: plan.vehicleId,
      kind: plan.kind,
      label: labelOf(plan.kind),
      status,
      intervalKm: plan.intervalKm,
      intervalHours: plan.intervalHours,
      intervalDays: plan.intervalDays,
      lastServiceOdometer: plan.lastServiceOdometer,
      lastServiceHours: plan.lastServiceHours,
      lastServiceAt: plan.lastServiceAt?.toISOString() ?? null,
      remainingKm,
      remainingHours,
      remainingDays,
      usage: Number(usage.toFixed(3)),
      notes: plan.notes,
    };
  }
}

function toLogEntry(row: MaintenanceLog): MaintenanceLogEntry {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    kind: row.kind,
    label: labelOf(row.kind),
    at: row.at.toISOString(),
    odometer: row.odometer,
    engineHours: row.engineHours,
    partReference: row.partReference,
    cost: row.cost === null ? null : Number(row.cost),
    performedBy: row.performedBy,
    notes: row.notes,
  };
}

/**
 * Formule courte de l'echeance, pour un message d'alerte.
 *
 * Un seul axe est cite — le plus avance des trois. Enumerer « 800 km,
 * 14 h et 32 jours restants » dans un fil d'evenements ne dit pas ce
 * qu'il faut faire, alors que « 800 km restants » suffit a decider.
 */
export function describeDeadline(state: MaintenancePlanState): string {
  const axes: { ratio: number; text: string }[] = [];

  if (state.remainingKm !== null && state.intervalKm) {
    axes.push({
      ratio: state.remainingKm / state.intervalKm,
      text:
        state.remainingKm >= 0
          ? `${format(state.remainingKm)} km restants`
          : `${format(-state.remainingKm)} km de dépassement`,
    });
  }

  if (state.remainingHours !== null && state.intervalHours) {
    axes.push({
      ratio: state.remainingHours / state.intervalHours,
      text:
        state.remainingHours >= 0
          ? `${format(state.remainingHours)} h restantes`
          : `${format(-state.remainingHours)} h de dépassement`,
    });
  }

  if (state.remainingDays !== null && state.intervalDays) {
    axes.push({
      ratio: state.remainingDays / state.intervalDays,
      text:
        state.remainingDays >= 0
          ? `${state.remainingDays} j restants`
          : `${-state.remainingDays} j de retard`,
    });
  }

  if (axes.length === 0) return 'échéance inconnue';

  axes.sort((a, b) => a.ratio - b.ratio);
  return axes[0].text;
}

function format(value: number): string {
  return Math.round(value).toLocaleString('fr-FR');
}
