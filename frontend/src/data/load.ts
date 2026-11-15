import type { MoonManifest } from './types';
import { asset } from '../lib/asset';

/**
 * Globe textures (LROC colour, LOLA relief, Earth) for the 3D view.
 * Site, Sun and Earth data come from the backend: see src/backend/data.ts.
 */
export async function loadMoonManifest(): Promise<MoonManifest> {
  const res = await fetch(asset('/data/moon/manifest.json'));
  if (!res.ok) throw new Error(`/data/moon/manifest.json: ${res.status} ${res.statusText}`);
  const m = (await res.json()) as MoonManifest;
  // las URLs del manifest son absolutas ('/data/moon/...'): pasarlas por asset() para GitHub Pages
  const fix = (o: unknown): void => {
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === 'url' && typeof v === 'string') (o as Record<string, unknown>)[k] = asset(v);
        else fix(v);
      }
    }
  };
  fix(m);
  return m;
}
