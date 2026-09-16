import { useEffect, useState } from 'react';
import type { VehicleExpenseCategory, VehicleExpenseEntry } from '../lib/types';
import { EXPENSE_CATEGORY_LABEL } from '../lib/accounting';
import { api } from '../api/client';

interface Props {
  vehicleId: string;
  onCancel: () => void;
  onDone: (expense: VehicleExpenseEntry) => void;
}

const CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABEL) as VehicleExpenseCategory[];

export function ExpenseDialog({ vehicleId, onCancel, onDone }: Props) {
  const [category, setCategory] = useState<VehicleExpenseCategory>('fuel');
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
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
    try {
      const expense = await api.addExpense(vehicleId, {
        category,
        amount: Number(amount),
        at: new Date(`${at}T12:00:00`).toISOString(),
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onDone(expense);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
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
        <h2 id="expense-dialog-title">Nouvelle charge — {vehicleId}</h2>

        <div className="field-grid">
          <label className="field">
            <span>Catégorie</span>
            <select
              className="select"
              value={category}
              onChange={(e) => setCategory(e.target.value as VehicleExpenseCategory)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Montant (MRU)</span>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Date</span>
            <input type="date" value={at} onChange={(e) => setAt(e.target.value)} required />
          </label>

          <label className="field">
            <span>Référence</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="n° facture ou quittance"
            />
          </label>
        </div>

        <label className="field">
          <span>Observations</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer la charge'}
          </button>
        </div>
      </form>
    </div>
  );
}
