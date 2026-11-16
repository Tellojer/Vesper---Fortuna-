import { asset } from '../lib/asset';
/**
 * The Vesper mark.
 *
 * - Flare: the original image (design/brand/vesper_logo_4320.png) with the
 *   trails removed by design/tools/extract-flare.cjs. It only pulses.
 * - Trails: two comets, each on its own diagonal elliptical orbit ("/" and
 *   "\"), like an atom. Each orbit has one side in front of the flare and one
 *   behind it, so it is drawn twice: the back half under the image and the
 *   front half over it.
 *
 * viewBox centred on 0,0; the tips of the star reach ±90.
 */

const VIEWBOX = '-100 -100 200 200';

// "/" orbit: major axis pointing up and to the right. The "\" orbit is its mirror.
const ORBIT_ANGLE = -47;

/**
 * Teardrop orbit, like an orbit seen in perspective: a thin, distant tip at
 * the top (the blade of the logo) and a round, near loop at the bottom.
 * In local coordinates: u along the axis (u > 0 towards the tip);
 * v > SHIFT is the front side, which crosses the flare.
 */
const BULB = 1.6; // how much of the width gathers in the loop
const SHIFT = -14 * 0.5 ** BULB; // the front side passes through the centre
const LOOP_REACH = 0.82;
const LOOP_BEND = 0.3;
const RINGS = [
  { a: 52, b: 14, weight: 1 }, // main trail
  { a: 46, b: 10, weight: 0.55 }, // second line, as in the loop of the logo
];

function orbitPath(a: number, b: number, steps = 120) {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    let u = a * Math.cos(t);
    let v = b * Math.sin(t) * ((1 - Math.cos(t)) / 2) ** BULB + SHIFT;
    // The loop is shorter than the blade and bends towards the horizontal.
    if (u < 0) {
      u *= LOOP_REACH;
      v -= LOOP_BEND * a * (u / a) ** 2;
    }
    pts.push(`${u.toFixed(2)} ${v.toFixed(2)}`);
  }
  return `M${pts.join(' L')}Z`;
}

/**
 * Comet: stroke layers with the same head and tails that get longer, thinner
 * and fainter; stacked, they fade smoothly towards the tail.
 * Lengths in % of the perimeter (pathLength = 100). The ellipse starts at the
 * top tip, goes down the front side (0-50), turns in the loop and comes back
 * behind (50-100). At rest the head is hidden behind the flare.
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
        {/* In the orbit's local coordinates: v > SHIFT is the front side. */}
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
        <img src={asset('/brand/vesper_flare.png')} alt="" draggable={false} decoding="async" />
      </div>
      <div className="vm-core" data-part="core" />
      <Trails half="front" />
    </div>
  );
}
