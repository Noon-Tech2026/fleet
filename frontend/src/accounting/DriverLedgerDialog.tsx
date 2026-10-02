import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DriverRecord } from '../lib/types';
import { api, type DriverLedger } from '../api/client';
import { formatMoney } from '../lib/accounting';
import { useAuth } from '../auth/AuthContext';
import { PeriodFilter, type Period } from './PeriodFilter';

interface Props { driver: DriverRecord; onClose: () => void }

/** Releve d'un chauffeur : primes par voyage, paiements, reste du. */
export function DriverLedgerDialog({ driver, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const canPay = can('supervisor');
  const isAdmin = can('admin');
  const [period, setPeriod] = useState<Period>({});
  const [ledger, setLedger] = useState<DriverLedger | null>(null);
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payKind, setPayKind] = useState<'advance' | 'other' | 'fee'>('advance');
  const [salMonth, setSalMonth] = useState(new Date().toISOString().slice(0, 7));
  const [salAmount, setSalAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setLedger(await api.driverLedger(driver.id, period)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [driver.id, period]);
  useEffect(() => { void load(); }, [load]);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(amount);
    if (!(v > 0)) return;
    setBusy(true);
    try {
      await api.addDriverPayment(driver.id, { amount: v, kind: payKind, at: `${at}T12:00:00`, notes: notes.trim() || undefined });
      setAmount(''); setNotes('');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  const selectedTotal = ledger ? ledger.fees.filter((f) => selected.has(f.expenseId)).reduce((a, f) => a + f.amount, 0) : 0;
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  async function paySelection() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await api.addDriverPayment(driver.id, { feeIds: [...selected], at: `${at}T12:00:00` });
      setSelected(new Set());
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function declareSalary(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.declareDriverSalary(driver.id, { month: salMonth, amount: salAmount ? Number(salAmount) : undefined });
      setSalAmount(''); await load();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function paySalary(id: string) {
    setBusy(true);
    try { await api.addDriverPayment(driver.id, { salaryId: id, at: `${at}T12:00:00` }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function removeSalary(id: string) {
    if (window.confirm(t('drivers.ledger.confirmDeleteSalary')) === false) return;
    try { await api.deleteDriverSalary(id); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function remove(id: string) {
    if (window.confirm(t('drivers.ledger.confirmDelete')) === false) return;
    await api.deleteDriverPayment(id); await load();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ledger-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>{t('drivers.ledger.title')} — {driver.fullName}</h2>
            <p>{t('drivers.tripFee')} : {formatMoney(driver.tripFee)} · {t('drivers.salary')} : {formatMoney(driver.monthlySalary ?? 0)}</p>
          </div>
          <button className="btn ghost" onClick={onClose}>{t('track.close')}</button>
        </header>

        <PeriodFilter value={period} onChange={setPeriod} />
        {error && <p className="banner err">{error}</p>}

        {ledger && (
          <>
            <div className="fleet-summary compact">
              <div className="summary-cell ok"><b>{formatMoney(ledger.period.fees)}</b><span>{t('drivers.ledger.fees')} · {t('drivers.feesCount', { n: ledger.period.feesCount })}</span></div>
              <div className="summary-cell"><b>{formatMoney(ledger.period.salaries)}</b><span>{t('drivers.ledger.salaries')}</span></div>
              <div className="summary-cell"><b>{formatMoney(ledger.period.paid)}</b><span>{t('drivers.ledger.paid')}</span></div>
              <div className={`summary-cell ${ledger.overall.balance > 0 ? 'warn' : ledger.overall.balance < 0 ? 'danger' : 'ok'}`}><b>{formatMoney(ledger.overall.balance)}</b><span>{ledger.overall.balance < 0 ? t('drivers.ledger.driverOwes') : t('drivers.ledger.balance')}</span></div>
            </div>

            {canPay && (
              <form className="ledger-pay" onSubmit={pay}>
                <label className="field inline"><span>{t('common.type')}</span>
                  <select value={payKind} onChange={(e) => setPayKind(e.target.value as 'advance' | 'other' | 'fee')}>
                    <option value="advance">{t('drivers.ledger.kind.advance')}</option>
                    <option value="fee">{t('drivers.ledger.kind.fee')}</option>
                    <option value="other">{t('drivers.ledger.kind.other')}</option>
                  </select>
                </label>
                <label className="field inline"><span>{t('drivers.ledger.amount')}</span><input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
                <label className="field inline"><span>{t('period.from')}</span><input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></label>
                <label className="field inline grow"><span>{t('drivers.ledger.notes')}</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('drivers.ledger.notesPh')} /></label>
                <button className="btn primary" disabled={busy || !(Number(amount) > 0)}>{t('drivers.ledger.pay')}</button>
              </form>
            )}

            <section className="ledger-salaries">
              <h3>{t('drivers.ledger.salaries')}</h3>
              {canPay && (
                <form className="ledger-pay" onSubmit={declareSalary}>
                  <label className="field inline"><span>{t('drivers.ledger.month')}</span><input type="month" value={salMonth} onChange={(e) => setSalMonth(e.target.value)} required /></label>
                  <label className="field inline"><span>{t('common.amount')}</span><input type="number" min="1" step="1" value={salAmount} placeholder={String(driver.monthlySalary ?? 0)} onChange={(e) => setSalAmount(e.target.value)} /></label>
                  <button className="btn primary" disabled={busy}>{t('drivers.ledger.declareSalary')}</button>
                </form>
              )}
              {ledger.salaries.length === 0 ? <p className="muted small">{t('drivers.ledger.noSalaries')}</p> : (
                <table className="table small"><thead><tr><th>{t('drivers.ledger.month')}</th><th>{t('common.amount')}</th><th /><th /></tr></thead>
                  <tbody>{ledger.salaries.map((sal) => (
                    <tr key={sal.id} className={sal.paid ? 'is-off' : ''}>
                      <td>{sal.month}</td><td>{formatMoney(sal.amount)}</td>
                      <td>{sal.paid ? <span className="badge ok">{t('drivers.ledger.paidBadge')}</span> : <span className="badge warn">{t('drivers.ledger.dueBadge')}</span>}</td>
                      <td className="cell-actions">
                        {canPay && !sal.paid && <button className="btn primary small" disabled={busy} onClick={() => void paySalary(sal.id)}>{t('drivers.ledger.paySalary')}</button>}
                        {isAdmin && !sal.paid && <button className="btn ghost small danger" onClick={() => void removeSalary(sal.id)}>{t('common.delete')}</button>}
                      </td>
                    </tr>
                  ))}</tbody></table>
              )}
            </section>

            <div className="ledger-grid">
              <section>
                <h3>{t('drivers.ledger.fees')}</h3>
                {ledger.fees.length === 0 ? <p className="muted small">{t('drivers.ledger.noFees')}</p> : (
                  <>
                  {canPay && selected.size > 0 && (
                    <div className="ledger-select-bar">
                      <span>{t('drivers.ledger.selected', { n: selected.size })} · <b>{formatMoney(selectedTotal)}</b></span>
                      <button className="btn primary small" disabled={busy} onClick={() => void paySelection()}>{t('drivers.ledger.paySelection')}</button>
                    </div>
                  )}
                  <table className="table small"><thead><tr>{canPay && <th />}<th>{t('common.date')}</th><th>{t('common.truck')}</th><th>{t('drivers.ledger.containers')}</th><th>{t('common.amount')}</th><th /></tr></thead>
                    <tbody>{ledger.fees.map((f) => (
                      <tr key={f.expenseId} className={f.paid ? 'is-off' : ''}>
                        {canPay && <td>{!f.paid && <input type="checkbox" checked={selected.has(f.expenseId)} onChange={() => toggle(f.expenseId)} />}</td>}
                        <td>{fmtDate(f.at)}</td><td>{f.vehicleId}</td>
                        <td className="cell-muted">{f.containers || '—'}{f.origin || f.destination ? ` · ${f.origin ?? '—'} → ${f.destination ?? '—'}` : ''}</td>
                        <td>{formatMoney(f.amount)}</td>
                        <td>{f.paid ? <span className="badge ok">{t('drivers.ledger.paidBadge')}</span> : <span className="badge warn">{t('drivers.ledger.dueBadge')}</span>}</td>
                      </tr>
                    ))}</tbody></table>
                  </>
                )}
              </section>
              <section>
                <h3>{t('drivers.ledger.payments')}</h3>
                {ledger.payments.length === 0 ? <p className="muted small">{t('drivers.ledger.noPayments')}</p> : (
                  <table className="table small"><thead><tr><th>{t('common.date')}</th><th>{t('common.amount')}</th><th>{t('drivers.ledger.notes')}</th>{isAdmin && <th />}</tr></thead>
                    <tbody>{ledger.payments.map((p) => (
                      <tr key={p.id}><td>{fmtDate(p.at)}</td><td>{formatMoney(p.amount)}</td><td className="cell-muted"><span className="badge idle">{t(`drivers.ledger.kind.${p.kind}`)}</span> {p.notes ?? ''}</td>{isAdmin && <td><button className="btn ghost small danger" onClick={() => void remove(p.id)}>{t('common.delete')}</button></td>}</tr>
                    ))}</tbody></table>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
