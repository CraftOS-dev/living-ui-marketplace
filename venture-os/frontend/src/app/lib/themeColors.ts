/**
 * The app's colours, derived from the host theme.
 *
 * The host sets the kit tokens (--agent-app-bg, -surface, -text, -muted,
 * -border) per theme pack, light or dark, plus custom colours. theme.css
 * mixes them into the --vo-* greys with the HR OS recipe for the first
 * paint. This module then reads what the tokens resolve to, runs the same
 * recipe in JS and checks every pairing the screens use:
 *
 *   - text (ink, ink-2, muted, faint) reaches 4.5:1 on page, side, panel,
 *     raised, sunk, hover and active;
 *   - the five meaning colours (blue, teal, red, amber, green) reach 4.5:1 as
 *     text on the same surfaces and on their own soft tint;
 *   - a panel stands off the page, hover stands off every surface it sits on,
 *     active stands off hover, and lines show on panels;
 *   - packs whose surface equals their background (ink, brutalist, drafting,
 *     clay) still get a visible panel.
 *
 * A colour that fails moves toward the ink in small steps until it passes.
 * It re-runs whenever <html> changes theme (attributes or custom colours),
 * guarded by a signature of the host tokens, since writing the inline
 * --vo-* properties also mutates `style`.
 */

type RGB = [number, number, number];

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** color-mix(in srgb, a, b p): a straight mix of the encoded values. */
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
function distance(a: RGB, b: RGB): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function css(c: RGB): string {
  return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
}

/** `fg` moved toward `toward` until it reaches `min` contrast on every background. */
function enough(fg: RGB, toward: RGB, backgrounds: RGB[], min: number): RGB {
  for (let p = 0; p <= 1.0001; p += 0.04) {
    const c = mix(fg, toward, p);
    if (backgrounds.every((b) => contrast(c, b) >= min)) return c;
  }
  return toward;
}

/** `c` moved toward `toward` until it is at least `gap` (OKLab) away from every one of `others`. */
function apart(c: RGB, toward: RGB, others: RGB[], gap: number): RGB {
  for (let p = 0; p <= 0.6; p += 0.02) {
    const x = mix(c, toward, p);
    if (others.every((o) => distance(x, o) >= gap)) return x;
  }
  return mix(c, toward, 0.6);
}

/* --------------------------------------------------------------- reading */

let probe: HTMLSpanElement | null = null;
let ink: CanvasRenderingContext2D | null = null;

/** What a token resolves to, as opaque sRGB composited over `under`. */
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

const TOKENS = ['--agent-app-bg', '--agent-app-surface', '--agent-app-text', '--agent-app-muted', '--agent-app-border'];

function signature(): string {
  const st = getComputedStyle(document.documentElement);
  return document.documentElement.getAttribute('data-theme') + '|' + TOKENS.map((t) => st.getPropertyValue(t).trim()).join('|');
}

/* ---------------------------------------------------------------- derive */

export interface HostColors {
  bg: RGB;
  surface: RGB;
  text: RGB;
  muted: RGB;
  border: RGB;
}

/** The whole palette from the host's five colours (pure: the contrast audit runs it per pack). */
export function derive(h: HostColors): Record<string, string> {
  const { bg: B, surface: S, text: T, muted: M, border: L } = h;
  const dark = lum(B) < 0.2;
  const toward = dark ? WHITE : BLACK;

  // Surfaces (the HR OS recipe).
  let page = dark ? mix(B, hex('#0e1316'), 0.3) : mix(B, hex('#dfe5e8'), 0.38);
  const side = dark ? mix(B, hex('#0b0f12'), 0.4) : mix(B, hex('#d9dfe2'), 0.28);
  let panel = dark ? mix(S, hex('#121a1f'), 0.2) : mix(S, hex('#eef2f4'), 0.1);
  let raised = dark ? mix(S, hex('#1a242a'), 0.18) : S;
  // A panel must stand off the page (packs where surface equals background).
  if (distance(panel, page) < 0.025) {
    if (dark) {
      panel = mix(panel, T, 0.06);
      raised = mix(raised, T, 0.09);
    } else {
      page = mix(page, T, 0.04);
      panel = mix(panel, WHITE, 0.6);
      raised = mix(raised, WHITE, 0.8);
    }
  }
  const sunk = dark ? mix(page, BLACK, 0.22) : mix(page, T, 0.04);
  // Hover stands off page, panel, raised and sunk; active stands off hover.
  let hover = mix(page, T, 0.06);
  hover = apart(hover, T, [page, panel, raised, side, sunk], 0.03);
  let active = mix(page, T, 0.11);
  active = apart(active, T, [hover, page, panel, side], 0.035);
  // A selected row under the pointer: apart from the selected fill and from every surface.
  let activeHover = mix(active, T, 0.06);
  activeHover = apart(activeHover, T, [active, hover, page, panel, side, raised], 0.03);

  // Lines: visible on panels, softer than text.
  const greyLine = dark ? hex('#5b6970') : hex('#8a959b');
  let line = mix(L, greyLine, dark ? 0.3 : 0.34);
  if (contrast(line, panel) < 1.35) line = enough(line, T, [panel, page], 1.35);
  let line2 = mix(L, dark ? hex('#7a8a92') : greyLine, dark ? 0.45 : 0.58);
  if (contrast(line2, panel) < 1.7) line2 = enough(line2, T, [panel, page], 1.7);
  const hair = mix(L, greyLine, dark ? 0.1 : 0.14);

  const surfaces = [page, side, panel, raised, sunk, hover, active, activeHover];

  // Text.
  const inkC = enough(T, toward, surfaces, 7);
  const ink2 = enough(mix(T, M, 0.35), toward, surfaces, 4.6);
  const muted = enough(mix(M, T, 0.12), toward, surfaces, 4.6);
  // Faint (index numerals, separators) is still text: 4.5:1 like the rest, a step lighter than muted where the pack allows.
  const faint = enough(mix(M, page, 0.3), toward, [page, side, panel, raised, sunk, hover], 4.55);

  // Meaning colours: readable as text everywhere, and on their own soft tint.
  const tone = (light: string, darkHex: string): RGB => {
    const base = hex(dark ? darkHex : light);
    const tints = surfaces.map((s) => mix(s, base, 0.14));
    return enough(base, toward, [...surfaces, ...tints], 4.6);
  };
  const seriesA = tone('#2563eb', '#6b9cff');
  const seriesB = tone('#0b7d73', '#34d1c0');
  const bad = tone('#c81e1e', '#f87171');
  const warn = tone('#9a5a06', '#f2a541');
  const good = tone('#15803d', '#4ade80');

  // Ink buttons carry the page colour as their label: keep 4.5:1.
  const onInk = contrast(page, inkC) >= 4.6 ? page : contrast(WHITE, inkC) > contrast(BLACK, inkC) ? WHITE : BLACK;

  return {
    '--vo-page': css(page),
    '--vo-side': css(side),
    '--vo-panel': css(panel),
    '--vo-raised': css(raised),
    '--vo-sunk': css(sunk),
    '--vo-hover': css(hover),
    '--vo-active': css(active),
    '--vo-active-hover': css(activeHover),
    '--vo-line': css(line),
    '--vo-line-2': css(line2),
    '--vo-hair': css(hair),
    '--vo-ink': css(inkC),
    '--vo-ink-2': css(ink2),
    '--vo-muted': css(muted),
    '--vo-faint': css(faint),
    '--vo-agent': css(inkC),
    '--vo-agent-ink': css(onInk),
    '--vo-on-ink': css(onInk),
    '--vo-a': css(seriesA),
    '--vo-b': css(seriesB),
    '--vo-bad': css(bad),
    '--vo-warn': css(warn),
    '--vo-good': css(good),
  };
}

export function readHost(): HostColors {
  const bg = resolve('--agent-app-bg', WHITE);
  const surface = resolve('--agent-app-surface', bg);
  return {
    bg,
    surface,
    text: resolve('--agent-app-text', bg),
    muted: resolve('--agent-app-muted', surface),
    border: resolve('--agent-app-border', surface),
  };
}

/* ----------------------------------------------------------------- apply */

let last = '';

function apply(): void {
  const sig = signature();
  if (sig === last) return;
  last = sig;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(derive(readHost()))) root.style.setProperty(k, v);
}

/** Derive now and again on every theme change. */
export function startThemeColors(): void {
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'style'] });
}
