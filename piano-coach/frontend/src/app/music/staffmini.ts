/**
 * A small staff for drills and lessons: one clef (or the grand staff), a key
 * signature, and a few notes or chords as whole notes (or a melody with
 * given durations; an item without notes is a rest). Accidentals the
 * signature already gives are not repeated. Drawn with VexFlow straight in
 * the browser, no server.
 */
import type { Note } from './theory.ts';
import { LETTERS, midiOf, signature, vexKey, vexKeySpec } from './theory.ts';

type VF = typeof import('vexflow/bravura');
let vf: Promise<VF> | null = null;
function load(): Promise<VF> {
  if (vf === null) {
    vf = import('vexflow/bravura').then(async (m) => {
      try {
        await Promise.race([document.fonts.load('30px Bravura'), new Promise((r) => setTimeout(r, 4000))]);
      } catch {
        /* drawn when the font arrives */
      }
      return m;
    });
  }
  return vf;
}

export interface MiniItem {
  /** Notes sounding together (a chord) or one note. Empty = a rest. */
  notes: Note[];
  /** VexFlow duration: 'w', 'h', 'q', '8', '16' (with 'd' for dotted). */
  dur?: string;
  /** Text above (a chord symbol, a Roman numeral, an interval). */
  label?: string;
  /** Colour of the notes (a CSS colour). */
  color?: string;
}

export interface MiniOpts {
  clef: 'treble' | 'bass' | 'grand';
  fifths?: number;
  time?: string;
  items: MiniItem[];
  width?: number;
  scale?: number;
}

/** Which staff a note belongs on in the grand staff. */
function onTreble(n: Note): boolean {
  return midiOf(n) >= 60;
}

export async function drawMini(host: HTMLElement, o: MiniOpts): Promise<void> {
  const V = await load();
  host.innerHTML = '';
  const scale = o.scale ?? 1;
  const grand = o.clef === 'grand';
  const perItem = o.items.length <= 1 ? 90 : o.items.some((i) => i.dur !== undefined && i.dur !== 'w') ? 46 : 70;
  const keyW = Math.abs(o.fifths ?? 0) * 10;
  const width = o.width ?? Math.max(150, 90 + keyW + (o.time ? 24 : 0) + o.items.length * perItem);
  const height = grand ? 250 : 140;
  const renderer = new V.Renderer(host as HTMLDivElement, V.Renderer.Backends.SVG);
  renderer.resize(width * scale, height * scale);
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);
  ctx.setFillStyle('currentColor');
  ctx.setStrokeStyle('currentColor');
  const key = vexKeySpec(o.fifths ?? 0);
  // What the signature already says: only differences get an accidental.
  const keyAlt = new Map<number, number>();
  for (const x of signature(o.fifths ?? 0)) keyAlt.set(LETTERS.indexOf(x.letter as (typeof LETTERS)[number]), x.a);
  const staves: { clef: 'treble' | 'bass'; stave: InstanceType<VF['Stave']> }[] = [];
  const top = grand ? 20 : 26;
  const clefs: ('treble' | 'bass')[] = grand ? ['treble', 'bass'] : [o.clef as 'treble' | 'bass'];
  clefs.forEach((c, i) => {
    const s = new V.Stave(10, top + i * 110, width - 20);
    s.addClef(c);
    if ((o.fifths ?? 0) !== 0) s.addKeySignature(key);
    if (o.time !== undefined) s.addTimeSignature(o.time);
    staves.push({ clef: c, stave: s });
  });
  V.Stave.formatBegModifiers(staves.map((s) => s.stave));
  for (const s of staves) s.stave.setContext(ctx).draw();
  if (grand) {
    const a = staves[0]!.stave;
    const b = staves[1]!.stave;
    new V.StaveConnector(a, b).setType('brace').setContext(ctx).draw();
    new V.StaveConnector(a, b).setType('singleLeft').setContext(ctx).draw();
    new V.StaveConnector(a, b).setType('singleRight').setContext(ctx).draw();
  }
  if (o.items.length === 0) return;

  const voices: InstanceType<VF['Voice']>[] = [];
  const all: { stave: InstanceType<VF['Stave']>; voice: InstanceType<VF['Voice']>; notes: InstanceType<VF['StaveNote']>[] }[] = [];
  for (const st of staves) {
    const notes: InstanceType<VF['StaveNote']>[] = [];
    for (const it of o.items) {
      const mine = grand ? it.notes.filter((n) => onTreble(n) === (st.clef === 'treble')) : it.notes;
      const dur = it.dur ?? 'w';
      const dotted = dur.endsWith('d');
      const base = dotted ? dur.slice(0, -1) : dur;
      let sn: InstanceType<VF['StaveNote']>;
      if (mine.length === 0 && it.notes.length === 0) {
        // A rest (on both staves of the grand staff).
        sn = new V.StaveNote({ keys: [st.clef === 'bass' ? 'd/3' : 'b/4'], duration: base + 'r', dots: dotted ? 1 : 0, clef: st.clef });
        if (dotted) V.Dot.buildAndAttach([sn], { all: true });
      } else if (mine.length === 0) {
        sn = new V.GhostNote({ duration: base }) as unknown as InstanceType<VF['StaveNote']>;
      } else {
        const sorted = mine.slice().sort((a, b) => midiOf(a) - midiOf(b));
        sn = new V.StaveNote({ keys: sorted.map(vexKey), duration: base, dots: dotted ? 1 : 0, clef: st.clef, autoStem: true });
        sorted.forEach((n, i) => {
          if (n.a === (keyAlt.get(n.l) ?? 0)) return;
          sn.addModifier(new V.Accidental(n.a === 1 ? '#' : n.a === 2 ? '##' : n.a === -1 ? 'b' : n.a === -2 ? 'bb' : 'n'), i);
        });
        if (dotted) V.Dot.buildAndAttach([sn], { all: true });
        if (it.color !== undefined) sn.setStyle({ fillStyle: it.color, strokeStyle: it.color });
      }
      notes.push(sn);
    }
    const voice = new V.Voice({ numBeats: 4, beatValue: 4 }).setMode(V.Voice.Mode.SOFT);
    voice.addTickables(notes);
    voices.push(voice);
    all.push({ stave: st.stave, voice, notes });
  }
  // Beams first (they set the stems), then format and draw.
  const beams: InstanceType<VF['Beam']>[] = [];
  for (const a of all) {
    const beamable = a.notes.filter((n) => !(n instanceof V.GhostNote) && !n.isRest());
    try {
      beams.push(...V.Beam.generateBeams(beamable));
    } catch {
      /* unbeamed */
    }
  }
  const fmt = new V.Formatter();
  for (const v of voices) fmt.joinVoices([v]);
  const st0 = staves[0]!.stave;
  fmt.format(voices, Math.max(40, st0.getNoteEndX() - st0.getNoteStartX() - 16));
  for (const a of all) a.voice.draw(ctx, a.stave);
  for (const b of beams) b.setContext(ctx).draw();

  // Labels (chord symbols, numerals, fingers) on one line above the top staff.
  const first = all[0];
  if (first === undefined || !o.items.some((it) => it.label !== undefined)) return;
  let y = first.stave.getYForLine(0) - 12;
  for (const n of first.notes) {
    if (n instanceof V.GhostNote) continue;
    const ys = n.getYs();
    const bb = n.getBoundingBox();
    const hi = Math.min(...ys, bb.getY());
    if (Number.isFinite(hi)) y = Math.min(y, hi - 10);
  }
  ctx.save();
  ctx.setFont('Inter Variable, Inter, sans-serif', 12.5, 600);
  o.items.forEach((it, i) => {
    if (it.label === undefined) return;
    // In the grand staff, place over whichever staff has the item's note.
    const holder = all.find((a) => !(a.notes[i] instanceof V.GhostNote)) ?? first;
    const n = holder.notes[i];
    if (n === undefined) return;
    const x = n.getAbsoluteX() + n.getGlyphWidth() / 2;
    const w = ctx.measureText(it.label).width;
    if (it.color !== undefined) ctx.setFillStyle(it.color);
    else ctx.setFillStyle('currentColor');
    ctx.fillText(it.label, x - w / 2, y);
  });
  ctx.restore();
}
