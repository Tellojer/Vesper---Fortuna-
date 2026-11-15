"""
PASO FINAL: genera web/data/<id>.json para cada sitio + web/data/index.json

    python build_data.py --sites sites.json --dem lola_sur.tif \
        --start 2027-01-01 --stop 2028-01-01 --step 1h --out ../web/data

Si un sitio cae fuera del DEM (p. ej. Apollo 11) o no pasas --dem, se usa el
horizonte de una esfera lisa y se marca "terrain": false.

Formato de salida (columnar para que pese poco):
{
  "site": {...datos de sites.json..., "alt_m": 1234.5, "terrain": true},
  "horizon": [360 valores en grados, indice = azimut],
  "times": ["2027-01-01T00:00", ...],
  "sun":   {"az": [...], "el": [...], "vis": [...]},   # vis: 0..1 fraccion del disco visible
  "earth": {"az": [...], "el": [...], "vis": [...]},
  "summary": {"sun_pct": .., "earth_pct": .., "both_pct": .., "max_sun_el": ..}
}
"""
import argparse
import json
import os
import sys

import numpy as np

from ephem import az_el_range

SUN_RADIUS_DEG = 0.267    # radio angular aparente del Sol
EARTH_RADIUS_DEG = 0.95   # radio angular aparente de la Tierra vista desde la Luna


def horizon_at(mask, az):
    """Interpola la mascara (360 valores) en azimuts arbitrarios."""
    az = np.mod(az, 360.0)
    i0 = np.floor(az).astype(int) % 360
    i1 = (i0 + 1) % 360
    f = az - np.floor(az)
    return mask[i0] * (1 - f) + mask[i1] * f


def visible_fraction(el, hor, radius):
    """Fraccion aprox. del disco por encima del horizonte (0..1)."""
    return np.clip((el - hor + radius) / (2 * radius), 0.0, 1.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", default="sites.json")
    ap.add_argument("--dem", default=None)
    ap.add_argument("--height-scale", type=float, default=1.0)
    ap.add_argument("--start", default="2027-01-01")
    ap.add_argument("--stop", default="2028-01-01")
    ap.add_argument("--step", default="1h")
    ap.add_argument("--max-dist-km", type=float, default=150.0)
    ap.add_argument("--observer-h", type=float, default=2.0, help="altura paneles/antena (m)")
    ap.add_argument("--out", default="../web/data")
    ap.add_argument("--only", default=None, help="procesar solo este id de sitio")
    args = ap.parse_args()

    with open(args.sites, encoding="utf-8") as f:
        sites = json.load(f)

    dem = None
    if args.dem:
        from horizon_mask import DEM
        dem = DEM(args.dem, height_scale=args.height_scale)
        dem.describe()

    os.makedirs(args.out, exist_ok=True)
    index = []

    for s in sites:
        if args.only and s["id"] != args.only:
            continue
        print(f"\n== {s['name']} ({s['lat']}, {s['lon']})")

        # 1) Terreno
        terrain = False
        alt_m = 0.0
        mask = None
        if dem is not None:
            from horizon_mask import horizon_mask
            try:
                alt_m, mask = horizon_mask(dem, s["lat"], s["lon"],
                                           max_dist_km=args.max_dist_km,
                                           observer_h_m=args.observer_h)
                terrain = True
                print(f"  altura {alt_m:.0f} m, horizonte max {mask.max():.2f} deg en az {mask.argmax()}")
            except ValueError as e:
                print(f"  {e} -> horizonte liso")
        if mask is None:
            mask = np.full(360, -np.degrees(np.arccos(1737400.0 / (1737400.0 + args.observer_h))))

        # 2) Efemerides (la altura del sitio importa un poco en el polo)
        alt_km = round((alt_m + args.observer_h) / 1000.0, 4)
        print("  pidiendo Sol a Horizons...")
        sun = az_el_range("10", s["lon"], s["lat"], alt_km, args.start, args.stop, args.step)
        print("  pidiendo Tierra a Horizons...")
        earth = az_el_range("399", s["lon"], s["lat"], alt_km, args.start, args.stop, args.step)
        if len(sun) != len(earth):
            sys.exit("Sol y Tierra con distinto numero de filas; revisa fechas")

        s_az = np.array([r["az"] for r in sun]); s_el = np.array([r["el"] for r in sun])
        e_az = np.array([r["az"] for r in earth]); e_el = np.array([r["el"] for r in earth])

        # 3) Visibilidad = elevacion vs terreno en ese azimut
        s_vis = visible_fraction(s_el, horizon_at(mask, s_az), SUN_RADIUS_DEG)
        e_vis = visible_fraction(e_el, horizon_at(mask, e_az), EARTH_RADIUS_DEG)
        both = (s_vis > 0.5) & (e_vis > 0.5)

        summary = {
            "sun_pct": round(float((s_vis > 0.5).mean() * 100), 1),
            "earth_pct": round(float((e_vis > 0.5).mean() * 100), 1),
            "both_pct": round(float(both.mean() * 100), 1),
            "max_sun_el": round(float(s_el.max()), 2),
        }
        print(f"  Sol {summary['sun_pct']}% | Tierra {summary['earth_pct']}% | ambos {summary['both_pct']}%")

        r2 = lambda a: [round(float(x), 2) for x in a]
        out = {
            "site": {**s, "alt_m": round(alt_m, 1), "terrain": terrain},
            "horizon": r2(mask),
            "times": [r["t"] for r in sun],
            "sun": {"az": r2(s_az), "el": r2(s_el), "vis": r2(s_vis)},
            "earth": {"az": r2(e_az), "el": r2(e_el), "vis": r2(e_vis)},
            "summary": summary,
        }
        path = os.path.join(args.out, f"{s['id']}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, separators=(",", ":"))
        print(f"  -> {path} ({os.path.getsize(path) / 1e6:.1f} MB)")
        index.append({**out["site"], "summary": summary, "file": f"{s['id']}.json"})

    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print("\nListo: index.json con", len(index), "sitios")


if __name__ == "__main__":
    main()
