import { useEffect, useMemo, useRef } from 'react';
import { MoonScene } from './scene/MoonScene';
import { SceneContext } from './scene/SceneContext';
import { loadMoonManifest } from './data/load';
import { REGIONS } from './data/types';
import { ephemAt, loadEphemeris, loadMissions, loadSurvey } from './backend/data';
import { SPEEDS, getState, hoursCount, openPoint, setHour, setState, subscribe, timeMs, useApp } from './state/store';
import { TopBar } from './components/TopBar';
import { RegionTitle } from './components/RegionTitle';
import { Sidebar } from './components/Sidebar';
import { SitePanel } from './components/SitePanel';
import { PointPanel } from './components/PointPanel';
import { Recommendations } from './components/Recommendations';
import { Dock } from './components/Dock';
import { Markers, BodyLabels } from './components/Overlays';

/** Right-hand menu, shown only while the "Landing site navigator" button is on. */
function Navigator() {
  const open = useApp((s) => s.navigatorOpen);
  if (!open) return null;
  return (
    <div id="navigator">
      <PointPanel />
      <SitePanel />
      <Recommendations />
    </div>
  );
}

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MoonScene | null>(null);
  const ctx = useMemo(() => sceneRef, []);

  // Scene lifecycle + data
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new MoonScene(
      hostRef.current!,
      {
        onRegion: (region) => setState({ region }),
        onCenter: (center) => setState({ center }),
        onPick: (c) => openPoint(c.lat, c.lon),
      },
      reduce,
    );
    sceneRef.current = scene;
    if (import.meta.env.DEV) (window as unknown as { __vesper?: MoonScene }).__vesper = scene;

    // Sun and Earth come from the backend ephemeris for the current hour
    const syncSky = () => {
      const s = getState();
      if (!s.ephem) return;
      const e = ephemAt(s.ephem, s.t);
      scene.setSky(timeMs(s), e.sun, e.earthKm);
    };

    let alive = true;
    setState({ loading: 'loading', error: null });
    // Optional data: never holds up the first render
    loadSurvey().then((surveySites) => alive && setState({ surveySites }));
    Promise.all([loadEphemeris(), loadMissions(), loadMoonManifest()])
      .then(async ([ephem, sites, manifest]) => {
        if (!alive) return;
        setState({ ephem, sites, manifest, t: 0 });
        syncSky();
        await scene.load(manifest);
        if (alive) setState({ loading: 'ready' });
      })
      .catch((err: unknown) => alive && setState({ loading: 'error', error: err instanceof Error ? err.message : String(err) }));

    // Keep the scene on the timeline's clock
    let lastT = -1;
    const unsub = subscribe(() => {
      const { t, ephem } = getState();
      if (ephem && t !== lastT) {
        lastT = t;
        syncSky();
      }
    });
    return () => {
      alive = false;
      unsub();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Timeline playback
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const s = getState();
      if (!s.playing || !s.ephem) return;
      // Fractional hours accumulate so slow speeds still advance smoothly
      acc += SPEEDS.find((x) => x.id === s.speedId)!.hoursPerSec * dt;
      const whole = Math.floor(acc);
      if (whole < 1) return;
      acc -= whole;
      const last = hoursCount(s) - 1;
      const next = s.t + whole;
      if (next >= last) setState({ t: last, playing: false });
      else setState({ t: next });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keyboard control
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const scene = sceneRef.current;
      if (!scene) return;
      const region = REGIONS.find((r) => r.key === e.key);
      const step = e.shiftKey ? 15 : 5;
      switch (true) {
        case !!region:
          scene.setRegion(region!.id);
          break;
        case e.key === 'ArrowLeft':
          scene.rotateBy(0, -step);
          break;
        case e.key === 'ArrowRight':
          scene.rotateBy(0, step);
          break;
        case e.key === 'ArrowUp':
          scene.rotateBy(step, 0);
          break;
        case e.key === 'ArrowDown':
          scene.rotateBy(-step, 0);
          break;
        case e.key === '+' || e.key === '=':
          scene.zoomBy(0.8);
          break;
        case e.key === '-' || e.key === '_':
          scene.zoomBy(1.25);
          break;
        case e.key === ' ':
          if (target.closest('button')) return; // let buttons handle Space
          setState((s) => ({ playing: !s.playing }));
          break;
        case e.key === '[':
          setHour(getState().t - 24);
          break;
        case e.key === ']':
          setHour(getState().t + 24);
          break;
        case e.key === ',':
          setHour(getState().t - 1);
          break;
        case e.key === '.':
          setHour(getState().t + 1);
          break;
        case e.key === 'e' || e.key === 'E':
          scene.face('earth');
          break;
        case e.key === 's' || e.key === 'S':
          scene.face('sun');
          break;
        case e.key === '/':
          document.getElementById('site-search')?.focus();
          break;
        case e.key === 'Escape':
          // First Esc closes the open site, the next one hides the navigator
          if (getState().selectedId || getState().customPoint) setState({ selectedId: null, customPoint: null, customVerdict: null, navOpen: false, pickedPoint: null });
          else setState({ navOpen: false, navigatorOpen: false });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <SceneContext.Provider value={ctx}>
      <main className="app">
        <div className="scene-host" ref={hostRef} aria-label="3D view of the Moon. Drag to rotate, scroll to zoom." role="application" />
        <Markers />
        <BodyLabels />
        <TopBar />
        <RegionTitle />
        <Sidebar />
        <Navigator />
        <Dock />
      </main>
    </SceneContext.Provider>
  );
}
