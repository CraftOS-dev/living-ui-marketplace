/**
 * Home: the books at a glance. Headline numbers against the period before,
 * the cash balance over time, money in and out by month, where money went,
 * who owes what, what is due, account trends, budgets, what needs the
 * person, and what the AI agent did. Every panel opens where the work is.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownLeft, ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, BellDot, CalendarClock, ChartColumn, ChartPie, CircleCheck, CreditCard, FileInput, FileOutput, FileText, HandCoins, Hourglass, Inbox, Landmark, PiggyBank, Repeat, Scale, Sparkles, Target, TrendingDown, TrendingUp, Undo2, Wallet } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { ago, compact, day, money, monthName } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import type { View } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Dashboard } from '../lib/types.ts';
import { AGE_BUCKETS, AreaChart, BarChart, CAT, CountUp, Donut, HBars, Legend, Meter, Sparkline } from '../components/charts.tsx';
import { Btn, Seg, Spinner, useConfirm } from '../components/ui.tsx';

type Range = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'last_12_months';

const RANGE_LABEL: Record<Range, string> = { this_month: 'This month', last_month: 'Last month', this_quarter: 'This quarter', ytd: 'Year to date', last_12_months: '12 months' };
const PREV_LABEL: Record<Range, string> = { this_month: 'vs same days last month', last_month: 'vs the month before', this_quarter: 'vs last quarter', ytd: 'vs last year', last_12_months: 'vs the 12 months before' };

function pct(now: number, before: number): number | null {
  if (before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

function Delta({ now, before, good = 'up', label }: { now: number; before: number; good?: 'up' | 'down' | undefined; label: string }): React.JSX.Element {
  const p = pct(now, before);
  if (p === null || !isFinite(p)) return <span className="text-[11.5px] text-[var(--lf-muted)]">{label}</span>;
  const up = p >= 0;
  const positive = good === 'up' ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11.5px]">
      <span className={cn('inline-flex items-center gap-0.5 rounded-[4px] px-1 font-bold', Math.abs(p) < 0.5 ? 'bg-[var(--lf-row)] text-[var(--lf-ink-2)]' : positive ? 'bg-[var(--lf-pos-soft)] text-[var(--lf-pos-text)]' : 'bg-[var(--lf-neg-soft)] text-[var(--lf-neg-text)]')}>
        <Icon size={11} strokeWidth={2.6} />
        <span className="num">{Math.abs(p) >= 1000 ? '999+' : Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}%</span>
      </span>
      <span className="truncate text-[var(--lf-muted)]">{label}</span>
    </span>
  );
}

function MiniBars({ values, color }: { values: number[]; color: string }): React.JSX.Element {
  const max = Math.max(1, ...values);
  return (
    <span className="flex h-[26px] shrink-0 items-end gap-[3px]" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className="lf-grow-y w-[5px] rounded-t-[1.5px]" style={{ height: `${Math.max(2, (v / max) * 26)}px`, background: color, opacity: i === values.length - 1 ? 1 : 0.45, animationDelay: `${i * 45}ms` }} />
      ))}
    </span>
  );
}

function Kpi({ icon: Icon, label, value, sub, viz, onClick, tone = 'none' }: { icon: LucideIcon; label: string; value: ReactNode; sub: ReactNode; viz?: ReactNode | undefined; onClick?: (() => void) | undefined; tone?: 'none' | 'neg' | 'pos' | undefined }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 flex-col gap-1.5 bg-[var(--lf-card)] px-4 py-3 text-left transition-colors hover:bg-[var(--lf-row)]">
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-[var(--lf-muted)]">
          <Icon size={13} strokeWidth={2.1} className="shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <ArrowRight size={12} className="shrink-0 -translate-x-1 text-[var(--lf-muted)] opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100" />
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className={cn('num shrink-0 text-[21px] font-bold leading-[26px] tracking-[-0.01em]', tone === 'neg' && 'text-[var(--lf-neg-text)]', tone === 'pos' && 'text-[var(--lf-pos-text)]')}>{value}</span>
        {viz !== undefined && <span className="hidden min-w-0 justify-end overflow-hidden sm:flex">{viz}</span>}
      </span>
      <span className="min-h-[18px]">{sub}</span>
    </button>
  );
}

function Panel({ icon: Icon, accent = false, title, sub, action, children, className, bodyClass, delay = 0 }: { icon: LucideIcon; accent?: boolean | undefined; title: string; sub?: ReactNode | undefined; action?: ReactNode | undefined; children: ReactNode; className?: string | undefined; bodyClass?: string | undefined; delay?: number | undefined }): React.JSX.Element {
  return (
    <section className={cn('flex min-w-0 flex-col bg-[var(--lf-card)]', className)}>
      <header className="flex h-10 shrink-0 items-center gap-2 px-4">
        <Icon size={14} strokeWidth={2.1} className={cn('shrink-0', accent ? 'text-[var(--lf-accent-text)]' : 'text-[var(--lf-ink-2)]')} />
        <h2 className="truncate text-[13px] font-bold">{title}</h2>
        {sub !== undefined && <span className="hidden truncate text-[12px] text-[var(--lf-muted)] sm:inline">{sub}</span>}
        <span className="flex-1" />
        {action}
      </header>
      <div className={cn('lf-rise min-h-0 flex-1 px-4 pb-4', bodyClass)} style={{ animationDelay: `${delay}ms` }}>
        {children}
      </div>
    </section>
  );
}

function Open({ view, q, label = 'Open' }: { view: View; q?: Record<string, string> | undefined; label?: string | undefined }): React.JSX.Element {
  return (
    <button type="button" onClick={() => go(view, q ?? {})} className="group inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[var(--lf-ink-2)] hover:text-[var(--lf-ink)]">
      {label} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function Attention({ d }: { d: Dashboard }): React.JSX.Element {
  const k = d.kpi;
  const mix = d.inbox.mix;
  const rows: { icon: LucideIcon; text: ReactNode; go: () => void; tone?: 'neg' | 'accent' | undefined; extra?: ReactNode }[] = [];
  if (d.inbox.total > 0)
    rows.push({
      icon: Inbox,
      text: (
        <>
          <b className="num">{d.inbox.total}</b> bank line{d.inbox.total === 1 ? '' : 's'} to review
        </>
      ),
      go: () => go('inbox'),
      extra: (
        <Meter
          count
          width={88}
          className="mt-1.5"
          items={[
            { label: 'AI proposals', value: mix.agent, color: 'var(--lf-accent)' },
            { label: 'by rules', value: mix.rule, color: 'var(--lf-ink-2)' },
            { label: 'matched', value: mix.match, color: 'var(--lf-c2)' },
            { label: 'like before', value: mix.memory, color: 'var(--lf-c1)' },
            { label: 'need a category', value: mix.none + mix.ai_working, color: 'var(--lf-line)' },
          ]}
        />
      ),
    });
  if (k.overdue_count > 0)
    rows.push({
      icon: FileOutput,
      tone: 'neg',
      text: (
        <>
          <b className="num">{k.overdue_count}</b> invoice{k.overdue_count === 1 ? '' : 's'} overdue, <b className="num">{money(k.overdue, d.currency)}</b>
        </>
      ),
      go: () => go('sales', { state: 'overdue' }),
    });
  if (k.payables_due_7 > 0)
    rows.push({
      icon: FileInput,
      text: (
        <>
          <b className="num">{money(k.payables_due_7, d.currency)}</b> due to suppliers within a week
        </>
      ),
      go: () => go('purchases', { state: 'unpaid' }),
    });
  if (d.inbox.proposed > 0)
    rows.push({
      icon: Sparkles,
      tone: 'accent',
      text: (
        <>
          <b className="num">{d.inbox.proposed}</b> entr{d.inbox.proposed === 1 ? 'y' : 'ies'} waiting for your approval
        </>
      ),
      go: () => go('ledger', { status: 'proposed' }),
    });
  if (d.inbox.files > 0)
    rows.push({
      icon: FileText,
      text: (
        <>
          <b className="num">{d.inbox.files}</b> receipt{d.inbox.files === 1 ? '' : 's'} to file
        </>
      ),
      go: () => go('inbox', { tab: 'files' }),
    });
  const behind = d.reconcile.filter((r) => r.through === '' || r.through < d.today.slice(0, 8) + '01');
  if (behind.length > 0)
    rows.push({
      icon: Scale,
      text: (
        <>
          <b className="num">{behind.length}</b> account{behind.length === 1 ? '' : 's'} to reconcile: {behind.map((b) => b.name).join(', ')}
        </>
      ),
      go: () => go('reconcile', { account: behind[0]!.id }),
    });
  if (rows.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
        <CircleCheck size={22} className="text-[var(--lf-pos)]" />
        <p className="text-[13px] font-semibold">All caught up</p>
        <p className="text-[12px] text-[var(--lf-muted)]">Nothing to review, chase or reconcile.</p>
      </div>
    );
  return (
    <ul className="-mx-4">
      {rows.map((r, i) => {
        const Icon = r.icon;
        return (
          <li key={i}>
            <button type="button" onClick={r.go} className="group flex w-full items-start gap-3 border-t border-[var(--lf-hair)] px-4 py-2.5 text-left transition-colors hover:bg-[var(--lf-row)]">
              <span className={cn('mt-px flex size-6 shrink-0 items-center justify-center rounded-[5px]', r.tone === 'neg' ? 'bg-[var(--lf-neg-soft)] text-[var(--lf-neg-text)]' : r.tone === 'accent' ? 'bg-[var(--lf-accent-soft)] text-[var(--lf-accent-text)]' : 'bg-[var(--lf-row-hover)] text-[var(--lf-ink-2)]')}>
                <Icon size={13} strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-[18px]">
                {r.text}
                {r.extra}
              </span>
              <ArrowRight size={13} className="mt-1 shrink-0 -translate-x-1 text-[var(--lf-muted)] opacity-0 transition-[opacity,transform] group-hover:translate-x-0 group-hover:opacity-100" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Categories({ d }: { d: Dashboard }): React.JSX.Element {
  const [which, setWhich] = useState<'spending' | 'earning'>('spending');
  const data = which === 'spending' ? d.spending : d.earning;
  const items = data.items.map((x, i) => ({ ...x, color: x.account === '' ? 'var(--lf-line)' : CAT(i) }));
  return (
    <Panel
      icon={ChartPie}
      delay={120}
      title={which === 'spending' ? 'Where money went' : 'Where money came from'}
      sub={RANGE_LABEL[d.range.name as Range]}
      className="xl:col-span-5"
      action={
        <Seg
          size="xs"
          value={which}
          onChange={setWhich}
          options={[
            { value: 'spending', label: 'Out' },
            { value: 'earning', label: 'In' },
          ]}
        />
      }
    >
      {items.length === 0 ? (
        <p className="py-10 text-center text-[12.5px] text-[var(--lf-muted)]">{which === 'spending' ? 'No spending booked in this period yet.' : 'No income booked in this period yet.'}</p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <Donut items={items.map((x) => ({ label: x.name, value: x.value, color: x.color }))} currency={d.currency} center={{ label: which === 'spending' ? 'Spent' : 'Earned', value: compact(data.total, d.currency) }} />
          <ul className="flex w-full min-w-0 flex-col">
            {items.map((x) => (
              <li key={x.name}>
                <button type="button" disabled={x.account === ''} onClick={() => go('ledger', { account: x.account })} className="flex w-full items-center gap-2 rounded-[4px] py-[5px] text-left text-[12.5px] hover:bg-[var(--lf-row)] disabled:hover:bg-transparent">
                  <span className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: x.color }} />
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <span className="num w-[42px] shrink-0 text-right text-[11.5px] text-[var(--lf-muted)]">{(x.share * 100).toFixed(0)}%</span>
                  <span className="num w-[86px] shrink-0 text-right font-semibold">{money(x.value, d.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function AiPanel({ d }: { d: Dashboard }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const run = d.runs[0];
  const agentWaiting = d.inbox.mix.agent;
  return (
    <Panel icon={Sparkles} accent delay={320} title="Your AI agent" className="xl:col-span-6" action={<Open view="activity" q={{ tab: 'runs' }} label="All runs" />}>
      {confirmEl}
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[6px] border border-[var(--lf-line)] bg-[var(--lf-line)]">
        {[
          { n: agentWaiting, l: 'proposals to review', go: () => go('inbox', { status: 'ai' }) },
          { n: d.inbox.proposed, l: 'entries to approve', go: () => go('ledger', { status: 'proposed' }) },
          { n: run?.changes ?? 0, l: 'changes in its last run', go: () => (run ? go('activity', { run: run.run }) : go('activity')) },
        ].map((x) => (
          <button key={x.l} type="button" onClick={x.go} className="flex flex-col items-start bg-[var(--lf-card)] px-3 py-2 text-left hover:bg-[var(--lf-row)]">
            <span className="num text-[18px] font-bold leading-6 text-[var(--lf-accent-text)]">{x.n}</span>
            <span className="text-[11.5px] text-[var(--lf-muted)]">{x.l}</span>
          </button>
        ))}
      </div>
      {run !== undefined ? (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-[12px]">
            <Sparkles size={12} className="text-[var(--lf-accent-text)]" />
            <span className="font-semibold">Last run {ago(run.last)}</span>
            <span className="flex-1" />
            {run.undone < run.changes && (
              <Btn
                size="xs"
                variant="ghost"
                icon={Undo2}
                onClick={() =>
                  void confirm('Every change in this run is undone, newest first; changes made since to the same records are skipped.', 'Revert this AI run?', 'Revert').then((ok) => {
                    if (ok)
                      api
                        .revertRun(run.run)
                        .then((x) => toast.success('Reverted ' + x.reverted))
                        .catch((err: unknown) => toast.error(errMessage(err)));
                  })
                }
              >
                Revert
              </Btn>
            )}
          </div>
          <ul className="mt-1.5 flex flex-col">
            {run.summaries.slice(0, 5).map((s, i) => (
              <li key={i} className="truncate border-t border-[var(--lf-hair)] py-1.5 text-[12px] text-[var(--lf-ink-2)]">
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] text-[var(--lf-muted)]">When your AI agent categorizes lines, reads receipts or prepares a close, its work shows here.</p>
      )}
    </Panel>
  );
}

export function HomeView(): React.JSX.Element {
  const app = useApp();
  const [range, setRange] = useState<Range>('this_month');
  const live = useLive(() => api.dashboard(range), ['postings', 'transactions', 'statement_lines', 'documents', 'allocations', 'files', 'budgets', 'reconciliations', 'activity', 'recurring'], [range], 700);
  useReportScreen('home', null, { range });
  const d = live.data;
  const months = useMemo(() => {
    if (d === null) return [];
    const first = d.months.findIndex((m) => m.income !== 0 || m.expense !== 0);
    return first < 0 ? d.months.slice(-6) : d.months.slice(Math.min(first, d.months.length - 3));
  }, [d]);

  if (d === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} />
      </div>
    );

  const k = d.kpi;
  const ccy = d.currency;
  const personal = d.entity === 'personal';
  const r = d.range;
  const prevLabel = PREV_LABEL[range];
  const cash60 = d.cash.slice(-60).map((p) => p.value);
  const last6 = months.slice(-6);
  const totalAged = d.aged.receivables['total'] ?? 0;
  const cashChange = d.cash.length > 1 ? d.cash[d.cash.length - 1]!.value - d.cash[0]!.value : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-11 flex-wrap items-center gap-3 border-b border-[var(--lf-line)] px-4 py-1.5">
        <div className="min-w-0">
          <p className="text-[14px] font-bold leading-5">{app.settings?.business_name || 'Your books'}</p>
          <p className="text-[11.5px] text-[var(--lf-muted)]">
            {day(r.from)} – {day(r.to)}
          </p>
        </div>
        <span className="flex-1" />
        <Seg
          value={range}
          onChange={setRange}
          options={(Object.keys(RANGE_LABEL) as Range[]).map((x) => ({ value: x, label: RANGE_LABEL[x] }))}
        />
      </div>

      <div className={cn('grid grid-cols-2 gap-px border-b border-[var(--lf-line)] bg-[var(--lf-line)] md:grid-cols-3 xl:grid-cols-6', live.loading && 'opacity-80')}>
        <Kpi
          icon={Landmark}
          label="Cash in the bank"
          value={<CountUp value={k.cash} format={(v) => money(v, ccy)} />}
          viz={<Sparkline values={cash60} color="var(--lf-accent)" width={64} />}
          sub={<Delta now={k.cash} before={k.cash_30} label="vs 30 days ago" />}
          onClick={() => go('reports', { r: 'cashflow' })}
        />
        <Kpi icon={ArrowDownLeft} label="Money in" value={<CountUp value={k.income} format={(v) => money(v, ccy)} />} viz={<MiniBars values={last6.map((m) => m.income)} color="var(--lf-pos)" />} sub={<Delta now={k.income} before={k.income_prev} label={prevLabel} />} onClick={() => go('reports', { r: 'pnl' })} />
        <Kpi icon={ArrowUpRight} label="Money out" value={<CountUp value={k.expense} format={(v) => money(v, ccy)} />} viz={<MiniBars values={last6.map((m) => m.expense)} color="var(--lf-neg)" />} sub={<Delta now={k.expense} before={k.expense_prev} good="down" label={prevLabel} />} onClick={() => go('reports', { r: 'spending' })} />
        <Kpi icon={k.net < 0 ? TrendingDown : TrendingUp} label={personal ? 'Saved' : 'Net profit'} value={<CountUp value={k.net} format={(v) => money(v, ccy)} />} tone={k.net < 0 ? 'neg' : 'none'} sub={<Delta now={k.net} before={k.net_prev} label={prevLabel} />} onClick={() => go('reports', { r: 'pnl' })} />
        {personal ? (
          <Kpi icon={CreditCard} label="Owed on cards" value={<CountUp value={k.cards} format={(v) => money(v, ccy)} />} sub={<span className="text-[11.5px] text-[var(--lf-muted)]">across your credit cards</span>} onClick={() => go('ledger')} />
        ) : (
          <Kpi
            icon={HandCoins}
            label="Customers owe you"
            value={<CountUp value={k.receivables} format={(v) => money(v, ccy)} />}
            sub={k.overdue > 0 ? <span className="num text-[11.5px] font-semibold text-[var(--lf-neg-text)]">{money(k.overdue, ccy)} overdue</span> : <span className="text-[11.5px] text-[var(--lf-muted)]">nothing overdue</span>}
            onClick={() => go('sales', { state: k.overdue > 0 ? 'overdue' : 'unpaid' })}
          />
        )}
        {personal || k.runway_months === null ? (
          <Kpi icon={PiggyBank} label="Savings rate" value={k.savings_rate === null ? '–' : <CountUp value={Math.round(k.savings_rate)} format={(v) => v + '%'} />} sub={<span className="text-[11.5px] text-[var(--lf-muted)]">of money in, kept</span>} onClick={() => go('reports', { r: 'pnl' })} />
        ) : (
          <Kpi
            icon={Hourglass}
            label="Runway"
            value={k.runway_months >= 99 ? '99+ mo' : <CountUp value={Math.round(k.runway_months * 10)} format={(v) => (v / 10).toFixed(1) + ' mo'} />}
            sub={<span className="num text-[11.5px] text-[var(--lf-muted)]">at {money(k.avg_monthly_expense, ccy)} a month</span>}
            onClick={() => go('reports', { r: 'cashflow' })}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-px bg-[var(--lf-line)] xl:grid-cols-12">
        <Panel
          icon={Landmark}
          title="Cash balance"
          sub="Bank and cash accounts"
          className="xl:col-span-8"
          action={
            <span className="flex items-center gap-2 text-[12px]">
              <span className="num font-semibold">{money(k.cash, ccy)}</span>
              <span className={cn('num', cashChange >= 0 ? 'text-[var(--lf-pos-text)]' : 'text-[var(--lf-neg-text)]')}>
                {money(cashChange, ccy, { sign: true })} since {day(d.cash[0]?.date ?? d.today, true)}
              </span>
            </span>
          }
        >
          <AreaChart points={d.cash} currency={ccy} height={236} label="Cash balance" />
        </Panel>
        <Panel icon={BellDot} delay={40} title="Needs your attention" className="xl:col-span-4">
          <Attention d={d} />
        </Panel>

        <Panel
          icon={ChartColumn}
          delay={80}
          title="Money in and out"
          sub="By month"
          className="xl:col-span-7"
          action={
            <Legend
              series={[
                { key: 'income', label: 'In', color: 'var(--lf-pos)' },
                { key: 'expense', label: 'Out', color: 'var(--lf-neg)' },
                { key: 'net', label: personal ? 'Saved' : 'Profit', color: 'var(--lf-ink)' },
              ]}
            />
          }
        >
          <BarChart
            height={232}
            currency={ccy}
            groups={months.map((m) => ({ label: monthName(m.month).slice(0, 3), title: monthName(m.month), values: { income: m.income, expense: m.expense, net: m.net } }))}
            series={[
              { key: 'income', label: 'Money in', color: 'var(--lf-pos)' },
              { key: 'expense', label: 'Money out', color: 'var(--lf-neg)' },
            ]}
            line={{ key: 'net', label: personal ? 'Saved' : 'Profit', color: 'var(--lf-ink)' }}
          />
        </Panel>
        <Categories d={d} />

        {!personal && (
          <Panel icon={HandCoins} delay={160} title="Who owes you" sub={money(totalAged, ccy)} className="xl:col-span-4" action={<Open view="reports" q={{ r: 'ar' }} label="Aging" />}>
            {totalAged === 0 ? (
              <p className="py-6 text-[12.5px] text-[var(--lf-muted)]">No open invoices.</p>
            ) : (
              <>
                <HBars currency={ccy} labelWidth={64} items={AGE_BUCKETS.map((b) => ({ label: b.label, value: d.aged.receivables[b.key] ?? 0, color: b.color }))} />
                <ul className="mt-2 flex flex-col">
                  {d.aged.debtors.map((x) => (
                    <li key={x.contact} className="flex items-center gap-2 border-t border-[var(--lf-hair)] py-1.5 text-[12.5px]">
                      <span className="min-w-0 flex-1 truncate">{x.name}</span>
                      {x.late > 0 && <span className="num text-[11.5px] font-semibold text-[var(--lf-neg-text)]">{compact(x.late, ccy)} late</span>}
                      <span className="num w-[90px] text-right font-semibold">{money(x.total, ccy)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        )}
        <Panel icon={CalendarClock} delay={200} title="Coming up" sub="Next two weeks" className={personal ? 'xl:col-span-6' : 'xl:col-span-4'}>
          {d.due.length === 0 && d.recurring.length === 0 ? (
            <p className="py-6 text-[12.5px] text-[var(--lf-muted)]">Nothing due in the next two weeks.</p>
          ) : (
            <ul className="flex flex-col">
              {d.due.map((x) => {
                const late = x.days > 0;
                return (
                  <li key={x.id}>
                    <button type="button" onClick={() => go(x.kind === 'bill' ? 'purchases' : 'sales', { doc: x.id })} className="flex w-full items-center gap-2.5 border-t border-[var(--lf-hair)] py-1.5 text-left text-[12.5px] first:border-t-0 hover:bg-[var(--lf-row)]">
                      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-[5px]', x.kind === 'bill' ? 'bg-[var(--lf-row-hover)] text-[var(--lf-ink-2)]' : 'bg-[var(--lf-pos-soft)] text-[var(--lf-pos-text)]')}>
                        {x.kind === 'bill' ? <FileInput size={12} /> : <FileOutput size={12} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{x.contact}</span>
                        <span className={cn('block text-[11px]', late ? 'font-semibold text-[var(--lf-neg-text)]' : 'text-[var(--lf-muted)]')}>
                          {x.number} · {late ? x.days + ' days late' : x.days === 0 ? 'due today' : 'due in ' + -x.days + ' days'}
                        </span>
                      </span>
                      <span className={cn('num font-semibold', x.kind === 'invoice' && 'text-[var(--lf-pos-text)]')}>
                        {x.kind === 'invoice' ? '+' : '−'}
                        {money(x.open, x.currency)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {d.recurring.map((x) => (
                <li key={x.id} className="flex items-center gap-2.5 border-t border-[var(--lf-hair)] py-1.5 text-[12.5px]">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-[var(--lf-row-hover)] text-[var(--lf-ink-2)]">
                    <Repeat size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{x.name}</span>
                    <span className="block text-[11px] text-[var(--lf-muted)]">Recurring {x.kind === 'transaction' ? 'entry' : x.kind}</span>
                  </span>
                  <span className="num text-[12px] text-[var(--lf-ink-2)]">{day(x.next_date, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel icon={Wallet} delay={240} title="Accounts" sub="Last 30 days" className={personal ? 'xl:col-span-6' : 'xl:col-span-4'} action={<Open view="ledger" />}>
          <ul className="flex flex-col">
            {d.accounts.map((a) => {
              const first = a.series[0] ?? 0;
              const last = a.series[a.series.length - 1] ?? 0;
              const Icon = a.subtype === 'card' ? CreditCard : a.subtype === 'cash' ? Banknote : Landmark;
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => go('ledger', { account: a.id })} className="flex w-full items-center gap-2.5 border-t border-[var(--lf-hair)] py-2 text-left first:border-t-0 hover:bg-[var(--lf-row)]">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-[var(--lf-row-hover)] text-[var(--lf-ink-2)]">
                      <Icon size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold">{a.name}</span>
                        {a.inbox > 0 && <span className="num rounded-[4px] bg-[var(--lf-ink)] px-1 text-[10px] font-bold leading-[14px] text-[var(--lf-card)]">{a.inbox}</span>}
                      </span>
                      <span className="text-[11px] text-[var(--lf-muted)]">{a.subtype === 'card' ? 'Owed' : a.subtype === 'cash' ? 'Cash' : 'Bank'}</span>
                    </span>
                    <Sparkline values={a.series} width={72} height={22} color={a.subtype === 'card' ? 'var(--lf-neg)' : last >= first ? 'var(--lf-pos)' : 'var(--lf-ink-2)'} />
                    <span className="num w-[96px] shrink-0 text-right text-[12.5px] font-semibold">{money(a.balance, a.currency)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel icon={Target} delay={280} title="Budgets this month" className="xl:col-span-6" action={<Open view="reports" q={{ r: 'budget' }} label="Budget vs actual" />}>
          {d.budgets.length === 0 ? (
            <div className="flex items-center gap-3 py-4">
              <p className="flex-1 text-[12.5px] text-[var(--lf-muted)]">Set monthly budgets for the categories you watch and see them fill up here.</p>
              <Btn size="sm" onClick={() => go('reports', { r: 'budget' })}>
                Set budgets
              </Btn>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5 pt-1">
              {d.budgets.map((b, i) => {
                const used = b.budget > 0 ? b.actual / b.budget : 0;
                const over = b.type === 'expense' && used > 1;
                return (
                  <li key={b.account}>
                    <button type="button" onClick={() => go('ledger', { account: b.account })} className="block w-full text-left">
                      <span className="flex items-baseline gap-2 text-[12.5px]">
                        <span className="min-w-0 flex-1 truncate font-semibold">{b.name}</span>
                        <span className={cn('num text-[12px]', over ? 'font-bold text-[var(--lf-neg-text)]' : 'text-[var(--lf-ink-2)]')}>
                          {money(b.actual, ccy)} <span className="text-[var(--lf-muted)]">of {money(b.budget, ccy)}</span>
                        </span>
                      </span>
                      <span className="mt-1 block h-[7px] w-full overflow-hidden rounded-full bg-[var(--lf-row-hover)]">
                        <span className="lf-grow-x block h-full rounded-full transition-[width]" style={{ width: `${Math.min(100, used * 100)}%`, background: over ? 'var(--lf-neg)' : used > 0.85 ? 'var(--lf-warn)' : 'var(--lf-pos)', animationDelay: `${300 + i * 50}ms` }} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <AiPanel d={d} />
      </div>
    </div>
  );
}
