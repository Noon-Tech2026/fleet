import { useCallback, useEffect, useRef, useState } from 'react';
import { openPrintReport, periodLabel } from '../lib/printReport';
import { useExpenseCategories } from '../lib/useExpenseCategories';
import { useTranslation } from 'react-i18next';
import type {
  ClientRecord,
  DriverRecord,
  TripEntry,
  VehicleAccountingSummary,
  VehicleExpenseEntry,
  VehicleInvestmentEntry,
} from '../lib/types';
import { INVESTMENT_KIND_LABEL, formatMoney } from '../lib/accounting';
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
  const { label: categoryLabel } = useExpenseCategories();
  const { t, i18n } = useTranslation();
  const [summary, setSummary] = useState<VehicleAccountingSummary | null>(null);
  const [trips, setTrips] = useState<TripEntry[] | null>(null);
  const [expenses, setExpenses] = useState<VehicleExpenseEntry[] | null>(null);
  const [investments, setInvestments] = useState<VehicleInvestmentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>({});
  const [addingTrip, setAddingTrip] = useState(false);
  const [editingTrip, setEditingTrip] = useState<TripEntry | null>(null);
  const [editingExpense, setEditingExpense] = useState<VehicleExpenseEntry | null>(null);
  const [editingInvestment, setEditingInvestment] = useState<VehicleInvestmentEntry | null>(null);
  const [addingExpense, setAddingExpense] = useState(false);
  const [addingInvestment, setAddingInvestment] = useState(false);

  async function removeTrip(id: string) {
    if (window.confirm(t('history.confirmDelete', { type: t('accounting.trip') })) === false) return;
    await api.deleteTrip(id); void load();
  }
  async function removeExpense(id: string) {
    if (window.confirm(t('history.confirmDelete', { type: t('accounting.expense') })) === false) return;
    await api.deleteExpense(id); void load();
  }
  async function removeInvestment(id: string) {
    if (window.confirm(t('history.confirmDelete', { type: t('accounting.investment') })) === false) return;
    await api.deleteInvestment(id); void load();
  }
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

  async function printVehicle() {
    const lang = i18n.language;
    const d = (iso: string) => new Date(iso).toLocaleDateString(lang);
    const tr = trips ?? [], ex = expenses ?? [], inv = investments ?? [];
    await openPrintReport({
      title: `${t('accounting.title')} — ${vehicleId}`, subtitle: plate ?? undefined,
      period: periodLabel(period, lang, t('period.all')), lang, rtl: lang.startsWith('ar'),
      labels: { printedOn: t('print.printedOn'), period: t('print.period'), page: '', total: t('clients.ledger.total') },
      kpis: [
        { label: t('accounting.revenue'), value: formatMoney(summary?.revenue ?? 0), tone: 'ok' },
        { label: t('accounting.expenses'), value: formatMoney(summary?.expenses ?? 0), tone: 'danger' },
        { label: t('accounting.investments'), value: formatMoney(summary?.investments ?? 0), tone: 'neutral' },
        { label: t('accounting.net'), value: formatMoney(summary?.netResult ?? 0), tone: (summary?.netResult ?? 0) >= 0 ? 'ok' : 'danger' },
      ],
      sections: [
        { title: t('accounting.trips'), columns: [{ label: t('common.date'), width: '11%' }, { label: t('common.client') }, { label: t('common.driver') }, { label: t('accounting.route') }, { label: t('accounting.containers') }, { label: t('common.amount'), align: 'right', width: '14%' }],
          rows: tr.map((x) => [d(x.startedAt), x.clientName, x.driverName, `${x.origin ?? '—'} → ${x.destination ?? '—'}`, x.containers.map((c) => `${c.containerNumber ?? '?'} (${c.size}')`).join(' · ') || '—', formatMoney(x.amount) + (x.paid ? ' ✓' : '')]),
          total: [t('clients.ledger.total'), '', '', '', String(tr.length), formatMoney(tr.reduce((a, x) => a + x.amount, 0))], empty: t('accounting.noTrips') },
        { title: t('accounting.expensesTitle'), columns: [{ label: t('common.date'), width: '11%' }, { label: t('accounting.category') }, { label: t('accounting.reference') }, { label: t('common.amount'), align: 'right', width: '14%' }],
          rows: ex.map((x) => [d(x.at), categoryLabel(x.category), [x.reference, x.tripContainers].filter(Boolean).join(' · ') || '—', formatMoney(x.amount)]),
          total: [t('clients.ledger.total'), '', '', formatMoney(ex.reduce((a, x) => a + x.amount, 0))], empty: t('accounting.noExpenses') },
        { title: t('accounting.investmentsTitle'), columns: [{ label: t('common.date'), width: '11%' }, { label: t('common.type') }, { label: t('accounting.description') }, { label: t('common.amount'), align: 'right', width: '14%' }],
          rows: inv.map((x) => [d(x.at), INVESTMENT_KIND_LABEL[x.kind], x.description ?? '—', formatMoney(x.amount)]),
          total: [t('clients.ledger.total'), '', '', formatMoney(inv.reduce((a, x) => a + x.amount, 0))], empty: t('accounting.noInvestments') },
      ],
    });
  }

  return (
    <div className="accounting-detail">
      <div className="page-toolbar">
        <div className="toolbar-right">
          <button className="btn ghost small" onClick={onBack}>
            {t('accounting.back')}
          </button>
          <button className="btn ghost small no-print" onClick={() => void printVehicle()}>{t('common.print')}</button>
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
                  {canManageMoney && <th />}
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
                      {trip.paid && <div className="cell-sub">{t('dialog.trip.paid')}</div>}
                    </td>
                    {canManageMoney && (
                      <td className="cell-actions">
                        <button className="btn ghost small" onClick={() => setEditingTrip(trip)}>{t('common.edit')}</button>
                        <button className="btn ghost small danger" onClick={() => void removeTrip(trip.id)}>{t('common.delete')}</button>
                      </td>
                    )}
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
                  {canManageMoney && <th />}
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.at).toLocaleDateString('fr-FR')}</td>
                    <td>{categoryLabel(e.category)}</td>
                    <td className="cell-muted">{e.reference ?? '—'}{e.tripContainers && <div className="cell-sub">{e.tripContainers}</div>}</td>
                    <td>{formatMoney(e.amount)}</td>
                    {canManageMoney && (
                      <td className="cell-actions">
                        <button className="btn ghost small" onClick={() => setEditingExpense(e)}>{t('common.edit')}</button>
                        <button className="btn ghost small danger" onClick={() => void removeExpense(e.id)}>{t('common.delete')}</button>
                      </td>
                    )}
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
                  {canManageMoney && <th />}
                </tr>
              </thead>
              <tbody>
                {investments.map((i) => (
                  <tr key={i.id}>
                    <td>{new Date(i.at).toLocaleDateString('fr-FR')}</td>
                    <td>{INVESTMENT_KIND_LABEL[i.kind]}</td>
                    <td className="cell-muted">{i.description ?? '—'}</td>
                    <td>{formatMoney(i.amount)}</td>
                    {canManageMoney && (
                      <td className="cell-actions">
                        <button className="btn ghost small" onClick={() => setEditingInvestment(i)}>{t('common.edit')}</button>
                        <button className="btn ghost small danger" onClick={() => void removeInvestment(i.id)}>{t('common.delete')}</button>
                      </td>
                    )}
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

      {editingTrip && (
        <TripDialog
          vehicleId={vehicleId}
          clients={clients}
          drivers={drivers}
          initial={editingTrip}
          onCancel={() => setEditingTrip(null)}
          onDone={() => { setEditingTrip(null); void load(); }}
        />
      )}
      {editingExpense && (
        <ExpenseDialog vehicleId={vehicleId} initial={editingExpense} onCancel={() => setEditingExpense(null)} onDone={() => { setEditingExpense(null); void load(); }} />
      )}
      {editingInvestment && (
        <InvestmentDialog vehicleId={vehicleId} initial={editingInvestment} onCancel={() => setEditingInvestment(null)} onDone={() => { setEditingInvestment(null); void load(); }} />
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
