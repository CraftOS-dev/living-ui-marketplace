/**
 * Renewals: the decision queue (renew, drop classes, let lapse, decide
 * later) grouped by family or mark, instructing the provider, recording
 * payment, the multi-year forecast and the history.
 */
import { useMemo, useState } from 'react';
import { CalendarCheck2, Info, RefreshCw, SearchX } from 'lucide-react';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, cn, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, fmtMoney, plural, relLabel } from '../lib/format.ts';
import { href, useHashParam } from '../lib/router.ts';
import type { FamilyRec } from '../lib/types.ts';
import { Checkbox, EmptyHint, ErrorBox, GroupHeader, Loading, Notice, PageHeader, Section, Segmented, StatTile, TONE_TEXT } from '../components/ui.tsx';
import {
  CostCell,
  DecisionPill,
  InstructDialog,
  LapseDialog,
  PartialDialog,
  RenewalSubject,
  dueTone,
  inGrace,
  matterOf,
} from '../components/renewShared.tsx';
import type { Decision, RenewalX } from '../components/renewShared.tsx';
import { ForecastTab, HistoryTab, InstructionsTab } from '../components/renewTabs.tsx';

export function RenewalsPage(): React.JSX.Element {
  const [tab, setTab] = useHashParam('tab', 'decisions');
  return (
    <div>
      <PageHeader title="Renewals" subtitle="Annuities, maintenance fees and trademark renewals. Decide, instruct your provider, record payment." />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="decisions">Decisions</TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            <TabsTrigger value="forecast">Forecast</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="decisions">
          <DecisionsTab />
        </TabsContent>
        <TabsContent value="instructions">
          <InstructionsTab onGoDecisions={() => setTab('decisions')} />
        </TabsContent>
        <TabsContent value="forecast">
          <ForecastTab />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Decisions                                                           */
/* ------------------------------------------------------------------ */

type Show = 'all' | 'd30' | 'd90' | 'grace' | 'nofee';

const SHOW_LABEL: Record<Show, string> = {
  all: 'All',
  d30: 'Due in 30 days',
  d90: 'Due in 90 days',
  grace: 'In grace period',
  nofee: 'Missing fee',
};

function matches(r: RenewalX, show: Show): boolean {
  const due = d10(r.due_date);
  const n = due === '' ? Number.POSITIVE_INFINITY : daysUntil(due);
  switch (show) {
    case 'd30':
      return n >= 0 && n <= 30;
    case 'd90':
      return n >= 0 && n <= 90;
    case 'grace':
      return inGrace(r);
    case 'nofee':
      return !r.fee_known;
    default:
      return true;
  }
}

const DEFAULT_TEXT: Record<'renew' | 'lapse' | 'decide', { head: string; body: string }> = {
  renew: { head: 'If nobody decides: renew.', body: 'New renewals start as Renew, ready to instruct, unless someone changes them.' },
  lapse: { head: 'If nobody decides: let lapse.', body: 'New renewals start as Let lapse and are left out of this queue.' },
  decide: { head: 'If nobody decides: nothing happens until someone decides.', body: 'Every renewal waits here for a person to choose.' },
};

type Dlg = { kind: 'lapse'; items: RenewalX[] } | { kind: 'partial'; item: RenewalX } | { kind: 'instruct'; items: RenewalX[] } | null;

function DecisionsTab(): React.JSX.Element {
  const { can, settings, homeCurrency } = useApp();
  const list = useCollection<RenewalX>('renewals', {
    filter: 'instruction_status = "not_instructed" && decision != "lapse"',
    sort: 'due_date',
    expand: 'matter,deadline',
  });
  const families = useCollection<FamilyRec>('families', { sort: 'title' });
  const [showRaw, setShow] = useHashParam('show', 'all');
  const show: Show = showRaw in SHOW_LABEL ? (showRaw as Show) : 'all';
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<Dlg>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const famTitle = useMemo(() => new Map(families.records.map((f) => [f.id, f.title])), [families.records]);

  const counts = useMemo(() => {
    const c: Record<Show, number> = { all: list.records.length, d30: 0, d90: 0, grace: 0, nofee: 0 };
    for (const r of list.records) {
      if (matches(r, 'd30')) c.d30 += 1;
      if (matches(r, 'd90')) c.d90 += 1;
      if (matches(r, 'grace')) c.grace += 1;
      if (matches(r, 'nofee')) c.nofee += 1;
    }
    return c;
  }, [list.records]);

  const shown = useMemo(() => list.records.filter((r) => matches(r, show)), [list.records, show]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; items: RenewalX[]; family: boolean }>();
    for (const r of shown) {
      const m = matterOf(r);
      const fam = m?.family ?? '';
      const key = fam !== '' ? `f:${fam}` : `m:${r.matter}`;
      const g = map.get(key) ?? { key, label: fam !== '' ? (famTitle.get(fam) ?? m?.title ?? 'Family') : (m?.title ?? 'Unknown matter'), items: [], family: fam !== '' };
      g.items.push(r);
      map.set(key, g);
    }
    return [...map.values()];
  }, [shown, famTitle]);

  const selRows = list.records.filter((r) => sel.has(r.id));
  const toggle = (ids: string[], v: boolean): void =>
    setSel((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (v) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  const decide = async (ids: string[], decision: 'renew' | 'defer'): Promise<void> => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const r = await op<{ updated: number }>('renewals/decide', { ids, decision });
      toast.success(decision === 'renew' ? `Renew: ${plural(r.updated, 'renewal')}` : `Decide later: ${plural(r.updated, 'renewal')}`);
      list.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDecide = (r: RenewalX, v: Decision): void => {
    if (v === 'lapse') setDlg({ kind: 'lapse', items: [r] });
    else if (v === 'renew_partial') setDlg({ kind: 'partial', item: r });
    else if (v === r.decision) return;
    else if (v === 'renew' || v === 'defer') void decide([r.id], v);
  };

  const refreshCosts = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const r = await op<{ refreshed: number }>('renewals/refresh-costs', {});
      toast.success(`Costs recalculated for ${plural(r.refreshed, 'renewal')}`);
      list.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const def = DEFAULT_TEXT[settings?.renewal_default ?? 'decide'] ?? DEFAULT_TEXT.decide;

  // Footer summary of the selection.
  const nRenew = selRows.filter((r) => r.decision === 'renew' || r.decision === 'renew_partial').length;
  const nLater = selRows.filter((r) => r.decision === 'defer').length;
  const nOpen = selRows.filter((r) => r.decision === 'pending').length;
  const est = selRows.reduce((a, r) => a + (r.fee_known ? r.home_amount : 0), 0);
  const noFee = selRows.filter((r) => !r.fee_known).length;
  const summary = [
    `${selRows.length} selected`,
    `Renew ${nRenew}`,
    ...(nOpen > 0 ? [`Undecided ${nOpen}`] : []),
    ...(nLater > 0 ? [`Later ${nLater}`] : []),
    `est. ${fmtMoney(est, homeCurrency)}${noFee > 0 ? ` + ${noFee} without a fee` : ''}`,
  ].join(' · ');

  if (list.loading && list.records.length === 0) return <Loading />;
  if (list.error !== null) return <ErrorBox message={list.error} onRetry={list.refresh} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Due in 30 days" value={counts.d30} tone={counts.d30 > 0 ? 'warn' : undefined} onClick={() => setShow(show === 'd30' ? 'all' : 'd30')} />
        <StatTile label="Due in 90 days" value={counts.d90} onClick={() => setShow(show === 'd90' ? 'all' : 'd90')} />
        <StatTile
          label="In grace period"
          value={counts.grace}
          tone={counts.grace > 0 ? 'bad' : undefined}
          sub="Due date passed, grace not ended"
          onClick={() => setShow(show === 'grace' ? 'all' : 'grace')}
        />
        <StatTile label="Missing fee" value={counts.nofee} tone={counts.nofee > 0 ? 'warn' : undefined} sub="No official fee on file" onClick={() => setShow(show === 'nofee' ? 'all' : 'nofee')} />
      </div>

      <Notice tone="info" icon={Info}>
        <span className="font-medium">Organization default. {def.head}</span> {def.body}
        {can.admin && (
          <>
            {' '}
            <a href={href('settings', undefined, { tab: 'organization' })} className="font-medium text-[var(--agent-app-accent)] hover:underline">
              Change it in Settings
            </a>
          </>
        )}
      </Notice>

      <Section
        title="Waiting for a decision"
        meta={show === 'all' ? String(list.records.length) : `${shown.length} of ${list.records.length}`}
        flush
        actions={
          <>
            {show !== 'all' && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShow('all')}>
                {SHOW_LABEL[show]} · Show all
              </Button>
            )}
            {can.edit && list.records.length > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void refreshCosts()} loading={refreshing} title="Recalculate fees and exchange rates for renewals not yet instructed">
                <RefreshCw size={12} aria-hidden /> Recalculate costs
              </Button>
            )}
          </>
        }
      >
        {list.records.length === 0 ? (
          <EmptyHint
            icon={CalendarCheck2}
            title="No renewals waiting for a decision"
            message="Renewals appear here as annuity, maintenance and renewal deadlines come up. Instructed ones move to Instructions."
            action={
              <a href={href('renewals', undefined, { tab: 'instructions' })} className="text-[13px] font-medium text-[var(--agent-app-accent)] hover:underline">
                Open Instructions
              </a>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyHint compact icon={SearchX} title={`Nothing ${SHOW_LABEL[show].toLowerCase()}`} action={<Button size="sm" variant="outline" onClick={() => setShow('all')}>Show all renewals</Button>} />
        ) : (
          groups.map((g) => {
            const ids = g.items.map((r) => r.id);
            const all = ids.every((id) => sel.has(id));
            const some = ids.some((id) => sel.has(id));
            return (
              <div key={g.key}>
                <GroupHeader
                  label={g.label}
                  count={g.items.length}
                  right={
                    can.manage ? (
                      <Checkbox checked={all} indeterminate={!all && some} onChange={(v) => toggle(ids, v)} ariaLabel={`Select all in ${g.label}`} />
                    ) : undefined
                  }
                />
                {g.items.map((r) => (
                  <DecisionRow
                    key={r.id}
                    r={r}
                    inFamily={g.family}
                    canManage={can.manage}
                    selected={sel.has(r.id)}
                    onSelect={(v) => toggle([r.id], v)}
                    onDecide={(v) => onDecide(r, v)}
                  />
                ))}
              </div>
            );
          })
        )}
      </Section>

      {can.manage && selRows.length > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-col gap-2 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-2.5 shadow-lg sm:flex-row sm:items-center">
          <span className="min-w-0 flex-1 text-[13px] font-medium tabular-nums">{summary}</span>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(selRows.map((r) => r.id), 'renew')}>
              Renew
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDlg({ kind: 'lapse', items: selRows })}>
              Let lapse
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(selRows.map((r) => r.id), 'defer')}>
              Decide later
            </Button>
            <Button size="sm" disabled={busy || nRenew === 0} onClick={() => setDlg({ kind: 'instruct', items: selRows })} title={nRenew === 0 ? 'Decide Renew on the selected renewals first' : undefined}>
              Instruct {nRenew > 0 ? nRenew : ''}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {dlg?.kind === 'lapse' && (
        <LapseDialog
          items={dlg.items}
          onClose={() => setDlg(null)}
          onDone={() => {
            toggle(
              dlg.items.map((r) => r.id),
              false,
            );
            list.refresh();
          }}
        />
      )}
      {dlg?.kind === 'partial' && <PartialDialog item={dlg.item} onClose={() => setDlg(null)} onDone={list.refresh} />}
      {dlg?.kind === 'instruct' && (
        <InstructDialog
          items={dlg.items}
          onClose={() => setDlg(null)}
          onDone={() => {
            setSel(new Set());
            list.refresh();
          }}
        />
      )}
    </div>
  );
}

function DecisionRow({
  r,
  inFamily,
  canManage,
  selected,
  onSelect,
  onDecide,
}: {
  r: RenewalX;
  inFamily: boolean;
  canManage: boolean;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onDecide: (v: Decision) => void;
}): React.JSX.Element {
  const m = matterOf(r);
  const due = d10(r.due_date);
  const grace = d10(r.grace_end);
  const tone = dueTone(due);
  const graceNow = inGrace(r);
  const options: { value: Decision; label: string; tone: 'good' | 'bad' | 'neutral'; title?: string }[] = [
    { value: 'renew', label: 'Renew', tone: 'good' },
    ...(m?.ip_type === 'trademark'
      ? [{ value: 'renew_partial' as const, label: 'Renew, drop classes', tone: 'good' as const, title: 'Renew only some of the classes' }]
      : []),
    { value: 'lapse', label: 'Let lapse', tone: 'bad' },
    { value: 'defer', label: 'Decide later', tone: 'neutral' },
  ];
  return (
    <div
      className={cn(
        'flex flex-col gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0 xl:flex-row xl:items-center xl:gap-4',
        selected && 'bg-[var(--agent-app-accent)]/5',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {canManage && (
          <div className="pt-0.5">
            <Checkbox checked={selected} onChange={onSelect} ariaLabel={`Select ${m?.ref ?? r.cycle_label}`} />
          </div>
        )}
        <div className="min-w-0">
          <RenewalSubject r={r} showType />
          <div className="mt-0.5 text-[13px] font-medium">{r.cycle_label}</div>
          {inFamily && m !== undefined && <div className="truncate text-xs text-[var(--agent-app-muted)]">{m.title}</div>}
          {r.decision === 'renew_partial' && (r.classes_keep ?? []).length > 0 && (
            <div className="text-xs text-[var(--agent-app-muted)]">Keeping classes {(r.classes_keep ?? []).join(', ')}</div>
          )}
        </div>
      </div>
      <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-2', canManage && 'pl-7 xl:pl-0')}>
        <div className="w-40 whitespace-nowrap tabular-nums">
          <div className="text-[13px]">{fmtDate(due) || 'No due date'}</div>
          {due !== '' && <div className={cn('text-xs', TONE_TEXT[tone])}>{relLabel(due)}</div>}
          {grace !== '' && (
            <div className={cn('text-xs', graceNow ? TONE_TEXT.warn : 'text-[var(--agent-app-muted)]')}>
              {graceNow ? 'In grace to ' : 'Grace to '}
              {fmtDate(grace)}
            </div>
          )}
        </div>
        <div className="w-28">
          <CostCell r={r} align="left" />
        </div>
        <div className="max-w-full overflow-x-auto xl:flex xl:w-[23rem] xl:justify-end">
          {canManage ? (
            <Segmented<Decision> size="sm" value={r.decision} options={options} onChange={onDecide} ariaLabel={`Decision for ${m?.ref ?? r.cycle_label}`} />
          ) : (
            <DecisionPill decision={r.decision} />
          )}
        </div>
      </div>
    </div>
  );
}
