export type Site = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: 'historic' | 'candidate' | 'custom';
  /** Display status from the backend (Landed / Candidate) */
  status?: string;
  country?: string;
  agency?: string;
  year?: number;
  detail?: string;
  coordSource?: string;
  sourceUrl?: string;
  approx?: boolean;
  /** Precomputed backend region for this site */
  file?: string;
  image?: string;
  summary?: { sun_pct_max: number; earth_pct_max: number };
};

export type MapLayer = { url: string; width?: number; height?: number };

export type MoonManifest = {
  body: 'moon';
  projection: string;
  reference: string;
  color?: MapLayer;
  normal?: MapLayer & { exaggeration?: number };
  height?: MapLayer & { minM: number; maxM: number; units: string };
  /** Background Earth; optional (a procedural placeholder is drawn without it). */
  earth?: { color?: MapLayer; projection?: string };
  sources: { name: string; via?: string; file?: string; url?: string; credit?: string }[];
};

/** Output of the offline Vesper Terrain module for one site (read-only in the UI). */
export type TerrainSummary = {
  siteId: string;
  realDataPercent: number;
  pixelSizeM: number;
  verticalDatum: string;
  slopeDeg: Record<string, { p50: number; p90: number; p99: number }>;
  roughnessM: Record<string, { p50: number; p90: number; p99: number }>;
  steepFraction: number;
  obstaclesPerHa: number;
  layers: { id: string; label: string; url: string; units?: string }[];
  sources: { name: string; version?: string }[];
};

export type RegionId = 'nearside' | 'farside' | 'north' | 'south' | 'stereo-north' | 'stereo-south';

export const REGIONS: { id: RegionId; name: string; projection: 'Orthographic' | 'Stereographic'; key: string }[] = [
  { id: 'nearside', name: 'Nearside', projection: 'Orthographic', key: '1' },
  { id: 'farside', name: 'Farside', projection: 'Orthographic', key: '2' },
  { id: 'north', name: 'North Pole', projection: 'Orthographic', key: '3' },
  { id: 'south', name: 'South Pole', projection: 'Orthographic', key: '4' },
  { id: 'stereo-north', name: 'North Pole', projection: 'Stereographic', key: '5' },
  { id: 'stereo-south', name: 'South Pole', projection: 'Stereographic', key: '6' },
];
