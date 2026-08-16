import { useEffect, useRef } from 'react';
import maplibregl, { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { VehicleState } from '../lib/types';

/**
 * Style neutre : aucune requete reseau, donc la carte fonctionne meme
 * sans serveur de tuiles. Renseigner VITE_MAP_STYLE pour passer a un
 * vrai fond cartographique — aucune autre modification n'est necessaire.
 */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'fond', type: 'background', paint: { 'background-color': '#0D181B' } }],
};

/** Miroir des tokens de `index.css` : MapLibre peint sur un canvas et ne
 *  voit pas les variables CSS. Toute retouche de palette se fait aux deux
 *  endroits, sinon la carte se désaccorde du reste de l'écran. */
const PAINT = {
  ink: '#070F11',
  bone: '#E9EFEC',
  dim: '#8BA1A7',
  amber: '#F5B13D',
  red: '#EF625A',
  mint: '#4ECF9F',
} as const;

interface Props {
  vehicles: VehicleState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FleetMap({ vehicles, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);

  useEffect(() => {
    if (!container.current || map.current) return;

    const style = import.meta.env.VITE_MAP_STYLE || BLANK_STYLE;

    map.current = new maplibregl.Map({
      container: container.current,
      style,
      center: [-2.2, 35.32],
      zoom: 9,
      attributionControl: false,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.current.on('load', async () => {
      const m = map.current!;

      // Zones servies par l'API : la carte ne redefinit jamais la geometrie
      // metier cote client.
      const zones = await fetch('/api/zones').then((r) => r.json());
      m.addSource('zones', { type: 'geojson', data: zonesToGeoJson(zones) });
      m.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: {
          'fill-color': ['case', ['==', ['get', 'kind'], 'forbidden'], PAINT.red, PAINT.mint],
          'fill-opacity': 0.12,
        },
      });
      m.addLayer({
        id: 'zones-line',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': ['case', ['==', ['get', 'kind'], 'forbidden'], PAINT.red, PAINT.mint],
          'line-width': 1.5,
          'line-dasharray': [3, 2],
        },
      });

      m.addSource('vehicles', { type: 'geojson', data: emptyCollection() });

      // Halo du camion sélectionné : sur vingt points de même taille, la
      // sélection doit se retrouver sans relire les étiquettes.
      m.addLayer({
        id: 'vehicles-halo',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 20, 0],
          'circle-color': PAINT.amber,
          'circle-opacity': 0.14,
        },
      });
      m.addLayer({
        id: 'vehicles-dot',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 10, 7],
          'circle-color': [
            'case',
            ['==', ['get', 'starter'], 'blocked'],
            PAINT.red,
            ['==', ['get', 'moving'], false],
            PAINT.dim,
            PAINT.amber,
          ],
          'circle-stroke-color': PAINT.ink,
          'circle-stroke-width': 2,
        },
      });
      m.addLayer({
        id: 'vehicles-label',
        type: 'symbol',
        source: 'vehicles',
        layout: {
          'text-field': ['get', 'id'],
          'text-offset': [0, -1.6],
          'text-size': 11,
        },
        paint: {
          'text-color': PAINT.bone,
          'text-halo-color': PAINT.ink,
          'text-halo-width': 1.5,
        },
      });

      m.on('click', 'vehicles-dot', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') onSelect(id);
      });
      m.on('mouseenter', 'vehicles-dot', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'vehicles-dot', () => (m.getCanvas().style.cursor = ''));

      ready.current = true;
    });

    return () => {
      map.current?.remove();
      map.current = null;
      ready.current = false;
    };
  }, [onSelect]);

  useEffect(() => {
    if (!ready.current || !map.current) return;
    const source = map.current.getSource('vehicles') as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: vehicles.map((v) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
        properties: {
          id: v.id,
          starter: v.starter,
          moving: v.speed > 3,
          selected: v.id === selectedId,
        },
      })),
    });
  }, [vehicles, selectedId]);

  return (
    <div className="map-shell">
      <div ref={container} className="map" />
      <div className="map-legend">
        <span>
          <i style={{ background: PAINT.amber }} /> En route
        </span>
        <span>
          <i style={{ background: PAINT.dim }} /> À l'arrêt
        </span>
        <span>
          <i style={{ background: PAINT.red }} /> Démarrage bloqué
        </span>
      </div>
    </div>
  );
}

/* --- conversion des zones API en GeoJSON --------------------------------- */

type ApiZone =
  | { id: string; name: string; kind: string; shape: 'circle'; lat: number; lon: number; radius: number }
  | { id: string; name: string; kind: string; shape: 'polygon'; points: [number, number][] };

function zonesToGeoJson(zones: ApiZone[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => ({
      type: 'Feature',
      properties: { id: z.id, name: z.name, kind: z.kind },
      geometry:
        z.shape === 'circle'
          ? { type: 'Polygon', coordinates: [circle(z.lat, z.lon, z.radius)] }
          : { type: 'Polygon', coordinates: [[...z.points.map(([lat, lon]) => [lon, lat]), [z.points[0][1], z.points[0][0]]]] },
    })),
  };
}

/** Approxime un cercle geographique par un polygone de 64 cotes. */
function circle(lat: number, lon: number, radiusMeters: number): number[][] {
  const points: number[][] = [];
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    points.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return points;
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
