/**
 * Sheet music: the song engraved with VexFlow as one long grand staff that
 * slides past a fixed cursor. Every note's group is tagged with the song
 * note it plays, so the practice screen can colour hits and misses, and a
 * time → x map lets the strip scroll smoothly between notes.
 *
 * VexFlow (with its Bravura music font) loads only when the sheet is first
 * shown. Chord symbols can go above the top staff and the sustain pedal as
 * brackets under the bottom one.
 */
import type { Ev, Model } from '../lib/types.ts';
import type { ChordSpan } from './harmony.ts';

export interface SheetLayout {
  width: number;
  height: number;
  /** Song time (quarter notes) → x, sorted by time. */
  xs: { q: number; x: number }[];
  /** Model note index → its engraved group (or null). */
  noteEls: (Element | null)[];
  /** Where each bar is drawn. */
  barX: { n: number; x0: number; x1: number }[];
}

type VF = typeof import('vexflow/bravura');
let vfPromise: Promise<VF> | null = null;

async function loadVexFlow(): Promise<VF> {
  if (vfPromise === null) {
    vfPromise = import('vexflow/bravura').then(async (mod) => {
      try {
        await Promise.race([document.fonts.load('30px Bravura'), new Promise((r) => setTimeout(r, 4000))]);
        await Promise.race([document.fonts.load('12px Academico'), new Promise((r) => setTimeout(r, 1500))]);
      } catch {
        /* the font arrives on its own */
      }
      return mod;
    });
  }
  return vfPromise;
}

/** Durations VexFlow can draw, longest first: [quarters, code, dots]. */
const DURS: [number, string, number][] = [
  [6, 'w', 1],
  [4, 'w', 0],
  [3.5, 'h', 2],
  [3, 'h', 1],
  [2, 'h', 0],
  [1.75, 'q', 2],
  [1.5, 'q', 1],
  [1, 'q', 0],
  [0.875, '8', 2],
  [0.75, '8', 1],
  [0.5, '8', 0],
  [0.375, '16', 1],
  [0.25, '16', 0],
  [0.1875, '32', 1],
  [0.125, '32', 0],
  [0.0625, '64', 0],
];

/** Split a length into drawable pieces (tied in the score). */
function decompose(q: number): [string, number][] {
  const out: [string, number][] = [];
  let left = q;
  let guard = 0;
  while (left > 0.03 && guard < 12) {
    guard += 1;
    const d = DURS.find((x) => x[0] <= left + 1e-4);
    if (d === undefined) break;
    out.push([d[1], d[2]]);
    left -= d[0];
  }
  if (out.length === 0) out.push(['64', 0]);
  return out;
}

function accText(alter: number): string {
  return alter === 1 ? '#' : alter === 2 ? '##' : alter === -1 ? 'b' : alter === -2 ? 'bb' : '';
}

export async function renderSheet(host: HTMLElement, model: Model, opts: { chords?: ChordSpan[] | null; pedal?: boolean } = {}): Promise<SheetLayout> {
  const V = await loadVexFlow();
  host.innerHTML = '';
  const renderer = new V.Renderer(host as HTMLDivElement, V.Renderer.Backends.SVG);
  const ctx = renderer.getContext();
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');

  const hands: ('R' | 'L')[] = [];
  if (model.voices.some((v) => v.hand === 'R')) hands.push('R');
  if (model.voices.some((v) => v.hand === 'L')) hands.push('L');
  const staffY: Record<string, number> = { R: 34, L: hands.length > 1 ? 150 : 34 };
  const height = hands.length > 1 ? 262 : 150;
  const clefOf = (h: 'R' | 'L'): string => model.voices.find((v) => v.hand === h)?.clef ?? (h === 'L' ? 'bass' : 'treble');
  const voicesOf = (h: 'R' | 'L'): number[] => model.voices.map((v, i) => (v.hand === h ? i : -1)).filter((i) => i >= 0);

  // Song notes by (voice, bar, onset, pitch), to tag each engraved note.
  const lookup = new Map<string, number>();
  model.notes.forEach((n, i) => {
    const bar = model.bars[n[7]];
    if (bar === undefined) return;
    lookup.set(`${n[6]}|${n[7]}|${Math.round((n[0] - bar.t) * 1000)}|${n[2]}`, i);
  });

  const noteEls: (Element | null)[] = new Array<Element | null>(model.notes.length).fill(null);
  const tagged: { note: InstanceType<VF['StaveNote']>; idx: number[] }[] = [];
  const xsRaw: { q: number; x: number }[] = [];
  const barX: SheetLayout['barX'] = [];
  const ties: InstanceType<VF['StaveTie']>[] = [];
  const pendingTie = new Map<string, { note: InstanceType<VF['StaveNote']>; index: number; idx: number }>();
  const keySpec = model.key.vex || 'C';
  const beamGroups = (meter: string): InstanceType<VF['Fraction']>[] => {
    const [a, b] = meter.split('/').map(Number);
    if (b === 8 && (a ?? 0) % 3 === 0) return [new V.Fraction(3, 8)];
    if (b === 2) return [new V.Fraction(1, 2)];
    return [new V.Fraction(1, 4)];
  };

  let x = 12;
  let prevMeter = '';
  let topLineY: number | null = null;
  let bottomLineY = 0;
  const draws: (() => void)[] = [];

  model.bars.forEach((bar, bi) => {
    const first = bi === 0;
    const meterChanged = bar.meter !== prevMeter && bar.meter !== 'free';
    prevMeter = bar.meter;
    const perStaff = new Map<string, { voices: InstanceType<VF['Voice']>[]; notes: InstanceType<VF['StaveNote']>[][]; beams: InstanceType<VF['Beam']>[]; tuplets: InstanceType<VF['Tuplet']>[] }>();

    for (const h of hands) {
      const clef = clefOf(h);
      const vidx = voicesOf(h);
      const multi = vidx.length > 1;
      const voices: InstanceType<VF['Voice']>[] = [];
      const allNotes: InstanceType<VF['StaveNote']>[][] = [];
      const tuplets: InstanceType<VF['Tuplet']>[] = [];
      vidx.forEach((v, order) => {
        const evs: Ev[] = model.events[v]?.[bi] ?? [];
        const notes: InstanceType<VF['StaveNote']>[] = [];
        const stem = multi ? (order % 2 === 0 ? V.Stem.UP : V.Stem.DOWN) : undefined;
        const groups = new Map<number, InstanceType<VF['StaveNote']>[]>();
        // A voice silent in this bar on a shared staff gets an invisible rest.
        if (evs.length === 0) {
          const g = new V.GhostNote({ duration: 'w' });
          notes.push(g as unknown as InstanceType<VF['StaveNote']>);
        }
        for (const ev of evs) {
          const tp = ev.tp;
          const base = tp !== undefined ? (ev.d * tp[0]) / tp[1] : ev.d;
          const pieces = ev.w ? ([['w', 0]] as [string, number][]) : decompose(base);
          let prevPiece: InstanceType<VF['StaveNote']> | null = null;
          pieces.forEach(([dur, dots], pi) => {
            let note: InstanceType<VF['StaveNote']>;
            if (ev.r) {
              if (ev.x) {
                note = new V.GhostNote({ duration: dur, dots }) as unknown as InstanceType<VF['StaveNote']>;
              } else {
                const restKey = multi ? (order % 2 === 0 ? (clef === 'bass' ? 'f/3' : 'd/5') : clef === 'bass' ? 'f/2' : 'd/4') : clef === 'bass' ? 'd/3' : 'b/4';
                note = new V.StaveNote({ keys: [restKey], duration: dur + 'r', dots, clef, alignCenter: ev.w === 1 });
              }
            } else {
              const keys = (ev.k ?? []).slice().sort((a, b) => a[0] - b[0]);
              const struct: ConstructorParameters<VF['StaveNote']>[0] = { keys: keys.map((k) => `${k[1].toLowerCase()}${accText(k[2])}/${k[3]}`), duration: dur, dots, clef };
              if (stem !== undefined) struct.stemDirection = stem;
              else struct.autoStem = true;
              note = new V.StaveNote(struct);
              if (pi === 0) {
                keys.forEach((k, ki) => {
                  if (k[5] > 0) {
                    const f = new V.FretHandFinger(String(k[5]));
                    f.setPosition(h === 'L' && !multi ? V.Modifier.Position.BELOW : V.Modifier.Position.ABOVE);
                    note.addModifier(f, ki);
                  }
                });
                if (ev.st) note.addModifier(new V.Articulation('a.').setPosition(V.Modifier.Position.ABOVE), 0);
                if (ev.dyn !== undefined) {
                  const ann = new V.Annotation(ev.dyn);
                  ann.setFont('Academico', 13, 'bold', 'italic');
                  ann.setVerticalJustification(V.Annotation.VerticalJustify.BOTTOM);
                  note.addModifier(ann, 0);
                }
              }
              // Which song notes this engraved note plays.
              const idx: number[] = [];
              keys.forEach((k, ki) => {
                const found = lookup.get(`${v}|${bi}|${Math.round(ev.t * 1000)}|${k[0]}`);
                const tieKey = `${v}|${k[0]}`;
                const from = pi === 0 ? pendingTie.get(tieKey) : undefined;
                if (pi === 0 && from !== undefined) {
                  ties.push(new V.StaveTie({ firstNote: from.note, lastNote: note, firstIndexes: [from.index], lastIndexes: [ki] }));
                  pendingTie.delete(tieKey);
                  idx.push(from.idx);
                } else if (found !== undefined) idx.push(found);
                if (pi === pieces.length - 1 && k[4] === 1) pendingTie.set(tieKey, { note, index: ki, idx: found ?? from?.idx ?? -1 });
              });
              if (pi === 0 && prevPiece === null) {
                for (const key of Object.keys(Object.fromEntries(pendingTie))) {
                  if (key.startsWith(`${v}|`) && !keys.some((k) => key === `${v}|${k[0]}`)) pendingTie.delete(key);
                }
              }
              if (prevPiece !== null) {
                const ix = keys.map((_, ki) => ki);
                ties.push(new V.StaveTie({ firstNote: prevPiece, lastNote: note, firstIndexes: ix, lastIndexes: ix }));
              }
              tagged.push({ note, idx: idx.filter((i) => i >= 0) });
            }
            if (dots > 0) V.Dot.buildAndAttach([note], { all: true });
            if (tp !== undefined) {
              const g = groups.get(tp[2]) ?? [];
              g.push(note);
              groups.set(tp[2], g);
            }
            notes.push(note);
            prevPiece = ev.r ? null : note;
            xsRaw.push({ q: bar.t + ev.t, x: -1 });
            (note as unknown as { __q: number }).__q = bar.t + ev.t + pi * 0.0001;
          });
        }
        for (const [id, g] of groups) {
          const evTp = evs.find((e) => e.tp !== undefined && e.tp[2] === id)?.tp;
          if (evTp !== undefined && g.length > 1) tuplets.push(new V.Tuplet(g, { numNotes: evTp[0], notesOccupied: evTp[1] }));
        }
        const [num, den] = bar.meter === 'free' ? [Math.max(1, Math.round(bar.len * 4)), 16] : (bar.meter.split('/').map(Number) as [number, number]);
        const voice = new V.Voice({ numBeats: num ?? 4, beatValue: den ?? 4 }).setMode(V.Voice.Mode.SOFT);
        voice.addTickables(notes);
        voices.push(voice);
        allNotes.push(notes);
      });
      if (voices.length > 0) {
        try {
          V.Accidental.applyAccidentals(voices, keySpec);
        } catch {
          /* drawn without courtesy logic */
        }
      }
      const beams: InstanceType<VF['Beam']>[] = [];
      allNotes.forEach((ns) => {
        const stemmable = ns.filter((n) => !(n instanceof V.GhostNote));
        try {
          beams.push(...V.Beam.generateBeams(stemmable, { groups: beamGroups(bar.meter), maintainStemDirections: vidx.length > 1 }));
        } catch {
          /* unbeamed */
        }
      });
      perStaff.set(h, { voices, notes: allNotes, beams, tuplets });
    }

    // Width: what the notes need, plus the clef, key and time at the start.
    const all = hands.flatMap((h) => perStaff.get(h)?.voices ?? []);
    const fmt = new V.Formatter();
    for (const h of hands) {
      const vs = perStaff.get(h)?.voices ?? [];
      if (vs.length > 0) fmt.joinVoices(vs);
    }
    let minW = 60;
    try {
      minW = fmt.preCalculateMinTotalWidth(all);
    } catch {
      minW = 60 + bar.len * 40;
    }
    const noteW = Math.max(70, minW * 1.5 + 28, bar.len * 34);
    const staves: Record<string, InstanceType<VF['Stave']>> = {};
    for (const h of hands) {
      const s = new V.Stave(x, staffY[h] ?? 34, 100);
      if (first) {
        s.addClef(clefOf(h));
        s.addKeySignature(keySpec);
      }
      if (meterChanged && bar.meter !== 'free') s.addTimeSignature(model.meter.label === 'C' ? 'C' : bar.meter);
      if (h === hands[0]) s.setMeasure(bar.n);
      if (bi === model.bars.length - 1) s.setEndBarType(V.Barline.type.END);
      staves[h] = s;
    }
    V.Stave.formatBegModifiers(hands.map((h) => staves[h]!).filter(Boolean));
    if (topLineY === null) {
      topLineY = staves[hands[0]!]?.getYForLine(0) ?? 0;
      bottomLineY = staves[hands[hands.length - 1]!]?.getYForLine(4) ?? 0;
    }
    const head = (staves[hands[0]!]?.getNoteStartX() ?? x) - x;
    const width = head + noteW;
    for (const h of hands) staves[h]?.setWidth(width);
    for (const h of hands) {
      const st = perStaff.get(h);
      const s = staves[h];
      if (st === undefined || s === undefined) continue;
      for (const v of st.voices) v.setStave(s);
    }
    try {
      fmt.format(all, Math.max(30, noteW - 18));
    } catch {
      /* drawn as formatted */
    }
    const x0 = x;
    barX.push({ n: bar.n, x0, x1: x0 + width });
    xsRaw.push({ q: bar.t, x: x0 + head - 4 });
    x += width;

    draws.push(() => {
      for (const h of hands) staves[h]?.setContext(ctx).draw();
      if (hands.length > 1) {
        const t = staves.R!;
        const b = staves.L!;
        if (first) new V.StaveConnector(t, b).setType('brace').setContext(ctx).draw();
        new V.StaveConnector(t, b).setType('singleLeft').setContext(ctx).draw();
        if (bi === model.bars.length - 1) new V.StaveConnector(t, b).setType('boldDoubleRight').setContext(ctx).draw();
      }
      for (const h of hands) {
        const st = perStaff.get(h);
        const s = staves[h];
        if (st === undefined || s === undefined) continue;
        for (const v of st.voices) v.draw(ctx, s);
        for (const b of st.beams) b.setContext(ctx).draw();
        for (const t of st.tuplets) t.setContext(ctx).draw();
      }
    });
  });

  const width = x + 40;
  const pedal = opts.pedal === true ? (model.pedal ?? []) : [];
  const fullHeight = height + (pedal.length > 0 ? 24 : 0);
  renderer.resize(width, fullHeight);
  for (const d of draws) d();
  for (const t of ties) {
    try {
      t.setContext(ctx).draw();
    } catch {
      /* a tie VexFlow cannot place */
    }
  }

  // Tag engraved notes; collect the time → x map from their positions.
  const xs: { q: number; x: number }[] = [];
  for (const b of barX) {
    const bar = model.bars.find((m) => m.n === b.n);
    if (bar !== undefined) xs.push({ q: bar.t, x: b.x0 + 8 });
  }
  for (const { note, idx } of tagged) {
    const el = note.getSVGElement() ?? null;
    const q = (note as unknown as { __q?: number }).__q;
    if (q !== undefined) {
      try {
        xs.push({ q: Math.round(q * 1000) / 1000, x: note.getAbsoluteX() + 6 });
      } catch {
        /* not positioned */
      }
    }
    for (const i of idx) if (i >= 0 && i < noteEls.length) noteEls[i] = el;
    if (el !== null) el.setAttribute('data-n', idx.join(','));
  }
  const last = model.bars[model.bars.length - 1];
  const lastX = barX[barX.length - 1];
  if (last !== undefined && lastX !== undefined) xs.push({ q: last.t + last.len, x: lastX.x1 - 6 });
  xs.sort((a, b) => a.q - b.q || a.x - b.x);
  // One x per time, never going back.
  const clean: { q: number; x: number }[] = [];
  for (const p of xs) {
    const prev = clean[clean.length - 1];
    if (prev !== undefined && Math.abs(prev.q - p.q) < 1e-3) {
      prev.x = Math.min(prev.x, p.x);
      continue;
    }
    if (prev !== undefined && p.x <= prev.x) continue;
    clean.push({ ...p });
  }
  void xsRaw;
  const out: SheetLayout = { width, height: fullHeight, xs: clean, noteEls, barX };

  // Chord symbols over the top staff.
  const chords = opts.chords ?? [];
  if (chords.length > 0 && topLineY !== null) {
    ctx.save();
    ctx.setFont('Inter Variable, Inter, sans-serif', 13, 600);
    for (const c of chords) ctx.fillText(c.sym, xAt(out, c.t) - 3, topLineY - 24);
    ctx.restore();
  }
  // The pedal under the bottom staff: a bracket per press, a notch at each change.
  if (pedal.length > 0) {
    const y = bottomLineY + 34;
    ctx.save();
    ctx.setLineWidth(1.2);
    ctx.setFont('Inter Variable, Inter, sans-serif', 11, 500);
    let prevEnd = -1;
    for (const [a, b] of pedal) {
      const x0 = xAt(out, a) - 4;
      const x1 = Math.max(x0 + 8, xAt(out, b) - 7);
      if (Math.abs(a - prevEnd) > 1e-6) ctx.fillText('Ped.', x0 - 2, y - 10);
      ctx.beginPath();
      ctx.moveTo(x0, y - 7);
      ctx.lineTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.lineTo(x1 + 3, y - 7);
      ctx.stroke();
      prevEnd = b;
    }
    ctx.restore();
  }
  return out;
}

/** x of a song time on the engraved strip (linear between known points). */
export function xAt(layout: SheetLayout, q: number): number {
  const xs = layout.xs;
  if (xs.length === 0) return 0;
  const first = xs[0]!;
  if (q <= first.q) return first.x - (first.q - q) * 60;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid]!.q <= q) lo = mid;
    else hi = mid - 1;
  }
  const a = xs[lo]!;
  const b = xs[lo + 1];
  if (b === undefined) return a.x;
  return a.x + ((q - a.q) / (b.q - a.q)) * (b.x - a.x);
}
