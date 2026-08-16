import { Controller, Sse, MessageEvent } from '@nestjs/common';
import { Observable, merge, interval, map, startWith } from 'rxjs';
import { EventsService } from './events.service';
import { FleetService } from '../fleet/fleet.service';
import { AlertsService } from '../rules/alerts.service';
import { StreamMessage } from '../common/types';

@Controller('api')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly fleet: FleetService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * GET /api/stream — flux SSE.
   *
   * SSE plutôt que WebSocket : le trafic est unidirectionnel
   * (serveur → navigateur), les commandes passent par des POST classiques.
   * Reconnexion automatique gérée par le navigateur, et le flux traverse
   * les proxys HTTP sans configuration particulière.
   */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const snapshot: StreamMessage = {
      type: 'snapshot',
      vehicles: this.fleet.all(),
      alerts: this.alerts.recent(50),
    };

    // Un heartbeat régulier évite que les proxys coupent une connexion
    // jugée inactive quand la flotte est à l'arrêt.
    const heartbeat = interval(20_000).pipe(
      map((): StreamMessage => ({ type: 'heartbeat', at: new Date().toISOString() })),
    );

    return merge(this.events.stream(), heartbeat).pipe(
      startWith(snapshot),
      map((data): MessageEvent => ({ data })),
    );
  }
}
