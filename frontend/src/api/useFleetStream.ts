import { useEffect, useRef, useState } from 'react';
import type { ExitRequestView } from '../lib/types';
import { api } from './client';
import type { Alert, StreamMessage, VehicleState } from '../lib/types';

export type ConnectionState = 'connecting' | 'live' | 'lost';

export interface FleetStream {
  vehicles: VehicleState[];
  alerts: Alert[];
  exitRequests: ExitRequestView[];
  connection: ConnectionState;
  lastMessageAt: Date | null;
}

/**
 * Une seule connexion SSE pour toute l'application.
 *
 * EventSource gere la reconnexion automatiquement : inutile d'ecrire
 * une boucle de retry, il suffit de refleter l'etat dans l'interface pour
 * que l'exploitant sache si ce qu'il voit est encore a jour.
 */
export function useFleetStream(): FleetStream {
  const [vehicles, setVehicles] = useState<Map<string, VehicleState>>(new Map());
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [exitRequests, setExitRequests] = useState<ExitRequestView[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastMessageAt, setLastMessageAt] = useState<Date | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource('/api/stream');
    sourceRef.current = source;

    api.exitRequestsOpen().then(setExitRequests).catch(() => undefined);
    source.onopen = () => setConnection('live');
    source.onerror = () => setConnection('lost');

    source.onmessage = (event) => {
      setLastMessageAt(new Date());
      setConnection('live');

      const message = JSON.parse(event.data) as StreamMessage;

      switch (message.type) {
        case 'snapshot':
          setVehicles(new Map(message.vehicles.map((v) => [v.id, v])));
          setAlerts(message.alerts);
          break;

        case 'position':
          setVehicles((prev) => {
            const next = new Map(prev);
            next.set(message.vehicle.id, message.vehicle);
            return next;
          });
          break;

        case 'alert':
          setAlerts((prev) => [message.alert, ...prev].slice(0, 200));
          break;

        case 'exit_request':
          setExitRequests((prev) => {
            const rest = prev.filter((r) => r.id !== message.request.id);
            return message.request.status === 'pending' ? [...rest, message.request] : rest;
          });
          break;

        case 'starter_lock':
          setVehicles((prev) => {
            const v = prev.get(message.vehicleId);
            if (v === undefined) return prev;
            const next = new Map(prev);
            next.set(v.id, { ...v, commandLock: message.lock });
            return next;
          });
          break;

        case 'command':
        case 'heartbeat':
          break;
      }
    };

    return () => source.close();
  }, []);

  return {
    vehicles: [...vehicles.values()].sort((a, b) => a.id.localeCompare(b.id)),
    alerts,
    exitRequests,
    connection,
    lastMessageAt,
  };
}
