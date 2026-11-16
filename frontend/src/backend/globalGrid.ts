import { asset } from '../lib/asset';
import { BackendError, type PointQuery, type PointResult } from './api';
import type { Ephemeris } from './data';
import { PRESETS } from './region';

/**
 * Analysis of any coordinate without the live server.
 *
 * The pipeline precomputes a grid of points over the whole Moon
 * (design/tools/global_grid.py, which calls the same engine as /api/point):
 * for each one, elevation, slope and whether the Sun and the Earth clear the
 * LOLA terrain horizon for every hour of the year. Here the nearest grid point
 * is scored for the mission window with the backend's rules
 * (point_engine.analyze_point), so the answer has the same shape as the
 * server's. It describes that grid point, not the exact coordinate asked for.
 */

type GridMeta = {
  step_deg: number;
  times: { start: string; step_h: number; n: number };
  row_bytes: number;
  dems: string[];
  points: { lat: number[]; lon: number[]; alt_m: number[]; slope_deg: number[]; dem: number[] };
};
type Grid = GridMeta & { bits: Uint8Array };

const D2R = Math.PI / 180;
const MOON_RADIUS_KM = 1737.4;
const SOLAR_CONSTANT = 1361; // W/m2, as in the backend
/** Pixel size of each DEM in metres, as the server reports it. */
const DEM_RES_M: Record<string, number> = { 'Polo Sur': 87, 'Polo Norte': 123, Global: 237 };
const VERDICT = { suitable: 'apto', acceptable: 'aceptable', 'not-recommended': 'no recomendado' } as const;

let cache: Promise<Grid> | null = null;

function loadGrid(): Promise<Grid> {
  cache ??= Promise.all([
    fetch(asset('/data/vesper/global-grid.json')).then((r) => {
      if (!r.ok) throw new Error(`global-grid.json: ${r.status}`);
      return r.json() as Promise<GridMeta>;
    }),
    fetch(asset('/data/vesper/global-grid.bin')).then((r) => {
      if (!r.ok) throw new Error(`global-grid.bin: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]).then(([meta, buf]) => {
    const bits = new Uint8Array(buf);
    if (bits.length !== meta.points.lat.length * meta.row_bytes * 2) throw new Error('global-grid.bin does not match global-grid.json');
    return { ...meta, bits };
  });
  cache.catch(() => (cache = null));
  return cache;
}

/** Great-circle distance in degrees of arc. */
function arcDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const c = Math.sin(lat1 * D2R) * Math.sin(lat2 * D2R) + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos((lon1 - lon2) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}

export type OfflineAnswer = { result: PointResult; distanceKm: number };

/**
 * Scores the grid point nearest to the requested coordinate for the mission
 * window. `ephem` gives the Sun direction per hour (for the panel energy).
 */
export async function analyseOffline(q: PointQuery, ephem: Ephemeris): Promise<OfflineAnswer> {
  const g = await loadGrid();
  const pts = g.points;

  let p = 0;
  let best = Infinity;
  for (let i = 0; i < pts.lat.length; i++) {
    const d = arcDeg(q.lat, q.lon, pts.lat[i], pts.lon[i]);
    if (d < best) {
      best = d;
      p = i;
    }
  }

  const T = g.times.n;
  const stepH = g.times.step_h;
  const sunRow = p * 2 * g.row_bytes;
  const earthRow = sunRow + g.row_bytes;
  const bit = (row: number, t: number) => (g.bits[row + (t >> 3)] >> (t & 7)) & 1;

  // Mission window, as in analyze_point: the date's hour, plus the delay
  const startMs = Date.parse(g.times.start + 'Z');
  const tDate = Math.round((q.dateMs - startMs) / (stepH * 3_600_000));
  if (tDate < 0 || tDate > T - 1) throw new BackendError(`Date outside the data (${g.times.start.slice(0, 4)})`);
  const t0 = Math.min(T - 1, tDate + Math.floor((q.delay * 24) / stepH));
  const t1 = Math.min(T, t0 + q.days * 24);
  const n = Math.max(1, t1 - t0);

  // Local "up" of the grid point in the pipeline's Moon frame (x -> lon 0, y -> lon 90E, z -> north)
  const la = pts.lat[p] * D2R;
  const lo = pts.lon[p] * D2R;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];

  let sun = 0, earth = 0, both = 0, run = 0, longest = 0, vert = 0, horiz = 0;
  for (let t = t0; t < t1; t++) {
    const s = bit(sunRow, t);
    const e = bit(earthRow, t);
    sun += s;
    earth += e;
    both += s & e;
    run = s ? run + 1 : 0;
    if (run > longest) longest = run;
    if (s) {
      const i = Math.min(ephem.n - 1, t) * 6;
      const sinEl = Math.max(-1, Math.min(1, ephem.data[i] * up[0] + ephem.data[i + 1] * up[1] + ephem.data[i + 2] * up[2]));
      vert += Math.sqrt(1 - sinEl * sinEl);
      horiz += Math.max(0, sinEl);
    }
  }
  const st = { sun: sun / n, earth: earth / n, both: both / n, longestSun: longest / n };
  const w = PRESETS[q.preset].weights;
  const score = 100 * (w.sun * st.sun + w.earth * st.earth + w.both * st.both + w.longestSun * st.longestSun);
  const slope = pts.slope_deg[p];
  const slopeOk = slope <= q.maxSlope;
  const verdict = !slopeOk || score < 30 ? 'not-recommended' : score >= 50 ? 'suitable' : 'acceptable';

  const vertPct = (vert / n) * 100;
  const horizPct = (horiz / n) * 100;
  const kwh = (sum: number) => Math.round(((sum * SOLAR_CONSTANT * stepH) / 1000) * 10) / 10;
  const pct = (f: number) => `${Math.round(f * 100)}%`;

  // Same rules and order as the backend's reasons, written in English
  const reasons: string[] = [];
  if (!slopeOk) reasons.push(`Slope of ${slope.toFixed(1)}°, above the ${q.maxSlope}° limit`);
  if (st.sun < 0.25) reasons.push(`Little sunlight during the mission: ${pct(st.sun)} of the hours`);
  if (st.earth < 0.25) {
    reasons.push(st.earth < 0.02 ? 'Almost no direct contact with Earth: it would need a relay satellite' : `Little contact with Earth: ${pct(st.earth)} of the hours`);
  }
  if (longest * stepH < 48 && st.sun > 0) reasons.push(`The longest stretch of continuous sunlight is only ${longest * stepH} h`);
  if (st.sun > 0 && horizPct < 0.25 * vertPct) {
    reasons.push(`Sun very low: vertical panels are needed (a horizontal panel yields ${Math.round(horizPct)}% against ${Math.round(vertPct)}% for a vertical one)`);
  }

  const countdown = (row: number) => {
    const visible = bit(row, t0) === 1;
    for (let t = t0 + 1; t < T; t++) if ((bit(row, t) === 1) !== visible) return { visible, hours: (t - t0) * stepH };
    return { visible, hours: null };
  };

  let ySun = 0, yEarth = 0, yBoth = 0;
  for (let t = 0; t < T; t++) {
    const s = bit(sunRow, t);
    const e = bit(earthRow, t);
    ySun += s;
    yEarth += e;
    yBoth += s & e;
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const dem = g.dems[pts.dem[p]] ?? 'Global';

  return {
    distanceKm: best * D2R * MOON_RADIUS_KM,
    result: {
      lat: pts.lat[p],
      lon: pts.lon[p],
      alt_m: pts.alt_m[p],
      slope_deg: slope,
      dem,
      dem_res_m: DEM_RES_M[dem] ?? 237,
      year: { sun_pct: r1((ySun / T) * 100), earth_pct: r1((yEarth / T) * 100), both_pct: r1((yBoth / T) * 100) },
      window: {
        start: new Date(startMs + t0 * stepH * 3_600_000).toISOString().slice(0, 16),
        hours: n,
        sun_pct: r1(st.sun * 100),
        earth_pct: r1(st.earth * 100),
        both_pct: r1(st.both * 100),
        longest_sun_h: longest * stepH,
        score: r1(score),
        verdict: VERDICT[verdict],
        reasons,
        sun_countdown: countdown(sunRow),
        earth_countdown: countdown(earthRow),
        energy: {
          vertical_tracking_kwh_m2: kwh(vert),
          horizontal_kwh_m2: kwh(horiz),
          best_panel: vertPct >= horizPct ? 'vertical' : 'horizontal',
        },
      },
    },
  };
}
