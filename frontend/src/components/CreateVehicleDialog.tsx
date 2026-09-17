import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface Props {
  onCancel: () => void;
  onCreated: (vehicleId: string) => void;
}

export function CreateVehicleDialog({ onCancel, onCreated }: Props) {
  const [id, setId] = useState('');
  const [plate, setPlate] = useState('');
  const [imei, setImei] = useState('');
  const [model, setModel] = useState('');
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
      const vehicle = await api.createVehicle({
        id: id.trim(),
        plate: plate.trim(),
        imei: imei.trim(),
        model: model.trim() || undefined,
      });
      onCreated(vehicle.id);
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
        aria-labelledby="create-vehicle-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="create-vehicle-title">Nouveau camion</h2>

        <label className="field">
          <span>Code véhicule</span>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="C-06" required autoFocus />
        </label>

        <label className="field">
          <span>Plaque d'immatriculation</span>
          <input value={plate} onChange={(e) => setPlate(e.target.value)} required />
        </label>

        <label className="field">
          <span>IMEI du boîtier</span>
          <input value={imei} onChange={(e) => setImei(e.target.value)} required />
        </label>

        <label className="field">
          <span>Modèle (optionnel)</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="SHACMAN F3000" />
        </label>

        <p className="modal-note">
          Le camion est ajouté au répertoire et apparaîtra dans la flotte dès la réception de sa
          première position par le boîtier. Le chauffeur s'affecte au moment de créer un voyage,
          pas ici.
        </p>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Création…' : 'Ajouter le camion'}
          </button>
        </div>
      </form>
    </div>
  );
}
