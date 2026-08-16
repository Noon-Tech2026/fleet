import { Injectable } from '@nestjs/common';
import { VehicleState } from '../common/types';
import { GeofenceService } from '../geofence/geofence.service';
import { FuelService } from '../fuel/fuel.service';
import { AlertsService } from './alerts.service';
import { ImmobilizerService, SYSTEM_ACTOR } from '../immobilizer/immobilizer.service';
import { DeparturesService } from '../fleet/departures.service';

/**
 * Règles métier évaluées à chaque position reçue.
 * Elles vivent ici et non dans Traccar : Traccar sait détecter une entrée
 * de geofence, mais pas « sortie du dépôt sans appui du bouton chauffeur ».
 */
@Injectable()
export class RulesService {
  constructor(
    private readonly geofence: GeofenceService,
    private readonly fuel: FuelService,
    private readonly alerts: AlertsService,
    private readonly immobilizer: ImmobilizerService,
    private readonly departures: DeparturesService,
  ) {}

  async evaluate(previous: VehicleState | undefined, current: VehicleState): Promise<void> {
    this.checkZoneTransition(previous, current);
    await this.checkDeparture(previous, current);
    this.checkFuel(current);
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
   * Le blocage est demandé, jamais appliqué immédiatement : le camion roule
   * au moment de la détection. ImmobilizerService l'exécutera au prochain
   * arrêt, contact coupé.
   */
  private async checkDeparture(
    previous: VehicleState | undefined,
    current: VehicleState,
  ): Promise<void> {
    if (!previous) return;

    const wasAtStation = previous.zoneId !== null && !this.geofence.isForbidden(previous.zoneId);
    const hasLeft = wasAtStation && current.zoneId !== previous.zoneId;

    if (hasLeft) await this.departures.markDeparted(current.id);

    if (hasLeft && !current.departureConfirmed) {
      this.alerts.raise(
        current.id,
        'critical',
        'departure_without_confirmation',
        'Sortie de station sans confirmation du chauffeur — blocage programmé au prochain arrêt',
      );
      await this.immobilizer.requestBlock(
        current,
        SYSTEM_ACTOR,
        'Sortie sans confirmation du chauffeur',
      );
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
}
