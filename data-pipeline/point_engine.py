"""
Motor para CUALQUIER coordenada de la Luna, sin internet.

  analyze_point(lat, lon, ...)  -> todo lo de un punto en ~1-3 s
  analyze_area(lat, lon, ...)   -> cuadricula alrededor (mismo formato que grid_region / region.js)

Usa:
  - DEMSources (los DEM de Moon Trek, leidos por partes)
  - GlobalEphem (Sol y Tierra precalculados con Horizons para todo el periodo)
"""
import numpy as np

from dem_source import DEMSources, R_MOON
from ephem_global import GlobalEphem
from horizon_mask import _destination

SUN_R, EARTH_R = 0.267, 0.95

PRESETS = {
    "equilibrada": {"sun": 0.40, "earth": 0.25, "both": 0.15, "longestSun": 0.20},
    "solar": {"sun": 0.50, "earth": 0.10, "both": 0.10, "longestSun": 0.30},
    "comunicacion": {"sun": 0.25, "earth": 0.50, "both": 0.15, "longestSun": 0.10},
}


def _interp_horizon(mask, az):
    az = np.mod(az, 360.0)
    i0 = np.floor(az).astype(int) % 360
    f = az - np.floor(az)
    return mask[i0] * (1 - f) + mask[(i0 + 1) % 360] * f


def _longest_run(v):
    best = run = 0
    for x in v:
        run = run + 1 if x else 0
        best = max(best, run)
    return best


SOLAR_CONSTANT = 1361.0  # W/m2 a 1 UA (varia +-3.4% en el ano)


def _windows(v, t0, t1, times, step_h, limit=60):
    """Intervalos continuos de visibilidad dentro de [t0, t1): inicio, fin, horas.
    starts_before / continues_after indican si el intervalo ya venia o sigue fuera de la mision."""
    out = []
    t = t0
    while t < t1 and len(out) < limit:
        if v[t]:
            s = t
            while t < t1 and v[t]:
                t += 1
            end_idx = min(t, len(times) - 1)
            out.append({"start": str(times[s]), "end": str(times[end_idx]), "hours": (t - s) * step_h,
                        "starts_before": bool(s == t0 and s > 0 and v[s - 1]),
                        "continues_after": bool(t == t1 and t < len(v) and v[t])})
        else:
            t += 1
    return out


def _energy(sun_el, sun_vis, step_h):
    """Potencial solar en la ventana.
    - Panel vertical que gira para mirar al Sol (tipico en los polos): potencia ~ cos(elevacion)
    - Panel horizontal fijo (tipico cerca del ecuador): potencia ~ sin(elevacion)
    Indice = % de la energia de un panel ideal siempre perpendicular al Sol todo el tiempo."""
    e = np.radians(sun_el)
    v = sun_vis.astype(float)
    vert = np.cos(e) * v
    horiz = np.clip(np.sin(e), 0, None) * v
    n = max(1, len(v))
    kwh = lambda f: round(float(f.sum()) * SOLAR_CONSTANT * step_h / 1000.0, 1)
    vi, hi = float(vert.sum() / n * 100), float(horiz.sum() / n * 100)
    return {"vertical_tracking_pct": round(vi, 1), "horizontal_pct": round(hi, 1),
            "vertical_tracking_kwh_m2": kwh(vert), "horizontal_kwh_m2": kwh(horiz),
            "best_panel": "vertical" if vi >= hi else "horizontal",
            "mean_sun_el_when_visible": round(float(np.degrees(e[sun_vis]).mean()), 2) if sun_vis.any() else None,
            "note": "Energia solar incidente por m2 de panel (constante solar 1361 W/m2), sin eficiencia del panel"}


def _countdown(v, t):
    vis = bool(v[t])
    nxt = np.flatnonzero(v[t + 1:] != vis)
    return {"visible": vis, "hours": int(nxt[0] + 1) if nxt.size else None}


class Engine:
    def __init__(self, sources: DEMSources, ephem: GlobalEphem, max_dist_km=150.0, observer_h=2.0):
        self.S, self.E = sources, ephem
        self.max_dist_km, self.observer_h = max_dist_km, observer_h

    # ---------- terreno ----------
    def _pick(self, lat, lon):
        for f in self.S.order_for(lat):
            h = f.sample(np.array([lat]), np.array([lon]), lon0=lon)[0]
            if np.isfinite(h):
                return f, float(h)
        raise ValueError(f"Ningun DEM cubre ({lat}, {lon})")

    def terrain(self, lat, lon):
        """Altura, pendiente y mascara de horizonte (360 valores) del punto."""
        lat = max(min(lat, 89.999), -89.999)
        f, h0 = self._pick(lat, lon)
        res = max(60.0, f.res_m)

        # pendiente: diferencias centradas a una distancia de 1 pixel en N-S y E-O
        plat, plon = _destination(lat, lon, np.array([0.0, 90.0, 180.0, 270.0]), np.array([res]))
        hN, hE, hS, hW = f.sample(plat[:, 0], plon[:, 0], lon0=lon)
        slope = float(np.degrees(np.arctan(np.hypot((hE - hW) / (2 * res), (hN - hS) / (2 * res)))))

        # horizonte: rayos cada 1 grado, desde 3 pixeles hasta max_dist_km
        dists = np.arange(3 * res, self.max_dist_km * 1000.0, res)
        az = np.arange(360.0)
        plat, plon = _destination(lat, lon, az, dists)
        h = f.sample(plat.ravel(), plon.ravel(), lon0=lon).reshape(plat.shape)
        r0 = R_MOON + h0 + self.observer_h
        r1 = R_MOON + h
        d = (dists / R_MOON)[None, :]
        el = np.degrees(np.arctan2(r1 * np.cos(d) - r0, r1 * np.sin(d)))
        geo = -np.degrees(np.arccos(min(1.0, (R_MOON + h0) / r0)))
        mask = np.where(np.all(np.isnan(el), axis=1), geo, np.nanmax(el, axis=1))
        coverage = float(1.0 - np.isnan(h).mean())
        return {"alt_m": h0, "slope_deg": slope, "horizon": mask, "dem": f.label,
                "dem_res_m": round(f.res_m), "horizon_coverage": round(coverage, 3)}

    # ---------- punto ----------
    def analyze_point(self, lat, lon, start=None, hours=240, delay_days=0,
                      preset="equilibrada", max_slope=10.0, include_series=True):
        ter = self.terrain(lat, lon)
        sa, se, ea, ee = self.E.azel(lat, lon, ter["alt_m"] + self.observer_h)
        hz = ter["horizon"]
        s_vis = se - _interp_horizon(hz, sa) > 0
        e_vis = ee - _interp_horizon(hz, ea) > 0
        both = s_vis & e_vis
        T = self.E.T

        t0 = 0
        if start:
            key = start if "T" in start else start + "T00:00"
            try:
                t0 = int(np.flatnonzero(self.E.times == key)[0])
            except IndexError:
                raise ValueError(f"Fecha fuera de los datos ({self.E.times[0]} a {self.E.times[-1]})")
        t0 = min(T - 1, t0 + int(delay_days) * 24 // self.E.step_h)
        t1 = min(T, t0 + int(hours))
        win = slice(t0, t1)
        n = max(1, t1 - t0)
        w = PRESETS.get(preset, PRESETS["equilibrada"])
        st = {"sun": float(s_vis[win].mean()), "earth": float(e_vis[win].mean()),
              "both": float(both[win].mean())}
        longest = _longest_run(s_vis[win])
        st["longestSun"] = longest / n
        slope_ok = ter["slope_deg"] <= max_slope
        score = 100 * sum(w[k] * st[k] for k in w)

        reasons = []
        if not slope_ok:
            reasons.append(f"Pendiente de {ter['slope_deg']:.1f}°, mayor que el limite de {max_slope:g}°")
        if st["sun"] < 0.25:
            reasons.append(f"Poco Sol en la mision: {st['sun']:.0%} de las horas")
        if st["earth"] < 0.25:
            reasons.append("Casi sin contacto directo con la Tierra: necesitaria satelite de relevo"
                           if st["earth"] < 0.02 else f"Poco contacto con la Tierra: {st['earth']:.0%} de las horas")
        if longest * self.E.step_h < 48 and st["sun"] > 0:
            reasons.append(f"El periodo de Sol continuo mas largo es de solo {longest * self.E.step_h} h")
        en = _energy(se[win], s_vis[win], self.E.step_h)
        if st["sun"] > 0 and en["horizontal_pct"] < 0.25 * en["vertical_tracking_pct"]:
            reasons.append("Sol muy bajo: hacen falta paneles verticales (un panel horizontal rinde "
                           f"{en['horizontal_pct']:.0f}% contra {en['vertical_tracking_pct']:.0f}% de uno vertical)")
        verdict = ("no recomendado" if (not slope_ok or score < 30)
                   else "apto" if score >= 50 else "aceptable")

        out = {
            "lat": lat, "lon": lon % 360.0, "alt_m": round(ter["alt_m"], 1),
            "slope_deg": round(ter["slope_deg"], 2), "dem": ter["dem"], "dem_res_m": ter["dem_res_m"],
            "horizon_coverage": ter["horizon_coverage"],
            "horizon": [round(float(x), 2) for x in hz],
            "times": {"start": str(self.E.times[0]), "step_h": self.E.step_h, "n": T},
            "year": {"sun_pct": round(float(s_vis.mean()) * 100, 1),
                     "earth_pct": round(float(e_vis.mean()) * 100, 1),
                     "both_pct": round(float(both.mean()) * 100, 1)},
            "window": {
                "start": str(self.E.times[t0]), "hours": n, "t0": t0,
                "sun_pct": round(st["sun"] * 100, 1), "earth_pct": round(st["earth"] * 100, 1),
                "both_pct": round(st["both"] * 100, 1), "longest_sun_h": longest * self.E.step_h,
                "score": round(score, 1), "verdict": verdict, "reasons": reasons, "preset": preset,
                "max_slope": max_slope,
                "sun_now": {"az": round(float(sa[t0]), 2), "el": round(float(se[t0]), 2),
                            "terrain_el": round(float(_interp_horizon(hz, sa[t0:t0 + 1])[0]), 2)},
                "earth_now": {"az": round(float(ea[t0]), 2), "el": round(float(ee[t0]), 2)},
                "sun_countdown": _countdown(s_vis, t0), "earth_countdown": _countdown(e_vis, t0),
                "windows": {"sun": _windows(s_vis, t0, t1, self.E.times, self.E.step_h),
                            "earth": _windows(e_vis, t0, t1, self.E.times, self.E.step_h),
                            "both": _windows(both, t0, t1, self.E.times, self.E.step_h)},
                "energy": _energy(se[win], s_vis[win], self.E.step_h),
            },
        }
        if include_series:
            r2 = lambda a: np.round(a, 2).tolist()
            out["sun"] = {"az": r2(sa), "el": r2(se), "visible": s_vis.astype(int).tolist()}
            out["earth"] = {"az": r2(ea), "el": r2(ee), "visible": e_vis.astype(int).tolist()}
        return out

    # ---------- area ----------
    def analyze_area(self, lat, lon, radius_km=5.0, spacing_km=0.5, out_dir="cache_areas", name=None):
        """Cuadricula alrededor del punto con el mismo formato que grid_region (region.js la lee)."""
        import argparse
        import os
        from grid_region import process_region
        os.makedirs(out_dir, exist_ok=True)
        rid = f"area_{lat:.4f}_{lon % 360:.4f}_{radius_km:g}_{spacing_km:g}".replace("-", "m")
        path = os.path.join(out_dir, f"region-{rid}.json")
        if not os.path.exists(path):
            args = argparse.Namespace(radius_km=radius_km, spacing_km=spacing_km, max_dist_km=self.max_dist_km,
                                      observer_h=self.observer_h, res_m=None, out=out_dir,
                                      step_hours=self.E.step_h, gephem=self.E,
                                      start=None, stop=None, step=None)
            reg = {"id": rid, "name": name or f"Area en {lat:.3f}, {lon % 360:.3f}", "lat": lat, "lon": lon % 360,
                   "radius_km": radius_km, "spacing_km": spacing_km}
            process_region(reg, self.S, args)
        return path
