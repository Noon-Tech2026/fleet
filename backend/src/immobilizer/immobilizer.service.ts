import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommandAudit, VehicleState } from '../common/types';
import { TELEMETRY_SOURCE, TelemetrySource } from '../telemetry/telemetry.source';
import { EventsService } from '../events/events.service';
import { AlertsService } from '../rules/alerts.service';
import { CommandLog } from '../auth/entities/command-log.entity';

/**
 * ============================================================================
 * REGLE DE SECURITE — NE PAS CONTOURNER
 * ============================================================================
 * Le systeme ne coupe jamais un moteur d'un vehicule EN MOUVEMENT. Couper
 * l'alimentation d'un moteur en roulage supprime la direction assistee et
 * l'assistance de freinage d'un ensemble de 40 tonnes.
 *
 * Decision client (18/09/2026) : le blocage doit s'appliquer quand le camion
 * est immobile, meme moteur tournant au ralenti (le relais DOUT1 coupe
 * effectivement le moteur sur C-01). Conditions d'execution :
 *   - contact coupe  -> immediat ;
 *   - contact mis    -> vitesse <= SPEED_THRESHOLD maintenue pendant au moins
 *                       STATIONARY_MS = 10 s (un seul point GPS a 0 km/h ne suffit
 *                       pas : bruit GPS, arret bref a un feu).
 * Toute demande emise hors de ces conditions est mise en file d'attente,
 * jamais executee.
 *
 * Cette verification vit ici, cote serveur. Un bouton grise dans le navigateur
 * n'est pas une protection : il suffit d'un appel HTTP pour le contourner.
 * ============================================================================
 */

const SPEED_THRESHOLD = 3; // km/h — tolerance sur le bruit GPS
const STATIONARY_MS = 10_000; // duree d'immobilite requise, contact mis

export interface Actor {
  id: string | null;
  email: string;
}

/** Acteur utilise par les regles automatiques. */
export const SYSTEM_ACTOR: Actor = { id: null, email: 'system' };

@Injectable()
export class ImmobilizerService {
  private readonly log = new Logger(ImmobilizerService.name);
  private readonly pending = new Map<string, { actor: Actor; reason: string }>();
  /** Instant (ms) depuis lequel chaque vehicule est immobile ; absent = en mouvement. */
  private readonly stationarySince = new Map<string, number>();
  /** Verification planifiee par vehicule, pour ne pas attendre la trame GPS suivante. */
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(TELEMETRY_SOURCE) private readonly source: TelemetrySource,
    @InjectRepository(CommandLog) private readonly logs: Repository<CommandLog>,
    private readonly events: EventsService,
    private readonly alerts: AlertsService,
  ) {}

  /** A appeler a chaque position recue : met a jour le compteur d'immobilite. */
  trackMotion(v: Pick<VehicleState, 'id' | 'speed'>, now = Date.now()): void {
    if (v.speed <= SPEED_THRESHOLD) {
      if (this.stationarySince.has(v.id) === false) this.stationarySince.set(v.id, now);
    } else {
      this.stationarySince.delete(v.id);
      this.cancelCheck(v.id);
    }
  }

  private cancelCheck(vehicleId: string): void {
    const t = this.timers.get(vehicleId);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(vehicleId);
  }

  /** Planifie un reconcile() a la fin du delai d'immobilite si une demande attend. */
  private scheduleCheck(vehicle: VehicleState): void {
    const since = this.stationarySince.get(vehicle.id);
    if (since === undefined || this.timers.has(vehicle.id)) return;
    const delay = Math.max(0, STATIONARY_MS - (Date.now() - since)) + 500;
    this.timers.set(
      vehicle.id,
      setTimeout(() => {
        this.timers.delete(vehicle.id);
        void this.reconcile(vehicle);
      }, delay),
    );
  }

  isSafeToBlock(v: Pick<VehicleState, 'id' | 'speed' | 'ignition'>, now = Date.now()): boolean {
    if (v.speed > SPEED_THRESHOLD) return false;
    if (v.ignition === false) return true;
    const since = this.stationarySince.get(v.id);
    return since !== undefined && now - since >= STATIONARY_MS;
  }

  async requestBlock(vehicle: VehicleState, actor: Actor, reason: string): Promise<CommandAudit> {
    this.trackMotion(vehicle);
    if (this.isSafeToBlock(vehicle) === false) {
      this.pending.set(vehicle.id, { actor, reason });
      this.log.warn(
        `${vehicle.id} — blocage differe demande par ${actor.email} ` +
          `(${vehicle.speed} km/h, contact ${vehicle.ignition ? 'mis' : 'coupe'})`,
      );
      this.scheduleCheck(vehicle);
      return this.record(vehicle, 'block_starter', actor, reason, false);
    }
    return this.applyBlock(vehicle, actor, reason);
  }

  /** Appele a chaque position : execute une demande en attente des que possible. */
  async reconcile(vehicle: VehicleState): Promise<void> {
    this.trackMotion(vehicle);
    const waiting = this.pending.get(vehicle.id);
    if (waiting === undefined) return;
    if (this.isSafeToBlock(vehicle) === false) {
      this.scheduleCheck(vehicle);
      return;
    }

    this.pending.delete(vehicle.id);
    this.cancelCheck(vehicle.id);
    await this.applyBlock(vehicle, waiting.actor, `${waiting.reason} (execution differee)`);
  }

  async release(vehicle: VehicleState, actor: Actor, reason: string): Promise<CommandAudit> {
    this.pending.delete(vehicle.id);
    this.cancelCheck(vehicle.id);
    await this.source.setDigitalOutput(vehicle.id, 1, false);
    vehicle.starter = 'allowed';
    this.alerts.raise(vehicle.id, 'info', 'starter_released', `Demarrage reautorise par ${actor.email}`);
    return this.record(vehicle, 'release_starter', actor, reason, true);
  }

  isPending(vehicleId: string): boolean {
    return this.pending.has(vehicleId);
  }

  /** Journal d'audit, lu depuis la base — jamais depuis la memoire. */
  async history(vehicleId?: string, limit = 100): Promise<CommandLog[]> {
    return this.logs.find({
      where: vehicleId ? { vehicleId } : {},
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  private async applyBlock(
    vehicle: VehicleState,
    actor: Actor,
    reason: string,
  ): Promise<CommandAudit> {
    await this.source.setDigitalOutput(vehicle.id, 1, true);
    vehicle.starter = 'blocked';
    this.alerts.raise(vehicle.id, 'critical', 'starter_blocked', `Demarreur bloque — ${reason}`);
    return this.record(vehicle, 'block_starter', actor, reason, true);
  }

  /**
   * L'ecriture en base precede la publication de l'evenement : si la trace
   * d'audit echoue, l'interface ne doit pas afficher une commande comme
   * enregistree.
   */
  private async record(
    vehicle: VehicleState,
    action: CommandLog['action'],
    actor: Actor,
    reason: string,
    applied: boolean,
  ): Promise<CommandAudit> {
    const entity = await this.logs.save(
      this.logs.create({
        vehicleId: vehicle.id,
        action,
        actorEmail: actor.email,
        actorId: actor.id,
        reason: reason.slice(0, 255),
        applied,
        speedAtRequest: vehicle.speed,
        ignitionAtRequest: vehicle.ignition,
      }),
    );

    if (applied === false) vehicle.starter = 'pending_block';

    const audit: CommandAudit = {
      id: entity.id,
      vehicleId: entity.vehicleId,
      action: entity.action,
      actor: entity.actorEmail,
      reason: entity.reason,
      applied: entity.applied,
      vehicleSpeedAtRequest: entity.speedAtRequest,
      ignitionAtRequest: entity.ignitionAtRequest,
      at: entity.createdAt.toISOString(),
    };

    this.events.publish({ type: 'command', audit });
    return audit;
  }
}
