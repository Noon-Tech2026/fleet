import { useEffect, useState } from 'react';
import { useExpenseCategories } from '../lib/useExpenseCategories';
import { useTranslation } from 'react-i18next';
import type { VehicleExpenseCategory, VehicleExpenseEntry } from '../lib/types';
import { api } from '../api/client';
import DateInput from '../components/DateInput';

interface Props {
  vehicleId: string;
  /** Présent = modification d'une charge existante. */
  initial?: VehicleExpenseEntry;
  onCancel: () => void;
  onDone: (expense: VehicleExpenseEntry) => void;
}


export function ExpenseDialog({ vehicleId, initial, onCancel, onDone }: Props) {
  const { categories, label } = useExpenseCategories();
  const { t } = useTranslation();
  const [category, setCategory] = useState<VehicleExpenseCategory>(initial?.category ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [at, setAt] = useState(() => (initial ? initial.at : new Date().toISOString()).slice(0, 10));
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [payment, setPayment] = useState<'cash' | 'credit' | 'legacy'>(initial ? (initial.payment ?? 'legacy') : 'cash');
  const [supplier, setSupplier] = useState(initial?.supplier ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      category,
      amount: Number(amount),
      at: new Date(`${at}T12:00:00`).toISOString(),
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
      ...(payment !== 'legacy' ? { payment } : {}),
      supplier: supplier.trim() || undefined,
    };
    try {
      const expense = initial
        ? await api.updateExpense(initial.id, payload)
        : await api.addExpense(vehicleId, payload);
      onDone(expense);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dialog.common.error'));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="expense-dialog-title">{t(initial ? 'dialog.expense.titleEdit' : 'dialog.expense.titleNew', { id: vehicleId })}</h2>

        <div className="field-grid">
          <label className="field">
            <span>{t('dialog.expense.category')}</span>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value as VehicleExpenseCategory)}>
              {category === '' && <option value="">—</option>}
              {categories.filter((c) => c.id !== 'driver').map((c) => (
                <option key={c.id} value={c.id}>{label(c.id)}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>{t('dialog.common.amount')}</span>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>{t('dialog.common.date')}</span>
            <DateInput value={at} onChange={(e) => setAt(e.target.value)} required />
          </label>

          <label className="field">
            <span>{t('dialog.expense.reference')}</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('dialog.expense.referencePlaceholder')} />
          </label>
        </div>

        <label className="field">
          <span>{t('dialog.expense.notes')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>{t('expensePay.label', 'Règlement')}</span>
            <select className="select" value={payment} onChange={(e) => setPayment(e.target.value as 'cash' | 'credit' | 'legacy')}>
              {payment === 'legacy' && <option value="legacy">{t('expensePay.legacy', 'Historique (hors caisse)')}</option>}
              <option value="cash">{t('expensePay.cash', 'Payée comptant (sort de la caisse)')}</option>
              <option value="credit">{t('expensePay.credit', 'À crédit (à payer plus tard)')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('expensePay.supplier', 'Fournisseur')}</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={t('expensePay.supplierPh', 'ex. station, garage…')} />
          </label>
        </div>
        {initial?.payment === 'credit' && initial.paidAt && (
          <p className="muted small">{t('expensePay.paidOn', 'Dette réglée le')} {new Date(initial.paidAt).toLocaleDateString()}</p>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {t('dialog.common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? t('dialog.common.saving') : t('dialog.expense.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
