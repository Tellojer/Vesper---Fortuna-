"""Compara el % de sol de cada punto contra el mapa oficial de iluminacion promedio (LOLA/PGDA, el mismo
que muestran las capas de QuickMap). Uso: python validate_nasa.py web_data AVGVISIB_85S_060M_201608.TIF"""
import json, base64, sys, numpy as np, rasterio, warnings
warnings.filterwarnings('ignore')
from pyproj import Transformer, CRS
folder, avg = sys.argv[1], sys.argv[2]
d = rasterio.open(avg); A = d.read(1).astype(float); sc = d.scales[0] or 1
t = Transformer.from_crs(CRS.from_proj4("+proj=longlat +R=1737400 +no_defs"), CRS.from_user_input(d.crs.to_wkt()), always_xy=True)
X = []; Y = []
for r in json.load(open(f'{folder}/regions.json', encoding='utf-8')):
    R = json.load(open(f"{folder}/{r['file']}")); P = len(R['points']['lat']); T = R['times']['n']
    b = np.frombuffer(base64.b64decode(R['sun_bits_b64']), np.uint8).reshape(P, -1)
    ours = np.unpackbits(b, axis=1, bitorder='little')[:, :T].mean(1) * 100
    x, y = t.transform(np.array(R['points']['lon']), np.array(R['points']['lat']))
    rows, cols = rasterio.transform.rowcol(d.transform, x, y); rows = np.array(rows); cols = np.array(cols)
    ok = (rows >= 0) & (rows < A.shape[0]) & (cols >= 0) & (cols < A.shape[1])
    ref = np.full(P, np.nan); ref[ok] = A[rows[ok], cols[ok]] * sc * 100
    m = np.isfinite(ref) & (ref >= 0)
    if m.sum() < 10: print(f"{r['name']:24s} fuera del mapa"); continue
    print(f"{r['name']:24s} n={m.sum():3d} corr={np.corrcoef(ours[m], ref[m])[0,1]:.2f}  "
          f"media nuestra={ours[m].mean():5.1f}%  media NASA={ref[m].mean():5.1f}%")
    X += list(ours[m]); Y += list(ref[m])
print(f"TOTAL corr={np.corrcoef(X, Y)[0,1]:.3f}  n={len(X)}")
