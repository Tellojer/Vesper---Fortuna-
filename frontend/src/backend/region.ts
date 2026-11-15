/**
 * TypeScript port of the backend's web/lib/region.js (Vesper data-pipeline).
 * Reads a precomputed region (grid_region.py output) and derives everything
 * the UI shows. Same maths and conventions as the original:
 *   azimuth 0 = north, 90 = east; elevations in degrees;
 *   p = grid point index (row * cols + col, row 0 = top of the map);
 *   t = hour index from times.start (step times.step_h hours).
 */

const D2R = Math.PI / 180;

export type RawRegion = {
  region: {
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
    dem: string;
  };
  grid: { rows: number; cols: number; spacing_m: number; center_xy: [number, number]; bounds_xy: number[]; image: string };
  times: { start: string; step_h: number; n: number };
  center: { sun: { az: number[]; el: number[] }; earth: { az: number[]; el: number[] } };
  points: { lat: number[]; lon: number[]; alt_m: (number | null)[]; slope_deg: (number | null)[] };
  horizon_cdeg_b64: string;
  sun_bits_b64: string;
  earth_bits_b64: string;
  bits_row_bytes: number;
  summary: { sun_pct_max: number; earth_pct_max: number };
};

type Vec = [number, number, number];
type Frame = { E: Vec; N: Vec; U: Vec };

export type Region = RawRegion & {
  P: number;
  T: number;
  startMs: number;
  horizon: Int16Array;
  bits: { sun: Uint8Array; earth: Uint8Array };
  vecs: { sun: Float64Array; earth: Float64Array };
  frames: Frame[];
  /** Index of the grid point at the region centre (the site itself). */
  centerP: number;
};

export type Body = 'sun' | 'earth';

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function enu(lat: number, lon: number): Frame {
  const p = lat * D2R;
  const l = lon * D2R;
  const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  return { E: [-sl, cl, 0], N: [-sp * cl, -sp * sl, cp], U: [cp * cl, cp * sl, sp] };
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function prepareRegion(raw: RawRegion): Region {
  const P = raw.points.lat.length;
  const hBytes = b64ToBytes(raw.horizon_cdeg_b64);
  const horizon = new Int16Array(hBytes.buffer, hBytes.byteOffset, P * 360);

  const c = enu(raw.region.lat, raw.region.lon);
  const toVecs = (series: { az: number[]; el: number[] }) => {
    const n = series.az.length;
    const v = new Float64Array(n * 3);
    for (let t = 0; t < n; t++) {
      const a = series.az[t] * D2R;
      const e = series.el[t] * D2R;
      const ce = Math.cos(e), x = ce * Math.sin(a), y = ce * Math.cos(a), z = Math.sin(e);
      for (let k = 0; k < 3; k++) v[t * 3 + k] = x * c.E[k] + y * c.N[k] + z * c.U[k];
    }
    return v;
  };

  return {
    ...raw,
    P,
    T: raw.times.n,
    startMs: Date.parse(raw.times.start + 'Z'),
    horizon,
    bits: { sun: b64ToBytes(raw.sun_bits_b64), earth: b64ToBytes(raw.earth_bits_b64) },
    vecs: { sun: toVecs(raw.center.sun), earth: toVecs(raw.center.earth) },
    frames: raw.points.lat.map((lat, i) => enu(lat, raw.points.lon[i])),
    centerP: Math.floor(raw.grid.rows / 2) * raw.grid.cols + Math.floor(raw.grid.cols / 2),
  };
}

export function isVisible(reg: Region, p: number, t: number, body: Body) {
  const byte = reg.bits[body][p * reg.bits_row_bytes + (t >> 3)];
  return ((byte >> (t & 7)) & 1) === 1;
}

export function localAzEl(reg: Region, p: number, t: number, body: Body) {
  const v = reg.vecs[body];
  const f = reg.frames[p];
  const d: Vec = [v[t * 3], v[t * 3 + 1], v[t * 3 + 2]];
  const az = (Math.atan2(dot(d, f.E), dot(d, f.N)) / D2R + 360) % 360;
  const el = Math.asin(Math.max(-1, Math.min(1, dot(d, f.U)))) / D2R;
  return { az, el };
}

export function horizonProfile(reg: Region, p: number) {
  const out = new Array<number>(360);
  for (let i = 0; i < 360; i++) out[i] = reg.horizon[p * 360 + i] / 100;
  return out;
}

export function track(reg: Region, p: number, t0: number, hours: number, body: Body, every = 1) {
  const out: { t: number; az: number; el: number; visible: boolean }[] = [];
  for (let t = t0; t < Math.min(reg.T, t0 + hours); t += every) {
    out.push({ t, ...localAzEl(reg, p, t, body), visible: isVisible(reg, p, t, body) });
  }
  return out;
}

export function windowStats(reg: Region, p: number, t0: number, hours: number) {
  const t1 = Math.min(reg.T, t0 + hours);
  const n = Math.max(1, t1 - t0);
  let sun = 0, earth = 0, both = 0, run = 0, longest = 0;
  for (let t = t0; t < t1; t++) {
    const s = isVisible(reg, p, t, 'sun');
    const e = isVisible(reg, p, t, 'earth');
    sun += +s;
    earth += +e;
    both += +(s && e);
    run = s ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return { sun: sun / n, earth: earth / n, both: both / n, longestSun: longest / n, longestSunHours: longest * reg.times.step_h };
}

/** Backend presets (names translated; weights unchanged). */
export const PRESETS = {
  balanced: { label: 'Balanced', weights: { sun: 0.4, earth: 0.25, both: 0.15, longestSun: 0.2 } },
  solar: { label: 'Solar power', weights: { sun: 0.5, earth: 0.1, both: 0.1, longestSun: 0.3 } },
  comms: { label: 'Communication', weights: { sun: 0.25, earth: 0.5, both: 0.15, longestSun: 0.1 } },
} as const satisfies Record<string, { label: string; weights: Record<'sun' | 'earth' | 'both' | 'longestSun', number> }>;
export type PresetId = keyof typeof PRESETS;
type Weights = (typeof PRESETS)[PresetId]['weights'];

export function rankPoints(reg: Region, t0: number, hours: number, weights: Weights = PRESETS.balanced.weights, maxSlope = 10) {
  const res = [];
  for (let p = 0; p < reg.P; p++) {
    const slope = reg.points.slope_deg[p];
    const st = windowStats(reg, p, t0, hours);
    const ok = slope !== null && reg.points.alt_m[p] !== null && slope <= maxSlope;
    const score = ok ? 100 * (weights.sun * st.sun + weights.earth * st.earth + weights.both * st.both + weights.longestSun * st.longestSun) : null;
    res.push({ p, score, slope, ...st });
  }
  res.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return res;
}

export function scoreGrid(reg: Region, t0: number, hours: number, weights: Weights, maxSlope: number) {
  const g = new Array<number | null>(reg.P).fill(null);
  for (const r of rankPoints(reg, t0, hours, weights, maxSlope)) g[r.p] = r.score;
  return g;
}

/** Hours until the body changes state (sets if visible, rises if not); null if not within the data. */
export function countdown(reg: Region, p: number, t: number, body: Body) {
  const visible = isVisible(reg, p, t, body);
  for (let k = t + 1; k < reg.T; k++) {
    if (isVisible(reg, p, k, body) !== visible) return { visible, hours: (k - t) * reg.times.step_h };
  }
  return { visible, hours: null as number | null };
}

/** Verdict rule from the backend API: not recommended if slope > max or score < 30; suitable if score >= 50. */
export function verdict(score: number | null, slope: number | null, maxSlope: number) {
  if (score === null || slope === null || slope > maxSlope || score < 30) return 'not-recommended' as const;
  return score >= 50 ? ('suitable' as const) : ('acceptable' as const);
}

export function pointToImage(reg: Region, p: number) {
  const { rows, cols } = reg.grid;
  return { x: ((p % cols) + 0.5) / cols, y: (Math.floor(p / cols) + 0.5) / rows };
}

export function imageToPoint(reg: Region, x: number, y: number) {
  const { rows, cols } = reg.grid;
  const c = Math.min(cols - 1, Math.max(0, Math.floor(x * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(y * rows)));
  return r * cols + c;
}

const cache = new Map<string, Promise<Region>>();

/** Loads (once) and decodes a region file from public/data/vesper. */
export function loadRegion(file: string) {
  let p = cache.get(file);
  if (!p) {
    p = fetch(`/data/vesper/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${file}: ${r.status}`);
        return r.json() as Promise<RawRegion>;
      })
      .then((raw) => {
        // The relief image sits next to the region file
        const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
        return prepareRegion(dir ? { ...raw, grid: { ...raw.grid, image: dir + raw.grid.image } } : raw);
      });
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return p;
}
