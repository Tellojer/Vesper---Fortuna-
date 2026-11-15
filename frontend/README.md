# Vesper

Compare lunar landing sites and dates: Sun, Earth and terrain for the same site and moment.
NASA Space Apps 2026, challenge "Lunar Landing Site Navigator".

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Playwright: Chromium, Firefox, WebKit
npm run build
```

## Main interface

- Full-screen 3D Moon (three.js) with LROC WAC colour and LOLA relief, Lunar-Lambert shading, earthshine, and a cool fill so the night side stays dark but readable.
- Six regions: Orthographic Nearside, Farside, North Pole, South Pole; Stereographic North and South Pole (shader, r = 2 tan(c/2)). The title follows the view; zooming in close over a pole opens its stereographic map.
- Sun direction and Earth position from the backend ephemeris (JPL Horizons). Earth at its true distance and size, lit by the same Sun; the Sun at 0.53° angular size. "Face Earth" and "Face Sun" frame each body beside the limb.
- The backend's 22 sites (landed and candidates) plus search by name or `lat, lon` (e.g. `-85.3, 31.2` or `85.3 S 31.2 E`).
- Timeline over the backend's hourly data (all of 2027) with play, speed and a date picker; it moves the terminator.
- Site panel, from the site's precomputed region: Sun and Earth elevation and visibility against the LOLA horizon, next sunrise/sunset and Earthrise/Earthset; mission window (duration, priority preset, max slope) with the backend's score and verdict; terrain (elevation, slope distribution, shaded relief).
- Keyboard: arrows rotate (Shift for larger steps), `+`/`−` zoom, `1`–`6` regions, Space play/pause, `[` `]` ∓1 day, `,` `.` ∓1 hour, `E` face Earth, `S` face Sun, `/` search, Esc close.
- Respects `prefers-reduced-motion`; mobile layout with a drawer and a bottom sheet.

## Data

All values shown in the UI come from the team's backend ([Tellojer/Vesper---Fortuna-](https://github.com/Tellojer/Vesper---Fortuna-), cloned next to this folder as `../vesper-data`). Its outputs are copied unchanged:

```bash
npm run sync:backend
```

| Copied to `public/data/vesper/` | What it holds |
|---|---|
| `missions.json` | 22 sites (14 landed, 8 candidates) with verified coordinates and sources. |
| `region-<id>.json` + `.png` | Precomputed region per site: 21 × 21 grid with elevation and slope, LOLA horizon, Sun and Earth visibility per point for every hour of 2027 (JPL Horizons + terrain). Decoded by `src/backend/region.ts`, a TypeScript port of the backend's `web/lib/region.js`. |
| `ephem.bin` + `ephem.json` | `ephem_global.npz` re-packed for the browser: Sun direction and Earth position in the Moon frame, hourly. Drives the globe's lighting, Earth's position and its distance label. |

- The timeline covers the backend's date range (all of 2027 today); regenerate the ephemeris in the backend to change it.
- The backend's Spanish strings (status, countries, notes, sources) are translated in `src/backend/i18n.ts`; the data itself is not modified.
- Coordinate search only moves the view: data exists for the precomputed sites.
- The globe textures (`public/data/moon/`) are prepared by `design/tools/prepare-moon.mjs` from NASA SVS 4720 and 3615.

### DEMs for terrain roughness and traversability

The backend uses three Moon Trek LOLA DEMs (git-ignored, ~4.2 GB), downloaded to `../vesper-data/data-pipeline/`:

| File | Coverage | Type |
|---|---|---|
| `LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif` | 75° S to the pole, 30 m/px | Float32 |
| `LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif` | 75° N to the pole, 30 m/px | Int16 |
| `LRO_LOLA_DEM_Global_128ppd_v04.tif` | Global, 128 ppd (~237 m/px) | Float32 |

Source: `https://trek.nasa.gov/moon/TrekWS/rest/cat/data/stream?label=<name without .tif>`.

Polar maps currently use the global 4K mosaic (about 2.7 km/px), so stereographic zoom stops near ±6° from the pole. Loading a polar DEM or mosaic is the next data step; lower `STEREO_MIN_HALF` in `src/scene/MoonScene.ts` when it is in.

## Data sources and attribution

- LROC WAC colour mosaic (2019) and LOLA gridded elevation (16 ppd), via the NASA SVS CGI Moon Kit, ID 4720: https://svs.gsfc.nasa.gov/4720/ (NASA / GSFC / Arizona State University; LOLA team).
- Ephemeris: series and libration formulas after J. Meeus, *Astronomical Algorithms*, 2nd ed.
- Site coordinates: see `coordSource` in `public/data/sites.json`; IM-2 and Shackleton rim are marked approximate and must be verified.
- Fonts: Fraunces and Sora (SIL Open Font License), self-hosted via Fontsource. Icons: Lucide (ISC).
- Earth texture: NASA SVS, ID 3615 (`flat_earth03.jpg`, 2048x1024, based on Blue Marble Next Generation): https://svs.gsfc.nasa.gov/3615/. Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio; Blue Marble Next Generation data courtesy of Reto Stockli (NASA/GSFC). Its look (cloud and ocean colour) was art-directed by SVS. Earth's spin is set so the scene's Sun falls on Earth's sub-solar point (Sun right ascension and Greenwich sidereal time).
- AI use: this code was written with an AI coding assistant (Claude); declare it in the submission.
