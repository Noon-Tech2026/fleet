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

  // Lecteur : progression 0..1 sur la duree totale, facteur = secondes
  // simulees par seconde reelle (x60 : une minute de trajet par seconde).
  const [playing, setPlaying] = useState(false);
  const [factor, setFactor] = useState(60);
  const [progress, setProgress] = useState(0);
  const truck = useRef<maplibregl.Marker | null>(null);
  const raf = useRef<number | null>(null);
  const lastTs = useRef<number | null>(null);

  async function load(f = from, tt = to) {
    setLoading(true);
    setError(null);
    try {
      const list = await api.vehicleTrack(vehicleId, new Date(f).toISOString(), new Date(tt).toISOString());
      list.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
      setPlaying(false);
      setProgress(0);
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

  // Rechargement automatique quand la periode change (petit delai pour la saisie).
  useEffect(() => {
    const timer = setTimeout(() => void load(from, to), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, from, to]);

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
      truck.current?.remove();
      truck.current = null;
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      const src = m.getSource('track') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
        (m.getSource('progress') as maplibregl.GeoJSONSource | undefined)?.setData(empty);
      } else {
        m.addSource('track', { type: 'geojson', data });
        m.addSource('progress', { type: 'geojson', data: empty });
        m.addLayer({ id: 'track-casing', type: 'line', source: 'track', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } });
        m.addLayer({ id: 'track-line', type: 'line', source: 'track', paint: { 'line-color': '#12704F', 'line-width': 4, 'line-opacity': 0.55 } });
        m.addLayer({ id: 'progress-line', type: 'line', source: 'progress', paint: { 'line-color': '#e67e22', 'line-width': 5 } });
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

  const span = useMemo(() => {
    if (points === null || points.length < 2) return null;
    return { t0: Date.parse(points[0].recordedAt), t1: Date.parse(points[points.length - 1].recordedAt) };
  }, [points]);

  /** Position interpolee dans le temps a la progression donnee. */
  function positionAt(prog: number): { lng: number; lat: number; idx: number; speed: number; time: number } | null {
    if (points === null || span === null) return null;
    const time = span.t0 + prog * (span.t1 - span.t0);
    let idx = 0;
    while (idx < points.length - 2 && Date.parse(points[idx + 1].recordedAt) <= time) idx++;
    const a = points[idx];
    const b = points[Math.min(idx + 1, points.length - 1)];
    const ta = Date.parse(a.recordedAt);
    const tb = Date.parse(b.recordedAt);
    const k = tb > ta ? Math.min(1, Math.max(0, (time - ta) / (tb - ta))) : 1;
    return { lng: a.lon + (b.lon - a.lon) * k, lat: a.lat + (b.lat - a.lat) * k, idx, speed: k < 0.5 ? a.speed : b.speed, time };
  }

  useEffect(() => {
    if (playing === false || span === null) {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      lastTs.current = null;
      return;
    }
    const total = span.t1 - span.t0;
    const loop = (ts: number) => {
      if (lastTs.current === null) lastTs.current = ts;
      const dt = ts - lastTs.current;
      lastTs.current = ts;
      setProgress((prev) => {
        const next = prev + (dt * factor) / total;
        if (next >= 1) {
          setPlaying(false);
          return 1;
        }
        return next;
      });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      lastTs.current = null;
    };
  }, [playing, factor, span]);

  useEffect(() => {
    const m = map.current;
    const pos = positionAt(progress);
    if (m === null || pos === null || points === null || m.isStyleLoaded() === false) return;
    if (truck.current === null) {
      const el = document.createElement('div');
      el.className = 'track-marker truck';
      truck.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([pos.lng, pos.lat]).addTo(m);
    } else {
      truck.current.setLngLat([pos.lng, pos.lat]);
    }
    const done = points.slice(0, pos.idx + 1).map((p) => [p.lon, p.lat]);
    done.push([pos.lng, pos.lat]);
    (m.getSource('progress') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: done.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: done } }] : [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, points]);

  const cursor = positionAt(progress);

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
          <button className="btn mint" disabled={loading} onClick={() => void load(from, to)}>{loading ? t('track.loading') : t('track.load')}</button>
          <span className="presets">
            <button className="btn ghost small" onClick={() => preset('today')}>{t('track.today')}</button>
            <button className="btn ghost small" onClick={() => preset(24)}>{t('track.last24h')}</button>
            <button className="btn ghost small" onClick={() => preset(24 * 7)}>{t('track.last7d')}</button>
          </span>
        </div>

        {error && <p className="notice">{error}</p>}
        {points !== null && points.length >= MAX_POINTS && <p className="notice">{t('track.tooMany', { n: MAX_POINTS })}</p>}

        <div className="track-map" ref={container} />

        {span !== null && (
          <div className="track-player">
            <button className="btn mint small" onClick={() => setPlaying((v) => v === false)}>
              {playing ? t('track.pause') : t('track.play')}
            </button>
            <button className="btn ghost small" onClick={() => { setPlaying(false); setProgress(0); }}>
              {t('track.restart')}
            </button>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(progress * 1000)}
              onChange={(e) => { setPlaying(false); setProgress(Number(e.target.value) / 1000); }}
              aria-label={t('track.title')}
            />
            <label className="player-speed">
              {t('track.playbackSpeed')}
              <select value={factor} onChange={(e) => setFactor(Number(e.target.value))}>
                {[5, 20, 60, 200, 600].map((f) => (
                  <option key={f} value={f}>×{f}</option>
                ))}
              </select>
            </label>
            {cursor && (
              <span className="player-info" dir="ltr">
                {new Date(cursor.time).toLocaleString(locale, { hour12: false })} · {cursor.speed} km/h
              </span>
            )}
          </div>
        )}

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
