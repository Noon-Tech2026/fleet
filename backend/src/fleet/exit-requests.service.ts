import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ExitRequest } from './entities/exit-request.entity';
import { EventsService } from '../events/events.service';
import { ExitRequestView } from '../common/types';

export function toView(r: ExitRequest): ExitRequestView {
  return {
    id: r.id,
    vehicleId: r.vehicleId,
    zoneId: r.zoneId,
    zoneName: r.zoneName,
    exitedAt: r.exitedAt.toISOString(),
    buttonPressedAt: r.buttonPressedAt ? r.buttonPressedAt.toISOString() : null,
    status: r.status,
    rejections: r.rejections,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    tripId: r.tripId,
    reason: r.reason,
  };
}

@Injectable()
export class ExitRequestsService {
  private readonly log = new Logger(ExitRequestsService.name);

  constructor(
    @InjectRepository(ExitRequest) private readonly repo: Repository<ExitRequest>,
    private readonly events: EventsService,
  ) {}

  async pendingFor(vehicleId: string): Promise<ExitRequest | null> {
    return this.repo.findOne({ where: { vehicleId, status: 'pending' }, order: { createdAt: 'DESC' } });
  }

  /**
   * Cree une demande. Appelee a l'appui du bouton (ou a la sortie si le
   * bouton avait deja ete presse) : une demande par chargement, plusieurs
   * par camion et par jour — le superviseur les valide en fin de service.
   */
  async create(vehicleId: string, zone: { id: string; name: string } | null, exitedAt: Date, buttonPressed: boolean): Promise<ExitRequest> {
    const now = new Date();
    const r = await this.repo.save(
      this.repo.create({
        vehicleId,
        zoneId: zone?.id ?? null,
        zoneName: zone?.name ?? '',
        exitedAt,
        buttonPressedAt: buttonPressed ? now : null,
        status: 'pending',
        rejections: 0,
      }),
    );
    this.log.log(`${vehicleId} — demande de chargement (${zone?.name ?? 'zone ?'})`);
    this.publish(r);
    return r;
  }

  /**
   * Appui du bouton apres la sortie : complete une demande rejetee en
   * attente d'un nouvel appui, sinon en ouvre une nouvelle.
   */
  async pressButton(vehicleId: string, zone: { id: string; name: string } | null, exitedAt: Date): Promise<ExitRequest> {
    const rejected = await this.repo.findOne({ where: { vehicleId, status: 'pending', buttonPressedAt: IsNull() }, order: { createdAt: 'DESC' } });
    if (rejected) {
      rejected.buttonPressedAt = new Date();
      await this.repo.save(rejected);
      this.publish(rejected);
      return rejected;
    }
    return this.create(vehicleId, zone, exitedAt, true);
  }

  async confirm(id: string, actor: string, tripId: string): Promise<ExitRequest> {
    const r = await this.get(id);
    r.status = 'confirmed';
    r.tripId = tripId;
    r.decidedBy = actor;
    r.decidedAt = new Date();
    await this.repo.save(r);
    this.publish(r);
    return r;
  }

  /** Rejet : la demande reste ouverte, le bouton devra etre presse a nouveau. */
  async reject(id: string, actor: string): Promise<ExitRequest> {
    const r = await this.get(id);
    r.rejections += 1;
    r.buttonPressedAt = null;
    r.decidedBy = actor;
    r.decidedAt = new Date();
    await this.repo.save(r);
    this.publish(r);
    return r;
  }

  async bypass(id: string, actor: string, reason: string): Promise<ExitRequest> {
    const r = await this.get(id);
    r.status = 'bypassed';
    r.reason = reason;
    r.decidedBy = actor;
    r.decidedAt = new Date();
    await this.repo.save(r);
    this.publish(r);
    return r;
  }

  async openList(): Promise<ExitRequest[]> {
    return this.repo.find({ where: { status: 'pending' }, order: { createdAt: 'ASC' } });
  }

  async history(vehicleId?: string, limit = 100): Promise<ExitRequest[]> {
    return this.repo.find({ where: vehicleId ? { vehicleId } : {}, order: { createdAt: 'DESC' }, take: limit });
  }

  private async get(id: string): Promise<ExitRequest> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Demande de sortie inconnue');
    return r;
  }

  private publish(r: ExitRequest): void {
    this.events.publish({ type: 'exit_request', request: toView(r) });
  }
}
