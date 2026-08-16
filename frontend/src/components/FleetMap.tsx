import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap, Marker, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { VehicleState } from '../lib/types';

/**
 * Style neutre : aucune requete reseau, donc la carte fonctionne meme
 * sans serveur de tuiles. Renseigner VITE_MAP_STYLE pour passer a un
 * vrai fond cartographique — aucune autre modification n'est necessaire.
 */
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'fond', type: 'background', paint: { 'background-color': '#0B1518' } }],
};

const MAP_STYLE = import.meta.env.VITE_MAP_STYLE as string | undefined;

/** Miroir des tokens de `index.css` : MapLibre peint sur un canvas et ne
 *  voit pas les variables CSS. Toute retouche de palette se fait aux deux
 *  endroits, sinon la carte se désaccorde du reste de l'écran. */
const PAINT = {
  grid: '#1B3036',
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
  // Etat et non ref : les positions arrivent souvent avant la fin du
  // chargement de la carte, il faut un rendu pour poser les marqueurs.
  const [ready, setReady] = useState(false);
  const markers = useRef(new Map<string, Marker>());
  const fitted = useRef(false);
  const focused = useRef<string | null>(null);

  // La carte est construite une fois pour toutes ; les rappels changent a
  // chaque rendu et ne doivent pas la faire reconstruire.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current || map.current) return;

    map.current = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE || OFFLINE_STYLE,
      center: [-2.2, 35.32],
      zoom: 9,
      attributionControl: false,
    });

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // Sans fond cartographique, l'echelle est le seul repere de distance.
    map.current.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.current.on('load', async () => {
      const m = map.current!;

      // Quadrillage geographique recalcule a chaque deplacement : il donne
      // une reference d'echelle quand aucun fond de carte n'est charge.
      // Avec un vrai fond, il ne ferait que salir la lecture.
      if (!MAP_STYLE) {
        m.addSource('grid', { type: 'geojson', data: emptyCollection() });
        m.addLayer({
          id: 'grid-line',
          type: 'line',
          source: 'grid',
          paint: { 'line-color': PAINT.grid, 'line-width': 1 },
        });
        const refreshGrid = () => {
          const source = m.getSource('grid') as maplibregl.GeoJSONSource | undefined;
          source?.setData(graticule(m));
        };
        refreshGrid();
        m.on('moveend', refreshGrid);
      }

      // Zones servies par l'API : la carte ne redefinit jamais la geometrie
      // metier cote client. Leur absence ne doit pas empecher l'affichage
      // des camions — c'est l'information vitale de l'ecran.
      try {
        const zones = await fetch('/api/zones', { credentials: 'include' }).then((r) => r.json());
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
      } catch {
        // silencieux : le flux SSE signale deja une API injoignable
      }

      setReady(true);
    });

    return () => {
      markers.current.forEach((marker) => marker.remove());
      markers.current.clear();
      map.current?.remove();
      map.current = null;
      setReady(false);
      fitted.current = false;
    };
  }, []);

  // Les camions sont des marqueurs HTML et non une couche `symbol` : sans
  // serveur de glyphes, MapLibre ne sait afficher aucun texte sur le canvas.
  // En HTML l'etiquette suit la feuille de style du reste du tableau de bord.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;

    const seen = new Set<string>();

    for (const v of vehicles) {
      seen.add(v.id);
      let marker = markers.current.get(v.id);

      if (!marker) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'veh-marker';
        el.innerHTML =
          '<span class="veh-pin"><i class="veh-arrow"></i></span><span class="veh-tag"></span>';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectRef.current(v.id);
        });
        marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([v.lon, v.lat])
          .addTo(m);
        markers.current.set(v.id, marker);
      } else {
        marker.setLngLat([v.lon, v.lat]);
      }

      paintMarker(marker.getElement(), v, v.id === selectedId);
    }

    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }

    // Premier cadrage sur la flotte reelle : le centre code en dur ne vaut
    // que tant qu'aucune position n'est arrivee.
    if (!fitted.current && vehicles.length > 0) {
      fitted.current = true;
      const bounds = new maplibregl.LngLatBounds();
      vehicles.forEach((v) => bounds.extend([v.lon, v.lat]));
      m.fitBounds(bounds, { padding: 90, maxZoom: 12, duration: 0 });
    }

    // Recentrage uniquement au changement de selection : le faire a chaque
    // trame empecherait l'exploitant de deplacer la carte a la main.
    const target = vehicles.find((v) => v.id === selectedId);
    if (target && focused.current !== selectedId) {
      focused.current = selectedId;
      m.easeTo({ center: [target.lon, target.lat], duration: 600 });
    }
  }, [vehicles, selectedId, ready]);

  return (
    <div className="map-shell">
      <div ref={container} className="map" />
      <div className="map-legend">
        <span>
          <i className="swatch amber" /> En route
        </span>
        <span>
          <i className="swatch dim" /> À l'arrêt
        </span>
        <span>
          <i className="swatch red" /> Démarrage bloqué
        </span>
        {!MAP_STYLE && <em>Fond hors ligne · VITE_MAP_STYLE non défini</em>}
      </div>
    </div>
  );
}

/* --- rendu d'un marqueur -------------------------------------------------- */

function paintMarker(el: HTMLElement, v: VehicleState, selected: boolean) {
  const moving = v.online && v.speed > 3;
  const tone = !v.online ? 'off' : v.starter !== 'allowed' ? 'blocked' : moving ? 'moving' : 'idle';

  // classList et non className : MapLibre pose sa propre classe de
  // positionnement sur l'element, l'ecraser detacherait le marqueur.
  ['off', 'blocked', 'moving', 'idle'].forEach((t) =>
    el.classList.toggle(`tone-${t}`, t === tone),
  );
  el.classList.toggle('is-selected', selected);
  el.style.zIndex = selected ? '3' : moving ? '2' : '1';
  el.setAttribute('aria-label', `${v.id} — ${v.plate} — ${v.speed} km/h`);

  const arrow = el.querySelector<HTMLElement>('.veh-arrow');
  // Le cap n'a de sens qu'en mouvement : a l'arret le GPS renvoie une
  // valeur residuelle qui ferait tourner la fleche sans raison.
  if (arrow) arrow.style.transform = moving ? `rotate(${v.course}deg)` : '';

  const tag = el.querySelector<HTMLElement>('.veh-tag');
  if (tag) tag.textContent = moving ? `${v.id} · ${v.speed}` : v.id;
}

/* --- quadrillage ---------------------------------------------------------- */

/** Pas du quadrillage en degres, choisi pour garder ~6 a 12 lignes a l'ecran
 *  quel que soit le zoom. */
function gridStep(zoom: number): number {
  if (zoom < 6) return 2;
  if (zoom < 8) return 0.5;
  if (zoom < 10) return 0.2;
  if (zoom < 12) return 0.05;
  if (zoom < 14) return 0.02;
  return 0.005;
}

function graticule(m: MapLibreMap): GeoJSON.FeatureCollection {
  const b = m.getBounds();
  const step = gridStep(m.getZoom());
  const features: GeoJSON.Feature[] = [];

  const west = Math.floor(b.getWest() / step) * step;
  const south = Math.floor(b.getSouth() / step) * step;

  for (let lon = west; lon <= b.getEast(); lon += step) {
    features.push(line([[lon, b.getSouth()], [lon, b.getNorth()]]));
  }
  for (let lat = south; lat <= b.getNorth(); lat += step) {
    features.push(line([[b.getWest(), lat], [b.getEast(), lat]]));
  }

  return { type: 'FeatureCollection', features };
}

function line(coordinates: number[][]): GeoJSON.Feature {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
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
