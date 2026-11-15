"""
Surveys each zone of the Moon with the Vesper backend engine and writes the
list of areas worth analysing in detail, away from the mission sites.

It only calls backend code (point_engine.Engine.analyze_point, the same thing
/api/point runs), so every number comes from the backend: LOLA terrain horizon
plus the JPL Horizons ephemeris for all of 2027.

  1. Sample a coarse grid over the whole Moon.
  2. Per zone, keep points with a landable slope, rank them by the backend's
     balanced weights over the year, and pick well-separated ones that are far
     from every mission in regions.json.
  3. Write survey-regions.json, ready for the backend's grid_region.py, which
     computes the 21 x 21 grid of each area in the usual region format.

Usage (from the backend's data-pipeline folder, with its Python environment):
  python <frontend>/design/tools/survey_zones.py --out survey-regions.json
  python grid_region.py --regions survey-regions.json --dem-south ... --dem-north ... \
         --dem-global ... --ephem ephem_global.npz --out ../web/data-survey
Then `npm run sync:backend` in the frontend copies web/data-survey unchanged.
"""
import argparse
import json
import math
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")

ap = argparse.ArgumentParser()
ap.add_argument("--backend", default=".", help="backend data-pipeline folder")
ap.add_argument("--out", default="survey-regions.json")
ap.add_argument("--cache", default="survey-points.json", help="sampled points (reused if present)")
ap.add_argument("--max-slope", type=float, default=8.0)
ap.add_argument("--mission-gap-deg", type=float, default=4.0, help="minimum distance to any mission (1 deg = 30 km)")
args = ap.parse_args()

sys.path.insert(0, os.path.abspath(args.backend))
from dem_source import DEMSources  # noqa: E402
from ephem_global import GlobalEphem  # noqa: E402
from point_engine import Engine, PRESETS  # noqa: E402

B = os.path.abspath(args.backend)
ZONES = {"nearside": "Nearside", "farside": "Farside", "north": "North Pole", "south": "South Pole"}
# zone -> (how many areas, minimum separation between them in degrees of arc)
PICK = {"nearside": (6, 28.0), "farside": (6, 28.0), "north": (4, 9.0), "south": (4, 9.0)}


def zone_of(lat, lon):
    """Same rule as the frontend (src/backend/recommend.ts)."""
    if lat > 55:
        return "north"
    if lat < -55:
        return "south"
    l = (lon + 180) % 360 - 180
    return "nearside" if abs(l) <= 90 else "farside"


def arc_deg(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(a[1] - b[1])
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def sample_grid():
    pts = []
    for lat in range(-50, 51, 10):          # mid latitudes, both hemispheres
        for lon in range(0, 360, 15):
            pts.append((float(lat), float(lon)))
    for sign in (1, -1):                    # polar caps, denser: terrain decides the light there
        for lat in range(60, 89, 4):
            for lon in range(0, 360, 20):
                pts.append((float(sign * lat), float(lon)))
    return pts


if os.path.exists(args.cache):
    with open(args.cache, encoding="utf-8") as f:
        rows = json.load(f)
    print(f"Reusing {len(rows)} sampled points from {args.cache}")
else:
    engine = Engine(
        DEMSources(south=os.path.join(B, "LRO_LOLA_DEM_SPole75_30mp_v04_EQ.tif"),
                   north=os.path.join(B, "LRO_LOLA_DEM_NPole75_30mp_v04_EQ.tif"),
                   global_=os.path.join(B, "LRO_LOLA_DEM_Global_128ppd_v04.tif")),
        GlobalEphem(os.path.join(B, "ephem_global.npz")))
    rows, t0 = [], time.time()
    grid = sample_grid()
    for i, (lat, lon) in enumerate(grid):
        try:
            r = engine.analyze_point(lat, lon, include_series=False)
        except Exception as e:  # a point no DEM covers
            print(f"  skipped {lat},{lon}: {e}")
            continue
        rows.append({"lat": lat, "lon": lon, "slope": r["slope_deg"], "alt": r["alt_m"], **r["year"]})
        if (i + 1) % 25 == 0:
            el = time.time() - t0
            print(f"  {i + 1}/{len(grid)} points ({el:.0f}s, ~{el / (i + 1) * (len(grid) - i - 1):.0f}s left)", flush=True)
    with open(args.cache, "w", encoding="utf-8") as f:
        json.dump(rows, f)

with open(os.path.join(B, "regions.json"), encoding="utf-8") as f:
    missions = json.load(f)
mission_ll = [(m["lat"], m["lon"]) for m in missions]
taken = {z: sum(1 for m in missions if zone_of(m["lat"], m["lon"]) == z) for z in ZONES}

w = PRESETS["equilibrada"]
out = []
for zone, label in ZONES.items():
    n, gap = PICK[zone]
    cand = [r for r in rows if zone_of(r["lat"], r["lon"]) == zone and r["slope"] <= args.max_slope
            and all(arc_deg((r["lat"], r["lon"]), m) >= args.mission_gap_deg for m in mission_ll)]
    for r in cand:
        # the backend's balanced weights over the whole year (the longest-sunlight term needs a mission window)
        r["score"] = w["sun"] * r["sun_pct"] + w["earth"] * r["earth_pct"] + w["both"] * r["both_pct"]
    # best yearly light first; within one point of score, the flattest ground
    cand.sort(key=lambda r: (-round(r["score"]), r["slope"]))
    chosen = []
    for r in cand:
        if len(chosen) == n:
            break
        if all(arc_deg((r["lat"], r["lon"]), (c["lat"], c["lon"])) >= gap for c in chosen):
            chosen.append(r)
    for k, r in enumerate(chosen):
        num = taken[zone] + k + 1
        out.append({
            "id": f"survey-{zone}-{num}", "name": f"{label} {num}", "lat": r["lat"], "lon": r["lon"],
            "country": "", "agency": "", "year": None, "status": "recomendada",
            "note": f"Zone survey: {r['sun_pct']}% Sun and {r['earth_pct']}% Earth over 2027, slope {r['slope']} deg.",
            "source": "Vesper zone survey (point_engine.analyze_point)", "source_url": "",
        })
        print(f"{label} {num}: {r['lat']}, {r['lon']}  sun {r['sun_pct']}%  earth {r['earth_pct']}%  slope {r['slope']}")

with open(args.out, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f"{len(out)} areas -> {args.out}")
