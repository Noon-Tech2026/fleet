import { useState } from 'react';
import type { VehicleState } from '../lib/types';
import { statusOf } from '../lib/status';
import { useTranslation } from 'react-i18next';
import { FuelGauge } from './FuelGauge';
import { MaintenancePanel } from './MaintenancePanel';
import { StarterDialog } from './StarterDialog';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface Props {
  vehicle: VehicleState;
  simulatorMode: boolean;
  onTrack?: () => void;
}

export function VehicleDetail({ vehicle, simulatorMode, onTrack }: Props) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const status = statusOf(vehicle);
  const locale = i18n.language;

  // Masquer un bouton n'est pas une protection — le serveur refuse de
  // toute façon. C'est du confort : ne pas proposer une action qui
  // renverra 403.
  const canOperate = can('operator');
  const canControlStarter = can('supervisor');
  const locked = sending || vehicle.commandLock !== null;

  function explain(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.includes('409') || msg.toLowerCase().includes('deja en cours')
      ? t('supervision.conflict')
      : t('supervision.failed', { msg });
  }

  async function block(reason: string) {
    setSending(true);
    try {
      const audit = await api.blockStarter(vehicle.id, reason);
      setDialogOpen(false);
      setNotice(audit.applied ? t('supervision.sent') : t('supervision.queued'));
    } catch (e) {
      setNotice(explain(e));
    } finally {
      setSending(false);
    }
  }

  async function release() {
    setSending(true);
    try {
      await api.releaseStarter(vehicle.id, t('supervision.releaseReason'));
      setNotice(t('supervision.sent'));
    } catch (e) {
      setNotice(explain(e));
    } finally {
      setSending(false);
    }
  }

  const starterLabel =
    vehicle.starter === 'allowed'
      ? t('supervision.starterAllowed')
      : vehicle.starter === 'pending_block'
        ? t('supervision.starterPending')
        : t('supervision.starterBlocked');

  return (
    <div className="detail">
      <header className="detail-head">
        <div>
          <h2>{vehicle.id}</h2>
          <p>
            <bdi dir="ltr">{vehicle.plate}</bdi> · {vehicle.driver || t('supervision.unassigned')}
          </p>
        </div>
        <div className="head-actions">
          <span className={`badge ${status.tone}`}>{t(`status.${status.key}`)}</span>
          {onTrack && (
            <button className="btn ghost small" onClick={onTrack}>{t('track.button')}</button>
          )}
        </div>
      </header>

      <dl className="stats">
        <div>
          <dt>{t('supervision.speed')}</dt>
          <dd>{vehicle.speed} km/h</dd>
        </div>
        <div>
          <dt>{t('supervision.engine')}</dt>
          <dd>{vehicle.ignition ? t('supervision.engineOn') : t('supervision.engineOff')}</dd>
        </div>
        <div>
          <dt>{t('supervision.odometer')}</dt>
          <dd>{vehicle.odometer.toLocaleString(locale)} km</dd>
        </div>
        <div>
          <dt>{t('supervision.engineHours')}</dt>
          <dd>{vehicle.engineHours.toLocaleString(locale)} h</dd>
        </div>
      </dl>

      <h3>{t('supervision.fuel')}</h3>
      <div className="fuel-row">
        <FuelGauge liters={vehicle.fuelMain} capacity={700} label={t('supervision.fuelMain')} />
        <FuelGauge liters={vehicle.fuelAux} capacity={300} label={t('supervision.fuelAux')} />
      </div>

      <h3>{t('supervision.maintenance')}</h3>
      <MaintenancePanel vehicleId={vehicle.id} />

      <h3>{t('supervision.departure')}</h3>
      <div className={`panel ${vehicle.departureConfirmed ? 'ok' : 'warn'}`}>
        <strong>
          {vehicle.departureConfirmed ? t('supervision.departureConfirmed') : t('supervision.departureNone')}
        </strong>
        <span>{t('supervision.departureHint')}</span>
        {simulatorMode && canOperate && vehicle.departureConfirmed === false && (
          <button className="btn ghost full" onClick={() => void api.pressButton(vehicle.id)}>
            {t('supervision.simulateButton')}
          </button>
        )}
      </div>

      <h3>{t('supervision.starter')}</h3>
      <div
        className={`panel ${vehicle.starter === 'allowed' ? 'ok' : vehicle.starter === 'pending_block' ? 'warn' : 'danger'}`}
      >
        <strong>{starterLabel}</strong>
        <span>{t('supervision.starterHint')}</span>
        {vehicle.commandLock && (
          <p className="hint">{t('supervision.commandInProgress', { by: vehicle.commandLock.by })}</p>
        )}

        {canControlStarter === false ? (
          <p className="hint">{t('supervision.supervisorOnly')}</p>
        ) : vehicle.starter === 'allowed' ? (
          <button className="btn danger full" disabled={locked} onClick={() => setDialogOpen(true)}>
            {t('supervision.blockButton')}
          </button>
        ) : (
          <button className="btn mint full" disabled={locked} onClick={() => void release()}>
            {t('supervision.releaseButton')}
          </button>
        )}
      </div>

      {notice && <p className="notice">{notice}</p>}

      <dl className="tech">
        <div>
          <dt>{t('supervision.imei')}</dt>
          <dd>{vehicle.imei}</dd>
        </div>
        <div>
          <dt>{t('supervision.position')}</dt>
          <dd>
            {vehicle.lat.toFixed(5)}, {vehicle.lon.toFixed(5)}
          </dd>
        </div>
        <div>
          <dt>{t('supervision.battery')}</dt>
          <dd>{vehicle.battery} V</dd>
        </div>
        <div>
          <dt>{t('supervision.lastFrame')}</dt>
          <dd>{new Date(vehicle.updatedAt).toLocaleTimeString(locale, { hour12: false })}</dd>
        </div>
      </dl>

      {dialogOpen && (
        <StarterDialog vehicle={vehicle} onCancel={() => setDialogOpen(false)} onConfirm={block} />
      )}
    </div>
  );
}
