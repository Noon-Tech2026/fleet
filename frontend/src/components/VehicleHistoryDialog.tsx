import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientRecord, DriverRecord, TripEntry, VehicleExpenseEntry, VehicleInvestmentEntry } from '../lib/types';
import { formatMoney } from '../lib/accounting';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { TripDialog } from '../accounting/TripDialog';
import { ExpenseDialog } from '../accounting/ExpenseDialog';
import { InvestmentDialog } from '../accounting/InvestmentDialog';

interface Props {
  vehicleId: string;
  plate: string;
  onClose: () => void;
}

type OpType = 'trip' | 'expense' | 'investment' | 'maintenance' | 'command';
const ALL_TYPES: OpType[] = ['trip', 'expense', 'investment', 'maintenance', 'command'];
type Adding = 'trip' | 'expense' | 'investment' | null;

/** Boutons du bandeau vert : fond clair pour rester lisibles. */
const HEAD_BTN: React.CSSProperties = { background: '#fff', color: '#12704F', border: '1px solid #fff', fontWeight: 600 };

/** Ligne unifiée du journal : toute opération rattachée au camion. */
interface Operation {
  id: string;
  /** Identifiant brut côté API, pour modifier/supprimer. */
  rawId: string;
  /** Entrée d'origine, pour pré-remplir un formulaire de modification. */
  raw: TripEntry | VehicleExpenseEntry | VehicleInvestmentEntry | null;
  at: string;
  type: OpType;
  label: string;
  detail: string;
  by: string;
  /** Utilisateur qui a saisi l'operation. */
  createdBy: string;
  /** Signé : recette positive, coût négatif, null si sans montant. */
  amount: number | null;
}

const MONEY_TYPES: OpType[] = ['trip', 'expense', 'investment'];

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Journal complet d'un camion, ouvert depuis la vue d'ensemble. Agrège
 * voyages, charges, investissements, entretiens et commandes démarreur,
 * et permet la saisie/modification directe (mêmes formulaires que
 * l'onglet Comptabilité). La suppression est réservée à l'admin.
 */
export function VehicleHistoryDialog({ vehicleId, plate, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const canRecord = can('operator');
  const canEditMoney = can('supervisor');
  const canDelete = can('admin');
  const showActions = canEditMoney || canDelete;

  const [ops, setOps] = useState<Operation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [types, setTypes] = useState<Set<OpType>>(new Set(ALL_TYPES));
  const [adding, setAdding] = useState<Adding>(null);
  const [editing, setEditing] = useState<Operation | null>(null);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);

  const load = useCallback(() => {
    Promise.all([
      api.vehicleTrips(vehicleId),
      api.vehicleExpenses(vehicleId),
      api.vehicleInvestments(vehicleId),
      api.maintenanceLogs(vehicleId),
      api.vehicleCommands(vehicleId),
    ])
      .then(([trips, expenses, investments, maintenance, commands]) => {
        const rows: Operation[] = [
          ...trips.map((x) => ({
            id: `t-${x.id}`,
            rawId: x.id,
            raw: x,
            at: x.startedAt,
            type: 'trip' as const,
            label: x.clientName,
            detail: `${x.origin ?? '—'} → ${x.destination ?? '—'} · ${t('history.containers', { count: x.containers.length })}`,
            by: x.driverName,
            createdBy: x.createdBy,
            amount: x.amount,
          })),
          ...expenses.map((x) => ({
            id: `e-${x.id}`,
            rawId: x.id,
            raw: x,
            at: x.at,
            type: 'expense' as const,
            label: t(`history.expense.${x.category}`),
            detail: [x.reference, x.notes].filter(Boolean).join(' · '),
            by: x.createdBy,
            createdBy: x.createdBy,
            amount: -x.amount,
          })),
          ...investments.map((x) => ({
            id: `i-${x.id}`,
            rawId: x.id,
            raw: x,
            at: x.at,
            type: 'investment' as const,
            label: t(`history.investment.${x.kind}`),
            detail: x.description ?? '',
            by: x.createdBy,
            createdBy: x.createdBy,
            amount: -x.amount,
          })),
          ...maintenance.map((x) => ({
            id: `m-${x.id}`,
            rawId: x.id,
            raw: null,
            at: x.at,
            type: 'maintenance' as const,
            label: x.label,
            detail: [x.odometer != null ? `${x.odometer.toLocaleString()} km` : null, x.partReference, x.notes]
              .filter(Boolean)
              .join(' · '),
            by: x.performedBy,
            createdBy: x.performedBy,
            amount: x.cost != null ? -x.cost : null,
          })),
          ...commands.map((x) => ({
            id: `c-${x.id}`,
            rawId: x.id,
            raw: null,
            at: x.at,
            type: 'command' as const,
            label: t(`history.command.${x.action}`) + (x.applied ? '' : ` ${t('history.command.queued')}`),
            detail: x.reason,
            by: x.actor,
            createdBy: x.actor,
            amount: null,
          })),
        ];
        rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
        setOps(rows);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('history.loadError')));
  }, [vehicleId, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Référentiel clients/chauffeurs, chargé une fois, seulement si on peut saisir.
  useEffect(() => {
    if (!canRecord) return;
    api.clients().then(setClients).catch(() => setClients([]));
    api.drivers().then(setDrivers).catch(() => setDrivers([]));
  }, [canRecord]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Un formulaire ouvert gère lui-même Échap : ne pas fermer le journal en dessous.
      if (e.key === 'Escape' && !adding && !editing) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, adding, editing]);

  function onRecorded(type: OpType) {
    setAdding(null);
    setNotice(t('history.recorded', { type: t(`history.type.${type}`) }));
    load();
  }

  function onEdited(type: OpType) {
    setEditing(null);
    setNotice(t('history.updated', { type: t(`history.type.${type}`) }));
    load();
  }

  async function remove(o: Operation) {
    const label = t(`history.type.${o.type}`);
    if (!window.confirm(t('history.confirmDelete', { type: label }))) return;
    try {
      if (o.type === 'trip') await api.deleteTrip(o.rawId);
      else if (o.type === 'expense') await api.deleteExpense(o.rawId);
      else if (o.type === 'investment') await api.deleteInvestment(o.rawId);
      else return;
      setNotice(t('history.deleted', { type: label }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('history.loadError'));
    }
  }

  const filtered = useMemo(() => {
    if (!ops) return null;
    const fromTs = from ? new Date(from).getTime() : -Infinity;
    const toTs = to ? new Date(to).getTime() + 86_400_000 : Infinity; // inclut la journée "au"
    return ops.filter((o) => {
      const ts = new Date(o.at).getTime();
      return ts >= fromTs && ts < toTs && types.has(o.type);
    });
  }, [ops, from, to, types]);

  const totals = useMemo(() => {
    let revenue = 0;
    let costs = 0;
    for (const o of filtered ?? []) {
      if (o.amount == null) continue;
      if (o.amount >= 0) revenue += o.amount;
      else costs += -o.amount;
    }
    return { revenue, costs, net: revenue - costs };
  }, [filtered]);

  function toggleType(type: OpType) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function quickRange(days: number) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    setFrom(toInputDate(start));
    setTo(toInputDate(end));
  }

  const locale = i18n.language.startsWith('ar') ? 'ar-MA' : i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB';

  return (
    <div className="modal-backdrop full" onClick={onClose}>
      <div
        className="modal full"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-full-head">
          <div>
            <h2 id="history-dialog-title">{t('history.title', { id: vehicleId })}</h2>
            <p>
              {plate}
              {filtered && ` · ${t('history.count', { count: filtered.length })}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {canRecord && (
              <>
                <button className="btn small" style={HEAD_BTN} onClick={() => setAdding('trip')}>{t('history.add.trip')}</button>
                <button className="btn small" style={HEAD_BTN} onClick={() => setAdding('expense')}>{t('history.add.expense')}</button>
                <button className="btn small" style={HEAD_BTN} onClick={() => setAdding('investment')}>{t('history.add.investment')}</button>
              </>
            )}
            <button className="modal-close" onClick={onClose} aria-label={t('history.close')}>
              ✕
            </button>
          </div>
        </header>

        <div className="modal-full-body">
          {error && <p className="banner err">{error}</p>}
          {notice && <p className="banner ok">{notice}</p>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', marginBottom: 16 }}>
            <label className="field" style={{ margin: 0 }}>
              <span>{t('history.from')}</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field" style={{ margin: 0 }}>
              <span>{t('history.to')}</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn ghost small" onClick={() => quickRange(7)}>7j</button>
              <button className="btn ghost small" onClick={() => quickRange(30)}>30j</button>
              <button className="btn ghost small" onClick={() => { setFrom(''); setTo(''); }}>{t('history.all')}</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginInlineStart: 'auto' }}>
              {ALL_TYPES.map((type) => (
                <button
                  key={type}
                  className={`btn small ${types.has(type) ? 'primary' : 'ghost'}`}
                  onClick={() => toggleType(type)}
                >
                  {t(`history.type.${type}`)}
                </button>
              ))}
            </div>
          </div>

          {filtered && (
            <dl className="ov-money-row" style={{ marginBottom: 16 }}>
              <div className="ov-money ok"><dt>{t('history.totals.revenue')}</dt><dd>{formatMoney(totals.revenue)}</dd></div>
              <div className="ov-money danger"><dt>{t('history.totals.costs')}</dt><dd>{formatMoney(totals.costs)}</dd></div>
              <div className={`ov-money ${totals.net >= 0 ? 'ok' : 'danger'}`}><dt>{t('history.totals.net')}</dt><dd>{formatMoney(totals.net)}</dd></div>
            </dl>
          )}

          {!filtered ? (
            <p className="empty">{t('history.loading')}</p>
          ) : filtered.length === 0 ? (
            <p className="empty">{t('history.empty')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('history.col.date')}</th>
                    <th>{t('history.col.type')}</th>
                    <th>{t('history.col.detail')}</th>
                    <th>{t('history.col.by')}</th>
                    <th>{t('history.col.createdBy')}</th>
                    <th>{t('history.col.amount')}</th>
                    {showActions && <th />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => {
                    const isMoney = MONEY_TYPES.includes(o.type);
                    const editable = o.raw !== null && (o.type === 'trip' ? canRecord : canEditMoney);
                    return (
                      <tr key={o.id}>
                        <td>{new Date(o.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td>
                          <span className={`badge ${o.type === 'trip' ? 'ok' : o.type === 'command' ? 'warn' : 'idle'}`}>
                            {t(`history.type.${o.type}`)}
                          </span>
                        </td>
                        <td>
                          <strong>{o.label}</strong>
                          {o.detail && <div className="cell-muted">{o.detail}</div>}
                        </td>
                        <td className="cell-muted">{o.by}</td>
                        <td className="cell-muted">{o.createdBy}</td>
                        <td>
                          {o.amount == null ? (
                            '—'
                          ) : (
                            <strong style={{ color: o.amount >= 0 ? 'var(--mint)' : 'var(--red)' }}>
                              {o.amount >= 0 ? '+' : '−'}{formatMoney(Math.abs(o.amount))}
                            </strong>
                          )}
                        </td>
                        {showActions && (
                          <td>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              {editable && (
                                <button className="btn ghost small" onClick={() => setEditing(o)}>
                                  {t('history.edit')}
                                </button>
                              )}
                              {canDelete && isMoney && (
                                <button className="btn danger small" onClick={() => void remove(o)}>
                                  {t('history.delete')}
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {adding === 'trip' && (
        <TripDialog
          vehicleId={vehicleId}
          clients={clients}
          drivers={drivers}
          onCancel={() => setAdding(null)}
          onDone={() => onRecorded('trip')}
        />
      )}
      {adding === 'expense' && (
        <ExpenseDialog vehicleId={vehicleId} onCancel={() => setAdding(null)} onDone={() => onRecorded('expense')} />
      )}
      {adding === 'investment' && (
        <InvestmentDialog vehicleId={vehicleId} onCancel={() => setAdding(null)} onDone={() => onRecorded('investment')} />
      )}

      {editing?.type === 'trip' && editing.raw && (
        <TripDialog
          vehicleId={vehicleId}
          clients={clients}
          drivers={drivers}
          initial={editing.raw as TripEntry}
          onCancel={() => setEditing(null)}
          onDone={() => onEdited('trip')}
        />
      )}
      {editing?.type === 'expense' && editing.raw && (
        <ExpenseDialog
          vehicleId={vehicleId}
          initial={editing.raw as VehicleExpenseEntry}
          onCancel={() => setEditing(null)}
          onDone={() => onEdited('expense')}
        />
      )}
      {editing?.type === 'investment' && editing.raw && (
        <InvestmentDialog
          vehicleId={vehicleId}
          initial={editing.raw as VehicleInvestmentEntry}
          onCancel={() => setEditing(null)}
          onDone={() => onEdited('investment')}
        />
      )}
    </div>
  );
}
