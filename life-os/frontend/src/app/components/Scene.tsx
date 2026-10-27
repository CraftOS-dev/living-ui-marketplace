/**
 * The landscape across the top of the pages: sky, sun or moon, clouds, far
 * mountains, a lake, pine woods and round trees on rolling hills, a cabin
 * with a smoking chimney on the hill (Home), a path, flowers and birds.
 *
 * Everything is drawn in the theme's own colors (scenePalette), changes with
 * the time of day (morning light, evening glow; night in dark mode) and the
 * season (blossom in spring, warm leaves in autumn, snow in winter). It is
 * generated for the banner's real width from a seed, so each page has its
 * own composition and nothing is stretched. The left part of the sky is
 * kept clear for the title. Decoration only (aria-hidden).
 */
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../kit/index.ts';
import { scenePalette, usePalette } from '../lib/themeColors.ts';
import type { DayPart, ScenePalette, Season } from '../lib/themeColors.ts';

function rng(seedText: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353) | 0;
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth path through points (Catmull-Rom as cubic Béziers), closed down to the bottom. */
function ridge(points: [number, number][], bottom: number): string {
  if (points.length < 2) return '';
  let d = `M${points[0]![0].toFixed(1)},${bottom} L${points[0]![0].toFixed(1)},${points[0]![1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  d += ` L${points[points.length - 1]![0].toFixed(1)},${bottom} Z`;
  return d;
}

/** The height of a ridge at x (linear between its points; close enough to place trees). */
function heightAt(points: [number, number][], x: number): number {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (x >= a[0] && x <= b[0]) {
      const t = (x - a[0]) / Math.max(1, b[0] - a[0]);
      const s = t * t * (3 - 2 * t);
      return a[1] + (b[1] - a[1]) * s;
    }
  }
  return points[points.length - 1]![1];
}

function Pine({ x, base, h, fill, shade, sway, snow }: { x: number; base: number; h: number; fill: string; shade: string; sway: boolean; snow: string | null }): React.JSX.Element {
  const w = h * 0.46;
  const tiers = [0, 1, 2].map((i) => {
    const top = base - h + i * h * 0.22;
    const bot = base - h * 0.5 + i * h * 0.2;
    const half = (w * (0.42 + i * 0.29)) / 2;
    return `M${x},${top} C${x + half * 0.35},${top + (bot - top) * 0.45} ${x + half * 0.8},${bot - 2} ${x + half},${bot} L${x - half},${bot} C${x - half * 0.8},${bot - 2} ${x - half * 0.35},${top + (bot - top) * 0.45} ${x},${top} Z`;
  });
  return (
    <g className={sway ? 'lo-scene-tree' : undefined} style={sway ? { animationDelay: `${(x % 7) * -0.9}s` } : undefined}>
      <rect x={x - h * 0.035} y={base - h * 0.14} width={h * 0.07} height={h * 0.16} fill={shade} />
      {tiers.map((d, i) => (
        <path key={i} d={d} fill={i === 1 ? shade : fill} />
      ))}
      {snow !== null && <path d={`M${x},${base - h} l${w * 0.12},${h * 0.1} l${-w * 0.24},0 Z`} fill={snow} />}
    </g>
  );
}

function RoundTree({ x, base, r, fill, light, dark, trunk, blossom, sway }: { x: number; base: number; r: number; fill: string; light: string; dark: string; trunk: string; blossom: string | null; sway: boolean }): React.JSX.Element {
  return (
    <g className={sway ? 'lo-scene-tree' : undefined} style={sway ? { animationDelay: `${(x % 5) * -1.1}s` } : undefined}>
      <rect x={x - r * 0.12} y={base - r * 1.1} width={r * 0.24} height={r * 1.12} rx={r * 0.08} fill={trunk} />
      <circle cx={x - r * 0.45} cy={base - r * 1.15} r={r * 0.62} fill={dark} />
      <circle cx={x + r * 0.42} cy={base - r * 1.2} r={r * 0.66} fill={fill} />
      <circle cx={x} cy={base - r * 1.62} r={r * 0.78} fill={fill} />
      <circle cx={x - r * 0.18} cy={base - r * 1.86} r={r * 0.36} fill={light} opacity="0.85" />
      {blossom !== null && (
        <>
          <circle cx={x - r * 0.4} cy={base - r * 1.55} r={r * 0.09} fill={blossom} />
          <circle cx={x + r * 0.3} cy={base - r * 1.85} r={r * 0.08} fill={blossom} />
          <circle cx={x + r * 0.55} cy={base - r * 1.25} r={r * 0.09} fill={blossom} />
          <circle cx={x - r * 0.05} cy={base - r * 1.25} r={r * 0.07} fill={blossom} />
        </>
      )}
    </g>
  );
}

function Cloud({ x, y, s, fill, delay }: { x: number; y: number; s: number; fill: string; delay: number }): React.JSX.Element {
  return (
    <g className="lo-scene-cloud" style={{ animationDelay: `${delay}s` }}>
      <ellipse cx={x} cy={y} rx={s * 1.3} ry={s * 0.42} fill={fill} />
      <circle cx={x - s * 0.45} cy={y - s * 0.18} r={s * 0.42} fill={fill} />
      <circle cx={x + s * 0.2} cy={y - s * 0.32} r={s * 0.55} fill={fill} />
      <circle cx={x + s * 0.75} cy={y - s * 0.08} r={s * 0.36} fill={fill} />
    </g>
  );
}

function Cabin({ x, base, s, c }: { x: number; base: number; s: number; c: ScenePalette }): React.JSX.Element {
  const w = s * 1.25;
  const h = s * 0.82;
  return (
    <g>
      <rect x={x + w * 0.52} y={base - h - s * 0.62} width={s * 0.17} height={s * 0.5} fill={c.trunk} />
      <circle className="lo-scene-smoke" cx={x + w * 0.6} cy={base - h - s * 0.72} r={s * 0.12} fill={c.cloud} />
      <circle className="lo-scene-smoke" style={{ animationDelay: '-2.5s' }} cx={x + w * 0.6} cy={base - h - s * 0.72} r={s * 0.1} fill={c.cloud} />
      <rect x={x} y={base - h} width={w} height={h} rx={s * 0.04} fill={c.wall} />
      <path d={`M${x - s * 0.12},${base - h + s * 0.04} L${x + w / 2},${base - h - s * 0.55} L${x + w + s * 0.12},${base - h + s * 0.04} Z`} fill={c.roof} />
      <rect x={x + w * 0.42} y={base - h * 0.62} width={w * 0.18} height={h * 0.62} rx={s * 0.03} fill={c.trunk} />
      <rect x={x + w * 0.1} y={base - h * 0.7} width={w * 0.2} height={h * 0.3} rx={s * 0.03} fill={c.window} />
      <rect x={x + w * 0.7} y={base - h * 0.7} width={w * 0.2} height={h * 0.3} rx={s * 0.03} fill={c.window} />
      {c.night && <circle cx={x + w * 0.2} cy={base - h * 0.55} r={s * 0.5} fill={c.window} opacity="0.12" />}
    </g>
  );
}

export interface SceneProps {
  height: number;
  seed: string;
  part: DayPart;
  season: Season;
  variant?: 'home' | 'page' | undefined;
  className?: string | undefined;
  children?: ReactNode | undefined;
}

export function Scene({ height, seed, part, season, variant = 'home', className, children }: SceneProps): React.JSX.Element {
  const pal = usePalette();
  const c = useMemo(() => scenePalette(pal, part, season), [pal, part, season]);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const set = (): void => setWidth(Math.max(320, Math.round(el.getBoundingClientRect().width / 20) * 20));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const art = useMemo(() => {
    const W = width;
    const H = height;
    const r = rng(seed + ':' + Math.round(W / 200));
    const home = variant === 'home';
    const y0 = H * (home ? 0.6 : 0.62);
    const winter = season === 'winter';
    const spring = season === 'spring';
    const autumn = season === 'autumn';
    const out: React.JSX.Element[] = [];
    // Sun or moon, right of the title.
    const sunX = W * (part === 'morning' ? 0.66 : part === 'evening' ? 0.9 : 0.8);
    const sunY = H * (c.night ? 0.24 : part === 'evening' ? 0.42 : part === 'morning' ? 0.3 : 0.22);
    const sunR = Math.max(12, H * 0.085);
    out.push(<circle key="glow" cx={sunX} cy={sunY} r={sunR * 4} fill={`url(#glow${uid})`} />);
    if (c.night) {
      out.push(<circle key="moon" cx={sunX} cy={sunY} r={sunR} fill={c.sun} />);
      out.push(<circle key="moon2" cx={sunX + sunR * 0.42} cy={sunY - sunR * 0.28} r={sunR * 0.86} fill={`url(#sky${uid})`} />);
      for (let i = 0; i < Math.round(W / 28); i++) {
        const sx = r() * W;
        const sy = r() * y0 * 0.85;
        out.push(<circle key={'s' + i} className="lo-scene-star" style={{ animationDelay: `${-r() * 4}s` }} cx={sx} cy={sy} r={0.7 + r() * 1.1} fill={c.star} />);
      }
    } else out.push(<circle key="sun" cx={sunX} cy={sunY} r={sunR} fill={c.sun} />);
    // Clouds, away from the title.
    const clouds = Math.max(2, Math.round(W / 420));
    for (let i = 0; i < clouds; i++) {
      const cx = W * (0.42 + (0.55 * (i + r() * 0.6)) / clouds);
      const cy = H * (0.1 + r() * 0.22);
      out.push(<Cloud key={'c' + i} x={cx} y={cy} s={H * (0.07 + r() * 0.05)} fill={c.cloud} delay={-r() * 20} />);
    }
    // Birds (day).
    if (!c.night) {
      const bx = W * (0.5 + r() * 0.15);
      const by = H * (0.18 + r() * 0.1);
      [0, 1, 2].forEach((i) => {
        const x = bx + i * H * 0.07 + r() * 6;
        const y = by + (i % 2) * H * 0.04;
        const s = H * 0.022;
        out.push(<path key={'b' + i} d={`M${x - s},${y - s * 0.5} Q${x - s * 0.4},${y - s} ${x},${y} Q${x + s * 0.4},${y - s} ${x + s},${y - s * 0.5}`} stroke={c.trunk} strokeWidth={1.4} fill="none" strokeLinecap="round" opacity="0.7" />);
      });
    }
    // Far mountains.
    const far: [number, number][] = [];
    const n = Math.max(6, Math.round(W / 150));
    for (let i = 0; i <= n; i++) far.push([(W * i) / n, y0 - H * (0.12 + r() * 0.2)]);
    out.push(<path key="far" d={ridge(far, H)} fill={c.far} />);
    if (winter)
      far.forEach((p, i) => {
        if (p[1] < y0 - H * 0.24) out.push(<path key={'sc' + i} d={`M${p[0]},${p[1]} l${H * 0.06},${H * 0.05} l${-H * 0.03},${-H * 0.006} l${-H * 0.03},${H * 0.02} l${-H * 0.03},${-H * 0.02} l${-H * 0.03},${H * 0.006} Z`} fill={c.snow} />);
      });
    // Mid hills with a pine wood.
    const mid: [number, number][] = [];
    const m = Math.max(5, Math.round(W / 220));
    for (let i = 0; i <= m; i++) mid.push([(W * i) / m, y0 - H * (0.02 + r() * 0.08)]);
    out.push(<path key="mid" d={ridge(mid, H)} fill={c.mid} />);
    // Lake (Home).
    const lakeL = W * 0.18;
    const lakeR = W * 0.62;
    if (home) {
      out.push(<ellipse key="lake" cx={(lakeL + lakeR) / 2} cy={y0 + H * 0.08} rx={(lakeR - lakeL) / 2} ry={H * 0.07} fill={c.water} />);
      for (let i = 0; i < 6; i++) {
        const lx = lakeL + (lakeR - lakeL) * (0.15 + r() * 0.7);
        const ly = y0 + H * (0.05 + r() * 0.06);
        out.push(<path key={'w' + i} d={`M${lx},${ly} h${H * (0.06 + r() * 0.08)}`} stroke={c.waterLine} strokeWidth={1.5} strokeLinecap="round" />);
      }
    }
    // Pines on the mid hills: denser to the right; low on the left so the title stays clear.
    // A page's banner keeps its title and subtitle on open sky and hills: no trees behind them.
    const clear = home ? 0 : Math.max(W * 0.46, Math.min(W, 420));
    const pines: React.JSX.Element[] = [];
    let x = home ? W * 0.02 : clear;
    let i = 0;
    while (x < W) {
      const left = x < W * 0.46;
      const inLake = home && x > lakeL && x < lakeR;
      const step = left ? 26 + r() * 30 : 14 + r() * 18;
      if (!inLake && r() > (left ? 0.45 : 0.12)) {
        const base = heightAt(mid, x) + H * 0.03 + r() * H * 0.04;
        const h = H * (left ? 0.1 + r() * 0.07 : 0.15 + r() * 0.12);
        const fill = i % 3 === 0 ? c.treeLight : i % 3 === 1 ? c.tree : c.treeDark;
        pines.push(<Pine key={'p' + i} x={x} base={base} h={h} fill={fill} shade={c.treeDark} sway={i % 4 === 0} snow={winter ? c.snow : null} />);
      }
      x += step;
      i++;
    }
    out.push(<g key="pines">{pines}</g>);
    // Near hills.
    const nearL: [number, number][] = [
      [-W * 0.05, y0 + H * 0.14],
      [W * 0.12, y0 + H * 0.06],
      [W * 0.32, y0 + H * 0.16],
      [W * 0.5, y0 + H * 0.24],
    ];
    const nearR: [number, number][] = [
      [W * 0.4, y0 + H * 0.3],
      [W * 0.62, y0 + H * 0.06],
      [W * 0.82, y0 - H * 0.04],
      [W * 1.05, y0 + H * 0.02],
    ];
    out.push(<path key="nearL" d={ridge(nearL, H + 2)} fill={c.meadow} />);
    out.push(<path key="nearR" d={ridge(nearR, H + 2)} fill={c.near} />);
    if (winter) {
      out.push(<path key="snowL" d={ridge(nearL.map(([a, b]) => [a, b + 1] as [number, number]), H + 2)} fill={c.snow} opacity="0.55" />);
      out.push(<path key="snowR" d={ridge(nearR.map(([a, b]) => [a, b + 1] as [number, number]), H + 2)} fill={c.snow} opacity="0.4" />);
    }
    // The cabin and its path (Home).
    if (home) {
      const cx = W * 0.8;
      const cb = heightAt(nearR, cx) + H * 0.03;
      const s = H * 0.16;
      out.push(<path key="path" d={`M${W * 0.6},${H + 4} C${W * 0.66},${H * 0.92} ${W * 0.74},${cb + H * 0.12} ${cx + s * 0.62},${cb}`} stroke={c.path} strokeWidth={H * 0.045} fill="none" strokeLinecap="round" />);
      out.push(<Cabin key="cabin" x={cx} base={cb} s={s} c={c} />);
    }
    // Round trees on the near hills.
    const rounds = home ? [0.66, 0.93, 0.97, 0.06, 0.48] : [0.58, 0.72, 0.9, 0.97].filter((f) => W * f > clear + 12);
    rounds.forEach((f, k) => {
      const tx = W * f + (r() - 0.5) * 20;
      const onRight = f > 0.45;
      const base = heightAt(onRight ? nearR : nearL, tx) + H * 0.04;
      const rad = H * (f < 0.2 ? 0.07 : 0.08 + r() * 0.04);
      const green = autumn && k % 3 === 2;
      out.push(<RoundTree key={'rt' + k} x={tx} base={base} r={rad} fill={green ? c.tree : c.round} light={green ? c.treeLight : c.roundLight} dark={green ? c.treeDark : c.roundDark} trunk={c.trunk} blossom={spring ? c.blossom : null} sway={k % 2 === 1} />);
    });
    // Flowers and grass along the bottom.
    for (let k = 0; k < Math.round(W / 40); k++) {
      const fx = r() * W;
      const fy = H - 4 - r() * H * 0.08;
      if (fx < W * 0.46 && fy < H * 0.86) continue;
      if (!winter && (spring || season === 'summer' || r() > 0.6)) out.push(<circle key={'f' + k} cx={fx} cy={fy} r={1.6 + r() * 1.4} fill={k % 3 === 0 ? c.sun : c.blossom} />);
      out.push(<path key={'g' + k} d={`M${fx + 4},${fy + 5} q-1,-6 2,-9 M${fx + 6},${fy + 5} q2,-5 5,-6`} stroke={c.treeDark} strokeWidth={1.2} fill="none" strokeLinecap="round" opacity="0.7" />);
    }
    if (winter && !c.night)
      for (let k = 0; k < Math.round(W / 60); k++) out.push(<circle key={'sn' + k} cx={r() * W} cy={r() * H * 0.8} r={1 + r() * 1.2} fill={c.snow} opacity="0.85" />);
    return out;
  }, [width, height, seed, part, season, variant, c, uid]);

  return (
    <div ref={box} className={cn('relative w-full overflow-hidden', className)} style={{ height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMax slice" aria-hidden>
        <defs>
          <linearGradient id={`sky${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={c.skyTop} />
            <stop offset="1" stopColor={c.skyBottom} />
          </linearGradient>
          <radialGradient id={`glow${uid}`}>
            <stop offset="0" stopColor={c.glow} />
            <stop offset="1" stopColor={c.glow} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={width} height={height} fill={`url(#sky${uid})`} />
        {art}
      </svg>
      {children !== undefined && (
        <div className="relative h-full" data-sky={c.skyTop + '|' + c.skyBottom} style={{ ['--lo-on-sky' as string]: c.onSky, ['--lo-on-sky-muted' as string]: c.onSkyMuted }}>
          {children}
        </div>
      )}
    </div>
  );
}
