import rasterio, numpy as np, json, warnings
warnings.filterwarnings('ignore')
from horizon_mask import DEM

ARCHIVO = 'LRO_LOLA_DEM_Global_128ppd_v04.tif'

with rasterio.open(ARCHIVO) as src:
    print('Tamaño:', src.width, 'x', src.height, '| tipo:', src.dtypes[0], '| nodata:', src.nodata)
    print('Resolución:', src.res, '| unidades CRS:', src.crs.linear_units if src.crs else None)
    print('CRS:', src.crs)
    print('Límites:', src.bounds)

dem = DEM(ARCHIVO)
dem.describe()

for r in json.load(open('regions.json')):
    h = dem.sample(np.array([r['lat']]), np.array([r['lon']]))[0]
    print(f"{r['name']:24s} altura en el DEM: {h if np.isfinite(h) else 'FUERA DEL ARCHIVO'}")