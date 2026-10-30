/**
 * Trading View colors, derived from the host theme.
 *
 * The host (CraftBot) sets the kit tokens (--agent-app-bg, -surface, -text,
 * -muted, -border, -accent, -accent-contrast) per theme pack, light or dark
 * mode, and custom colors. This module reads what they resolve to and writes
 * the app's --tv-* tokens on <html>, re-running whenever the theme or the
 * up/down palette changes (data-palette on <html>).
 *
 * The interface is near-monochrome: ink on the card, hairline rules, the
 * accent only for the selection and for what the AI agent adds. Color
 * carries meaning only: up and down (three palettes: green/red, red/green
 * as in East Asian markets, blue/orange for color-blind readers), the link
 * channel of a widget, and indicator lines (which must be told apart).
 * Every color is checked against the card it sits on and shifted until it
 * reads.
 */

type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

const PALETTES: Record<string, { up: RGB; down: RGB }> = {
  green_red: { up: [8, 153, 129], down: [242, 54, 69] },
  red_green: { up: [242, 54, 69], down: [8, 153, 129] },
  blue_orange: { up: [41, 98, 255], down: [245, 124, 0] },
};

/** Link channels 1..6. */
const LINKS: RGB[] = [
  [41, 98, 255],
  [232, 145, 12],
  [22, 163, 74],
  [219, 39, 119],
  [139, 92, 246],
  [8, 145, 178],
];

/** Indicator lines, in the order indicators are added. */
const LINES: RGB[] = [
  [41, 98, 255],
  [232, 145, 12],
  [139, 92, 246],
  [13, 148, 136],
  [219, 39, 119],
  [234, 88, 12],
  [8, 145, 178],
  [101, 163, 13],
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

function distance(a: RGB, b: RGB): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function css(c: RGB): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}

function cssA(c: RGB, a: number): string {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;
}

function best(bg: RGB, candidates: RGB[]): RGB {
  let top = candidates[0] ?? BLACK;
  for (const c of candidates) if (contrast(c, bg) > contrast(top, bg)) top = c;
  return top;
}

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
  return TOKENS.map((t) => st.getPropertyValue(t).trim()).join('|') + '|' + (document.documentElement.dataset['palette'] ?? '');
}

/* ---------------------------------------------------------------- derive */

/** Colors the chart canvas needs as plain strings (it cannot read CSS variables). */
export interface ChartColors {
  dark: boolean;
  card: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  grid: string;
  crosshair: string;
  label: string;
  onLabel: string;
  accent: string;
  accentSoft: string;
  up: string;
  down: string;
  upText: string;
  downText: string;
  upSoft: string;
  downSoft: string;
  upWash: string;
  downWash: string;
  extWash: string;
  lines: string[];
  linesSoft: string[];
  named: Record<string, string>;
}

let chart: ChartColors | null = null;

function derive(): Record<string, string> {
  const B0 = resolve('--agent-app-bg', WHITE);
  const S0 = resolve('--agent-app-surface', B0);
  const T = resolve('--agent-app-text', B0);
  const M0 = resolve('--agent-app-muted', S0);
  const A = resolve('--agent-app-accent', S0);
  const AC = resolve('--agent-app-accent-contrast', A);
  const dark = lum(B0) < 0.18;
  const toward = dark ? WHITE : BLACK;

  // One flat surface: panels are the card; the hairlines between them show.
  const card = S0;
  const row = mix(card, T, dark ? 0.06 : 0.045);
  const rowHover = mix(card, T, dark ? 0.1 : 0.08);
  const line = mix(card, T, dark ? 0.2 : 0.15);
  const hair = mix(card, T, dark ? 0.12 : 0.09);
  const muted = enough(M0, T, [card, row, rowHover], 4.8);
  const ink2 = enough(mix(T, M0, 0.3), T, [card, row], 7);

  const accentIsInk = distance(A, T) < 0.12;
  const accentOk = !accentIsInk && contrast(A, card) >= 2.2;
  const accent = accentOk ? A : accentIsInk ? enough([41, 98, 255], toward, [card], 3) : enough(A, toward, [card], 2.2);
  const onAccent = contrast(AC, accent) >= 3 ? AC : best(accent, [WHITE, BLACK, T, card]);
  const accentSoft = mix(card, accent, dark ? 0.22 : 0.12);
  const accentText = enough(accent, toward, [card, row], 4.5);

  const palette = PALETTES[document.documentElement.dataset['palette'] ?? 'green_red'] ?? PALETTES['green_red']!;
  const up = enough(palette.up, toward, [card], 2.4);
  const down = enough(palette.down, toward, [card], 2.4);
  const upText = enough(palette.up, toward, [card, row, rowHover], 4.5);
  const downText = enough(palette.down, toward, [card, row, rowHover], 4.5);

  const tooltip = dark ? mix(T, card, 0.08) : mix(T, card, 0.04);
  const onTooltip = best(tooltip, [card, WHITE, BLACK]);

  const out: Record<string, string> = {
    '--tv-card': css(card),
    '--tv-row': css(row),
    '--tv-row-hover': css(rowHover),
    '--tv-line': css(line),
    '--tv-hair': css(hair),
    '--tv-ink': css(T),
    '--tv-ink-2': css(ink2),
    '--tv-muted': css(muted),
    '--tv-accent': css(accent),
    '--tv-accent-text': css(accentText),
    '--tv-on-accent': css(onAccent),
    '--tv-accent-soft': css(accentSoft),
    '--tv-up': css(up),
    '--tv-down': css(down),
    '--tv-up-text': css(upText),
    '--tv-down-text': css(downText),
    '--tv-up-soft': css(mix(card, up, dark ? 0.24 : 0.14)),
    '--tv-down-soft': css(mix(card, down, dark ? 0.24 : 0.14)),
    '--tv-tooltip': css(tooltip),
    '--tv-on-tooltip': css(onTooltip),
    '--tv-warn': css(enough([217, 119, 6], toward, [card], 3.5)),
  };
  LINKS.forEach((c, i) => {
    out[`--tv-link-${i + 1}`] = css(enough(c, toward, [card, row], 2.6));
  });

  const lines = LINES.map((c) => enough(c, toward, [card], 2.6));
  const named: Record<string, string> = {
    ink: css(T),
    accent: css(accent),
    up: css(up),
    down: css(down),
    amber: css(enough([232, 145, 12], toward, [card], 2.6)),
    violet: css(enough([139, 92, 246], toward, [card], 2.6)),
    teal: css(enough([13, 148, 136], toward, [card], 2.6)),
    muted: css(muted),
  };
  chart = {
    dark: dark,
    card: css(card),
    ink: css(T),
    ink2: css(ink2),
    muted: css(muted),
    line: css(line),
    grid: css(mix(card, T, dark ? 0.07 : 0.05)),
    crosshair: css(mix(card, T, 0.45)),
    label: css(tooltip),
    onLabel: css(onTooltip),
    accent: css(accent),
    accentSoft: cssA(accent, dark ? 0.2 : 0.12),
    up: css(up),
    down: css(down),
    upText: css(upText),
    downText: css(downText),
    upSoft: cssA(up, dark ? 0.45 : 0.4),
    downSoft: cssA(down, dark ? 0.45 : 0.4),
    upWash: cssA(up, dark ? 0.16 : 0.1),
    downWash: cssA(down, dark ? 0.16 : 0.1),
    extWash: cssA(T, dark ? 0.05 : 0.035),
    lines: lines.map(css),
    linesSoft: lines.map((c) => cssA(c, dark ? 0.14 : 0.09)),
    named: named,
  };
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
  for (const [k, v] of Object.entries(derive())) root.style.setProperty(k, v);
  for (const fn of listeners) fn();
}

/** Derive now and again on every theme or palette change. */
export function startThemeColors(): void {
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'data-palette', 'style'] });
}

export function chartColors(): ChartColors {
  if (chart === null) apply();
  return chart as ChartColors;
}

/** Call fn after every theme change; returns the unsubscribe. */
export function onThemeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The color of a drawing style name or hex. */
export function namedColor(name: string | undefined): string {
  const c = chartColors();
  if (name !== undefined && /^#[0-9a-fA-F]{6}$/.test(name)) return name;
  return c.named[name ?? 'ink'] ?? c.ink;
}

/** A translucent version of an rgb()/#hex color. */
export function alpha(color: string, a: number): string {
  const m = /rgb\((\d+)\s+(\d+)\s+(\d+)\)/.exec(color);
  if (m !== null) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
  const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (h !== null) return `rgba(${parseInt(h[1] ?? '0', 16)}, ${parseInt(h[2] ?? '0', 16)}, ${parseInt(h[3] ?? '0', 16)}, ${a})`;
  return color;
}
