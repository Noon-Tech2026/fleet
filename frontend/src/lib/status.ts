import type { VehicleState } from './types';

export interface Status {
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'idle';
}

/**
 * Règle d'affichage unique, partagée par la liste et la fiche.
 * L'ordre des tests est significatif : on montre toujours la condition
 * la plus grave en premier.
 */
export function statusOf(v: VehicleState): Status {
  if (!v.online) return { label: 'Hors ligne', tone: 'idle' };
  if (v.starter === 'blocked') return { label: 'Démarrage bloqué', tone: 'danger' };
  if (v.starter === 'pending_block') return { label: 'Blocage en attente', tone: 'warn' };
  if (!v.ignition) return { label: "À l'arrêt", tone: 'idle' };
  if (v.speed <= 3) return { label: 'Moteur au ralenti', tone: 'warn' };
  return { label: 'En route', tone: 'ok' };
}
