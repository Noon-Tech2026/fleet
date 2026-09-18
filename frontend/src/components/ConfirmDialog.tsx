import { useEffect, useState } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  /** Une erreur levée ici reste affichée dans le dialogue, qui ne se ferme pas. */
  onConfirm: () => Promise<void>;
}

export function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action refusée');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        <p className="modal-note">{message}</p>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy} autoFocus>
            Annuler
          </button>
          <button className="btn danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Suppression…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
