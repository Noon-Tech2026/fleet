import { useEffect, useState } from 'react';
import type { ClientRecord } from '../lib/types';
import { api } from '../api/client';

interface Props {
  onCancel: () => void;
  onCreated: (client: ClientRecord) => void;
}

export function CreateClientDialog({ onCancel, onCreated }: Props) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
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
    setBusy(true);
    setError(null);
    try {
      const client = await api.createClient({
        name: name.trim(),
        contact: contact.trim() || undefined,
      });
      onCreated(client);
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
        aria-labelledby="create-client-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="create-client-title">Nouveau client</h2>

        <label className="field">
          <span>Nom du client</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>

        <label className="field">
          <span>Contact (téléphone ou email, optionnel)</span>
          <input value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Création…' : 'Ajouter le client'}
          </button>
        </div>
      </form>
    </div>
  );
}
