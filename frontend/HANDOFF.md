# Vesper: handoff (2026-11-15)

Read this first, then `README.md` (how it works, data, commands) and `PRODUCT.md` (users, purpose, constraints).

## What Vesper is

A web app for NASA Space Apps 2026, challenge "Lunar Landing Site Navigator". **Main goal (user): recommend suitable lunar landing sites.** If that works in the frontend, the project meets its goal; judge every feature by how it serves it.

- Frontend (this folder): Vite + React 19 + TypeScript + three.js. `npm run dev` → http://localhost:5173.
- Backend (team repo, cloned at `C:\Users\emtel\Desktop\vesper-data`, https://github.com/Tellojer/Vesper---Fortuna-): Python data-pipeline. Its outputs are copied unchanged into `public/data/vesper/` with `npm run sync:backend`. Docs: `vesper-data/data-pipeline/API.md`, `README_A.md`, `web/README_B.md`.
- The user writes in Spanish; the UI and the submission are in English.

## Binding decisions from the user

1. Dates come from the backend (hourly, all of 2027 today), not "around today".
2. Everything user-facing is in English; the backend's Spanish strings are translated in `src/backend/i18n.ts` (data untouched).
3. This frontend is the main app (not the backend's `web/index.html`).
4. All data shown comes from the backend. Our own Meeus ephemeris (`src/astro/ephemeris.ts`) is only used to spin Earth visually.
5. The Moon's night side must never be pitch black; the terminator must be soft (no hard line).
6. The frontend adapts to the backend, not the other way round. Mirror the backend's functions (`web/lib/region.js`, ported to `src/backend/region.ts`).
7. Recommendations are by zone: in any view (farside included) the app must say which places can work.
8. Mission controls are integer sliders (duration 1–14 d, priority 3 steps, max slope 2–25°, delay 0–29 d), as in the backend app.
9. The timeline readout shows the date, not hour counts.
10. Visual direction (latest): graphite + platinum interface, accent in the ice blue of the logo, technological type, not generic rounded cards.

## Current frontend

- **Globe** (`src/scene/MoonScene.ts`, `shaders.ts`): LROC colour + LOLA normal map (NASA SVS 4720), Lunar-Lambert shading, soft terminator, cool night fill. Six regions (4 orthographic, 2 stereographic polar maps). Sun direction and Earth position from the backend ephemeris (`ephem.bin`, JPL Horizons). Earth texture NASA SVS 3615. Render on demand.
- **Landing site navigator** (right menu, `src/components/Recommendations.tsx` + `SitePanel.tsx`): hidden by default; the top-bar button "Landing site navigator" toggles it (`navigatorOpen` in the store). It lists recommended sites for the zone in view, independent of the missions: one per backend-analysed area (its best grid point for the mission window), with generic stable names (`recoAreas` in `recommend.ts`: Farside 1, Nearside 7…). They are drawn on the Moon as diamond markers coloured by verdict, only while the navigator is open. Opening one shows the site panel with the generic name (`selectedKind: 'reco'`).
- **Surveyed areas** (sites far from the missions): `design/tools/survey_zones.py` samples the whole Moon (552 points) with the backend's `point_engine.analyze_point`, picks 20 flat, well-separated areas at least 4° from any mission (6 nearside, 6 farside, 4 per pole), and the backend's `grid_region.py` computes each one into `vesper-data/web/data-survey/` (untracked in the backend clone). `npm run sync:backend` copies it to `public/data/vesper/survey/`; the app loads it with `loadSurvey()` (optional). Commands are in the script's docstring; the backend's Python env is `vesper-data/.venv` (3.14, requirements.txt). They are numbered after the mission areas (Farside 3–8, Nearside 10–15, North Pole 3–6, South Pole 10–13).
- **Custom sites** (any coordinate, live): clicking the Moon (a press without dragging, `onPick` in `MoonScene.ts`) or typing `lat, lon` in the search opens `src/components/PointPanel.tsx`, which asks the backend server `/api/point` (`src/backend/api.ts`) for the score, verdict and reasons of that point for the current mission window. Needs `server.py` running (port 8000 of the same host by default; `VITE_VESPER_API` overrides it); without it the panel explains how to start it. Backend reasons are translated in `i18n.ts` (`tReason`). Tests mock the endpoint.
- **Missions** stay in the left menu; the "Show on the Moon" switch (`showMissions`) hides their markers. Clicking a mission opens its site panel (and the navigator).
- **Site panel** (`src/components/SitePanel.tsx`), tabs:
  - Landing: sliders, delay impact text, aptitude heat map with top-3 pins (click a point), score and rank, stats, countdowns.
  - Sky: Sun/Earth elevation, sky dial with the real LOLA horizon, hourly bands.
  - Terrain: relief, slope distribution.
- **Dock** (`src/components/Dock.tsx`): play/speed, date picker, year scrubber with month ticks; the Vesper bubble (`VesperBubble.tsx`, `VesperMark.tsx`) sits in the middle (animated star with orbiting trails; it will become the voice push-to-talk).
- **Data layer**: `src/backend/data.ts` (missions, ephemeris), `region.ts` (port of region.js), `recommend.ts` (zones, evaluation), `i18n.ts`. State in `src/state/store.ts`.
- **Tests**: `npm test` (Playwright, Chromium/Firefox/WebKit, 2 workers). 36 passed on 2026-11-15.

## Redesign in progress (unfinished)

Done: tokens in `src/styles/tokens.css` (graphite `--ink-*`, platinum `--plat*`, accent `--accent*` = logo ice blue `#a8d2ff`, `--metal` gradient); fonts Archivo variable (width axis, `font-stretch: 125%` for display) + JetBrains Mono for measurements (`.tabular`); all corners square; wide uppercase wordmark and region title; panels with instrument corner brackets; underlined tabs; section headings with hairline; metal play button. Section "Platinum language" near the end of `src/styles/app.css`.

Still to do:
- Brand in the top bar: compose the new logo (star flare + "VESPER" wordmark) like the user's image; the logo image is the star in `public/brand/` + the wordmark text.
- Remove leftover indigo/blue tints: marker dots, bubble chrome (`VesperBubble.css`), shadows using `rgb(3 4 15 …)`, `.scene` background `#03040f` in `MoonScene.ts`.
- Check sizes after the wider title; mobile layout.
- Verify: screenshots (the in-app browser pane is often hidden; use a Playwright screenshot script), Impeccable detector (`C:\Users\emtel\.claude\skills\impeccable\scripts\impeccable.cmd detect --json src`), `npm test`, `npm run build`.

## Future work

1. **Vesper Terrain** (roughness, then rover traversability). The three Moon Trek LOLA DEMs are downloaded and size-verified in `vesper-data/data-pipeline/` (git-ignored, ~4.2 GB): `LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif`, `..._NPole75_30mp_v04_EQ.tif`, `LRO_LOLA_DEM_Global_128ppd_v04.tif`. Brief: offline Python, output JSON + PNG layers per site; rover limits user-editable with cited sources.
2. **Voice commands** through the bubble: push-to-talk, en-US Web Speech API, rule-based intents (go to region/site, face Earth/Sun, when does the Sun set, is Earth visible, how rough is this site, next day/week), typed fallback, spoken answers only from computed values.
3. **Side-by-side comparison** of two site-date scenarios (user said: after the model and data are integrated).
4. **Deploy**: data is static, so `npm run build` → host `dist/` (Vercel/Netlify/Cloudflare/GitHub Pages). Not git-initialised yet; ask the user before publishing.

## Gotchas

- Windows + PowerShell 5.1: refresh PATH in each command: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
- Writing files with PowerShell `Get-Content -Raw` can corrupt UTF-8 accents; use the editor tools or explicit UTF-8 encoding.
- The preview server config lives in the session scratch workspace `.claude/launch.json` (`npm --prefix <project> run dev`).
- Regions are ~1.9 MB each; the south pole view loads ~8 (cached after).
- Site coordinates: IM-2 and Shackleton come from the backend's verified list; `missions.json` is the source of truth.
