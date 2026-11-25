import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

type Report = Awaited<ReturnType<typeof api.vehicleIdle>>;

interface Props {
  vehicleId: string;
  plate: string;
  onClose: () => void;
}

/** Nuit = debut entre 20 h et 6 h (heure locale). */
const isNight = (iso: string) => {
  const h = new Date(iso).getHours();
  return h >= 20 || h < 6;
};

function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/** Periodes moteur tournant camion arrete > 10 min (jour et nuit). */
export function IdleLogDialog({ vehicleId, plate, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [days, setDays] = useState(3);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    api.vehicleIdle(vehicleId, from.toISOString(), to.toISOString())
      .then((r) => { if (alive) setData(r); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [vehicleId, days]);

  const list = data?.sessions ?? [];
  const totalMin = list.reduce((a, x) => a + x.minutes, 0);
  const totalL = list.reduce((a, x) => a + x.liters, 0);
  const nights = list.filter((x) => isNight(x.from)).length;
  const dt = (iso: string) =>
    new Date(iso).toLocaleString(locale, { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <h2>{t('idle.title', 'Moteur tournant à l\'arrêt')}</h2>
            <p>
              {vehicleId} · <bdi dir="ltr">{plate}</bdi>
              {data?.driver && <> · <b>{data.driver}</b></>}
            </p>
          </div>
          <button className="btn ghost" onClick={onClose}>{t('track.close')}</button>
        </header>

        <div className="track-controls">
          <span className="presets">
            {[1, 3, 7].map((d) => (
              <button key={d} className={`btn small ${days === d ? 'mint' : 'ghost'}`} onClick={() => setDays(d)}>
                {d === 1 ? t('idle.last24h', '24 h') : t('idle.lastDays', { count: d, defaultValue: '{{count}} jours' })}
              </button>
            ))}
          </span>
          <span className="muted small">{t('idle.rule', 'Contact mis, camion arrêté, plus de 10 min. Gasoil estimé à 3 L/h.')}</span>
        </div>

        {loading && <p className="muted">{t('track.loading')}</p>}
        {error && <p className="notice">{t('idle.error', 'Historique indisponible pour le moment.')}</p>}
        {data && data.supported === false && <p className="notice">{t('idle.unsupported', 'Historique non disponible pour ce boîtier.')}</p>}

        {data && !loading && (
          <>
            <dl className="stats track-stats">
              <div><dt>{t('idle.count', 'Périodes')}</dt><dd>{list.length}</dd></div>
              <div><dt>{t('idle.total', 'Durée totale')}</dt><dd>{fmtDur(totalMin)}</dd></div>
              <div><dt>{t('idle.fuel', 'Gasoil estimé')}</dt><dd>≈ {Math.round(totalL)} L</dd></div>
              <div><dt>{t('idle.nights', 'La nuit')}</dt><dd>{nights}</dd></div>
            </dl>

            {list.length === 0 ? (
              <p className="empty">{t('idle.empty', 'Aucune période de plus de 10 min sur cette durée.')}</p>
            ) : (
              <div className="track-scroll">
                <table className="track-table">
                  <thead>
                    <tr>
                      <th>{t('track.from')}</th>
                      <th>{t('track.to')}</th>
                      <th>{t('idle.duration', 'Durée')}</th>
                      <th>{t('idle.fuel', 'Gasoil estimé')}</th>
                      <th>{t('idle.place', 'Lieu')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.from} className={isNight(s.from) ? 'idle-row-night' : undefined}>
                        <td>
                          {dt(s.from)}
                          {isNight(s.from) && <span className="idle-night">{t('idle.night', 'Nuit')}</span>}
                        </td>
                        <td>
                          {dt(s.to)}
                          {s.ongoing && <span className="idle-live">{t('idle.ongoing', 'en cours')}</span>}
                        </td>
                        <td><b>{fmtDur(s.minutes)}</b></td>
                        <td>≈ {s.liters.toLocaleString(locale, { maximumFractionDigits: 1 })} L</td>
                        <td>
                          {s.zone ? <b>{s.zone}</b> : null}{' '}
                          <a href={`https://www.google.com/maps?q=${s.lat},${s.lon}`} target="_blank" rel="noreferrer" dir="ltr">
                            {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
