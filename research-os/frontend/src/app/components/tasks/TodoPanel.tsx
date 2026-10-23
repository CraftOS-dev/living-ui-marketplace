/**
 * The to-do at a glance: how many tasks are late, due today, due this week
 * and with your AI agent (each one a filter), and what comes next. On Home it
 * covers every project (with the projects that have open tasks); on a
 * project's Overview it covers that project, with a line to add a task. Each
 * task shows its priority (click the flag to change it); anything else opens
 * the task in its project.
 */
import { useState } from 'react';
import { ArrowRight, ListTodo, Sparkles } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import { num, plural } from '../../lib/format.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Project, Task, TaskSummary } from '../../lib/types.ts';
import { Button, Empty, LoadError, Panel, Skeleton, TextLink } from '../ui.tsx';
import { PriorityPick, QuickAdd } from '../project/Tasks.tsx';
import { DueChip } from './bits.tsx';

type Pick = 'next' | 'late' | 'today' | 'week' | 'agent';

const LIST: Record<Exclude<Pick, 'next'>, Record<string, string>> = {
  late: { due: 'overdue' },
  today: { due: 'today' },
  week: { due: 'week' },
  agent: { assignee: 'agent' },
};

const openTask = (t: Task): void => navigate('project', { id: t.project, view: 'tasks', task: t.id });

export function TodoPanel({ project }: { project?: Project }): React.JSX.Element {
  const [pick, setPick] = useState<Pick>('next');
  const scope = project !== undefined ? { project: project.id } : {};
  const s = useLive((signal) => op<TaskSummary>('tasks.summary', { ...scope, limit: 10 }, { quiet: true, signal }), ['tasks', 'projects'], [project?.id], 200);
  const picked = useLive((signal) => (pick === 'next' ? Promise.resolve(null) : op<{ tasks: Task[] }>('tasks.list', { ...scope, status: 'open', limit: 200, ...LIST[pick] }, { quiet: true, signal }).then((r) => r.tasks)), ['tasks', 'projects'], [pick, project?.id], 150);
  if (s.error !== null) return <LoadError message={s.error} onRetry={s.reload} />;
  const d = s.data;
  const active = new Set((d?.by_project ?? []).map((b) => b.project));
  // Across projects, archived projects' tasks wait with their project, as in the counts.
  const rows = pick === 'next' ? (d?.next ?? []) : (picked.data ?? []).filter((t) => project !== undefined || active.has(t.project)).slice(0, 10);
  const loading = d === null || (pick !== 'next' && picked.data === null);
  const c = d?.counts;
  const tiles: { key: Pick; label: string; n: number; tone?: 'late' | 'agent' }[] = [
    { key: 'late', label: 'Late', n: c?.overdue ?? 0, tone: 'late' },
    { key: 'today', label: 'Today', n: c?.today ?? 0 },
    { key: 'week', label: 'This week', n: c?.week ?? 0 },
    { key: 'agent', label: 'Your AI agent', n: c?.agent ?? 0, tone: 'agent' },
  ];
  const heading: Record<Pick, string> = { next: 'Next up', late: 'Late', today: 'Due today', week: 'Due this week', agent: 'With your AI agent' };
  const total = c?.open ?? 0;
  const doneWeek = c && c.done_week > 0 ? ' · ' + num(c.done_week) + ' done this week' : '';
  const toList = (): void => replaceQuery({ view: 'tasks' });
  const empty = d !== null && total === 0 && (c?.done_week ?? 0) === 0;
  return (
    <Panel
      title="To-do"
      subtitle={d === null ? ' ' : total === 0 ? 'Nothing open' + doneWeek : plural(total, 'open task') + (project === undefined ? ' in ' + plural(d.by_project.length, 'project') : '') + doneWeek}
      actions={
        project !== undefined ? (
          <TextLink onClick={toList}>
            All tasks <ArrowRight size={12} />
          </TextLink>
        ) : (
          <TextLink onClick={() => navigate('projects')}>
            Projects <ArrowRight size={12} />
          </TextLink>
        )
      }
      padded={!(project !== undefined && empty)}
    >
      {empty && project === undefined ? (
        <Empty compact icon={ListTodo} title="No tasks yet" action={<Button size="sm" onClick={() => navigate('projects')}>Open a project</Button>}>
          Each project keeps its own to-do list. Everything open shows up here.
        </Empty>
      ) : empty && project !== undefined ? (
        <>
          <QuickAdd project={project.id} />
          <p className="px-4 py-3 text-[12px] text-[var(--ro-muted)]">Reading to finish, analyses to run, people to write to: keep them here with the project.</p>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 @min-[720px]:grid-cols-[260px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid grid-cols-2 gap-1.5">
              {tiles.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  aria-pressed={pick === x.key}
                  onClick={() => setPick(pick === x.key ? 'next' : x.key)}
                  className={cn('flex min-w-0 flex-col rounded-[var(--ro-r-md)] border px-2.5 py-2 text-left transition-colors', pick === x.key ? 'border-[var(--ro-ink)] bg-[var(--ro-row)]' : 'border-[var(--ro-line)] hover:bg-[var(--ro-row)]')}
                >
                  <span className="flex items-center gap-1 text-[12px] text-[var(--ro-muted)]">
                    {x.tone === 'agent' && <Sparkles size={11} className="text-[var(--ro-accent)]" />}
                    <span className="truncate">{x.label}</span>
                  </span>
                  {d === null ? <Skeleton className="mt-1 h-6 w-8" /> : <span className={cn('num text-[26px] font-bold leading-8 tracking-tight', x.tone === 'late' && x.n > 0 && 'text-[var(--ro-red-text)]')}>{num(x.n)}</span>}
                </button>
              ))}
            </div>
            {project !== undefined && c !== undefined && (
              <ul className="flex flex-col">
                {[
                  { label: 'In progress', n: c.doing },
                  { label: 'Waiting', n: c.waiting },
                  { label: 'No due day', n: c.no_date },
                  { label: 'High or urgent', n: c.urgent },
                ].map((x) => (
                  <li key={x.label}>
                    <button type="button" onClick={toList} className="flex h-7 w-full items-center gap-2 rounded-[var(--ro-r-sm)] px-1 text-left hover:bg-[var(--ro-row)]">
                      <span className="min-w-0 flex-1 truncate text-[12px]">{x.label}</span>
                      <span className="num w-6 shrink-0 text-right text-[12px] font-bold">{num(x.n)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {project === undefined && d !== null && d.by_project.length > 0 && (
              <div className="flex flex-col">
                <p className="mb-1 text-[12px] font-semibold text-[var(--ro-ink-2)]">By project</p>
                <ul className="flex flex-col">
                  {d.by_project.slice(0, 6).map((b) => (
                    <li key={b.project}>
                      <button type="button" onClick={() => navigate('project', { id: b.project, view: 'tasks' })} className="flex h-7 w-full items-center gap-2 rounded-[var(--ro-r-sm)] px-1 text-left hover:bg-[var(--ro-row)]">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--ro-pc-${b.color})` }} />
                        <span className="min-w-0 flex-1 truncate text-[12px]">{b.name}</span>
                        {b.overdue > 0 && <span className="num shrink-0 text-[12px] font-semibold text-[var(--ro-red-text)]">{num(b.overdue)} late</span>}
                        <span className="num w-6 shrink-0 text-right text-[12px] font-bold">{num(b.open)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {d.by_project.length > 6 && <p className="px-1 pt-1 text-[12px] text-[var(--ro-muted)]">and {plural(d.by_project.length - 6, 'more project')}</p>}
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col @min-[720px]:border-l @min-[720px]:border-[var(--ro-hair)] @min-[720px]:pl-4">
            <p className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-[var(--ro-ink-2)]">
              {heading[pick]}
              {pick !== 'next' && (
                <button type="button" onClick={() => setPick('next')} className="font-normal text-[var(--ro-muted)] hover:text-[var(--ro-ink)]">
                  Show next up
                </button>
              )}
            </p>
            {project !== undefined && <QuickAdd project={project.id} compact />}
            {loading ? (
              <div className="flex flex-col gap-2 py-1">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-5" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="py-3 text-[12px] text-[var(--ro-muted)]">{pick === 'next' && project === undefined ? 'Nothing due in the next two weeks.' : 'Nothing here.'}</p>
            ) : (
              <ul className="flex flex-col">
                {rows.map((t) => (
                  <li key={t.id}>
                    <div role="button" tabIndex={0} onClick={() => openTask(t)} onKeyDown={(e) => e.key === 'Enter' && openTask(t)} className="flex h-9 cursor-pointer items-center gap-2.5 border-b border-[var(--ro-hair)] px-1 last:border-0 hover:bg-[var(--ro-row)]">
                      <PriorityPick t={t} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                      {project === undefined && (
                        <span className="hidden w-44 min-w-0 shrink-0 items-center gap-1.5 @min-[560px]:flex">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--ro-pc-${t.project_color})` }} />
                          <span className="truncate text-[12px] text-[var(--ro-muted)]">{t.project_name}</span>
                        </span>
                      )}
                      <span className="flex w-3 shrink-0 justify-center">{t.assignee === 'agent' && <Sparkles size={12} className="text-[var(--ro-accent)]" aria-label="For your AI agent" />}</span>
                      <span className="flex w-[76px] shrink-0 justify-end">
                        <DueChip task={t} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {project !== undefined && pick === 'next' && !loading && total > rows.length && (
              <button type="button" onClick={toList} className="mt-1 flex h-7 items-center gap-1 self-start rounded-[var(--ro-r-sm)] px-1 text-[12px] font-semibold text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]">
                {plural(total - rows.length, 'more open task')} <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
