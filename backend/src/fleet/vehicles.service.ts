import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { SimulatorSource } from '../telemetry/simulator.source';
import { TELEMETRY_SOURCE, TelemetrySource } from '../telemetry/telemetry.source';

/**
 * Repertoire de la flotte, avec cache : le repertoire est consulte a
 * chaque trame pour enrichir la position (plaque, chauffeur), et il
 * change quelques fois par an.
 *
 * Le repertoire est tenu synchrone avec la source de telemetrie (Traccar) :
 * un camion cree ici existe dans Traccar, sinon la creation echoue.
 */
@Injectable()
export class VehiclesService implements OnModuleInit {
  private readonly log = new Logger(VehiclesService.name);
  private cache = new Map<string, Vehicle>();

  constructor(
    @InjectRepository(Vehicle) private readonly repo: Repository<Vehicle>,
    private readonly simulator: SimulatorSource,
    @Inject(TELEMETRY_SOURCE) private readonly source: TelemetrySource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /**
   * Ajoute une distance parcourue (km) au cumul GPS du camion. Mise a jour
   * du cache immediate ; ecriture en base sans rechargement (appele a chaque
   * trame en mouvement).
   */
  async addGpsKm(id: string, km: number): Promise<void> {
    const v = this.cache.get(id);
    if (v === undefined || km <= 0) return;
    v.gpsKm = Number(v.gpsKm ?? 0) + km;
    try {
      await this.repo.update({ id }, { gpsKm: v.gpsKm });
    } catch (e) {
      this.log.warn(`${id} — cumul GPS non persiste : ${String(e)}`);
    }
  }

  async reload(): Promise<void> {
    const rows = await this.repo.find();
    this.cache = new Map(rows.map((v) => [v.id, v]));
    this.log.log(`${rows.length} vehicules au repertoire`);

    // Sans boitier reel pour l'annoncer, un camion du repertoire resterait
    // invisible en Vue d'ensemble tant que la simulation ne sait pas qu'il
    // existe — que ce soit un ajout au demarrage ou depuis l'interface.
    for (const v of rows) this.simulator.addVehicle(v.id);
  }

  peek(id: string): Vehicle | undefined {
    return this.cache.get(id);
  }

  list(): Vehicle[] {
    return [...this.cache.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<Vehicle> {
    const vehicle = this.cache.get(id) ?? (await this.repo.findOne({ where: { id } }));
    if (!vehicle) throw new NotFoundException(`Vehicule inconnu : ${id}`);
    return vehicle;
  }

  /** Traduit un refus de la source en 400 lisible par l'interface. */
  private async withSource(action: () => Promise<void> | undefined): Promise<void> {
    try {
      await action();
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  async create(data: Partial<Vehicle>): Promise<Vehicle> {
    if (!data.id) throw new BadRequestException('Le code du vehicule est obligatoire');
    if (!data.imei) throw new BadRequestException("L'IMEI est obligatoire");
    if (this.cache.has(data.id)) {
      throw new BadRequestException(`Le code ${data.id} est deja utilise`);
    }
    if (await this.repo.findOne({ where: { imei: data.imei } })) {
      throw new BadRequestException('Cet IMEI est deja associe a un autre vehicule');
    }

    // Traccar d'abord : c'est lui qui detecte un IMEI deja pris ailleurs.
    await this.withSource(() => this.source.registerDevice?.(data.id!, data.imei!));

    try {
      const saved = await this.repo.save(this.repo.create(data));
      await this.reload();
      return saved;
    } catch (err) {
      // Ne pas laisser un boitier orphelin dans Traccar.
      await this.source.unregisterDevice?.(data.id).catch((e) =>
        this.log.error(`Rollback Traccar impossible pour ${data.id} : ${String(e)}`),
      );
      throw err;
    }
  }

  async update(id: string, data: Partial<Vehicle>): Promise<Vehicle> {
    const vehicle = await this.get(id);

    if (data.imei && data.imei !== vehicle.imei) {
      const clash = await this.repo.findOne({ where: { imei: data.imei } });
      if (clash && clash.id !== id) {
        throw new BadRequestException(`Cet IMEI est deja associe au vehicule ${clash.id}`);
      }
      await this.withSource(() => this.source.updateDeviceImei?.(id, data.imei!));
    }

    // Saisie d'un kilometrage compteur : on fige la lecture boitier du moment,
    // l'odometre affiche vaudra ensuite initialOdometer + (boitier - lecture figee).
    if (data.initialOdometer !== undefined && data.initialOdometer !== vehicle.initialOdometer) {
      const rows: { odometer: number }[] = await this.repo.manager.query(
        'SELECT odometer FROM positions WHERE vehicle_id = ? ORDER BY id DESC LIMIT 1',
        [id],
      );
      // Nouveau compteur saisi : le cumul GPS repart de zero.
      data = { ...data, initialOdometerDeviceKm: Number(rows[0]?.odometer ?? 0), gpsKm: 0 };
    }

    Object.assign(vehicle, data, { id: vehicle.id });
    const saved = await this.repo.save(vehicle);
    await this.reload();
    return saved;
  }

  /**
   * Desactivation plutot que suppression : les positions et le journal
   * d'audit referencent ce code de vehicule. Le boitier est desactive dans
   * Traccar (pas supprime) pour garder son historique.
   */
  async deactivate(id: string): Promise<Vehicle> {
    await this.withSource(() => this.source.setDeviceEnabled?.(id, false));
    return this.update(id, { active: false });
  }
}
