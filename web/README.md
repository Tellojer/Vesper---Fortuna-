# Precomputed data

`data/` holds the outputs of the data pipeline (`data-pipeline/grid_region.py`), exactly as computed:

| File | Content |
|---|---|
| `missions.json` | The 22 catalogued sites with coordinates, sources and their region file |
| `regions.json` | Index of the computed regions |
| `region-<id>.json` | One region: 21 × 21 grid (points 1 km apart) with elevation and slope, the 360° LOLA terrain horizon of every point, and Sun and Earth visibility per point for every hour of 2027 |
| `region-<id>.png` | Shaded relief of the region |

`npm run sync:backend` (in `frontend/`) copies this folder unchanged into
`frontend/public/data/vesper/`, where the app reads it. The region format is decoded by
`frontend/src/backend/region.ts`.

`server.py` serves this folder too, and reads `data/missions.json` for `/api/missions`.
