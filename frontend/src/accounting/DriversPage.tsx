import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DriverRecord } from '../lib/types';
import { initials } from '../lib/roles';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DriverDialog } from './DriverDialog';

export function DriversPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canManage = can('supervisor');
  const [drivers, setDrivers] = useState<DriverRecord[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // null : fermé. 'new' : création. Une fiche : modification.
  const [editing, setEditing] = useState<DriverRecord | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DriverRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Relue après chaque écriture : la base fait foi, pas la réponse d'un PATCH,
  // qui peut être partielle selon la version du serveur.
  const load = useCallback(async () => {
    try {
      setDrivers(await api.drivers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(driver: DriverRecord) {
    setBusyId(driver.id);
    setError(null);
    setNotice(null);
    try {
      await api.updateDriver(driver.id, { active: !driver.active });
      await load();
      setNotice(
        driver.active
          ? `${driver.fullName} est désactivé — il n'est plus proposé pour un nouveau voyage.`
          : `${driver.fullName} est réactivé.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Modification refusée');
    } finally {
      setBusyId(null);
    }
  }

  const shown = useMemo(() => {
    if (!drivers) return [];
    const q = query.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter(
      (d) =>
        d.fullName.toLowerCase().includes(q) ||
        (d.phone ?? '').toLowerCase().includes(q) ||
        (d.licenseNumber ?? '').toLowerCase().includes(q),
    );
  }, [drivers, query]);

  const activeCount = drivers?.filter((d) => d.active).length ?? 0;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>{t('drivers.title')}</h2>
        </div>
        {canManage && (
          <button className="btn primary" onClick={() => setEditing('new')}>
            {t('drivers.new')}
          </button>
        )}
      </header>

      <div className="page-toolbar">
        <div className="user-stats">
          <div className="user-stat">
            <b>{drivers?.length ?? '—'}</b>
            <span>{t('drivers.title')}</span>
          </div>
          <div className="user-stat brand">
            <b>{activeCount}</b>
            <span>{t('common.activeCount')}</span>
          </div>
        </div>

        <label className="search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('drivers.search')}
          />
        </label>
      </div>

      {error && <p className="banner err">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {!drivers ? (
        <p className="empty">{t('drivers.loading')}</p>
      ) : drivers.length === 0 ? (
        <p className="empty">{t('drivers.empty')}</p>
      ) : shown.length === 0 ? (
        <p className="empty">{t('drivers.noMatch')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.driver')}</th>
                <th>{t('common.phone')}</th>
                <th>{t('drivers.license')}</th>
                <th>{t('common.status')}</th>
                {canManage && <th aria-label={t('common.actions')} />}
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const busy = busyId === d.id;
                return (
                  <tr key={d.id} className={d.active ? '' : 'is-off'}>
                    <td>
                      <div className="cell-user">
                        <span className="avatar" aria-hidden="true">
                          {initials(d.fullName)}
                        </span>
                        <div>
                          <strong>{d.fullName}</strong>
                        </div>
                      </div>
                    </td>
                    <td className="cell-muted">{d.phone ?? '—'}</td>
                    <td className="cell-muted">{d.licenseNumber ?? '—'}</td>
                    <td>
                      <button
                        className={`switch ${d.active ? 'on' : ''}`}
                        role="switch"
                        aria-checked={d.active}
                        disabled={!canManage || busy}
                        onClick={() => void toggleActive(d)}
                      >
                        <i />
                        {d.active ? t('common.active') : t('common.inactive')}
                      </button>
                    </td>
                    {canManage && (
                      <td className="cell-actions">
                        <button className="btn ghost small" onClick={() => setEditing(d)} disabled={busy}>
                          {t('common.edit')}
                        </button>
                        <button className="btn danger small" onClick={() => setDeleting(d)} disabled={busy}>
                          {t('common.delete')}
                        </button>
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
        <DriverDialog
          driver={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={(driver) => {
            const created = editing === 'new';
            setEditing(null);
            void load();
            setError(null);
            setNotice(created ? `${driver.fullName} ajouté au référentiel.` : `${driver.fullName} mis à jour.`);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('drivers.deleteTitle')}
          message={`${deleting.fullName} sera définitivement retiré du référentiel. Un chauffeur qui a déjà effectué des voyages ne peut pas être supprimé : désactivez-le pour conserver l'historique.`}
          confirmLabel={t('common.delete')}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteDriver(deleting.id);
            const removed = deleting;
            setDeleting(null);
            setDrivers((list) => list?.filter((d) => d.id !== removed.id) ?? null);
            setError(null);
            setNotice(`${removed.fullName} supprimé du référentiel.`);
          }}
        />
      )}
    </main>
  );
}
