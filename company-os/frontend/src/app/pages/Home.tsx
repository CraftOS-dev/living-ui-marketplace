/**
 * Home. One screen that answers: am I okay (cash flow hero + momentum wall),
 * what needs me (attention lines + open tasks), what's next (Journey card),
 * and what's coming (Command-Center-style month calendar fed by follow-ups,
 * due work, invoices, and promos). Two real column stacks, no voids.
 */
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  Check,
  CircleDollarSign,
  FolderKanban,
  Megaphone,
  Sparkles,
  Target,
  Users,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Button,
  Progress,
  fireAgentTrigger,
  getPbClient,
  toast,
  useAgentRequest,
  useCollection,
  cn,
} from '../../kit/index.ts';
import { callOp } from '../lib/ops.ts';
import type {
  Company,
  Customer,
  Invoice,
  Issue,
  JourneyStep,
  Metric,
  KanbanCard,
  MetricEntry,
  ModuleKey,
  ModuleRow,
  MoneyEntry,
  Page,
  Priority,
  Promo,
  Stage,
  Suggestion,
} from '../lib/types.ts';
import { STAGES, STAGE_LABELS } from '../lib/types.ts';
import { MODULE_META } from '../components/ActivateGate.tsx';
import { notifyModulesChanged } from '../lib/moduleEvents.ts';
import { CashFlowChart, Constellation, MetricPanel, MonthCalendar } from '../components/viz.tsx';
import type { CalEvent, CashPoint, OrbitNode } from '../components/viz.tsx';
import { Dot, ListRow, PageHeader, Pill, RelDate, Section, fmtMoney, initialsOf, relDay } from '../components/ui.tsx';
import { todayStr, weekStart } from '../lib/useCompany.ts';

const MODULE_ICONS: Record<ModuleKey, LucideIcon> = {
  customers: Users,
  money: CircleDollarSign,
  kanban: FolderKanban,
  goals: Target,
  team: Building2,
  meetings: CalendarCheck,
  processes: Wrench,
  marketing: Megaphone,
};

function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function HomePage({
  company,
  onNavigate,
}: {
  company: Company;
  onNavigate: (page: Page) => void;
}): React.JSX.Element {
  const { records: steps } = useCollection<JourneyStep>('journey_steps', { sort: 'order' });
  const { records: suggestions } = useCollection<Suggestion>('suggestions', {
    filter: "status = 'open'",
    sort: '-created',
  });
  const { records: moduleRows } = useCollection<ModuleRow>('modules');
  const { records: moneyEntries } = useCollection<MoneyEntry>('money_entries');
  const { records: metrics } = useCollection<Metric>('metrics', { filter: 'active = true', sort: 'order' });
  const { records: metricEntries } = useCollection<MetricEntry>('metric_entries', { sort: 'week_start' });
  const { records: openIssues } = useCollection<Issue>('issues', { filter: "status = 'open'" });
  const { records: customers } = useCollection<Customer>('customers');
  const { records: priorities } = useCollection<Priority>('priorities');
  const { records: cards } = useCollection<KanbanCard>('kanban_cards');
  const { records: invoices } = useCollection<Invoice>('invoices');
  const { records: promos } = useCollection<Promo>('promos');

  const [reqId, setReqId] = useState<string | null>(null);
  const { request } = useAgentRequest(reqId);
  const requestWorking = request?.status === 'claimed';

  const activeKeys = useMemo(
    () => new Set<ModuleKey>(moduleRows.filter((m) => m.active).map((m) => m.key)),
    [moduleRows],
  );
  const suggestedModules = moduleRows.filter((m) => !m.active && m.suggested);

  /* ---------- Journey ---------- */
  const idx = stageIndex(company.stage);
  const unlocked = steps.filter((s) => stageIndex(s.stage) <= idx);
  const done = unlocked.filter((s) => s.status === 'done').length;
  const nextSteps = unlocked.filter((s) => s.status === 'open');
  const journeyComplete = steps.length > 0 && nextSteps.length === 0;
  const nextStep = nextSteps[0];

  /* ---------- Money: this month + cash curve ---------- */
  const month = todayStr().slice(0, 7);
  let inMonth = 0;
  let outMonth = 0;
  for (const e of moneyEntries) {
    if (e.date.slice(0, 7) === month) {
      if (e.kind === 'in') inMonth += e.amount;
      else outMonth += e.amount;
    }
  }

  const { history, projection, runOutDate } = useMemo(() => {
    const DAYS = 90;
    const start = isoDaysAgo(DAYS);
    const deltaByDay = new Map<string, number>();
    let netWindow = 0;
    for (const e of moneyEntries) {
      const d = e.date.slice(0, 10);
      if (d >= start) {
        const signed = e.kind === 'in' ? e.amount : -e.amount;
        deltaByDay.set(d, (deltaByDay.get(d) ?? 0) + signed);
        netWindow += signed;
      }
    }
    const hist: CashPoint[] = [];
    let bal = company.cash_on_hand;
    for (let i = 0; i <= DAYS; i++) {
      const d = isoDaysAgo(i);
      hist.unshift({ date: d, balance: bal });
      bal -= deltaByDay.get(d) ?? 0;
    }
    const daily = netWindow / DAYS;
    const proj: CashPoint[] = [];
    let runOut: string | null = null;
    if (moneyEntries.length > 0) {
      let p = company.cash_on_hand;
      for (let i = 1; i <= 60; i++) {
        p += daily;
        const d = new Date();
        d.setDate(d.getDate() + i);
        const iso = d.toISOString().slice(0, 10);
        proj.push({ date: iso, balance: Math.max(p, 0) });
        if (runOut === null && p <= 0) runOut = iso;
        if (p <= 0) break;
      }
    }
    return { history: hist, projection: proj, runOutDate: runOut };
  }, [moneyEntries, company.cash_on_hand]);

  const monthlyNet = useMemo(() => {
    let net = 0;
    const since = isoDaysAgo(90);
    for (const e of moneyEntries) {
      if (e.date.slice(0, 10) >= since) net += e.kind === 'in' ? e.amount : -e.amount;
    }
    return net / 3;
  }, [moneyEntries]);
  const runwaySentence =
    moneyEntries.length === 0
      ? 'Record money in and out on the Money page and this becomes your cash curve.'
      : monthlyNet < 0 && company.cash_on_hand > 0
        ? `About ${(company.cash_on_hand / -monthlyNet).toFixed(1)} months of runway at the current pace.`
        : 'You bring in more than you spend. The dashed line is the projected path.';

  /* ---------- Momentum wall ---------- */
  const momentum = useMemo(
    () =>
      metrics.slice(0, 4).map((m) => ({
        metric: m,
        series: metricEntries
          .filter((e) => e.metric === m.id)
          .map((e) => ({ week: e.week_start.slice(0, 10), value: e.value })),
      })),
    [metrics, metricEntries],
  );
  const showMomentum = activeKeys.has('goals') && momentum.some((m) => m.series.length > 0);

  /* ---------- Calendar events (real records only) ---------- */
  const calEvents: CalEvent[] = useMemo(() => {
    const events: CalEvent[] = [];
    for (const c of customers) {
      if (c.follow_up !== '') {
        events.push({ key: `fu-${c.id}`, date: c.follow_up, title: `Follow up with ${c.name}`, kind: 'follow_up', page: 'customers' });
      }
    }
    for (const t of cards) {
      if (t.due !== '' && t.status !== 'done') {
        events.push({ key: `t-${t.id}`, date: t.due, title: t.title, kind: 'work', page: 'kanban' });
      }
    }
    for (const inv of invoices) {
      if (inv.due !== '' && inv.status !== 'paid') {
        events.push({ key: `i-${inv.id}`, date: inv.due, title: `Invoice #${inv.number} due`, kind: 'invoice', page: 'money' });
      }
    }
    for (const pr of promos) {
      if (pr.date !== '' && pr.status !== 'published') {
        events.push({ key: `pr-${pr.id}`, date: pr.date, title: pr.title, kind: 'promo', page: 'marketing' });
      }
    }
    return events;
  }, [customers, cards, invoices, promos]);

  /* ---------- Constellation ---------- */
  const weekAgo = isoDaysAgo(7);
  const orbitNodes: OrbitNode[] = useMemo(() => {
    const countSince = (dates: string[]): number => dates.filter((d) => d.slice(0, 10) >= weekAgo).length;
    const counts: Partial<Record<ModuleKey, number>> = {
      customers: countSince(customers.map((c) => c.created)),
      money: countSince(moneyEntries.map((e) => e.created)),
      kanban: countSince(cards.map((t) => t.created)),
      goals: countSince(metricEntries.map((e) => e.created)),
      meetings: countSince(openIssues.map((i) => i.created)),
    };
    return [...activeKeys].map((key) => ({
      key,
      label: MODULE_META[key].title,
      icon: MODULE_ICONS[key],
      weekCount: counts[key] ?? null,
      onClick: () => onNavigate(key),
    }));
  }, [activeKeys, customers, moneyEntries, cards, metricEntries, openIssues, weekAgo, onNavigate]);

  /* ---------- Attention + tasks ---------- */
  const attention: Array<{ key: string; text: string; sub: string; tone: 'bad' | 'warn'; page: Page }> = [];
  for (const c of customers) {
    if (c.follow_up !== '' && c.follow_up.slice(0, 10) < todayStr()) {
      attention.push({
        key: `fu-${c.id}`,
        text: `Follow up with ${c.name}`,
        sub: relDay(c.follow_up).label,
        tone: 'bad',
        page: 'customers',
      });
    }
  }
  for (const p of priorities) {
    if (p.status === 'at_risk') {
      attention.push({ key: `pr-${p.id}`, text: p.title, sub: 'priority at risk', tone: 'warn', page: 'goals' });
    }
  }
  for (const i of openIssues) {
    attention.push({ key: `is-${i.id}`, text: i.title, sub: 'open issue', tone: 'warn', page: 'meetings' });
  }

  const openTasks = useMemo(
    () =>
      cards
        .filter((t) => t.status !== 'done')
        .sort((a, b) => {
          if (a.due === '' && b.due === '') return 0;
          if (a.due === '') return 1;
          if (b.due === '') return -1;
          return a.due < b.due ? -1 : 1;
        })
        .slice(0, 6),
    [cards],
  );

  const cycleTask = async (t: KanbanCard): Promise<void> => {
    const next = t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo';
    await getPbClient()
      .call((pb) => pb.collection('kanban_cards').update(t.id, { status: next }))
      .catch(() => undefined);
  };

  /* ---------- Suggestion + trigger actions ---------- */
  const acceptSuggestion = async (s: Suggestion): Promise<void> => {
    try {
      if (s.kind === 'stage_advance' && s.payload?.stage !== undefined) {
        await callOp('/api/ops/stage-advance', { stage: s.payload.stage });
        toast.success(`Welcome to the ${STAGE_LABELS[s.payload.stage]} stage`);
      } else {
        await getPbClient().call((pb) => pb.collection('suggestions').update(s.id, { status: 'accepted' }));
        if (s.kind === 'follow_up') onNavigate('customers');
        if (s.kind === 'runway') onNavigate('money');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not apply that');
    }
  };

  const dismissSuggestion = async (s: Suggestion): Promise<void> => {
    await getPbClient()
      .call((pb) => pb.collection('suggestions').update(s.id, { status: 'dismissed' }))
      .catch(() => undefined);
  };

  const activateModule = async (row: ModuleRow): Promise<void> => {
    await getPbClient()
      .call((pb) =>
        pb.collection('modules').update(row.id, { active: true, suggested: false, activated_at: todayStr() }),
      )
      .then(() => {
        notifyModulesChanged();
        toast.success(`${MODULE_META[row.key].title} is now on`);
        onNavigate(row.key);
      })
      .catch(() => undefined);
  };

  const askCheckup = async (): Promise<void> => {
    const fired = await fireAgentTrigger('company_checkup_requested', {
      stage: company.stage,
      open_issues: openIssues.length,
      open_steps: nextSteps.length,
    });
    if (fired.ok && fired.requestId !== undefined) {
      setReqId(fired.requestId ?? null);
      toast.info('Asked CraftBot for a checkup');
    } else if (!fired.ok) {
      toast.error(fired.message ?? 'Could not reach an agent');
    }
  };

  const showMoney = activeKeys.has('money');

  return (
    <div>
      <PageHeader
        title={company.name}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={
          <Button variant="secondary" size="sm" onClick={() => void askCheckup()}>
            <Sparkles size={14} aria-hidden />
            CraftBot checkup
          </Button>
        }
      />

      {request !== null && (
        <p className="mb-4 flex items-center gap-2 text-xs text-[var(--lui-muted)]">
          <Dot tone={requestWorking ? 'accent' : request.status === 'done' ? 'good' : 'neutral'} />
          {requestWorking
            ? 'CraftBot is looking at your company…'
            : request.status === 'done'
              ? 'Checkup done. The note is waiting in Notes.'
              : request.status === 'pending'
                ? 'Checkup requested. No agent connected yet.'
                : 'Checkup request could not be completed.'}
        </p>
      )}

      {/* Suggestions: proposed, never self-applied */}
      {(suggestions.length > 0 || suggestedModules.length > 0) && (
        <div className="mb-5 flex flex-col gap-2">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 border border-[var(--lui-accent)]/35 bg-[var(--lui-accent)]/[0.04] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-0.5 text-xs text-[var(--lui-muted)]">{s.body}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => void acceptSuggestion(s)}>
                  {s.kind === 'stage_advance' ? 'Advance' : 'Take a look'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void dismissSuggestion(s)}>
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
          {suggestedModules.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 border border-[var(--lui-border)] bg-[var(--lui-surface)] px-4 py-2.5"
            >
              <p className="min-w-0 text-[13px]">
                <span className="font-medium">{MODULE_META[m.key].title}</span>
                <span className="text-[var(--lui-muted)]"> is recommended for this stage. {MODULE_META[m.key].pitch}</span>
              </p>
              <Button size="sm" variant="secondary" onClick={() => void activateModule(m)}>
                Turn on
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Hero row: cash flow + constellation */}
      <div className="mb-5 grid items-stretch gap-3 lg:grid-cols-3">
        {showMoney && (
          <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)] lg:col-span-2">
            <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3.5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--lui-muted)]">Cash on hand</p>
                <p className="mt-0.5 text-[26px] font-semibold leading-8 tracking-tight tabular-nums">
                  {fmtMoney(company.cash_on_hand)}
                </p>
              </div>
              <div className="flex items-center gap-4 pb-1 text-xs tabular-nums">
                <span className="text-emerald-700 dark:text-emerald-400">+{fmtMoney(inMonth)} in</span>
                <span className="text-[var(--lui-muted)]">−{fmtMoney(outMonth)} out this month</span>
                <Button variant="ghost" size="sm" onClick={() => onNavigate('money')}>
                  Money
                  <ArrowRight size={13} aria-hidden />
                </Button>
              </div>
            </div>
            <div className="px-2 pb-2">
              <CashFlowChart history={history} projection={projection} runOutDate={runOutDate} />
            </div>
            <p className="border-t border-[var(--lui-border)]/70 px-4 py-2 text-xs text-[var(--lui-muted)]">{runwaySentence}</p>
          </div>
        )}
        <div
          className={cn(
            'flex flex-col border border-[var(--lui-border)] bg-[var(--lui-surface)]',
            !showMoney && 'lg:col-span-3',
          )}
        >
          <p className="px-4 pt-3.5 text-[11px] font-medium uppercase tracking-wider text-[var(--lui-muted)]">
            This week in your company
          </p>
          <div className="flex flex-1 items-center justify-center py-2">
            <Constellation companyInitials={initialsOf(company.name)} nodes={orbitNodes} />
          </div>
        </div>
      </div>

      {/* Momentum wall */}
      {showMomentum && (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {momentum.map(({ metric, series }) => (
            <MetricPanel
              key={metric.id}
              name={metric.name}
              unit={metric.unit}
              goal={metric.goal}
              direction={metric.direction}
              series={series}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-5">
        {/* Calendar row (Command Center design, wide) */}
        <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)] p-4">
          <MonthCalendar events={calEvents} onOpen={(p) => onNavigate(p as Page)} />
        </div>

        {/* Journey row */}
        <Section
            title="Your Journey"
            meta={`${done} of ${unlocked.length} done`}
            actions={
              <Button variant="ghost" size="sm" onClick={() => onNavigate('journey')}>
                Open
                <ArrowRight size={13} aria-hidden />
              </Button>
            }
            flush
          >
            {journeyComplete ? (
              <p className="px-4 py-6 text-[13px] text-[var(--lui-muted)]">
                Every unlocked step is done. New steps arrive as the company advances.
              </p>
            ) : (
              <div>
                <div className="flex items-center gap-3 px-4 pb-1 pt-3">
                  <Progress value={unlocked.length > 0 ? (done / unlocked.length) * 100 : 0} className="h-1 flex-1" />
                </div>
                {nextStep !== undefined && (
                  <div className="mx-4 my-3 border border-[var(--lui-border)] bg-[var(--lui-bg)]/60 p-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--lui-accent)]">
                      Next step · {STAGE_LABELS[nextStep.stage]}
                    </p>
                    <p className="mt-1 text-sm font-medium">{nextStep.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--lui-muted)]">{nextStep.why}</p>
                    <Button size="sm" className="mt-2.5" onClick={() => onNavigate('journey')}>
                      {nextStep.kind === 'attest' ? 'Mark it done' : 'Do it now'}
                    </Button>
                  </div>
                )}
                <div className="pb-1">
                  {nextSteps.slice(1, 4).map((s) => (
                    <ListRow
                      key={s.id}
                      className="min-h-9 px-4 py-1.5"
                      leading={<span aria-hidden className="size-3.5 shrink-0 border border-[var(--lui-border)]" />}
                      primary={<span className="text-[13px] font-normal">{s.title}</span>}
                      onClick={() => onNavigate('journey')}
                    />
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Attention + open tasks, side by side */}
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <Section title="Needs attention" meta={attention.length > 0 ? String(attention.length) : undefined} flush>
              {attention.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-[var(--lui-muted)]">Nothing waiting on you.</p>
              ) : (
                <div>
                  {attention.slice(0, 6).map((a) => (
                    <ListRow
                      key={a.key}
                      className="min-h-10"
                      leading={<Dot tone={a.tone} />}
                      primary={<span className="text-[13px]">{a.text}</span>}
                      trailing={<span className="text-xs text-[var(--lui-muted)]">{a.sub}</span>}
                      onClick={() => onNavigate(a.page)}
                    />
                  ))}
                  {attention.length > 6 && (
                    <p className="px-4 py-2 text-xs text-[var(--lui-muted)]">and {attention.length - 6} more…</p>
                  )}
                </div>
              )}
            </Section>

            {activeKeys.has('kanban') && (
              <Section
                title="Open tasks"
                meta={openTasks.length > 0 ? String(cards.filter((t) => t.status !== 'done').length) : undefined}
                actions={
                  <Button variant="ghost" size="sm" onClick={() => onNavigate('kanban')}>
                    All
                    <ArrowRight size={13} aria-hidden />
                  </Button>
                }
                flush
              >
                {openTasks.length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-[var(--lui-muted)]">
                    No open tasks. Add work on the Kanban board.
                  </p>
                ) : (
                  openTasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex min-h-10 items-center gap-2.5 border-b border-[var(--lui-border)]/70 px-4 py-1.5 last:border-0"
                    >
                      <button
                        type="button"
                        aria-label={`Status of ${t.title}: ${t.status}. Click to advance.`}
                        onClick={() => void cycleTask(t)}
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center border transition-colors',
                          t.status === 'doing'
                            ? 'border-[var(--lui-accent)] bg-[var(--lui-accent)]/20'
                            : 'border-[var(--lui-border)] hover:border-[var(--lui-muted)]',
                        )}
                      >
                        {t.status === 'done' && <Check size={11} aria-hidden />}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                      {t.due !== '' && <RelDate iso={t.due} />}
                    </div>
                  ))
                )}
              </Section>
            )}
          </div>

          {/* This quarter */}
          {activeKeys.has('goals') && priorities.length > 0 && (
            <Section
              title="This quarter"
              meta={`${priorities.filter((p) => p.status === 'done').length}/${priorities.length} done`}
              flush
            >
              {priorities.slice(0, 5).map((p) => (
                <ListRow
                  key={p.id}
                  className="min-h-10"
                  primary={<span className="text-[13px]">{p.title}</span>}
                  trailing={
                    <Pill tone={p.status === 'on_track' ? 'good' : p.status === 'at_risk' ? 'warn' : 'neutral'}>
                      {p.status === 'on_track' ? 'On track' : p.status === 'at_risk' ? 'At risk' : 'Done'}
                    </Pill>
                  }
                  onClick={() => onNavigate('goals')}
                />
              ))}
            </Section>
          )}
      </div>
    </div>
  );
}
