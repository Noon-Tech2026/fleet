import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientRecord } from '../lib/types';
import { api } from '../api/client';

interface Props {
  /** Absent : création. Présent : modification de cette fiche. */
  client?: ClientRecord;
  onCancel: () => void;
  onSaved: (client: ClientRecord) => void;
}

export function ClientDialog({ client, onCancel, onSaved }: Props) {
  const { t } = useTranslation();
  const editing = client !== undefined;
  const [name, setName] = useState(client?.name ?? '');
  const [contact, setContact] = useState(client?.contact ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');
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
      // En modification, un champ vidé part à null pour être effacé côté
      // serveur ; omis, il resterait à son ancienne valeur.
      const saved = editing
        ? await api.updateClient(client.id, {
            name: name.trim(),
            contact: contact.trim() || null,
            notes: notes.trim() || null,
          })
        : await api.createClient({
            name: name.trim(),
            contact: contact.trim() || undefined,
            notes: notes.trim() || undefined,
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="client-dialog-title">{editing ? t('clients.editTitle') : t('clients.new')}</h2>

        <label className="field">
          <span>{t('clients.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
        </label>

        <label className="field">
          <span>{t('clients.contactOpt')}</span>
          <input value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>

        <label className="field">
          <span>{t('clients.notesOpt')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Enregistrement…' : editing ? t('common.save') : t('clients.add')}
          </button>
        </div>
      </form>
    </div>
  );
}
