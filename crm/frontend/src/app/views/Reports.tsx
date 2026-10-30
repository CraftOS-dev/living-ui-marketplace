/**
 * Reports: eight presets, each a chart above a table, with a period and a
 * pipeline, the formula behind every number, click-through to the deals,
 * CSV export and "Explain with AI". No report builder: these answer "how
 * are we doing" without one.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Cake, ChartPie, Clock, Download, Filter as FunnelIcon, Flame, Handshake, Info, Kanban, Snowflake, Sparkles, TrendingUp, Trophy, Users } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { compact, day, money, monthName, relDay, since, stageColor, toDecimal } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { ActivityReport, Deal, Forecast, Funnel, PipelineReport, Relationships, Sources, StageTime, WinLoss } from '../lib/types.ts';
import { BarChart, CAT, Donut, Legend, StackBar, StackedBars } from '../components/charts.tsx';
import { Avatar, Dot, StrengthBars } from '../components/controls.tsx';
import { Btn, Select, Spinner } from '../components/ui.tsx';

type Rid = 'pipeline' | 'funnel' | 'forecast' | 'winloss' | 'stage_time' | 'sources' | 'activity' | 'relationships';

const LIST: { id: Rid; label: string; icon: LucideIcon; group: string; pipe?: boolean; range?: boolean }[] = [
  { id: 'pipeline', label: 'Pipeline', icon: Kanban, group: 'Deals', pipe: true },
  { id: 'funnel', label: 'Conversion', icon: FunnelIcon, group: 'Deals', pipe: true, range: true },
  { id: 'forecast', label: 'Forecast', icon: TrendingUp, group: 'Deals', pipe: true },
  { id: 'winloss', label: 'Won and lost', icon: Trophy, group: 'Deals', pipe: true, range: true },
  { id: 'stage_time', label: 'Time in stage', icon: Clock, group: 'Deals', pipe: true, range: true },
  { id: 'sources', label: 'Sources', icon: ChartPie, group: 'Deals', range: true },
  { id: 'activity', label: 'Activity', icon: Handshake, group: 'Relationships', range: true },
  { id: 'relationships', label: 'Relationships', icon: Users, group: 'Relationships' },
];

const RANGES = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'last_quarter', label: 'Last quarter' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'last_year', label: 'Last year' },
  { value: 'last_12_months', label: 'Last 12 months' },
];

function Formula({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <p className="flex items-start gap-1.5 px-4 pb-1 pt-2 text-[11.5px] leading-4 text-[var(--cr-muted)]">
      <Info size={12} className="mt-px shrink-0" /> <span>{children}</span>
    </p>
  );
}

function ChartBox({ title, aside, children }: { title: string; aside?: ReactNode | undefined; children: ReactNode }): React.JSX.Element {
  return (
    <div className="cr-rise border-b border-[var(--cr-line)] px-4 pb-3 pt-2.5">
      <div className="mb-1.5 flex items-center gap-3">
        <span className="text-[12px] font-semibold text-[var(--cr-ink-2)]">{title}</span>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode | undefined; tone?: 'pos' | 'neg' | undefined }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-[var(--cr-card)] px-4 py-2.5">
      <span className="truncate text-[11px] font-semibold text-[var(--cr-muted)]">{label}</span>
      <span className={cn('num text-[17px] font-bold leading-6', tone === 'pos' && 'text-[var(--cr-pos-text)]', tone === 'neg' && 'text-[var(--cr-neg-text)]')}>{value}</span>
      {sub !== undefined && <span className="truncate text-[11.5px] text-[var(--cr-muted)]">{sub}</span>}
    </div>
  );
}

function DealRows({ deals, home }: { deals: Deal[]; home: string }): React.JSX.Element {
  return (
    <table className="cr-table table-fixed">
      <colgroup>
        <col />
        <col className="w-[24%]" />
        <col className="w-[132px]" />
        <col className="w-[112px]" />
        <col className="w-[96px]" />
        <col className="w-[92px]" />
      </colgroup>
      <thead>
        <tr>
          <th>Deal</th>
          <th>Company</th>
          <th>Stage</th>
          <th className="r">Value</th>
          <th className="r">Weighted</th>
          <th>Close</th>
        </tr>
      </thead>
      <tbody>
        {deals.map((d) => (
          <tr key={d.id} data-click="true" onClick={() => go('deals', { id: d.id })}>
            <td className="truncate font-semibold" title={d.name}>
              {d.name}
            </td>
            <td className="truncate text-[var(--cr-ink-2)]">{d.company_name}</td>
            <td className="truncate">
              <span className="inline-flex items-center gap-1.5">
                <Dot color={stageColor(d.stage_color, d.stage_kind)} /> {d.stage_name}
              </span>
            </td>
            <td className="r num">{money(d.value, d.currency)}</td>
            <td className="r num text-[var(--cr-ink-2)]">{d.weighted === null ? '–' : compact(d.weighted, home)}</td>
            <td className="num text-[var(--cr-ink-2)]">{d.status === 'open' ? (d.expected_close ? relDay(d.expected_close) : '') : day(d.closed_at, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PipelineView({ r, home }: { r: PipelineReport; home: string }): React.JSX.Element {
  const max = Math.max(1, ...r.stages.map((s) => s.value));
  return (
    <>
      <div className="grid grid-cols-2 gap-px border-b border-[var(--cr-line)] bg-[var(--cr-line)] sm:grid-cols-4">
        <Stat label="Open deals" value={r.total.count} />
        <Stat label="Open value" value={compact(r.total.value, home)} />
        <Stat label="Weighted" value={compact(r.total.weighted, home)} sub="value x probability" />
        <Stat label="Rotting" value={r.stages.reduce((t, s) => t + s.rotting, 0)} tone={r.stages.some((s) => s.rotting > 0) ? 'neg' : undefined} sub="no activity past the stage limit" />
      </div>
      <ChartBox title="Open deals by stage">
        <ul className="flex flex-col gap-1.5">
          {r.stages.map((s, i) => (
            <li key={s.id} className="grid grid-cols-[130px_minmax(0,1fr)_150px] items-center gap-3 text-[12.5px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <Dot color={stageColor(s.color)} />
                <span className="truncate font-semibold">{s.name}</span>
                <span className="text-[11px] text-[var(--cr-muted)]">{s.probability}%</span>
              </span>
              <span className="relative h-6 overflow-hidden bg-[var(--cr-row)]">
                <span className="cr-grow-x absolute inset-y-0 left-0 opacity-30" style={{ width: `${(s.value / max) * 100}%`, background: stageColor(s.color), animationDelay: `${i * 60}ms` }} />
                <span className="cr-grow-x absolute inset-y-0 left-0" style={{ width: `${(s.weighted / max) * 100}%`, background: stageColor(s.color), animationDelay: `${i * 60 + 120}ms` }} />
              </span>
              <span className="num text-right">
                <b>{compact(s.value, home)}</b> <span className="text-[var(--cr-muted)]">· {s.count}</span>
              </span>
            </li>
          ))}
        </ul>
      </ChartBox>
      <Formula>Values are in your home currency at the latest rate{r.no_rate > 0 ? '; ' + r.no_rate + ' deal' + (r.no_rate === 1 ? ' has' : 's have') + ' no rate and are left out' : ''}. Weighted = value x probability (the stage's unless the deal sets its own).</Formula>
      <DealRows deals={r.deals} home={home} />
    </>
  );
}

function FunnelView({ r }: { r: Funnel }): React.JSX.Element {
  return (
    <>
      <div className="grid grid-cols-2 gap-px border-b border-[var(--cr-line)] bg-[var(--cr-line)] sm:grid-cols-3">
        <Stat label="Deals created" value={r.deals} sub={day(r.from, true) + ' – ' + day(r.to, true)} />
        <Stat label="Won so far" value={r.win_rate === null ? '–' : r.win_rate + '%'} tone="pos" />
        <Stat label="Biggest drop" value={(() => {
          let worst = '';
          let low = 101;
          for (const s of r.stages.slice(1)) if (s.from_prev < low) {
            low = s.from_prev;
            worst = s.name;
          }
          return worst ? worst : '–';
        })()} sub="lowest share from the stage before" />
      </div>
      <ChartBox title="Share of deals that reached each stage">
        {r.deals === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-[var(--cr-muted)]">No deals created in this period.</p>
        ) : (
          <div className="flex h-[200px] items-end gap-2 pt-4">
            {r.stages.map((s, i) => (
              <div key={s.id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="num text-[12px] font-bold">{s.pct}%</span>
                <span className="cr-grow-y w-full max-w-[72px]" style={{ height: `${Math.max(2, s.pct)}%`, background: s.kind === 'won' ? 'var(--cr-pos)' : stageColor(s.color), animationDelay: `${i * 70}ms` }} title={s.reached + ' of ' + r.deals} />
                <span className="w-full truncate text-center text-[11px] text-[var(--cr-ink-2)]">{s.name}</span>
                {i > 0 && <span className="num text-[10.5px] text-[var(--cr-muted)]">{s.from_prev}% from before</span>}
              </div>
            ))}
          </div>
        )}
      </ChartBox>
      <Formula>Of the deals created in the period: the share that ever entered each stage. A deal that skipped a stage counts as having passed it; a won deal passed every open stage.</Formula>
      <table className="cr-table">
        <thead>
          <tr>
            <th>Stage</th>
            <th className="r">Reached</th>
            <th className="r">Of all</th>
            <th className="r">From the stage before</th>
          </tr>
        </thead>
        <tbody>
          {r.stages.map((s) => (
            <tr key={s.id}>
              <td>
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Dot color={s.kind === 'won' ? 'var(--cr-pos)' : stageColor(s.color)} /> {s.name}
                </span>
              </td>
              <td className="r num">{s.reached}</td>
              <td className="r num">{s.pct}%</td>
              <td className="r num">{s.from_prev}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ForecastView({ r, home }: { r: Forecast; home: string }): React.JSX.Element {
  return (
    <>
      <ChartBox title="By month" aside={<Legend series={[{ key: 'won', label: 'Won', color: 'var(--cr-pos)' }, { key: 'weighted', label: 'Weighted', color: 'var(--cr-c1)' }, { key: 'best', label: 'Won + best case', color: 'var(--cr-ink)' }]} />}>
        <BarChart
          height={230}
          currency={home}
          groups={r.months.map((m) => ({ label: monthName(m.month).slice(0, 3), title: monthName(m.month), values: { won: m.won, weighted: m.weighted, best: m.best + m.won } }))}
          series={[
            { key: 'won', label: 'Won', color: 'var(--cr-pos)' },
            { key: 'weighted', label: 'Weighted', color: 'var(--cr-c1)' },
          ]}
          line={{ key: 'best', label: 'Won + best case', color: 'var(--cr-ink)' }}
        />
      </ChartBox>
      <Formula>Won deals sit in the month they closed; open deals in the month of their expected close (overdue ones count this month), weighted by probability. Best case counts them at full value.</Formula>
      <table className="cr-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="r">Won</th>
            <th className="r">Weighted</th>
            <th className="r">Best case</th>
            <th className="r">Open deals</th>
          </tr>
        </thead>
        <tbody>
          {r.months.map((m) => (
            <tr key={m.month}>
              <td className="font-semibold">{monthName(m.month)}</td>
              <td className="r num text-[var(--cr-pos-text)]">{money(m.won, home)}</td>
              <td className="r num">{money(m.weighted, home)}</td>
              <td className="r num text-[var(--cr-ink-2)]">{money(m.best, home)}</td>
              <td className="r num">{m.deals}</td>
            </tr>
          ))}
          {r.undated.count > 0 && (
            <tr>
              <td className="text-[var(--cr-ink-2)]">No expected close</td>
              <td />
              <td className="r num">{money(r.undated.weighted, home)}</td>
              <td className="r num text-[var(--cr-ink-2)]">{money(r.undated.value, home)}</td>
              <td className="r num">{r.undated.count}</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

function WinLossView({ r, home }: { r: WinLoss; home: string }): React.JSX.Element {
  const s = r.stats;
  const p = r.previous;
  const maxReason = Math.max(1, ...r.reasons.map((x) => x.count));
  return (
    <>
      <div className="grid grid-cols-2 gap-px border-b border-[var(--cr-line)] bg-[var(--cr-line)] sm:grid-cols-4">
        <Stat label="Won" value={compact(s.won_value, home)} sub={s.won + ' deals' + (p ? ' · before ' + compact(p.won_value, home) : '')} tone="pos" />
        <Stat label="Win rate" value={s.win_rate === null ? '–' : s.win_rate + '%'} sub={p && p.win_rate !== null ? 'before ' + p.win_rate + '%' : 'won / (won + lost)'} />
        <Stat label="Average deal" value={s.avg_deal === null ? '–' : compact(s.avg_deal, home)} sub={p && p.avg_deal !== null ? 'before ' + compact(p.avg_deal, home) : undefined} />
        <Stat label="Sales cycle" value={s.cycle_days === null ? '–' : s.cycle_days + ' d'} sub={p && p.cycle_days !== null ? 'before ' + p.cycle_days + ' d' : 'created to won'} />
      </div>
      <ChartBox title="Won and lost by month" aside={<Legend series={[{ key: 'won', label: 'Won', color: 'var(--cr-pos)' }, { key: 'lost', label: 'Lost', color: 'var(--cr-neg)' }]} />}>
        <BarChart
          height={210}
          currency={home}
          groups={r.months.map((m) => ({ label: monthName(m.month).slice(0, 3), title: monthName(m.month) + (m.win_rate !== null ? ' · ' + m.win_rate + '% won' : ''), values: { won: m.won, lost: m.lost } }))}
          series={[
            { key: 'won', label: 'Won', color: 'var(--cr-pos)' },
            { key: 'lost', label: 'Lost', color: 'var(--cr-neg)' },
          ]}
        />
      </ChartBox>
      {r.reasons.length > 0 && (
        <ChartBox title="Why deals were lost">
          <ul className="flex flex-col gap-1">
            {r.reasons.map((x, i) => (
              <li key={x.reason} className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_90px] items-center gap-3 text-[12.5px]">
                <span className="truncate">{x.reason}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[var(--cr-row-hover)]">
                  <span className="cr-grow-x block h-full rounded-full bg-[var(--cr-neg)]" style={{ width: `${(x.count / maxReason) * 100}%`, animationDelay: `${i * 50}ms` }} />
                </span>
                <span className="num text-right">
                  <b>{x.count}</b> <span className="text-[var(--cr-muted)]">· {compact(x.value, home)}</span>
                </span>
              </li>
            ))}
          </ul>
        </ChartBox>
      )}
      <Formula>Win rate = won / (won + lost) among deals closed in the period. Average deal = won value / won deals. Sales cycle = average days from a won deal's creation to its close. Values are frozen in your home currency when a deal closes.</Formula>
      <DealRows deals={r.deals} home={home} />
    </>
  );
}

function StageTimeView({ r }: { r: StageTime }): React.JSX.Element {
  const max = Math.max(1, ...r.stages.map((s) => Math.max(s.max ?? 0, s.target_days)));
  return (
    <>
      <ChartBox title="Days in each stage" aside={<span className="flex items-center gap-3 text-[11.5px] text-[var(--cr-ink-2)]"><span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-4 bg-[var(--cr-ink-2)] opacity-25" /> min to max</span><span className="inline-flex items-center gap-1"><span className="inline-block size-2 rounded-full bg-[var(--cr-ink)]" /> average</span><span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-px bg-[var(--cr-neg)]" /> target</span></span>}>
        <ul className="flex flex-col gap-2 py-1">
          {r.stages.map((s) => (
            <li key={s.id} className="grid grid-cols-[130px_minmax(0,1fr)_110px] items-center gap-3 text-[12.5px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <Dot color={stageColor(s.color)} />
                <span className="truncate font-semibold">{s.name}</span>
              </span>
              <span className="relative h-5 bg-[var(--cr-row)]">
                {s.min !== null && s.max !== null && <span className="cr-grow-x absolute inset-y-1 opacity-30" style={{ left: `${(s.min / max) * 100}%`, width: `${Math.max(0.8, ((s.max - s.min) / max) * 100)}%`, background: stageColor(s.color) }} />}
                {s.avg !== null && <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--cr-card)]" style={{ left: `${(s.avg / max) * 100}%`, background: stageColor(s.color) }} title={'Average ' + s.avg + ' days'} />}
                {s.target_days > 0 && <span className="absolute inset-y-0 w-px bg-[var(--cr-neg)]" style={{ left: `${(s.target_days / max) * 100}%` }} title={'Target ' + s.target_days + ' days'} />}
              </span>
              <span className="num text-right">
                <b className={cn(s.avg !== null && s.target_days > 0 && s.avg > s.target_days && 'text-[var(--cr-neg-text)]')}>{s.avg === null ? '–' : s.avg + ' d'}</b> <span className="text-[var(--cr-muted)]">· {s.count}</span>
              </span>
            </li>
          ))}
        </ul>
      </ChartBox>
      <Formula>From the stage history: every stay in a stage that ended in the period or is still running, in days. A stage's target (Setup) shows where deals start to drag.</Formula>
      <table className="cr-table">
        <thead>
          <tr>
            <th>Stage</th>
            <th className="r">Stays</th>
            <th className="r">Shortest</th>
            <th className="r">Average</th>
            <th className="r">Longest</th>
            <th className="r">Target</th>
          </tr>
        </thead>
        <tbody>
          {r.stages.map((s) => (
            <tr key={s.id}>
              <td className="font-semibold">{s.name}</td>
              <td className="r num">{s.count}</td>
              <td className="r num">{s.min ?? '–'}</td>
              <td className="r num font-semibold">{s.avg ?? '–'}</td>
              <td className="r num">{s.max ?? '–'}</td>
              <td className="r num text-[var(--cr-muted)]">{s.target_days || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function SourcesView({ r, home }: { r: Sources; home: string }): React.JSX.Element {
  const items = r.deals.map((s, i) => ({ label: s.source, value: s.deals, color: s.source === 'Unknown' ? 'var(--cr-line)' : CAT(i) }));
  const maxP = Math.max(1, ...r.people.map((x) => x.count));
  return (
    <>
      <ChartBox title="Deals created, by source">
        {items.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-[var(--cr-muted)]">No deals created in this period.</p>
        ) : (
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <Donut size={170} thickness={24} currency={home} items={items} center={{ label: 'Deals', value: String(items.reduce((t, x) => t + x.value, 0)) }} />
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">New people by source</p>
              <ul className="flex flex-col gap-1">
                {r.people.slice(0, 8).map((x, i) => (
                  <li key={x.source} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_40px] items-center gap-2 text-[12.5px]">
                    <span className="truncate">{x.source}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-[var(--cr-row-hover)]">
                      <span className="cr-grow-x block h-full rounded-full bg-[var(--cr-c1)]" style={{ width: `${(x.count / maxP) * 100}%`, animationDelay: `${i * 50}ms` }} />
                    </span>
                    <span className="num text-right font-semibold">{x.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </ChartBox>
      <Formula>Deals and people created in the period, by their source field. Win rate = won / (won + lost) of those deals so far.</Formula>
      <table className="cr-table">
        <thead>
          <tr>
            <th>Source</th>
            <th className="r">Deals</th>
            <th className="r">Won</th>
            <th className="r">Lost</th>
            <th className="r">Win rate</th>
            <th className="r">Won value</th>
            <th className="r">Still open</th>
          </tr>
        </thead>
        <tbody>
          {r.deals.map((s, i) => (
            <tr key={s.source}>
              <td>
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <span className="inline-block size-2" style={{ background: items[i]?.color }} /> {s.source}
                </span>
              </td>
              <td className="r num">{s.deals}</td>
              <td className="r num">{s.won}</td>
              <td className="r num">{s.lost}</td>
              <td className="r num">{s.win_rate === null ? '–' : s.win_rate + '%'}</td>
              <td className="r num text-[var(--cr-pos-text)]">{money(s.won_value, home)}</td>
              <td className="r num">{money(s.open_value, home)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const IX = [
  { key: 'meeting', label: 'Meetings', color: 'var(--cr-c1)' },
  { key: 'call', label: 'Calls', color: 'var(--cr-c2)' },
  { key: 'email', label: 'Emails', color: 'var(--cr-c4)' },
  { key: 'message', label: 'Messages', color: 'var(--cr-c3)' },
];

function ActivityView({ r }: { r: ActivityReport }): React.JSX.Element {
  return (
    <>
      <div className="grid grid-cols-2 gap-px border-b border-[var(--cr-line)] bg-[var(--cr-line)] sm:grid-cols-6">
        <Stat label="Interactions" value={r.total} />
        {IX.map((x) => (
          <Stat key={x.key} label={x.label} value={r.by_kind[x.key] ?? 0} />
        ))}
        <Stat label="Tasks done" value={r.tasks_done} sub={r.notes + ' notes'} />
      </div>
      <ChartBox title="Per week" aside={<Legend series={IX} />}>
        <StackedBars height={220} unit="interactions" series={IX} groups={r.weeks.map((w) => ({ label: day(w.week, true), title: 'Week of ' + day(w.week), values: { meeting: w.meeting, call: w.call, email: w.email, message: w.message } }))} />
      </ChartBox>
      <Formula>Interactions logged by you, your AI agent or a sync, by the week they happened (weeks start on Monday).</Formula>
      <table className="cr-table">
        <thead>
          <tr>
            <th>Most in touch with</th>
            <th className="r">Interactions</th>
            <th>Strength</th>
          </tr>
        </thead>
        <tbody>
          {r.top_people.map((p) => (
            <tr key={p.id} data-click="true" onClick={() => go('people', { id: p.id })}>
              <td>
                <span className="inline-flex items-center gap-2 font-semibold">
                  <Avatar name={p.name} size={20} /> {p.name}
                </span>
              </td>
              <td className="r num">{p.count}</td>
              <td>
                <StrengthBars value={p.strength} showLabel />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RelationshipsView({ r }: { r: Relationships }): React.JSX.Element {
  const L = ({ icon: Icon, title, list, right, empty }: { icon: LucideIcon; title: string; list: Relationships['cold']; right: (p: Relationships['cold'][number]) => ReactNode; empty: string }): React.JSX.Element => (
    <section className="min-w-0">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-[var(--cr-ink-2)]">
        <Icon size={13} /> {title}
      </h3>
      {list.length === 0 ? (
        <p className="text-[12px] text-[var(--cr-muted)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--cr-hair)] border border-[var(--cr-line)]">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => go('people', { id: p.id })} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--cr-row)]">
                <Avatar name={p.name} size={20} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block truncate text-[11px] text-[var(--cr-muted)]">{[p.title, p.company_name].filter(Boolean).join(' · ')}</span>
                </span>
                {right(p)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <>
      <ChartBox title={'Strength of your relationships · ' + r.total + ' people'}>
        <StackBar
          currency=""
          height={14}
          items={[
            { label: 'Strong', value: r.mix.strong, color: 'var(--cr-pos)' },
            { label: 'Good', value: r.mix.good, color: 'var(--cr-c1)' },
            { label: 'Weak', value: r.mix.weak, color: 'var(--cr-warn)' },
            { label: 'No contact yet', value: r.mix.none, color: 'var(--cr-line)' },
          ]}
          legend={false}
        />
        <p className="mt-2 flex flex-wrap gap-x-4 text-[12px] text-[var(--cr-ink-2)]">
          {[
            ['Strong', r.mix.strong, 'var(--cr-pos)'],
            ['Good', r.mix.good, 'var(--cr-c1)'],
            ['Weak', r.mix.weak, 'var(--cr-warn)'],
            ['No contact yet', r.mix.none, 'var(--cr-line)'],
          ].map(([l, n, c]) => (
            <span key={String(l)} className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2" style={{ background: String(c) }} />
              {l} <b className="num">{n}</b>
            </span>
          ))}
        </p>
      </ChartBox>
      <Formula>Strength weighs how recent and how frequent your interactions are: each one in the last year counts (meeting 3, call 2, email received 1.5, sent or message 1), halving every 60 days. 60+ is strong, 30 to 59 good.</Formula>
      <div className="grid grid-cols-1 gap-4 px-4 py-3 lg:grid-cols-2">
        <L icon={Snowflake} title="Going cold" list={r.cold} empty="Nobody you talked to often has gone quiet." right={(p) => <span className="text-[11.5px] text-[var(--cr-muted)]">{since(p.last_interaction)}</span>} />
        <L icon={Clock} title="Keep in touch now" list={r.keep_in_touch} empty="Nobody is due." right={(p) => <span className="text-[11.5px] font-semibold text-[var(--cr-warn-text)]">{relDay(p.next_touch)}</span>} />
        <L icon={Flame} title="Strongest" list={r.strongest} empty="Log interactions to see them here." right={(p) => <StrengthBars value={p.strength} />} />
        <L icon={Cake} title="Birthdays in the next 30 days" list={r.birthdays} empty="None coming up." right={(p) => <span className="text-[11.5px] text-[var(--cr-ink-2)]">{p.in_days === 0 ? 'today' : 'in ' + p.in_days + ' d'}</span>} />
      </div>
    </>
  );
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : String(c))).join(',')).join('\n') + '\n';
}

function csvOf(id: Rid, data: unknown, home: string): string {
  const m = (v: number): string => toDecimal(v, home);
  if (id === 'pipeline') return toCsv([['stage', 'deals', 'value', 'weighted'], ...(data as PipelineReport).stages.map((s) => [s.name, s.count, m(s.value), m(s.weighted)])]);
  if (id === 'funnel') return toCsv([['stage', 'reached', 'pct', 'from_previous_pct'], ...(data as Funnel).stages.map((s) => [s.name, s.reached, s.pct, s.from_prev])]);
  if (id === 'forecast') return toCsv([['month', 'won', 'weighted', 'best_case', 'deals'], ...(data as Forecast).months.map((x) => [x.month, m(x.won), m(x.weighted), m(x.best), x.deals])]);
  if (id === 'winloss') return toCsv([['month', 'won', 'lost', 'won_count', 'lost_count', 'win_rate'], ...(data as WinLoss).months.map((x) => [x.month, m(x.won), m(x.lost), x.won_count, x.lost_count, x.win_rate ?? ''])]);
  if (id === 'stage_time') return toCsv([['stage', 'stays', 'min_days', 'avg_days', 'max_days', 'target_days'], ...(data as StageTime).stages.map((s) => [s.name, s.count, s.min ?? '', s.avg ?? '', s.max ?? '', s.target_days])]);
  if (id === 'sources') return toCsv([['source', 'deals', 'won', 'lost', 'win_rate', 'won_value', 'open_value'], ...(data as Sources).deals.map((s) => [s.source, s.deals, s.won, s.lost, s.win_rate ?? '', m(s.won_value), m(s.open_value)])]);
  if (id === 'activity') return toCsv([['week', 'meetings', 'calls', 'emails', 'messages'], ...(data as ActivityReport).weeks.map((w) => [w.week, w.meeting, w.call, w.email, w.message])]);
  const r = data as Relationships;
  return toCsv([['list', 'name', 'company', 'strength', 'last_interaction'], ...r.cold.map((p) => ['going cold', p.name, p.company_name, p.strength, p.last_interaction]), ...r.keep_in_touch.map((p) => ['keep in touch', p.name, p.company_name, p.strength, p.last_interaction])]);
}

export function ReportsView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const app = useApp();
  const id = (LIST.some((x) => x.id === q['r']) ? q['r'] : 'pipeline') as Rid;
  const meta = LIST.find((x) => x.id === id)!;
  const [range, setRange] = useState('this_quarter');
  const pipeline = q['pipeline'] ?? app.pipelines[0]?.id ?? '';
  const params: Record<string, unknown> = { range, pipeline: meta.pipe ? pipeline : undefined };
  const live = useLive<unknown>(
    () => {
      switch (id) {
        case 'pipeline':
          return api.reportPipeline(pipeline);
        case 'funnel':
          return api.funnel(params);
        case 'forecast':
          return api.forecast({ pipeline, months: 6 });
        case 'winloss':
          return api.winloss(params);
        case 'stage_time':
          return api.stageTime(params);
        case 'sources':
          return api.sources({ range });
        case 'activity':
          return api.activityReport({ range });
        default:
          return api.relationships();
      }
    },
    ['deals', 'stage_events', 'interactions', 'people', 'stages', 'fx_rates', 'tasks'],
    [id, range, pipeline],
    500,
  );
  useReportScreen('reports', { type: 'report', id }, { range, pipeline });
  const d = live.data;
  const explain = (): void => {
    api
      .ask('Explain the ' + meta.label.toLowerCase() + ' report: what changed, what stands out, what to do about it.', 'explain', { report: id, params })
      .then((r) => toast.success(r.asked ? 'Asked your AI agent; the answer appears under Ask AI' : 'Saved; your AI agent answers when it is next available'))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  const download = (): void => {
    if (d === null) return;
    const blob = new Blob([csvOf(id, d, app.home)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = id + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const groups = [...new Set(LIST.map((x) => x.group))];
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[200px] shrink-0 overflow-y-auto border-r border-[var(--cr-line)] py-1 md:block">
        {groups.map((g) => (
          <div key={g} className="mb-1">
            <p className="px-3 pb-0.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--cr-muted)]">{g}</p>
            {LIST.filter((x) => x.group === g).map((x) => (
              <button key={x.id} type="button" onClick={() => setQuery({ r: x.id }, true)} className={cn('relative flex h-7 w-full items-center gap-2 px-3 text-left text-[12.5px] transition-colors', x.id === id ? 'bg-[var(--cr-row-hover)] font-semibold' : 'hover:bg-[var(--cr-row)]')}>
                {x.id === id && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 bg-[var(--cr-accent)]" />}
                <x.icon size={14} strokeWidth={2} className={cn('shrink-0', x.id === id ? 'text-[var(--cr-ink)]' : 'text-[var(--cr-muted)]')} />
                {x.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--cr-line)] px-3 py-1.5">
          <Select small label="Report" value={id} onChange={(v) => setQuery({ r: v }, true)} className="w-40 md:hidden" options={LIST.map((x) => ({ value: x.id, label: x.label }))} />
          <h2 className="hidden items-center gap-2 text-[13px] font-bold md:flex">
            <meta.icon size={15} className="text-[var(--cr-ink-2)]" /> {meta.label}
          </h2>
          <span className="flex-1" />
          {meta.pipe && app.pipelines.length > 0 && <Select small label="Pipeline" value={pipeline} onChange={(v) => setQuery({ pipeline: v }, true)} className="w-40" options={app.pipelines.map((p) => ({ value: p.id, label: p.name }))} />}
          {meta.range && <Select small label="Period" value={range} onChange={setRange} className="w-36" options={RANGES} />}
          <Btn size="sm" variant="ghost" icon={Download} onClick={download}>
            CSV
          </Btn>
          <Btn size="sm" icon={Sparkles} onClick={explain} className="text-[var(--cr-accent-text)]">
            Explain
          </Btn>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" key={id}>
          {d === null ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          ) : id === 'pipeline' ? (
            <PipelineView r={d as PipelineReport} home={app.home} />
          ) : id === 'funnel' ? (
            <FunnelView r={d as Funnel} />
          ) : id === 'forecast' ? (
            <ForecastView r={d as Forecast} home={app.home} />
          ) : id === 'winloss' ? (
            <WinLossView r={d as WinLoss} home={app.home} />
          ) : id === 'stage_time' ? (
            <StageTimeView r={d as StageTime} />
          ) : id === 'sources' ? (
            <SourcesView r={d as Sources} home={app.home} />
          ) : id === 'activity' ? (
            <ActivityView r={d as ActivityReport} />
          ) : (
            <RelationshipsView r={d as Relationships} />
          )}
        </div>
      </section>
    </div>
  );
}

