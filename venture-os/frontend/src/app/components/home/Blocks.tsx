/**
 * Home's panels beside the hero, the flow and today (SPEC 3.1, the
 * dashboard): Next with Start, deal flow by source, the portfolio treemap,
 * fund performance, the runway strip, the sector mix and growth. Each draws
 * from home.summary's `visual`, shows a skeleton while Home loads and a
 * quiet empty state on an empty firm; nothing is computed here but scale,
 * layout and the firm's own formatting.
 */
import { useState } from 'react';
import { CheckCheck, Inbox, Landmark, LayoutGrid, PieChart, Play, Timer, TrendingUp } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { compact, exponent, fmtDay, fmtMonth, humanize, money, monthName, months, multiple, num, pct, plural, toMajor } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import { primary } from '../../registry.ts';
import { BarChart, Legend, LineChart, Sparkline } from '../charts.tsx';
import { NextRow } from '../next.tsx';
import { Button, Empty, Panel, Segmented, Skeleton } from '../ui.tsx';
import type { Health, HomeSummary, PortfolioVisual, Performance, SourceKey, SourcesAnswer, Visual } from './types.ts';
import { Donut, StackedArea, Swatches, squarify, useDrawn, useWidth } from './viz.tsx';

/* ------------------------------------------------------------------- Next */

export function NextBlock({ next, total, className }: { next: HomeSummary['next']['items'] | null; total: number; className?: string | undefined }): React.JSX.Element {
  return (
    <Panel
      divided
      label="Waiting for you"
      tip="Decisions, votes, drafts and checks that need you. Start goes through them one by one."
      flush
      className={className}
      aside={
        <span className="flex items-center gap-3">
          {next !== null && total > 0 && <span className="text-[12px] text-[var(--vo-muted)]">{plural(total, 'item')}</span>}
          {/* On a phone the bottom bar's Next (with its count) is Start. */}
          <Button variant="primary" size="sm" icon={Play} onClick={() => navigate('/focus')} className="max-md:hidden">
            Start
          </Button>
        </span>
      }
    >
      {next === null ? (
        <div className="flex flex-col gap-3 px-4 pb-4 pt-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-6 w-3/5" />
        </div>
      ) : next.length === 0 ? (
        <Empty icon={CheckCheck} title="Nothing waiting for you" className="py-10" />
      ) : (
        <div className="px-3 pb-2">
          {next.map((it) => (
            <NextRow key={it.key} item={it} onOpen={(i) => navigate('/focus', { at: i.key })} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- Deal flow */

export const SOURCES: Record<SourceKey, { label: string; color: string }> = {
  email: { label: 'Email', color: 'var(--vo-a)' },
  upload: { label: 'Upload', color: 'color-mix(in srgb, var(--vo-a) 48%, var(--vo-panel))' },
  scout: { label: 'Scout', color: 'var(--vo-b)' },
  sourced: { label: 'Sourced', color: 'color-mix(in srgb, var(--vo-b) 48%, var(--vo-panel))' },
  introduced: { label: 'Introduced', color: 'color-mix(in srgb, var(--vo-ink) 38%, var(--vo-panel))' },
};

export function DealFlowBlock({ sources, loading, className }: { sources: SourcesAnswer | null; loading: boolean; className?: string | undefined }): React.JSX.Element | null {
  if (!loading && sources === null) return null;
  const add = primary();
  return (
    <Panel divided label="New deals by source" tip="Deals that came in each month over the last 12 months, by where they came from." className={className} aside={sources !== null && sources.total > 0 ? <span className="text-[12px] text-[var(--vo-muted)]">{plural(sources.total, 'deal')} in 12 months</span> : undefined}>
      {loading || sources === null ? (
        <Skeleton className="h-[236px] w-full" />
      ) : sources.total === 0 ? (
        <Empty icon={Inbox} title="New deals show here" className="py-10" action={add !== null ? <Button icon={add.icon} onClick={() => (add.run !== undefined ? add.run() : add.to !== undefined ? navigate(add.to) : undefined)}>{add.label}</Button> : undefined} />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <StackedArea
            labels={sources.months.map((m) => monthName(Number(m.month.slice(5, 7))))}
            tips={sources.months.map((m) => fmtMonth(m.month))}
            series={sources.keys.map((k) => ({ key: k, label: SOURCES[k].label, color: SOURCES[k].color, values: sources.months.map((m) => m[k]) }))}
            height={208}
            format={(v) => plural(v, 'deal')}
            label={`Deals by month and source, last 12 months: ${sources.months.map((m) => sources.keys.reduce((a, k) => a + m[k], 0)).join(', ')}`}
          />
          <Swatches items={sources.keys.map((k) => SOURCES[k])} />
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- Treemap */

const AT_COST = 'color-mix(in srgb, var(--vo-ink) 7%, var(--vo-panel))';

/** MOIC bands: under cost red, at cost grey, then greener with the multiple. */
function band(moic: number | null): { fill: string; label: string } {
  if (moic === null) return { fill: AT_COST, label: 'Unknown' };
  if (moic < 0.95) return { fill: 'color-mix(in srgb, var(--vo-bad) 18%, var(--vo-panel))', label: 'Under 1x' };
  if (moic <= 1.05) return { fill: AT_COST, label: 'At cost' };
  if (moic < 2) return { fill: 'color-mix(in srgb, var(--vo-good) 12%, var(--vo-panel))', label: '1x to 2x' };
  if (moic < 3) return { fill: 'color-mix(in srgb, var(--vo-good) 22%, var(--vo-panel))', label: '2x to 3x' };
  return { fill: 'color-mix(in srgb, var(--vo-good) 32%, var(--vo-panel))', label: '3x and more' };
}

const BANDS = [
  { label: '<1x', fill: band(0.5).fill },
  { label: '1x', fill: band(1).fill },
  { label: '2x', fill: band(2.2).fill },
  { label: '3x+', fill: band(3.5).fill },
];

function Treemap({ p, height }: { p: PortfolioVisual; height: number }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const tiles = width > 0 ? squarify(p.treemap.map((t) => ({ v: t.value_minor, t })), { x: 0, y: 0, w: width, h: height }) : [];
  const total = p.treemap.reduce((a, t) => a + t.value_minor, 0);
  return (
    <div ref={ref} className="relative w-full min-w-0" style={{ height }} role="list" aria-label="Portfolio by value">
      {tiles.map(({ x, y, w, h, t }) => {
        const m = t.moic_e8 !== null ? t.moic_e8 / 1e8 : null;
        const b = band(m);
        const roomy = w >= 64 && h >= 38;
        const tight = !roomy && w >= 40 && h >= 20;
        const share = total > 0 ? Math.round((t.value_minor / total) * 1000) / 10 : 0;
        return (
          <button
            key={t.company.id}
            type="button"
            role="listitem"
            onClick={() => navigate('/portfolio/' + t.company.id)}
            onPointerEnter={() => setHover(t.company.id)}
            onPointerLeave={() => setHover(null)}
            title={`${t.company.name}: ${money(t.value_minor, p.currency, { compact: true })}, ${m !== null ? multiple(t.moic_e8) : 'MOIC unknown'}, ${share}% of value`}
            className="vo-focus absolute overflow-hidden rounded-[3px] text-left transition-[box-shadow] duration-150"
            style={{ left: x + 1, top: y + 1, width: Math.max(0, w - 2), height: Math.max(0, h - 2), background: b.fill, boxShadow: hover === t.company.id ? 'inset 0 0 0 1.5px var(--vo-ink)' : 'inset 0 0 0 1px color-mix(in srgb, var(--vo-ink) 6%, transparent)' }}
          >
            {(roomy || tight) && (
              <span className="flex h-full min-w-0 flex-col justify-between p-2">
                <span className="truncate text-[12px] font-medium leading-4 text-[var(--vo-ink)]">{t.company.name}</span>
                {roomy && (
                  <span className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="vo-mono vo-num truncate text-[12px] leading-4 text-[var(--vo-ink)]">{money(t.value_minor, p.currency, { compact: true, bare: w < 132 })}</span>
                    {w >= 108 && m !== null && <span className="vo-mono vo-num shrink-0 text-[12px] leading-4 text-[var(--vo-ink)]">{multiple(t.moic_e8, 1)}</span>}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TreemapBlock({ p, loading, className }: { p: PortfolioVisual | null; loading: boolean; className?: string | undefined }): React.JSX.Element | null {
  if (!loading && p === null) return null;
  return (
    <Panel
      divided
      label={p !== null ? `Portfolio by value, ${p.currency}` : 'Portfolio by value'}
      tip="Each tile is a company, sized by its current value and shaded by its multiple on what you paid."
      className={className}
      aside={
        p !== null && p.treemap.length > 0 ? (
          <span className="flex items-center gap-2.5" aria-label="Multiple bands">
            <span className="text-[12px] text-[var(--vo-muted)]">Multiple</span>
            {BANDS.map((x) => (
              <span key={x.label} className="vo-mono inline-flex items-center gap-1 text-[12px] text-[var(--vo-muted)]">
                <span aria-hidden className="inline-block size-2.5 rounded-[2px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--vo-ink)_10%,transparent)]" style={{ background: x.fill }} />
                {x.label}
              </span>
            ))}
          </span>
        ) : undefined
      }
    >
      {loading || p === null ? (
        <Skeleton className="h-[300px] w-full" />
      ) : p.treemap.length === 0 ? (
        <Empty icon={LayoutGrid} title="Your investments show here" className="py-10" />
      ) : (
        <>
          <div className="hidden md:block">
            <Treemap p={p} height={300} />
          </div>
          <div className="md:hidden">
            <Treemap p={p} height={240} />
          </div>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------- Fund performance */

const REASON: Record<string, string> = { no_paid_in: 'Nothing called yet', no_nav: 'No NAV yet' };

function quarterShort(q: string): string {
  return q.replace(/ 20(\d\d)$/, " '$1");
}

export function PerformanceBlock({ perf: all, loading, className }: { perf: Performance | null; loading: boolean; className?: string | undefined }): React.JSX.Element | null {
  const [ref, width] = useWidth<HTMLDivElement>();
  if (!loading && all === null) return null;
  // A narrow panel shows the last two years, so every quarter keeps a readable label.
  const perf = all !== null && width > 0 && width < 380 && all.quarters.length > 8 ? { ...all, quarters: all.quarters.slice(-8) } : all;
  const has = perf !== null && perf.paid_in_minor > 0 && perf.quarters.length > 0;
  const ccy = perf?.fund.currency ?? 'USD';
  const x = (v: number | null): number | null => (v === null ? null : v / 1e8);
  return (
    <Panel
      divided
      label={perf !== null ? `${perf.fund.label} performance` : 'Fund performance'}
      tip="Multiples by quarter (TVPI, DPI and RVPI net to LPs, gross MOIC dashed); below, the capital called and distributed each quarter."
      className={className}
      aside={
        has && perf !== null ? (
          <span className="flex items-baseline gap-3 text-[12px] text-[var(--vo-muted)]">
            {perf.net.tvpi_e8 !== null && (
              <span title="TVPI, net to LPs">
                Net TVPI <span className="vo-mono vo-num text-[13px] text-[var(--vo-ink)]">{multiple(perf.net.tvpi_e8)}</span>
              </span>
            )}
            {perf.gross.moic_e8 !== null && (
              <span title="MOIC, gross of fees and carry">
                Gross <span className="vo-mono vo-num text-[13px] text-[var(--vo-ink)]">{multiple(perf.gross.moic_e8)}</span>
              </span>
            )}
            <button type="button" onClick={() => navigate('/funds/' + perf.fund.id)} className="vo-focus vo-link hit rounded-[2px] text-[12px] text-[var(--vo-ink-2)] hover:text-[var(--vo-ink)]">
              Open
            </button>
          </span>
        ) : undefined
      }
    >
      <div ref={ref} className="min-w-0">
      {loading || perf === null ? (
        <Skeleton className="h-[300px] w-full" />
      ) : !has ? (
        <Empty icon={Landmark} title={REASON.no_paid_in ?? 'Nothing called yet'} className="py-10" />
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <LineChart
            labels={perf.quarters.map((q) => quarterShort(q.quarter))}
            series={[
              { key: 'tvpi', label: 'TVPI', values: perf.quarters.map((q) => x(q.tvpi_e8)), tone: 'a' },
              { key: 'dpi', label: 'DPI', values: perf.quarters.map((q) => x(q.dpi_e8)), tone: 'good' },
              { key: 'rvpi', label: 'RVPI', values: perf.quarters.map((q) => x(q.rvpi_e8)), tone: 'b' },
              { key: 'gross', label: 'Gross MOIC', values: perf.quarters.map((q) => x(q.gross_moic_e8)), tone: 'ink', dashed: true },
            ]}
            height={164}
            format={(v) => v.toFixed(2) + 'x'}
            yFormat={(v) => (Math.round(v * 10) / 10).toString() + 'x'}
            label={`${perf.fund.label}: TVPI, DPI and RVPI by quarter, gross MOIC beside them`}
          />
          <Legend
            items={[
              { label: 'TVPI', tone: 'a' },
              { label: 'DPI', tone: 'good' },
              { label: 'RVPI', tone: 'b' },
              { label: 'Gross', tone: 'ink', dashed: true },
            ]}
          />
          <BarChart
            labels={perf.quarters.map((q) => quarterShort(q.quarter))}
            series={[
              { key: 'calls', label: 'Calls', values: perf.quarters.map((q) => toMajor(q.calls_minor, ccy)), tone: 'muted' },
              { key: 'dist', label: 'Distributions', values: perf.quarters.map((q) => toMajor(q.dist_minor, ccy)), tone: 'good' },
            ]}
            stacked
            height={112}
            format={(v) => money(Math.round(v * 10 ** exponent(ccy)), ccy, { compact: true })}
            yFormat={(v) => compact(v)}
            label={`${perf.fund.label}: calls and distributions by quarter`}
            className="mt-2"
          />
        </div>
      )}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- Runway */

const HEALTH: Record<Health, string> = { good: 'var(--vo-good)', warn: 'var(--vo-warn)', bad: 'var(--vo-bad)', unknown: 'var(--vo-line-2)' };

export function RunwayBlock({ p, loading, className }: { p: PortfolioVisual | null; loading: boolean; className?: string | undefined }): React.JSX.Element | null {
  if (!loading && p === null) return null;
  const all = p?.runway.rows ?? [];
  // Only the runways that are known; the rest are named in the tip.
  const rows = all.filter((r) => r.months !== null);
  const unknown = all.length - rows.length;
  const th = p?.runway.threshold_months ?? 6;
  const max = Math.min(48, Math.max(24, Math.ceil(Math.max(0, ...rows.map((r) => r.months ?? 0)) / 6) * 6));
  const at = (m: number): string => `${Math.max(0, Math.min(100, (m / max) * 100))}%`;
  return (
    <Panel
      divided
      label="Runway"
      tip={`Months of cash left at the current burn, shortest first. The red line is ${th} months.${unknown > 0 ? ` ${plural(unknown, 'company has', 'companies have')} not reported cash and burn.` : ''}`}
      className={className}
      aside={rows.length > 0 ? <span className="text-[12px] text-[var(--vo-bad)]">Red line: {th} months</span> : undefined}
    >
      {loading || p === null ? (
        <Skeleton className="h-[300px] w-full" />
      ) : rows.length === 0 ? (
        <Empty icon={Timer} title="Runways show once companies report" className="py-10" />
      ) : (
        <div className="relative min-w-0">
          <ul className="flex min-w-0 flex-col" aria-label="Runway by company, shortest first">
            {rows.map((r) => (
              <li key={r.company.id}>
                <button
                  type="button"
                  onClick={() => navigate('/portfolio/' + r.company.id)}
                  title={`${r.company.name}: ${r.months !== null ? months(r.months) + ' of runway' + (r.as_of_day !== '' ? ' (as of ' + fmtDay(r.as_of_day) + ')' : '') : 'runway unknown'}`}
                  className="vo-focus group grid h-5 w-full min-w-0 grid-cols-[minmax(0,104px)_minmax(0,1fr)_52px] items-center gap-2.5 rounded-[3px] px-1 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]"
                >
                  <span className="truncate text-[12px] text-[var(--vo-ink-2)] group-hover:text-[var(--vo-ink)]">{r.company.name}</span>
                  <span className="relative h-[7px] min-w-0 rounded-full bg-[var(--vo-sunk)]">
                    {r.months !== null && <RunwayFill width={at(r.months)} color={HEALTH[r.health]} />}
                    <span aria-hidden className="absolute -inset-y-[5px] w-px bg-[var(--vo-bad)] opacity-70" style={{ left: at(th) }} />
                  </span>
                  <span className="vo-mono vo-num text-right text-[12px] text-[var(--vo-ink)]">{months(r.months)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function RunwayFill({ width, color }: { width: string; color: string }): React.JSX.Element {
  const drawn = useDrawn();
  return <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: drawn ? width : '0%', background: color }} />;
}

/* ---------------------------------------------------------------- Sectors */

/** A sector as people write it: the first letter up, short words (AI, HR) in capitals. */
function sectorLabel(key: string): string {
  if (key === 'other' || key === '') return 'Other';
  const s = humanize(key);
  return s
    .split(' ')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w))
    .join(' ');
}

/** Seven tones from the primary series colour down to grey: the largest sector the darkest. */
function sectorColor(i: number, other: boolean): string {
  if (other) return 'var(--vo-line-2)';
  const strength = [100, 78, 60, 46, 34, 24][i] ?? 20;
  return `color-mix(in srgb, var(--vo-a) ${strength}%, var(--vo-panel))`;
}

export function SectorBlock({ v, loading, className }: { v: Visual | null; loading: boolean; className?: string | undefined }): React.JSX.Element | null {
  const canInvested = v !== null && v.portfolio !== null;
  const canPipe = v !== null && v.pipeline_sectors !== null;
  const [mode, setMode] = useState<'invested' | 'pipeline'>('invested');
  const [hover, setHover] = useState<string | null>(null);
  if (!loading && !canInvested && !canPipe) return null;
  const use = mode === 'invested' && canInvested ? 'invested' : canPipe ? 'pipeline' : 'invested';
  const ccy = v?.portfolio?.currency ?? v?.currency ?? 'USD';
  const raw =
    use === 'invested'
      ? (v?.portfolio?.invested ?? []).filter((s) => s.value_minor > 0).map((s) => ({ key: s.sector, value: s.value_minor, n: s.companies }))
      : (v?.pipeline_sectors ?? []).map((s) => ({ key: s.sector, value: s.deals, n: s.deals }));
  const top = raw.slice(0, 6);
  const rest = raw.slice(6);
  const segs = top.map((s, i) => ({ key: s.key, label: sectorLabel(s.key), value: s.value, color: sectorColor(i, false) }));
  if (rest.length > 0) segs.push({ key: '__rest', label: 'Other', value: rest.reduce((a, s) => a + s.value, 0), color: sectorColor(6, true) });
  const total = segs.reduce((a, s) => a + s.value, 0);
  const fmt = (n: number): string => (use === 'invested' ? money(n, ccy, { compact: true }) : plural(n, 'deal'));
  return (
    <Panel
      divided
      label={use === 'invested' ? 'Invested by sector' : 'Open deals by sector'}
      tip={use === 'invested' ? 'What you paid for your companies, by sector.' : 'Open deals in the pipeline, by sector.'}
      className={className}
      aside={
        canInvested && canPipe ? (
          <Segmented<'invested' | 'pipeline'>
            size="sm"
            value={use}
            onChange={setMode}
            label="Sector mix"
            options={[
              { value: 'invested', label: 'Invested' },
              { value: 'pipeline', label: 'Pipeline' },
            ]}
          />
        ) : undefined
      }
    >
      {loading || v === null ? (
        <Skeleton className="h-[300px] w-full" />
      ) : total === 0 ? (
        <Empty icon={PieChart} title={use === 'invested' ? 'Investments show here' : 'Open deals show here'} className="py-10" />
      ) : (
        <div className="flex min-w-0 flex-col items-center gap-5 sm:flex-row sm:items-center lg:flex-col xl:flex-row">
          <Donut
            key={use}
            segments={segs}
            size={144}
            thickness={15}
            hover={hover}
            onHover={setHover}
            format={fmt}
            label={`${use === 'invested' ? 'Invested' : 'Open deals'} by sector: ${segs.map((s) => `${s.label} ${fmt(s.value)}`).join(', ')}`}
            center={
              <>
                <span className="vo-mono vo-num text-[15px] text-[var(--vo-ink)]">{use === 'invested' ? money(total, ccy, { compact: true, bare: true }) : num(total)}</span>
                <span className="text-[12px] text-[var(--vo-muted)]">{use === 'invested' ? ccy : 'deals'}</span>
              </>
            }
          />
          <ul className="flex w-full min-w-0 flex-1 flex-col">
            {segs.map((s) => (
              <li key={s.key} onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)} className={cn('flex h-7 min-w-0 items-center gap-2 rounded-[3px] px-1.5 transition-colors duration-150', hover === s.key && 'bg-[var(--vo-hover)]')}>
                <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--vo-ink-2)]">{s.label}</span>
                <span className="vo-mono vo-num shrink-0 text-[12px] text-[var(--vo-ink)]">{use === 'invested' ? money(s.value, ccy, { compact: true }) : plural(s.value, 'deal')}</span>
                <span className="vo-mono vo-num w-9 shrink-0 text-right text-[12px] text-[var(--vo-muted)]">{Math.round((s.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- Growth */

function GrowthCell({ g, currency }: { g: PortfolioVisual['growth'][number]; currency: string }): React.JSX.Element {
  const [ref, w] = useWidth<HTMLButtonElement>();
  const up = g.growth_ppm !== null && g.growth_ppm >= 0;
  const ccy = g.currency !== '' ? g.currency : currency;
  const money_ = g.key === 'arr' || g.key === 'mrr' || g.key === 'revenue';
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => navigate('/portfolio/' + g.company.id)}
      title={`${g.company.name}: ${g.label}${g.growth_ppm !== null ? `, ${pct(g.growth_ppm, 0, { sign: true })} over ${plural(g.months, 'month')}` : ''}`}
      className="vo-focus flex min-w-0 flex-col gap-1 rounded-[var(--vo-radius-sm)] px-2 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]"
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--vo-ink)]">{g.company.name}</span>
        {g.growth_ppm !== null && <span className={cn('vo-mono vo-num shrink-0 text-[12px]', up ? 'text-[var(--vo-good)]' : 'text-[var(--vo-bad)]')}>{pct(g.growth_ppm, 0, { sign: true })}</span>}
      </span>
      {w > 0 && (
        <Sparkline
          values={g.points.map((p) => (p.value === null ? null : money_ ? toMajor(p.value, ccy) : p.value))}
          status={g.points.map((p) => (p.status === 'staged' ? 'staged' : 'verified'))}
          tone={up ? 'a' : 'bad'}
          width={Math.max(40, w - 16)}
          height={34}
          area
          format={(v) => (money_ ? money(Math.round(v * 10 ** exponent(ccy)), ccy, { compact: true }) : compact(v))}
          label={`${g.company.name} ${g.label}`}
        />
      )}
    </button>
  );
}

export function GrowthBlock({ p, loading, className }: { p: PortfolioVisual | null; loading: boolean; className?: string | undefined }): React.JSX.Element | null {
  if (!loading && p === null) return null;
  const list = p?.growth ?? [];
  const label = list.length > 0 && list.every((g) => g.key === list[0]?.key) ? (list[0]?.label ?? '') : '';
  return (
    <Panel divided label={label !== '' ? `${label} growth` : 'Growth'} tip="Each company's main figure over the last months, with its growth over that time. Dashed points are not verified yet." className={className}>
      {loading || p === null ? (
        <Skeleton className="h-[300px] w-full" />
      ) : list.length === 0 ? (
        <Empty icon={TrendingUp} title="Growth shows once companies report" className="py-10" />
      ) : (
        <div className="-mx-2 grid min-w-0 grid-cols-2 gap-x-1 gap-y-1">
          {list.map((g) => (
            <GrowthCell key={g.company.id} g={g} currency={p.currency} />
          ))}
        </div>
      )}
    </Panel>
  );
}
