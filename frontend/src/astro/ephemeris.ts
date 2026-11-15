/**
 * First-order Sun and Earth geometry as seen from the Moon.
 *
 * Series and libration formulas after Meeus, "Astronomical Algorithms"
 * (2nd ed.), chapters 25, 47 and 53, truncated to their largest terms.
 * Accuracy: about 0.1-0.3 deg for the sub-solar and sub-Earth points, which
 * is enough for a smooth-sphere screening estimate. Terrain horizons and
 * physical libration are NOT included.
 *
 * Frame: Moon body-fixed (MOON_ME approx.), planetocentric degrees,
 * longitude east-positive.
 */

export const MOON_RADIUS_KM = 1737.4;
export const EARTH_RADIUS_KM = 6371.0;
export const AU_KM = 149_597_870.7;
export const SUN_ANGULAR_DIAMETER_DEG = 0.53;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const I_MOON = 1.54242 * D2R; // inclination of the lunar equator to the ecliptic

const norm360 = (a: number) => ((a % 360) + 360) % 360;
const norm180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const sin = (deg: number) => Math.sin(deg * D2R);
const cos = (deg: number) => Math.cos(deg * D2R);

export type LatLon = { lat: number; lon: number };

export type Geometry = {
  /** Sub-solar point on the Moon */
  subSolar: LatLon;
  /** Sub-Earth point on the Moon (optical libration) */
  subEarth: LatLon;
  /** Earth-Moon centre distance, km */
  earthDistanceKm: number;
  /** Sun-Moon distance, km */
  sunDistanceKm: number;
  /** Earth's orientation: Greenwich sidereal angle, deg */
  gmstDeg: number;
  /** Geocentric ecliptic longitude of the Moon, deg (to orient Earth's axis) */
  moonEclLon: number;
  /** Sub-solar point on Earth (declination, east longitude), deg */
  earthSubSolar: LatLon;
  /** Sun's geocentric ecliptic longitude, deg */
  sunEclLon: number;
};

export function julianDay(ms: number) {
  return ms / 86_400_000 + 2_440_587.5;
}

export function geometryAt(ms: number): Geometry {
  const jd = julianDay(ms);
  const T = (jd - 2_451_545.0) / 36_525;

  // Fundamental arguments (deg)
  const Lp = norm360(218.3164477 + 481267.88123421 * T); // Moon mean longitude
  const D = norm360(297.8501921 + 445267.1114034 * T); // mean elongation
  const M = norm360(357.5291092 + 35999.0502909 * T); // Sun mean anomaly
  const Mp = norm360(134.9633964 + 477198.8675055 * T); // Moon mean anomaly
  const F = norm360(93.272095 + 483202.0175233 * T); // Moon argument of latitude
  const Om = norm360(125.0445479 - 1934.1362891 * T); // ascending node

  // Moon geocentric ecliptic position (largest terms)
  const lambda =
    Lp + 6.289 * sin(Mp) + 1.274 * sin(2 * D - Mp) + 0.658 * sin(2 * D) + 0.214 * sin(2 * Mp) - 0.186 * sin(M) - 0.114 * sin(2 * F);
  const beta = 5.128 * sin(F) + 0.281 * sin(Mp + F) + 0.278 * sin(Mp - F) + 0.173 * sin(2 * D - F);
  const earthDistanceKm = 385000.56 - 20905.355 * cos(Mp) - 3699.111 * cos(2 * D - Mp) - 2955.968 * cos(2 * D);

  // Sun geocentric ecliptic longitude and distance
  const L0 = 280.46646 + 36000.76983 * T;
  const C = (1.914602 - 0.004817 * T) * sin(M) + 0.019993 * sin(2 * M);
  const sunLon = norm360(L0 + C);
  const e = 0.016708634;
  const nu = M + C;
  const sunDistAu = (1.000001018 * (1 - e * e)) / (1 + e * cos(nu));
  const sunDistanceKm = sunDistAu * AU_KM;

  // Optical libration: where a body at ecliptic (lam, bet), seen from the
  // Moon's centre in the opposite direction, appears on the lunar surface.
  const subPoint = (lam: number, bet: number): LatLon => {
    const W = (lam - Om) * D2R;
    const b = bet * D2R;
    const A = Math.atan2(Math.sin(W) * Math.cos(b) * Math.cos(I_MOON) - Math.sin(b) * Math.sin(I_MOON), Math.cos(W) * Math.cos(b));
    const lon = norm180(A * R2D - F);
    const lat = Math.asin(-Math.sin(W) * Math.cos(b) * Math.sin(I_MOON) - Math.sin(b) * Math.cos(I_MOON)) * R2D;
    return { lat, lon };
  };

  const subEarth = subPoint(lambda, beta);

  // Selenocentric direction to the Sun ("heliocentric" Moon position)
  const ratio = earthDistanceKm / sunDistanceKm;
  const lamH = sunLon + 180 + ratio * R2D * cos(beta) * sin(sunLon - lambda);
  const betH = ratio * beta;
  const subSolar = subPoint(lamH, betH);

  const d = jd - 2_451_545.0;
  const gmstDeg = norm360(280.46061837 + 360.98564736629 * d);

  // Sun's right ascension and declination -> sub-solar point on Earth
  const eps = 23.4393 - 0.013 * T;
  const ra = Math.atan2(cos(eps) * sin(sunLon), cos(sunLon)) * R2D;
  const dec = Math.asin(sin(eps) * sin(sunLon)) * R2D;
  const earthSubSolar = { lat: dec, lon: norm180(ra - gmstDeg) };

  return { subSolar, subEarth, earthDistanceKm, sunDistanceKm, gmstDeg, moonEclLon: norm360(lambda), earthSubSolar, sunEclLon: sunLon };
}

/** Unit vector for (lat, lon) in the scene frame shared with three.js:
 * lon 0 -> +X, north -> +Y, lon +90 (east) -> -Z. */
export function toVec(lat: number, lon: number): [number, number, number] {
  const cl = cos(lat);
  return [cl * cos(lon), sin(lat), -cl * sin(lon)];
}

export function toLatLon(x: number, y: number, z: number): LatLon {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(y / r) * R2D, lon: norm180(Math.atan2(-z, x) * R2D) };
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Sun-centre elevation above the local horizon of a smooth sphere, deg. */
export function sunElevation(site: LatLon, g: Geometry) {
  return Math.asin(Math.max(-1, Math.min(1, dot(toVec(site.lat, site.lon), toVec(g.subSolar.lat, g.subSolar.lon))))) * R2D;
}

/** Earth-centre elevation, including the parallax of the site (1 Moon radius). */
export function earthElevation(site: LatLon, g: Geometry) {
  const n = toVec(site.lat, site.lon);
  const k = g.earthDistanceKm / MOON_RADIUS_KM;
  const e = toVec(g.subEarth.lat, g.subEarth.lon).map((v) => v * k);
  const d = [e[0] - n[0], e[1] - n[1], e[2] - n[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  return Math.asin(dot(n, d) / len) * R2D;
}

export type Crossing = { ms: number; kind: 'rise' | 'set' } | null;

export type SkyEvents = {
  sunrise: Crossing;
  sunset: Crossing;
  earthrise: Crossing;
  earthset: Crossing;
};

/**
 * Next horizon crossings of the Sun and Earth centres after `fromMs`,
 * searched up to `horizonDays` ahead (coarse scan, then bisection).
 */
export function nextEvents(site: LatLon, fromMs: number, horizonDays = 35): SkyEvents {
  const STEP = 20 * 60_000; // 20 min
  const end = fromMs + horizonDays * 86_400_000;
  const out: SkyEvents = { sunrise: null, sunset: null, earthrise: null, earthset: null };

  const refine = (f: (ms: number) => number, a: number, b: number) => {
    let fa = f(a);
    for (let i = 0; i < 24; i++) {
      const m = (a + b) / 2;
      const fm = f(m);
      if (Math.sign(fm) === Math.sign(fa)) {
        a = m;
        fa = fm;
      } else b = m;
    }
    return (a + b) / 2;
  };
  const sunF = (ms: number) => sunElevation(site, geometryAt(ms));
  const earthF = (ms: number) => earthElevation(site, geometryAt(ms));

  let t0 = fromMs;
  let g0 = geometryAt(t0);
  let s0 = sunElevation(site, g0);
  let e0 = earthElevation(site, g0);
  for (let t = fromMs + STEP; t <= end; t += STEP) {
    const g = geometryAt(t);
    const s = sunElevation(site, g);
    const e = earthElevation(site, g);
    if (s0 <= 0 && s > 0 && !out.sunrise) out.sunrise = { ms: refine(sunF, t0, t), kind: 'rise' };
    if (s0 > 0 && s <= 0 && !out.sunset) out.sunset = { ms: refine(sunF, t0, t), kind: 'set' };
    if (e0 <= 0 && e > 0 && !out.earthrise) out.earthrise = { ms: refine(earthF, t0, t), kind: 'rise' };
    if (e0 > 0 && e <= 0 && !out.earthset) out.earthset = { ms: refine(earthF, t0, t), kind: 'set' };
    if (out.sunrise && out.sunset && out.earthrise && out.earthset) break;
    t0 = t;
    s0 = s;
    e0 = e;
  }
  return out;
}
