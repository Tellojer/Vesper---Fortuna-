import type { Site } from '../data/types';
import { tCountry, tName, tNote, tSource, tStatus } from './i18n';
import { asset } from '../lib/asset';

/**
 * Backend data entry points (copied unchanged by `npm run sync:backend`):
 *   /data/vesper/missions.json   22 sites with verified coordinates and sources
 *   /data/vesper/region-*.json   precomputed regions (Sun/Earth visibility with terrain, 2027 hourly)
 *   /data/vesper/survey/*        areas away from the missions, found by surveying each zone with the
 *                                backend engine (design/tools/survey_zones.py + grid_region.py); optional
 *   /data/vesper/ephem.bin/.json Sun direction and Earth position in the Moon frame, hourly (JPL Horizons)
 */

type RawMission = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  agency: string;
  year: number | null;
  status: string;
  note: string;
  source: string;
  source_url: string;
  file?: string;
  image?: string;
  summary?: { sun_pct_max: number; earth_pct_max: number };
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function loadMissions(): Promise<Site[]> {
  const raw = await getJson<RawMission[]>(asset('/data/vesper/missions.json'));
  return raw.map((m) => ({
    id: m.id,
    name: tName(m.id, m.name),
    lat: m.lat,
    lon: m.lon,
    kind: m.status === 'pasada' ? 'historic' : 'candidate',
    status: tStatus(m.status),
    country: m.country ? tCountry(m.country) : undefined,
    agency: m.agency || undefined,
    year: m.year ?? undefined,
    detail: tNote(m.id, m.note),
    coordSource: tSource(m.source),
    sourceUrl: m.source_url,
    file: m.file,
    image: m.image,
    summary: m.summary,
  }));
}

/** Surveyed areas (same format as missions.json). Empty when the survey has not been run. */
export async function loadSurvey(): Promise<Site[]> {
  try {
    const raw = await getJson<RawMission[]>(asset('/data/vesper/survey/missions.json'));
    return raw
      .filter((m) => m.file)
      .map((m) => ({ id: m.id, name: m.name, lat: m.lat, lon: m.lon, kind: 'custom' as const, detail: m.note, file: `survey/${m.file}`, summary: m.summary }));
  } catch {
    return [];
  }
}

export type Ephemeris = {
  start: string;
  startMs: number;
  stepH: number;
  n: number;
  /** float32 per hour: sun unit vector xyz, Earth position xyz (km); backend Moon frame */
  data: Float32Array;
};

export async function loadEphemeris(): Promise<Ephemeris> {
  const [meta, buf] = await Promise.all([
    getJson<{ start: string; stepH: number; n: number }>(asset('/data/vesper/ephem.json')),
    fetch(asset('/data/vesper/ephem.bin')).then((r) => {
      if (!r.ok) throw new Error(`/data/vesper/ephem.bin: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  return { ...meta, startMs: Date.parse(meta.start + 'Z'), data: new Float32Array(buf) };
}

/** Sun direction and Earth position at hour t, converted to the scene frame (lon 0 -> +X, north -> +Y, east -> -Z). */
export function ephemAt(e: Ephemeris, t: number) {
  const i = Math.max(0, Math.min(e.n - 1, Math.round(t))) * 6;
  const d = e.data;
  return {
    sun: [d[i], d[i + 2], -d[i + 1]] as [number, number, number],
    earthKm: [d[i + 3], d[i + 5], -d[i + 4]] as [number, number, number],
  };
}
