/**
 * A portfolio company's Overview tab, a dashboard read top to bottom:
 *
 *   1. KPI tiles: ARR (or revenue), growth, net burn, cash, runway (with the
 *      6-month line) and headcount, each a big number with its unit and a
 *      small chart; only the metrics the company reports.
 *   2. What is happening: the latest founder update (its date and a
 *      summary), open asks, the next board meeting.
 *   3. News about the company and its files (decks, board decks, founder
 *      updates, the deal room), each one click away.
 *   4. KPIs over time: the larger charts.
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarClock, FileText, FolderOpen, HandHelping, Mail, Newspaper, Plus, Presentation, Table2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentTag, Avatar, Button, Empty, LinkButton, Panel, Skeleton, StatusDot, Tag, Tip } from '../../components/ui.tsx';
import { Sparkline } from '../../components/charts.tsx';
import type { PointStatus } from '../../components/charts.tsx';
import { chartFormat, chartValue, growthText, periodLong, valueText } from '../../components/portfolio/kit.tsx';
import { NewsList } from '../../components/markets/NewsList.tsx';
import { listNews } from '../../components/markets/news.ts';
import type { NewsRow } from '../../components/markets/news.ts';
import { fmtDay, num, relDay, today } from '../../lib/format.ts';
import { useOnChange, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { openSource } from '../../lib/source.ts';
import { KPI_READS, Overview } from './Overview.tsx';
import type { CompanyView, KpiList, Metric, PageFile } from './types.ts';

/** The width of an element (charts that fill their tile). */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.getBoundingClientRect().width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

interface TileSpec {
  key: string;
  label: string;
  value: string;
  tip: string;
  when: string;
  tone?: 'bad' | 'good' | undefined;
  values?: (number | null)[] | undefined;
  status?: PointStatus[] | undefined;
  format?: ((v: number) => string) | undefined;
  runway?: number | null | undefined;
}

/** Runway on a 0 to 24 month track with the 6-month line marked and named. */
function RunwayLine({ months }: { months: number | null }): React.JSX.Element {
  const MAX = 24;
  const at = (m: number): string => `${(Math.max(0, Math.min(MAX, m)) / MAX) * 100}%`;
  const tone = months === null ? 'var(--vo-line-2)' : months < 6 ? 'var(--vo-bad)' : months < 12 ? 'var(--vo-warn)' : 'var(--vo-ink)';
  return (
    <div className="relative h-8 w-full" role="img" aria-label={months === null ? 'Runway unknown' : `Runway ${num(months, 1)} months; the red line is 6 months`}>
      <span className="absolute inset-x-0 top-2 h-1.5 rounded-full bg-[var(--vo-sunk)]" />
      <span className="absolute left-0 top-2 h-1.5 rounded-full transition-[width] duration-700 ease-out" style={{ width: months === null ? 0 : at(months), background: tone }} />
      <span aria-hidden className="absolute top-0.5 h-[18px] w-[2px] rounded-full bg-[var(--vo-bad)]" style={{ left: `calc(${at(6)} - 1px)` }} />
      <span className="absolute top-[18px] -translate-x-1/2 whitespace-nowrap text-[12px] leading-4 text-[var(--vo-bad)]" style={{ left: at(6) }}>
        6 months
      </span>
      <span className="absolute right-0 top-[18px] text-[12px] leading-4 text-[var(--vo-muted)]">24+</span>
    </div>
  );
}

function Tile({ t }: { t: TileSpec }): React.JSX.Element {
  const [ref, w] = useWidth();
  return (
    <div className="vo-panel vo-in flex min-w-0 flex-col gap-1 px-4 pb-3 pt-3.5">
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--vo-muted)]">
        <Tip text={t.tip} className="min-w-0 truncate">
          {t.label}
        </Tip>
        {t.when !== '' && <span className="ml-auto shrink-0">{t.when}</span>}
      </div>
      <div className={cn('vo-mono vo-num truncate text-[26px] font-light leading-8 tracking-tight', t.tone === 'bad' ? 'text-[var(--vo-bad)]' : t.tone === 'good' ? 'text-[var(--vo-good)]' : 'text-[var(--vo-ink)]')}>{t.value}</div>
      <div ref={ref} className="mt-1 flex h-8 min-w-0 items-center">
        {t.runway !== undefined ? <RunwayLine months={t.runway} /> : t.values !== undefined && w > 0 ? <Sparkline values={t.values} status={t.status} width={w} height={32} area tone="a" format={t.format} label={t.label} /> : null}
      </div>
    </div>
  );
}

/** The last 12 points of a metric (verified solid, staged dashed). */
function series(m: Metric): { values: (number | null)[]; status: PointStatus[]; last: string } {
  const pts = m.points.filter((p) => p.value !== null).slice(-12);
  return {
    values: pts.map((p) => chartValue(m.unit, p.value, p.currency)),
    status: pts.map((p) => (p.status === 'verified' ? 'verified' : 'staged')),
    last: pts.at(-1)?.period_end ?? '',
  };
}

function perPeriod(m: Metric): string {
  const months = m.latest?.months ?? m.points.at(-1)?.months ?? 1;
  return months === 3 ? ' a quarter' : months === 12 ? ' a year' : ' a month';
}

/** The KPI tiles: only the metrics the company reports. */
function Tiles({ k }: { k: KpiList }): React.JSX.Element | null {
  const m = (key: string): Metric | undefined => k.metrics.find((x) => x.key === key && x.points.some((p) => p.value !== null));
  const tiles: TileSpec[] = [];
  const top = m('arr') ?? m('mrr') ?? m('revenue');
  if (top !== undefined) {
    const s = series(top);
    const cur = top.latest?.currency ?? k.report_currency;
    tiles.push({ key: 'top', label: top.label, value: top.latest !== null ? valueText(top.unit, top.latest.value, top.latest.currency) + (top.key === 'revenue' ? perPeriod(top) : '') : '', tip: top.label + ': the latest verified value.', when: top.latest !== null ? periodLong(top.latest.period_end) : '', values: s.values, status: s.status, format: chartFormat(top.unit, cur) });
    if (top.growth.growth_ppm !== null) {
      const g: (number | null)[] = [];
      const v = s.values;
      for (let i = 1; i < v.length; i++) {
        const a = v[i - 1];
        const b = v[i];
        g.push(a !== null && a !== undefined && b !== null && b !== undefined && a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null);
      }
      tiles.push({ key: 'growth', label: 'Growth', value: growthText(top.growth.growth_ppm) + perPeriod(top), tip: top.label + ' growth on the verified period before.', when: '', tone: top.growth.growth_ppm < 0 ? 'bad' : undefined, values: g, format: (x) => num(x, 1) + '%' });
    }
  }
  const burn = m('net_burn');
  if (burn !== undefined) {
    const s = series(burn);
    tiles.push({ key: 'burn', label: 'Net burn', value: burn.latest !== null ? valueText('money', burn.latest.value, burn.latest.currency) + perPeriod(burn) : '', tip: 'Cash spent beyond revenue, the latest verified period.', when: burn.latest !== null ? periodLong(burn.latest.period_end) : '', values: s.values, status: s.status, format: chartFormat('money', burn.latest?.currency ?? k.report_currency) });
  }
  const cash = m('cash');
  if (cash !== undefined) {
    const s = series(cash);
    tiles.push({ key: 'cash', label: 'Cash', value: cash.latest !== null ? valueText('money', cash.latest.value, cash.latest.currency) : '', tip: 'Cash in the bank, the latest verified month end.', when: cash.latest !== null ? periodLong(cash.latest.period_end) : '', values: s.values, status: s.status, format: chartFormat('money', cash.latest?.currency ?? k.report_currency) });
  }
  const rw = k.runway;
  if (rw.state === 'not_burning') tiles.push({ key: 'runway', label: 'Runway', value: 'Not burning', tip: 'Revenue covers costs: no cash burned.', when: '', tone: 'good' });
  else if (rw.state === 'known' && rw.months !== null)
    tiles.push({ key: 'runway', label: 'Runway', value: num(rw.months, 1) + ' months', tip: 'Verified cash over the average net burn of the last three verified months. The red line is 6 months.' + (rw.zero_day !== null ? ' Cash runs out in ' + periodLong(rw.zero_day) + '.' : ''), when: rw.zero_day !== null ? 'to ' + periodLong(rw.zero_day) : '', tone: rw.months < 6 ? 'bad' : undefined, runway: rw.months });
  const hc = m('headcount');
  if (hc !== undefined && hc.latest !== null) {
    const s = series(hc);
    tiles.push({ key: 'hc', label: 'Headcount', value: num(hc.latest.value) + ' people', tip: 'People on the team, the latest verified month.', when: periodLong(hc.latest.period_end), values: s.values, status: s.status, format: (x) => num(x) + ' people' });
  }
  const shown = tiles.filter((t) => t.value !== '');
  if (shown.length === 0) return null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
      {shown.map((t) => (
        <Tile key={t.key} t={t} />
      ))}
    </div>
  );
}

function LatestUpdate({ v, onUpdate, onAdd, edit }: { v: CompanyView; onUpdate: (id: string) => void; onAdd: () => void; edit: boolean }): React.JSX.Element {
  const u = v.update;
  return (
    <Panel label="Latest update" aside={u !== null ? <span className="text-[12px] text-[var(--vo-muted)]">{fmtDay(u.received_at)}</span> : undefined} bodyClass="flex flex-col">
      {u === null ? (
        <Empty icon={Mail} title="Founder updates appear here" action={edit ? <Button icon={Plus} onClick={onAdd}>Add update</Button> : undefined} className="py-6" />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span data-data="" className="vo-wrap text-[13px] font-medium text-[var(--vo-ink)]">
              {u.subject !== '' ? u.subject : u.period_label !== '' ? u.period_label + ' update' : 'Founder update'}
            </span>
            {u.summary !== '' && (
              <p data-data="" className="vo-wrap line-clamp-4 text-[13px] leading-5 text-[var(--vo-ink-2)]">
                {u.summary}
              </p>
            )}
          </div>
          <div className="mt-auto flex min-w-0 flex-wrap items-center gap-2">
            {u.counts.staged > 0 ? <StatusDot tone="warn" label={u.counts.staged === 1 ? '1 figure to check' : u.counts.staged + ' figures to check'} /> : u.counts.verified > 0 ? <StatusDot tone="good" label={u.counts.verified === 1 ? '1 figure verified' : u.counts.verified + ' figures verified'} /> : null}
            <span className="flex-1" />
            <Button size="sm" onClick={() => onUpdate(u.id)}>
              Read the update
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

const ASK_KIND: Record<string, string> = { intro: 'Intro', hire: 'Hire', customer: 'Customer', fundraising: 'Fundraising', advice: 'Advice', other: 'Other' };

function OpenAsks({ v }: { v: CompanyView }): React.JSX.Element {
  const a = v.asks;
  const all = a.open + a.in_progress;
  return (
    <Panel label="Open asks" aside={all > 0 ? <LinkButton onClick={() => setQuery({ tab: 'asks', update: null })}>{all === 1 ? 'See the ask' : 'See all ' + all}</LinkButton> : undefined}>
      {a.items.length === 0 ? (
        <Empty icon={HandHelping} title="Founder asks appear here" action={<Button onClick={() => setQuery({ tab: 'asks', update: null })}>Open asks</Button>} className="py-6" />
      ) : (
        <ul data-data="" className="-mx-2 flex flex-col">
          {a.items.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => setQuery({ tab: 'asks', update: null })} className="vo-focus flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[var(--vo-radius-sm)] px-2 py-1 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                <span className="vo-wrap min-w-0 flex-1 text-[13px] text-[var(--vo-ink)]">{x.title}</span>
                {x.actor === 'agent' && <AgentTag />}
                <Tag tone={x.status === 'in_progress' ? 'a' : 'faint'}>{x.status === 'in_progress' ? 'In progress' : ASK_KIND[x.kind] ?? 'Open'}</Tag>
                {x.owner !== null && (
                  <span title={'Owner: ' + x.owner.name}>
                    <Avatar name={x.owner.name} size={20} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function NextBoard({ v }: { v: CompanyView }): React.JSX.Element {
  const b = v.next_board;
  const open = (): void => setQuery({ tab: 'board', update: null });
  return (
    <Panel label="Next board meeting" bodyClass="flex flex-col">
      {b === null ? (
        <Empty icon={Presentation} title="Board meetings appear here" action={<Button onClick={open}>Open board</Button>} className="py-6" />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)]">
              <CalendarClock size={16} strokeWidth={1.8} aria-hidden className="text-[var(--vo-ink-2)]" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span data-data="" className="vo-wrap text-[15px] font-medium leading-6 text-[var(--vo-ink)]">
                {fmtDay(b.day, { weekday: true }) + (b.time !== '' ? ', ' + b.time : '')}
              </span>
              <span className="vo-wrap text-[13px] text-[var(--vo-ink-2)]">{b.title + ' (' + (b.day === today() ? 'today' : relDay(b.day)) + ')'}</span>
            </span>
          </div>
          <div className="mt-auto flex min-w-0 flex-wrap items-center gap-2">
            {b.brief ? <StatusDot tone="good" label="Brief ready" /> : <StatusDot tone="faint" label="Your AI agent writes the brief 2 days before" />}
            <span className="flex-1" />
            <Button size="sm" onClick={open}>
              Open
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** News about the company (the markets module's news.list, scope company). */
function CompanyNews({ v }: { v: CompanyView }): React.JSX.Element {
  const [rows, setRows] = useState<NewsRow[] | null>(null);
  const [tick, setTick] = useState(0);
  useOnChange(['news'], () => setTick((t) => t + 1));
  useEffect(() => {
    let live = true;
    listNews('company', v.company.id, 6)
      .then((r) => live && setRows(r.items))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [v.company.id, tick]);
  return (
    <Panel label="News">
      {rows === null ? <Skeleton className="h-24 w-full" /> : rows.length === 0 ? <Empty icon={Newspaper} title={'News about ' + v.company.name + ' appears here'} className="py-6" /> : <NewsList items={rows} compact />}
    </Panel>
  );
}

const FILE_KIND: Record<PageFile['kind'], { label: string; icon: LucideIcon }> = {
  deck: { label: 'Deck', icon: FileText },
  board: { label: 'Board deck', icon: Presentation },
  update: { label: 'Founder update', icon: Mail },
  file: { label: 'File', icon: FolderOpen },
};

function Files({ v, onUpdate, onAdd, edit }: { v: CompanyView; onUpdate: (id: string) => void; onAdd: () => void; edit: boolean }): React.JSX.Element {
  const list = v.files;
  return (
    <Panel label="Files" aside={list.length > 0 ? <span className="text-[12px] text-[var(--vo-muted)]">{list.length === 1 ? '1 file' : list.length + ' files'}</span> : undefined}>
      {v.files.length === 0 ? (
        <Empty icon={FolderOpen} title="Decks and updates appear here" action={edit ? <Button icon={Plus} onClick={onAdd}>Add update</Button> : undefined} className="py-6" />
      ) : (
        <ul data-data="" className="vo-scroll -mx-2 flex max-h-[360px] flex-col overflow-y-auto">
          {list.map((f) => {
            const k = FILE_KIND[f.kind];
            const Icon = k.icon;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => (f.file !== '' ? openSource({ file: f.file, name: f.name }) : onUpdate(f.update))}
                  className="vo-focus grid min-h-9 w-full min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--vo-radius-sm)] px-2 py-1 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]"
                >
                  <Icon size={14} strokeWidth={1.8} aria-hidden className="text-[var(--vo-muted)]" />
                  <span className="flex min-w-0 flex-col">
                    <span className="vo-wrap text-[13px] text-[var(--vo-ink)]">{f.name}</span>
                    <span className="text-[12px] text-[var(--vo-muted)]">{k.label + (f.pages > 0 ? ', ' + f.pages + (f.pages === 1 ? ' page' : ' pages') : '')}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-[var(--vo-muted)]">{fmtDay(f.day, { year: 'auto' })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function Dashboard({ company, v, baseCurrency, edit, onAdd, onUpdate, onEditNumbers }: { company: string; v: CompanyView; baseCurrency: string; edit: boolean; onAdd: () => void; onUpdate: (id: string) => void; onEditNumbers?: (() => void) | undefined }): React.JSX.Element {
  const kpis = useOp<KpiList>('kpis.list', { company, currency: 'native' }, KPI_READS, { name: 'kpis.list', keep: true });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {kpis.data === null ? kpis.error === null && <Skeleton className="h-[118px] w-full" /> : <Tiles k={kpis.data} />}
      <div className="grid min-w-0 gap-3 lg:grid-cols-3">
        <LatestUpdate v={v} onUpdate={onUpdate} onAdd={onAdd} edit={edit} />
        <OpenAsks v={v} />
        <NextBoard v={v} />
      </div>
      <div id="company-files" className="grid min-w-0 scroll-mt-20 gap-3 lg:grid-cols-2">
        <Files v={v} onUpdate={onUpdate} onAdd={onAdd} edit={edit} />
        <CompanyNews v={v} />
      </div>
      <div className="flex min-w-0 flex-col gap-3 pt-2">
        <div className="flex min-h-8 min-w-0 items-center gap-2">
          <h3 className="vo-label min-w-0 flex-1">KPIs over time</h3>
          {onEditNumbers !== undefined && (
            <Button size="sm" icon={Table2} onClick={onEditNumbers} title="Add or correct the company's numbers, month by month">
              Edit numbers
            </Button>
          )}
        </div>
        <Overview company={company} baseCurrency={baseCurrency} onAdd={onAdd} strip={false} />
      </div>
    </div>
  );
}
