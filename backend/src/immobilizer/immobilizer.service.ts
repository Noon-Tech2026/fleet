import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
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
 * effectivement le moteur sur C-01). Condition d'execution :
 *   vitesse <= SPEED_THRESHOLD maintenue pendant au moins STATIONARY_MS = 10 s,
 *   quel que soit l'etat du contact (un seul point GPS a 0 km/h ne suffit pas :
 *   bruit GPS, arret bref a un feu).
 * Toute demande emise hors de ces conditions est mise en file d'attente,
 * jamais executee.
 *
 * Cette verification vit ici, cote serveur. Un bouton grise dans le navigateur
 * n'est pas une protection : il suffit d'un appel HTTP pour le contourner.
 * ============================================================================
 */

const SPEED_THRESHOLD = 9; // km/h — decision client 19/09/2026 (la vitesse GPS saute de 9 a 0 ; 3 km/h etait juge trop strict)
const STATIONARY_MS = 10_000; // duree d'immobilite requise
const ACK_TIMEOUT_MS = 15_000; // delai max pour que le boitier confirme DOUT1

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
  /** Commande envoyee au boitier, pas encore confirmee par une trame out1. */
  private readonly inFlight = new Map<
    string,
    { expectOutput: boolean; lock: NonNullable<VehicleState['commandLock']>; timer: NodeJS.Timeout }
  >();

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
    // Pas de raccourci "contact coupe" : la lecture d'ignition n'est pas fiable
    // sur C-01 (lue "coupe" a 14 km/h). L'immobilite stable est la seule preuve.
    const since = this.stationarySince.get(v.id);
    return since !== undefined && now - since >= STATIONARY_MS;
  }

  async requestBlock(vehicle: VehicleState, actor: Actor, reason: string): Promise<CommandAudit> {
    this.assertNotLocked(vehicle);
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
  async reconcile(vehicle: VehicleState, outputActive?: boolean): Promise<void> {
    this.trackMotion(vehicle);
    if (outputActive !== undefined) this.acknowledge(vehicle, outputActive);
    if (this.inFlight.has(vehicle.id)) return; // on attend la confirmation avant toute autre action

    // Hors commande en cours, l'etat affiche suit l'etat reel du relais.
    if (outputActive !== undefined) {
      vehicle.starter = this.pending.has(vehicle.id) ? 'pending_block' : outputActive ? 'blocked' : 'allowed';
    }
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
    this.assertNotLocked(vehicle);
    this.pending.delete(vehicle.id);
    this.cancelCheck(vehicle.id);
    this.lock(vehicle, actor, 'release', false);
    try {
      await this.source.setDigitalOutput(vehicle.id, 1, false);
    } catch (e) {
      vehicle.commandLock = null;
      this.unlock(vehicle.id, 'echec envoi');
      throw e;
    }
    vehicle.starter = 'allowed';
    this.events.publish({ type: 'position', vehicle: { ...vehicle } });
    this.alerts.raise(vehicle.id, 'info', 'starter_released', `Demarrage reautorise par ${actor.email}`);
    return this.record(vehicle, 'release_starter', actor, reason, true);
  }

  // ---- Verrou de commande -------------------------------------------------

  /** Verrou courant d'un vehicule — source de verite lue par FleetService a chaque trame. */
  lockOf(vehicleId: string): VehicleState['commandLock'] {
    return this.inFlight.get(vehicleId)?.lock ?? null;
  }

  isLocked(vehicleId: string): boolean {
    return this.inFlight.has(vehicleId);
  }

  private assertNotLocked(vehicle: VehicleState): void {
    const lock = this.lockOf(vehicle.id);
    if (lock !== null) {
      throw new ConflictException(
        `Commande deja en cours pour ${vehicle.id} (par ${lock.by}) — attendez la confirmation du boitier`,
      );
    }
  }

  private lock(vehicle: VehicleState, actor: Actor, action: 'block' | 'release', expectOutput: boolean): void {
    const lock = { by: actor.email, action, since: new Date().toISOString() };
    const timer = setTimeout(() => {
      if (this.inFlight.has(vehicle.id) === false) return;
      this.log.warn(`${vehicle.id} — pas de confirmation du boitier apres ${ACK_TIMEOUT_MS / 1000} s`);
      this.unlock(vehicle.id, 'timeout — etat resynchronise a la prochaine trame');
    }, ACK_TIMEOUT_MS);
    this.inFlight.set(vehicle.id, { expectOutput, lock, timer });
    vehicle.commandLock = lock;
    this.events.publish({ type: 'starter_lock', vehicleId: vehicle.id, lock });
  }

  private unlock(vehicleId: string, why: string): void {
    const f = this.inFlight.get(vehicleId);
    if (f !== undefined) clearTimeout(f.timer);
    this.inFlight.delete(vehicleId);
    this.log.log(`${vehicleId} — verrou de commande leve (${why})`);
    this.events.publish({ type: 'starter_lock', vehicleId, lock: null });
  }

  /** Une trame confirme l'etat reel de DOUT1 : leve le verrou si elle correspond. */
  private acknowledge(vehicle: VehicleState, outputActive: boolean): void {
    const f = this.inFlight.get(vehicle.id);
    if (f === undefined) return;
    if (outputActive === f.expectOutput) {
      vehicle.starter = outputActive ? 'blocked' : 'allowed';
      vehicle.commandLock = null;
      this.unlock(vehicle.id, 'confirme par le boitier');
    }
  }

  // ---- Buzzer cabine (DOUT2) ------------------------------------------------

  /** Declenche le buzzer pour `seconds` ; le boitier l'eteint seul a l'echeance. */
  async buzzerOn(vehicleId: string, seconds: number): Promise<void> {
    try {
      await this.source.setDigitalOutput(vehicleId, 2, true, seconds);
    } catch (e) {
      this.log.warn(`${vehicleId} — buzzer non declenche : ${String(e)}`);
    }
  }

  async buzzerOff(vehicleId: string): Promise<void> {
    try {
      await this.source.setDigitalOutput(vehicleId, 2, false);
    } catch (e) {
      this.log.warn(`${vehicleId} — buzzer non eteint : ${String(e)}`);
    }
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
    this.lock(vehicle, actor, 'block', true);
    try {
      await this.source.setDigitalOutput(vehicle.id, 1, true);
    } catch (e) {
      vehicle.commandLock = null;
      this.unlock(vehicle.id, 'echec envoi');
      throw e;
    }
    vehicle.starter = 'blocked';
    this.events.publish({ type: 'position', vehicle: { ...vehicle } });
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
