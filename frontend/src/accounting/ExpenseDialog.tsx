import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VehicleExpenseCategory, VehicleExpenseEntry } from '../lib/types';
import { api } from '../api/client';

interface Props {
  vehicleId: string;
  /** Présent = modification d'une charge existante. */
  initial?: VehicleExpenseEntry;
  onCancel: () => void;
  onDone: (expense: VehicleExpenseEntry) => void;
}

const CATEGORIES: VehicleExpenseCategory[] = ['fuel', 'tires', 'insurance', 'toll', 'salary', 'fine', 'other'];

export function ExpenseDialog({ vehicleId, initial, onCancel, onDone }: Props) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<VehicleExpenseCategory>(initial?.category ?? 'fuel');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [at, setAt] = useState(() => (initial ? initial.at : new Date().toISOString()).slice(0, 10));
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
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
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{t(`history.expense.${c}`)}</option>
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
            <input type="date" value={at} onChange={(e) => setAt(e.target.value)} required />
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
