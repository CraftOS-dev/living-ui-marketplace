/**
 * Activity: every change to every image, newest first, by day: edits,
 * undos and redos, by you or your AI agent. Open the image, or revert a
 * change on its own.
 */
import { useMemo, useState } from 'react';
import { History, ImageIcon, Pencil, Redo2, Sparkles, Undo2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Button, Empty, PageHeader, Segmented, Spinner, errMessage } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { ago, day } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';
import type { HistoryBatch } from '../lib/types.ts';

type Who = '' | 'you' | 'agent';

function dayLabel(d: string): string {
  const today = day(new Date().toISOString());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d === today) return 'Today';
  if (d === day(y.toISOString())) return 'Yesterday';
  return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ActivityPage(): React.JSX.Element {
  const [who, setWho] = useState<Who>('');
  const [limit, setLimit] = useState(60);
  const list = useLive(() => api.history({ actor: who, limit }), ['changes'], [who, limit], 300);
  const groups = useMemo(() => {
    const out: { day: string; rows: HistoryBatch[] }[] = [];
    for (const b of list.data?.batches ?? []) {
      const d = day(b.created);
      const last = out[out.length - 1];
      if (last !== undefined && last.day === d) last.rows.push(b);
      else out.push({ day: d, rows: [b] });
    }
    return out;
  }, [list.data]);
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Activity"
        subtitle="Every change to every image. Reverting one is itself a change, so it can be undone too."
        actions={
          <Segmented<Who>
            label="Who"
            value={who}
            onChange={setWho}
            options={[
              { value: '', label: 'Everyone' },
              { value: 'you', label: 'You' },
              { value: 'agent', label: 'Your AI agent' },
            ]}
          />
        }
      />
      {list.data === null ? (
        <div className="flex h-40 items-center justify-center text-[var(--iu-muted)]">
          <Spinner size={16} />
        </div>
      ) : groups.length === 0 ? (
        <Empty icon={History} title="Nothing yet">
          Edits, undos and redos show up here as they happen.
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.day} className="flex flex-col gap-1">
              <h2 className="text-[12px] font-bold text-[var(--iu-ink-2)]">{dayLabel(g.day)}</h2>
              <ul className="divide-y divide-[var(--iu-hair)] overflow-hidden rounded-[var(--iu-r-md)] border border-[var(--iu-line)] bg-[var(--iu-card)]">
                {g.rows.map((b) => {
                  const Icon = b.kind === 'undo' ? Undo2 : b.kind === 'redo' ? Redo2 : Pencil;
                  const reverted = b.reverted_by !== '';
                  return (
                    <li key={b.batch} className="group flex items-center gap-2.5 px-3 py-2">
                      <Icon size={14} aria-hidden className="shrink-0 text-[var(--iu-ink-2)]" />
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate text-[13px] font-semibold', reverted && 'text-[var(--iu-muted)] line-through')}>{b.note !== '' ? b.note : b.count + ' changes'}</p>
                        <p className="flex items-center gap-1 text-[12px] text-[var(--iu-muted)]">
                          {b.actor === 'agent' && <Sparkles size={11} aria-hidden className="text-[var(--iu-accent-text)]" />}
                          {b.actor === 'agent' ? 'Your AI agent' : 'You'} · {ago(b.created)}
                          {b.image.name !== '' && (
                            <button type="button" onClick={() => navigate('image', { id: b.image.id })} className="ml-1 inline-flex items-center gap-1 font-semibold text-[var(--iu-ink-2)] hover:text-[var(--iu-ink)] hover:underline">
                              <ImageIcon size={11} aria-hidden /> {b.image.name}
                            </button>
                          )}
                        </p>
                      </div>
                      {!reverted && b.image.name !== '' && (
                        <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => api.revert(b.batch).catch((err: unknown) => toast.error(errMessage(err)))}>
                          Revert
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {list.data.more && (
            <Button className="self-center" onClick={() => setLimit((l) => l + 60)}>
              Show more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
