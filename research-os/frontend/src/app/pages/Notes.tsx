/**
 * Notes: literature notes (one per paper), project notes and free notes,
 * pinned first. Blocks embed passages and claims by reference, so a quote in
 * a note is always the passage itself, one click from its page.
 */
import { useEffect, useState } from 'react';
import { BookOpenText, FileText, FolderKanban, NotebookPen, Pin, PinOff, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { ago, plural } from '../lib/format.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import type { Anchor, Note } from '../lib/types.ts';
import { NoteEditor } from '../components/notes/NoteEditor.tsx';
import { Badge, Button, Empty, IconButton, LoadError, Segmented, Skeleton, Spinner, useConfirm } from '../components/ui.tsx';

type Kind = '' | 'literature' | 'project' | 'free';

export default function NotesPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <NotesWorkspace project="" noteId={query.get('note') ?? ''} startNew={query.get('new') === '1'} />
    </div>
  );
}

export function NotesWorkspace({ project, noteId, startNew = false }: { project: string; noteId: string; startNew?: boolean }): React.JSX.Element {
  const [kind, setKind] = useState<Kind>('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);
  const list = useLive((signal) => op<{ notes: Note[] }>('notes.list', { project: project || undefined, kind: kind || undefined, q: debounced || undefined, limit: 300 }, { quiet: true, signal }).then((r) => r.notes), ['notes'], [project, kind, debounced], 200);
  const selected = noteId !== '' ? noteId : (list.data?.[0]?.id ?? '');
  const open = (id: string): void => replaceQuery({ note: id, new: undefined });
  const create = async (): Promise<void> => {
    const r = await op<{ note: Note }>('notes.create', project !== '' ? { kind: 'project', project, title: '' } : { kind: 'free', title: '' });
    changed('notes');
    open(r.note.id);
  };
  useEffect(() => {
    if (startNew) void create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNew]);
  return (
    <div className="flex min-h-0 flex-1 @container">
      <aside className={cn('flex w-full shrink-0 flex-col border-r border-[var(--ro-line)] bg-[var(--ro-card)] @min-[760px]:w-72', selected !== '' && 'hidden @min-[760px]:flex')}>
        <div className="flex items-center gap-2 border-b border-[var(--ro-hair)] px-3 py-2.5">
          <NotebookPen size={14} className="text-[var(--ro-muted)]" />
          <span className="flex-1 text-[13px] font-bold">{project !== '' ? 'Project notes' : 'Notes'}</span>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => void create()}>
            New
          </Button>
        </div>
        <div className="flex flex-col gap-2 px-3 py-2">
          <label className="flex h-7 items-center gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] px-2 focus-within:border-[var(--ro-ink)]">
            <Search size={13} className="text-[var(--ro-muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" aria-label="Search notes" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
          </label>
          {project === '' && <Segmented label="Kind" size="sm" value={kind} onChange={setKind} options={[{ value: '', label: 'All' }, { value: 'literature', label: 'Papers' }, { value: 'project', label: 'Projects' }, { value: 'free', label: 'Free' }]} />}
        </div>
        <div data-scroll className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {list.error !== null && <LoadError message={list.error} onRetry={list.reload} />}
          {list.data === null && list.error === null && (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          )}
          {list.data !== null && list.data.length === 0 && <Empty compact icon={NotebookPen} title={debounced !== '' ? 'No notes match' : 'No notes yet'} action={debounced === '' ? <Button icon={Plus} onClick={() => void create()}>New note</Button> : undefined} />}
          <ul className="flex flex-col gap-px">
            {(list.data ?? []).map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => open(n.id)} className={cn('flex w-full flex-col gap-0.5 rounded-[var(--ro-r)] px-2.5 py-2 text-left', n.id === selected ? 'bg-[var(--ro-row-hover)]' : 'hover:bg-[var(--ro-row)]')}>
                  <span className="flex items-center gap-1.5">
                    {n.kind === 'literature' ? <BookOpenText size={12} className="shrink-0 text-[var(--ro-muted)]" /> : n.kind === 'project' ? <FolderKanban size={12} className="shrink-0 text-[var(--ro-muted)]" /> : <FileText size={12} className="shrink-0 text-[var(--ro-muted)]" />}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{n.title || 'Untitled note'}</span>
                    {n.pinned && <Pin size={11} className="shrink-0 text-[var(--ro-muted)]" />}
                    {n.status === 'agent_proposed' && <Sparkles size={11} className="shrink-0 text-[var(--ro-accent)]" aria-label="Written by your AI agent, not kept yet" />}
                  </span>
                  {n.snippet !== '' && <span className="line-clamp-2 text-[12px] leading-4 text-[var(--ro-muted)]">{n.snippet}</span>}
                  <span className="truncate text-[12px] text-[var(--ro-muted)]">
                    {n.kind === 'literature' && n.work_label !== '' ? n.work_label + ' · ' : n.kind === 'project' && project === '' && n.project_name !== '' ? n.project_name + ' · ' : ''}
                    {ago(n.updated)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {(list.data ?? []).length > 0 && <div className="border-t border-[var(--ro-hair)] px-3 py-1.5 text-[12px] text-[var(--ro-muted)]">{plural(list.data?.length ?? 0, 'note')}</div>}
      </aside>
      <section className={cn('min-w-0 flex-1 flex-col bg-[var(--ro-card)]', selected === '' ? 'hidden @min-[760px]:flex' : 'flex')}>
        {selected === '' ? (
          <div className="flex flex-1 items-center justify-center">
            <Empty icon={NotebookPen} title="No note open" action={<Button icon={Plus} onClick={() => void create()}>New note</Button>} />
          </div>
        ) : (
          <OpenNote key={selected} id={selected} onGone={() => replaceQuery({ note: undefined })} />
        )}
      </section>
    </div>
  );
}

function OpenNote({ id, onGone }: { id: string; onGone: () => void }): React.JSX.Element {
  const note = useLive((signal) => op<{ note: Note }>('notes.get', { note: id }, { quiet: true, signal }).then((r) => r.note), ['notes', 'anchors', 'nodes'], [id], 300);
  const [confirmNode, confirm] = useConfirm();
  if (note.error !== null) return <div className="p-4"><LoadError message={note.error} onRetry={note.reload} /></div>;
  if (note.data === null) return <div className="flex flex-1 items-center justify-center"><Spinner size={20} /></div>;
  const n = note.data;
  const jump = (a: Anchor): void => navigate('read', { file: a.file, page: String(a.page) });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--ro-hair)] px-3">
        <button type="button" onClick={onGone} className="mr-1 text-[12px] font-semibold text-[var(--ro-muted)] hover:text-[var(--ro-ink)] @min-[760px]:hidden">
          All notes
        </button>
        {n.kind === 'literature' && n.work !== '' && (
          <Button size="sm" variant="ghost" icon={BookOpenText} onClick={() => navigate('paper', { id: n.work })}>
            {n.work_label || 'The paper'}
          </Button>
        )}
        {n.kind === 'project' && n.project !== '' && <Badge tone="neutral">{n.project_name}</Badge>}
        <span className="flex-1" />
        <IconButton icon={n.pinned ? PinOff : Pin} label={n.pinned ? 'Unpin' : 'Pin'} onClick={() => void op('notes.update', { note: n.id, pinned: !n.pinned }).then(() => changed('notes'))} />
        <IconButton
          icon={Trash2}
          label="Delete the note"
          variant="danger"
          onClick={async () => {
            if (!(await confirm('Delete "' + (n.title || 'this note') + '"?', 'Delete note', 'Delete'))) return;
            await op('notes.delete', { note: n.id });
            changed('notes');
            onGone();
          }}
        />
      </div>
      <div data-scroll className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 py-6">
          <NoteEditor note={n} onJump={jump} />
        </div>
      </div>
      {confirmNode}
    </div>
  );
}
