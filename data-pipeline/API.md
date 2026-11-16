# Vesper API

Local Python server (`server.py`) that analyses **any coordinate on the Moon** on demand. It needs no
internet connection: it reads the Moon Trek LOLA DEMs from disk and the precomputed JPL Horizons
ephemeris (`ephem_global.npz`, all of 2027, hourly).

## Start

From `data-pipeline/`:

```bash
python server.py --dem-south "LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif" \
                 --dem-north "LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif" \
                 --dem-global "LRO_LOLA_DEM_Global_128ppd_v04.tif"
```

- Listens on `http://localhost:8000`. It also serves the files in `../web` (the precomputed data).
- CORS is open, so the frontend can call it from another origin (`fetch('http://localhost:8000/api/...')`).
- `--port 8080` changes the port; `--host 0.0.0.0` accepts connections from other machines.

## Conventions

- `lat`: −90 to 90 (south is negative). `lon`: degrees **east**; −180..180 and 0..360 are both accepted.
- Azimuth: 0 = north, 90 = east. Elevation in degrees above the local horizontal plane.
- `horizon[i]`: elevation (degrees) of the terrain at azimuth `i` (i = 0..359).
- Hours: index `t` counted from `times.start` (UTC), in steps of `times.step_h` hours.
- Visible = the centre of the disk is above the terrain horizon, for an observer 2 m above the ground.

Some values in the API are Spanish words, kept as stable identifiers; the frontend translates them
(`frontend/src/backend/i18n.ts`, `api.ts`):

| Field | API value | Meaning |
|---|---|---|
| `preset` | `equilibrada` / `solar` / `comunicacion` | balanced / solar power / communication |
| `verdict` | `apto` / `aceptable` / `no recomendado` | suitable / acceptable / not recommended |
| `status` (missions) | `pasada` / `candidata` | landed / candidate |
| `dem` | `Polo Sur` / `Polo Norte` / `Global` | which DEM answered |
| `reasons[]` | sentences in Spanish | why the verdict was given |

## `GET /api/health`

Status, loaded DEMs and the available date range.

## `GET /api/missions`

Catalogue of the 22 sites (`missions.json`): `id, name, lat, lon, country, agency, year, status, note,
source, source_url`, plus `file` and `summary` when the site has a precomputed region.

## `GET /api/point`: one point in about 0.5 s

| Parameter | Default | Meaning |
|---|---|---|
| `lat`, `lon` | (required) | coordinate |
| `date` | start of the data | landing date, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` (UTC) |
| `days` | 10 | mission length |
| `delay` | 0 | days of delay added to `date` |
| `preset` | `equilibrada` | `equilibrada`, `solar` or `comunicacion` |
| `max_slope` | 10 | steepest acceptable slope, degrees |
| `series` | 1 | `0` to leave out the hourly series of the whole year (small response) |

Response:

```jsonc
{
  "lat": -89.46, "lon": 222.51, "alt_m": 1944.0, "slope_deg": 4.74,
  "dem": "Polo Sur", "dem_res_m": 87, "horizon_coverage": 1.0,
  "horizon": [ /* 360 values in degrees */ ],
  "times": {"start": "2027-01-01T00:00", "step_h": 1, "n": 8761},
  "year":   {"sun_pct": 60.4, "earth_pct": 45.1, "both_pct": 30.2},        // the whole year
  "window": {                                                             // the requested mission
    "start": "2027-03-19T00:00", "hours": 240, "t0": 1848,
    "sun_pct": 0.0, "earth_pct": 0.0, "both_pct": 0.0, "longest_sun_h": 0,
    "score": 0.0, "verdict": "no recomendado",        // apto | aceptable | no recomendado
    "reasons": ["Poco Sol en la mision: 0% de las horas", "..."],
    "sun_now":   {"az": 101.2, "el": -0.8, "terrain_el": 1.3},
    "earth_now": {"az": 2.1, "el": -3.4},
    "sun_countdown":   {"visible": false, "hours": 443},   // hours until it changes (null = it does not)
    "earth_countdown": {"visible": false, "hours": 363},
    "windows": {                                         // continuous intervals inside the mission
      "sun":   [{"start": "2027-03-12T00:00", "end": "2027-03-16T18:00", "hours": 114,
                 "starts_before": true, "continues_after": false}],
      "earth": [ /* ... */ ],
      "both":  [ /* ... */ ]                             // Sun and Earth together: operate and transmit
    },
    "energy": {                                          // solar generation potential in the mission
      "vertical_tracking_pct": 47.5,                     // vertical panel that turns towards the Sun
      "horizontal_pct": 0.0,                             // fixed horizontal panel
      "vertical_tracking_kwh_m2": 155.1,                 // incident solar energy per m2 (before efficiency)
      "horizontal_kwh_m2": 0.0,
      "best_panel": "vertical",
      "mean_sun_el_when_visible": -1.09
    }
  },
  "sun":   {"az": [/* ... */], "el": [/* ... */], "visible": [0, 1 /* ... */]},   // if series=1: every hour of the year
  "earth": {"az": [/* ... */], "el": [/* ... */], "visible": [0, 1 /* ... */]},
  "elapsed_s": 0.41
}
```

**Verdict:** `no recomendado` if the slope exceeds `max_slope` or the score is under 30; `apto` if the
score is 50 or more; `aceptable` in between. `reasons` explains why.

**Windows:** `starts_before = true` if the interval was already running before the mission started;
`continues_after = true` if it goes on after the mission ends.

**Energy:** percentages relative to an ideal panel that always faces the Sun for the whole mission.
Vertical panel ∝ cos(Sun elevation); horizontal ∝ sin(elevation). kWh/m² is the incident energy with the
solar constant (1361 W/m²), before panel efficiency (about 30% for space-grade cells). At the poles the
Sun skims the horizon, so a horizontal panel generates almost nothing: vertical panels are needed.

**Score (0–100):** `100 × (w_sun·%Sun + w_earth·%Earth + w_both·%Both + w_continuous·(longest continuous
sunlight / mission length))`, with the weights of the `preset`.

## `GET /api/area`: grid around a point (20–60 s the first time, then cached)

| Parameter | Default | Limit |
|---|---|---|
| `lat`, `lon` | (required) | |
| `radius_km` | 5 | max. 15 |
| `spacing_km` | 0.5 | min. 0.2 |

Returns **the same format as the precomputed regions** (`web/data/region-*.json`), so the frontend's
`src/backend/region.ts` reads it the same way (`prepareRegion`, then `rankPoints`, `scoreGrid`, `track`,
`countdown`). The relief image comes in `grid.image` (a `/cache/...` path).

## For a 3D view

- Direction of the Sun or the Earth at hour `t`, in the point's local coordinates (x = east, y = north, z = up):
  ```js
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  const dir = [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];  // use as a directional light
  ```
- The `horizon` profile draws the terrain silhouette around the observer.
- If the 3D engine uses y = up (three.js), reorder to `[x = east, y = up, z = -north]`.

## Errors

JSON `{"error": "..."}` with status 400 (invalid parameter, date out of range, site with no DEM) or 500.
