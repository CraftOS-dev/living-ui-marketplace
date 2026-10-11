/**
 * The app's colors, derived from the host theme.
 *
 * The host sets the kit tokens (--agent-app-bg, -surface, -text,
 * -muted, -border, -accent, -accent-contrast) per theme pack, light or dark
 * mode, and custom colors. This module reads what they resolve to and writes
 * the app's --ps-* tokens on <html>, re-running whenever the theme changes.
 *
 * A fixed color-mix() recipe cannot know that a pack's accent equals its text
 * color (ink, atelier, drafting) or that its surface equals its background
 * (ink, brutalist, drafting, clay). So every token is computed here, and every
 * pairing is checked: a color only goes where it contrasts with what sits
 * under it, and otherwise the next theme color that does is used instead.
 *
 * Category colors: eight fixed hues (a till's categories must stay
 * recognisable from day to day), each with a tint for tiles and chips and a
 * text color solved to read on that tint and on cards in the current theme.
 */

type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
/** The fixed state colors (theme.css --ps-red, --ps-green, --ps-amber). */
const RED: RGB = [222, 75, 51];
const GREEN: RGB = [79, 154, 108];
const AMBER: RGB = [226, 164, 58];

/** Category hues, slots 1 to 8. */
export const CATEGORY_HUES: RGB[] = [
  [214, 106, 74], // terracotta
  [210, 158, 52], // ochre
  [104, 158, 82], // leaf
  [48, 150, 148], // teal
  [72, 122, 206], // blue
  [132, 102, 204], // violet
  [204, 88, 132], // rose
  [112, 122, 138], // slate
];

/* ------------------------------------------------------------ color math */

function mix(a: RGB, b: RGB, p: number): RGB {
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
  // Rows sit on cards and, as fields and filters, on the shell too.
  let rowP = 0.05;
  while (rowP < 0.2 && distance(mix(card, T, rowP), shell) < 0.025) rowP += 0.01;
  const row = mix(card, T, rowP);
  const rowHover = mix(card, T, rowP + 0.05);
  const sand = mix(mix(shell, T, 0.12), A, 0.1);
  const sand2 = distance(mix(sand, card, 0.5), card) >= 0.06 ? mix(sand, card, 0.5) : sand;
  // Tracks and rules stay soft even where a pack draws hard borders, but visible.
  let line = L0;
  if (!(contrast(L0, card) < 1.6 && distance(L0, card) >= 0.06 && distance(L0, row) >= 0.065)) {
    let lineP = 0.16;
    while (lineP < 0.5 && distance(mix(card, T, lineP), row) < 0.065) lineP += 0.02;
    line = mix(card, T, lineP);
  }
  let trackP = 0;
  while (trackP < 0.6 && distance(mix(line, T, trackP), sand) < 0.07) trackP += 0.05;
  const trackSand = mix(line, T, trackP);

  const muted = enough(M0, T, [shell, card, row, rowHover], 4.6);
  const mutedSand = enough(M0, T, [sand, sand2], 4.6);
  const ink2 = enough(mix(T, M0, 0.32), T, [card, row, sand], 4.6);

  const accentIsInk = distance(A, T) < 0.12;
  const accentOk = !accentIsInk && contrast(A, card) >= 1.6;
  const accent = accentOk ? A : accentIsInk ? mix(T, card, 0.5) : enough(A, T, [card], 1.6);
  const onAccent = accentOk && contrast(AC, accent) >= 3 ? AC : best(accent, [T, card]);
  // Accent fills that carry text (count badges, accent buttons) keep the
  // host's text color on them and deepen (or lighten) until it reads.
  const accentFill = enough(accent, lum(onAccent) > lum(accent) ? BLACK : WHITE, [onAccent], 4.6);
  // Round icon badges keep the host's own pairing (an icon needs 3:1).
  const onDot = contrast(AC, accent) >= 3 ? AC : best(accent, [T, card]);
  const accentSoft = mix(accent, card, 0.82);
  // Accent used as text on cards and rows (links, the agent marker).
  const accentText = enough(accent, dark ? WHITE : BLACK, [card, row, accentSoft], 4.6);

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
  const greenText = enough(GREEN, dark ? WHITE : BLACK, [shell, card, row, mix(card, GREEN, 0.15), mix(row, GREEN, 0.15)], 4.6);
  const amberText = enough(AMBER, dark ? WHITE : BLACK, [shell, card, row, mix(card, AMBER, 0.25), mix(row, AMBER, 0.25)], 4.6);
  const redOnDark = enough(RED, lum(darkCard) < 0.2 ? WHITE : BLACK, [darkCard, dark2], 4.5);
  const onDarkMuted = enough(mix(onDark, darkCard, 0.42), onDark, [darkCard, dark2], 4.6);
  // The accent on the dark card and on ink (the pay button, selected chips) is
  // mostly text (totals, counts, prices): it is solved to read there. A pack
  // whose accent is its text color falls back to the surface's own text.
  const accentDark = distance(A, onDark) >= 0.12 ? enough(A, lum(darkCard) < 0.2 ? WHITE : BLACK, [darkCard, dark2], 4.6) : onDark;
  // A text-carrying fill on the dark card (the pay button): the host's accent
  // with its contrast color, deepened until the words read; it must still
  // stand off the card, or the text-grade accent is used as the fill.
  const fillDarkOn = contrast(AC, A) >= 3 ? AC : best(A, [WHITE, BLACK]);
  const fillDarkTry = enough(A, lum(fillDarkOn) > lum(A) ? BLACK : WHITE, [fillDarkOn], 4.6);
  const fillDarkOk = distance(A, onDark) >= 0.12 && contrast(fillDarkTry, darkCard) >= 2.2 && distance(fillDarkTry, darkCard) >= 0.12;
  const accentFillDark = fillDarkOk ? fillDarkTry : accentDark;
  const onAccentDark = fillDarkOk ? fillDarkOn : best(accentDark, [darkCard, T, B0]);
  const dotDarkOk = contrast(A, darkCard) >= 3 && distance(A, dark2) >= 0.1;
  const dotDark = dotDarkOk ? A : onDark;
  const onDotDark = dotDarkOk && contrast(AC, dotDark) >= 3 ? AC : best(dotDark, [darkCard, T, B0]);
  // Ink buttons lighten to 90% on hover: the accent reads there too.
  const inkHover = [T, mix(T, card, 0.12), mix(T, shell, 0.12)];
  const accentInk = distance(A, T) >= 0.12 ? enough(A, lum(T) < 0.2 ? WHITE : BLACK, inkHover, 4.6) : shell;
  const onAccentInk = contrast(AC, accentInk) >= 4.6 ? AC : best(accentInk, [T, shell]);
  const dotInkOk = contrast(A, T) >= 2.2 && distance(A, T) >= 0.12;
  const dotInk = dotInkOk ? A : shell;
  const onDotInk = dotInkOk && contrast(AC, dotInk) >= 3 ? AC : best(dotInk, [T, shell]);

  // Solid badges (the current page in the rail, plus circles, the done step):
  // ink with the accent in light mode, the accent itself in dark mode,
  // whichever reads.
  let solid: RGB;
  let onSolid: RGB;
  if (!dark) {
    solid = T;
    onSolid = accentInk;
  } else {
    const accentShows = contrast(A, shell) >= 2 && distance(A, shell) >= 0.12;
    solid = accentShows ? A : T;
    onSolid = accentShows && contrast(AC, solid) >= 3 ? AC : best(solid, [shell, T, card]);
  }

  // Ring segments: theme colors in order of preference, then a ladder of
  // text-to-card tones (monochrome packs live on that ladder). Each is kept
  // only if it is clearly different from those already taken and from the
  // sand card under the ring; the spacing relaxes only if five do not fit.
  const preferred: RGB[] = dark
    ? [T, A, mix(A, card, 0.55), mix(T, card, 0.28), mix(T, card, 0.55), mix(A, T, 0.5), mix(A, card, 0.75)]
    : [T, A, mix(A, card, 0.55), card, mix(T, card, 0.52), mix(A, T, 0.5), mix(A, card, 0.75)];
  const ladder: RGB[] = Array.from({ length: 18 }, (_, i) => mix(T, card, 0.1 + i * 0.05));
  const pool = [...preferred, ...ladder];
  const take = (gap: number, onSand: number, from: RGB[], taken: RGB[], n: number): RGB[] => {
    const got: RGB[] = [];
    for (const c of from) {
      if (got.length === n) break;
      if (distance(c, sand) < onSand) continue;
      if ([...taken, ...got].every((x) => distance(x, c) >= gap)) got.push(c);
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
  const otherPool: RGB[] = [...(dark ? [mix(T, card, 0.72), mix(T, card, 0.64), mix(T, card, 0.8)] : [mix(T, card, 0.88), mix(T, card, 0.8), mix(T, card, 0.72)]), ...ladder.slice().reverse()];
  const other = take(0.06, 0.06, otherPool, segs, 1)[0] ?? take(0.045, 0.045, otherPool, segs, 1)[0] ?? otherPool[0] ?? card;
  // A label on a segment: the theme's own text or card color where it reads,
  // else black or white (one of the two always reaches 4.5:1).
  const labelOn = (fill: RGB): RGB => {
    if (fill === A && contrast(AC, A) >= 4.5) return AC;
    const own = best(fill, [T, card]);
    return contrast(own, fill) >= 4.5 ? own : best(fill, [BLACK, WHITE]);
  };

  const out: Record<string, string> = {
    '--ps-canvas': css(canvas),
    '--ps-shell': css(shell),
    '--ps-card': css(card),
    '--ps-row': css(row),
    '--ps-row-hover': css(rowHover),
    '--ps-line': css(line),
    '--ps-track-sand': css(trackSand),
    '--ps-sand': css(sand),
    '--ps-sand-2': css(sand2),
    '--ps-ink': css(T),
    '--ps-ink-2': css(ink2),
    '--ps-muted-base': css(muted),
    '--ps-muted-sand': css(mutedSand),
    '--ps-accent-base': css(accent),
    '--ps-on-accent-base': css(onAccent),
    '--ps-accent-fill-base': css(accentFill),
    '--ps-dot-base': css(accent),
    '--ps-on-dot-base': css(onDot),
    '--ps-accent-fill-dark': css(accentFillDark),
    '--ps-dot-dark': css(dotDark),
    '--ps-on-dot-dark': css(onDotDark),
    '--ps-dot-ink': css(dotInk),
    '--ps-on-dot-ink': css(onDotInk),
    '--ps-accent-soft': css(accentSoft),
    '--ps-accent-text': css(accentText),
    '--ps-dark': css(darkCard),
    '--ps-dark-2': css(dark2),
    '--ps-on-dark': css(onDark),
    '--ps-on-dark-muted': css(onDarkMuted),
    '--ps-accent-dark': css(accentDark),
    '--ps-on-accent-dark': css(onAccentDark),
    '--ps-accent-ink': css(accentInk),
    '--ps-on-accent-ink': css(onAccentInk),
    '--ps-red-text-base': css(redText),
    '--ps-red-on-dark': css(redOnDark),
    '--ps-green-text': css(greenText),
    '--ps-amber-text': css(amberText),
    '--ps-solid': css(solid),
    '--ps-on-solid': css(onSolid),
    '--ps-seg-other': css(other),
    '--ps-seg-other-text': css(labelOn(other)),
    '--ps-on-red': css(best(RED, [WHITE, [12, 11, 10]])),
  };

  segs.forEach((seg, i) => {
    out[`--ps-seg-${i}`] = css(seg);
    out[`--ps-seg-${i}-text`] = css(labelOn(seg));
  });

  // Category slots: a strong mark (stripe, swatch), a tint for tiles and the
  // text and icon colors that read on the tint and on the card.
  CATEGORY_HUES.forEach((hue, i) => {
    const n = i + 1;
    const mark = enough(hue, dark ? WHITE : BLACK, [card, row], 2.2);
    const soft = mix(card, hue, dark ? 0.2 : 0.13);
    const text = enough(hue, dark ? WHITE : BLACK, [soft, card, row, rowHover], 4.6);
    out[`--ps-cat-${n}`] = css(mark);
    out[`--ps-cat-${n}-soft`] = css(soft);
    out[`--ps-cat-${n}-text`] = css(text);
  });
  // Slot 0 (no category): neutral.
  out['--ps-cat-0'] = css(line);
  out['--ps-cat-0-soft'] = css(row);
  out['--ps-cat-0-text'] = css(ink2);
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

/** Run `fn` after every theme change has been applied. Returns the unsubscribe. */
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
