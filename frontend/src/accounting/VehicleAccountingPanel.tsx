import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [summary, setSummary] = useState<VehicleAccountingSummary | null>(null);
  const [trips, setTrips] = useState<TripEntry[] | null>(null);
  const [expenses, setExpenses] = useState<VehicleExpenseEntry[] | null>(null);
  const [investments, setInvestments] = useState<VehicleInvestmentEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        api.vehicleAccountingSummary(vehicleId),
        api.vehicleTrips(vehicleId),
        api.vehicleExpenses(vehicleId),
        api.vehicleInvestments(vehicleId),
      ]);
      setSummary(s);
      setTrips(t);
      setExpenses(e);
      setInvestments(i);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, [vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="accounting-detail">
      <div className="page-toolbar">
        <div className="toolbar-right">
          <button className="btn ghost small" onClick={onBack}>
            ← Retour à la synthèse
          </button>
          <h3 className="col-title">
            {vehicleId} <span className="cell-sub">{plate}</span>
          </h3>
        </div>

        {(canRecordTrip || canManageMoney) && (
          <div className="dropdown" ref={menuRef}>
            <button className="btn primary small" onClick={() => setMenuOpen((open) => !open)}>
              + Ajouter un mouvement
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
                    <strong>Voyage</strong>
                    <span>Course facturée à un client</span>
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
                    <strong>Charge</strong>
                    <span>Carburant, pneus, péage, salaire…</span>
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
                    <strong>Investissement</strong>
                    <span>Achat, équipement, réfection lourde</span>
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
            <span>Investissement</span>
          </div>
          <div className={`summary-cell ${summary.netResult >= 0 ? 'ok' : 'danger'}`}>
            <b>{formatMoney(summary.netResult)}</b>
            <span>Résultat net</span>
          </div>
        </div>
      )}

      <section className="accounting-block">
        <header>
          <h4>Voyages</h4>
        </header>

        {!trips ? (
          <p className="empty">Chargement…</p>
        ) : trips.length === 0 ? (
          <p className="empty">Aucun voyage enregistré pour ce camion.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Chauffeur</th>
                  <th>Trajet</th>
                  <th>Conteneurs</th>
                  <th>Montant</th>
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
          <h4>Charges</h4>
        </header>

        {!expenses ? (
          <p className="empty">Chargement…</p>
        ) : expenses.length === 0 ? (
          <p className="empty">Aucune charge enregistrée pour ce camion.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Catégorie</th>
                  <th>Référence</th>
                  <th>Montant</th>
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
          <h4>Investissements</h4>
        </header>

        {!investments ? (
          <p className="empty">Chargement…</p>
        ) : investments.length === 0 ? (
          <p className="empty">Aucun investissement enregistré pour ce camion.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Montant</th>
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
