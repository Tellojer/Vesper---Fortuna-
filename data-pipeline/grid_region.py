"""
MODO CUADRICULA: escanea una region alrededor de un punto objetivo y genera
todo lo que el frontend necesita para el mapa de calor y el ranking.

    python grid_region.py --regions regions.json --dem lola_sur.tif \
        --start 2027-01-01 --stop 2028-01-01 --out web_data

Por region:
  1. Una cuadricula de puntos (p. ej. 21x21 a 1 km = 441 puntos).
  2. Para cada punto: altura, pendiente y mascara de horizonte de 360 grados.
  3. UNA consulta a Horizons (Sol y Tierra) en el centro de la region.
     La direccion del Sol y de la Tierra se convierte a az/el local de cada
     punto (error por paralaje de la Tierra en 20 km ~ 0.003 grados).
  4. Visibilidad hora por hora de cada punto -> bits comprimidos.
  5. Un PNG de relieve (hillshade) de la region para el fondo del mapa.

Salida: web_data/region-<id>.json, web_data/region-<id>.png, web_data/regions.json
El frontend calcula el puntaje para cualquier fecha/duracion con region.js.
"""
import argparse
import base64
import json
import os
import time

import numpy as np
from pyproj import CRS, Transformer

from ephem import az_el_range
from horizon_mask import horizon_mask, MOON_LONLAT
from dem_source import DEMSources

SUN_R = 0.267    # radio angular del Sol (grados)
EARTH_R = 0.95   # radio angular de la Tierra vista desde la Luna (grados)


# ---------- geometria ----------
def enu(lat, lon):
    """Vectores Este, Norte, Arriba (cenit) en el marco fijo a la Luna."""
    p, l = np.radians(lat), np.radians(lon)
    E = np.stack([-np.sin(l), np.cos(l), np.zeros_like(l)], -1)
    N = np.stack([-np.sin(p) * np.cos(l), -np.sin(p) * np.sin(l), np.cos(p)], -1)
    U = np.stack([np.cos(p) * np.cos(l), np.cos(p) * np.sin(l), np.sin(p)], -1)
    return E, N, U


def azel_to_vec(lat, lon, az, el):
    """az/el en (lat,lon) -> vector unitario en el marco fijo a la Luna. az, el: arrays (T,)."""
    E, N, U = enu(np.array(lat), np.array(lon))
    a, e = np.radians(az)[:, None], np.radians(el)[:, None]
    return np.cos(e) * np.sin(a) * E + np.cos(e) * np.cos(a) * N + np.sin(e) * U  # (T,3)


def vec_to_local_azel(vec, lats, lons):
    """vec (T,3) -> az, el locales de cada punto: arrays (P,T)."""
    E, N, U = enu(lats, lons)  # (P,3)
    e_ = E @ vec.T
    n_ = N @ vec.T
    u_ = U @ vec.T
    az = np.degrees(np.arctan2(e_, n_)) % 360.0
    el = np.degrees(np.arcsin(np.clip(u_, -1, 1)))
    return az, el


def horizon_at(masks, az):
    """masks (P,360), az (P,T) -> elevacion del terreno (P,T), interpolada."""
    i0 = np.floor(az).astype(int) % 360
    i1 = (i0 + 1) % 360
    f = az - np.floor(az)
    rows = np.arange(masks.shape[0])[:, None]
    return masks[rows, i0] * (1 - f) + masks[rows, i1] * f


# ---------- terreno ----------
def slope_deg(dem, x, y):
    """Pendiente (grados) en el pixel del punto, metodo de Horn 3x3."""
    col, row = dem.inv * (x, y)
    r, c = int(row), int(col)
    z = dem.z[r - 1:r + 2, c - 1:c + 2]
    if z.shape != (3, 3) or np.isnan(z).any():
        return float("nan")
    dzdx = ((z[0, 2] + 2 * z[1, 2] + z[2, 2]) - (z[0, 0] + 2 * z[1, 0] + z[2, 0])) / (8 * dem.res)
    dzdy = ((z[2, 0] + 2 * z[2, 1] + z[2, 2]) - (z[0, 0] + 2 * z[0, 1] + z[0, 2])) / (8 * dem.res)
    return float(np.degrees(np.arctan(np.hypot(dzdx, dzdy))))


def hillshade_png(dem, cx, cy, half_m, path, px=512):
    """Relieve sombreado de la region (luz del noroeste en el mapa) como PNG en gris."""
    from PIL import Image
    xs = np.linspace(cx - half_m, cx + half_m, px)
    ys = np.linspace(cy + half_m, cy - half_m, px)  # fila 0 = arriba (y mayor)
    X, Y = np.meshgrid(xs, ys)
    col, row = dem.inv * (X, Y)
    # bilineal (centro del pixel en +0.5) para que no salgan escalones
    c = np.clip(col - 0.5, 0, dem.z.shape[1] - 1.001)
    r = np.clip(row - 0.5, 0, dem.z.shape[0] - 1.001)
    c0, r0 = np.floor(c).astype(int), np.floor(r).astype(int)
    fc, fr = c - c0, r - r0
    Z = dem.z
    z = (Z[r0, c0] * (1 - fc) * (1 - fr) + Z[r0, c0 + 1] * fc * (1 - fr)
         + Z[r0 + 1, c0] * (1 - fc) * fr + Z[r0 + 1, c0 + 1] * fc * fr)
    step = (2 * half_m) / (px - 1)
    gy, gx = np.gradient(z * 2.0, step)  # exageracion vertical x2 para que se lea el relieve
    gy = -gy  # fila 0 = arriba
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(gy, -gx)
    alt, az = np.radians(35), np.radians(135)  # luz desde arriba-izquierda en la imagen
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    hs = np.nan_to_num(np.clip(hs, 0, 1))
    lo, hi = np.percentile(hs, [1, 99])
    hs = np.clip((hs - lo) / max(hi - lo, 1e-6), 0, 1)
    Image.fromarray((hs * 255).astype(np.uint8)).save(path)


# ---------- principal ----------
def b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def process_region(reg, sources, args):
    t_start = time.time()
    print(f"\n== Region {reg['name']} ({reg['lat']}, {reg['lon']})")
    radius = reg.get("radius_km", args.radius_km) * 1000.0
    spacing = reg.get("spacing_km", args.spacing_km) * 1000.0

    # 0) DEM local: solo el pedazo que necesita esta region
    half_extent = radius + spacing + args.max_dist_km * 1000.0 + 2000.0
    dem, dem_label = sources.local_dem(reg["lat"], reg["lon"], half_extent, args.res_m)
    print(f"  Terreno: {dem_label}")
    dem.describe()
    ll = CRS.from_proj4(MOON_LONLAT)
    to_xy = Transformer.from_crs(ll, dem.crs, always_xy=True)
    to_ll = Transformer.from_crs(dem.crs, ll, always_xy=True)

    # 1) cuadricula en coordenadas del mapa (metros), centrada en el objetivo
    cx, cy = to_xy.transform(reg["lon"], reg["lat"])
    offs = np.arange(-radius, radius + 1, spacing)
    gx, gy = np.meshgrid(offs, offs[::-1])  # fila 0 = norte del mapa (y mayor)
    nrows, ncols = gx.shape
    X = (cx + gx).ravel()
    Y = (cy + gy).ravel()
    lons, lats = to_ll.transform(X, Y)
    lats = np.asarray(lats); lons = np.asarray(lons) % 360.0
    P = len(X)
    print(f"  {ncols}x{nrows} = {P} puntos cada {spacing / 1000:g} km")

    # 2) terreno de cada punto
    masks = np.zeros((P, 360))
    alts = np.zeros(P)
    slopes = np.zeros(P)
    t0 = time.time()
    for i in range(P):
        try:
            alts[i], masks[i] = horizon_mask(dem, lats[i], lons[i],
                                             max_dist_km=args.max_dist_km,
                                             observer_h_m=args.observer_h)
        except ValueError:
            alts[i], masks[i] = np.nan, 90.0  # fuera del DEM: nunca visible
        slopes[i] = slope_deg(dem, X[i], Y[i])
        if i == 0 or (i + 1) % 50 == 0 or i == P - 1:
            el = time.time() - t0
            print(f"  horizonte {i + 1}/{P}  ({el:.0f}s, faltan ~{el / (i + 1) * (P - i - 1):.0f}s)")

    # 3) efemerides en el centro
    alt_c_km = round((float(np.nanmedian(alts)) + args.observer_h) / 1000.0, 4)
    if getattr(args, "gephem", None) is not None:
        # efemerides precalculadas (sin internet): misma informacion que Horizons en el centro
        s_az, s_el, e_az, e_el = args.gephem.azel(reg["lat"], reg["lon"], alt_c_km * 1000.0)
        times0 = str(args.gephem.times[0])
    else:
        print("  Horizons: Sol...")
        sun = az_el_range("10", reg["lon"], reg["lat"], alt_c_km, args.start, args.stop, args.step)
        print("  Horizons: Tierra...")
        earth = az_el_range("399", reg["lon"], reg["lat"], alt_c_km, args.start, args.stop, args.step)
        s_az = np.array([r["az"] for r in sun]); s_el = np.array([r["el"] for r in sun])
        e_az = np.array([r["az"] for r in earth]); e_el = np.array([r["el"] for r in earth])
        times0 = sun[0]["t"]
    T = len(s_az)

    # 4) visibilidad de cada punto, hora por hora
    sun_vec = azel_to_vec(reg["lat"], reg["lon"], s_az, s_el)
    earth_vec = azel_to_vec(reg["lat"], reg["lon"], e_az, e_el)
    bits = {}
    pct = {}
    for name, vec, rad in (("sun", sun_vec, SUN_R), ("earth", earth_vec, EARTH_R)):
        vis = np.zeros((P, T), dtype=bool)
        for a in range(0, P, 64):  # por bloques para no gastar mucha memoria
            b = min(a + 64, P)
            az, el = vec_to_local_azel(vec, lats[a:b], lons[a:b])
            vis[a:b] = el - horizon_at(masks[a:b], az) > 0.0  # centro del disco sobre el terreno
        bits[name] = np.packbits(vis, axis=1, bitorder="little")
        pct[name] = vis.mean(axis=1) * 100
    print(f"  % Sol en la region: min {pct['sun'].min():.0f}, max {pct['sun'].max():.0f}")
    print(f"  % Tierra en la region: min {pct['earth'].min():.0f}, max {pct['earth'].max():.0f}")

    # 5) fondo de relieve
    half = radius + spacing / 2
    png_name = f"region-{reg['id']}.png"
    hillshade_png(dem, cx, cy, half, os.path.join(args.out, png_name))

    out = {
        "region": {**{k: reg[k] for k in reg}, "dem": dem_label},
        "grid": {"rows": nrows, "cols": ncols, "spacing_m": spacing,
                 "center_xy": [cx, cy],
                 "bounds_xy": [cx - half, cy - half, cx + half, cy + half],
                 "image": png_name},
        "times": {"start": times0, "step_h": args.step_hours, "n": T},
        "center": {"sun": {"az": np.round(s_az, 3).tolist(), "el": np.round(s_el, 3).tolist()},
                   "earth": {"az": np.round(e_az, 3).tolist(), "el": np.round(e_el, 3).tolist()}},
        "points": {"lat": np.round(lats, 5).tolist(), "lon": np.round(lons, 5).tolist(),
                   "alt_m": [None if np.isnan(a) else round(float(a), 1) for a in alts],
                   "slope_deg": [None if np.isnan(s) else round(float(s), 2) for s in slopes]},
        "horizon_cdeg_b64": b64(np.round(masks * 100).clip(-32768, 32767).astype("<i2")),
        "sun_bits_b64": b64(bits["sun"]),
        "earth_bits_b64": b64(bits["earth"]),
        "bits_row_bytes": int(bits["sun"].shape[1]),
        "summary": {"sun_pct_max": round(float(pct["sun"].max()), 1),
                    "earth_pct_max": round(float(pct["earth"].max()), 1)},
    }
    path = os.path.join(args.out, f"region-{reg['id']}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"  -> {path} ({os.path.getsize(path) / 1e6:.1f} MB) + {png_name}  [{time.time() - t_start:.0f}s]")
    return {**reg, "file": f"region-{reg['id']}.json", "image": png_name, "summary": out["summary"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", default="regions.json")
    ap.add_argument("--dem-south", "--dem", dest="dem_south", default=None, help="DEM polo sur")
    ap.add_argument("--dem-north", default=None, help="DEM polo norte")
    ap.add_argument("--dem-global", default=None, help="DEM global (grados)")
    ap.add_argument("--polar-lat", type=float, default=60.0, help="desde esta |latitud| se usan los DEM polares")
    ap.add_argument("--height-scale", type=float, default=None, help="forzar escala de alturas en TODOS los DEM")
    ap.add_argument("--scale-south", type=float, default=None, help="forzar escala solo del DEM sur (p. ej. 0.5)")
    ap.add_argument("--scale-north", type=float, default=None, help="forzar escala solo del DEM norte")
    ap.add_argument("--scale-global", type=float, default=None, help="forzar escala solo del DEM global")
    ap.add_argument("--res-m", type=float, default=None, help="resolucion del DEM local (m); por defecto la nativa, minimo 60")
    ap.add_argument("--start", default="2027-01-01")
    ap.add_argument("--stop", default="2028-01-01")
    ap.add_argument("--step", default="1h")
    ap.add_argument("--radius-km", type=float, default=10.0)
    ap.add_argument("--spacing-km", type=float, default=1.0)
    ap.add_argument("--max-dist-km", type=float, default=150.0)
    ap.add_argument("--observer-h", type=float, default=2.0)
    ap.add_argument("--out", default="web_data")
    ap.add_argument("--only", default=None)
    ap.add_argument("--ephem", default=None, help="usar efemerides precalculadas (sin internet), p. ej. ephem_global.npz")
    args = ap.parse_args()
    if not args.step.endswith("h"):
        raise SystemExit("--step debe ser en horas, p. ej. 1h")
    args.step_hours = int(args.step[:-1])

    args.gephem = None
    if args.ephem:
        from ephem_global import GlobalEphem
        args.gephem = GlobalEphem(args.ephem)
    with open(args.regions, encoding="utf-8") as f:
        regions = json.load(f)
    os.makedirs(args.out, exist_ok=True)

    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)
    sources = DEMSources(south=args.dem_south, north=args.dem_north, global_=args.dem_global,
                         polar_lat=args.polar_lat, height_scale=args.height_scale,
                         scales={k: v for k, v in (("south", args.scale_south), ("north", args.scale_north),
                                                   ("global", args.scale_global)) if v is not None})
    print("DEM disponibles:")
    sources.describe()

    index_path = os.path.join(args.out, "regions.json")
    index = []
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            index = json.load(f)
    for reg in regions:
        if args.only and reg["id"] != args.only:
            continue
        try:
            entry = process_region(reg, sources, args)
        except (ValueError, MemoryError) as e:
            print(f"  SALTADA: {e}")
            continue
        index = [e for e in index if e["id"] != reg["id"]] + [entry]
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=1)
    # catalogo completo de misiones (calculadas o no) para el mapa de inicio de la app
    done = {e["id"]: e for e in index}
    missions = []
    for reg in regions:
        m = {k: v for k, v in reg.items() if k not in ("radius_km", "spacing_km")}
        if reg["id"] in done:
            m["file"] = done[reg["id"]]["file"]
            m["summary"] = done[reg["id"]].get("summary")
        missions.append(m)
    with open(os.path.join(args.out, "missions.json"), "w", encoding="utf-8") as f:
        json.dump(missions, f, ensure_ascii=False, indent=1)
    print("\nListo:", len(index), "regiones calculadas en", index_path,
          f"| {len(missions)} misiones en missions.json")


if __name__ == "__main__":
    main()
