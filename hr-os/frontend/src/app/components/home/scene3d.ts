/**
 * What the Home 3D scenes share (home-reports): the --hr-* tokens read as
 * colours (so the scenes follow the theme), colour mixing, disposal, and the
 * handle and events every scene gives the section (components/home/globe.tsx).
 * Loaded only with the scene chunks.
 */
import { Color, SRGBColorSpace, Vector3 } from 'three';
import type { BufferGeometry, Material, Mesh, Object3D } from 'three';

export type RGB = [number, number, number];

export interface Palette {
  ink: RGB;
  ink2: RGB;
  muted: RGB;
  faint: RGB;
  line: RGB;
  line2: RGB;
  hair: RGB;
  page: RGB;
  panel: RGB;
  raised: RGB;
  sunk: RGB;
  rh: RGB;
  lh: RGB;
  warn: RGB;
  good: RGB;
  bad: RGB;
  dark: boolean;
}

/** What a scene tells the section: the thing under the pointer (or a first tap), and a pick (a click or a second tap). */
export interface SceneEvents {
  onFocus: (key: string | null) => void;
  onSelect: (key: string) => void;
}

export interface SceneHandle<D> {
  update: (d: D) => void;
  setReduced: (on: boolean) => void;
  dispose: () => void;
}

let probe: HTMLSpanElement | null = null;
let pixel: CanvasRenderingContext2D | null = null;

/** A token as opaque sRGB 0..1 (whatever colour syntax it resolves to). */
export function token(name: string): RGB {
  if (probe === null) {
    probe = document.createElement('span');
    probe.style.display = 'none';
    document.documentElement.appendChild(probe);
  }
  if (pixel === null) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    pixel = c.getContext('2d', { willReadFrequently: true });
  }
  probe.style.color = `var(${name})`;
  const v = getComputedStyle(probe).color;
  if (pixel === null) return [0.5, 0.5, 0.5];
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = '#808080';
  pixel.fillStyle = v;
  pixel.fillRect(0, 0, 1, 1);
  const d = pixel.getImageData(0, 0, 1, 1).data;
  return [(d[0] ?? 128) / 255, (d[1] ?? 128) / 255, (d[2] ?? 128) / 255];
}

export function lum(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function readPalette(): Palette {
  const page = token('--hr-page');
  return {
    ink: token('--hr-ink'),
    ink2: token('--hr-ink-2'),
    muted: token('--hr-muted'),
    faint: token('--hr-faint'),
    line: token('--hr-line'),
    line2: token('--hr-line-2'),
    hair: token('--hr-hair'),
    page,
    panel: token('--hr-panel'),
    raised: token('--hr-raised'),
    sunk: token('--hr-sunk'),
    rh: token('--hr-rh'),
    lh: token('--hr-lh'),
    warn: token('--hr-warn'),
    good: token('--hr-good'),
    bad: token('--hr-bad'),
    dark: lum(page) < 0.4,
  };
}

export function mixRGB(a: RGB, b: RGB, p: number): RGB {
  return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
}

export function v3(c: RGB): Vector3 {
  return new Vector3(c[0], c[1], c[2]);
}

/** A token colour for a material (sRGB in, linear inside three). */
export function srgb(c: RGB): Color {
  return new Color().setRGB(c[0], c[1], c[2], SRGBColorSpace);
}

/** Dispose every geometry and material under `o` (but `keep`, a geometry shared elsewhere). */
export function disposeTree(o: Object3D, keep?: BufferGeometry): void {
  o.traverse((x) => {
    const m = x as Mesh;
    if (m.geometry !== undefined && m.geometry !== keep) m.geometry.dispose();
    const mat = (m as { material?: Material | Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((q) => q.dispose());
    else if (mat !== undefined) mat.dispose();
  });
}

/** Watch <html> for theme changes (attributes and inline tokens); `fn` runs once per settled change. */
export function onTheme(fn: () => void): () => void {
  let queued = 0;
  const mo = new MutationObserver(() => {
    if (queued !== 0) return;
    queued = window.setTimeout(() => {
      queued = 0;
      fn();
    }, 60);
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style', 'style', 'class'] });
  return () => {
    mo.disconnect();
    if (queued !== 0) clearTimeout(queued);
  };
}
