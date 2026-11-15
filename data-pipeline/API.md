# API de Vesper (para el frontend)

Servidor local en Python, sin internet. Calcula **cualquier coordenada de la Luna** con los DEM de
Moon Trek y las efemérides de JPL Horizons precalculadas (`ephem_global.npz`, todo 2027, cada hora).

## Arrancar

Desde `data-pipeline`:
```
python server.py --dem-south "S_POLE_75.tif" --dem-north "N_POLE_75.tif" --dem-global "LRO_LOLA_DEM_Global_128ppd_v04.tif"
```
- Queda en `http://localhost:8000`. Sirve también la app de `../web`.
- CORS abierto: el frontend 3D puede llamarlo desde otro puerto (`fetch('http://localhost:8000/api/...')`).
- `--port 8080` para cambiar el puerto.

## Convenciones
- `lat`: −90 a 90 (sur negativo). `lon`: grados **este**; acepta −180..180 o 0..360.
- Azimut: 0 = norte, 90 = este. Elevación en grados sobre el plano horizontal local.
- `horizon[i]`: elevación (grados) del terreno en el azimut `i` (i = 0..359).
- Horas: índice `t` desde `times.start` (UTC), paso `times.step_h` horas.
- Visible = el centro del disco sobre el horizonte del terreno; observador a 2 m del suelo.

## `GET /api/health`
Estado, DEM cargados y rango de fechas disponible.

## `GET /api/missions`
Catálogo de los 22 sitios (`missions.json`): `id, name, lat, lon, country, agency, year, status
(pasada|candidata), note, source, source_url`, y `file` + `summary` si tienen región precalculada.

## `GET /api/point` — un punto en ~0.5 s
| Parámetro | Default | Qué es |
|---|---|---|
| `lat`, `lon` | (obligatorios) | coordenada |
| `date` | inicio de los datos | fecha de aterrizaje `YYYY-MM-DD` (UTC) |
| `days` | 10 | duración de la misión |
| `delay` | 0 | días de retraso sobre `date` |
| `preset` | `equilibrada` | `equilibrada`, `solar` o `comunicacion` |
| `max_slope` | 10 | pendiente máxima aceptable (grados) |
| `series` | 1 | `0` para no mandar las series de todo el año (respuesta pequeña) |

Respuesta:
```jsonc
{
  "lat": -89.46, "lon": 222.51, "alt_m": 1944.0, "slope_deg": 4.74,
  "dem": "Polo Sur", "dem_res_m": 87, "horizon_coverage": 1.0,
  "horizon": [ ...360 valores en grados... ],
  "times": {"start": "2027-01-01T00:00", "step_h": 1, "n": 8761},
  "year":   {"sun_pct": 60.4, "earth_pct": 45.1, "both_pct": 30.2},          // todo el año
  "window": {                                                               // la misión pedida
    "start": "2027-03-19T00:00", "hours": 240, "t0": 1848,
    "sun_pct": 0.0, "earth_pct": 0.0, "both_pct": 0.0, "longest_sun_h": 0,
    "score": 0.0, "verdict": "no recomendado",        // apto | aceptable | no recomendado
    "reasons": ["Poco Sol en la mision: 0% de las horas", "..."],
    "sun_now":   {"az": 101.2, "el": -0.8, "terrain_el": 1.3},
    "earth_now": {"az": 2.1, "el": -3.4},
    "sun_countdown":   {"visible": false, "hours": 443},   // horas hasta que cambie (null = no cambia)
    "earth_countdown": {"visible": false, "hours": 363},
    "windows": {                                         // intervalos continuos dentro de la misión
      "sun":   [{"start": "2027-03-12T00:00", "end": "2027-03-16T18:00", "hours": 114,
                 "starts_before": true, "continues_after": false}],
      "earth": [...],
      "both":  [...]                                     // Sol y Tierra a la vez: operar y transmitir
    },
    "energy": {                                          // potencial de generación en la misión
      "vertical_tracking_pct": 47.5,                     // panel vertical que gira hacia el Sol
      "horizontal_pct": 0.0,                             // panel horizontal fijo
      "vertical_tracking_kwh_m2": 155.1,                 // energía solar incidente por m² (sin eficiencia)
      "horizontal_kwh_m2": 0.0,
      "best_panel": "vertical",
      "mean_sun_el_when_visible": -1.09
    }
  },
  "sun":   {"az": [...], "el": [...], "visible": [0,1,...]},   // si series=1: cada hora del año
  "earth": {"az": [...], "el": [...], "visible": [0,1,...]},
  "elapsed_s": 0.41
}
```
**Veredicto:** `no recomendado` si la pendiente supera `max_slope` o el puntaje < 30; `apto` si el
puntaje ≥ 50; `aceptable` en medio. `reasons` explica por qué, listo para mostrar.

**Ventanas:** `starts_before = true` si el intervalo ya venía desde antes del inicio de la misión;
`continues_after = true` si sigue después del final.

**Energía:** porcentaje respecto a un panel ideal siempre perpendicular al Sol durante toda la misión.
Panel vertical ∝ cos(elevación del Sol); horizontal ∝ sen(elevación). kWh/m² = energía incidente con la
constante solar (1361 W/m²), antes de la eficiencia del panel (~30% en paneles espaciales). En los polos
el Sol va al ras del horizonte, así que un panel horizontal casi no genera: hacen falta paneles verticales.

**Puntaje (0–100):** `100 × (w_sol·%Sol + w_tierra·%Tierra + w_ambos·%Ambos + w_continuo·(Sol continuo más largo / duración))`,
con los pesos del `preset`.

## `GET /api/area` — cuadrícula alrededor del punto (20–60 s la primera vez, luego instantáneo)
| Parámetro | Default | Límite |
|---|---|---|
| `lat`, `lon` | (obligatorios) | |
| `radius_km` | 5 | máx. 15 |
| `spacing_km` | 0.5 | mín. 0.2 |

Devuelve **el mismo formato que las regiones precalculadas** (`web/data/region-*.json`), así que
`web/lib/region.js` lo lee igual: `R.prepareRegion(json)` y luego `rankPoints`, `scoreGrid`, `track`,
`countdown`, `windows` y `energy`. La imagen de relieve viene en `grid.image` (ruta `/cache/...`).
Muestra un "calculando…" mientras responde.

## Para el 3D
- Dirección del Sol o la Tierra en una hora `t`, en coordenadas locales del punto (x = este, y = norte, z = arriba):
  ```js
  const a = az * Math.PI/180, e = el * Math.PI/180;
  const dir = [Math.cos(e)*Math.sin(a), Math.cos(e)*Math.cos(a), Math.sin(e)];  // úsalo como luz direccional
  ```
- El perfil `horizon` permite dibujar la silueta del terreno alrededor del observador.
- Si el motor 3D usa y = arriba (Three.js), cambia el orden: `[x=este, y=arriba, z=-norte]`.

## Errores
JSON `{"error": "..."}` con código 400 (parámetro inválido, fecha fuera de rango, sitio sin DEM) o 500.
