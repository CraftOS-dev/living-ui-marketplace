/**
 * Small pieces the inventory screens share: an item's status pill and level
 * bar, the 90-day stock level chart (a step line with the reorder point),
 * the words and icons for each kind of stock move and change, and one
 * history row with a link to the record that moved the stock.
 */
import { useId, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ClipboardCheck,
  Factory,
  FileText,
  Flag,
  Minus,
  Plus,
  Truck,
  Undo2,
  Wrench,
} from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { dayLabel, shortDay } from '../../lib/dates.ts';
import { compact, money, qty, signed } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { ChangeKind, ItemKind, ItemStatus, MoveKind } from '../../lib/types/stock.ts';
import { useWidth } from '../charts.tsx';
import { ActorPill, StatusPill } from '../ui.tsx';
import type { Tone } from '../ui.tsx';

/* ---------------------------------------------------------------- status */

export const STATUS_LABEL: Record<ItemStatus, string> = {
  ok: 'In stock',
  low: 'Low',
  out: 'Out of stock',
  over: 'Overstocked',
  na: 'Not counted',
};

const STATUS_TONE: Record<ItemStatus, Tone> = {
  ok: 'good',
  low: 'warn',
  out: 'bad',
  over: 'neutral',
  na: 'neutral',
};

export const KIND_LABEL: Record<ItemKind, string> = {
  stock: 'Stock item',
  service: 'Service',
  non_stock: 'Non-stock goods',
};

export function ItemStatusPill({ status, kind, archived = false, size = 'md' }: { status: ItemStatus; kind: ItemKind; archived?: boolean | undefined; size?: 'md' | 'sm' | undefined }): React.JSX.Element {
  if (archived) return <StatusPill tone="neutral" size={size}>Archived</StatusPill>;
  if (kind !== 'stock') return <StatusPill tone="neutral" size={size}>{KIND_LABEL[kind]}</StatusPill>;
  return (
    <StatusPill tone={STATUS_TONE[status]} size={size}>
      {STATUS_LABEL[status]}
    </StatusPill>
  );
}

/** On hand against the reorder point (the tick) and the target level. */
export function LevelBar({
  onHand,
  min,
  max,
  status,
  className,
  dark = false,
}: {
  onHand: number;
  min: number;
  max: number;
  status: ItemStatus;
  className?: string | undefined;
  dark?: boolean | undefined;
}): React.JSX.Element {
  const top = Math.max(max > 0 ? max : 0, min > 0 ? min * 2 : 0, onHand, 1);
  const fill = Math.max(0, Math.min(1, onHand / top));
  const tick = min > 0 ? Math.min(1, min / top) : null;
  return (
    <span className={cn('relative block h-2 w-full rounded-full', dark ? 'bg-[var(--erp-dark-2)]' : 'bg-[var(--erp-line)]', className)} aria-hidden>
      <span
        className={cn(
          'erp-grow-x absolute inset-y-0 left-0 rounded-full',
          status === 'out' && 'bg-[var(--erp-red)]',
          status === 'low' && 'bg-[var(--erp-amber)]',
          (status === 'ok' || status === 'na') && (dark ? 'bg-[var(--erp-on-dark)]' : 'bg-[var(--erp-ink)]'),
          status === 'over' && (dark ? 'bg-[var(--erp-on-dark-muted)]' : 'bg-[var(--erp-ink-2)]'),
        )}
        style={{ width: `${Math.max(fill * 100, onHand > 0 ? 4 : 0)}%` }}
      />
      {tick !== null && <span className={cn('absolute -top-1 h-4 w-[3px] -translate-x-1/2 rounded-full', dark ? 'bg-[var(--erp-accent)]' : 'bg-[var(--erp-ink)]')} style={{ left: `${tick * 100}%` }} />}
    </span>
  );
}

/* ----------------------------------------------------------------- chart */

/**
 * Stock on hand per day as a step line (stock holds its level until the
 * next move) over a soft area, with the reorder point as a dashed line.
 */
export function LevelChart({ series, min, unit, height = 190 }: { series: { date: string; qty: number }[]; min: number; unit: string; height?: number | undefined }): React.JSX.Element {
  const [box, width] = useWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const padR = 48;
  const padB = 22;
  const h = height - padB;
  const w = Math.max(160, width - padR);
  const peak = Math.max(1, min * 1.4, ...series.map((s) => s.qty));
  const top = niceCeil(peak);
  const lowest = Math.min(0, ...series.map((s) => s.qty));
  const span = top - lowest || 1;
  const x = (i: number): number => (series.length <= 1 ? w / 2 : (i / (series.length - 1)) * w);
  const y = (v: number): number => 6 + (1 - (v - lowest) / span) * (h - 12);
  let line = '';
  series.forEach((s, i) => {
    const px = x(i).toFixed(1);
    const py = y(s.qty).toFixed(1);
    line += i === 0 ? `M${px} ${py}` : ` H${px} V${py}`;
  });
  const area = series.length > 0 ? `${line} V${y(lowest).toFixed(1)} H${x(0).toFixed(1)} Z` : '';
  const pt = hover !== null ? series[hover] : undefined;
  const ticks = series.length > 1 ? [0, Math.round((series.length - 1) / 3), Math.round(((series.length - 1) * 2) / 3), series.length - 1] : [];
  return (
    <div ref={box} className="relative w-full select-none [contain:inline-size]">
      <svg
        width={w + padR}
        height={height}
        className="block overflow-visible"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / w) * (series.length - 1));
          setHover(Math.max(0, Math.min(series.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Stock on hand over the last ${series.length} days`}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--erp-accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--erp-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[top, (top + lowest) / 2, lowest].map((v) => (
          <g key={v}>
            <line x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="var(--erp-line)" strokeDasharray="3 4" />
            <text x={w + 8} y={y(v)} dominantBaseline="central" fontSize={12} fill="var(--erp-muted)" className="num">
              {compact(Math.round(v * 10) / 10)}
            </text>
          </g>
        ))}
        {area !== '' && <path d={area} fill={`url(#${gid})`} />}
        {line !== '' && <path d={line} fill="none" stroke="var(--erp-ink)" strokeWidth={2.2} strokeLinejoin="round" />}
        {min > 0 && (
          <g>
            <line x1={0} x2={w} y1={y(min)} y2={y(min)} stroke="var(--erp-red)" strokeWidth={1.6} strokeDasharray="6 5" />
            <text x={4} y={y(min) - 8} fontSize={12} fontWeight={700} fill="var(--erp-red-text)">
              Reorder at {qty(min)}
            </text>
          </g>
        )}
        {ticks.map((i) => {
          const s = series[i];
          if (s === undefined) return null;
          return (
            <text key={i} x={x(i)} y={height - 4} fontSize={12} fill="var(--erp-muted)" textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}>
              {shortDay(s.date)}
            </text>
          );
        })}
        {pt !== undefined && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={h} stroke="var(--erp-ink-2)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(pt.qty)} r={5} fill="var(--erp-card)" stroke="var(--erp-ink)" strokeWidth={2.5} />
          </g>
        )}
      </svg>
      {pt !== undefined && hover !== null && (
        <div
          className="erp-on-ink pointer-events-none absolute -top-3 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-[var(--erp-ink)] px-3 py-1.5 text-[12px] font-semibold text-[var(--erp-shell)]"
          style={{ left: Math.max(70, Math.min(w - 40, x(hover))) }}
        >
          {dayLabel(pt.date)}: <span className="num">{qty(pt.qty)}</span> {unit}
        </div>
      )}
    </div>
  );
}

function niceCeil(peak: number): number {
  if (peak <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(peak)));
  const f = peak / p;
  const n = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10;
  return n * p;
}

/* ----------------------------------------------------------------- moves */

export const MOVE: Record<MoveKind, { label: string; icon: LucideIcon }> = {
  receipt: { label: 'Received', icon: Truck },
  delivery: { label: 'Delivered', icon: ArrowUpRight },
  adjust_in: { label: 'Added', icon: Plus },
  adjust_out: { label: 'Removed', icon: Minus },
  count: { label: 'Counted', icon: ClipboardCheck },
  transfer_in: { label: 'Transferred in', icon: ArrowLeftRight },
  transfer_out: { label: 'Transferred out', icon: ArrowLeftRight },
  build_in: { label: 'Built', icon: Factory },
  build_out: { label: 'Used in a build', icon: Wrench },
  opening: { label: 'Opening stock', icon: Flag },
  return_in: { label: 'Returned by customer', icon: Undo2 },
  return_out: { label: 'Returned to supplier', icon: ArrowDownLeft },
};

export function moveOf(kind: string): { label: string; icon: LucideIcon } {
  return MOVE[kind as MoveKind] ?? { label: kind.replace(/_/g, ' '), icon: FileText };
}

export const CHANGE_KIND: Record<ChangeKind, string> = {
  adjust: 'Adjustment',
  count: 'Count',
  transfer: 'Transfer',
};

export const REASON_LABEL: Record<string, string> = {
  count: 'Stock count',
  damage: 'Damaged',
  loss: 'Lost or stolen',
  found: 'Found',
  expiry: 'Expired',
  sample: 'Sample or gift',
  correction: 'Correction',
  opening: 'Opening stock',
  other: 'Other',
};

/** Open the record a stock move came from, when the app has a page for it. */
export function sourceAction(entity: string, id: string): (() => void) | null {
  if (id === '') return null;
  if (entity === 'documents') return () => navigate('doc', { id });
  if (entity === 'stock_changes') return () => navigate('stock-change', { id });
  if (entity === 'builds') return () => navigate('build', { id });
  return null;
}

/** One history row: what moved, where, from which record, the change and what it left. */
export function MoveRow({
  m,
  currency,
  showItem = false,
  showValue = true,
}: {
  m: { id: string; date: string; kind: string; qty: number; value: number; balance: number; entity: string; source: string; label: string; actor: string; warehouse: string; name?: string | undefined; sku?: string | undefined; item?: string | undefined; unit?: string | undefined };
  currency: string;
  showItem?: boolean | undefined;
  showValue?: boolean | undefined;
}): React.JSX.Element {
  const k = moveOf(m.kind);
  const Icon = k.icon;
  const go = sourceAction(m.entity, m.source);
  const itemId = m.item;
  return (
    <li className="flex items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-3 py-2.5">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', m.qty < 0 ? 'bg-[var(--erp-card)] text-[var(--erp-ink-2)]' : 'bg-[var(--erp-accent-soft)] text-[var(--erp-ink)]')}>
        <Icon size={15} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          {showItem && itemId !== undefined && itemId !== '' ? (
            <button type="button" onClick={() => navigate('item', { id: itemId })} className="min-w-0 truncate text-left text-[13px] font-bold hover:underline">
              {m.name}
            </button>
          ) : (
            <span className="min-w-0 truncate text-[13px] font-bold">{k.label}</span>
          )}
          {m.actor === 'agent' && <ActorPill actor="agent" />}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-[var(--erp-muted)]">
          <span>{dayLabel(m.date)}</span>
          {showItem && <span>· {k.label}</span>}
          {m.warehouse !== '' && <span className="truncate">· {m.warehouse}</span>}
          {m.label !== '' && (
            <>
              <span>·</span>
              {go !== null ? (
                <button type="button" onClick={go} className="truncate font-semibold text-[var(--erp-ink-2)] underline-offset-2 hover:text-[var(--erp-ink)] hover:underline">
                  {m.label}
                </button>
              ) : (
                <span className="truncate">{m.label}</span>
              )}
            </>
          )}
        </span>
      </span>
      <span className="num shrink-0 text-right">
        <span className={cn('block text-[14px] font-bold', m.qty < 0 && 'text-[var(--erp-ink-2)]')}>
          {signed(m.qty)}
          {m.unit !== undefined && m.unit !== '' ? <span className="ml-1 text-[12px] font-semibold text-[var(--erp-muted)]">{m.unit}</span> : null}
        </span>
        <span className="block text-[12px] text-[var(--erp-muted)]">{showValue && m.value !== 0 ? money(m.value, currency) : `left ${qty(m.balance)}`}</span>
      </span>
    </li>
  );
}

/** A short date for dense tables ("Oct 5"). */
export function tableDay(day: string): string {
  return day === '' ? '' : shortDay(day);
}
