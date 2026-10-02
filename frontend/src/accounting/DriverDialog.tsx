import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DriverRecord } from '../lib/types';
import { api } from '../api/client';

interface Props {
  /** Absent : création. Présent : modification de cette fiche. */
  driver?: DriverRecord;
  onCancel: () => void;
  onSaved: (driver: DriverRecord) => void;
}

export function DriverDialog({ driver, onCancel, onSaved }: Props) {
  const { t } = useTranslation();
  const editing = driver !== undefined;
  const [fullName, setFullName] = useState(driver?.fullName ?? '');
  const [phone, setPhone] = useState(driver?.phone ?? '');
  const [licenseNumber, setLicenseNumber] = useState(driver?.licenseNumber ?? '');
  const [tripFee, setTripFee] = useState(driver?.tripFee != null ? String(driver.tripFee) : '0');
  const [vehicleId, setVehicleId] = useState<string>(driver?.vehicleId ?? '');
  const [vehicles, setVehicles] = useState<{ id: string; plate?: string | null }[]>([]);
  useEffect(() => { api.fleetVehicles().then((v) => setVehicles(v as { id: string; plate?: string | null }[])).catch(() => setVehicles([])); }, []);
  const [monthlySalary, setMonthlySalary] = useState(driver?.monthlySalary != null ? String(driver.monthlySalary) : '0');
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
        ? await api.updateDriver(driver.id, {
            fullName: fullName.trim(),
            phone: phone.trim() || null,
            licenseNumber: licenseNumber.trim() || null,
        tripFee: Number(tripFee) || 0,
        monthlySalary: Number(monthlySalary) || 0,
        vehicleId: vehicleId || null,
          })
        : await api.createDriver({
            fullName: fullName.trim(),
            phone: phone.trim() || undefined,
            licenseNumber: licenseNumber.trim() || undefined,
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
        aria-labelledby="driver-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="driver-dialog-title">{editing ? t('drivers.editTitle') : t('drivers.new')}</h2>

        <label className="field">
          <span>{t('drivers.name')}</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} autoFocus />
        </label>

        <label className="field">
          <span>{t('drivers.phoneOpt')}</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>

        <label className="field">
          <span>{t('drivers.licenseOpt')}</span>
          <input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
        </label>

        <label className="field">
          <span>{t('drivers.tripFee')}</span>
          <input type="number" min="0" step="1" value={tripFee} onChange={(e) => setTripFee(e.target.value)} />
          <p className="hint">{t('drivers.tripFeeHint')}</p>
        </label>

        <label className="field">
          <span>{t('drivers.vehicle')}</span>
          <select className="select" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">{t('drivers.noVehicle')}</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.id}{v.plate ? ` · ${v.plate}` : ''}</option>)}
          </select>
        </label>

        <label className="field">
          <span>{t('drivers.salary')}</span>
          <input type="number" min="0" step="1" value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Enregistrement…' : editing ? t('common.save') : t('drivers.add')}
          </button>
        </div>
      </form>
    </div>
  );
}
