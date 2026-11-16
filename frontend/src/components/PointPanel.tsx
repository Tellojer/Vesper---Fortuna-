import { useEffect, useState } from 'react';
import { Crosshair, X } from 'lucide-react';
import { API_BASE, fetchPoint, verdictOf, type PointResult } from '../backend/api';
import { tDem, tReason } from '../backend/i18n';
import { fmtDate, fmtDuration, fmtLatLon } from '../lib/format';
import { useScene } from '../scene/SceneContext';
import { msAt, setState, useApp } from '../state/store';
import { MissionControls, useMission } from './MissionControls';
import { VERDICT_LABEL } from './verdict';

/** Running next to the developer's own server, as opposed to the hosted site. */
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

type Status = { state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string; offline: boolean };

/**
 * Any coordinate, analysed live by the backend (/api/point): clicked on the
 * Moon or typed as "lat, lon". Needs the Vesper server running.
 */
export function PointPanel() {
  const point = useApp((s) => s.customPoint);
  const m = useMission();
  const plannedMs = useApp((s) => msAt(s, m.planned));
  const landingMs = useApp((s) => msAt(s, m.t0));
  const scene = useScene();
  const [result, setResult] = useState<PointResult | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const lat = point?.lat;
  const lon = point?.lon;

  // A new point starts clean; a new mission window keeps the last answer on screen while it refreshes
  useEffect(() => {
    setResult(null);
    setState({ customVerdict: null });
  }, [lat, lon]);

  useEffect(() => {
    if (lat === undefined || lon === undefined || !plannedMs) return;
    const ctl = new AbortController();
    setStatus({ state: 'loading' });
    // Sliders fire many changes: wait for them to settle before asking
    const timer = setTimeout(() => {
      fetchPoint({ lat, lon, dateMs: plannedMs, days: m.days, delay: m.delay, preset: m.preset, maxSlope: m.maxSlope }, ctl.signal)
        .then((r) => {
          setResult(r);
          setStatus({ state: 'ready' });
          setState({ customVerdict: verdictOf(r) });
        })
        .catch((e: unknown) => {
          if (ctl.signal.aborted) return;
          // fetch rejects with a TypeError when the server cannot be reached
          setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e), offline: e instanceof TypeError });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [lat, lon, plannedMs, m.days, m.delay, m.preset, m.maxSlope]);

  if (!point) return null;
  const w = result?.window;
  const verdict = result ? verdictOf(result) : null;

  return (
    <aside className="site-panel point-panel glass" aria-labelledby="point-title">
      <header className="site-head">
        <div className="site-head-text">
          <h2 id="point-title" className="site-name">
            Custom site
          </h2>
          <p className="site-coords tabular">{fmtLatLon(point.lat, point.lon, 3)}</p>
          <p className="site-detail">Analysed live by the Vesper backend</p>
        </div>
        <div className="site-head-actions">
          <button type="button" className="icon-btn" aria-label="Centre view on the custom site" title="Centre view" onClick={() => scene()?.flyTo(point.lat, point.lon, 1.6)}>
            <Crosshair size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Close custom site" title="Close (Esc)" onClick={() => setState({ customPoint: null, customVerdict: null })}>
            <X size={16} />
          </button>
        </div>
      </header>
      <p className="site-note tabular">
        Landing {landingMs ? fmtDate(landingMs) : '…'}
        {m.delay ? ` (+${m.delay} d delay)` : ''}, {m.days} {m.days === 1 ? 'day' : 'days'} on the surface
      </p>

      <MissionControls withDelay />

      {status.state === 'error' ? (
        <div className="empty is-error" role="alert">
          {status.offline && LOCAL ? (
            <>
              <p className="empty-title">The Vesper backend is not reachable</p>
              <p>
                Custom sites are computed by the backend server at <span className="mono">{API_BASE}</span>. Start it from <span className="mono">data-pipeline</span> with{' '}
                <span className="mono">python server.py</span> and the three DEMs, then pick the point again.
              </p>
            </>
          ) : status.offline ? (
            <>
              <p className="empty-title">Live analysis is offline right now</p>
              <p>
                Any coordinate is analysed on demand by the Vesper server, which reads 4.2 GB of NASA LOLA terrain and is not online at the moment. The rest of the app works from precomputed
                data: open the Landing site navigator to see the recommended sites of this region, or pick a mission on the left.
              </p>
            </>
          ) : (
            <p>The backend could not analyse this point: {status.message}</p>
          )}
        </div>
      ) : !result || !w || !verdict ? (
        <div aria-busy="true" className="region-loading">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <p className="note">Tracing the terrain horizon around the point… Polar points take a few seconds.</p>
        </div>
      ) : (
        <div className="point-result" aria-busy={status.state === 'loading'} data-stale={status.state === 'loading'}>
          <div className={`verdict verdict-${verdict}`}>
            <span className="verdict-label">{VERDICT_LABEL[verdict]}</span>
            <span className="verdict-score tabular">score {Math.round(w.score)} / 100</span>
          </div>

          {w.reasons.length > 0 && (
            <ul className="reasons">
              {w.reasons.map((r) => (
                <li key={r}>{tReason(r)}</li>
              ))}
            </ul>
          )}

          <dl className="stats-list tabular">
            <div>
              <dt>Sun visible</dt>
              <dd>{Math.round(w.sun_pct)}%</dd>
            </div>
            <div>
              <dt>Earth visible</dt>
              <dd>{Math.round(w.earth_pct)}%</dd>
            </div>
            <div>
              <dt>Sun and Earth together</dt>
              <dd>{Math.round(w.both_pct)}%</dd>
            </div>
            <div>
              <dt>Longest continuous sunlight</dt>
              <dd>{w.longest_sun_h ? fmtDuration(w.longest_sun_h * 3_600_000) : '0 h'}</dd>
            </div>
            <div>
              <dt>Slope</dt>
              <dd>{result.slope_deg.toFixed(1)}°</dd>
            </div>
            <div>
              <dt>Elevation</dt>
              <dd>{Math.round(result.alt_m).toLocaleString('en-US')} m</dd>
            </div>
            <div>
              <dt>Solar energy, {w.energy.best_panel} panel</dt>
              <dd>{(w.energy.best_panel === 'vertical' ? w.energy.vertical_tracking_kwh_m2 : w.energy.horizontal_kwh_m2).toLocaleString('en-US')} kWh/m²</dd>
            </div>
            <div>
              <dt>All of 2027, Sun / Earth</dt>
              <dd>
                {Math.round(result.year.sun_pct)}% / {Math.round(result.year.earth_pct)}%
              </dd>
            </div>
          </dl>

          <div className="countdowns">
            <p>
              <span className="dot sun" aria-hidden="true" />
              {w.sun_countdown.visible ? 'The Sun sets in' : 'The Sun rises in'}{' '}
              <b className="tabular">{w.sun_countdown.hours === null ? 'beyond the data' : fmtDuration(w.sun_countdown.hours * 3_600_000)}</b>
            </p>
            <p>
              <span className="dot earth" aria-hidden="true" />
              {w.earth_countdown.visible ? 'Earth sets in' : 'Earth rises in'}{' '}
              <b className="tabular">{w.earth_countdown.hours === null ? 'beyond the data' : fmtDuration(w.earth_countdown.hours * 3_600_000)}</b>
            </p>
          </div>

          <p className="note">
            Terrain: {tDem(result.dem)}. Sun and Earth: JPL Horizons, against the real horizon up to 150 km away. Slope is measured at the DEM scale (~{result.dem_res_m} m), not the lander’s.
          </p>
        </div>
      )}
    </aside>
  );
}
