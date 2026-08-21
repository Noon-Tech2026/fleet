import { useEffect, useState } from 'react';
import type { MaintenancePlanState } from '../lib/types';
import { api } from '../api/client';

interface Props {
  plan: MaintenancePlanState;
  onCancel: () => void;
  onDone: (updated: MaintenancePlanState) => void;
}

/**
 * Réglage de la périodicité d'une opération, camion par camion.
 *
 * Réservé au superviseur côté serveur : allonger un intervalle de vidange
 * sur tout un parc se voit dans les factures d'huile bien avant de se voir
 * dans l'état des moteurs.
 */
export function PlanDialog({ plan, onCancel, onDone }: Props) {
  const [intervalKm, setIntervalKm] = useState(() => String(plan.intervalKm ?? ''));
  const [intervalHours, setIntervalHours] = useState(() => String(plan.intervalHours ?? ''));
  const [intervalDays, setIntervalDays] = useState(() => String(plan.intervalDays ?? ''));
  const [notes, setNotes] = useState(plan.notes ?? '');
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

    const km = toNumber(intervalKm);
    const hours = toNumber(intervalHours);
    const days = toNumber(intervalDays);

    if (km === undefined && hours === undefined && days === undefined) {
      setError('Définissez au moins une périodicité : kilomètres, heures ou jours.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const updated = await api.saveMaintenancePlan(plan.vehicleId, plan.kind, {
        intervalKm: km,
        intervalHours: hours,
        intervalDays: days,
        notes: notes.trim() || undefined,
      });
      onDone(updated);
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
        aria-labelledby="plan-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="plan-dialog-title">
          Périodicité — {plan.label} · {plan.vehicleId}
        </h2>

        <p className="modal-note">
          Les trois axes se cumulent : l'échéance tombe dès que le premier est atteint. Laissez un
          champ vide pour ne pas suivre cet axe.
        </p>

        <div className="field-grid">
          <label className="field">
            <span>Tous les (km)</span>
            <input
              type="number"
              min={100}
              max={500000}
              value={intervalKm}
              onChange={(e) => setIntervalKm(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Heures moteur</span>
            <input
              type="number"
              min={10}
              max={50000}
              value={intervalHours}
              onChange={(e) => setIntervalHours(e.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span>Ou tous les (jours)</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Note d'atelier</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ex. intervalle raccourci — service carrière"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

function toNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round(value) : undefined;
}
