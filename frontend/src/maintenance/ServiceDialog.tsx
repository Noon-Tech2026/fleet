import { useEffect, useState } from 'react';
import type { MaintenancePlanState, VehicleState } from '../lib/types';
import { intervalText, lastServiceText } from '../lib/maintenance';
import { api } from '../api/client';

interface Props {
  plan: MaintenancePlanState;
  vehicle: VehicleState | undefined;
  onCancel: () => void;
  onDone: (updated: MaintenancePlanState) => void;
}

/**
 * Consignation d'un entretien réalisé.
 *
 * Les compteurs sont préremplis avec la dernière trame reçue mais restent
 * modifiables : une vidange faite hier se saisit aujourd'hui, et c'est le
 * kilométrage du jour de l'intervention qui fait foi.
 */
export function ServiceDialog({ plan, vehicle, onCancel, onDone }: Props) {
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [odometer, setOdometer] = useState(() => String(vehicle?.odometer ?? ''));
  const [engineHours, setEngineHours] = useState(() => String(vehicle?.engineHours ?? ''));
  const [partReference, setPartReference] = useState('');
  const [cost, setCost] = useState('');
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
      const updated = await api.recordService(plan.vehicleId, plan.kind, {
        at: new Date(`${at}T12:00:00`).toISOString(),
        odometer: toNumber(odometer),
        engineHours: toNumber(engineHours),
        partReference: partReference.trim() || undefined,
        cost: toNumber(cost),
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
        aria-labelledby="service-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="service-dialog-title">
          {plan.label} — {plan.vehicleId}
        </h2>

        <dl className="conditions">
          <div>
            <dt>Périodicité</dt>
            <dd>{intervalText(plan)}</dd>
          </div>
          <div>
            <dt>Dernier entretien</dt>
            <dd>{lastServiceText(plan)}</dd>
          </div>
        </dl>

        <label className="field">
          <span>Date de l'intervention</span>
          <input type="date" value={at} onChange={(e) => setAt(e.target.value)} required />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>Compteur (km)</span>
            <input
              type="number"
              min={0}
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              placeholder="relevé au tableau de bord"
            />
          </label>

          <label className="field">
            <span>Heures moteur</span>
            <input
              type="number"
              min={0}
              value={engineHours}
              onChange={(e) => setEngineHours(e.target.value)}
            />
          </label>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Référence de la pièce</span>
            <input
              value={partReference}
              onChange={(e) => setPartReference(e.target.value)}
              placeholder="ex. LF9009, 15 L 15W40"
            />
          </label>

          <label className="field">
            <span>Coût (DH)</span>
            <input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Observations</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ex. cartouche colmatée avant terme"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Enregistrement…' : "Enregistrer l'entretien"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Un champ vide n'est pas un zéro : il laisse le serveur retenir le
 *  dernier relevé connu. */
function toNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}
