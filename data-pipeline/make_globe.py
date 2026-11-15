"""
Mapa base de toda la Luna para la pantalla de inicio de la app.

    python make_globe.py --dem-global "ARCHIVO_GLOBAL.tif" --out ../web/data

Lee el DEM global (Moon Trek, LRO LOLA DEM) reducido (no carga el archivo completo),
calcula un relieve sombreado coloreado por altura y guarda:
  - moon.png  (equirectangular, longitud -180..180 de izquierda a derecha, latitud 90..-90)
  - moon.json (tamaño y limites, para que la app ubique las misiones)
"""
import argparse
import json
import os

import numpy as np
import rasterio
from rasterio.enums import Resampling
from PIL import Image

R_MOON = 1737400.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem-global", required=True)
    ap.add_argument("--out", default="web_data")
    ap.add_argument("--width", type=int, default=2048)
    ap.add_argument("--height-scale", type=float, default=None)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    W, H = args.width, args.width // 2
    with rasterio.open(args.dem_global) as src:
        if src.crs is None or not src.crs.is_geographic:
            raise SystemExit("El DEM global debe estar en grados (proyeccion geografica)")
        if src.dtypes[0] == "uint8":
            raise SystemExit("Es una imagen uint8, no alturas: descarga la version con alturas")
        z = src.read(1, out_shape=(H, W), resampling=Resampling.average).astype("float64")
        scale = args.height_scale or (src.scales[0] if src.scales and src.scales[0] else 1.0)
        off = src.offsets[0] if src.offsets and src.offsets[0] else 0.0
        if src.nodata is not None:
            z[z == src.nodata] = np.nan
        left = src.transform.c
    z = z * scale + off
    if np.nanmedian(z) > 1e6:
        z -= R_MOON
    # reordenar para que la imagen vaya de -180 a 180 (cara visible al centro)
    shift = int(round(((-180.0 - left) % 360.0) / 360.0 * W))
    z = np.roll(z, -shift, axis=1)

    # relieve sombreado (exageracion vertical para que se lea a escala global)
    px_m = 2 * np.pi * R_MOON / W
    gy, gx = np.gradient(np.nan_to_num(z, nan=np.nanmedian(z)) * 8.0, px_m)
    lat = np.linspace(90, -90, H)[:, None]
    gx = gx / np.maximum(np.cos(np.radians(lat)), 0.05)
    gy = -gy
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(gy, -gx)
    alt, az = np.radians(40), np.radians(135)
    hs = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)

    # color por altura: gris azulado (bajo) a gris arena (alto), discreto
    lo, hi = np.nanpercentile(z, [2, 98])
    t = np.clip((z - lo) / (hi - lo), 0, 1)
    low = np.array([96, 104, 116]); high = np.array([214, 206, 188])
    col = low[None, None, :] * (1 - t[..., None]) + high[None, None, :] * t[..., None]
    shade = (0.45 + 0.75 * hs)[..., None]
    rgb = np.clip(col * shade, 0, 255).astype(np.uint8)
    Image.fromarray(rgb).save(os.path.join(args.out, "moon.png"), optimize=True)

    meta = {"width": W, "height": H, "lon_min": -180, "lon_max": 180, "lat_max": 90, "lat_min": -90,
            "source": os.path.basename(args.dem_global)}
    with open(os.path.join(args.out, "moon.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    print(f"Listo: moon.png ({W}x{H}) en {args.out}")


if __name__ == "__main__":
    main()
