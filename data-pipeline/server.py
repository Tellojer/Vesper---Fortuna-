"""
Servidor de Vesper: cualquier coordenada de la Luna, sin internet.
Solo usa la libreria estandar de Python + lo que ya instalaron (numpy, rasterio, pyproj).

    python server.py --dem-south "S.tif" --dem-north "N.tif" --dem-global "GLOBAL.tif"

Luego abre http://localhost:8000  (sirve tambien la carpeta ../web)

Endpoints (todos GET, respuesta JSON, con CORS abierto para el frontend 3D):
  /api/health
  /api/missions
  /api/point?lat=-89.46&lon=222.51&date=2027-03-12&days=10&delay=0&preset=equilibrada&max_slope=10&series=1
  /api/area?lat=-89.46&lon=222.51&radius_km=5&spacing_km=0.5      (tarda ~20-60 s la primera vez)
  /data/...  y  /cache/...                                           (archivos estaticos)
Detalle en API.md.
"""
import argparse
import json
import os
import threading
import time
import traceback
import warnings
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

warnings.filterwarnings("ignore")

from dem_source import DEMSources  # noqa: E402
from ephem_global import GlobalEphem  # noqa: E402
from point_engine import Engine, PRESETS  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
LOCK = threading.Lock()   # los archivos DEM (rasterio) no se comparten entre hilos
ENGINE = None
ARGS = None


def _num(q, k, default=None, cast=float):
    v = q.get(k, [None])[0]
    if v in (None, ""):
        if default is None:
            raise ValueError(f"Falta el parametro '{k}'")
        return default
    return cast(v)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ARGS.web, **kw)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if not u.path.startswith("/api/"):
            if u.path.startswith("/cache/"):
                return self._file(os.path.join(ARGS.cache, os.path.basename(u.path)))
            return super().do_GET()
        q = parse_qs(u.query)
        t = time.time()
        try:
            if u.path == "/api/health":
                return self._json({"ok": True, "dems": [f.info() for f in ENGINE.S.files.values()],
                                   "dates": [str(ENGINE.E.times[0]), str(ENGINE.E.times[-1])],
                                   "presets": list(PRESETS)})
            if u.path == "/api/missions":
                with open(os.path.join(ARGS.web, "data", "missions.json"), encoding="utf-8") as f:
                    return self._json(json.load(f))
            if u.path == "/api/point":
                lat, lon = _num(q, "lat"), _num(q, "lon")
                if not -90 <= lat <= 90:
                    raise ValueError("lat debe estar entre -90 y 90")
                with LOCK:
                    out = ENGINE.analyze_point(
                        lat, lon, start=q.get("date", [None])[0],
                        hours=int(_num(q, "days", 10)) * 24, delay_days=int(_num(q, "delay", 0)),
                        preset=q.get("preset", ["equilibrada"])[0], max_slope=_num(q, "max_slope", 10.0),
                        include_series=q.get("series", ["1"])[0] != "0")
                out["elapsed_s"] = round(time.time() - t, 2)
                return self._json(out)
            if u.path == "/api/area":
                lat, lon = _num(q, "lat"), _num(q, "lon")
                radius = min(_num(q, "radius_km", 5.0), 15.0)
                spacing = max(_num(q, "spacing_km", 0.5), 0.2)
                with LOCK:
                    path = ENGINE.analyze_area(lat, lon, radius_km=radius, spacing_km=spacing, out_dir=ARGS.cache)
                with open(path, encoding="utf-8") as f:
                    out = json.load(f)
                out["grid"]["image"] = "/cache/" + out["grid"]["image"]   # ruta servible
                out["elapsed_s"] = round(time.time() - t, 2)
                return self._json(out)
            return self._json({"error": "ruta desconocida"}, 404)
        except ValueError as e:
            return self._json({"error": str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self._json({"error": f"{type(e).__name__}: {e}"}, 500)

    def _file(self, path):
        if not os.path.isfile(path):
            return self._json({"error": "no existe"}, 404)
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "image/png" if path.endswith(".png") else "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    global ENGINE, ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem-south")
    ap.add_argument("--dem-north")
    ap.add_argument("--dem-global")
    ap.add_argument("--ephem", default=os.path.join(HERE, "ephem_global.npz"))
    ap.add_argument("--web", default=os.path.join(HERE, "..", "web"))
    ap.add_argument("--cache", default=os.path.join(HERE, "cache_areas"))
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ARGS = ap.parse_args()
    ARGS.web = os.path.abspath(ARGS.web)
    os.makedirs(ARGS.cache, exist_ok=True)

    print("Cargando DEM y efemerides...")
    S = DEMSources(south=ARGS.dem_south, north=ARGS.dem_north, global_=ARGS.dem_global)
    S.describe()
    E = GlobalEphem(ARGS.ephem)
    print(f"  Efemerides: {E.T} horas, {E.times[0]} a {E.times[-1]}")
    ENGINE = Engine(S, E)
    print(f"\nVesper listo en http://{ARGS.host}:{ARGS.port}   (Ctrl+C para detener)")
    print(f"  Prueba: http://{ARGS.host}:{ARGS.port}/api/point?lat=-89.46&lon=222.51&date=2027-03-12&series=0")
    ThreadingHTTPServer((ARGS.host, ARGS.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
