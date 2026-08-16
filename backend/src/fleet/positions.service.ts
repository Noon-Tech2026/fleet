import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThan, Repository } from 'typeorm';
import { Position } from './entities/position.entity';
import { VehicleState } from '../common/types';
import { haversine } from '../geofence/geofence.service';

/**
 * Seuils de conservation d'une trame.
 *
 * Sans filtrage, un camion a l'arret moteur coupe ecrirait une ligne
 * identique toutes les 30 secondes pendant la nuit — des milliers de
 * lignes sans aucune information. On garde ce qui raconte quelque chose :
 * un changement d'etat, un deplacement reel, et un point de controle
 * periodique pour prouver que le boitier emettait toujours.
 */
const MOVED_METERS = 60;
const MAX_GAP_MS = 3 * 60 * 1000;

interface LastKept {
  lat: number;
  lon: number;
  ignition: boolean;
  zoneId: string | null;
  at: number;
}

@Injectable()
export class PositionsService {
  private readonly log = new Logger(PositionsService.name);
  private readonly lastKept = new Map<string, LastKept>();

  constructor(
    @InjectRepository(Position) private readonly repo: Repository<Position>,
  ) {}

  /**
   * Decide si la trame merite une ligne en base, et l'ecrit le cas echeant.
   * Retourne le motif retenu, ou null si la trame a ete ignoree.
   */
  async record(state: VehicleState): Promise<Position['keptBecause'] | null> {
    const reason = this.shouldPersist(state);
    if (!reason) return null;

    await this.repo.insert({
      vehicleId: state.id,
      lat: state.lat,
      lon: state.lon,
      speed: Math.round(state.speed),
      course: Math.round(state.course),
      ignition: state.ignition,
      fuelMain: Math.round(state.fuelMain),
      fuelAux: Math.round(state.fuelAux),
      odometer: Math.round(state.odometer),
      engineHours: Math.round(state.engineHours),
      zoneId: state.zoneId,
      keptBecause: reason,
      recordedAt: new Date(state.updatedAt),
    });

    this.lastKept.set(state.id, {
      lat: state.lat,
      lon: state.lon,
      ignition: state.ignition,
      zoneId: state.zoneId,
      at: Date.now(),
    });

    return reason;
  }

  private shouldPersist(state: VehicleState): Position['keptBecause'] | null {
    const last = this.lastKept.get(state.id);
    if (!last) return 'first';

    // Un changement de contact borne un trajet : jamais filtre.
    if (last.ignition !== state.ignition) return 'ignition';

    // Une entree ou sortie de zone doit etre datable a la trame pres.
    if (last.zoneId !== state.zoneId) return 'zone';

    if (haversine(last.lat, last.lon, state.lat, state.lon) >= MOVED_METERS) return 'moved';

    // Point de controle : prouve que le boitier emettait toujours.
    if (Date.now() - last.at >= MAX_GAP_MS) return 'interval';

    return null;
  }

  /** Trajet d'un vehicule entre deux dates, du plus ancien au plus recent. */
  async history(vehicleId: string, from: Date, to: Date, limit = 5000): Promise<Position[]> {
    return this.repo.find({
      where: { vehicleId, recordedAt: Between(from, to) },
      order: { recordedAt: 'ASC' },
      take: limit,
    });
  }

  async latest(vehicleId: string, limit = 100): Promise<Position[]> {
    return this.repo.find({
      where: { vehicleId },
      order: { recordedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Purge des positions anterieures a la date donnee.
   *
   * A brancher sur une tache planifiee. Rien ne l'appelle automatiquement
   * pour l'instant : effacer des donnees doit rester une decision
   * explicite, pas un effet de bord du demarrage.
   */
  async purgeBefore(cutoff: Date): Promise<number> {
    const result = await this.repo.delete({ recordedAt: LessThan(cutoff) });
    const deleted = result.affected ?? 0;
    this.log.warn(`Purge : ${deleted} positions anterieures au ${cutoff.toISOString()}`);
    return deleted;
  }

  async countFor(vehicleId: string): Promise<number> {
    return this.repo.count({ where: { vehicleId } });
  }
}
