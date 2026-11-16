/**
 * Pipeline flow: this quarter's cohort as a Sankey, from Inbound through
 * each stage to Invested and Passed. The columns are deals' cohort funnel
 * (how many of the quarter's inbound reached each stage); the exits say
 * where each one stopped. What moved on flows right into the next stage;
 * what was invested flows to Invested; what was passed drops into the row
 * of grey Passed bars below its stage; what is still open (or held) stays
 * as the paler part of its stage's bar. Below 560 px the flow runs top to
 * bottom and each stage's passed deals stay as the grey end of its bar,
 * counted beside it. One sweep on first draw; tooltips carry the detail.
 */
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { GitFork } from 'lucide-react';
import { num, pct, plural } from '../../lib/format.ts';
import { Empty, Panel, Skeleton } from '../ui.tsx';
import type { FlowAnswer } from './types.ts';
import { useDrawn, useWidth } from './viz.tsx';

type Kind = 'go' | 'inv' | 'pas';

interface Ribbon {
  key: string;
  kind: Kind;
  /** Source and target along the flow axis; cross ranges at each end. */
  f1: number;
  f2: number;
  a1: number;
  b1: number;
  a2: number;
  b2: number;
  tip: string;
}

/** A bar segment: along the flow axis at f (THICK deep), across from a to b. */
interface Seg {
  key: string;
  f: number;
  a: number;
  b: number;
  fill: string;
  tip: string;
  hover: string;
}

const THICK = 8;
const MIN = 2;

function ribbonPath(r: Ribbon, vertical: boolean): string {
  const fm = (r.f1 + r.f2) / 2;
  const P = (f: number, c: number): string => (vertical ? `${c.toFixed(1)},${f.toFixed(1)}` : `${f.toFixed(1)},${c.toFixed(1)}`);
  return `M${P(r.f1, r.a1)}C${P(fm, r.a1)} ${P(fm, r.a2)} ${P(r.f2, r.a2)}L${P(r.f2, r.b2)}C${P(fm, r.b2)} ${P(fm, r.b1)} ${P(r.f1, r.b1)}Z`;
}

const FILL: Record<Kind, string> = { go: 'var(--vo-a)', inv: 'var(--vo-good)', pas: 'var(--vo-muted)' };
const REST: Record<Kind, number> = { go: 0.18, inv: 0.32, pas: 0.14 };
const HERE = 'color-mix(in srgb, var(--vo-a) 38%, var(--vo-panel))';

interface Layout {
  segs: Seg[];
  ribbons: Ribbon[];
  height: number;
  fOf: (i: number) => number;
  /** Flow position of each column's Passed bar. */
  exitF: (i: number) => number;
  exitLo: number;
  fT: number;
  mainLo: number;
  k: number;
  spacing: number;
  invTot: number;
  pasTot: number;
  passedAt: number[];
  /** Where each stage's bar ends across the flow (the phone's passed counts sit there). */
  barEnd: number[];
}

function layout(flow: FlowAnswer, width: number, vertical: boolean): Layout {
  const cols = flow.columns;
  const n = cols.length;
  const N = cols.map((c) => c.count);
  const N0 = Math.max(1, N[0] ?? 0);
  const ex = (i: number): { passed: number; invested: number; held: number; open: number } => flow.exits[i] ?? { passed: 0, invested: 0, held: 0, open: 0 };
  const P = cols.map((_, i) => ex(i).passed);
  const maxP = Math.max(1, ...P);
  let invTot = 0;
  let pasTot = 0;
  for (let i = 0; i < n; i++) {
    invTot += ex(i).invested;
    pasTot += ex(i).passed;
  }
  let mainLo: number;
  let mainSpan: number;
  let exitLo: number;
  let exitSpan: number;
  let fOf: (i: number) => number;
  let spacing: number;
  let fT: number;
  if (vertical) {
    mainLo = 128;
    mainSpan = Math.max(40, width - 30 - mainLo);
    exitLo = 0;
    exitSpan = Infinity;
    spacing = 34;
    fOf = (i) => 6 + i * spacing;
    fT = fOf(n) + 4;
  } else {
    mainLo = 58;
    mainSpan = 168;
    exitLo = 0;
    exitSpan = 54;
    const right = 96;
    spacing = (width - right - 2) / n;
    fOf = (i) => 2 + i * spacing;
    fT = width - right + 16;
  }
  const k = Math.min(mainSpan / N0, exitSpan / maxP);
  // The drops start right under the tallest bar.
  if (!vertical) exitLo = mainLo + N0 * k + 22;
  const span = (count: number): number => (count <= 0 ? 0 : Math.max(MIN, count * k));
  const mid = mainLo + (N0 * k) / 2;
  const exitF = (i: number): number => fOf(i) + Math.max(THICK + 6, spacing * 0.58);
  const height = vertical ? fT + THICK + 26 : exitLo + maxP * k + 22;
  const segs: Seg[] = [];
  const ribbons: Ribbon[] = [];
  const top = N.map((c) => mid - span(c) / 2);
  const barEnd = N.map((c, i) => (top[i] ?? 0) + span(c));
  let invAt = mainLo;
  for (let i = 0; i < n; i++) {
    const c = cols[i];
    if (c === undefined) continue;
    const ni = N[i] ?? 0;
    const e = ex(i);
    const nextN = i + 1 < n ? (N[i + 1] ?? 0) : 0;
    const here = e.open + e.held;
    const nodeTip =
      i === 0
        ? `${c.label}: ${num(ni)} came in this quarter` + (here > 0 ? `, ${num(here)} still in the Inbox` : '') + (e.passed > 0 ? `, ${num(e.passed)} passed` : '')
        : `${c.label}: ${num(ni)} reached it` + (nextN > 0 ? `, ${num(nextN)} moved on` : '') + (here > 0 ? `, ${num(here)} here now` : '') + (e.passed > 0 ? `, ${num(e.passed)} passed` : '');
    const f = fOf(i);
    if (ni === 0) {
      segs.push({ key: 'z' + i, f, a: mid - 0.5, b: mid + 0.5, fill: 'var(--vo-line-2)', tip: `${c.label}: none yet`, hover: 'c' + i });
      continue;
    }
    // The bar, top to bottom: moved on, invested, still here, passed.
    let at = top[i] ?? mainLo;
    const piece = (key: string, count: number, fill: string): [number, number] | null => {
      if (count <= 0) return null;
      const w = span(count);
      const r: [number, number] = [at, at + w];
      segs.push({ key: key + i, f, a: at, b: at + w, fill, tip: nodeTip, hover: 'c' + i });
      at += w;
      return r;
    };
    const go = i + 1 < n ? piece('go', nextN, 'var(--vo-a)') : null;
    const inv = piece('inv', e.invested, 'var(--vo-good)');
    piece('here', here, HERE);
    const pas = piece('pas', e.passed, 'var(--vo-muted)');
    if (go !== null) {
      const nx = cols[i + 1];
      const ta = top[i + 1] ?? mainLo;
      ribbons.push({ key: 'go' + i, kind: 'go', f1: f + THICK, f2: fOf(i + 1), a1: go[0], b1: go[1], a2: ta, b2: ta + (go[1] - go[0]), tip: `${c.label} to ${nx?.label ?? ''}: ${num(nextN)} of ${num(ni)}` + (nx !== undefined && nx.conversion_ppm !== null ? `, ${pct(nx.conversion_ppm, 0)}` : '') });
    }
    if (inv !== null) {
      const w = inv[1] - inv[0];
      ribbons.push({ key: 'inv' + i, kind: 'inv', f1: f + THICK, f2: fT, a1: inv[0], b1: inv[1], a2: invAt, b2: invAt + w, tip: `Invested from ${c.label}: ${num(e.invested)}` });
      invAt += w;
    }
    if (pas !== null && !vertical) {
      const w = pas[1] - pas[0];
      const tip = `Passed at ${c.label}: ${num(e.passed)}`;
      ribbons.push({ key: 'pas' + i, kind: 'pas', f1: f + THICK, f2: exitF(i), a1: pas[0], b1: pas[1], a2: exitLo, b2: exitLo + w, tip });
      segs.push({ key: 'x' + i, f: exitF(i), a: exitLo, b: exitLo + w, fill: 'var(--vo-muted)', tip, hover: 'pas' + i });
    }
  }
  segs.push({ key: 'inv', f: fT, a: mainLo, b: mainLo + Math.max(1, span(invTot)), fill: invTot > 0 ? 'var(--vo-good)' : 'var(--vo-line-2)', tip: `Invested: ${num(invTot)}`, hover: 'inv' });
  return { segs, ribbons, height, fOf, exitF, exitLo, fT, mainLo, k, spacing, invTot, pasTot, passedAt: P, barEnd };
}

function Sankey({ flow }: { flow: FlowAnswer }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const drawn = useDrawn();
  const clip = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [hover, setHover] = useState<{ key: string; tip: string; x: number; y: number } | null>(null);
  const vertical = width > 0 && width < 560;
  const L = width > 0 ? layout(flow, width, vertical) : null;
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [tipW, setTipW] = useState(160);
  useLayoutEffect(() => {
    if (tipRef.current !== null) setTipW(tipRef.current.offsetWidth);
  });
  const XY = (f: number, c: number): { x: number; y: number } => (vertical ? { x: c, y: f } : { x: f, y: c });
  const move = (e: React.PointerEvent, key: string, tip: string): void => {
    const box = ref.current?.getBoundingClientRect();
    if (box === undefined) return;
    setHover({ key, tip, x: e.clientX - box.left, y: e.clientY - box.top });
  };
  const cols = flow.columns;
  const label = cols.map((c) => `${c.label} ${c.count}`).join(', ');
  const lit = (key: string): boolean => hover !== null && hover.key === key;
  return (
    <div ref={ref} className="relative w-full min-w-0" style={{ height: L?.height ?? 272 }}>
      {L !== null && (
        <>
          <svg width={width} height={L.height} role="img" aria-label={`Pipeline flow this quarter: ${label}; invested ${L.invTot}, passed ${L.pasTot}`} className="block overflow-visible" onPointerLeave={() => setHover(null)}>
            <defs>
              <clipPath id={clip}>
                <rect x={-4} y={-4} width={width + 8} height={L.height + 8} style={{ transformOrigin: '0px 0px', transform: drawn ? 'scale(1, 1)' : vertical ? 'scale(1, 0)' : 'scale(0, 1)', transition: 'transform 700ms cubic-bezier(0.2, 0.7, 0.2, 1)' }} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clip})`}>
              {L.ribbons.map((r) => (
                <path key={r.key} d={ribbonPath(r, vertical)} onPointerMove={(e) => move(e, r.key, r.tip)} style={{ fill: FILL[r.kind], opacity: lit(r.key) ? REST[r.kind] + 0.22 : REST[r.kind], transition: 'opacity 150ms ease' }} />
              ))}
              {L.segs.map((g) => {
                const p = XY(g.f, g.a);
                const len = Math.max(1, g.b - g.a);
                return <rect key={g.key} x={p.x} y={p.y} width={vertical ? len : THICK} height={vertical ? THICK : len} onPointerMove={(e) => move(e, g.hover, g.tip)} style={{ fill: g.fill, opacity: lit(g.hover) ? 0.75 : 1, transition: 'opacity 150ms ease' }} />;
              })}
            </g>
          </svg>
          {/* Column labels: the count (and the conversion from the column before), then the stage. */}
          {cols.map((c, i) => {
            const f = L.fOf(i);
            const conv = i > 0 && c.conversion_ppm !== null ? pct(c.conversion_ppm, 0) : '';
            if (vertical)
              return (
                <div key={c.key} className="pointer-events-none absolute left-0 flex items-baseline gap-2 pr-2" style={{ top: f - 4, width: 122 }} title={c.label}>
                  <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-[var(--vo-ink-2)]">{c.label}</span>
                  <span className="vo-mono vo-num text-[12px] leading-4 text-[var(--vo-ink)]">{num(c.count)}</span>
                </div>
              );
            return (
              <div key={c.key} className="pointer-events-none absolute top-0" style={{ left: f, width: Math.max(40, L.spacing - 6) }} title={c.label}>
                <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                  <span className="vo-mono vo-num text-[13px] text-[var(--vo-ink)]">{num(c.count)}</span>
                  {conv !== '' && L.spacing >= 62 && (
                    <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]" title={`${conv} moved on from the stage before`}>
                      {conv}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 line-clamp-2 text-[12px] leading-[14px] text-[var(--vo-muted)]">{c.label}</div>
              </div>
            );
          })}
          {/* The count under (or beside) each Passed bar. */}
          {L.passedAt.map((p, i) => {
            if (p <= 0) return null;
            const f = vertical ? L.fOf(i) : L.exitF(i);
            const end = vertical ? (L.barEnd[i] ?? 0) : L.exitLo + Math.max(MIN, p * L.k);
            return (
              <span key={'pc' + i} aria-hidden className="vo-mono vo-num pointer-events-none absolute text-[12px] leading-4 text-[var(--vo-muted)]" style={vertical ? { left: end + 6, top: f - 4 } : { left: f - 2, top: end + 3 }}>
                {num(p)}
              </span>
            );
          })}
          {/* Terminals: Invested at the end of the flow, Passed at the end of the drops. */}
          <div className="pointer-events-none absolute flex items-baseline gap-1.5 whitespace-nowrap" style={vertical ? { left: L.mainLo, top: L.fT + THICK + 6 } : { left: L.fT + THICK + 8, top: L.mainLo - 3 }}>
            <span className="text-[12px] text-[var(--vo-good)]">Invested</span>
            <span className="vo-mono vo-num text-[13px] text-[var(--vo-ink)]">{num(L.invTot)}</span>
          </div>
          <div className="pointer-events-none absolute flex items-baseline gap-1.5 whitespace-nowrap" style={vertical ? { right: 0, top: L.fT + THICK + 6 } : { left: L.fT + THICK + 8, top: L.exitLo - 3 }}>
            <span className="text-[12px] text-[var(--vo-ink-2)]">Passed</span>
            <span className="vo-mono vo-num text-[13px] text-[var(--vo-ink)]">{num(L.pasTot)}</span>
          </div>
        </>
      )}
      {hover !== null && (
        <div ref={tipRef} role="tooltip" className="pointer-events-none absolute z-10 whitespace-nowrap rounded-[4px] bg-[var(--vo-ink)] px-2.5 py-1.5 text-[12px] leading-[17px] text-[var(--vo-on-ink)] shadow-[var(--vo-shadow-lg)]" style={{ left: Math.max(0, Math.min(hover.x + 12, width - tipW)), top: Math.max(0, hover.y - 34) }}>
          {hover.tip}
        </div>
      )}
    </div>
  );
}

export function FlowBlock({ flow, loading, className }: { flow: FlowAnswer | null; loading: boolean; className?: string | undefined }): React.JSX.Element | null {
  if (!loading && flow === null) return null;
  const m = flow !== null ? /^(\d{4})-(Q\d)$/.exec(flow.quarter.key) : null;
  const q = m !== null ? `${m[2] ?? ''} ${m[1] ?? ''}` : '';
  return (
    <Panel
      divided
      label="This quarter's deals"
      tip="Every deal that came in this quarter and how far it got: each column is a stage with how many reached it and the share that moved on from the stage before; green went to invested, grey was passed."
      className={className}
      aside={q !== '' && flow !== null ? <span className="text-[12px] text-[var(--vo-muted)]">{`${q}, ${plural(flow.cohort, 'deal')}`}</span> : undefined}
    >
      {loading || flow === null ? <Skeleton className="h-[272px] w-full" /> : flow.cohort === 0 ? <Empty icon={GitFork} title="This quarter's deals show here" className="py-10" /> : <Sankey flow={flow} />}
    </Panel>
  );
}
