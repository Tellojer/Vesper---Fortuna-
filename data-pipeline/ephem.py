"""
Posicion del Sol y la Tierra vistos desde un punto de la superficie lunar,
usando la API de JPL Horizons.

Uso rapido:
    from ephem import az_el
    sol = az_el("10", lon=0.0, lat=-89.5, alt_km=0.0,
                start="2027-01-01", stop="2027-02-01", step="1h")

- target: "10" = Sol, "399" = Tierra
- lon: longitud ESTE en grados (0..360 o -180..180)
- lat: latitud en grados (sur = negativa)
- alt_km: altura sobre la esfera de referencia (sale del DEM)

Devuelve una lista de dicts: {"t": "2027-01-01T00:00", "az": grados, "el": grados}
Azimut: 0 = norte, 90 = este (convencion Horizons).
Elevacion: respecto a una Luna lisa (SIN terreno, sin refraccion).
"""
import json
import os
import time
import hashlib
from datetime import datetime

import requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
CACHE_DIR = os.path.join(os.path.dirname(__file__), ".cache")


def _q(v):
    return f"'{v}'"


def _parse_time(s):
    s = s.strip()
    for fmt in ("%Y-%b-%d %H:%M:%S.%f", "%Y-%b-%d %H:%M:%S", "%Y-%b-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%dT%H:%M")
        except ValueError:
            pass
    raise ValueError(f"Formato de fecha inesperado: {s!r}")


def _parse(result_text):
    if "$$SOE" not in result_text:
        raise RuntimeError("Horizons no devolvio datos:\n" + result_text[:2000])
    head, rest = result_text.split("$$SOE", 1)
    body = rest.split("$$EOE", 1)[0]

    # La linea de encabezado CSV es la ultima linea no vacia antes de $$SOE
    # que contiene 'Date' (la de '*****' es separador).
    header_line = [l for l in head.splitlines() if "Date" in l and "," in l][-1]
    cols = [c.strip() for c in header_line.split(",")]
    i_az = next(i for i, c in enumerate(cols) if c.startswith("Azi"))
    i_el = next(i for i, c in enumerate(cols) if c.startswith("Elev"))

    out = []
    for line in body.strip().splitlines():
        c = [x.strip() for x in line.split(",")]
        out.append({"t": _parse_time(c[0]), "az": float(c[i_az]), "el": float(c[i_el])})
    return out


def _request(params, retries=4):
    key = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, key + ".txt")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return f.read()

    for attempt in range(retries):
        try:
            r = requests.get(API, params=params, timeout=120)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise RuntimeError(data["error"])
            text = data["result"]
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            return text
        except Exception as e:  # red inestable en el hackathon: reintentar
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f"  Horizons fallo ({e}); reintento en {wait}s...")
            time.sleep(wait)


def az_el(target, lon, lat, alt_km, start, stop, step="1h"):
    params = {
        "format": "json",
        "MAKE_EPHEM": _q("YES"),
        "EPHEM_TYPE": _q("OBSERVER"),
        "COMMAND": _q(target),
        "CENTER": _q("coord@301"),
        "COORD_TYPE": _q("GEODETIC"),
        "SITE_COORD": _q(f"{lon},{lat},{alt_km}"),
        "START_TIME": _q(start),
        "STOP_TIME": _q(stop),
        "STEP_SIZE": _q(step),
        "QUANTITIES": _q("4"),
        "CSV_FORMAT": _q("YES"),
        "ANG_FORMAT": _q("DEG"),
        "EXTRA_PREC": _q("NO"),
    }
    return _parse(_request(params))


def az_el_range(target, lon, lat, alt_km, start, stop, step="1h", chunk_days=60):
    """Igual que az_el pero partiendo rangos largos en pedazos (mas robusto)."""
    from datetime import timedelta

    t0 = datetime.fromisoformat(start)
    t1 = datetime.fromisoformat(stop)
    out = []
    while t0 < t1:
        t_end = min(t0 + timedelta(days=chunk_days), t1)
        part = az_el(target, lon, lat, alt_km,
                     t0.strftime("%Y-%m-%d %H:%M"), t_end.strftime("%Y-%m-%d %H:%M"), step)
        if out and part and part[0]["t"] == out[-1]["t"]:
            part = part[1:]  # evitar duplicar el punto de union
        out.extend(part)
        t0 = t_end
    return out
