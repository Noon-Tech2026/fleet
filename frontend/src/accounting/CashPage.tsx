import { useCallback, useEffect, useState } from 'react';
import { openPrintReport, periodLabel } from '../lib/printReport';
import { useTranslation } from 'react-i18next';
import { api, type CashJournal } from '../api/client';
import { formatMoney } from '../lib/accounting';
import { useAuth } from '../auth/AuthContext';
import { PeriodFilter, type Period } from './PeriodFilter';
import DateInput from '../components/DateInput';
import { PayablesPanel } from './PayablesPanel';
import { useDataChanged } from '../lib/dataChanged';

/** Journal de caisse : entrees (debit), sorties (credit), solde cumule. */
export function CashPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const canWrite = can('supervisor');
  const isAdmin = can('admin');
  const [period, setPeriod] = useState<Period>({});
  const [journal, setJournal] = useState<CashJournal | null>(null);
  const [kind, setKind] = useState<'debit' | 'credit'>('debit');
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState(new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setJournal(await api.cashJournal(period)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [period]);
  useDataChanged(load);
  useEffect(() => { void load(); }, [load]);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(amount);
    if (!(v > 0) || label.trim().length < 2) return;
    setBusy(true);
    try {
      await api.addCashEntry({ kind, amount: v, at: `${at}T12:00:00`, label: label.trim() });
      setAmount(''); setLabel('');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function print() {
    if (!journal) return;
    const lang = i18n.language;
    await openPrintReport({
      title: t('cash.title'), period: periodLabel(period, lang, t('period.all')), lang, rtl: lang.startsWith('ar'),
      labels: { printedOn: t('print.printedOn'), period: t('print.period'), page: '', total: t('clients.ledger.total') },
      kpis: [
        { label: t('cash.debit'), value: formatMoney(journal.period.debit), tone: 'ok' },
        { label: t('cash.credit'), value: formatMoney(journal.period.credit), tone: 'danger' },
        { label: t('cash.balance'), value: formatMoney(journal.overall.balance), tone: journal.overall.balance >= 0 ? 'ok' : 'danger' },
      ],
      sections: [{ title: t('cash.title'), columns: [{ label: t('common.date'), width: '11%' }, { label: t('clients.ledger.label') }, { label: t('cash.source'), width: '11%' }, { label: t('cash.debit'), align: 'right', width: '13%' }, { label: t('cash.credit'), align: 'right', width: '13%' }, { label: t('clients.ledger.solde'), align: 'right', width: '13%' }],
        rows: rows.map((l) => [fmtDate(l.at), l.label, t(`cash.src.${l.source}`), l.kind === 'debit' ? formatMoney(l.amount) : '', l.kind === 'credit' ? formatMoney(l.amount) : '', formatMoney(l.balance)]),
        total: [t('clients.ledger.total'), '', '', formatMoney(journal.period.debit), formatMoney(journal.period.credit), formatMoney(journal.period.balance)], empty: t('cash.empty') }],
    });
  }
  async function remove(id: string) {
    if (window.confirm(t('cash.confirmDelete')) === false) return;
    await api.deleteCashEntry(id); await load();
  }

  const rows = journal ? (() => {
    const asc = [...journal.lines].sort((a, b) => a.at.localeCompare(b.at));
    let run = 0; const bal = new Map<string, number>();
    for (const l of asc) { run += l.kind === 'debit' ? l.amount : -l.amount; bal.set(l.id, run); }
    return journal.lines.map((l) => ({ ...l, balance: bal.get(l.id) ?? 0 }));
  })() : [];

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>{t('cash.title')}</h2>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
        <button className="btn ghost" onClick={() => void print()}>{t('common.print')}</button>
      </header>
      {error && <p className="banner err">{error}</p>}

      {journal && (
        <>
          <div className="fleet-summary compact">
            <div className="summary-cell ok"><b>{formatMoney(journal.period.debit)}</b><span>{t('cash.debit')}</span></div>
            <div className="summary-cell danger"><b>{formatMoney(journal.period.credit)}</b><span>{t('cash.credit')}</span></div>
            <div className={`summary-cell ${journal.overall.balance >= 0 ? 'ok' : 'warn'}`}><b>{formatMoney(journal.overall.balance)}</b><span>{t('cash.balance')}</span></div>
          </div>

          {canWrite && (
            <form className="ledger-pay" onSubmit={submit}>
              <label className="field inline"><span>{t('common.type')}</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as 'debit' | 'credit')}>
                  <option value="debit">{t('cash.debitEntry')}</option>
                  <option value="credit">{t('cash.creditEntry')}</option>
                </select>
              </label>
              <label className="field inline"><span>{t('common.amount')}</span><input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
              <label className="field inline"><span>{t('common.date')}</span><DateInput value={at} onChange={(e) => setAt(e.target.value)} /></label>
              <label className="field inline grow"><span>{t('clients.ledger.label')}</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('cash.labelPh')} required /></label>
              <button className="btn primary" disabled={busy || !(Number(amount) > 0) || label.trim().length < 2}>{t('clients.ledger.add')}</button>
            </form>
          )}

          <div className="table-wrap">
            {rows.length === 0 ? <p className="muted small">{t('cash.empty')}</p> : (
              <table className="table">
                <thead><tr><th>{t('common.date')}</th><th>{t('clients.ledger.label')}</th><th>{t('cash.source')}</th><th>{t('cash.debit')}</th><th>{t('cash.credit')}</th><th>{t('clients.ledger.solde')}</th>{isAdmin && <th />}</tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td>{fmtDate(l.at)}</td>
                      <td>{l.label}</td>
                      <td><span className="badge idle">{t(`cash.src.${l.source}`)}</span></td>
                      <td className="text-success">{l.kind === 'debit' ? formatMoney(l.amount) : ''}</td>
                      <td className="text-danger">{l.kind === 'credit' ? formatMoney(l.amount) : ''}</td>
                      <td className={l.balance >= 0 ? 'text-success' : 'text-danger'}><b>{formatMoney(l.balance)}</b></td>
                      {isAdmin && <td>{l.deletable && <button className="btn ghost small danger" onClick={() => void remove(l.id)}>{t('common.delete')}</button>}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="ledger-total">
                    <td colSpan={3}><b>{t('clients.ledger.total')}</b></td>
                    <td className="text-success"><b>{formatMoney(journal.period.debit)}</b></td>
                    <td className="text-danger"><b>{formatMoney(journal.period.credit)}</b></td>
                    <td className={journal.period.balance >= 0 ? 'text-success' : 'text-danger'}><b>{formatMoney(journal.period.balance)}</b></td>
                    {isAdmin && <td />}
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}
      <PayablesPanel canWrite={canWrite} onChanged={() => void load()} />
    </main>
  );
}
