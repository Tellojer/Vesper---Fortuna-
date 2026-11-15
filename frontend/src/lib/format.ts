const abs = Math.abs;

export const fmtLat = (lat: number, digits = 2) => `${abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}`;
export const fmtLon = (lon: number, digits = 2) => {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${abs(l).toFixed(digits)}° ${l >= 0 ? 'E' : 'W'}`;
};
export const fmtLatLon = (lat: number, lon: number, digits = 2) => `${fmtLat(lat, digits)}, ${fmtLon(lon, digits)}`;

export const fmtSignedDeg = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${abs(v).toFixed(digits)}°`;

export function fmtDuration(ms: number) {
  const totalMin = Math.round(abs(ms) / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${String(h).padStart(2, '0')} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min`;
}

export function fmtOffset(days: number) {
  if (abs(days) < 1 / 1440) return 'Now';
  return `${days > 0 ? '+' : '−'}${fmtDuration(days * 86_400_000)}`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const fmtDate = (ms: number) => dateFmt.format(ms);
export const fmtTime = (ms: number) => `${timeFmt.format(ms)} UTC`;
export const fmtShort = (ms: number) => `${shortFmt.format(ms)} UTC`;

export const fmtKm = (km: number) => `${Math.round(km).toLocaleString('en-US')} km`;
export const fmtAu = (km: number) => `${(km / 149_597_870.7).toFixed(4)} AU`;

/** Parses "lat, lon" with optional N/S/E/W, e.g. "-85.3, 31.2" or "85.3 S 31.2 E". */
export function parseLatLon(input: string): { lat: number; lon: number } | null {
  const m = input
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  if (m[2]?.toUpperCase() === 'S') lat = -abs(lat);
  if (m[4]?.toUpperCase() === 'W') lon = -abs(lon);
  if (abs(lat) > 90 || abs(lon) > 360) return null;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}
