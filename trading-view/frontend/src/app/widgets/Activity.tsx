/**
 * Activity: every change by the person or the AI agent, newest first.
 * Each can be undone (and redone); the AI agent's changes are grouped by run
 * and a whole run can be reverted.
 */
import { useMemo } from 'react';
import { History, Redo2, RotateCcw, Sparkles, Undo2, User } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Empty, IconBtn, Seg, useConfirm } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { ago } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { useApp } from '../lib/store.tsx';
import type { ActivityEntry, Widget } from '../lib/types.ts';
import { Title, WidgetShell } from '../workspace/WidgetShell.tsx';

export function ActivityWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const actor = w.config.actor ?? '';
  const live = useLive(() => api.activity({ actor: actor === '' ? undefined : actor, limit: 150 }).then((r) => r.activity), ['activity'], [actor]);
  const [confirmEl, confirm] = useConfirm();

  // Consecutive entries of one AI agent run form a group.
  const groups = useMemo(() => {
    const out: { run: string; items: ActivityEntry[] }[] = [];
    for (const e of live.data ?? []) {
      const last = out[out.length - 1];
      if (e.actor === 'agent' && e.run !== '' && last !== undefined && last.run === e.run) last.items.push(e);
      else out.push({ run: e.actor === 'agent' ? e.run : '', items: [e] });
    }
    return out;
  }, [live.data]);

  const act = (p: Promise<{ entry: ActivityEntry }>, verb: string): void => {
    p.then((r) => toast.success(verb + ': ' + r.entry.summary)).catch((err: unknown) => toast.error(errMessage(err)));
  };

  const revert = async (run: string, n: number): Promise<void> => {
    if (!(await confirm('Undo all ' + n + ' change' + (n === 1 ? '' : 's') + ' your AI agent made in this run?', 'Revert the run', 'Revert'))) return;
    try {
      const r = await api.revertRun(run);
      toast.success('Reverted ' + r.reverted + ' change' + (r.reverted === 1 ? '' : 's'));
    } catch (err) {
      toast.error(errMessage(err));
    }
  };

  return (
    <WidgetShell
      w={w}
      title={<Title>Activity</Title>}
      actions={
        <Seg
          size="xs"
          value={actor}
          onChange={(v) => app.configure(w, { actor: v })}
          options={[
            { value: '', label: 'All' },
            { value: 'user', label: 'Mine' },
            { value: 'agent', label: 'AI agent' },
          ]}
        />
      }
    >
      <div className="h-full overflow-y-auto">
        {(live.data ?? []).length === 0 && !live.loading ? (
          <Empty icon={History} title="Nothing yet">
            Changes to workspaces, charts, watchlists, drawings and alerts show up here, with undo.
          </Empty>
        ) : (
          groups.map((g, gi) => (
            <div key={gi} className={cn('border-b border-[var(--tv-hair)]', g.run !== '' && 'bg-[color-mix(in_srgb,var(--tv-accent-soft)_45%,transparent)]')}>
              {g.run !== '' && (
                <div className="flex h-7 items-center gap-1.5 px-2.5">
                  <Sparkles size={12} className="text-[var(--tv-accent-text)]" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--tv-accent-text)]">AI agent run · {g.items.length} change{g.items.length === 1 ? '' : 's'}</span>
                  <span className="flex-1" />
                  {g.items.some((e) => e.undoable) && (
                    <button type="button" onClick={() => void revert(g.run, g.items.filter((e) => e.undoable).length)} className="flex h-5 items-center gap-1 rounded-[3px] px-1.5 text-[11px] font-bold text-[var(--tv-ink-2)] hover:bg-[var(--tv-row-hover)] hover:text-[var(--tv-ink)]">
                      <RotateCcw size={11} /> Revert run
                    </button>
                  )}
                </div>
              )}
              {g.items.map((e) => (
                <div key={e.id} className="group flex min-h-[26px] items-center gap-2 px-2.5 py-0.5">
                  {e.actor === 'agent' ? <Sparkles size={12} className="shrink-0 text-[var(--tv-accent-text)]" /> : <User size={12} className="shrink-0 text-[var(--tv-muted)]" />}
                  <span className={cn('min-w-0 flex-1 text-[12px] leading-4', e.undone && 'text-[var(--tv-muted)] line-through')}>{e.summary}</span>
                  <span className="shrink-0 text-[11px] text-[var(--tv-muted)]">{ago(e.created)}</span>
                  <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                    {e.undoable && <IconBtn icon={Undo2} size={20} label="Undo" onClick={() => act(api.undo(e.id), 'Undone')} />}
                    {e.redoable && <IconBtn icon={Redo2} size={20} label="Redo" onClick={() => act(api.redo(e.id), 'Redone')} />}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      {confirmEl}
    </WidgetShell>
  );
}
