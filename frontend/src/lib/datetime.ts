/** Dates des ecritures comptables (heure de Nouakchott = UTC). */
const pad = (n: number) => String(n).padStart(2, '0');

/** Jour choisi (YYYY-MM-DD) -> horodatage envoye a l'API : heure reelle si c'est aujourd'hui, 12:00 sinon. */
export function stamp(day: string): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (day === today) return `${day}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${day}T12:00:00`;
}

/** « 15/10/2026 14:51 » ; date seule si l'heure n'a jamais ete saisie (12:00:00 ou 00:00:00 pile). */
export function fmtDateTime(iso: string, lang: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  if (m === 0 && s === 0 && (h === 12 || h === 0)) return date;
  return `${date} ${d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}
