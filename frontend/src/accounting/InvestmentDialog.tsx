import { useEffect, useState } from 'react';
import type { VehicleInvestmentEntry, VehicleInvestmentKind } from '../lib/types';
import { INVESTMENT_KIND_LABEL } from '../lib/accounting';
import { api } from '../api/client';

interface Props {
  vehicleId: string;
  onCancel: () => void;
  onDone: (investment: VehicleInvestmentEntry) => void;
}

const KINDS = Object.keys(INVESTMENT_KIND_LABEL) as VehicleInvestmentKind[];

export function InvestmentDialog({ vehicleId, onCancel, onDone }: Props) {
  const [kind, setKind] = useState<VehicleInvestmentKind>('purchase');
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
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
      const investment = await api.addInvestment(vehicleId, {
        kind,
        amount: Number(amount),
        at: new Date(`${at}T12:00:00`).toISOString(),
        description: description.trim() || undefined,
      });
      onDone(investment);
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
        aria-labelledby="investment-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="investment-dialog-title">Nouvel investissement — {vehicleId}</h2>

        <p className="modal-note">
          Comptabilisé tel quel, sans amortissement : le montant s'ajoute en une fois au total du
          véhicule.
        </p>

        <div className="field-grid">
          <label className="field">
            <span>Type</span>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as VehicleInvestmentKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {INVESTMENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Montant (DH)</span>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
        </div>

        <label className="field">
          <span>Date</span>
          <input type="date" value={at} onChange={(e) => setAt(e.target.value)} required />
        </label>

        <label className="field">
          <span>Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="ex. achat camion C-06"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Enregistrement…' : "Enregistrer l'investissement"}
          </button>
        </div>
      </form>
    </div>
  );
}
