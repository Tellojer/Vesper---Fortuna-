import { useEffect, useMemo, useState } from 'react';
import { Earth, Sun } from 'lucide-react';
import { ZONE_LABEL, evaluateRegion, recoAreas, sortZones, zoneForRegion, type RecoMarker, type ZoneResult } from '../backend/recommend';
import { loadRegion, type Region } from '../backend/region';
import { fmtDate, fmtLatLon } from '../lib/format';
import { useScene } from '../scene/SceneContext';
import { msAt, openSite, setState, useApp } from '../state/store';
import { MissionControls, useMission } from './MissionControls';
import { VERDICT_LABEL } from './verdict';

/**
 * Landing site navigator for the zone in view: one recommended site per area
 * the backend analysed there (its best grid point for the current mission
 * window), with generic names and ranked with the backend's scoring. The
 * list is shown when no site is open; the sites stay on the Moon either way.
 */
export function Recommendations() {
  const selectedId = useApp((s) => s.selectedId);
  const customPoint = useApp((s) => s.customPoint);
  const region = useApp((s) => s.region);
  const sites = useApp((s) => s.sites);
  const survey = useApp((s) => s.surveySites);
  const zone = zoneForRegion(region);
  const m = useMission();
  const landingMs = useApp((s) => msAt(s, m.t0));
  const scene = useScene();

  const areas = useMemo(() => recoAreas(sites, survey).filter((a) => a.zone === zone), [sites, survey, zone]);
  const [regions, setRegions] = useState<Record<string, Region | Error>>({});

  // Load the regions of this zone (cached by loadRegion)
  useEffect(() => {
    let alive = true;
    for (const { id, site } of areas) {
      if (regions[id]) continue;
      loadRegion(site.file!)
        .then((reg) => alive && setRegions((r) => ({ ...r, [id]: reg })))
        .catch((e: unknown) => alive && setRegions((r) => ({ ...r, [id]: e instanceof Error ? e : new Error(String(e)) })));
    }
    return () => {
      alive = false;
    };
  }, [areas]); // eslint-disable-line react-hooks/exhaustive-deps

  const results: ZoneResult[] = useMemo(
    () =>
      sortZones(
        areas.map((area) => {
          const r = regions[area.id];
          if (!r) return { area, result: null };
          if (r instanceof Error) return { area, result: null, error: r.message };
          return { area, result: evaluateRegion(r, { t0: m.t0, hours: m.hours, preset: m.preset, maxSlope: m.maxSlope }) };
        }),
      ),
    [areas, regions, m.t0, m.hours, m.preset, m.maxSlope],
  );

  // Publish the recommended sites so the Moon shows them at their own coordinates
  useEffect(() => {
    const list: RecoMarker[] = [];
    for (const z of results) {
      const reg = regions[z.area.id];
      if (!z.result || !reg || reg instanceof Error) continue;
      const p = z.result.best.p;
      list.push({ id: z.area.id, name: z.area.name, lat: reg.points.lat[p], lon: reg.points.lon[p], verdict: z.result.verdict });
    }
    setState({ recoMarkers: list });
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => setState({ recoMarkers: [] }), []);
  const markers = useApp((s) => s.recoMarkers);

  if (selectedId || customPoint) return null;
  const pending = results.filter((z) => !z.result && !z.error).length;

  return (
    <aside className="reco-panel glass" aria-labelledby="reco-title">
      <header className="reco-head">
        <h2 id="reco-title" className="reco-title">
          Landing sites · {ZONE_LABEL[zone]}
        </h2>
        <p className="reco-sub tabular">
          Landing {landingMs ? fmtDate(landingMs) : '…'}
          {m.delay ? ` (+${m.delay} d delay)` : ''}, {m.days} {m.days === 1 ? 'day' : 'days'} on the surface
        </p>
      </header>

      <MissionControls />

      {areas.length === 0 ? (
        <p className="empty">The backend has no analysed areas in the {ZONE_LABEL[zone].toLowerCase()} yet. Rotate the Moon or pick another region to see recommendations.</p>
      ) : (
        <ol className="reco-list" aria-busy={pending > 0}>
          {results.map((z, i) => {
            const at = markers.find((k) => k.id === z.area.id);
            return (
            <li key={z.area.id}>
              <button
                type="button"
                className="reco-item"
                onClick={() => {
                  openSite(z.area.id, 'reco');
                  scene()?.flyTo(at?.lat ?? z.area.site.lat, at?.lon ?? z.area.site.lon, 1.9);
                }}
              >
                <span className="reco-rank tabular" aria-hidden="true">
                  {z.result ? i + 1 : '·'}
                </span>
                <span className="reco-name">{z.area.name}</span>
                {z.result ? (
                  <>
                    <span className={`reco-verdict v-${z.result.verdict}`}>{VERDICT_LABEL[z.result.verdict]}</span>
                    <span className="reco-meta tabular">
                      {z.result.best.score !== null ? (
                        <>
                          Score {Math.round(z.result.best.score)}/100
                          <span className="reco-light">
                            <Sun size={11} aria-hidden="true" />
                            {Math.round(z.result.best.sun * 100)}%
                            <Earth size={11} aria-hidden="true" />
                            {Math.round(z.result.best.earth * 100)}%
                          </span>
                        </>
                      ) : (
                        `No point under ${m.maxSlope}°`
                      )}
                    </span>
                  </>
                ) : z.error ? (
                  <span className="reco-meta is-error">Couldn’t load: {z.error}</span>
                ) : (
                  <span className="reco-meta">
                    <span className="skeleton-line" />
                  </span>
                )}
                {at && <span className="reco-coords tabular">{fmtLatLon(at.lat, at.lon, 2)}</span>}
              </button>
            </li>
            );
          })}
        </ol>
      )}
      <p className="note">Each site is the best point of a 20 × 20 km area analysed by the Vesper backend. The areas come from a survey of the whole zone with the backend engine, plus the surroundings of known sites. Scores weigh hours with the Sun and Earth above the real LOLA horizon; points steeper than the max slope are discarded.</p>
    </aside>
  );
}
