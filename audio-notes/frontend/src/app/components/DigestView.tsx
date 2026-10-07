import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Download } from 'lucide-react';
import { Button, EmptyState, RelDate, Spinner, Stat, StatGrid, cn, getPbClient, toast } from '../../kit/index.ts';
import { api, saveFile } from '../api.ts';
import { addDays, fmtDay, length, localDay, weekStart } from '../format.ts';
import type { Digest } from '../types.ts';

/** Monday-to-Sunday rollup: totals, each note's summary, decisions and actions. */
export function DigestView({
  version,
  onOpen,
  onBack,
}: {
  version: number;
  onOpen: (id: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [week, setWeek] = useState(() => weekStart(localDay()));
  const [digest, setDigest] = useState<Digest | null>(null);
  const [copied, setCopied] = useState(false);
  const thisWeek = weekStart(localDay());

  useEffect(() => {
    let live = true;
    void api
      .digest(week)
      .then((d) => {
        if (live) setDigest(d);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [week, version]);

  const toggle = (noteId: string, actionId: string, done: boolean): void => {
    void getPbClient()
      .call((pb) => pb.send('/api/ops/actions/update', { method: 'POST', body: { note_id: noteId, action_id: actionId, done } }))
      .catch(() => undefined);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pb-20 pt-8 md:px-10">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to notes"
        className="-ml-2 mb-2 inline-flex size-8 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-hover)] md:hidden"
      >
        <ArrowLeft size={16} />
      </button>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Weekly digest</h1>
          <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">
            {fmtDay(week, false)} to {fmtDay(addDays(week, 6))}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous week" title="Previous week" onClick={() => setWeek(addDays(week, -7))}>
            <ChevronLeft size={16} />
          </Button>
          <Button size="sm" variant="secondary" disabled={week === thisWeek} onClick={() => setWeek(thisWeek)}>
            This week
          </Button>
          <Button size="icon" variant="ghost" aria-label="Next week" title="Next week" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
      {digest === null ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : digest.notes.length === 0 ? (
        <EmptyState icon={<CalendarDays size={18} />} title="Nothing recorded this week" message="Notes dated in this week show up here with their summaries, decisions and action items." />
      ) : (
        <div className="flex flex-col gap-4">
          <StatGrid className="lg:grid-cols-4">
            <Stat label="Notes" value={String(digest.totals.notes)} />
            <Stat label="Recorded" value={digest.totals.recorded_seconds > 0 ? length(digest.totals.recorded_seconds) : '-'} />
            <Stat label="Open actions" value={String(digest.totals.open_actions)} sub={`${digest.totals.done_actions} done`} tone={digest.totals.open_actions > 0 ? 'warn' : 'good'} />
            <Stat label="People" value={String(digest.totals.people)} />
          </StatGrid>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(digest.markdown)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                  .catch(() => toast.error('Copying was blocked by the browser.'));
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy as Markdown'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => saveFile({ filename: `Weekly digest ${digest.week_start}.md`, mime: 'text/markdown', content: digest.markdown })}
            >
              <Download size={14} />
              Download .md
            </Button>
          </div>
          {digest.notes.map((n) => (
            <section key={n.id} className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <button type="button" onClick={() => onOpen(n.id)} className="min-w-0 text-left">
                  <h2 className="text-[15px] font-semibold hover:text-[var(--agent-app-accent)]">{n.title}</h2>
                  <p className="mt-0.5 text-[13px] text-[var(--agent-app-muted)]">
                    {[fmtDay(n.date, false), n.duration_seconds > 0 ? length(n.duration_seconds) : '', n.attendees.join(', ')].filter((x) => x !== '').join(' · ')}
                  </p>
                </button>
                <Button size="sm" variant="ghost" onClick={() => onOpen(n.id)}>
                  Open
                </Button>
              </div>
              <div className="flex flex-col gap-4 text-[15px] leading-7">
                {n.summary !== '' ? <p>{n.summary}</p> : <p className="text-[var(--agent-app-muted)]">No summary yet.</p>}
                {n.decisions.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-semibold">Decisions</p>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {n.decisions.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {n.action_items.length > 0 && (
                  <div>
                    <p className="mb-1 text-sm font-semibold">Action items</p>
                    {n.action_items.map((a) => (
                      <label key={a.id} className="flex items-center gap-2.5 py-0.5">
                        <input type="checkbox" checked={a.done} onChange={() => toggle(n.id, a.id, !a.done)} className="accent-[var(--agent-app-accent)]" />
                        <span className={cn('flex-1', a.done && 'text-[var(--agent-app-muted)] line-through')}>{a.title}</span>
                        {a.assignee !== '' && <span className="text-[13px] text-[var(--agent-app-muted)]">{a.assignee}</span>}
                        {a.due !== '' && !a.done && <RelDate iso={a.due} />}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
