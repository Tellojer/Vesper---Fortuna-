"""
Lectura de DEM por partes, para cualquier lugar de la Luna.

Problema: los DEM de Moon Trek son enormes (polares 45 grados a 100 m/px, global
en grados). Cargarlos completos no cabe en memoria.

Solucion: para cada region se arma un DEM LOCAL pequeno:
  - proyeccion estereografica centrada en el sitio (en metros, sin deformacion
    cerca del sitio, funciona igual en el polo que en el ecuador),
  - de +-(radio + distancia del horizonte) alrededor del sitio, a --res-m metros,
  - leyendo del archivo fuente SOLO la ventana necesaria.
  Para el DEM global en grados tambien se resuelve el cruce del meridiano 180.

El objeto que devuelve (LocalDEM) tiene la misma interfaz que horizon_mask.DEM,
asi que horizon_mask() y el resto del pipeline funcionan sin cambios.

Uso:
    sources = DEMSources(south="sur.tif", north="norte.tif", global_="global.tif")
    dem, name = sources.local_dem(lat, lon, half_extent_m=160_000, res_m=100)
"""
import numpy as np
import rasterio
from rasterio.windows import Window
from rasterio.transform import from_origin
from pyproj import CRS, Transformer

R_MOON = 1737400.0
MOON_LONLAT = "+proj=longlat +R=1737400 +no_defs"
LL = CRS.from_proj4(MOON_LONLAT)


class DEMFile:
    """Un archivo DEM abierto (sin cargarlo). Lee ventanas a demanda."""

    def __init__(self, path, label, height_scale=None):
        self.path = path
        self.label = label
        self.src = rasterio.open(path)
        if self.src.crs is None:
            raise ValueError(f"{path}: el GeoTIFF no trae proyeccion (CRS)")
        self.crs = CRS.from_user_input(self.src.crs.to_wkt())
        self.geographic = self.crs.is_geographic
        self.W, self.H = self.src.width, self.src.height
        self.tr = self.src.transform
        meta_scale = self.src.scales[0] if self.src.scales and self.src.scales[0] else 1.0
        meta_off = self.src.offsets[0] if self.src.offsets and self.src.offsets[0] else 0.0
        if height_scale is not None:
            self.scale, self.offset = height_scale, 0.0
        else:
            self.scale, self.offset = meta_scale, meta_off
        self.nodata = self.src.nodata
        if self.src.dtypes[0] == "uint8":
            raise ValueError(f"{path}: es uint8 (imagen 0-255), no alturas. "
                             "Descarga la version del DEM con alturas (int16/float32).")
        if not self.geographic:
            self.to_src = Transformer.from_crs(LL, self.crs, always_xy=True)
        else:
            self.is_global_lon = abs(self.W * self.tr.a - 360.0) < 1e-3
        # Algunos "shape maps" guardan el RADIO (~1 737 400 m) y no la altura: se detecta y corrige.
        probe = self.src.read(1, window=Window(self.W // 2 - 50, self.H // 2 - 50, 100, 100)).astype("float64")
        if self.nodata is not None:
            probe = probe[probe != self.nodata]
        med = float(np.median(probe * self.scale + self.offset)) if probe.size else 0.0
        if med > 1.0e6:
            self.offset -= R_MOON
            print(f"  {label}: los valores son radio, se resta {R_MOON:.0f} m para obtener alturas")

    def _read(self, r0, r1, c0, c1):
        """Lee filas [r0,r1) y columnas [c0,c1); columnas fuera de rango se envuelven
        (solo DEM global en grados) o quedan NaN."""
        r0c, r1c = max(r0, 0), min(r1, self.H)
        out = np.full((r1 - r0, c1 - c0), np.nan, dtype="float32")
        if r1c <= r0c:
            return out
        if self.geographic and self.is_global_lon:
            # trozos con columnas modulo W (cruce del meridiano 180)
            c = c0
            while c < c1:
                cm = c % self.W
                n = min(c1 - c, self.W - cm)
                blk = self.src.read(1, window=Window(cm, r0c, n, r1c - r0c)).astype("float32")
                out[r0c - r0:r1c - r0, c - c0:c - c0 + n] = blk
                c += n
        else:
            c0c, c1c = max(c0, 0), min(c1, self.W)
            if c1c > c0c:
                blk = self.src.read(1, window=Window(c0c, r0c, c1c - c0c, r1c - r0c)).astype("float32")
                out[r0c - r0:r1c - r0, c0c - c0:c1c - c0] = blk
        if self.nodata is not None:
            out[out == np.float32(self.nodata)] = np.nan
        return out * self.scale + self.offset

    def sample(self, lat, lon, lon0=None):
        """Altura (m) bilineal en arrays lat/lon. Lee solo la ventana necesaria."""
        lat = np.asarray(lat, dtype="float64")
        lon = np.asarray(lon, dtype="float64")
        if self.geographic:
            left = self.tr.c
            if lon0 is None:
                lon0 = float(np.nanmedian(lon))
            # longitud continua alrededor del sitio, dentro del rango del archivo
            lon0 = left + ((lon0 - left) % 360.0)
            lon_u = lon0 + ((lon - lon0 + 180.0) % 360.0 - 180.0)
            colf = (lon_u - self.tr.c) / self.tr.a
            rowf = (lat - self.tr.f) / self.tr.e
        else:
            x, y = self.to_src.transform(lon, lat)
            inv = ~self.tr
            colf, rowf = inv * (np.asarray(x), np.asarray(y))
        # bilineal sobre centros de pixel
        return self._bilinear(colf - 0.5, rowf - 0.5)

    BAND_ROWS = 256
    MAX_WINDOW_PX = 40_000_000

    def _bilinear(self, cf, rf):
        """Interpola leyendo por bandas de filas: cada banda lee solo las columnas que usa.
        Cerca del polo en un DEM en grados, una ventana unica abarcaria las 360 longitudes."""
        out = np.full(np.shape(cf), np.nan)
        rfl = np.floor(rf)
        r0 = int(np.nanmin(rfl)) - 1
        r1 = int(np.nanmax(rfl)) + 3
        c0 = int(np.floor(np.nanmin(cf))) - 1
        c1 = int(np.floor(np.nanmax(cf))) + 3
        if (r1 - r0) * (c1 - c0) <= self.MAX_WINDOW_PX:
            bands = [(r0, r1)]
        else:
            bands = [(b, min(b + self.BAND_ROWS, r1)) for b in range(r0, r1, self.BAND_ROWS)]
        for b0, b1 in bands:
            m = (rfl >= b0) & (rfl < b1) if len(bands) > 1 else np.isfinite(rfl)
            if not m.any():
                continue
            cfm, rfm = cf[m], rf[m]
            bc0 = int(np.floor(cfm.min())) - 1
            bc1 = int(np.floor(cfm.max())) + 3
            br0, br1 = b0 - 1, b1 + 2
            if (br1 - br0) * (bc1 - bc0) > 400_000_000:
                raise MemoryError("Ventana demasiado grande. Baja --max-dist-km o el radio de la region.")
            z = self._read(br0, br1, bc0, bc1)
            ci = np.clip(np.floor(cfm).astype(int) - bc0, 0, z.shape[1] - 2)
            ri = np.clip(np.floor(rfm).astype(int) - br0, 0, z.shape[0] - 2)
            fc, fr = cfm - np.floor(cfm), rfm - np.floor(rfm)
            out[m] = (z[ri, ci] * (1 - fc) * (1 - fr) + z[ri, ci + 1] * fc * (1 - fr)
                      + z[ri + 1, ci] * (1 - fc) * fr + z[ri + 1, ci + 1] * fc * fr)
        return out

    @property
    def res_m(self):
        if self.geographic:
            return abs(self.tr.a) * np.pi / 180.0 * R_MOON
        return abs(self.tr.a)

    def info(self):
        kind = "geografico (grados)" if self.geographic else "proyectado (metros)"
        return (f"{self.label}: {self.W}x{self.H} px, ~{self.res_m:.0f} m/px, {kind}, "
                f"tipo {self.src.dtypes[0]}, escala alturas x{self.scale:g}")


class LocalDEM:
    """DEM pequeno en estereografica local. Misma interfaz que horizon_mask.DEM."""

    def __init__(self, z, transform, crs, res):
        self.z = z.astype("float64")
        self.transform = transform
        self.inv = ~transform
        self.crs = crs
        self.res = res
        self.to_xy = Transformer.from_crs(LL, crs, always_xy=True)

    def describe(self):
        z = self.z[np.isfinite(self.z)]
        print(f"  DEM local {self.z.shape[1]}x{self.z.shape[0]} px a {self.res:.0f} m/px; "
              f"alturas {z.min():.0f} a {z.max():.0f} m")

    def sample(self, lat, lon):
        x, y = self.to_xy.transform(np.asarray(lon), np.asarray(lat))
        col, row = self.inv * (np.asarray(x), np.asarray(y))
        col = np.floor(col).astype(int)
        row = np.floor(row).astype(int)
        h, w = self.z.shape
        ok = (row >= 0) & (row < h) & (col >= 0) & (col < w)
        out = np.full(np.shape(col), np.nan)
        out[ok] = self.z[row[ok], col[ok]]
        return out


class DEMSources:
    """Elige el DEM segun la latitud del sitio y arma el DEM local."""

    def __init__(self, south=None, north=None, global_=None, polar_lat=60.0, height_scale=None,
                 scales=None):
        """scales: dict opcional {"south": 0.5, ...} para forzar la escala de un archivo."""
        scales = scales or {}
        self.files = {}
        for key, path, label in (("south", south, "Polo Sur"), ("north", north, "Polo Norte"),
                                 ("global", global_, "Global")):
            if path:
                self.files[key] = DEMFile(path, label, scales.get(key, height_scale))
        if not self.files:
            raise ValueError("Pasa al menos un DEM (--dem-south, --dem-north o --dem-global)")
        self.polar_lat = polar_lat
        if "global" in self.files:
            for key in ("south", "north"):
                if key in self.files and key not in scales and height_scale is None:
                    self._match_scale(self.files[key], self.files["global"], -1 if key == "south" else 1)

    @staticmethod
    def _match_scale(f, ref, sign):
        """Compara alturas contra el DEM global en varios puntos; si salen al doble
        (medios metros, comun en LOLA v4) corrige la escala del archivo."""
        lats = sign * np.array([65, 70, 75, 80, 85, 65, 70, 75, 80, 85], dtype=float)
        lons = np.array([0, 60, 120, 180, 240, 300, 30, 90, 150, 210], dtype=float)
        a = np.array([f.sample(lats[i:i+1], lons[i:i+1], lon0=lons[i])[0] for i in range(len(lats))])
        b = np.array([ref.sample(lats[i:i+1], lons[i:i+1], lon0=lons[i])[0] for i in range(len(lats))])
        ok = np.isfinite(a) & np.isfinite(b) & (np.abs(b) > 300)
        if ok.sum() < 3:
            return
        ratio = float(np.median(a[ok] / b[ok]))
        if abs(ratio - 2.0) < 0.15:
            f.scale *= 0.5; f.offset *= 0.5
            print(f"  {f.label}: alturas al doble que el global -> se multiplican por 0.5 (medios metros)")
        elif abs(ratio - 1.0) > 0.15:
            print(f"  Aviso: {f.label} da alturas {ratio:.2f} veces las del global; revisa la escala")

    def describe(self):
        for f in self.files.values():
            print("  " + f.info())

    def order_for(self, lat):
        if lat <= -self.polar_lat:
            pref = ["south", "global"]
        elif lat >= self.polar_lat:
            pref = ["north", "global"]
        else:
            pref = ["global", "south" if lat < 0 else "north"]
        return [self.files[k] for k in pref if k in self.files]

    def local_dem(self, lat, lon, half_extent_m, res_m=None):
        """res_m=None -> la resolucion nativa del DEM elegido."""
        crs = CRS.from_proj4(f"+proj=stere +lat_0={lat} +lon_0={lon} +k=1 +x_0=0 +y_0=0 "
                             f"+R={R_MOON} +units=m +no_defs")
        to_ll = Transformer.from_crs(crs, LL, always_xy=True)
        last_err = None
        for f in self.order_for(lat):
            h0 = f.sample(np.array([lat]), np.array([lon]), lon0=lon)[0]
            if not np.isfinite(h0):
                last_err = f"el sitio cae fuera de {f.label}"
                continue
            # 60 m minimo por defecto: a 30 m nativos cada region pesaria 4 veces mas
            res = res_m or max(60.0, round(f.res_m))
            n = int(np.ceil(2 * half_extent_m / res))
            half = n * res / 2
            xs = -half + (np.arange(n) + 0.5) * res
            ys = half - (np.arange(n) + 0.5) * res
            X, Y = np.meshgrid(xs, ys)
            lons, lats = to_ll.transform(X, Y)
            z = f.sample(lats, lons, lon0=lon)
            cover = float(np.isfinite(z).mean())
            if cover < 0.6:
                last_err = f"{f.label} solo cubre {cover:.0%} del area"
                continue
            if cover < 0.98:
                print(f"  Aviso: {f.label} cubre {cover:.0%} del area alrededor del sitio")
            zmax = np.nanmax(np.abs(z))
            if zmax > 12000:
                print(f"  Aviso: alturas de hasta {zmax:.0f} m; si el DEM viene en medios metros "
                      f"usa --height-scale 0.5")
            return LocalDEM(z, from_origin(-half, half, res, res), crs, res), f.label
        raise ValueError(f"No hay DEM para ({lat}, {lon}): {last_err}")
