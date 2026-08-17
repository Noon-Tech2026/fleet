import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthUser, Role } from '../lib/types';
import { ROLE_RANK } from '../lib/types';
import { ROLE_LABEL, initials } from '../lib/roles';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CreateUserDialog } from './CreateUserDialog';
import { PasswordDialog } from './PasswordDialog';

export function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AuthUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api.users());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(user: AuthUser, changes: { role?: Role; active?: boolean }) {
    setBusyId(user.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateUser(user.id, changes);
      setUsers((list) => list?.map((u) => (u.id === updated.id ? updated : u)) ?? null);
      setNotice(
        changes.active === false
          ? `${updated.fullName} est désactivé — ses sessions ont été coupées.`
          : changes.active === true
            ? `${updated.fullName} est réactivé.`
            : `${updated.fullName} est désormais ${ROLE_LABEL[updated.role].toLowerCase()}.`,
      );
    } catch (err) {
      // Le serveur refuse notamment l'auto-rétrogradation : on remonte son
      // message tel quel plutôt qu'une formule maison qui divergerait.
      setError(err instanceof Error ? err.message : 'Modification refusée');
    } finally {
      setBusyId(null);
    }
  }

  const shown = useMemo(() => {
    if (!users) return [];
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, query]);

  const activeCount = users?.filter((u) => u.active).length ?? 0;
  const adminCount = users?.filter((u) => u.active && u.role === 'admin').length ?? 0;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h2>Utilisateurs</h2>
          <p>
            Les rôles sont cumulatifs et appliqués par le serveur : masquer un bouton ne protège
            rien, seul le rôle compte.
          </p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          Nouvel utilisateur
        </button>
      </header>

      <div className="page-toolbar">
        <div className="fleet-summary compact">
          <div className="summary-cell">
            <b>{users?.length ?? '—'}</b>
            <span>Comptes</span>
          </div>
          <div className="summary-cell ok">
            <b>{activeCount}</b>
            <span>Actifs</span>
          </div>
          <div className="summary-cell">
            <b>{adminCount}</b>
            <span>Administrateurs</span>
          </div>
        </div>

        <label className="search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un nom ou une adresse"
          />
        </label>
      </div>

      {error && <p className="banner err">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {!users ? (
        <p className="empty">Chargement des comptes…</p>
      ) : shown.length === 0 ? (
        <p className="empty">Aucun compte ne correspond à cette recherche.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Rôle</th>
                <th>État</th>
                <th>Dernière connexion</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const isSelf = u.id === me?.id;
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} className={u.active ? '' : 'is-off'}>
                    <td>
                      <div className="cell-user">
                        <span className="avatar" aria-hidden="true">
                          {initials(u.fullName)}
                        </span>
                        <div>
                          <strong>
                            {u.fullName}
                            {isSelf && <em className="self">vous</em>}
                          </strong>
                          <span>{u.email}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      <select
                        className="select"
                        value={u.role}
                        disabled={isSelf || busy}
                        // Le serveur interdit de modifier son propre rôle ;
                        // le champ est grisé pour ne pas proposer un 403.
                        title={isSelf ? 'Vous ne pouvez pas modifier votre propre rôle' : undefined}
                        onChange={(e) => void patch(u, { role: e.target.value as Role })}
                      >
                        {ROLE_RANK.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <button
                        className={`switch ${u.active ? 'on' : ''}`}
                        role="switch"
                        aria-checked={u.active}
                        disabled={isSelf || busy}
                        title={isSelf ? 'Vous ne pouvez pas vous désactiver' : undefined}
                        onClick={() => void patch(u, { active: !u.active })}
                      >
                        <i />
                        {u.active ? 'Actif' : 'Désactivé'}
                      </button>
                    </td>

                    <td className="cell-muted">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString('fr-FR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : 'Jamais connecté'}
                    </td>

                    <td className="cell-actions">
                      <button className="btn ghost small" onClick={() => setResetting(u)}>
                        Mot de passe
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateUserDialog
          onCancel={() => setCreating(false)}
          onCreated={(user, password) => {
            setCreating(false);
            setUsers((list) => [...(list ?? []), user]);
            setError(null);
            setNotice(`Compte créé pour ${user.fullName}. Mot de passe initial : ${password}`);
          }}
        />
      )}

      {resetting && (
        <PasswordDialog
          user={resetting}
          isSelf={resetting.id === me?.id}
          onCancel={() => setResetting(null)}
          onDone={(password) => {
            const target = resetting;
            setResetting(null);
            setError(null);
            setNotice(`Mot de passe de ${target.fullName} réinitialisé : ${password}`);
          }}
        />
      )}
    </main>
  );
}
