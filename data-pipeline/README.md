# Vesper data pipeline

Python code that turns NASA data into everything the app shows: where the Sun and the Earth are
against the real terrain horizon, for any point on the Moon and every hour of 2027.

```bash
pip install -r requirements.txt
```

## Files

| File | What it does |
|---|---|
| `ephem.py` | Queries the JPL Horizons API (with cache and retries) |
| `ephem_global.py` | Precomputes the Sun direction and Earth position for a whole period → `ephem_global.npz` |
| `dem_source.py` | Reads the Moon Trek DEMs in windows (south pole, north pole, global), picks the DEM by latitude, fixes the height scale, handles the 180° meridian |
| `horizon_mask.py` | 360° terrain horizon by ray casting (up to 150 km, exact lunar curvature) |
| `grid_region.py` | 21 × 21 grid (1 km apart) per region → `region-<id>.json` + `.png`, `missions.json` |
| `point_engine.py` | Engine for any coordinate: `analyze_point` (about 1 s), `analyze_area` (20–60 s) |
| `server.py` | HTTP server (standard library, open CORS): `/api/health`, `/api/missions`, `/api/point`, `/api/area`. See [API.md](API.md) |
| `make_globe.py` | Base map of the whole Moon (`moon.png`) from the global DEM |
| `check_dem.py` | Inspects a DEM without loading it |
| `check_horizons.py` | Sanity check of the Horizons queries |
| `validate_nasa.py` | Compares our Sun percentage with the LOLA average-illumination map (85° S) |
| `build_data.py`, `sites.json` | Earlier single-site mode (one JSON per site), kept for reference |
| `regions.json` | Catalogue of the 22 sites, each with its source |
| `survey-regions.json`, `survey-points.json` | Areas far from the missions, found by surveying the whole Moon (see below) |

## DEMs (NASA Moon Trek, not in git)

| File | Coverage | Notes |
|---|---|---|
| `LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif` | 75° S to the pole | equirectangular (degrees), float32, metres |
| `LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif` | 75° N to the pole | equirectangular, int16, **half metres** (corrected automatically) |
| `LRO_LOLA_DEM_Global_128ppd_v04.tif` | everything else | degrees, float32, metres, about 237 m/px |

Download each one into this folder (about 4.2 GB in total):

```
https://trek.nasa.gov/moon/TrekWS/rest/cat/data/stream?label=<file name without .tif>
```

The pipeline reads **only the piece of DEM each computation needs**, so these files work on a laptop
without filling its memory. The DEM is chosen by latitude: the polar DEMs beyond 60°, the global one
elsewhere. Polar LOLA v4 files store half metres; when the global DEM is also given, the pipeline
detects it by comparing heights and corrects it (a message is printed). Check a file first with
`python check_dem.py "FILE.tif"`.

## Server: any coordinate in about a second

```bash
python server.py --dem-south "LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif" \
                 --dem-north "LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif" \
                 --dem-global "LRO_LOLA_DEM_Global_128ppd_v04.tif"
```

Listens on `http://localhost:8000` (`--host 0.0.0.0` to accept other machines, `--port` to change the
port). `ephem_global.npz` already holds the Sun and the Earth for all of 2027; for another period run
`python ephem_global.py --start 2028-01-01 --stop 2029-01-01`. Full reference: [API.md](API.md).

Quick test: `http://localhost:8000/api/point?lat=-89.46&lon=222.51&date=2027-03-12&series=0`

### Running the server online

The frontend only needs the server for custom coordinates (a click on the Moon or a typed `lat, lon`).
It runs on any Linux machine with Python 3.10+ and about 6 GB of disk: install the requirements,
download the three DEMs as described above and start it with `--host 0.0.0.0`. The frontend must reach
it over `https`: put it behind a reverse proxy or a tunnel, and set `VITE_VESPER_API` to that URL when
building the frontend. A laptop can stand in for it with a tunnel:

```bash
cloudflared tunnel --url http://localhost:8000
```

## Precomputed regions (what the app loads)

```bash
python grid_region.py --regions regions.json \
    --dem-south "LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif" \
    --dem-north "LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif" \
    --dem-global "LRO_LOLA_DEM_Global_128ppd_v04.tif" \
    --ephem ephem_global.npz --out ../web/data
```

- About one minute per region; `--only <id>` recomputes a single one. Regions with no DEM are skipped
  with a warning.
- Also writes `missions.json`, the catalogue the app starts from.
- Heights are corrected automatically when the file carries a scale or stores the radius instead of the
  height. A `uint8` file (an image) is rejected: the version with heights is needed.
- `regions.json` fields: `id`, `name`, `lat`, `lon` (degrees east), `radius_km`, `spacing_km`, `source`.

Then copy the outputs into the frontend with `npm run sync:backend` (in `frontend/`).

### Areas far from the missions

`frontend/design/tools/survey_zones.py` samples the whole Moon (552 points) with `analyze_point`, keeps
flat points at least 4° away from every mission, and picks well-separated ones per zone (6 nearside,
6 farside, 4 per pole). The result is `survey-regions.json`; `grid_region.py` then computes each area:

```bash
python ../frontend/design/tools/survey_zones.py --out survey-regions.json
python grid_region.py --regions survey-regions.json --dem-south ... --dem-north ... --dem-global ... \
    --ephem ephem_global.npz --out ../web/data-survey
```

## Validation

```bash
python validate_nasa.py ../web/data AVGVISIB_85S_060M_201608.TIF
```

Compares the yearly Sun percentage of every grid point with NASA's LOLA average-illumination map (the
layer shown in QuickMap). Result for the 7 south-pole regions: correlation 0.927 over 3,086 points. The
two are not expected to be identical: the NASA map averages 18.6 years and Vesper computes one.

`check_horizons.py` checks the Horizons convention (longitude **east** positive, south latitude
negative, azimuth 0 = north and 90 = east): from (0°, 0°) the Earth stays between about 80° and 87° of
elevation, and from 89.5° S the Sun stays between about 0.4° and 1.0°.

## Method and assumptions

- Ephemeris: JPL Horizons (DE441 lunar model); elevation without refraction (the Moon has no atmosphere).
- Terrain: LOLA, rays sampled every pixel up to 150 km, with exact lunar curvature.
- Observer 2 m above the ground (`--observer-h`), like the panels or the antenna of a lander.
- Disk radius: Sun about 0.27°, Earth about 0.95°. A body counts as visible when its centre is above the terrain.
- Limits: terrain beyond 150 km is not considered; slope is measured at DEM scale (60–237 m), not lander scale.

Code comments and console messages in the Python files are in Spanish.
