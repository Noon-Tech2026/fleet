import { useCallback, useEffect, useMemo, useState } from 'react';
import { openPrintReport, periodLabel } from '../lib/printReport';
import { useTranslation as useT2 } from 'react-i18next';
import { api as apiClient, type AccountingOverview } from '../api/client';
import { ExpenseCategoriesDialog } from './ExpenseCategoriesDialog';
import { useTranslation } from 'react-i18next';
import type { ClientRecord, DriverRecord, VehicleAccountingSummary } from '../lib/types';
import { formatMoney } from '../lib/accounting';
import { PeriodFilter, type Period } from './PeriodFilter';
import { api, type VehicleDirectoryEntry } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { VehicleAccountingPanel } from './VehicleAccountingPanel';

export function AccountingPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [summaries, setSummaries] = useState<VehicleAccountingSummary[] | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [fleet, setFleet] = useState<VehicleDirectoryEntry[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>({});
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [overview, setOverview] = useState<AccountingOverview | null>(null);
  useEffect(() => { apiClient.accountingOverview(period).then(setOverview).catch(() => setOverview(null)); }, [period]);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const canRecordTrip = can('operator');
  const canManageMoney = can('supervisor');

  const loadSummaries = useCallback(async () => {
    try {
      setSummaries(await api.accountingSummary(period));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, [period]);

  const loadDirectory = useCallback(async () => {
    try {
      const [c, d, f] = await Promise.all([api.clients(), api.drivers(), api.fleetVehicles()]);
      setClients(c);
      setDrivers(d);
      setFleet(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    void loadSummaries();
    void loadDirectory();
  }, [loadSummaries, loadDirectory]);

  // Le repertoire, pas la telemetrie en direct : un camion tout juste cree
  // doit rester consultable ici avant meme d'avoir emis sa premiere position.
  const byVehicle = useMemo(() => new Map(fleet.map((v) => [v.id, v])), [fleet]);


  const selectedVehicle = selectedVehicleId ? byVehicle.get(selectedVehicleId) : undefined;

  const { i18n } = useT2();
  async function printOverview() {
    if (!overview) return;
    const lang = i18n.language;
    await openPrintReport({
      title: t('accounting.title'), subtitle: t('print.fleetReport'),
      period: periodLabel(period, lang, t('period.all')), lang, rtl: lang.startsWith('ar'),
      labels: { printedOn: t('print.printedOn'), period: t('print.period'), page: '', total: t('clients.ledger.total') },
      kpis: [
        { label: t('overview.revenue'), value: formatMoney(overview.revenue), tone: 'ok' },
        { label: t('overview.driverCharges'), value: formatMoney(overview.driverCharges), tone: 'danger' },
        { label: t('overview.truckCharges'), value: formatMoney(overview.truckCharges), tone: 'danger' },
        { label: t('overview.afterCharges'), value: formatMoney(overview.afterCharges), tone: overview.afterCharges >= 0 ? 'ok' : 'danger' },
        { label: t('overview.versements'), value: formatMoney(overview.versements), tone: 'warn' },
        { label: t('overview.afterVersements'), value: formatMoney(overview.afterVersements), tone: overview.afterVersements >= 0 ? 'ok' : 'danger' },
        { label: t('overview.investments'), value: formatMoney(overview.investments), tone: 'neutral' },
        { label: t('overview.afterInvestments'), value: formatMoney(overview.afterInvestments), tone: overview.afterInvestments >= 0 ? 'ok' : 'danger' },
      ],
      sections: [{
        title: t('print.byVehicle'),
        columns: [{ label: t('common.truck') }, { label: t('accounting.trips'), align: 'center', width: '9%' }, { label: t('accounting.fleetRevenue'), align: 'right' }, { label: t('accounting.fleetExpenses'), align: 'right' }, { label: t('accounting.fleetInvest'), align: 'right' }, { label: t('accounting.fleetNet'), align: 'right' }],
        rows: (summaries ?? []).map((x) => [`${x.vehicleId}${byVehicle.get(x.vehicleId)?.plate ? ' · ' + byVehicle.get(x.vehicleId)?.plate : ''}`, x.tripsCount, formatMoney(x.revenue), formatMoney(x.expenses), formatMoney(x.investments), formatMoney(x.netResult)]),
        total: [t('clients.ledger.total'), (summaries ?? []).reduce((a, x) => a + x.tripsCount, 0), formatMoney((summaries ?? []).reduce((a, x) => a + x.revenue, 0)), formatMoney((summaries ?? []).reduce((a, x) => a + x.expenses, 0)), formatMoney((summaries ?? []).reduce((a, x) => a + x.investments, 0)), formatMoney((summaries ?? []).reduce((a, x) => a + x.netResult, 0))],
        empty: t('accounting.noVehicles'),
      }],
    });
  }

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>{t('accounting.title')}</h2>
          {selectedVehicleId === null && <PeriodFilter value={period} onChange={setPeriod} />}
        </div>
        <div className="chips no-print">
          {selectedVehicleId === null && <input className="search" value={vehicleQuery} onChange={(e) => setVehicleQuery(e.target.value)} placeholder={t('accounting.searchVehicle')} />}
          {selectedVehicleId === null && <button className="btn ghost" onClick={() => void printOverview()}>{t('common.print')}</button>}
          {can('admin') && <button className="btn ghost" onClick={() => setCatalogOpen(true)}>{t('expenseCat.button')}</button>}
        </div>
      </header>
      {catalogOpen && <ExpenseCategoriesDialog onClose={() => setCatalogOpen(false)} />}

      {error && <p className="banner err">{error}</p>}

      {selectedVehicle ? (
        <VehicleAccountingPanel
          vehicleId={selectedVehicle.id}
          plate={selectedVehicle.plate}
          clients={clients}
          drivers={drivers}
          canRecordTrip={canRecordTrip}
          canManageMoney={canManageMoney}
          onBack={() => {
            setSelectedVehicleId(null);
            void loadSummaries();
          }}
        />
      ) : (
        <>
          {overview && (
            <div className="fleet-summary cols-4 overview-cards">
              <div className="summary-cell ok"><b>{formatMoney(overview.revenue)}</b><span>{t('overview.revenue')}</span></div>
              <div className="summary-cell danger"><b>{formatMoney(overview.driverCharges)}</b><span>{t('overview.driverCharges')}</span></div>
              <div className="summary-cell danger"><b>{formatMoney(overview.truckCharges)}</b><span>{t('overview.truckCharges')}</span></div>
              <div className={`summary-cell ${overview.afterCharges >= 0 ? 'ok' : 'danger'}`}><b>{formatMoney(overview.afterCharges)}</b><span>{t('overview.afterCharges')}</span></div>
              <div className="summary-cell warn"><b>{formatMoney(overview.versements)}</b><span>{t('overview.versements')}</span></div>
              <div className={`summary-cell ${overview.afterVersements >= 0 ? 'ok' : 'danger'}`}><b>{formatMoney(overview.afterVersements)}</b><span>{t('overview.afterVersements')}</span></div>
              <div className="summary-cell"><b>{formatMoney(overview.investments)}</b><span>{t('overview.investments')}</span></div>
              <div className={`summary-cell ${overview.afterInvestments >= 0 ? 'ok' : 'danger'}`}><b>{formatMoney(overview.afterInvestments)}</b><span>{t('overview.afterInvestments')}</span></div>
            </div>
          )}


          {!summaries ? (
            <p className="empty">{t('accounting.loadingSummary')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('common.truck')}</th>
                    <th>{t('accounting.trips')}</th>
                    <th>{t('accounting.revenue')}</th>
                    <th>{t('accounting.expenses')}</th>
                    <th>{t('accounting.investment')}</th>
                    <th>{t('accounting.net')}</th>
                    <th aria-label={t('common.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {summaries.filter((s) => {
                    const q = vehicleQuery.trim().toLowerCase();
                    if (!q) return true;
                    const plate = (byVehicle.get(s.vehicleId)?.plate ?? '').toLowerCase().replace(/\s+/g, '');
                    return s.vehicleId.toLowerCase().includes(q) || plate.includes(q.replace(/\s+/g, ''));
                  }).map((s) => (
                    <tr key={s.vehicleId}>
                      <td>
                        <strong>{s.vehicleId}</strong>
                        <div className="cell-sub">{byVehicle.get(s.vehicleId)?.plate ? <span className="plate-badge sm" dir="ltr">{byVehicle.get(s.vehicleId)?.plate}</span> : '—'}</div>
                      </td>
                      <td>{s.tripsCount}</td>
                      <td>{formatMoney(s.revenue)}</td>
                      <td>{formatMoney(s.expenses)}</td>
                      <td>{formatMoney(s.investments)}</td>
                      <td>
                        <strong className={s.netResult >= 0 ? 'ok-text' : 'danger-text'}>
                          {formatMoney(s.netResult)}
                        </strong>
                      </td>
                      <td className="cell-actions">
                        <button className="btn ghost small" onClick={() => setSelectedVehicleId(s.vehicleId)}>
                          {t('accounting.detail')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
