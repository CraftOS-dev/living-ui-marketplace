/**
 * The app's colors, derived from the host theme.
 *
 * The host (CraftBot) sets the kit tokens (--agent-app-bg, -surface, -text, -muted,
 * -border, -accent, -accent-contrast) per theme pack, light or dark mode,
 * and custom colors. This module reads what they resolve to and writes the
 * app's --erp-* tokens on <html>, re-running whenever the theme changes.
 *
 * A fixed color-mix() recipe cannot know that a pack's accent equals its text
 * color (ink, atelier, drafting) or that its surface equals its background
 * (ink, brutalist, drafting, clay). So every token is computed here, and every
 * pairing is checked: a color only goes where it contrasts with what sits
 * under it, and otherwise the next theme color that does is used instead.
 *
 * Scopes in theme.css re-point --erp-accent / --erp-on-accent / --erp-muted inside
 * dark cards (.erp-on-dark), ink pills (.erp-on-ink) and sand cards (.erp-on-sand)
 * to the variants computed for those backgrounds. The audit in
 * tools/contrast-audit.mjs runs deriveColors() for every theme pack in both
 * modes and fails on any pairing under its minimum.
 */

type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
/** The fixed state colors (theme.css --erp-red, --erp-green, --erp-amber). */
const RED: RGB = [222, 75, 51];
const GREEN: RGB = [79, 154, 108];
const AMBER: RGB = [226, 164, 58];

/* ------------------------------------------------------------ color math */

function mix(a: RGB, b: RGB, p: number): RGB {
  // Same as color-mix(in srgb, a, b p): a straight mix of the encoded values.
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
function contrast(a: RGB, b: RGB): number {
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
function distance(a: RGB, b: RGB): number {
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

/** What a theme token resolves to, as opaque sRGB composited over `under`. */
function resolve(token: string, under: RGB): RGB {
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
  probe.style.color = `var(${token})`;
  const value = getComputedStyle(probe).color;
  if (ink === null) return under;
  ink.clearRect(0, 0, 1, 1);
  ink.fillStyle = css(under);
  ink.fillRect(0, 0, 1, 1);
  ink.fillStyle = value;
  ink.fillRect(0, 0, 1, 1);
  const d = ink.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
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
  // Rows sit on cards and, as fields and filters, on the shell too: they must
  // stand off both (in some packs the shell is exactly a 5% shade of the card).
  let rowP = 0.05;
  while (rowP < 0.2 && distance(mix(card, T, rowP), shell) < 0.025) rowP += 0.01;
  const row = mix(card, T, rowP);
  const rowHover = mix(card, T, rowP + 0.05);
  const sand = mix(mix(shell, T, 0.12), A, 0.1);
  // A raised tile on a row-colored stage (board columns, calendar cells) must stand off it.
  let floorP = 0;
  while (floorP < 0.6 && distance(mix(sand, T, floorP), row) < 0.09) floorP += 0.03;
  const floor = mix(sand, T, floorP);
  // The pale bar behind a value (budget, allowance) must still show on a card.
  const sand2 = distance(mix(sand, card, 0.5), card) >= 0.06 ? mix(sand, card, 0.5) : sand;
  // Tracks and rules stay soft even where a pack draws hard borders, but visible
  // on cards and on the rows inside them.
  let line = L0;
  if (!(contrast(L0, card) < 1.6 && distance(L0, card) >= 0.06 && distance(L0, row) >= 0.065)) {
    let lineP = 0.16;
    while (lineP < 0.5 && distance(mix(card, T, lineP), row) < 0.065) lineP += 0.02;
    line = mix(card, T, lineP);
  }
  // The off track of a switch is the line color; on a sand card it moves toward the ink until it shows.
  let trackP = 0;
  while (trackP < 0.6 && distance(mix(line, T, trackP), sand) < 0.07) trackP += 0.05;
  const trackSand = mix(line, T, trackP);

  // Text: muted copy readable on every light surface; a sand-safe variant for sand cards.
  const muted = enough(M0, T, [shell, card, row, rowHover], 4.6);
  const mutedSand = enough(M0, T, [sand, sand2], 4.6);
  const ink2 = enough(mix(T, M0, 0.32), T, [card, row, sand], 4.6);

  // The accent on ordinary surfaces: it must show on the card and differ from
  // the ink it is set against (today's bar among the ink bars). Packs whose
  // accent is their text color get a mid tone instead.
  const accentIsInk = distance(A, T) < 0.12;
  const accentOk = !accentIsInk && contrast(A, card) >= 1.6;
  const accent = accentOk ? A : accentIsInk ? mix(T, card, 0.5) : enough(A, T, [card], 1.6);
  const onAccent = accentOk && contrast(AC, accent) >= 3 ? AC : best(accent, [T, card]);
  const accentSoft = mix(accent, card, 0.55);

  // The dark card: near-black in light mode; in dark mode a deeper shade of
  // the background, or a raised one when the background is already black.
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

  // State colors stay fixed as fills; as text they shift just enough to read.
  const redText = enough(RED, dark ? WHITE : BLACK, [shell, card, row, mix(card, RED, 0.15), mix(row, RED, 0.15), mix(rowHover, RED, 0.15)], 4.6);
  const greenText = enough(GREEN, dark ? WHITE : BLACK, [shell, card, row, mix(card, GREEN, 0.12), mix(row, GREEN, 0.12), mix(rowHover, GREEN, 0.12)], 4.6);
  const amberText = enough(AMBER, dark ? WHITE : BLACK, [shell, card, row, mix(card, AMBER, 0.25), mix(row, AMBER, 0.25), mix(rowHover, AMBER, 0.25)], 4.6);
  const redOnDark = enough(RED, lum(darkCard) < 0.2 ? WHITE : BLACK, [darkCard, dark2], 4.5);
  const onDarkMuted = enough(mix(onDark, darkCard, 0.42), onDark, [darkCard, dark2], 4.6);
  const accentDarkOk = contrast(A, darkCard) >= 3 && distance(A, dark2) >= 0.1;
  const accentDark = accentDarkOk ? A : onDark;
  const onAccentDark = accentDarkOk && contrast(AC, accentDark) >= 3 ? AC : best(accentDark, [darkCard, T, B0]);

  // The accent on ink (dark pills in light mode, light pills in dark mode).
  const accentInkOk = contrast(A, T) >= 2.2 && distance(A, T) >= 0.12;
  const accentInk = accentInkOk ? A : shell;
  const onAccentInk = accentInkOk && contrast(AC, accentInk) >= 3 ? AC : best(accentInk, [T, shell]);

  // Solid badges (the current page, done steps, the phone's "+"): the accent
  // with its own label color wherever it shows against the shell, else ink.
  const accentShows = contrast(A, shell) >= 2 && distance(A, shell) >= 0.12;
  const solid = accentShows ? A : T;
  const onSolid = accentShows && contrast(AC, solid) >= 3 ? AC : best(solid, [shell, T, card]);

  // Chart segments (spending by account, sales by customer, drawn on a card): theme colors in order
  // of preference, then a ladder of text-to-card tones (monochrome packs live on
  // that ladder). Each is kept only if it is clearly different from those
  // already taken and from the card under it; the spacing relaxes only if five
  // do not fit.
  const preferred: RGB[] = dark
    ? [T, A, mix(A, card, 0.55), mix(T, card, 0.28), mix(T, card, 0.55), mix(A, T, 0.5), mix(A, card, 0.75)]
    : [T, A, mix(A, card, 0.55), card, mix(T, card, 0.52), mix(A, T, 0.5), mix(A, card, 0.75)];
  const ladder: RGB[] = Array.from({ length: 18 }, (_, i) => mix(T, card, 0.1 + i * 0.05));
  const pool = [...preferred, ...ladder];
  const take = (gap: number, offCard: number, from: RGB[], taken: RGB[], n: number): RGB[] => {
    const got: RGB[] = [];
    for (const c of from) {
      if (got.length === n) break;
      if (distance(c, card) < offCard) continue;
      if ([...taken, ...got].every((s) => distance(s, c) >= gap)) got.push(c);
    }
    return got;
  };
  let segs: RGB[] = [];
  for (const gap of [0.09, 0.075, 0.06]) {
    segs = take(gap, 0.07, pool, [], 5);
    if (segs.length === 5) break;
  }
  // Never fewer than five: a palette this narrow repeats rather than leaving a gap.
  for (let i = 0; segs.length < 5; i++) segs.push(segs[i % Math.max(1, segs.length)] ?? T);
  // A mid tone that neither white nor near-black can label at 4.5:1 moves just
  // far enough toward the side that makes one of them read.
  const NEAR_BLACK: RGB = [12, 11, 10];
  const labelable = (c: RGB): RGB =>
    contrast(c, WHITE) >= 4.6 || contrast(c, NEAR_BLACK) >= 4.6 ? c : lum(c) < 0.2 ? enough(c, BLACK, [WHITE], 4.6) : enough(c, WHITE, [NEAR_BLACK], 4.6);
  segs = segs.map(labelable);
  const otherPool: RGB[] = [...(dark ? [mix(T, card, 0.72), mix(T, card, 0.64), mix(T, card, 0.8)] : [mix(T, card, 0.88), mix(T, card, 0.8), mix(T, card, 0.72)]), ...ladder.slice().reverse()];
  const other = take(0.06, 0.06, otherPool, segs, 1)[0] ?? take(0.045, 0.045, otherPool, segs, 1)[0] ?? otherPool[0] ?? card;
  // Labels written on a segment (12px bold): the theme's own colors when they
  // reach 4.5:1, else whichever of a warm near-black and white reads best.
  const labelOn = (fill: RGB): RGB => {
    const prefs: RGB[] = [...(fill === A ? [AC] : []), T, card];
    for (const c of prefs) if (contrast(c, fill) >= 4.5) return c;
    return best(fill, [[12, 11, 10], WHITE]);
  };

  const out: Record<string, string> = {
    '--erp-canvas': css(canvas),
    '--erp-shell': css(shell),
    '--erp-card': css(card),
    '--erp-row': css(row),
    '--erp-row-hover': css(rowHover),
    '--erp-line': css(line),
    '--erp-track-sand': css(trackSand),
    '--erp-sand': css(sand),
    '--erp-sand-2': css(sand2),
    '--erp-floor': css(floor),
    '--erp-ink': css(T),
    '--erp-ink-2': css(ink2),
    '--erp-muted-base': css(muted),
    '--erp-muted-sand': css(mutedSand),
    '--erp-accent-base': css(accent),
    '--erp-on-accent-base': css(onAccent),
    '--erp-accent-soft': css(accentSoft),
    '--erp-dark': css(darkCard),
    '--erp-dark-2': css(dark2),
    '--erp-on-dark': css(onDark),
    '--erp-on-dark-muted': css(onDarkMuted),
    '--erp-accent-dark': css(accentDark),
    '--erp-on-accent-dark': css(onAccentDark),
    '--erp-accent-ink': css(accentInk),
    '--erp-on-accent-ink': css(onAccentInk),
    '--erp-red-text-base': css(redText),
    '--erp-red-on-dark': css(redOnDark),
    '--erp-green-text': css(greenText),
    '--erp-solid': css(solid),
    '--erp-on-solid': css(onSolid),
    // Labels written on the fixed state fills (the receivables ring, state badges).
    // A warm near-black deep enough to reach 4.5:1 on the red.
    '--erp-on-red': css(best(RED, [WHITE, [12, 11, 10]])),
    '--erp-on-green': css(best(GREEN, [WHITE, [12, 11, 10]])),
    '--erp-on-amber': css(best(AMBER, [WHITE, [12, 11, 10]])),
    '--erp-amber-text': css(amberText),
    '--erp-seg-other': css(other),
    '--erp-seg-other-text': css(best(other, [T, card])),
  };
  segs.forEach((s, i) => {
    out[`--erp-seg-${i}`] = css(s);
    out[`--erp-seg-${i}-text`] = css(labelOn(s));
  });
  // The same five for charts on the dark card: drawn from the dark card's own
  // colors (its accent and text), each clearly off the card and off the others.
  const darkPool: RGB[] = [accentDark, onDark, mix(onDark, darkCard, 0.35), mix(accentDark, darkCard, 0.45), mix(onDark, darkCard, 0.55), ...Array.from({ length: 14 }, (_, i) => mix(onDark, darkCard, 0.15 + i * 0.05))];
  const takeDark = (gap: number): RGB[] => {
    const got: RGB[] = [];
    for (const c of darkPool) {
      if (got.length === 5) break;
      if (distance(c, darkCard) < 0.08 || distance(c, dark2) < 0.05) continue;
      if (got.every((x) => distance(x, c) >= gap)) got.push(c);
    }
    return got;
  };
  let darkSegs: RGB[] = [];
  for (const gap of [0.09, 0.07, 0.05]) {
    darkSegs = takeDark(gap);
    if (darkSegs.length === 5) break;
  }
  for (let i = 0; darkSegs.length < 5; i++) darkSegs.push(darkSegs[i % Math.max(1, darkSegs.length)] ?? onDark);
  darkSegs.map(labelable).forEach((s, i) => {
    out[`--erp-seg-dark-${i}`] = css(s);
    out[`--erp-seg-dark-${i}-text`] = css(best(s, [darkCard, onDark, [12, 11, 10], WHITE]));
  });
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

/** Run `fn` after every theme change has been applied (canvas drawings re-read the tokens). Returns the unsubscribe. */
export function onThemeColors(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Derive now and again on every theme change (attributes or custom colors on <html>). */
export function startThemeColors(): void {
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'style'] });
}
