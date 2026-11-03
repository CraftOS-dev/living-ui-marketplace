/**
 * The pieces lessons and drills are made of: a little Markdown, a play
 * button (the guide voice sings single notes, the piano plays chords), a
 * staff picture in the singer's clef with syllables under the notes, an
 * engraved example with its words that the guide voice sings with a moving
 * highlight, answer buttons, and the Voice Dial as a still picture.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pause, Play, Volume2 } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { IconButton, Spinner, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import type { Model } from '../lib/types.ts';
import { audio } from '../music/audio.ts';
import { angleOf, noteLabel } from '../music/dial.ts';
import { onPlaying, playModel, playSeq, stopSound, toMidi } from '../music/play.ts';
import { renderSheet } from '../music/sheet.ts';
import type { SheetLayout } from '../music/sheet.ts';
import { drawMini } from '../music/staffmini.ts';
import type { MiniItem } from '../music/staffmini.ts';
import { lyricMap, melodyModel } from '../music/transpose.ts';
import { note as parseNote } from '../music/theory.ts';
import type { Sound, StaffPic } from './schema.ts';

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={i++} className="font-semibold text-[var(--sc-ink)]">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={i++} className="sc-mono rounded bg-[var(--sc-sunk)] px-1 text-[0.92em]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={i++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Paragraphs, **bold**, *italic*, `code`, and lists ("- ", "1. "). */
export function Prose({ md, className }: { md: string; className?: string }): React.JSX.Element {
  const blocks = md.trim().split(/\n\s*\n/);
  return (
    <div className={cn('flex flex-col gap-2.5 text-[14.5px] leading-[1.6] text-[var(--sc-ink-2)]', className)}>
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim() !== '');
        if (lines.every((l) => /^\s*[-*] /.test(l)))
          return (
            <ul key={i} className="flex flex-col gap-1 pl-1">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.62em] size-1 shrink-0 rounded-full bg-[var(--sc-ink-2)]" />
                  <span>{inline(l.replace(/^\s*[-*] /, ''))}</span>
                </li>
              ))}
            </ul>
          );
        if (lines.every((l) => /^\s*\d+[.)] /.test(l)))
          return (
            <ol key={i} className="flex flex-col gap-1 pl-1">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="sc-mono sc-num w-4 shrink-0 text-right text-[12px] leading-[1.95] text-[var(--sc-muted)]">{j + 1}</span>
                  <span>{inline(l.replace(/^\s*\d+[.)] /, ''))}</span>
                </li>
              ))}
            </ol>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- sound */

/** Plays a Sound; shows a pause while it plays. */
export function SoundButton({ sound, label = 'Play', size = 'md', auto }: { sound: Sound; label?: string; size?: 'sm' | 'md' | 'lg'; auto?: boolean }): React.JSX.Element {
  const [on, setOn] = useState(false);
  const mine = useRef(false);
  useEffect(
    () =>
      onPlaying((p) => {
        if (!p) {
          mine.current = false;
          setOn(false);
        }
      }),
    [],
  );
  const go = (): void => {
    if (on) {
      stopSound();
      return;
    }
    void playSeq(sound.seq, { bpm: sound.bpm ?? 80, hold: sound.hold ?? 1, voice: sound.with !== 'piano', vowel: sound.vowel ?? 'oo' });
    mine.current = true;
    setOn(true);
  };
  const key = JSON.stringify(sound);
  useEffect(() => {
    if (auto !== true || !audio.ready) return;
    const t = window.setTimeout(go, 250);
    return () => window.clearTimeout(t);
    // Plays once per new sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => void (mine.current && stopSound()), []);
  const dim = size === 'lg' ? 'size-14' : size === 'sm' ? 'size-8' : 'size-10';
  return (
    <button
      type="button"
      onClick={go}
      aria-label={on ? 'Stop' : label}
      title={on ? 'Stop' : label}
      className={cn('sc-focus relative inline-flex shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-150 hover:scale-[1.04] active:scale-95', dim, on ? 'bg-[var(--sc-raised)] text-[var(--sc-ink)] ring-1 ring-[var(--sc-line-2)]' : 'bg-[var(--sc-ink)] text-[var(--sc-page)]')}
    >
      {on && <span aria-hidden className="absolute inset-0 rounded-full" style={{ animation: 'sc-ring 1.2s ease-out infinite', border: '1.5px solid var(--sc-ink)' }} />}
      {on ? <Pause size={size === 'lg' ? 20 : 15} fill="currentColor" aria-hidden /> : size === 'sm' ? <Volume2 size={14} aria-hidden /> : <Play size={size === 'lg' ? 22 : 16} fill="currentColor" className="ml-0.5" aria-hidden />}
    </button>
  );
}

export type Tone = 'voice' | 'bad' | 'ink' | 'good';
const TONE: Record<Tone, string> = { voice: 'var(--sc-voice)', bad: 'var(--sc-bad)', ink: 'var(--sc-ink)', good: 'var(--sc-good)' };

function cssColor(v: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m === null) return v;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1] ?? '').trim() || '#2563eb';
}

function useThemeKey(): number {
  const [k, setK] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setK((x) => x + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => mo.disconnect();
  }, []);
  return k;
}

/** The clef a picture uses: its own, or (auto) the singer's. */
export function useClef(clef: StaffPic['clef']): 'treble' | 'treble8' | 'bass' {
  const app = useApp();
  if (clef !== undefined && clef !== 'auto') return clef;
  const own = app.settings?.clef ?? 'auto';
  return own !== 'auto' ? own : (app.state?.voice.clef ?? 'treble');
}

/** A staff picture in a clef, with labels above and syllables below the notes. */
export function Staff({ pic, scale = 1.15, className }: { pic: StaffPic; scale?: number; className?: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const theme = useThemeKey();
  const clef = useClef(pic.clef);
  const sig = JSON.stringify(pic);
  useLayoutEffect(() => {
    const el = host.current;
    if (el === null) return;
    const items: MiniItem[] = pic.items.map((it) => {
      const rest = typeof it.dur === 'string' && it.dur.endsWith('r');
      const out: MiniItem = { notes: rest ? [] : it.notes.map((n) => parseNote(n)) };
      if (it.dur !== undefined) out.dur = rest ? it.dur.slice(0, -1) : it.dur;
      if (it.label !== undefined) out.label = it.label;
      if (it.lyric !== undefined) out.lyric = it.lyric;
      if (it.tone !== undefined) out.color = cssColor(TONE[it.tone]);
      return out;
    });
    const opts = { clef, items, scale, ...(pic.fifths !== undefined ? { fifths: pic.fifths } : {}), ...(pic.time !== undefined ? { time: pic.time } : {}) };
    void drawMini(el, opts).catch(() => undefined);
    // Redrawn when the picture, the clef or the theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, theme, scale, clef]);
  return (
    <div className={cn('sc-scroll max-w-full overflow-x-auto', className)}>
      <div ref={host} className="mx-auto w-max text-[var(--sc-ink)]" />
    </div>
  );
}

/* --------------------------------------------------------------- score */

const parsed = new Map<string, Promise<Model>>();
export function parseAbc(abc: string): Promise<Model> {
  let p = parsed.get(abc);
  if (p === undefined) {
    p = api.parse(abc).then((r) => r.model);
    parsed.set(abc, p);
    p.catch(() => parsed.delete(abc));
  }
  return p;
}

/** An engraved example: plays with a moving highlight. */
export function Score({ abc, actions }: { abc: string; actions?: ReactNode }): React.JSX.Element {
  const clef = useClef('auto');
  const host = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [layout, setLayout] = useState<SheetLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const theme = useThemeKey();
  const raf = useRef(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    parseAbc(abc)
      .then((m) => alive && setModel(m))
      .catch((err: unknown) => alive && setError(errMessage(err)));
    return () => {
      alive = false;
    };
  }, [abc]);
  useEffect(() => {
    const el = host.current;
    if (el === null || model === null) return;
    let alive = true;
    const sub = melodyModel(model, 0, clef);
    void renderSheet(el, sub, { lyrics: lyricMap(model, 1), chords: (sub.chords ?? []).map(([t, sym], i, all) => ({ t, d: (all[i + 1]?.[0] ?? sub.total) - t, sym })) }).then((l) => {
      if (!alive) return;
      setLayout(l);
      const svg = el.querySelector('svg');
      if (svg !== null) {
        svg.setAttribute('viewBox', `0 0 ${l.width} ${l.height}`);
        svg.style.width = `${l.width * 0.9}px`;
        svg.style.height = `${l.height * 0.9}px`;
      }
    });
    return () => {
      alive = false;
    };
  }, [model, theme, clef]);
  useEffect(
    () =>
      onPlaying((p) => {
        if (!p) {
          setOn(false);
          cancelAnimationFrame(raf.current);
          for (const el of host.current?.querySelectorAll('.sc-sound-on') ?? []) el.classList.remove('sc-sound-on');
        }
      }),
    [],
  );
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = (): void => {
    if (on) {
      stopSound();
      return;
    }
    if (model === null) return;
    void playModel(model);
    setOn(true);
    const t0 = audio.now() + 0.08 + audio.outputLatency();
    const secPerQ = 60 / Math.max(10, model.tempo);
    const lit = new Set<number>();
    const tick = (): void => {
      const q = (audio.now() - t0) / secPerQ;
      const sub = melodyModel(model, 0, clef);
      sub.notes.forEach((n, i) => {
        const el = layout?.noteEls[i];
        if (el === null || el === undefined) return;
        const live = q >= n[0] && q < n[0] + n[1];
        if (live && !lit.has(i)) {
          lit.add(i);
          el.classList.add('sc-sound-on');
        } else if (!live && lit.has(i)) {
          lit.delete(i);
          el.classList.remove('sc-sound-on');
        }
      });
      if (layout !== null && box.current !== null && q >= 0) {
        const x = layout.xs.find((p) => p.q >= q)?.x ?? 0;
        const want = x * 0.9 - box.current.clientWidth * 0.35;
        if (want > box.current.scrollLeft + 40 || want < box.current.scrollLeft - 40) box.current.scrollTo({ left: Math.max(0, want), behavior: 'smooth' });
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} className="sc-scroll relative overflow-x-auto rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-raised)] py-1">
        {error !== null ? (
          <div className="px-4 py-6 text-[12.5px] text-[var(--sc-bad)]">{error}</div>
        ) : (
          <div ref={host} className="sc-score w-max px-2 text-[var(--sc-ink)]">
            {model === null && (
              <div className="flex h-[150px] w-[300px] items-center justify-center text-[var(--sc-muted)]">
                <Spinner />
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <IconButton icon={on ? Pause : Play} label={on ? 'Stop' : 'Play'} onClick={play} disabled={model === null} active={on} size={32} />
        {actions}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- choices */

/** Answer buttons: the right one turns green, a wrong pick shakes red. */
export function Options({ options, answer, chosen, onChoose, numbered }: { options: string[]; answer: number; chosen: number | null; onChoose: (k: number) => void; numbered?: boolean }): React.JSX.Element {
  const done = chosen !== null;
  const long = options.some((o) => o.length > 14);
  const letters = options.length === 7 && options.every((o) => o.length <= 2);
  return (
    <div className={cn('grid w-full gap-2', letters ? 'grid-cols-7' : long ? 'grid-cols-1 sm:grid-cols-2' : options.length <= 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3')}>
      {options.map((o, k) => {
        const right = done && k === answer;
        const wrong = done && chosen === k && k !== answer;
        return (
          <button
            key={o}
            type="button"
            disabled={done}
            onClick={() => onChoose(k)}
            className={cn(
              'sc-focus relative flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--sc-radius)] border px-3 py-2 text-[13.5px] font-medium transition-[background-color,border-color,transform,opacity] duration-150 active:scale-[0.98]',
              right ? 'border-[var(--sc-good)] bg-[var(--sc-good-soft)] text-[var(--sc-ink)]' : wrong ? 'sc-shake border-[var(--sc-bad)] bg-[var(--sc-bad-soft)]' : 'border-[var(--sc-line)] bg-[var(--sc-raised)] hover:border-[var(--sc-line-2)] hover:bg-[var(--sc-hover)]',
              done && !right && !wrong && 'opacity-50',
              letters && 'text-[16px] font-semibold',
            )}
          >
            {numbered === true && !letters && options.length <= 9 && <span className="sc-mono absolute left-2 top-1.5 text-[9.5px] text-[var(--sc-faint)]">{k + 1}</span>}
            <span className={cn(long ? 'text-left' : 'text-center', 'leading-snug')}>{o}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- the dial, still */

/** The Voice Dial as a picture: a target note at the top and marks at cents from it. */
export function DialPicture({ target, marks = [] }: { target: string; marks?: { cents: number; label?: string | undefined }[] | undefined }): React.JSX.Element {
  const W = 360;
  const H = 190;
  const cx = W / 2;
  const cy = H - 22;
  const R = 140;
  const pt = (th: number, r: number): [number, number] => [cx + r * Math.sin(th), cy - r * Math.cos(th)];
  const midi = toMidi(target);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="mx-auto block max-h-[220px] max-w-[420px]" role="img" aria-label={`The voice dial with ${noteLabel(midi)} at the top`}>
      <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" style={{ stroke: 'var(--sc-line-2)' }} />
      <line x1={cx - R - 10} x2={cx + R + 10} y1={cy + 0.5} y2={cy + 0.5} style={{ stroke: 'var(--sc-line)' }} />
      {Array.from({ length: 25 }, (_, i) => i - 12).map((k) => {
        const th = angleOf(k * 100);
        const [x0, y0] = pt(th, R - (k % 12 === 0 ? 9 : 6));
        const [x1, y1] = pt(th, R);
        return <line key={k} x1={x0} y1={y0} x2={x1} y2={y1} style={{ stroke: 'var(--sc-muted)' }} strokeWidth={1} />;
      })}
      {[-2, -1, 1, 2].map((k) => {
        const [x, y] = pt(angleOf(k * 100), R + 16);
        return (
          <text key={k} x={x} y={y + 3.5} textAnchor="middle" fontSize={10} style={{ fill: 'var(--sc-muted)', fontFamily: 'var(--sc-mono)' }}>
            {noteLabel(midi + k)}
          </text>
        );
      })}
      {[-25, 25].map((c) => {
        const [x0, y0] = pt(angleOf(c), R - 13);
        const [x1, y1] = pt(angleOf(c), R + 7);
        return <line key={c} x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={2} strokeLinecap="round" style={{ stroke: 'var(--sc-ink-2)' }} />;
      })}
      <text x={cx} y={cy - R - 14} textAnchor="middle" fontSize={12} fontWeight={600} style={{ fill: 'var(--sc-ink)', fontFamily: 'var(--sc-mono)' }}>
        {noteLabel(midi)}
      </text>
      {marks.map((m, i) => {
        const [x, y] = pt(angleOf(m.cents), R);
        const [lx, ly] = pt(angleOf(m.cents), R - 30);
        const on = Math.abs(m.cents) <= 25;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={7} style={{ fill: 'var(--sc-voice)' }} opacity={on ? 1 : 0.75} />
            <text x={lx} y={ly + 3} textAnchor="middle" fontSize={10.5} style={{ fill: 'var(--sc-ink-2)', fontFamily: 'var(--sc-mono)' }}>
              {m.label ?? (m.cents === 0 ? '0¢' : (m.cents < 0 ? '♭' : '♯') + Math.abs(m.cents) + '¢')}
            </text>
          </g>
        );
      })}
      <text x={cx - R + 4} y={cy - 8} fontSize={9.5} style={{ fill: 'var(--sc-faint)', fontFamily: 'var(--sc-mono)' }}>
        FLAT
      </text>
      <text x={cx + R - 4} y={cy - 8} textAnchor="end" fontSize={9.5} style={{ fill: 'var(--sc-faint)', fontFamily: 'var(--sc-mono)' }}>
        SHARP
      </text>
    </svg>
  );
}

/** Mark the audio as unlocked from a click inside a lesson. */
export function unlock(): void {
  audio.ensure();
}
