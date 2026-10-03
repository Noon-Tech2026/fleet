import { useTranslation } from 'react-i18next';
import { useBranding } from '../lib/branding';
import type { Period } from '../accounting/PeriodFilter';

/** En-tete visible uniquement a l'impression : societe, titre, periode, date. */
export function PrintHeader({ title, period }: { title: string; period?: Period }) {
  const { t, i18n } = useTranslation();
  const brand = useBranding();
  const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString(i18n.language) : null);
  const per = period && (period.from || period.to) ? `${fmt(period.from) ?? '…'} → ${fmt(period.to) ?? '…'}` : t('period.all');
  return (
    <div className="print-header">
      <div>
        <div className="print-brand">{brand.name}</div>
        <div className="print-title">{title}</div>
      </div>
      <div className="print-meta">
        <div>{t('print.period')} : {per}</div>
        <div>{t('print.printedOn')} : {new Date().toLocaleString(i18n.language)}</div>
      </div>
    </div>
  );
}
