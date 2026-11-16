"""
Precomputes a grid of points over the whole Moon so the app can analyse any
coordinate without the live server: it answers with the nearest grid point.

Every number comes from the Vesper engine (point_engine.Engine.analyze_point,
the same code /api/point runs): LOLA terrain horizon plus the JPL Horizons
ephemeris. For each point it stores elevation, slope and whether the Sun and
the Earth are above the terrain horizon for every hour of the year.

Points are spaced --step degrees in latitude and the same distance in
longitude (fewer points per row towards the poles).

Usage (from data-pipeline/, with its Python environment and the three DEMs):
  python ../frontend/design/tools/global_grid.py --out ../frontend/public/data/vesper

Outputs:
  global-grid.json  point list (lat, lon, alt_m, slope_deg, dem) and layout
  global-grid.bin   per point: Sun bits then Earth bits, one bit per hour
                    (bit t of byte t >> 3, least significant bit first)
"""
import argparse
import json
import math
import os
import sys
import time
import warnings

import numpy as np

warnings.filterwarnings("ignore")

ap = argparse.ArgumentParser()
ap.add_argument("--backend", default=".", help="data-pipeline folder")
ap.add_argument("--out", default="../frontend/public/data/vesper")
ap.add_argument("--step", type=float, default=4.0, help="grid spacing in degrees of latitude")
args = ap.parse_args()

sys.path.insert(0, os.path.abspath(args.backend))
from dem_source import DEMSources  # noqa: E402
from ephem_global import GlobalEphem  # noqa: E402
from point_engine import Engine  # noqa: E402

B = os.path.abspath(args.backend)
engine = Engine(
    DEMSources(south=os.path.join(B, "LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif"),
               north=os.path.join(B, "LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif"),
               global_=os.path.join(B, "LRO_LOLA_DEM_Global_128ppd_v04.tif")),
    GlobalEphem(os.path.join(B, "ephem_global.npz")))

points = []
lat = -90.0
while lat <= 90.0 + 1e-9:
    n = max(1, round(360.0 / args.step * math.cos(math.radians(lat))))
    for k in range(n):
        points.append((round(lat, 4), round(k * 360.0 / n, 4)))
    lat += args.step

T = engine.E.T
row_bytes = (T + 7) // 8
meta = {"lat": [], "lon": [], "alt_m": [], "slope_deg": [], "dem": []}
dems = []
bits = bytearray()
t0 = time.time()
for i, (la, lo) in enumerate(points):
    try:
        r = engine.analyze_point(la, lo, include_series=True)
    except Exception as e:  # a point no DEM covers
        print(f"  skipped {la},{lo}: {e}", flush=True)
        continue
    if r["dem"] not in dems:
        dems.append(r["dem"])
    meta["lat"].append(la)
    meta["lon"].append(lo)
    meta["alt_m"].append(r["alt_m"])
    meta["slope_deg"].append(r["slope_deg"])
    meta["dem"].append(dems.index(r["dem"]))
    for body in ("sun", "earth"):
        v = np.asarray(r[body]["visible"], dtype=np.uint8)
        packed = np.packbits(v, bitorder="little")
        assert len(packed) == row_bytes
        bits += packed.tobytes()
    if (i + 1) % 100 == 0:
        el = time.time() - t0
        print(f"  {i + 1}/{len(points)} ({el:.0f}s, ~{el / (i + 1) * (len(points) - i - 1):.0f}s left)", flush=True)

os.makedirs(args.out, exist_ok=True)
with open(os.path.join(args.out, "global-grid.bin"), "wb") as f:
    f.write(bits)
with open(os.path.join(args.out, "global-grid.json"), "w", encoding="utf-8") as f:
    json.dump({
        "source": "Vesper point_engine.analyze_point: LOLA terrain horizon (NASA Moon Trek DEMs) + JPL Horizons ephemeris",
        "step_deg": args.step,
        "times": {"start": str(engine.E.times[0]), "step_h": int(engine.E.step_h), "n": int(T)},
        "row_bytes": row_bytes,
        "layout": "per point: row_bytes of Sun bits, then row_bytes of Earth bits; bit t of byte t>>3, LSB first",
        "dems": dems,
        "points": meta,
    }, f, separators=(",", ":"))
print(f"{len(meta['lat'])} points -> {args.out} ({len(bits) / 1e6:.1f} MB) in {time.time() - t0:.0f}s")
