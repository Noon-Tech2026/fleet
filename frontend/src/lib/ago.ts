/** Duree ecoulee depuis un instant ISO : « 4 min », « 2 h 05 », « 3 j ». */
export function fmtAgo(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j`;
}

/** Instant a afficher sous un camion : hors ligne depuis / arret depuis / rien en roulage. */
export function sinceOf(v: { online: boolean; speed: number; updatedAt: string; stoppedSince?: string | null }): { kind: 'off' | 'stop'; iso: string } | null {
  if (!v.online) return { kind: 'off', iso: v.updatedAt };
  if (v.speed <= 3 && v.stoppedSince) return { kind: 'stop', iso: v.stoppedSince };
  return null;
}
