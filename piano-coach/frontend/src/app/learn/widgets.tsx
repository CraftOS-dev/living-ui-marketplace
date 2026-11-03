/**
 * The pieces lessons, drills and the reference are built from: a little
 * Markdown, a playable keyboard that answers to every input (screen, computer
 * keys, MIDI, microphone), a staff, an engraved example that plays with a
 * moving highlight, and a sound button.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pause, Play, Volume2 } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { IconButton, Spinner, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import type { Model } from '../lib/types.ts';
import { audio } from '../music/audio.ts';
import { input } from '../music/input.ts';
import type { Source } from '../music/input.ts';
import { layout as keyLayout } from '../music/keys.ts';
import { onPlaying, playModel, playSeq, stopSound, toMidi } from '../music/play.ts';
import { renderSheet } from '../music/sheet.ts';
import type { SheetLayout } from '../music/sheet.ts';
import { drawMini } from '../music/staffmini.ts';
import type { MiniItem } from '../music/staffmini.ts';
import { fromMidi, name as noteName, note as parseNote } from '../music/theory.ts';
import type { KeysPic, Sound, StaffPic } from './schema.ts';

/* ------------------------------------------------------------- markdown */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={i++} className="font-semibold text-[var(--pc-ink)]">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={i++} className="pc-mono rounded bg-[var(--pc-sunk)] px-1 text-[0.92em]">{tok.slice(1, -1)}</code>);
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
    <div className={cn('flex flex-col gap-2.5 text-[14.5px] leading-[1.6] text-[var(--pc-ink-2)]', className)}>
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim() !== '');
        if (lines.every((l) => /^\s*[-*] /.test(l)))
          return (
            <ul key={i} className="flex flex-col gap-1 pl-1">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.62em] size-1 shrink-0 rounded-full bg-[var(--pc-ink-2)]" />
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
                  <span className="pc-mono pc-num w-4 shrink-0 text-right text-[12px] leading-[1.95] text-[var(--pc-muted)]">{j + 1}</span>
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
    void playSeq(sound.seq, { bpm: sound.bpm ?? 80, hold: sound.hold ?? 1 });
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
      className={cn('pc-focus relative inline-flex shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-150 hover:scale-[1.04] active:scale-95', dim, on ? 'bg-[var(--pc-raised)] text-[var(--pc-ink)] ring-1 ring-[var(--pc-line-2)]' : 'bg-[var(--pc-ink)] text-[var(--pc-page)]')}
    >
      {on && <span aria-hidden className="absolute inset-0 rounded-full" style={{ animation: 'pc-ring 1.2s ease-out infinite', border: '1.5px solid var(--pc-ink)' }} />}
      {on ? <Pause size={size === 'lg' ? 20 : 15} fill="currentColor" aria-hidden /> : size === 'sm' ? <Volume2 size={14} aria-hidden /> : <Play size={size === 'lg' ? 22 : 16} fill="currentColor" className="ml-0.5" aria-hidden />}
    </button>
  );
}

/* --------------------------------------------------------------- keys */

export type Tone = 'rh' | 'lh' | 'bad' | 'ink' | 'good';
export interface KeyMark {
  label?: string | undefined;
  tone?: Tone | undefined;
}

const TONE: Record<Tone, string> = { rh: 'var(--pc-rh)', lh: 'var(--pc-lh)', bad: 'var(--pc-bad)', ink: 'var(--pc-ink)', good: 'var(--pc-good)' };

/** The range a picture needs: whole octaves C..B around the marks, at least one octave. */
export function keysRange(pic: { from?: string | undefined; to?: string | undefined }, notes: number[]): [number, number] {
  if (pic.from !== undefined && pic.to !== undefined) return [toMidi(pic.from), toMidi(pic.to)];
  const lo = notes.length > 0 ? Math.min(...notes) : 60;
  const hi = notes.length > 0 ? Math.max(...notes) : 71;
  let a = Math.floor(lo / 12) * 12;
  let b = Math.ceil((hi + 1) / 12) * 12 - 1;
  if (b - a < 11) b = a + 11;
  if (pic.from !== undefined) a = toMidi(pic.from);
  if (pic.to !== undefined) b = toMidi(pic.to);
  return [Math.max(21, a), Math.min(108, b)];
}

/**
 * A keyboard. Marks put a coloured dot (with a label) on keys. With
 * `onNote`, it is played: pointer presses sound and every input source
 * (computer keys, MIDI, microphone) reaches `onNote`.
 */
export function MiniKeys({ from, to, marks, names, onNote, height = 116, className }: { from: number; to: number; marks?: Map<number, KeyMark>; names?: boolean | undefined; onNote?: ((midi: number, on: boolean, src: Source) => void) | undefined; height?: number; className?: string }): React.JSX.Element {
  const lay = useMemo(() => keyLayout(from, to), [from, to]);
  const [held, setHeld] = useState<Set<number>>(() => new Set());
  const pointer = useRef(new Map<number, number>());
  const cb = useRef(onNote);
  cb.current = onNote;
  const interactive = onNote !== undefined;

  useEffect(() => {
    if (!interactive) return;
    return input.on((e) => {
      setHeld((prev) => {
        const next = new Set(prev);
        if (e.on) next.add(e.note);
        else next.delete(e.note);
        return next;
      });
      cb.current?.(e.note, e.on, e.src);
    });
  }, [interactive]);
  useEffect(
    () => () => {
      for (const m of pointer.current.values()) input.screen(m, false);
    },
    [],
  );

  const keyAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const k = el?.closest<HTMLElement>('[data-mk]');
    return k === null || k === undefined ? null : Number(k.dataset['mk']);
  };
  const press = (m: number, id: number): void => {
    const prev = pointer.current.get(id);
    if (prev === m) return;
    if (prev !== undefined) input.screen(prev, false);
    pointer.current.set(id, m);
    if (interactive) input.screen(m, true);
    else audio.noteOn(m, 80);
  };
  const release = (id: number): void => {
    const prev = pointer.current.get(id);
    if (prev !== undefined) {
      if (interactive) input.screen(prev, false);
      else audio.noteOff(prev);
    }
    pointer.current.delete(id);
  };
  const minW = lay.whites * 20;

  return (
    <div className={cn('pc-scroll w-full overflow-x-auto', className)}>
      <div
        className="relative mx-auto select-none overflow-hidden rounded-[var(--pc-radius-sm)] border border-[var(--pc-line-2)] bg-[var(--pc-key-black)]"
        style={{ height, minWidth: minW, maxWidth: lay.whites * 46, touchAction: 'none' }}
        onPointerDown={(e) => {
          const m = keyAt(e.clientX, e.clientY);
          if (m === null) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          press(m, e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!pointer.current.has(e.pointerId)) return;
          const m = keyAt(e.clientX, e.clientY);
          if (m !== null) press(m, e.pointerId);
        }}
        onPointerUp={(e) => release(e.pointerId)}
        onPointerCancel={(e) => release(e.pointerId)}
      >
        {lay.keys.map((k) => {
          const mark = marks?.get(k.midi);
          const down = held.has(k.midi) || [...pointer.current.values()].includes(k.midi);
          const tone = mark?.tone;
          const label = mark?.label ?? '';
          const nm = names === true && !k.black && mark === undefined ? noteName(fromMidi(k.midi), false) : '';
          const c = k.midi % 12 === 0 && !k.black && names !== true && mark === undefined ? 'C' + (Math.floor(k.midi / 12) - 1) : '';
          return (
            <div key={k.midi} data-mk={k.midi} className={cn('pc-key', k.black ? 'black' : 'white', down && 'down')} style={{ left: `${k.x * 100}%`, width: `${k.w * 100}%`, ...(tone === 'bad' ? { background: 'color-mix(in srgb, var(--pc-bad), var(--pc-key-white) 30%)' } : {}) }}>
              {mark !== undefined && (
                <span
                  className="pc-pop pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full font-semibold text-white shadow-sm"
                  style={{ bottom: k.black ? 6 : 8, minWidth: k.black ? 14 : 18, height: k.black ? 14 : 18, padding: label.length > 2 ? '0 5px' : 0, background: TONE[tone ?? 'rh'], fontSize: label.length > 2 ? 9 : k.black ? 9 : 10.5, color: tone === 'ink' ? 'var(--pc-page)' : '#fff' }}
                >
                  {label}
                </span>
              )}
              {(nm !== '' || c !== '') && (
                <span className="pc-mono pointer-events-none absolute bottom-1.5 left-0 right-0 text-center text-[9.5px]" style={{ color: c !== '' ? '#8a959b' : '#4b565c' }}>
                  {nm || c}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A KeysPic from a lesson, drawn. */
export function KeysPicture({ pic, extra, onNote, height }: { pic: KeysPic; extra?: Map<number, KeyMark> | undefined; onNote?: ((m: number, on: boolean, src: Source) => void) | undefined; height?: number }): React.JSX.Element {
  const marks = useMemo(() => {
    const m = new Map<number, KeyMark>();
    for (const x of pic.marks) m.set(toMidi(x.note), { label: x.label, tone: x.tone ?? 'rh' });
    if (extra !== undefined) for (const [k, v] of extra) m.set(k, v);
    return m;
  }, [pic, extra]);
  const [a, b] = keysRange(pic, pic.marks.map((x) => toMidi(x.note)));
  return <MiniKeys from={a} to={b} marks={marks} names={pic.names} onNote={onNote} {...(height !== undefined ? { height } : {})} />;
}

/* --------------------------------------------------------------- staff */

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

/** A staff picture (one clef or the grand staff). */
export function Staff({ pic, scale = 1.15, className }: { pic: StaffPic; scale?: number; className?: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const theme = useThemeKey();
  const sig = JSON.stringify(pic);
  useLayoutEffect(() => {
    const el = host.current;
    if (el === null) return;
    const items: MiniItem[] = pic.items.map((it) => {
      const out: MiniItem = { notes: it.notes.map((n) => parseNote(n)) };
      if (it.dur !== undefined) out.dur = it.dur;
      if (it.label !== undefined) out.label = it.label;
      if (it.tone !== undefined) out.color = cssColor(TONE[it.tone]);
      return out;
    });
    const opts = { clef: pic.clef, items, scale, ...(pic.fifths !== undefined ? { fifths: pic.fifths } : {}), ...(pic.time !== undefined ? { time: pic.time } : {}) };
    void drawMini(el, opts).catch(() => undefined);
    // Redrawn when the picture or the theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, theme, scale]);
  return (
    <div className={cn('pc-scroll max-w-full overflow-x-auto', className)}>
      <div ref={host} className="mx-auto w-max text-[var(--pc-ink)]" />
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
    void renderSheet(el, model).then((l) => {
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
  }, [model, theme]);
  useEffect(
    () =>
      onPlaying((p) => {
        if (!p) {
          setOn(false);
          cancelAnimationFrame(raf.current);
          for (const el of host.current?.querySelectorAll('.pc-sound-on') ?? []) el.classList.remove('pc-sound-on');
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
      model.notes.forEach((n, i) => {
        const el = layout?.noteEls[i];
        if (el === null || el === undefined) return;
        const live = q >= n[0] && q < n[0] + n[1];
        if (live && !lit.has(i)) {
          lit.add(i);
          el.classList.add('pc-sound-on');
        } else if (!live && lit.has(i)) {
          lit.delete(i);
          el.classList.remove('pc-sound-on');
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
      <div ref={box} className="pc-scroll relative overflow-x-auto rounded-[var(--pc-radius)] border border-[var(--pc-line)] bg-[var(--pc-raised)] py-1">
        {error !== null ? (
          <div className="px-4 py-6 text-[12.5px] text-[var(--pc-bad)]">{error}</div>
        ) : (
          <div ref={host} className="pc-score w-max px-2 text-[var(--pc-ink)]">
            {model === null && (
              <div className="flex h-[150px] w-[300px] items-center justify-center text-[var(--pc-muted)]">
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
              'pc-focus relative flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--pc-radius)] border px-3 py-2 text-[13.5px] font-medium transition-[background-color,border-color,transform,opacity] duration-150 active:scale-[0.98]',
              right ? 'border-[var(--pc-good)] bg-[var(--pc-good-soft)] text-[var(--pc-ink)]' : wrong ? 'pc-shake border-[var(--pc-bad)] bg-[var(--pc-bad-soft)]' : 'border-[var(--pc-line)] bg-[var(--pc-raised)] hover:border-[var(--pc-line-2)] hover:bg-[var(--pc-hover)]',
              done && !right && !wrong && 'opacity-50',
              letters && 'text-[16px] font-semibold',
            )}
          >
            {numbered === true && !letters && options.length <= 9 && <span className="pc-mono absolute left-2 top-1.5 text-[9.5px] text-[var(--pc-faint)]">{k + 1}</span>}
            <span className={cn(long ? 'text-left' : 'text-center', 'leading-snug')}>{o}</span>
          </button>
        );
      })}
    </div>
  );
}
