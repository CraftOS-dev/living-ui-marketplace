/**
 * Network: the map of who you know. Companies are squares sized by how many
 * of your people work there, people are circles sized and colored by how
 * strong the relationship is (green strong, blue good, amber weak, gray no
 * contact yet), open deals are orange diamonds; lines are where someone
 * works and who is on a deal. The layout is a force simulation, seeded from
 * the ids so the map holds still between visits. Drag to pan, scroll or the
 * buttons to zoom, hover to light up a node and its connections, click to
 * open the record.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Building2, Kanban, Maximize2, Minus, Plus, Search, Users } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { compact, since, strengthBand, STRENGTH_LABEL } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Company, Deal, Person } from '../lib/types.ts';
import { HeaderActions } from '../components/Shell.tsx';
import { Spinner } from '../components/ui.tsx';

type Kind = 'company' | 'person' | 'deal';
type Show = 'all' | 'warm' | 'cold';

interface GNode {
  id: string;
  kind: Kind;
  label: string;
  sub: string;
  r: number;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GEdge {
  a: number;
  b: number;
  len: number;
  deal: boolean;
  /** A secondary tie (a deal's people): a soft pull, so clusters stay around their company. */
  weak?: boolean | undefined;
}

const BAND_COLOR: Record<string, string> = { strong: 'var(--cr-pos)', good: 'var(--cr-c1)', weak: 'var(--cr-warn)', none: 'var(--cr-line)' };

function seed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function daysAgo(ts: string): number {
  if (ts === '') return Infinity;
  return (Date.now() - Date.parse(ts.replace(' ', 'T'))) / 86400000;
}

function build(people: Person[], companies: Company[], deals: Deal[], show: Show, withDeals: boolean, home: string): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const index = new Map<string, number>();
  const add = (n: Omit<GNode, 'x' | 'y' | 'vx' | 'vy'>, cx: number, cy: number, spread: number): number => {
    const a = seed(n.id) * Math.PI * 2;
    const d = spread * (0.35 + seed(n.id + 'r') * 0.65);
    nodes.push({ ...n, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: 0, vy: 0 });
    index.set(n.kind + n.id, nodes.length - 1);
    return nodes.length - 1;
  };
  const shown = people.filter((p) => (show === 'warm' ? p.strength >= 30 : show === 'cold' ? p.touches >= 3 && daysAgo(p.last_interaction) > 60 : true));
  const usedCompanies = new Set(shown.map((p) => p.company).filter((c) => c !== ''));
  const openDeals = withDeals ? deals.filter((d) => d.status === 'open') : [];
  for (const d of openDeals) if (d.company !== '') usedCompanies.add(d.company);
  const comps = companies.filter((c) => usedCompanies.has(c.id));
  const R0 = 80 + Math.sqrt(comps.length) * 95;
  comps.forEach((c, i) => {
    const a = (i / Math.max(comps.length, 1)) * Math.PI * 2;
    add({ id: c.id, kind: 'company', label: c.name, sub: [c.industry, c.people + ' ' + (c.people === 1 ? 'person' : 'people')].filter(Boolean).join(' · '), r: 13 + Math.min(9, c.people * 1.6), color: 'var(--cr-card)' }, Math.cos(a) * R0, Math.sin(a) * R0, 30);
  });
  const edges: GEdge[] = [];
  for (const p of shown) {
    const ci = p.company !== '' ? index.get('company' + p.company) : undefined;
    const base = ci !== undefined ? nodes[ci] : undefined;
    const band = strengthBand(p.strength);
    const pi = add(
      { id: p.id, kind: 'person', label: p.name, sub: [p.title, p.company_name].filter(Boolean).join(' at ') + (p.last_interaction ? ' · last contact ' + since(p.last_interaction) : ''), r: 5.5 + (Math.min(100, p.strength) / 100) * 5, color: BAND_COLOR[band] ?? 'var(--cr-line)' },
      base?.x ?? 0,
      base?.y ?? 0,
      base !== undefined ? 50 : R0 + 120,
    );
    if (ci !== undefined) edges.push({ a: pi, b: ci, len: 58, deal: false });
  }
  for (const d of openDeals) {
    const ci = d.company !== '' ? index.get('company' + d.company) : undefined;
    const base = ci !== undefined ? nodes[ci] : undefined;
    const di = add({ id: d.id, kind: 'deal', label: d.name, sub: d.stage_name + ' · ' + (d.home_value !== null ? compact(d.home_value, home) : compact(d.value, d.currency)), r: 6, color: 'var(--cr-accent)' }, base?.x ?? 0, base?.y ?? 0, 40);
    if (ci !== undefined) edges.push({ a: di, b: ci, len: 44, deal: true });
    for (const pp of d.people) {
      const pi = index.get('person' + pp.id);
      if (pi !== undefined) edges.push({ a: di, b: pi, len: 90, deal: true, weak: true });
    }
  }
  // Force layout: everything repels, lines pull to their length, a light pull to the middle.
  const n = nodes.length;
  const iters = n > 300 ? 140 : n > 150 ? 220 : 320;
  for (let it = 0; it < iters; it++) {
    const alpha = 1 - it / iters;
    for (let i = 0; i < n; i++) {
      const p = nodes[i] as GNode;
      for (let j = i + 1; j < n; j++) {
        const q = nodes[j] as GNode;
        let dx = p.x - q.x;
        let dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = seed(p.id + q.id) - 0.5;
          dy = seed(q.id + p.id) - 0.5;
          d2 = 0.25;
        }
        if (d2 > 250000) continue;
        const min = p.r + q.r + 16;
        const f = ((p.kind === 'company' && q.kind === 'company' ? 9000 : p.kind === 'company' || q.kind === 'company' ? 3200 : 2000) * (0.3 + alpha)) / d2 + (d2 < min * min ? 0.9 : 0);
        const d = Math.sqrt(d2);
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
        q.vx -= (dx / d) * f;
        q.vy -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const p = nodes[e.a] as GNode;
      const q = nodes[e.b] as GNode;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
      const f = ((d - e.len) / d) * (e.weak === true ? 0.012 : 0.07) * (0.4 + alpha);
      p.vx += dx * f;
      p.vy += dy * f;
      q.vx -= dx * f;
      q.vy -= dy * f;
    }
    for (const p of nodes) {
      p.vx -= p.x * 0.0025;
      p.vy -= p.y * 0.0025;
      const sp = Math.hypot(p.vx, p.vy);
      const cap = 14 * (0.2 + alpha);
      if (sp > cap) {
        p.vx = (p.vx / sp) * cap;
        p.vy = (p.vy / sp) * cap;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.55;
      p.vy *= 0.55;
    }
  }
  return { nodes, edges };
}

interface Cam {
  x: number;
  y: number;
  k: number;
}

function fit(nodes: GNode[], w: number, h: number): Cam {
  if (nodes.length === 0 || w === 0) return { x: 0, y: 0, k: 1 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x - n.r);
    y0 = Math.min(y0, n.y - n.r);
    x1 = Math.max(x1, n.x + n.r);
    y1 = Math.max(y1, n.y + n.r + 14);
  }
  const k = Math.min(1.4, Math.min((w - 120) / Math.max(1, x1 - x0), (h - 120) / Math.max(1, y1 - y0)));
  return { x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k, k };
}

function Legend(): React.JSX.Element {
  const row = (shape: ReactNode, label: string): React.JSX.Element => (
    <span className="flex items-center gap-1.5">
      {shape}
      {label}
    </span>
  );
  return (
    <div className="cr-block pointer-events-auto flex flex-col gap-1 px-3 py-2 text-[11.5px] text-[var(--cr-ink-2)]">
      {row(<span className="inline-block size-3 border border-[var(--cr-ink-2)] bg-[var(--cr-card)]" />, 'Company')}
      {(['strong', 'good', 'weak', 'none'] as const).map((b) => row(<span className="inline-block size-2.5 rounded-full" style={{ background: BAND_COLOR[b] }} />, STRENGTH_LABEL[b] ?? b))}
      {row(<span className="inline-block size-2.5 rotate-45 bg-[var(--cr-accent)]" />, 'Open deal')}
    </div>
  );
}

export function NetworkView(): React.JSX.Element {
  const app = useApp();
  const [show, setShow] = useState<Show>('all');
  const [withDeals, setWithDeals] = useState(true);
  const [q, setQ] = useState('');
  const [hover, setHover] = useState<number | null>(null);
  const [cam, setCam] = useState<Cam | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const wrap = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  useReportScreen('network', null, { show, deals: withDeals });
  const live = useLive(
    async () => {
      const [p, c, d] = await Promise.all([api.people({ limit: 1000, sort: 'strength', dir: 'desc' }), api.companies({ limit: 1000 }), api.deals({ limit: 1000, status: 'open' })]);
      return { people: p.people, companies: c.companies, deals: d.deals };
    },
    ['people', 'companies', 'deals', 'deal_people', 'employments'],
    [],
    800,
  );
  const graph = useMemo(() => (live.data === null ? null : build(live.data.people.slice(0, 400), live.data.companies, live.data.deals, show, withDeals, app.home)), [live.data, show, withDeals, app.home]);

  useEffect(() => {
    const el = wrap.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [live.data === null]);

  useEffect(() => {
    if (graph !== null && size.w > 0) setCam(fit(graph.nodes, size.w, size.h));
  }, [graph, size.w, size.h]);

  useEffect(() => {
    const el = wrap.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setCam((c) => {
        if (c === null) return c;
        const k = Math.max(0.25, Math.min(4, c.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        return { k, x: mx - ((mx - c.x) / c.k) * k, y: my - ((my - c.y) / c.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [live.data === null]);

  const neighbors = useMemo(() => {
    const out = new Set<number>();
    if (graph === null || hover === null) return out;
    out.add(hover);
    for (const e of graph.edges) {
      if (e.a === hover) out.add(e.b);
      if (e.b === hover) out.add(e.a);
    }
    return out;
  }, [graph, hover]);
  const term = q.trim().toLowerCase();
  const match = (n: GNode): boolean => term !== '' && n.label.toLowerCase().includes(term);

  const zoom = (f: number): void =>
    setCam((c) => {
      if (c === null) return c;
      const k = Math.max(0.25, Math.min(4, c.k * f));
      return { k, x: size.w / 2 - ((size.w / 2 - c.x) / c.k) * k, y: size.h / 2 - ((size.h / 2 - c.y) / c.k) * k };
    });
  const open = (n: GNode): void => {
    if (n.kind === 'person') go('people', { id: n.id });
    else if (n.kind === 'company') go('companies', { id: n.id });
    else go('deals', { id: n.id });
  };

  const header = (
    <HeaderActions>
      <label className="cr-block relative flex h-8 items-center">
        <Search size={13} className="pointer-events-none absolute left-2.5 text-[var(--cr-muted)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find on the map" aria-label="Find on the map" className="h-full w-40 bg-transparent pl-7 pr-2 text-[12.5px] outline-none" />
      </label>
      <div role="radiogroup" aria-label="People shown" className="cr-block flex h-8 items-center">
        {(
          [
            ['all', 'Everyone'],
            ['warm', 'Warm'],
            ['cold', 'Going cold'],
          ] as const
        ).map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={show === v} onClick={() => setShow(v)} className={cn('h-full px-2.5 text-[12px] font-medium transition-colors', show === v ? 'bg-[var(--cr-ink)] text-[var(--cr-card)]' : 'text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)]')}>
            {l}
          </button>
        ))}
      </div>
      <button type="button" aria-pressed={withDeals} onClick={() => setWithDeals((x) => !x)} className={cn('cr-block inline-flex h-8 items-center gap-1.5 px-2.5 text-[12px] font-medium', withDeals ? 'text-[var(--cr-accent-text)]' : 'text-[var(--cr-muted)]')}>
        <Kanban size={13} /> Deals
      </button>
    </HeaderActions>
  );

  if (live.data === null || graph === null)
    return (
      <div className="flex h-full items-center justify-center">
        {header}
        <Spinner size={18} />
      </div>
    );
  const people = graph.nodes.filter((n) => n.kind === 'person').length;
  const comps = graph.nodes.filter((n) => n.kind === 'company').length;
  const dealsN = graph.nodes.filter((n) => n.kind === 'deal').length;
  const h = hover !== null ? graph.nodes[hover] : undefined;
  const c = cam ?? { x: 0, y: 0, k: 1 };
  const base = size.w > 0 ? fit(graph.nodes, size.w, size.h).k : 1;
  const labelAll = c.k >= base * 1.7;
  return (
    <div className="relative h-full overflow-hidden" style={{ backgroundImage: 'radial-gradient(var(--cr-hair) 1px, transparent 1px)', backgroundSize: `${22 * c.k}px ${22 * c.k}px`, backgroundPosition: `${c.x}px ${c.y}px` }}>
      {header}
      <div
        ref={wrap}
        className={cn('absolute inset-0 select-none', drag.current !== null ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[data-node]') !== null) return;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y, moved: false };
        }}
        onPointerMove={(e) => {
          const dr = drag.current;
          if (dr === null) return;
          dr.moved = true;
          setCam({ k: c.k, x: dr.cx + e.clientX - dr.x, y: dr.cy + e.clientY - dr.y });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {graph.nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Users size={22} className="text-[var(--cr-muted)]" />
            <p className="text-[13px] font-semibold">{show === 'all' ? 'Nobody on the map yet' : show === 'warm' ? 'No warm relationships yet' : 'Nobody is going cold'}</p>
            <p className="max-w-xs text-[12.5px] text-[var(--cr-muted)]">{show === 'all' ? 'Add people and companies, or ask your AI agent to fill the CRM from your email and calendar.' : 'Log calls, meetings and emails and relationships show here by strength.'}</p>
          </div>
        ) : (
          <svg width={size.w} height={size.h} className="block" role="img" aria-label="Your network of people, companies and deals">
            <g transform={`translate(${c.x},${c.y}) scale(${c.k})`}>
              {graph.edges.map((e, i) => {
                const a = graph.nodes[e.a] as GNode;
                const b = graph.nodes[e.b] as GNode;
                const lit = hover !== null && (e.a === hover || e.b === hover);
                const dim = hover !== null && !lit;
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lit ? 'var(--cr-accent)' : e.deal ? 'var(--cr-accent)' : 'var(--cr-line)'} strokeWidth={(lit ? 1.6 : 1) / Math.max(0.6, c.k)} strokeDasharray={e.deal ? '3 3' : undefined} opacity={dim ? 0.15 : e.deal && !lit ? 0.45 : 1} className={lit && e.deal ? 'cr-flow' : undefined} />;
              })}
              {graph.nodes.map((n, i) => {
                const dim = hover !== null && !neighbors.has(i);
                const hit = match(n);
                const showLabel = n.kind === 'company' || labelAll || neighbors.has(i) || hit;
                return (
                  <g key={n.kind + n.id} data-node transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.22 : term !== '' && !hit ? 0.35 : 1} className="cursor-pointer" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover((x) => (x === i ? null : x))} onClick={() => open(n)}>
                    {hit && <circle r={n.r + 6} fill="none" stroke="var(--cr-accent)" strokeWidth={2 / c.k} />}
                    {n.kind === 'company' ? (
                      <>
                        <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} fill="var(--cr-card)" stroke={hover === i ? 'var(--cr-accent)' : 'var(--cr-ink-2)'} strokeWidth={1.4 / Math.max(0.7, c.k)} />
                        <text textAnchor="middle" dy="0.35em" fontSize={Math.max(8, n.r * 0.62)} fontWeight={700} fill="var(--cr-ink)">
                          {n.label
                            .split(/\s+/)
                            .map((w) => w[0] ?? '')
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </text>
                      </>
                    ) : n.kind === 'person' ? (
                      <circle r={n.r} fill={n.color} stroke="var(--cr-card)" strokeWidth={1.5} />
                    ) : (
                      <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} transform="rotate(45)" fill="var(--cr-accent)" stroke="var(--cr-card)" strokeWidth={1.2} />
                    )}
                    {showLabel && (
                      <text y={n.r + 11 / Math.max(0.8, c.k)} textAnchor="middle" fontSize={11 / Math.max(0.8, c.k)} fontWeight={n.kind === 'company' ? 600 : 400} fill={n.kind === 'company' ? 'var(--cr-ink)' : 'var(--cr-ink-2)'} paintOrder="stroke" stroke="var(--cr-card)" strokeWidth={3 / Math.max(0.8, c.k)}>
                        {n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>

      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
        <div className="cr-block flex items-center gap-3 px-3 py-2 text-[12px] text-[var(--cr-ink-2)]">
          <span className="flex items-center gap-1.5">
            <Users size={12} /> <b className="num">{people}</b> people
          </span>
          <span className="flex items-center gap-1.5">
            <Building2 size={12} /> <b className="num">{comps}</b> companies
          </span>
          {withDeals && (
            <span className="flex items-center gap-1.5">
              <Kanban size={12} /> <b className="num">{dealsN}</b> open deals
            </span>
          )}
        </div>
        {h !== undefined && (
          <div className="cr-block cr-pop flex max-w-[280px] flex-col gap-0.5 px-3 py-2">
            <p className="cr-label">{h.kind === 'person' ? 'Person' : h.kind === 'company' ? 'Company' : 'Open deal'}</p>
            <p className="truncate text-[13px] font-semibold">{h.label}</p>
            {h.sub !== '' && <p className="text-[12px] leading-[17px] text-[var(--cr-ink-2)]">{h.sub}</p>}
            <p className="mt-0.5 text-[11px] text-[var(--cr-muted)]">{neighbors.size - 1} connection{neighbors.size === 2 ? '' : 's'} · click to open</p>
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 hidden sm:block">
        <Legend />
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col">
        <div className="cr-block flex flex-col">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)} className="flex size-8 items-center justify-center text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)]">
            <Plus size={14} />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)} className="flex size-8 items-center justify-center border-t border-[var(--cr-hair)] text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)]">
            <Minus size={14} />
          </button>
          <button type="button" aria-label="Fit the map" onClick={() => setCam(fit(graph.nodes, size.w, size.h))} className="flex size-8 items-center justify-center border-t border-[var(--cr-hair)] text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)]">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
