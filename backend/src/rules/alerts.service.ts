import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Alert, AlertCode, AlertLevel } from '../common/types';
import { EventsService } from '../events/events.service';

const MAX_KEPT = 500;

@Injectable()
export class AlertsService {
  private readonly alerts: Alert[] = [];

  constructor(private readonly events: EventsService) {}

  raise(vehicleId: string, level: AlertLevel, code: AlertCode, message: string): Alert {
    const alert: Alert = {
      id: randomUUID(),
      vehicleId,
      level,
      code,
      message,
      at: new Date().toISOString(),
      acknowledged: false,
    };
    this.alerts.unshift(alert);
    if (this.alerts.length > MAX_KEPT) this.alerts.length = MAX_KEPT;
    this.events.publish({ type: 'alert', alert });
    return alert;
  }

  recent(limit = 100): Alert[] {
    return this.alerts.slice(0, limit);
  }

  acknowledge(id: string): Alert | undefined {
    const alert = this.alerts.find((a) => a.id === id);
    if (alert) alert.acknowledged = true;
    return alert;
  }
}
