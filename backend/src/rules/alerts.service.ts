import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Alert, AlertCode, AlertLevel } from '../common/types';
import { EventsService } from '../events/events.service';
import { AlertEntity } from './entities/alert.entity';

const MAX_KEPT = 500;

@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly log = new Logger(AlertsService.name);
  private readonly alerts: Alert[] = [];

  constructor(
    private readonly events: EventsService,
    @InjectRepository(AlertEntity) private readonly repo: Repository<AlertEntity>,
  ) {}

  /** Recharge les dernieres alertes : le fil d'evenements survit aux redemarrages. */
  async onModuleInit(): Promise<void> {
    const rows = await this.repo.find({ order: { at: 'DESC' }, take: MAX_KEPT });
    for (const r of rows) this.alerts.push(toAlert(r));
    this.log.log(`${rows.length} alerte(s) rechargee(s)`);
  }

  raise(vehicleId: string, level: AlertLevel, code: AlertCode, message: string): Alert {
    const alert: Alert = { id: randomUUID(), vehicleId, level, code, message, at: new Date().toISOString(), acknowledged: false };
    this.alerts.unshift(alert);
    if (this.alerts.length > MAX_KEPT) this.alerts.length = MAX_KEPT;
    this.events.publish({ type: 'alert', alert });
    void this.repo.insert({ ...alert, at: new Date(alert.at) }).catch((e) => this.log.warn(`alerte non persistee : ${String(e)}`));
    return alert;
  }

  recent(limit = 100): Alert[] {
    return this.alerts.slice(0, limit);
  }

  acknowledge(id: string): Alert | undefined {
    const alert = this.alerts.find((a) => a.id === id);
    if (alert) {
      alert.acknowledged = true;
      void this.repo.update({ id }, { acknowledged: true }).catch(() => undefined);
    }
    return alert;
  }
}

function toAlert(r: AlertEntity): Alert {
  return { id: r.id, vehicleId: r.vehicleId, level: r.level, code: r.code, message: r.message, at: r.at.toISOString(), acknowledged: r.acknowledged };
}
