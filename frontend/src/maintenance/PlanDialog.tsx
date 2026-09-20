import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaintenancePlanState } from '../lib/types';
import { api } from '../api/client';

interface Props {
  /** Plan existant, ou brouillon (vehicleId + kind + label) pour une nouvelle echeance. */
  plan: Pick<MaintenancePlanState, 'vehicleId' | 'kind' | 'label'> & Partial<MaintenancePlanState>;
  onCancel: () => void;
  onDone: (updated: MaintenancePlanState) => void;
}

/**
 * Periodicite et rappel d'une operation, camion par camion.
 * Reserve au superviseur cote serveur.
 */
export function PlanDialog({ plan, onCancel, onDone }: Props) {
  const { t } = useTranslation();
  const [intervalKm, setIntervalKm] = useState(() => String(plan.intervalKm ?? ''));
  const [intervalHours, setIntervalHours] = useState(() => String(plan.intervalHours ?? ''));
  const [intervalDays, setIntervalDays] = useState(() => String(plan.intervalDays ?? ''));
  const [remindKm, setRemindKm] = useState(() => String(plan.remindKm ?? ''));
  const [remindHours, setRemindHours] = useState(() => String(plan.remindHours ?? ''));
  const [remindDays, setRemindDays] = useState(() => String(plan.remindDays ?? ''));
  const [notes, setNotes] = useState(plan.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && busy === false) onCancel();
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
      setError(t('maintenance.plan.needOne'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.saveMaintenancePlan(plan.vehicleId, plan.kind, {
        intervalKm: km,
        intervalHours: hours,
        intervalDays: days,
        remindKm: toNumber(remindKm),
        remindHours: toNumber(remindHours),
        remindDays: toNumber(remindDays),
        notes: notes.trim() || undefined,
      });
      onDone(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('maintenance.plan.error'));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="plan-dialog-title">
          {t('maintenance.plan.title')} — {plan.label} · {plan.vehicleId}
        </h2>
        <p className="modal-note">{t('maintenance.plan.note')}</p>

        <h4 className="form-section">{t('maintenance.plan.interval')}</h4>
        <div className="field-grid">
          <label className="field">
            <span>{t('maintenance.plan.everyKm')}</span>
            <input type="number" min={100} max={500000} value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('maintenance.plan.everyHours')}</span>
            <input type="number" min={10} max={50000} value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('maintenance.plan.everyDays')}</span>
            <input type="number" min={1} max={3650} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
          </label>
        </div>

        <h4 className="form-section">{t('maintenance.plan.remind')}</h4>
        <p className="hint">{t('maintenance.plan.remindNote')}</p>
        <div className="field-grid">
          <label className="field">
            <span>{t('maintenance.plan.remindKm')}</span>
            <input type="number" min={1} max={100000} value={remindKm} onChange={(e) => setRemindKm(e.target.value)} placeholder="500" />
          </label>
          <label className="field">
            <span>{t('maintenance.plan.remindHours')}</span>
            <input type="number" min={1} max={10000} value={remindHours} onChange={(e) => setRemindHours(e.target.value)} placeholder="20" />
          </label>
          <label className="field">
            <span>{t('maintenance.plan.remindDays')}</span>
            <input type="number" min={1} max={365} value={remindDays} onChange={(e) => setRemindDays(e.target.value)} placeholder="7" />
          </label>
        </div>

        <label className="field">
          <span>{t('maintenance.plan.notes')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('maintenance.plan.notesPlaceholder')} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>{t('maintenance.plan.cancel')}</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? t('maintenance.plan.saving') : t('maintenance.plan.save')}</button>
        </div>
      </form>
    </div>
  );
}

function toNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round(value) : undefined;
}
