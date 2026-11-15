import type { MoonManifest } from './types';

/**
 * Globe textures (LROC colour, LOLA relief, Earth) for the 3D view.
 * Site, Sun and Earth data come from the backend: see src/backend/data.ts.
 */
export async function loadMoonManifest(): Promise<MoonManifest> {
  const res = await fetch('/data/moon/manifest.json');
  if (!res.ok) throw new Error(`/data/moon/manifest.json: ${res.status} ${res.statusText}`);
  return (await res.json()) as MoonManifest;
}
