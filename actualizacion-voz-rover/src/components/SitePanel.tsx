import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Crosshair, Earth, ExternalLink, Sun, X } from 'lucide-react';
import { tDem } from '../backend/i18n';
import { evaluateRegion, recoAreas } from '../backend/recommend';
import { ROVERS, ruggedness, traverse } from '../backend/rover';
import {
  countdown,
  horizonProfile,
  imageToPoint,
  isVisible,
  loadRegion,
  localAzEl,
  pointToImage,
  track,
  type Body,
  type Region,
} from '../backend/region';
import type { Site } from '../data/types';
import { fmtDate, fmtDuration, fmtLatLon, fmtShort, fmtSignedDeg } from '../lib/format';
import { useScene } from '../scene/SceneContext';
import { selectedSite, setState, useApp } from '../state/store';
import { MissionControls, useMission } from './MissionControls';
import { VERDICT_LABEL } from './verdict';

type Tab = 'landing' | 'sky' | 'terrain';
const TABS: { id: Tab; label: string }[] = [
  { id: 'landing', label: 'Landing' },
  { id: 'sky', label: 'Sky' },
  { id: 'terrain', label: 'Terrain' },
];

const clampT = (reg: Region, t: number) => Math.max(0, Math.min(reg.T - 1, t));
const tMs = (reg: Region, t: number) => reg.startMs + t * reg.times.step_h * 3_600_000;
const pct = (f: number) => `${Math.round(f * 100)}%`;
const score = (s: number | null | undefined) => (s === null || s === undefined ? 'discarded' : String(Math.round(s)));

function useRegion(site: Site) {
  const [state, setLocal] = useState<{ id: string; reg: Region | null; error?: string } | null>(null);
  useEffect(() => {
    if (!site.file) {
      setLocal({ id: site.id, reg: null, error: 'No precomputed region for this site.' });
      return;
    }
    let alive = true;
    loadRegion(site.file)
      .then((reg) => alive && setLocal({ id: site.id, reg }))
      .catch((e: unknown) => alive && setLocal({ id: site.id, reg: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [site.id, site.file]);
  return state && state.id === site.id ? state : null;
}

/** Backend rankings for the planned and (delayed) actual landing, plus the chosen point. */
function useAnalysis(reg: Region) {
  const m = useMission();
  const picked = useApp((s) => s.pickedPoint);
  return useMemo(() => {
    const params = { hours: m.hours, preset: m.preset, maxSlope: m.maxSlope };
    const planned = evaluateRegion(reg, { ...params, t0: clampT(reg, m.planned) });
    const now = m.delay ? evaluateRegion(reg, { ...params, t0: clampT(reg, m.t0) }) : planned;
    const p = picked ?? now.best.p;
    const row = now.rank.find((r) => r.p === p)!;
    const position = now.rank.findIndex((r) => r.p === p) + 1;
    return { m, planned, now, p, row, position, picked: picked !== null, t0: clampT(reg, m.t0) };
  }, [reg, m, picked]);
}

export function SitePanel() {
  const site = useApp(selectedSite);
  const [tab, setTab] = useState<Tab>('landing');
  const scene = useScene();
  const isReco = useApp((s) => s.selectedKind === 'reco');
  const sites = useApp((s) => s.sites);
  const survey = useApp((s) => s.surveySites);
  const marker = useApp((s) => s.recoMarkers.find((r) => r.id === s.selectedId));
  const customPoint = useApp((s) => s.customPoint);
  if (!site || customPoint) return null;
  // A recommended site shares the backend area of a mission but has its own name and coordinates
  const area = isReco ? recoAreas(sites, survey).find((a) => a.id === site.id) : undefined;
  const name = area?.name ?? site.name;
  const lat = isReco && marker ? marker.lat : site.lat;
  const lon = isReco && marker ? marker.lon : site.lon;

  return (
    <aside className="site-panel glass" aria-labelledby="site-title">
      <header className="site-head">
        <div className="site-head-text">
          <h2 id="site-title" className="site-name">
            {name}
          </h2>
          <p className="site-coords tabular">{fmtLatLon(lat, lon, 3)}</p>
          <p className="site-detail">{isReco ? 'Recommended landing site · Vesper analysis' : [site.status, site.agency, site.country, site.year].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="site-head-actions">
          <button type="button" className="icon-btn" aria-label={`Centre view on ${name}`} title="Centre view" onClick={() => scene()?.flyTo(lat, lon, 1.6)}>
            <Crosshair size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Close site panel" title="Close (Esc)" onClick={() => setState({ selectedId: null, pickedPoint: null })}>
            <X size={16} />
          </button>
        </div>
      </header>
      {isReco ? (
        <p className="site-note">
          Best point for this mission in a 20 × 20 km area {area?.surveyed ? 'the backend engine picked by surveying the whole zone, away from past missions' : `the backend analysed around ${site.name}`}. It moves if the date
          or the mission settings change.
        </p>
      ) : (
        site.detail && <p className="site-note">{site.detail}</p>
      )}

      <div className="tabs" role="tablist" aria-label="Site details">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls={`panel-${x.id}`}
            className="tab"
            onClick={() => setTab(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel">
        <RegionGate site={site}>{(reg) => (tab === 'landing' ? <LandingTab reg={reg} /> : tab === 'sky' ? <SkyTab reg={reg} /> : <TerrainTab reg={reg} />)}</RegionGate>
      </div>

      {!isReco && site.coordSource && (
        <p className="source">
          Coordinates: {site.coordSource}
          {site.sourceUrl && (
            <a href={site.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open coordinate source">
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </p>
      )}
    </aside>
  );
}

function RegionGate({ site, children }: { site: Site; children: (reg: Region) => ReactNode }) {
  const state = useRegion(site);
  if (!state) {
    return (
      <div aria-busy="true" className="region-loading">
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <p className="note">Loading the precomputed region…</p>
      </div>
    );
  }
  if (!state.reg) {
    return (
      <p className="empty is-error" role="alert">
        Couldn’t load this site’s data: {state.error}
      </p>
    );
  }
  return <>{children(state.reg)}</>;
}

// ---------- Landing (backend: controls, impact, aptitude map, chosen point) ----------

function LandingTab({ reg }: { reg: Region }) {
  const a = useAnalysis(reg);
  const { m, planned, now, p, row } = a;
  const valid = now.valid;
  const plannedRow = planned.rank.find((r) => r.p === p);
  const sun = countdown(reg, p, a.t0, 'sun');
  const earth = countdown(reg, p, a.t0, 'earth');
  const lat = reg.points.lat[p];
  const lon = reg.points.lon[p];
  const alt = reg.points.alt_m[p];

  let impact: ReactNode;
  if (!m.delay) {
    impact = (
      <>
        Best point for landing on {fmtDate(tMs(reg, a.t0))}: <b>{score(now.best.score)}</b> / 100. Move “What if the landing slips?” to see how it changes.
      </>
    );
  } else {
    const moved = now.best.p !== p;
    impact = (
      <>
        With <b>+{m.delay} days</b> of delay, the chosen point goes from <b>{score(plannedRow?.score)}</b> to <b>{score(row.score)}</b>.{' '}
        {moved ? (
          <>
            The best point is now another one, with <b>{score(now.best.score)}</b>: it is marked 1 on the map.
          </>
        ) : (planned.best.score ?? 0) - (now.best.score ?? 0) > 5 ? (
          <>
            It is still the best, but the whole region gets worse: the maximum drops from <b>{score(planned.best.score)}</b> to <b>{score(now.best.score)}</b>.
          </>
        ) : (
          'It is still the best point in the region.'
        )}
      </>
    );
  }
  const impactOk = !m.delay || ((plannedRow?.score ?? 0) - (row.score ?? 0) < 5 && now.best.p === p);

  return (
    <>
      <MissionControls withDelay />
      <p className={`impact ${impactOk ? 'ok' : ''}`} aria-live="polite">
        {impact}
      </p>

      <AptitudeMap reg={reg} rank={now.rank} selected={p} />

      <div className={`verdict verdict-${now.verdict}`}>
        <span className="verdict-label">{VERDICT_LABEL[now.verdict]}</span>
        <span className="verdict-score tabular">zone best {score(now.best.score)} / 100</span>
      </div>

      <div className="point-score">
        <strong className="tabular">{score(row.score)}</strong>
        <span>
          score of the {a.picked ? 'chosen' : 'best'} point
          <br />
          {row.score === null ? `slope ${row.slope?.toFixed(1)}°, above the limit` : `#${a.position} of ${valid} usable points`}
        </span>
      </div>

      <dl className="stats-list tabular">
        <div>
          <dt>Sun visible</dt>
          <dd>{pct(row.sun)}</dd>
        </div>
        <div>
          <dt>Earth visible</dt>
          <dd>{pct(row.earth)}</dd>
        </div>
        <div>
          <dt>Sun and Earth together</dt>
          <dd>{pct(row.both)}</dd>
        </div>
        <div>
          <dt>Longest continuous sunlight</dt>
          <dd>{row.longestSunHours ? fmtDuration(row.longestSunHours * 3_600_000) : '0 h'}</dd>
        </div>
        <div>
          <dt>Slope</dt>
          <dd>{row.slope === null ? '–' : `${row.slope.toFixed(1)}°`}</dd>
        </div>
        <div>
          <dt>Elevation</dt>
          <dd>{alt === null ? '–' : `${Math.round(alt).toLocaleString('en-US')} m`}</dd>
        </div>
        <div>
          <dt>Coordinates</dt>
          <dd>{fmtLatLon(lat, lon, 3)}</dd>
        </div>
      </dl>

      <div className="countdowns">
        <p>
          <span className="dot sun" aria-hidden="true" />
          {sun.visible ? 'The Sun sets in' : 'The Sun rises in'} <b className="tabular">{sun.hours === null ? 'beyond the data' : fmtDuration(sun.hours * 3_600_000)}</b>
        </p>
        <p>
          <span className="dot earth" aria-hidden="true" />
          {earth.visible ? 'Earth sets in' : 'Earth rises in'} <b className="tabular">{earth.hours === null ? 'beyond the data' : fmtDuration(earth.hours * 3_600_000)}</b>
        </p>
      </div>
      {now.best.p !== p && (
        <button type="button" className="text-btn" onClick={() => setState({ pickedPoint: null })}>
          Go to the best point
        </button>
      )}
    </>
  );
}

function AptitudeMap({ reg, rank, selected }: { reg: Region; rank: ReturnType<typeof evaluateRegion>['rank']; selected: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { rows, cols } = reg.grid;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const cw = cv.width / cols;
    const ch = cv.height / rows;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const max = Math.max(1, ...rank.filter((r) => r.score !== null).map((r) => r.score as number));
    for (const r of rank) {
      const x = (r.p % cols) * cw;
      const y = Math.floor(r.p / cols) * ch;
      if (r.score === null) {
        ctx.fillStyle = 'rgba(255,154,138,0.08)';
        ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = 'rgba(255,154,138,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + ch - 3);
        ctx.lineTo(x + cw - 3, y + 3);
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(127,214,164,${(0.06 + 0.8 * (r.score / max)).toFixed(3)})`;
        ctx.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      }
    }
  }, [rank, rows, cols]);

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    setState({ pickedPoint: imageToPoint(reg, (e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height) });
  };
  const sel = pointToImage(reg, selected);
  const sizeKm = ((cols - 1) * reg.grid.spacing_m) / 1000;

  return (
    <figure className="aptitude">
      <div className="aptitude-map" onClick={pick} role="img" aria-label="Region suitability map; click to choose a point">
        <img src={`/data/vesper/${reg.grid.image}`} alt="" />
        <canvas ref={canvas} width={420} height={420} />
        {rank.slice(0, 3).map((r, i) =>
          r.score === null ? null : (
            <span key={r.p} className="pin" style={{ left: `${pointToImage(reg, r.p).x * 100}%`, top: `${pointToImage(reg, r.p).y * 100}%` }}>
              {i + 1}
            </span>
          ),
        )}
        <span className="sel-ring" style={{ left: `${sel.x * 100}%`, top: `${sel.y * 100}%` }} aria-hidden="true" />
      </div>
      <figcaption className="legend">
        <span>Less suitable</span>
        <span className="ramp" aria-hidden="true" />
        <span>More suitable</span>
        <span className="swatch-x" aria-hidden="true" />
        <span>Too steep</span>
        <span className="legend-size tabular">
          {sizeKm} × {sizeKm} km · click to choose a point
        </span>
      </figcaption>
    </figure>
  );
}

// ---------- Sky (backend: dial from the point, mission hour by hour) ----------

function bodyState(reg: Region, p: number, t: number, body: Body) {
  const { az, el } = localAzEl(reg, p, t, body);
  const visible = isVisible(reg, p, t, body);
  return { az, el, visible, state: visible ? 'Visible' : el > 0 ? 'Behind terrain' : 'Below horizon' };
}

function SkyTab({ reg }: { reg: Region }) {
  const a = useAnalysis(reg);
  const tNow = clampT(reg, useApp((s) => s.t));
  const p = a.p;
  const sun = bodyState(reg, p, tNow, 'sun');
  const earth = bodyState(reg, p, tNow, 'earth');

  return (
    <>
      <div className="readouts">
        <Readout icon={<Sun size={15} aria-hidden="true" />} tone="sun" label="Sun elevation" value={fmtSignedDeg(sun.el)} state={sun.state} az={sun.az} on={sun.visible} />
        <Readout icon={<Earth size={15} aria-hidden="true" />} tone="earth" label="Earth elevation" value={fmtSignedDeg(earth.el)} state={earth.state} az={earth.az} on={earth.visible} />
      </div>
      <p className="mission-window tabular">
        {fmtShort(tMs(reg, tNow))} · {a.picked ? 'chosen' : 'best'} point
      </p>
      <SkyDial reg={reg} p={p} t0={a.t0} hours={a.m.hours} tNow={tNow} />
      <HourBands reg={reg} p={p} t0={a.t0} hours={a.m.hours} tNow={tNow} />
    </>
  );
}

function Readout({ icon, tone, label, value, state, az, on }: { icon: ReactNode; tone: 'sun' | 'earth'; label: string; value: string; state: string; az: number; on: boolean }) {
  return (
    <div className={`readout tone-${tone}`} data-on={on}>
      <span className="readout-label">
        {icon}
        {label}
      </span>
      <span className="readout-value tabular">{value}</span>
      <span className="readout-state">
        {state} · az {az.toFixed(0)}°
      </span>
    </div>
  );
}

const EL_MAX = 16;
const EL_MIN = -4;
function polar(az: number, el: number, R: number): [number, number] {
  const r = (R * (EL_MAX - Math.max(EL_MIN, Math.min(EL_MAX, el)))) / (EL_MAX - EL_MIN);
  const a = (az * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

function SkyDial({ reg, p, t0, hours, tNow }: { reg: Region; p: number; t0: number; hours: number; tNow: number }) {
  const S = 300;
  const R = 128;
  const paths = useMemo(() => {
    const hp = horizonProfile(reg, p);
    let d = '';
    for (let a = 0; a <= 360; a++) {
      const [x, y] = polar(a, hp[a % 360], R);
      d += `${a ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    let outer = '';
    for (let a = 360; a >= 0; a--) {
      const [x, y] = polar(a, EL_MIN, R);
      outer += `L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    const tracks = (['earth', 'sun'] as const).map((body) => {
      const tr = track(reg, p, t0, hours, body, 2);
      const segs: { pts: string; visible: boolean }[] = [];
      let cur: string[] = [];
      let vis = tr[0]?.visible ?? false;
      for (const q of tr) {
        const [x, y] = polar(q.az, q.el, R);
        const xy = `${x.toFixed(1)},${y.toFixed(1)}`;
        if (q.visible !== vis) {
          cur.push(xy);
          segs.push({ pts: cur.join(' '), visible: vis });
          cur = [xy];
          vis = q.visible;
        } else cur.push(xy);
      }
      if (cur.length > 1) segs.push({ pts: cur.join(' '), visible: vis });
      return { body, segs };
    });
    return { terrain: d + outer + 'Z', tracks };
  }, [reg, p, t0, hours]);

  return (
    <figure className="dial">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Sky from the point: terrain horizon and the Sun and Earth paths during the mission">
        <g transform={`translate(${S / 2},${S / 2})`}>
          <circle r={R} className="dial-sky" />
          {[0, 5, 10].map((el) => {
            const r = (R * (EL_MAX - el)) / (EL_MAX - EL_MIN);
            return (
              <g key={el}>
                <circle r={r} className="dial-ring" strokeDasharray={el === 0 ? undefined : '3 4'} />
                <text x={4} y={-r - 3} className="dial-label">
                  {el}°
                </text>
              </g>
            );
          })}
          <path d={paths.terrain} className="dial-terrain" />
          {[
            ['N', 0],
            ['E', 90],
            ['S', 180],
            ['W', 270],
          ].map(([lab, az]) => {
            const [x, y] = polar(az as number, EL_MIN - 1.8, R);
            return (
              <text key={lab} x={x} y={y + 4} textAnchor="middle" className="dial-cardinal">
                {lab}
              </text>
            );
          })}
          {paths.tracks.map(({ body, segs }) =>
            segs.map((s, i) => <polyline key={`${body}${i}`} points={s.pts} className={`dial-track ${body} ${s.visible ? 'on' : 'off'}`} />),
          )}
          {(['earth', 'sun'] as const).map((body) => {
            const now = localAzEl(reg, p, tNow, body);
            const [x, y] = polar(now.az, now.el, R);
            return <circle key={body} cx={x} cy={y} r={body === 'sun' ? 7 : 8} className={`dial-body ${body} ${isVisible(reg, p, tNow, body) ? 'on' : 'off'}`} />;
          })}
        </g>
      </svg>
      <figcaption className="note">Real LOLA horizon. Centre 16° elevation, edge −4°; north up, east right. Solid: visible; dotted: hidden by terrain.</figcaption>
    </figure>
  );
}

function HourBands({ reg, p, t0, hours, tNow }: { reg: Region; p: number; t0: number; hours: number; tNow: number }) {
  const W = 300;
  const L = 52;
  const rowH = 14;
  const gap = 6;
  const bands = useMemo(() => {
    const rows = [
      { key: 'sun', label: 'Sun' },
      { key: 'earth', label: 'Earth' },
      { key: 'both', label: 'Both' },
    ] as const;
    return rows.map((row) => {
      const spans: [number, number][] = [];
      let start: number | null = null;
      for (let h = 0; h <= hours; h++) {
        const tt = t0 + h;
        const on =
          h < hours && tt < reg.T && (row.key === 'both' ? isVisible(reg, p, tt, 'sun') && isVisible(reg, p, tt, 'earth') : isVisible(reg, p, tt, row.key));
        if (on && start === null) start = h;
        if (!on && start !== null) {
          spans.push([start, h]);
          start = null;
        }
      }
      return { ...row, spans };
    });
  }, [reg, p, t0, hours]);
  const x = (h: number) => L + (h / hours) * (W - L - 4);
  const H = 3 * (rowH + gap) + 14;
  const cursor = tNow - t0;

  return (
    <figure className="bands">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hours with the Sun, Earth and both above the terrain horizon during the mission">
        {bands.map((b, i) => {
          const y = i * (rowH + gap);
          return (
            <g key={b.key}>
              <text x={0} y={y + 11} className="band-label">
                {b.label}
              </text>
              <rect x={L} y={y} width={W - L - 4} height={rowH} rx={3} className="band-track" />
              {b.spans.map(([s, e]) => (
                <rect key={s} x={x(s)} y={y + 2} width={Math.max(1, x(e) - x(s))} height={rowH - 4} rx={2} className={`band-on ${b.key}`} />
              ))}
            </g>
          );
        })}
        {cursor >= 0 && cursor < hours && <line x1={x(cursor)} x2={x(cursor)} y1={-2} y2={3 * (rowH + gap) - gap + 2} className="band-cursor" />}
        <text x={L} y={H - 2} className="band-label">
          {fmtShort(tMs(reg, t0))}
        </text>
        <text x={W - 4} y={H - 2} textAnchor="end" className="band-label">
          +{hours / 24} d
        </text>
      </svg>
      <figcaption className="note">The mission hour by hour: bars mark the hours each body is above the terrain horizon. The line is the time on the timeline.</figcaption>
    </figure>
  );
}

// ---------- Terrain ----------

/** Where a rover could drive from the landing point, from the area's elevation and slope grid. */
function RoverSection({ reg, start, picked }: { reg: Region; start: number; picked: boolean }) {
  const limit = useApp((s) => s.roverSlope);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { rows, cols } = reg.grid;
  const tr = useMemo(() => traverse(reg, start, limit), [reg, start, limit]);
  const rough = useMemo(() => {
    const tri = ruggedness(reg);
    const sorted = tri.filter((v): v is number => v !== null).sort((x, y) => x - y);
    return { here: tri[start], median: percentile(sorted, 0.5) };
  }, [reg, start]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const cw = cv.width / cols;
    const ch = cv.height / rows;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let p = 0; p < reg.P; p++) {
      const x = (p % cols) * cw;
      const y = Math.floor(p / cols) * ch;
      if (tr.driveKm[p] !== Infinity) {
        ctx.fillStyle = 'rgba(127,214,164,0.42)';
        ctx.fillRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      } else if (tr.passable[p]) {
        // Drivable ground the rover cannot get to from here
        ctx.strokeStyle = 'rgba(240,194,106,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 2.5, y + 2.5, cw - 5, ch - 5);
      } else {
        ctx.fillStyle = 'rgba(255,154,138,0.1)';
        ctx.fillRect(x, y, cw, ch);
        ctx.strokeStyle = 'rgba(255,154,138,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 3, y + ch - 3);
        ctx.lineTo(x + cw - 3, y + 3);
        ctx.stroke();
      }
    }
  }, [reg, tr, rows, cols]);

  const mark = pointToImage(reg, start);
  const preset = ROVERS.find((r) => r.maxSlope === limit);
  const km = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} km`;

  return (
    <section className="rover" aria-labelledby="rover-h">
      <h3 id="rover-h" className="rover-heading">
        Rover traversability
      </h3>
      <div className="rover-presets" role="group" aria-label="Rover slope limit presets">
        {ROVERS.map((r) => (
          <button key={r.id} type="button" className="chip" aria-pressed={limit === r.maxSlope} title={r.source} onClick={() => setState({ roverSlope: r.maxSlope })}>
            {r.name} · {r.maxSlope}°
          </button>
        ))}
      </div>
      <label className="slider">
        <span className="slider-head">
          <span>Rover slope limit</span>
          <output className="tabular">
            {limit}°{preset ? ` (${preset.name})` : ''}
          </output>
        </span>
        <input
          type="range"
          min={5}
          max={30}
          step={1}
          value={limit}
          aria-valuetext={`${limit} degrees`}
          style={{ '--fill': `${((limit - 5) / 25) * 100}%` } as CSSProperties}
          onChange={(e) => setState({ roverSlope: Number(e.target.value) })}
        />
      </label>

      <figure className="aptitude">
        <div className="aptitude-map rover-map" role="img" aria-label="Ground a rover can reach from the landing point">
          <img src={`/data/vesper/${reg.grid.image}`} alt="" />
          <canvas ref={canvas} width={420} height={420} />
          <span className="sel-ring" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }} aria-hidden="true" />
        </div>
        <figcaption className="legend">
          <span className="swatch-reach" aria-hidden="true" />
          <span>Reachable</span>
          <span className="swatch-island" aria-hidden="true" />
          <span>Drivable, cut off</span>
          <span className="swatch-x" aria-hidden="true" />
          <span>Too steep</span>
        </figcaption>
      </figure>

      {tr.startOk ? (
        <dl className="stats-list tabular">
          <div>
            <dt>Ground reachable from the {picked ? 'chosen' : 'best'} point</dt>
            <dd>
              {Math.round(tr.reachableKm2)} km² ({pct(tr.reachableShare)})
            </dd>
          </div>
          <div>
            <dt>Farthest reachable point</dt>
            <dd>{km(tr.rangeKm)} away</dd>
          </div>
          <div>
            <dt>Longest drive to reach it</dt>
            <dd>{km(tr.longestDriveKm)}</dd>
          </div>
          <div>
            <dt>Relief roughness here / area median</dt>
            <dd>
              {rough.here === null ? '–' : `${Math.round(rough.here)} m`} / {Math.round(rough.median)} m
            </dd>
          </div>
        </dl>
      ) : (
        <p className="empty is-error">The landing point itself is steeper than {limit}°: this rover could not leave it.</p>
      )}
      <p className="note">
        A rover moves between neighbouring grid points when both are under the limit and the grade between them is too. Limits:{' '}
        {ROVERS.map((r, i) => (
          <span key={r.id}>
            {i > 0 && '; '}
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.name} {r.maxSlope}° (NASA)
            </a>
          </span>
        ))}
        . Roughness is the Terrain Ruggedness Index (mean elevation difference to neighbouring points). Both use LOLA points 1 km apart, so they describe hills and crater walls, not rocks at rover scale.
      </p>
    </section>
  );
}

function percentile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

function TerrainTab({ reg }: { reg: Region }) {
  const maxSlope = useApp((s) => s.maxSlope);
  const a = useAnalysis(reg);
  const stats = useMemo(() => {
    const slopes = reg.points.slope_deg.filter((v): v is number => v !== null).sort((x, y) => x - y);
    const alts = reg.points.alt_m.filter((v): v is number => v !== null);
    return {
      p50: percentile(slopes, 0.5),
      p90: percentile(slopes, 0.9),
      max: slopes[slopes.length - 1],
      steep: slopes.filter((s) => s > maxSlope).length / Math.max(1, slopes.length),
      altMin: Math.min(...alts),
      altMax: Math.max(...alts),
    };
  }, [reg, maxSlope]);
  const p = a.p;
  const alt = reg.points.alt_m[p];
  const slope = reg.points.slope_deg[p];
  const sizeKm = ((reg.grid.cols - 1) * reg.grid.spacing_m) / 1000;
  const mark = pointToImage(reg, p);

  return (
    <>
      <figure className="relief">
        <img src={`/data/vesper/${reg.grid.image}`} alt={`Shaded relief of the ${sizeKm} km region around the site`} />
        <span className="relief-mark" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }} aria-hidden="true" />
        <figcaption className="tabular">
          {sizeKm} × {sizeKm} km · {reg.grid.rows} × {reg.grid.cols} points every {reg.grid.spacing_m / 1000} km
        </figcaption>
      </figure>
      <dl className="stats-list tabular">
        <div>
          <dt>Elevation at the {a.picked ? 'chosen' : 'best'} point</dt>
          <dd>{alt !== null ? `${Math.round(alt).toLocaleString('en-US')} m` : 'No data'}</dd>
        </div>
        <div>
          <dt>Slope at that point</dt>
          <dd>{slope !== null ? `${slope.toFixed(1)}°` : 'No data'}</dd>
        </div>
        <div>
          <dt>Region slope, median / 90th pct / max</dt>
          <dd>
            {stats.p50.toFixed(1)}° / {stats.p90.toFixed(1)}° / {stats.max.toFixed(1)}°
          </dd>
        </div>
        <div>
          <dt>Points steeper than {maxSlope}°</dt>
          <dd>{pct(stats.steep)}</dd>
        </div>
        <div>
          <dt>Elevation range</dt>
          <dd>
            {Math.round(stats.altMin).toLocaleString('en-US')} to {Math.round(stats.altMax).toLocaleString('en-US')} m
          </dd>
        </div>
      </dl>
      <p className="note">Source: {tDem(reg.region.dem)} via the Vesper data-pipeline.</p>
      <RoverSection reg={reg} start={p} picked={a.picked} />
    </>
  );
}
