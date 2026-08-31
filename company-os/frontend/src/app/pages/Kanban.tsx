/**
 * Kanban: a three-column board (To Do / In Progress / Done) with drag-and-drop
 * between columns. Each card carries the full detail a task needs — a progress
 * ring (checklist completion, or status when there's no checklist), a due date,
 * a person in charge, a note, a checklist, and file attachments — edited in a
 * slide-over detail drawer. Native HTML5 drag-and-drop, no new dependency.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckSquare, KanbanSquare, ListChecks, Paperclip, Plus, X } from 'lucide-react';
import {
  Button,
  DateInput,
  Dialog,
  Input,
  Select,
  getPbClient,
  toast,
  useCollection,
  useConfirm,
  cn,
} from '../../kit/index.ts';
import type { CardStatus, ChecklistItem, KanbanCard, TeamMember } from '../lib/types.ts';
import {
  GhostBoard,
  GhostState,
  IdentityChip,
  PageHeader,
  ProgressRing,
  RelDate,
  type Tone,
} from '../components/ui.tsx';
import { NoteEditor } from '../components/NoteEditor.tsx';

const COLUMNS: Array<{ key: CardStatus; label: string; tone: Tone }> = [
  { key: 'todo', label: 'To Do', tone: 'neutral' },
  { key: 'doing', label: 'In Progress', tone: 'accent' },
  { key: 'done', label: 'Done', tone: 'good' },
];
const DOT: Record<Tone, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  info: 'bg-sky-500',
  accent: 'bg-[var(--lui-accent)]',
  neutral: 'bg-[var(--lui-muted)]/60',
};

const CARDS = 'kanban_cards';

const STATE_WEIGHT: Record<CardStatus, number> = { todo: 0, doing: 0.5, done: 1 };
const NEXT_STATE: Record<CardStatus, CardStatus> = { todo: 'doing', doing: 'done', done: 'todo' };

/** Ring value: weighted checklist progress (doing counts half) if any, else status. */
function progressOf(card: KanbanCard): number {
  const list = card.checklist ?? [];
  if (list.length > 0) return list.reduce((a, i) => a + STATE_WEIGHT[i.state], 0) / list.length;
  return STATE_WEIGHT[card.status];
}

export function KanbanPage(): React.JSX.Element {
  const { records: cards } = useCollection<KanbanCard>(CARDS, { sort: 'created' });
  const { records: members } = useCollection<TeamMember>('team_members', { sort: 'name' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<CardStatus | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const openCard = openId !== null ? (cards.find((c) => c.id === openId) ?? null) : null;
  const memberName = (id: string): string => members.find((m) => m.id === id)?.name ?? '';

  const pb = getPbClient();
  const update = (id: string, patch: Record<string, unknown>): Promise<unknown> =>
    pb.call((p) => p.collection(CARDS).update(id, patch)).catch(() => undefined);

  const createCard = async (status: CardStatus, title: string): Promise<string | null> => {
    const t = title.trim();
    if (t === '') return null;
    try {
      const rec = await pb.call((p) =>
        p.collection(CARDS).create({ title: t, status, order: cards.length, checklist: [] }),
      );
      return rec.id;
    } catch {
      return null;
    }
  };

  const moveToStatus = (id: string, status: CardStatus): void => {
    const card = cards.find((c) => c.id === id);
    if (card === undefined || card.status === status) return;
    void update(id, { status });
  };

  const endDrag = (): void => {
    setDragId(null);
    setDragOver(null);
  };

  const removeCard = async (card: KanbanCard): Promise<void> => {
    if (!(await confirm(`Delete task "${card.title}"?`))) return;
    setOpenId(null);
    await pb.call((p) => p.collection(CARDS).delete(card.id)).catch(() => undefined);
  };

  return (
    <div>
      <PageHeader
        icon={KanbanSquare}
        title="Kanban"
        meta={cards.length > 0 ? String(cards.length) : undefined}
        subtitle="Move work across the board. Each card holds a due date, an owner, a checklist, notes, and files."
        actions={
          <Button
            size="sm"
            onClick={async () => {
              const id = await createCard('todo', 'New task');
              if (id !== null) setOpenId(id);
            }}
          >
            <Plus size={14} aria-hidden />
            New task
          </Button>
        }
      />

      {cards.length === 0 ? (
        <GhostState
          icon={KanbanSquare}
          title="No tasks yet"
          message="This is your board. Add a task and drag it across To Do → In Progress → Done. Open any card for its checklist, files, and owner."
          action={
            <Button
              onClick={async () => {
                const id = await createCard('todo', 'New task');
                if (id !== null) setOpenId(id);
              }}
            >
              <Plus size={14} aria-hidden />
              New task
            </Button>
          }
        >
          <GhostBoard columns={COLUMNS.map((c) => c.label)} />
        </GhostState>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const inCol = cards.filter((c) => c.status === col.key);
            const isTarget = dragId !== null && dragOver === col.key;
            return (
              <div
                key={col.key}
                onDragOver={(e) => {
                  if (dragId === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOver !== col.key) setDragOver(col.key);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain') || dragId;
                  if (id) moveToStatus(id, col.key);
                  endDrag();
                }}
                className={cn(
                  'flex flex-col border bg-[var(--lui-surface)] transition-colors',
                  isTarget ? 'border-[var(--lui-accent)] bg-[var(--lui-accent)]/[0.04]' : 'border-[var(--lui-border)]',
                )}
              >
                <div className="flex items-center gap-2 border-b border-[var(--lui-border)] px-3 py-2">
                  <span aria-hidden className={cn('size-1.5 rounded-full', DOT[col.tone])} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">{col.label}</span>
                  <span className="text-[11px] tabular-nums text-[var(--lui-muted)]">{inCol.length}</span>
                </div>
                <div className="flex min-h-24 flex-col gap-2 p-2">
                  {inCol.map((card) => (
                    <CardFace
                      key={card.id}
                      card={card}
                      ownerName={memberName(card.owner)}
                      dragging={dragId === card.id}
                      onOpen={() => setOpenId(card.id)}
                      onDragStart={(e) => {
                        setDragId(card.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', card.id);
                      }}
                      onDragEnd={endDrag}
                    />
                  ))}
                  {isTarget && inCol.length === 0 && (
                    <div className="flex min-h-16 items-center justify-center border border-dashed border-[var(--lui-accent)]/60 text-[11px] text-[var(--lui-accent)]">
                      Drop here
                    </div>
                  )}
                  <QuickAdd onAdd={(title) => void createCard(col.key, title)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmEl}

      <Dialog
        open={openCard !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
        title={openCard?.title ?? 'Task'}
        className="w-[min(94vw,40rem)]"
      >
        {openCard !== null && (
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <CardDetail
              card={openCard}
              members={members}
              onPatch={(patch) => void update(openCard.id, patch)}
              onDelete={() => void removeCard(openCard)}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Board card                                                          */
/* ------------------------------------------------------------------ */

function CardFace({
  card,
  ownerName,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: KanbanCard;
  ownerName: string;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}): React.JSX.Element {
  const list = card.checklist ?? [];
  const checkDone = list.filter((i) => i.state === 'done').length;
  const nAttach = card.attachments?.length ?? 0;
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        'flex w-full cursor-grab flex-col gap-2 border border-[var(--lui-border)] bg-[var(--lui-bg)]/50 px-3 py-2.5 text-left transition-colors hover:border-[var(--lui-muted)]/50 active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        <ProgressRing value={progressOf(card)} size={18} className="mt-0.5" />
        <span
          className={cn(
            'min-w-0 flex-1 text-[13px] font-medium leading-snug',
            card.status === 'done' && 'text-[var(--lui-muted)] line-through decoration-[var(--lui-border)]',
          )}
        >
          {card.title}
        </span>
      </div>
      {(card.due !== '' || ownerName !== '' || list.length > 0 || nAttach > 0 || card.note !== '') && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[26px] text-[11px] text-[var(--lui-muted)]">
          {card.due !== '' && card.status !== 'done' && <RelDate iso={card.due} />}
          {list.length > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <ListChecks size={12} aria-hidden />
              {checkDone}/{list.length}
            </span>
          )}
          {nAttach > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Paperclip size={11} aria-hidden />
              {nAttach}
            </span>
          )}
          {card.note !== '' && <span className="inline-flex items-center gap-1">note</span>}
          {ownerName !== '' && (
            <span className="ml-auto inline-flex items-center gap-1">
              <IdentityChip name={ownerName} size="sm" />
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function QuickAdd({ onAdd }: { onAdd: (title: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const submit = (): void => {
    if (title.trim() !== '') onAdd(title);
    setTitle('');
    setOpen(false);
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-1 py-1 text-[12px] text-[var(--lui-muted)] transition-colors hover:text-[var(--lui-text)]"
      >
        <Plus size={13} aria-hidden />
        Add a task
      </button>
    );
  }
  return (
    <Input
      autoFocus
      placeholder="Task title, Enter to add"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') {
          setTitle('');
          setOpen(false);
        }
      }}
      className="h-8 text-[13px]"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer                                                       */
/* ------------------------------------------------------------------ */

function CardDetail({
  card,
  members,
  onPatch,
  onDelete,
}: {
  card: KanbanCard;
  members: TeamMember[];
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}): React.JSX.Element {
  // Every editable field lives in local state so the input reflects the change
  // the instant you make it. Tying a controlled input straight to the async
  // record makes it snap back until the round-trip lands — that was the
  // "due date won't change" bug. Resynced when a different card is opened.
  const [title, setTitle] = useState(card.title);
  const [status, setStatus] = useState<CardStatus>(card.status);
  const [due, setDue] = useState(card.due);
  const [owner, setOwner] = useState(card.owner);
  const [list, setList] = useState<ChecklistItem[]>(card.checklist ?? []);
  const [newItem, setNewItem] = useState('');
  const pb = getPbClient();

  useEffect(() => {
    setTitle(card.title);
    setStatus(card.status);
    setDue(card.due);
    setOwner(card.owner);
    setList(card.checklist ?? []);
  }, [card.id]);

  // The note editor emits Markdown on every keystroke; persist debounced, and
  // flush any pending edit when the modal closes so nothing is lost.
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestNote = useRef(card.note);
  const onNoteChange = (md: string): void => {
    latestNote.current = md;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      if (md !== card.note) onPatch({ note: md });
    }, 500);
  };
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
      if (latestNote.current !== card.note) onPatch({ note: latestNote.current });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const setStatusVal = (s: CardStatus): void => {
    setStatus(s);
    onPatch({ status: s });
  };
  const setDueVal = (iso: string | null): void => {
    const v = iso ?? '';
    setDue(v);
    onPatch({ due: v });
  };
  const setOwnerVal = (o: string): void => {
    setOwner(o);
    onPatch({ owner: o });
  };

  const persistChecklist = (next: ChecklistItem[]): void => {
    setList(next);
    onPatch({ checklist: next });
  };
  const addItem = (): void => {
    const t = newItem.trim();
    if (t === '') return;
    persistChecklist([...list, { text: t, state: 'todo' }]);
    setNewItem('');
  };
  const cycleItem = (i: number): void =>
    persistChecklist(list.map((it, idx) => (idx === i ? { ...it, state: NEXT_STATE[it.state] } : it)));
  const removeItem = (i: number): void => persistChecklist(list.filter((_, idx) => idx !== i));

  const uploadFile = async (file: File | null | undefined): Promise<void> => {
    if (file === null || file === undefined) return;
    const form = new FormData();
    form.append('attachments+', file);
    try {
      await pb.call((p) => p.collection(CARDS).update(card.id, form));
      toast.success('File attached');
    } catch {
      toast.error('Upload failed');
    }
  };
  const removeFile = (filename: string): void => {
    void pb.call((p) => p.collection(CARDS).update(card.id, { 'attachments-': filename })).catch(() => undefined);
  };

  const checkDone = list.filter((i) => i.state === 'done').length;
  const attachments = card.attachments ?? [];

  return (
    <div className="flex flex-col gap-5">
      {/* Title */}
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() !== '' && title !== card.title && onPatch({ title: title.trim() })}
        className="text-sm font-semibold"
        aria-label="Task title"
      />

      {/* Status / Due / Owner */}
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatusVal(e.target.value as CardStatus)}
          options={COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
        />
        <DateInput label="Due date" dateOnly value={due === '' ? null : due} onValue={setDueVal} />
        <div className="col-span-2">
          <Select
            label="Person in charge"
            value={owner}
            onChange={(e) => setOwnerVal(e.target.value)}
            placeholder="Unassigned"
            options={members.map((m) => ({ value: m.id, label: m.name }))}
          />
        </div>
      </div>

      {/* Checklist — add input on top, three states: to do → doing → done */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <ListChecks size={14} aria-hidden className="text-[var(--lui-muted)]" />
          <span className="text-[13px] font-semibold">Checklist</span>
          {list.length > 0 && (
            <span className="text-[11px] tabular-nums text-[var(--lui-muted)]">
              {checkDone}/{list.length}
            </span>
          )}
        </div>
        <Input
          placeholder="Add a checklist item, Enter to add"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addItem();
          }}
          className="h-8 text-[13px]"
        />
        {list.length > 0 && (
          <div className="mt-1.5 flex flex-col">
            {list.map((item, i) => (
              <div key={i} className="group flex items-center gap-2 py-1">
                <button
                  type="button"
                  onClick={() => cycleItem(i)}
                  title={item.state === 'todo' ? 'To do' : item.state === 'doing' ? 'In progress' : 'Done'}
                  aria-label={`Item is ${item.state}. Click to advance.`}
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center border transition-colors',
                    item.state === 'done'
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : item.state === 'doing'
                        ? 'border-[var(--lui-accent)] bg-[var(--lui-accent)]/25'
                        : 'border-[var(--lui-border)] hover:border-[var(--lui-muted)]',
                  )}
                >
                  {item.state === 'done' && <CheckSquare size={11} aria-hidden />}
                </button>
                <span
                  className={cn(
                    'min-w-0 flex-1 text-[13px]',
                    item.state === 'done' && 'text-[var(--lui-muted)] line-through decoration-[var(--lui-border)]',
                  )}
                >
                  {item.text}
                </span>
                {item.state === 'doing' && (
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--lui-accent)]">
                    doing
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  aria-label="Remove item"
                  className="shrink-0 text-[var(--lui-muted)] opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Note — inline Markdown editor (converts as you type), plus files */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[13px] font-semibold">Note</span>
          {attachments.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-[var(--lui-muted)]">
              <Paperclip size={11} aria-hidden />
              {attachments.length}
            </span>
          )}
        </div>
        <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
          <div className="px-3 py-2.5">
            <NoteEditor value={card.note} resetKey={card.id} onChange={onNoteChange} />
          </div>
          <div className="flex flex-col gap-1.5 border-t border-[var(--lui-border)] p-2">
            {attachments.map((filename) => (
              <div
                key={filename}
                className="group flex items-center gap-2 border border-[var(--lui-border)] bg-[var(--lui-bg)]/40 px-2.5 py-1.5"
              >
                <Paperclip size={12} aria-hidden className="shrink-0 text-[var(--lui-muted)]" />
                <a
                  href={pb.pb.files.getURL(card, filename)}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-[12px] text-[var(--lui-accent)] hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {filename.replace(/_\w{10}(\.\w+)?$/, '$1')}
                </a>
                <button
                  type="button"
                  onClick={() => removeFile(filename)}
                  aria-label="Remove attachment"
                  className="shrink-0 text-[var(--lui-muted)] opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
            ))}
            <label className="flex cursor-pointer items-center justify-center gap-2 border border-dashed border-[var(--lui-border)] px-3 py-2 text-[12px] text-[var(--lui-muted)] transition-colors hover:border-[var(--lui-muted)] hover:text-[var(--lui-text)]">
              <Paperclip size={13} aria-hidden />
              Attach a file
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  void uploadFile(e.target.files?.item(0));
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Delete */}
      <div className="flex justify-end border-t border-[var(--lui-border)] pt-4">
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-red-600 hover:bg-red-500/10 dark:text-red-400">
          <X size={14} aria-hidden />
          Delete task
        </Button>
      </div>
    </div>
  );
}
