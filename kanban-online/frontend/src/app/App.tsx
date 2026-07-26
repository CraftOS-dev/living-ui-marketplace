/**
 * Kanban Board — boards → lists → cards with labels, priorities, due dates,
 * checklists, archiving and drag-and-drop between columns.
 */
import { useMemo, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
  Progress,
  getPbClient,
  toast,
  useAuth,
  useCollection,
} from '../kit/index.ts';

interface Member extends RecordModel {
  email: string;
  name: string;
}

interface Board extends RecordModel {
  name: string;
}

interface List extends RecordModel {
  board: string;
  title: string;
  position: number;
}

interface ChecklistItem {
  text: string;
  done: boolean;
}

interface CardRec extends RecordModel {
  list: string;
  title: string;
  description: string;
  priority: '' | 'none' | 'low' | 'medium' | 'high' | 'urgent';
  due_date: string;
  position: number;
  archived: boolean;
  labels: string[];
  checklist: ChecklistItem[] | null;
}

interface Label extends RecordModel {
  board: string;
  name: string;
  color: string;
}

const PRIORITY_BADGE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  low: 'secondary',
  medium: 'default',
  high: 'destructive',
  urgent: 'destructive',
};
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

function isOverdue(due: string): boolean {
  return due !== '' && new Date(due).getTime() < Date.now();
}

function checklistProgress(items: ChecklistItem[] | null): number | null {
  if (items === null || items.length === 0) return null;
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

export function App(): React.JSX.Element {
  const { records: boards, loading } = useCollection<Board>('boards', { sort: 'created' });
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');

  const boardId = selectedBoard ?? boards[0]?.id ?? null;

  const createBoard = async (): Promise<void> => {
    const name = newBoardName.trim();
    if (name === '') return;
    try {
      const rec = await getPbClient().call((pb) =>
        pb.collection('boards').create<Board>({ name }),
      );
      setSelectedBoard(rec.id);
      setNewBoardOpen(false);
      setNewBoardName('');
      toast.success(`Board "${name}" created`);
    } catch {
      /* surfaced by shell */
    }
  };

  const currentBoard = boards.find((b) => b.id === boardId);

  const renameBoard = async (): Promise<void> => {
    if (currentBoard === undefined) return;
    const next = window.prompt('Rename board:', currentBoard.name);
    if (next === null || next.trim() === '' || next.trim() === currentBoard.name) return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('boards').update(currentBoard.id, { name: next.trim() }),
      );
      toast.success('Board renamed');
    } catch {
      /* surfaced by shell */
    }
  };

  const deleteBoard = async (): Promise<void> => {
    if (currentBoard === undefined) return;
    if (!window.confirm(`Delete board "${currentBoard.name}" with all its lists and cards?`)) return;
    try {
      await getPbClient().call((pb) => pb.collection('boards').delete(currentBoard.id));
      setSelectedBoard(null);
      toast.success('Board deleted');
    } catch {
      /* surfaced by shell */
    }
  };

  if (loading) return <p className="p-6 text-sm opacity-70">Loading boards…</p>;

  return (
    <div className="flex h-full min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Kanban</h1>
        <select
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
          value={boardId ?? ''}
          onChange={(e) => setSelectedBoard(e.target.value)}
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => setNewBoardOpen(true)}>
          New board
        </Button>
        <WorkspaceMenu />
        {currentBoard !== undefined && (
          <>
            <Button variant="outline" size="sm" onClick={() => void renameBoard()}>
              Rename
            </Button>
            <Button variant="outline" size="sm" onClick={() => void deleteBoard()}>
              Delete board
            </Button>
          </>
        )}
      </header>

      {boardId === null ? (
        <p className="p-6 text-sm opacity-70">Create a board to get started.</p>
      ) : (
        <BoardView key={boardId} boardId={boardId} />
      )}

      <Dialog
        open={newBoardOpen}
        onOpenChange={setNewBoardOpen}
        title="New board"
        footer={
          <Button onClick={() => void createBoard()} disabled={newBoardName.trim() === ''}>
            Create
          </Button>
        }
      >
        <Input
          value={newBoardName}
          placeholder="Board name"
          onChange={(e) => setNewBoardName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createBoard();
          }}
        />
      </Dialog>
    </div>
  );
}

function BoardView({ boardId }: { boardId: string }): React.JSX.Element {
  const { records: lists } = useCollection<List>('lists', {
    filter: `board = "${boardId}"`,
    sort: 'position',
  });
  const { records: cards } = useCollection<CardRec>('cards', {
    filter: `list.board = "${boardId}" && archived = false`,
    sort: 'position',
  });
  const { records: labels } = useCollection<Label>('labels', {
    filter: `board = "${boardId}"`,
    sort: 'name',
  });
  const [newListTitle, setNewListTitle] = useState('');
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);

  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  // Resolve from live records so realtime updates reach the open dialog.
  const openCard = openCardId === null ? null : (cards.find((c) => c.id === openCardId) ?? null);

  // Cross-card search over title + description, plus an optional label filter.
  const query = search.trim().toLowerCase();
  const visibleCards = cards.filter((c) => {
    if (
      query !== '' &&
      !c.title.toLowerCase().includes(query) &&
      !c.description.toLowerCase().includes(query)
    ) {
      return false;
    }
    if (labelFilter !== '' && !c.labels.includes(labelFilter)) return false;
    return true;
  });
  const filtering = query !== '' || labelFilter !== '';

  // Board stats: total cards, due/overdue, checklist completion.
  const stats = useMemo(() => {
    const total = cards.length;
    const now = Date.now();
    const overdue = cards.filter(
      (c) => c.due_date !== '' && new Date(c.due_date).getTime() < now,
    ).length;
    let checklistDone = 0;
    let checklistAll = 0;
    for (const c of cards) {
      for (const item of c.checklist ?? []) {
        checklistAll += 1;
        if (item.done) checklistDone += 1;
      }
    }
    const byPriority: Record<string, number> = {};
    for (const c of cards) {
      const key = c.priority === '' ? 'none' : c.priority;
      byPriority[key] = (byPriority[key] ?? 0) + 1;
    }
    return { total, overdue, checklistDone, checklistAll, byPriority };
  }, [cards]);

  const addList = async (): Promise<void> => {
    const title = newListTitle.trim();
    if (title === '') return;
    const position = Math.max(0, ...lists.map((l) => l.position + 1));
    try {
      await getPbClient().call((pb) =>
        pb.collection('lists').create({ board: boardId, title, position }),
      );
      setNewListTitle('');
    } catch {
      /* surfaced by shell */
    }
  };

  /** Move a card to a list, optionally before a specific card (reorder).
   *  The target list is renumbered 0..n so ordering stays stable. */
  const moveCard = async (
    cardId: string,
    toList: string,
    beforeCardId: string | null = null,
  ): Promise<void> => {
    const card = cards.find((c) => c.id === cardId);
    if (card === undefined || cardId === beforeCardId) return;
    const target = cards
      .filter((c) => c.list === toList && c.id !== cardId)
      .sort((a, b) => a.position - b.position);
    const foundIndex = beforeCardId === null ? -1 : target.findIndex((c) => c.id === beforeCardId);
    const insertAt = foundIndex === -1 ? target.length : foundIndex;
    const ordered = [...target.slice(0, insertAt), card, ...target.slice(insertAt)];
    try {
      for (let i = 0; i < ordered.length; i++) {
        const item = ordered[i]!;
        const needsList = item.id === cardId && item.list !== toList;
        if (item.position === i && !needsList) continue;
        await getPbClient().call((pb) =>
          pb.collection('cards').update(item.id, needsList ? { list: toList, position: i } : { position: i }),
        );
      }
    } catch {
      /* surfaced by shell */
    }
  };

  const moveList = async (listId: string, delta: number): Promise<void> => {
    const ordered = [...lists].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((l) => l.id === listId);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= ordered.length) return;
    const [item] = ordered.splice(index, 1);
    ordered.splice(target, 0, item!);
    try {
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i]!.position === i) continue;
        await getPbClient().call((pb) =>
          pb.collection('lists').update(ordered[i]!.id, { position: i }),
        );
      }
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <Input
          className="w-64"
          value={search}
          placeholder="🔍 Search cards…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-md border bg-transparent px-2 py-1 text-sm"
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
        >
          <option value="">All labels</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => setLabelManagerOpen(true)}>
          Labels
        </Button>
        {filtering && (
          <span className="text-xs opacity-60">
            {visibleCards.length} of {cards.length} card(s) match
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums opacity-60">
          {stats.total} cards
          {stats.overdue > 0 && <span className="text-red-500"> · {stats.overdue} overdue</span>}
          {stats.checklistAll > 0 && ` · checklist ${stats.checklistDone}/${stats.checklistAll}`}
          {(['urgent', 'high', 'medium', 'low'] as const)
            .filter((p) => (stats.byPriority[p] ?? 0) > 0)
            .map((p) => ` · ${stats.byPriority[p]} ${p}`)
            .join('')}
        </span>
      </div>
      <main className="flex flex-1 items-start gap-4 overflow-x-auto p-4">
      {lists.map((list) => (
        <ListColumn
          key={list.id}
          list={list}
          cards={visibleCards.filter((c) => c.list === list.id)}
          labelById={labelById}
          onOpenCard={(card) => setOpenCardId(card.id)}
          onDropCard={(cardId, beforeCardId) => void moveCard(cardId, list.id, beforeCardId)}
          onMoveList={(delta) => void moveList(list.id, delta)}
        />
      ))}
      <div className="w-64 shrink-0">
        <Input
          value={newListTitle}
          placeholder="+ Add list"
          onChange={(e) => setNewListTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addList();
          }}
        />
      </div>

      {openCard !== null && (
        <CardDialog card={openCard} boardLabels={labels} onClose={() => setOpenCardId(null)} />
      )}
      {labelManagerOpen && (
        <LabelManagerDialog
          labels={labels}
          boardId={boardId}
          cards={cards}
          onClose={() => setLabelManagerOpen(false)}
        />
      )}
      </main>
    </div>
  );
}

function ListColumn({
  list,
  cards,
  labelById,
  onOpenCard,
  onDropCard,
  onMoveList,
}: {
  list: List;
  cards: CardRec[];
  labelById: Map<string, Label>;
  onOpenCard: (card: CardRec) => void;
  onDropCard: (cardId: string, beforeCardId: string | null) => void;
  onMoveList: (delta: number) => void;
}): React.JSX.Element {
  const [newCardTitle, setNewCardTitle] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  const renameList = async (next: string): Promise<void> => {
    const trimmed = next.trim();
    setEditingTitle(false);
    if (trimmed === '' || trimmed === list.title) return;
    try {
      await getPbClient().call((pb) => pb.collection('lists').update(list.id, { title: trimmed }));
    } catch {
      /* surfaced by shell */
    }
  };

  const addCard = async (): Promise<void> => {
    const title = newCardTitle.trim();
    if (title === '') return;
    const position = Math.max(0, ...cards.map((c) => c.position + 1));
    try {
      await getPbClient().call((pb) =>
        pb.collection('cards').create({
          list: list.id,
          title,
          position,
          priority: 'none',
          archived: false,
        }),
      );
      setNewCardTitle('');
    } catch {
      /* surfaced by shell */
    }
  };

  const deleteList = async (): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('lists').delete(list.id));
      toast.success(`List "${list.title}" deleted`);
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div
      className={`w-72 shrink-0 ${dragOver ? 'rounded-xl ring-2 ring-blue-400' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const cardId = e.dataTransfer.getData('text/plain');
        if (cardId !== '') onDropCard(cardId, null);
      }}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
          <CardTitle className="min-w-0 flex-1 text-sm">
            {editingTitle ? (
              <Input
                autoFocus
                defaultValue={list.title}
                className="h-7"
                onBlur={(e) => void renameList(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void renameList(e.currentTarget.value);
                  if (e.key === 'Escape') setEditingTitle(false);
                }}
              />
            ) : (
              <button
                type="button"
                className="text-left hover:underline"
                title="Click to rename"
                onClick={() => setEditingTitle(true)}
              >
                {list.title} <span className="ml-1 font-normal opacity-60">{cards.length}</span>
              </button>
            )}
          </CardTitle>
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              title="Move list left"
              className="px-1 text-xs opacity-50 hover:opacity-100"
              onClick={() => onMoveList(-1)}
            >
              ←
            </button>
            <button
              type="button"
              title="Move list right"
              className="px-1 text-xs opacity-50 hover:opacity-100"
              onClick={() => onMoveList(1)}
            >
              →
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (cards.length === 0) void deleteList();
                else toast.error('Move or delete its cards first');
              }}
            >
              ✕
            </Button>
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {cards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              labelById={labelById}
              onOpen={() => onOpenCard(card)}
              onDropBefore={(draggedId) => onDropCard(draggedId, card.id)}
            />
          ))}
          <Input
            value={newCardTitle}
            placeholder="+ Add card"
            onChange={(e) => setNewCardTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addCard();
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function CardTile({
  card,
  labelById,
  onOpen,
  onDropBefore,
}: {
  card: CardRec;
  labelById: Map<string, Label>;
  onOpen: () => void;
  onDropBefore: (draggedCardId: string) => void;
}): React.JSX.Element {
  const progress = checklistProgress(card.checklist);
  const [dropTarget, setDropTarget] = useState(false);
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(false);
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId !== '' && draggedId !== card.id) onDropBefore(draggedId);
      }}
      onClick={onOpen}
      className={`cursor-pointer rounded-md border p-2 text-sm shadow-sm hover:shadow ${dropTarget ? 'border-t-2 border-t-blue-500' : ''}`}
    >
      {card.labels.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {card.labels.map((id) => {
            const label = labelById.get(id);
            if (label === undefined) return null;
            return (
              <span
                key={id}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: label.color }}
              >
                {label.name}
              </span>
            );
          })}
        </div>
      )}
      <p>{card.title}</p>
      {(card.priority !== 'none' && card.priority !== '') || card.due_date !== '' ? (
        <div className="mt-1 flex items-center gap-2">
          {card.priority !== 'none' && card.priority !== '' && (
            <Badge variant={PRIORITY_BADGE[card.priority] ?? 'default'}>{card.priority}</Badge>
          )}
          {card.due_date !== '' && (
            <span
              className={`text-xs ${isOverdue(card.due_date) ? 'text-red-500' : 'opacity-60'}`}
            >
              {new Date(card.due_date).toLocaleDateString()}
            </span>
          )}
        </div>
      ) : null}
      {progress !== null && <Progress value={progress} className="mt-2 h-1.5" />}
    </div>
  );
}

function CardDialog({
  card,
  boardLabels,
  onClose,
}: {
  card: CardRec;
  boardLabels: Label[];
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [newChecklistText, setNewChecklistText] = useState('');
  const checklist = card.checklist ?? [];

  const update = async (patch: Record<string, unknown>): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('cards').update(card.id, patch));
    } catch {
      /* surfaced by shell */
    }
  };

  const toggleLabel = (labelId: string): void => {
    const next = card.labels.includes(labelId)
      ? card.labels.filter((id) => id !== labelId)
      : [...card.labels, labelId];
    void update({ labels: next });
  };

  const addChecklistItem = (): void => {
    const text = newChecklistText.trim();
    if (text === '') return;
    void update({ checklist: [...checklist, { text, done: false }] });
    setNewChecklistText('');
  };

  const removeCard = async (): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('cards').delete(card.id));
      toast.success('Card deleted');
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Card"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="destructive" size="sm" onClick={() => void removeCard()}>
            Delete
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void update({ archived: true });
              toast.success('Card archived');
              onClose();
            }}
          >
            Archive
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() !== '' && title !== card.title) void update({ title: title.trim() });
          }}
        />
        <textarea
          className="min-h-20 rounded-md border bg-transparent p-2 text-sm"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== card.description) void update({ description });
          }}
        />

        <div className="flex items-center gap-2">
          <label className="text-xs opacity-70">Priority</label>
          <select
            className="rounded-md border bg-transparent px-2 py-1 text-sm"
            value={card.priority === '' ? 'none' : card.priority}
            onChange={(e) => void update({ priority: e.target.value })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <label className="ml-2 text-xs opacity-70">Due</label>
          <input
            type="date"
            className="rounded-md border bg-transparent px-2 py-1 text-sm"
            value={card.due_date === '' ? '' : card.due_date.slice(0, 10)}
            onChange={(e) =>
              void update({ due_date: e.target.value === '' ? '' : `${e.target.value} 12:00:00` })
            }
          />
        </div>

        <div>
          <p className="mb-1 text-xs opacity-70">Labels</p>
          <div className="flex flex-wrap gap-1">
            {boardLabels.map((label) => {
              const active = card.labels.includes(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => toggleLabel(label.id)}
                  className={`rounded px-2 py-0.5 text-xs font-medium text-white ${active ? '' : 'opacity-35'}`}
                  style={{ backgroundColor: label.color }}
                >
                  {label.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs opacity-70">Checklist</p>
          <div className="flex flex-col gap-1">
            {checklist.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() => {
                    const next = checklist.map((it, j) =>
                      j === i ? { ...it, done: !it.done } : it,
                    );
                    void update({ checklist: next });
                  }}
                />
                <span className={item.done ? 'line-through opacity-60' : ''}>{item.text}</span>
                <button
                  type="button"
                  className="ml-auto text-xs opacity-50 hover:opacity-100"
                  onClick={() => void update({ checklist: checklist.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <Input
              value={newChecklistText}
              placeholder="+ Add checklist item"
              onChange={(e) => setNewChecklistText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addChecklistItem();
              }}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------- label manager ---------------------------- */

const LABEL_PALETTE = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#64748b'];

function LabelManagerDialog({
  labels,
  boardId,
  cards,
  onClose,
}: {
  labels: Label[];
  boardId: string;
  cards: CardRec[];
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState('');

  const add = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('labels').create({
          board: boardId,
          name: trimmed,
          color: LABEL_PALETTE[labels.length % LABEL_PALETTE.length],
        }),
      );
      setName('');
    } catch {
      /* surfaced by shell */
    }
  };

  const update = async (label: Label, patch: Record<string, unknown>): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('labels').update(label.id, patch));
    } catch {
      /* surfaced by shell */
    }
  };

  const remove = async (label: Label): Promise<void> => {
    const used = cards.filter((c) => c.labels.includes(label.id)).length;
    if (used > 0 && !window.confirm(`"${label.name}" is on ${used} card(s). Delete it anyway?`)) {
      return;
    }
    try {
      await getPbClient().call((pb) => pb.collection('labels').delete(label.id));
      toast.success(`Label "${label.name}" deleted`);
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Board labels"
      description="Create, rename, recolor or delete the labels available on this board."
    >
      <div className="flex flex-col gap-2">
        {labels.map((label) => (
          <div key={label.id} className="flex items-center gap-2 text-sm">
            <span
              className="rounded px-1.5 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: label.color || '#64748b' }}
            >
              {label.name}
            </span>
            <Input
              className="h-8 w-32"
              defaultValue={label.name}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== '' && value !== label.name) void update(label, { name: value });
              }}
            />
            {LABEL_PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => void update(label, { color: swatch })}
                className={`h-4 w-4 rounded-full ${label.color === swatch ? 'ring-2 ring-offset-1' : ''}`}
                style={{ backgroundColor: swatch }}
              />
            ))}
            <span className="text-xs opacity-50">
              {cards.filter((c) => c.labels.includes(label.id)).length}
            </span>
            <button
              type="button"
              className="ml-auto text-xs opacity-50 hover:opacity-100"
              onClick={() => void remove(label)}
            >
              ✕
            </button>
          </div>
        ))}
        <Input
          value={name}
          placeholder="+ New label (Enter)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
      </div>
    </Dialog>
  );
}

/* --------------------------- workspace menu --------------------------- */

function WorkspaceMenu(): React.JSX.Element {
  const auth = useAuth();
  const [membersOpen, setMembersOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="ml-auto flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setMembersOpen(true)}>
        Members
      </Button>
      <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
        Invite
      </Button>
      <Button variant="outline" size="sm" onClick={() => setProfileOpen(true)}>
        {auth.email ?? 'Profile'}
      </Button>
      <Button variant="outline" size="sm" onClick={() => auth.logout()}>
        Sign out
      </Button>

      {membersOpen && <MembersDialog onClose={() => setMembersOpen(false)} />}
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
    </div>
  );
}

function MembersDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { records: members } = useCollection<Member>('users', { sort: 'created' });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Workspace members"
    >
      <div className="flex flex-col gap-1">
        {members.map((member) => (
          <div key={member.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-xs font-semibold uppercase dark:bg-white/20">
              {(member.name || member.email || '?').slice(0, 1)}
            </span>
            <div>
              <p className="font-medium">{member.name || member.email || 'Member'}</p>
              {member.name !== '' && member.email !== '' && (
                <p className="text-xs opacity-60">{member.email}</p>
              )}
            </div>
          </div>
        ))}
        {members.length === 0 && <p className="text-sm opacity-60">Just you so far.</p>}
      </div>
    </Dialog>
  );
}

function ProfileDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const auth = useAuth();
  const [name, setName] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const save = async (): Promise<void> => {
    if (auth.userId === null) return;
    const patch: Record<string, string> = {};
    if (name.trim() !== '') patch['name'] = name.trim();
    if (newPassword !== '') {
      if (oldPassword === '' || newPassword.length < 8) {
        toast.error('Password change needs the old password and 8+ new characters');
        return;
      }
      patch['oldPassword'] = oldPassword;
      patch['password'] = newPassword;
      patch['passwordConfirm'] = newPassword;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    try {
      await getPbClient().call((pb) => pb.collection('users').update(auth.userId!, patch));
      toast.success('Profile updated');
      // PB invalidates the auth token after a password change — sign back in.
      if (patch['password'] !== undefined) auth.logout();
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Your profile"
      description={auth.email ?? undefined}
      footer={<Button onClick={() => void save()}>Save</Button>}
    >
      <div className="flex flex-col gap-2">
        <Input value={name} placeholder="Display name" onChange={(e) => setName(e.target.value)} />
        <p className="mt-1 text-xs opacity-60">Change password (optional)</p>
        <Input
          type="password"
          value={oldPassword}
          placeholder="Current password"
          onChange={(e) => setOldPassword(e.target.value)}
        />
        <Input
          type="password"
          value={newPassword}
          placeholder="New password (8+ characters)"
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const url = window.location.origin;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        `Join our Kanban workspace: open ${url} and hit "Register" — boards are shared with everyone who signs up.`,
      );
      toast.success('Invite text copied');
    } catch {
      toast.error('Copy failed');
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Invite teammates"
      footer={<Button onClick={() => void copy()}>Copy invite text</Button>}
    >
      <p className="text-sm opacity-80">
        Anyone who can reach <span className="font-mono">{url}</span> can register and joins the
        shared workspace. Copy the invite text and send it over your usual channel.
      </p>
    </Dialog>
  );
}
