import { loadBranding } from './branding';

export interface ReportKpi { label: string; value: string; tone?: 'ok' | 'danger' | 'warn' | 'neutral' }
export interface ReportColumn { label: string; align?: 'left' | 'right' | 'center'; width?: string }
export interface ReportSection { title: string; columns: ReportColumn[]; rows: (string | number)[][]; total?: (string | number)[]; empty?: string }
export interface ReportDoc {
  title: string;
  subtitle?: string;
  period: string;
  kpis: ReportKpi[];
  sections: ReportSection[];
  lang: string;
  rtl?: boolean;
  labels: { printedOn: string; period: string; page: string; total: string };
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Ouvre une fenetre avec un document d'impression autonome (A4), puis lance l'impression. */
export async function openPrintReport(doc: ReportDoc): Promise<void> {
  const brand = await loadBranding();
  const logo = brand.logo ? `<img src="${esc(brand.logo)}" alt="" onerror="this.style.display='none'">` : '';
  const kpis = doc.kpis.map((k) => `<div class="kpi ${k.tone ?? 'neutral'}"><div class="kv">${esc(k.value)}</div><div class="kl">${esc(k.label)}</div></div>`).join('');
  const sections = doc.sections.map((s) => {
    const head = s.columns.map((c) => `<th class="${c.align ?? 'left'}"${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`).join('');
    const body = s.rows.length === 0
      ? `<tr><td colspan="${s.columns.length}" class="empty">${esc(s.empty ?? '—')}</td></tr>`
      : s.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${s.columns[i]?.align ?? 'left'}">${esc(v)}</td>`).join('')}</tr>`).join('');
    const foot = s.total ? `<tfoot><tr>${s.total.map((v, i) => `<td class="${s.columns[i]?.align ?? 'left'}">${esc(v)}</td>`).join('')}</tr></tfoot>` : '';
    return `<section><h2>${esc(s.title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></section>`;
  }).join('');
  const now = new Date().toLocaleString(doc.lang);
  const html = `<!doctype html><html lang="${esc(doc.lang)}"${doc.rtl ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><title>${esc(doc.title)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11.5px/1.45 "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1f6f43; padding-bottom: 8px; margin-bottom: 14px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { height: 44px; width: auto; }
  .brand .name { font-size: 20px; font-weight: 800; letter-spacing: .03em; color: #1f6f43; }
  .brand .tag { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .12em; }
  .doc { text-align: right; }
  .doc h1 { margin: 0; font-size: 16px; }
  .doc .sub { color: #444; font-size: 11px; }
  .doc .meta { color: #666; font-size: 10px; margin-top: 4px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .kpi { border: 1px solid #d5d9de; border-top-width: 3px; border-radius: 4px; padding: 7px 9px; }
  .kpi.ok { border-top-color: #1f8f4f; } .kpi.danger { border-top-color: #c0392b; } .kpi.warn { border-top-color: #b8860b; } .kpi.neutral { border-top-color: #7a8793; }
  .kv { font-size: 14px; font-weight: 700; } .kl { font-size: 9.5px; color: #555; text-transform: uppercase; letter-spacing: .08em; margin-top: 2px; }
  section { margin-top: 12px; break-inside: auto; }
  h2 { font-size: 12.5px; margin: 0 0 6px; padding-bottom: 3px; border-bottom: 1px solid #1f6f43; color: #1f6f43; text-transform: uppercase; letter-spacing: .06em; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #eef3ef; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #333; }
  th, td { border: 1px solid #d5d9de; padding: 4px 6px; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafbfa; }
  tfoot td { font-weight: 700; background: #eef3ef; border-top: 2px solid #1f6f43; }
  tr { break-inside: avoid; }
  .right { text-align: right; white-space: nowrap; } .center { text-align: center; } .left { text-align: left; }
  .empty { text-align: center; color: #777; font-style: italic; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9px; color: #777; display: flex; justify-content: space-between; border-top: 1px solid #ddd; padding-top: 3px; }
  @media screen { body { background: #e9ecef; padding: 20px; } .sheet { background: #fff; max-width: 210mm; margin: 0 auto; padding: 14mm 12mm 16mm; box-shadow: 0 2px 12px rgba(0,0,0,.12); } footer { position: static; margin-top: 16px; } }
</style></head><body><div class="sheet">
<header>
  <div class="brand">${logo}<div><div class="name">${esc(brand.name)}</div><div class="tag">${esc(brand.tagline)}</div></div></div>
  <div class="doc"><h1>${esc(doc.title)}</h1>${doc.subtitle ? `<div class="sub">${esc(doc.subtitle)}</div>` : ''}<div class="meta">${esc(doc.labels.period)} : ${esc(doc.period)} · ${esc(doc.labels.printedOn)} ${esc(now)}</div></div>
</header>
<div class="kpis">${kpis}</div>
${sections}
<footer><span>${esc(brand.name)} — ${esc(doc.title)}</span><span>${esc(now)}</span></footer>
</div><script>window.addEventListener('load', () => { setTimeout(() => window.print(), 250); });</script></body></html>`;
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { alert('Fenêtre bloquée : autorisez les pop-ups pour imprimer.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

export function periodLabel(period: { from?: string; to?: string } | undefined, lang: string, allLabel: string): string {
  const f = (d?: string) => (d ? new Date(d).toLocaleDateString(lang) : '…');
  return period && (period.from || period.to) ? `${f(period.from)} → ${f(period.to)}` : allLabel;
}
