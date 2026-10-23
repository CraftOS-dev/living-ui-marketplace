/**
 * Activity: every change, newest first, by you, your AI agent or the app
 * itself, with Undo where a change can be taken back (a batch undoes as one).
 */
import { useEffect, useRef, useState } from 'react';
import { History, Sparkles, Undo2, User, Wrench } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { changed, useLive } from '../lib/live.ts';
import { time } from '../lib/format.ts';
import type { ActivityEntry } from '../lib/types.ts';
import { Badge, Button, Empty, LoadError, PageHeader, Segmented, Skeleton, Spinner } from '../components/ui.tsx';

const TARGETS: { v: string; label: string }[] = [
  { v: '', label: 'Everything' },
  { v: 'works', label: 'Papers' },
  { v: 'files', label: 'PDFs' },
  { v: 'annotations', label: 'Highlights' },
  { v: 'nodes', label: 'Claims' },
  { v: 'relations', label: 'Links' },
  { v: 'notes', label: 'Notes' },
  { v: 'ms_changes', label: 'Writing' },
  { v: 'decisions', label: 'Screening' },
];

const PAGE = 60;

function dayOf(ts: string): string {
  const d = new Date(ts.replace(' ', 'T'));
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export default function ActivityPage(): React.JSX.Element {
  const { projects } = useApp();
  const [actor, setActor] = useState<'' | 'person' | 'agent' | 'system'>('');
  const [target, setTarget] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [actor, target]);
  const list = useLive((signal) => op<{ entries: ActivityEntry[]; more: boolean }>('activity.list', { actor: actor || undefined, target: target || undefined, limit }, { quiet: true, signal }), ['activity'], [actor, target, limit], 200);
  const more = useRef<HTMLDivElement | null>(null);
  const rows = list.data?.entries ?? [];
  const full = (list.data?.more ?? false) && limit < 1000;
  useEffect(() => {
    const el = more.current;
    if (el === null || !full) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setLimit((l) => l + PAGE), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [full, rows.length]);
  const undo = async (a: ActivityEntry, batch: boolean): Promise<void> => {
    try {
      const r = await op<{ undone: number }>('activity.undo', batch ? { batch: a.batch } : { entry: a.id });
      changed('activity', 'works', 'files', 'annotations', 'nodes', 'relations', 'notes', 'collections', 'collection_items', 'tags', 'work_tags', 'project_works');
      toast.success(r.undone > 1 ? r.undone + ' changes undone' : 'Undone');
    } catch {
      /* toasted */
    }
  };
  const groups: { day: string; rows: ActivityEntry[] }[] = [];
  for (const a of rows) {
    const d = dayOf(a.created);
    const g = groups[groups.length - 1];
    if (g !== undefined && g.day === d) g.rows.push(a);
    else groups.push({ day: d, rows: [a] });
  }
  const batchSize = (b: string): number => (b === '' ? 0 : rows.filter((x) => x.batch === b).length);
  const projectName = (id: string): string => projects.find((p) => p.id === id)?.name ?? '';
  return (
    <div className="flex flex-col gap-3">
      <PageHeader icon={History} title="Activity" />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Who" size="sm" value={actor} onChange={setActor} options={[{ value: '', label: 'Everyone' }, { value: 'person', label: 'You', icon: User }, { value: 'agent', label: 'Your AI agent', icon: Sparkles }, { value: 'system', label: 'The app', icon: Wrench }]} />
        <span className="mx-1 h-5 w-px bg-[var(--ro-line)]" />
        <div className="flex flex-wrap gap-1">
          {TARGETS.map((t) => (
            <button key={t.v} type="button" onClick={() => setTarget(t.v)} className={cn('h-7 rounded-[var(--ro-r)] px-2 text-[12px] font-semibold', target === t.v ? 'ro-on-ink bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)] hover:bg-[var(--ro-row-hover)]')}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {list.error !== null && <LoadError message={list.error} onRetry={list.reload} />}
      {list.data === null && list.error === null && <Skeleton className="h-64" />}
      {list.data !== null && rows.length === 0 && <Empty icon={History} title="Nothing here yet" />}
      {groups.map((g) => (
        <section key={g.day} className="flex flex-col">
          <h2 className="sticky top-0 z-10 bg-[var(--ro-shell)] py-1.5 text-[12px] font-bold text-[var(--ro-muted)]">{g.day}</h2>
          <ul className="overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
            {g.rows.map((a) => {
              const n = batchSize(a.batch);
              return (
                <li key={a.id} className={cn('group flex items-start gap-2.5 border-b border-[var(--ro-hair)] px-3 py-2 last:border-0', a.undone && 'opacity-55')}>
                  <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[var(--ro-r-sm)]', a.actor === 'agent' ? 'bg-[var(--ro-accent-soft)] text-[var(--ro-accent-text)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)]')}>
                    {a.actor === 'agent' ? <Sparkles size={12} /> : a.actor === 'system' ? <Wrench size={12} /> : <User size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px] leading-[18px]', a.undone && 'line-through')}>{a.label}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--ro-muted)]">
                      {time(a.created)}
                      {a.project !== '' && projectName(a.project) !== '' && <span>· {projectName(a.project)}</span>}
                      {a.undone && <Badge tone="neutral">undone</Badge>}
                    </span>
                  </span>
                  {a.undoable && (
                    <span className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100">
                      {n > 1 ? (
                        <Button size="sm" variant="ghost" icon={Undo2} onClick={() => void undo(a, true)} title={'Undo all ' + n + ' changes made together'}>
                          Undo {n}
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" icon={Undo2} onClick={() => void undo(a, false)}>
                          Undo
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {full && (
        <div ref={more} className="flex justify-center py-4">
          <Spinner />
        </div>
      )}
    </div>
  );
}
