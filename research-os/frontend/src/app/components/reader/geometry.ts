/**
 * The stored text layer's geometry, the same walk the server makes
 * (pb_hooks/lib_text.js): item offsets in the page text, and rectangles for
 * a range. Used for find hits and for mapping a selection to offsets.
 */
import type { Item, Rect } from '../../lib/types.ts';

const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500,
  667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500,
  722, 500, 500, 500, 334, 260, 334, 584,
];

function charW(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return WIDTHS[c - 32] as number;
  if (c >= 0x2e80) return 1000;
  return 556;
}

function widthOf(s: string, a: number, b: number): number {
  let w = 0;
  for (let i = a; i < b; i++) w += charW(s.charAt(i));
  return w;
}

export function itemOffsets(items: Item[]): number[] {
  const out: number[] = [];
  let pos = 0;
  for (const it of items) {
    out.push(pos);
    pos += it[0].length + (it[6] ? 1 : 0);
  }
  return out;
}

export function pageText(items: Item[]): string {
  let t = '';
  for (const it of items) t += it[0] + (it[6] ? '\n' : '');
  return t;
}

export function rectsFor(items: Item[], starts: number[], start: number, end: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Item;
    const s = it[0];
    const a0 = starts[i] as number;
    const a1 = a0 + s.length;
    if (s.length === 0 || a1 <= start || a0 >= end) continue;
    const from = Math.max(0, start - a0);
    const to = Math.min(s.length, end - a0);
    const total = widthOf(s, 0, s.length) || 1;
    const x0 = it[1] + (it[4] * widthOf(s, 0, from)) / total;
    const w = (it[4] * widthOf(s, from, to)) / total;
    const r: Rect = [x0, it[2], w, it[3], it[5] || 0];
    const last = out[out.length - 1];
    if (last && last[4] === r[4] && Math.abs(last[1] - r[1]) < r[3] * 0.5 && r[0] - (last[0] + last[2]) < r[3] * 1.2 && r[0] >= last[0] - 1) {
      const right = Math.max(last[0] + last[2], r[0] + r[2]);
      last[2] = right - last[0];
      last[3] = Math.max(last[3], r[3]);
    } else out.push(r);
  }
  return out;
}

/** Every place a query occurs in a page's text (case-insensitive), as [start, end]. */
export function occurrences(text: string, q: string): [number, number][] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hay = text.toLowerCase().replace(/\n/g, ' ');
  const out: [number, number][] = [];
  let i = hay.indexOf(needle);
  while (i >= 0 && out.length < 500) {
    out.push([i, i + needle.length]);
    i = hay.indexOf(needle, i + needle.length);
  }
  return out;
}

/** The horizontal stretch a span needs so the stored item covers the drawn glyphs (independent of zoom). */
const measure = (() => {
  let ctx: CanvasRenderingContext2D | null = null;
  return (s: string): number => {
    if (ctx === null) {
      const c = document.createElement('canvas');
      ctx = c.getContext('2d');
      if (ctx !== null) ctx.font = '100px sans-serif';
    }
    return ctx === null ? s.length * 50 : ctx.measureText(s).width;
  };
})();

export function stretchOf(it: Item): number {
  const w100 = measure(it[0]);
  if (w100 <= 0 || it[3] <= 0) return 1;
  return (it[4] * 100) / (w100 * it[3]);
}
