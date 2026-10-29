/**
 * CRM System colors, derived from the host theme.
 *
 * The host (CraftBot) sets the kit tokens (--agent-app-bg, -surface, -text,
 * -muted, -border, -accent, -accent-contrast) per theme pack, light or dark
 * mode, and custom colors. This module reads what they resolve to and writes
 * the app's --cr-* tokens on <html>, re-running whenever the theme changes.
 *
 * The interface is near-monochrome: ink on the card, hairline rules, the
 * accent only for the selection and for what the AI agent proposes. Color
 * carries meaning only: money in and "done" (green), money owed, overdue and
 * errors (red), attention (amber). Every color is checked against the card
 * it sits on and shifted until it reads.
 */

type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

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
  return TOKENS.map((t) => st.getPropertyValue(t).trim()).join('|');
}

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
  const row = mix(card, T, dark ? 0.06 : 0.04);
  const rowHover = mix(card, T, dark ? 0.1 : 0.075);
  const line = mix(card, T, dark ? 0.2 : 0.15);
  const hair = mix(card, T, dark ? 0.12 : 0.085);
  const muted = enough(M0, T, [card, row, rowHover], 4.8);
  const ink2 = enough(mix(T, M0, 0.3), T, [card, row], 7);

  const accentIsInk = distance(A, T) < 0.12;
  const accentOk = !accentIsInk && contrast(A, card) >= 2.2;
  const accent = accentOk ? A : accentIsInk ? enough([41, 98, 255], toward, [card], 3) : enough(A, toward, [card], 2.2);
  const onAccent = contrast(AC, accent) >= 3 ? AC : best(accent, [WHITE, BLACK, T, card]);
  const accentText = enough(accent, toward, [card, row], 4.5);

  const green: RGB = [22, 140, 90];
  const red: RGB = [214, 54, 56];
  const amber: RGB = [205, 120, 8];
  const pos = enough(green, toward, [card], 2.6);
  const neg = enough(red, toward, [card], 2.6);
  const warn = enough(amber, toward, [card], 2.6);

  const tooltip = dark ? mix(T, card, 0.08) : mix(T, card, 0.04);
  const onTooltip = best(tooltip, [card, WHITE, BLACK]);

  // Categorical colors for charts (spending by category and the like),
  // each checked against the card.
  const CHART: RGB[] = [
    [41, 98, 255],
    [16, 163, 127],
    [232, 145, 12],
    [139, 92, 246],
    [219, 39, 119],
    [8, 145, 178],
    [101, 163, 13],
    [120, 113, 108],
  ];
  const chart: Record<string, string> = {};
  CHART.forEach((c, i) => {
    chart[`--cr-c${i + 1}`] = css(enough(c, toward, [card], 2.4));
  });

  return {
    ...chart,
    '--cr-card': css(card),
    '--cr-row': css(row),
    '--cr-row-hover': css(rowHover),
    '--cr-line': css(line),
    '--cr-hair': css(hair),
    '--cr-ink': css(T),
    '--cr-ink-2': css(ink2),
    '--cr-muted': css(muted),
    '--cr-accent': css(accent),
    '--cr-accent-text': css(accentText),
    '--cr-on-accent': css(onAccent),
    '--cr-accent-soft': css(mix(card, accent, dark ? 0.2 : 0.1)),
    '--cr-pos': css(pos),
    '--cr-pos-text': css(enough(green, toward, [card, row, rowHover], 4.5)),
    '--cr-pos-soft': css(mix(card, green, dark ? 0.22 : 0.12)),
    '--cr-neg': css(neg),
    '--cr-neg-text': css(enough(red, toward, [card, row, rowHover], 4.5)),
    '--cr-neg-soft': css(mix(card, red, dark ? 0.22 : 0.11)),
    '--cr-warn': css(warn),
    '--cr-warn-text': css(enough(amber, toward, [card, row, rowHover], 4.5)),
    '--cr-warn-soft': css(mix(card, amber, dark ? 0.22 : 0.13)),
    '--cr-tooltip': css(tooltip),
    '--cr-on-tooltip': css(onTooltip),
  };
}

let last = '';

function apply(): void {
  const sig = signature();
  if (sig === last) return;
  last = sig;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(derive())) root.style.setProperty(k, v);
}

/** Derive now and again on every theme change. */
export function startThemeColors(): void {
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'style'] });
}
