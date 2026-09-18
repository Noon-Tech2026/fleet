import { useTranslation } from 'react-i18next';
import type { VehicleDirectoryEntry } from '../api/client';

interface Props {
  entry: VehicleDirectoryEntry;
  canEdit: boolean;
  onEdit: () => void;
}

/** Camion inscrit au répertoire mais dont le boîtier n'a encore rien envoyé. */
export function PendingVehicleCard({ entry, canEdit, onEdit }: Props) {
  const { t } = useTranslation();
  return (
    <article className="ov-card" style={{ opacity: 0.85 }}>
      <div className="ov-truck-wrap" style={{ background: '#9AA3AC', minHeight: 96 }}>
        <div className="ov-truck-info">
          <div className="ov-truck-driver" style={{ color: '#EEF0F2' }}>
            <span className="dot" style={{ background: '#D8DCE0' }} />
            {t('overview.driverUnassigned')}
          </div>
          <div>
            <div className="ov-truck-id">{entry.id}</div>
            <div className="ov-truck-sub" style={{ color: '#EEF0F2' }}>
              {entry.model || 'SHACMAN F3000'} · {entry.plate}
            </div>
          </div>
        </div>
      </div>

      <div className="ov-status-row">
        <span className="badge idle">{t('overview.awaitingPosition')}</span>
      </div>

      <div className="ov-body">
        <p className="hint">{t('overview.pendingHint')}</p>
        <dl className="ov-stat-grid">
          <div className="ov-stat">
            <dt>{t('overview.imei')}</dt>
            <dd>{entry.imei}</dd>
          </div>
        </dl>
        <div className="ov-actions">
          {canEdit && (
            <button className="btn ghost small" onClick={onEdit}>
              {t('overview.edit')}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
