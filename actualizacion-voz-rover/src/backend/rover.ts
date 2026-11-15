import type { Region } from './region';

/**
 * Rover traversability, derived in the browser from the terrain the backend
 * already delivers for each analysed area: elevation and slope of every grid
 * point (LOLA DEM, points 1 km apart). Nothing here is measured at rover
 * scale: it says which parts of the area a rover could reach over the broad
 * relief, not whether a given boulder field is drivable.
 */

/** Slope limits of real rovers, from NASA sources. The UI lets the user move the limit. */
export const ROVERS = [
  {
    id: 'viper',
    name: 'VIPER',
    maxSlope: 15,
    source: 'NASA Science, VIPER lunar operations: “can generally drive on a slope of up to 15 degrees”',
    url: 'https://science.nasa.gov/mission/viper/lunar-operations/',
  },
  {
    id: 'lrv',
    name: 'Apollo LRV',
    maxSlope: 25,
    source: 'NASA SP-4214, ch. 13: the Lunar Roving Vehicle could “climb and descend slopes of 25 degrees”',
    url: 'https://www.hq.nasa.gov/office/pao/History/SP-4214/ch13-3.html',
  },
] as const;

export type Traverse = {
  /** Driving distance from the start to each grid point, km (Infinity = not reachable). */
  driveKm: Float32Array;
  /** Whether the point itself is under the slope limit. */
  passable: Uint8Array;
  startOk: boolean;
  reachable: number;
  reachableKm2: number;
  /** Share of the area's points the rover can reach from the start. */
  reachableShare: number;
  /** Straight-line distance to the farthest reachable point, km. */
  rangeKm: number;
  /** Longest shortest-path drive to a reachable point, km. */
  longestDriveKm: number;
};

const NEIGHBOURS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
] as const;

/**
 * Where a rover can go from `start` with a slope limit. A step between two
 * neighbouring points is allowed when both are under the limit and the grade
 * between them (elevation difference over their distance) is too.
 */
export function traverse(reg: Region, start: number, maxSlope: number): Traverse {
  const { rows, cols, spacing_m } = reg.grid;
  const alt = reg.points.alt_m;
  const slope = reg.points.slope_deg;
  const P = reg.P;
  const passable = new Uint8Array(P);
  for (let p = 0; p < P; p++) passable[p] = slope[p] !== null && alt[p] !== null && (slope[p] as number) <= maxSlope ? 1 : 0;

  const driveKm = new Float32Array(P).fill(Infinity);
  const done = new Uint8Array(P);
  const tan = Math.tan((maxSlope * Math.PI) / 180);
  if (passable[start]) driveKm[start] = 0;

  // Dijkstra over at most a few hundred points: a linear scan for the minimum is enough
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let p = 0; p < P; p++) {
      if (!done[p] && driveKm[p] < best) {
        best = driveKm[p];
        u = p;
      }
    }
    if (u < 0) break;
    done[u] = 1;
    const r = Math.floor(u / cols);
    const c = u % cols;
    for (const [dr, dc] of NEIGHBOURS) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      const v = rr * cols + cc;
      if (!passable[v] || done[v]) continue;
      const dist = spacing_m * Math.hypot(dr, dc);
      if (Math.abs((alt[v] as number) - (alt[u] as number)) / dist > tan) continue;
      const d = best + dist / 1000;
      if (d < driveKm[v]) driveKm[v] = d;
    }
  }

  let reachable = 0;
  let rangeKm = 0;
  let longestDriveKm = 0;
  const sr = Math.floor(start / cols);
  const sc = start % cols;
  for (let p = 0; p < P; p++) {
    if (driveKm[p] === Infinity) continue;
    reachable++;
    longestDriveKm = Math.max(longestDriveKm, driveKm[p]);
    rangeKm = Math.max(rangeKm, (spacing_m / 1000) * Math.hypot(Math.floor(p / cols) - sr, (p % cols) - sc));
  }
  const cellKm2 = (spacing_m / 1000) ** 2;
  return { driveKm, passable, startOk: passable[start] === 1, reachable, reachableKm2: reachable * cellKm2, reachableShare: reachable / P, rangeKm, longestDriveKm };
}

/**
 * Relief roughness per grid point: the Terrain Ruggedness Index (Riley et al.
 * 1999), the mean absolute elevation difference to the neighbouring points,
 * in metres. With points 1 km apart it describes hills and crater walls, not
 * rocks.
 */
export function ruggedness(reg: Region): (number | null)[] {
  const { rows, cols } = reg.grid;
  const alt = reg.points.alt_m;
  return alt.map((a, p) => {
    if (a === null) return null;
    const r = Math.floor(p / cols);
    const c = p % cols;
    let sum = 0;
    let n = 0;
    for (const [dr, dc] of NEIGHBOURS) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      const b = alt[rr * cols + cc];
      if (b === null) continue;
      sum += Math.abs(b - a);
      n++;
    }
    return n ? sum / n : null;
  });
}
