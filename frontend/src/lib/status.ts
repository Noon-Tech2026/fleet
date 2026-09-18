import type { VehicleState } from './types';

export type StatusKey = 'offline' | 'blocked' | 'pendingBlock' | 'stopped' | 'idling' | 'moving';

export interface Status {
  /** Clé i18n : afficher via t(`status.${key}`). */
  key: StatusKey;
  tone: 'ok' | 'warn' | 'danger' | 'idle';
}

/**
 * Règle d'affichage unique, partagée par la liste et la fiche.
 * L'ordre des tests est significatif : on montre toujours la condition
 * la plus grave en premier.
 */
export function statusOf(v: VehicleState): Status {
  if (!v.online) return { key: 'offline', tone: 'idle' };
  if (v.starter === 'blocked') return { key: 'blocked', tone: 'danger' };
  if (v.starter === 'pending_block') return { key: 'pendingBlock', tone: 'warn' };
  if (!v.ignition) return { key: 'stopped', tone: 'idle' };
  if (v.speed <= 3) return { key: 'idling', tone: 'warn' };
  return { key: 'moving', tone: 'ok' };
}
