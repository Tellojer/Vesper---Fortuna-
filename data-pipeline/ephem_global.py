"""
Efemerides GLOBALES: con una sola consulta a Horizons por cuerpo, la direccion del Sol y la
POSICION de la Tierra cada hora, en el marco fijo a la Luna. Con eso se obtiene el az/el del
Sol y la Tierra desde CUALQUIER punto de la Luna, sin volver a consultar Horizons.

  - Sol: a 150 millones de km, su direccion es la misma desde todo el Moon (error < 0.0001 grados).
  - Tierra: a ~385 000 km hay paralaje de hasta ~0.26 grados entre un lado y otro de la Luna.
    Por eso se guarda su POSICION (direccion x distancia) y para cada sitio se resta la posicion
    del sitio.

    python ephem_global.py --start 2027-01-01 --stop 2028-01-01 --out ephem_global.npz

Uso desde Python:
    E = GlobalEphem("ephem_global.npz")
    sun_az, sun_el, earth_az, earth_el = E.azel(lat, lon, alt_m)   # arrays por hora
"""
import argparse
from datetime import datetime, timedelta

import numpy as np

from ephem import _request, _parse_time

R_MOON_KM = 1737.4
REF_LAT, REF_LON = 0.0, 0.0  # sitio de referencia: centro de la cara visible


def enu(lat, lon):
    p, l = np.radians(lat), np.radians(lon)
    E = np.stack([-np.sin(l), np.cos(l), np.zeros_like(l)], -1)
    N = np.stack([-np.sin(p) * np.cos(l), -np.sin(p) * np.sin(l), np.cos(p)], -1)
    U = np.stack([np.cos(p) * np.cos(l), np.cos(p) * np.sin(l), np.sin(p)], -1)
    return E, N, U


def _query(target, start, stop, step):
    q = lambda v: f"'{v}'"
    params = {
        "format": "json", "MAKE_EPHEM": q("YES"), "EPHEM_TYPE": q("OBSERVER"),
        "COMMAND": q(target), "CENTER": q("coord@301"), "COORD_TYPE": q("GEODETIC"),
        "SITE_COORD": q(f"{REF_LON},{REF_LAT},0"), "START_TIME": q(start), "STOP_TIME": q(stop),
        "STEP_SIZE": q(step), "QUANTITIES": q("4,20"), "CSV_FORMAT": q("YES"),
        "ANG_FORMAT": q("DEG"), "RANGE_UNITS": q("KM"),
    }
    text = _request(params)
    head, rest = text.split("$$SOE", 1)
    body = rest.split("$$EOE", 1)[0]
    cols = [c.strip() for c in [l for l in head.splitlines() if "Date" in l and "," in l][-1].split(",")]
    ia = next(i for i, c in enumerate(cols) if c.startswith("Azi"))
    ie = next(i for i, c in enumerate(cols) if c.startswith("Elev"))
    idl = cols.index("delta")
    rows = []
    for line in body.strip().splitlines():
        c = [x.strip() for x in line.split(",")]
        rows.append((_parse_time(c[0]), float(c[ia]), float(c[ie]), float(c[idl])))
    return rows


def build(start, stop, step="1h", chunk_days=60):
    t0, t1 = datetime.fromisoformat(start), datetime.fromisoformat(stop)
    out = {"10": [], "399": []}
    for target in out:
        t = t0
        while t < t1:
            te = min(t + timedelta(days=chunk_days), t1)
            part = _query(target, t.strftime("%Y-%m-%d %H:%M"), te.strftime("%Y-%m-%d %H:%M"), step)
            if out[target] and part and part[0][0] == out[target][-1][0]:
                part = part[1:]
            out[target].extend(part)
            t = te
    sun, earth = out["10"], out["399"]
    assert len(sun) == len(earth), "Sol y Tierra con distinto numero de filas"
    E, N, U = enu(np.array(REF_LAT), np.array(REF_LON))
    ref_pos = R_MOON_KM * U

    def vec(rows):
        a = np.radians([r[1] for r in rows])[:, None]
        e = np.radians([r[2] for r in rows])[:, None]
        return np.cos(e) * np.sin(a) * E + np.cos(e) * np.cos(a) * N + np.sin(e) * U

    sun_u = vec(sun)
    earth_p = ref_pos + vec(earth) * np.array([r[3] for r in earth])[:, None]
    return np.array([r[0] for r in sun]), sun_u, earth_p


class GlobalEphem:
    def __init__(self, path):
        d = np.load(path, allow_pickle=False)
        self.times = d["times"].astype(str)
        self.sun_u = d["sun_u"]
        self.earth_p = d["earth_p"]  # km, marco fijo a la Luna (centro de la Luna = origen)
        self.T = len(self.times)
        self.step_h = int(d["step_h"])

    def vectors(self, lat, lon, alt_m=0.0):
        """Vectores unitarios Sol y Tierra (T,3) vistos desde el sitio, marco fijo a la Luna."""
        _, _, U = enu(np.array(lat), np.array(lon))
        site = (R_MOON_KM + alt_m / 1000.0) * U
        e = self.earth_p - site
        e /= np.linalg.norm(e, axis=1, keepdims=True)
        return self.sun_u, e

    def azel(self, lat, lon, alt_m=0.0):
        """az/el (grados) del Sol y la Tierra cada hora desde (lat, lon)."""
        E, N, U = enu(np.array(lat), np.array(lon))
        s, e = self.vectors(lat, lon, alt_m)
        f = lambda v: ((np.degrees(np.arctan2(v @ E, v @ N)) % 360.0),
                       np.degrees(np.arcsin(np.clip(v @ U, -1, 1))))
        sa, se = f(s)
        ea, ee = f(e)
        return sa, se, ea, ee


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2027-01-01")
    ap.add_argument("--stop", default="2028-01-01")
    ap.add_argument("--step", default="1h")
    ap.add_argument("--out", default="ephem_global.npz")
    a = ap.parse_args()
    times, sun_u, earth_p = build(a.start, a.stop, a.step)
    np.savez_compressed(a.out, times=np.array(times), sun_u=sun_u, earth_p=earth_p,
                        step_h=int(a.step.rstrip("h")))
    print(f"Listo: {len(times)} horas, {times[0]} a {times[-1]} -> {a.out}")


if __name__ == "__main__":
    main()
