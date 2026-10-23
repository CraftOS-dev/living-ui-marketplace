/**
 * Timesheets. My week: a grid of project and task rows by day (on phones,
 * one day at a time), typed hours, totals, rows added from the projects
 * time can go to, Save and Submit; submitted, approved and billed time is
 * locked and shows its state. Team: submitted weeks to approve or reject
 * with a note. History: past weeks and where they stand.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, Clock, History, Inbox, Lock, Plus, Send, Trash2, Users, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { Tabs } from '../../components/controls.tsx';
import { PersonAvatar } from '../../components/people/common.tsx';
import { DataTable } from '../../components/table.tsx';
import { TIME_STATE, projectColor } from '../../components/work/common.tsx';
import { Card, CardHeader, CircleButton, Empty, LoadError, Notice, PageHeader, PillButton, PillSelect, Skeleton, StatusPill, cellInput, softArea } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { addDays, dayLabel, shortDay, today } from '../../lib/dates.ts';
import { hours, normalizeNumber, plural, qty } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { TimeEntry, TimeList, TimeStatus, Week, WeekRow } from '../../lib/types/work.ts';
import type { PageProps } from '../../routes.tsx';

type Tab = 'week' | 'team' | 'history';

function mondayOf(day: string): string {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return addDays(day, -((d.getDay() + 6) % 7));
}

function num(t: string): number {
  const n = Number(normalizeNumber(t, 2) ?? 'NaN');
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n === 0 ? '' : String(Math.round(n * 100) / 100);
}

/* ------------------------------------------------------------- my week */

interface GridRow {
  key: string;
  project: WeekRow['project'];
  task: { id: string; title: string } | null;
  cells: string[];
  locked: boolean[];
  status: string[];
}

function rowsOf(w: Week): GridRow[] {
  return w.rows.map((r) => ({
    key: r.key,
    project: r.project,
    task: r.task,
    cells: r.cells.map((c) => (c.locked ? fmt(c.hours) : fmt(c.hours))),
    locked: r.cells.map((c) => c.locked),
    status: r.cells.map((c) => c.status),
  }));
}

function MyWeek({ week, setWeek }: { week: string; setWeek: (w: string) => void }): React.JSX.Element {
  const live = useLive(() => op<Week>('timesheets.week', { week }, { quiet: true }), ['timesheets', 'projects', 'project_tasks', 'holidays'], [week]);
  const w = live.data;
  const [rows, setRows] = useState<GridRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addProject, setAddProject] = useState('');
  const [addTask, setAddTask] = useState('');
  const [day, setDay] = useState(0);
  useEffect(() => {
    if (w === null || dirty) return;
    setRows(rowsOf(w));
    const t = today();
    const i = w.days.findIndex((d) => d.date === t);
    setDay(i >= 0 ? i : 0);
  }, [w, dirty]);
  useEffect(() => {
    setDirty(false);
    setError(null);
  }, [week]);

  if (live.error !== null && w === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (w === null) return <Skeleton className="h-72" rounded="rounded-[24px]" />;

  const dayTotals = w.days.map((_, i) => rows.reduce((s, r) => s + num(r.cells[i] ?? ''), 0));
  const total = dayTotals.reduce((a, b) => a + b, 0);
  const editable = w.can.edit;
  const project = w.projects.find((p) => p.id === addProject);
  const rejected = w.entries.filter((e) => e.status === 'rejected');
  const hasOpen = rows.some((r) => r.cells.some((c, i) => !(r.locked[i] ?? false) && num(c) > 0));
  const thisWeek = mondayOf(today());

  const setCell = (key: string, i: number, v: string): void => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, cells: r.cells.map((c, j) => (j === i ? v : c)) } : r)));
    setDirty(true);
  };

  const payload = (): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      r.cells.forEach((c, i) => {
        if (r.locked[i] === true) return;
        const h = num(c);
        if (h <= 0) return;
        const date = w.days[i]?.date ?? '';
        const prior = w.entries.filter((e) => !e.locked && e.project.id === r.project.id && (e.task?.id ?? '') === (r.task?.id ?? '') && e.date === date);
        const first = prior[0];
        const same = prior.length > 0 && Math.abs(prior.reduce((s, e) => s + e.hours, 0) - h) < 1e-9;
        if (same) for (const e of prior) out.push({ project: r.project.id, task: r.task?.id ?? '', date, hours: e.hours, billable: e.billable, description: e.description });
        else out.push({ project: r.project.id, task: r.task?.id ?? '', date, hours: h, ...(first !== undefined ? { billable: first.billable, description: first.description } : {}) });
      });
    }
    return out;
  };

  const save = async (submit: boolean): Promise<void> => {
    setBusy(submit ? 'submit' : 'save');
    setError(null);
    try {
      let next = w;
      if (dirty) next = await op<Week>('timesheets.save-week', { week: w.week, entries: payload() }, { quiet: true });
      if (submit) next = await op<Week>('timesheets.submit', { week: w.week }, { quiet: true });
      live.set(next);
      setDirty(false);
      setRows(rowsOf(next));
      toast.success(submit ? `Week sent to ${next.employee.manager?.name ?? 'your manager'}` : 'Saved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copyLastWeek = async (): Promise<void> => {
    try {
      const prev = await op<Week>('timesheets.week', { week: w.prev_week }, { quiet: true });
      const open = new Set(w.projects.map((p) => p.id));
      const fresh = prev.rows.filter((r) => open.has(r.project.id) && !rows.some((x) => x.key === r.key));
      if (fresh.length === 0) {
        toast.error('Last week has no rows on active projects');
        return;
      }
      setRows((rs) => [...rs, ...fresh.map((r) => ({ key: r.key, project: r.project, task: r.task, cells: ['', '', '', '', '', '', ''], locked: [false, false, false, false, false, false, false], status: ['', '', '', '', '', '', ''] }))]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const addRow = (): void => {
    if (project === undefined) return;
    const task = project.tasks.find((t) => t.id === addTask) ?? null;
    const key = `${project.id}|${task?.id ?? ''}`;
    if (rows.some((r) => r.key === key)) {
      toast.error('That row is already on the week');
      return;
    }
    setRows((rs) => [
      ...rs,
      { key, project: { id: project.id, code: project.code, name: project.name, color: project.color, status: 'active', billing: project.billing }, task: task !== null ? { id: task.id, title: task.title } : null, cells: ['', '', '', '', '', '', ''], locked: [false, false, false, false, false, false, false], status: ['', '', '', '', '', '', ''] },
    ]);
    setAddProject('');
    setAddTask('');
  };

  // Plain render helpers (not components): a component defined here would remount its input on every keystroke.
  const cell = (r: GridRow, i: number, wide: boolean): React.JSX.Element => {
    const locked = r.locked[i] === true;
    const st = (r.status[i] ?? '') as TimeStatus | 'mixed' | '';
    if (locked || !editable) {
      return (
        <span
          title={st !== '' ? TIME_STATE[st].label : undefined}
          className={cn(
            'num flex h-10 items-center justify-center gap-1 rounded-[12px] text-[14px] font-semibold',
            st === 'approved' || st === 'invoiced' ? 'bg-[var(--erp-green)]/12 text-[var(--erp-green-text)]' : st === 'submitted' ? 'bg-[var(--erp-amber)]/20 text-[var(--erp-amber-text)]' : 'text-[var(--erp-ink-2)]',
            wide ? 'w-full' : 'w-24',
          )}
        >
          {locked && <Lock size={11} aria-hidden />}
          {r.cells[i]}
        </span>
      );
    }
    return (
      <input
        value={r.cells[i] ?? ''}
        onChange={(e) => setCell(r.key, i, e.target.value)}
        onBlur={(e) => {
          const n = normalizeNumber(e.target.value, 2);
          if (e.target.value.trim() !== '' && n !== null) setCell(r.key, i, fmt(Number(n)));
        }}
        inputMode="decimal"
        aria-label={`${r.project.name}${r.task !== null ? `, ${r.task.title}` : ''}, ${dayLabel(w.days[i]?.date ?? '')}`}
        placeholder="0"
        className={cn(cellInput, 'num text-center', st === 'rejected' && 'ring-2 ring-[var(--erp-red)]', wide ? '' : 'w-24')}
      />
    );
  };

  const rowLabel = (r: GridRow): React.JSX.Element => (
    <button type="button" onClick={() => navigate('project', { id: r.project.id })} className="flex min-w-0 items-center gap-2.5 text-left">
      <span aria-hidden className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: projectColor(r.project.color) }} />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold">{r.project.name}</span>
        <span className="block truncate text-[12px] text-[var(--erp-muted)]">{r.task !== null ? r.task.title : r.project.code}</span>
      </span>
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full bg-[var(--erp-card)] p-1">
          <CircleButton icon={ChevronLeft} label="Previous week" variant="ghost" size={36} onClick={() => setWeek(w.prev_week)} />
          <span className="min-w-[10rem] text-center text-[14px] font-bold">
            {shortDay(w.week)} to {shortDay(addDays(w.week, 6))}
          </span>
          <CircleButton icon={ChevronRight} label="Next week" variant="ghost" size={36} onClick={() => setWeek(w.next_week)} />
        </div>
        {w.week !== thisWeek && (
          <PillButton size="sm" variant="ghost" onClick={() => setWeek(thisWeek)}>
            This week
          </PillButton>
        )}
        <StatusPill tone={TIME_STATE[w.status].tone}>{w.status === 'empty' ? 'Nothing logged' : TIME_STATE[w.status].label}</StatusPill>
        <span className="flex-1" />
        <span className="num text-[13px] text-[var(--erp-muted)]">
          <span className="text-[15px] font-extrabold text-[var(--erp-ink)]">{hours(total)}</span> this week
        </span>
      </div>

      {rejected.length > 0 && (
        <Notice tone="bad" icon={AlertTriangle}>
          <p className="font-semibold">Sent back to you: change the time and submit again.</p>
          <ul className="mt-1">
            {rejected.map((e) => (
              <li key={e.id}>
                {e.project.name}, {dayLabel(e.date)}, {hours(e.hours)}
                {e.note !== '' ? `: ${e.note}` : ''}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <Card padded={false}>
        {/* Wide screens: the whole week */}
        <div className="hidden relative overflow-x-auto p-4 @min-[640px]:block @min-[640px]:p-5">
          <table className="w-full min-w-[760px] border-separate border-spacing-y-1.5">
            <thead>
              <tr>
                <th className="min-w-[200px] whitespace-nowrap pb-1 text-left text-[12px] font-semibold text-[var(--erp-muted)]">Project and task</th>
                {w.days.map((d, i) => (
                  <th key={d.date} className="w-24 pb-1 text-center" title={d.holiday !== '' ? d.holiday : undefined}>
                    <span className={cn('mx-auto flex w-[88px] flex-col items-center rounded-[12px] py-1', d.holiday !== '' && 'bg-[var(--erp-accent-soft)]', d.date === today() && 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]')}>
                      <span className="text-[12px] font-semibold">{d.day}</span>
                      <span className={cn('num text-[12px]', d.date === today() ? '' : 'text-[var(--erp-muted)]')}>{d.holiday !== '' ? 'Holiday' : shortDay(d.date)}</span>
                    </span>
                    <span className="sr-only">{dayLabel(w.days[i]?.date ?? '')}</span>
                  </th>
                ))}
                <th className="w-20 pb-1 text-right text-[12px] font-semibold text-[var(--erp-muted)]">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rt = r.cells.reduce((s, c) => s + num(c), 0);
                const removable = editable && !r.locked.some((x) => x);
                return (
                  <tr key={r.key}>
                    <td className="max-w-[240px] pr-3">
                      {rowLabel(r)}
                    </td>
                    {w.days.map((d, i) => (
                      <td key={d.date} className="px-0.5 text-center">
                        <div className="mx-auto w-[88px]">
                          {cell(r, i, true)}
                        </div>
                      </td>
                    ))}
                    <td className="num pl-2 text-right text-[14px] font-bold">{rt > 0 ? qty(Math.round(rt * 100) / 100) : ''}</td>
                    <td className="pl-1 text-right">
                      {removable && (
                        <CircleButton
                          icon={Trash2}
                          label={`Remove ${r.project.name}`}
                          variant="ghost"
                          size={32}
                          onClick={() => {
                            setRows((rs) => rs.filter((x) => x.key !== r.key));
                            setDirty(true);
                          }}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center">
                    <p className="text-[13px] text-[var(--erp-muted)]">No time this week yet.</p>
                    {editable && (
                      <PillButton size="sm" variant="soft" icon={History} className="mt-3" onClick={() => void copyLastWeek()}>
                        Same rows as last week
                      </PillButton>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="border-t border-[var(--erp-line)] pt-3 text-[13px] font-bold">Total</td>
                {dayTotals.map((t, i) => (
                  <td key={i} className={cn('num border-t border-[var(--erp-line)] pt-3 text-center text-[13px] font-bold', t > 24 && 'text-[var(--erp-red-text)]')}>
                    {t > 0 ? qty(Math.round(t * 100) / 100) : ''}
                  </td>
                ))}
                <td className="num border-t border-[var(--erp-line)] pt-3 text-right text-[15px] font-extrabold">{qty(Math.round(total * 100) / 100)}</td>
                <td className="border-t border-[var(--erp-line)]" />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Phones: one day at a time */}
        <div className="p-4 @min-[640px]:hidden">
          <div role="tablist" aria-label="Day" className="grid grid-cols-7 gap-1">
            {w.days.map((d, i) => (
              <button
                key={d.date}
                type="button"
                role="tab"
                aria-selected={day === i}
                onClick={() => setDay(i)}
                className={cn(
                  'flex flex-col items-center rounded-[14px] py-1.5 transition-colors',
                  day === i ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : d.holiday !== '' ? 'bg-[var(--erp-accent-soft)]' : 'bg-[var(--erp-row)]',
                )}
              >
                <span className="text-[12px] font-semibold">{d.day.slice(0, 2)}</span>
                <span className="num text-[12px] font-bold">{dayTotals[i] !== undefined && dayTotals[i] > 0 ? qty(Math.round((dayTotals[i] ?? 0) * 10) / 10) : Number(d.date.slice(8, 10))}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[13px] font-bold">
            {dayLabel(w.days[day]?.date ?? w.week)}
            {(w.days[day]?.holiday ?? '') !== '' && <span className="ml-2 font-semibold text-[var(--erp-muted)]">{w.days[day]?.holiday}</span>}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 rounded-[18px] bg-[var(--erp-row)] p-2 pl-3">
                <div className="min-w-0 flex-1">
                  {rowLabel(r)}
                </div>
                <div className="w-24 shrink-0">
                  {cell(r, day, true)}
                </div>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="flex flex-col items-center gap-3 py-6 text-center text-[13px] text-[var(--erp-muted)]">
                No time this week yet.
                {editable && (
                  <PillButton size="sm" variant="soft" icon={History} onClick={() => void copyLastWeek()}>
                    Same rows as last week
                  </PillButton>
                )}
              </li>
            )}
          </ul>
        </div>

        {editable && (
          <div className="flex flex-col gap-2 border-t border-[var(--erp-line)] p-4 @min-[480px]:flex-row @min-[480px]:items-center @min-[640px]:px-5">
            <PillSelect
              soft
              value={addProject}
              onChange={(v) => {
                setAddProject(v);
                setAddTask('');
              }}
              ariaLabel="Project"
              className="@min-[480px]:w-72"
              options={[{ value: '', label: 'Add a project...' }, ...w.projects.map((p) => ({ value: p.id, label: `${p.member ? '' : '  '}${p.code} ${p.name}` }))]}
            />
            {project !== undefined && project.tasks.length > 0 && (
              <PillSelect soft value={addTask} onChange={setAddTask} ariaLabel="Task" className="@min-[480px]:w-64" options={[{ value: '', label: 'No task' }, ...project.tasks.map((t) => ({ value: t.id, label: `${t.title}${t.mine ? ' (yours)' : ''}` }))]} />
            )}
            <PillButton variant="soft" icon={Plus} disabled={project === undefined} onClick={addRow}>
              Add row
            </PillButton>
          </div>
        )}
      </Card>

      {error !== null && (
        <Notice tone="bad" icon={AlertTriangle}>
          {error}
        </Notice>
      )}
      {editable && (
        <div className="z-10 flex flex-wrap items-center justify-end gap-2 @min-[640px]:sticky @min-[640px]:bottom-4">
          {dirty && <span className="mr-auto rounded-full bg-[var(--erp-card)] px-3 py-1.5 text-[12px] font-semibold text-[var(--erp-ink-2)] shadow-[var(--erp-shadow)]">Not saved yet</span>}
          <PillButton variant="light" loading={busy === 'save'} disabled={!dirty || busy !== null} onClick={() => void save(false)}>
            Save
          </PillButton>
          <PillButton icon={Send} dot loading={busy === 'submit'} disabled={busy !== null || !(w.can.submit || (dirty && hasOpen))} onClick={() => void save(true)}>
            Submit week
          </PillButton>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- team */

interface Group {
  key: string;
  employee: { id: string; name: string };
  week: string;
  entries: TimeEntry[];
  hours: number;
  billable: number;
}

function TeamGroup({ g, onDone }: { g: Group; onDone: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const byProject = new Map<string, { name: string; hours: number }>();
  for (const e of g.entries) {
    const x = byProject.get(e.project.id) ?? { name: e.project.name, hours: 0 };
    x.hours += e.hours;
    byProject.set(e.project.id, x);
  }
  const decide = async (approve: boolean): Promise<void> => {
    setBusy(approve ? 'a' : 'r');
    try {
      await op('timesheets.decide', { ids: g.entries.map((e) => e.id), approve, note: note.trim() === '' ? undefined : note.trim() });
      toast.success(approve ? `Approved ${hours(g.hours)}` : 'Sent back');
      onDone();
    } catch {
      /* shown */
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="rounded-[20px] bg-[var(--erp-row)] p-3 @min-[640px]:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <PersonAvatar name={g.employee.name} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{g.employee.name}</span>
            <span className="block truncate text-[12px] text-[var(--erp-muted)]">
              Week of {shortDay(g.week)} · {[...byProject.values()].map((p) => `${p.name} ${qty(Math.round(p.hours * 100) / 100)} h`).join(', ')}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="num block text-[15px] font-extrabold">{hours(g.hours)}</span>
            <span className="num block text-[12px] text-[var(--erp-muted)]">{hours(g.billable)} billable</span>
          </span>
        </button>
        {!rejecting && (
          <div className="flex w-full justify-end gap-2 @min-[480px]:w-auto">
            <PillButton size="sm" variant="light" icon={X} onClick={() => setRejecting(true)}>
              Reject
            </PillButton>
            <PillButton size="sm" icon={Check} loading={busy === 'a'} onClick={() => void decide(true)}>
              Approve
            </PillButton>
          </div>
        )}
      </div>
      {open && (
        <ul className="mt-3 flex flex-col gap-1 rounded-[16px] bg-[var(--erp-card)] p-2">
          {g.entries.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-[12px] px-2 py-1.5 text-[13px]">
              <span className="w-24 shrink-0 text-[var(--erp-muted)]">{dayLabel(e.date)}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{e.project.name}</span>
                {e.task !== null ? ` · ${e.task.title}` : ''}
                {e.description !== '' ? <span className="text-[var(--erp-muted)]"> · {e.description}</span> : null}
              </span>
              {!e.billable && <span className="text-[12px] text-[var(--erp-muted)]">not billable</span>}
              <span className="num w-14 text-right font-bold">{qty(e.hours)} h</span>
            </li>
          ))}
        </ul>
      )}
      {rejecting && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus aria-label="Why not" placeholder={`What to change (${g.employee.name.split(' ')[0] ?? ''} reads this)`} className={cn(softArea, 'min-h-[56px] bg-[var(--erp-card)]')} />
          <div className="flex justify-end gap-2">
            <PillButton size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Keep it
            </PillButton>
            <PillButton size="sm" variant="danger" loading={busy === 'r'} onClick={() => void decide(false)}>
              Send back
            </PillButton>
          </div>
        </div>
      )}
    </li>
  );
}

function TeamTab({ scope }: { scope: 'team' | 'all' }): React.JSX.Element {
  const live = useLive(() => op<TimeList>('timesheets.list', { scope, status: 'submitted', limit: 1000 }, { quiet: true }), ['timesheets'], [scope]);
  const me = useMe();
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const e of live.data?.entries ?? []) {
      if (me.employee !== null && e.employee.id === me.employee.id) continue;
      const week = mondayOf(e.date);
      const key = `${e.employee.id}|${week}`;
      let g = m.get(key);
      if (g === undefined) {
        g = { key, employee: e.employee, week, entries: [], hours: 0, billable: 0 };
        m.set(key, g);
      }
      g.entries.push(e);
      g.hours += e.hours;
      if (e.billable) g.billable += e.hours;
    }
    return [...m.values()].sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : a.employee.name.localeCompare(b.employee.name)));
  }, [live.data, me.employee]);
  return (
    <Card>
      <CardHeader title="Weeks waiting for approval" subtitle={live.data !== null ? `${plural(groups.length, 'week')}, ${hours(groups.reduce((s, g) => s + g.hours, 0))}` : undefined} icon={Inbox} />
      {live.error !== null && live.data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : live.data === null ? (
        <Skeleton className="h-20" />
      ) : groups.length === 0 ? (
        <Empty icon={Inbox} title="Nothing waiting" compact>
          Weeks {scope === 'team' ? 'your team submits' : 'people submit'} show here.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <TeamGroup key={g.key} g={g} onDone={live.reload} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- history */

function HistoryTab({ onOpen }: { onOpen: (week: string) => void }): React.JSX.Element {
  const from = addDays(mondayOf(today()), -7 * 25);
  const live = useLive(() => op<TimeList>('timesheets.list', { scope: 'mine', from, limit: 1000 }, { quiet: true }), ['timesheets'], [from]);
  const weeks = useMemo(() => {
    const m = new Map<string, { week: string; hours: number; billable: number; by: Partial<Record<TimeStatus, number>> }>();
    for (const e of live.data?.entries ?? []) {
      const w = mondayOf(e.date);
      const g = m.get(w) ?? { week: w, hours: 0, billable: 0, by: {} };
      g.hours += e.hours;
      if (e.billable) g.billable += e.hours;
      g.by[e.status] = (g.by[e.status] ?? 0) + e.hours;
      m.set(w, g);
    }
    return [...m.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
  }, [live.data]);
  return (
    <Card>
      <CardHeader title="Past weeks" subtitle="The last six months" icon={History} />
      {live.error !== null && live.data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : (
        <DataTable
          ariaLabel="Past weeks"
          rows={weeks}
          loading={live.data === null}
          rowKey={(w) => w.week}
          onOpen={(w) => onOpen(w.week)}
          empty={<Empty icon={CalendarClock} title="No time logged yet" compact />}
          columns={[
            { key: 'w', label: 'Week', width: 'minmax(0, 1.4fr)', render: (w) => <span className="font-semibold">{`${shortDay(w.week)} to ${shortDay(addDays(w.week, 6))}`}</span> },
            {
              key: 's',
              label: 'Where it stands',
              width: 'minmax(0, 2fr)',
              hide: 'md',
              render: (w) => (
                <span className="flex flex-wrap gap-1.5">
                  {(Object.keys(w.by) as TimeStatus[]).map((s) => (
                    <StatusPill key={s} tone={TIME_STATE[s].tone} size="sm">
                      {TIME_STATE[s].label} {qty(Math.round((w.by[s] ?? 0) * 100) / 100)} h
                    </StatusPill>
                  ))}
                </span>
              ),
            },
            { key: 'b', label: 'Billable', width: '100px', align: 'right', hide: 'sm', render: (w) => hours(w.billable) },
            { key: 'h', label: 'Hours', width: '90px', align: 'right', render: (w) => <span className="font-bold">{hours(w.hours)}</span> },
          ]}
          mobile={(w) => ({ title: `${shortDay(w.week)} to ${shortDay(addDays(w.week, 6))}`, sub: (Object.keys(w.by) as TimeStatus[]).map((s) => TIME_STATE[s].label).join(', '), right: hours(w.hours) })}
        />
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- page */

export function TimesheetsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const self = me.employee !== null;
  const full = can(me, 'projects', 'full');
  const showTeam = me.manages > 0 || full;
  const tabs: { value: Tab; label: string; icon: typeof Clock }[] = [];
  if (self) tabs.push({ value: 'week', label: 'My week', icon: Clock });
  if (showTeam) tabs.push({ value: 'team', label: me.manages > 0 ? 'Team' : 'To approve', icon: Users });
  if (self) tabs.push({ value: 'history', label: 'History', icon: History });
  const asked = query.get('tab') as Tab | null;
  const tab: Tab = asked !== null && tabs.some((t) => t.value === asked) ? asked : (tabs[0]?.value ?? 'week');
  const week = mondayOf(query.get('week') ?? today());
  const go = (patch: Record<string, string | undefined>): void => replaceQuery('timesheets', { tab: tab === tabs[0]?.value ? undefined : tab, week: query.get('week') ?? undefined, ...patch });

  return (
    <div>
      <PageHeader title="Timesheets" subtitle={!self ? 'Your account has no employee record, so it keeps no timesheet' : undefined} />
      {tabs.length > 1 && <Tabs ariaLabel="Timesheets" value={tab} onChange={(t) => go({ tab: t === tabs[0]?.value ? undefined : t })} tabs={tabs} />}
      {tab === 'week' && self && <MyWeek week={week} setWeek={(w) => go({ week: w === mondayOf(today()) ? undefined : w })} />}
      {tab === 'team' && <TeamTab scope={me.manages > 0 && !full ? 'team' : full ? 'all' : 'team'} />}
      {tab === 'history' && <HistoryTab onOpen={(w) => replaceQuery('timesheets', { week: w })} />}
    </div>
  );
}
