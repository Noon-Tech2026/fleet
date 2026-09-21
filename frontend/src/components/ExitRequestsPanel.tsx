import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientRecord, DriverRecord, ExitRequestView, TripEntry } from '../lib/types';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { TripDialog } from '../accounting/TripDialog';

interface Props {
  requests: ExitRequestView[];
  /** Incrementer pour ouvrir la fenetre depuis un autre composant. */
  openSignal?: number;
}

/**
 * Sorties de zone de chargement a valider : un bouton compact dans la barre
 * laterale, une fenetre avec la liste complete. La confirmation passe par
 * le formulaire de voyage existant ; le voyage cree est lie a la demande.
 */
export function ExitRequestsPanel({ requests, openSignal = 0 }: Props) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const canDecide = can('supervisor');
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<ExitRequestView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (canDecide === false || open === false) return;
    api.clients().then(setClients).catch(() => setClients([]));
    api.drivers().then(setDrivers).catch(() => setDrivers([]));
  }, [canDecide, open]);

  useEffect(() => {
    if (openSignal > 0 && requests.length > 0) setOpen(true);
  }, [openSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plus rien a valider : refermer la fenetre toute seule.
  useEffect(() => {
    if (requests.length === 0) setOpen(false);
  }, [requests.length]);

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

  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false });
  const waiting = requests.filter((r) => r.buttonPressedAt === null).length;
  const ready = requests.length - waiting;

  // Jamais "a valider" derriere "en attente" ; a statut egal, la plus ancienne d'abord.
  const sorted = [...requests].sort((a, b) => {
    const ra = a.buttonPressedAt === null ? 1 : 0;
    const rb = b.buttonPressedAt === null ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return Date.parse(a.exitedAt) - Date.parse(b.exitedAt);
  });
  const q = filter.trim().toLowerCase();
  const shown = q.length === 0 ? sorted : sorted.filter((r) => r.vehicleId.toLowerCase().includes(q) || r.zoneName.toLowerCase().includes(q));

  return (
    <>
      <button className="btn exit-toggle" onClick={() => setOpen(true)}>
        <span>{t('exit.title')}</span>
        <span className="exit-counts">
          {ready > 0 && <span className="badge ok">{ready}</span>}
          {waiting > 0 && <span className="badge warn">{waiting}</span>}
        </span>
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal exit-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <header className="modal-head">
              <div>
                <h2>{t('exit.title')}</h2>
                <p>{t('exit.summary', { ready, waiting })}</p>
              </div>
              <button className="btn ghost" onClick={() => setOpen(false)}>{t('track.close')}</button>
            </header>

            {requests.length > 10 && (
              <input
                className="exit-filter"
                type="search"
                placeholder={t('exit.filter')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}

            <ul className="exit-list">
              {shown.map((r) => {
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
          </div>
        </div>
      )}

      {confirming && (
        <TripDialog
          vehicleId={confirming.vehicleId}
          clients={clients}
          drivers={drivers}
          onCancel={() => setConfirming(null)}
          onDone={(trip) => void onTripDone(trip)}
        />
      )}
    </>
  );
}
