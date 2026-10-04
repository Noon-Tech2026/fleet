import maplibregl, { type IControl, type Map as MapLibreMap } from 'maplibre-gl';

/* Arabe : sans ce greffon, MapLibre dessine les lettres separees et a l'envers.
 * Charge une seule fois (ce module est importe par toutes les cartes). */
try {
  if (maplibregl.getRTLTextPluginStatus() === 'unavailable') {
    void maplibregl.setRTLTextPlugin('/mapbox-gl-rtl-text.js', false);
  }
} catch {
  /* deja initialise */
}

/** Fond de carte : plan (style vectoriel) ou satellite (imagerie + etiquettes du plan). */
export type BaseMode = 'plan' | 'satellite';

const KEY = 'mirsad.basemap';
const SAT_TILES =
  (import.meta.env.VITE_SATELLITE_TILES as string | undefined) ||
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_ATTRIBUTION =
  (import.meta.env.VITE_SATELLITE_ATTRIBUTION as string | undefined) ||
  'Imagerie © Esri, Maxar, Earthstar Geographics';

export function loadBaseMode(): BaseMode {
  try { return localStorage.getItem(KEY) === 'plan' ? 'plan' : 'satellite'; } catch { return 'satellite'; }
}

function saveBaseMode(mode: BaseMode): void {
  try { localStorage.setItem(KEY, mode); } catch { /* navigation privee : sans memoire */ }
}

const withAttribution = new WeakSet<MapLibreMap>();

/**
 * Ajoute (une fois) la couche satellite sous les etiquettes du fond, puis regle sa visibilite.
 * A appeler une fois le style charge.
 */
export function applyBaseMode(map: MapLibreMap, mode: BaseMode): void {
  if (!map.getSource('sat')) {
    map.addSource('sat', { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: SAT_ATTRIBUTION });
    const firstSymbol = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
    map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } }, firstSymbol);
  }
  map.setLayoutProperty('sat', 'visibility', mode === 'satellite' ? 'visible' : 'none');
  if (mode === 'satellite' && !withAttribution.has(map)) {
    withAttribution.add(map);
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  }
}

function labelFor(mode: BaseMode): string {
  const lang = (document.documentElement.lang || 'fr').slice(0, 2);
  const next = mode === 'satellite' ? 'plan' : 'satellite';
  const L: Record<string, Record<BaseMode, string>> = {
    fr: { plan: 'Plan', satellite: 'Satellite' },
    en: { plan: 'Map', satellite: 'Satellite' },
    ar: { plan: 'خريطة', satellite: 'قمر صناعي' },
  };
  return (L[lang] ?? L.fr)[next];
}

/** Bouton « Plan / Satellite » a ajouter a chaque carte (avant le 'load' de la carte). */
export class BaseMapControl implements IControl {
  private el?: HTMLDivElement;
  private btn?: HTMLButtonElement;

  onAdd(map: MapLibreMap): HTMLElement {
    const el = document.createElement('div');
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group basemap-ctrl';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'basemap-btn';
    el.appendChild(btn);
    this.el = el;
    this.btn = btn;
    this.render();

    const init = () => applyBaseMode(map, loadBaseMode());
    if (map.isStyleLoaded()) init(); else map.once('load', init);

    btn.addEventListener('click', () => {
      const next: BaseMode = loadBaseMode() === 'satellite' ? 'plan' : 'satellite';
      saveBaseMode(next);
      if (map.isStyleLoaded()) applyBaseMode(map, next);
      this.render();
    });
    return el;
  }

  onRemove(): void {
    this.el?.remove();
  }

  private render(): void {
    if (this.btn) this.btn.textContent = labelFor(loadBaseMode());
  }
}
