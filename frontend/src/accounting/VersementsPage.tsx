import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PeriodFilter, type Period } from './PeriodFilter';
import { VersementsPanel } from './VersementsPanel';

/** Registre des versements (retraits des associes) avec filtre de periode. */
export function VersementsPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>({});
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>{t('versements.title')}</h2>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>
      </header>
      <VersementsPanel period={period} onChanged={() => undefined} showTotal />
    </main>
  );
}
