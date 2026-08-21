import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MaintenancePlanState, MaintenanceStatus, VehicleState } from '../lib/types';
import {
  MAINTENANCE_STATUS_LABEL,
  MAINTENANCE_STATUS_TONE,
  deadlineText,
  intervalText,
  lastServiceText,
} from '../lib/maintenance';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ServiceDialog } from './ServiceDialog';
import { PlanDialog } from './PlanDialog';
import { MaintenanceLogs } from './MaintenanceLogs';

type Filter = 'all' | 'overdue' | 'soon';

const FILTER_LABEL: Record<Filter, string> = {
  all: 'Toutes',
  overdue: 'Dépassées',
  soon: 'À prévoir',
};

export function MaintenancePage({ vehicles }: { vehicles: VehicleState[] }) {
  const { can } = useAuth();
  const [plans, setPlans] = useState<MaintenancePlanState[] | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<MaintenancePlanState | null>(null);
  const [configuring, setConfiguring] = useState<MaintenancePlanState | null>(null);
  const [installing, setInstalling] = useState(false);
  const [tab, setTab] = useState<'plans' | 'logs'>('plans');
  // Le journal se recharge apres chaque saisie : sans cela, l'onglet
  // rouvert afficherait encore la liste d'avant l'intervention.
  const [logsVersion, setLogsVersion] = useState(0);

  const canRecord = can('operator');
  const canConfigure = can('supervisor');

  const load = useCallback(async () => {
    try {
      setPlans(await api.maintenance());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byVehicle = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  /** Camions connus du parc mais sans aucune échéance suivie. */
  const untracked = useMemo(() => {
    if (!plans) return [];
    const tracked = new Set(plans.map((p) => p.vehicleId));
    return vehicles.filter((v) => !tracked.has(v.id));
  }, [plans, vehicles]);

  const shown = useMemo(() => {
    if (!plans) return [];
    const q = query.trim().toLowerCase();
    return plans.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (!q) return true;
      const plate = byVehicle.get(p.vehicleId)?.plate ?? '';
      return (
        p.vehicleId.toLowerCase().includes(q) ||
        p.label.toLowerCase().includes(q) ||
        plate.toLowerCase().includes(q)
      );
    });
  }, [plans, query, filter, byVehicle]);

  const count = (status: MaintenanceStatus) => plans?.filter((p) => p.status === status).length ?? 0;

  async function installCatalog() {
    setInstalling(true);
    setError(null);
    try {
      for (const vehicle of untracked) await api.applyMaintenanceCatalog(vehicle.id);
      await load();
      setNotice(`Périodicités de référence installées sur ${untracked.length} camion(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation impossible');
    } finally {
      setInstalling(false);
    }
  }

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>Entretien</h2>
          <p>
            Vidanges, cartouches et contrôles périodiques. Chaque échéance se compte sur trois axes —
            kilométrage, heures moteur et calendrier — et c'est le plus avancé qui décide.
          </p>
        </div>

        <nav className="chips">
          <button
            className={`chip ${tab === 'plans' ? 'active' : ''}`}
            onClick={() => setTab('plans')}
          >
            Échéances
          </button>
          <button className={`chip ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>
            Journal
          </button>
        </nav>
      </header>

      {tab === 'plans' && (
      <div className="page-toolbar">
        <div className="fleet-summary compact">
          <div className="summary-cell danger">
            <b>{count('overdue')}</b>
            <span>Dépassées</span>
          </div>
          <div className="summary-cell warn">
            <b>{count('soon')}</b>
            <span>À prévoir</span>
          </div>
          <div className="summary-cell ok">
            <b>{count('ok')}</b>
            <span>À jour</span>
          </div>
        </div>

        <div className="toolbar-right">
          <div className="chips">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <button
                key={f}
                className={`chip ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>

          <label className="search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Camion, plaque ou opération"
            />
          </label>
        </div>
      </div>
      )}

      {error && <p className="banner err">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {untracked.length > 0 && canConfigure && (
        <p className="banner warn">
          {untracked.length} camion(s) sans suivi d'entretien : {untracked.map((v) => v.id).join(', ')}.
          <button className="btn small" onClick={() => void installCatalog()} disabled={installing}>
            {installing ? 'Installation…' : 'Installer les périodicités de référence'}
          </button>
        </p>
      )}

      {tab === 'logs' ? (
        <MaintenanceLogs key={logsVersion} />
      ) : !plans ? (
        <p className="empty">Chargement des échéances…</p>
      ) : shown.length === 0 ? (
        <p className="empty">Aucune échéance ne correspond à ce filtre.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Camion</th>
                <th>Opération</th>
                <th>État</th>
                <th>Échéance</th>
                <th>Périodicité</th>
                <th>Dernier entretien</th>
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
                      <div className="cell-sub">{byVehicle.get(plan.vehicleId)?.plate ?? '—'}</div>
                    </td>
                    <td>{plan.label}</td>
                    <td>
                      <span className={`badge ${tone}`}>{MAINTENANCE_STATUS_LABEL[plan.status]}</span>
                    </td>
                    <td className="cell-deadline">
                      {deadlineText(plan)}
                      <div className={`usage ${tone}`}>
                        <i style={{ width: `${Math.min(100, plan.usage * 100)}%` }} />
                      </div>
                    </td>
                    <td className="cell-muted">{intervalText(plan)}</td>
                    <td className="cell-muted">{lastServiceText(plan)}</td>
                    {(canRecord || canConfigure) && (
                      <td className="cell-actions">
                        {canConfigure && (
                          <button
                            className="btn ghost small"
                            onClick={() => setConfiguring(plan)}
                            title="Régler la périodicité de cette opération"
                          >
                            Périodicité
                          </button>
                        )}
                        {canRecord && (
                          <button className="btn ghost small" onClick={() => setEditing(plan)}>
                            Enregistrer
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
            setNotice(`${updated.label} — ${updated.vehicleId} : entretien enregistré.`);
          }}
        />
      )}

      {configuring && (
        <PlanDialog
          plan={configuring}
          onCancel={() => setConfiguring(null)}
          onDone={(updated) => {
            setConfiguring(null);
            setPlans((list) => list?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
            setError(null);
            setNotice(`${updated.label} — ${updated.vehicleId} : périodicité mise à jour.`);
          }}
        />
      )}
    </main>
  );
}
