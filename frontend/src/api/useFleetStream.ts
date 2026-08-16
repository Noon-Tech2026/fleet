import { useEffect, useRef, useState } from 'react';
import type { Alert, StreamMessage, VehicleState } from '../lib/types';

export type ConnectionState = 'connecting' | 'live' | 'lost';

export interface FleetStream {
  vehicles: VehicleState[];
  alerts: Alert[];
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
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastMessageAt, setLastMessageAt] = useState<Date | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource('/api/stream');
    sourceRef.current = source;

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
    connection,
    lastMessageAt,
  };
}
