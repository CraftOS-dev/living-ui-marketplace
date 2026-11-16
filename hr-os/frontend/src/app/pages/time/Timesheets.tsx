/**
 * Timesheets. A person's week comes from attendance (regular, overtime,
 * leave and holiday rows per day); they split a day over projects or
 * correct it in place, then submit; the manager approves in the Inbox.
 * Reviewers (HR, managers) get the week's list with waiting timesheets and
 * exceptions first, and can ask your AI agent to check for missed punches.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, ClipboardCheck, Inbox, Plus, RotateCcw, Send, Sparkle, Trash2, Undo2 } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, DataTable, Empty, IconButton, Input, LinkButton, LoadError, Loading, Notice, PageBody, PageHeader, Panel, Select, StatTile, StatusDot, Tag, toast } from '../../components/ui.tsx';
import type { Column, Tone } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addDays, fmtDay, fmtRange, weekday } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import type { Entry, EntryKind, Sheet, SheetRow, TimesheetCheck } from './types.ts';
import { AgentAskStatus } from '../../components/agent.tsx';
import { editsTime, hm, READS, seesOthers, statusLabel } from './util.ts';

export const SHEET_TONE: Record<Sheet['status'], Tone> = { draft: 'faint', submitted: 'warn', approved: 'good', rejected: 'bad' };
const KINDS: EntryKind[] = ['regular', 'overtime', 'leave', 'holiday'];

/** "7:30", "7.5" or "450m" -> minutes; null when not readable. */
export function parseMinutes(s: string): number | null {
  const v = s.trim();
  if (v === '') return 0;
  let m: RegExpExecArray | null = /^(\d{1,2}):([0-5]\d)$/.exec(v);
  if (m !== null) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+)m$/.exec(v);
  if (m !== null) return Number(m[1]);
  const n = Number(v.replace(',', '.'));
  if (Number.isFinite(n) && n >= 0 && n <= 24) return Math.round(n * 60);
  return null;
}

function hmm(m: number): string {
  return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

export function TimesheetsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  return seesOthers(me) ? <ReviewList week={query.get('week') ?? ''} /> : <MySheet week={query.get('week') ?? ''} />;
}

function WeekNav({ from }: { from: string }): React.JSX.Element {
  return (
    <span className="flex items-center">
      <IconButton icon={ChevronLeft} label={t('time.sched.prev')} onClick={() => setQuery({ week: addDays(from, -7) })} />
      <Button size="sm" variant="ghost" onClick={() => setQuery({ week: undefined })} className="hidden sm:inline-flex">
        {t('time.sched.this_week')}
      </Button>
      <IconButton icon={ChevronRight} label={t('time.sched.next')} onClick={() => setQuery({ week: addDays(from, 7) })} />
    </span>
  );
}

/* --------------------------------------------------------------- review */

function ReviewList({ week }: { week: string }): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const live = useOp<{ from: string; to: string; timesheets: SheetRow[]; counts: Record<string, number> }>('timesheets.list', { week: week === '' ? undefined : week, entity: entity === '' ? undefined : entity }, READS.sheets, { name: 'time.sheets' });
  const d = live.data;
  const [asking, setAsking] = useState(false);
  const checks = useOp<{ reviews: TimesheetCheck[] }>('timesheet-reviews.list', { limit: 20 }, ['timesheet_reviews'], { name: 'time.checks', skip: !editsTime(me) });
  const check = d === null ? undefined : (checks.data?.reviews ?? []).find((r) => r.from === d.from && (entity === '' || r.entity === '' || r.entity === entity));
  const columns: Column<SheetRow>[] = useMemo(
    () => [
      { key: 'name', label: t('time.col.person'), width: 'minmax(200px,2fr)', sort: (r) => r.name, phone: 'title', render: (r) => <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block truncate text-[12px] text-[var(--hr-muted)]">{r.title}</span></span> },
      { key: 'status', label: t('time.col.status'), width: '120px', sort: (r) => r.status, phone: 'end', render: (r) => <StatusDot tone={SHEET_TONE[r.status]} label={t('time.ts.status.' + r.status)} /> },
      { key: 'regular', label: t('time.ts.regular'), width: '84px', mono: true, align: 'right', sort: (r) => r.totals.regular_min, render: (r) => hm(r.totals.regular_min) },
      { key: 'overtime', label: t('time.ts.overtime'), width: '84px', mono: true, align: 'right', sort: (r) => r.totals.overtime_min, render: (r) => (r.totals.overtime_min > 0 ? hm(r.totals.overtime_min) : '') },
      { key: 'leave', label: t('time.ts.leave'), width: '72px', mono: true, align: 'right', hideBelow: 'lg', sort: (r) => r.totals.leave_min, render: (r) => (r.totals.leave_min > 0 ? hm(r.totals.leave_min) : '') },
      { key: 'total', label: t('time.ts.total'), width: '84px', mono: true, align: 'right', sort: (r) => r.totals.total_min, render: (r) => hm(r.totals.total_min) },
      { key: 'exceptions', label: t('time.ts.exceptions'), width: '120px', sort: (r) => r.exceptions, render: (r) => (r.exceptions > 0 ? <Tag tone="warn">{tn('time.ts.n_exceptions', r.exceptions)}</Tag> : <span className="text-[var(--hr-faint)]">{t('time.ts.clean')}</span>) },
    ],
    [],
  );
  const ask = async (): Promise<void> => {
    if (d === null) return;
    setAsking(true);
    const r = await act([], () => op('timesheets.review-ask', { week: d.from, entity: entity === '' ? undefined : entity }), ['timesheet_reviews']);
    setAsking(false);
    if (r !== null) toast.success(t('time.ts.asked'));
  };
  if (d === null)
    return (
      <>
        <PageHeader title={t('time.ts.title')} />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const c = d.counts;
  return (
    <>
      <PageHeader title={t('time.ts.title')} meta={[fmtRange(d.from, d.to), tn('time.ts.waiting', c['submitted'] ?? 0)].join(' · ')}>
        <WeekNav from={d.from} />
        {editsTime(me) && (
          <Button variant="agent" icon={Sparkle} busy={asking} onClick={() => void ask()} disabled={d.timesheets.length === 0 || check?.agent?.open === true}>
            {t('time.ts.ask_agent')}
          </Button>
        )}
        {me.employee !== null && (
          <Button icon={ClipboardCheck} onClick={() => navigate('/time/timesheets/mine', { week: d.from })}>
            {t('time.ts.mine')}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {check !== undefined && (
          <Notice tone="agent" className="mb-3">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {t('time.ts.check')}
              <AgentAskStatus ask={check.agent} reads={['timesheet_reviews']} />
              {check.result !== null && check.result.note !== '' && <span className="hr-wrap min-w-0">{check.result.note}</span>}
            </span>
          </Notice>
        )}
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile index="01" label={t('time.ts.status.submitted')} value={c['submitted'] ?? 0} tone={(c['submitted'] ?? 0) > 0 ? 'warn' : undefined} />
          <StatTile index="02" label={t('time.ts.with_exceptions')} value={c['with_exceptions'] ?? 0} tone={(c['with_exceptions'] ?? 0) > 0 ? 'warn' : undefined} />
          <StatTile index="03" label={t('time.ts.status.approved')} value={c['approved'] ?? 0} tone="good" />
          <StatTile index="04" label={t('time.ts.status.draft')} value={c['draft'] ?? 0} />
        </div>
        <div className="hr-panel hr-in min-w-0">
          <DataTable label={t('time.ts.title')} columns={columns} rows={d.timesheets} rowKey={(r) => r.employment} rowHref={(r) => `#/time/timesheets/${r.employment}?week=${d.from}`} empty={<Empty icon={ClipboardCheck} title={t('time.ts.empty')} />} />
        </div>
      </PageBody>
    </>
  );
}

/* ----------------------------------------------------------- one sheet */

function MySheet({ week }: { week: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ timesheet: Sheet }>('timesheets.mine', { week: week === '' ? undefined : week }, READS.sheets, { skip: me.employee === null, name: 'time.sheet.mine' });
  if (me.employee === null) return <NoRecord />;
  return <SheetView live={live} title={t('time.ts.my_title')} own />;
}

/** A member whose sign-in has no employee record: nothing of their own to show (no request made). */
function NoRecord(): React.JSX.Element {
  return (
    <>
      <PageHeader title={t('time.ts.my_title')} />
      <PageBody>
        <Empty icon={ClipboardCheck} title={t('time.clock.no_employee')}>
          {t('time.clock.no_employee_text')}
        </Empty>
      </PageBody>
    </>
  );
}

export function PersonSheetPage({ params, query }: PageProps): React.JSX.Element {
  const me = useMe();
  const id = params['employment'] ?? '';
  const own = id === 'mine';
  const week = query.get('week') ?? '';
  const live = useOp<{ timesheet: Sheet }>(own ? 'timesheets.mine' : 'timesheets.get', own ? { week: week === '' ? undefined : week } : { employment: id, week: week === '' ? undefined : week }, READS.sheets, { skip: own && me.employee === null, name: 'time.sheet.' + id });
  if (own && me.employee === null) return <NoRecord />;
  return <SheetView live={live} title={own ? t('time.ts.my_title') : live.data?.timesheet.employee.name ?? t('time.ts.title')} own={own} back={seesOthers(me) ? '#/time/timesheets' + (week !== '' ? '?week=' + week : '') : undefined} />;
}

function SheetView({ live, title, own, back }: { live: { data: { timesheet: Sheet } | null; error: string | null; reload: () => void }; title: string; own: boolean; back?: string | undefined }): React.JSX.Element {
  const s = live.data?.timesheet ?? null;
  const [busy, setBusy] = useState('');
  if (s === null)
    return (
      <>
        <PageHeader title={title} back={back} />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />}</PageBody>
      </>
    );
  const can = s.can ?? { edit: false, submit: false, withdraw: false };
  const run = async (what: 'submit' | 'withdraw' | 'reopen'): Promise<void> => {
    setBusy(what);
    const params = own ? { week: s.period_start } : { employment: s.employment, week: s.period_start };
    const r = await act([], () => op(what === 'submit' ? 'timesheets.submit' : what === 'withdraw' ? 'timesheets.withdraw' : 'timesheets.reopen', what === 'submit' ? { week: s.period_start } : params), READS.sheets.concat(['approvals']));
    setBusy('');
    if (r !== null) toast.success(t('time.ts.done.' + what));
  };
  const days = s.days.filter((d) => d.outside !== true);
  return (
    <>
      <PageHeader title={title} meta={[fmtRange(s.period_start, s.period_end), t('time.ts.status.' + s.status)].join(' · ')} back={back}>
        <WeekNav from={s.period_start} />
        {can.withdraw && (
          <Button icon={Undo2} busy={busy === 'withdraw'} onClick={() => void run('withdraw')}>
            {t('time.ts.withdraw')}
          </Button>
        )}
        {can.reopen === true && (
          <Button icon={RotateCcw} busy={busy === 'reopen'} onClick={() => void run('reopen')}>
            {t('time.ts.reopen')}
          </Button>
        )}
        {s.status === 'submitted' && !own && (
          <Button variant="primary" icon={Inbox} onClick={() => navigate('/inbox', { view: 'approvals' })}>
            {t('time.ts.decide_inbox')}
          </Button>
        )}
        {can.submit && (
          <Button variant="primary" icon={Send} busy={busy === 'submit'} onClick={() => void run('submit')}>
            {t('time.ts.submit')}
          </Button>
        )}
      </PageHeader>
      <PageBody className="max-w-[1180px]">
        {s.status === 'rejected' && s.decided_note !== '' && <Notice tone="bad" className="mb-3">{t('time.ts.rejected_note', { note: s.decided_note })}</Notice>}
        {s.locked && <Notice tone="warn" className="mb-3">{t('time.ts.locked')}</Notice>}
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile index="01" label={t('time.ts.regular')} value={hm(s.totals.regular_min)} />
          <StatTile index="02" label={t('time.ts.overtime')} value={hm(s.totals.overtime_min)} tone={s.totals.overtime_min > 0 ? 'rh' : undefined} />
          <StatTile index="03" label={t('time.ts.leave')} value={hm(s.totals.leave_min)} tone={s.totals.leave_min > 0 ? 'lh' : undefined} />
          <StatTile index="04" label={t('time.ts.holiday')} value={hm(s.totals.holiday_min)} />
          <StatTile index="05" label={t('time.ts.total')} value={hm(s.totals.total_min)} />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <Panel index="06" label={t('time.ts.days')} className="lg:col-span-8" flush>
            <ul>
              {days.map((d) => (
                <DayBlock key={d.day} sheet={s} day={d.day} worked={d.worked} status={d.status} future={d.future} editable={can.edit} own={own} />
              ))}
            </ul>
          </Panel>
          <div className="flex flex-col gap-3 lg:col-span-4">
            <Panel index="07" label={t('time.ts.exceptions')}>
              {s.exceptions.length === 0 ? (
                <p className="py-3 text-[13px] text-[var(--hr-muted)]">{t('time.ts.no_exceptions')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {s.exceptions.map((x, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px]">
                      <StatusDot tone={x.severity === 'warning' ? 'warn' : x.severity === 'blocker' ? 'bad' : 'faint'} />
                      <span className="hr-mono hr-num w-14 shrink-0 text-[12px] text-[var(--hr-muted)]">{fmtDay(x.day)}</span>
                      <span className="hr-wrap min-w-0 flex-1">{x.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {s.projects.length > 0 && (
              <Panel index="08" label={t('time.ts.projects')}>
                <ul className="flex flex-col gap-1">
                  {s.projects.map((p) => (
                    <li key={p.project} className="flex items-center gap-2 text-[13px]">
                      <span className="hr-wrap min-w-0 flex-1">{p.project}</span>
                      <span className="hr-mono hr-num text-[12px]">{hm(p.minutes)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}

interface EditRow {
  kind: EntryKind;
  time: string;
  project: string;
  task: string;
  note: string;
}

function DayBlock({ sheet, day, worked, status, future, editable, own }: { sheet: Sheet; day: string; worked: number; status: string; future: boolean; editable: boolean; own: boolean }): React.JSX.Element {
  const entries = sheet.entries.filter((e) => e.day === day);
  const mine = entries.some((e) => e.source !== 'attendance');
  const [edit, setEdit] = useState<EditRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const start = (): void => setEdit(entries.length > 0 ? entries.map((e) => ({ kind: e.kind, time: hmm(e.minutes), project: e.project, task: e.task, note: e.note })) : [{ kind: 'regular', time: '', project: '', task: '', note: '' }]);
  const parsed = (edit ?? []).map((r) => parseMinutes(r.time));
  const ok = edit !== null && parsed.every((m) => m !== null);
  const save = async (rows: EditRow[] | null): Promise<void> => {
    setBusy(true);
    const base = own ? { week: sheet.period_start } : { employment: sheet.employment, week: sheet.period_start };
    const entriesOut = rows === null ? [] : rows.map((r, i) => ({ day, kind: r.kind, minutes: parsed[i] ?? 0, project: r.project.trim(), task: r.task.trim(), note: r.note.trim() }));
    const r = await act([], () => op('timesheets.save-entries', { ...base, entries: entriesOut, days: rows === null ? [day] : undefined }), READS.sheets);
    setBusy(false);
    if (r !== null) setEdit(null);
  };
  const sum = entries.reduce((s0, e) => s0 + e.minutes, 0);
  return (
    <li className={cn('border-t border-[var(--hr-hair)] px-3.5 py-2.5', future && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 shrink-0">
          <span className="hr-label block">{weekday(day)}</span>
          <span className="hr-mono hr-num text-[13px]">{fmtDay(day)}</span>
        </span>
        <span className="min-w-0 flex-1 text-[12px] text-[var(--hr-muted)]">
          {status !== '' ? statusLabel(status) : future ? t('time.ts.ahead') : ''}
          {worked > 0 ? ' · ' + t('time.ts.punched', { h: hm(worked) }) : ''}
          {mine && <Tag className="ml-2">{t('time.ts.edited')}</Tag>}
        </span>
        <span className="hr-mono hr-num text-[13px]">{sum > 0 ? hm(sum) : ''}</span>
        {editable && edit === null && !future && (
          <LinkButton onClick={start}>{entries.length > 0 ? t('time.ts.split') : t('time.ts.add_hours')}</LinkButton>
        )}
      </div>
      {edit === null ? (
        entries.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-0.5 pl-0 sm:pl-[120px]">
            {entries.map((e, i) => (
              <li key={e.id !== '' ? e.id : i} className="flex items-center gap-2 text-[13px]">
                <span className="w-20 shrink-0 text-[var(--hr-muted)]">{t('time.ts.kind.' + e.kind)}</span>
                <span className="hr-wrap min-w-0 flex-1">{e.project !== '' ? e.project + (e.task !== '' ? ' / ' + e.task : '') : ''}</span>
                <span className="hr-mono hr-num">{hm(e.minutes)}</span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="mt-2 flex flex-col gap-1.5 rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-sunk)] p-2.5">
          {edit.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <Select value={r.kind} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, kind: e.target.value as EntryKind } : x)))} aria-label={t('time.ts.kind_label')} className="w-[112px]">
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t('time.ts.kind.' + k)}
                  </option>
                ))}
              </Select>
              <Input value={r.time} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} placeholder="7:30" aria-label={t('time.ts.hours')} aria-invalid={parsed[i] === null} className="hr-mono w-[72px]" inputMode="decimal" />
              <Input value={r.project} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, project: e.target.value } : x)))} placeholder={t('time.ts.project')} aria-label={t('time.ts.project')} className="min-w-[120px] flex-1" />
              <Input value={r.task} onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, task: e.target.value } : x)))} placeholder={t('time.ts.task')} aria-label={t('time.ts.task')} className="w-[120px]" />
              <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" onClick={() => setEdit(edit.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <LinkButton onClick={() => setEdit([...edit, { kind: 'regular', time: '', project: '', task: '', note: '' }])}>
              <Plus size={12} aria-hidden />
              {t('time.ts.add_row')}
            </LinkButton>
            <span className="hr-num text-[12px] text-[var(--hr-muted)]">{t('time.ts.sum', { h: hm(parsed.reduce<number>((a, m) => a + (m ?? 0), 0)), punched: hm(worked) })}</span>
            <span className="flex-1" />
            {mine && (
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void save(null)}>
                {t('time.ts.back_to_punches')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {t('ui.cancel')}
            </Button>
            <Button size="sm" variant="primary" disabled={!ok} busy={busy} onClick={() => void save(edit)} iconRight={ArrowRight}>
              {t('ui.save')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function sheetStatusLabel(s: Sheet['status']): string {
  return t('time.ts.status.' + s);
}

export type { Entry };
