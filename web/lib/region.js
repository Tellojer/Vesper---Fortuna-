/**
 * region.js — lee los datos de una región (generados por grid_region.py) y
 * calcula todo lo que la app muestra. Sin dependencias, sin servidor.
 *
 *   import * as R from './lib/region.js';
 *   const reg = await R.loadRegion('data/region-test-polo.json');
 *   const t0  = R.timeIndex(reg, '2027-03-12T00:00');      // fecha de aterrizaje
 *   const ranking = R.rankPoints(reg, t0, 10 * 24);        // misión de 10 días
 *   ranking[0]  // -> {p, score, sun, earth, both, longestSun, slope}
 *   R.localAzEl(reg, ranking[0].p, t0, 'sun')              // -> {az, el}
 *   R.countdown(reg, ranking[0].p, t0, 'earth')            // -> {visible, hours}
 *
 * Convenciones: azimut 0 = norte, 90 = este. Elevación en grados.
 * p = índice del punto en la cuadrícula (fila * cols + col; fila 0 = arriba del mapa).
 * t = índice de hora desde reg.times.start (paso reg.times.step_h horas).
 */

const D2R = Math.PI / 180;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function enu(lat, lon) {
  const p = lat * D2R, l = lon * D2R;
  const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  return {
    E: [-sl, cl, 0],
    N: [-sp * cl, -sp * sl, cp],
    U: [cp * cl, cp * sl, sp],
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Carga y decodifica una región. */
export async function loadRegion(url) {
  const raw = await (await fetch(url)).json();
  return prepareRegion(raw);
}

/** Igual que loadRegion pero con el JSON ya leído (útil en pruebas). */
export function prepareRegion(raw) {
  const P = raw.points.lat.length;
  const hBytes = b64ToBytes(raw.horizon_cdeg_b64);
  const horizon = new Int16Array(hBytes.buffer, hBytes.byteOffset, P * 360);

  // Dirección del Sol y la Tierra como vectores fijos a la Luna (una vez).
  const c = enu(raw.region.lat, raw.region.lon);
  const toVecs = (series) => {
    const n = series.az.length, v = new Float64Array(n * 3);
    for (let t = 0; t < n; t++) {
      const a = series.az[t] * D2R, e = series.el[t] * D2R;
      const ce = Math.cos(e), x = ce * Math.sin(a), y = ce * Math.cos(a), z = Math.sin(e);
      for (let k = 0; k < 3; k++) v[t * 3 + k] = x * c.E[k] + y * c.N[k] + z * c.U[k];
    }
    return v;
  };

  const frames = raw.points.lat.map((lat, i) => enu(lat, raw.points.lon[i]));

  return {
    ...raw,
    P,
    T: raw.times.n,
    startMs: Date.parse(raw.times.start + 'Z'),
    horizon,
    bits: { sun: b64ToBytes(raw.sun_bits_b64), earth: b64ToBytes(raw.earth_bits_b64) },
    vecs: { sun: toVecs(raw.center.sun), earth: toVecs(raw.center.earth) },
    frames,
  };
}

/** Índice de hora para una fecha ISO ('2027-03-12T00:00', UTC). */
export function timeIndex(reg, iso) {
  const ms = Date.parse(iso.length <= 10 ? iso + 'T00:00Z' : iso.endsWith('Z') ? iso : iso + 'Z');
  const t = Math.round((ms - reg.startMs) / (reg.times.step_h * 3600e3));
  return Math.max(0, Math.min(reg.T - 1, t));
}

/** Fecha ISO (UTC) de un índice de hora. */
export function timeLabel(reg, t) {
  return new Date(reg.startMs + t * reg.times.step_h * 3600e3).toISOString().slice(0, 16);
}

/** ¿Está visible el Sol / la Tierra en el punto p a la hora t? */
export function isVisible(reg, p, t, body) {
  const byte = reg.bits[body][p * reg.bits_row_bytes + (t >> 3)];
  return ((byte >> (t & 7)) & 1) === 1;
}

/** Azimut y elevación local del Sol / la Tierra en el punto p a la hora t. */
export function localAzEl(reg, p, t, body) {
  const v = reg.vecs[body], f = reg.frames[p];
  const d = [v[t * 3], v[t * 3 + 1], v[t * 3 + 2]];
  const az = (Math.atan2(dot(d, f.E), dot(d, f.N)) / D2R + 360) % 360;
  const el = Math.asin(Math.max(-1, Math.min(1, dot(d, f.U)))) / D2R;
  return { az, el };
}

/** Perfil de horizonte del punto p: 360 elevaciones (grados), índice = azimut. */
export function horizonProfile(reg, p) {
  const out = new Array(360);
  for (let i = 0; i < 360; i++) out[i] = reg.horizon[p * 360 + i] / 100;
  return out;
}

/** Trayectoria para la gráfica polar: [{t, az, el, visible}] cada `every` horas. */
export function track(reg, p, t0, hours, body, every = 1) {
  const out = [];
  for (let t = t0; t < Math.min(reg.T, t0 + hours); t += every) {
    out.push({ t, ...localAzEl(reg, p, t, body), visible: isVisible(reg, p, t, body) });
  }
  return out;
}

/** Estadísticas del punto p en la ventana [t0, t0+hours). Fracciones 0..1. */
export function windowStats(reg, p, t0, hours) {
  const t1 = Math.min(reg.T, t0 + hours), n = Math.max(1, t1 - t0);
  let sun = 0, earth = 0, both = 0, run = 0, longest = 0;
  for (let t = t0; t < t1; t++) {
    const s = isVisible(reg, p, t, 'sun'), e = isVisible(reg, p, t, 'earth');
    sun += s; earth += e; both += s && e;
    run = s ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return {
    sun: sun / n, earth: earth / n, both: both / n,
    longestSun: longest / n,                       // fracción de la ventana
    longestSunHours: longest * reg.times.step_h,
  };
}

export const PRESETS = {
  equilibrada:   { sun: 0.40, earth: 0.25, both: 0.15, longestSun: 0.20 },
  solar:         { sun: 0.50, earth: 0.10, both: 0.10, longestSun: 0.30 },
  comunicacion:  { sun: 0.25, earth: 0.50, both: 0.15, longestSun: 0.10 },
};

/**
 * Puntaje 0..100 de cada punto para una ventana de misión, ordenado de mejor a peor.
 * Puntos con pendiente > maxSlope o fuera del DEM quedan con score null (al final).
 */
export function rankPoints(reg, t0, hours, weights = PRESETS.equilibrada, maxSlope = 10) {
  const res = [];
  for (let p = 0; p < reg.P; p++) {
    const slope = reg.points.slope_deg[p];
    const st = windowStats(reg, p, t0, hours);
    const ok = slope !== null && reg.points.alt_m[p] !== null && slope <= maxSlope;
    const score = ok
      ? 100 * (weights.sun * st.sun + weights.earth * st.earth +
               weights.both * st.both + weights.longestSun * st.longestSun)
      : null;
    res.push({ p, score, slope, ...st });
  }
  res.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return res;
}

/** Puntajes en orden de cuadrícula (para pintar el mapa de calor). */
export function scoreGrid(reg, t0, hours, weights, maxSlope) {
  const g = new Array(reg.P).fill(null);
  for (const r of rankPoints(reg, t0, hours, weights, maxSlope)) g[r.p] = r.score;
  return g;
}

/**
 * Cuenta regresiva desde la hora t:
 *  - si el cuerpo está visible: horas hasta que se oculte (atardecer / ocaso de la Tierra)
 *  - si no está visible: horas hasta que aparezca
 * hours = null si no cambia antes del fin de los datos.
 */
export function countdown(reg, p, t, body) {
  const visible = isVisible(reg, p, t, body);
  for (let k = t + 1; k < reg.T; k++) {
    if (isVisible(reg, p, k, body) !== visible) return { visible, hours: (k - t) * reg.times.step_h };
  }
  return { visible, hours: null };
}

/** Posición del punto p en el mapa como fracción 0..1 de la imagen (x a la derecha, y hacia abajo). */
export function pointToImage(reg, p) {
  const { rows, cols } = reg.grid;
  const r = Math.floor(p / cols), c = p % cols;
  return { x: (c + 0.5) / cols, y: (r + 0.5) / rows };
}

/** Punto de la cuadrícula más cercano a un clic en la imagen (fracciones 0..1). */
export function imageToPoint(reg, x, y) {
  const { rows, cols } = reg.grid;
  const c = Math.min(cols - 1, Math.max(0, Math.floor(x * cols)));
  const r = Math.min(rows - 1, Math.max(0, Math.floor(y * rows)));
  return r * cols + c;
}
