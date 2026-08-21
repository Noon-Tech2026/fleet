import { useEffect, useState } from 'react';
import type { MaintenancePlanState } from '../lib/types';
import { MAINTENANCE_STATUS_LABEL, MAINTENANCE_STATUS_TONE, deadlineText } from '../lib/maintenance';
import { api } from '../api/client';

const SHOWN = 4;

/**
 * Les échéances les plus proches du camion sélectionné.
 *
 * Chargées une fois par camion et non à chaque trame : la fiche se
 * redessine plusieurs fois par minute sous le flux SSE, alors qu'une
 * échéance d'entretien bouge de quelques kilomètres par heure.
 */
export function MaintenancePanel({ vehicleId }: { vehicleId: string }) {
  const [plans, setPlans] = useState<MaintenancePlanState[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlans(null);
    setFailed(false);

    api
      .vehicleMaintenance(vehicleId)
      .then((list) => {
        if (!cancelled) setPlans(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  if (failed) return <p className="hint">Échéances d'entretien indisponibles.</p>;
  if (!plans) return <p className="hint">Chargement…</p>;
  if (plans.length === 0) return <p className="hint">Aucune échéance suivie sur ce camion.</p>;

  const due = plans.filter((p) => p.status === 'overdue' || p.status === 'soon').length;

  return (
    <div className="maint-list">
      {plans.slice(0, SHOWN).map((plan) => {
        const tone = MAINTENANCE_STATUS_TONE[plan.status];
        return (
          <div key={plan.id} className={`maint-row ${tone}`}>
            <div>
              <strong>{plan.label}</strong>
              <span>{deadlineText(plan)}</span>
            </div>
            <span className={`badge ${tone}`}>{MAINTENANCE_STATUS_LABEL[plan.status]}</span>
          </div>
        );
      })}

      {plans.length > SHOWN && (
        <p className="hint">
          {plans.length - SHOWN} autre(s) opération(s) suivie(s)
          {due > 0 ? ` · ${due} échéance(s) à traiter` : ''} — voir l'onglet Entretien.
        </p>
      )}
    </div>
  );
}
