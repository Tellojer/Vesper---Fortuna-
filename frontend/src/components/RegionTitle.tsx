import { REGIONS } from '../data/types';
import { fmtLatLon } from '../lib/format';
import { useApp } from '../state/store';

export function RegionTitle() {
  const region = useApp((s) => s.region);
  const lat = useApp((s) => Math.round(s.center.lat * 10) / 10);
  const lon = useApp((s) => Math.round(s.center.lon * 10) / 10);
  const loading = useApp((s) => s.loading);
  const colorWidth = useApp((s) => s.manifest?.color?.width ?? 0);
  const r = REGIONS.find((x) => x.id === region)!;
  // Resolution of the loaded mosaic at the equator, km per pixel
  const kmPerPx = colorWidth ? (2 * Math.PI * 1737.4) / colorWidth : 0;

  return (
    <div className="region-title" aria-live="polite">
      <h1 key={region} className="region-name">
        {r.name}
      </h1>
      <p className="region-meta">
        <span>{r.projection}</span>
        <span aria-hidden="true" className="dot-sep" />
        <span className="tabular">centre {fmtLatLon(lat, lon, 1)}</span>
        {kmPerPx > 0 && (
          <>
            <span aria-hidden="true" className="dot-sep" />
            <span className="tabular" title="Resolution of the loaded global mosaic">
              {kmPerPx.toFixed(1)} km/px mosaic
            </span>
          </>
        )}
        {loading === 'loading' && (
          <>
            <span aria-hidden="true" className="dot-sep" />
            <span className="loading-text">Loading LROC colour and LOLA relief…</span>
          </>
        )}
      </p>
    </div>
  );
}
