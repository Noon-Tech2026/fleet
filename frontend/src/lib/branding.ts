import { useEffect, useState } from 'react';

export interface Branding { name: string; tagline: string; logo: string }

const FALLBACK: Branding = { name: 'GeoTruck', tagline: 'Your fleet under control', logo: '/logo.png' };
let cached: Branding | null = null;
let inflight: Promise<Branding> | null = null;

/** Charge la marque une seule fois (endpoint public), met a jour le titre de l'onglet. */
export function loadBranding(): Promise<Branding> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch('/api/branding')
    .then((r) => (r.ok ? r.json() : FALLBACK))
    .catch(() => FALLBACK)
    .then((b: Branding) => {
      cached = { ...FALLBACK, ...b };
      document.title = cached.name;
      return cached;
    });
  return inflight;
}

export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(cached ?? FALLBACK);
  useEffect(() => {
    void loadBranding().then(setB);
  }, []);
  return b;
}
