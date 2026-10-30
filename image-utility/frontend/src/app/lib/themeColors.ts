/**
 * The app's colors, derived from the host theme.
 *
 * The host (CraftBot) sets the kit tokens (--agent-app-bg, -surface, -text,
 * -muted, -border, -accent, -accent-contrast) per theme pack, light or dark
 * mode, and custom colors. This module reads what they resolve to and writes
 * the app's --iu-* tokens on <html>, re-running whenever the theme changes.
 *
 * A fixed color-mix() recipe cannot know that a pack's accent equals its text
 * color (ink, atelier, drafting) or that its surface equals its background
 * (ink, brutalist, drafting, clay). So every token is computed here, and every
 * pairing is checked: a color only goes where it contrasts with what sits
 * under it, and otherwise the next theme color that does is used instead.
 *
 * The image stage is a quiet field one step off the cards, with a
 * checkerboard for transparency in two tones solved against it.
 */

export type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
/** The fixed state colors (theme.css --iu-red, --iu-green, --iu-amber). */
const RED: RGB = [222, 75, 51];
const GREEN: RGB = [79, 154, 108];
const AMBER: RGB = [226, 164, 58];

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

function css(c: RGB): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}

/** The candidate with the highest contrast against `bg`. */
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

/** What a CSS color (or var()) resolves to, as opaque sRGB composited over `under`. */
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

export function deriveColors(): Record<string, string> {
  const B0 = resolve('--agent-app-bg', WHITE);
  const S0 = resolve('--agent-app-surface', B0);
  const T = resolve('--agent-app-text', B0);
  const M0 = resolve('--agent-app-muted', S0);
  const L0 = resolve('--agent-app-border', S0);
  const A = resolve('--agent-app-accent', S0);
  const AC = resolve('--agent-app-accent-contrast', A);
  const dark = lum(B0) < 0.18;

  // Shell and cards: a card must stand off the shell it sits on.
  let shell = B0;
  let card = S0;
  if (distance(card, shell) < 0.02) {
    if (dark) card = mix(S0, T, 0.07);
    else if (lum(S0) < 0.85) card = mix(S0, WHITE, 0.6);
    else shell = mix(B0, T, 0.045);
  }
  const canvas = mix(shell, T, 0.08);
  // Rows sit on cards and, as fields and filters, on the shell too.
  let rowP = 0.05;
  while (rowP < 0.2 && distance(mix(card, T, rowP), shell) < 0.025) rowP += 0.01;
  const row = mix(card, T, rowP);
  const rowHover = mix(card, T, rowP + 0.05);
  const sand = mix(mix(shell, T, 0.12), A, 0.1);
  // Tracks and rules stay soft even where a pack draws hard borders, but visible.
  let line = L0;
  if (!(contrast(L0, card) < 1.6 && distance(L0, card) >= 0.06 && distance(L0, row) >= 0.065)) {
    let lineP = 0.16;
    while (lineP < 0.5 && distance(mix(card, T, lineP), row) < 0.065) lineP += 0.02;
    line = mix(card, T, lineP);
  }
  // Hairlines between rows inside a panel: softer than a border, still visible.
  let hairP = 0.07;
  while (hairP < 0.3 && distance(mix(card, T, hairP), card) < 0.035) hairP += 0.01;
  const hair = mix(card, T, hairP);
  let trackP = 0;
  while (trackP < 0.6 && distance(mix(line, T, trackP), sand) < 0.07) trackP += 0.05;
  const trackSand = mix(line, T, trackP);

  // The viewer's stage: a quiet field one step off the card it sits in.
  let stage = dark ? mix(card, BLACK, 0.28) : mix(card, T, 0.045);
  if (distance(stage, card) < 0.025) stage = dark ? mix(card, T, 0.06) : mix(card, T, 0.08);

  const muted = enough(M0, T, [shell, card, row, rowHover], 4.6);
  const mutedSand = enough(M0, T, [sand], 4.6);
  const ink2 = enough(mix(T, M0, 0.32), T, [card, row, sand], 4.6);

  const accentIsInk = distance(A, T) < 0.12;
  const accentOk = !accentIsInk && contrast(A, card) >= 1.6;
  const accent = accentOk ? A : accentIsInk ? mix(T, card, 0.5) : enough(A, T, [card], 1.6);
  const onAccent = accentOk && contrast(AC, accent) >= 3 ? AC : best(accent, [T, card]);
  const accentSoft = mix(accent, card, 0.55);
  // Accent used as text on cards and rows (links, the agent marker).
  const accentText = enough(accent, dark ? WHITE : BLACK, [card, row], 3.2);

  // The dark card: near-black in light mode; a deeper shade in dark mode.
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

  let solid: RGB;
  let onSolid: RGB;
  if (!dark) {
    solid = T;
    onSolid = contrast(A, T) >= 3.2 && distance(A, T) >= 0.12 ? A : shell;
  } else {
    const accentShows = contrast(A, shell) >= 2 && distance(A, shell) >= 0.12;
    solid = accentShows ? A : T;
    onSolid = accentShows && contrast(AC, solid) >= 3 ? AC : best(solid, [shell, T, card]);
  }

  // The transparency checkerboard: two quiet tones that read on the stage.
  const checkA = dark ? mix(stage, WHITE, 0.1) : mix(stage, WHITE, 0.75);
  const checkB = dark ? mix(stage, WHITE, 0.17) : mix(stage, T, 0.09);

  // Text on the stage (overlays, the pixel readout).
  const onStage = best(stage, [T, dark ? WHITE : BLACK]);
  const onStageMuted = enough(mix(T, stage, 0.45), T, [stage], 4.6);

  return {
    '--iu-canvas': css(canvas),
    '--iu-shell': css(shell),
    '--iu-card': css(card),
    '--iu-row': css(row),
    '--iu-row-hover': css(rowHover),
    '--iu-line': css(line),
    '--iu-hair': css(hair),
    '--iu-track-sand': css(trackSand),
    '--iu-sand': css(sand),
    '--iu-stage': css(stage),
    '--iu-check-a': css(checkA),
    '--iu-check-b': css(checkB),
    '--iu-on-stage': css(onStage),
    '--iu-on-stage-muted': css(onStageMuted),
    '--iu-ink': css(T),
    '--iu-ink-2': css(ink2),
    '--iu-muted-base': css(muted),
    '--iu-muted-sand': css(mutedSand),
    '--iu-accent-base': css(accent),
    '--iu-on-accent-base': css(onAccent),
    '--iu-accent-soft': css(accentSoft),
    '--iu-accent-text': css(accentText),
    '--iu-dark': css(darkCard),
    '--iu-dark-2': css(dark2),
    '--iu-on-dark': css(onDark),
    '--iu-on-dark-muted': css(onDarkMuted),
    '--iu-accent-dark': css(accentDark),
    '--iu-on-accent-dark': css(onAccentDark),
    '--iu-accent-ink': css(accentInk),
    '--iu-on-accent-ink': css(onAccentInk),
    '--iu-red-text-base': css(redText),
    '--iu-red-on-dark': css(redOnDark),
    '--iu-green-text': css(greenText),
    '--iu-amber-text': css(amberText),
    '--iu-solid': css(solid),
    '--iu-on-solid': css(onSolid),
    '--iu-on-red': css(best(RED, [WHITE, [12, 11, 10]])),
    '--iu-on-green': css(best(GREEN, [WHITE, [12, 11, 10]])),
    '--iu-on-amber': css(best(AMBER, [WHITE, [12, 11, 10]])),
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

/** Run `fn` after every theme change has been applied (canvas drawings re-read the tokens). Returns the unsubscribe. */
export function onThemeColors(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A palette color as a CSS color. */
export function rgbCss(c: RGB): string {
  return 'rgb(' + Math.round(c[0]) + ' ' + Math.round(c[1]) + ' ' + Math.round(c[2]) + ')';
}

/** Derive now and again on every theme change (attributes or custom colors on <html>). */
export function startThemeColors(): void {
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'style'] });
}
