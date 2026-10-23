/**
 * Every experiment in a project, in one place.
 *
 *   Board        the default view: by status; drag a card to start, pause or
 *                finish it
 *   In progress  (Table and Timeline) a card per running or paused
 *                experiment: how long it has run, the next protocol step
 *                (tick it here), and a line to write in its journal
 *   Table        grouped by status (or kind), sortable, searchable, filtered
 *                by status, outcome, kind and tag; pinned ones first
 *   Timeline     planned and actual dates as bars, today marked
 *
 * Research behind it: reports/Experiments redesign.md.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarRange, Check, Columns3, FlaskConical, LayoutList, Pin, Play, Plus, Search, SendHorizontal } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { changed, useLive } from '../../lib/live.ts';
import { ago, clip, num, plural } from '../../lib/format.ts';
import { replaceQuery } from '../../lib/router.ts';
import type { ExpKind, ExpOutcome, ExpStatus, ExpTemplate, Experiment, Project } from '../../lib/types.ts';
import { Button, Empty, Field, IconButton, LoadError, Modal, Segmented, Select, Skeleton, inputCls, textareaCls } from '../ui.tsx';
import { ExperimentPage } from './Page.tsx';
import { dayDate, KIND, KindLabel, OUTCOME, OutcomeFlag, parseAt, RunsBar, saveExp, shortDate, STATUS, STATUS_ORDER, StatusChip, tplus, useNow, whenText } from './shared.tsx';

type View = 'table' | 'board' | 'timeline';
const BOARD: ExpStatus[] = ['planned', 'running', 'paused', 'done', 'cancelled'];
const DRAG = 'application/x-research-experiment';

export const openExp = (id: string): void => replaceQuery({ exp: id });

export function ExperimentsView({ project, expId }: { project: Project; expId: string }): React.JSX.Element {
  return expId === '' ? <Hub project={project} /> : <ExperimentPage key={expId} project={project} id={expId} />;
}

/** The line under a title: what is next, else the hypothesis, else the conclusion. */
function subline(e: Experiment): string {
  if ((e.status === 'running' || e.status === 'paused') && e.next_step !== null) return 'Next: step ' + (e.next_step.index + 1) + ', ' + e.next_step.text;
  if (e.status === 'done' && e.summary !== '') return e.summary;
  if (e.hypothesis !== '') return e.hypothesis;
  if (e.aim !== '') return e.aim;
  return '';
}

/* ------------------------------------------------------------------ hub */

function Hub({ project }: { project: Project }): React.JSX.Element {
  // Board unless this browser picked another view.
  const [view, setView] = useState<View>(() => {
    try {
      const v = localStorage.getItem('ro_exp_hub_view');
      return v === 'table' || v === 'timeline' ? v : 'board';
    } catch {
      return 'board';
    }
  });
  const pickView = (v: View): void => {
    setView(v);
    try {
      localStorage.setItem('ro_exp_hub_view', v);
    } catch {
      /* a convenience */
    }
  };
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | ExpStatus>('all');
  const [outcome, setOutcome] = useState<'all' | ExpOutcome | 'none'>('all');
  const [kind, setKind] = useState<'all' | ExpKind>('all');
  const [tag, setTag] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useLive((signal) => op<{ experiments: Experiment[] }>('exp.list', { project: project.id }, { quiet: true, signal }).then((r) => r.experiments), ['experiments', 'exp_runs', 'exp_log'], [project.id], 120);
  const all = list.data ?? [];
  const tags = useMemo(() => [...new Set(all.flatMap((e) => e.tags))].sort(), [all]);
  const needle = q.trim().toLowerCase();
  const shown = all.filter(
    (e) =>
      (status === 'all' || e.status === status) &&
      (outcome === 'all' || (outcome === 'none' ? e.outcome === '' : e.outcome === outcome)) &&
      (kind === 'all' || e.kind === kind) &&
      (tag === '' || e.tags.includes(tag)) &&
      (needle === '' || (e.code + ' ' + e.title + ' ' + e.aim + ' ' + e.hypothesis + ' ' + e.tags.join(' ')).toLowerCase().includes(needle)),
  );
  const count = (s: ExpStatus): number => all.filter((e) => e.status === s).length;
  const active = all.filter((e) => e.status === 'running' || e.status === 'paused');
  return (
    <div data-scroll className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex w-full flex-col gap-3 p-4">
        <header className="flex flex-wrap items-center gap-2">
          <FlaskConical size={16} className="text-[var(--ro-muted)]" />
          <h1 className="text-[15px] font-bold">Experiments</h1>
          <span className="num text-[12px] text-[var(--ro-muted)]">{num(all.length)}</span>
          <span className="flex-1" />
          <label className="flex h-8 w-56 items-center gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-2 focus-within:border-[var(--ro-ink)]">
            <Search size={13} className="shrink-0 text-[var(--ro-muted)]" />
            <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Find an experiment" aria-label="Find an experiment" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
          </label>
          <Segmented
            label="View"
            value={view}
            onChange={pickView}
            options={[
              { value: 'table', label: 'Table', icon: LayoutList },
              { value: 'board', label: 'Board', icon: Columns3 },
              { value: 'timeline', label: 'Timeline', icon: CalendarRange },
            ]}
          />
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New experiment
          </Button>
        </header>

        {list.error !== null ? (
          <LoadError message={list.error} onRetry={list.reload} />
        ) : list.data === null ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <div className="rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] py-12">
            <Empty icon={FlaskConical} title="No experiments yet" action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New experiment</Button>}>
              Plan what you vary and what you measure, follow the protocol step by step, record every run, and keep a journal as it happens. Bench, chemistry, simulation, a study with people or field work.
            </Empty>
          </div>
        ) : (
          <>
            {active.length > 0 && view !== 'board' && <RunningNow list={active} />}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex max-w-full items-center gap-1.5 overflow-x-auto">
              {(['all', 'running', 'paused', 'planned', 'done', 'cancelled'] as const).map((s) => {
                const n = s === 'all' ? all.length : count(s);
                if (s !== 'all' && n === 0 && status !== s) return null;
                return (
                  <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--ro-r)] border px-2.5 text-[12px] font-semibold', status === s ? 'border-[var(--ro-ink)] bg-[var(--ro-card)] text-[var(--ro-ink)]' : 'border-[var(--ro-line)] bg-[var(--ro-card)] text-[var(--ro-ink-2)] hover:text-[var(--ro-ink)]')}>
                    {s !== 'all' && <span className="size-2 rounded-full" style={{ background: STATUS[s].dot }} />}
                    {s === 'all' ? 'All' : STATUS[s].label} <span className="num font-normal text-[var(--ro-muted)]">{n}</span>
                  </button>
                );
              })}
              </div>
              <span className="mx-1 hidden h-5 w-px bg-[var(--ro-line)] @min-[700px]:block" />
              <div className="flex w-full items-center gap-1.5 @min-[700px]:w-auto">
                <Select ariaLabel="Outcome" className="flex-1 @min-[700px]:w-40 @min-[700px]:flex-none" value={outcome} onChange={(v) => setOutcome(v as typeof outcome)} options={[{ value: 'all', label: 'Any outcome' }, ...(Object.keys(OUTCOME) as ExpOutcome[]).map((o) => ({ value: o, label: OUTCOME[o].short })), { value: 'none', label: 'No outcome yet' }]} />
                <Select ariaLabel="Kind" className="flex-1 @min-[700px]:w-36 @min-[700px]:flex-none" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: 'all', label: 'Any kind' }, ...(Object.keys(KIND) as ExpKind[]).map((k) => ({ value: k, label: KIND[k].label }))]} />
                {tags.length > 0 && <Select ariaLabel="Tag" className="flex-1 @min-[700px]:w-36 @min-[700px]:flex-none" value={tag} onChange={setTag} options={[{ value: '', label: 'Any tag' }, ...tags.map((t) => ({ value: t, label: '#' + t }))]} />}
              </div>
              {shown.length !== all.length && <span className="num ml-auto text-[12px] text-[var(--ro-muted)]">{shown.length} of {all.length}</span>}
            </div>
            {shown.length === 0 ? (
              <p className="rounded-[var(--ro-r-md)] border border-dashed border-[var(--ro-line)] py-8 text-center text-[12px] text-[var(--ro-muted)]">No experiment matches.</p>
            ) : view === 'table' ? (
              <TableView rows={shown} />
            ) : view === 'board' ? (
              <BoardView rows={shown} />
            ) : (
              <TimelineView rows={shown} />
            )}
          </>
        )}
      </div>
      <NewExperiment project={project.id} open={creating} onClose={() => setCreating(false)} onMade={openExp} />
    </div>
  );
}

/* ---------------------------------------------------------- running now */

function RunningNow({ list }: { list: Experiment[] }): React.JSX.Element {
  return (
    <section aria-label="In progress" className="flex flex-col gap-2">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-ink-2)]">In progress</h2>
      <div className="grid grid-cols-1 gap-2 @min-[760px]:grid-cols-2 @min-[1200px]:grid-cols-3">
        {list.map((e) => (
          <RunningCard key={e.id} e={e} />
        ))}
      </div>
    </section>
  );
}

function RunningCard({ e }: { e: Experiment }): React.JSX.Element {
  const now = useNow(30000);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ns = e.next_step;
  const tick = async (): Promise<void> => {
    if (ns === null) return;
    try {
      await op('exp.step', { experiment: e.id, step: ns.id, done: true });
      changed('experiments', 'exp_log');
    } catch {
      /* toasted */
    }
  };
  const log = async (): Promise<void> => {
    if (text.trim() === '' || busy) return;
    setBusy(true);
    try {
      await op('exp.log', { experiment: e.id, kind: 'observation', text: text.trim() });
      setText('');
      changed('exp_log', 'experiments');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3 shadow-[var(--ro-shadow-sm)]">
      <button type="button" onClick={() => openExp(e.id)} className="flex min-w-0 items-center gap-2 text-left">
        <span className="num shrink-0 text-[12px] font-semibold text-[var(--ro-muted)]">{e.code}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{e.title}</span>
        <StatusChip status={e.status} />
      </button>
      <span className="num text-[12px] text-[var(--ro-muted)]">
        {[e.started_at !== '' ? tplus(e.started_at, new Date(now).toISOString().replace('T', ' ')) : '', e.counts.steps > 0 ? e.counts.steps_done + '/' + e.counts.steps + ' steps' : '', e.counts.runs > 0 ? e.counts.done + '/' + e.counts.runs + ' runs' : ''].filter(Boolean).join(' · ')}
      </span>
      {ns !== null ? (
        <span className="flex items-start gap-2 rounded-[var(--ro-r)] bg-[var(--ro-row)] px-2 py-1.5">
          <span className="min-w-0 flex-1 text-[12px] leading-4">
            <span className="font-semibold text-[var(--ro-ink-2)]">Step {ns.index + 1}</span> {clip(ns.text, 120)}
          </span>
          {e.status === 'paused' ? (
            <Button size="sm" icon={Play} onClick={() => void saveExp(e.id, { status: 'running' })} title="Resume the experiment">
              Resume
            </Button>
          ) : (
            <Button size="sm" icon={Check} onClick={() => void tick()} title="Mark this step done">
              Done
            </Button>
          )}
        </span>
      ) : (
        <span className="text-[12px] text-[var(--ro-muted)]">{e.counts.steps === 0 ? 'No protocol steps.' : 'Every step is done.'}</span>
      )}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void log();
        }}
        className="flex items-center gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] pl-2 focus-within:border-[var(--ro-ink)]"
      >
        <input value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Write an observation in the journal" aria-label={'Journal entry for ' + e.code} className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        <IconButton icon={SendHorizontal} label="Write it (Enter)" size={28} type="submit" disabled={text.trim() === '' || busy} />
      </form>
    </article>
  );
}

/* ----------------------------------------------------------------- table */

type SortKey = 'number' | 'title' | 'status' | 'when' | 'runs' | 'last';

function sortValue(e: Experiment, k: SortKey): number | string {
  if (k === 'number') return e.number;
  if (k === 'title') return e.title.toLowerCase();
  if (k === 'status') return STATUS_ORDER.indexOf(e.status);
  if (k === 'runs') return e.counts.runs === 0 ? -1 : e.counts.done / e.counts.runs;
  if (k === 'last') return e.last_log;
  return e.started_at !== '' ? e.started_at : e.planned_start !== '' ? e.planned_start : '9999';
}

function TableView({ rows }: { rows: Experiment[] }): React.JSX.Element {
  const [group, setGroup] = useState<'status' | 'kind' | 'none'>('status');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'number', dir: -1 });
  const now = useNow(60000);
  const sorted = rows.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir || b.number - a.number;
  });
  const groups: { key: string; label: string; dot?: string; rows: Experiment[] }[] =
    group === 'none'
      ? [{ key: 'all', label: '', rows: sorted }]
      : group === 'status'
        ? STATUS_ORDER.map((s) => ({ key: s, label: STATUS[s].label, dot: STATUS[s].dot, rows: sorted.filter((e) => e.status === s) })).filter((g) => g.rows.length > 0)
        : (Object.keys(KIND) as ExpKind[]).map((k) => ({ key: k, label: KIND[k].label, rows: sorted.filter((e) => e.kind === k) })).filter((g) => g.rows.length > 0);
  const head = (k: SortKey, label: string, className?: string): React.JSX.Element => (
    <th className={cn('h-8 px-2 text-left font-semibold', className)}>
      <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === 'number' || k === 'last' ? -1 : 1 }))} className="inline-flex items-center gap-1 hover:text-[var(--ro-ink)]">
        {label}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
  const togglePin = (e: Experiment): void => void saveExp(e.id, { pinned: !e.pinned });
  return (
    <div className="overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
      <div className="flex items-center gap-2 border-b border-[var(--ro-hair)] px-3 py-1.5">
        <span className="text-[12px] text-[var(--ro-muted)]">Group by</span>
        <Segmented label="Group by" size="sm" value={group} onChange={setGroup} options={[{ value: 'status', label: 'Status' }, { value: 'kind', label: 'Kind' }, { value: 'none', label: 'None' }]} />
      </div>
      <ul className="flex flex-col @min-[700px]:hidden">
        {groups.map((g) => (
          <li key={g.key} className="flex flex-col">
            {g.label !== '' && (
              <span className="flex items-center gap-1.5 border-b border-[var(--ro-hair)] bg-[var(--ro-row)] px-3 py-1 text-[12px] font-bold text-[var(--ro-ink-2)]">
                {g.dot !== undefined && <span className="size-2 rounded-full" style={{ background: g.dot }} />}
                {g.label} <span className="num font-normal text-[var(--ro-muted)]">{g.rows.length}</span>
              </span>
            )}
            {g.rows.map((e) => (
              <button key={e.id} type="button" onClick={() => openExp(e.id)} className="flex flex-col gap-1 border-b border-[var(--ro-hair)] px-3 py-2 text-left hover:bg-[var(--ro-row)]">
                <span className="flex items-center gap-2">
                  <span className="num text-[12px] font-semibold text-[var(--ro-muted)]">{e.code}</span>
                  {e.pinned && <Pin size={11} className="text-[var(--ro-accent)]" aria-label="Pinned" />}
                  <span className="flex-1" />
                  <OutcomeFlag outcome={e.outcome} short />
                  {group !== 'status' && <StatusChip status={e.status} />}
                </span>
                <span className="text-[13px] font-semibold leading-[18px]">{e.title}</span>
                {subline(e) !== '' && <span className="line-clamp-2 text-[12px] leading-4 text-[var(--ro-muted)]">{subline(e)}</span>}
                <span className="num text-[12px] text-[var(--ro-ink-2)]">{[whenText(e, now), e.counts.runs > 0 ? e.counts.done + '/' + e.counts.runs + ' runs' : ''].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto @min-[700px]:block">
        <table className="w-full min-w-[880px] table-fixed border-separate border-spacing-0 text-[13px]">
          <thead className="text-[12px] text-[var(--ro-muted)]">
            <tr>
              <th className="w-8" />
              {head('number', 'ID', 'w-[76px]')}
              {head('title', 'Experiment')}
              <th className="h-8 w-[112px] px-2 text-left font-semibold">Kind</th>
              {head('status', 'Status', 'w-[124px]')}
              {head('when', 'When', 'w-[156px]')}
              {head('runs', 'Runs', 'w-[150px]')}
              {head('last', 'Last entry', 'w-[96px]')}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              {g.label !== '' && (
                <tr>
                  <td colSpan={8} className="border-y border-[var(--ro-hair)] bg-[var(--ro-row)] px-3 py-1 text-[12px] font-bold text-[var(--ro-ink-2)]">
                    <span className="inline-flex items-center gap-1.5">
                      {g.dot !== undefined && <span className="size-2 rounded-full" style={{ background: g.dot }} />}
                      {g.label} <span className="num font-normal text-[var(--ro-muted)]">{g.rows.length}</span>
                    </span>
                  </td>
                </tr>
              )}
              {g.rows.map((e) => {
                const sub = subline(e);
                return (
                  <tr key={e.id} onClick={() => openExp(e.id)} className="group cursor-pointer hover:bg-[var(--ro-row)]">
                    <td className="border-b border-[var(--ro-hair)] pl-2 align-top">
                      <button
                        type="button"
                        aria-label={e.pinned ? 'Unpin' : 'Pin to the top'}
                        title={e.pinned ? 'Unpin' : 'Pin to the top'}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          togglePin(e);
                        }}
                        className={cn('mt-2 rounded-[var(--ro-r-sm)] p-1 hover:bg-[var(--ro-row-hover)]', e.pinned ? 'text-[var(--ro-accent)]' : 'text-[var(--ro-line)] opacity-0 group-hover:opacity-100')}
                      >
                        <Pin size={12} />
                      </button>
                    </td>
                    <td className="num whitespace-nowrap border-b border-[var(--ro-hair)] px-2 py-2 align-top text-[12px] font-semibold leading-5 text-[var(--ro-muted)]">{e.code}</td>
                    <td className="min-w-0 border-b border-[var(--ro-hair)] px-2 py-2 align-top">
                      <span className="block truncate font-semibold">{e.title}</span>
                      {sub !== '' && <span className={cn('mt-0.5 block truncate text-[12px]', e.status === 'running' || e.status === 'paused' ? 'text-[var(--ro-ink-2)]' : 'text-[var(--ro-muted)]')}>{sub}</span>}
                      {(e.tags.length > 0 || e.parent !== null) && (
                        <span className="mt-1 flex flex-wrap gap-1.5 text-[12px] text-[var(--ro-muted)]">
                          {e.parent !== null && <span>Repeat of {e.parent.code}</span>}
                          {e.tags.map((t) => (
                            <span key={t}>#{t}</span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-[var(--ro-hair)] px-2 py-2 align-top">
                      <KindLabel kind={e.kind} />
                    </td>
                    <td className="border-b border-[var(--ro-hair)] px-2 py-2 align-top">
                      <span className="flex flex-col items-start gap-1">
                        <StatusChip status={e.status} />
                        {e.outcome !== '' ? <OutcomeFlag outcome={e.outcome} short /> : e.status === 'done' && <span className="text-[12px] text-[var(--ro-muted)]">No outcome yet</span>}
                      </span>
                    </td>
                    <td className="num border-b border-[var(--ro-hair)] px-2 py-2 align-top text-[12px] text-[var(--ro-ink-2)]">{whenText(e, now)}</td>
                    <td className="border-b border-[var(--ro-hair)] px-2 py-2 align-top">
                      <RunsBar e={e} />
                    </td>
                    <td className="border-b border-[var(--ro-hair)] px-2 py-2 align-top text-[12px] text-[var(--ro-muted)]">{e.last_log !== '' ? ago(e.last_log) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- board */

function BoardView({ rows }: { rows: Experiment[] }): React.JSX.Element {
  const [over, setOver] = useState<ExpStatus | ''>('');
  const [moved, setMoved] = useState<Record<string, ExpStatus>>({});
  useEffect(() => {
    setMoved((m) => {
      const next = { ...m };
      for (const id of Object.keys(m)) if (rows.find((r) => r.id === id)?.status === m[id]) delete next[id];
      return next;
    });
  }, [rows]);
  const statusOf = (e: Experiment): ExpStatus => moved[e.id] ?? e.status;
  const drop = (ev: React.DragEvent, s: ExpStatus): void => {
    ev.preventDefault();
    setOver('');
    const id = ev.dataTransfer.getData(DRAG);
    const e = rows.find((r) => r.id === id);
    if (e === undefined || statusOf(e) === s) return;
    setMoved((m) => ({ ...m, [id]: s }));
    void saveExp(id, { status: s }).then((r) => {
      if (r === null) setMoved((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)));
    });
  };
  return (
    <div className="grid auto-cols-[minmax(188px,1fr)] grid-flow-col gap-2.5 overflow-x-auto pb-2">
      {BOARD.map((s) => {
        const col = rows.filter((e) => statusOf(e) === s).sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.number - a.number));
        return (
          <section
            key={s}
            onDragOver={(ev) => {
              if (!ev.dataTransfer.types.includes(DRAG)) return;
              ev.preventDefault();
              setOver(s);
            }}
            onDragLeave={(ev) => {
              if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setOver('');
            }}
            onDrop={(ev) => drop(ev, s)}
            className={cn('flex min-h-[320px] flex-col rounded-[var(--ro-r-md)] border bg-[var(--ro-stage)]', over === s ? 'border-[var(--ro-accent)]' : 'border-[var(--ro-line)]')}
          >
            <h3 className="flex h-9 shrink-0 items-center gap-2 px-3 text-[12px] font-bold">
              <span className="size-2 rounded-full" style={{ background: STATUS[s].dot }} />
              {STATUS[s].label} <span className="num font-normal text-[var(--ro-muted)]">{col.length}</span>
            </h3>
            <ul className="flex flex-col gap-1.5 p-2 pt-0">
              {col.map((e) => (
                <li
                  key={e.id}
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData(DRAG, e.id);
                    ev.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <button type="button" onClick={() => openExp(e.id)} className="flex w-full flex-col gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2.5 text-left shadow-[var(--ro-shadow-sm)] hover:border-[var(--ro-ink-2)]">
                    <span className="flex items-center gap-2">
                      <span className="num text-[12px] font-semibold text-[var(--ro-muted)]">{e.code}</span>
                      {e.pinned && <Pin size={11} className="text-[var(--ro-accent)]" aria-label="Pinned" />}
                      <span className="flex-1" />
                      <OutcomeFlag outcome={e.outcome} short />
                    </span>
                    <span className="text-[13px] font-semibold leading-[18px]">{e.title}</span>
                    {subline(e) !== '' && <span className="line-clamp-2 text-[12px] leading-4 text-[var(--ro-muted)]">{subline(e)}</span>}
                    <KindLabel kind={e.kind} />
                    {e.counts.runs > 0 && <RunsBar e={e} />}
                    {e.tags.length > 0 && (
                      <span className="flex flex-wrap gap-1.5 text-[12px] text-[var(--ro-muted)]">
                        {e.tags.map((t) => (
                          <span key={t}>#{t}</span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {col.length === 0 && <li className="rounded-[var(--ro-r)] border border-dashed border-[var(--ro-line)] px-3 py-4 text-center text-[12px] text-[var(--ro-muted)]">Drop an experiment here</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- timeline */

const DAY_MS = 86400000;
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function TimelineView({ rows }: { rows: Experiment[] }): React.JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const ro = new ResizeObserver((en) => setW(Math.floor(en[0]?.contentRect.width ?? 900)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const today = startOfDay(new Date());
  const span = (e: Experiment): { from: number; to: number; planned: boolean } | null => {
    if (e.started_at !== '') {
      const from = startOfDay(parseAt(e.started_at));
      const to = e.ended_at !== '' ? startOfDay(parseAt(e.ended_at)) : Math.max(today, from);
      return { from, to, planned: false };
    }
    if (e.planned_start !== '') {
      const from = startOfDay(dayDate(e.planned_start));
      const to = e.planned_end !== '' ? startOfDay(dayDate(e.planned_end)) : from;
      return { from, to: Math.max(from, to), planned: true };
    }
    return null;
  };
  const placed = rows.map((e) => ({ e, s: span(e) })).filter((x): x is { e: Experiment; s: { from: number; to: number; planned: boolean } } => x.s !== null).sort((a, b) => a.s.from - b.s.from);
  const unscheduled = rows.filter((e) => span(e) === null);
  const lo = Math.min(today - 7 * DAY_MS, ...placed.map((x) => x.s.from)) - 2 * DAY_MS;
  const hi = Math.max(today + 14 * DAY_MS, ...placed.map((x) => x.s.to)) + 3 * DAY_MS;
  const days = Math.round((hi - lo) / DAY_MS) + 1;
  const LABEL = 260;
  const dayW = Math.max(14, Math.min(48, (w - LABEL) / days));
  const x = (t: number): number => ((t - lo) / DAY_MS) * dayW;
  const months: { t: number; label: string }[] = [];
  const weeks: number[] = [];
  for (let t = lo; t <= hi; t += DAY_MS) {
    const d = new Date(t);
    if (d.getDate() === 1 || t === lo) months.push({ t, label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) });
    if (d.getDay() === 1) weeks.push(t);
  }
  const bar = (e: Experiment, planned: boolean): string => (planned ? 'var(--ro-card)' : e.status === 'done' ? (e.outcome === 'failed' || e.outcome === 'refutes' ? 'var(--ro-red)' : 'var(--ro-green)') : e.status === 'cancelled' ? 'var(--ro-line)' : e.status === 'paused' ? 'var(--ro-amber)' : 'var(--ro-accent)');
  return (
    <div ref={box} className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
        <div style={{ width: LABEL + days * dayW }} className="relative">
          <div className="sticky top-0 z-[1] flex h-12 border-b border-[var(--ro-line)] bg-[var(--ro-card)]">
            <div className="sticky left-0 z-[2] flex shrink-0 items-end border-r border-[var(--ro-hair)] bg-[var(--ro-card)] px-3 pb-1.5 text-[12px] font-semibold text-[var(--ro-muted)]" style={{ width: LABEL }}>
              Experiment
            </div>
            <div className="relative flex-1">
              {months.map((m) => (
                <span key={m.t} className="absolute top-1 text-[12px] font-bold text-[var(--ro-ink-2)]" style={{ left: x(m.t) + 4 }}>
                  {m.label}
                </span>
              ))}
              {weeks.map((t) => (
                <span key={t} className="num absolute bottom-1 text-[12px] text-[var(--ro-muted)]" style={{ left: x(t) + 3 }}>
                  {new Date(t).getDate()}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0" style={{ left: LABEL }}>
              {weeks.map((t) => (
                <span key={t} className="absolute inset-y-0 w-px bg-[var(--ro-hair)]" style={{ left: x(t) }} />
              ))}
              <span className="absolute inset-y-0 w-0.5 bg-[var(--ro-accent)]" style={{ left: x(today) + dayW / 2 }} title="Today" />
            </div>
            {placed.length === 0 && <p className="px-3 py-6 text-[12px] text-[var(--ro-muted)]">No experiment has dates yet. Give one a planned start, or start it.</p>}
            {placed.map(({ e, s }) => {
              const left = x(s.from);
              const width = Math.max(dayW, x(s.to + DAY_MS) - x(s.from));
              const open = !s.planned && e.ended_at === '';
              const label = (s.planned ? 'Planned' : STATUS[e.status].label) + ', ' + (open ? 'since ' + shortDate(new Date(s.from)) : shortDate(new Date(s.from)) + (s.to > s.from ? ' to ' + shortDate(new Date(s.to)) : ''));
              const inside = s.planned && width >= label.length * 7 + 16;
              const flip = left + width + 200 > days * dayW;
              return (
                <button key={e.id} type="button" onClick={() => openExp(e.id)} title={label} className="group flex h-9 w-full items-center border-b border-[var(--ro-hair)] text-left hover:bg-[var(--ro-row)]">
                  <span className="sticky left-0 z-[1] flex h-full shrink-0 items-center gap-2 border-r border-[var(--ro-hair)] bg-[var(--ro-card)] px-3 group-hover:bg-[var(--ro-row)]" style={{ width: LABEL }}>
                    <span className="num shrink-0 text-[12px] font-semibold text-[var(--ro-muted)]">{e.code}</span>
                    <span className="min-w-0 truncate text-[13px]">{e.title}</span>
                  </span>
                  <span className="relative h-full flex-1">
                    <span className={cn('absolute top-2.5 h-4 rounded-[var(--ro-r-sm)]', s.planned && 'border border-dashed border-[var(--ro-ink-2)]')} style={{ left, width, background: bar(e, s.planned) }} />
                    <span className="num absolute top-0 flex h-full items-center whitespace-nowrap text-[12px] text-[var(--ro-ink-2)]" style={inside ? { left: left + 8 } : flip ? { right: days * dayW - left + 6 } : { left: left + width + 6 }}>
                      {label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {unscheduled.length > 0 && (
        <div className="rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3">
          <p className="mb-1.5 text-[12px] font-bold text-[var(--ro-ink-2)]">Not scheduled {unscheduled.length}</p>
          <ul className="flex flex-col">
            {unscheduled.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => openExp(e.id)} className="flex h-8 w-full items-center gap-2 rounded-[var(--ro-r-sm)] px-1 text-left hover:bg-[var(--ro-row)]">
                  <span className="num text-[12px] font-semibold text-[var(--ro-muted)]">{e.code}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{e.title}</span>
                  <StatusChip status={e.status} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- new experiment */

export function NewExperiment({ project, open, onClose, onMade }: { project: string; open: boolean; onClose: () => void; onMade: (id: string) => void }): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ExpKind>('lab');
  const [aim, setAim] = useState('');
  const [start, setStart] = useState('');
  const [tpl, setTpl] = useState('');
  const [templates, setTemplates] = useState<ExpTemplate[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setAim('');
    setStart('');
    setTpl('');
    void op<{ templates: ExpTemplate[] }>('exp.templates', {}, { quiet: true })
      .then((r) => setTemplates(r.templates))
      .catch(() => setTemplates([]));
  }, [open]);
  const chosen = templates?.find((t) => t.id === tpl);
  const save = async (): Promise<void> => {
    if ((title.trim() === '' && chosen === undefined) || busy) return;
    setBusy(true);
    try {
      const r = await op<{ experiment: Experiment }>('exp.create', {
        project,
        title: title.trim() || undefined,
        template: tpl || undefined,
        kind: chosen === undefined ? kind : undefined,
        aim: aim.trim() || undefined,
        planned_start: start || undefined,
      });
      changed('experiments', 'projects');
      onClose();
      onMade(r.experiment.id);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New experiment"
      icon={FlaskConical}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={title.trim() === '' && chosen === undefined} onClick={() => void save()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <input autoFocus value={title} onChange={(ev) => setTitle(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && void save()} className={inputCls} placeholder={chosen !== undefined ? chosen.name : 'Growth of E. coli at three temperatures'} />
        </Field>
        {templates !== null && templates.length > 0 && (
          <Field label="Start from">
            <div role="radiogroup" aria-label="Start from" className="flex max-h-44 flex-col overflow-y-auto rounded-[var(--ro-r)] border border-[var(--ro-line)]">
              {[{ id: '', name: 'A blank experiment', counts: null } as { id: string; name: string; counts: ExpTemplate['counts'] | null }, ...templates].map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={tpl === t.id} onClick={() => setTpl(t.id)} className={cn('flex h-9 items-center gap-2 border-b border-[var(--ro-hair)] px-2.5 text-left text-[13px] last:border-0', tpl === t.id ? 'bg-[var(--ro-row-hover)] font-semibold' : 'hover:bg-[var(--ro-row)]')}>
                  <span className={cn('size-3 shrink-0 rounded-full border', tpl === t.id ? 'border-[4px] border-[var(--ro-ink)]' : 'border-[var(--ro-ink-2)]')} />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.counts !== null && <span className="num shrink-0 text-[12px] font-normal text-[var(--ro-muted)]">{plural(t.counts.steps, 'step')}, {plural(t.counts.variables, 'variable')}</span>}
                </button>
              ))}
            </div>
          </Field>
        )}
        {chosen === undefined && (
          <div role="radiogroup" aria-label="Kind" className="grid grid-cols-2 gap-2 @min-[480px]:grid-cols-3">
            {(Object.keys(KIND) as ExpKind[]).map((k) => {
              const K = KIND[k];
              return (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn('flex items-start gap-2 rounded-[var(--ro-r-md)] border p-2.5 text-left transition-colors', kind === k ? 'border-[var(--ro-ink)] bg-[var(--ro-row)]' : 'border-[var(--ro-line)] hover:bg-[var(--ro-row)]')}>
                  <K.icon size={16} className="mt-px shrink-0 text-[var(--ro-ink-2)]" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{K.label}</span>
                    <span className="block text-[12px] leading-4 text-[var(--ro-muted)]">{K.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 @min-[480px]:grid-cols-[minmax(0,1fr)_170px]">
          <Field label="Aim" hint="What it sets out to find. The design and protocol come next.">
            <textarea rows={2} value={aim} onChange={(ev) => setAim(ev.target.value)} className={textareaCls} placeholder={chosen?.aim || 'Find the temperature at which the strain grows fastest'} />
          </Field>
          <Field label="Planned start" hint="Optional">
            <input type="date" value={start} onChange={(ev) => setStart(ev.target.value)} className={inputCls} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------- project overview panel */

/** The project Overview's view of its experiments: what runs now and what is next. */
export function ExperimentsPanel({ project }: { project: Project }): React.JSX.Element | null {
  const list = useLive((signal) => op<{ experiments: Experiment[] }>('exp.list', { project: project.id }, { quiet: true, signal }).then((r) => r.experiments), ['experiments', 'exp_runs', 'exp_log'], [project.id], 200);
  const now = useNow(60000);
  if (list.data === null || list.data.length === 0) return null;
  const active = list.data.filter((e) => e.status === 'running' || e.status === 'paused');
  const next = list.data.filter((e) => e.status === 'planned').sort((a, b) => (a.planned_start || '9999').localeCompare(b.planned_start || '9999') || a.number - b.number).slice(0, 3);
  const done = list.data.filter((e) => e.status === 'done').length;
  const rows = [...active, ...next];
  return (
    <section className="flex flex-col overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
      <header className="flex min-h-10 items-center gap-2 border-b border-[var(--ro-hair)] px-3 py-2">
        <FlaskConical size={14} className="text-[var(--ro-muted)]" />
        <h2 className="text-[13px] font-bold">Experiments</h2>
        <span className="num text-[12px] text-[var(--ro-muted)]">
          {active.length} running · {list.data.filter((e) => e.status === 'planned').length} planned · {done} done
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => replaceQuery({ view: 'exp', exp: undefined })} className="text-[12px] font-semibold text-[var(--ro-ink-2)] hover:text-[var(--ro-ink)]">
          All experiments
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[12px] text-[var(--ro-muted)]">Nothing running or planned.</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => replaceQuery({ view: 'exp', exp: e.id })} className="grid w-full grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--ro-hair)] px-3 py-2 text-left last:border-0 hover:bg-[var(--ro-row)]">
                <span className="num text-[12px] font-semibold text-[var(--ro-muted)]">{e.code}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{e.title}</span>
                  {subline(e) !== '' && <span className="block truncate text-[12px] text-[var(--ro-muted)]">{subline(e)}</span>}
                </span>
                <span className="flex flex-col items-end gap-1">
                  <StatusChip status={e.status} />
                  <span className="num text-[12px] text-[var(--ro-muted)]">{whenText(e, now)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
