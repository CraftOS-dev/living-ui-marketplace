/**
 * Home's project shelf: every active project as a card on a 3D stage. The
 * card in front faces you, with the project's color as its top bar and in its
 * point-cloud visual (the shape follows the stage the project is in, the
 * density the papers and claims in it); the others stand angled to either side. Arrows, the mouse wheel,
 * a swipe, the ruler below, a side card or the keyboard (Left, Right, Home,
 * End) bring another to the front. The last slot starts a new project.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Lock, Plus, Sparkles } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import { num } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { Project } from '../../lib/types.ts';
import { ProjectTodo } from '../tasks/bits.tsx';

export type Stage = 'collect' | 'read' | 'map' | 'synthesize' | 'write';

export const STAGE: Record<Stage, { label: string }> = {
  collect: { label: 'Collecting' },
  read: { label: 'Reading' },
  map: { label: 'Mapping' },
  synthesize: { label: 'Synthesizing' },
  write: { label: 'Writing' },
};

type Slot = { kind: 'project'; p: Project } | { kind: 'new' };

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function stageOf(p: Project): Stage {
  const all = p.journey?.steps.every((s) => s.done) ?? false;
  return all ? 'write' : ((p.journey?.next ?? 'collect') as Stage);
}

/* --------------------------------------------------------------- visual */

type P3 = [number, number, number];

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** The point cloud of a project: a sphere while collecting, a sheet while reading, a network while mapping, a lattice while synthesizing, a ring while writing. */
function cloud(seed: string, stage: Stage, density: number): { pts: P3[]; links: [number, number][] } {
  const r = rng(seed);
  const n = Math.round(90 + Math.min(1, density / 80) * 330);
  const pts: P3[] = [];
  const links: [number, number][] = [];
  if (stage === 'collect' || stage === 'map') {
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const th = golden * i + r() * 0.4;
      const k = 0.82 + r() * 0.22;
      pts.push([Math.cos(th) * rad * k, y * k, Math.sin(th) * rad * k]);
    }
    if (stage === 'map') {
      for (let i = 0; i < n; i += 3) {
        let best = -1;
        let bd = 9;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const a = pts[i] as P3;
          const b = pts[j] as P3;
          const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
          if (d < bd && d > 0.01) {
            bd = d;
            best = j;
          }
        }
        if (best >= 0 && r() < 0.8) links.push([i, best]);
      }
    }
  } else if (stage === 'read') {
    const cols = Math.round(Math.sqrt(n * 2.2));
    const rows = Math.max(4, Math.round(n / cols));
    const f1 = 2 + r() * 2;
    const f2 = 1 + r() * 2;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const x = (i / (cols - 1)) * 2.2 - 1.1;
        const z = (j / (rows - 1)) * 1.2 - 0.6;
        pts.push([x + (r() - 0.5) * 0.04, Math.sin(x * f1 + z * f2) * 0.22 + (r() - 0.5) * 0.05, z]);
      }
  } else if (stage === 'synthesize') {
    const per = Math.max(6, Math.round(n / 16));
    const V: P3[] = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    const E: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of E)
      for (let t = 0; t <= per; t++) {
        const A = V[a] as P3;
        const B = V[b] as P3;
        const u = t / per;
        pts.push([(A[0] + (B[0] - A[0]) * u) * 0.68, (A[1] + (B[1] - A[1]) * u) * 0.68, (A[2] + (B[2] - A[2]) * u) * 0.68]);
      }
    for (let i = 0; i < n / 4; i++) pts.push([(r() - 0.5) * 1.1, (r() - 0.5) * 0.04 - 0.1, (r() - 0.5) * 1.1]);
  } else {
    for (let i = 0; i < n; i++) {
      const u = r() * Math.PI * 2;
      const v = r() * Math.PI * 2;
      const R = 0.78;
      const rr = 0.2 + r() * 0.06;
      pts.push([(R + rr * Math.cos(v)) * Math.cos(u), rr * Math.sin(v), (R + rr * Math.cos(v)) * Math.sin(u)]);
    }
  }
  return { pts, links };
}

export function ProjectVisual({ seed, stage, density, live, className }: { seed: string; stage: Stage; density: number; live: boolean; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const shape = useMemo(() => cloud(seed, stage, density), [seed, stage, density]);
  useEffect(() => {
    const cv = ref.current;
    if (cv === null) return;
    const ctx = cv.getContext('2d');
    if (ctx === null) return;
    let raf = 0;
    let angle = (rng(seed)() * Math.PI * 2) % (Math.PI * 2);
    let last = performance.now();
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const color = getComputedStyle(cv).color;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      const tilt = stage === 'read' ? 0.55 : 0.32;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const scale = Math.min(w, h * 1.5) * 0.36;
      const proj = shape.pts.map(([x, y, z]) => {
        const x1 = x * ca + z * sa;
        const z1 = -x * sa + z * ca;
        const y2 = y * ct - z1 * st;
        const z2 = y * st + z1 * ct;
        const f = 3 / (3 + z2);
        return [w / 2 + x1 * scale * f, h / 2 + y2 * scale * f, z2] as [number, number, number];
      });
      ctx.lineWidth = 0.6;
      for (const [a, b] of shape.links) {
        const A = proj[a];
        const B = proj[b];
        if (!A || !B) continue;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.moveTo(A[0], A[1]);
        ctx.lineTo(B[0], B[1]);
        ctx.stroke();
      }
      for (const [px, py, pz] of proj) {
        const near = Math.max(0, Math.min(1, (1 - pz) / 2));
        ctx.globalAlpha = 0.35 + near * 0.65;
        const s = 0.9 + near * 1.3;
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    };
    const tick = (now: number): void => {
      angle += ((now - last) / 1000) * 0.22;
      last = now;
      draw();
      raf = requestAnimationFrame(tick);
    };
    draw();
    let io: IntersectionObserver | null = null;
    if (live && !still) {
      io = new IntersectionObserver((e) => {
        cancelAnimationFrame(raf);
        if (e[0]?.isIntersecting) {
          last = performance.now();
          raf = requestAnimationFrame(tick);
        }
      });
      io.observe(cv);
    }
    const ro = new ResizeObserver(() => draw());
    ro.observe(cv);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      ro.disconnect();
    };
  }, [shape, live, seed, stage]);
  return <canvas ref={ref} aria-hidden className={cn('block h-full w-full', className)} />;
}

/* ------------------------------------------------------------- the shelf */

export function ProjectShelf(): React.JSX.Element {
  const list = useLive((signal) => op<{ projects: Project[] }>('projects.list', { state: 'active' }, { quiet: true, signal }).then((r) => r.projects), ['projects', 'project_works', 'nodes', 'relations', 'annotations', 'boards', 'manuscripts', 'reviews', 'tasks'], [], 300);
  const slots: Slot[] = useMemo(() => [...(list.data ?? []).map((p) => ({ kind: 'project' as const, p })), { kind: 'new' as const }], [list.data]);
  const [current, setCurrent] = useState<string>(() => {
    try {
      return localStorage.getItem('ro_home_project') ?? '';
    } catch {
      return '';
    }
  });
  const found = slots.findIndex((s) => (s.kind === 'project' ? s.p.id : 'new') === current);
  const index = found >= 0 ? found : 0;
  const go = useCallback(
    (i: number) => {
      const L = slots.length;
      const j = L >= 4 ? ((i % L) + L) % L : Math.max(0, Math.min(L - 1, i));
      const s = slots[j];
      if (s === undefined) return;
      const id = s.kind === 'project' ? s.p.id : 'new';
      setCurrent(id);
      try {
        localStorage.setItem('ro_home_project', id);
      } catch {
        /* a convenience */
      }
    },
    [slots],
  );
  const stage = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = stage.current;
    if (el === null) return;
    const ro = new ResizeObserver((e) => setWidth(e[0]?.contentRect.width ?? 1000));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // With the pointer anywhere in the section the wheel (either way) steps through the shelf, a card
  // a notch, and stops at the first and last card; it never scrolls the page from here.
  const section = useRef<HTMLElement | null>(null);
  const wheel = useRef({ at: 0, sum: 0, last: 0 });
  const stepRef = useRef({ index, go });
  stepRef.current = { index, go };
  useEffect(() => {
    const el = section.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const d = raw * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      if (d === 0) return;
      const s = stepRef.current;
      e.preventDefault();
      const w = wheel.current;
      const now = Date.now();
      // A trackpad sends many small deltas: they add up to a step, and a pause starts afresh.
      if (now - w.last > 200 || Math.sign(w.sum) !== Math.sign(d)) w.sum = 0;
      w.last = now;
      w.sum += d;
      if (Math.abs(w.sum) < 40 || now - w.at < 280) return;
      w.at = now;
      w.sum = 0;
      s.go(s.index + (d > 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const lastD = useRef(new Map<string, number>());
  const nextD = new Map<string, number>();
  useEffect(() => {
    lastD.current = nextD;
  });
  const swiped = useRef(false);

  const narrow = width < 640;
  const cardW = narrow ? Math.floor(Math.min(260, width - 96)) : 300;
  // Whole pixels: a card on a half pixel, or pulled toward the viewer, has its text drawn soft.
  const left = Math.floor((width - cardW) / 2);
  const cardH = narrow ? 370 : 410;
  const near = narrow ? cardW / 2 + 34 : cardW / 2 + 110;
  const stepX = narrow ? 16 : 44;
  const shown = narrow ? 2 : 4;
  const total = slots.length - 1;

  return (
    <section ref={section} aria-label="Projects" className="relative">
      <div className="mb-1 flex items-end gap-3">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.18em] text-[var(--ro-ink-2)]">Projects</h2>
        <span className="num text-[12px] text-[var(--ro-muted)]">{list.data !== null ? pad2(total) + ' active' : ''}</span>
        <span className="flex-1" />
        <button type="button" onClick={() => navigate('projects')} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ro-ink-2)] hover:text-[var(--ro-ink)]">
          All projects <ArrowRight size={12} />
        </button>
      </div>
      <div
        ref={stage}
        role="region"
        aria-roledescription="carousel"
        aria-label="Your projects"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(index + 1);
          else if (e.key === 'ArrowLeft') go(index - 1);
          else if (e.key === 'Home') go(0);
          else if (e.key === 'End') go(slots.length - 1);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, moved: false };
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d !== null && Math.abs(e.clientX - d.x) > 40) {
            swiped.current = true;
            go(index + (e.clientX < d.x ? 1 : -1));
          }
        }}
        className="relative overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-[var(--ro-ink)]"
        style={{ height: cardH + 64, perspective: 1300, touchAction: 'pan-y' }}
      >
        <Backdrop height={cardH + 64} />
        {list.data === null ? (
          <div className="ro-skeleton absolute top-10 rounded-[var(--ro-r-md)]" style={{ left, width: cardW, height: cardH }} />
        ) : (
          slots.map((s, i) => {
            const L = slots.length;
            let d = i - index;
            if (L >= 4) {
              d = ((d % L) + L) % L;
              if (d > L / 2) d -= L;
            }
            const key = s.kind === 'project' ? s.p.id : 'new';
            // A card that wraps from one end of the ring to the other moves without flying across the front.
            const before = lastD.current.get(key);
            const wraps = before !== undefined && Math.abs(before - d) > 2;
            nextD.set(key, d);
            const ad = Math.abs(d);
            const side = Math.sign(d);
            const x = d === 0 ? 0 : side * (near + (ad - 1) * stepX);
            const hidden = ad > shown;
            // The front card has no transform at all: outside the 3D stage it is drawn as plain, sharp text.
            const transform = d === 0 ? 'none' : `translateX(${Math.round(x)}px) translateZ(${-ad * 30}px) rotateY(${-side * 58}deg) scale(0.92)`;
            return (
              <div
                key={key}
                className={cn('absolute top-8', !wraps && 'transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,0.8,0.24,1)]')}
                style={{ left, width: cardW, height: cardH, transform, opacity: hidden ? 0 : 1, zIndex: 50 - ad, pointerEvents: hidden ? 'none' : 'auto' }}
                aria-hidden={hidden}
              >
                <Card
                  slot={s}
                  n={i + 1}
                  front={d === 0}
                  onSelect={() => {
                    // The click that ends a swipe is not a click on the card.
                    if (swiped.current) {
                      swiped.current = false;
                      return;
                    }
                    if (d !== 0) go(i);
                    else if (s.kind === 'project') navigate('project', { id: s.p.id });
                    else navigate('projects', { new: '1' });
                  }}
                />
              </div>
            );
          })
        )}
        <button type="button" aria-label="Previous project" disabled={slots.length < 4 && index === 0} onClick={() => go(index - 1)} className="absolute left-0 top-1/2 z-[60] flex size-8 -translate-y-1/2 items-center justify-center rounded-[var(--ro-r-sm)] border border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink-2)] hover:text-[var(--ro-ink)] disabled:opacity-30">
          <ChevronLeft size={15} />
        </button>
        <button type="button" aria-label="Next project" disabled={slots.length < 4 && index === slots.length - 1} onClick={() => go(index + 1)} className="absolute right-0 top-1/2 z-[60] flex size-8 -translate-y-1/2 items-center justify-center rounded-[var(--ro-r-sm)] border border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink-2)] hover:text-[var(--ro-ink)] disabled:opacity-30">
          <ChevronRight size={15} />
        </button>
      </div>
      <Ruler count={slots.length} index={index} onPick={go} />
    </section>
  );
}

/** The dotted rings and the cross grid the cards stand in. */
function Backdrop({ height }: { height: number }): React.JSX.Element {
  const rings = (cy: number, key: string): React.JSX.Element => (
    <g key={key}>
      {[0, 1, 2, 3].map((k) => (
        <ellipse key={k} cx="50%" cy={cy + k * 5} rx="47%" ry={34 + k * 3} fill="none" strokeWidth={1.6} strokeLinecap="round" strokeDasharray="0.1 6" style={{ stroke: 'var(--ro-grid)' }} opacity={1 - k * 0.18} />
      ))}
    </g>
  );
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" style={{ maskImage: 'radial-gradient(ellipse at center, black 45%, transparent 78%)', WebkitMaskImage: 'radial-gradient(ellipse at center, black 45%, transparent 78%)' }}>
      <defs>
        <pattern id="ro-cross" width="44" height="44" patternUnits="userSpaceOnUse">
          <path d="M18 22h8M22 18v8" strokeWidth={1} style={{ stroke: 'var(--ro-grid)' }} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#ro-cross)" />
      {rings(height * 0.2, 'top')}
      {rings(height * 0.8, 'bottom')}
    </svg>
  );
}

function Card({ slot, n, front, onSelect }: { slot: Slot; n: number; front: boolean; onSelect: () => void }): React.JSX.Element {
  if (slot.kind === 'new') {
    return (
      <button type="button" onClick={onSelect} aria-label="Start a new project" className={cn('flex h-full w-full flex-col rounded-[var(--ro-r-md)] border border-dashed p-4 text-left transition-colors', front ? 'border-[var(--ro-ink-2)] bg-[var(--ro-card)] hover:bg-[var(--ro-row)]' : 'border-[var(--ro-line)] bg-[var(--ro-card)]')}>
        <span className="flex items-baseline gap-2 border-b border-[var(--ro-line)] pb-3">
          <span className="num text-[26px] font-light leading-none text-[var(--ro-ink-2)]">{pad2(n)}</span>
          <span className="text-[12px] font-bold uppercase tracking-[0.2em] text-[var(--ro-muted)]">Open slot</span>
        </span>
        <span className="flex flex-1 items-center justify-center">
          <span className="flex size-20 items-center justify-center rounded-full border border-dashed border-[var(--ro-line)] text-[var(--ro-ink-2)]">
            <Plus size={28} strokeWidth={1.5} />
          </span>
        </span>
        <span className="border-t border-[var(--ro-line)] pt-3">
          <span className="block text-[15px] font-bold">New project</span>
          <span className="mt-1 block text-[12px] leading-4 text-[var(--ro-ink-2)]">A research question, with its papers, claims, to-do and writing.</span>
        </span>
      </button>
    );
  }
  const p = slot.p;
  const s = p.stats;
  const st = stageOf(p);
  const density = (s?.papers ?? 0) * 3 + (s?.claims ?? 0) * 2 + (s?.evidence ?? 0) + (s?.highlights ?? 0) * 0.5;
  const pc = `var(--ro-pc-${p.color})`;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={front ? 'Open ' + p.name : 'Show ' + p.name}
      className={cn(
        'group relative flex h-full w-full flex-col overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-4 pt-5 text-left text-[var(--ro-ink)] transition-[box-shadow,border-color]',
        front ? 'shadow-[var(--ro-shadow)] hover:border-[var(--ro-ink-2)]' : 'shadow-[-6px_0_18px_-10px_rgb(0_0_0/0.25)]',
      )}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: pc }} />
      <span className="flex items-center gap-2 border-b border-[var(--ro-line)] pb-3">
        <span className={cn('num text-[26px] font-light leading-none', front ? 'text-[var(--ro-ink)]' : 'text-[var(--ro-ink-2)]')}>{pad2(n)}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-[0.2em] text-[var(--ro-muted)]">{STAGE[st].label}</span>
        {p.confidentiality === 'confidential' ? (
          <span className="inline-flex items-center gap-1 rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--ro-ink-2)]" title="Your AI agent is kept out of this project">
            <Lock size={11} /> Private
          </span>
        ) : (s?.proposed ?? 0) > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-[var(--ro-r-sm)] bg-[var(--ro-accent-soft)] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--ro-accent-text)]" title="Proposed by your AI agent, waiting for you">
            <Sparkles size={11} /> {num(s?.proposed ?? 0)}
          </span>
        ) : null}
      </span>
      <span className={cn('relative min-h-0 flex-1', !front && 'opacity-60')} style={{ color: front ? pc : 'var(--ro-ink-2)' }}>
        <ProjectVisual seed={p.id} stage={st} density={density} live={front} />
      </span>
      <span className="border-t border-[var(--ro-line)] pt-3">
        <span className="line-clamp-1 text-[15px] font-bold">{p.name}</span>
        <span className="mt-1 line-clamp-2 min-h-8 text-[12px] leading-4 text-[var(--ro-ink-2)]">{p.question !== '' ? p.question : 'No research question yet'}</span>
        <ProjectTodo p={p} />
      </span>
    </button>
  );
}

/** The ruler under the shelf: a tick per slot, the current one marked, "03 / 08" beneath. */
function Ruler({ count, index, onPick }: { count: number; index: number; onPick: (i: number) => void }): React.JSX.Element {
  const from = Math.max(0, Math.min(index - 7, count - 15));
  const to = Math.min(count, from + 15);
  return (
    <div className="mt-1 flex flex-col items-center gap-1">
      <div className="flex items-end">
        {Array.from({ length: to - from }, (_, k) => {
          const i = from + k;
          const on = i === index;
          return (
            <button key={i} type="button" aria-label={'Project ' + (i + 1)} aria-current={on} onClick={() => onPick(i)} className="group flex w-7 flex-col items-center gap-1 pb-0.5">
              <span className={cn('size-0 border-x-[4px] border-t-[5px] border-x-transparent', on ? 'border-t-[var(--ro-accent)]' : 'border-t-transparent')} />
              <span className={cn('w-px transition-all', on ? 'h-4 bg-[var(--ro-accent)]' : 'h-2.5 bg-[var(--ro-line)] group-hover:h-3.5 group-hover:bg-[var(--ro-ink-2)]')} />
              <span className={cn('num text-[12px] leading-none', on ? 'font-bold text-[var(--ro-ink)]' : 'text-[var(--ro-muted)]')}>{pad2(i + 1)}</span>
            </button>
          );
        })}
      </div>
      <span className="num text-[12px] font-bold tracking-[0.2em] text-[var(--ro-ink-2)]">
        {pad2(index + 1)} / {pad2(count)}
      </span>
    </div>
  );
}
