/**
 * Notes: the lightweight knowledge base. Pinned notes lead, categories are
 * quiet pills, and reading happens in a wide drawer. Weekly digests and
 * CraftBot checkup notes land here too.
 */
import { useState } from 'react';
import { NotebookPen, Pin, Plus } from 'lucide-react';
import {
  Button,
  Dialog,
  EntityForm,
  SearchInput,
  getPbClient,
  useCollection,
  useConfirm,
  cn,
} from '../../kit/index.ts';
import type { EntityField } from '../../kit/index.ts';
import type { Note } from '../lib/types.ts';
import { AgoDate, DeleteButton, EditButton, EmptyHint, GhostCards, GhostState, PageHeader } from '../components/ui.tsx';

const NOTE_FIELDS: EntityField[] = [
  { name: 'title', type: 'text', required: true },
  { name: 'category', type: 'text', placeholder: 'e.g. Ideas, Decisions, Research' },
  { name: 'body', type: 'textarea' },
  { name: 'pinned', label: 'Pin to the top', type: 'boolean' },
];

export function NotesPage(): React.JSX.Element {
  const { records: notes, loading } = useCollection<Note>('notes', { sort: '-created' });
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [reading, setReading] = useState<Note | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const remove = async (n: Note): Promise<void> => {
    if (!(await confirm(`Delete note "${n.title}"?`))) return;
    setReading(null);
    await getPbClient()
      .call((pb) => pb.collection('notes').delete(n.id))
      .catch(() => undefined);
  };

  const q = query.toLowerCase();
  const filtered =
    q === ''
      ? notes
      : notes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.category.toLowerCase().includes(q) ||
            n.body.toLowerCase().includes(q),
        );
  const ordered = [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const addButton = (
    <Button
      size="sm"
      onClick={() => {
        setEditing(null);
        setFormOpen(true);
      }}
    >
      <Plus size={14} aria-hidden />
      New note
    </Button>
  );

  return (
    <div>
      <PageHeader icon={NotebookPen} title="Notes" meta={String(notes.length)} actions={addButton} />

      <div className="mb-4">
        <SearchInput onSearch={setQuery} placeholder="Search notes…" />
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-[var(--lui-muted)]">Loading…</p>
      ) : ordered.length === 0 ? (
        q === '' ? (
          <GhostState
            icon={NotebookPen}
            title="No notes yet"
            message="Write down the things you decide and learn. Future you will thank present you."
            action={addButton}
          >
            <GhostCards count={3} />
          </GhostState>
        ) : (
          <div className="border border-dashed border-[var(--lui-border)]">
            <EmptyHint
              icon={NotebookPen}
              title="No notes match your search"
              message="Try a different word, or clear the search."
            />
          </div>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setReading(n)}
              className={cn(
                'group flex h-full flex-col gap-2 border bg-[var(--lui-surface)] p-4 text-left transition-colors hover:border-[var(--lui-muted)]/50',
                n.pinned ? 'border-[var(--lui-accent)]/40' : 'border-[var(--lui-border)]',
              )}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold">{n.title}</p>
                {n.pinned && <Pin size={12} aria-label="Pinned" className="mt-0.5 shrink-0 text-[var(--lui-accent)]" />}
              </div>
              <p className="line-clamp-4 w-full whitespace-pre-line text-xs leading-relaxed text-[var(--lui-muted)]">
                {n.body}
              </p>
              <div className="mt-auto flex w-full items-center justify-between pt-1">
                {n.category !== '' ? (
                  <span className="bg-[var(--lui-border)]/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--lui-muted)]">
                    {n.category}
                  </span>
                ) : (
                  <span />
                )}
                <AgoDate iso={n.created} />
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={reading !== null}
        onOpenChange={(o) => {
          if (!o) setReading(null);
        }}
        title={reading?.title ?? ''}
        className="w-[min(94vw,42rem)]"
        footer={
          <>
            <DeleteButton label="Delete note" onClick={() => reading !== null && void remove(reading)} />
            <EditButton
              label="Edit note"
              onClick={() => {
                setEditing(reading);
                setReading(null);
                setFormOpen(true);
              }}
            />
          </>
        }
      >
        <p className="max-h-[65vh] overflow-y-auto whitespace-pre-line text-sm leading-relaxed">
          {reading?.body ?? ''}
        </p>
      </Dialog>

      <Dialog
        open={formOpen}
        onOpenChange={(o) => {
          if (!o) setFormOpen(false);
        }}
        title={editing !== null ? 'Edit note' : 'New note'}
        className="w-[min(94vw,40rem)]"
      >
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          <EntityForm
            collection="notes"
            fields={NOTE_FIELDS}
            {...(editing !== null ? { initial: editing } : {})}
            onSaved={() => setFormOpen(false)}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      </Dialog>

      {confirmEl}
    </div>
  );
}
