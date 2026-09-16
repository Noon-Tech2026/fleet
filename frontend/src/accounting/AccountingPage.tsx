import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClientRecord, DriverRecord, VehicleAccountingSummary, VehicleState } from '../lib/types';
import { formatMoney } from '../lib/accounting';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { VehicleAccountingPanel } from './VehicleAccountingPanel';
import { DirectoryPanel } from './DirectoryPanel';

type Tab = 'summary' | 'directory';

export function AccountingPage({ vehicles }: { vehicles: VehicleState[] }) {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('summary');
  const [summaries, setSummaries] = useState<VehicleAccountingSummary[] | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
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
      const [c, d] = await Promise.all([api.clients(), api.drivers()]);
      setClients(c);
      setDrivers(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    void loadSummaries();
    void loadDirectory();
  }, [loadSummaries, loadDirectory]);

  const byVehicle = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

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
          <h2>Comptabilité</h2>
        </div>

        {!selectedVehicleId && (
          <nav className="chips">
            <button className={`chip ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>
              Synthèse
            </button>
            <button className={`chip ${tab === 'directory' ? 'active' : ''}`} onClick={() => setTab('directory')}>
              Référentiels
            </button>
          </nav>
        )}
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
      ) : tab === 'directory' ? (
        <DirectoryPanel
          clients={clients}
          drivers={drivers}
          canManage={canManageMoney}
          onClientsChange={setClients}
          onDriversChange={setDrivers}
        />
      ) : (
        <>
          {fleetTotals && (
            <div className="fleet-summary cols-4">
              <div className="summary-cell ok">
                <b>{formatMoney(fleetTotals.revenue)}</b>
                <span>Revenu flotte</span>
              </div>
              <div className="summary-cell danger">
                <b>{formatMoney(fleetTotals.expenses)}</b>
                <span>Charges flotte</span>
              </div>
              <div className="summary-cell">
                <b>{formatMoney(fleetTotals.investments)}</b>
                <span>Investissement flotte</span>
              </div>
              <div className={`summary-cell ${fleetTotals.netResult >= 0 ? 'ok' : 'danger'}`}>
                <b>{formatMoney(fleetTotals.netResult)}</b>
                <span>Résultat net flotte</span>
              </div>
            </div>
          )}

          {!summaries ? (
            <p className="empty">Chargement de la synthèse…</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Camion</th>
                    <th>Voyages</th>
                    <th>Revenu</th>
                    <th>Charges</th>
                    <th>Investissement</th>
                    <th>Résultat net</th>
                    <th aria-label="Actions" />
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
                          Détail
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
