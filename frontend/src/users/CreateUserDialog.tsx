import { useEffect, useState } from 'react';
import type { AuthUser, Role } from '../lib/types';
import { ROLE_RANK } from '../lib/types';
import { PASSWORD_MIN_LENGTH, ROLE_HINT, ROLE_LABEL, generatePassword } from '../lib/roles';
import { api } from '../api/client';
import { PasswordField } from './PasswordField';

interface Props {
  onCancel: () => void;
  onCreated: (user: AuthUser, password: string) => void;
}

export function CreateUserDialog({ onCancel, onCreated }: Props) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [password, setPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await api.createUser({ email: email.trim(), fullName, role, password });
      onCreated(user, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="create-user-title">Nouvel utilisateur</h2>

        <label className="field">
          <span>Nom complet</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
        </label>

        <label className="field">
          <span>Adresse email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            required
          />
        </label>

        <label className="field">
          <span>Rôle</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLE_RANK.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <p className="role-hint">{ROLE_HINT[role]}</p>

        <PasswordField label="Mot de passe initial" value={password} onChange={setPassword} />

        <p className="modal-note">
          Notez ce mot de passe avant de valider : il n'est plus consultable ensuite, seule une
          réinitialisation permet d'en fixer un nouveau.
        </p>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Création…' : 'Créer le compte'}
          </button>
        </div>
      </form>
    </div>
  );
}
