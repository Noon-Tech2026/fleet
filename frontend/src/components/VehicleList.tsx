import type { VehicleState } from '../lib/types';
import type { VehicleDirectoryEntry } from '../api/client';
import { statusOf } from '../lib/status';
import { useTranslation } from 'react-i18next';

/** Somme des deux réservoirs d'un F3000 — sert uniquement à l'échelle de la
 *  barre de la vignette, jamais à un calcul métier. */
const TANKS_TOTAL_LITERS = 1000;

interface Props {
  vehicles: VehicleState[];
  /** Camions du répertoire dont le boîtier n'a encore rien transmis. */
  pending?: VehicleDirectoryEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function VehicleList({ vehicles, pending = [], selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  if (vehicles.length === 0 && pending.length === 0) {
    return <p className="empty">{t('supervision.empty')}</p>;
  }

  const moving = vehicles.filter((v) => v.online && v.speed > 3).length;
  const blocked = vehicles.filter((v) => v.starter !== 'allowed').length;
  const stopped = vehicles.length - moving;

  return (
    <>
      <div className="fleet-summary">
        <div className="summary-cell ok">
          <b>{moving}</b>
          <span>{t('supervision.moving')}</span>
        </div>
        <div className="summary-cell idle">
          <b>{stopped}</b>
          <span>{t('supervision.stopped')}</span>
        </div>
        <div className="summary-cell danger">
          <b>{blocked}</b>
          <span>{t('supervision.blocked')}</span>
        </div>
      </div>

      <ul className="vehicle-list">
        {vehicles.map((v) => {
          const status = statusOf(v);
          const total = v.fuelMain + v.fuelAux;
          const ratio = Math.min(1, total / TANKS_TOTAL_LITERS);
          // Le niveau se lit d'abord à la couleur : sur une liste de vingt
          // vignettes, personne ne compare des largeurs de barres.
          const gaugeTone = ratio < 0.15 ? 'danger' : ratio < 0.3 ? 'warn' : 'ok';

          return (
            <li key={v.id}>
              <button
                className={`vehicle-card tone-${status.tone} ${v.id === selectedId ? 'active' : ''}`}
                onClick={() => onSelect(v.id)}
                aria-current={v.id === selectedId}
              >
                <div className="row">
                  <span className="vid">{v.id}</span>
                  <span className={`badge ${status.tone}`}>{t(`status.${status.key}`)}</span>
                </div>
                <div className="plate" dir="ltr">{v.plate}</div>
                <div className="row muted">
                  <span className="metric">
                    {v.speed} <u>km/h</u>
                  </span>
                  <span className="metric">
                    {Math.round(total)} <u>L</u>
                  </span>
                </div>
                <div className={`gauge ${gaugeTone}`}>
                  <i style={{ width: `${ratio * 100}%` }} />
                </div>
              </button>
            </li>
          );
        })}

        {pending.map((d) => (
          <li key={d.id}>
            <div className="vehicle-card tone-idle pending" aria-disabled="true">
              <div className="row">
                <span className="vid">{d.id}</span>
                <span className="badge idle">{t('supervision.awaitingPosition')}</span>
              </div>
              <div className="plate" dir="ltr">{d.plate}</div>
              <div className="row muted">
                <span className="metric">{t('supervision.awaitingHint')}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
