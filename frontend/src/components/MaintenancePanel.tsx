import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaintenancePlanState } from '../lib/types';
import { MAINTENANCE_STATUS_TONE, deadlineText } from '../lib/maintenance';
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
  const { t, i18n } = useTranslation();
  const [plans, setPlans] = useState<MaintenancePlanState[] | null>(null);
  const [failed, setFailed] = useState(false);
  const tr = (key: string, vars?: Record<string, unknown>) => t(`maintenance.${key}`, vars);

  useEffect(() => {
    let cancelled = false;
    setPlans(null);
    setFailed(false);

    api
      .vehicleMaintenance(vehicleId)
      .then((list) => {
        if (cancelled === false) setPlans(list);
      })
      .catch(() => {
        if (cancelled === false) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  if (failed) return <p className="hint">{t('maintenance.unavailable')}</p>;
  if (plans === null) return <p className="hint">{t('maintenance.loading')}</p>;
  if (plans.length === 0) return <p className="hint">{t('maintenance.empty')}</p>;

  const due = plans.filter((p) => p.status === 'overdue' || p.status === 'soon').length;

  return (
    <div className="maint-list">
      {plans.slice(0, SHOWN).map((plan) => {
        const tone = MAINTENANCE_STATUS_TONE[plan.status];
        return (
          <div key={plan.id} className={`maint-row ${tone}`}>
            <div>
              <strong>{plan.label}</strong>
              <span>{deadlineText(plan, tr, i18n.language)}</span>
            </div>
            <span className={`badge ${tone}`}>{t(`maintenance.status.${plan.status}`)}</span>
          </div>
        );
      })}

      {plans.length > SHOWN && (
        <p className="hint">
          {t('maintenance.more', { n: plans.length - SHOWN })}
          {due > 0 ? t('maintenance.due', { n: due }) : ''}
          {t('maintenance.seeTab')}
        </p>
      )}
    </div>
  );
}
