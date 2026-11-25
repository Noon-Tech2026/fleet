import { Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Driver } from '../accounting/entities/driver.entity';
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

  /** Chauffeur attribue a chaque camion (page Chauffeurs), rafraichi toutes les 30 s. */
  private driverByVehicle = new Map<string, string>();
  private driverTimer?: ReturnType<typeof setInterval>;

  private async refreshDrivers(): Promise<void> {
    try {
      const rows = await this.dataSource.getRepository(Driver).find();
      const map = new Map<string, string>();
      for (const d of rows as Array<{ vehicleId?: string | null; fullName?: string; active?: boolean }>) {
        if (d.vehicleId && d.fullName && d.active !== false) map.set(d.vehicleId, d.fullName);
      }
      this.driverByVehicle = map;
      // Camions deja a l'ecran (y compris hors ligne) : chauffeur a jour sans attendre une trame.
      for (const v of this.state.values()) {
        const name = map.get(v.id) ?? this.vehicles.peek(v.id)?.driver;
        if (name !== undefined && v.driver !== name) {
          v.driver = name;
          this.events.publish({ type: 'position', vehicle: { ...v } });
        }
      }
    } catch {
      /* base indisponible au demarrage : nouvel essai au prochain tour */
    }
  }

  constructor(
    @Inject(TELEMETRY_SOURCE) private readonly source: TelemetrySource,
    private readonly events: EventsService,
    private readonly geofence: GeofenceService,
    private readonly fuel: FuelService,
    private readonly dataSource: DataSource,
    private readonly rules: RulesService,
    private readonly immobilizer: ImmobilizerService,
    private readonly vehicles: VehiclesService,
    private readonly positions: PositionsService,
    private readonly departures: DeparturesService,
  ) {    setTimeout(() => void this.refreshDrivers(), 3_000);
    this.driverTimer = setInterval(() => void this.refreshDrivers(), 30_000);
  }

  async onModuleInit(): Promise<void> {
    // Chaque minute : un camion muet depuis 5 min passe « Hors ligne » a l'ecran.
    setInterval(() => this.sweepOffline(), 60_000);
    setTimeout(() => void this.immobilizer.resyncOutputs(this.vehicles.list().map((v) => v.id)), 12_000);
    // Reponses getio : etat reel des sorties, applique au camion concerne.
    this.source.onIoReport?.((report) => {
      const v = this.state.get(report.vehicleId);
      if (v === undefined) return;
      this.immobilizer.applyIoReport(v, report);
      void this.rules.applyButtons(v, report.din[2] === true, report.din[3] === true).then(() => {
        this.events.publish({ type: 'position', vehicle: { ...v } });
      });
    });
    // Au boot : interroger tous les boitiers (ceux hors ligne repondront a leur reveil).
    setTimeout(() => void this.source.queryIoAll?.().catch(() => undefined), 8000);

    // Chauffeurs charges AVANT les premieres trames (sinon « Non affecte » apres un redemarrage).
    await this.refreshDrivers();
    // Trames d'un meme camion traitees dans l'ordre, jamais en parallele.
    await this.source.start((raw) => this.enqueue(raw));
    setTimeout(() => void this.restoreMissing(), 20_000);
  }

  /**
   * Camions sans etat apres le demarrage alors qu'ils ont deja emis : leur derniere
   * trame Traccar etait une reponse de commande (getio, sans GPS). On reprend leur
   * derniere vraie position.
   */
  private async restoreMissing(): Promise<void> {
    const src = this.source as TelemetrySource & { lastRealPosition?: (id: string) => Promise<RawPosition | null> };
    if (!src.lastRealPosition) return;
    for (const v of this.vehicles.list()) {
      if (this.state.has(v.id)) continue;
      try {
        const raw = await src.lastRealPosition(v.id);
        if (raw && !this.state.has(v.id)) {
          await this.ingest(raw);
          this.log.log(`${v.id} — derniere position restauree (${raw.at.toISOString()})`);
        }
      } catch (e) {
        this.log.warn(`${v.id} — restauration impossible : ${String(e)}`);
      }
    }
  }

  /** Point ou l'arret en cours a commence, par camion. */
  private readonly stopAnchor = new Map<string, { lat: number; lon: number }>();

  /**
   * Debut de l'arret en cours. Roulage (> 5 km/h) : null. Un deplacement de plus de
   * 300 m depuis le point d'arret ouvre un nouvel arret (le bruit GPS ne le fait pas).
   */
  private async stopSince(previous: VehicleState | undefined, raw: RawPosition): Promise<string | null> {
    const id = raw.vehicleId;
    if (raw.speed > 5) {
      this.stopAnchor.delete(id);
      return null;
    }
    const anchor = this.stopAnchor.get(id);
    if (anchor && previous?.stoppedSince) {
      if (haversineKm(anchor.lat, anchor.lon, raw.lat, raw.lon) < 0.3) return previous.stoppedSince;
      this.stopAnchor.set(id, { lat: raw.lat, lon: raw.lon });
      return raw.at.toISOString();
    }
    this.stopAnchor.set(id, { lat: raw.lat, lon: raw.lon });
    if (previous !== undefined) return previous.speed > 5 ? raw.at.toISOString() : previous.stoppedSince ?? raw.at.toISOString();
    // Premiere trame apres demarrage de l'API : fin du dernier roulage connu en base.
    try {
      const rows: Array<{ t: unknown }> = await this.dataSource.query(
        'SELECT MAX(recorded_at) AS t FROM positions WHERE vehicle_id = ? AND speed > 5',
        [id],
      );
      const v = rows[0]?.t;
      if (v !== null && v !== undefined) {
        const d = v instanceof Date ? v : new Date(String(v).includes('T') ? String(v) : `${String(v).replace(' ', 'T')}Z`);
        if (Number.isFinite(d.getTime()) && d.getTime() <= raw.at.getTime()) return d.toISOString();
      }
    } catch {
      /* base indisponible : on part de cette trame */
    }
    return raw.at.toISOString();
  }

  private sweepOffline(): void {
    const now = Date.now();
    for (const v of this.state.values()) {
      if (v.online !== false && now - Date.parse(v.updatedAt) >= OFFLINE_AFTER_MS) {
        v.online = false;
        this.events.publish({ type: 'position', vehicle: { ...v } });
      }
    }
  }

  /** File par camion : une trame n'est traitee qu'apres la precedente du meme camion. */
  private readonly chains = new Map<string, Promise<void>>();

  private enqueue(raw: RawPosition): void {
    const prev = this.chains.get(raw.vehicleId) ?? Promise.resolve();
    const next = prev
      .then(() => this.ingest(raw))
      .catch((err) => this.log.error(`Ingestion : ${String(err)}`));
    this.chains.set(raw.vehicleId, next);
    // Liberer la reference quand la file est vide.
    void next.then(() => { if (this.chains.get(raw.vehicleId) === next) this.chains.delete(raw.vehicleId); });
  }

  /** Rebroadcast de l'etat complet : apres un changement du referentiel camions. */
  pushSnapshot(): void {
    this.events.publish({ type: 'snapshot', vehicles: this.all(), alerts: [] } as never);
  }

  /**
   * Periodes moteur tournant camion arrete >= minMinutes, d'apres l'historique Traccar.
   * Meme regle que l'alerte en direct (RulesService.checkIdle). Fenetre max 7 jours,
   * lue jour par jour pour limiter la memoire.
   */
  async idleSessions(id: string, fromIso?: string, toIso?: string, minMinutes = 10) {
    this.get(id); // 404 si camion inconnu
    const src = this.source as TelemetrySource & { route?: (v: string, f: Date, t: Date) => Promise<RawPosition[]> };
    const to = toIso && Number.isFinite(Date.parse(toIso)) ? new Date(toIso) : new Date();
    let from = fromIso && Number.isFinite(Date.parse(fromIso)) ? new Date(fromIso) : new Date(to.getTime() - 3 * 86_400_000);
    if (to.getTime() - from.getTime() > 7 * 86_400_000) from = new Date(to.getTime() - 7 * 86_400_000);
    const driver = this.driverByVehicle.get(id) ?? '';
    const sessions: Array<{ from: string; to: string; minutes: number; liters: number; lat: number; lon: number; zone: string | null; ongoing: boolean }> = [];
    if (!src.route) return { supported: false, driver, from: from.toISOString(), to: to.toISOString(), sessions };

    const GAP = 10 * 60_000, RADIUS = 200, L_PER_H = 3;
    const st: { cur: { since: number; last: number; lat: number; lon: number } | null } = { cur: null };
    const close = (end: number, ongoing = false) => {
      const c = st.cur;
      st.cur = null;
      if (c === null || end - c.since < minMinutes * 60_000) return;
      const minutes = Math.round((end - c.since) / 60_000);
      sessions.push({
        from: new Date(c.since).toISOString(), to: new Date(end).toISOString(), minutes,
        liters: Math.round((minutes / 60) * L_PER_H * 10) / 10,
        lat: c.lat, lon: c.lon, zone: this.zoneNameAt(c.lat, c.lon), ongoing,
      });
    };

    for (let t0 = from.getTime(); t0 < to.getTime(); t0 += 86_400_000) {
      const list = await src.route(id, new Date(t0), new Date(Math.min(t0 + 86_400_000, to.getTime())));
      list.sort((a, b) => a.at.getTime() - b.at.getTime());
      for (const p of list) {
        const t = p.at.getTime();
        if (st.cur !== null && t - st.cur.last > GAP) close(st.cur.last);
        const moved = st.cur !== null && distanceM(st.cur.lat, st.cur.lon, p.lat, p.lon) > RADIUS;
        if (p.ignition === false || moved) {
          if (st.cur !== null) close(t);
          if (p.ignition === false || p.speed >= 5) continue;
        }
        if (st.cur === null) {
          if (p.speed >= 5) continue;
          st.cur = { since: t, last: t, lat: p.lat, lon: p.lon };
        } else {
          st.cur.last = t;
        }
      }
    }
    if (st.cur !== null) close(st.cur.last, Date.now() - st.cur.last < GAP);
    sessions.reverse(); // plus recent en premier
    return { supported: true, driver, from: from.toISOString(), to: to.toISOString(), sessions };
  }

  /** Nom de la zone contenant le point, sinon null. */
  private zoneNameAt(lat: number, lon: number): string | null {
    try {
      const g = this.geofence as unknown as { locate?: (a: number, b: number) => unknown };
      const z = g.locate?.(lat, lon);
      const zid = typeof z === 'string' ? z : z && typeof z === 'object' && 'id' in z ? String((z as { id: unknown }).id) : null;
      return zid ? this.geofence.get(zid)?.name ?? null : null;
    } catch {
      return null;
    }
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
    if (previous === undefined) void this.source.queryIo?.(raw.vehicleId).catch(() => undefined);
    const meta = this.vehicles.peek(raw.vehicleId);

    // Un boitier inconnu au repertoire est signale une fois, puis ignore.
    // Sans ce garde-fou, un IMEI mal saisi creerait un camion fantome.
    if (!meta) {
      if (!previous) this.log.warn(`Trame d'un vehicule absent du repertoire : ${raw.vehicleId}`);
      return;
    }

    // Distance parcourue depuis la trame precedente, cumulee cote API.
    // Ignore les sauts GPS improbables (> 5 km) et le bruit a l'arret.
    if (previous !== undefined && (raw.speed > 3 || previous.speed > 3)) {
      const km = haversineKm(previous.lat, previous.lon, raw.lat, raw.lon);
      if (km > 0.005 && km < 5) await this.vehicles.addGpsKm(raw.vehicleId, km);
    }

    // Carburant : capteur BLE prioritaire (calibration obligatoire), sinon sonde analogique.
    const fuelOf = (tank: 'main' | 'aux') => {
      const ble = tank === 'main' ? raw.fuelMainBle : raw.fuelAuxBle;
      const prevSensor = tank === 'main' ? previous?.fuelMainSensor : previous?.fuelAuxSensor;
      if (ble === undefined && !prevSensor) {
        const volts = tank === 'main' ? raw.fuelMainVolts : raw.fuelAuxVolts;
        return { liters: this.fuel.toLiters(raw.vehicleId, tank, volts), sensor: undefined };
      }
      // Lecture BLE absente sur cette trame : derniere valeur connue.
      const value = ble ?? prevSensor?.raw;
      const liters = value === undefined ? null : this.fuel.toLitersBle(raw.vehicleId, tank, value);
      return {
        liters: liters ?? 0,
        sensor: {
          raw: value,
          calibrated: liters !== null,
          tempC: (tank === 'main' ? raw.fuelMainTemp : raw.fuelAuxTemp) ?? prevSensor?.tempC,
          battery: (tank === 'main' ? raw.fuelMainBattery : raw.fuelAuxBattery) ?? prevSensor?.battery,
        },
      };
    };
    const fuelMainR = fuelOf('main');
    const fuelAuxR = fuelOf('aux');

    const stoppedSince = await this.stopSince(previous, raw);

    const current: VehicleState = {
      id: raw.vehicleId,
      plate: meta.plate,
      driver: this.driverByVehicle.get(raw.vehicleId) ?? meta.driver,
      imei: meta.imei,
      tankMainCapacity: Number(meta.tankMainCapacity ?? 700),
      tankAuxCapacity: Number(meta.tankAuxCapacity ?? 300),

      lat: raw.lat,
      lon: raw.lon,
      speed: raw.speed,
      course: raw.course,

      ignition: raw.ignition,
      // L'appui bouton est une impulsion : on garde l'etat confirme
      // jusqu'a la sortie de station (voir RulesService.checkDeparture).
      departureConfirmed: raw.buttonPressed || (previous?.departureConfirmed ?? false),
      unlockRequested: raw.unlockPressed || (previous?.unlockRequested ?? false),
      starter: previous?.starter ?? this.immobilizer.initialStarter(raw.vehicleId, raw.outputActive),
      commandLock: this.immobilizer.lockOf(raw.vehicleId),

      fuelMain: fuelMainR.liters,
      fuelAux: fuelAuxR.liters,
      fuelMainSensor: fuelMainR.sensor,
      fuelAuxSensor: fuelAuxR.sensor,

      odometer: Math.round(meta.initialOdometer + Number(meta.gpsKm ?? 0)),
      engineHours: raw.engineHours,

      zoneId: this.geofence.locate(raw.lat, raw.lon, raw.vehicleId)?.id ?? null,
      battery: Number(raw.battery.toFixed(1)),
      gsm: raw.gsm,

      // Trame en retard (memoire du boitier videe) : pas « en ligne ».
      online: Date.now() - raw.at.getTime() < OFFLINE_AFTER_MS,
      updatedAt: raw.at.toISOString(),
      stoppedSince,
    };

    this.state.set(current.id, current);

    // Le bouton physique cloture la partie « confirmation » de la fiche.
    if (raw.buttonPressed) await this.departures.markConfirmed(current.id);

    await this.rules.evaluate(previous, current);
    await this.immobilizer.reconcile(current, raw.outputActive);
    await this.positions.record(current);

    this.events.publish({ type: 'position', vehicle: { ...current } });
  }
}

/** Distance en km entre deux points (formule de haversine). */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Distance en metres entre deux points GPS. */
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
