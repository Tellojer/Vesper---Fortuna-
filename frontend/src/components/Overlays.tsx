import { useEffect, useRef } from 'react';
import { ephemAt } from '../backend/data';
import { fmtKm } from '../lib/format';
import { useScene } from '../scene/SceneContext';
import { openSite, useApp } from '../state/store';

/** Retries until the scene exists (it mounts after its children's effects). */
function useSceneAttach(attach: (sc: NonNullable<ReturnType<ReturnType<typeof useScene>>>) => () => void) {
  const scene = useScene();
  useEffect(() => {
    let raf = 0;
    let detach: (() => void) | null = null;
    const tryAttach = () => {
      const sc = scene();
      if (sc) detach = attach(sc);
      else raf = requestAnimationFrame(tryAttach);
    };
    tryAttach();
    return () => {
      cancelAnimationFrame(raf);
      detach?.();
    };
  }, [scene]); // eslint-disable-line react-hooks/exhaustive-deps
  return scene;
}

/** Markers positioned over the Moon by the scene every frame: missions (optional) and recommended landing sites. */
export function Markers() {
  const ref = useRef<HTMLDivElement>(null);
  const sites = useApp((s) => s.sites);
  const selectedId = useApp((s) => s.selectedId);
  const selectedKind = useApp((s) => s.selectedKind);
  const showMissions = useApp((s) => s.showMissions);
  const recos = useApp((s) => s.recoMarkers);
  const custom = useApp((s) => s.customPoint);
  const customVerdict = useApp((s) => s.customVerdict);
  const scene = useSceneAttach((sc) => {
    sc.setOverlay(ref.current);
    return () => sc.setOverlay(null);
  });

  useEffect(() => {
    scene()?.requestRender();
  }, [sites, selectedId, selectedKind, showMissions, recos, custom, customVerdict, scene]);

  return (
    <div className="markers" ref={ref}>
      {(showMissions ? sites : []).map((s) => (
        <button
          key={s.id}
          type="button"
          className="marker"
          data-lat={s.lat}
          data-lon={s.lon}
          data-kind={s.kind}
          data-selected={selectedKind === 'mission' && s.id === selectedId}
          data-visible="false"
          aria-label={`${s.name}, select mission`}
          onClick={() => openSite(s.id, 'mission')}
          onDoubleClick={() => scene()?.flyTo(s.lat, s.lon, 1.6)}
        >
          <span className="marker-dot" aria-hidden="true" />
          <span className="marker-label">{s.name}</span>
        </button>
      ))}
      {recos.map((r) => (
        <button
          key={`reco-${r.id}`}
          type="button"
          className="marker"
          data-lat={r.lat}
          data-lon={r.lon}
          data-kind="reco"
          data-verdict={r.verdict}
          data-selected={selectedKind === 'reco' && r.id === selectedId}
          data-visible="false"
          aria-label={`${r.name}, recommended landing site, ${r.verdict.replace('-', ' ')}`}
          onClick={() => openSite(r.id, 'reco')}
          onDoubleClick={() => scene()?.flyTo(r.lat, r.lon, 1.6)}
        >
          <span className="marker-dot" aria-hidden="true" />
          <span className="marker-label">{r.name}</span>
        </button>
      ))}
      {custom && (
        <button
          type="button"
          className="marker"
          data-lat={custom.lat}
          data-lon={custom.lon}
          data-kind="custom"
          data-verdict={customVerdict ?? 'none'}
          data-selected="true"
          data-visible="false"
          aria-label={`Custom site${customVerdict ? `, ${customVerdict.replace('-', ' ')}` : ''}`}
          onDoubleClick={() => scene()?.flyTo(custom.lat, custom.lon, 1.6)}
        >
          <span className="marker-dot" aria-hidden="true" />
          <span className="marker-label">Custom site</span>
        </button>
      )}
    </div>
  );
}

/** Earth and Sun labels. Earth's distance comes from the backend ephemeris. */
export function BodyLabels() {
  const earthRef = useRef<HTMLDivElement>(null);
  const sunRef = useRef<HTMLDivElement>(null);
  const earthKm = useApp((s) => {
    if (!s.ephem) return 0;
    const e = ephemAt(s.ephem, s.t).earthKm;
    return Math.round(Math.hypot(e[0], e[1], e[2]));
  });

  useSceneAttach((sc) => {
    sc.setBodyLabel('earth', earthRef.current);
    sc.setBodyLabel('sun', sunRef.current);
    return () => {
      sc.setBodyLabel('earth', null);
      sc.setBodyLabel('sun', null);
    };
  });

  return (
    <>
      <div className="body-label" ref={earthRef} data-visible="false">
        <span className="body-label-name">Earth</span>
        {earthKm > 0 && <span className="body-label-value">{fmtKm(earthKm)}</span>}
      </div>
      <div className="body-label" ref={sunRef} data-visible="false">
        <span className="body-label-name">Sun</span>
      </div>
    </>
  );
}
