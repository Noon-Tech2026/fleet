import type { VehicleState } from '../lib/types';
import { statusOf } from '../lib/status';

/** Somme des deux réservoirs d'un F3000 — sert uniquement à l'échelle de la
 *  barre de la vignette, jamais à un calcul métier. */
const TANKS_TOTAL_LITERS = 1000;

interface Props {
  vehicles: VehicleState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function VehicleList({ vehicles, selectedId, onSelect }: Props) {
  if (vehicles.length === 0) {
    return <p className="empty">Aucun boîtier n'a encore transmis de position.</p>;
  }

  const moving = vehicles.filter((v) => v.online && v.speed > 3).length;
  const blocked = vehicles.filter((v) => v.starter !== 'allowed').length;
  const stopped = vehicles.length - moving;

  return (
    <>
      <div className="fleet-summary">
        <div className="summary-cell ok">
          <b>{moving}</b>
          <span>En route</span>
        </div>
        <div className="summary-cell idle">
          <b>{stopped}</b>
          <span>À l'arrêt</span>
        </div>
        <div className="summary-cell danger">
          <b>{blocked}</b>
          <span>Bloqués</span>
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
                  <span className={`badge ${status.tone}`}>{status.label}</span>
                </div>
                <div className="plate">{v.plate}</div>
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
      </ul>
    </>
  );
}
