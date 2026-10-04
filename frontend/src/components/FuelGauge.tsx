import { useTranslation } from 'react-i18next';

export interface FuelSensorInfo {
  raw?: number;
  calibrated: boolean;
  tempC?: number;
  battery?: number;
}

interface Props {
  liters: number;
  capacity: number;
  label: string;
  /** Capteur BLE (absent = sonde analogique ou pas de capteur). */
  sensor?: FuelSensorInfo | null;
}

/**
 * Les deux réservoirs sont affichés séparément et jamais additionnés :
 * c'est la lecture séparée qui rend un siphonnage visible.
 * Capteur non calibré : pas de litres affichés (un « 0 L » rouge serait faux).
 */
export function FuelGauge({ liters, capacity, label, sensor }: Props) {
  const { t } = useTranslation();
  const uncalibrated = sensor != null && sensor.calibrated === false;
  const ratio = uncalibrated ? 0 : Math.max(0, Math.min(1, liters / capacity));
  const tone = uncalibrated ? 'var(--faint)' : ratio < 0.15 ? 'var(--red)' : ratio < 0.3 ? 'var(--amber)' : 'var(--mint)';
  const extra = sensor
    ? [
        sensor.tempC !== undefined ? `${Math.round(sensor.tempC)} °C` : null,
        sensor.battery !== undefined ? `${t('supervision.sensorBattery', 'pile')} ${sensor.battery} %` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="fuel">
      <div
        className="fuel-tank"
        role="img"
        aria-label={
          uncalibrated
            ? `${label} : ${t('supervision.fuelUncalibrated', 'Capteur non calibré')}`
            : `${label} : ${Math.round(liters)} litres sur ${capacity}`
        }
      >
        <div className="fuel-level" style={{ height: `${ratio * 100}%`, background: tone, color: tone }} />
      </div>
      {uncalibrated ? (
        <div className="fuel-value" style={{ color: tone, fontSize: '13px', lineHeight: 1.3 }}>
          {t('supervision.fuelUncalibrated', 'Capteur non calibré')}
          {sensor?.raw !== undefined && (
            <div style={{ fontSize: '12px', fontWeight: 500 }}>
              {t('supervision.fuelRaw', 'brut')} {sensor.raw}
            </div>
          )}
        </div>
      ) : (
        <div className="fuel-value" style={{ color: tone }}>
          {Math.round(liters)} <span>L</span>
        </div>
      )}
      <div className="fuel-label">{label}</div>
      <div className="fuel-cap">{t('supervision.capacity', { capacity })}</div>
      {extra && <div className="fuel-cap">{extra}</div>}
    </div>
  );
}
