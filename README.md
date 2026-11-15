# Vesper - Fortuna!
Por escribir

## Backend

El backend calcula, para cualquier punto de la Luna, cuántas horas recibe Sol y ve la Tierra
(considerando el relieve real), y recomienda sitios de aterrizaje según la fecha y duración de
la misión. Todo funciona **sin internet** una vez descargados los datos.

```
data-pipeline/   servidor y cálculo (Python)
web/             app (index.html, lib/region.js, data/ con las regiones ya calculadas)
```

### 1. Instalar
```
cd data-pipeline
pip install -r requirements.txt
```

### 2. Descargar los 3 DEM de NASA Moon Trek
Los archivos son muy grandes (1–2 GB cada uno), así que **no están en el repo**. Se descargan de
[NASA Moon Trek](https://trek.nasa.gov/moon/) buscando cada capa por su nombre y exportándola
como GeoTIFF. Hay que guardarlos dentro de `data-pipeline/`:

| Archivo | Cobertura | Resolución |
|---|---|---|
| `LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif` | Polo sur (75°S al polo) | 30 m/px |
| `LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif` | Polo norte (75°N al polo) | 30 m/px |
| `LRO_LOLA_DEM_Global_128ppd_v04.tif` | Toda la Luna | ~237 m/px |

Para revisar un archivo: `python check_dem.py "ARCHIVO.tif"`. Los polares de LOLA v4 suelen venir
en medios metros; si se carga también el global, el pipeline lo detecta y lo corrige solo.

### 3. Servidor: cualquier coordenada en ~0.5 s
```
cd data-pipeline
python server.py --dem-south "LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif" --dem-north "LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif" --dem-global "LRO_LOLA_DEM_Global_128ppd_v04.tif"
```
Abre http://localhost:8000 (sirve también la app de `web/`). `--port 8080` cambia el puerto.
Las efemérides del Sol y la Tierra de todo 2027 ya vienen en `ephem_global.npz`. Para otro periodo:
`python ephem_global.py --start 2028-01-01 --stop 2029-01-01` (necesita internet).

Endpoints principales (detalle en [data-pipeline/API.md](data-pipeline/API.md)):
- `GET /api/health`: estado y DEM cargados.
- `GET /api/missions`: catálogo de los 22 sitios (misiones que aterrizaron y regiones candidatas).
- `GET /api/point?lat=-89.46&lon=222.51&date=2027-03-19&days=10`: horizonte, % de Sol/Tierra,
  ventanas continuas, energía solar, puntaje y veredicto (`apto` / `aceptable` / `no recomendado`).
- `GET /api/area?lat=..&lon=..&radius_km=5`: cuadrícula alrededor del punto, en el mismo formato
  que las regiones precalculadas.

### 4. Precalcular regiones (lo que lee la app)
```
cd data-pipeline
python grid_region.py --regions regions.json --dem-south "LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif" --dem-north "LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif" --dem-global "LRO_LOLA_DEM_Global_128ppd_v04.tif" --out ../web/data
```
- ~1 min por región (~25 min en total). Para rehacer solo una: `--only <id>`.
- El DEM se elige solo según la latitud: polar sur (≤60°S), polar norte (≥60°N) o global.
- También genera `missions.json` para el mapa de inicio.
- Mapa base de la Luna: `python make_globe.py --dem-global "LRO_LOLA_DEM_Global_128ppd_v04.tif" --out ../web/data`.
- Los resultados ya calculados están en `web/data/`.

Validación contra el mapa de iluminación promedio de NASA (polo sur, `AVGVISIB_85S_060M_201608.tiff`
de PGDA): `python validate_nasa.py ../web/data AVGVISIB_85S_060M_201608.tiff`. Con el DEM polar de
LOLA da una correlación de 0.93 en 2,646 puntos.

Más detalle del pipeline en [data-pipeline/README_A.md](data-pipeline/README_A.md) y del frontend en
[web/README_B.md](web/README_B.md).

### Método y supuestos
- Efemérides: JPL Horizons (DE441), sin refracción (la Luna no tiene atmósfera).
- Terreno: LOLA, rayos hasta 150 km con curvatura lunar exacta; observador a 2 m del suelo.
- Limitación: no se considera el terreno a más de 150 km ni fuera del DEM.

### Recursos usados
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/): posición del Sol y la Tierra vistos desde la Luna.
- [NASA Moon Trek](https://trek.nasa.gov/moon/): DEM LOLA polares y global.
- [LROC QuickMap](https://quickmap.lroc.asu.edu/): verificación de coordenadas de sitios y comparación con mapas de iluminación.
- [Agencia Espacial Canadiense](https://www.asc-csa.gc.ca/): recursos de exploración lunar.
- [NASA PGDA](https://pgda.gsfc.nasa.gov/): mapa de iluminación promedio del polo sur para validar.
