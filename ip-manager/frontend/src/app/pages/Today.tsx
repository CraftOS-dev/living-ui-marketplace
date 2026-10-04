/**
 * Today: the home screen. What is due (mine or the team's), what waits for
 * review, the portfolio at a glance, renewal spend ahead and recent
 * activity. First run shows the four steps that fill an empty register.
 */
import { useMemo, useState } from 'react';
import {
  CalendarCheck,
  FilePlus2,
  FileSpreadsheet,
  History,
  PlugZap,
  RefreshCcw,
  UserPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Dialog, cn, getPbClient, useAuth } from '../../kit/index.ts';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, ago, plural, toPb, today, weekdayName } from '../lib/format.ts';
import { IP_TYPE_PLURAL } from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { AuditRec, DeadlineRec, IpType, MatterRec, SummaryResponse } from '../lib/types.ts';
import { MonthBars } from '../components/charts.tsx';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { EventDialog, eventCodesFor } from '../components/events.tsx';
import { RecordPicker } from '../components/pickers.tsx';
import { EmptyHint, ErrorBox, IdentityChip, ListRow, Loading, Notice, PageHeader, Section, Segmented, StatTile, TONE_TEXT } from '../components/ui.tsx';
import { DEADLINE_EXPAND, subjectTitle, useLatest } from '../components/workShared.tsx';

const SEARCH_FIELDS = ['ref', 'title', 'application_no', 'registration_no'];

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(day: string): string {
  return `${weekdayName(day)}, ${Number(day.slice(8, 10))} ${MONTHS_FULL[Number(day.slice(5, 7)) - 1] ?? ''}`;
}

interface TodayData {
  summary: SummaryResponse;
  agreementsTotal: number;
}

/** Everything the summary counts; a change to any of them re-runs it quietly. */
const TODAY_SOURCES = ['deadlines', 'matters', 'families', 'inbox_items', 'renewals', 'agreements', 'works', 'properties', 'disclosures', 'settings', 'fx_rates'];

async function loadToday(): Promise<TodayData> {
  const [summary, agreements] = await Promise.all([
    op<SummaryResponse>('summary', {}),
    getPbClient().call((p) => p.collection('agreements').getList(1, 1, { fields: 'id' }), { silent: true }),
  ]);
  return { summary, agreementsTotal: agreements.totalItems };
}

export function TodayPage(): React.JSX.Element {
  const { can, me } = useApp();
  const { userId } = useAuth();
  const myId = me?.id ?? userId ?? '';
  const day = today();
  const data = useLiveAsync(loadToday, [], TODAY_SOURCES);
  const [recordOpen, setRecordOpen] = useState(false);

  const horizon = toPb(addDays(day, 90));
  const dl = useCollection<DeadlineRec>('deadlines', {
    filter: `status = "open" && due_date != "" && due_date <= "${horizon}"`,
    sort: 'due_date',
    expand: DEADLINE_EXPAND,
  });
  const { actions, dialogs, canEdit } = useDeadlineActions(() => data.reload());

  const mine = useMemo(() => dl.records.filter((d) => d.assignee !== '' && d.assignee === myId), [dl.records, myId]);
  const [scopeChoice, setScopeChoice] = useState<'mine' | 'team' | null>(null);
  const scope: 'mine' | 'team' = !can.edit ? 'mine' : (scopeChoice ?? (!dl.loading && mine.length === 0 ? 'team' : 'mine'));
  const shown = scope === 'mine' ? mine : dl.records;

  const s = data.data?.summary ?? null;
  const mattersTotal = s === null ? 0 : Object.values(s.portfolio).reduce((a, g) => a + g.pre_filing + g.pending + g.live + g.dead, 0);
  const firstRun = s !== null && data.data !== null && mattersTotal === 0 && data.data.agreementsTotal === 0 && s.counts.works === 0;

  return (
    <div>
      <PageHeader
        title="Today"
        meta={longDate(day)}
        actions={
          can.edit ? (
            <Button variant="outline" onClick={() => setRecordOpen(true)}>
              <FilePlus2 size={14} aria-hidden /> Record office action
            </Button>
          ) : undefined
        }
      />

      {firstRun && <GetStarted />}

      {s === null ? (
        data.error !== null ? (
          <div className="mb-6">
            <ErrorBox message={data.error} onRetry={data.reload} />
          </div>
        ) : (
          <Loading label="Loading today" />
        )
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile
            label="Overdue"
            value={s.deadlines.overdue}
            tone={s.deadlines.overdue > 0 ? 'bad' : undefined}
            sub={s.deadlines.mine_overdue > 0 ? `${s.deadlines.mine_overdue} assigned to you` : 'None assigned to you'}
            onClick={() => navigate('deadlines', undefined, { window: 'overdue', scope: 'all' })}
          />
          <StatTile
            label="Due this week"
            value={s.deadlines.week}
            sub={s.deadlines.mine_week > 0 ? `${s.deadlines.mine_week} assigned to you` : 'Next 7 days'}
            onClick={() => navigate('deadlines', undefined, { window: 'week', scope: 'all' })}
          />
          <StatTile
            label="Next 30 days"
            value={s.deadlines.d30}
            sub={`${s.deadlines.d90} in the next 90 days`}
            onClick={() => navigate('deadlines', undefined, { window: '30', scope: 'all' })}
          />
          <StatTile
            label="To review"
            value={s.inbox.new + s.inbox.awaiting_second}
            sub={s.inbox.awaiting_second > 0 ? `${s.inbox.awaiting_second} need a second reviewer` : 'Office changes and proposals'}
            onClick={() => navigate('inbox')}
          />
          <StatTile
            label="Renewal decisions"
            value={s.renewals.pending}
            sub={s.renewals.in_grace > 0 ? `${s.renewals.in_grace} in a grace period` : 'Renew or let lapse'}
            onClick={() => navigate('renewals')}
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Section
            title={scope === 'mine' ? 'My deadlines' : 'Team deadlines'}
            meta={dl.loading ? undefined : String(shown.length)}
            flush
            actions={
              can.edit ? (
                <Segmented<'mine' | 'team'>
                  size="sm"
                  ariaLabel="Whose deadlines"
                  value={scope}
                  onChange={setScopeChoice}
                  options={[
                    { value: 'mine', label: `Mine ${dl.loading ? '' : mine.length}`.trim() },
                    { value: 'team', label: `Team ${dl.loading ? '' : dl.records.length}`.trim() },
                  ]}
                />
              ) : undefined
            }
          >
            {dl.loading ? (
              <Loading label="Loading deadlines" />
            ) : dl.error !== null ? (
              <div className="p-4">
                <ErrorBox message={dl.error} onRetry={dl.refresh} />
              </div>
            ) : (
              <DeadlineList
                deadlines={shown}
                actions={canEdit ? actions : null}
                subjectLabel={(d) => subjectTitle(d)}
                empty={
                  <EmptyHint
                    icon={CalendarCheck}
                    title="Nothing due in the next 90 days"
                    message={
                      scope === 'mine'
                        ? 'Nothing assigned to you is overdue or due in the next 90 days.'
                        : 'No open deadline is overdue or due in the next 90 days.'
                    }
                    action={
                      <Button size="sm" variant="outline" onClick={() => navigate('deadlines')}>
                        Open Deadlines
                      </Button>
                    }
                  />
                }
              />
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <PortfolioCard summary={s} />
          <RenewalSpendCard summary={s} />
          {can.edit && <RecentActivity />}
        </div>
      </div>

      {dialogs}
      {recordOpen && <RecordOfficeActionDialog onClose={() => setRecordOpen(false)} onDone={() => data.reload()} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* First run                                                           */
/* ------------------------------------------------------------------ */

interface Step {
  key: string;
  icon: LucideIcon;
  title: string;
  text: string;
  cta: string;
  link: string;
}

function GetStarted(): React.JSX.Element {
  const { can } = useApp();
  const steps: Step[] = [];
  if (can.edit) {
    steps.push({
      key: 'record',
      icon: FilePlus2,
      title: 'Add your first record',
      text: 'Enter a trademark with its numbers and dates. The rules work out its deadlines for you.',
      cta: 'Add a record',
      link: href('trademarks', undefined, { new: '1' }),
    });
    steps.push({
      key: 'import',
      icon: FileSpreadsheet,
      title: 'Import from a spreadsheet',
      text: 'Bring in an existing docket from a CSV file. You see a trial run before anything is saved.',
      cta: 'Import records',
      link: href('settings', undefined, { tab: 'import' }),
    });
  }
  if (can.admin) {
    steps.push({
      key: 'offices',
      icon: PlugZap,
      title: 'Connect office data',
      text: 'Link USPTO, EPO, EUIPO or JPO so status changes arrive in the Inbox for review.',
      cta: 'Connect offices',
      link: href('settings', undefined, { tab: 'offices' }),
    });
  }
  if (can.manage) {
    steps.push({
      key: 'people',
      icon: UserPlus,
      title: 'Invite the team',
      text: 'Add colleagues and choose what each person can see and change.',
      cta: 'Invite people',
      link: href('settings', undefined, { tab: 'people' }),
    });
  }
  return (
    <div className="mb-6">
      <Section title="Get started" meta="The register is empty">
        {steps.length === 0 ? (
          <Notice>Nothing has been added yet. Once your team adds records, their deadlines and renewals show up here.</Notice>
        ) : (
          <ol className={cn('grid gap-3 sm:grid-cols-2', steps.length >= 4 ? 'xl:grid-cols-4' : steps.length === 3 ? 'xl:grid-cols-3' : '')}>
            {steps.map((st, i) => {
              const Icon = st.icon;
              return (
                <li key={st.key} className="min-w-0">
                  <a
                    href={st.link}
                    className="flex h-full flex-col gap-1.5 border border-[var(--agent-app-border)] p-3 transition-colors hover:border-[var(--agent-app-accent)]/50 hover:bg-[var(--agent-app-border)]/15"
                  >
                    <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                      <span className="font-mono">{i + 1}</span>
                      <Icon size={13} aria-hidden />
                    </span>
                    <span className="text-sm font-semibold">{st.title}</span>
                    <span className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{st.text}</span>
                    <span className="mt-auto pt-1 text-xs font-medium text-[var(--agent-app-accent)]">{st.cta} →</span>
                  </a>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right column                                                        */
/* ------------------------------------------------------------------ */

const PORTFOLIO_TYPES: IpType[] = ['patent', 'utility_model', 'design', 'trademark', 'copyright', 'domain'];

const TYPE_PAGE: Record<IpType, Page | null> = {
  patent: 'patents',
  utility_model: 'patents',
  design: 'designs',
  trademark: 'trademarks',
  copyright: 'copyrights',
  domain: null,
};

function Count({ n, tone }: { n: number; tone: 'good' | 'info' | 'neutral' }): React.JSX.Element {
  return (
    <span className={cn('text-right text-[13px] tabular-nums', n === 0 ? 'text-[var(--agent-app-muted)]/60' : tone === 'neutral' ? '' : cn('font-medium', TONE_TEXT[tone]))}>
      {n}
    </span>
  );
}

const PF_GRID = 'grid grid-cols-[minmax(0,1fr)_repeat(3,3.75rem)] items-center gap-x-2';

function PortfolioCard({ summary }: { summary: SummaryResponse | null }): React.JSX.Element {
  const { vocab } = useApp();
  if (summary === null) {
    return (
      <Section title="Portfolio">
        <Loading />
      </Section>
    );
  }
  const rows = PORTFOLIO_TYPES.map((t) => {
    const g = summary.portfolio[t];
    return { t, live: g?.live ?? 0, pending: g?.pending ?? 0, pre: g?.pre_filing ?? 0 };
  }).filter((r) => r.live + r.pending + r.pre > 0);
  const active = rows.reduce((a, r) => a + r.live + r.pending + r.pre, 0);
  return (
    <Section title="Portfolio" meta={active > 0 ? `${active} active` : undefined} flush>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-[var(--agent-app-muted)]">No patents, trademarks, designs or copyrights on the register yet.</p>
      ) : (
        <div>
          <div className={cn(PF_GRID, 'border-b border-[var(--agent-app-border)] px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]')}>
            <span>Type</span>
            <span className="text-right">In force</span>
            <span className="text-right">Pending</span>
            <span className="text-right">Not filed</span>
          </div>
          {rows.map((r) => {
            const page = TYPE_PAGE[r.t];
            const inner = (
              <>
                <span className="truncate text-[13px] font-medium">{IP_TYPE_PLURAL[r.t]}</span>
                <Count n={r.live} tone="good" />
                <Count n={r.pending} tone="info" />
                <Count n={r.pre} tone="neutral" />
              </>
            );
            return page !== null ? (
              <button
                key={r.t}
                type="button"
                onClick={() => navigate(page)}
                className={cn(PF_GRID, 'w-full border-b border-[var(--agent-app-border)]/70 px-4 py-2 text-left transition-colors hover:bg-[var(--agent-app-border)]/20')}
              >
                {inner}
              </button>
            ) : (
              <div key={r.t} className={cn(PF_GRID, 'border-b border-[var(--agent-app-border)]/70 px-4 py-2')}>
                {inner}
              </div>
            );
          })}
        </div>
      )}
      <div className="border-t border-[var(--agent-app-border)]/70">
        <ListRow
          primary="Active agreements"
          onClick={() => navigate('agreements')}
          trailing={<span className="text-[13px] font-medium tabular-nums">{summary.agreements.active}</span>}
        />
        <ListRow
          primary="Agreements ending in 90 days"
          onClick={() => navigate('agreements')}
          trailing={
            <span className={cn('text-[13px] font-medium tabular-nums', summary.agreements.expiring90 > 0 ? TONE_TEXT.warn : 'text-[var(--agent-app-muted)]/60')}>
              {summary.agreements.expiring90}
            </span>
          }
        />
        {summary.counts.works > 0 && (
          <ListRow
            primary={vocab.works}
            onClick={() => navigate('works')}
            trailing={<span className="text-[13px] font-medium tabular-nums">{summary.counts.works}</span>}
          />
        )}
      </div>
    </Section>
  );
}

function RenewalSpendCard({ summary }: { summary: SummaryResponse | null }): React.JSX.Element {
  if (summary === null) {
    return (
      <Section title="Renewal spend, next 12 months">
        <Loading />
      </Section>
    );
  }
  const spend = summary.renewal_spend;
  const hasRenewals = spend.months.some((m) => m.count > 0);
  const unknown = spend.months.reduce((a, m) => a + m.unknown, 0);
  return (
    <Section
      title="Renewal spend, next 12 months"
      meta={spend.currency}
      actions={
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate('renewals')}>
          Renewals
        </Button>
      }
    >
      {!hasRenewals ? (
        <EmptyHint compact icon={RefreshCcw} title="No renewals in the next 12 months" message="Renewal fees show here as renewal deadlines come onto the docket." />
      ) : (
        <>
          <MonthBars data={spend.months} currency={spend.currency} onBarClick={(month) => navigate('renewals', undefined, { month })} />
          {unknown > 0 && (
            <p className="mt-2 text-xs text-[var(--agent-app-muted)]">
              {plural(unknown, 'renewal')} without a fee on file {unknown === 1 ? 'is' : 'are'} not in the totals.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity (audit log)                                         */
/* ------------------------------------------------------------------ */

const VERB: Record<string, string> = {
  create: 'added',
  update: 'updated',
  delete: 'deleted',
  accept: 'accepted',
  reject: 'rejected',
  close: 'closed',
  decide: 'decided',
  event: 'recorded',
  extend: 'extended',
  generate: 'created deadlines for',
  import: 'imported',
  instruct: 'sent renewal instructions for',
  move: 'moved the date of',
  regenerate: 'recalculated deadlines for',
  sync: 'updated obligations for',
};

/** Actions whose label already names the subject (no noun needed). */
const LABEL_ONLY = new Set(['event', 'generate', 'regenerate', 'import', 'instruct', 'sync']);

function activityLink(a: AuditRec): string {
  if (a.action === 'delete' || a.record_id === '') return '';
  switch (a.collection) {
    case 'matters':
      return href('matter', a.record_id);
    case 'agreements':
      return href('agreement', a.record_id);
    case 'works':
      return href('work', a.record_id);
    case 'properties':
      return href('property', a.record_id);
    case 'families':
      return href('family', a.record_id);
    case 'disclosures':
      return href('invention', a.record_id);
    case 'inbox_items':
      return href('inbox', a.record_id);
    case 'deadlines':
      return a.action === 'generate' || a.action === 'regenerate' ? '' : href('deadlines', a.record_id);
    default:
      return '';
  }
}

function RecentActivity(): React.JSX.Element {
  const { vocab } = useApp();
  const log = useLatest<AuditRec>('audit_log', 8, { sort: '-created' });
  const noun: Record<string, string> = {
    matters: 'record',
    families: 'family',
    properties: vocab.property.toLowerCase(),
    works: vocab.work.toLowerCase(),
    agreements: 'agreement',
    grants: 'rights grant',
    goods_services: 'goods and services',
    deadlines: 'deadline',
    renewals: 'renewal',
    documents: 'document',
    parties: 'contact',
    involvements: 'party link',
    clearances: 'clearance',
    approvals: 'product approval',
    disputes: 'dispute',
    watch_hits: 'watch notice',
    disclosures: 'invention',
    rules: 'rule',
    users: 'person',
    fee_schedule: 'fee',
    fx_rates: 'exchange rate',
    office_calendars: 'office closure day',
    dimension_values: 'rights value',
    scoring_criteria: 'scoring criterion',
    royalty_reports: 'royalty report',
    events: 'event',
    inbox_items: 'Inbox item',
    office_connections: 'office connection',
  };
  const sentence = (a: AuditRec): string => {
    const who = a.actor_name || 'CraftBot';
    const verb = VERB[a.action] ?? a.action;
    if (a.collection === 'settings') return `${who} ${verb} the organization settings`;
    if (LABEL_ONLY.has(a.action)) return `${who} ${verb}`;
    return `${who} ${verb} ${noun[a.collection] ?? 'a record'}`;
  };
  return (
    <Section title="Recent activity" flush>
      {log.loading ? (
        <Loading />
      ) : log.error !== null ? (
        <div className="p-4">
          <ErrorBox message={log.error} />
        </div>
      ) : log.records.length === 0 ? (
        <EmptyHint compact icon={History} title="No activity yet" message="Changes people and CraftBot make show here, newest first." />
      ) : (
        log.records.map((a) => {
          const link = activityLink(a);
          const label = a.collection === 'settings' ? '' : a.record_label;
          return (
            <ListRow
              key={a.id}
              leading={<IdentityChip name={a.actor_name || 'CraftBot'} size="sm" />}
              primary={<span className="font-normal">{sentence(a)}</span>}
              secondary={label !== '' ? label : undefined}
              trailing={<span className="whitespace-nowrap text-xs text-[var(--agent-app-muted)]">{ago(a.created)}</span>}
              onClick={
                link !== ''
                  ? () => {
                      window.location.hash = link;
                    }
                  : undefined
              }
            />
          );
        })
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Record an office action: pick the record, then the event dialog     */
/* ------------------------------------------------------------------ */

function RecordOfficeActionDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [matter, setMatter] = useState<MatterRec | null>(null);
  const [step, setStep] = useState<'pick' | 'event'>('pick');

  if (step === 'event' && matter !== null) {
    const codes = eventCodesFor(matter.ip_type);
    const preferred = matter.ip_type === 'patent' && matter.jurisdiction.toUpperCase() === 'US' ? 'OA_NONFINAL' : 'OA_ISSUED';
    return (
      <EventDialog
        subjectId={matter.id}
        subjectType="matter"
        ipType={matter.ip_type}
        jurisdiction={matter.jurisdiction}
        initialCode={codes.includes(preferred) ? preferred : undefined}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record an office action"
      description="Choose the record the office wrote about. Next you enter the date on the document and see the deadlines it creates."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={matter === null} onClick={() => setStep('event')}>
            Continue
          </Button>
        </>
      }
    >
      <RecordPicker<MatterRec>
        collection="matters"
        label="Record"
        value={matter?.id ?? ''}
        onChange={(id, rec) => setMatter(id !== '' ? rec : null)}
        labelOf={(m) => `${m.ref} ${m.title}`.trim()}
        searchFields={SEARCH_FIELDS}
        placeholder="Search by reference, title or office number"
      />
    </Dialog>
  );
}
