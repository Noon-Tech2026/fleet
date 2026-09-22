import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ClientRecord,
  DriverRecord,
  TripEntry,
  VehicleAccountingSummary,
  VehicleExpenseEntry,
  VehicleInvestmentEntry,
} from '../lib/types';
import { EXPENSE_CATEGORY_LABEL, INVESTMENT_KIND_LABEL, formatMoney } from '../lib/accounting';
import { api } from '../api/client';
import { PeriodFilter, type Period } from './PeriodFilter';
import { TripDialog } from './TripDialog';
import { ExpenseDialog } from './ExpenseDialog';
import { InvestmentDialog } from './InvestmentDialog';

interface Props {
  vehicleId: string;
  plate: string;
  clients: ClientRecord[];
  drivers: DriverRecord[];
  canRecordTrip: boolean;
  canManageMoney: boolean;
  onBack: () => void;
}

export function VehicleAccountingPanel({
  vehicleId,
  plate,
  clients,
  drivers,
  canRecordTrip,
  canManageMoney,
  onBack,
}: Props) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<VehicleAccountingSummary | null>(null);
  const [trips, setTrips] = useState<TripEntry[] | null>(null);
  const [expenses, setExpenses] = useState<VehicleExpenseEntry[] | null>(null);
  const [investments, setInvestments] = useState<VehicleInvestmentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>({});
  const [addingTrip, setAddingTrip] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);
  const [addingInvestment, setAddingInvestment] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Un mouvement à la fois : trois entrées (voyage, charge, investissement)
  // regroupées derrière un seul bouton plutôt qu'un bouton par section —
  // le type se choisit après, pas avant.
  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const load = useCallback(async () => {
    try {
      const [s, t, e, i] = await Promise.all([
        api.vehicleAccountingSummary(vehicleId, period),
        api.vehicleTrips(vehicleId, period),
        api.vehicleExpenses(vehicleId, period),
        api.vehicleInvestments(vehicleId, period),
      ]);
      setSummary(s);
      setTrips(t);
      setExpenses(e);
      setInvestments(i);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, [vehicleId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="accounting-detail">
      <div className="page-toolbar">
        <div className="toolbar-right">
          <button className="btn ghost small" onClick={onBack}>
            {t('accounting.back')}
          </button>
          <PeriodFilter value={period} onChange={setPeriod} />
          <h3 className="col-title">
            {vehicleId} <span className="cell-sub">{plate}</span>
          </h3>
        </div>

        {(canRecordTrip || canManageMoney) && (
          <div className="dropdown" ref={menuRef}>
            <button className="btn primary small" onClick={() => setMenuOpen((open) => !open)}>
              {t('accounting.addMovement')}
            </button>
            {menuOpen && (
              <div className="dropdown-menu">
                {canRecordTrip && (
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      setAddingTrip(true);
                    }}
                  >
                    <strong>{t('accounting.trip')}</strong>
                    <span>{t('accounting.tripHint')}</span>
                  </button>
                )}
                {canManageMoney && (
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      setAddingExpense(true);
                    }}
                  >
                    <strong>{t('accounting.expense')}</strong>
                    <span>{t('accounting.expenseHint')}</span>
                  </button>
                )}
                {canManageMoney && (
                  <button
                    className="dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      setAddingInvestment(true);
                    }}
                  >
                    <strong>{t('accounting.investment')}</strong>
                    <span>{t('accounting.investHint')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="banner err">{error}</p>}

      {summary && (
        <div className="fleet-summary cols-4">
          <div className="summary-cell ok">
            <b>{formatMoney(summary.revenue)}</b>
            <span>Revenu ({summary.tripsCount} voyage(s))</span>
          </div>
          <div className="summary-cell danger">
            <b>{formatMoney(summary.expenses)}</b>
            <span>Charges (dont entretien {formatMoney(summary.maintenanceCost)})</span>
          </div>
          <div className="summary-cell">
            <b>{formatMoney(summary.investments)}</b>
            <span>{t('accounting.investment')}</span>
          </div>
          <div className={`summary-cell ${summary.netResult >= 0 ? 'ok' : 'danger'}`}>
            <b>{formatMoney(summary.netResult)}</b>
            <span>{t('accounting.net')}</span>
          </div>
        </div>
      )}

      <section className="accounting-block">
        <header>
          <h4>{t('accounting.trips')}</h4>
        </header>

        {!trips ? (
          <p className="empty">{t('common.loading')}</p>
        ) : trips.length === 0 ? (
          <p className="empty">{t('accounting.noTrips')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.client')}</th>
                  <th>{t('common.driver')}</th>
                  <th>{t('accounting.route')}</th>
                  <th>{t('accounting.containers')}</th>
                  <th>{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr key={trip.id}>
                    <td>{new Date(trip.startedAt).toLocaleDateString('fr-FR')}</td>
                    <td>{trip.clientName}</td>
                    <td>{trip.driverName}</td>
                    <td className="cell-muted">
                      {trip.origin ?? '—'} → {trip.destination ?? '—'}
                    </td>
                    <td>
                      <span className="badge idle">{trip.containers.length}</span>
                      <div className="cell-sub">
                        {trip.containers
                          .map((c) => `${c.containerNumber ?? 'n° inconnu'} (${c.size}')`)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>
                      <strong>{formatMoney(trip.amount)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="accounting-block">
        <header>
          <h4>{t('accounting.expenses')}</h4>
        </header>

        {!expenses ? (
          <p className="empty">{t('common.loading')}</p>
        ) : expenses.length === 0 ? (
          <p className="empty">{t('accounting.noExpenses')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.category')}</th>
                  <th>{t('common.reference')}</th>
                  <th>{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.at).toLocaleDateString('fr-FR')}</td>
                    <td>{EXPENSE_CATEGORY_LABEL[e.category]}</td>
                    <td className="cell-muted">{e.reference ?? '—'}</td>
                    <td>{formatMoney(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="accounting-block">
        <header>
          <h4>{t('accounting.investments')}</h4>
        </header>

        {!investments ? (
          <p className="empty">{t('common.loading')}</p>
        ) : investments.length === 0 ? (
          <p className="empty">{t('accounting.noInvest')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.type')}</th>
                  <th>{t('common.description')}</th>
                  <th>{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {investments.map((i) => (
                  <tr key={i.id}>
                    <td>{new Date(i.at).toLocaleDateString('fr-FR')}</td>
                    <td>{INVESTMENT_KIND_LABEL[i.kind]}</td>
                    <td className="cell-muted">{i.description ?? '—'}</td>
                    <td>{formatMoney(i.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {addingTrip && (
        <TripDialog
          vehicleId={vehicleId}
          clients={clients}
          drivers={drivers}
          onCancel={() => setAddingTrip(false)}
          onDone={() => {
            setAddingTrip(false);
            void load();
          }}
        />
      )}

      {addingExpense && (
        <ExpenseDialog
          vehicleId={vehicleId}
          onCancel={() => setAddingExpense(false)}
          onDone={() => {
            setAddingExpense(false);
            void load();
          }}
        />
      )}

      {addingInvestment && (
        <InvestmentDialog
          vehicleId={vehicleId}
          onCancel={() => setAddingInvestment(false)}
          onDone={() => {
            setAddingInvestment(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
