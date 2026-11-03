/**
 * The pitch lane: the melody scrolling right to left past a fixed now-line
 * (at 28% of the width), one hairline per semitone (the tonic's heavier),
 * the singer's passaggio as a faint band, the notes as hollow bars as long
 * as they last, the words under them, and the voice as a ribbon: its centre
 * is the pitch, its width the loudness (like Melodyne's blobs), so a vibrato
 * reads as an even wave, a scoop as a curve into the bar and a drift as a
 * lean. A voice singing an octave away is drawn in the melody's octave.
 *
 * After a note is judged it shows its mark: ✓ on, ~ close, ♭ or ♯ with the
 * cents when off, ○ missed, ↗ a scoop, ↘ a fall. Red only marks a note off
 * or missed, always with a glyph.
 */
import type { NoteResult, TFrame } from './judge.ts';
import { ST_CLOSE, ST_FREE, ST_MISSED, ST_OFF, ST_ON, fold } from './judge.ts';
import { noteLabel } from './dial.ts';

export interface LaneNote {
  t: number;
  d: number;
  midi: number;
  flags: number;
  syl: string;
  bar: number;
}

export interface LaneState {
  /** Seconds on the take's clock at the now-line. */
  heard: number;
  notes: LaneNote[];
  frames: TFrame[];
  judged: (NoteResult | null)[];
  current: number;
  /** Bar starts on the take's clock with their numbers. */
  barLines: { s: number; n: number }[];
  ribbon: boolean;
  lyrics: boolean;
  targets: boolean;
  marks: boolean;
  /** Absolute MIDI of the singer's passaggio band, or null. */
  passaggio: [number, number] | null;
  /** Pitch class of the key's tonic. */
  tonicPc: number;
  /** 'hear' dims the voice while the app sings (echo). */
  hearing: boolean;
  /** A vowel to show when the song has no words. */
  vowel: string;
}

interface Theme {
  ink: string;
  ink2: string;
  muted: string;
  faint: string;
  line: string;
  hair: string;
  voice: string;
  bad: string;
  sunk: string;
  mono: string;
  sans: string;
}

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v === '' ? fallback : v;
}

export class Lane {
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Seconds across the width. */
  span = 9;
  private th: Theme = { ink: '#1b2024', ink2: '#3a4247', muted: '#6b757b', faint: '#9aa3a8', line: '#c9d0d4', hair: '#e2e6e8', voice: '#2f6fe4', bad: '#dc2626', sunk: '#eef1f2', mono: 'monospace', sans: 'sans-serif' };
  private lo = 55;
  private hi = 72;

  constructor(canvas: HTMLCanvasElement) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.readTheme();
  }

  readTheme(): void {
    const el = this.c;
    this.th = {
      ink: cssVar(el, '--sc-ink', '#1b2024'),
      ink2: cssVar(el, '--sc-ink-2', '#3a4247'),
      muted: cssVar(el, '--sc-muted', '#6b757b'),
      faint: cssVar(el, '--sc-faint', '#9aa3a8'),
      line: cssVar(el, '--sc-line', '#c9d0d4'),
      hair: cssVar(el, '--sc-hair', '#e2e6e8'),
      voice: cssVar(el, '--sc-voice', '#2f6fe4'),
      bad: cssVar(el, '--sc-bad', '#dc2626'),
      sunk: cssVar(el, '--sc-sunk', '#eef1f2'),
      mono: cssVar(el, '--sc-mono', 'ui-monospace, monospace'),
      sans: cssVar(el, '--sc-font', 'Inter, sans-serif'),
    };
  }

  resize(w: number, h: number): void {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.c.width = Math.max(1, Math.round(w * dpr));
    this.c.height = Math.max(1, Math.round(h * dpr));
    this.c.style.width = w + 'px';
    this.c.style.height = h + 'px';
    this.span = w < 560 ? 6 : w < 900 ? 8 : 10;
  }

  /** The rows to show: the melody's range with room around it. */
  setRange(notes: LaneNote[]): void {
    let lo = 127;
    let hi = 0;
    for (const n of notes) {
      if (n.flags & 1) continue;
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
    if (lo > hi) {
      lo = 57;
      hi = 69;
    }
    lo -= 2;
    hi += 2;
    while (hi - lo < 13) {
      lo -= 1;
      if (hi - lo < 13) hi += 1;
    }
    this.lo = lo;
    this.hi = hi;
  }

  private lyricH(): number {
    return this.h < 220 ? 24 : 30;
  }

  /** y of a (fractional) MIDI pitch: the centre of its row. */
  private y(m: number): number {
    const top = 18;
    const bottom = this.h - this.lyricH() - 6;
    const rows = this.hi - this.lo + 1;
    const rh = (bottom - top) / rows;
    return bottom - (m - this.lo + 0.5) * rh;
  }

  private rowH(): number {
    const top = 18;
    const bottom = this.h - this.lyricH() - 6;
    return (bottom - top) / (this.hi - this.lo + 1);
  }

  draw(st: LaneState): void {
    const g = this.g;
    if (g === null || this.w === 0) return;
    const t = this.th;
    const w = this.w;
    const h = this.h;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const nowX = Math.round(w * 0.28);
    const pps = w / this.span;
    const x = (s: number): number => nowX + (s - st.heard) * pps;
    const rh = this.rowH();
    const lyrTop = h - this.lyricH();

    // Passaggio band.
    if (st.passaggio !== null) {
      const [a, b] = st.passaggio;
      const ya = this.y(Math.min(b, this.hi + 0.5)) - rh / 2;
      const yb = this.y(Math.max(a, this.lo - 0.5)) + rh / 2;
      if (b >= this.lo && a <= this.hi && yb > ya) {
        g.fillStyle = t.ink;
        g.globalAlpha = 0.04;
        g.fillRect(0, ya, w, yb - ya);
        g.globalAlpha = 1;
      }
    }
    // Semitone rows; the tonic's heavier; names of C and the tonic at the left.
    g.font = '500 9px ' + t.mono;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    for (let m = this.lo; m <= this.hi; m++) {
      const y = Math.round(this.y(m) + rh / 2) + 0.5;
      const tonic = ((m % 12) + 12) % 12 === st.tonicPc;
      g.strokeStyle = tonic ? t.line : t.hair;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      if (tonic || m % 12 === 0) {
        g.fillStyle = tonic ? t.muted : t.faint;
        g.fillText(noteLabel(m), 6, this.y(m));
      }
    }
    // Bar lines and numbers.
    g.textAlign = 'center';
    for (const b of st.barLines) {
      const bx = Math.round(x(b.s)) + 0.5;
      if (bx < -2 || bx > w + 2) continue;
      g.strokeStyle = t.line;
      g.globalAlpha = 0.8;
      g.beginPath();
      g.moveTo(bx, 14);
      g.lineTo(bx, lyrTop - 2);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = t.faint;
      g.fillText(String(b.n), bx, 8);
    }
    // Notes.
    if (st.targets) {
      for (let i = 0; i < st.notes.length; i++) {
        const n = st.notes[i]!;
        const x0 = x(n.t);
        const x1 = x(n.t + n.d);
        if (x1 < -4 || x0 > w + 4) continue;
        const r = st.judged[i] ?? null;
        const cur = i === st.current;
        const spoken = (n.flags & 1) !== 0;
        const free = (n.flags & 2) !== 0;
        const yc = spoken ? this.y(this.lo) : this.y(n.midi);
        const bh = Math.max(5, Math.min(14, rh * 0.82));
        const bx = x0 + 1;
        const bw = Math.max(3, x1 - x0 - 2);
        const by = yc - bh / 2;
        g.beginPath();
        g.roundRect(bx, by, bw, bh, 2);
        if (r !== null && st.marks && r.status !== ST_FREE) {
          if (r.status === ST_ON) {
            g.fillStyle = t.voice;
            g.globalAlpha = 0.26;
            g.fill();
          } else if (r.status === ST_CLOSE) {
            g.fillStyle = t.voice;
            g.globalAlpha = 0.13;
            g.fill();
          }
          g.globalAlpha = 1;
          g.strokeStyle = r.status === ST_OFF || r.status === ST_MISSED ? t.bad : t.ink2;
          g.lineWidth = 1;
          if (r.status === ST_MISSED) g.setLineDash([3, 3]);
          g.stroke();
          g.setLineDash([]);
        } else {
          if (cur) {
            g.fillStyle = t.ink;
            g.globalAlpha = 0.07;
            g.fill();
            g.globalAlpha = 1;
          }
          g.strokeStyle = cur ? t.ink : t.ink2;
          g.lineWidth = cur ? 1.6 : 1;
          if (spoken) g.setLineDash([4, 3]);
          if (free) g.setLineDash([1, 3]);
          g.globalAlpha = st.hearing ? 0.55 : 1;
          g.stroke();
          g.setLineDash([]);
          g.globalAlpha = 1;
        }
        // A breath mark before the note.
        if (n.flags & 4) {
          g.fillStyle = t.muted;
          g.font = '600 13px ' + t.sans;
          g.textAlign = 'center';
          g.fillText(',', x0 - 5, by - 6);
        }
        // The mark of a judged note.
        if (r !== null && st.marks && r.status !== ST_FREE) {
          const glyph = r.status === ST_ON ? '✓' : r.status === ST_CLOSE ? '~' : r.status === ST_MISSED ? '○' : (r.cents ?? 0) < 0 ? '♭' + Math.abs(r.cents ?? 0) : '♯' + Math.abs(r.cents ?? 0);
          const extra = r.scoop ? ' ↗' : r.fall ? ' ↘' : '';
          g.font = '600 9.5px ' + t.mono;
          g.textAlign = 'left';
          g.fillStyle = r.status === ST_OFF || r.status === ST_MISSED ? t.bad : t.muted;
          g.fillText(glyph + extra, bx + 1, by - 7);
        }
      }
    }
    // The voice ribbon.
    if (st.ribbon && st.frames.length > 1) {
      const from = st.heard - this.span * 0.28 - 0.2;
      const pts: { x: number; y: number; r: number }[][] = [];
      let run: { x: number; y: number; r: number }[] = [];
      let ni = 0;
      for (const f of st.frames) {
        if (f.s < from || f.s > st.heard + 0.05) continue;
        if (!Number.isFinite(f.midi)) {
          if (run.length > 1) pts.push(run);
          run = [];
          continue;
        }
        // Draw it in the octave of the note sung at that moment.
        while (ni + 1 < st.notes.length && st.notes[ni + 1]!.t <= f.s) ni++;
        const ref = st.notes[ni];
        const m = ref !== undefined ? ref.midi + fold(f.midi, ref.midi) / 100 : f.midi;
        const loud = Math.max(0, Math.min(1, (f.db + 52) / 44));
        run.push({ x: x(f.s), y: this.y(m), r: 1 + loud * 3.6 });
      }
      if (run.length > 1) pts.push(run);
      g.fillStyle = t.voice;
      g.strokeStyle = t.voice;
      for (const r of pts) {
        g.globalAlpha = st.hearing ? 0.2 : 0.42;
        g.beginPath();
        g.moveTo(r[0]!.x, r[0]!.y - r[0]!.r);
        for (const p of r) g.lineTo(p.x, p.y - p.r);
        for (let i = r.length - 1; i >= 0; i--) g.lineTo(r[i]!.x, r[i]!.y + r[i]!.r);
        g.closePath();
        g.fill();
        g.globalAlpha = st.hearing ? 0.4 : 1;
        g.lineWidth = 1.3;
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(r[0]!.x, r[0]!.y);
        for (const p of r) g.lineTo(p.x, p.y);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // The words.
    if (st.lyrics) {
      g.fillStyle = t.sunk;
      g.fillRect(0, lyrTop, w, this.lyricH());
      g.strokeStyle = t.hair;
      g.beginPath();
      g.moveTo(0, lyrTop + 0.5);
      g.lineTo(w, lyrTop + 0.5);
      g.stroke();
      const ly = lyrTop + this.lyricH() / 2 + 1;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      const anyWords = st.notes.some((n) => n.syl !== '' && n.syl !== '_');
      for (let i = 0; i < st.notes.length; i++) {
        const n = st.notes[i]!;
        const x0 = x(n.t);
        if (x0 > w + 4 || x(n.t + n.d) < -60) continue;
        let syl = n.syl;
        if (!anyWords) syl = i === 0 || (n.flags & 4) !== 0 || (st.notes[i - 1] !== undefined && n.t - (st.notes[i - 1]!.t + st.notes[i - 1]!.d) > 0.05) ? st.vowel : '_';
        if (syl === '') continue;
        const past = n.t + n.d < st.heard;
        const cur = i === st.current;
        if (syl === '_') {
          // A melisma: an extender line under the held syllable.
          g.strokeStyle = cur ? t.ink : past ? t.faint : t.muted;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x0 + 1, ly + 6);
          g.lineTo(x(n.t + n.d) - 2, ly + 6);
          g.stroke();
          continue;
        }
        const hy = syl.endsWith('-');
        const text = hy ? syl.slice(0, -1) : syl;
        g.font = (cur ? '600 ' : '500 ') + (this.h < 220 ? '12px ' : '13.5px ') + t.sans;
        g.fillStyle = cur ? t.ink : past ? t.faint : t.ink2;
        g.fillText(text, x0 + 1, ly);
        if (hy) {
          const tw = g.measureText(text).width;
          const nx = i + 1 < st.notes.length ? x(st.notes[i + 1]!.t) : x0 + tw + 14;
          const hx = Math.max(x0 + tw + 4, (x0 + tw + nx) / 2 - 2);
          g.fillStyle = past ? t.faint : t.muted;
          g.fillText('-', hx, ly);
        }
      }
    }
    // The now-line.
    g.strokeStyle = t.ink;
    g.lineWidth = 1;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.moveTo(nowX + 0.5, 12);
    g.lineTo(nowX + 0.5, lyrTop);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = t.ink;
    g.beginPath();
    g.moveTo(nowX - 4, 8);
    g.lineTo(nowX + 5, 8);
    g.lineTo(nowX + 0.5, 13);
    g.closePath();
    g.fill();
  }
}
