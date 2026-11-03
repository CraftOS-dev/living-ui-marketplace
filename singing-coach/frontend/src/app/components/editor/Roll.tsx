/**
 * The song editor's canvas: bars across, pitches up, the sung notes as
 * blocks; chord symbols in a lane above, the words of every verse in lanes
 * below (the verse being edited brighter), the playhead through all of it.
 *
 *   notes   click selects (Shift or Ctrl adds), drag moves (in time on the
 *           grid, in pitch by semitones), the right edge drags the length,
 *           a drag on empty ground selects what it covers; with the pen (or
 *           a double-click) a click draws a note, a drag sets its length
 *   words   click a note's cell to type its syllable: Tab or Enter goes on
 *           to the next note (Shift+Tab back), a syllable ending in "-"
 *           joins the next one, an empty cell holds the syllable before;
 *           drag a syllable onto another note to move it there (two
 *           syllables trade places)
 *   chords  click the lane to add one on the beat (the key's chords offered),
 *           click one to change it, drag it along
 *   ruler   click or drag to put the playhead there
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../kit/index.ts';
import { barBeat, barStart, barTicks, newId, normalize, songEnd, tonicOf, TICKS } from '../../music/songdoc.ts';
import type { DocNote, SongDoc } from '../../music/songdoc.ts';
import { parseChord } from '../../music/theory.ts';
import { preview } from '../../music/editplay.ts';

export type Tool = 'select' | 'draw' | 'pan';

const GUT = 64;
const RULER = 24;
const CH = 30;
const RH = 14;
const LYR = 28;
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function pitchName(m: number): string {
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export interface RollProps {
  doc: SongDoc;
  sel: Set<number>;
  chordSel: number | null;
  verse: number;
  zoom: number;
  playhead: number;
  playing: boolean;
  tool: Tool;
  snap: number;
  len: number;
  /** Pitches shown (lowest, highest). */
  range: [number, number];
  onSelect: (ids: Set<number>) => void;
  onChordSelect: (id: number | null) => void;
  onVerse: (v: number) => void;
  onCommit: (next: SongDoc) => void;
  onPlayhead: (t: number) => void;
  /** Ask to type the syllable of a note (from the keyboard, Enter). */
  lyricTarget: number | null;
  onLyricTargetDone: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

type Drag =
  | { kind: 'move'; x0: number; y0: number; ids: number[]; dt: number; dm: number; moved: boolean; hit: number; additive: boolean }
  | { kind: 'resize'; x0: number; ids: number[]; dd: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: Set<number> }
  | { kind: 'draw'; note: DocNote }
  | { kind: 'chord'; id: number; x0: number; t0: number; dt: number; moved: boolean }
  | { kind: 'syl'; from: number; verse: number; x0: number; x: number; moved: boolean; chip: boolean }
  | { kind: 'newchord'; t: number }
  | { kind: 'ruler' };

/** The key's own chords, offered when a chord is added. */
function keyChords(doc: SongDoc): string[] {
  const names = doc.fifths < 0 ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const t = tonicOf(doc.fifths, doc.mode);
  const n = (i: number): string => names[(t + i) % 12]!;
  return doc.mode === 'minor' ? [n(0) + 'm', n(5) + 'm', n(7), n(7) + '7', n(3), n(8), n(10), n(2) + 'dim'] : [n(0), n(5), n(7), n(7) + '7', n(9) + 'm', n(2) + 'm', n(4) + 'm', n(0) + 'maj7'];
}

export function Roll(p: RollProps): React.JSX.Element {
  const { doc, zoom, range, snap } = p;
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [hover, setHover] = useState<{ t: number; midi: number } | null>(null);
  const [lyric, setLyric] = useState<{ id: number; verse: number; text: string } | null>(null);
  const [chordEdit, setChordEdit] = useState<{ id: number | null; t: number; text: string } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [lo, hi] = range;
  const rows = hi - lo + 1;
  const end = songEnd(doc) + barTicks(doc.meter);
  const W = end * zoom;
  const bt = barTicks(doc.meter);
  const beatT = (4 / doc.meter.den) * TICKS;
  const scale = useMemo(() => {
    const t = tonicOf(doc.fifths, doc.mode);
    const ivs = doc.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return new Set(ivs.map((i) => (t + i) % 12));
  }, [doc.fifths, doc.mode]);

  const setD = (d: Drag | null): void => {
    dragRef.current = d;
    setDrag(d);
  };

  // What is drawn: the song as it would be if the drag ended now.
  const shown = useMemo((): SongDoc => {
    const d = drag;
    if (d === null) return doc;
    if (d.kind === 'move' && d.moved) {
      const ids = new Set(d.ids);
      return { ...doc, notes: doc.notes.map((n) => (ids.has(n.id) ? { ...n, t: Math.max(0, n.t + d.dt), midi: n.midi + d.dm } : n)) };
    }
    if (d.kind === 'resize') {
      const ids = new Set(d.ids);
      return { ...doc, notes: doc.notes.map((n) => (ids.has(n.id) ? { ...n, d: Math.max(snap, n.d + d.dd) } : n)) };
    }
    if (d.kind === 'draw') return { ...doc, notes: [...doc.notes, d.note].sort((a, b) => a.t - b.t) };
    if (d.kind === 'chord' && d.moved) return { ...doc, chords: doc.chords.map((c) => (c.id === d.id ? { ...c, t: Math.max(0, d.t0 + d.dt) } : c)) };
    return doc;
  }, [doc, drag, snap]);

  const local = (e: { clientX: number; clientY: number }, el: HTMLElement | null): { x: number; y: number } => {
    const r = (el ?? gridRef.current)!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const snapT = (x: number): number => Math.max(0, Math.floor(x / zoom / snap) * snap);
  const midiAt = (y: number): number => Math.max(lo, Math.min(hi, hi - Math.floor(y / RH)));

  /* ------------------------------------------------------------- notes */

  const onGridDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    setLyric(null);
    setChordEdit(null);
    const { x, y } = local(e, e.currentTarget);
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-note]');
    e.currentTarget.setPointerCapture(e.pointerId);
    if (target !== null) {
      const id = Number(target.dataset['note']);
      const n = doc.notes.find((k) => k.id === id);
      if (n === undefined) return;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const edge = (e.target as HTMLElement).dataset['edge'] === '1';
      let ids = p.sel.has(id) ? [...p.sel] : [id];
      if (!p.sel.has(id)) p.onSelect(additive ? new Set([...p.sel, id]) : new Set([id]));
      if (additive && !p.sel.has(id)) ids = [...p.sel, id];
      p.onChordSelect(null);
      if (edge) setD({ kind: 'resize', x0: x, ids, dd: 0 });
      else setD({ kind: 'move', x0: x, y0: y, ids, dt: 0, dm: 0, moved: false, hit: id, additive });
      return;
    }
    p.onChordSelect(null);
    if (p.tool === 'draw') {
      const t = snapT(x);
      const note: DocNote = { id: newId(), t, d: p.len, midi: midiAt(y), syl: Array.from({ length: doc.verses }, () => ''), join: Array.from({ length: doc.verses }, () => false), breath: false, stacc: false, spoken: false, free: false };
      preview(note.midi);
      setD({ kind: 'draw', note });
      return;
    }
    setD({ kind: 'marquee', x0: x, y0: y, x1: x, y1: y, base: e.shiftKey ? new Set(p.sel) : new Set() });
  };

  const onGridMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    const { x, y } = local(e, e.currentTarget);
    if (d === null) {
      if (p.tool === 'draw' && (e.target as HTMLElement).closest('[data-note]') === null) setHover({ t: snapT(x), midi: midiAt(y) });
      else if (hover !== null) setHover(null);
      return;
    }
    if (d.kind === 'move') {
      const dt = Math.round((x - d.x0) / zoom / snap) * snap;
      const dm = -Math.round((y - d.y0) / RH);
      const moved = d.moved || Math.abs(x - d.x0) > 3 || Math.abs(y - d.y0) > 3;
      if (dm !== d.dm && moved) {
        const n = doc.notes.find((k) => k.id === d.hit);
        if (n !== undefined) preview(n.midi + dm);
      }
      setD({ ...d, dt, dm, moved });
    } else if (d.kind === 'resize') setD({ ...d, dd: Math.round((x - d.x0) / zoom / snap) * snap });
    else if (d.kind === 'marquee') setD({ ...d, x1: x, y1: y });
    else if (d.kind === 'draw') {
      const dd = Math.max(snap, Math.ceil((x / zoom - d.note.t) / snap) * snap);
      setD({ ...d, note: { ...d.note, d: Math.max(dd, x / zoom - d.note.t < snap ? p.len : snap) } });
    }
  };

  const onGridUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    setD(null);
    if (d === null) return;
    if (d.kind === 'move') {
      if (!d.moved) {
        // A plain click: this note alone (or toggled with Shift), and its pitch heard.
        const n = doc.notes.find((k) => k.id === d.hit);
        if (n !== undefined) preview(n.midi);
        if (d.additive) {
          const s = new Set(p.sel);
          if (s.has(d.hit) && p.sel.size > 0) s.delete(d.hit);
          else s.add(d.hit);
          p.onSelect(s);
        } else p.onSelect(new Set([d.hit]));
        return;
      }
      if (d.dt === 0 && d.dm === 0) return;
      const ids = new Set(d.ids);
      p.onCommit(normalize({ ...doc, notes: doc.notes.map((n) => (ids.has(n.id) ? { ...n, t: Math.max(0, n.t + d.dt), midi: n.midi + d.dm } : n)) }, ids));
    } else if (d.kind === 'resize') {
      if (d.dd === 0) return;
      const ids = new Set(d.ids);
      p.onCommit(normalize({ ...doc, notes: doc.notes.map((n) => (ids.has(n.id) ? { ...n, d: Math.max(snap, n.d + d.dd) } : n)) }, ids));
    } else if (d.kind === 'marquee') {
      const { x } = local(e, e.currentTarget);
      if (Math.abs(d.x1 - d.x0) < 4 && Math.abs(d.y1 - d.y0) < 4) {
        p.onSelect(new Set());
        p.onPlayhead(Math.max(0, Math.round(x / zoom)));
        return;
      }
      const t0 = Math.min(d.x0, d.x1) / zoom;
      const t1 = Math.max(d.x0, d.x1) / zoom;
      const m0 = midiAt(Math.max(d.y0, d.y1));
      const m1 = midiAt(Math.min(d.y0, d.y1));
      const s = new Set(d.base);
      for (const n of doc.notes) if (n.t < t1 && n.t + n.d > t0 && n.midi >= m0 && n.midi <= m1) s.add(n.id);
      p.onSelect(s);
    } else if (d.kind === 'draw') {
      p.onCommit(normalize({ ...doc, notes: [...doc.notes, d.note] }, new Set([d.note.id])));
      p.onSelect(new Set([d.note.id]));
    }
  };

  /* ------------------------------------------------------------ chords */

  const onChordDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    setLyric(null);
    const { x } = local(e, e.currentTarget);
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-chord]');
    if (chip !== null) {
      const id = Number(chip.dataset['chord']);
      const c = doc.chords.find((k) => k.id === id);
      if (c === undefined) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      p.onChordSelect(id);
      p.onSelect(new Set());
      setD({ kind: 'chord', id, x0: x, t0: c.t, dt: 0, moved: false });
      return;
    }
    if ((e.target as HTMLElement).closest('input,button') !== null) return;
    // A new chord on the beat under the pointer, asked for on release.
    const t = Math.max(0, Math.round(x / zoom / beatT) * beatT);
    p.onChordSelect(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    setD({ kind: 'newchord', t });
  };
  const onChordMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null || d.kind !== 'chord') return;
    const { x } = local(e, e.currentTarget);
    const dt = Math.round((x - d.x0) / zoom / snap) * snap;
    setD({ ...d, dt, moved: d.moved || Math.abs(x - d.x0) > 3 });
  };
  const onChordUp = (): void => {
    const d = dragRef.current;
    setD(null);
    if (d !== null && d.kind === 'newchord') {
      setChordEdit({ id: null, t: d.t, text: '' });
      return;
    }
    if (d === null || d.kind !== 'chord') return;
    const c = doc.chords.find((k) => k.id === d.id);
    if (c === undefined) return;
    if (!d.moved) {
      setChordEdit({ id: c.id, t: c.t, text: c.name });
      return;
    }
    if (d.dt === 0) return;
    const t = Math.max(0, d.t0 + d.dt);
    p.onCommit({ ...doc, chords: doc.chords.filter((k) => k.id === d.id || k.t !== t).map((k) => (k.id === d.id ? { ...k, t } : k)).sort((a, b) => a.t - b.t) });
  };
  const commitChord = (text: string): void => {
    const ce = chordEdit;
    setChordEdit(null);
    if (ce === null) return;
    const name = text.trim();
    if (name !== '' && parseChord(name) === null) return;
    if (ce.id === null) {
      if (name === '') return;
      const id = newId();
      p.onCommit({ ...doc, chords: [...doc.chords.filter((k) => k.t !== ce.t), { id, t: ce.t, name }].sort((a, b) => a.t - b.t) });
      p.onChordSelect(id);
    } else if (name === '') p.onCommit({ ...doc, chords: doc.chords.filter((k) => k.id !== ce.id) });
    else p.onCommit({ ...doc, chords: doc.chords.map((k) => (k.id === ce.id ? { ...k, name } : k)) });
  };

  /* ------------------------------------------------------------- words */

  const held = useMemo(() => {
    // Per verse and note: the note holds a syllable sung before it (no rest in between).
    return Array.from({ length: shown.verses }, (_, v) => {
      const out: boolean[] = [];
      let on = false;
      shown.notes.forEach((n, i) => {
        const prev = shown.notes[i - 1];
        if (prev !== undefined && n.t - (prev.t + prev.d) > 0) on = false;
        const s = n.syl[v] ?? '';
        out.push(s === '' && on);
        if (s !== '') on = true;
      });
      return out;
    });
  }, [shown]);

  const startLyric = (id: number, verse: number): void => {
    const n = doc.notes.find((k) => k.id === id);
    if (n === undefined) return;
    p.onVerse(verse);
    p.onSelect(new Set([id]));
    setLyric({ id, verse, text: (n.syl[verse] ?? '') + (n.join[verse] === true ? '-' : '') });
    // Bring the note into view.
    const sc = p.scrollRef.current;
    if (sc !== null) {
      const x = GUT + n.t * zoom;
      if (x < sc.scrollLeft + GUT + 40 || x > sc.scrollLeft + sc.clientWidth - 120) sc.scrollTo({ left: Math.max(0, x - sc.clientWidth / 3), behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (p.lyricTarget === null) return;
    startLyric(p.lyricTarget, Math.min(p.verse, Math.max(0, doc.verses - 1)));
    p.onLyricTargetDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.lyricTarget]);

  /** Write the syllable being typed, then go to the note `step` along (0: stay). */
  const commitLyric = (step: number, typed?: string): void => {
    const l = lyric === null ? null : typed !== undefined ? { ...lyric, text: typed } : lyric;
    if (l === null) return;
    let next = doc;
    if (next.verses <= l.verse) next = { ...next, verses: l.verse + 1, notes: next.notes.map((n) => ({ ...n, syl: [...n.syl, ...Array.from({ length: l.verse + 1 - n.syl.length }, () => '')], join: [...n.join, ...Array.from({ length: l.verse + 1 - n.join.length }, () => false)] })) };
    const raw = l.text.trim();
    const join = raw.length > 1 && raw.endsWith('-');
    const s = (join ? raw.slice(0, -1) : raw).replace(/[_*|\\]/g, '');
    const cur = next.notes.find((n) => n.id === l.id);
    if (cur !== undefined && ((cur.syl[l.verse] ?? '') !== s || (cur.join[l.verse] ?? false) !== join))
      next = { ...next, notes: next.notes.map((n) => (n.id === l.id ? { ...n, syl: n.syl.map((x, k) => (k === l.verse ? s : x)), join: n.join.map((x, k) => (k === l.verse ? join : x)) } : n)) };
    if (next !== doc) p.onCommit(next);
    const i = next.notes.findIndex((n) => n.id === l.id);
    const to = next.notes[i + step];
    if (step !== 0 && to !== undefined) {
      p.onSelect(new Set([to.id]));
      setLyric({ id: to.id, verse: l.verse, text: (to.syl[l.verse] ?? '') + (to.join[l.verse] === true ? '-' : '') });
    } else setLyric(null);
  };

  const onLyrDown = (e: React.PointerEvent<HTMLDivElement>, verse: number): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input') !== null) return;
    const { x } = local(e, e.currentTarget);
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-syl]');
    const from = chip !== null ? Number(chip.dataset['syl']) : (noteAtX(x / zoom)?.id ?? null);
    if (from === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setD({ kind: 'syl', from, verse, x0: x, x, moved: false, chip: chip !== null });
  };
  const noteAtX = (t: number): DocNote | null => {
    let best: DocNote | null = null;
    for (const n of doc.notes) if (n.t <= t + 2 && t < n.t + Math.max(n.d, 14 / zoom)) best = n;
    return best;
  };
  const onLyrMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (d === null || d.kind !== 'syl') return;
    const { x } = local(e, e.currentTarget);
    setD({ ...d, x, moved: d.moved || (d.chip && Math.abs(x - d.x0) > 4) });
  };
  const onLyrUp = (): void => {
    const d = dragRef.current;
    setD(null);
    if (d === null || d.kind !== 'syl') return;
    if (!d.moved) {
      if (lyric !== null) commitLyric(0);
      startLyric(d.from, d.verse);
      return;
    }
    const to = noteAtX(d.x / zoom);
    if (to === null || to.id === d.from) return;
    const a = doc.notes.find((n) => n.id === d.from);
    if (a === undefined) return;
    const v = d.verse;
    const sa = a.syl[v] ?? '';
    const ja = a.join[v] ?? false;
    const sb = to.syl[v] ?? '';
    const jb = to.join[v] ?? false;
    p.onCommit({
      ...doc,
      notes: doc.notes.map((n) => {
        if (n.id === a.id) return { ...n, syl: n.syl.map((x, k) => (k === v ? sb : x)), join: n.join.map((x, k) => (k === v ? jb : x)) };
        if (n.id === to.id) return { ...n, syl: n.syl.map((x, k) => (k === v ? sa : x)), join: n.join.map((x, k) => (k === v ? ja : x)) };
        return n;
      }),
    });
    p.onSelect(new Set([to.id]));
  };

  /* ------------------------------------------------------------- ruler */

  const onRulerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setD({ kind: 'ruler' });
    p.onPlayhead(Math.max(0, Math.round(local(e, e.currentTarget).x / zoom)));
  };
  const onRulerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.kind === 'ruler') p.onPlayhead(Math.max(0, Math.round(local(e, e.currentTarget).x / zoom)));
  };

  /* ------------------------------------------------------------- draw */

  const bars: { n: number; t: number }[] = [];
  for (let n = doc.pickup > 0 ? 0 : 1; ; n++) {
    const t = barStart(doc, n);
    if (t > end) break;
    bars.push({ n, t });
  }
  const beats: number[] = [];
  for (const b of bars) for (let t = b.t + beatT; t < Math.min(end, b.t + (b.n === 0 ? doc.pickup : bt)) - 1; t += beatT) beats.push(t);
  const subs: number[] = [];
  if (snap * zoom >= 9) for (let t = 0; t < end; t += snap) subs.push(t);
  const ph = p.playhead * zoom;
  const playLine = <div aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-px bg-[var(--sc-coach)]" style={{ left: ph }} />;
  const mq = drag?.kind === 'marquee' ? drag : null;
  const dragSyl = drag?.kind === 'syl' && drag.moved ? drag : null;

  return (
    <div className="relative inline-block min-w-full select-none align-top" style={{ width: GUT + W }}>
      {/* The ruler. */}
      <div data-timeline className="sticky top-0 z-30 flex border-b border-[var(--sc-line)] bg-[var(--sc-panel)]" style={{ height: RULER }}>
        <div className="sticky left-0 z-10 shrink-0 border-r border-[var(--sc-line)] bg-[var(--sc-panel)]" style={{ width: GUT }}>
          <span className="sc-label absolute bottom-1 left-2">Bar</span>
        </div>
        <div className="relative cursor-pointer" style={{ width: W }} onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={() => setD(null)} title="Click to play from here">
          {bars.map((b) => (
            <div key={b.n} className="absolute inset-y-0 border-l border-[var(--sc-line-2)]" style={{ left: b.t * zoom }}>
              <span className="sc-mono absolute left-1 top-1 text-[10.5px] text-[var(--sc-muted)]">{b.n}</span>
            </div>
          ))}
          <div aria-hidden className="pointer-events-none absolute top-0 z-20 -ml-[5px] size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-[var(--sc-coach)]" style={{ left: ph }} />
          {playLine}
        </div>
      </div>

      {/* The chords. */}
      <div data-timeline className="flex border-b border-[var(--sc-line)] bg-[var(--sc-page)]" style={{ height: CH }}>
        <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-[var(--sc-line)] bg-[var(--sc-panel)] px-2" style={{ width: GUT }}>
          <span className="sc-label">Chords</span>
        </div>
        <div className="relative cursor-copy" style={{ width: W }} onPointerDown={onChordDown} onPointerMove={onChordMove} onPointerUp={onChordUp} title="Click to add a chord on the beat">
          {bars.map((b) => (
            <div key={b.n} aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-[var(--sc-hair)]" style={{ left: b.t * zoom }} />
          ))}
          {shown.chords.map((c) =>
            chordEdit?.id === c.id ? null : (
              <div
                key={c.id}
                data-chord={c.id}
                className={cn('sc-mono absolute top-1 z-10 flex h-[22px] cursor-grab items-center rounded-[4px] border px-1.5 text-[11.5px] font-medium active:cursor-grabbing', p.chordSel === c.id ? 'border-[var(--sc-ink)] bg-[var(--sc-ink)] text-[var(--sc-page)]' : 'border-[var(--sc-line-2)] bg-[var(--sc-raised)] text-[var(--sc-ink)] hover:border-[var(--sc-ink-2)]')}
                style={{ left: c.t * zoom }}
                title={`${c.name}: drag to move, click to change`}
              >
                {c.name}
              </div>
            ),
          )}
          {chordEdit !== null && <ChordInput key={`${chordEdit.id}-${chordEdit.t}`} x={chordEdit.t * zoom} initial={chordEdit.text} offer={keyChords(doc)} onDone={commitChord} onCancel={() => setChordEdit(null)} />}
          {playLine}
        </div>
      </div>

      {/* The notes. */}
      <div className="flex">
        <div className="sticky left-0 z-10 shrink-0 border-r border-[var(--sc-line)] bg-[var(--sc-panel)]" style={{ width: GUT, height: rows * RH }}>
          {Array.from({ length: rows }, (_, i) => {
            const m = hi - i;
            const pc = ((m % 12) + 12) % 12;
            const black = [1, 3, 6, 8, 10].includes(pc);
            return (
              <div key={m} className={cn('absolute right-0 flex items-center justify-end pr-1.5 text-[9.5px]', black ? 'w-[60%] bg-[var(--sc-sunk)] text-[var(--sc-faint)]' : 'w-full text-[var(--sc-muted)]', pc === 0 && 'border-b border-[var(--sc-line-2)] font-semibold text-[var(--sc-ink-2)]')} style={{ top: i * RH, height: RH }}>
                {pc === 0 || (hover !== null && hover.midi === m) || (p.sel.size === 1 && doc.notes.find((n) => p.sel.has(n.id))?.midi === m) ? pitchName(m) : ''}
              </div>
            );
          })}
        </div>
        <div
          ref={gridRef}
          className={cn('relative', p.tool === 'draw' ? 'cursor-crosshair' : 'cursor-default')}
          style={{ width: W, height: rows * RH }}
          onPointerDown={onGridDown}
          onPointerMove={onGridMove}
          onPointerUp={onGridUp}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={(e) => {
            // A double-click on empty ground draws a note there.
            if ((e.target as HTMLElement).closest('[data-note]') !== null) return;
            const { x, y } = local(e, e.currentTarget);
            const note: DocNote = { id: newId(), t: snapT(x), d: p.len, midi: midiAt(y), syl: Array.from({ length: doc.verses }, () => ''), join: Array.from({ length: doc.verses }, () => false), breath: false, stacc: false, spoken: false, free: false };
            preview(note.midi);
            p.onCommit(normalize({ ...doc, notes: [...doc.notes, note] }, new Set([note.id])));
            p.onSelect(new Set([note.id]));
          }}
        >
          {/* Rows: the key's notes lighter, the others shaded. */}
          {Array.from({ length: rows }, (_, i) => {
            const m = hi - i;
            const pc = ((m % 12) + 12) % 12;
            return <div key={m} aria-hidden className={cn('pointer-events-none absolute inset-x-0', scale.has(pc) ? 'bg-[var(--sc-page)]' : 'bg-[var(--sc-sunk)]', pc === 0 && 'border-b border-[var(--sc-line)]')} style={{ top: i * RH, height: RH }} />;
          })}
          {subs.map((t) => (
            <div key={`s${t}`} aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-[var(--sc-hair)] opacity-50" style={{ left: t * zoom }} />
          ))}
          {beats.map((t) => (
            <div key={`b${t}`} aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-[var(--sc-hair)]" style={{ left: t * zoom }} />
          ))}
          {bars.map((b) => (
            <div key={`B${b.n}`} aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-[var(--sc-line-2)]" style={{ left: b.t * zoom }} />
          ))}
          {shown.notes.map((n) => {
            if (n.midi < lo || n.midi > hi) return null;
            const on = p.sel.has(n.id);
            const w = Math.max(4, n.d * zoom - 1);
            return (
              <div
                key={n.id}
                data-note={n.id}
                className={cn(
                  'absolute z-10 cursor-grab rounded-[3px] border active:cursor-grabbing',
                  on ? 'border-[var(--sc-ink)] bg-[var(--sc-ink)]' : n.free || n.spoken ? 'border-dashed border-[var(--sc-ink-2)] bg-[var(--sc-raised)]' : 'border-[var(--sc-ink-2)] bg-[var(--sc-raised)] hover:bg-[var(--sc-hover)]',
                )}
                style={{ left: n.t * zoom, top: (hi - n.midi) * RH + 1, width: w, height: RH - 2 }}
                title={`${pitchName(n.midi)} · bar ${barBeat(doc, n.t).bar}, beat ${Math.round(barBeat(doc, n.t).beat * 100) / 100}`}
              >
                {w > 34 && <span aria-hidden className={cn('pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-[9px] leading-none', on ? 'text-[var(--sc-page)]' : 'text-[var(--sc-faint)]')}>{pitchName(n.midi)}</span>}
                {n.breath && <span aria-hidden className={cn('absolute -left-[7px] -top-[9px] text-[10px] font-bold', on ? 'text-[var(--sc-ink)]' : 'text-[var(--sc-muted)]')}>’</span>}
                {w > 14 && <div data-note={n.id} data-edge="1" aria-hidden className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize rounded-r-[3px] hover:bg-[color-mix(in_srgb,var(--sc-coach),transparent_50%)]" />}
              </div>
            );
          })}
          {hover !== null && drag === null && <div aria-hidden className="pointer-events-none absolute z-10 rounded-[3px] border border-dashed border-[var(--sc-ink-2)] opacity-70" style={{ left: hover.t * zoom, top: (hi - hover.midi) * RH + 1, width: Math.max(4, p.len * zoom - 1), height: RH - 2 }} />}
          {mq !== null && <div aria-hidden className="pointer-events-none absolute z-20 border border-[var(--sc-coach)] bg-[color-mix(in_srgb,var(--sc-coach),transparent_88%)]" style={{ left: Math.min(mq.x0, mq.x1), top: Math.min(mq.y0, mq.y1), width: Math.abs(mq.x1 - mq.x0), height: Math.abs(mq.y1 - mq.y0) }} />}
          {playLine}
        </div>
      </div>

      {/* The words, a lane per verse. */}
      <div data-timeline className="sticky bottom-0 z-30 border-t border-[var(--sc-line)] bg-[var(--sc-panel)]">
        {Array.from({ length: Math.max(1, shown.verses) }, (_, v) => (
          <div key={v} className="flex" style={{ height: LYR }}>
            <button type="button" onClick={() => p.onVerse(v)} className={cn('sc-focus sticky left-0 z-10 flex shrink-0 cursor-pointer items-center border-r border-[var(--sc-line)] px-2 text-left', v === p.verse ? 'bg-[var(--sc-active)] text-[var(--sc-ink)]' : 'bg-[var(--sc-panel)] text-[var(--sc-muted)] hover:text-[var(--sc-ink)]')} style={{ width: GUT }} title={shown.verses === 0 ? 'No words yet: click under a note to write one' : `Verse ${v + 1}`}>
              <span className="whitespace-nowrap text-[11px] font-medium">{shown.verses === 0 ? 'Words' : `Verse ${v + 1}`}</span>
            </button>
            <div className={cn('relative cursor-text', v === p.verse ? '' : 'opacity-60')} style={{ width: W }} onPointerDown={(e) => onLyrDown(e, v)} onPointerMove={onLyrMove} onPointerUp={onLyrUp}>
              {shown.notes.map((n, i) => {
                const s = n.syl[v] ?? '';
                const isHeld = held[v]?.[i] === true;
                const w = Math.max(16, n.d * zoom - 2);
                if (lyric !== null && lyric.id === n.id && lyric.verse === v) return null;
                if (s === '' && !isHeld) return <div key={n.id} aria-hidden className={cn('absolute bottom-[5px] h-px', p.sel.has(n.id) && v === p.verse ? 'bg-[var(--sc-ink-2)]' : 'bg-transparent')} style={{ left: n.t * zoom, width: w }} />;
                if (s === '') return <div key={n.id} aria-hidden className="absolute bottom-[9px] h-px bg-[var(--sc-line-2)]" style={{ left: n.t * zoom + 2, width: w - 4 }} />;
                const moving = dragSyl !== null && dragSyl.from === n.id && dragSyl.verse === v;
                // A syllable may run on over the notes it holds, up to the next syllable (then "…").
                let room = Infinity;
                for (let j = i + 1; j < shown.notes.length; j++)
                  if ((shown.notes[j]!.syl[v] ?? '') !== '') {
                    room = (shown.notes[j]!.t - n.t) * zoom - 2;
                    break;
                  }
                return (
                  <div
                    key={n.id}
                    data-syl={n.id}
                    className={cn('absolute top-[4px] flex h-[20px] cursor-grab items-center overflow-hidden whitespace-nowrap rounded-[3px] px-1 text-[12.5px] leading-none hover:bg-[var(--sc-hover)]', p.sel.has(n.id) && v === p.verse && 'bg-[var(--sc-active)] font-medium', moving && 'opacity-30')}
                    style={{ left: n.t * zoom, maxWidth: Math.max(14, Math.min(room, Math.max(w, 160))) }}
                    title={`${s}${n.join[v] === true ? '-' : ''}: click to change, drag onto another note to move`}
                  >
                    <span className="truncate">{s}</span>
                    {n.join[v] === true && <span className="text-[var(--sc-muted)]">-</span>}
                  </div>
                );
              })}
              {dragSyl !== null && dragSyl.verse === v && (
                <div aria-hidden className="pointer-events-none absolute top-[3px] z-20 rounded-[3px] border border-[var(--sc-ink)] bg-[var(--sc-raised)] px-1 text-[12.5px] shadow-[var(--sc-shadow)]" style={{ left: dragSyl.x - 10 }}>
                  {doc.notes.find((n) => n.id === dragSyl.from)?.syl[v] ?? ''}
                </div>
              )}
              {lyric !== null && lyric.verse === v && (
                <LyricInput
                  key={lyric.id}
                  x={(doc.notes.find((n) => n.id === lyric.id)?.t ?? 0) * zoom}
                  value={lyric.text}
                  onChange={(text) => setLyric({ ...lyric, text })}
                  onCommit={commitLyric}
                  onCancel={() => setLyric(null)}
                />
              )}
              {playLine}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LyricInput({ x, value, onChange, onCommit, onCancel }: { x: number; value: string; onChange: (v: string) => void; onCommit: (step: number, typed?: string) => void; onCancel: () => void }): React.JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Syllable"
      onChange={(e) => {
        const v = e.target.value;
        // A hyphen typed at the end joins the next syllable and moves on.
        if (v.length > 1 && v.endsWith('-') && !value.endsWith('-') && !(e.nativeEvent as InputEvent).isComposing) {
          onChange(v);
          onCommit(1, v);
          return;
        }
        onChange(v);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          onCommit(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
        e.stopPropagation();
      }}
      onBlur={() => onCommit(0)}
      className="sc-focus absolute top-[2px] z-30 h-[24px] w-[96px] rounded-[4px] border border-[var(--sc-ink)] bg-[var(--sc-raised)] px-1.5 text-[12.5px] outline-none"
      style={{ left: x }}
    />
  );
}

function ChordInput({ x, initial, offer, onDone, onCancel }: { x: number; initial: string; offer: string[]; onDone: (v: string) => void; onCancel: () => void }): React.JSX.Element {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const bad = v.trim() !== '' && parseChord(v.trim()) === null;
  return (
    <div className="absolute top-[3px] z-40 flex flex-col gap-1" style={{ left: x }} onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        value={v}
        aria-label="Chord"
        placeholder="Am7"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!bad) onDone(v);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
          e.stopPropagation();
        }}
        onBlur={() => window.setTimeout(() => (bad ? onCancel() : onDone(v)), 120)}
        className={cn('sc-mono h-[22px] w-[84px] rounded-[4px] border bg-[var(--sc-raised)] px-1.5 text-[11.5px] outline-none', bad ? 'border-[var(--sc-bad)]' : 'border-[var(--sc-ink)]')}
      />
      <div className="flex w-[208px] flex-wrap gap-1 rounded-[6px] border border-[var(--sc-line)] bg-[var(--sc-raised)] p-1 shadow-[var(--sc-shadow)]">
        {offer.map((c) => (
          <button key={c} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onDone(c)} className="sc-mono sc-focus cursor-pointer rounded-[3px] border border-[var(--sc-line)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--sc-hover)]">
            {c}
          </button>
        ))}
        {initial !== '' && (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onDone('')} className="sc-focus cursor-pointer rounded-[3px] px-1.5 py-0.5 text-[11px] text-[var(--sc-bad)] hover:bg-[var(--sc-bad-soft)]">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export const ROLL = { GUT, RULER, CH, RH, LYR };
