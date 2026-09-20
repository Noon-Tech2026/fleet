import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientRecord, DriverRecord, VehicleAccountingSummary } from '../lib/types';
import { formatMoney } from '../lib/accounting';
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

  const canRecordTrip = can('operator');
  const canManageMoney = can('supervisor');

  const loadSummaries = useCallback(async () => {
    try {
      setSummaries(await api.accountingSummary());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, []);

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

  const fleetTotals = useMemo(() => {
    if (!summaries) return null;
    return summaries.reduce(
      (acc, s) => ({
        revenue: acc.revenue + s.revenue,
        expenses: acc.expenses + s.expenses,
        investments: acc.investments + s.investments,
        netResult: acc.netResult + s.netResult,
      }),
      { revenue: 0, expenses: 0, investments: 0, netResult: 0 },
    );
  }, [summaries]);

  const selectedVehicle = selectedVehicleId ? byVehicle.get(selectedVehicleId) : undefined;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>{t('accounting.title')}</h2>
        </div>
      </header>

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
          {fleetTotals && (
            <div className="fleet-summary cols-4">
              <div className="summary-cell ok">
                <b>{formatMoney(fleetTotals.revenue)}</b>
                <span>{t('accounting.fleetRevenue')}</span>
              </div>
              <div className="summary-cell danger">
                <b>{formatMoney(fleetTotals.expenses)}</b>
                <span>{t('accounting.fleetExpenses')}</span>
              </div>
              <div className="summary-cell">
                <b>{formatMoney(fleetTotals.investments)}</b>
                <span>{t('accounting.fleetInvest')}</span>
              </div>
              <div className={`summary-cell ${fleetTotals.netResult >= 0 ? 'ok' : 'danger'}`}>
                <b>{formatMoney(fleetTotals.netResult)}</b>
                <span>{t('accounting.fleetNet')}</span>
              </div>
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
                  {summaries.map((s) => (
                    <tr key={s.vehicleId}>
                      <td>
                        <strong>{s.vehicleId}</strong>
                        <div className="cell-sub">{byVehicle.get(s.vehicleId)?.plate ?? '—'}</div>
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
