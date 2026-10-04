/**
 * Today: the person's day. Counts that need attention (each opens the
 * right list), the next deadlines that are theirs (then statutory ones
 * nobody owns), a month calendar, what waits for them in the Inbox and in
 * approvals, upcoming talent dates, and quick ways into the work. Every
 * part follows changes made by anyone, including CraftBot, as they happen.
 */
import { useMemo } from 'react';
import { CalendarCheck, CalendarClock, ClipboardCheck, FilePlus2, Inbox as InboxIcon, ListChecks, Mic2 } from 'lucide-react';
import { Button, useAuth } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { addDays, ago, d10, deadlineSeverity, fmtDate, relLabel, toPb, today, weekdayName } from '../lib/format.ts';
import { enumLabel, isJa, t } from '../lib/i18n.ts';
import { href, navigate, subjectHref, useHashParam } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { ApprovalRec, DeadlineRec, InboxItemRec, ProductRec } from '../lib/records.ts';
import type { ModuleKey } from '../lib/shapes.ts';
import { CalendarMonth } from '../components/CalendarMonth.tsx';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { EmptyHint, ErrorBox, GroupHeader, ListRow, Loading, PageHeader, Pill, Section, Segmented, StatTile, Tag } from '../components/ui.tsx';
import { INBOX_LIST_EXPAND, SourceTag, inboxSubject } from '../components/workInbox.tsx';

/** What the summary op returns (lib_reports.js summary()). */
interface Summary {
  today: string;
  deadlines: { overdue: number; week: number; d30: number; d90: number; mine_overdue: number; mine_week: number };
  inbox: { new: number; awaiting_second: number };
  approvals: { open: number; overdue: number; changes: number };
  renewals: { pending: number; in_grace: number };
  agreements: { active: number; expiring90: number };
  royalties: { overdue: number; due30: number };
  committees: { open_consents: number };
  permissions: { expiring60: number };
  enforcement: { open: number; watch_new: number };
}

/** Everything the summary counts: a change to any of them re-runs it quietly. */
const SUMMARY_SOURCES = [
  'deadlines',
  'inbox_items',
  'approvals',
  'renewals',
  'agreements',
  'royalty_reports',
  'consent_requests',
  'permissions',
  'enforcement_cases',
  'watch_hits',
  'matters',
];

const STATUTORY_FILTER = '(kind = "hard" || kind = "extendable" || kind = "designated")';
const NOTHING = 'id = "-"';

export function TodayPage(): React.JSX.Element {
  const { can, me, on } = useApp();
  const { userId } = useAuth();
  const myId = me?.id ?? userId ?? '';
  const meQ = myId !== '' ? myId : '-';
  const day = today();

  const summary = useLiveAsync(() => op<Summary>('summary', {}), [], SUMMARY_SOURCES);
  const s = summary.data;

  const horizon30 = toPb(addDays(day, 30));
  const nextCol = useCollection<DeadlineRec>('deadlines', {
    filter: `status = "open" && due_date != "" && due_date <= "${horizon30}" && (assignee = "${meQ}" || (assignee = "" && ${STATUTORY_FILTER}))`,
    sort: 'due_date',
  });
  const mine = useMemo(() => nextCol.records.filter((d) => d.assignee === myId && myId !== ''), [nextCol.records, myId]);
  const unowned = useMemo(() => nextCol.records.filter((d) => d.assignee === ''), [nextCol.records]);

  const [calScopeRaw, setCalScope] = useHashParam('cal', can.edit ? 'all' : 'mine');
  const calScope = calScopeRaw === 'mine' ? 'mine' : 'all';
  const [selDay, setSelDay] = useHashParam('day', day);
  const calCol = useCollection<DeadlineRec>('deadlines', {
    filter: calScope === 'mine' ? `status = "open" && assignee = "${meQ}"` : 'status = "open"',
    sort: 'due_date',
  });
  const dayRows = useMemo(() => calCol.records.filter((d) => d10(d.due_date) === selDay), [calCol.records, selDay]);

  const talentCol = useCollection<DeadlineRec>('deadlines', {
    filter: on('talents')
      ? `status = "open" && (category = "talent" || category = "playbook") && due_date >= "${toPb(day)}" && due_date <= "${toPb(addDays(day, 60))}"`
      : NOTHING,
    sort: 'due_date',
  });

  const dl = useDeadlineActions(() => {
    nextCol.refresh();
    calCol.refresh();
    talentCol.refresh();
  });

  const meta = isJa() ? `${fmtDate(day)}（${weekdayName(day)}）` : `${weekdayName(day)}, ${fmtDate(day)}`;

  return (
    <div>
      <PageHeader
        title={t('Today')}
        meta={meta}
        subtitle={t('Your deadlines, reviews and decisions. Everything here updates as people and CraftBot work.')}
      />

      {s === null ? (
        summary.error !== null ? (
          <div className="mb-6">
            <ErrorBox message={summary.error} onRetry={summary.reload} />
          </div>
        ) : (
          <Loading />
        )
      ) : (
        <StatTiles s={s} />
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section
            title={t('My next deadlines')}
            meta={nextCol.loading ? undefined : String(nextCol.records.length)}
            flush
            actions={
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => navigate('deadlines', undefined, { assignee: 'me' })}>
                {t('All of mine')}
              </Button>
            }
          >
            {nextCol.loading ? (
              <Loading />
            ) : nextCol.error !== null ? (
              <div className="p-4">
                <ErrorBox message={nextCol.error} onRetry={nextCol.refresh} />
              </div>
            ) : nextCol.records.length === 0 ? (
              <EmptyHint
                compact
                icon={CalendarCheck}
                title={t('Nothing due in the next 30 days')}
                message={t('Deadlines assigned to you, and statutory deadlines nobody owns, show here when they are overdue or due within 30 days.')}
                action={
                  <Button size="sm" variant="outline" onClick={() => navigate('deadlines')}>
                    {t('Open Deadlines')}
                  </Button>
                }
              />
            ) : (
              <div>
                {mine.length > 0 && (
                  <>
                    <GroupHeader label={t('Assigned to you')} count={mine.length} />
                    <DeadlineList deadlines={mine} actions={dl.actions} canEdit={dl.canEdit} grouped={false} bulk={false} />
                  </>
                )}
                {unowned.length > 0 && (
                  <>
                    <GroupHeader label={t('Statutory, nobody assigned')} count={unowned.length} tone="warn" />
                    <DeadlineList deadlines={unowned} actions={dl.actions} canEdit={dl.canEdit} grouped={false} bulk={false} />
                  </>
                )}
              </div>
            )}
          </Section>

          <Section
            title={t('Calendar')}
            meta={calCol.loading ? undefined : t('{n} open', { n: calCol.records.length })}
            actions={
              <Segmented<'mine' | 'all'>
                size="sm"
                ariaLabel={t('Whose deadlines')}
                value={calScope}
                onChange={setCalScope}
                options={[
                  { value: 'mine', label: t('Mine') },
                  { value: 'all', label: t('Everyone') },
                ]}
              />
            }
          >
            <CalendarMonth deadlines={calCol.records} selectedDay={selDay} onSelectDay={setSelDay} />
            <div className="-mx-4 -mb-4 mt-4 border-t border-[var(--agent-app-border)]">
              <GroupHeader label={t('Due {date}', { date: fmtDate(selDay) })} count={dayRows.length} />
              <DeadlineList
                deadlines={dayRows}
                actions={dl.actions}
                canEdit={dl.canEdit}
                grouped={false}
                bulk={false}
                empty={<p className="px-4 py-3 text-[13px] text-[var(--agent-app-muted)]">{t('Nothing due on this day.')}</p>}
              />
            </div>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <WaitingForYou myId={myId} />
          {on('talents') && (
            <Section title={t('Talent dates, next 60 days')} meta={talentCol.loading ? undefined : String(talentCol.records.length)} flush>
              {talentCol.loading ? (
                <Loading />
              ) : talentCol.records.length === 0 ? (
                <EmptyHint compact icon={Mic2} title={t('No talent dates coming up')} message={t('Debut, anniversary, graduation and playbook dates for your talents show here.')} />
              ) : (
                <DeadlineList deadlines={talentCol.records} actions={dl.actions} canEdit={dl.canEdit} grouped={false} bulk={false} />
              )}
            </Section>
          )}
          <QuickActions />
        </div>
      </div>

      {dl.dialogs}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tiles                                                          */
/* ------------------------------------------------------------------ */

function StatTiles({ s }: { s: Summary }): React.JSX.Element {
  const { on } = useApp();
  const inbox = s.inbox.new + s.inbox.awaiting_second;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <StatTile
        label={t('Overdue')}
        value={s.deadlines.overdue}
        tone={s.deadlines.overdue > 0 ? 'bad' : undefined}
        sub={s.deadlines.mine_overdue > 0 ? t('{n} assigned to you', { n: s.deadlines.mine_overdue }) : t('None assigned to you')}
        onClick={() => navigate('deadlines', undefined, { window: 'overdue' })}
      />
      <StatTile
        label={t('Due this week')}
        value={s.deadlines.week}
        tone={s.deadlines.week > 0 ? 'warn' : undefined}
        sub={s.deadlines.mine_week > 0 ? t('{n} assigned to you', { n: s.deadlines.mine_week }) : t('Next 7 days')}
        onClick={() => navigate('deadlines', undefined, { window: 'week' })}
      />
      <StatTile
        label={t('Inbox waiting')}
        value={inbox}
        tone={inbox > 0 ? 'info' : undefined}
        sub={s.inbox.awaiting_second > 0 ? t('{n} need a second reviewer', { n: s.inbox.awaiting_second }) : t('Proposals to review')}
        onClick={() => navigate('inbox')}
      />
      {on('approvals') && (
        <StatTile
          label={t('Approvals overdue')}
          value={s.approvals.overdue}
          tone={s.approvals.overdue > 0 ? 'bad' : undefined}
          sub={t('{n} in review', { n: s.approvals.open })}
          onClick={() => navigate('approvals', undefined, { overdue: '1' })}
        />
      )}
      {on('royalties') && (
        <StatTile
          label={t('Royalty statements late')}
          value={s.royalties.overdue}
          tone={s.royalties.overdue > 0 ? 'bad' : undefined}
          sub={t('{n} due in 30 days', { n: s.royalties.due30 })}
          onClick={() => navigate('royalties', undefined, { late: '1' })}
        />
      )}
      <StatTile
        label={t('Renewal decisions')}
        value={s.renewals.pending}
        tone={s.renewals.pending > 0 ? 'warn' : undefined}
        sub={s.renewals.in_grace > 0 ? t('{n} in a grace period', { n: s.renewals.in_grace }) : t('Renew or let lapse')}
        onClick={() => navigate('renewals', undefined, { decision: 'pending' })}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Waiting for you                                                     */
/* ------------------------------------------------------------------ */

function WaitingForYou({ myId }: { myId: string }): React.JSX.Element {
  const { can, on } = useApp();
  const inbox = useCollection<InboxItemRec>('inbox_items', {
    filter: can.edit ? 'status = "new" || status = "awaiting_second"' : NOTHING,
    sort: '-created',
    expand: INBOX_LIST_EXPAND,
  });
  const approvalsCol = useCollection<ApprovalRec>('approvals', {
    filter: on('approvals') ? 'status = "submitted" || status = "in_review"' : NOTHING,
    sort: 'due_date',
    expand: 'product',
  });
  const approvals = useMemo(
    () =>
      approvalsCol.records.filter(
        (a) => can.licensing || (a.reviewers ?? []).some((r) => r.user !== undefined && r.user !== '' && r.user === myId && r.decision === 'pending'),
      ),
    [approvalsCol.records, can.licensing, myId],
  );
  // Items I approved first wait for someone else.
  const items = inbox.records.filter((i) => !(i.status === 'awaiting_second' && i.first_approver === myId));
  const loading = inbox.loading || approvalsCol.loading;
  const total = items.length + approvals.length;

  return (
    <Section title={t('Waiting for you')} meta={loading ? undefined : String(total)} flush>
      {loading ? (
        <Loading />
      ) : total === 0 ? (
        <EmptyHint
          compact
          icon={ListChecks}
          title={t('Nothing is waiting for you')}
          message={can.edit ? t('Inbox proposals and approvals that need your answer show here.') : t('Approvals that need your answer show here.')}
        />
      ) : (
        <div>
          {items.length > 0 && (
            <>
              <GroupHeader
                label={t('Inbox')}
                count={items.length}
                right={
                  <a href={href('inbox')} className="text-[11px] font-medium text-[var(--agent-app-accent)] hover:underline">
                    {t('Open the Inbox')}
                  </a>
                }
              />
              {items.slice(0, 6).map((i) => {
                const subject = inboxSubject(i);
                return (
                  <ListRow
                    key={i.id}
                    leading={<InboxIcon size={15} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />}
                    primary={i.title}
                    secondary={
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Tag>{enumLabel('inbox_items.kind', i.kind)}</Tag>
                        <SourceTag source={i.source} />
                        <span className="truncate">{subject !== null ? subject.label : ''}</span>
                      </span>
                    }
                    trailing={
                      i.status === 'awaiting_second' ? (
                        <Pill tone="warn">{t('Second review')}</Pill>
                      ) : (
                        <span className="whitespace-nowrap text-xs text-[var(--agent-app-muted)]">{ago(i.created)}</span>
                      )
                    }
                    onClick={() => navigate('inbox', i.id)}
                  />
                );
              })}
              {items.length > 6 && <p className="px-4 py-2 text-xs text-[var(--agent-app-muted)]">{t('and {n} more in the Inbox', { n: items.length - 6 })}</p>}
            </>
          )}
          {approvals.length > 0 && (
            <>
              <GroupHeader label={t('Approvals')} count={approvals.length} />
              {approvals.slice(0, 6).map((a) => {
                const product = (a.expand?.['product'] ?? null) as ProductRec | null;
                const due = d10(a.due_date);
                const sev = due !== '' ? deadlineSeverity({ status: 'open', due_date: due, kind: 'internal', target_date: '' }) : null;
                return (
                  <ListRow
                    key={a.id}
                    leading={<ClipboardCheck size={15} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />}
                    primary={product !== null ? product.name : t('Product approval')}
                    secondary={`${enumLabel('approvals.stage', a.stage)} · ${t('Round {n}', { n: a.round })}`}
                    trailing={sev !== null ? <Pill tone={sev.tone}>{relLabel(due)}</Pill> : undefined}
                    onClick={() => {
                      window.location.hash = subjectHref('approval', a.id);
                    }}
                  />
                );
              })}
              {approvals.length > 6 && <p className="px-4 py-2 text-xs text-[var(--agent-app-muted)]">{t('and {n} more in Approvals', { n: approvals.length - 6 })}</p>}
            </>
          )}
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Quick actions                                                       */
/* ------------------------------------------------------------------ */

function QuickActions(): React.JSX.Element {
  const { can, on } = useApp();
  const recordPages: { page: Page; label: string; module: ModuleKey | null }[] = [
    { page: 'trademarks', label: t('Trademarks and designs'), module: null },
    { page: 'agreements', label: t('Agreements'), module: null },
    { page: 'titles', label: t('Titles'), module: 'titles' },
    { page: 'talents', label: t('Talents'), module: 'talents' },
    { page: 'products', label: t('Products'), module: 'products' },
    { page: 'committees', label: t('Committees'), module: 'committees' },
    { page: 'enforcement', label: t('Enforcement'), module: null },
  ];
  return (
    <Section title={t('Quick actions')} flush>
      {can.edit && (
        <div className="border-b border-[var(--agent-app-border)]/70 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FilePlus2 size={15} className="text-[var(--agent-app-muted)]" aria-hidden /> {t('Record an event')}
          </div>
          <p className="mt-0.5 text-xs text-[var(--agent-app-muted)]">{t('Open the record, then choose Record what happened. Its deadlines are worked out for you to confirm.')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recordPages
              .filter((r) => r.module === null || on(r.module))
              .map((r) => (
                <a
                  key={r.page}
                  href={href(r.page)}
                  className="border border-[var(--agent-app-border)] px-2 py-1 text-xs text-[var(--agent-app-text)]/85 hover:border-[var(--agent-app-accent)]/50 hover:bg-[var(--agent-app-border)]/20"
                >
                  {r.label}
                </a>
              ))}
          </div>
        </div>
      )}
      {can.edit && (
        <ListRow
          leading={<CalendarClock size={15} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />}
          primary={t('Add a deadline by hand')}
          secondary={t('For a date no rule covers')}
          onClick={() => navigate('deadlines', undefined, { new: '1' })}
        />
      )}
      <ListRow
        leading={<CalendarCheck size={15} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />}
        primary={t('Put your deadlines in your calendar')}
        secondary={t('Subscribe from Google Calendar, Outlook or Apple Calendar')}
        onClick={() => navigate('deadlines', undefined, { feed: '1' })}
      />
      <ListRow
        leading={<ListChecks size={15} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />}
        primary={t('Run a report')}
        secondary={t('Deadlines, licences ending, royalties and more, with CSV export')}
        onClick={() => navigate('reports')}
      />
    </Section>
  );
}
