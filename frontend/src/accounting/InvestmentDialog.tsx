import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VehicleInvestmentEntry, VehicleInvestmentKind } from '../lib/types';
import { api } from '../api/client';

interface Props {
  vehicleId: string;
  /** Présent = modification d'un investissement existant. */
  initial?: VehicleInvestmentEntry;
  onCancel: () => void;
  onDone: (investment: VehicleInvestmentEntry) => void;
}

const KINDS: VehicleInvestmentKind[] = ['purchase', 'equipment', 'overhaul', 'other'];

export function InvestmentDialog({ vehicleId, initial, onCancel, onDone }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<VehicleInvestmentKind>(initial?.kind ?? 'purchase');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [at, setAt] = useState(() => (initial ? initial.at : new Date().toISOString()).slice(0, 10));
  const [description, setDescription] = useState(initial?.description ?? '');
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
      kind,
      amount: Number(amount),
      at: new Date(`${at}T12:00:00`).toISOString(),
      description: description.trim() || undefined,
    };
    try {
      const investment = initial
        ? await api.updateInvestment(initial.id, payload)
        : await api.addInvestment(vehicleId, payload);
      onDone(investment);
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
        aria-labelledby="investment-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="investment-dialog-title">{t(initial ? 'dialog.investment.titleEdit' : 'dialog.investment.titleNew', { id: vehicleId })}</h2>

        <div className="field-grid">
          <label className="field">
            <span>{t('dialog.investment.kind')}</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as VehicleInvestmentKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>{t(`history.investment.${k}`)}</option>
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
            <span>{t('dialog.investment.description')}</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {t('dialog.common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? t('dialog.common.saving') : t('dialog.investment.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
