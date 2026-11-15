import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Mic, Send } from 'lucide-react';
import { ZONE_LABEL, bestSiteInZone, recoAreas } from '../backend/recommend';
import { fmtDate, fmtTime } from '../lib/format';
import { useScene } from '../scene/SceneContext';
import { getState, msAt, openSite, setState } from '../state/store';
import { parseTimeOnly, parseWhen, parseZone, type When, type Zone } from '../voice/intent';
import { VesperMark } from './VesperMark';
import { VERDICT_LABEL } from './verdict';
import './VesperBubble.css';

/**
 * Burbuja de Vesper, abajo al centro.
 * Al hacer clic:
 * - el destello (imagen original) palpita; no gira;
 * - cada estela recorre su órbita elíptica completa alrededor del destello,
 *   pasando por detrás en la mitad trasera, y vuelve a su posición;
 * - una onda sale de la burbuja y un haz sube como el del logo;
 * - se abre el asistente de voz (Vesper escucha; también se puede escribir).
 *
 * Voice assistant: the user asks for the best landing site on a day and time,
 * Vesper asks which region, and takes the view to the best recommended site
 * there. Understanding is rule-based (src/voice/intent.ts) and every figure
 * Vesper says is computed with the backend scoring.
 */

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_ORBIT = 'cubic-bezier(0.65, 0, 0.35, 1)'; // easeInOutCubic (easings.net)
const PULSE_MS = 720;
const ORBIT_MS = 1500;

type Line = { who: 'vesper' | 'you'; text: string };

// Web Speech API (Chromium, Edge, Safari); typed input covers the rest
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const recognitionCtor = () => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const ASK_WHEN = 'Tell me the day and time of the landing in 2027, for example: March 12 at 14:00.';
const ASK_ZONE = 'Which region: nearside, farside, north pole or south pole?';

export function VesperBubble() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scene = useScene();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState('');
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const openRef = useRef(false);
  const rec = useRef<Recognition | null>(null);
  const slots = useRef<{ when?: When; zone?: Zone }>({});

  const stopListening = () => {
    rec.current?.abort();
    rec.current = null;
    setListening(false);
  };

  const listen = () => {
    const Ctor = recognitionCtor();
    if (!Ctor || !openRef.current) {
      if (!Ctor) setStatus('Voice input is not available in this browser. Type your request.');
      return;
    }
    stopListening();
    window.speechSynthesis?.cancel();
    try {
      const r = new Ctor();
      r.lang = 'en-US';
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.onresult = (e) => {
        const said = e.results[0]?.[0]?.transcript?.trim();
        if (said) void handle(said);
      };
      r.onerror = (e) => {
        if (e.error === 'aborted') return;
        setStatus(
          e.error === 'no-speech'
            ? 'I didn’t hear anything. Press the microphone or type.'
            : e.error === 'not-allowed' || e.error === 'service-not-allowed'
              ? 'The microphone is blocked. Allow it in the browser, or type your request.'
              : 'Voice input failed. Type your request.',
        );
      };
      r.onend = () => {
        if (rec.current === r) {
          rec.current = null;
          setListening(false);
        }
      };
      rec.current = r;
      r.start();
      setListening(true);
      setStatus('Listening…');
    } catch {
      setListening(false);
      setStatus('Voice input failed. Type your request.');
    }
  };

  /** Vesper's turn: shown, spoken (en-US), and then it listens again if it asked something. */
  const say = (message: string, thenListen = false) => {
    setLines((l) => [...l, { who: 'vesper' as const, text: message }].slice(-6));
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      if (thenListen) listen();
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(message);
    u.lang = 'en-US';
    if (thenListen) u.onend = () => listen();
    synth.speak(u);
  };

  const handle = async (said: string) => {
    stopListening();
    setStatus('');
    setLines((l) => [...l, { who: 'you' as const, text: said }].slice(-6));
    const s = slots.current;
    const when = parseWhen(said);
    if (when) s.when = when;
    else if (s.when && !s.when.hasTime) {
      const time = parseTimeOnly(said);
      if (time) s.when = { ...s.when, ...time, hasTime: true };
    }
    s.zone = parseZone(said) ?? s.zone;

    const { ephem } = getState();
    if (!ephem) return say('The Moon data is still loading. Try again in a moment.');
    const dataYear = new Date(ephem.startMs).getUTCFullYear();
    if (s.when?.year && s.when.year !== dataYear) {
      s.when = undefined;
      return say(`My data covers ${dataYear} only. Which day and time of ${dataYear}?`, true);
    }
    if (!s.when) return say(ASK_WHEN, true);
    if (!s.zone) return say(ASK_ZONE, true);

    const { when: w, zone } = s as { when: When; zone: Zone };
    slots.current = {};
    const ms = Date.UTC(dataYear, w.month, w.day, w.hour, w.minute);
    const t = Math.round((ms - ephem.startMs) / (ephem.stepH * 3_600_000));
    if (t < 0 || t > ephem.n - 1) return say(`That date is outside my data, which covers ${dataYear}.`);

    // Move the timeline and the view first, then rank the zone with the backend scoring
    setState({ t, playing: false, navigatorOpen: true, selectedId: null, customPoint: null, customVerdict: null, pickedPoint: null });
    scene()?.setRegion(zone);
    setStatus('Ranking the landing sites…');
    const st = getState();
    const t0 = Math.min(ephem.n - 1, t + st.delayDays * 24);
    const areas = recoAreas(st.sites, st.surveySites).filter((a) => a.zone === zone);
    const best = await bestSiteInZone(areas, { t0, hours: st.missionDays * 24, preset: st.preset, maxSlope: st.maxSlope });
    setStatus('');
    const whenText = `${fmtDate(msAt(st, t0))} at ${fmtTime(msAt(st, t0))}`;
    if (!best) {
      return say(`I found no site in the ${ZONE_LABEL[zone]} with a slope under ${st.maxSlope} degrees for a landing on ${whenText}.`);
    }
    openSite(best.area.id, 'reco');
    scene()?.flyTo(best.lat, best.lon, 1.9);
    const b = best.result.best;
    say(
      `${best.area.name} is the best site in the ${ZONE_LABEL[zone]} for a ${st.missionDays}-day mission landing on ${whenText}: ` +
        `${VERDICT_LABEL[best.result.verdict].toLowerCase()}, score ${Math.round(b.score ?? 0)} out of 100, ` +
        `with the Sun visible ${Math.round(b.sun * 100)}% and Earth ${Math.round(b.earth * 100)}% of the time.`,
    );
  };

  const toggle = () => {
    const next = !openRef.current;
    openRef.current = next;
    setOpen(next);
    if (next) {
      slots.current = {};
      setLines([]);
      setStatus('');
      say('Which landing do you want to plan? Ask me for the best site on a day and time.', true);
      if (!recognitionCtor()) setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      stopListening();
      window.speechSynthesis?.cancel();
    }
  };

  useEffect(
    () => () => {
      rec.current?.abort();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const said = text.trim();
    if (!said) return;
    setText('');
    window.speechSynthesis?.cancel();
    void handle(said);
  };

  return (
    <div className="vesper-dock" ref={rootRef}>
      {open && (
        <div className="voice-panel glass" role="dialog" aria-label="Voice assistant">
          <ol className="voice-log" aria-live="polite">
            {lines.map((l, i) => (
              <li key={i} data-who={l.who}>
                <span className="voice-who">{l.who === 'vesper' ? 'Vesper' : 'You'}</span>
                {l.text}
              </li>
            ))}
          </ol>
          {status && (
            <p className="voice-status" data-listening={listening} role="status">
              {status}
            </p>
          )}
          <form className="voice-form" onSubmit={submit}>
            <input
              ref={inputRef}
              type="text"
              aria-label="Type your request"
              placeholder="Best site on March 12 at 14:00"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') toggle();
              }}
            />
            <button type="button" className="icon-btn" aria-label={listening ? 'Stop listening' : 'Listen'} aria-pressed={listening} onClick={() => (listening ? stopListening() : listen())}>
              <Mic size={16} />
            </button>
            <button type="submit" className="icon-btn" aria-label="Send request">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="vesper-bubble"
        aria-label="Vesper"
        aria-expanded={open}
        onClick={() => {
          if (rootRef.current) ignite(rootRef.current);
          toggle();
        }}
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
