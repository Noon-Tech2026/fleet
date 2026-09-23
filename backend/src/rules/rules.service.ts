import { Injectable } from '@nestjs/common';
import { VehicleState } from '../common/types';
import { GeofenceService } from '../geofence/geofence.service';
import { FuelService } from '../fuel/fuel.service';
import { AlertsService } from './alerts.service';
import { ImmobilizerService } from '../immobilizer/immobilizer.service';
import { DeparturesService } from '../fleet/departures.service';
import { ExitRequestsService } from '../fleet/exit-requests.service';
import { MaintenanceService, describeDeadline } from '../maintenance/maintenance.service';

/** Sortie sans confirmation : buzzer cabine, jamais de coupure moteur. */
const BUZZ_SECONDS = 60; // duree d'une sonnerie (minuterie du boitier)
const BUZZ_REPEAT_MS = 5 * 60_000; // rappel tant que non confirme
const BUZZ_MAX = 3; // nombre max de sonneries par sortie

/** Sortie d'un cercle de securite : sonnerie repetee SANS limite jusqu'a retour ou acquittement. */
const PERIMETER_BUZZ_SECONDS = 60;
const PERIMETER_REPEAT_MS = 2 * 60_000;

/**
 * Règles métier évaluées à chaque position reçue.
 * Elles vivent ici et non dans Traccar : Traccar sait détecter une entrée
 * de geofence, mais pas « sortie du dépôt sans appui du bouton chauffeur ».
 */
@Injectable()
export class RulesService {
  /** Sorties non confirmees en cours, par vehicule. */
  private readonly unconfirmed = new Map<string, { lastBuzz: number; count: number; zone: { id: string; name: string } | null; exitedAt: Date }>();
  /** Alarmes de perimetre en cours : zone quittee + derniere sonnerie. */
  private readonly perimeterAlarm = new Map<string, { zoneId: string; lastBuzz: number }>();

  constructor(
    private readonly geofence: GeofenceService,
    private readonly fuel: FuelService,
    private readonly alerts: AlertsService,
    private readonly immobilizer: ImmobilizerService,
    private readonly departures: DeparturesService,
    private readonly exitRequests: ExitRequestsService,
    private readonly maintenance: MaintenanceService,
  ) {}

  async evaluate(previous: VehicleState | undefined, current: VehicleState): Promise<void> {
    this.checkZoneTransition(previous, current);
    await this.checkPerimeter(previous, current);
    await this.checkUnlockRequest(previous, current);
    await this.checkDeparture(previous, current);
    this.checkFuel(current);
    this.checkMaintenance(current);
  }

  private checkZoneTransition(previous: VehicleState | undefined, current: VehicleState): void {
    const before = previous?.zoneId ?? null;
    const after = current.zoneId;
    if (before === after) return;

    if (after && this.geofence.isForbidden(after)) {
      const zone = this.geofence.get(after);
      this.alerts.raise(
        current.id,
        'critical',
        'forbidden_zone_entered',
        `Entrée en zone interdite — ${zone?.name ?? after}`,
      );
    } else if (before && this.geofence.isForbidden(before)) {
      const zone = this.geofence.get(before);
      this.alerts.raise(
        current.id,
        'info',
        'forbidden_zone_left',
        `Sortie de zone interdite — ${zone?.name ?? before}`,
      );
    }
  }

  /**
   * Sortie d'une station sans confirmation du chauffeur.
   *
   * Décision client (19/09/2026) : on ne bloque pas le camion, on déclenche
   * le buzzer cabine (DOUT2) pour que le chauffeur appuie sur le bouton.
   * Rappel toutes les BUZZ_REPEAT_MS, au plus BUZZ_MAX fois ; arrêt immédiat
   * dès que le bouton est pressé. Le blocage reste une décision humaine.
   */
  private async checkDeparture(
    previous: VehicleState | undefined,
    current: VehicleState,
  ): Promise<void> {
    if (!previous) return;

    // Suivi d'une sortie non confirmee deja signalee.
    const open = this.unconfirmed.get(current.id);
    if (open) {
      const now = Date.now();
      if (current.departureConfirmed) {
        this.unconfirmed.delete(current.id);
        this.immobilizer.stopIoPolling(current.id);
        await this.exitRequests.pressButton(current.id, open.zone, open.exitedAt); // la demande d'abord : visible tout de suite
        await this.immobilizer.tripAck(current.id);
        current.departureConfirmed = false; // appui consomme : la prochaine sortie exigera un nouvel appui
        this.alerts.raise(current.id, 'info', 'departure_confirmed_late', 'Départ confirmé par le chauffeur après rappel');
      } else if (now - open.lastBuzz >= BUZZ_REPEAT_MS) {
        if (open.count >= BUZZ_MAX) {
          this.unconfirmed.delete(current.id);
        } else {
          open.count += 1;
          open.lastBuzz = now;
          await this.immobilizer.buzzerOn(current.id, BUZZ_SECONDS);
        }
      }
    }

    const wasAtStation = previous.zoneId !== null && !this.geofence.isForbidden(previous.zoneId);
    const hasLeft = wasAtStation && current.zoneId !== previous.zoneId;

    if (hasLeft) await this.departures.markDeparted(current.id);
    const leftZone = hasLeft ? this.geofence.get(previous.zoneId as string) : undefined;
    const leftStation = leftZone?.kind === 'station' ? { id: leftZone.id, name: leftZone.name } : null;


    if (hasLeft && leftStation) {
      this.alerts.raise(
        current.id,
        'critical',
        'departure_without_confirmation',
        'Sortie de station sans confirmation du chauffeur — buzzer cabine déclenché',
      );
      this.unconfirmed.set(current.id, { lastBuzz: Date.now(), count: 1, zone: leftStation, exitedAt: new Date() });
      await this.immobilizer.ledTrip(current.id, true);
      await this.immobilizer.buzzerOn(current.id, BUZZ_SECONDS);
      this.immobilizer.startIoPolling(current.id, 3_000, 10 * 60_000, 15_000);
    }

    // Une fois hors station, la confirmation est consommée : le prochain
    // départ devra être confirmé à nouveau.
    if (hasLeft) current.departureConfirmed = false;
  }

  /**
   * Cercle de securite (anti-vol). Sortie => alerte critique + buzzer repete
   * toutes les PERIMETER_REPEAT_MS, sans limite, jusqu'au retour du camion
   * dans la zone ou a l'acquittement par un superviseur (silencePerimeter).
   */
  private async checkPerimeter(previous: VehicleState | undefined, current: VehicleState): Promise<void> {
    const alarm = this.perimeterAlarm.get(current.id);

    if (alarm) {
      if (current.zoneId === alarm.zoneId) {
        this.perimeterAlarm.delete(current.id);
        await this.immobilizer.buzzerOff(current.id);
        const zone = this.geofence.get(alarm.zoneId);
        this.alerts.raise(current.id, 'info', 'perimeter_return', `Retour dans le périmètre — ${zone?.name ?? alarm.zoneId}`);
        return;
      }
      if (Date.now() - alarm.lastBuzz >= PERIMETER_REPEAT_MS) {
        alarm.lastBuzz = Date.now();
        await this.immobilizer.buzzerOn(current.id, PERIMETER_BUZZ_SECONDS);
      }
      return;
    }

    if (!previous) return;
    const left = previous.zoneId !== null && previous.zoneId !== current.zoneId && this.geofence.isAlarmedPerimeter(previous.zoneId);
    if (left === false) return;

    const zone = this.geofence.get(previous.zoneId as string);
    this.perimeterAlarm.set(current.id, { zoneId: previous.zoneId as string, lastBuzz: Date.now() });
    this.alerts.raise(current.id, 'critical', 'perimeter_exit', `Sortie du périmètre de sécurité — ${zone?.name ?? previous.zoneId}`);
    await this.immobilizer.buzzerOn(current.id, PERIMETER_BUZZ_SECONDS);
  }

  /** Apres un rejet : le chauffeur doit appuyer a nouveau ; le rappel repart. */
  async resumeExitReminder(vehicle: VehicleState): Promise<void> {
    vehicle.departureConfirmed = false;
    this.unconfirmed.set(vehicle.id, { lastBuzz: Date.now(), count: 1, zone: null, exitedAt: new Date() });
    await this.immobilizer.ledTrip(vehicle.id, true);
    await this.immobilizer.buzzerOn(vehicle.id, BUZZ_SECONDS); // rejet : le buzzer repart comme a la sortie
    this.immobilizer.startIoPolling(vehicle.id, 3_000, 10 * 60_000, 15_000);
    await this.immobilizer.buzzerOn(vehicle.id, BUZZ_SECONDS);
  }

  /**
   * Etats des boutons lus par getio (reponse du boitier). Equivalent d'une
   * trame portant in2/in3 : on met a jour le camion puis on reevalue.
   */
  async applyButtons(vehicle: VehicleState, tripPressed: boolean, unlockPressed: boolean): Promise<void> {
    const before: VehicleState = { ...vehicle };
    if (tripPressed) vehicle.departureConfirmed = true;
    if (unlockPressed) vehicle.unlockRequested = true;
    if (tripPressed || unlockPressed) await this.evaluate(before, vehicle);
  }

  /** Decision prise : plus de rappel, voyant eteint. */
  stopExitReminder(vehicleId: string): void {
    this.unconfirmed.delete(vehicleId);
    this.immobilizer.stopIoPolling(vehicleId);
    void this.immobilizer.ledTrip(vehicleId, false);
  }

  /**
   * DIN3 : le chauffeur demande le deblocage du demarreur. Alerte critique
   * pour le superviseur + bip de 2 s pour confirmer au chauffeur que la
   * demande est partie. L'etat retombe a la reautorisation.
   */
  private async checkUnlockRequest(previous: VehicleState | undefined, current: VehicleState): Promise<void> {
    const rising = current.unlockRequested && (previous === undefined || previous.unlockRequested === false);
    if (rising === false) return;
    this.alerts.raise(current.id, 'critical', 'unlock_requested', `Le chauffeur demande le déblocage du démarreur (${current.driver || 'non affecté'})`);
    await this.immobilizer.buzzerOn(current.id, 2);
    // Voyant eteint = demande enregistree ; il se rallume apres 5 min si toujours bloque.
    await this.immobilizer.ledUnlock(current.id, false);
    setTimeout(() => {
      if (current.starter !== 'allowed') void this.immobilizer.ledUnlock(current.id, true);
    }, 5 * 60_000);
  }

  /** Acquittement par un superviseur : coupe le buzzer, l'alerte reste dans le journal. */
  async silencePerimeter(vehicleId: string): Promise<boolean> {
    if (this.perimeterAlarm.has(vehicleId) === false) return false;
    this.perimeterAlarm.delete(vehicleId);
    await this.immobilizer.buzzerOff(vehicleId);
    return true;
  }

  hasPerimeterAlarm(vehicleId: string): boolean {
    return this.perimeterAlarm.has(vehicleId);
  }

  private checkFuel(current: VehicleState): void {
    const labels: Record<string, [level: 'critical' | 'warning' | 'info', text: (tank: string, d: number) => string]> = {
      fuel_drop: ['critical', (t, d) => `Chute anormale du réservoir ${t} — ${d} L véhicule à l'arrêt (vol possible)`],
      fuel_leak: ['warning', (t, d) => `Baisse lente du réservoir ${t} moteur coupé — ${d} L (fuite possible)`],
      fuel_refill: ['info', (t, d) => `Plein détecté — +${d} L (réservoir ${t})`],
      fuel_overconsumption: ['warning', (_t, d) => `Consommation anormale — ${d} L/100 km`],
    };
    for (const tank of ['main', 'aux'] as const) {
      const liters = tank === 'main' ? current.fuelMain : current.fuelAux;
      const r = this.fuel.inspect(current.id, tank, liters, current.speed, current.ignition, current.odometer);
      if (r === null) continue;
      const [level, text] = labels[r.code];
      this.alerts.raise(current.id, level, r.code, text(tank === 'main' ? 'principal' : 'auxiliaire', r.delta));
    }
  }

  private checkMaintenance(current: VehicleState): void {
    for (const due of this.maintenance.detectTransitions(current)) {
      if (due.status === 'overdue') {
        this.alerts.raise(
          current.id,
          'warning',
          'maintenance_overdue',
          `Entretien dépassé — ${due.label} (${describeDeadline(due)})`,
        );
      } else {
        this.alerts.raise(
          current.id,
          'info',
          'maintenance_due',
          `Entretien à prévoir — ${due.label} (${describeDeadline(due)})`,
        );
      }
    }
  }
}
