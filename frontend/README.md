# Vesper frontend

The Vesper web app: Vite + React + TypeScript + three.js. Project overview, method and data sources
are in the [repository README](../README.md); every reference is listed in [REFERENCES.md](REFERENCES.md).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Playwright: Chromium, Firefox, WebKit
npm run build      # static site in dist/
```

## What is in the app

- **3D Moon** (three.js) with LROC WAC colour and LOLA relief, Lunar-Lambert shading, earthshine and a
  cool fill so the night side stays dark but readable. Sun direction and Earth position come from the
  ephemeris (JPL Horizons); the Earth is drawn at its true distance and size.
- **Six views:** orthographic nearside, farside, north pole and south pole, plus stereographic maps of
  both poles. Zooming in close over a pole opens its stereographic map.
- **Landing site navigator** (button at the top right): recommended sites for the region in view,
  ranked by score for the chosen landing date, mission length, priority and maximum slope. Each site
  is the best point of an analysed 20 × 20 km area, drawn on the Moon as a diamond coloured by verdict.
- **Missions** (left menu): the 22 catalogued sites, with a switch to hide their markers on the Moon.
- **Site panel:** *Landing* (mission controls, "What if the landing slips?", suitability map with the
  top three points, score, countdowns to sunset and Earthset), *Sky* (Sun and Earth elevation, sky dial
  with the real LOLA horizon, hourly visibility bands) and *Terrain* (relief, slope distribution, rover
  traversability).
- **Custom sites:** click the Moon or type `lat, lon` (for example `-85.3, 31.2`). With the backend
  server running, that exact point is analysed live; without it the app answers with the nearest
  point of a precomputed global grid and says how far away it is (see below).
- **Voice assistant** (the bubble at the bottom): ask for the best landing site on a day and time;
  Vesper asks which region and takes the view there. Speech recognition and synthesis use the browser's
  Web Speech API (en-US); typed input always works. Understanding is rule-based
  (`src/voice/intent.ts`) and every figure it says is computed.
- **Timeline** over all of 2027, hourly, with play, speed and a date picker.
- **Keyboard:** arrows rotate (Shift for larger steps), `+`/`−` zoom, `1`–`6` views, Space play/pause,
  `[` `]` ∓1 day, `,` `.` ∓1 hour, `E` face Earth, `S` face Sun, `/` search, Esc close.
- Respects `prefers-reduced-motion`; mobile layout with a drawer and a bottom sheet.

## Data

Everything the app shows is computed by the data pipeline in [`../data-pipeline`](../data-pipeline).
Its outputs are copied unchanged into `public/data/vesper/`:

```bash
npm run sync:backend
```

| In `public/data/vesper/` | What it holds |
|---|---|
| `missions.json` | 22 sites (14 landed, 8 candidates) with coordinates and sources |
| `region-<id>.json` + `.png` | One 21 × 21 grid per site with elevation and slope, the LOLA horizon, and Sun and Earth visibility per point for every hour of 2027. Decoded by `src/backend/region.ts` |
| `survey/` | 20 more areas far from the missions, chosen by surveying the whole Moon (`design/tools/survey_zones.py`) |
| `global-grid.json` + `.bin` | About 2,600 points over the whole Moon (4° apart) with elevation, slope and hourly Sun and Earth visibility, computed by `design/tools/global_grid.py` with the pipeline's engine. Read by `src/backend/globalGrid.ts` |
| `ephem.bin` + `ephem.json` | The pipeline's `ephem_global.npz` re-packed for the browser: Sun direction and Earth position in the Moon frame, hourly |

- Some strings in the pipeline's data are Spanish (status, countries, notes, verdict reasons); they are
  translated for display in `src/backend/i18n.ts`. The data itself is not modified.
- The globe textures in `public/data/moon/` are prepared by `design/tools/prepare-moon.mjs` from NASA
  SVS 4720 and 3615.

## Custom sites and the backend server

A click on the Moon first calls `/api/point` on the pipeline's server (`../data-pipeline/server.py`,
see [API.md](../data-pipeline/API.md)), which analyses that exact coordinate against the LOLA terrain.
By default the app looks for it on port 8000 of the same host, so it works when both run on one
machine. For a hosted build, set `VITE_VESPER_API` to the server's `https` URL at build time.

When the server cannot be reached, `src/backend/globalGrid.ts` answers from the precomputed global
grid: it takes the nearest grid point and scores it for the mission window with the same rules as the
server. On the grid points themselves the two give identical results. The panel then says "Nearest
precomputed point" and how many kilometres away it is (up to about 100 km). At mid latitudes sunlight
and Earth contact change little over that distance (in a test of 28 random points the score differed
by a median of 1.3 points), while slope is local and can change the verdict. Near the poles conditions
change within a few kilometres, so there the answer is only a rough guide and the panel says so.

## Source layout

| Path | Content |
|---|---|
| `src/scene/` | The 3D scene, shaders and picking |
| `src/backend/` | Data loading, the region format, scoring and recommendations, rover traversability, the server client |
| `src/components/` | Interface: top bar, sidebar, navigator, site panel, custom-site panel, dock, voice bubble |
| `src/voice/` | Parsing of spoken or typed landing requests |
| `src/state/` | Application state |
| `tests/` | End-to-end tests (Playwright) |
| `design/tools/` | Scripts that prepare textures, sync the pipeline data and survey the Moon |

## Credits

- Fonts: Archivo and JetBrains Mono (SIL Open Font License), self-hosted via Fontsource. Icons: Lucide (ISC).
- This code was written with the help of an AI coding assistant (Anthropic's Claude); see "Use of AI"
  in the repository README.
