import { useEffect, useMemo, useState } from 'react';
import type { VehicleState } from '../lib/types';
import { statusOf, type Status } from '../lib/status';
import { formatMoney } from '../lib/accounting';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { StarterDialog } from './StarterDialog';
import { VehicleHistoryDialog } from './VehicleHistoryDialog';

interface Props {
  vehicles: VehicleState[];
  onTrack: (vehicleId: string) => void;
}

const RING_RADIUS = 25;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Palette de l'illustration camion par ton d'état — même vocabulaire que
 *  `statusOf` (ok/warn/danger/idle), pas une couleur par véhicule. */
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
  const { can } = useAuth();
  const canControlStarter = can('supervisor');

  const [summaries, setSummaries] = useState<Record<string, { revenue: number; expenses: number; investments: number; netResult: number }>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogVehicleId, setDialogVehicleId] = useState<string | null>(null);
  const [historyVehicleId, setHistoryVehicleId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .accountingSummary()
      .then((rows) => {
        setSummaries(Object.fromEntries(rows.map((r) => [r.vehicleId, r])));
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);

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
    setNotice(
      `${vehicleId} — ${
        audit.applied
          ? 'démarreur bloqué, le boîtier a accusé réception.'
          : "blocage en file d'attente, appliqué automatiquement dès l'arrêt."
      }`,
    );
  }

  async function release(vehicleId: string) {
    await api.releaseStarter(vehicleId, 'Réautorisation manuelle');
    setNotice(`${vehicleId} — démarrage réautorisé.`);
  }

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>Vue d'ensemble</h2>
        </div>
      </header>

      {loadError && <p className="banner err">{loadError}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {vehicles.length === 0 ? (
        <p className="empty">Aucun boîtier n'a encore transmis de position.</p>
      ) : (
        <div className="overview-grid">
          {vehicles.map((v) => {
            const status = statusOf(v);
            const palette = TRUCK_PALETTE[status.tone];
            const summary = summaries[v.id];

            const ratioMain = Math.max(0, Math.min(1, v.fuelMain / FUEL_MAIN_CAPACITY));
            const ratioAux = Math.max(0, Math.min(1, v.fuelAux / FUEL_AUX_CAPACITY));

            const moteurBlocked = v.starter === 'blocked';
            const moteurLabel = moteurBlocked ? 'Bloqué' : v.ignition ? 'Marche' : 'Arrêté';
            const moteurColor = moteurBlocked ? 'var(--red)' : v.ignition ? 'var(--mint)' : 'var(--dim)';

            return (
              <article className="ov-card" key={v.id}>
                <svg viewBox="0 0 440 96" className="ov-truck" role="img" aria-label={`${v.id}, ${v.plate}`}>
                  <rect x="0" y="0" width="440" height="96" fill={palette.base} />
                  <path d="M300 0 L360 0 L360 96 L300 96 Z" fill={palette.mid} />
                  <path d="M360 0 L440 0 L440 96 L360 96 L372 60 L372 36 Z" fill={palette.dark} />
                  <rect x="384" y="30" width="44" height="26" rx="4" fill={palette.glass} />
                  <rect x="388" y="34" width="36" height="18" rx="2" fill={palette.glassPale} />
                  <circle cx="432" cy="70" r="4" fill="#FAC775" />
                  <rect x="300" y="40" width="60" height="4" rx="2" fill={palette.stripe} />
                  <rect x="300" y="52" width="60" height="4" rx="2" fill={palette.stripe} />
                  <text x="28" y="42" fill="#fff" fontSize="24" fontWeight="600">
                    {v.id}
                  </text>
                  <text x="28" y="66" fill={palette.glassPale} fontSize="13">
                    SHACMAN F3000 · {v.plate}
                  </text>
                  <circle cx="200" cy="30" r="4" fill={palette.glass} />
                  <text x="212" y="34" fill={palette.glassPale} fontSize="11">
                    {v.driver}
                  </text>
                </svg>

                <div
                  className="ov-strip"
                  style={{
                    background: `repeating-linear-gradient(90deg, ${palette.stripe} 0 20px, transparent 20px 40px)`,
                  }}
                />

                <div className="ov-status-row">
                  <span className={`badge ${status.tone}`}>{status.label}</span>
                </div>

                <div className="ov-body">
                  <div className="ov-gauges">
                    <RingGauge ratio={ratioMain} label={`Princ. ${Math.round(v.fuelMain)}L`} />
                    <RingGauge ratio={ratioAux} label={`Aux. ${Math.round(v.fuelAux)}L`} />

                    <dl className="ov-stat-grid">
                      <div className="ov-stat">
                        <dt>Moteur</dt>
                        <dd style={{ color: moteurColor }}>{moteurLabel}</dd>
                      </div>
                      <div className="ov-stat">
                        <dt>Odo</dt>
                        <dd>{v.odometer.toLocaleString('fr-FR')} km</dd>
                      </div>
                      <div className="ov-stat">
                        <dt>Batt.</dt>
                        <dd>{v.battery} V</dd>
                      </div>
                      <div className="ov-stat">
                        <dt>GPS</dt>
                        <dd style={{ color: v.online ? 'var(--mint)' : 'var(--red)' }}>
                          {v.online ? 'Actif' : 'Hors ligne'}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {summary && (
                    <>
                      <dl className="ov-money-row">
                        <div className="ov-money ok">
                          <dt>Voyages</dt>
                          <dd>{formatMoney(summary.revenue)}</dd>
                        </div>
                        <div className="ov-money danger">
                          <dt>Charges</dt>
                          <dd>{formatMoney(summary.expenses)}</dd>
                        </div>
                        <div className="ov-money warn">
                          <dt>Invest.</dt>
                          <dd>{formatMoney(summary.investments)}</dd>
                        </div>
                      </dl>

                      <div className={`ov-net ${summary.netResult >= 0 ? 'ok' : 'danger'}`}>
                        <span>Reste après invest.</span>
                        <b>
                          {summary.netResult >= 0 ? '+' : ''}
                          {formatMoney(summary.netResult)}
                        </b>
                      </div>
                    </>
                  )}

                  <div className="ov-actions">
                    <button className="btn ghost small" onClick={() => onTrack(v.id)}>
                      Suivi
                    </button>
                    <button className="btn ghost small" onClick={() => setHistoryVehicleId(v.id)}>
                      Historique
                    </button>
                    {canControlStarter &&
                      (v.starter === 'allowed' ? (
                        <button className="btn danger small" onClick={() => setDialogVehicleId(v.id)}>
                          Bloquer
                        </button>
                      ) : (
                        <button className="btn mint small" onClick={() => void release(v.id)}>
                          Débloquer
                        </button>
                      ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dialogVehicle && (
        <StarterDialog
          vehicle={dialogVehicle}
          onCancel={() => setDialogVehicleId(null)}
          onConfirm={(reason) => block(dialogVehicle.id, reason)}
        />
      )}

      {historyVehicle && (
        <VehicleHistoryDialog
          vehicleId={historyVehicle.id}
          plate={historyVehicle.plate}
          onClose={() => setHistoryVehicleId(null)}
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
