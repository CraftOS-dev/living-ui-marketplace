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
  useCollection,
} from '../kit/index.ts';

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
  priority: '' | 'none' | 'low' | 'medium' | 'high';
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
};

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

  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  // Resolve from live records so realtime updates reach the open dialog.
  const openCard = openCardId === null ? null : (cards.find((c) => c.id === openCardId) ?? null);

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

  const moveCard = async (cardId: string, toList: string): Promise<void> => {
    const card = cards.find((c) => c.id === cardId);
    if (card === undefined || card.list === toList) return;
    const position = Math.max(
      0,
      ...cards.filter((c) => c.list === toList).map((c) => c.position + 1),
    );
    try {
      await getPbClient().call((pb) =>
        pb.collection('cards').update(cardId, { list: toList, position }),
      );
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <main className="flex flex-1 items-start gap-4 overflow-x-auto p-4">
      {lists.map((list) => (
        <ListColumn
          key={list.id}
          list={list}
          cards={cards.filter((c) => c.list === list.id)}
          labelById={labelById}
          onOpenCard={(card) => setOpenCardId(card.id)}
          onDropCard={(cardId) => void moveCard(cardId, list.id)}
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
    </main>
  );
}

function ListColumn({
  list,
  cards,
  labelById,
  onOpenCard,
  onDropCard,
}: {
  list: List;
  cards: CardRec[];
  labelById: Map<string, Label>;
  onOpenCard: (card: CardRec) => void;
  onDropCard: (cardId: string) => void;
}): React.JSX.Element {
  const [newCardTitle, setNewCardTitle] = useState('');
  const [dragOver, setDragOver] = useState(false);

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
        if (cardId !== '') onDropCard(cardId);
      }}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
          <CardTitle className="text-sm">
            {list.title} <span className="ml-1 font-normal opacity-60">{cards.length}</span>
          </CardTitle>
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
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {cards.map((card) => (
            <CardTile
              key={card.id}
              card={card}
              labelById={labelById}
              onOpen={() => onOpenCard(card)}
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
}: {
  card: CardRec;
  labelById: Map<string, Label>;
  onOpen: () => void;
}): React.JSX.Element {
  const progress = checklistProgress(card.checklist);
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', card.id)}
      onClick={onOpen}
      className="cursor-pointer rounded-md border p-2 text-sm shadow-sm hover:shadow"
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
            {['none', 'low', 'medium', 'high'].map((p) => (
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
