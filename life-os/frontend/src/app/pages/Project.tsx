/**
 * One project: its journey across the top, then its steps on three lists
 * (To do, Doing, Done) to drag between, with "Add a step" on each. The
 * project's part of life, the goal it serves, its deadline and notes sit
 * beside it.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Check, Moon, Play, Trash2 } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { act, changed, patch, patchWhere, READS, useLive } from '../lib/live.ts';
import { back, navigate } from '../lib/router.ts';
import type { ProjectDetail, Task } from '../lib/types.ts';
import { AREA_NAMES, AreaArt } from '../components/art.tsx';
import { ColumnArt, NavArt } from '../components/art2.tsx';
import { AddLine, AreaChoice, InlineText, kindColor } from '../components/bits.tsx';
import { Panel } from '../components/panel.tsx';
import { Stones } from '../components/journey.tsx';
import { DateButton, RecordPicker } from '../components/pickers.tsx';
import { snack } from '../components/snack.tsx';
import { addTask, TaskCard, tasksChanged } from '../components/tasks.tsx';
import { Button, LoadError, Skeleton, useConfirm } from '../components/ui.tsx';

type Stage = 'todo' | 'doing' | 'done';

function StageList({ stage, title, art, tasks, today, dragId, setDrag, onDrop, add }: { stage: Stage; title: string; art: ReactNode; tasks: Task[]; today: string; dragId: string | null; setDrag: (id: string | null) => void; onDrop: (stage: Stage) => void; add?: ((title: string) => Promise<unknown>) | undefined }): React.JSX.Element {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  return (
    <section
      ref={ref}
      aria-label={title}
      onDragOver={(e) => {
        if (dragId === null) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop(stage);
      }}
      className={cn('flex min-h-48 flex-col rounded-[var(--lo-r-xl)] bg-[var(--lo-sunk)] p-3 transition-shadow', over && 'shadow-[0_0_0_2px_var(--lo-accent)]')}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        {art}
        <h2 className="serif flex-1 text-[15px] font-semibold">{title}</h2>
        {tasks.length > 0 && <span className="num rounded-[var(--lo-r-xs)] bg-[var(--lo-card)] px-1.5 text-[12px] font-extrabold text-[var(--lo-ink-2)]">{tasks.length}</span>}
      </div>
      {add !== undefined && <AddLine placeholder={stage === 'doing' ? 'Something you are on now' : 'Add a step'} onAdd={add} className="mb-2" />}
      <div className="flex flex-col gap-2">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            inProject
            today={today}
            dragging={dragId === t.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', t.id);
              setDrag(t.id);
            }}
            onDragEnd={() => setDrag(null)}
          />
        ))}
      </div>
    </section>
  );
}

export default function ProjectPage({ id }: { id: string }): React.JSX.Element {
  const status = useStatus().data;
  const today = status?.today ?? '';
  const live = useLive<{ project: ProjectDetail }>((signal) => op('projects.get', { project: id }, { quiet: true, signal }), READS.board, [id]);
  const [drag, setDrag] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const p = live.data?.project;
  if (p === undefined) {
    return <div className="mx-auto max-w-[1320px] px-8 py-8">{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />}</div>;
  }
  const save = async (fields: Record<string, unknown>): Promise<void> => {
    await act([patch<ProjectDetail>(id, fields as Partial<ProjectDetail>)], () => op('projects.update', { project: id, ...fields }), ['projects', 'tasks']);
  };
  const setState = async (state: ProjectDetail['state']): Promise<void> => {
    if (state === 'done') snack(`"${p.title}" is done. Well done`);
    await act([patch<ProjectDetail>(id, { state })], () => op('projects.set-state', { project: id, state }), ['projects', 'tasks']);
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm(`"${p.title}" will be deleted. Its steps stay as cards on the board.`, 'Delete this project?'))) return;
    await op('projects.delete', { project: id });
    changed('projects', 'tasks');
    snack(`Deleted "${p.title}"`);
    navigate('projects');
  };
  const drop = (stage: Stage): void => {
    const t = [...p.todo, ...p.doing, ...p.done].find((x) => x.id === drag);
    setDrag(null);
    if (t === undefined) return;
    // The card lands in its new list at once.
    const moved: Task = { ...t, state: stage === 'done' ? 'done' : 'open', stage: stage === 'done' ? t.stage : stage };
    const relist = patchWhere(
      (o) => o.id === p.id && Array.isArray(o.todo) && Array.isArray(o.doing) && Array.isArray(o.done),
      (o) => {
        const out: Record<string, unknown> = {};
        for (const k of ['todo', 'doing', 'done'] as const) out[k] = (o[k] as Task[]).filter((x) => x.id !== t.id);
        (out[stage] as Task[]).unshift(moved);
        return out;
      },
    );
    void act([relist], () => (stage === 'done' ? op('tasks.complete', { task: t.id, done: true }) : t.state === 'done' ? op('tasks.complete', { task: t.id, done: false }).then(() => op('tasks.update', { task: t.id, stage })) : op('tasks.update', { task: t.id, stage })), ['projects', 'tasks', 'goals']);
  };
  const steps = [...p.done.slice().reverse(), ...p.doing, ...p.todo].map((t) => ({ id: t.id, title: t.title, done: t.state === 'done', stage: t.stage }));
  return (
    <div>
      {confirmEl}
      <header className="border-b border-[var(--lo-hair)]" style={{ background: kindColor(p.area, 'soft') }}>
        <div className="mx-auto max-w-[1320px] px-5 pb-6 pt-5 md:px-8">
          <button type="button" onClick={() => back('projects')} className="hit-y mb-2 inline-flex items-center gap-1 text-[13px] font-bold text-[var(--lo-ink-2)] hover:text-[var(--lo-ink)]">
            <ArrowLeft size={14} /> Projects
          </button>
          <div className="flex flex-wrap items-start gap-4">
            {p.area !== '' ? <AreaArt kind={p.area} size={72} /> : <NavArt kind="projects" size={72} />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold" style={{ color: kindColor(p.area, 'text') }}>
                {p.area !== '' ? AREA_NAMES[p.area] : 'Project'}
                {p.state !== 'active' ? ` · ${p.state === 'done' ? 'Done' : p.state === 'someday' ? 'Someday' : 'Dropped'}` : ''}
              </p>
              <InlineText value={p.title} onSave={(v) => save({ title: v })} placeholder="Project" ariaLabel="Project" className="serif text-[26px] font-semibold leading-9" maxLength={200} />
              <div className="mt-3 overflow-x-auto pb-1">
                <Stones steps={steps} kind={p.area} size="lg" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {p.state !== 'done' && (
                <Button variant="primary" size="sm" icon={Check} onClick={() => void setState('done')}>
                  Finished
                </Button>
              )}
              {p.state === 'active' ? (
                <Button variant="ghost" size="sm" icon={Moon} onClick={() => void setState('someday')}>
                  Someday
                </Button>
              ) : (
                <Button variant="soft" size="sm" icon={Play} onClick={() => void setState('active')}>
                  On the go again
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1320px] grid-cols-1 items-start gap-5 px-4 pb-12 pt-5 md:px-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StageList stage="todo" title="To do" art={<ColumnArt kind="inbox" size={26} />} tasks={p.todo} today={today} dragId={drag} setDrag={setDrag} onDrop={drop} add={(title) => addTask(title, { project: id, stage: 'todo' }).then(() => live.reload())} />
          <StageList stage="doing" title="Doing" art={<ColumnArt kind="today" size={26} />} tasks={p.doing} today={today} dragId={drag} setDrag={setDrag} onDrop={drop} add={(title) => addTask(title, { project: id, stage: 'doing' }).then(() => live.reload())} />
          <StageList stage="done" title="Done" art={<ColumnArt kind="done" size={26} />} tasks={p.done} today={today} dragId={drag} setDrag={setDrag} onDrop={drop} />
        </div>
        <aside className="flex flex-col gap-5">
          <Panel title="Details" art={<NavArt kind="projects" size={24} />}>
            <div className="flex flex-col gap-4">
              <div>
                <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">Part of life</p>
                <AreaChoice value={p.area} onChange={(k) => void save({ area: k })} size="sm" />
              </div>
              <div>
                <p className="pb-1.5 text-[12px] font-bold text-[var(--lo-muted)]">The goal it serves</p>
                <RecordPicker value={p.goal?.id ?? ''} placeholder="Pick a goal" emptyLabel="No goal" onChange={(v) => void save({ goal: v })} options={(status?.goals ?? []).map((g) => ({ value: g.id, label: g.title, art: <AreaArt kind={g.area} size={18} /> }))} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-[var(--lo-muted)]">By when</span>
                <DateButton value={p.deadline} today={today} onChange={(d) => void save({ deadline: d })} placeholder="No date" />
              </div>
              <div>
                <p className="pb-1 text-[12px] font-bold text-[var(--lo-muted)]">Notes</p>
                <InlineText multiline value={p.notes} onSave={(v) => save({ notes: v })} placeholder="Quotes, links, who to call" className="text-[14px] leading-6" maxLength={8000} />
              </div>
              <div>
                <Button variant="danger" size="sm" icon={Trash2} onClick={() => void remove()}>
                  Delete project
                </Button>
              </div>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
