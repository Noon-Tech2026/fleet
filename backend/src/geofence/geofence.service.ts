import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Zone } from './entities/zone.entity';

@Injectable()
export class GeofenceService implements OnModuleInit {
  private readonly log = new Logger(GeofenceService.name);

  /**
   * Cache en memoire.
   *
   * locate() est appele a CHAQUE trame de CHAQUE camion. Une requete SQL
   * a cet endroit serait le premier goulot du systeme. Les zones changent
   * quelques fois par mois : on les charge une fois et on rafraichit le
   * cache a chaque ecriture.
   */
  private cache: Zone[] = [];

  constructor(@InjectRepository(Zone) private readonly repo: Repository<Zone>) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.cache = await this.repo.find({ where: { active: true } });
    this.log.log(`${this.cache.length} zones chargees`);
  }

  all(): Zone[] {
    return this.cache;
  }

  get(id: string): Zone | undefined {
    return this.cache.find((z) => z.id === id);
  }

  /** La zone concerne-t-elle ce camion ? (vehicleIds null = toute la flotte) */
  appliesTo(zone: Zone, vehicleId?: string): boolean {
    if (zone.vehicleIds === null || zone.vehicleIds === undefined || zone.vehicleIds.length === 0) return true;
    return vehicleId !== undefined && zone.vehicleIds.includes(vehicleId);
  }

  /**
   * Premiere zone contenant le point et concernant le camion, ou null.
   * Les zones restreintes a des camions precis passent avant les zones
   * generales : une zone dediee est plus specifique.
   */
  locate(lat: number, lon: number, vehicleId?: string): Zone | null {
    const ordered = [...this.cache].sort((a, b) => Number(this.isGeneral(b)) - Number(this.isGeneral(a)));
    for (const zone of ordered) {
      if (this.appliesTo(zone, vehicleId) === false) continue;
      if (zone.shape === 'circle') {
        if (zone.lat === null || zone.lon === null || zone.radius === null) continue;
        if (haversine(lat, lon, zone.lat, zone.lon) <= zone.radius) return zone;
      } else if (zone.points && pointInPolygon(lat, lon, zone.points)) {
        return zone;
      }
    }
    return null;
  }

  private isGeneral(zone: Zone): boolean {
    return zone.vehicleIds === null || zone.vehicleIds === undefined || zone.vehicleIds.length === 0;
  }

  isForbidden(zoneId: string | null): boolean {
    if (!zoneId) return false;
    return this.get(zoneId)?.kind === 'forbidden';
  }

  /** Zone de securite dont la sortie declenche l'alarme. */
  isAlarmedPerimeter(zoneId: string | null): boolean {
    if (!zoneId) return false;
    const z = this.get(zoneId);
    return z !== undefined && z.kind === 'perimeter' && z.alarmOnExit === true;
  }

  /* --- administration --------------------------------------------------- */

  async create(data: Partial<Zone>): Promise<Zone> {
    const zone = await this.repo.save(this.repo.create(data));
    await this.reload();
    return zone;
  }

  async update(id: string, data: Partial<Zone>): Promise<Zone> {
    const zone = await this.repo.findOne({ where: { id } });
    if (!zone) throw new NotFoundException('Zone inconnue');
    Object.assign(zone, data);
    const saved = await this.repo.save(zone);
    await this.reload();
    return saved;
  }

  /**
   * Desactivation plutot que suppression : les positions deja enregistrees
   * referencent cette zone. La supprimer rendrait l'historique illisible.
   */
  async deactivate(id: string): Promise<Zone> {
    return this.update(id, { active: false });
  }

  /**
   * Suppression definitive (admin). Les positions gardent l'ancien zone_id :
   * pas de contrainte FK, l'historique reste lisible par identifiant.
   */
  async remove(id: string): Promise<void> {
    const zone = await this.repo.findOne({ where: { id } });
    if (!zone) throw new NotFoundException('Zone inconnue');
    await this.repo.remove(zone);
    await this.reload();
  }

  async listAll(): Promise<Zone[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }
}

/** Distance en metres entre deux points. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Ray casting. Suffisant aux latitudes concernees et pour des zones de cette taille. */
export function pointInPolygon(lat: number, lon: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
