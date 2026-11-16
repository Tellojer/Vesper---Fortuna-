import type { PresetId } from './region';

/**
 * Live Vesper backend (data-pipeline/server.py, see API.md). It analyses the
 * exact coordinate asked for, so it only works while that server runs:
 *   python server.py --dem-south ... --dem-north ... --dem-global ...
 * Set VITE_VESPER_API to point somewhere else than port 8000 of this host.
 * When it cannot be reached the app falls back to the precomputed global
 * grid (globalGrid.ts).
 */
export const API_BASE: string =
  (import.meta.env.VITE_VESPER_API as string | undefined) ??
  (location.hostname.endsWith('github.io') ? 'http://localhost:8000' : `http://${location.hostname}:8000`);

/** The server answered, and its answer was an error (bad parameter, date out of range, no DEM). */
export class BackendError extends Error {}

/** Longest the live server may take before the app falls back to the precomputed grid. */
const TIMEOUT_MS = 15_000;

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
  // Anything other than a JSON answer from the server (no connection, a dead
  // tunnel's error page, a timeout) is left as a plain error: the caller falls back
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(`${API_BASE}/api/point?${params}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const body = (await res.json()) as PointResult | { error: string };
  if ('error' in body) throw new BackendError(body.error);
  if (!res.ok || !('window' in body)) throw new Error(`${res.status} ${res.statusText}`);
  return body;
}
