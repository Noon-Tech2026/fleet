import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl, { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { TrackPoint } from '../lib/types';
import { api } from '../api/client';

interface Props {
  vehicleId: string;
  plate: string;
  onClose: () => void;
}

const MAP_STYLE = import.meta.env.VITE_MAP_STYLE as string | undefined;
const PLAIN_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f3f0e8' } }],
};
const STOP_SPEED = 3; // km/h
const STOP_MIN_MS = 5 * 60_000;
const MAX_POINTS = 5000; // limite du serveur
const MAX_JUMP_KM = 5; // saut GPS improbable entre deux trames : ignore dans le cumul

interface Stop {
  lat: number;
  lon: number;
  from: string;
  to: string;
  minutes: number;
}

interface Summary {
  km: number;
  maxSpeed: number;
  movingMin: number;
  stoppedMin: number;
  stops: Stop[];
}

function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function summarize(points: TrackPoint[]): Summary {
  let km = 0;
  let maxSpeed = 0;
  let movingMs = 0;
  let stoppedMs = 0;
  const stops: Stop[] = [];
  let stopStart: TrackPoint | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    maxSpeed = Math.max(maxSpeed, p.speed);
    if (i > 0) {
      const prev = points[i - 1];
      const dt = Date.parse(p.recordedAt) - Date.parse(prev.recordedAt);
      const d = haversineKm(prev, p);
      if (d < MAX_JUMP_KM) km += d;
      if (prev.speed > STOP_SPEED) movingMs += dt;
      else stoppedMs += dt;
    }
    if (p.speed <= STOP_SPEED) {
      if (stopStart === null) stopStart = p;
    } else if (stopStart !== null) {
      const ms = Date.parse(p.recordedAt) - Date.parse(stopStart.recordedAt);
      if (ms >= STOP_MIN_MS) stops.push({ lat: stopStart.lat, lon: stopStart.lon, from: stopStart.recordedAt, to: p.recordedAt, minutes: Math.round(ms / 60_000) });
      stopStart = null;
    }
  }
  if (stopStart !== null && points.length > 0) {
    const last = points[points.length - 1];
    const ms = Date.parse(last.recordedAt) - Date.parse(stopStart.recordedAt);
    if (ms >= STOP_MIN_MS) stops.push({ lat: stopStart.lat, lon: stopStart.lon, from: stopStart.recordedAt, to: last.recordedAt, minutes: Math.round(ms / 60_000) });
  }
  return { km, maxSpeed, movingMin: Math.round(movingMs / 60_000), stoppedMin: Math.round(stoppedMs / 60_000), stops };
}

/** Valeur pour <input type="datetime-local"> en heure locale. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/**
 * Historique des mouvements d'un camion entre deux instants : trace sur
 * carte, arrets, resume. Lecture seule ; les donnees viennent de la table
 * positions (echantillonnee par PositionsService), pas de Traccar.
 */
export function TrackHistoryDialog({ vehicleId, plate, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const now = new Date();
  const [from, setFrom] = useState(toLocalInput(new Date(now.getTime() - 24 * 3600_000)));
  const [to, setTo] = useState(toLocalInput(now));
  const [points, setPoints] = useState<TrackPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPoints, setShowPoints] = useState(false);

  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  async function load(f = from, tt = to) {
    setLoading(true);
    setError(null);
    try {
      const list = await api.vehicleTrack(vehicleId, new Date(f).toISOString(), new Date(tt).toISOString());
      list.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
      setPoints(list);
    } catch {
      setError(t('track.error'));
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }

  function preset(hours: number | 'today') {
    const end = new Date();
    const start = hours === 'today' ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : new Date(end.getTime() - hours * 3600_000);
    const f = toLocalInput(start);
    const tt = toLocalInput(end);
    setFrom(f);
    setTo(tt);
    void load(f, tt);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  const summary = useMemo(() => (points && points.length > 1 ? summarize(points) : null), [points]);

  // Carte : construite une fois, trace redessinee a chaque chargement.
  useEffect(() => {
    if (container.current === null || map.current !== null) return;
    map.current = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE || PLAIN_STYLE,
      center: [-15.93, 18.1],
      zoom: 10,
      attributionControl: false,
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (m === null || points === null) return;

    const draw = () => {
      markers.current.forEach((mk) => mk.remove());
      markers.current = [];
      const coords = points.map((p) => [p.lon, p.lat]);
      const data: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [],
      };
      const src = m.getSource('track') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data);
      else {
        m.addSource('track', { type: 'geojson', data });
        m.addLayer({ id: 'track-casing', type: 'line', source: 'track', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } });
        m.addLayer({ id: 'track-line', type: 'line', source: 'track', paint: { 'line-color': '#12704F', 'line-width': 4 } });
      }
      if (coords.length === 0) return;

      const mk = (lngLat: [number, number], cls: string, title: string) => {
        const el = document.createElement('div');
        el.className = `track-marker ${cls}`;
        el.title = title;
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(m);
        markers.current.push(marker);
      };
      mk(coords[0] as [number, number], 'start', t('track.start'));
      mk(coords[coords.length - 1] as [number, number], 'end', t('track.end'));
      summary?.stops.forEach((s) => mk([s.lon, s.lat], 'stop', `${fmtDuration(s.minutes)}`));

      const bounds = coords.reduce((b, c) => b.extend(c as [number, number]), new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]));
      m.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 400 });
    };

    if (m.isStyleLoaded()) draw();
    else m.once('load', draw);
  }, [points, summary, t]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-head">
          <div>
            <h2>{t('track.title')}</h2>
            <p>
              {vehicleId} · <bdi dir="ltr">{plate}</bdi>
            </p>
          </div>
          <button className="btn ghost" onClick={onClose}>{t('track.close')}</button>
        </header>

        <div className="track-controls">
          <label>
            {t('track.from')}
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            {t('track.to')}
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn mint" disabled={loading} onClick={() => void load()}>{loading ? t('track.loading') : t('track.load')}</button>
          <span className="presets">
            <button className="btn ghost small" onClick={() => preset('today')}>{t('track.today')}</button>
            <button className="btn ghost small" onClick={() => preset(24)}>{t('track.last24h')}</button>
            <button className="btn ghost small" onClick={() => preset(24 * 7)}>{t('track.last7d')}</button>
          </span>
        </div>

        {error && <p className="notice">{error}</p>}
        {points !== null && points.length >= MAX_POINTS && <p className="notice">{t('track.tooMany', { n: MAX_POINTS })}</p>}

        <div className="track-map" ref={container} />

        {points !== null && points.length === 0 && loading === false && <p className="empty">{t('track.empty')}</p>}

        {summary && (
          <dl className="stats track-stats">
            <div><dt>{t('track.distance')}</dt><dd>{summary.km.toLocaleString(locale, { maximumFractionDigits: 1 })} km</dd></div>
            <div><dt>{t('track.maxSpeed')}</dt><dd>{summary.maxSpeed} km/h</dd></div>
            <div><dt>{t('track.moving')}</dt><dd>{fmtDuration(summary.movingMin)}</dd></div>
            <div><dt>{t('track.stopped')}</dt><dd>{fmtDuration(summary.stoppedMin)}</dd></div>
            <div><dt>{t('track.stops')}</dt><dd>{summary.stops.length}</dd></div>
            <div><dt>{t('track.points')}</dt><dd>{points?.length ?? 0}</dd></div>
          </dl>
        )}

        {summary && summary.stops.length > 0 && (
          <table className="track-table">
            <thead><tr><th>{t('track.stops')}</th><th>{t('track.from')}</th><th>{t('track.to')}</th><th>{t('track.position')}</th></tr></thead>
            <tbody>
              {summary.stops.map((s, i) => (
                <tr key={i}>
                  <td>{fmtDuration(s.minutes)}</td>
                  <td>{new Date(s.from).toLocaleString(locale, { hour12: false })}</td>
                  <td>{new Date(s.to).toLocaleString(locale, { hour12: false })}</td>
                  <td dir="ltr">{s.lat.toFixed(5)}, {s.lon.toFixed(5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {points !== null && points.length > 0 && (
          <>
            <button className="btn ghost small" onClick={() => setShowPoints((v) => v === false)}>
              {showPoints ? t('track.hidePoints') : t('track.showPoints')}
            </button>
            {showPoints && (
              <div className="track-scroll">
                <table className="track-table">
                  <thead><tr><th>{t('track.time')}</th><th>{t('track.speed')}</th><th>{t('track.position')}</th></tr></thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.id}>
                        <td>{new Date(p.recordedAt).toLocaleString(locale, { hour12: false })}</td>
                        <td>{p.speed} km/h</td>
                        <td dir="ltr">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</td>
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
