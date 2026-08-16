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
 * Le systeme ne coupe jamais un moteur en marche. Couper l'alimentation d'un
 * moteur en roulage supprime la direction assistee et l'assistance de freinage
 * d'un ensemble de 40 tonnes.
 *
 * La seule action autorisee est le blocage du DEMARREUR, et uniquement quand
 * le vehicule est deja a l'arret, contact coupe. Toute demande emise dans
 * d'autres conditions est mise en file d'attente, jamais executee.
 *
 * Cette verification vit ici, cote serveur. Un bouton grise dans le navigateur
 * n'est pas une protection : il suffit d'un appel HTTP pour le contourner.
 * ============================================================================
 */

const SPEED_THRESHOLD = 3; // km/h — tolerance sur le bruit GPS

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

  constructor(
    @Inject(TELEMETRY_SOURCE) private readonly source: TelemetrySource,
    @InjectRepository(CommandLog) private readonly logs: Repository<CommandLog>,
    private readonly events: EventsService,
    private readonly alerts: AlertsService,
  ) {}

  static isSafeToBlock(v: Pick<VehicleState, 'speed' | 'ignition'>): boolean {
    return v.speed <= SPEED_THRESHOLD && !v.ignition;
  }

  async requestBlock(vehicle: VehicleState, actor: Actor, reason: string): Promise<CommandAudit> {
    if (!ImmobilizerService.isSafeToBlock(vehicle)) {
      this.pending.set(vehicle.id, { actor, reason });
      this.log.warn(
        `${vehicle.id} — blocage differe demande par ${actor.email} ` +
          `(${vehicle.speed} km/h, contact ${vehicle.ignition ? 'mis' : 'coupe'})`,
      );
      return this.record(vehicle, 'block_starter', actor, reason, false);
    }
    return this.applyBlock(vehicle, actor, reason);
  }

  /** Appele a chaque position : execute une demande en attente des que possible. */
  async reconcile(vehicle: VehicleState): Promise<void> {
    const waiting = this.pending.get(vehicle.id);
    if (!waiting || !ImmobilizerService.isSafeToBlock(vehicle)) return;

    this.pending.delete(vehicle.id);
    await this.applyBlock(vehicle, waiting.actor, `${waiting.reason} (execution differee)`);
  }

  async release(vehicle: VehicleState, actor: Actor, reason: string): Promise<CommandAudit> {
    this.pending.delete(vehicle.id);
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

    if (!applied) vehicle.starter = 'pending_block';

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
