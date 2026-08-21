import type { MaintenancePlanState, MaintenanceStatus } from './types';

export const MAINTENANCE_STATUS_LABEL: Record<MaintenanceStatus, string> = {
  unknown: 'Jamais effectué',
  ok: 'À jour',
  soon: 'À prévoir',
  overdue: 'Dépassé',
};

/** Réutilise les tons de badge du reste du tableau de bord. */
export const MAINTENANCE_STATUS_TONE: Record<MaintenanceStatus, 'ok' | 'warn' | 'danger' | 'idle'> =
  {
    unknown: 'idle',
    ok: 'ok',
    soon: 'warn',
    overdue: 'danger',
  };

/**
 * Échéance la plus proche des trois axes, en une phrase.
 *
 * Le serveur produit la même formule pour ses messages d'alerte
 * (`describeDeadline`). La duplication est assumée : l'un écrit dans un
 * fil d'événements, l'autre dans un tableau, et les deux évolueront
 * séparément.
 */
export function deadlineText(state: MaintenancePlanState): string {
  const axes = deadlineAxes(state);
  if (axes.length === 0) return 'Aucun relevé de référence';
  return axes[0].text;
}

/** Tous les axes suivis, du plus urgent au plus lointain. */
export function deadlineAxes(state: MaintenancePlanState): { ratio: number; text: string }[] {
  const axes: { ratio: number; text: string }[] = [];

  if (state.remainingKm !== null && state.intervalKm) {
    axes.push({
      ratio: state.remainingKm / state.intervalKm,
      text:
        state.remainingKm >= 0
          ? `${format(state.remainingKm)} km restants`
          : `${format(-state.remainingKm)} km de dépassement`,
    });
  }

  if (state.remainingHours !== null && state.intervalHours) {
    axes.push({
      ratio: state.remainingHours / state.intervalHours,
      text:
        state.remainingHours >= 0
          ? `${format(state.remainingHours)} h restantes`
          : `${format(-state.remainingHours)} h de dépassement`,
    });
  }

  if (state.remainingDays !== null && state.intervalDays) {
    axes.push({
      ratio: state.remainingDays / state.intervalDays,
      text:
        state.remainingDays >= 0
          ? `${state.remainingDays} j restants`
          : `${-state.remainingDays} j de retard`,
    });
  }

  return axes.sort((a, b) => a.ratio - b.ratio);
}

/** Périodicité, telle qu'elle se lit sur un carnet d'atelier. */
export function intervalText(state: MaintenancePlanState): string {
  const parts: string[] = [];
  if (state.intervalKm) parts.push(`${format(state.intervalKm)} km`);
  if (state.intervalHours) parts.push(`${format(state.intervalHours)} h`);
  if (state.intervalDays) parts.push(`${state.intervalDays} j`);
  return parts.join(' · ') || '—';
}

export function lastServiceText(state: MaintenancePlanState): string {
  if (!state.lastServiceAt && state.lastServiceOdometer === null) return 'Jamais';

  const parts: string[] = [];
  if (state.lastServiceAt) {
    parts.push(new Date(state.lastServiceAt).toLocaleDateString('fr-FR'));
  }
  if (state.lastServiceOdometer !== null) {
    parts.push(`${format(state.lastServiceOdometer)} km`);
  }
  return parts.join(' · ');
}

function format(value: number): string {
  return Math.round(value).toLocaleString('fr-FR');
}
