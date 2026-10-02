import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientRecord } from '../lib/types';
import { api, type ClientLedger } from '../api/client';
import { formatMoney } from '../lib/accounting';
import { useAuth } from '../auth/AuthContext';
import { PeriodFilter, type Period } from './PeriodFilter';

interface Props { client: ClientRecord; onClose: () => void }

/** Journal d'un client : debit (du), credit (recu), solde. */
export function ClientLedgerDialog({ client, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const canWrite = can('supervisor');
  const isAdmin = can('admin');
  const [period, setPeriod] = useState<Period>({});
  const [ledger, setLedger] = useState<ClientLedger | null>(null);
  const [kind, setKind] = useState<'debit' | 'credit'>('credit');
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setLedger(await api.clientLedger(client.id, period)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [client.id, period]);
  useEffect(() => { void load(); }, [load]);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(amount);
    if (!(v > 0) || label.trim().length < 2) return;
    setBusy(true);
    try {
      await api.addClientEntry(client.id, { kind, amount: v, at: `${at}T12:00:00`, label: label.trim() });
      setAmount(''); setLabel('');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (window.confirm(t('clients.ledger.confirmDelete')) === false) return;
    await api.deleteClientEntry(id); await load();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ledger-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div><h2>{t('clients.ledger.title')} — {client.name}</h2></div>
          <button className="btn ghost" onClick={onClose}>{t('track.close')}</button>
        </header>

        <PeriodFilter value={period} onChange={setPeriod} />
        {error && <p className="banner err">{error}</p>}

        {ledger && (
          <>
            <div className="fleet-summary compact">
              <div className="summary-cell danger"><b>{formatMoney(ledger.period.debit)}</b><span>{t('clients.ledger.debit')}</span></div>
              <div className="summary-cell ok"><b>{formatMoney(ledger.period.credit)}</b><span>{t('clients.ledger.credit')}</span></div>
              <div className={`summary-cell ${ledger.overall.balance > 0 ? 'warn' : 'ok'}`}><b>{formatMoney(ledger.overall.balance)}</b><span>{t('clients.ledger.balance')}</span></div>
            </div>

            {canWrite && (
              <form className="ledger-pay" onSubmit={submit}>
                <label className="field inline"><span>{t('common.type')}</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value as 'debit' | 'credit')}>
                    <option value="credit">{t('clients.ledger.creditEntry')}</option>
                    <option value="debit">{t('clients.ledger.debitEntry')}</option>
                  </select>
                </label>
                <label className="field inline"><span>{t('common.amount')}</span><input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
                <label className="field inline"><span>{t('common.date')}</span><input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></label>
                <label className="field inline grow"><span>{t('clients.ledger.label')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('clients.ledger.labelPh')} required /></label>
                <button className="btn primary" disabled={busy || !(Number(amount) > 0) || label.trim().length < 2}>{t('clients.ledger.add')}</button>
              </form>
            )}

            {ledger.lines.length === 0 ? <p className="muted small">{t('clients.ledger.empty')}</p> : (
              <table className="table small">
                <thead><tr><th>{t('common.date')}</th><th>{t('clients.ledger.label')}</th><th>{t('clients.ledger.debit')}</th><th>{t('clients.ledger.credit')}</th>{isAdmin && <th />}</tr></thead>
                <tbody>
                  {ledger.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{fmtDate(l.at)}</td>
                      <td>{l.label}</td>
                      <td className="text-danger">{l.kind === 'debit' ? formatMoney(l.amount) : ''}</td>
                      <td className="text-success">{l.kind === 'credit' ? formatMoney(l.amount) : ''}</td>
                      {isAdmin && <td>{l.deletable && <button className="btn ghost small danger" onClick={() => void remove(l.id)}>{t('common.delete')}</button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
