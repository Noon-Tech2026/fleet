import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { VehicleState } from '../common/types';
import { TELEMETRY_SOURCE, TelemetrySource, RawPosition } from '../telemetry/telemetry.source';
import { EventsService } from '../events/events.service';
import { GeofenceService } from '../geofence/geofence.service';
import { FuelService } from '../fuel/fuel.service';
import { RulesService } from '../rules/rules.service';
import { ImmobilizerService } from '../immobilizer/immobilizer.service';
import { VehiclesService } from './vehicles.service';
import { PositionsService } from './positions.service';
import { DeparturesService } from './departures.service';

const OFFLINE_AFTER_MS = 5 * 60 * 1000;

@Injectable()
export class FleetService implements OnModuleInit {
  private readonly log = new Logger(FleetService.name);

  /**
   * Etat courant, en memoire.
   *
   * Volontairement pas en base : c'est une vue qui change chaque seconde
   * et dont seule la derniere valeur compte. L'historique durable vit
   * dans la table positions, alimentee par PositionsService qui filtre
   * ce qui merite d'etre garde.
   */
  private readonly state = new Map<string, VehicleState>();

  constructor(
    @Inject(TELEMETRY_SOURCE) private readonly source: TelemetrySource,
    private readonly events: EventsService,
    private readonly geofence: GeofenceService,
    private readonly fuel: FuelService,
    private readonly rules: RulesService,
    private readonly immobilizer: ImmobilizerService,
    private readonly vehicles: VehiclesService,
    private readonly positions: PositionsService,
    private readonly departures: DeparturesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.source.start((raw) => {
      void this.ingest(raw).catch((err) => this.log.error(`Ingestion : ${String(err)}`));
    });
  }

  all(): VehicleState[] {
    const now = Date.now();
    return [...this.state.values()].map((v) => ({
      ...v,
      online: now - new Date(v.updatedAt).getTime() < OFFLINE_AFTER_MS,
    }));
  }

  get(id: string): VehicleState {
    const v = this.state.get(id);
    if (!v) throw new NotFoundException(`Aucune donnee recue pour ${id}`);
    return v;
  }

  /** Confirmation manuelle depuis l'interface (le bouton physique passe par ingest). */
  async confirmDeparture(id: string): Promise<VehicleState> {
    const v = this.get(id);
    v.departureConfirmed = true;
    await this.departures.markConfirmed(id);
    this.events.publish({ type: 'position', vehicle: { ...v } });
    return v;
  }

  /**
   * Chaine de traitement d'une position :
   * conversion -> etat -> regles metier -> immobiliseur -> persistance -> diffusion.
   */
  private async ingest(raw: RawPosition): Promise<void> {
    const previous = this.state.get(raw.vehicleId);
    const meta = this.vehicles.peek(raw.vehicleId);

    // Un boitier inconnu au repertoire est signale une fois, puis ignore.
    // Sans ce garde-fou, un IMEI mal saisi creerait un camion fantome.
    if (!meta) {
      if (!previous) this.log.warn(`Trame d'un vehicule absent du repertoire : ${raw.vehicleId}`);
      return;
    }

    const current: VehicleState = {
      id: raw.vehicleId,
      plate: meta.plate,
      driver: meta.driver,
      imei: meta.imei,

      lat: raw.lat,
      lon: raw.lon,
      speed: raw.speed,
      course: raw.course,

      ignition: raw.ignition,
      // L'appui bouton est une impulsion : on garde l'etat confirme
      // jusqu'a la sortie de station (voir RulesService.checkDeparture).
      departureConfirmed: raw.buttonPressed || (previous?.departureConfirmed ?? false),
      starter: previous?.starter ?? (raw.outputActive ? 'blocked' : 'allowed'),

      fuelMain: this.fuel.toLiters(raw.vehicleId, 'main', raw.fuelMainVolts),
      fuelAux: this.fuel.toLiters(raw.vehicleId, 'aux', raw.fuelAuxVolts),

      odometer: raw.odometer,
      engineHours: raw.engineHours,

      zoneId: this.geofence.locate(raw.lat, raw.lon)?.id ?? null,
      battery: Number(raw.battery.toFixed(1)),
      gsm: raw.gsm,

      online: true,
      updatedAt: raw.at.toISOString(),
    };

    this.state.set(current.id, current);

    // Le bouton physique cloture la partie « confirmation » de la fiche.
    if (raw.buttonPressed) await this.departures.markConfirmed(current.id);

    await this.rules.evaluate(previous, current);
    await this.immobilizer.reconcile(current);
    await this.positions.record(current);

    this.events.publish({ type: 'position', vehicle: { ...current } });
  }
}
