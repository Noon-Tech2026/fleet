import { Injectable } from '@nestjs/common';
import { VehicleState } from '../common/types';
import { GeofenceService } from '../geofence/geofence.service';
import { FuelService } from '../fuel/fuel.service';
import { AlertsService } from './alerts.service';
import { ImmobilizerService } from '../immobilizer/immobilizer.service';
import { DeparturesService } from '../fleet/departures.service';
import { MaintenanceService, describeDeadline } from '../maintenance/maintenance.service';

/** Sortie sans confirmation : buzzer cabine, jamais de coupure moteur. */
const BUZZ_SECONDS = 60; // duree d'une sonnerie (minuterie du boitier)
const BUZZ_REPEAT_MS = 5 * 60_000; // rappel tant que non confirme
const BUZZ_MAX = 3; // nombre max de sonneries par sortie

/**
 * Règles métier évaluées à chaque position reçue.
 * Elles vivent ici et non dans Traccar : Traccar sait détecter une entrée
 * de geofence, mais pas « sortie du dépôt sans appui du bouton chauffeur ».
 */
@Injectable()
export class RulesService {
  /** Sorties non confirmees en cours, par vehicule. */
  private readonly unconfirmed = new Map<string, { lastBuzz: number; count: number }>();

  constructor(
    private readonly geofence: GeofenceService,
    private readonly fuel: FuelService,
    private readonly alerts: AlertsService,
    private readonly immobilizer: ImmobilizerService,
    private readonly departures: DeparturesService,
    private readonly maintenance: MaintenanceService,
  ) {}

  async evaluate(previous: VehicleState | undefined, current: VehicleState): Promise<void> {
    this.checkZoneTransition(previous, current);
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
        await this.immobilizer.buzzerOff(current.id);
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

    if (hasLeft && !current.departureConfirmed) {
      this.alerts.raise(
        current.id,
        'critical',
        'departure_without_confirmation',
        'Sortie de station sans confirmation du chauffeur — buzzer cabine déclenché',
      );
      this.unconfirmed.set(current.id, { lastBuzz: Date.now(), count: 1 });
      await this.immobilizer.buzzerOn(current.id, BUZZ_SECONDS);
    }

    // Une fois hors station, la confirmation est consommée : le prochain
    // départ devra être confirmé à nouveau.
    if (hasLeft) current.departureConfirmed = false;
  }

  private checkFuel(current: VehicleState): void {
    const drop = this.fuel.inspect(current.id, 'main', current.fuelMain, current.speed);
    if (drop) {
      this.alerts.raise(
        current.id,
        'critical',
        'fuel_drop',
        `Chute anormale du réservoir principal — ${drop.delta} L véhicule à l'arrêt`,
      );
    }

    const dropAux = this.fuel.inspect(current.id, 'aux', current.fuelAux, current.speed);
    if (dropAux) {
      this.alerts.raise(
        current.id,
        'critical',
        'fuel_drop',
        `Chute anormale du réservoir auxiliaire — ${dropAux.delta} L véhicule à l'arrêt`,
      );
    }
  }

  /**
   * Echeances d'entretien.
   *
   * MaintenanceService ne renvoie que les franchissements de seuil, pas
   * l'etat courant : une vidange en retard depuis trois semaines ne doit
   * pas produire une alerte a chaque trame.
   *
   * Niveau `warning` et non `critical` : un entretien depasse coute un
   * moteur a terme, il ne met personne en danger dans la minute. Le
   * critique reste reserve a la zone interdite et au siphonnage.
   */
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
