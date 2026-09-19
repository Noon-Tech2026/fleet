import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientRecord, DriverRecord, ExitRequestView, TripEntry } from '../lib/types';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { TripDialog } from '../accounting/TripDialog';

interface Props {
  requests: ExitRequestView[];
}

/**
 * Sorties de zone de chargement a valider. Visible par tous, actionnable par
 * superviseur/admin. La confirmation passe par le formulaire de voyage
 * existant : le voyage cree est ensuite lie a la demande.
 */
export function ExitRequestsPanel({ requests }: Props) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const canDecide = can('supervisor');
  const [confirming, setConfirming] = useState<ExitRequestView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);

  useEffect(() => {
    if (canDecide === false) return;
    api.clients().then(setClients).catch(() => setClients([]));
    api.drivers().then(setDrivers).catch(() => setDrivers([]));
  }, [canDecide]);

  if (requests.length === 0) return null;

  async function reject(r: ExitRequestView) {
    if (window.confirm(t('exit.confirmReject', { id: r.vehicleId })) === false) return;
    setBusy(r.id);
    try { await api.rejectExit(r.id); } finally { setBusy(null); }
  }

  async function bypass(r: ExitRequestView) {
    const reason = window.prompt(t('exit.bypassReason'));
    if (reason === null || reason.trim().length < 2) return;
    setBusy(r.id);
    try { await api.bypassExit(r.id, reason.trim()); } finally { setBusy(null); }
  }

  async function onTripDone(trip: TripEntry) {
    if (confirming === null) return;
    setBusy(confirming.id);
    try { await api.confirmExit(confirming.id, trip.id); } finally { setBusy(null); setConfirming(null); }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <section className="exit-panel">
      <h2 className="col-title">
        {t('exit.title')} <span className="count">{requests.length}</span>
      </h2>
      <ul className="exit-list">
        {requests.map((r) => {
          const waitingButton = r.buttonPressedAt === null;
          return (
            <li key={r.id} className={waitingButton ? 'warn' : 'ready'}>
              <div className="row">
                <strong>{r.vehicleId}</strong>
                <span className={`badge ${waitingButton ? 'warn' : 'ok'}`}>
                  {waitingButton ? t('exit.waitingButton') : t('exit.toDecide')}
                </span>
              </div>
              <div className="muted">
                {t('exit.leftZone', { zone: r.zoneName || '—', at: fmt(r.exitedAt) })}
                {r.buttonPressedAt && ` · ${t('exit.pressedAt', { at: fmt(r.buttonPressedAt) })}`}
                {r.rejections > 0 && ` · ${t('exit.rejections', { n: r.rejections })}`}
              </div>
              {canDecide && (
                <div className="exit-actions">
                  <button className="btn mint small" disabled={busy === r.id} onClick={() => setConfirming(r)}>{t('exit.confirm')}</button>
                  <button className="btn ghost small" disabled={busy === r.id || waitingButton} onClick={() => void reject(r)}>{t('exit.reject')}</button>
                  <button className="btn ghost small" disabled={busy === r.id} onClick={() => void bypass(r)}>{t('exit.bypass')}</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {confirming && (
        <TripDialog
          vehicleId={confirming.vehicleId}
          clients={clients}
          drivers={drivers}
          onCancel={() => setConfirming(null)}
          onDone={(trip) => void onTripDone(trip)}
        />
      )}
    </section>
  );
}
