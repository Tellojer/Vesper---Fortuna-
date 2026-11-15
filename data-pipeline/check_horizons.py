"""
PASO 2: prueba de cordura de Horizons. Correr ANTES que todo lo demas.

Que esperamos:
  - Desde (lat 0, lon 0), el centro de la cara visible, la Tierra esta casi en el
    cenit -> elevacion de la Tierra ~ 80-90 grados.
  - Desde (lat 0, lon 90 E), el limbo este, la Tierra esta en el horizonte
    -> elevacion ~ -8..+8 grados y azimut ~ 270 (hacia el oeste).
  - Desde cerca del polo sur, el Sol siempre esta cerca del horizonte -> |el| < ~2.
Si algo de esto no se cumple, hay un problema de convencion (longitud/signos).
"""
from ephem import az_el

def stats(rows):
    els = [r["el"] for r in rows]
    azs = [r["az"] for r in rows]
    return min(els), max(els), sum(azs) / len(azs)

R = dict(start="2027-01-01", stop="2027-01-29", step="6h")

e = az_el("399", 0, 0, 0, **R)
print("Tierra desde (0,0):      el min/max = %.1f / %.1f" % stats(e)[:2])

e = az_el("399", 90, 0, 0, **R)
mn, mx, az = stats(e)
print("Tierra desde (0,90E):    el min/max = %.1f / %.1f, az promedio = %.0f" % (mn, mx, az))

s = az_el("10", 0, -89.5, 0, **R)
print("Sol desde (-89.5,0):     el min/max = %.2f / %.2f" % stats(s)[:2])

e = az_el("399", 0, -89.5, 0, **R)
print("Tierra desde (-89.5,0):  el min/max = %.2f / %.2f" % stats(e)[:2])
print("\nPrimeras filas Sol polo:", s[:3])
