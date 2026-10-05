import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ContainerHit } from '../api/client';
import { formatMoney } from '../lib/accounting';

interface Props {
  onClose: () => void;
  /** Ouvre le journal du client avec le voyage surligne. */
  onOpenLedger: (clientId: string, clientName: string, tripId: string) => void;
}

/** Recherche avancee : retrouve le voyage d'un conteneur (client, camion, chauffeur, montant). */
export function ContainerSearchDialog({ onClose, onOpenLedger }: Props) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ContainerHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    try { setHits(await api.searchContainers(q.trim())); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ledger-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div><h2>{t('containerSearch.title', 'Recherche avancée — conteneur')}</h2></div>
          <div className="chips"><button className="btn ghost" onClick={onClose}>{t('track.close')}</button></div>
        </header>

        <form className="ledger-pay" onSubmit={search}>
          <label className="field inline grow">
            <span>{t('containerSearch.number', 'N° de conteneur')}</span>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('containerSearch.ph', 'ex. MSKU1234567 (3 caractères minimum)')} />
          </label>
          <button className="btn primary" disabled={busy || q.trim().length < 3}>{t('containerSearch.search', 'Rechercher')}</button>
        </form>
        {error && <p className="banner err">{error}</p>}

        {hits && hits.length === 0 && <p className="muted small">{t('containerSearch.none', 'Aucun voyage trouvé pour ce conteneur.')}</p>}
        {hits && hits.length > 0 && (
          <div className="container-hits">
            {hits.map((h) => (
              <article key={`${h.tripId}:${h.containerNumber}`} className="container-hit">
                <header>
                  <b className="container-no">{h.containerNumber ?? '—'}</b>
                  <span className="badge idle">{h.size}'</span>
                  <span className={h.paid ? 'badge ok' : 'badge warn'}>
                    {h.paid ? t('containerSearch.paid', 'Payé comptant') : t('containerSearch.account', 'Sur compte client')}
                  </span>
                </header>
                <dl>
                  <dt>{t('containerSearch.client', 'Client')}</dt><dd><b>{h.clientName}</b></dd>
                  <dt>{t('containerSearch.truck', 'Camion')}</dt>
                  <dd>{h.vehicleId}{h.plate ? ` · ${h.plate}` : ''}{h.driverName ? ` · ${h.driverName}` : ''}</dd>
                  <dt>{t('containerSearch.date', 'Date')}</dt>
                  <dd>{fmt(h.startedAt)}{h.endedAt ? ` → ${fmt(h.endedAt)}` : ''}</dd>
                  {(h.origin || h.destination) && (<><dt>{t('containerSearch.route', 'Trajet')}</dt><dd>{h.origin ?? '—'} → {h.destination ?? '—'}</dd></>)}
                  <dt>{t('containerSearch.amount', 'Montant du voyage')}</dt><dd><b>{formatMoney(h.amount)}</b></dd>
                  {h.otherContainers.length > 0 && (<><dt>{t('containerSearch.others', 'Autres conteneurs')}</dt><dd>{h.otherContainers.join(' · ')}</dd></>)}
                  {h.notes && (<><dt>{t('containerSearch.notes', 'Notes')}</dt><dd>{h.notes}</dd></>)}
                </dl>
                <footer>
                  <button className="btn primary small" onClick={() => onOpenLedger(h.clientId, h.clientName, h.tripId)}>
                    {t('containerSearch.openLedger', 'Ouvrir le journal client')}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
