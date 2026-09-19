import type { MaintenancePlanState, MaintenanceStatus } from './types';

/** Traducteur optionnel : (cle sous `maintenance.`, variables) → texte. Sans lui, francais. */
export type Tr = (key: string, vars?: Record<string, unknown>) => string;

const FR_TEXT: Record<string, string> = {
  kmLeft: '{{n}} km restants',
  kmOver: '{{n}} km de dépassement',
  hLeft: '{{n}} h restantes',
  hOver: '{{n}} h de dépassement',
  dLeft: '{{n}} j restants',
  dOver: '{{n}} j de retard',
  none: 'Aucun relevé de référence',
};
const frTr: Tr = (key, vars) => (FR_TEXT[key] ?? key).replace('{{n}}', String(vars?.n ?? ''));

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
export function deadlineText(state: MaintenancePlanState, tr: Tr = frTr, locale = 'fr-FR'): string {
  const axes = deadlineAxes(state, tr, locale);
  if (axes.length === 0) return tr('none');
  return axes[0].text;
}

/** Tous les axes suivis, du plus urgent au plus lointain. */
export function deadlineAxes(state: MaintenancePlanState, tr: Tr = frTr, locale = 'fr-FR'): { ratio: number; text: string }[] {
  const axes: { ratio: number; text: string }[] = [];

  if (state.remainingKm !== null && state.intervalKm) {
    axes.push({
      ratio: state.remainingKm / state.intervalKm,
      text:
        state.remainingKm >= 0
          ? tr('kmLeft', { n: format(state.remainingKm, locale) })
          : tr('kmOver', { n: format(-state.remainingKm, locale) }),
    });
  }

  if (state.remainingHours !== null && state.intervalHours) {
    axes.push({
      ratio: state.remainingHours / state.intervalHours,
      text:
        state.remainingHours >= 0
          ? tr('hLeft', { n: format(state.remainingHours, locale) })
          : tr('hOver', { n: format(-state.remainingHours, locale) }),
    });
  }

  if (state.remainingDays !== null && state.intervalDays) {
    axes.push({
      ratio: state.remainingDays / state.intervalDays,
      text:
        state.remainingDays >= 0
          ? tr('dLeft', { n: state.remainingDays })
          : tr('dOver', { n: -state.remainingDays }),
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

function format(value: number, locale = 'fr-FR'): string {
  return Math.round(value).toLocaleString(locale);
}
