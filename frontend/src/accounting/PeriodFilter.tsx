import { useTranslation } from 'react-i18next';

export interface Period { from?: string; to?: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Presets : mois en cours, mois precedent, annee en cours, tout. */
export function presets(): Record<string, Period> {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  return {
    month: { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) },
    lastMonth: { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    year: { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) },
    all: {},
  };
}

interface Props { value: Period; onChange: (p: Period) => void }

/** Filtre Du / Au + raccourcis. Vide = pas de borne. */
export function PeriodFilter({ value, onChange }: Props) {
  const { t } = useTranslation();
  const p = presets();
  const active = (k: string) => (p[k].from ?? '') === (value.from ?? '') && (p[k].to ?? '') === (value.to ?? '');
  return (
    <div className="period-filter">
      <label className="field inline">
        <span>{t('period.from')}</span>
        <input type="date" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} />
      </label>
      <label className="field inline">
        <span>{t('period.to')}</span>
        <input type="date" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} />
      </label>
      <div className="chips">
        {(['month', 'lastMonth', 'year', 'all'] as const).map((k) => (
          <button key={k} className={`chip ${active(k) ? 'active' : ''}`} onClick={() => onChange(p[k])}>{t(`period.${k}`)}</button>
        ))}
      </div>
    </div>
  );
}
