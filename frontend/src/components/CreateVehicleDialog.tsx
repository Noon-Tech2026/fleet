import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

interface Props {
  onCancel: () => void;
  onCreated: (vehicleId: string) => void;
}

export function CreateVehicleDialog({ onCancel, onCreated }: Props) {
  const { t } = useTranslation();
  const [id, setId] = useState('');
  const [plate, setPlate] = useState('');
  const [imei, setImei] = useState('');
  const [simNumber, setSimNumber] = useState('');
  const [initialOdometer, setInitialOdometer] = useState('');
  const [tankMain, setTankMain] = useState('700');
  const [tankAux, setTankAux] = useState('300');
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
        simNumber: simNumber.trim() || undefined,
        initialOdometer: initialOdometer ? Number(initialOdometer) : undefined,
        tankMainCapacity: tankMain ? Number(tankMain) : undefined,
        tankAuxCapacity: tankAux ? Number(tankAux) : undefined,
        model: model.trim() || undefined,
      });
      onCreated(vehicle.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('vehicle.error'));
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
        <h2 id="create-vehicle-title">{t('vehicle.title')}</h2>

        <label className="field">
          <span>{t('vehicle.code')}</span>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="C-06" required autoFocus />
        </label>

        <label className="field">
          <span>{t('vehicle.plate')}</span>
          <input value={plate} onChange={(e) => setPlate(e.target.value)} required />
        </label>

        <label className="field">
          <span>{t('vehicle.imei')}</span>
          <input value={imei} onChange={(e) => setImei(e.target.value)} required />
        </label>

        <label className="field">
          <span>{t('vehicle.sim')}</span>
          <input value={simNumber} onChange={(e) => setSimNumber(e.target.value)} placeholder={t('vehicle.simPlaceholder')} />
        </label>

        <label className="field">
          <span>{t('vehicle.odometer')}</span>
          <input type="number" min="0" value={initialOdometer} onChange={(e) => setInitialOdometer(e.target.value)} placeholder="0" />
          <p className="hint">{t('vehicle.odometerHint')}</p>
        </label>
        <div className="field-row">
          <label>
            <span>{t('vehicle.tankMain')}</span>
            <input type="number" min="1" max="2000" value={tankMain} onChange={(e) => setTankMain(e.target.value)} />
          </label>
          <label>
            <span>{t('vehicle.tankAux')}</span>
            <input type="number" min="0" max="2000" value={tankAux} onChange={(e) => setTankAux(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>{t('vehicle.model')}</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="SHACMAN F3000" />
        </label>

        <p className="modal-note">{t('vehicle.note')}</p>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {t('vehicle.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? t('vehicle.submitting') : t('vehicle.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
