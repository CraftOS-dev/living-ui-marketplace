/**
 * The app's colors, derived from the host theme.
 *
 * The host (CraftBot) sets the kit tokens (--agent-app-bg, -surface, -text,
 * -muted, -border, -accent, -accent-contrast) per theme pack, light or dark
 * mode, and custom colors. This module reads what they resolve to and writes
 * the app's --ro-* tokens on <html>, re-running whenever the theme changes.
 *
 * A fixed color-mix() recipe cannot know that a pack's accent equals its text
 * color or that its surface equals its background, so every token is
 * computed here and every pairing is checked: a color only goes where it
 * contrasts with what sits under it; otherwise the next theme color that
 * does is used.
 *
 * Highlights sit on PDF pages, which are white paper in every theme, so
 * their fills are tuned for paper; their swatches (dots in menus and lists)
 * are tuned for the cards they sit on.
 */

import { useEffect, useState } from 'react';

export type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const RED: RGB = [222, 75, 51];
const GREEN: RGB = [79, 154, 108];
const AMBER: RGB = [226, 164, 58];

/** The eight highlight hues (tuned for marks on white paper). */
export const HUES = ['yellow', 'red', 'green', 'blue', 'violet', 'orange', 'teal', 'gray'] as const;
export type Hue = (typeof HUES)[number];
const HUE_RGB: Record<Hue, RGB> = {
  yellow: [255, 212, 0],
  red: [255, 102, 102],
  green: [95, 178, 54],
  blue: [46, 168, 229],
  violet: [162, 138, 229],
  orange: [241, 152, 55],
  teal: [26, 180, 163],
  gray: [170, 170, 170],
};

/** Project colors. */
export const PROJECT_COLORS = ['ink', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'teal'] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];
const PROJECT_RGB: Record<Exclude<ProjectColor, 'ink' | 'accent'>, RGB> = {
  blue: [70, 122, 214],
  green: [72, 150, 102],
  amber: [214, 150, 48],
  red: [212, 82, 66],
  violet: [132, 104, 200],
  teal: [34, 150, 140],
};

/* ------------------------------------------------------------ color math */

export function mix(a: RGB, b: RGB, p: number): RGB {
  return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
}

function lin(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
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

function oklab(c: RGB): RGB {
  const r = lin(c[0]);
  const g = lin(c[1]);
  const b = lin(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** Perceptual distance (OKLab); about 0.02 is just visible, 0.1 clearly different. */
export function distance(a: RGB, b: RGB): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function css(c: RGB, alpha?: number): string {
  if (alpha !== undefined) return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])} / ${alpha})`;
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}

function best(bg: RGB, candidates: RGB[]): RGB {
  let top = candidates[0] ?? BLACK;
  for (const c of candidates) if (contrast(c, bg) > contrast(top, bg)) top = c;
  return top;
}

/** `fg` moved toward `toward` in small steps until it reaches `min` contrast on every background. */
function enough(fg: RGB, toward: RGB, backgrounds: RGB[], min: number): RGB {
  for (let p = 0; p <= 1.0001; p += 0.05) {
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
  return TOKENS.map((t) => st.getPropertyValue(t).trim()).join('|');
}

/* ---------------------------------------------------------------- derive */

export interface Palette {
  dark: boolean;
  card: RGB;
  ink: RGB;
  accent: RGB;
  stage: RGB;
  line: RGB;
  hueSolid: Record<Hue, RGB>;
  hueFill: Record<Hue, RGB>;
  rel: { supports: RGB; opposes: RGB; informs: RGB };
  kind: { question: RGB; claim: RGB; evidence: RGB };
  project: Record<ProjectColor, RGB>;
}

let palette: Palette | null = null;

export function deriveColors(): Record<string, string> {
  const B0 = resolve('--agent-app-bg', WHITE);
  const S0 = resolve('--agent-app-surface', B0);
  const T = resolve('--agent-app-text', B0);
  const M0 = resolve('--agent-app-muted', S0);
  const L0 = resolve('--agent-app-border', S0);
  const A = resolve('--agent-app-accent', S0);
  const AC = resolve('--agent-app-accent-contrast', A);
  const dark = lum(B0) < 0.18;

  let shell = B0;
  let card = S0;
  if (distance(card, shell) < 0.02) {
    if (dark) card = mix(S0, T, 0.07);
    else if (lum(S0) < 0.85) card = mix(S0, WHITE, 0.6);
    else shell = mix(B0, T, 0.045);
  }
  let rowP = 0.05;
  while (rowP < 0.2 && distance(mix(card, T, rowP), shell) < 0.025) rowP += 0.01;
  const row = mix(card, T, rowP);
  const rowHover = mix(card, T, rowP + 0.05);
  const sand = mix(mix(shell, T, 0.12), A, 0.1);
  let line = L0;
  if (!(contrast(L0, card) < 1.6 && distance(L0, card) >= 0.06 && distance(L0, row) >= 0.065)) {
    let lineP = 0.16;
    while (lineP < 0.5 && distance(mix(card, T, lineP), row) < 0.065) lineP += 0.02;
    line = mix(card, T, lineP);
  }
  let hairP = 0.07;
  while (hairP < 0.3 && distance(mix(card, T, hairP), card) < 0.035) hairP += 0.01;
  const hair = mix(card, T, hairP);
  let trackP = 0;
  while (trackP < 0.6 && distance(mix(line, T, trackP), sand) < 0.07) trackP += 0.05;
  const trackSand = mix(line, T, trackP);

  // The canvas behind maps and boards, and the reader's desk around pages.
  let stage = dark ? mix(card, BLACK, 0.28) : mix(card, T, 0.045);
  if (distance(stage, card) < 0.025) stage = dark ? mix(card, T, 0.06) : mix(card, T, 0.08);
  const grid = mix(stage, T, dark ? 0.16 : 0.14);
  let desk = dark ? mix(shell, BLACK, 0.35) : mix(shell, T, 0.07);
  if (distance(desk, WHITE) < 0.06) desk = mix(shell, T, 0.12);

  const muted = enough(M0, T, [shell, card, row, rowHover], 4.6);
  const mutedSand = enough(M0, T, [sand], 4.6);
  const ink2 = enough(mix(T, M0, 0.32), T, [card, row, sand], 4.6);

  const accentIsInk = distance(A, T) < 0.12;
  const accentOk = !accentIsInk && contrast(A, card) >= 1.6;
  const accent = accentOk ? A : accentIsInk ? mix(T, card, 0.5) : enough(A, T, [card], 1.6);
  const onAccent = accentOk && contrast(AC, accent) >= 3 ? AC : best(accent, [T, card]);
  const accentSoft = mix(accent, card, 0.72);
  const accentText = enough(accent, dark ? WHITE : BLACK, [card, row, accentSoft], 4.6);
  // Count badges keep white figures: the accent deepens until they read at 4.5:1.
  const badge = contrast(WHITE, accent) >= 4.6 ? accent : enough(accent, BLACK, [WHITE], 4.6);

  let darkCard: RGB;
  let onDark: RGB;
  if (!dark) {
    darkCard = mix(T, B0, 0.06);
    onDark = contrast(B0, darkCard) >= 7 ? B0 : best(darkCard, [WHITE, B0]);
  } else {
    const deeper = mix(B0, BLACK, 0.45);
    darkCard = distance(deeper, shell) >= 0.045 ? deeper : mix(card, T, 0.1);
    onDark = contrast(T, darkCard) >= 7 ? T : best(darkCard, [WHITE, T]);
  }
  const dark2 = mix(darkCard, onDark, 0.13);

  const redText = enough(RED, dark ? WHITE : BLACK, [shell, card, row, mix(card, RED, 0.15), mix(row, RED, 0.15), mix(rowHover, RED, 0.15)], 4.6);
  const greenText = enough(GREEN, dark ? WHITE : BLACK, [shell, card, row, mix(card, GREEN, 0.12), mix(row, GREEN, 0.12)], 4.6);
  const amberText = enough(AMBER, dark ? WHITE : BLACK, [shell, card, row, mix(card, AMBER, 0.25), mix(row, AMBER, 0.25)], 4.6);
  const redOnDark = enough(RED, lum(darkCard) < 0.2 ? WHITE : BLACK, [darkCard, dark2], 4.5);
  const onDarkMuted = enough(mix(onDark, darkCard, 0.42), onDark, [darkCard, dark2], 4.6);
  const accentDarkOk = contrast(A, darkCard) >= 3 && distance(A, dark2) >= 0.1;
  const accentDark = accentDarkOk ? A : onDark;
  const onAccentDark = accentDarkOk && contrast(AC, accentDark) >= 3 ? AC : best(accentDark, [darkCard, T, B0]);
  const accentInkOk = contrast(A, T) >= 2.2 && distance(A, T) >= 0.12;
  const accentInk = accentInkOk ? A : shell;
  const onAccentInk = accentInkOk && contrast(AC, accentInk) >= 3 ? AC : best(accentInk, [T, shell]);

  // Highlight swatches: each hue kept distinct and visible on cards (2:1 at least).
  const hueSolid = {} as Record<Hue, RGB>;
  const hueFill = {} as Record<Hue, RGB>;
  for (const h of HUES) {
    const base = HUE_RGB[h];
    hueSolid[h] = contrast(base, card) >= 1.9 ? base : enough(base, dark ? WHITE : BLACK, [card], 1.9);
    hueFill[h] = base;
  }
  // Relations and node kinds: state colors solved against cards and the canvas.
  const onCanvas = (c: RGB): RGB => enough(c, dark ? WHITE : BLACK, [card, stage], 3);
  const rel = { supports: onCanvas(GREEN), opposes: onCanvas(RED), informs: onCanvas(mix(T, card, 0.45)) };
  const kind = { question: onCanvas([132, 104, 200]), claim: onCanvas(accentIsInk ? mix(T, card, 0.15) : accent), evidence: onCanvas([46, 140, 196]) };
  // The same colors as words (labels like "supports" or "Evidence"): 4.5:1 on every surface they sit on.
  const asText = (c: RGB): RGB => enough(c, dark ? WHITE : BLACK, [shell, card, row, rowHover, accentSoft], 4.6);
  const project = {} as Record<ProjectColor, RGB>;
  project.ink = mix(T, card, 0.08);
  project.accent = accent;
  for (const k of Object.keys(PROJECT_RGB) as Exclude<ProjectColor, 'ink' | 'accent'>[]) project[k] = enough(PROJECT_RGB[k], dark ? WHITE : BLACK, [card], 2);

  // The browser's own selection blue: an accent tint reads as one of the highlight colors.
  const select = [60, 120, 230] as RGB;

  palette = { dark, card, ink: T, accent, stage, line, hueSolid, hueFill, rel, kind, project };

  const out: Record<string, string> = {
    '--ro-shell': css(shell),
    '--ro-card': css(card),
    '--ro-row': css(row),
    '--ro-row-hover': css(rowHover),
    '--ro-line': css(line),
    '--ro-hair': css(hair),
    '--ro-track-sand': css(trackSand),
    '--ro-sand': css(sand),
    '--ro-stage': css(stage),
    '--ro-grid': css(grid),
    '--ro-desk': css(desk),
    '--ro-ink': css(T),
    '--ro-ink-2': css(ink2),
    '--ro-muted-base': css(muted),
    '--ro-muted-sand': css(mutedSand),
    '--ro-accent-base': css(accent),
    '--ro-on-accent-base': css(onAccent),
    '--ro-accent-soft': css(accentSoft),
    '--ro-accent-text': css(accentText),
    '--ro-dark': css(darkCard),
    '--ro-dark-2': css(dark2),
    '--ro-on-dark': css(onDark),
    '--ro-on-dark-muted': css(onDarkMuted),
    '--ro-accent-dark': css(accentDark),
    '--ro-on-accent-dark': css(onAccentDark),
    '--ro-accent-ink': css(accentInk),
    '--ro-on-accent-ink': css(onAccentInk),
    '--ro-red-text-base': css(redText),
    '--ro-red-on-dark': css(redOnDark),
    '--ro-green-text': css(greenText),
    '--ro-amber-text': css(amberText),
    '--ro-on-red': css(best(RED, [WHITE, [12, 11, 10]])),
    '--ro-on-green': css(best(GREEN, [WHITE, [12, 11, 10]])),
    '--ro-on-amber': css(best(AMBER, [WHITE, [12, 11, 10]])),
    '--ro-select': css(select, 0.32),
    '--ro-rel-supports': css(rel.supports),
    '--ro-rel-opposes': css(rel.opposes),
    '--ro-rel-informs': css(rel.informs),
    '--ro-kind-question': css(kind.question),
    '--ro-kind-claim': css(kind.claim),
    '--ro-kind-evidence': css(kind.evidence),
    '--ro-rel-supports-text': css(asText(rel.supports)),
    '--ro-rel-opposes-text': css(asText(rel.opposes)),
    '--ro-rel-informs-text': css(asText(rel.informs)),
    '--ro-kind-question-text': css(asText(kind.question)),
    '--ro-kind-claim-text': css(asText(kind.claim)),
    '--ro-kind-evidence-text': css(asText(kind.evidence)),
    '--ro-badge': css(badge),
    // Main action buttons: the accent with white icon and label (deepened just enough for 4.5:1).
    '--ro-primary': css(badge),
    '--ro-primary-hover': css(mix(badge, BLACK, 0.12)),
  };
  for (const h of HUES) {
    out['--ro-hl-' + h] = css(hueSolid[h]);
    out['--ro-hl-' + h + '-fill'] = css(hueFill[h], h === 'yellow' ? 0.45 : 0.36);
    out['--ro-hl-' + h + '-line'] = css(mix(hueFill[h], BLACK, 0.15));
  }
  for (const k of PROJECT_COLORS) {
    out['--ro-pc-' + k] = css(project[k]);
    out['--ro-pc-' + k + '-soft'] = css(mix(project[k], card, 0.82));
    out['--ro-pc-' + k + '-on'] = css(best(project[k], [WHITE, [12, 11, 10], T]));
    // The project's color as a card face: deep enough that white text (and 80% white) reads on it.
    out['--ro-pc-' + k + '-deep'] = css(contrast(WHITE, project[k]) >= 6 ? project[k] : enough(project[k], BLACK, [WHITE], 6));
  }
  return out;
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

/** Run `fn` after every theme change (canvas drawings re-read the colors). Returns the unsubscribe. */
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
  useEffect(() => onThemeColors(() => setPal(palette as Palette)), []);
  return pal;
}

export function rgbCss(c: RGB, alpha?: number): string {
  return css(c, alpha);
}

/** Derive now and again on every theme change (attributes or custom colors on <html>). */
export function startThemeColors(): void {
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'style'] });
}
