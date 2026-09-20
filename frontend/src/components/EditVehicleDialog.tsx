import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

interface Props {
  vehicleId: string;
  onCancel: () => void;
  onSaved: (vehicleId: string) => void;
}

export function EditVehicleDialog({ vehicleId, onCancel, onSaved }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [plate, setPlate] = useState('');
  const [imei, setImei] = useState('');
  const [simNumber, setSimNumber] = useState('');
  const [odometer, setOdometer] = useState('');
  const [tankMain, setTankMain] = useState('700');
  const [tankAux, setTankAux] = useState('300');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La fiche administrative vient du repertoire, pas du flux SSE.
  useEffect(() => {
    api
      .fleetVehicles()
      .then((rows) => {
        const row = rows.find((r) => r.id === vehicleId);
        if (!row) throw new Error(t('editTruck.error'));
        setPlate(row.plate);
        setImei(row.imei);
        setSimNumber(row.simNumber ?? '');
        setOdometer(row.initialOdometer != null ? String(row.initialOdometer) : '');
        setTankMain(String(row.tankMainCapacity ?? 700));
        setTankAux(String(row.tankAuxCapacity ?? 300));
        setModel(row.model ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('editTruck.error')))
      .finally(() => setLoading(false));
  }, [vehicleId, t]);

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
      await api.updateVehicle(vehicleId, {
        plate: plate.trim(),
        simNumber: simNumber.trim() || undefined,
        initialOdometer: odometer !== '' ? Number(odometer) : undefined,
        tankMainCapacity: tankMain !== '' ? Number(tankMain) : undefined,
        tankAuxCapacity: tankAux !== '' ? Number(tankAux) : undefined,
        model: model.trim() || undefined,
      });
      onSaved(vehicleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('editTruck.error'));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-vehicle-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="edit-vehicle-title">{t('editTruck.title', { id: vehicleId })}</h2>

        <label className="field">
          <span>{t('editTruck.code')}</span>
          <input value={vehicleId} disabled />
        </label>

        <label className="field">
          <span>{t('editTruck.plate')}</span>
          <input value={plate} onChange={(e) => setPlate(e.target.value)} required disabled={loading} autoFocus />
        </label>

        <label className="field">
          <span>{t('editTruck.imei')}</span>
          <input value={imei} disabled />
          <p className="hint">{t('editTruck.imeiHint')}</p>
        </label>

        <label className="field">
          <span>{t('editTruck.sim')}</span>
          <input value={simNumber} onChange={(e) => setSimNumber(e.target.value)} placeholder={t('vehicle.simPlaceholder')} disabled={loading} />
        </label>

        <label className="field">
          <span>{t('editTruck.odometer')}</span>
          <input type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="0" disabled={loading} />
          <p className="hint">{t('editTruck.odometerHint')}</p>
        </label>
        <div className="field-row">
          <label>
            <span>{t('vehicle.tankMain')}</span>
            <input type="number" min="1" max="2000" value={tankMain} onChange={(e) => setTankMain(e.target.value)} disabled={loading} />
          </label>
          <label>
            <span>{t('vehicle.tankAux')}</span>
            <input type="number" min="0" max="2000" value={tankAux} onChange={(e) => setTankAux(e.target.value)} disabled={loading} />
          </label>
        </div>

        <label className="field">
          <span>{t('editTruck.model')}</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="SHACMAN F3000" disabled={loading} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {t('vehicle.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy || loading}>
            {busy ? t('vehicle.submitting') : t('editTruck.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
