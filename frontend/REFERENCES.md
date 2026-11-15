# Vesper: references and source files

Every dataset, figure and method the app relies on, with where it is used in the code. Site coordinates and their per-site sources live in `public/data/vesper/missions.json` (shown in each site panel).

## 1. Sun and Earth positions

| Source | Used for | Where |
|---|---|---|
| [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) (ephemeris DE441), queried by the backend | Sun direction and Earth position in the Moon-fixed frame, every hour of 2027 | backend `ephem.py`, `ephem_global.py` → `public/data/vesper/ephem.bin`, read by `src/backend/data.ts` |
| J. Meeus, *Astronomical Algorithms*, 2nd ed. (Willmann-Bell, 1998) | Only to spin the Earth on its axis in the 3D view (visual) | `src/astro/ephemeris.ts` |

## 2. Lunar terrain (surface, elevation, slope, horizon)

| Source | Used for | Where |
|---|---|---|
| [NASA Moon Trek](https://trek.nasa.gov/moon/), LRO LOLA DEM `LRO_LOLA_DEM_SPole75_30mp_v04_EQ` (75° S to the pole) | Elevation, slope and the 360° terrain horizon near the south pole | backend `dem_source.py`, `horizon_mask.py`, `point_engine.py` |
| NASA Moon Trek, `LRO_LOLA_DEM_NPole75_30mp_v04_EQ` (75° N to the pole) | Same, near the north pole | same |
| NASA Moon Trek, `LRO_LOLA_DEM_Global_128ppd_v04` (global, ~237 m/px) | Same, everywhere else | same |
| [NASA GSFC PGDA, LOLA 5 m/px south-pole site DEMs](https://pgda.gsfc.nasa.gov/products/78) (Barker et al. 2021) | Centre coordinates of the six south-pole candidate sites | backend `regions.json` |
| LOLA average-illumination map `AVGVISIB_85S_060M_201608` (NASA PGDA / LOLA team) | Validation only: the backend's Sun percentages against it (correlation 0.927 over 3,086 points) | backend `validate_nasa.py` |

Download pattern for the three DEMs: `https://trek.nasa.gov/moon/TrekWS/rest/cat/data/stream?label=<file name without .tif>`. They are not in the repository (4.2 GB).

## 3. Moon and Earth models in the 3D view

| Source | Used for | Where |
|---|---|---|
| [NASA SVS CGI Moon Kit, ID 4720](https://svs.gsfc.nasa.gov/4720/): LROC WAC colour mosaic (2019). Credit: NASA / GSFC / Arizona State University | Colour texture of the globe | `design/tools/prepare-moon.mjs` → `public/data/moon/` |
| NASA SVS CGI Moon Kit, ID 4720: LOLA gridded elevation, 16 ppd. Credit: NASA / GSFC LOLA team | Normal map (relief shading) of the globe | same |
| [NASA SVS, ID 3615](https://svs.gsfc.nasa.gov/3615/), Earth texture based on Blue Marble Next Generation. Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio; Blue Marble Next Generation courtesy of Reto Stockli (NASA/GSFC) | Earth in the background | same |
| Lunar-Lambert photometric function | Shading of the globe (flat-lit at full phase, Lambertian near the terminator) | `src/scene/shaders.ts` |

## 4. Landing sites (catalogue of 22)

| Source | Sites |
|---|---|
| [NASA NSSDCA lunar landing sites](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html), LRO coordinates (Wagner et al. 2017) | Apollo 11, 12, 14, 15, 16, 17 |
| LROC (QuickMap team) featured images and NAC DTMs: [1100](https://www.lroc.asu.edu/images/1100), [1374](https://lroc.im-ldi.com/images/1374), [1358](https://www.lroc.asu.edu/images/1358), [1401](https://www.lroc.asu.edu/images/1401), [1400](https://www.lroc.im-ldi.com/images/1400) | Chang'e 4 and 6, SLIM, IM-2, Blue Ghost 1 and others (see `missions.json` for the exact pairing) |
| [NASA SSERVI, Chang'e 5 landing site](https://webarchive.library.unt.edu/web/20201218022812/https://sservi.nasa.gov/articles/change-5-landing-site) | Chang'e 5 |
| ISRO coordinate, inside the [LROC NAC DTM of the Vikram site](https://data.lroc.im-ldi.com/lroc/view_rdr_product/NAC_DTM_VIKRAMSITE1_M1442997156_100CM) | Chandrayaan-3 (marked "to verify in QuickMap") |
| [NASA / LROC, images of the Odysseus lander](https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/) | IM-1 |
| NASA Moon Trek study regions / IAU crater coordinates | The two north-pole sites (marked "to verify") |

## 5. Rover traversability

| Source | Used for | Where |
|---|---|---|
| [NASA Science, VIPER lunar operations](https://science.nasa.gov/mission/viper/lunar-operations/): the rover "can generally drive on a slope of up to 15 degrees" | VIPER preset, 15° | `src/backend/rover.ts` |
| [NASA SP-4214, *Where No Man Has Gone Before*, ch. 13](https://www.hq.nasa.gov/office/pao/History/SP-4214/ch13-3.html): the Lunar Roving Vehicle could "climb and descend slopes of 25 degrees" | Apollo LRV preset, 25° | same |
| Riley, S. J., DeGloria, S. D., Elliot, R. (1999). "A terrain ruggedness index that quantifies topographic heterogeneity." *Intermountain Journal of Sciences* 5(1–4), 23–27 | Relief roughness (Terrain Ruggedness Index) | same |
| Dijkstra, E. W. (1959). "A note on two problems in connexion with graphs." *Numerische Mathematik* 1, 269–271 | Shortest drive to every reachable grid point | same |

Scale warning: traversability and roughness use the backend's grid of points 1 km apart (slope measured at the DEM scale, 60 to 237 m). They describe hills and crater walls, not rocks at rover scale.

## 6. Scoring and verdict

Defined by the team's backend (`data-pipeline/point_engine.py`, documented in `data-pipeline/API.md`) and mirrored in `src/backend/region.ts`:

- Score (0–100) = 100 × (w_sun · %Sun + w_earth · %Earth + w_both · %Both + w_continuous · longest continuous sunlight / mission length). Balanced weights: 0.40, 0.25, 0.15, 0.20.
- Verdict: not recommended if the slope exceeds the limit or the score is under 30; suitable from 50; acceptable in between.
- A body counts as visible when the centre of its disk is above the terrain horizon, for an observer 2 m above the ground; terrain up to 150 km away is considered.

## 7. Software

| Library | Use |
|---|---|
| [three.js](https://threejs.org/) | 3D globe and polar maps |
| [React](https://react.dev/) + [Vite](https://vite.dev/) + TypeScript | Application |
| [Playwright](https://playwright.dev/) | End-to-end tests (`tests/`) |
| [lucide](https://lucide.dev/) | Icons |
| Archivo and JetBrains Mono (via Fontsource, SIL Open Font License) | Typefaces |
| Web Speech API (browser) | Voice assistant: speech recognition and synthesis, en-US |
| Backend: Python, NumPy, rasterio, pyproj, matplotlib, requests | Data pipeline and server |

## 8. Source files by feature

Paths are relative to the frontend folder (`frontend/` in the team repository).

| Feature | Files |
|---|---|
| 3D Moon, Sun, Earth, picking | `src/scene/MoonScene.ts`, `src/scene/shaders.ts`, `src/scene/SceneContext.tsx`, `src/astro/ephemeris.ts` |
| Backend data (missions, ephemeris, regions) | `src/backend/data.ts`, `src/backend/region.ts`, `src/backend/i18n.ts`, `design/tools/sync-backend.mjs` |
| Recommended sites (Landing site navigator) | `src/backend/recommend.ts`, `src/components/Recommendations.tsx`, `src/components/MissionControls.tsx`, `src/components/verdict.ts` |
| Zone survey (sites far from the missions) | `design/tools/survey_zones.py`, data in `public/data/vesper/survey/` |
| Site panel (Landing, Sky, Terrain) | `src/components/SitePanel.tsx` |
| Custom sites (click or coordinates, live backend) | `src/backend/api.ts`, `src/components/PointPanel.tsx` |
| Rover traversability | `src/backend/rover.ts`, section in `src/components/SitePanel.tsx` |
| Voice assistant | `src/voice/intent.ts`, `src/components/VesperBubble.tsx`, `src/components/VesperBubble.css`, `src/components/VesperMark.tsx` |
| Layout and controls | `src/App.tsx`, `src/components/TopBar.tsx`, `Sidebar.tsx`, `Dock.tsx`, `Overlays.tsx`, `RegionTitle.tsx`, `src/state/store.ts`, `src/lib/format.ts` |
| Styles | `src/styles/tokens.css`, `base.css`, `app.css` |
| Tests | `tests/main-interface.spec.ts`, `tests/vesper-bubble.spec.ts`, `playwright.config.ts` |
| Globe textures | `design/tools/prepare-moon.mjs`, `public/data/moon/` |
