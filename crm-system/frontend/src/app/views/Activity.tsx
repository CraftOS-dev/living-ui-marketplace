/**
 * Activity: every change to the books by the person, the AI agent, rules,
 * imports and schedules, newest first, each with what changed and undo or
 * redo. The AI agent's work is grouped into runs that can be reviewed and
 * reverted as a whole.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownToLine, History, Redo2, RotateCcw, Settings2, Sparkles, Undo2, UserRound } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { ago } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useReportScreen } from '../lib/store.tsx';
import type { ActivityEntry } from '../lib/types.ts';
import { Tabs } from '../components/controls.tsx';
import { Btn, Chip, Empty, Select, useConfirm } from '../components/ui.tsx';

const ACTOR: Record<string, string> = { user: 'You', agent: 'AI agent', import: 'Import', system: 'System' };
const ACTOR_ICON: Record<string, LucideIcon> = { user: UserRound, agent: Sparkles, import: ArrowDownToLine, system: Settings2 };

function open(e: ActivityEntry): void {
  const t = e.target_type;
  if ((t === 'people' || t === 'companies' || t === 'deals') && e.target_id) go(t, { id: e.target_id });
  else if (t === 'pipelines' || t === 'stages') go('setup', { tab: 'pipelines' });
  else if (t === 'fields') go('setup', { tab: 'fields' });
  else if (t === 'lists') go('people', { list: e.target_id });
  else if (t === 'settings') go('setup');
  else if (t === 'tasks') go('today');
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function Entry({ e }: { e: ActivityEntry }): React.JSX.Element {
  const [more, setMore] = useState(false);
  const act = (p: Promise<{ entry: ActivityEntry }>, msg: string): void => {
    p.then(() => toast.success(msg)).catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <li className={cn('group border-b border-[var(--cr-hair)] px-4 py-2', e.undone && 'opacity-55')}>
      <div className="flex items-start gap-3">
        <span className={cn('mt-px flex size-6 shrink-0 items-center justify-center rounded-[5px]', e.actor === 'agent' ? 'bg-[var(--cr-accent-soft)] text-[var(--cr-accent-text)]' : 'bg-[var(--cr-row-hover)] text-[var(--cr-ink-2)]')}>
          {(() => {
            const Icon = ACTOR_ICON[e.actor] ?? Settings2;
            return <Icon size={12} strokeWidth={2.2} />;
          })()}
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => open(e)} className={cn('text-left text-[12.5px] hover:underline', e.undone && 'line-through')}>
            {e.summary}
          </button>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--cr-muted)]">
            <span>{ACTOR[e.actor] ?? e.actor}</span>
            <span>{ago(e.created)}</span>
            {e.run !== '' && (
              <button type="button" className="hover:underline" onClick={() => setQuery({ tab: 'all', run: e.run })}>
                run {e.run.slice(-5)}
              </button>
            )}
            {e.changes !== null && e.changes.length > 0 && (
              <button type="button" className="font-semibold hover:underline" onClick={() => setMore((m) => !m)}>
                {more ? 'Hide changes' : e.changes.length + ' change' + (e.changes.length === 1 ? '' : 's')}
              </button>
            )}
          </p>
          {more && e.changes !== null && (
            <table className="mt-1.5 text-[11.5px]">
              <tbody>
                {e.changes.map((c) => (
                  <tr key={c.field}>
                    <td className="pr-3 text-[var(--cr-muted)]">{c.field.replace(/_/g, ' ')}</td>
                    <td className="max-w-[220px] truncate pr-2 line-through decoration-[var(--cr-muted)]">{show(c.before)}</td>
                    <td className="max-w-[220px] truncate">{show(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {e.undoable && (
          <Btn size="xs" variant="ghost" icon={Undo2} className="opacity-60 group-hover:opacity-100" onClick={() => act(api.undo(e.id), 'Undone')}>
            Undo
          </Btn>
        )}
        {e.redoable && (
          <Btn size="xs" variant="ghost" icon={Redo2} onClick={() => act(api.redo(e.id), 'Redone')}>
            Redo
          </Btn>
        )}
      </div>
    </li>
  );
}

export function ActivityView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const tab = q['tab'] === 'runs' ? 'runs' : 'all';
  const run = q['run'] ?? '';
  const [actor, setActor] = useState('');
  const [limit, setLimit] = useState(100);
  const log = useLive(() => api.activity({ actor: actor || undefined, run: run || undefined, limit }), ['activity'], [actor, run, limit], 300);
  const runs = useLive(() => api.runs(), ['activity'], [], 300);
  const [confirmEl, confirm] = useConfirm();
  useReportScreen('activity', null, { tab, run });
  const entries = log.data?.activity ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      {confirmEl}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-[var(--cr-line)] px-4">
        <Tabs
          value={tab}
          onChange={(v) => setQuery({ tab: v === 'all' ? undefined : v, run: undefined }, false)}
          className="h-full"
          tabs={[
            { value: 'all', label: 'All changes' },
            { value: 'runs', label: 'AI agent runs', count: runs.data?.runs.length },
          ]}
        />
        <span className="flex-1" />
        {tab === 'all' && run !== '' && (
          <Chip tone="accent">
            Run {run.slice(-5)}
            <button type="button" aria-label="Show all" className="ml-1 font-bold" onClick={() => setQuery({ run: undefined })}>
              ×
            </button>
          </Chip>
        )}
        {tab === 'all' && (
          <Select
            small
            label="Who"
            value={actor}
            onChange={setActor}
            className="w-32"
            options={[
              { value: '', label: 'Everyone' },
              { value: 'user', label: 'You' },
              { value: 'agent', label: 'AI agent' },
              { value: 'import', label: 'Imports' },
            ]}
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'all' ? (
          entries.length === 0 && !log.loading ? (
            <Empty icon={History} title="No changes yet">
              Every change to the books shows here with a way to undo it.
            </Empty>
          ) : (
            <ul>
              {entries.map((e) => (
                <Entry key={e.id} e={e} />
              ))}
              {entries.length >= limit && (
                <li className="p-3 text-center">
                  <Btn size="sm" onClick={() => setLimit((l) => l + 100)}>
                    Show more
                  </Btn>
                </li>
              )}
            </ul>
          )
        ) : (runs.data?.runs ?? []).length === 0 ? (
          <Empty icon={Sparkles} title="Your AI agent has not changed anything yet">
            When it categorizes lines, reads receipts or drafts documents, its work is grouped here by run.
          </Empty>
        ) : (
          <ul>
            {(runs.data?.runs ?? []).map((r) => (
              <li key={r.run} className="border-b border-[var(--cr-hair)] px-4 py-3">
                <div className="flex items-start gap-3">
                  <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--cr-accent-text)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold">
                      {r.changes} change{r.changes === 1 ? '' : 's'} · {ago(r.last)}
                      {r.undone > 0 && <span className="ml-2 font-normal text-[var(--cr-muted)]">{r.undone} undone</span>}
                    </p>
                    <ul className="mt-1 text-[12px] text-[var(--cr-ink-2)]">
                      {r.summaries.map((s, i) => (
                        <li key={i} className="truncate">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Btn size="xs" onClick={() => setQuery({ tab: undefined, run: r.run }, false)}>
                      Review
                    </Btn>
                    {r.undone < r.changes && (
                      <Btn
                        size="xs"
                        icon={RotateCcw}
                        onClick={() =>
                          void confirm('Every change in this run is undone, newest first. Changes you made since to the same records are kept and those entries are skipped.', 'Revert this AI run?', 'Revert').then((ok) => {
                            if (ok)
                              api
                                .revertRun(r.run)
                                .then((x) => toast.success('Reverted ' + x.reverted + (x.skipped.length > 0 ? '; ' + x.skipped.length + ' skipped (changed since)' : '')))
                                .catch((err: unknown) => toast.error(errMessage(err)));
                          })
                        }
                      >
                        Revert
                      </Btn>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
