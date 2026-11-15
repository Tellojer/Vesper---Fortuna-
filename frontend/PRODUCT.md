# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** NASA Space Apps 2026 judges evaluating the project, and mission planners who compare lunar landing sites and dates.
- **Must also serve:** scientists and engineers. Vesper has to be more than a demo: values must be traceable to their data source, units explicit, and limits stated, so a technical user can apply the results.

## Product Purpose

Vesper compares lunar landing sites and dates for the NASA Space Apps challenge "Lunar Landing Site Navigator". For a chosen site and day it shows lighting (Sun elevation, time to sunset/sunrise), Earth visibility (Earth elevation, Earthset/Earthrise) and, through the Vesper Terrain module, terrain screening (slope, roughness, obstacles, data confidence). Success: a planner can pick a region and a date and get a defensible shortlist of landing zones.

## Positioning

Site + date comparison in one place: Sun, Earth and terrain evaluated together for the same site and moment, with honest data-confidence reporting instead of a single opaque score.

## Operating Context

- Main interface: full-screen 3D Moon (three.js) with six regions (Orthographic Nearside, Farside, North Pole, South Pole; Stereographic North and South Pole), Earth and Sun at true relative scale, curated sites, search by name or "lat, lon", and a timeline from -15 to +30 days.
- Vesper Terrain: per-site analysis computed offline in Python (numpy, scipy, rasterio, opencv). The frontend only reads and draws its JSON + PNG layers. Rover traversability is a later step that combines those layers with a user-editable rover profile.
- Voice control (final stage): push-to-talk through the Vesper star bubble, en-US, rule-based intents, typed-command fallback, spoken answers built only from computed values.
- Order of work: site data and module outputs, comparison view, video and README, voice.

## Capabilities and Constraints

- UI and submission language: English.
- Curated sites: Apollo 11, Apollo 17, Chang'e 4, Chandrayaan-3, IM-2 (Mons Mouton), Shackleton rim.
- Sun and Earth values are first-order (smooth sphere) until terrain horizons and full libration are included; the UI must say so.
- One CRS from DEM clip to UI (south polar stereographic, metres, MOON_ME); record vertical datum and pixel size in every output.
- Browser performance: precompute per site and stream PNG layers; avoid live analysis on grids above ~512 x 512.
- Required next: side-by-side comparison of two site-date scenarios.
- Undecided: Chang'e 4 DTM product IDs, IM-2/Shackleton NAC image IDs, Pragyan and Yutu-2 specs, primary LTV requirements.

## Brand Commitments

- Name: Vesper. Logo: the Vesper star (design/brand/), with its two orbiting trails.
- Wordmark in Fraunces, UI in Sora (binding, from the brief).

## Evidence on Hand

- Data catalog and briefs: "Vesper data catalog and implementation briefs" (14 Nov 2026), listing NAC DTMs, LOLA LDEMs, Diviner rock abundance, PGDA illumination maps, rover documents.
- Calibration ranges at historical sites: TRI 0.077 to 0.462 m, slopes 0 to 10 degrees (NTRS 20200001796).
- No VIPER slope limit was found: rover limits are user-editable and must cite a source. Never fabricate values, results or validations.

## Product Principles

1. Every number shown comes from data or computation, with its source and units; nothing invented.
2. State limits openly: data confidence, interpolated pixels, first-order estimates.
3. Same site, same moment: Sun, Earth and terrain are always evaluated together.
4. Fast to a decision: region and day first, details on demand.
5. Ready for real data: textures, relief and terrain layers plug in without UI changes.

## Accessibility & Inclusion

Respect prefers-reduced-motion, full keyboard control, and a mobile layout (from the brief).
