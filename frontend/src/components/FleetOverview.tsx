import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VehicleState } from '../lib/types';
import { statusOf, type Status } from '../lib/status';
import { formatMoney } from '../lib/accounting';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { StarterDialog } from './StarterDialog';
import { VehicleHistoryDialog } from './VehicleHistoryDialog';
import { TrackHistoryDialog } from './TrackHistoryDialog';
import { CreateVehicleDialog } from './CreateVehicleDialog';
import { EditVehicleDialog } from './EditVehicleDialog';
import { PendingVehicleCard } from './PendingVehicleCard';
import type { VehicleDirectoryEntry } from '../api/client';

interface Props {
  vehicles: VehicleState[];
  onTrack: (vehicleId: string) => void;
}

const RING_RADIUS = 25;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const TRUCK_PALETTE: Record<Status['tone'], { base: string; mid: string; dark: string; glass: string; glassPale: string; stripe: string }> = {
  ok: { base: '#3FBE8E', mid: '#1D9E75', dark: '#12704F', glass: '#AEE9D3', glassPale: '#D6F5E9', stripe: '#0F5A3D' },
  warn: { base: '#E2A93A', mid: '#BA7517', dark: '#8A5710', glass: '#F5DDA6', glassPale: '#FBEFD3', stripe: '#6B4009' },
  danger: { base: '#E2544F', mid: '#C53030', dark: '#8C2323', glass: '#F7C1C1', glassPale: '#FCEBEB', stripe: '#5C1717' },
  idle: { base: '#9AA3AC', mid: '#6B7480', dark: '#4B525C', glass: '#D8DCE0', glassPale: '#EEF0F2', stripe: '#333940' },
};

const FUEL_MAIN_CAPACITY = 700;
const FUEL_AUX_CAPACITY = 300;

function fuelTone(ratio: number): string {
  return ratio < 0.15 ? 'var(--red)' : ratio < 0.3 ? 'var(--amber)' : 'var(--mint)';
}

export function FleetOverview({ vehicles, onTrack }: Props) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canControlStarter = can('supervisor');
  const canManageFleet = can('admin');

  const [summaries, setSummaries] = useState<Record<string, { revenue: number; expenses: number; investments: number; netResult: number }>>({});
  // Incrémenté à la fermeture du journal : les montants ont pu changer.
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [directory, setDirectory] = useState<VehicleDirectoryEntry[]>([]);
  const [directoryVersion, setDirectoryVersion] = useState(0);

  // Camions inscrits mais encore muets : sans cela, un camion cree depuis
  // l'interface disparait jusqu'a sa premiere position.
  useEffect(() => {
    api.fleetVehicles().then(setDirectory).catch(() => setDirectory([]));
  }, [directoryVersion]);
  const pending = directory.filter((d) => d.active && !vehicles.some((v) => v.id === d.id));
  const [dialogVehicleId, setDialogVehicleId] = useState<string | null>(null);
  const [historyVehicleId, setHistoryVehicleId] = useState<string | null>(null);
  const [trackVehicle, setTrackVehicle] = useState<{ id: string; plate: string } | null>(null);
  const [creatingVehicle, setCreatingVehicle] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .accountingSummary()
      .then((rows) => {
        setSummaries(Object.fromEntries(rows.map((r) => [r.vehicleId, r])));
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : t('overview.loadError')));
  }, [t, summaryVersion]);

  const dialogVehicle = useMemo(
    () => vehicles.find((v) => v.id === dialogVehicleId) ?? null,
    [vehicles, dialogVehicleId],
  );

  const historyVehicle = useMemo(
    () => vehicles.find((v) => v.id === historyVehicleId) ?? null,
    [vehicles, historyVehicleId],
  );

  async function block(vehicleId: string, reason: string) {
    const audit = await api.blockStarter(vehicleId, reason);
    setDialogVehicleId(null);
    setNotice(t(audit.applied ? 'overview.blockedApplied' : 'overview.blockedQueued', { id: vehicleId }));
  }

  async function release(vehicleId: string) {
    await api.releaseStarter(vehicleId, 'Réautorisation manuelle');
    setNotice(t('overview.released', { id: vehicleId }));
  }

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>{t('overview.title')}</h2>
        </div>
        {canManageFleet && (
          <button className="btn primary" onClick={() => setCreatingVehicle(true)}>
            {t('overview.newTruck')}
          </button>
        )}
      </header>

      {loadError && <p className="banner err">{loadError}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {vehicles.length === 0 && pending.length === 0 ? (
        <p className="empty">{t('overview.empty')}</p>
      ) : (
        <div className="overview-grid">
          {vehicles.map((v, i) => {
            const status = statusOf(v);
            const palette = TRUCK_PALETTE[status.tone];
            const summary = summaries[v.id];

            const ratioMain = Math.max(0, Math.min(1, v.fuelMain / FUEL_MAIN_CAPACITY));
            const ratioAux = Math.max(0, Math.min(1, v.fuelAux / FUEL_AUX_CAPACITY));

            const moteurBlocked = v.starter === 'blocked';
            const moteurLabel = moteurBlocked ? t('overview.engineBlocked') : v.ignition ? t('overview.engineRunning') : t('overview.engineStopped');
            const moteurColor = moteurBlocked ? 'var(--red)' : v.ignition ? 'var(--mint)' : 'var(--dim)';
            const moving = v.ignition && v.speed > 0;

            return (
              <article className="ov-card" key={v.id} style={{ animationDelay: `${Math.min(i, 10) * 45}ms` }}>
                <div className="ov-truck-wrap">
                  <svg viewBox="0 0 440 96" className="ov-truck" role="img" aria-label={`${v.id}, ${v.plate}`}>
                    <rect x="0" y="0" width="440" height="96" fill={palette.base} />
                    <path d="M300 0 L360 0 L360 96 L300 96 Z" fill={palette.mid} />
                    <path d="M360 0 L440 0 L440 96 L360 96 L372 60 L372 36 Z" fill={palette.dark} />
                    <rect x="384" y="30" width="44" height="26" rx="4" fill={palette.glass} />
                    <rect x="388" y="34" width="36" height="18" rx="2" fill={palette.glassPale} />
                    <circle cx="432" cy="70" r="4" fill="#FAC775" />
                    <rect x="300" y="40" width="60" height="4" rx="2" fill={palette.stripe} />
                    <rect x="300" y="52" width="60" height="4" rx="2" fill={palette.stripe} />
                  </svg>

                  <div className="ov-truck-info">
                    <div className="ov-truck-driver" style={{ color: palette.glassPale }}>
                      <span className="dot" style={{ background: palette.glass }} />
                      {v.driver || t('overview.driverUnassigned')}
                    </div>
                    <div>
                      <div className="ov-truck-id">{v.id}</div>
                      <div className="ov-truck-sub" style={{ color: palette.glassPale }}>
                        SHACMAN F3000 · {v.plate}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className={`ov-strip ${moving ? 'moving' : ''}`}
                  style={{ background: `repeating-linear-gradient(90deg, ${palette.stripe} 0 20px, transparent 20px 40px)` }}
                />

                <div className="ov-status-row">
                  <span className={`badge ${status.tone}`}>{t(`status.${status.key}`)}</span>
                </div>

                <div className="ov-body">
                  <div className="ov-gauges">
                    <RingGauge ratio={ratioMain} label={`${t('overview.fuelMain')} ${Math.round(v.fuelMain)}L`} />
                    <RingGauge ratio={ratioAux} label={`${t('overview.fuelAux')} ${Math.round(v.fuelAux)}L`} />

                    <dl className="ov-stat-grid">
                      <div className="ov-stat">
                        <dt>{t('overview.engine')}</dt>
                        <dd style={{ color: moteurColor }}>{moteurLabel}</dd>
                      </div>
                      <div className="ov-stat">
                        <dt>{t('overview.odometer')}</dt>
                        <dd>{v.odometer.toLocaleString('fr-FR')} km</dd>
                      </div>
                      <div className="ov-stat">
                        <dt>{t('overview.battery')}</dt>
                        <dd>{v.battery} V</dd>
                      </div>
                      <div className="ov-stat">
                        <dt>{t('overview.gps')}</dt>
                        <dd style={{ color: v.online ? 'var(--mint)' : 'var(--red)' }}>
                          {v.online ? t('overview.gpsOnline') : t('overview.gpsOffline')}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {summary && (
                    <>
                      <dl className="ov-money-row">
                        <div className="ov-money ok">
                          <dt>{t('overview.trips')}</dt>
                          <dd>{formatMoney(summary.revenue)}</dd>
                        </div>
                        <div className="ov-money danger">
                          <dt>{t('overview.charges')}</dt>
                          <dd>{formatMoney(summary.expenses)}</dd>
                        </div>
                        <div className="ov-money warn">
                          <dt>{t('overview.investments')}</dt>
                          <dd>{formatMoney(summary.investments)}</dd>
                        </div>
                      </dl>

                      <div className={`ov-net ${summary.netResult >= 0 ? 'ok' : 'danger'}`}>
                        <span>{t('overview.netResult')}</span>
                        <b>
                          {summary.netResult >= 0 ? '+' : ''}
                          {formatMoney(summary.netResult)}
                        </b>
                      </div>
                    </>
                  )}

                  <div className="ov-actions">
                    <button className="btn ghost small" onClick={() => onTrack(v.id)}>
                      {t('overview.track')}
                    </button>
                    <button className="btn ghost small" onClick={() => setTrackVehicle({ id: v.id, plate: v.plate })}>{t('track.button')}</button>
                    <button className="btn ghost small" onClick={() => setHistoryVehicleId(v.id)}>
                      {t('overview.history')}
                    </button>
                    {canManageFleet && (
                      <button className="btn ghost small" onClick={() => setEditingVehicleId(v.id)}>
                        {t('overview.edit')}
                      </button>
                    )}
                    {canControlStarter &&
                      (v.starter === 'allowed' ? (
                        <button className="btn danger small" onClick={() => setDialogVehicleId(v.id)}>
                          {t('overview.block')}
                        </button>
                      ) : (
                        <button className="btn mint small" onClick={() => void release(v.id)}>
                          {t('overview.unblock')}
                        </button>
                      ))}
                  </div>
                </div>
              </article>
            );
          })}
          {pending.map((d) => (
            <PendingVehicleCard key={d.id} entry={d} canEdit={canManageFleet} onEdit={() => setEditingVehicleId(d.id)} />
          ))}
        </div>
      )}

      {dialogVehicle && (
        <StarterDialog
          vehicle={dialogVehicle}
          onCancel={() => setDialogVehicleId(null)}
          onConfirm={(reason) => block(dialogVehicle.id, reason)}
        />
      )}

      {trackVehicle && (
        <TrackHistoryDialog vehicleId={trackVehicle.id} plate={trackVehicle.plate} onClose={() => setTrackVehicle(null)} />
      )}

      {historyVehicle && (
        <VehicleHistoryDialog
          vehicleId={historyVehicle.id}
          plate={historyVehicle.plate}
          onClose={() => {
            setHistoryVehicleId(null);
            setSummaryVersion((n) => n + 1);
          }}
        />
      )}

      {editingVehicleId && (
        <EditVehicleDialog
          vehicleId={editingVehicleId}
          onCancel={() => setEditingVehicleId(null)}
          onSaved={(vehicleId) => {
            setEditingVehicleId(null);
            setDirectoryVersion((n) => n + 1);
            setNotice(t('overview.updated', { id: vehicleId }));
          }}
        />
      )}

      {creatingVehicle && (
        <CreateVehicleDialog
          onCancel={() => setCreatingVehicle(false)}
          onCreated={(vehicleId) => {
            setCreatingVehicle(false);
            setDirectoryVersion((n) => n + 1);
            setNotice(t('overview.created', { id: vehicleId }));
          }}
        />
      )}
    </main>
  );
}

function RingGauge({ ratio, label }: { ratio: number; label: string }) {
  const tone = fuelTone(ratio);
  const offset = RING_CIRCUMFERENCE * (1 - ratio);

  return (
    <div className="ov-ring">
      <svg viewBox="0 0 60 60" role="img" aria-label={label}>
        <circle cx="30" cy="30" r={RING_RADIUS} fill="none" stroke="var(--ink-0)" strokeWidth="6" />
        <circle
          cx="30"
          cy="30"
          r={RING_RADIUS}
          fill="none"
          stroke={tone}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 30 30)"
        />
        <text x="30" y="34" textAnchor="middle" fill="var(--bone)" fontSize="13" fontWeight="600">
          {Math.round(ratio * 100)}%
        </text>
      </svg>
      <span>{label}</span>
    </div>
  );
}
