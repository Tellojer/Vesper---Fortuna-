/**
 * Marca de Vesper.
 *
 * - Destello: la imagen original (design/brand/vesper_logo_4320.png) con las
 *   estelas borradas por design/tools/extract-flare.cjs. No gira, solo palpita.
 * - Estelas: dos cometas, cada uno sobre su propia órbita elíptica en diagonal
 *   ("/" y "\"), como un átomo. Cada órbita tiene un lado delante del destello
 *   y otro detrás: se dibuja dos veces, la mitad trasera bajo la imagen y la
 *   delantera encima.
 *
 * viewBox centrado en 0,0; las puntas de la estrella llegan a ±90.
 */

const VIEWBOX = '-100 -100 200 200';

// Órbita "/": eje mayor hacia arriba a la derecha. La "\" es su espejo.
const ORBIT_ANGLE = -47;

/**
 * Órbita en forma de lágrima, como una órbita vista en perspectiva: punta fina
 * y lejana arriba (el aspa del logo) y lazo redondo y cercano abajo.
 * En coordenadas locales: u a lo largo del eje (u > 0 hacia la punta),
 * v > SHIFT es el lado delantero, que cruza el destello.
 */
const BULB = 1.6; // cuánto se concentra el ancho en el lazo
const SHIFT = -14 * 0.5 ** BULB; // el lado delantero pasa por el centro
const LOOP_REACH = 0.82;
const LOOP_BEND = 0.3;
const RINGS = [
  { a: 52, b: 14, weight: 1 }, // estela principal
  { a: 46, b: 10, weight: 0.55 }, // segunda línea, como en el lazo del logo
];

function orbitPath(a: number, b: number, steps = 120) {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    let u = a * Math.cos(t);
    let v = b * Math.sin(t) * ((1 - Math.cos(t)) / 2) ** BULB + SHIFT;
    // El lazo es más corto que el aspa y se curva hacia la horizontal.
    if (u < 0) {
      u *= LOOP_REACH;
      v -= LOOP_BEND * a * (u / a) ** 2;
    }
    pts.push(`${u.toFixed(2)} ${v.toFixed(2)}`);
  }
  return `M${pts.join(' L')}Z`;
}

/**
 * Cometa: capas de trazo con la misma cabeza y colas cada vez más largas,
 * finas y tenues; al apilarse forman un desvanecido suave hacia la cola.
 * Longitudes en % del perímetro (pathLength = 100). La elipse empieza en la
 * punta de arriba, baja por el lado delantero (0-50), gira en el lazo y vuelve
 * por detrás (50-100). En reposo la cabeza queda escondida tras el destello.
 */
const COMET_HEAD = 76;
const COMET = [
  { len: 76, width: 0.9, opacity: 0.34 },
  { len: 62, width: 1.2, opacity: 0.26 },
  { len: 48, width: 1.6, opacity: 0.26 },
  { len: 34, width: 2.0, opacity: 0.3 },
  { len: 20, width: 2.3, opacity: 0.34 },
];

const PATHS = RINGS.map((r) => orbitPath(r.a, r.b));

function Orbit({ mirror, half }: { mirror: boolean; half: 'front' | 'back' }) {
  const transform = `${mirror ? 'scale(-1 1) ' : ''}rotate(${ORBIT_ANGLE})`;
  return (
    <g transform={transform}>
      <g clipPath={`url(#vm-clip-${half})`} filter={`url(#vm-glow-${half})`}>
        {RINGS.map((ring, r) =>
          COMET.map((c, i) => (
            <path
              key={`${r}-${i}`}
              data-comet=""
              d={PATHS[r]}
              pathLength={100}
              fill="none"
              stroke="var(--star-ice)"
              strokeLinecap="round"
              strokeWidth={c.width * (r === 0 ? 1 : 0.6)}
              opacity={c.opacity * ring.weight}
              strokeDasharray={`${c.len} ${100 - c.len}`}
              strokeDashoffset={-(COMET_HEAD - c.len)}
            />
          )),
        )}
      </g>
    </g>
  );
}

function Trails({ half }: { half: 'front' | 'back' }) {
  return (
    <svg className="vm-layer" viewBox={VIEWBOX} aria-hidden="true" focusable="false" data-trails={half}>
      <defs>
        {/* En coordenadas locales de la órbita: v > SHIFT es el lado delantero. */}
        <clipPath id={`vm-clip-${half}`} clipPathUnits="userSpaceOnUse">
          <rect x="-100" y={half === 'front' ? SHIFT : SHIFT - 100} width="200" height="100" />
        </clipPath>
        <filter id={`vm-glow-${half}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <Orbit mirror={false} half={half} />
      <Orbit mirror half={half} />
    </svg>
  );
}

export function VesperMark() {
  return (
    <div className="vesper-mark" aria-hidden="true">
      <Trails half="back" />
      <div className="vm-flare" data-part="star">
        <img src="/brand/vesper_flare.png" alt="" draggable={false} decoding="async" />
      </div>
      <div className="vm-core" data-part="core" />
      <Trails half="front" />
    </div>
  );
}
