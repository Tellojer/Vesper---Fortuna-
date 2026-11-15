import { useId, useMemo, useState } from 'react';
import { MapPin, Menu, Radar, Search, X } from 'lucide-react';
import { fmtLatLon, parseLatLon } from '../lib/format';
import { useScene } from '../scene/SceneContext';
import { openPoint, openSite, setState, useApp } from '../state/store';
import type { Site } from '../data/types';

export function TopBar() {
  const navOpen = useApp((s) => s.navOpen);
  const navigatorOpen = useApp((s) => s.navigatorOpen);
  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn nav-toggle"
        aria-label={navOpen ? 'Close regions and sites' : 'Open regions and sites'}
        aria-expanded={navOpen}
        aria-controls="sidebar"
        onClick={() => setState({ navOpen: !navOpen })}
      >
        {navOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
      <div className="brand">
        <img src="/brand/vesper_star_64.png" alt="" width={28} height={28} />
        <span className="wordmark">Vesper</span>
      </div>
      <SiteSearch />
      <button
        type="button"
        className="navigator-btn"
        aria-expanded={navigatorOpen}
        aria-controls="navigator"
        aria-label="Landing site navigator"
        title={navigatorOpen ? 'Hide the landing site navigator' : 'Show the landing site navigator'}
        onClick={() => setState({ navigatorOpen: !navigatorOpen })}
      >
        <Radar size={16} aria-hidden="true" />
        <span className="navigator-btn-label">Landing site navigator</span>
      </button>
    </header>
  );
}

type Option = { kind: 'site'; site: Site } | { kind: 'coords'; lat: number; lon: number };

function SiteSearch() {
  const sites = useApp((s) => s.sites);
  const scene = useScene();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sites.map((site) => ({ kind: 'site' as const, site }));
    const coords = parseLatLon(query);
    const matches = sites
      .filter((s) => s.name.toLowerCase().includes(q) || s.detail?.toLowerCase().includes(q))
      .map((site) => ({ kind: 'site' as const, site }));
    return coords ? [{ kind: 'coords' as const, ...coords }, ...matches] : matches;
  }, [query, sites]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    if (o.kind === 'site') {
      openSite(o.site.id, 'mission');
      scene()?.flyTo(o.site.lat, o.site.lon, 1.9);
    } else {
      // Any coordinate is analysed live by the backend
      openPoint(o.lat, o.lon);
      scene()?.flyTo(o.lat, o.lon, 1.9);
    }
    setQuery('');
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const showList = open && options.length > 0;
  const showEmpty = open && query.trim() !== '' && options.length === 0;

  return (
    <div className="search" role="search">
      <Search size={16} className="search-icon" aria-hidden="true" />
      <input
        id="site-search"
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder="Site or lat, lon"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === 'Escape') {
            setQuery('');
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <kbd className="search-kbd" aria-hidden="true">/</kbd>
      {showList && (
        <ul className="search-list" id={listId} role="listbox">
          {options.map((o, i) => (
            <li
              key={o.kind === 'site' ? o.site.id : 'coords'}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="search-option"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              {o.kind === 'site' ? (
                <>
                  <span className="search-option-name">{o.site.name}</span>
                  <span className="search-option-meta">{fmtLatLon(o.site.lat, o.site.lon, 1)}</span>
                </>
              ) : (
                <>
                  <span className="search-option-name">
                    <MapPin size={14} aria-hidden="true" /> Analyse {fmtLatLon(o.lat, o.lon, 2)}
                  </span>
                  <span className="search-option-meta">Custom site</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {showEmpty && (
        <div className="search-list search-empty" role="status">
          No site matches “{query.trim()}”. Try a site name or coordinates like <span className="mono">-85.3, 31.2</span>.
        </div>
      )}
    </div>
  );
}
