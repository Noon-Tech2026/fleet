import { useEffect, useState } from 'react';
import type { DriverRecord } from '../lib/types';
import { api } from '../api/client';

interface Props {
  onCancel: () => void;
  onCreated: (driver: DriverRecord) => void;
}

export function CreateDriverDialog({ onCancel, onCreated }: Props) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
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
      const driver = await api.createDriver({
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        licenseNumber: licenseNumber.trim() || undefined,
      });
      onCreated(driver);
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
        aria-labelledby="create-driver-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="create-driver-title">Nouveau chauffeur</h2>

        <label className="field">
          <span>Nom complet</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
        </label>

        <label className="field">
          <span>Téléphone (optionnel)</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>

        <label className="field">
          <span>N° de permis (optionnel)</span>
          <input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Création…' : 'Ajouter le chauffeur'}
          </button>
        </div>
      </form>
    </div>
  );
}
