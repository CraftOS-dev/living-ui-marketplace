/**
 * Home: the business at a glance, shaped by the person's role. A greeting
 * with search and New; what needs them today; then cash, money owed both
 * ways, sales this month, profit, overdue invoices and bills due, the order
 * pipeline, stock to reorder, and their own leave, time and claims. Your AI
 * agent's card shows what it did today and takes a question. Until the
 * company is set up, a checklist leads the way.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlarmClock,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Clock,
  Factory,
  FileText,
  HandCoins,
  Inbox,
  Landmark,
  MessageCircleQuestion,
  Package,
  Plus,
  Receipt,
  Search,
  Send,
  ShoppingCart,
  Sparkles,
  Timer,
  Truck,
  Users,
} from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { AskAgent } from '../components/AskAgent.tsx';
import { AreaLine, Bars, PairBars, PairLegend, RankBars } from '../components/charts.tsx';
import { ProgressRing } from '../components/controls.tsx';
import { useCreate } from '../components/Create.tsx';
import { Donut } from '../components/Donut.tsx';
import type { DonutSlice } from '../components/Donut.tsx';
import { usePalette } from '../components/Palette.tsx';
import { Card, CardHeader, CircleButton, Empty, Figure, LoadError, PillButton, Skeleton, StatusPill, TextLink, Tile, softInput } from '../components/ui.tsx';
import { op } from '../lib/api.ts';
import { ago, dayLabel, monthLabel, shortDay } from '../lib/dates.ts';
import { money, pct, plural, qty } from '../lib/format.ts';
import { READS, useLive } from '../lib/live.ts';
import { can, useMe } from '../lib/me.ts';
import { navigate } from '../lib/router.ts';
import type { Page, Query } from '../lib/router.ts';
import type { Aging, HomeSummary } from '../lib/types/home.ts';
import type { PageProps } from '../routes.tsx';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/* --------------------------------------------------------------- needs */

interface NeedTile {
  key: string;
  label: string;
  icon: LucideIcon;
  page: Page;
  query?: Query | undefined;
  tone?: 'bad' | undefined;
}

const NEED_TILES: NeedTile[] = [
  { key: 'proposals', label: 'from your AI agent', icon: Sparkles, page: 'proposals' },
  { key: 'overdue', label: 'overdue invoices', icon: AlarmClock, page: 'invoices', query: { status: 'overdue' }, tone: 'bad' },
  { key: 'bills_due', label: 'bills due this week', icon: Receipt, page: 'bills', query: { status: 'unpaid' } },
  { key: 'bank', label: 'bank lines to match', icon: Landmark, page: 'banks' },
  { key: 'leave', label: 'leave requests', icon: CalendarDays, page: 'leave', query: { tab: 'team' } },
  { key: 'claims', label: 'expense claims', icon: HandCoins, page: 'claims', query: { tab: 'team' } },
  { key: 'timesheets', label: 'timesheets', icon: Timer, page: 'timesheets', query: { tab: 'team' } },
  { key: 'agent_drafts', label: 'drafts by your AI agent', icon: FileText, page: 'needs' },
  { key: 'inbox_failed', label: 'inbox files to check', icon: Inbox, page: 'inbox', tone: 'bad' },
];

function NeedsStrip({ counts }: { counts: Record<string, number> }): React.JSX.Element | null {
  const tiles = NEED_TILES.filter((t) => (counts[t.key] ?? 0) > 0);
  if (tiles.length === 0) {
    return (
      <div className="erp-rise flex items-center gap-3 rounded-[20px] bg-[var(--erp-card)] px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-[var(--erp-green)]/15 text-[var(--erp-green-text)]">
          <Check size={16} strokeWidth={2.6} aria-hidden />
        </span>
        <span className="text-[14px] font-semibold">Nothing needs you right now</span>
      </div>
    );
  }
  return (
    <section aria-label="Needs you" className="erp-rise">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[15px] font-bold">Needs you</h2>
        <TextLink tone="muted" onClick={() => navigate('needs')}>
          See all <ArrowRight size={13} aria-hidden />
        </TextLink>
      </div>
      <div className="erp-strip -mx-1 flex gap-2 relative overflow-x-auto px-1 pb-1">
        {tiles.map((t) => {
          const Icon = t.icon;
          const n = counts[t.key] ?? 0;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => navigate(t.page, t.query)}
              className="group flex min-w-[150px] shrink-0 items-center gap-3 rounded-[20px] bg-[var(--erp-card)] py-2.5 pl-2.5 pr-4 text-left transition-[transform,box-shadow] hover:shadow-[0_16px_32px_-24px_rgba(29,28,26,0.6)] active:scale-[0.98]"
            >
              <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', t.tone === 'bad' ? 'bg-[var(--erp-red)]/15 text-[var(--erp-red-text)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink)] group-hover:bg-[var(--erp-solid)] group-hover:text-[var(--erp-on-solid)]')}>
                <Icon size={17} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="num block text-[15px] font-extrabold leading-5">{qty(n)}</span>
                <span className="block truncate text-[12px] text-[var(--erp-muted)]">{t.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- setup */

const SETUP_LINK: Record<string, { page: Page; query?: Query }> = {
  company: { page: 'settings', query: { tab: 'company' } },
  banks: { page: 'banks' },
  parties: { page: 'customers' },
  items: { page: 'items' },
  opening: { page: 'settings', query: { tab: 'opening' } },
  people: { page: 'settings', query: { tab: 'team' } },
};

function SetupCard({ steps }: { steps: NonNullable<HomeSummary['setup']> }): React.JSX.Element {
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <Card tone="sand" delay={1}>
      <CardHeader title="Set up your company" subtitle={`${done} of ${steps.length} done. Your AI agent can do most of these in chat, too.`} action={<ProgressRing value={done / steps.length} size={52} />} />
      <ol className="grid grid-cols-1 gap-2 @min-[480px]:grid-cols-2 @min-[900px]:grid-cols-3">
        {steps.map((s, i) => {
          const link = SETUP_LINK[s.key] ?? { page: 'settings' as Page };
          const current = s === next;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => navigate(link.page, link.query)}
                className={cn('flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left transition-colors', current ? 'bg-[var(--erp-card)]' : 'bg-[var(--erp-card)]/60 hover:bg-[var(--erp-card)]')}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
                    s.done ? 'bg-[var(--erp-solid)] text-[var(--erp-on-solid)]' : current ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink-2)]',
                  )}
                >
                  {s.done ? <Check size={14} strokeWidth={3} aria-label="Done" /> : i + 1}
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-[14px] font-semibold', s.done && 'text-[var(--erp-muted)]')}>{s.label}</span>
                {current && <ArrowRight size={15} aria-hidden />}
              </button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ---------------------------------------------------------------- cash */

function CashCard({ cash, currency }: { cash: NonNullable<HomeSummary['cash']>; currency: string }): React.JSX.Element {
  const first = cash.series[0]?.balance ?? 0;
  const lastV = cash.series[cash.series.length - 1]?.balance ?? 0;
  const change = lastV - first;
  return (
    <Card tone="dark" delay={1}>
      <CardHeader
        title="Cash"
        dark
        subtitle="In your bank and cash accounts"
        action={<CircleButton icon={ArrowUpRight} label="Bank accounts" variant="onDark" size={36} onClick={() => navigate('banks')} />}
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{money(cash.total, currency)}</p>
          <p className="mt-1 text-[13px] text-[var(--erp-on-dark-muted)]">
            <span className={cn('num font-bold', change < 0 ? 'text-[var(--erp-red-text)]' : 'text-[var(--erp-on-dark)]')}>
              {change >= 0 ? '+' : ''}
              {money(change, currency)}
            </span>{' '}
            over 30 days
          </p>
        </div>
        {cash.unmatched > 0 && (
          <button type="button" onClick={() => navigate('banks')} className="rounded-full bg-[var(--erp-dark-2)] px-3 py-1.5 text-[12px] font-bold">
            {plural(cash.unmatched, 'line')} to match
          </button>
        )}
      </div>
      {cash.series.length > 1 && (
        <div className="mt-4">
          <AreaLine dark height={130} format={(n) => money(n, currency, 'short')} points={cash.series.map((p) => ({ key: p.date, label: dayLabel(p.date), value: p.balance, text: money(p.balance, currency) }))} />
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-2 @min-[480px]:grid-cols-2">
        {cash.banks.slice(0, 4).map((b) => (
          <button key={b.id} type="button" onClick={() => navigate('bank', { id: b.id })} className="flex items-center gap-3 rounded-[18px] bg-[var(--erp-dark-2)] p-3 text-left transition-transform active:scale-[0.98]">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] text-[var(--erp-on-dark-muted)]">{b.name}</span>
              <span className="num block truncate text-[15px] font-bold">{money(b.balance, b.currency)}</span>
            </span>
            {b.unmatched > 0 && <span className="num rounded-full bg-[var(--erp-accent)] px-2 text-[12px] font-bold text-[var(--erp-on-accent)]">{b.unmatched}</span>}
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- owed */

function agingSlices(a: Aging, currency: string): DonutSlice[] {
  const total = a.total || 1;
  const rows = [
    { key: 'current', label: 'Not due', value: a.current, fill: 'var(--erp-green)', text: 'var(--erp-on-green)' },
    { key: 'd30', label: '1 to 30 days', value: a.d30, fill: 'var(--erp-amber)', text: 'var(--erp-on-amber)' },
    { key: 'd60', label: '31 to 60 days', value: a.d60, fill: 'var(--erp-red)', text: 'var(--erp-on-red)' },
    { key: 'old', label: 'Over 60 days', value: a.d90 + a.over90, fill: 'var(--erp-ink)', text: 'var(--erp-shell)' },
  ];
  return rows.filter((r) => r.value > 0).map((r) => ({ ...r, amount: money(r.value, currency, 'short'), share: Math.round((r.value / total) * 100) }));
}

function OwedCard({ side, aging, currency, delay }: { side: 'in' | 'out'; aging: Aging; currency: string; delay: number }): React.JSX.Element {
  const title = side === 'in' ? 'Owed to you' : 'You owe';
  const page: Page = side === 'in' ? 'invoices' : 'bills';
  const slices = agingSlices(aging, currency);
  return (
    <Card delay={delay}>
      <CardHeader
        title={title}
        subtitle={aging.count === 0 ? 'Nothing open' : `${plural(aging.count, side === 'in' ? 'open invoice' : 'open bill')}`}
        action={<CircleButton icon={ArrowUpRight} label={side === 'in' ? 'Invoices' : 'Bills'} variant="row" size={36} onClick={() => navigate(page, { status: 'unpaid' })} />}
      />
      {aging.total === 0 ? (
        <Empty icon={BadgeCheck} title="All settled" compact />
      ) : (
        <div className="flex flex-col items-center gap-4">
          <Donut
            size={220}
            slices={slices}
            centerValue={money(aging.total, currency, 'short')}
            centerCaption={aging.overdue > 0 ? `${money(aging.overdue, currency, 'short')} overdue` : 'none overdue'}
            onPick={(key) => navigate(page, { status: key === 'current' ? 'unpaid' : 'overdue' })}
          />
          <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5">
            {[
              { k: 'Not due', v: aging.current, fill: 'var(--erp-green)' },
              { k: '1 to 30 days', v: aging.d30, fill: 'var(--erp-amber)' },
              { k: '31 to 60 days', v: aging.d60, fill: 'var(--erp-red)' },
              { k: 'Over 60 days', v: aging.d90 + aging.over90, fill: 'var(--erp-ink)' },
            ].map((r) => (
              <li key={r.k} className="flex items-center gap-2 text-[12px]">
                <span aria-hidden className="h-2 w-4 shrink-0 rounded-full" style={{ background: r.fill }} />
                <span className="min-w-0 flex-1 truncate text-[var(--erp-ink-2)]">{r.k}</span>
                <span className="num font-bold">{money(r.v, currency, 'short')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------- sales */

function SalesCard({ sales, currency }: { sales: NonNullable<HomeSummary['sales']>; currency: string }): React.JSX.Element {
  const base = sales.last_month_to_date;
  const delta = base !== 0 ? (sales.this_month - base) / Math.abs(base) : null;
  const todayKey = sales.days.filter((d) => !d.future).slice(-1)[0]?.date ?? '';
  return (
    <Card delay={2}>
      <CardHeader
        title="Sales this month"
        subtitle="Invoiced, before tax"
        action={<CircleButton icon={ArrowUpRight} label="Sales report" variant="row" size={36} onClick={() => navigate('report', { kind: 'sales' })} />}
      />
      <div className="mb-5 flex flex-wrap items-end gap-x-8 gap-y-3">
        <Figure label="So far" value={money(sales.this_month, currency)} />
        <Figure label="Last month by today" value={money(base, currency)} size="md" tone="muted" />
        {delta !== null && (
          <StatusPill tone={delta >= 0 ? 'good' : 'bad'}>
            {delta >= 0 ? 'Up' : 'Down'} {pct(Math.abs(delta))}
          </StatusPill>
        )}
      </div>
      <Bars
        height={150}
        format={(n) => money(n, currency, 'short')}
        points={sales.days.map((d) => ({
          key: d.date,
          label: dayLabel(d.date),
          axis: String(Number(d.date.slice(8, 10))),
          value: d.value,
          text: money(d.value, currency),
          muted: d.future,
          current: d.date === todayKey,
        }))}
        onPick={(day) => navigate('invoices', { from: day, to: day })}
      />
    </Card>
  );
}

/* -------------------------------------------------------------- profit */

function ProfitCard({ profit, currency }: { profit: NonNullable<HomeSummary['profit']>; currency: string }): React.JSX.Element {
  return (
    <Card delay={3}>
      <CardHeader
        title="Profit"
        subtitle="Income less expenses, by month"
        action={
          <div className="flex items-center gap-3">
            <span className="hidden @min-[480px]:block">
              <PairLegend a="Income" b="Expenses" />
            </span>
            <CircleButton icon={ArrowUpRight} label="Profit and loss" variant="row" size={36} onClick={() => navigate('report', { kind: 'pnl' })} />
          </div>
        }
      />
      <div className="mb-5 flex flex-wrap items-end gap-x-8 gap-y-3">
        <Figure label="This month so far" value={money(profit.net, currency)} tone={profit.net < 0 ? 'red' : 'ink'} />
        <Figure label="Last month" value={money(profit.last_net, currency)} size="md" tone={profit.last_net < 0 ? 'red' : 'muted'} />
      </div>
      <PairBars
        height={150}
        aName="Income"
        bName="Expenses"
        format={(n) => money(n, currency, 'short')}
        points={profit.months.map((m) => ({
          key: m.month,
          label: monthLabel(m.month),
          axis: monthLabel(m.month, true).slice(0, 3),
          a: Math.max(0, m.revenue),
          b: Math.max(0, m.revenue - m.net),
          aText: money(m.revenue, currency),
          bText: money(m.revenue - m.net, currency),
        }))}
        onPick={(m) => navigate('report', { kind: 'pnl', from: `${m}-01` })}
      />
    </Card>
  );
}

/* ------------------------------------------------------------ due lists */

function DueList({ title, rows, kind, empty, action, delay }: { title: string; rows: NonNullable<HomeSummary['overdue_invoices']>; kind: 'invoice' | 'bill'; empty: string; action?: React.ReactNode; delay: number }): React.JSX.Element {
  return (
    <Card delay={delay}>
      <CardHeader title={title} subtitle={rows.length === 0 ? empty : undefined} action={<CircleButton icon={ArrowUpRight} label={kind === 'invoice' ? 'Overdue invoices' : 'Bills to pay'} variant="row" size={36} onClick={() => navigate(kind === 'invoice' ? 'invoices' : 'bills', { status: kind === 'invoice' ? 'overdue' : 'unpaid' })} />} />
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {rows.slice(0, 4).map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => navigate('doc', { id: r.id })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--erp-row-hover)]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{r.party}</span>
                  <span className={cn('block truncate text-[12px]', kind === 'invoice' || r.days < 0 ? 'text-[var(--erp-red-text)]' : 'text-[var(--erp-muted)]')}>
                    {r.number} · {kind === 'invoice' ? `${plural(r.days, 'day')} late` : r.days < 0 ? `${plural(-r.days, 'day')} late` : r.days === 0 ? 'due today' : `due ${shortDay(r.due_date)}`}
                  </span>
                </span>
                <span className="num shrink-0 text-[13px] font-bold">{money(r.balance, r.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {action !== undefined && rows.length > 0 && <div className="mt-4">{action}</div>}
    </Card>
  );
}

/* ---------------------------------------------------------------- agent */

function AgentCard({ agent }: { agent: HomeSummary['agent'] }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const ask = async (): Promise<void> => {
    if (q.trim() === '') return;
    setBusy(true);
    try {
      await op('asks.create', { question: q.trim() });
      setQ('');
      toast.success('Asked. The answer comes back under Questions.');
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card tone="sand" delay={2}>
      <CardHeader title="Your AI agent" icon={Sparkles} subtitle={agent.today > 0 ? `${plural(agent.today, 'thing')} done today` : 'Nothing done yet today'} action={<CircleButton icon={ArrowUpRight} label="What it did" variant="light" size={36} onClick={() => navigate('agent-activity')} />} />
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Tile label="Waiting for you" value={plural(agent.proposals, 'proposal')} onClick={() => navigate('proposals')} className="bg-[var(--erp-card)] hover:bg-[var(--erp-card)]" />
        <Tile label="Files in the Inbox" value={qty(agent.inbox)} onClick={() => navigate('inbox')} className="bg-[var(--erp-card)] hover:bg-[var(--erp-card)]" />
      </div>
      {agent.recent.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {agent.recent.slice(0, 3).map((r, i) => (
            <li key={`${r.created}${i}`} className="flex items-start gap-2 text-[13px]">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--erp-ink)]" />
              <span className="min-w-0 flex-1">
                <span className="block leading-5">{r.summary}</span>
                <span className="block text-[12px] text-[var(--erp-muted)]">{ago(r.created)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <MessageCircleQuestion size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--erp-muted)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the business" aria-label="Ask your AI agent" className={cn(softInput, 'bg-[var(--erp-card)] pl-11 pr-12')} />
        <button type="submit" disabled={busy || q.trim() === ''} aria-label="Ask" className="erp-on-ink absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--erp-ink)] text-[var(--erp-shell)] disabled:opacity-40">
          {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Send size={14} />}
        </button>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------ pipeline */

function PipelineCard({ s, currency }: { s: HomeSummary; currency: string }): React.JSX.Element | null {
  const tiles: { label: string; value: string; sub: string; icon: LucideIcon; page: Page; query?: Query }[] = [];
  if (s.quotes_open !== undefined) tiles.push({ label: 'Open quotes', value: qty(s.quotes_open.n), sub: money(s.quotes_open.v, currency, 'short'), icon: FileText, page: 'quotes', query: { status: 'sent' } });
  if (s.orders_to_deliver !== undefined) tiles.push({ label: 'To deliver', value: qty(s.orders_to_deliver.n), sub: money(s.orders_to_deliver.v, currency, 'short'), icon: Truck, page: 'sales-orders', query: { status: 'to_fulfil' } });
  if (s.orders_to_receive !== undefined) tiles.push({ label: 'To receive', value: qty(s.orders_to_receive.n), sub: money(s.orders_to_receive.v, currency, 'short'), icon: ShoppingCart, page: 'purchase-orders', query: { status: 'to_fulfil' } });
  if (s.builds !== undefined) tiles.push({ label: 'Builds planned', value: qty(s.builds), sub: 'Drafts', icon: Factory, page: 'builds' });
  if (tiles.length === 0) return null;
  return (
    <Card delay={3}>
      <CardHeader title="In the pipeline" />
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.label} type="button" onClick={() => navigate(t.page, t.query)} className="flex flex-col gap-2 rounded-[18px] bg-[var(--erp-row)] p-3 text-left transition-colors hover:bg-[var(--erp-row-hover)]">
              <span className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--erp-muted)]">{t.label}</span>
                <Icon size={15} className="text-[var(--erp-ink-2)]" aria-hidden />
              </span>
              <span className="num text-[15px] font-bold">{t.value}</span>
              <span className="num text-[12px] text-[var(--erp-muted)]">{t.sub}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- stock */

function StockCard({ stock, currency }: { stock: NonNullable<HomeSummary['stock']>; currency: string }): React.JSX.Element {
  const low = (stock.counts['low'] ?? 0) + (stock.counts['out'] ?? 0);
  return (
    <Card delay={4}>
      <CardHeader title="Stock" subtitle={`${money(stock.value, currency)} at average cost`} action={<CircleButton icon={ArrowUpRight} label="Items" variant="row" size={36} onClick={() => navigate('items')} />} />
      {stock.reorder.length === 0 ? (
        <div className="flex items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-3 text-[13px]">
          <Package size={16} aria-hidden />
          <span className="font-semibold">Nothing to reorder</span>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {stock.reorder.slice(0, 4).map((it) => (
              <li key={it.id}>
                <button type="button" onClick={() => navigate('item', { id: it.id })} className="flex w-full items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-left hover:bg-[var(--erp-row-hover)]">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{it.name}</span>
                  <span className={cn('num shrink-0 text-[13px] font-bold', it.on_hand <= 0 && 'text-[var(--erp-red-text)]')}>
                    {qty(it.on_hand)} <span className="font-medium text-[var(--erp-muted)]">/ {qty(it.min_qty)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <PillButton size="sm" variant="soft" icon={ShoppingCart} onClick={() => navigate('reorder')}>
              Reorder {low > 0 ? plural(low, 'item') : ''}
            </PillButton>
            <AskAgent kind="reorder_review" label="Draft orders" size="sm" variant="light" />
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- me */

function MeCard({ me, currency, wide }: { me: NonNullable<HomeSummary['me']>; currency: string; wide: boolean }): React.JSX.Element {
  const annual = me.leave[0];
  const claimsOpen = me.claims.reduce((s, c) => s + c.n, 0);
  return (
    <Card delay={3}>
      <CardHeader title="You" subtitle={me.employee?.job_title !== undefined && me.employee.job_title !== '' ? me.employee.job_title : undefined} action={<CircleButton icon={Plus} label="Request leave" variant="row" size={36} onClick={() => navigate('leave', { new: '1' })} />} />
      <div className={cn('grid gap-4', wide ? '@min-[640px]:grid-cols-[auto_1fr]' : '')}>
        <div className="flex flex-wrap items-center gap-4">
          {me.leave.slice(0, wide ? 3 : 2).map((l) => (
            <button key={l.type} type="button" onClick={() => navigate('leave')} className="flex items-center gap-3 text-left">
              <ProgressRing value={l.entitled > 0 ? l.remaining / l.entitled : 0} size={56} tone={l.remaining <= 0 ? 'red' : 'accent'}>
                {qty(l.remaining)}
              </ProgressRing>
              <span>
                <span className="block text-[13px] font-bold">{l.type}</span>
                <span className="block text-[12px] text-[var(--erp-muted)]">
                  {qty(l.remaining)} of {qty(l.entitled)} days left{l.pending > 0 ? `, ${qty(l.pending)} waiting` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 @min-[480px]:grid-cols-3">
          <Tile label="Hours this week" value={qty(me.hours_this_week)} onClick={() => navigate('timesheets')} />
          <Tile label="Open claims" value={qty(claimsOpen)} onClick={() => navigate('claims')} />
          {me.latest_payslip !== null ? (
            <Tile label={`Pay, ${monthLabel(me.latest_payslip.month, true)}`} value={money(me.latest_payslip.net, currency)} onClick={() => navigate('payslip', { id: me.latest_payslip?.id ?? '' })} />
          ) : me.next_holiday !== null ? (
            <Tile label="Next holiday" value={shortDay(me.next_holiday.date)} />
          ) : (
            <Tile label="Team" value={me.team > 0 ? plural(me.team, 'person', 'people') : 'Just you'} onClick={me.team > 0 ? () => navigate('leave', { tab: 'team' }) : undefined} />
          )}
        </div>
      </div>
      {me.upcoming_leave.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {me.upcoming_leave.map((l) => (
            <li key={l.id} className="flex items-center gap-3 rounded-[16px] bg-[var(--erp-row)] px-3 py-2.5 text-[13px]">
              <CalendarDays size={15} aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {l.type}, {shortDay(l.start)}
                {l.end !== l.start ? ` to ${shortDay(l.end)}` : ''}
              </span>
              <StatusPill tone={l.status === 'approved' ? 'good' : 'warn'} size="sm">
                {l.status === 'approved' ? 'Approved' : 'Waiting'}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
      {annual === undefined && me.leave.length === 0 && <p className="mt-2 text-[13px] text-[var(--erp-muted)]">No leave types yet.</p>}
    </Card>
  );
}

/* -------------------------------------------------------------- the page */

export function HomePage({ query }: PageProps): React.JSX.Element {
  void query;
  const me = useMe();
  const palette = usePalette();
  const create = useCreate();
  const data = useLive(() => op<HomeSummary>('home.summary', {}, { quiet: true }), [...READS.docs, ...READS.books, ...READS.stock, ...READS.money, ...READS.people, ...READS.agent, 'projects', 'timesheets', 'builds', 'settings', 'audit', 'payslips'], []);
  const s = data.data;
  const cur = me.company.currency;
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const finance = s !== null && (s.cash !== undefined || s.receivables !== undefined || s.payables !== undefined || s.profit !== undefined || s.sales !== undefined);

  return (
    <div className="flex flex-col gap-5">
      <header className="erp-rise mb-1 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em]">
            {greeting()}, {firstName(me.member.name)}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--erp-muted)]">
            {dateLine}. Here is {me.company.name}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => palette.open()} className="hidden h-11 w-72 items-center gap-3 rounded-full bg-[var(--erp-card)] px-4 text-[14px] text-[var(--erp-muted)] hover:text-[var(--erp-ink)] @min-[900px]:flex">
            <Search size={16} aria-hidden />
            <span className="flex-1 text-left">Search anything</span>
          </button>
          <PillButton icon={Plus} dot onClick={(e) => create.open(e.currentTarget)} className="hidden @min-[640px]:inline-flex">
            New
          </PillButton>
        </div>
      </header>

      {data.error !== null && s === null && <LoadError message={data.error} onRetry={data.reload} />}

      {s === null && data.error === null && (
        <div className="flex flex-col gap-5">
          <div className="flex gap-2 overflow-hidden">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-44 shrink-0" rounded="rounded-[20px]" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
            <Skeleton className="h-[320px] @min-[900px]:col-span-8" rounded="rounded-[24px]" />
            <Skeleton className="h-[320px] @min-[900px]:col-span-4" rounded="rounded-[24px]" />
          </div>
        </div>
      )}

      {s !== null && (
        <>
          <NeedsStrip counts={s.needs} />
          {s.setup !== undefined && <SetupCard steps={s.setup} />}

          {finance ? (
            <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
              <div className="contents @min-[900px]:col-span-8 @min-[900px]:flex @min-[900px]:flex-col @min-[900px]:gap-5">
                {s.cash !== undefined && (
                  <div className="order-1 @min-[900px]:order-none">
                    <CashCard cash={s.cash} currency={cur} />
                  </div>
                )}
                {(s.receivables !== undefined || s.payables !== undefined) && (
                  <div className="order-2 grid grid-cols-1 gap-5 @min-[640px]:grid-cols-2 @min-[900px]:order-none">
                    {s.receivables !== undefined && <OwedCard side="in" aging={s.receivables} currency={cur} delay={2} />}
                    {s.payables !== undefined && <OwedCard side="out" aging={s.payables} currency={cur} delay={2} />}
                  </div>
                )}
                {s.sales !== undefined && (
                  <div className="order-4 @min-[900px]:order-none">
                    <SalesCard sales={s.sales} currency={cur} />
                  </div>
                )}
                {s.profit !== undefined && (
                  <div className="order-5 @min-[900px]:order-none">
                    <ProfitCard profit={s.profit} currency={cur} />
                  </div>
                )}
                {s.me !== undefined && (
                  <div className="order-9 @min-[900px]:order-none">
                    <MeCard me={s.me} currency={cur} wide />
                  </div>
                )}
              </div>
              <div className="contents @min-[900px]:col-span-4 @min-[900px]:flex @min-[900px]:flex-col @min-[900px]:gap-5">
                <div className="order-3 @min-[900px]:order-none">
                  <AgentCard agent={s.agent} />
                </div>
                {s.overdue_invoices !== undefined && (
                  <div className="order-6 @min-[900px]:order-none">
                    <DueList
                      title="Overdue invoices"
                      kind="invoice"
                      rows={s.overdue_invoices}
                      empty="Everyone has paid on time"
                      delay={3}
                      action={can(me, 'sales', 'edit') ? <AskAgent kind="collections_requested" label="Ask your AI agent to chase" size="sm" variant="light" align="start" /> : undefined}
                    />
                  </div>
                )}
                {s.bills_due !== undefined && (
                  <div className="order-7 @min-[900px]:order-none">
                    <DueList title="Bills due this week" kind="bill" rows={s.bills_due} empty="Nothing due this week" delay={3} />
                  </div>
                )}
                <div className="order-8 @min-[900px]:order-none">
                  <PipelineCard s={s} currency={cur} />
                </div>
                {s.stock !== undefined && (
                  <div className="order-10 @min-[900px]:order-none">
                    <StockCard stock={s.stock} currency={cur} />
                  </div>
                )}
                {s.projects !== undefined && (
                  <div className="order-11 @min-[900px]:order-none">
                    <Card delay={4}>
                      <CardHeader title="Projects" action={<CircleButton icon={ArrowUpRight} label="Projects" variant="row" size={36} onClick={() => navigate('projects')} />} />
                      <div className="grid grid-cols-2 gap-2">
                        <Tile label="Active" value={qty(s.projects.active)} onClick={() => navigate('projects')} />
                        <Tile label="Hours this month" value={qty(s.projects.hours_this_month)} onClick={() => navigate('timesheets')} />
                      </div>
                    </Card>
                  </div>
                )}
                {s.top_customers !== undefined && s.top_customers.length > 0 && (
                  <div className="order-12 @min-[900px]:order-none">
                    <Card delay={5}>
                      <CardHeader title="Best customers" subtitle="Last 3 months" action={<Users size={16} className="text-[var(--erp-muted)]" aria-hidden />} />
                      <RankBars rows={s.top_customers.map((c) => ({ key: c.id, label: c.name, value: c.value, valueText: money(c.value, cur, 'short'), onClick: () => navigate('party', { id: c.id, role: 'customer' }) }))} />
                    </Card>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
              <div className="flex flex-col gap-5 @min-[900px]:col-span-8">
                {s.me !== undefined ? (
                  <MeCard me={s.me} currency={cur} wide />
                ) : (
                  <Card>
                    <Empty icon={Clock} title="Welcome">
                      Your role shows what is shared with you here.
                    </Empty>
                  </Card>
                )}
                {s.stock !== undefined && <StockCard stock={s.stock} currency={cur} />}
                {s.projects !== undefined && (
                  <Card delay={4}>
                    <CardHeader title="Projects" />
                    <div className="grid grid-cols-2 gap-2">
                      <Tile label="Active" value={qty(s.projects.active)} onClick={() => navigate('projects')} />
                      <Tile label="Hours this month" value={qty(s.projects.hours_this_month)} onClick={() => navigate('timesheets')} />
                    </div>
                  </Card>
                )}
              </div>
              <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
                <AgentCard agent={s.agent} />
                <PipelineCard s={s} currency={cur} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
