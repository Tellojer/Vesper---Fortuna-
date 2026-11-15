import type { PresetId } from './region';

/**
 * Live Vesper backend (data-pipeline/server.py, see API.md). It analyses any
 * coordinate of the Moon on demand, so it only works while that server runs:
 *   python server.py --dem-south ... --dem-north ... --dem-global ...
 * Set VITE_VESPER_API to point somewhere else than port 8000 of this host.
 */
export const API_BASE: string =
  (import.meta.env.VITE_VESPER_API as string | undefined) ??
  (location.hostname.endsWith('github.io') ? 'http://localhost:8000' : `http://${location.hostname}:8000`);

/** Backend preset ids (Spanish in the API). */
const PRESET_PARAM: Record<PresetId, string> = { balanced: 'equilibrada', solar: 'solar', comms: 'comunicacion' };

const VERDICT = { apto: 'suitable', aceptable: 'acceptable', 'no recomendado': 'not-recommended' } as const;

type Countdown = { visible: boolean; hours: number | null };

/** Response of GET /api/point with series=0 (fields the UI reads). */
export type PointResult = {
  lat: number;
  lon: number;
  alt_m: number;
  slope_deg: number;
  dem: string;
  dem_res_m: number;
  year: { sun_pct: number; earth_pct: number; both_pct: number };
  window: {
    start: string;
    hours: number;
    sun_pct: number;
    earth_pct: number;
    both_pct: number;
    longest_sun_h: number;
    score: number;
    verdict: keyof typeof VERDICT;
    reasons: string[];
    sun_countdown: Countdown;
    earth_countdown: Countdown;
    energy: { vertical_tracking_kwh_m2: number; horizontal_kwh_m2: number; best_panel: 'vertical' | 'horizontal' };
  };
  elapsed_s?: number;
};

export const verdictOf = (r: PointResult) => VERDICT[r.window.verdict] ?? 'not-recommended';

export type PointQuery = { lat: number; lon: number; dateMs: number; days: number; delay: number; preset: PresetId; maxSlope: number };

/** Asks the backend to analyse one coordinate for a mission window. */
export async function fetchPoint(q: PointQuery, signal?: AbortSignal): Promise<PointResult> {
  const params = new URLSearchParams({
    lat: q.lat.toFixed(5),
    lon: q.lon.toFixed(5),
    date: new Date(q.dateMs).toISOString().slice(0, 16), // the backend's hourly key, UTC
    days: String(q.days),
    delay: String(q.delay),
    preset: PRESET_PARAM[q.preset],
    max_slope: String(q.maxSlope),
    series: '0',
  });
  const res = await fetch(`${API_BASE}/api/point?${params}`, { signal });
  const body = (await res.json()) as PointResult | { error: string };
  if (!res.ok || 'error' in body) throw new Error('error' in body ? body.error : `${res.status} ${res.statusText}`);
  return body;
}
