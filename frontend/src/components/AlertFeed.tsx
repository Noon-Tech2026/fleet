import type { Alert } from '../lib/types';

const LEVEL_TONE: Record<Alert['level'], string> = {
  info: 'info',
  warning: 'warn',
  critical: 'crit',
};

export function AlertFeed({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="empty">
        Aucun événement. Les alertes apparaîtront ici dès qu'une règle se déclenche.
      </p>
    );
  }

  return (
    <ul className="alert-feed">
      {alerts.map((a) => (
        <li key={a.id} className={LEVEL_TONE[a.level]}>
          <time dateTime={a.at}>
            {new Date(a.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </time>
          <span className="who">{a.vehicleId}</span>
          <span>{a.message}</span>
        </li>
      ))}
    </ul>
  );
}
