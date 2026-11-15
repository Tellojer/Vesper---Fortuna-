import { Earth, Sun } from 'lucide-react';
import { ephemAt } from '../backend/data';
import { REGIONS, type Site } from '../data/types';
import { fmtKm, fmtLatLon } from '../lib/format';
import { useScene } from '../scene/SceneContext';
import { openSite, setState, useApp } from '../state/store';

export function Sidebar() {
  const navOpen = useApp((s) => s.navOpen);
  return (
    <>
      <nav id="sidebar" className="sidebar glass" data-open={navOpen} aria-label="Regions, sites and sky">
        <RegionList />
        <SiteList />
        <SkySection />
        <DataSources />
      </nav>
      {navOpen && <div className="scrim" onClick={() => setState({ navOpen: false })} aria-hidden="true" />}
    </>
  );
}

function RegionList() {
  const region = useApp((s) => s.region);
  const scene = useScene();
  return (
    <section className="side-section" aria-labelledby="regions-h">
      <h2 id="regions-h" className="side-heading">
        Regions
      </h2>
      {(['Orthographic', 'Stereographic'] as const).map((proj) => (
        <div key={proj} className="region-group" role="group" aria-label={proj}>
          <span className="region-group-label">{proj}</span>
          <ul className="region-chips">
            {REGIONS.filter((r) => r.projection === proj).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="chip"
                  aria-current={region === r.id ? 'true' : undefined}
                  aria-keyshortcuts={r.key}
                  title={`${proj} ${r.name} (${r.key})`}
                  onClick={() => {
                    scene()?.setRegion(r.id);
                    setState({ navOpen: false });
                  }}
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function SiteRow({ s, selected }: { s: Site; selected: boolean }) {
  const scene = useScene();
  return (
    <li>
      <button
        type="button"
        className="row-btn site-btn"
        aria-pressed={selected}
        onClick={() => {
          openSite(s.id, 'mission');
          scene()?.flyTo(s.lat, s.lon, 1.9);
        }}
      >
        <span className="site-btn-name">{s.name}</span>
        <span className="site-btn-coords tabular">{fmtLatLon(s.lat, s.lon, 1)}</span>
        {s.summary && (
          <span className="site-btn-light tabular" title="Best point in the region, share of 2027 hours with the Sun / Earth above the terrain horizon (backend)">
            <span className="light-sun">
              <Sun size={11} aria-hidden="true" />
              {Math.round(s.summary.sun_pct_max)}%
            </span>
            <span className="light-earth">
              <Earth size={11} aria-hidden="true" />
              {Math.round(s.summary.earth_pct_max)}%
            </span>
          </span>
        )}
      </button>
    </li>
  );
}

function SiteList() {
  const sites = useApp((s) => s.sites);
  const selectedId = useApp((s) => (s.selectedKind === 'mission' ? s.selectedId : null));
  const showMissions = useApp((s) => s.showMissions);
  const loading = useApp((s) => s.loading);
  const groups = [
    { id: 'historic', label: 'Landed' },
    { id: 'candidate', label: 'Candidates' },
  ] as const;

  return (
    <section className="side-section" aria-labelledby="sites-h">
      <h2 id="sites-h" className="side-heading">
        Missions
      </h2>
      <button type="button" role="switch" aria-checked={showMissions} className="switch-row" onClick={() => setState({ showMissions: !showMissions })}>
        <span>Show on the Moon</span>
        <span className="switch" aria-hidden="true" />
      </button>
      {sites.length === 0 && loading !== 'error' ? (
        <ul className="site-list" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="skeleton-row" />
          ))}
        </ul>
      ) : (
        groups.map((g) => {
          const list = sites.filter((s) => s.kind === g.id);
          if (!list.length) return null;
          return (
            <div key={g.id} className="site-group">
              <h3 className="site-group-label">
                {g.label} <span className="count">{list.length}</span>
              </h3>
              <ul className="site-list">
                {list.map((s) => (
                  <SiteRow key={s.id} s={s} selected={selectedId === s.id} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

function SkySection() {
  const scene = useScene();
  const earthKm = useApp((s) => {
    if (!s.ephem) return 0;
    const e = ephemAt(s.ephem, s.t).earthKm;
    return Math.round(Math.hypot(e[0], e[1], e[2]));
  });
  return (
    <section className="side-section" aria-labelledby="sky-h">
      <h2 id="sky-h" className="side-heading">
        Sky
      </h2>
      <div className="sky-grid">
        <button type="button" className="sky-btn" onClick={() => scene()?.face('earth')}>
          <Earth size={16} aria-hidden="true" className="sky-icon earth" />
          <span className="sky-btn-label">Face Earth</span>
          <span className="sky-btn-value tabular">{earthKm ? fmtKm(earthKm) : '—'}</span>
        </button>
        <button type="button" className="sky-btn" onClick={() => scene()?.face('sun')}>
          <Sun size={16} aria-hidden="true" className="sky-icon sun" />
          <span className="sky-btn-label">Face Sun</span>
          <span className="sky-btn-value">Direction from JPL Horizons</span>
        </button>
      </div>
    </section>
  );
}

function DataSources() {
  const manifest = useApp((s) => s.manifest);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  if (loading === 'error') {
    return (
      <p className="side-foot is-error" role="alert">
        Couldn’t load Vesper data ({error}). Run <span className="mono">npm run sync:backend</span> to copy the backend outputs into{' '}
        <span className="mono">public/data/vesper</span>, then reload.
      </p>
    );
  }
  if (!manifest) return null;
  return (
    <p className="side-foot">
      Sun, Earth and site data: Vesper data-pipeline (JPL Horizons ephemeris, LOLA terrain). Globe:{' '}
      {manifest.sources.slice(0, 2).map((s, i) => (
        <span key={s.name}>
          {i > 0 && ' · '}
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.name}
          </a>
        </span>
      ))}
      .
    </p>
  );
}
