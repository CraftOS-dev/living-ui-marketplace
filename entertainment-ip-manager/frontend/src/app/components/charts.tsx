/**
 * Small charts drawn to scale in SVG: monthly bars, a year forecast with
 * a jurisdiction split, and a Gantt timeline (families, rights windows).
 * Single-hue series; status color only where the bar means status.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../kit/index.ts';
import { d10, fmtDate, fmtMoney, fmtMonth, today } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';

export function MonthBars({
  data,
  currency,
  onBarClick,
  height = 120,
}: {
  data: { month: string; amount: number; count: number; unknown: number }[];
  currency: string;
  onBarClick?: ((month: string) => void) | undefined;
  height?: number | undefined;
}): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.amount));
  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const h = hover !== null ? data[hover] : undefined;
  return (
    <div>
      <div className="mb-1 h-4 text-xs tabular-nums text-[var(--agent-app-muted)]">
        {h !== undefined
          ? t('{month}: {amount} across {n} renewals', { month: fmtMonth(h.month), amount: fmtMoney(h.amount, currency), n: h.count }) + (h.unknown ? t(', {n} without a fee on file', { n: h.unknown }) : '')
          : t('Next 12 months: {amount}', { amount: fmtMoney(data.reduce((a, b) => a + b.amount, 0), currency) })}
      </div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => {
          const pct = d.amount > 0 ? Math.max(3, (d.amount / max) * 100) : d.count > 0 ? 3 : 0;
          return (
            <button
              key={d.month}
              type="button"
              className="group flex h-full flex-1 flex-col justify-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onBarClick?.(d.month)}
              aria-label={`${d.month}: ${fmtMoney(d.amount, currency)}`}
            >
              <div
                className={cn('w-full transition-colors', d.unknown > 0 && d.amount === 0 ? 'bg-[var(--agent-app-border)]' : 'bg-[var(--agent-app-accent)]/75 group-hover:bg-[var(--agent-app-accent)]')}
                style={{ height: `${pct}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((d) => (
          <span key={d.month} className="flex-1 text-center font-mono text-[9.5px] text-[var(--agent-app-muted)]">
            {MONTHS[Number(d.month.slice(5, 7)) - 1]}
          </span>
        ))}
      </div>
    </div>
  );
}

const JUR_SHADES = ['bg-[var(--agent-app-accent)]', 'bg-[var(--agent-app-accent)]/70', 'bg-[var(--agent-app-accent)]/45', 'bg-[var(--agent-app-accent)]/25', 'bg-[var(--agent-app-muted)]/40'];

/** Forecast: one bar per year, stacked by the top 4 jurisdictions plus "Other". */
export function YearForecast({
  years,
  currency,
}: {
  years: { year: string; total: number; count: number; unknown: number; by_jurisdiction: Record<string, number> }[];
  currency: string;
}): React.JSX.Element {
  const top = useMemo(() => {
    const tot: Record<string, number> = {};
    for (const y of years) for (const [j, v] of Object.entries(y.by_jurisdiction)) tot[j] = (tot[j] ?? 0) + v;
    return Object.entries(tot)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([j]) => j);
  }, [years]);
  const max = Math.max(1, ...years.map((y) => y.total));
  const [hover, setHover] = useState<string | null>(null);
  const hv = years.find((y) => y.year === hover);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-[var(--agent-app-muted)]">
        {[...top, t('Other')].map((j, i) => (
          <span key={j} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2.5', JUR_SHADES[i])} />
            {j}
          </span>
        ))}
      </div>
      <div className="flex h-44 items-end gap-3">
        {years.map((y) => {
          const parts = top.map((j) => y.by_jurisdiction[j] ?? 0);
          const other = y.total - parts.reduce((a, b) => a + b, 0);
          const all = [...parts, Math.max(0, other)];
          return (
            <div key={y.year} className="flex h-full flex-1 flex-col items-center justify-end gap-1" onMouseEnter={() => setHover(y.year)} onMouseLeave={() => setHover(null)}>
              <span className="text-[11px] tabular-nums text-[var(--agent-app-muted)]">{fmtMoney(y.total, currency)}</span>
              <div className="flex w-full max-w-16 flex-col-reverse" style={{ height: `${Math.max(2, (y.total / max) * 100)}%` }}>
                {all.map((v, i) =>
                  v > 0 ? <div key={i} className={JUR_SHADES[i]} style={{ height: `${(v / Math.max(1, y.total)) * 100}%` }} /> : null,
                )}
              </div>
              <span className="font-mono text-xs">{y.year}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 h-4 text-xs text-[var(--agent-app-muted)]">
        {hv !== undefined
          ? t('{year}: {n} renewals, {amount}', { year: hv.year, n: hv.count, amount: fmtMoney(hv.total, currency) }) + (hv.unknown ? t(', {n} without a fee on file', { n: hv.unknown }) : '')
          : t('Hover a year for detail.')}
      </div>
    </div>
  );
}

export interface TimelineSegment {
  start: string;
  end: string;
  label?: string | undefined;
  className: string;
  title?: string | undefined;
}

export interface TimelineMarker {
  date: string;
  label: string;
  className?: string | undefined;
}

export interface TimelineRow {
  key: string;
  label: ReactNode;
  segments: TimelineSegment[];
  markers?: TimelineMarker[] | undefined;
}

/** Gantt-style timeline: rows of dated segments on one shared scale. */
export function Timeline({ rows, from, to }: { rows: TimelineRow[]; from?: string | undefined; to?: string | undefined }): React.JSX.Element {
  const dates: string[] = [];
  for (const r of rows) {
    for (const s of r.segments) dates.push(d10(s.start), d10(s.end));
    for (const m of r.markers ?? []) dates.push(d10(m.date));
  }
  const valid = dates.filter((d) => d !== '').sort();
  const start = d10(from ?? '') || valid[0] || today();
  const end = d10(to ?? '') || valid[valid.length - 1] || today();
  const t0 = new Date(start).getTime();
  const t1 = Math.max(t0 + 86400000 * 30, new Date(end).getTime());
  const pos = (d: string): number => Math.min(100, Math.max(0, ((new Date(d10(d) || start).getTime() - t0) / (t1 - t0)) * 100));
  const y0 = Number(start.slice(0, 4));
  const y1 = Number(end.slice(0, 4));
  const step = y1 - y0 > 24 ? 5 : y1 - y0 > 10 ? 2 : 1;
  const ticks: number[] = [];
  for (let y = y0 + 1; y <= y1; y += step) ticks.push(y);
  const nowPos = pos(today());
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="relative ml-44 h-5 border-b border-[var(--agent-app-border)]">
          {ticks.map((y) => (
            <span key={y} className="absolute -translate-x-1/2 font-mono text-[10px] text-[var(--agent-app-muted)]" style={{ left: `${pos(`${y}-01-01`)}%` }}>
              {y}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center border-b border-[var(--agent-app-border)]/60 last:border-0">
            <div className="w-44 shrink-0 truncate py-2 pr-3 text-[12.5px]">{r.label}</div>
            <div className="relative h-8 flex-1">
              {ticks.map((y) => (
                <span key={y} className="absolute inset-y-0 w-px bg-[var(--agent-app-border)]/50" style={{ left: `${pos(`${y}-01-01`)}%` }} />
              ))}
              {nowPos > 0 && nowPos < 100 && <span className="absolute inset-y-0 w-px bg-[var(--agent-app-accent)]" style={{ left: `${nowPos}%` }} title="Today" />}
              {r.segments.map((s, i) => {
                const a = pos(s.start);
                const b = pos(s.end);
                return (
                  <div
                    key={i}
                    title={s.title ?? `${s.label ?? ''} ${fmtDate(s.start)} to ${fmtDate(s.end)}`}
                    className={cn('absolute top-2 h-4 truncate px-1 text-[10px] leading-4', s.className)}
                    style={{ left: `${a}%`, width: `${Math.max(0.6, b - a)}%` }}
                  >
                    {s.label}
                  </div>
                );
              })}
              {(r.markers ?? []).map((m, i) => (
                <span
                  key={i}
                  title={`${m.label}: ${fmtDate(m.date)}`}
                  className={cn('absolute top-1.5 size-2.5 -translate-x-1/2 rotate-45 border border-[var(--agent-app-surface)]', m.className ?? 'bg-[var(--agent-app-text)]')}
                  style={{ left: `${pos(m.date)}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
