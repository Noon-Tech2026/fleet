import { useTranslation } from 'react-i18next';
import type { Alert } from '../lib/types';

const LEVEL_TONE: Record<Alert['level'], string> = {
  info: 'info',
  warning: 'warn',
  critical: 'crit',
};

/**
 * Le serveur formule ses messages en français : « Titre — détail » ou
 * « Titre par acteur ». On traduit le titre d'après le code et on garde le
 * détail (motif, zone, litres, e-mail) tel quel.
 */
function detailOf(message: string): string {
  const dash = message.indexOf(' — ');
  if (dash >= 0) return message.slice(dash + 3).trim();
  const par = message.lastIndexOf(' par ');
  if (par >= 0) return message.slice(par + 5).trim();
  return '';
}

export function AlertFeed({ alerts }: { alerts: Alert[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const isFrench = locale.startsWith('fr');

  function text(a: Alert): string {
    if (isFrench) return a.message;
    const key = `alerts.${a.code}`;
    if (i18n.exists(key) === false) return a.message;
    return t(key, { detail: detailOf(a.message) });
  }

  if (alerts.length === 0) {
    return <p className="empty">{t('alerts.empty')}</p>;
  }

  return (
    <ul className="alert-feed">
      {alerts.map((a) => (
        <li key={a.id} className={LEVEL_TONE[a.level]}>
          <time dateTime={a.at}>
            {new Date(a.at).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
          </time>
          <span className="who">{a.vehicleId}</span>
          <span>{text(a)}</span>
        </li>
      ))}
    </ul>
  );
}
