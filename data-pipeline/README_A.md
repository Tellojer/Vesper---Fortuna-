# Pipeline de datos — guía para A

## ⭐ SERVIDOR: cualquier coordenada en ~0.5 s (sin internet)
```
python server.py --dem-south "S.tif" --dem-north "N.tif" --dem-global "GLOBAL.tif"
```
Abre http://localhost:8000 . Documentación de la API para el frontend en **API.md**.
`ephem_global.npz` ya trae el Sol y la Tierra de todo 2027 (precalculado con Horizons; para otro
periodo: `python ephem_global.py --start 2028-01-01 --stop 2029-01-01`).


## ⭐ MODO CUADRÍCULA (lo que usa la app) — toda la Luna

El pipeline lee **solo el pedazo de DEM que necesita cada región**, así que funciona con los
archivos enormes de Moon Trek sin llenar la memoria. Elige el DEM según la latitud:

| Latitud del sitio | DEM que usa | Opción |
|---|---|---|
| 60°S o más al sur | LRO LOLA DEM, 45 deg v4, **S Pole** (Moon Trek) | `--dem-south` |
| 60°N o más al norte | LRO LOLA DEM, 45 deg v4, **N Pole** (Moon Trek) | `--dem-north` |
| entre 60°S y 60°N | LRO LOLA DEM **global con alturas** (Moon Trek) | `--dem-global` |

### Correr en tu computadora (dentro de `data-pipeline`)
```
python grid_region.py --regions regions.json --dem-south "ARCHIVO_S_POLE.tif" --dem-north "ARCHIVO_N_POLE.tif" --out ../web/data
```
- Agrega `--dem-global "ARCHIVO_GLOBAL.tif"` cuando lo tengas. Las regiones sin DEM se saltan con un aviso.
- Pon los nombres de archivo entre comillas si tienen espacios.
- ~1 minuto por región. Para rehacer solo una: `--only <id>`.
- Las alturas se corrigen solas si el archivo trae escala o guarda el radio en vez de la altura.
  Si aparece el aviso de "medios metros", agrega `--height-scale 0.5`.
- Un archivo `uint8` (imagen) se rechaza: hace falta la versión con alturas.

### Archivos de Moon Trek que usamos
| Uso | Archivo |
|---|---|
| Polo sur (75°S al polo, 30 m/px) | LRO LOLA DEM, S Pole, 75 deg v4 |
| Polo norte (75°N al polo, 30 m/px) | LRO LOLA DEM, N Pole, 75 deg v4 |
| Resto de la Luna (237 m/px) | LRO_LOLA_DEM_Global_128ppd_v04 |

- Los polares de LOLA v4 suelen venir en **medios metros**: si pasas también el global, el
  pipeline lo detecta comparando alturas y lo corrige solo (verás el mensaje en pantalla).
- Se calcula a 60 m por defecto (más fino es mucho más lento sin cambiar casi nada).
- Sitios fuera de los polares (p. ej. Chandrayaan-3 a 69°S) usan el global automáticamente.
- Revisa cada archivo antes: `python check_dem.py "ARCHIVO.tif"`.

### Toda la Luna: orden de trabajo
1. `regions.json` ya trae el catálogo: 14 misiones que aterrizaron, 6 regiones candidatas del polo sur
   y 2 del polo norte, cada una con su fuente.
2. Calcula todo con los tres DEM de Moon Trek:
   ```
   python grid_region.py --regions regions.json --dem-south "S.tif" --dem-north "N.tif" --dem-global "GLOBAL.tif" --out ../web/data
   ```
   (~1 min por sitio, ~25 min en total). También genera `missions.json`, que alimenta el mapa de inicio.
3. Genera el mapa base de la Luna con el DEM global de Moon Trek:
   ```
   python make_globe.py --dem-global "GLOBAL.tif" --out ../web/data
   ```
   El `moon.png` incluido es provisional (LOLA de 4 px/grado); reemplázalo con este paso.

### Validar contra el mapa de iluminación de NASA (solo polo sur)
```
python validate_nasa.py ../web/data AVGVISIB_85S_060M_201608.TIF
```
Con el DEM polar de LOLA da una correlación de 0.93 en 2,646 puntos.

### regions.json
`id`, `name`, `lat`, `lon` (grados ESTE), `radius_km`, `spacing_km`, `source`. Coordenadas verificadas
en QuickMap / Moon Trek.

---

La sección de abajo es el modo de **sitios sueltos** (`build_data.py`), útil para Apollo 11
y para pruebas.

Objetivo: generar `web/data/<sitio>.json` + `web/data/index.json` con, para cada sitio,
la posición del Sol y la Tierra cada hora durante un año, el horizonte del terreno
y si cada uno es visible.

Archivos:
| Archivo | Qué hace |
|---|---|
| `ephem.py` | Pide az/el del Sol y la Tierra a JPL Horizons (con caché y reintentos) |
| `check_horizons.py` | Prueba de cordura de Horizons |
| `horizon_mask.py` | Calcula el perfil de horizonte de 360° desde el DEM |
| `build_data.py` | Une todo y escribe los JSON para el frontend |
| `sites.json` | Lista de sitios (la llena C) |
| `sample_output/` | JSON de ejemplo con datos reales de Horizons (sin terreno), para que B empiece ya |

---

## Paso 1 — Instalar (5 min)
```bash
cd data-pipeline
pip install -r requirements.txt
```

## Paso 2 — Probar Horizons (5 min)
```bash
python check_horizons.py
```
Debe salir aprox.:
```
Tierra desde (0,0):      el min/max = 80.0 / 87.4
Tierra desde (0,90E):    el min/max = -8.0 / 7.1, az promedio = 270
Sol desde (-89.5,0):     el min/max = 0.40 / 1.03
Tierra desde (-89.5,0):  el min/max = -6.48 / 7.00
```
Si sale eso, Horizons funciona y la convención está bien: **longitud ESTE positiva**,
latitud sur negativa y azimut 0 = norte, 90 = este.

👉 **Pásale a B la carpeta `sample_output/`** en cuanto esto funcione, para que conecte
datos reales mientras tú sigues con el terreno.

## Paso 3 — Bajar el DEM (20–30 min, máx.)
1. En Moon Trek (trek.nasa.gov/moon), busca una capa **LOLA DEM** del **polo sur**
   (idealmente 20–60 m/px).
2. Recorta el área que cubra todos los sitios **más ~150 km de margen** (los cerros
   lejanos también tapan el Sol). Si los sitios están cerca del polo, un recorte de
   ~88°S hacia el polo, o un cuadro de ~400×400 km centrado en el polo, va bien.
3. Descárgalo como **GeoTIFF** y guárdalo como `data-pipeline/lola_sur.tif`.

**Plan B** si Moon Trek se complica: usa un DEM LOLA de PGDA
(pgda.gsfc.nasa.gov, productos LOLA polares) en GeoTIFF.
No pases más de 30 min en esto.

## Paso 4 — Revisar el DEM (5 min)
```python
from horizon_mask import DEM
dem = DEM("lola_sur.tif")
dem.describe()
```
- Las alturas deben verse como **metros** (aprox. −5000 a +3000). Si ves −5 a 3, son km →
  usa `--height-scale 1000` en el paso 6.
- El CRS debe decir `+proj=stere +lat_0=-90`. Si el archivo no trae CRS, el código usa
  la polar estereográfica sur de LOLA por defecto.

## Paso 5 — Probar el horizonte de UN sitio (15 min)
```python
from horizon_mask import DEM, horizon_mask, plot_mask
dem = DEM("lola_sur.tif")
h, mask = horizon_mask(dem, lat=-89.5, lon=0.0)
print("altura del sitio:", h, "m")
plot_mask(mask, "Prueba", "horizonte_prueba.png")
```
Abre la imagen. Debe verse una silueta de cerros de unos pocos grados.
Si sale el aviso "solo X% de los rayos cae dentro del DEM", el recorte es chico:
baja `max_dist_km` (p. ej. 80) o descarga un recorte más grande.

Validación rápida: el `% Sol` de un sitio (paso 6) debe parecerse al valor del mapa de
iluminación promedio de QuickMap/PGDA en ese punto (no idéntico: ellos promedian 18.6 años
y tú calculas 1).

## Paso 6 — Generar todo (10–20 min, corre solo)
Cuando C tenga `sites.json` con coordenadas verificadas:
```bash
python build_data.py --sites sites.json --dem lola_sur.tif \
    --start 2027-01-01 --stop 2028-01-01 --step 1h --out ../web/data
```
- Para un solo sitio: `--only shackleton-rim`
- Las respuestas de Horizons se guardan en `.cache/`: correrlo otra vez es instantáneo.
- Los sitios fuera del DEM (Apollo) usan horizonte liso y quedan con `"terrain": false`.

Cada sitio pesa ~0.4–0.5 MB. Haz commit de `web/data/` para que el demo funcione **sin internet**.

---

## Formato de `sites.json` (para C)
```json
{"id": "shackleton-rim", "name": "...", "lat": -89.xx, "lon": 123.xx,
 "country": "US", "status": "futura", "source": "link a la fuente oficial"}
```
`lon` en grados ESTE (0–360 o −180–180). Coordenadas **siempre de fuente oficial**.

## Formato de salida (para B)
```json
{
  "site": {"id": "...", "name": "...", "lat": -89.5, "lon": 0, "alt_m": 1234.5, "terrain": true},
  "horizon": [360 números en grados; índice = azimut],
  "times": ["2027-01-01T00:00", ...],
  "sun":   {"az": [...], "el": [...], "vis": [...]},
  "earth": {"az": [...], "el": [...], "vis": [...]},
  "summary": {"sun_pct": 52.2, "earth_pct": 49.9, "both_pct": 25.4, "max_sun_el": 1.03}
}
```
- `vis` va de 0 a 1: la fracción del disco por encima del terreno. Visible = `vis > 0.5`.
- Cuenta regresiva a atardecer/ocaso de la Tierra: desde el índice actual, buscar el
  primer `vis <= 0.5`.

## Supuestos (para la diapositiva de "método")
- Efemérides: JPL Horizons (modelo lunar DE441), elevación sin refracción (Luna sin atmósfera).
- Terreno: LOLA, rayos cada pixel hasta 150 km, con curvatura lunar exacta.
- Observador a 2 m sobre el suelo (`--observer-h`), como paneles o antena de un lander.
- Visibilidad del disco: Sol ≈ 0.27° de radio, Tierra ≈ 0.95°.
- Limitación: el terreno más allá de 150 km o fuera del recorte no se considera.
