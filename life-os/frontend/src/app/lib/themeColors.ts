/**
 * The app's colors, derived from the host theme.
 *
 * The host (CraftBot) sets the kit tokens (--agent-app-bg, -surface, -text,
 * -muted, -border, -accent, -accent-contrast) per theme pack, light or dark
 * mode, and custom colors. This module reads what they resolve to and writes
 * the app's --lo-* tokens on <html>, re-running whenever the theme changes.
 *
 * The look is a calm, illustrated one: warm paper, cream cards, a deep
 * "grove" sidebar and landscapes, all in the family of the theme's accent
 * (an orange accent gives an autumn grove, a green one a forest, an ink
 * theme a pencil drawing). Every pairing is checked: a color only goes where
 * it contrasts with what sits under it; otherwise it is moved until it does.
 *
 * Areas of life get ten color slots spread around the accent's hue, each
 * with a soft fill and a text variant that reads at 4.5:1.
 */

import { useEffect, useState } from 'react';

export type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const RED: RGB = [214, 76, 58];
const GREEN: RGB = [80, 150, 98];
const AMBER: RGB = [224, 160, 56];

/* ------------------------------------------------------------ color math */

export function mix(a: RGB, b: RGB, p: number): RGB {
  return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
}

function lin(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function unlin(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, v * 255));
}

function lum(c: RGB): number {
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG contrast ratio. */
export function contrast(a: RGB, b: RGB): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function oklab(c: RGB): [number, number, number] {
  const r = lin(c[0]);
  const g = lin(c[1]);
  const b = lin(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromOklabRaw(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

export interface LCH {
  l: number;
  c: number;
  h: number;
}

export function toLch(c: RGB): LCH {
  const [L, a, b] = oklab(c);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l: L, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

/** An OKLCH color as sRGB, its chroma reduced until it fits the gamut. */
export function lch(l: number, c: number, h: number): RGB {
  const L = Math.max(0, Math.min(1, l));
  const rad = (h * Math.PI) / 180;
  let lo = 0;
  let hi = Math.max(0, c);
  const fits = (cc: number): boolean => {
    const [r, g, b] = fromOklabRaw(L, cc * Math.cos(rad), cc * Math.sin(rad));
    return r >= -0.0005 && r <= 1.0005 && g >= -0.0005 && g <= 1.0005 && b >= -0.0005 && b <= 1.0005;
  };
  if (!fits(hi)) {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    hi = lo;
  }
  const [r, g, b] = fromOklabRaw(L, hi * Math.cos(rad), hi * Math.sin(rad));
  return [unlin(r), unlin(g), unlin(b)];
}

/** A hue blended toward another along the shorter way round (p = 0 keeps `a`, 1 gives `b`). */
export function hueMix(a: number, b: number, p: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * p + 360) % 360;
}

/** Perceptual distance (OKLab); about 0.02 is just visible, 0.1 clearly different. */
export function distance(a: RGB, b: RGB): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export function css(c: RGB, alpha?: number | undefined): string {
  if (alpha !== undefined) return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])} / ${alpha})`;
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}

function best(bg: RGB, candidates: RGB[]): RGB {
  let top = candidates[0] ?? BLACK;
  for (const c of candidates) if (contrast(c, bg) > contrast(top, bg)) top = c;
  return top;
}

/** `fg` moved toward `toward` in small steps until it reaches `min` contrast on every background. */
export function enough(fg: RGB, toward: RGB, backgrounds: RGB[], min: number): RGB {
  for (let p = 0; p <= 1.0001; p += 0.04) {
    const c = mix(fg, toward, p);
    if (backgrounds.every((b) => contrast(c, b) >= min)) return c;
  }
  return toward;
}

/* --------------------------------------------------------------- reading */

let probe: HTMLSpanElement | null = null;
let ink: CanvasRenderingContext2D | null = null;

export function resolveColor(value: string, under: RGB): RGB {
  if (probe === null) {
    probe = document.createElement('span');
    probe.style.display = 'none';
    document.documentElement.appendChild(probe);
  }
  if (ink === null) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    ink = canvas.getContext('2d', { willReadFrequently: true });
  }
  probe.style.color = value;
  const resolved = getComputedStyle(probe).color;
  if (ink === null) return under;
  ink.clearRect(0, 0, 1, 1);
  ink.fillStyle = css(under);
  ink.fillRect(0, 0, 1, 1);
  ink.fillStyle = resolved;
  ink.fillRect(0, 0, 1, 1);
  const d = ink.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
}

function resolve(token: string, under: RGB): RGB {
  return resolveColor(`var(${token})`, under);
}

const TOKENS = ['--agent-app-bg', '--agent-app-surface', '--agent-app-text', '--agent-app-muted', '--agent-app-border', '--agent-app-accent', '--agent-app-accent-contrast'];

function signature(): string {
  const st = getComputedStyle(document.documentElement);
  return TOKENS.map((t) => st.getPropertyValue(t).trim()).join('|') + '|' + (document.documentElement.getAttribute('data-theme') ?? '');
}

/* ---------------------------------------------------------------- derive */


export interface Palette {
  dark: boolean;
  paper: RGB;
  card: RGB;
  sunk: RGB;
  ink: RGB;
  muted: RGB;
  line: RGB;
  accent: RGB;
  moss: RGB;
  track: RGB;
  grove: RGB;
  /** The accent's hue (0-360) and how colorful the theme is (0 for ink themes). */
  hue: number;
  chroma: number;
  /** The hue of growing things: green, tinted toward the accent (moss, the grove, foliage). */
  nature: number;
  /** The warm hue of paper. */
  parchment: number;
  heat: RGB[];
}

let palette: Palette | null = null;

export function deriveColors(): Record<string, string> {
  const B0 = resolve('--agent-app-bg', WHITE);
  const S0 = resolve('--agent-app-surface', B0);
  const T = resolve('--agent-app-text', B0);
  const M0 = resolve('--agent-app-muted', S0);
  const A = resolve('--agent-app-accent', S0);
  const AC = resolve('--agent-app-accent-contrast', A);
  const dark = lum(B0) < 0.18;

  const accentIsInk = distance(A, T) < 0.12;
  const A_lch = toLch(A);
  const hue = A_lch.h;
  const chroma = accentIsInk ? 0 : Math.min(0.16, A_lch.c);
  // Growing things are green in every theme, leaning toward the accent (an orange accent gives olive, a blue one teal).
  const nature = chroma === 0 ? hue : hueMix(hue, 136, 0.76);
  const natureC = chroma === 0 ? 0 : 0.062;
  // Paper and cards are warm cream, leaning toward the accent.
  const parchment = chroma === 0 ? hue : hueMix(hue, 82, 0.72);
  const B_l = toLch(B0);
  const S_l = toLch(S0);

  // Paper (the page) and cards: the theme's background and surface, warmed into cream.
  let paper = dark ? mix(B0, A, 0.04) : lch(Math.min(0.955, B_l.l - 0.01), chroma === 0 ? B_l.c : Math.max(B_l.c, 0.022), chroma === 0 ? B_l.h : parchment);
  let card = dark ? mix(S0, A, 0.03) : lch(Math.min(0.985, S_l.l - 0.004), chroma === 0 ? S_l.c : Math.max(S_l.c, 0.011), chroma === 0 ? S_l.h : parchment);
  if (distance(card, paper) < 0.022) {
    if (dark) card = mix(paper, T, 0.07);
    else if (lum(paper) < 0.86) card = mix(paper, WHITE, 0.55);
    else paper = mix(B0, mix(T, A, 0.3), 0.06);
  }
  // Inner tiles inside cards (stat boxes, notes): a step toward ink.
  let sunkP = dark ? 0.06 : 0.045;
  while (sunkP < 0.2 && distance(mix(card, mix(T, A, 0.25), sunkP), card) < 0.022) sunkP += 0.01;
  const sunk = mix(card, mix(T, A, 0.25), sunkP);
  const sunkHover = mix(card, mix(T, A, 0.25), sunkP + 0.04);
  let lineP = dark ? 0.12 : 0.1;
  while (lineP < 0.4 && distance(mix(card, T, lineP), card) < 0.045) lineP += 0.02;
  const line = mix(mix(card, T, lineP), A, 0.04);
  const hair = mix(card, T, dark ? 0.08 : 0.06);
  const track = mix(mix(card, T, dark ? 0.14 : 0.1), A, 0.05);

  const muted = enough(M0, T, [paper, card, sunk, sunkHover], 4.6);
  const ink2 = enough(mix(T, M0, 0.3), T, [paper, card, sunk], 4.6);

  // The accent for interaction; primary buttons: the accent with white (deepened until white reads at 4.5:1).
  const accentOk = !accentIsInk && contrast(A, card) >= 1.6;
  const accent = accentOk ? A : accentIsInk ? mix(T, card, 0.4) : enough(A, T, [card], 1.6);
  const onAccent = accentOk && contrast(AC, accent) >= 3 ? AC : best(accent, [T, card, WHITE]);
  const accentSoft = mix(accent, card, dark ? 0.8 : 0.86);
  const accentText = enough(accent, dark ? WHITE : BLACK, [card, sunk, accentSoft, paper], 4.6);
  const primary = contrast(WHITE, accent) >= 4.6 ? accent : enough(accent, BLACK, [WHITE], 4.6);

  // Moss: the calm nature tone of the theme (progress, leaves). Sage for green themes, terracotta for orange ones.
  const mossL = dark ? 0.7 : 0.56;
  let moss = lch(mossL, natureC === 0 ? 0 : natureC + 0.012, nature);
  if (contrast(moss, card) < 2) moss = enough(moss, dark ? WHITE : BLACK, [card], 2);
  const mossSoft = mix(moss, card, dark ? 0.78 : 0.82);
  // Moss text sits on cards, paper and its own soft tint (pills, chosen chips).
  const mossText = enough(moss, dark ? WHITE : BLACK, [card, sunk, paper, mossSoft], 4.6);

  // The grove: the deep sidebar. Cream text on it.
  const groveC = natureC === 0 ? 0 : dark ? 0.03 : 0.05;
  let grove = dark ? lch(Math.max(0.17, B_l.l - 0.04), groveC, nature) : lch(0.4, groveC, nature);
  if (dark && distance(grove, paper) < 0.035) grove = lch(B_l.l + 0.06, groveC, nature);
  const groveL = toLch(grove).l;
  const grove2 = lch(groveL + (dark ? 0.06 : 0.065), groveC, nature);
  const grove3 = lch(groveL + (dark ? 0.1 : 0.12), groveC * 0.9, nature);
  const cream = dark ? mix(T, A, 0.05) : mix(lum(paper) > 0.8 ? paper : WHITE, WHITE, 0.25);
  const onGrove = contrast(cream, grove) >= 7 ? cream : best(grove, [cream, WHITE, T, BLACK]);
  const onGroveMuted = enough(mix(onGrove, grove, 0.35), onGrove, [grove, grove2], 4.6);
  const grovePill = dark ? mix(grove, T, 0.82) : mix(paper, WHITE, 0.3);
  const onGrovePill = best(grovePill, [T, grove, BLACK, WHITE]);
  const groveAccent = contrast(A, grove) >= 3 && !accentIsInk ? A : onGrove;
  // The plaque at the top of the grove (a carved sign).
  const woodH = chroma === 0 ? hue : hueMix(hue, 55, 0.7);
  const woodC = chroma === 0 ? 0 : 0.07;
  const plaque = lch(dark ? 0.34 : 0.5, woodC, woodH);
  const plaqueEdge = lch(dark ? 0.26 : 0.39, woodC, woodH);
  const onPlaque = best(plaque, [cream, WHITE, mix(cream, plaque, 0.1)]);

  // States (fixed hues, derived text).
  const redText = enough(RED, dark ? WHITE : BLACK, [paper, card, sunk, mix(card, RED, 0.12)], 4.6);
  const greenText = enough(GREEN, dark ? WHITE : BLACK, [paper, card, sunk, mix(card, GREEN, 0.12)], 4.6);
  const amberText = enough(AMBER, dark ? WHITE : BLACK, [paper, card, sunk, mix(card, AMBER, 0.2)], 4.6);
  const badge = contrast(WHITE, accent) >= 4.6 ? accent : enough(accent, BLACK, [WHITE], 4.6);

  const out: Record<string, string> = {};

  // The illustrations' colors: natural hues (an apple is red, a leaf green), dimmed a little in dark
  // mode and gray in ink packs (where the accent is the text color).
  const artK = accentIsInk ? 0 : dark ? 0.88 : 1;
  const artL = (l: number): number => (dark ? Math.max(0.2, l - 0.06) : l);
  const art = (l: number, c: number, h: number): RGB => lch(artL(l), c * artK, h);
  const ART: Record<string, RGB> = {
    red: art(0.63, 0.16, 28),
    'red-d': art(0.52, 0.15, 26),
    'red-l': art(0.76, 0.11, 32),
    pink: art(0.8, 0.085, 2),
    'pink-d': art(0.67, 0.115, 4),
    clay: art(0.7, 0.13, 50),
    'clay-d': art(0.58, 0.13, 45),
    honey: art(0.84, 0.14, 86),
    'honey-d': art(0.72, 0.14, 76),
    green: art(0.68, 0.13, 138),
    'green-d': art(0.55, 0.12, 142),
    'green-l': art(0.8, 0.11, 132),
    teal: art(0.72, 0.09, 185),
    'teal-d': art(0.58, 0.09, 190),
    sky: art(0.76, 0.085, 235),
    'sky-d': art(0.6, 0.1, 248),
    water: art(0.9, 0.04, 220),
    plum: art(0.6, 0.11, 315),
    'plum-d': art(0.48, 0.1, 312),
    lavender: art(0.8, 0.07, 300),
    wood: art(0.56, 0.075, 55),
    'wood-d': art(0.44, 0.065, 50),
    'wood-l': art(0.7, 0.07, 62),
    cream: art(0.96, 0.025, 85),
    'cream-d': art(0.87, 0.035, 80),
    stone: art(0.8, 0.012, 80),
    'stone-d': art(0.62, 0.014, 80),
    ink: lch(0.3, 0.025 * artK, 50),
    white: [255, 255, 255],
    'skin-1': art(0.88, 0.045, 62),
    'skin-2': art(0.8, 0.06, 58),
    'skin-3': art(0.7, 0.075, 52),
    'skin-4': art(0.57, 0.075, 48),
    'skin-5': art(0.44, 0.06, 42),
    'hair-1': art(0.3, 0.02, 40),
    'hair-2': art(0.44, 0.07, 52),
    'hair-3': art(0.54, 0.12, 40),
    'hair-4': art(0.82, 0.1, 86),
    'hair-5': art(0.74, 0.012, 80),
    'hair-6': art(0.66, 0.12, 350),
  };
  for (const [k, c] of Object.entries(ART)) out[`--lo-art-${k}`] = css(c);
  out['--lo-art-shadow'] = css(mix(card, T, dark ? 0.35 : 0.12));
  // Drawing colors that also appear as text (rain chances, the top three), checked against what they sit on.
  for (const k of ['sky-d', 'honey-d']) out[`--lo-art-${k.replace('-d', '')}-text`] = css(enough(ART[k] as RGB, dark ? WHITE : BLACK, [card, sunk, paper], 4.6));

  // One quiet signature color per area of life (a strip, a dot, a chart bar), taken from its drawing.
  const KIND: Record<string, string> = { health: 'red', money: 'honey-d', relationships: 'pink-d', work: 'sky-d', home: 'wood', growth: 'green', fun: 'teal', mind: 'plum' };
  for (const [kind, key] of Object.entries(KIND)) {
    let c = ART[key] as RGB;
    if (contrast(c, card) < 1.8) c = enough(c, dark ? WHITE : BLACK, [card], 1.8);
    const soft = mix(c, card, dark ? 0.78 : 0.84);
    out[`--lo-k-${kind}`] = css(c);
    out[`--lo-k-${kind}-soft`] = css(soft);
    out[`--lo-k-${kind}-text`] = css(enough(c, dark ? WHITE : BLACK, [card, sunk, soft, paper], 4.6));
  }
  // Heatmap steps from the track to moss.
  const heat: RGB[] = [track, mix(track, moss, 0.35), mix(track, moss, 0.6), mix(track, moss, 0.82), moss];

  palette = { dark, paper, card, sunk, ink: T, muted, line, accent, moss, track, grove, hue, chroma, nature, parchment, heat };

  Object.assign(out, {
    '--lo-paper': css(paper),
    '--lo-card': css(card),
    '--lo-sunk': css(sunk),
    '--lo-sunk-hover': css(sunkHover),
    '--lo-line': css(line),
    '--lo-hair': css(hair),
    '--lo-track': css(track),
    '--lo-ink': css(T),
    '--lo-ink-2': css(ink2),
    '--lo-muted-base': css(muted),
    '--lo-accent-base': css(accent),
    '--lo-on-accent': css(onAccent),
    '--lo-accent-soft': css(accentSoft),
    '--lo-accent-text': css(accentText),
    '--lo-primary': css(primary),
    '--lo-primary-hover': css(mix(primary, BLACK, 0.12)),
    '--lo-badge': css(badge),
    '--lo-moss': css(moss),
    '--lo-moss-text': css(mossText),
    '--lo-moss-soft': css(mossSoft),
    '--lo-grove': css(grove),
    '--lo-grove-2': css(grove2),
    '--lo-grove-3': css(grove3),
    '--lo-on-grove': css(onGrove),
    '--lo-on-grove-muted': css(onGroveMuted),
    '--lo-grove-pill': css(grovePill),
    '--lo-on-grove-pill': css(onGrovePill),
    '--lo-grove-accent': css(groveAccent),
    '--lo-plaque': css(plaque),
    '--lo-plaque-edge': css(plaqueEdge),
    '--lo-on-plaque': css(onPlaque),
    '--lo-red': css(RED),
    '--lo-red-text': css(redText),
    '--lo-green': css(GREEN),
    '--lo-green-text': css(greenText),
    '--lo-amber': css(AMBER),
    '--lo-amber-text': css(amberText),
    '--lo-on-red': css(best(RED, [WHITE, [20, 16, 12]])),
    '--lo-on-green': css(best(GREEN, [WHITE, [20, 16, 12]])),
    '--lo-heat-0': css(heat[0] as RGB),
    '--lo-heat-1': css(heat[1] as RGB),
    '--lo-heat-2': css(heat[2] as RGB),
    '--lo-heat-3': css(heat[3] as RGB),
    '--lo-heat-4': css(heat[4] as RGB),
  });
  return out;
}

/* ------------------------------------------------------- the landscapes */

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface ScenePalette {
  night: boolean;
  skyTop: string;
  skyBottom: string;
  glow: string;
  sun: string;
  cloud: string;
  far: string;
  mid: string;
  near: string;
  meadow: string;
  water: string;
  waterLine: string;
  tree: string;
  treeDark: string;
  treeLight: string;
  round: string;
  roundLight: string;
  roundDark: string;
  trunk: string;
  roof: string;
  wall: string;
  window: string;
  path: string;
  blossom: string;
  snow: string;
  star: string;
  /** Text that reads on the sky (the greeting). */
  onSky: string;
  onSkyMuted: string;
}

/** Colors for a landscape: the accent's family, by time of day, season and mode. */
export function scenePalette(pal: Palette, part: DayPart, season: Season): ScenePalette {
  const h = pal.hue;
  const c = pal.chroma;
  const night = pal.dark;
  const k = c === 0 ? 0 : 0.085;
  // The land stays green through the year (a little warmer in autumn, paler in winter); round trees carry the season.
  const landShift = season === 'spring' ? 6 : season === 'autumn' ? -10 : season === 'winter' ? -4 : 0;
  const seasonC = season === 'winter' ? 0.6 : 1;
  const fh = (pal.nature + landShift + 360) % 360;
  const skyH = c === 0 ? h : hueMix(h, 228, 0.78);
  const evening = !night && part === 'evening';
  const morning = !night && part === 'morning';
  let skyTop: RGB;
  let skyBottom: RGB;
  if (night) {
    skyTop = lch(0.22, k * 0.45, skyH + 30);
    skyBottom = lch(0.33, k * 0.45, skyH + 10);
  } else if (evening) {
    skyTop = lch(0.84, k * 0.45, hueMix(skyH, 300, 0.5));
    skyBottom = lch(0.92, k * 0.6, hueMix(h, 60, 0.5));
  } else if (morning) {
    skyTop = lch(0.91, k * 0.42, skyH);
    skyBottom = lch(0.96, k * 0.35, hueMix(h, 75, 0.6));
  } else {
    skyTop = lch(0.89, k * 0.5, skyH);
    skyBottom = lch(0.96, k * 0.22, hueMix(skyH, 120, 0.5));
  }
  const L = night ? (x: number) => 0.14 + x * 0.32 : (x: number) => x;
  const leaf = (l: number, cc: number, hh: number): RGB => lch(L(l), cc * seasonC, hh);
  const skyH0 = c === 0 ? h : hueMix(h, 228, 0.78);
  const far = leaf(0.82, k * 0.32, hueMix(fh, skyH0, 0.45));
  const mid = leaf(0.74, k * 0.55, fh + 4);
  const near = leaf(0.66, k * 0.72, fh + 2);
  const meadow = leaf(0.72, k * 0.68, fh + 10);
  // Pines are evergreen: the nature hue, deep.
  const ph = (pal.nature - 8 + 360) % 360;
  const tree = leaf(0.5, k * 0.75, ph);
  const treeDark = leaf(0.4, k * 0.65, ph - 6);
  const treeLight = leaf(0.6, k * 0.8, ph + 6);
  // Round trees: blossom in spring, full in summer, warm in autumn, pale in winter.
  const warmH = c === 0 ? h : hueMix(h, 45, 0.55);
  const leafH = season === 'autumn' ? warmH : season === 'spring' ? fh + 12 : fh;
  const leafC = season === 'autumn' ? (c === 0 ? 0 : 0.12) : season === 'winter' ? k * 0.4 : k * 0.85;
  const round = lch(L(season === 'autumn' ? 0.6 : 0.56), leafC, leafH);
  const roundLight = lch(L(season === 'autumn' ? 0.7 : 0.66), leafC, leafH + 8);
  const roundDark = lch(L(season === 'autumn' ? 0.5 : 0.46), leafC * 0.9, leafH - 8);
  const wood = c === 0 ? h : hueMix(h, 55, 0.7);
  const trunk = lch(night ? 0.22 : 0.42, c === 0 ? 0 : 0.05, wood);
  const water = night ? lch(0.3, k * 0.4, skyH) : lch(0.84, k * 0.5, skyH);
  const sky = mix(skyTop, skyBottom, 0.35);
  const onSky = best(sky, [pal.ink, night ? [245, 240, 230] : [30, 28, 24]]);
  const onSkyMuted = enough(mix(onSky, sky, 0.38), onSky, [skyTop, skyBottom], 4.6);
  return {
    night,
    skyTop: css(skyTop),
    skyBottom: css(skyBottom),
    glow: night ? css(lch(0.85, c === 0 ? 0 : 0.04, h + 60), 0.35) : evening ? css(lch(0.88, c === 0 ? 0 : Math.max(0.06, k * 0.7), hueMix(h, 50, 0.5)), 0.55) : css(lch(0.97, c === 0 ? 0 : 0.05, 85), 0.6),
    sun: night ? css(lch(0.93, c === 0 ? 0 : 0.02, h + 80)) : evening ? css(lch(0.8, c === 0 ? 0 : Math.max(0.1, k), hueMix(h, 45, 0.5))) : css(lch(0.95, c === 0 ? 0 : 0.07, 85)),
    cloud: night ? css(lch(0.4, k * 0.2, h + 220), 0.55) : css(mix(skyBottom, WHITE, 0.6), 0.85),
    far: css(far),
    mid: css(mid),
    near: css(near),
    meadow: css(meadow),
    water: css(water),
    waterLine: css(night ? lch(0.45, k * 0.3, h + 210) : mix(water, WHITE, 0.55)),
    tree: css(tree),
    treeDark: css(treeDark),
    treeLight: css(treeLight),
    round: css(round),
    roundLight: css(roundLight),
    roundDark: css(roundDark),
    trunk: css(trunk),
    roof: css(lch(night ? 0.32 : 0.52, c === 0 ? 0 : Math.max(0.08, Math.min(0.14, c * 0.7)), h)),
    wall: css(lch(night ? 0.38 : 0.9, c === 0 ? 0 : 0.03, pal.parchment)),
    window: night ? css(lch(0.86, 0.12, 85)) : css(lch(0.74, k * 0.4, skyH)),
    path: css(lch(night ? 0.34 : 0.87, c === 0 ? 0 : 0.035, pal.parchment)),
    blossom: css(lch(night ? 0.58 : 0.8, c === 0 ? 0 : Math.max(0.08, Math.min(0.13, c * 0.75)), hueMix(h, 350, 0.35))),
    snow: css(night ? lch(0.72, 0.01, skyH) : lch(0.98, 0.005, skyH)),
    star: css(lch(0.95, 0.03, 85)),
    onSky: css(onSky),
    onSkyMuted: css(onSkyMuted),
  };
}

/* ----------------------------------------------------------------- apply */

let last = '';
const listeners = new Set<() => void>();

function apply(): void {
  const sig = signature();
  if (sig === last) return;
  last = sig;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(deriveColors())) root.style.setProperty(k, v);
  for (const fn of listeners) fn();
}

/** Run `fn` after every theme change. Returns the unsubscribe. */
export function onThemeColors(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The palette, kept current across theme changes (for SVG drawings). */
export function usePalette(): Palette {
  const [pal, setPal] = useState<Palette>(() => {
    if (palette === null) deriveColors();
    return palette as Palette;
  });
  useEffect(() => {
    // A theme change between the first render and this subscription would otherwise be missed.
    setPal(palette as Palette);
    return onThemeColors(() => setPal(palette as Palette));
  }, []);
  return pal;
}

/** Derive now and again on every theme change (attributes or custom colors on <html>). */
export function startThemeColors(): void {
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'style'] });
}
