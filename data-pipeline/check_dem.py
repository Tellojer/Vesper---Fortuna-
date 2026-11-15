"""
Revisa un DEM SIN cargarlo completo: formato, proyeccion, escala de alturas y
que alturas da en cada sitio de regions.json.

    python check_dem.py "LRO_LOLA_DEM_Global_128ppd_v04.tif"
"""
import json
import sys
import warnings

import numpy as np
import rasterio

warnings.filterwarnings("ignore")
from dem_source import DEMFile  # noqa: E402

if len(sys.argv) < 2:
    sys.exit('Uso: python check_dem.py "ARCHIVO.tif"')
path = sys.argv[1]

with rasterio.open(path) as src:
    print("Archivo:", path)
    print("Tamano:", src.width, "x", src.height, "| tipo:", src.dtypes[0], "| nodata:", src.nodata)
    print("Resolucion:", src.res, "| escala en metadatos:", src.scales[0], "| offset:", src.offsets[0])
    print("CRS:", src.crs.to_string() if src.crs else None)
    print("Limites:", src.bounds)

try:
    f = DEMFile(path, "DEM")
except ValueError as e:
    sys.exit(f"\nNO SIRVE: {e}")
print("\n" + f.info())

sites = json.load(open("regions.json", encoding="utf-8"))
print("\nAltura en cada sitio (m):")
vals = []
for r in sites:
    h = f.sample(np.array([r["lat"]]), np.array([r["lon"]]), lon0=r["lon"])[0]
    txt = f"{h:9.0f}" if np.isfinite(h) else "   fuera"
    print(f"  {r['name']:30s} {txt}")
    if np.isfinite(h):
        vals.append(h)

if vals:
    hi = max(abs(v) for v in vals)
    print("\nRango:", round(min(vals)), "a", round(max(vals)), "m")
    if hi > 12000:
        print("OJO: alturas demasiado grandes. Probablemente vienen en medios metros: usa --height-scale 0.5")
    else:
        print("Las alturas se ven bien (metros).")
