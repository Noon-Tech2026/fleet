import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type PayableItem } from '../api/client';
import { formatMoney } from '../lib/accounting';
import { useExpenseCategories } from '../lib/useExpenseCategories';
import DateInput from '../components/DateInput';
import { useDataChanged } from '../lib/dataChanged';

interface Props {
  canWrite: boolean;
  /** Appele apres un reglement (pour recharger la caisse). */
  onChanged: () => void;
}

/** Charges a credit non reglees ; « Marquer payee » les fait sortir de la caisse a la date choisie. */
export function PayablesPanel({ canWrite, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const { label } = useExpenseCategories();
  const [items, setItems] = useState<PayableItem[] | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems((await api.payables()).items); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useDataChanged(load);
  useEffect(() => { void load(); }, [load]);

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const total = (items ?? []).reduce((a, x) => a + x.amount, 0);

  async function pay(id: string) {
    if (window.confirm(t('payables.confirmPay', 'Confirmer le paiement ? La charge sortira de la caisse à la date choisie.')) === false) return;
    setBusy(id);
    try { await api.payExpense(id, `${payDate}T12:00:00`); await load(); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  return (
    <section className="payables" style={{ marginTop: 28 }}>
      <h3>{t('payables.title', 'Charges à payer')}</h3>
      <div className="versements-head">
        <div className="fleet-summary compact">
          <div className="summary-cell warn">
            <b>{formatMoney(total)}</b>
            <span>{t('payables.total', 'Total dû')} · {items?.length ?? 0}</span>
          </div>
        </div>
        {canWrite && (items?.length ?? 0) > 0 && (
          <label className="field inline">
            <span>{t('payables.payDate', 'Date de paiement')}</span>
            <DateInput value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </label>
        )}
      </div>
      {error && <p className="banner err">{error}</p>}
      {!items ? null : items.length === 0 ? (
        <p className="muted small">{t('payables.empty', 'Aucune charge à crédit en attente de paiement.')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('payables.vehicle', 'Camion')}</th>
                <th>{t('common.category')}</th>
                <th>{t('expensePay.supplier', 'Fournisseur')}</th>
                <th>{t('common.reference')}</th>
                <th>{t('common.amount')}</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id}>
                  <td>{fmtDate(x.at)}</td>
                  <td>{x.vehicleId}</td>
                  <td>{label(x.category)}</td>
                  <td>{x.supplier ?? '—'}</td>
                  <td className="cell-muted">{x.reference ?? '—'}</td>
                  <td className="text-danger"><b>{formatMoney(x.amount)}</b></td>
                  {canWrite && (
                    <td className="cell-actions">
                      <button className="btn primary small" disabled={busy === x.id} onClick={() => void pay(x.id)}>
                        {t('payables.pay', 'Marquer payée')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
