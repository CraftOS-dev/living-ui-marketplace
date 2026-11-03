/**
 * Editing a song, by sight and by ear, on a page of its own: the notes on a
 * piano roll, the chords above, the words of each verse below (Roll.tsx);
 * the key, metre, tempo and the song's details beside; play it from
 * anywhere, with the recording it was made from when it has one. Every
 * change can be undone and is saved by itself a moment later (the notation
 * is written from the song and checked by the server, whose problems show
 * here with the bar they are in). The notation stays one click away for
 * those who want it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftToLine, ChevronDown, ChevronUp, CircleAlert, Code2, Hand, Keyboard, MousePointer2, Pencil, Play, Plus, Redo2, Scissors, Square, Trash2, Undo2, Combine, ZoomIn, ZoomOut, AudioLines, Music2, Wind } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { KindSelect, LevelSelect } from '../components/library/AddSong.tsx';
import { CheckLine, useCheck } from '../components/library/NotationEditor.tsx';
import { Roll, ROLL, pitchName } from '../components/editor/Roll.tsx';
import type { Tool } from '../components/editor/Roll.tsx';
import { Button, Empty, Field, IconButton, Input, Popover, Segmented, Select, Spinner, Textarea, Toggle, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { navigate, useRoute } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { Song } from '../lib/types.ts';
import { audio } from '../music/audio.ts';
import { loadBacking } from '../music/backing.ts';
import { playFrom } from '../music/editplay.ts';
import type { EditPlayback } from '../music/editplay.ts';
import { syllablesOf } from '../music/lyrics.ts';
import { TICKS, addVerse, barBeat, barStart, barTicks, docFromSong, docToAbc, fifthsFor, keyLabel, newId, normalize, removeVerse, shiftWords, songEnd, tonicOf, transpose } from '../music/songdoc.ts';
import type { DocNote, SongDoc } from '../music/songdoc.ts';

const LENGTHS: { value: string; label: string; t: number; title: string }[] = [
  { value: '12', label: '1/16', t: 12, title: 'Sixteenth (1)' },
  { value: '24', label: '1/8', t: 24, title: 'Eighth (2)' },
  { value: '48', label: '1/4', t: 48, title: 'Quarter (3)' },
  { value: '96', label: '1/2', t: 96, title: 'Half (4)' },
  { value: '192', label: '1', t: 192, title: 'Whole (5)' },
];
const METERS = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/8', '6/8', '9/8', '12/8'];

interface Details {
  composer: string;
  level: number;
  kind: 'song' | 'vocalise';
  sections: { name: string; from: number; to: number }[];
  gloss: string;
}

export function EditorPage(): React.JSX.Element {
  const { query } = useRoute();
  const id = query.get('song') ?? '';
  const [song, setSong] = useState<Song | null>(null);
  const [err, setErr] = useState('');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setSong(null);
    setErr('');
    if (id === '') {
      setErr('No song was named.');
      return;
    }
    api
      .songFull(id)
      .then((r) => live && setSong(r.song))
      .catch((e: unknown) => live && setErr(errMessage(e)));
    return () => {
      live = false;
    };
  }, [id, nonce]);
  const back = (query.get('back') ?? 'library') as Page;
  if (err !== '')
    return (
      <div className="flex h-full items-center justify-center">
        <Empty icon={CircleAlert} title="This song could not be opened" action={<Button onClick={() => navigate('library')}>Back to the library</Button>}>
          {err}
        </Empty>
      </div>
    );
  if (song === null || song.model === undefined || song.abc === undefined)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[var(--sc-muted)]">
        <Spinner size={14} /> Opening the song…
      </div>
    );
  return <Studio key={`${song.id}-${nonce}`} song={song} back={back} reload={() => setNonce((n) => n + 1)} />;
}

type Status = { s: 'saved' } | { s: 'dirty' } | { s: 'saving' } | { s: 'error'; msg: string } | { s: 'conflict' };

function sectionsText(xs: Details['sections']): string {
  return xs
    .filter((x) => x.name.trim() !== '' && x.from >= 0 && x.to >= x.from)
    .map((x) => `${x.name.trim()}:${x.from}-${x.to}`)
    .join(', ');
}

function Studio({ song, back, reload }: { song: Song; back: Page; reload: () => void }): React.JSX.Element {
  const app = useApp();
  const vowel = (app.settings?.vowel ?? 'oo') as 'oo' | 'ah';
  const first = useMemo(() => docFromSong(song.abc ?? '', song.model!, song.title), [song]);
  const [hist, setHist] = useState<{ past: SongDoc[]; now: SongDoc; future: SongDoc[] }>({ past: [], now: first, future: [] });
  const doc = hist.now;
  const [details, setDetails] = useState<Details>({ composer: song.composer, level: song.level, kind: song.kind, sections: song.sections.map((x) => ({ name: x.name, from: x.from, to: x.to })), gloss: song.gloss ?? '' });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [chordSel, setChordSel] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [lenT, setLenT] = useState(24);
  const [triplet, setTriplet] = useState(false);
  const [verse, setVerse] = useState(0);
  const [zoom, setZoom] = useState(1.3);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [melody, setMelody] = useState<'voice' | 'piano' | 'off'>('voice');
  const [chordsOn, setChordsOn] = useState(true);
  const [recPart, setRecPart] = useState<'original' | 'voice' | 'music' | 'off'>('original');
  const [status, setStatus] = useState<Status>({ s: 'saved' });
  const [lyricTarget, setLyricTarget] = useState<number | null>(null);
  const [showAbc, setShowAbc] = useState(false);
  const [abcDraft, setAbcDraft] = useState<string | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const keysAnchor = useRef<HTMLButtonElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const playback = useRef<EditPlayback | null>(null);
  const clip = useRef<DocNote[]>([]);
  const locked = song.backing != null;
  const snap = triplet ? 16 : 12;
  const len = triplet ? Math.round((lenT * 2) / 3) : lenT;

  /* ------------------------------------------------------------ history */

  const commit = useCallback((next: SongDoc) => {
    setHist((h) => (next === h.now ? h : { past: [...h.past.slice(-199), h.now], now: next, future: [] }));
  }, []);
  const undo = (): void => setHist((h) => (h.past.length === 0 ? h : { past: h.past.slice(0, -1), now: h.past[h.past.length - 1]!, future: [h.now, ...h.future] }));
  const redo = (): void => setHist((h) => (h.future.length === 0 ? h : { past: [...h.past, h.now], now: h.future[0]!, future: h.future.slice(1) }));

  /* --------------------------------------------------------------- save */

  const abc = useMemo(() => docToAbc(doc), [doc]);
  const secText = sectionsText(details.sections);
  const { result, busy: checking } = useCheck(abc, secText);
  const saved = useRef({ abc: docToAbc(first), title: first.title, composer: song.composer, level: song.level, kind: song.kind, sections: sectionsText(details.sections), gloss: song.gloss ?? '' });
  const seq = useRef(0);
  const pending = useRef<null | (() => Promise<void>)>(null);
  const cur = { abc, title: doc.title.trim() || song.title, composer: details.composer, level: details.level, kind: details.kind, sections: secText, gloss: details.gloss };
  const curRef = useRef(cur);
  curRef.current = cur;

  // The notation on the server as last seen here: another hand (the coach, another window) changing
  // the song meanwhile is noticed before it would be overwritten.
  // (Compared as the server keeps it: trimmed, with plain line ends.)
  const sameAbc = (a: string, b: string): boolean => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim();
  const server = useRef(song.abc ?? '');
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const elsewhereRef = useRef<string | null>(null);
  elsewhereRef.current = elsewhere;

  const save = useCallback(async (): Promise<void> => {
    const c = curRef.current;
    const s = saved.current;
    const same = c.abc === s.abc && c.title === s.title && c.composer === s.composer && c.level === s.level && c.kind === s.kind && c.sections === s.sections && c.gloss === s.gloss;
    if (same) {
      setStatus({ s: 'saved' });
      return;
    }
    if (elsewhereRef.current !== null) {
      setStatus({ s: 'conflict' });
      return;
    }
    const mine = ++seq.current;
    setStatus({ s: 'saving' });
    try {
      if (c.abc !== s.abc) {
        const now = (await api.song(song.id)).song.abc ?? '';
        if (!sameAbc(now, server.current)) {
          setElsewhere(now);
          if (mine === seq.current) setStatus({ s: 'conflict' });
          return;
        }
      }
      await api.updateSong(song.id, {
        title: c.title !== s.title ? c.title : undefined,
        composer: c.composer !== s.composer ? c.composer : undefined,
        level: c.level !== s.level ? c.level : undefined,
        kind: c.kind !== s.kind ? c.kind : undefined,
        sections: c.sections !== s.sections || c.abc !== s.abc ? c.sections : undefined,
        abc: c.abc !== s.abc ? c.abc : undefined,
        gloss: c.gloss !== s.gloss ? c.gloss : undefined,
      });
      saved.current = c;
      if (c.abc !== s.abc) server.current = c.abc;
      if (mine === seq.current) setStatus({ s: 'saved' });
    } catch (e) {
      if (mine === seq.current) setStatus({ s: 'error', msg: errMessage(e) });
    }
  }, [song.id]);

  useEffect(() => {
    const s = saved.current;
    const c = cur;
    if (c.abc === s.abc && c.title === s.title && c.composer === s.composer && c.level === s.level && c.kind === s.kind && c.sections === s.sections && c.gloss === s.gloss) return;
    // A song the server would refuse is kept here until it is fixed (the problems show below).
    if (result !== null && !result.ok && !checking) {
      setStatus({ s: 'error', msg: result.errors[0]?.message ?? 'The song has a problem.' });
      return;
    }
    setStatus({ s: 'dirty' });
    const t = window.setTimeout(() => void save(), 900);
    pending.current = save;
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abc, cur.title, cur.composer, cur.level, cur.kind, cur.sections, cur.gloss, result, checking]);

  // Every 15 s while nothing waits to be saved: has the song been changed elsewhere?
  useEffect(() => {
    const t = window.setInterval(() => {
      if (elsewhereRef.current !== null || document.hidden) return;
      api
        .song(song.id)
        .then((r) => {
          const now = r.song.abc ?? '';
          if (!sameAbc(now, server.current) && elsewhereRef.current === null) setElsewhere(now);
        })
        .catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(t);
  }, [song.id]);

  // Leaving: what is not saved yet goes now.
  useEffect(
    () => () => {
      playback.current?.stop();
      void pending.current?.();
    },
    [],
  );

  /* ---------------------------------------------------------- playback */

  const [recBufs, setRecBufs] = useState<{ original: AudioBuffer | null; voice: AudioBuffer | null; music: AudioBuffer | null }>({ original: null, voice: null, music: null });
  useEffect(() => {
    if (song.backing == null) return;
    let live = true;
    const b = song.backing;
    void loadBacking(b.url).then((x) => live && setRecBufs((r) => ({ ...r, original: x }))).catch(() => undefined);
    if (b.voice != null) void loadBacking(b.voice).then((x) => live && setRecBufs((r) => ({ ...r, voice: x }))).catch(() => undefined);
    if (b.music != null) void loadBacking(b.music).then((x) => live && setRecBufs((r) => ({ ...r, music: x }))).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [song.backing]);

  const stop = useCallback(() => {
    playback.current?.stop();
    playback.current = null;
    setPlaying(false);
  }, []);

  const play = (from = playhead): void => {
    stop();
    const map = song.backing?.map ?? null;
    const buf = recPart === 'off' ? null : recBufs[recPart];
    const end = songEnd(doc);
    const pb = playFrom(doc, Math.min(from, end - 1), end, { melody, chords: chordsOn, recording: map !== null && buf !== null ? { buffer: buf, map } : null, vowel });
    playback.current = pb;
    setPlaying(true);
  };

  // The playhead follows what is heard, the view follows the playhead.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (): void => {
      const pb = playback.current;
      if (pb === null) return;
      const t = pb.tick();
      if (t >= pb.end) {
        stop();
        return;
      }
      setPlayhead(Math.round(t));
      const sc = scrollRef.current;
      if (sc !== null) {
        const x = ROLL.GUT + t * zoom;
        if (x > sc.scrollLeft + sc.clientWidth - 80 || x < sc.scrollLeft + ROLL.GUT) sc.scrollLeft = Math.max(0, x - ROLL.GUT - 60);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, zoom, stop]);

  /* ------------------------------------------------------------ edits */

  const selected = doc.notes.filter((n) => sel.has(n.id));
  const editNotes = (f: (n: DocNote) => DocNote, keep = true): void => {
    if (sel.size === 0) return;
    commit(normalize({ ...doc, notes: doc.notes.map((n) => (sel.has(n.id) ? f(n) : n)) }, keep ? sel : new Set()));
  };
  const remove = (): void => {
    if (chordSel !== null) {
      commit({ ...doc, chords: doc.chords.filter((c) => c.id !== chordSel) });
      setChordSel(null);
      return;
    }
    if (sel.size === 0) return;
    commit({ ...doc, notes: doc.notes.filter((n) => !sel.has(n.id)) });
    setSel(new Set());
  };
  const nudgePitch = (d: number): void => {
    editNotes((n) => ({ ...n, midi: n.midi + d }));
    const n0 = selected[0];
    if (n0 !== undefined) audio.play(n0.midi + d, 70, audio.now() + 0.01, 0.3, 'ed-preview');
  };
  const nudgeTime = (d: number): void => editNotes((n) => ({ ...n, t: Math.max(0, n.t + d) }));
  const nudgeLen = (d: number): void => editNotes((n) => ({ ...n, d: Math.max(snap, n.d + d) }));
  const split = (): void => {
    if (sel.size === 0) return;
    const out: DocNote[] = [];
    const keep = new Set<number>();
    for (const n of doc.notes) {
      if (!sel.has(n.id) || n.d < 2 * snap) {
        out.push(n);
        continue;
      }
      // At the playhead when it is inside the note, else in the middle (on the grid).
      const at = playhead > n.t && playhead < n.t + n.d ? Math.round((playhead - n.t) / snap) * snap : Math.round(n.d / 2 / snap) * snap;
      const a = Math.max(snap, Math.min(n.d - snap, at));
      const b: DocNote = { ...n, id: newId(), t: n.t + a, d: n.d - a, syl: n.syl.map(() => ''), join: n.join.map(() => false), breath: false };
      out.push({ ...n, d: a }, b);
      keep.add(n.id).add(b.id);
    }
    commit(normalize({ ...doc, notes: out }));
    setSel(keep);
  };
  const join = (): void => {
    const ns = selected.slice().sort((a, b) => a.t - b.t);
    if (ns.length < 2) return;
    const a = ns[0]!;
    const z = ns[ns.length - 1]!;
    const merged: DocNote = { ...a, d: z.t + z.d - a.t };
    const ids = new Set(ns.map((n) => n.id));
    commit(normalize({ ...doc, notes: [...doc.notes.filter((n) => !ids.has(n.id)), merged] }, new Set([a.id])));
    setSel(new Set([a.id]));
  };
  const copy = (): void => {
    clip.current = selected.map((n) => ({ ...n }));
  };
  const paste = (): void => {
    const c = clip.current;
    if (c.length === 0) return;
    const t0 = Math.min(...c.map((n) => n.t));
    const at = Math.round(playhead / snap) * snap;
    const fresh = c.map((n) => ({ ...n, id: newId(), t: at + n.t - t0, syl: Array.from({ length: doc.verses }, (_, k) => n.syl[k] ?? ''), join: Array.from({ length: doc.verses }, (_, k) => n.join[k] ?? false) }));
    const ids = new Set(fresh.map((n) => n.id));
    commit(normalize({ ...doc, notes: [...doc.notes, ...fresh] }, ids));
    setSel(ids);
  };
  const shift = (dir: -1 | 1): void => {
    const n0 = selected.slice().sort((a, b) => a.t - b.t)[0];
    if (n0 === undefined) return;
    const i = doc.notes.findIndex((n) => n.id === n0.id);
    const next = shiftWords(doc, i, verse, dir);
    if (next === null) {
      toast.info('The note before already has a syllable of its own.');
      return;
    }
    commit(next);
    const to = doc.notes[i + dir];
    if (to !== undefined) setSel(new Set([to.id]));
  };

  /* --------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tgt = e.target as HTMLElement | null;
      if (tgt !== null && (tgt.closest('input,textarea,select,[contenteditable="true"]') !== null)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (mod && (k === 'z' || k === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && (k === 'y' || k === 'Y')) {
        e.preventDefault();
        redo();
      } else if (mod && (k === 'a' || k === 'A')) {
        e.preventDefault();
        setSel(new Set(doc.notes.map((n) => n.id)));
      } else if (mod && (k === 'c' || k === 'C')) copy();
      else if (mod && (k === 'x' || k === 'X')) {
        copy();
        remove();
      } else if (mod && (k === 'v' || k === 'V')) {
        e.preventDefault();
        paste();
      } else if (k === ' ') {
        e.preventDefault();
        if (playing) stop();
        else play();
      } else if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        remove();
      } else if ((k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') && sel.size === 0) {
        // Nothing chosen: the arrows move around the song (a bar along, a few notes up or down).
        e.preventDefault();
        const sc = scrollRef.current;
        if (sc !== null) sc.scrollBy({ left: k === 'ArrowLeft' ? -barTicks(doc.meter) * zoom : k === 'ArrowRight' ? barTicks(doc.meter) * zoom : 0, top: k === 'ArrowUp' ? -ROLL.RH * 6 : k === 'ArrowDown' ? ROLL.RH * 6 : 0, behavior: 'smooth' });
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        nudgePitch((k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        e.preventDefault();
        const step = (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? (4 / doc.meter.den) * TICKS : snap);
        if (e.altKey) nudgeLen(step);
        else nudgeTime(step);
      } else if (k === 'Enter') {
        const n0 = selected.slice().sort((a, b) => a.t - b.t)[0];
        if (n0 !== undefined) {
          e.preventDefault();
          setLyricTarget(n0.id);
        }
      } else if (k === 'Escape') {
        setSel(new Set());
        setChordSel(null);
      } else if (!mod && (k === 'v' || k === 'V')) setTool('select');
      else if (!mod && (k === 'n' || k === 'N' || k === 'p' || k === 'P')) setTool('draw');
      else if (!mod && (k === 'h' || k === 'H')) setTool('pan');
      else if (!mod && (k === 's' || k === 'S')) split();
      else if (!mod && (k === 'j' || k === 'J')) join();
      else if (!mod && (k === 't' || k === 'T')) setTriplet((x) => !x);
      else if (!mod && k >= '1' && k <= '5') setLenT(LENGTHS[Number(k) - 1]!.t);
      else if (!mod && k === 'Home') {
        setPlayhead(0);
        jumpTo(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* --------------------------------------------------------- the view */

  const range = useMemo((): [number, number] => {
    const ms = first.notes.map((n) => n.midi);
    const lo0 = ms.length > 0 ? Math.min(...ms) : 60;
    const hi0 = ms.length > 0 ? Math.max(...ms) : 72;
    const pad = Math.max(4, Math.ceil((26 - (hi0 - lo0)) / 2));
    return [lo0 - pad, hi0 + pad];
  }, [first]);
  const now = doc.notes.map((n) => n.midi);
  const shownRange: [number, number] = [Math.min(range[0], ...now.map((m) => m - 2)), Math.max(range[1], ...now.map((m) => m + 2))];

  // Open on the first note.
  useEffect(() => {
    const sc = scrollRef.current;
    const f = doc.notes[0];
    if (sc !== null && f !== undefined) {
      sc.scrollLeft = Math.max(0, f.t * zoom - 80);
      const midY = ROLL.RULER + ROLL.CH + (shownRange[1] - f.midi) * ROLL.RH - sc.clientHeight / 2;
      sc.scrollTop = Math.max(0, midY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Zoom by f, keeping what is under the pointer (else the playhead) where it is on screen. */
  const zoomBy = (f: number, clientX?: number): void => {
    const sc = scrollRef.current;
    const z = Math.max(0.25, Math.min(5, zoom * f));
    if (z === zoom) return;
    if (sc !== null) {
      const r = sc.getBoundingClientRect();
      const x = clientX !== undefined ? clientX - r.left : ROLL.GUT + playhead * zoom - sc.scrollLeft;
      const t = (sc.scrollLeft + x - ROLL.GUT) / zoom;
      requestAnimationFrame(() => {
        sc.scrollLeft = Math.max(0, ROLL.GUT + t * z - x);
        readView();
      });
    }
    setZoom(z);
  };
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;

  const [view, setView] = useState({ left: 0, width: 800 });
  const readView = (): void => {
    const sc = scrollRef.current;
    if (sc !== null) setView((v) => (v.left === sc.scrollLeft && v.width === sc.clientWidth ? v : { left: sc.scrollLeft, width: sc.clientWidth }));
  };
  useEffect(() => {
    const sc = scrollRef.current;
    if (sc === null) return;
    readView();
    const ro = new ResizeObserver(() => readView());
    ro.observe(sc);
    // The wheel: Ctrl zooms where the pointer is; over the bars, chords and words (or when the
    // song fits the height) it moves along the song; Shift (or a sideways swipe) always does.
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX);
        return;
      }
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const lane = (e.target as HTMLElement | null)?.closest('[data-timeline]') ?? null;
      if (lane !== null || sc.scrollHeight <= sc.clientHeight + 2) {
        e.preventDefault();
        sc.scrollLeft += e.deltaY;
      }
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      sc.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => readView(), [zoom]);

  /** Bring tick t to the middle of the view. */
  const jumpTo = (t: number): void => {
    const sc = scrollRef.current;
    if (sc === null) return;
    sc.scrollLeft = Math.max(0, t * zoom - (sc.clientWidth - ROLL.GUT) / 2);
    readView();
  };
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const deleteVerse = (): void => {
    if (doc.verses === 0) return;
    const v = Math.min(verse, doc.verses - 1);
    const had = doc.notes.some((n) => (n.syl[v] ?? '') !== '');
    commit(removeVerse(doc, v));
    setVerse(Math.max(0, Math.min(v, doc.verses - 2)));
    toast.info(had ? `Verse ${v + 1} deleted. Ctrl+Z brings it back.` : `Verse ${v + 1} deleted.`);
  };

  const pos = barBeat(doc, playhead);
  const one = selected.length === 1 ? selected[0]! : null;
  const statusText = status.s === 'saved' ? 'Saved' : status.s === 'saving' ? 'Saving…' : status.s === 'dirty' ? 'Editing…' : status.s === 'conflict' ? 'Changed elsewhere' : 'Not saved';

  const leave = (to: Page, q: Record<string, string>): void => {
    stop();
    void save().finally(() => navigate(to, q));
  };

  /* ---------------------------------------------------------- render */

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--sc-line)] bg-[var(--sc-panel)] px-3">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => leave(back === 'practice' ? 'practice' : 'library', back === 'practice' ? { song: song.id } : { song: song.id })} />
        <input
          value={doc.title}
          onChange={(e) => commit({ ...doc, title: e.target.value })}
          aria-label="Title"
          className="sc-focus min-w-0 max-w-[420px] flex-1 truncate rounded-[var(--sc-radius-sm)] border border-transparent bg-transparent px-1.5 py-1 text-[15px] font-semibold outline-none hover:border-[var(--sc-line)] focus:border-[var(--sc-ink-2)]"
        />
        <span
          title={status.s === 'error' ? status.msg : undefined}
          className={cn('sc-label flex shrink-0 items-center gap-1.5 normal-case tracking-normal', status.s === 'error' ? 'text-[var(--sc-bad)]' : 'text-[var(--sc-muted)]')}
        >
          {status.s === 'saving' ? <Spinner size={11} /> : <span className={cn('size-1.5 rounded-full', status.s === 'saved' ? 'bg-[var(--sc-good)]' : status.s === 'error' ? 'bg-[var(--sc-bad)]' : 'bg-[var(--sc-warn)]')} />}
          {statusText}
        </span>
        <span className="flex-1" />
        <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={hist.past.length === 0} onClick={undo} />
        <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={hist.future.length === 0} onClick={redo} />
        <button ref={keysAnchor} type="button" onClick={() => setKeysOpen((o) => !o)} className="sc-focus inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--sc-radius-sm)] px-2 text-[12px] text-[var(--sc-muted)] hover:bg-[var(--sc-hover)] hover:text-[var(--sc-ink)]">
          <Keyboard size={14} aria-hidden /> Shortcuts
        </button>
        <Popover anchor={keysAnchor} open={keysOpen} onClose={() => setKeysOpen(false)} width={320} className="p-3">
          <Shortcuts />
        </Popover>
        <Button variant="primary" icon={Play} onClick={() => leave('practice', { song: song.id })}>
          Practise
        </Button>
      </div>

      {elsewhere !== null && (
        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--sc-warn)] bg-[var(--sc-warn-soft)] px-4 py-2 text-[12.5px]">
          <CircleAlert size={14} aria-hidden className="shrink-0 text-[var(--sc-warn)]" />
          <span className="min-w-0 flex-1">This song was changed outside the editor since you opened it (perhaps by your coach). Your changes here are kept until you choose.</span>
          <Button size="sm" variant="primary" onClick={() => (stop(), reload())}>
            Load the new version
          </Button>
          <Button
            size="sm"
            onClick={() => {
              server.current = elsewhere;
              setElsewhere(null);
              elsewhereRef.current = null;
              void save();
            }}
          >
            Keep mine
          </Button>
        </div>
      )}

      {/* Tools */}
      <div className="sc-scroll flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--sc-line)] bg-[var(--sc-page)] px-3">
        <Segmented
          value={tool}
          onChange={setTool}
          label="Tool"
          size="sm"
          options={[
            { value: 'select', label: 'Select', icon: MousePointer2, title: 'Select, move and stretch notes (V)' },
            { value: 'draw', label: 'Draw', icon: Pencil, title: 'Draw notes: click, or drag for a longer one (N)' },
            { value: 'pan', label: 'Hand', icon: Hand, title: 'Move around the song: drag anywhere (H, or drag with the middle mouse button)' },
          ]}
        />
        <span className="mx-1 h-5 w-px shrink-0 bg-[var(--sc-line)]" />
        <span className="sc-label mr-0.5">New note</span>
        <Segmented value={String(lenT)} onChange={(v) => setLenT(Number(v))} label="Length of a new note" size="sm" options={LENGTHS.map((l) => ({ value: l.value, label: l.label, title: l.title }))} />
        <button type="button" aria-pressed={triplet} title={triplet ? 'Triplets on (T)' : 'Triplets off (T)'} onClick={() => setTriplet((x) => !x)} className={cn('sc-focus sc-mono inline-flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--sc-radius-sm)] text-[12px] font-semibold', triplet ? 'bg-[var(--sc-active)] text-[var(--sc-ink)]' : 'text-[var(--sc-muted)] hover:bg-[var(--sc-hover)] hover:text-[var(--sc-ink)]')}>
          3
        </button>
        <span className="mx-1 h-5 w-px shrink-0 bg-[var(--sc-line)]" />
        <IconButton icon={Scissors} label="Split the note (S)" disabled={sel.size === 0} onClick={split} />
        <IconButton icon={Combine} label="Join the notes into one (J)" disabled={sel.size < 2} onClick={join} />
        <IconButton icon={Trash2} label="Delete (Del)" tone="danger" disabled={sel.size === 0 && chordSel === null} onClick={remove} />
        <span className="mx-1 h-5 w-px shrink-0 bg-[var(--sc-line)]" />
        <span className="sc-label mr-0.5">Words</span>
        <Select value={String(verse)} onChange={(e) => setVerse(Number(e.target.value))} aria-label="Verse being edited" className="w-[104px]">
          {Array.from({ length: Math.max(1, doc.verses) }, (_, v) => (
            <option key={v} value={v}>
              Verse {v + 1}
            </option>
          ))}
        </Select>
        <IconButton icon={Plus} label="Add a verse" onClick={() => (commit(addVerse(doc.verses === 0 ? addVerse(doc) : doc)), setVerse(Math.max(1, doc.verses)))} />
        <IconButton icon={Trash2} label={`Delete verse ${verse + 1}`} tone="danger" disabled={doc.verses === 0} onClick={deleteVerse} />
        <span className="flex-1" />
        <span className="sc-mono shrink-0 text-[11.5px] text-[var(--sc-muted)]">
          {keyLabel(doc.fifths, doc.mode)} · {doc.meter.num}/{doc.meter.den} · ♩={doc.tempo}
        </span>
      </div>

      {/* The roll and the inspector */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
        <Overview doc={doc} zoom={zoom} view={view} playhead={playhead} onJump={jumpTo} />
        <style>{'.sc-pan, .sc-pan * { cursor: grab !important } .sc-panning, .sc-panning * { cursor: grabbing !important }'}</style>
        <div
          ref={scrollRef}
          className={cn('sc-scroll relative min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--sc-page)]', panning ? 'sc-panning' : tool === 'pan' && 'sc-pan')}
          onScroll={readView}
          onMouseDown={(e) => {
            // The middle button pans here (not the browser's own autoscroll).
            if (e.button === 1) e.preventDefault();
          }}
          onPointerDownCapture={(e) => {
            const sc = scrollRef.current;
            if (sc === null) return;
            const byHand = e.button === 0 && tool === 'pan' && (e.target as HTMLElement).closest('input,textarea,select,button') === null;
            if (e.button !== 1 && !byHand) return;
            e.preventDefault();
            e.stopPropagation();
            sc.setPointerCapture(e.pointerId);
            panRef.current = { x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop };
            setPanning(true);
          }}
          onPointerMoveCapture={(e) => {
            const p = panRef.current;
            const sc = scrollRef.current;
            if (p === null || sc === null) return;
            e.stopPropagation();
            sc.scrollLeft = p.left - (e.clientX - p.x);
            sc.scrollTop = p.top - (e.clientY - p.y);
          }}
          onPointerUpCapture={(e) => {
            if (panRef.current === null) return;
            e.stopPropagation();
            panRef.current = null;
            setPanning(false);
          }}
        >
          <Roll
            doc={doc}
            sel={sel}
            chordSel={chordSel}
            verse={verse}
            zoom={zoom}
            playhead={playhead}
            playing={playing}
            tool={tool}
            snap={snap}
            len={len}
            range={shownRange}
            onSelect={(s) => (setSel(s), s.size > 0 && setChordSel(null))}
            onChordSelect={setChordSel}
            onVerse={setVerse}
            onCommit={commit}
            onPlayhead={(t) => {
              setPlayhead(t);
              if (playing) play(t);
            }}
            lyricTarget={lyricTarget}
            onLyricTargetDone={() => setLyricTarget(null)}
            scrollRef={scrollRef}
          />
        </div>
        </div>

        <aside className="sc-scroll hidden w-[312px] shrink-0 flex-col gap-0 overflow-y-auto border-l border-[var(--sc-line)] bg-[var(--sc-panel)] lg:flex">
          {(one !== null || selected.length > 1) && (
            <Section title={one !== null ? `Note ${pitchName(one.midi)}` : `${selected.length} notes`} aside={one !== null ? `bar ${barBeat(doc, one.t).bar} · beat ${Math.round(barBeat(doc, one.t).beat * 100) / 100}` : undefined}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" icon={ChevronUp} onClick={() => nudgePitch(1)} title="Up a semitone (↑)">
                  Up
                </Button>
                <Button size="sm" icon={ChevronDown} onClick={() => nudgePitch(-1)} title="Down a semitone (↓)">
                  Down
                </Button>
                <Button size="sm" onClick={() => nudgePitch(12)} title="Up an octave (Shift+↑)">
                  8va
                </Button>
                <Button size="sm" onClick={() => nudgePitch(-12)} title="Down an octave (Shift+↓)">
                  8vb
                </Button>
              </div>
              <Field label="Length">
                <Segmented
                  value={one !== null && LENGTHS.some((l) => l.t === one.d) ? String(one.d) : ''}
                  onChange={(v) => editNotes((n) => ({ ...n, d: Number(v) }))}
                  label="Length of the selected notes"
                  size="sm"
                  options={LENGTHS.map((l) => ({ value: l.value, label: l.label, title: l.title }))}
                />
              </Field>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <FlagToggle label="Breathe before" on={selected.every((n) => n.breath)} onChange={(v) => editNotes((n) => ({ ...n, breath: v }), false)} />
                <FlagToggle label="Staccato" on={selected.every((n) => n.stacc)} onChange={(v) => editNotes((n) => ({ ...n, stacc: v }), false)} />
                <FlagToggle label="Spoken" on={selected.every((n) => n.spoken)} onChange={(v) => editNotes((n) => ({ ...n, spoken: v, free: v ? false : n.free }), false)} />
                <FlagToggle label="Not scored" on={selected.every((n) => n.free)} onChange={(v) => editNotes((n) => ({ ...n, free: v, spoken: v ? false : n.spoken }), false)} />
              </div>
              <WordsBox doc={doc} verse={verse} selected={selected} onCommit={commit} onShift={shift} onType={(id) => setLyricTarget(id)} />
            </Section>
          )}

          {selected.length === 0 && chordSel === null && (
            <Section title="Editing">
              <ul className="flex flex-col gap-1.5 text-[12.5px] leading-[18px] text-[var(--sc-ink-2)]">
                <li>Click a note to choose it, drag it to move it, drag its right edge to make it longer.</li>
                <li>Double-click empty ground, or use Draw, to add a note.</li>
                <li>Click under a note to write its word; Tab goes on to the next note. Drag a word onto another note to move it.</li>
                <li>Click the chord lane to add a chord.</li>
                <li>Move around: the strip above shows the whole song (click or drag it), the wheel scrolls (Shift+wheel sideways, Ctrl+wheel zooms), the middle mouse button or the Hand drags the view.</li>
                <li>Play from anywhere: click the bar numbers, then Space.{song.backing != null ? ' The recording plays along, so you can hear where each note and word belongs.' : ''}</li>
              </ul>
            </Section>
          )}

          <Section title="Key, metre and tempo" aside={locked ? 'follows the recording' : undefined}>
            <Field label="Key">
              <div className="flex items-center gap-1.5">
                <Select
                  value={`${doc.fifths}:${doc.mode}`}
                  onChange={(e) => {
                    const [f, m] = e.target.value.split(':');
                    commit({ ...doc, fifths: Number(f), mode: m === 'minor' ? 'minor' : 'major' });
                  }}
                  aria-label="Key signature"
                >
                  {(['major', 'minor'] as const).flatMap((m) =>
                    Array.from({ length: 13 }, (_, i) => i - 6).map((f) => (
                      <option key={`${f}:${m}`} value={`${f}:${m}`}>
                        {keyLabel(f, m)}
                      </option>
                    )),
                  )}
                </Select>
              </div>
            </Field>
            <Field label="Move the whole song" hint={locked ? 'The notes match the recording, so they stay where they are; in practice, Key sings the song higher or lower.' : 'Every note and chord a semitone up or down, the key with them.'}>
              <div className="flex items-center gap-1.5">
                <Button size="sm" icon={ChevronDown} disabled={locked} onClick={() => commit(transpose(doc, -1))}>
                  Down
                </Button>
                <Button size="sm" icon={ChevronUp} disabled={locked} onClick={() => commit(transpose(doc, 1))}>
                  Up
                </Button>
                <span className="sc-mono text-[12px] text-[var(--sc-muted)]">{pitchName(Math.min(...doc.notes.map((n) => n.midi), 127))}–{pitchName(Math.max(...doc.notes.map((n) => n.midi), 0))}</span>
              </div>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Metre">
                <Select
                  value={`${doc.meter.num}/${doc.meter.den}`}
                  disabled={locked}
                  onChange={(e) => {
                    const [a, b] = e.target.value.split('/').map(Number);
                    commit({ ...doc, meter: { num: a ?? 4, den: b ?? 4 } });
                  }}
                  aria-label="Metre"
                >
                  {[...new Set([...METERS, `${doc.meter.num}/${doc.meter.den}`])].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Pickup">
                <Select
                  value={String(doc.pickup)}
                  disabled={locked}
                  onChange={(e) => commit({ ...doc, pickup: Number(e.target.value) })}
                  aria-label="Pickup before bar 1"
                >
                  {[0, ...Array.from({ length: Math.round(barTicks(doc.meter) / ((4 / doc.meter.den) * TICKS)) - 1 }, (_, i) => (i + 1) * (4 / doc.meter.den) * TICKS), ...(doc.pickup % ((4 / doc.meter.den) * TICKS) !== 0 ? [doc.pickup] : [])].map((t) => (
                    <option key={t} value={t}>
                      {t === 0 ? 'None' : `${Math.round((t / ((4 / doc.meter.den) * TICKS)) * 100) / 100} beat${t === (4 / doc.meter.den) * TICKS ? '' : 's'}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tempo">
                <Input type="number" min={30} max={260} value={doc.tempo} disabled={locked} onChange={(e) => commit({ ...doc, tempo: Math.max(20, Math.min(300, Number(e.target.value) || doc.tempo)) })} aria-label="Tempo (quarter notes a minute)" />
              </Field>
            </div>
          </Section>

          <Section title="Song">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Level">
                <LevelSelect value={details.level} onChange={(level) => setDetails({ ...details, level })} />
              </Field>
              <Field label="Kind">
                <KindSelect value={details.kind} onChange={(kind) => setDetails({ ...details, kind })} />
              </Field>
            </div>
            <Field label="Composer">
              <Input value={details.composer} onChange={(e) => setDetails({ ...details, composer: e.target.value })} />
            </Field>
            <Field label="Sections" hint="Parts of the song to practise on their own, by bars.">
              <div className="flex flex-col gap-1.5">
                {details.sections.map((x, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input value={x.name} onChange={(e) => setDetails({ ...details, sections: details.sections.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)) })} aria-label="Section name" className="w-20" />
                    <Input type="number" min={0} value={x.from} onChange={(e) => setDetails({ ...details, sections: details.sections.map((y, k) => (k === i ? { ...y, from: Number(e.target.value) } : y)) })} aria-label="First bar" className="sc-mono w-16" />
                    <span className="text-[var(--sc-muted)]">–</span>
                    <Input type="number" min={0} value={x.to} onChange={(e) => setDetails({ ...details, sections: details.sections.map((y, k) => (k === i ? { ...y, to: Number(e.target.value) } : y)) })} aria-label="Last bar" className="sc-mono w-16" />
                    <IconButton icon={Trash2} label="Remove the section" tone="danger" size={26} onClick={() => setDetails({ ...details, sections: details.sections.filter((_, k) => k !== i) })} />
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Plus}
                  className="self-start"
                  onClick={() => {
                    const last = details.sections[details.sections.length - 1];
                    const lastBar = barBeat(doc, songEnd(doc) - 1).bar;
                    const from = last !== undefined ? last.to + 1 : 1;
                    setDetails({ ...details, sections: [...details.sections, { name: String.fromCharCode(65 + details.sections.length), from, to: Math.min(lastBar, from + 7) }] });
                  }}
                >
                  Add a section
                </Button>
              </div>
            </Field>
            <Field label="About the words" hint="A translation, what the song is about, how to say the words.">
              <Textarea value={details.gloss} onChange={(e) => setDetails({ ...details, gloss: e.target.value })} minRows={2} maxRows={8} />
            </Field>
          </Section>

          <Section title="Check">
            <CheckLine result={result} busy={checking} />
            {status.s === 'error' && result?.ok !== false && <p className="text-[12px] leading-[17px] text-[var(--sc-bad)]">{status.msg}</p>}
            {doc.changed.length > 0 && <p className="text-[12px] leading-[17px] text-[var(--sc-muted)]">{doc.changed.join(' ')}</p>}
          </Section>

          <Section
            title="Notation"
            aside={
              <button type="button" onClick={() => setShowAbc((x) => !x)} className="sc-focus inline-flex cursor-pointer items-center gap-1 text-[12px] text-[var(--sc-muted)] hover:text-[var(--sc-ink)]">
                <Code2 size={13} aria-hidden /> {showAbc ? 'Hide' : 'Show'}
              </button>
            }
          >
            {showAbc && (
              <div className="flex flex-col gap-2">
                <Textarea value={abcDraft ?? abc} onChange={(e) => setAbcDraft(e.target.value)} minRows={8} maxRows={18} spellCheck={false} className="sc-mono text-[11.5px] leading-[17px]" aria-label="ABC notation" />
                {abcDraft !== null && abcDraft !== abc && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        const text = abcDraft;
                        stop();
                        api
                          .updateSong(song.id, { abc: text })
                          .then(() => {
                            toast.success('The notation is in use');
                            reload();
                          })
                          .catch((e: unknown) => toast.error(errMessage(e)));
                      }}
                    >
                      Use this notation
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAbcDraft(null)}>
                      Discard
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Section>
        </aside>
      </div>

      {/* Transport */}
      <div className="flex h-[54px] shrink-0 items-center gap-2.5 border-t border-[var(--sc-line)] bg-[var(--sc-panel)] px-3">
        <button
          type="button"
          aria-label={playing ? 'Stop' : 'Play'}
          title={playing ? 'Stop (Space)' : 'Play from the playhead (Space)'}
          onClick={() => (playing ? stop() : play())}
          className={cn('sc-focus flex h-[38px] shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 text-[13px] font-semibold shadow-[var(--sc-shadow)] transition-transform hover:scale-[1.03] active:scale-95', playing ? 'bg-[var(--sc-raised)] text-[var(--sc-ink)] ring-1 ring-[var(--sc-line-2)]' : 'bg-[var(--sc-ink)] text-[var(--sc-page)]')}
        >
          {playing ? <Square size={13} fill="currentColor" aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
          {playing ? 'Stop' : 'Play'}
        </button>
        <IconButton icon={ArrowLeftToLine} label="To the start (Home)" onClick={() => (setPlayhead(0), playing && play(0))} />
        <span className="sc-mono w-[96px] shrink-0 text-[12px] text-[var(--sc-muted)]">
          bar {pos.bar} · {Math.floor(pos.beat)}
        </span>
        <span className="mx-1 h-5 w-px shrink-0 bg-[var(--sc-line)]" />
        <span className="sc-label">Melody</span>
        <Segmented value={melody} onChange={(m) => (setMelody(m), playing && window.setTimeout(() => play(playhead), 0))} label="Melody" size="sm" options={[{ value: 'voice', label: 'Voice' }, { value: 'piano', label: 'Piano' }, { value: 'off', label: 'Off' }]} />
        <IconButton icon={Music2} label={chordsOn ? 'Chords on' : 'Chords off'} active={chordsOn} onClick={() => setChordsOn((c) => !c)} />
        {song.backing != null && (
          <>
            <span className="mx-1 h-5 w-px shrink-0 bg-[var(--sc-line)]" />
            <AudioLines size={14} aria-hidden className="shrink-0 text-[var(--sc-muted)]" />
            <Segmented
              value={recPart}
              onChange={setRecPart}
              label="Recording"
              size="sm"
              options={[
                { value: 'original', label: 'Recording' },
                ...(song.backing.voice != null ? [{ value: 'voice' as const, label: 'Voice' }] : []),
                ...(song.backing.music != null ? [{ value: 'music' as const, label: 'Music' }] : []),
                { value: 'off', label: 'Off' },
              ]}
            />
            {recPart !== 'off' && recBufs[recPart] === null && <Spinner size={12} />}
          </>
        )}
        <span className="flex-1" />
        <IconButton icon={ZoomOut} label="Zoom out (Ctrl+wheel)" onClick={() => zoomBy(1 / 1.35)} />
        <IconButton icon={ZoomIn} label="Zoom in (Ctrl+wheel)" onClick={() => zoomBy(1.35)} />
      </div>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2.5 border-b border-[var(--sc-line)] px-4 py-3.5">
      <div className="flex items-center gap-2">
        <h3 className="sc-label flex-1 text-[var(--sc-ink-2)]">{title}</h3>
        {typeof aside === 'string' ? <span className="text-[11.5px] text-[var(--sc-muted)]">{aside}</span> : aside}
      </div>
      {children}
    </section>
  );
}

function FlagToggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
      <Toggle checked={on} onChange={onChange} label={label} />
      <span>{label}</span>
    </label>
  );
}

/** The words of the selected notes in the verse being edited: shift them, or type a whole line onto the selection. */
function WordsBox({ doc, verse, selected, onCommit, onShift, onType }: { doc: SongDoc; verse: number; selected: DocNote[]; onCommit: (d: SongDoc) => void; onShift: (dir: -1 | 1) => void; onType: (id: number) => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const ns = selected.slice().sort((a, b) => a.t - b.t);
  const lay = (): void => {
    const syls = syllablesOf(text, [...text].map(() => NaN));
    if (syls.length === 0 || ns.length === 0) return;
    let next = doc;
    if (next.verses <= verse) for (let v = next.verses; v <= verse; v++) next = addVerse(next);
    const ids = ns.map((n) => n.id);
    const put = new Map<number, { s: string; j: boolean }>();
    ids.forEach((id, k) => {
      const sy = syls[k];
      if (sy !== undefined) put.set(id, { s: sy.s, j: sy.join });
      else put.set(id, { s: '', j: false });
    });
    // More syllables than notes: the rest go with the last note.
    if (syls.length > ids.length) {
      const last = ids[ids.length - 1]!;
      const rest = syls.slice(ids.length - 1);
      put.set(last, { s: rest.map((x) => x.s).join(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(rest[0]?.s ?? '') ? '' : ' '), j: false });
    }
    onCommit({ ...next, notes: next.notes.map((n) => (put.has(n.id) ? { ...n, syl: n.syl.map((x, k) => (k === verse ? put.get(n.id)!.s : x)), join: n.join.map((x, k) => (k === verse ? put.get(n.id)!.j : x)) } : n)) });
    setText('');
  };
  return (
    <div className="flex flex-col gap-2 rounded-[var(--sc-radius-sm)] bg-[var(--sc-sunk)] p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="sc-label flex-1">Words · verse {verse + 1}</span>
        {ns[0] !== undefined && (
          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onType(ns[0]!.id)} title="Type the syllables note by note (Enter)">
            Type
          </Button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={() => onShift(-1)} title="This syllable and the rest of its line, one note earlier">
          ← Earlier
        </Button>
        <Button size="sm" onClick={() => onShift(1)} title="This syllable and the rest of its line, one note later">
          Later →
        </Button>
      </div>
      {ns.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} minRows={2} maxRows={5} placeholder="Type the words for these notes…" aria-label="Words for the selected notes" />
          <Button size="sm" icon={Wind} disabled={text.trim() === ''} onClick={lay} className="self-start">
            Put them on the {ns.length} notes
          </Button>
        </div>
      )}
    </div>
  );
}

function Shortcuts(): React.JSX.Element {
  const rows: [string, string][] = [
    ['Space', 'Play or stop'],
    ['Wheel · Shift+wheel', 'Up and down · along the song (over the bars, chords and words: along)'],
    ['Ctrl+wheel', 'Zoom where the pointer is'],
    ['Middle-drag · H', 'Move around the song · the hand'],
    ['← → ↑ ↓ (nothing chosen)', 'Move around the song'],
    ['Click · Shift+click', 'Select a note · add to the selection'],
    ['Drag', 'Move notes (time and pitch); the right edge stretches'],
    ['Double-click · N', 'Draw a note · the pen'],
    ['↑ ↓ (Shift)', 'Pitch by a semitone (an octave)'],
    ['← → (Shift, Alt)', 'Move by the grid (a beat; change the length)'],
    ['Enter · Tab', 'Type the syllable · on to the next note'],
    ['S · J', 'Split · join notes'],
    ['1–5 · T', 'New note length · triplets'],
    ['Del', 'Delete notes or the chord'],
    ['Ctrl+Z · Ctrl+Shift+Z', 'Undo · redo'],
    ['Ctrl+C · Ctrl+V', 'Copy · paste at the playhead'],
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-start gap-3 text-[12px]">
          <span className="sc-mono w-[126px] shrink-0 text-[11px] text-[var(--sc-ink-2)]">{k}</span>
          <span className="text-[var(--sc-muted)]">{v}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The whole song in one strip: its notes, its bars, the playhead, and the
 * part on screen as a frame; click or drag anywhere to go there.
 */
function Overview({ doc, zoom, view, playhead, onJump }: { doc: SongDoc; zoom: number; view: { left: number; width: number }; playhead: number; onJump: (t: number) => void }): React.JSX.Element {
  const inner = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const end = Math.max(1, songEnd(doc));
  const ms = doc.notes.map((n) => n.midi);
  const lo = (ms.length > 0 ? Math.min(...ms) : 60) - 1;
  const hi = (ms.length > 0 ? Math.max(...ms) : 72) + 1;
  const t0 = view.left / zoom;
  const t1 = (view.left + view.width - ROLL.GUT) / zoom;
  const pct = (t: number): string => `${Math.max(0, Math.min(100, (t / end) * 100))}%`;
  const go = (clientX: number): void => {
    const r = inner.current?.getBoundingClientRect();
    if (r === undefined || r.width <= 0) return;
    onJump((Math.max(0, Math.min(r.width, clientX - r.left)) / r.width) * end);
  };
  const bars: number[] = [];
  for (let n = doc.pickup > 0 ? 1 : 2; ; n++) {
    const t = barStart(doc, n);
    if (t >= end) break;
    bars.push(t);
  }
  return (
    <div
      className="relative h-10 shrink-0 cursor-pointer touch-none select-none border-b border-[var(--sc-line)] bg-[var(--sc-panel)] px-2 py-1.5"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        go(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && go(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      title="The whole song: click or drag to go there"
    >
      <div ref={inner} role="slider" aria-label="Where you are in the song" aria-valuemin={1} aria-valuemax={barBeat(doc, end - 1).bar} aria-valuenow={barBeat(doc, t0).bar} tabIndex={-1} className="relative h-full w-full overflow-hidden rounded-[4px] bg-[var(--sc-sunk)]">
        <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox={`0 0 ${end} ${hi - lo + 1}`} preserveAspectRatio="none">
          {bars.map((t) => (
            <rect key={t} x={t} y={0} width={end / 2000} height={hi - lo + 1} style={{ fill: 'var(--sc-line)' }} />
          ))}
          {doc.notes.map((n) => (
            <rect key={n.id} x={n.t} y={hi - n.midi} width={Math.max(n.d, end / 900)} height={1.4} style={{ fill: 'var(--sc-ink-2)' }} />
          ))}
        </svg>
        <div aria-hidden className="absolute inset-y-0 rounded-[3px] border border-[var(--sc-ink)] bg-[color-mix(in_srgb,var(--sc-ink),transparent_90%)]" style={{ left: pct(t0), width: `calc(${pct(t1)} - ${pct(t0)})` }} />
        <div aria-hidden className="absolute inset-y-0 w-px bg-[var(--sc-coach)]" style={{ left: pct(playhead) }} />
      </div>
    </div>
  );
}

export { fifthsFor, tonicOf, barStart };
