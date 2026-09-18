import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClientRecord } from '../lib/types';
import { initials } from '../lib/roles';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ClientDialog } from './ClientDialog';

export function ClientsPage() {
  const { can } = useAuth();
  const canManage = can('supervisor');
  const [clients, setClients] = useState<ClientRecord[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // null : fermé. 'new' : création. Une fiche : modification.
  const [editing, setEditing] = useState<ClientRecord | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ClientRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Relue après chaque écriture : la base fait foi, pas la réponse d'un PATCH,
  // qui peut être partielle selon la version du serveur.
  const load = useCallback(async () => {
    try {
      setClients(await api.clients());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(client: ClientRecord) {
    setBusyId(client.id);
    setError(null);
    setNotice(null);
    try {
      await api.updateClient(client.id, { active: !client.active });
      await load();
      setNotice(
        client.active
          ? `${client.name} est désactivé — il n'est plus proposé pour un nouveau voyage.`
          : `${client.name} est réactivé.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Modification refusée');
    } finally {
      setBusyId(null);
    }
  }

  const shown = useMemo(() => {
    if (!clients) return [];
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.contact ?? '').toLowerCase().includes(q) ||
        (c.notes ?? '').toLowerCase().includes(q),
    );
  }, [clients, query]);

  const activeCount = clients?.filter((c) => c.active).length ?? 0;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>Clients</h2>
        </div>
        {canManage && (
          <button className="btn primary" onClick={() => setEditing('new')}>
            Nouveau client
          </button>
        )}
      </header>

      <div className="page-toolbar">
        <div className="user-stats">
          <div className="user-stat">
            <b>{clients?.length ?? '—'}</b>
            <span>Clients</span>
          </div>
          <div className="user-stat brand">
            <b>{activeCount}</b>
            <span>Actifs</span>
          </div>
        </div>

        <label className="search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un nom, un contact ou une note"
          />
        </label>
      </div>

      {error && <p className="banner err">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {!clients ? (
        <p className="empty">Chargement des clients…</p>
      ) : clients.length === 0 ? (
        <p className="empty">Aucun client au référentiel.</p>
      ) : shown.length === 0 ? (
        <p className="empty">Aucun client ne correspond à cette recherche.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Contact</th>
                <th>Notes</th>
                <th>État</th>
                {canManage && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const busy = busyId === c.id;
                return (
                  <tr key={c.id} className={c.active ? '' : 'is-off'}>
                    <td>
                      <div className="cell-user">
                        <span className="avatar" aria-hidden="true">
                          {initials(c.name)}
                        </span>
                        <div>
                          <strong>{c.name}</strong>
                        </div>
                      </div>
                    </td>
                    <td className="cell-muted">{c.contact ?? '—'}</td>
                    <td className="cell-muted">{c.notes ?? '—'}</td>
                    <td>
                      <button
                        className={`switch ${c.active ? 'on' : ''}`}
                        role="switch"
                        aria-checked={c.active}
                        disabled={!canManage || busy}
                        onClick={() => void toggleActive(c)}
                      >
                        <i />
                        {c.active ? 'Actif' : 'Désactivé'}
                      </button>
                    </td>
                    {canManage && (
                      <td className="cell-actions">
                        <button className="btn ghost small" onClick={() => setEditing(c)} disabled={busy}>
                          Modifier
                        </button>
                        <button className="btn danger small" onClick={() => setDeleting(c)} disabled={busy}>
                          Supprimer
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
        <ClientDialog
          client={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={(client) => {
            const created = editing === 'new';
            setEditing(null);
            void load();
            setError(null);
            setNotice(created ? `${client.name} ajouté au référentiel.` : `${client.name} mis à jour.`);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Supprimer le client"
          message={`${deleting.name} sera définitivement retiré du référentiel. Un client déjà facturé ne peut pas être supprimé : désactivez-le pour conserver l'historique.`}
          confirmLabel="Supprimer"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteClient(deleting.id);
            const removed = deleting;
            setDeleting(null);
            setClients((list) => list?.filter((c) => c.id !== removed.id) ?? null);
            setError(null);
            setNotice(`${removed.name} supprimé du référentiel.`);
          }}
        />
      )}
    </main>
  );
}
