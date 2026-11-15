import { useRef } from 'react';
import { VesperMark } from './VesperMark';
import './VesperBubble.css';

/**
 * Burbuja de Vesper, abajo al centro.
 * Al hacer clic:
 * - el destello (imagen original) palpita; no gira;
 * - cada estela recorre su órbita elíptica completa alrededor del destello,
 *   pasando por detrás en la mitad trasera, y vuelve a su posición;
 * - una onda sale de la burbuja y un haz sube como el del logo.
 */

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_ORBIT = 'cubic-bezier(0.65, 0, 0.35, 1)'; // easeInOutCubic (easings.net)
const PULSE_MS = 720;
const ORBIT_MS = 1500;

export function VesperBubble() {
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div className="vesper-dock" ref={rootRef}>
      <button
        type="button"
        className="vesper-bubble"
        aria-label="Vesper"
        onClick={() => rootRef.current && ignite(rootRef.current)}
      >
        <VesperMark />
      </button>
    </div>
  );
}

function ignite(root: HTMLElement) {
  const star = root.querySelector('[data-part="star"]')!;
  const core = root.querySelector('[data-part="core"]')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Movimiento reducido: solo un destello de luz, sin órbita ni escalas.
  if (reduce) {
    retarget(core, [{ opacity: 1, offset: 0.3 }, { opacity: 0 }], 480, 'ease');
    spawn(root, 'vesper-ripple', [{ opacity: 0.5 }, { opacity: 0 }], 480);
    return;
  }

  // Palpitar del destello: retoma desde el valor actual si ya estaba latiendo.
  retarget(star, [{ scale: '1.18', offset: 0.38 }, { scale: '1' }], PULSE_MS);
  retarget(core, [{ scale: '1.5', opacity: 1, offset: 0.25 }, { scale: '1', opacity: 0 }], PULSE_MS);

  // Órbita: cada capa del cometa avanza un perímetro completo (100) por su
  // elipse y termina donde empezó. Si ya está orbitando, la deja terminar.
  const comets = root.querySelectorAll<SVGPathElement>('[data-comet]');
  if (comets[0]?.getAnimations().length === 0) {
    for (const path of comets) {
      const rest = Number(path.getAttribute('stroke-dashoffset'));
      path.animate(
        [{ strokeDashoffset: rest }, { strokeDashoffset: rest - 100 }],
        { duration: ORBIT_MS, easing: EASE_ORBIT },
      );
    }
  }

  spawn(root, 'vesper-ripple', [
    { transform: 'scale(1)', opacity: 0.55 },
    { transform: 'scale(2.6)', opacity: 0 },
  ], PULSE_MS + 180);

  spawn(root, 'vesper-beam', [
    { transform: 'scaleY(0.15)', opacity: 0 },
    { transform: 'scaleY(1)', opacity: 0.9, offset: 0.22 },
    { transform: 'scaleY(1)', opacity: 0 },
  ], PULSE_MS + 280);
}

/**
 * Anima desde el valor actual (aunque haya otra animación a medias) hasta el
 * destino, y al terminar devuelve el control al CSS.
 */
function retarget(el: Element, frames: Keyframe[], duration: number, easing = EASE_OUT) {
  const style = (el as HTMLElement).style;
  const props = [...new Set(frames.flatMap((f) => Object.keys(f).filter((k) => k !== 'offset')))];
  const from: Keyframe = {};
  for (const p of props) from[p] = current(el, p);

  for (const a of el.getAnimations()) a.cancel();

  const anim = el.animate([from, ...frames], { duration, easing, fill: 'forwards' });
  anim.onfinish = () => {
    for (const p of props) style.removeProperty(p);
    anim.cancel();
  };
}

function current(el: Element, prop: string): string {
  const v = getComputedStyle(el).getPropertyValue(prop);
  if (prop === 'scale' && (v === 'none' || v === '')) return '1';
  return v;
}

/** Crea una pieza efímera (onda, haz), la anima y la retira. Varias pueden convivir. */
function spawn(root: HTMLElement, className: string, frames: Keyframe[], duration: number) {
  const el = document.createElement('span');
  el.className = className;
  el.setAttribute('aria-hidden', 'true');
  root.prepend(el);
  el.animate(frames, { duration, easing: EASE_OUT }).onfinish = () => el.remove();
}
