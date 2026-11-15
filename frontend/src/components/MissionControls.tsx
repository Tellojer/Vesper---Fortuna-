import type { CSSProperties } from 'react';
import { PRESETS } from '../backend/region';
import { PRIORITY_STEPS } from '../backend/recommend';
import { setState, useApp } from '../state/store';

/** Mission window shared by the recommendations and the site panel. */
export function useMission() {
  const t = useApp((s) => s.t);
  const n = useApp((s) => s.ephem?.n ?? 0);
  const playing = useApp((s) => s.playing);
  const days = useApp((s) => s.missionDays);
  const delay = useApp((s) => s.delayDays);
  const preset = useApp((s) => s.preset);
  const maxSlope = useApp((s) => s.maxSlope);
  // While playing, the (heavier) rankings refresh once per simulated day
  const base = playing ? Math.floor(t / 24) * 24 : t;
  const planned = Math.max(0, Math.min(Math.max(0, n - 1), base));
  const t0 = Math.max(0, Math.min(Math.max(0, n - 1), planned + delay * 24));
  return { planned, t0, hours: days * 24, days, delay, preset, maxSlope };
}

function Slider({
  label,
  value,
  min,
  max,
  display,
  onChange,
  ends,
  valueText,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  display: string;
  onChange: (v: number) => void;
  ends?: [string, string];
  valueText?: string;
}) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <output className="tabular">{display}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-valuetext={valueText ?? display}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {ends && (
        <span className="slider-ends" aria-hidden="true">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </span>
      )}
    </label>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function MissionControls({ withDelay = false }: { withDelay?: boolean }) {
  const days = useApp((s) => s.missionDays);
  const delay = useApp((s) => s.delayDays);
  const preset = useApp((s) => s.preset);
  const maxSlope = useApp((s) => s.maxSlope);
  const step = PRIORITY_STEPS.indexOf(preset);

  return (
    <div className="mission-controls">
      <Slider label="Mission duration" value={days} min={1} max={14} display={plural(days, 'day')} onChange={(v) => setState({ missionDays: v, pickedPoint: null })} />
      <Slider
        label="Priority"
        value={step}
        min={0}
        max={PRIORITY_STEPS.length - 1}
        display={PRESETS[preset].label}
        ends={['Communication', 'Solar power']}
        onChange={(v) => setState({ preset: PRIORITY_STEPS[v], pickedPoint: null })}
      />
      <Slider label="Max slope" value={maxSlope} min={2} max={25} display={`${maxSlope}°`} onChange={(v) => setState({ maxSlope: v, pickedPoint: null })} />
      {withDelay && (
        <Slider label="What if the landing slips?" value={delay} min={0} max={29} display={`+${plural(delay, 'day')}`} onChange={(v) => setState({ delayDays: v })} />
      )}
    </div>
  );
}
