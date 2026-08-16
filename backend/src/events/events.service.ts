import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { StreamMessage } from '../common/types';

/**
 * Bus interne. Tous les modules publient ici ; le contrôleur SSE est
 * le seul consommateur exposé au réseau.
 *
 * Point d'architecture important : le dashboard n'ouvre jamais de
 * connexion vers Traccar. L'API garde une seule connexion amont et
 * rediffuse à N navigateurs.
 */
@Injectable()
export class EventsService {
  private readonly subject = new Subject<StreamMessage>();

  publish(message: StreamMessage): void {
    this.subject.next(message);
  }

  stream(): Observable<StreamMessage> {
    return this.subject.asObservable();
  }
}
