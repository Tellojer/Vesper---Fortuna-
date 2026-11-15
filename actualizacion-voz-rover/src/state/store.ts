import { useSyncExternalStore } from 'react';
import type { LatLon } from '../astro/ephemeris';
import type { Ephemeris } from '../backend/data';
import type { RecoMarker } from '../backend/recommend';
import type { PresetId } from '../backend/region';
import type { MoonManifest, RegionId, Site } from '../data/types';

/** Playback speeds, in data hours per second. */
export const SPEEDS = [
  { id: '1h', label: '1 h/s', hoursPerSec: 1 },
  { id: '6h', label: '6 h/s', hoursPerSec: 6 },
  { id: '1d', label: '1 d/s', hoursPerSec: 24 },
] as const;

export type AppState = {
  /** Backend ephemeris: defines the time range (all of 2027 today). */
  ephem: Ephemeris | null;
  /** Current hour index into the backend time series. */
  t: number;
  playing: boolean;
  speedId: (typeof SPEEDS)[number]['id'];
  /** Mission parameters, same controls and ranges as the backend app. */
  missionDays: number;
  delayDays: number;
  preset: PresetId;
  maxSlope: number;
  /** Steepest slope the rover can drive, degrees (Terrain tab). */
  roverSlope: number;
  /** Grid point chosen in the selected site's region (null = follow the best point). */
  pickedPoint: number | null;
  /** Recommended landing sites of the zone in view (drawn on the Moon while the navigator is open). */
  recoMarkers: RecoMarker[];
  /** Right-hand "Landing site navigator" menu; hidden until its button is pressed. */
  navigatorOpen: boolean;
  /** Whether the mission markers are drawn on the Moon. */
  showMissions: boolean;
  region: RegionId;
  center: LatLon;
  selectedId: string | null;
  /** Any coordinate picked on the Moon or typed, analysed live by the backend (/api/point). */
  customPoint: LatLon | null;
  customVerdict: 'suitable' | 'acceptable' | 'not-recommended' | null;
  /** What the selection is: a mission from the catalogue or a recommended site (same backend area id). */
  selectedKind: 'mission' | 'reco';
  sites: Site[];
  /** Areas the backend engine found away from the missions (see loadSurvey). */
  surveySites: Site[];
  manifest: MoonManifest | null;
  loading: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  navOpen: boolean;
};

let state: AppState = {
  ephem: null,
  t: 0,
  playing: false,
  speedId: '6h',
  missionDays: 10,
  delayDays: 0,
  preset: 'balanced',
  maxSlope: 10,
  roverSlope: 15,
  pickedPoint: null,
  recoMarkers: [],
  navigatorOpen: false,
  showMissions: true,
  region: 'nearside',
  center: { lat: 0, lon: 0 },
  selectedId: null,
  customPoint: null,
  customVerdict: null,
  selectedKind: 'mission',
  sites: [],
  surveySites: [],
  manifest: null,
  loading: 'idle',
  error: null,
  navOpen: false,
};

const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  let changed = false;
  for (const k of Object.keys(next) as (keyof AppState)[]) {
    if (state[k] !== next[k]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

/** Number of hours in the backend series (0 until it loads). */
export const hoursCount = (s: AppState) => s.ephem?.n ?? 0;

/** UTC milliseconds of the current hour index. */
export const timeMs = (s: AppState) => (s.ephem ? s.ephem.startMs + s.t * s.ephem.stepH * 3_600_000 : 0);

export const msAt = (s: AppState, t: number) => (s.ephem ? s.ephem.startMs + t * s.ephem.stepH * 3_600_000 : 0);

export function selectedSite(s: AppState) {
  return s.sites.find((x) => x.id === s.selectedId) ?? s.surveySites.find((x) => x.id === s.selectedId) ?? null;
}

/** Opens a mission or a recommended site in the navigator. */
export function openSite(id: string, kind: 'mission' | 'reco') {
  setState({ selectedId: id, selectedKind: kind, pickedPoint: null, navOpen: false, navigatorOpen: true, customPoint: null, customVerdict: null });
}

/** Opens the live analysis of any coordinate in the navigator. */
export function openPoint(lat: number, lon: number) {
  setState({ customPoint: { lat, lon }, customVerdict: null, selectedId: null, pickedPoint: null, navOpen: false, navigatorOpen: true });
}

export function setHour(t: number) {
  const n = hoursCount(state);
  setState({ t: Math.max(0, Math.min(Math.max(0, n - 1), t)) });
}

/** Hour index of a UTC date string (YYYY-MM-DD), clamped to the data range. */
export function hourOfDate(s: AppState, isoDate: string) {
  if (!s.ephem) return 0;
  const ms = Date.parse(isoDate + 'T00:00Z');
  return Math.round((ms - s.ephem.startMs) / (s.ephem.stepH * 3_600_000));
}
