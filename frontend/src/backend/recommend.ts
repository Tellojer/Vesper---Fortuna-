import type { RegionId, Site } from '../data/types';
import { PRESETS, rankPoints, verdict, type PresetId, type Region } from './region';

/** Zone of the Moon a site belongs to, with the same rule the view uses for its title. */
export function zoneOf(lat: number, lon: number): 'nearside' | 'farside' | 'north' | 'south' {
  if (lat > 55) return 'north';
  if (lat < -55) return 'south';
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Math.abs(l) <= 90 ? 'nearside' : 'farside';
}

export function zoneForRegion(region: RegionId) {
  return region === 'stereo-north' ? 'north' : region === 'stereo-south' ? 'south' : region;
}

export const ZONE_LABEL = { nearside: 'Nearside', farside: 'Farside', north: 'North Pole', south: 'South Pole' } as const;

/**
 * Recommended landing sites, independent of the missions: one per area the
 * backend analysed (a grid of points 1 km apart). The areas are the ones
 * around the catalogue sites plus the surveyed ones, which the backend engine
 * found far from any mission by sampling the whole zone. The site is the
 * best-scoring grid point of its area for the mission window, so its
 * coordinates are the backend's, not the mission's. Names are generic and
 * stable per zone (Farside 1, Farside 2, ...), numbered in backend order.
 */
export type RecoArea = { id: string; name: string; zone: ReturnType<typeof zoneOf>; site: Site; surveyed: boolean };

export function recoAreas(sites: Site[], survey: Site[] = []): RecoArea[] {
  const count: Record<string, number> = {};
  const area = (surveyed: boolean) => (site: Site) => {
    const zone = zoneOf(site.lat, site.lon);
    count[zone] = (count[zone] ?? 0) + 1;
    return { id: site.id, name: `${ZONE_LABEL[zone]} ${count[zone]}`, zone, site, surveyed };
  };
  return [...sites.filter((s) => s.file).map(area(false)), ...survey.map(area(true))];
}

/** A recommended site as drawn on the Moon. */
export type RecoMarker = { id: string; name: string; lat: number; lon: number; verdict: 'suitable' | 'acceptable' | 'not-recommended' };

export type MissionParams = { t0: number; hours: number; preset: PresetId; maxSlope: number };

/** Backend ranking of one region for a mission window. */
export function evaluateRegion(reg: Region, m: MissionParams) {
  const rank = rankPoints(reg, m.t0, m.hours, PRESETS[m.preset].weights, m.maxSlope);
  const best = rank[0];
  const valid = rank.filter((r) => r.score !== null).length;
  return { rank, best, valid, verdict: verdict(best?.score ?? null, best?.slope ?? null, m.maxSlope) };
}

export type ZoneResult = { area: RecoArea; result: ReturnType<typeof evaluateRegion> | null; error?: string };

/** Sort: scored zones by best score, then those without a valid point. */
export function sortZones(list: ZoneResult[]) {
  return [...list].sort((a, b) => (b.result?.best?.score ?? -1) - (a.result?.best?.score ?? -1));
}

/** Integer priority slider, ordered from communication to solar power (backend presets). */
export const PRIORITY_STEPS: PresetId[] = ['comms', 'balanced', 'solar'];
