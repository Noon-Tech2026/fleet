import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type VersementRecord } from '../api/client';
import { formatMoney } from '../lib/accounting';
import { useAuth } from '../auth/AuthContext';
import type { Period } from './PeriodFilter';

interface Props { period: Period; onChanged: () => void; showTotal?: boolean }

/** Versements (retraits des associes) : saisie et liste sur la periode. */
export function VersementsPanel({ period, onChanged, showTotal = false }: Props) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const canWrite = can('supervisor');
  const isAdmin = can('admin');
  const [rows, setRows] = useState<VersementRecord[]>([]);
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.versements(period).then(setRows).catch(() => setRows([])), [period]);
  useEffect(() => { void load(); }, [load]);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(amount);
    if (!(v > 0) || label.trim().length < 2) return;
    setBusy(true);
    try { await api.addVersement({ amount: v, at: `${at}T12:00:00`, label: label.trim() }); setAmount(''); setLabel(''); await load(); onChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (window.confirm(t('versements.confirmDelete')) === false) return;
    await api.deleteVersement(id); await load(); onChanged();
  }

  return (
    <section className="versements">
      {!showTotal && <h3>{t('versements.title')}</h3>}
      {showTotal && <div className="fleet-summary compact"><div className="summary-cell warn"><b>{formatMoney(rows.reduce((a, v) => a + v.amount, 0))}</b><span>{t('overview.versements')}</span></div></div>}
      {error && <p className="banner err">{error}</p>}
      {canWrite && (
        <form className="ledger-pay" onSubmit={submit}>
          <label className="field inline"><span>{t('common.amount')}</span><input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label className="field inline"><span>{t('common.date')}</span><input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></label>
          <label className="field inline grow"><span>{t('versements.label')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('versements.labelPh')} required /></label>
          <button className="btn primary" disabled={busy || !(Number(amount) > 0) || label.trim().length < 2}>{t('versements.add')}</button>
        </form>
      )}
      {rows.length === 0 ? <p className="muted small">{t('versements.empty')}</p> : (
        <table className="table">
          <thead><tr><th>{t('common.date')}</th><th>{t('versements.label')}</th><th>{t('common.amount')}</th>{isAdmin && <th />}</tr></thead>
          <tbody>{rows.map((v) => (
            <tr key={v.id}><td>{fmtDate(v.at)}</td><td>{v.label}</td><td className="text-danger">{formatMoney(v.amount)}</td>{isAdmin && <td><button className="btn ghost small danger" onClick={() => void remove(v.id)}>{t('common.delete')}</button></td>}</tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}
