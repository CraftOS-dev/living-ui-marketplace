/**
 * The Notes tab of a deal (and of a company without a deal): one 36px row
 * per note with its template, day, author and review picture; a click opens
 * the editor (query note=<id>). A meeting's "Add note" lands here with
 * event=<calendar event>: the meeting's note opens at once.
 */
import { useEffect, useRef, useState } from 'react';
import { NotebookPen, Plus } from 'lucide-react';
import { AgentTag, Avatar, Button, Count, Empty, LoadError, Skeleton, StepTrack, Tag, Tip } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { fmtDay } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { setQuery, useRoute } from '../../lib/router.ts';
import { NoteEditor } from './NoteEditor.tsx';
import type { NoteHome } from './NoteEditor.tsx';
import { NOTE_READS } from './types.ts';
import type { Note } from './types.ts';


function State({ n }: { n: Note }): React.JSX.Element | null {
  const r = n.review;
  if (n.status === 'draft') return <Tag tone="faint">{n.empty ? 'Empty' : 'Draft'}</Tag>;
  if (r.steps !== null && r.state !== 'ready') return <StepTrack labels={r.steps.labels} at={r.steps.at} compact className="w-20" />;
  if (n.summary_by === 'agent') return <AgentTag />;
  return null;
}

export function NotesTab({ home, canWrite }: { home: NoteHome; canWrite: boolean }): React.JSX.Element {
  const { query } = useRoute();
  const params = home.deal !== undefined ? { deal: home.deal.id } : { company: home.company };
  const live = useOp<{ notes: Note[]; total: number; hidden: number }>('notes.list', { ...params, limit: 200 }, NOTE_READS, { name: 'notes.list' });
  const open = query.get('note') ?? '';
  const event = query.get('event') ?? '';
  const [fresh, setFresh] = useState(false);
  // One editor per opening: a new note keeps its editor when it gets its id (no remount mid-typing).
  const [session, setSession] = useState(0);
  const opening = useRef('');
  const openNote = (id: string): void => {
    setSession((x) => x + 1);
    setQuery({ note: id });
  };
  const startNew = (): void => {
    setSession((x) => x + 1);
    setFresh(true);
  };

  // A meeting's Add note: open (or make) the meeting's note.
  useEffect(() => {
    if (event === '' || opening.current === event) return;
    opening.current = event;
    void op<{ note: Note }>('notes.create', home.deal !== undefined ? { deal: home.deal.id, cal_event: event } : { company: home.company, cal_event: event })
      .then((r) => {
        setSession((x) => x + 1);
        setQuery({ event: null, note: r.note.id });
      })
      .catch(() => setQuery({ event: null }));
  }, [event, home.deal, home.company]);

  const notes = live.data?.notes ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {canWrite && notes.length > 0 && (
        <div className="flex justify-end">
          <Button icon={Plus} onClick={startNew}>
            New note
          </Button>
        </div>
      )}
      {live.error !== null && live.data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : live.data === null ? (
        <Skeleton className="h-40 w-full" />
      ) : notes.length === 0 ? (
        <Empty
          icon={NotebookPen}
          title="No notes yet"
          action={
            canWrite ? (
              <Button icon={Plus} onClick={startNew}>
                New note
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="vo-panel vo-in flex flex-col overflow-hidden" aria-label="Notes">
          {notes.map((n) => {
            const pending = n.review.pending;
            return (
              <li key={n.id} className="border-b border-[var(--vo-hair)] last:border-b-0">
                <button type="button" onClick={() => openNote(n.id)} className="vo-focus vo-tap flex h-11 w-full min-w-0 items-center gap-3 px-4 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                  <NotebookPen size={15} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {n.title !== '' ? n.title : n.template.name}
                    {n.summary?.headline !== undefined && n.summary.headline !== '' && <span className="ml-3 font-normal text-[var(--vo-ink-2)]">{n.summary.headline}</span>}
                  </span>
                  {pending > 0 && (
                    <Tip text={`${pending} changes to accept`}>
                      <Count n={pending} tone="agent" />
                    </Tip>
                  )}
                  <State n={n} />
                  {n.author !== null && (
                    <Tip text={n.author.name}>
                      <Avatar name={n.author.name} size={20} />
                    </Tip>
                  )}
                  <span className="vo-mono vo-num w-20 shrink-0 text-right text-[12px] text-[var(--vo-muted)]">{fmtDay(n.meeting_day, { year: 'auto' })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {(open !== '' || fresh) && (
        <NoteEditor
          key={session}
          id={open !== '' ? open : null}
          home={home}
          onCreated={(id) => {
            setFresh(false);
            setQuery({ note: id });
          }}
          onClose={() => {
            setFresh(false);
            setQuery({ note: null });
          }}
        />
      )}
    </div>
  );
}
