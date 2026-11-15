"""
Mascara de horizonte: para un sitio, la elevacion (grados) del terreno en cada
azimut 0..359 (0 = norte, 90 = este; misma convencion que Horizons).

Metodo: para cada azimut se "camina" sobre la esfera lunar (formula del punto
destino por rumbo y distancia), se lee la altura del DEM y se calcula el angulo
de elevacion exacto considerando la curvatura:

    el = atan2(r1*cos(d) - r0, r1*sin(d))
    r0 = R + h_sitio + h_observador,  r1 = R + h_terreno,  d = distancia/R

Caminar en lat/lon (y no en x/y del mapa) evita confusiones de orientacion
en la proyeccion polar, donde "norte" apunta distinto en cada punto.

Uso:
    from horizon_mask import DEM, horizon_mask
    dem = DEM("lola_south_pole.tif")
    h0, mask = horizon_mask(dem, lat=-89.45, lon=222.7)
"""
import numpy as np
import rasterio
from pyproj import CRS, Transformer

R_MOON = 1737400.0  # m, radio de referencia LOLA

# Proyeccion polar estereografica sur usada por LOLA/PGDA (respaldo si el
# GeoTIFF no trae CRS):
FALLBACK_SOUTH_STERE = (
    "+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"
)
MOON_LONLAT = "+proj=longlat +R=1737400 +no_defs"


class DEM:
    def __init__(self, path, height_scale=1.0, height_offset=0.0, crs_override=None):
        """
        height_scale/offset: convierte el valor del pixel a METROS relativos a
        R_MOON. Revisa con dem.describe(): en el polo sur las alturas deben
        andar aprox. entre -5000 y +3000 m. Si ves numeros como -5 a 3 son km
        -> height_scale=1000.
        """
        with rasterio.open(path) as src:
            self.z = src.read(1).astype("float64")
            nodata = src.nodata
            self.transform = src.transform
            crs = crs_override or (src.crs.to_wkt() if src.crs else FALLBACK_SOUTH_STERE)
            self.res = abs(src.transform.a)
        if nodata is not None:
            self.z[self.z == nodata] = np.nan
        self.z = self.z * height_scale + height_offset
        self.crs = CRS.from_user_input(crs)
        self.to_xy = Transformer.from_crs(CRS.from_proj4(MOON_LONLAT), self.crs, always_xy=True)
        self.inv = ~self.transform

    def describe(self):
        z = self.z[np.isfinite(self.z)]
        print(f"DEM {self.z.shape[1]}x{self.z.shape[0]} px, {self.res:.1f} m/px")
        print(f"Alturas: min {z.min():.1f}, max {z.max():.1f}, mediana {np.median(z):.1f} (deben ser metros)")
        print(f"CRS: {self.crs.name}")

    def sample(self, lat, lon):
        """Altura (m) en lat/lon (arrays). NaN fuera del DEM."""
        x, y = self.to_xy.transform(np.asarray(lon), np.asarray(lat))
        col, row = self.inv * (np.asarray(x), np.asarray(y))
        col = np.floor(col).astype(int)
        row = np.floor(row).astype(int)
        h, w = self.z.shape
        ok = (row >= 0) & (row < h) & (col >= 0) & (col < w)
        out = np.full(np.shape(col), np.nan)
        out[ok] = self.z[row[ok], col[ok]]
        return out


def _destination(lat, lon, az_deg, dist_m):
    """Punto destino sobre la esfera dado rumbo (az) y distancia."""
    p1, l1 = np.radians(lat), np.radians(lon)
    th = np.radians(az_deg)[:, None]
    d = (np.asarray(dist_m) / R_MOON)[None, :]
    p2 = np.arcsin(np.sin(p1) * np.cos(d) + np.cos(p1) * np.sin(d) * np.cos(th))
    l2 = l1 + np.arctan2(np.sin(th) * np.sin(d) * np.cos(p1),
                         np.cos(d) - np.sin(p1) * np.sin(p2))
    return np.degrees(p2), np.degrees(l2)


def horizon_mask(dem, lat, lon, max_dist_km=150.0, observer_h_m=2.0, n_az=360, min_dist_px=3):
    """
    Devuelve (h_sitio_m, mascara) donde mascara[i] = elevacion del terreno
    (grados) en el azimut i. observer_h_m = altura de los paneles/antena.

    Nota: evita lat exactamente -90 (usa -89.999); el rumbo no esta definido ahi.
    """
    lat = max(min(lat, 89.999), -89.999)
    h_site = float(dem.sample(np.array([lat]), np.array([lon]))[0])
    if not np.isfinite(h_site):
        raise ValueError(f"El sitio ({lat}, {lon}) cae fuera del DEM o en NoData")

    step = dem.res  # un paso por pixel
    # se omiten los primeros pixeles: ahi domina el ruido del DEM (la pendiente local se mide aparte)
    dists = np.arange(min_dist_px * step, max_dist_km * 1000.0, step)
    az = np.arange(n_az) * (360.0 / n_az)

    plat, plon = _destination(lat, lon, az, dists)
    h = dem.sample(plat, plon)  # (n_az, n_dist)

    r0 = R_MOON + h_site + observer_h_m
    r1 = R_MOON + h
    d = (dists / R_MOON)[None, :]
    el = np.degrees(np.arctan2(r1 * np.cos(d) - r0, r1 * np.sin(d)))

    # Horizonte geometrico de una esfera lisa (por si el DEM se acaba):
    geo = -np.degrees(np.arccos((R_MOON + h_site) / r0))
    mask = np.where(np.all(np.isnan(el), axis=1), geo, np.nanmax(el, axis=1))

    # Que tanto del rayo quedo fuera del DEM (para avisar)
    coverage = 1.0 - np.isnan(h).mean()
    if coverage < 0.9:
        print(f"  Aviso: solo {coverage:.0%} de los rayos cae dentro del DEM. "
              f"Usa un recorte mas grande o baja max_dist_km.")
    return h_site, mask


def plot_mask(mask, title="Horizonte", path=None):
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(10, 3))
    ax.fill_between(np.arange(len(mask)), -10, mask, color="#555")
    ax.set_xlim(0, 360)
    ax.set_ylim(min(-3, mask.min() - 0.5), max(5, mask.max() + 0.5))
    ax.set_xlabel("Azimut (0=N, 90=E, 180=S, 270=O)")
    ax.set_ylabel("Elevacion (grados)")
    ax.set_title(title)
    ax.axhline(0, color="k", lw=0.5)
    fig.tight_layout()
    if path:
        fig.savefig(path, dpi=120)
    else:
        plt.show()
