import { useEffect, useState } from 'react';
import type { AuthUser } from '../lib/types';
import { PASSWORD_MIN_LENGTH, generatePassword } from '../lib/roles';
import { api } from '../api/client';
import { PasswordField } from './PasswordField';

interface Props {
  user: AuthUser;
  isSelf: boolean;
  onCancel: () => void;
  onDone: (password: string) => void;
}

export function PasswordDialog({ user, isSelf, onCancel, onDone }: Props) {
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
      await api.resetUserPassword(user.id, password);
      onDone(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Réinitialisation impossible');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="password-dialog-title">Mot de passe — {user.fullName}</h2>

        <div className="warning">
          <strong>Toutes les sessions ouvertes de ce compte seront fermées.</strong>
          {isSelf
            ? ' Vous serez déconnecté immédiatement et devrez vous reconnecter avec ce nouveau mot de passe.'
            : " L'utilisateur devra se reconnecter avec ce nouveau mot de passe."}
        </div>

        <PasswordField label="Nouveau mot de passe" value={password} onChange={setPassword} />

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn danger" disabled={busy}>
            {busy ? 'Envoi…' : 'Réinitialiser'}
          </button>
        </div>
      </form>
    </div>
  );
}
