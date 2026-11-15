import { useMemo, type CSSProperties } from 'react';
import { CalendarDays, Pause, Play } from 'lucide-react';
import { fmtDate, fmtTime } from '../lib/format';
import { SPEEDS, getState, hourOfDate, hoursCount, msAt, setHour, setState, timeMs, useApp } from '../state/store';
import { VesperBubble } from './VesperBubble';

/** Bottom dock: timeline over the backend's date range, on both sides of the Vesper bubble. */
export function Dock() {
  return (
    <div className="dock">
      <PlayControls />
      <VesperBubble />
      <Scrubber />
    </div>
  );
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function DateField({ className }: { className?: string }) {
  const t = useApp((s) => s.t);
  const n = useApp(hoursCount);
  const ms = useApp(timeMs);
  const min = useApp((s) => (s.ephem ? isoDay(msAt(s, 0)) : ''));
  const max = useApp((s) => (s.ephem ? isoDay(msAt(s, n - 1)) : ''));
  const hourOfDay = t % 24;

  return (
    <label className={`clock ${className ?? ''}`} title="Choose a date (UTC)">
      <span className="clock-date tabular">
        <CalendarDays size={13} aria-hidden="true" />
        {n ? fmtDate(ms) : 'Loading dates…'}
        {n ? <span className="clock-time">{fmtTime(ms)}</span> : null}
      </span>
      <input
        type="date"
        className="clock-input"
        aria-label="Date (UTC)"
        min={min}
        max={max}
        value={n ? isoDay(ms) : ''}
        disabled={!n}
        onChange={(e) => {
          if (!e.target.value) return;
          setHour(hourOfDate(getState(), e.target.value) + hourOfDay);
          setState({ playing: false });
        }}
      />
    </label>
  );
}

function PlayControls() {
  const playing = useApp((s) => s.playing);
  const speedId = useApp((s) => s.speedId);
  const n = useApp(hoursCount);

  return (
    <div className="dock-pill dock-left glass">
      <button
        type="button"
        className="icon-btn play-btn"
        aria-label={playing ? 'Pause timeline' : 'Play timeline'}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        disabled={!n}
        onClick={() => {
          const s = getState();
          if (!s.playing && s.t >= hoursCount(s) - 1) setState({ t: 0 });
          setState({ playing: !s.playing });
        }}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="speed" role="radiogroup" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={speedId === s.id} className="speed-btn" onClick={() => setState({ speedId: s.id })}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

function Scrubber() {
  const t = useApp((s) => s.t);
  const n = useApp(hoursCount);
  const startMs = useApp((s) => s.ephem?.startMs ?? 0);
  const stepH = useApp((s) => s.ephem?.stepH ?? 1);
  const span = Math.max(1, n - 1);

  // Month ticks across the data range
  const ticks = useMemo(() => {
    if (!n) return [];
    const out: { pct: number; label: string }[] = [];
    const end = startMs + span * stepH * 3_600_000;
    const d = new Date(startMs);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    if (d.getTime() < startMs) d.setUTCMonth(d.getUTCMonth() + 1);
    for (; d.getTime() <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
      out.push({ pct: ((d.getTime() - startMs) / (end - startMs)) * 100, label: monthFmt.format(d) });
    }
    return out;
  }, [n, startMs, stepH, span]);

  return (
    <div className="dock-pill dock-right glass">
      <div className="scrub">
        <div className="scrub-head">
          <DateField className="scrub-date" />
        </div>
        <input
          type="range"
          className="scrub-range"
          min={0}
          max={span}
          step={1}
          value={t}
          disabled={!n}
          aria-label="Time in the backend data range"
          aria-valuetext={n ? `${fmtDate(msAt(getState(), t))} ${fmtTime(msAt(getState(), t))}` : 'Loading'}
          style={{ '--fill': `${(t / span) * 100}%` } as CSSProperties}
          onChange={(e) => setState({ t: Number(e.target.value), playing: false })}
        />
        <div className="scrub-ticks tabular" aria-hidden="true">
          {ticks.map((k) => (
            <span key={k.pct} className="scrub-tick" style={{ left: `${k.pct}%` }}>
              {k.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
