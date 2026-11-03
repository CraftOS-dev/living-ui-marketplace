/**
 * The Voice Dial in its strip: the dial in the middle, the target on the
 * left (note, syllable, frequency, bar) and the voice's numbers on the right
 * (steadiness, vibrato, loudness, breath). The page drives it from its
 * animation frame through the handle, so singing never re-renders React.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { cn } from '../../../kit/index.ts';
import { Dial, noteLabel } from '../../music/dial.ts';
import type { DialFrame, DialMode, DialTarget } from '../../music/dial.ts';
import { midiToHz } from '../../music/pitch.ts';
import { useWidth } from '../charts.tsx';

export interface DialHandle {
  push: (f: DialFrame) => void;
  target: (t: DialTarget | null, next: DialTarget | null, soon: boolean, info?: { syl?: string | undefined; bar?: number | undefined; beat?: string | undefined }) => void;
  mode: (m: DialMode) => void;
  bands: (on: number, close: number) => void;
  breath: (phase: 'inhale' | 'suspend' | 'exhale' | 'rest', p: number) => void;
  /** Draw (every frame); readouts update ten times a second. */
  draw: (now: number) => void;
  /** Seconds of the current breath (voiced time since the last gap). */
  breathTime: (s: number, of?: number) => void;
  /** Vibrato and steadiness to show. */
  vibrato: (rate: number | null, extent: number | null) => void;
  theme: () => void;
}

export const VoiceDial = forwardRef<DialHandle, { height: number; compact?: boolean; className?: string; hideSides?: boolean; mode?: DialMode }>(function VoiceDial({ height, compact, className, hideSides, mode = 'song' }, ref) {
  const [box, w] = useWidth<HTMLDivElement>();
  const sc = useRef<HTMLCanvasElement | null>(null);
  const dc = useRef<HTMLCanvasElement | null>(null);
  const dial = useRef<Dial | null>(null);
  const r = {
    target: useRef<HTMLSpanElement | null>(null),
    syl: useRef<HTMLSpanElement | null>(null),
    hz: useRef<HTMLSpanElement | null>(null),
    bar: useRef<HTMLSpanElement | null>(null),
    hub: useRef<HTMLSpanElement | null>(null),
    hubSub: useRef<HTMLSpanElement | null>(null),
    hold: useRef<HTMLSpanElement | null>(null),
    vib: useRef<HTMLSpanElement | null>(null),
    level: useRef<HTMLSpanElement | null>(null),
    meter: useRef<HTMLSpanElement | null>(null),
    breath: useRef<HTMLSpanElement | null>(null),
  };
  const last = useRef({ at: 0, midi: NaN, db: -120 });
  const vib = useRef<{ rate: number | null; extent: number | null }>({ rate: null, extent: null });
  const breathS = useRef<{ s: number; of: number }>({ s: 0, of: 0 });

  useEffect(() => {
    if (sc.current === null || dc.current === null) return;
    const d = new Dial(sc.current, dc.current);
    d.setMode(mode);
    dial.current = d;
    const obs = new MutationObserver(() => d.readTheme());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => obs.disconnect();
    // The dial lives as long as the strip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dial.current?.setMode(mode);
  }, [mode]);

  // The side readouts only when the dial keeps a usable width beside them.
  const sides = !hideSides && w - 2 * (compact === true ? 150 : 190) >= 300;
  const dialW = sides ? Math.min(w - 2 * (compact ? 150 : 190), Math.max(320, height * 2.4)) : w;
  useEffect(() => {
    dial.current?.resize(Math.max(120, dialW), height);
  }, [dialW, height]);

  const set = (el: HTMLElement | null, text: string): void => {
    if (el !== null && el.textContent !== text) el.textContent = text;
  };

  useImperativeHandle(ref, () => ({
    push(f) {
      dial.current?.push(f);
      if (f.voiced) last.current.midi = f.midi;
      last.current.db = f.db;
    },
    target(t, next, soon, info) {
      dial.current?.setTarget(t, next, soon);
      set(r.target.current, t === null ? '—' : t.name ?? noteLabel(t.midi));
      set(r.hz.current, t === null ? '' : midiToHz(t.midi).toFixed(1) + ' Hz');
      set(r.syl.current, info?.syl !== undefined && info.syl !== '' && info.syl !== '_' ? '“' + info.syl.replace(/-$/, '') + '”' : '');
      set(r.bar.current, info?.bar !== undefined ? 'Bar ' + info.bar + (info.beat !== undefined ? ' · ' + info.beat : '') : '');
    },
    mode(m) {
      dial.current?.setMode(m);
    },
    bands(on, close) {
      dial.current?.setBands(on, close);
    },
    breath(phase, p) {
      dial.current?.setBreath(phase, p);
    },
    breathTime(s, of) {
      breathS.current = { s, of: of ?? 0 };
    },
    vibrato(rate, extent) {
      vib.current = { rate, extent };
    },
    theme() {
      dial.current?.readTheme();
    },
    draw(now) {
      const d = dial.current;
      if (d === null) return;
      d.draw(now);
      if (now - last.current.at < 100) return;
      last.current.at = now;
      const ro = d.readout(last.current.midi, last.current.db);
      if (ro.voiced && ro.cents !== null) {
        set(r.hub.current, ro.note);
        set(r.hubSub.current, ro.locked ? 'on' : (ro.cents < 0 ? '♭' : ro.cents > 0 ? '♯' : '') + Math.abs(ro.cents) + '¢');
        r.hubSub.current?.setAttribute('data-locked', ro.locked ? '1' : '0');
      } else if (ro.voiced) {
        set(r.hub.current, ro.note);
        set(r.hubSub.current, '');
      } else {
        set(r.hub.current, d.mode === 'blind' ? '' : '—');
        set(r.hubSub.current, 'Listening');
        r.hubSub.current?.setAttribute('data-locked', '0');
      }
      set(r.hold.current, ro.steady !== null ? ro.steady + '¢' : '—');
      const v = vib.current;
      set(r.vib.current, v.rate !== null && v.rate > 0 ? v.rate.toFixed(1) + ' Hz ±' + Math.round(v.extent ?? 0) + '¢' : ro.voiced ? 'straight' : '—');
      set(r.level.current, ro.db > -100 ? Math.round(ro.db) + ' dB' : '—');
      const lvl = Math.max(0, Math.min(1, (ro.db + 62) / 52));
      if (r.meter.current !== null) r.meter.current.style.transform = `scaleX(${lvl.toFixed(3)})`;
      const b = breathS.current;
      set(r.breath.current, b.s > 0.2 ? b.s.toFixed(1) + (b.of > 0 ? ' of ' + Math.round(b.of) + ' s' : ' s') : '—');
    },
  }));

  return (
    <div ref={box} className={cn('relative w-full select-none', className)} style={{ height }}>
      {sides && (
        <div className="absolute left-4 top-1/2 flex -translate-y-1/2 flex-col gap-1.5" style={{ width: compact ? 130 : 170 }}>
          <span className="sc-label">Target</span>
          <span className="flex items-baseline gap-2">
            <span ref={r.target} className="sc-mono sc-num text-[26px] font-light leading-none tracking-[-0.02em]">
              —
            </span>
            <span ref={r.syl} className="truncate text-[14px] font-medium text-[var(--sc-ink-2)]" />
          </span>
          <span ref={r.hz} className="sc-mono sc-num text-[11px] text-[var(--sc-muted)]" />
          <span ref={r.bar} className="sc-mono sc-num text-[11px] text-[var(--sc-muted)]" />
        </div>
      )}
      <div className="sc-dial absolute top-0" style={{ width: Math.max(120, dialW), height, left: '50%', transform: 'translateX(-50%)' }}>
        <canvas ref={sc} className="sc-dial-static" />
        <canvas ref={dc} />
        <div className="pointer-events-none absolute bottom-[18px] left-1/2 flex -translate-x-1/2 flex-col items-center leading-none">
          <span ref={r.hub} className="sc-mono sc-num text-[20px] font-light text-[var(--sc-ink)]">
            —
          </span>
          <span ref={r.hubSub} data-locked="0" className="sc-mono sc-num mt-1 text-[11px] text-[var(--sc-muted)] data-[locked=1]:font-semibold data-[locked=1]:text-[var(--sc-voice)]">
            Listening
          </span>
        </div>
      </div>
      {sides && (
        <div className="absolute right-4 top-1/2 grid -translate-y-1/2 grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5" style={{ width: compact ? 130 : 170 }}>
          <span className="sc-label">Hold</span>
          <span ref={r.hold} className="sc-mono sc-num text-right text-[13px]">
            —
          </span>
          <span className="sc-label">Vib</span>
          <span ref={r.vib} className="sc-mono sc-num text-right text-[12px]">
            —
          </span>
          <span className="sc-label">Level</span>
          <span className="flex flex-col items-end gap-1">
            <span ref={r.level} className="sc-mono sc-num text-[13px]">
              —
            </span>
            <span className="sc-meter w-16">
              <span ref={r.meter} style={{ transform: 'scaleX(0)' }} />
            </span>
          </span>
          <span className="sc-label">Breath</span>
          <span ref={r.breath} className="sc-mono sc-num text-right text-[13px]">
            —
          </span>
        </div>
      )}
    </div>
  );
});
