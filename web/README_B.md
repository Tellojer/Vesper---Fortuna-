# Frontend — guía para B

`lib/region.js` ya hace todo el cálculo. Tú solo dibujas.
`data/` trae una región de prueba real (441 puntos, 1 año, cada hora) para empezar ya.

## Cargar
```html
<script type="module">
  import * as R from './lib/region.js';
  const index = await (await fetch('data/regions.json')).json();  // lista de regiones
  const reg = await R.loadRegion('data/' + index[0].file);
</script>
```
⚠️ Necesitas un servidor local (fetch no funciona con file://):
`python -m http.server 8000` dentro de `web/` → abre http://localhost:8000

## Lo que la app necesita, función por función

| Pantalla | Función |
|---|---|
| Fecha → índice de hora | `t0 = R.timeIndex(reg, '2027-03-12')` |
| Mapa de calor | `R.scoreGrid(reg, t0, horas, R.PRESETS.equilibrada, 10)` → arreglo de puntajes (null = descartado) en orden de cuadrícula |
| Top 3 | `R.rankPoints(reg, t0, horas, pesos, maxPendiente).slice(0, 3)` |
| Slider de retraso | volver a llamar `rankPoints` con `t0 + dias * 24` (tarda ~3 ms) |
| Gráfica polar: horizonte | `R.horizonProfile(reg, p)` → 360 elevaciones |
| Gráfica polar: trayectorias | `R.track(reg, p, t0, horas, 'sun' / 'earth', 2)` → `[{t, az, el, visible}]` |
| Línea de tiempo 3 bandas | `R.isVisible(reg, p, t, 'sun')` y `'earth'` para cada hora |
| Cuenta regresiva | `R.countdown(reg, p, t, 'sun')` → `{visible, hours}` |
| Métricas del punto | `R.windowStats(reg, p, t0, horas)` → `{sun, earth, both, longestSunHours}` |
| Clic en el mapa → punto | `R.imageToPoint(reg, x, y)` con x, y en fracción 0..1 de la imagen |
| Punto → posición en el mapa | `R.pointToImage(reg, p)` → `{x, y}` en fracción 0..1 |

## Mapa
- Fondo: `data/` + `reg.grid.image` (PNG de relieve de la región, cuadrado).
- La cuadrícula es `reg.grid.rows × reg.grid.cols`; el punto `p` está en la fila
  `Math.floor(p / cols)` y la columna `p % cols`, con la fila 0 arriba.
- Mapa de calor: dibuja un cuadrado semitransparente por punto encima de la imagen.
  Escala sugerida: 0 = transparente, 100 = color fuerte. Los `null` (pendiente
  excesiva) en gris rayado o sin color.

## Gráfica polar
- Centro = cenit (90°), borde = horizonte (0°). En el polo todo pasa cerca del
  borde, así que usa un radio **lineal en elevación de −5° a +15°**; si no, todo se
  amontona en la orilla.
- Azimut: 0 = norte arriba, 90 = este a la derecha.
- Horizonte = polígono relleno gris con `horizonProfile`.
- Sol amarillo, Tierra azul. Los puntos con `visible: false` van más tenues.

## Pesos (presets)
`R.PRESETS.equilibrada`, `R.PRESETS.solar`, `R.PRESETS.comunicacion`.
Pendiente máxima por defecto: 10° (ajustable con un slider).
