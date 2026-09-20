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
