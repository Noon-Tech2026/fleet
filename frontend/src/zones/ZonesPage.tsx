import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl, { Map as MapLibreMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Zone, ZoneInput, ZoneKind, ZoneShape, VehicleState } from '../lib/types';
import type { VehicleDirectoryEntry } from '../api/client';
import { api } from '../api/client';

interface Props {
  vehicles: VehicleState[];
  directory: VehicleDirectoryEntry[];
  isAdmin: boolean;
}

const MAP_STYLE = import.meta.env.VITE_MAP_STYLE as string | undefined;
const PLAIN_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f3f0e8' } }],
};
const KIND_COLOR: Record<ZoneKind, string> = { station: '#12704F', forbidden: '#c0392b', perimeter: '#1f5fbf' };

interface Draft {
  shape: ZoneShape;
  center: [number, number] | null; // [lat, lon]
  radius: number;
  points: [number, number][];
}

const emptyDraft = (shape: ZoneShape): Draft => ({ shape, center: null, radius: 300, points: [] });

function circlePolygon(lat: number, lon: number, radiusMeters: number): number[][] {
  const pts: number[][] = [];
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return pts;
}

function zoneFeature(z: Pick<Zone, 'shape' | 'lat' | 'lon' | 'radius' | 'points'>, props: Record<string, unknown>): GeoJSON.Feature | null {
  if (z.shape === 'circle') {
    if (z.lat === null || z.lon === null || z.radius === null) return null;
    return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [circlePolygon(z.lat, z.lon, z.radius)] } };
  }
  if (z.points === null || z.points.length < 3) return null;
  const ring = [...z.points.map(([lat, lon]) => [lon, lat]), [z.points[0][1], z.points[0][0]]];
  return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * Gestion des zones (superviseur/admin) : liste, trace sur carte, type,
 * camions concernes. Le serveur reste juge de la geometrie (locate()).
 */
export function ZonesPage({ vehicles, directory, isAdmin }: Props) {
  const { t } = useTranslation();
  const [zones, setZones] = useState<Zone[]>([]);
  const [editing, setEditing] = useState<Zone | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ZoneKind>('station');
  const [alarmOnExit, setAlarmOnExit] = useState(false);
  const [allTrucks, setAllTrucks] = useState(true);
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft('circle'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const drawingRef = useRef(false);
  drawingRef.current = creating || editing !== null;
  const markers = useRef<maplibregl.Marker[]>([]);

  const formOpen = creating || editing !== null;

  async function load() {
    try {
      setZones(isAdmin ? await api.zonesAll() : await api.zones());
    } catch {
      setZones([]);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // --- carte ------------------------------------------------------------
  useEffect(() => {
    if (container.current === null || map.current !== null) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE || PLAIN_STYLE,
      center: [-15.95, 18.08],
      zoom: 11,
      attributionControl: false,
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    m.on('load', () => {
      m.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 } });
      m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
      m.addLayer({ id: 'zones-label', type: 'symbol', source: 'zones', layout: { 'text-field': ['get', 'name'], 'text-size': 12 }, paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
      m.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', paint: { 'fill-color': '#e67e22', 'fill-opacity': 0.2 } });
      m.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#e67e22', 'line-width': 2, 'line-dasharray': [2, 1] } });
      m.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#e67e22', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      setMapReady(true);
    });
    m.on('click', (e: MapMouseEvent) => {
      if (drawingRef.current === false) return;
      const d = draftRef.current;
      if (d.shape === 'circle') setDraft({ ...d, center: [e.lngLat.lat, e.lngLat.lng] });
      else setDraft({ ...d, points: [...d.points, [e.lngLat.lat, e.lngLat.lng]] });
    });
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);
  const [mapReady, setMapReady] = useState(false);

  // zones existantes
  useEffect(() => {
    const m = map.current;
    if (m === null || mapReady === false) return;
    const features = zones
      .filter((z) => z.active && (editing === null || z.id !== editing.id))
      .map((z) => zoneFeature(z, { name: z.name, color: KIND_COLOR[z.kind] }))
      .filter((f): f is GeoJSON.Feature => f !== null);
    (m.getSource('zones') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }, [zones, editing, mapReady]);

  // brouillon
  useEffect(() => {
    const m = map.current;
    if (m === null || mapReady === false) return;
    const features: GeoJSON.Feature[] = [];
    if (draft.shape === 'circle' && draft.center) {
      const f = zoneFeature({ shape: 'circle', lat: draft.center[0], lon: draft.center[1], radius: draft.radius, points: null }, {});
      if (f) features.push(f);
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [draft.center[1], draft.center[0]] } });
    }
    if (draft.shape === 'polygon') {
      draft.points.forEach(([lat, lon]) => features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }));
      if (draft.points.length >= 2) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draft.points.map(([lat, lon]) => [lon, lat]) } });
      }
      const f = zoneFeature({ shape: 'polygon', lat: null, lon: null, radius: null, points: draft.points }, {});
      if (f) features.push(f);
    }
    (m.getSource('draft') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }, [draft, mapReady]);

  // camions en direct (contexte)
  useEffect(() => {
    const m = map.current;
    if (m === null || mapReady === false) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = vehicles.map((v) => {
      const el = document.createElement('div');
      el.className = 'zone-truck';
      el.title = v.id;
      return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([v.lon, v.lat]).addTo(m);
    });
  }, [vehicles, mapReady]);

  // --- formulaire -------------------------------------------------------
  function startCreate() {
    setEditing(null);
    setCreating(true);
    setName('');
    setKind('station');
    setAlarmOnExit(false);
    setAllTrucks(true);
    setVehicleIds([]);
    setDraft(emptyDraft('circle'));
    setError(null);
  }

  function startEdit(z: Zone) {
    setCreating(false);
    setEditing(z);
    setName(z.name);
    setKind(z.kind);
    setAlarmOnExit(z.alarmOnExit);
    setAllTrucks(z.vehicleIds === null || z.vehicleIds.length === 0);
    setVehicleIds(z.vehicleIds ?? []);
    setDraft({ shape: z.shape, center: z.lat !== null && z.lon !== null ? [z.lat, z.lon] : null, radius: z.radius ?? 300, points: z.points ?? [] });
    setError(null);
    const f = zoneFeature(z, {});
    if (f && map.current) {
      const coords = (f.geometry as GeoJSON.Polygon).coordinates[0];
      const b = coords.reduce((bb, c) => bb.extend(c as [number, number]), new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]));
      map.current.fitBounds(b, { padding: 60, maxZoom: 15 });
    }
  }

  function cancel() {
    setCreating(false);
    setEditing(null);
    setDraft(emptyDraft('circle'));
    setError(null);
  }

  const shapeReady = draft.shape === 'circle' ? draft.center !== null : draft.points.length >= 3;

  async function save() {
    if (shapeReady === false) {
      setError(t('zones.needShape'));
      return;
    }
    const input: ZoneInput = {
      name: name.trim(),
      kind,
      shape: draft.shape,
      lat: draft.shape === 'circle' && draft.center ? draft.center[0] : null,
      lon: draft.shape === 'circle' && draft.center ? draft.center[1] : null,
      radius: draft.shape === 'circle' ? Math.round(draft.radius) : null,
      points: draft.shape === 'polygon' ? draft.points : null,
      alarmOnExit: kind === 'perimeter' ? alarmOnExit : false,
      vehicleIds: allTrucks ? null : vehicleIds,
    };
    setSaving(true);
    setError(null);
    try {
      if (editing) await api.updateZone(editing.id, input);
      else await api.createZone(input);
      await load();
      cancel();
    } catch (e) {
      setError(t('zones.error', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(z: Zone) {
    if (window.confirm(t('zones.confirmDeactivate')) === false) return;
    await api.deactivateZone(z.id);
    await load();
    if (editing?.id === z.id) cancel();
  }

  const trucks = useMemo(() => directory.filter((d) => d.active !== false), [directory]);

  return (
    <div className="zones-page">
      <aside className="zones-side">
        <header className="zones-head">
          <h2>{t('zones.title')}</h2>
          {formOpen === false && (
            <button className="btn mint small" onClick={startCreate}>{t('zones.new')}</button>
          )}
        </header>

        {formOpen ? (
          <form className="zone-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label>
              {t('zones.name')}
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
            </label>
            <label>
              {t('zones.kind')}
              <select value={kind} onChange={(e) => setKind(e.target.value as ZoneKind)}>
                {(['station', 'forbidden', 'perimeter'] as ZoneKind[]).map((k) => (
                  <option key={k} value={k}>{t(`zones.kinds.${k}`)}</option>
                ))}
              </select>
            </label>
            {kind === 'perimeter' && (
              <label className="check">
                <input type="checkbox" checked={alarmOnExit} onChange={(e) => setAlarmOnExit(e.target.checked)} />
                {t('zones.alarmOnExit')}
              </label>
            )}

            <fieldset>
              <legend>{t('zones.appliesTo')}</legend>
              <label className="check"><input type="radio" checked={allTrucks} onChange={() => setAllTrucks(true)} /> {t('zones.allTrucks')}</label>
              <label className="check"><input type="radio" checked={allTrucks === false} onChange={() => setAllTrucks(false)} /> {t('zones.someTrucks')}</label>
              {allTrucks === false && (
                <div className="truck-picks">
                  {trucks.map((d) => (
                    <label key={d.id} className="check">
                      <input
                        type="checkbox"
                        checked={vehicleIds.includes(d.id)}
                        onChange={(e) => setVehicleIds(e.target.checked ? [...vehicleIds, d.id] : vehicleIds.filter((x) => x !== d.id))}
                      />
                      {d.id} <span className="muted" dir="ltr">{d.plate}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset>
              <legend>{t('zones.shape')}</legend>
              <div className="shape-switch">
                <button type="button" className={`btn small ${draft.shape === 'circle' ? 'mint' : 'ghost'}`} onClick={() => setDraft(emptyDraft('circle'))}>{t('zones.circle')}</button>
                <button type="button" className={`btn small ${draft.shape === 'polygon' ? 'mint' : 'ghost'}`} onClick={() => setDraft(emptyDraft('polygon'))}>{t('zones.polygon')}</button>
              </div>
              <p className="hint">{draft.shape === 'circle' ? t('zones.hintCircle') : t('zones.hintPolygon')}</p>
              {draft.shape === 'circle' && (
                <label>
                  {t('zones.radius')} — {Math.round(draft.radius)} m
                  <input type="range" min={50} max={20000} step={50} value={draft.radius} onChange={(e) => setDraft({ ...draft, radius: Number(e.target.value) })} />
                </label>
              )}
              {draft.shape === 'polygon' && (
                <p className="hint">{t('zones.points', { n: draft.points.length })}</p>
              )}
              <button type="button" className="btn ghost small" onClick={() => setDraft(emptyDraft(draft.shape))}>{t('zones.clear')}</button>
            </fieldset>

            {error && <p className="notice">{error}</p>}
            <div className="form-actions">
              <button type="button" className="btn ghost" onClick={cancel}>{t('zones.cancel')}</button>
              <button type="submit" className="btn mint" disabled={saving}>{saving ? t('zones.saving') : t('zones.save')}</button>
            </div>
          </form>
        ) : zones.length === 0 ? (
          <p className="empty">{t('zones.empty')}</p>
        ) : (
          <ul className="zone-list">
            {zones.map((z) => (
              <li key={z.id} className={z.active ? '' : 'inactive'}>
                <span className="swatch" style={{ background: KIND_COLOR[z.kind] }} />
                <div>
                  <strong>{z.name}</strong>
                  <span className="muted">
                    {t(`zones.kinds.${z.kind}`)}
                    {z.kind === 'perimeter' && z.alarmOnExit ? ' · 🔔' : ''}
                    {' · '}
                    {z.vehicleIds && z.vehicleIds.length > 0 ? z.vehicleIds.join(', ') : t('zones.allTrucks')}
                    {z.active ? '' : ` · ${t('zones.inactive')}`}
                  </span>
                </div>
                <div className="zone-actions">
                  <button className="btn ghost small" onClick={() => startEdit(z)}>{t('zones.edit')}</button>
                  {z.active && <button className="btn ghost small danger" onClick={() => void deactivate(z)}>{t('zones.deactivate')}</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className={`zones-map ${formOpen ? 'drawing' : ''}`} ref={container} />
    </div>
  );
}
