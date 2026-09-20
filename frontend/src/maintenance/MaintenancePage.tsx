import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaintenancePlanState, MaintenanceStatus, VehicleState } from '../lib/types';
import { MAINTENANCE_STATUS_TONE, deadlineText, intervalText, lastServiceText } from '../lib/maintenance';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ServiceDialog } from './ServiceDialog';
import { PlanDialog } from './PlanDialog';
import { MaintenanceLogs } from './MaintenanceLogs';

type Filter = 'all' | 'overdue' | 'soon';
const FILTERS: Filter[] = ['all', 'overdue', 'soon'];

export function MaintenancePage({ vehicles }: { vehicles: VehicleState[] }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const tr = (key: string, vars?: Record<string, unknown>) => t(`maintenance.${key}`, vars);
  const [plans, setPlans] = useState<MaintenancePlanState[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<MaintenancePlanState | null>(null);
  const [configuring, setConfiguring] = useState<PlanDialogPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [catalog, setCatalog] = useState<{ kind: string; label: string }[]>([]);
  const [newVehicle, setNewVehicle] = useState('');
  const [newKind, setNewKind] = useState('');
  const [installing, setInstalling] = useState(false);
  const [tab, setTab] = useState<'plans' | 'logs'>('plans');
  const [logsVersion, setLogsVersion] = useState(0);

  const canRecord = can('operator');
  const canConfigure = can('supervisor');
  const isAdmin = can('admin');

  const load = useCallback(async () => {
    try {
      setPlans(await api.maintenance());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('maintenance.page.loadError'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (canConfigure === false) return;
    api.maintenanceCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, [canConfigure]);

  const byVehicle = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  const untracked = useMemo(() => {
    if (plans === null) return [];
    const tracked = new Set(plans.map((p) => p.vehicleId));
    return vehicles.filter((v) => tracked.has(v.id) === false);
  }, [plans, vehicles]);

  const shown = useMemo(() => {
    if (plans === null) return [];
    const q = query.trim().toLowerCase();
    return plans.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (q.length === 0) return true;
      const plate = byVehicle.get(p.vehicleId)?.plate ?? '';
      return p.vehicleId.toLowerCase().includes(q) || p.label.toLowerCase().includes(q) || plate.toLowerCase().includes(q);
    });
  }, [plans, query, filter, byVehicle]);

  const count = (status: MaintenanceStatus) => plans?.filter((p) => p.status === status).length ?? 0;

  async function installCatalog() {
    setInstalling(true);
    setError(null);
    try {
      for (const vehicle of untracked) await api.applyMaintenanceCatalog(vehicle.id);
      await load();
      setNotice(tr('page.installed', { n: untracked.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('maintenance.page.installError'));
    } finally {
      setInstalling(false);
    }
  }

  /** Operations du catalogue pas encore suivies sur le camion choisi. */
  const availableKinds = useMemo(() => {
    const used = new Set((plans ?? []).filter((p) => p.vehicleId === newVehicle).map((p) => p.kind));
    return catalog.filter((c) => used.has(c.kind as MaintenancePlanState['kind']) === false);
  }, [catalog, plans, newVehicle]);

  function startNew() {
    if (newVehicle.length === 0 || newKind.length === 0) return;
    const label = catalog.find((c) => c.kind === newKind)?.label ?? newKind;
    setCreating(false);
    setConfiguring({ vehicleId: newVehicle, kind: newKind as MaintenancePlanState['kind'], label });
  }

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>{tr('page.title')}</h2>
        </div>
        <nav className="chips">
          <button className={`chip ${tab === 'plans' ? 'active' : ''}`} onClick={() => setTab('plans')}>{tr('page.tabPlans')}</button>
          <button className={`chip ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>{tr('page.tabLogs')}</button>
        </nav>
      </header>

      {tab === 'plans' && (
        <div className="page-toolbar">
          <div className="fleet-summary compact">
            <div className="summary-cell danger"><b>{count('overdue')}</b><span>{tr('status.overdue')}</span></div>
            <div className="summary-cell warn"><b>{count('soon')}</b><span>{tr('status.soon')}</span></div>
            <div className="summary-cell ok"><b>{count('ok')}</b><span>{tr('status.ok')}</span></div>
          </div>

          <div className="toolbar-right">
            <div className="chips">
              {FILTERS.map((f) => (
                <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{tr(`page.filter.${f}`)}</button>
              ))}
            </div>
            <label className="search">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('page.search')} />
            </label>
            {canConfigure && (
              <button className="btn mint" onClick={() => { setCreating(true); setNewVehicle(vehicles[0]?.id ?? ''); setNewKind(''); }}>
                {tr('page.new')}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="banner err">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {untracked.length > 0 && canConfigure && (
        <p className="banner warn">
          {tr('page.untracked', { n: untracked.length, list: untracked.map((v) => v.id).join(', ') })}
          <button className="btn small" onClick={() => void installCatalog()} disabled={installing}>
            {installing ? tr('page.installing') : tr('page.install')}
          </button>
        </p>
      )}

      {tab === 'logs' ? (
        <MaintenanceLogs key={logsVersion} />
      ) : plans === null ? (
        <p className="empty">{tr('page.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="empty">{tr('page.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{tr('page.colVehicle')}</th>
                <th>{tr('page.colOperation')}</th>
                <th>{tr('page.colStatus')}</th>
                <th>{tr('page.colDeadline')}</th>
                <th>{tr('page.colInterval')}</th>
                <th>{tr('page.colReminder')}</th>
                <th>{tr('page.colLast')}</th>
                {(canRecord || canConfigure) && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {shown.map((plan) => {
                const tone = MAINTENANCE_STATUS_TONE[plan.status];
                return (
                  <tr key={plan.id}>
                    <td>
                      <strong>{plan.vehicleId}</strong>
                      <div className="cell-sub" dir="ltr">{byVehicle.get(plan.vehicleId)?.plate ?? '—'}</div>
                    </td>
                    <td>{plan.label}</td>
                    <td><span className={`badge ${tone}`}>{tr(`status.${plan.status}`)}</span></td>
                    <td className="cell-deadline">
                      {deadlineText(plan, tr, i18n.language)}
                      <div className={`usage ${tone}`}><i style={{ width: `${Math.min(100, plan.usage * 100)}%` }} /></div>
                    </td>
                    <td className="cell-muted">{intervalText(plan)}</td>
                    <td className="cell-muted">{remindText(plan)}</td>
                    <td className="cell-muted">{lastServiceText(plan)}</td>
                    {(canRecord || canConfigure) && (
                      <td className="cell-actions">
                        {canConfigure && (
                          <button className="btn ghost small" onClick={() => setConfiguring(plan)} title={tr('page.periodicityHint')}>{tr('page.periodicity')}</button>
                        )}
                        {canRecord && (
                          <button className="btn ghost small" onClick={() => setEditing(plan)}>{tr('page.record')}</button>
                        )}
                        {isAdmin && (
                          <button
                            className="btn ghost small danger"
                            onClick={() => {
                              if (window.confirm(tr('page.confirmDelete', { label: plan.label, id: plan.vehicleId })) === false) return;
                              void api.deleteMaintenancePlan(plan.id).then(() => {
                                setPlans((list) => list?.filter((p) => p.id !== plan.id) ?? null);
                                setNotice(tr('page.deleted', { label: plan.label, id: plan.vehicleId }));
                              }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
                            }}
                          >
                            {tr('page.delete')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}>
          <form className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); startNew(); }}>
            <h2>{tr('page.new')}</h2>
            <label className="field">
              <span>{tr('page.colVehicle')}</span>
              <select value={newVehicle} onChange={(e) => { setNewVehicle(e.target.value); setNewKind(''); }}>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id} · {v.plate}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{tr('page.colOperation')}</span>
              <select value={newKind} onChange={(e) => setNewKind(e.target.value)} required>
                <option value="">{tr('page.chooseOperation')}</option>
                {availableKinds.map((c) => <option key={c.kind} value={c.kind}>{c.label}</option>)}
              </select>
            </label>
            {availableKinds.length === 0 && newVehicle && <p className="hint">{tr('page.allTracked')}</p>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setCreating(false)}>{tr('plan.cancel')}</button>
              <button type="submit" className="btn primary" disabled={newKind.length === 0}>{tr('page.next')}</button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <ServiceDialog
          plan={editing}
          vehicle={byVehicle.get(editing.vehicleId)}
          onCancel={() => setEditing(null)}
          onDone={(updated) => {
            setEditing(null);
            setPlans((list) => list?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
            setLogsVersion((v) => v + 1);
            setError(null);
            setNotice(tr('page.recorded', { label: updated.label, id: updated.vehicleId }));
          }}
        />
      )}

      {configuring && (
        <PlanDialog
          plan={configuring}
          onCancel={() => setConfiguring(null)}
          onDone={(updated) => {
            setConfiguring(null);
            setPlans((list) => {
              if (list === null) return [updated];
              return list.some((p) => p.id === updated.id) ? list.map((p) => (p.id === updated.id ? updated : p)) : [updated, ...list];
            });
            setError(null);
            setNotice(tr('page.planSaved', { label: updated.label, id: updated.vehicleId }));
          }}
        />
      )}
    </main>
  );
}

type PlanDialogPlan = Pick<MaintenancePlanState, 'vehicleId' | 'kind' | 'label'> & Partial<MaintenancePlanState>;

function remindText(p: MaintenancePlanState): string {
  const parts: string[] = [];
  if (p.remindKm) parts.push(`${p.remindKm} km`);
  if (p.remindHours) parts.push(`${p.remindHours} h`);
  if (p.remindDays) parts.push(`${p.remindDays} j`);
  return parts.join(' · ') || '—';
}
