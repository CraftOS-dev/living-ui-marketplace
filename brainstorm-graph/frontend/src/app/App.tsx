/**
 * Brainstorm Graph — sessions of ideas laid out as a mind-map tree.
 * Nodes are cards on a canvas (root left, children fan out rightward);
 * edges are SVG curves underneath. Click a node to edit, ＋ to branch.
 */
import { useMemo, useRef, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import { Button, Dialog, Input, getPbClient, toast, useCollection } from '../kit/index.ts';

interface Session extends RecordModel {
  title: string;
  topic: string;
}

interface Node extends RecordModel {
  session: string;
  parent: string;
  content: string;
  kind: '' | 'idea' | 'question' | 'insight' | 'task';
  x: number;
  y: number;
}

const KIND_COLOR: Record<string, string> = {
  idea: '#3b82f6',
  question: '#8b5cf6',
  insight: '#10b981',
  task: '#f59e0b',
};
const KINDS = ['idea', 'question', 'insight', 'task'] as const;

const NODE_W = 210;
const NODE_H = 74;
const COL_GAP = 70;
const ROW_GAP = 18;

interface Placed {
  node: Node;
  x: number;
  y: number;
}

/** Tidy-ish tree layout: leaves stack top-down, parents center on children. */
function layoutTree(nodes: Node[]): { placed: Placed[]; width: number; height: number } {
  const children = new Map<string, Node[]>();
  const roots: Node[] = [];
  for (const node of nodes) {
    if (node.parent !== '' && nodes.some((n) => n.id === node.parent)) {
      const list = children.get(node.parent) ?? [];
      list.push(node);
      children.set(node.parent, list);
    } else {
      roots.push(node);
    }
  }
  const placed: Placed[] = [];
  let nextSlot = 0;
  let maxDepth = 0;

  const place = (node: Node, depth: number): number => {
    if (depth > maxDepth) maxDepth = depth;
    const kids = children.get(node.id) ?? [];
    let y: number;
    if (kids.length === 0) {
      y = nextSlot * (NODE_H + ROW_GAP);
      nextSlot += 1;
    } else {
      const ys = kids.map((kid) => place(kid, depth + 1));
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    placed.push({ node, x: depth * (NODE_W + COL_GAP), y });
    return y;
  };
  for (const root of roots) place(root, 0);

  return {
    placed,
    width: (maxDepth + 1) * (NODE_W + COL_GAP),
    height: Math.max(1, nextSlot) * (NODE_H + ROW_GAP),
  };
}

export function App(): React.JSX.Element {
  const { records: sessions } = useCollection<Session>('sessions', { sort: '-created' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const session = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;

  return (
    <div className="flex h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-3 py-3">
          <h1 className="text-lg font-semibold">Brainstorm</h1>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={`cursor-pointer border-b px-3 py-2 text-sm ${item.id === session?.id ? 'bg-black/5 dark:bg-white/10' : ''}`}
            >
              <p className="font-medium">{item.title}</p>
              <p className="truncate text-xs opacity-60">{item.topic}</p>
            </div>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        {session === null ? (
          <p className="p-6 text-sm opacity-60">Create a session to start brainstorming.</p>
        ) : (
          <GraphCanvas key={session.id} session={session} onDeleted={() => setSelectedId(null)} />
        )}
      </main>

      {newOpen && (
        <NewSessionDialog
          onCreated={(id) => {
            setSelectedId(id);
            setNewOpen(false);
          }}
          onClose={() => setNewOpen(false)}
        />
      )}
    </div>
  );
}

function GraphCanvas({
  session,
  onDeleted,
}: {
  session: Session;
  onDeleted: () => void;
}): React.JSX.Element {
  const { records: nodes } = useCollection<Node>('nodes', {
    filter: `session = "${session.id}"`,
    sort: 'created',
  });
  const [editNodeId, setEditNodeId] = useState<string | null>(null);
  const [branchFrom, setBranchFrom] = useState<Node | null>(null);
  const [view, setView] = useState<'graph' | 'outline'>('graph');
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [exploring, setExploring] = useState(false);
  const [editSessionOpen, setEditSessionOpen] = useState(false);
  // Live drag positions (node id → x/y) so dragging is smooth pre-persist.
  const [dragPos, setDragPos] = useState<Map<string, { x: number; y: number }>>(new Map());
  const dragRef = useRef<{
    id: string;
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const { placed, width, height } = useMemo(() => {
    const layout = layoutTree(nodes);
    // Manual positions (x/y set by dragging) override the auto layout.
    let maxX = layout.width;
    let maxY = layout.height;
    const merged = layout.placed.map((p) => {
      const live = dragPos.get(p.node.id);
      const manual =
        live ?? (p.node.x !== 0 || p.node.y !== 0 ? { x: p.node.x, y: p.node.y } : null);
      if (manual === null) return p;
      maxX = Math.max(maxX, manual.x + NODE_W);
      maxY = Math.max(maxY, manual.y + NODE_H);
      return { ...p, x: manual.x, y: manual.y };
    });
    return { placed: merged, width: maxX, height: maxY };
  }, [nodes, dragPos]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);
  const editNode = editNodeId === null ? null : (nodes.find((n) => n.id === editNodeId) ?? null);

  const deleteSession = async (): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('sessions').delete(session.id));
      toast.success('Session deleted');
      onDeleted();
    } catch {
      /* surfaced by shell */
    }
  };

  const summarize = async (): Promise<void> => {
    setSummarizing(true);
    try {
      const res = await fetch('/api/ops/sessions/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id }),
      });
      const data = (await res.json()) as { summary?: string; error?: string };
      if (!res.ok || data.summary === undefined) {
        toast.error(data.error ?? 'Summarize failed');
        return;
      }
      setSummary(data.summary);
    } catch {
      toast.error('Summarize failed');
    } finally {
      setSummarizing(false);
    }
  };

  const suggest = async (node: Node): Promise<void> => {
    setSuggestingId(node.id);
    try {
      const res = await fetch('/api/ops/nodes/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: node.id }),
      });
      const data = (await res.json()) as { created?: string[]; error?: string };
      if (!res.ok || data.created === undefined) {
        toast.error(data.error ?? 'AI suggest failed');
        return;
      }
      toast.success(`${data.created.length} idea(s) added`);
    } catch {
      toast.error('AI suggest failed');
    } finally {
      setSuggestingId(null);
    }
  };

  const explore = async (): Promise<void> => {
    setExploring(true);
    try {
      const res = await fetch('/api/ops/sessions/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id }),
      });
      const data = (await res.json()) as { created?: string[]; error?: string };
      if (!res.ok || data.created === undefined) {
        toast.error(data.error ?? 'Explore failed');
        return;
      }
      toast.success(`${data.created.length} new angle(s) added`);
    } catch {
      toast.error('Explore failed');
    } finally {
      setExploring(false);
    }
  };

  const answerNode = async (node: Node): Promise<void> => {
    setSuggestingId(node.id);
    try {
      const res = await fetch('/api/ops/nodes/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: node.id }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      if (!res.ok || data.answer === undefined) {
        toast.error(data.error ?? 'AI answer failed');
        return;
      }
      toast.success('Answer added as an insight');
    } catch {
      toast.error('AI answer failed');
    } finally {
      setSuggestingId(null);
    }
  };

  const persistPosition = async (nodeId: string, x: number, y: number): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('nodes').update(nodeId, { x, y }));
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <div className="p-4">
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">{session.title}</h2>
        <span className="text-sm opacity-60">{nodes.length} nodes</span>
        <Button
          size="sm"
          variant={view === 'graph' ? 'default' : 'outline'}
          onClick={() => setView('graph')}
        >
          Graph
        </Button>
        <Button
          size="sm"
          variant={view === 'outline' ? 'default' : 'outline'}
          onClick={() => setView('outline')}
        >
          Outline
        </Button>
        <Button size="sm" variant="outline" onClick={() => void summarize()} disabled={summarizing}>
          {summarizing ? 'Summarizing…' : '✨ Summarize'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void explore()} disabled={exploring}>
          {exploring ? 'Exploring…' : '✨ Explore'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditSessionOpen(true)}>
          Edit
        </Button>
        <Button variant="outline" size="sm" onClick={() => void deleteSession()}>
          Delete session
        </Button>
      </header>

      {editSessionOpen && (
        <EditSessionDialog session={session} onClose={() => setEditSessionOpen(false)} />
      )}

      {view === 'outline' ? (
        <OutlineView nodes={nodes} onOpen={(id) => setEditNodeId(id)} />
      ) : (
      <div className="relative" style={{ width: width + 40, height: height + 40 }}>
        <svg
          className="pointer-events-none absolute inset-0"
          width={width + 40}
          height={height + 40}
        >
          {placed.map(({ node }) => {
            const parent = node.parent !== '' ? byId.get(node.parent) : undefined;
            const self = byId.get(node.id);
            if (parent === undefined || self === undefined) return null;
            const x1 = parent.x + NODE_W;
            const y1 = parent.y + NODE_H / 2;
            const x2 = self.x;
            const y2 = self.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={node.id}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.25}
                strokeWidth={1.5}
              />
            );
          })}
        </svg>

        {placed.map(({ node, x, y }) => (
          <div
            key={node.id}
            className="group absolute cursor-grab touch-none rounded-lg border bg-white p-2 text-sm shadow-sm transition-shadow hover:shadow active:cursor-grabbing dark:bg-neutral-900"
            style={{
              left: x,
              top: y,
              width: NODE_W,
              minHeight: NODE_H,
              borderTopColor: KIND_COLOR[node.kind] ?? '#3b82f6',
              borderTopWidth: 3,
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = {
                id: node.id,
                pointerX: e.clientX,
                pointerY: e.clientY,
                originX: x,
                originY: y,
                moved: false,
              };
            }}
            onPointerMove={(e) => {
              const drag = dragRef.current;
              if (drag === null || drag.id !== node.id) return;
              const dx = e.clientX - drag.pointerX;
              const dy = e.clientY - drag.pointerY;
              if (!drag.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
              drag.moved = true;
              setDragPos((prev) =>
                new Map(prev).set(node.id, {
                  x: Math.max(0, drag.originX + dx),
                  y: Math.max(0, drag.originY + dy),
                }),
              );
            }}
            onPointerUp={() => {
              const drag = dragRef.current;
              dragRef.current = null;
              if (drag === null || drag.id !== node.id) return;
              if (drag.moved) {
                const pos = dragPos.get(node.id);
                if (pos !== undefined) void persistPosition(node.id, pos.x, pos.y);
              } else {
                setEditNodeId(node.id);
              }
            }}
          >
            <p className="line-clamp-2">{node.content}</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide opacity-50">
                {node.kind || 'idea'}
              </span>
              <span className="flex gap-1">
                {node.kind === 'question' && (
                  <button
                    type="button"
                    title="AI: answer this question"
                    className="rounded px-1 text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                    disabled={suggestingId === node.id}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      void answerNode(node);
                    }}
                  >
                    💡
                  </button>
                )}
                <button
                  type="button"
                  title="AI: suggest 3 child ideas"
                  className="rounded px-1 text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                  disabled={suggestingId === node.id}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    void suggest(node);
                  }}
                >
                  {suggestingId === node.id ? '…' : '✨'}
                </button>
                <button
                  type="button"
                  title="Add child node"
                  className="rounded px-1 text-xs opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setBranchFrom(node);
                  }}
                >
                  ＋
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
      )}

      {summary !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSummary(null);
          }}
          title="AI summary"
        >
          <p className="whitespace-pre-wrap text-sm">{summary}</p>
        </Dialog>
      )}

      {editNode !== null && <EditNodeDialog node={editNode} onClose={() => setEditNodeId(null)} />}
      {branchFrom !== null && (
        <NodeDialog
          title={`Branch from: ${branchFrom.content.slice(0, 40)}`}
          onSave={async (content, kind) => {
            try {
              await getPbClient().call((pb) =>
                pb.collection('nodes').create({
                  session: session.id,
                  parent: branchFrom.id,
                  content,
                  kind,
                }),
              );
              setBranchFrom(null);
            } catch {
              /* surfaced by shell */
            }
          }}
          onClose={() => setBranchFrom(null)}
        />
      )}
    </div>
  );
}

function OutlineView({
  nodes,
  onOpen,
}: {
  nodes: Node[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const rows: { node: Node; depth: number }[] = [];
  const children = new Map<string, Node[]>();
  const roots: Node[] = [];
  for (const node of nodes) {
    if (node.parent !== '' && nodes.some((n) => n.id === node.parent)) {
      const list = children.get(node.parent) ?? [];
      list.push(node);
      children.set(node.parent, list);
    } else {
      roots.push(node);
    }
  }
  const walk = (node: Node, depth: number): void => {
    rows.push({ node, depth });
    for (const child of children.get(node.id) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);

  return (
    <div className="flex max-w-2xl flex-col gap-1">
      {rows.map(({ node, depth }) => (
        <button
          key={node.id}
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
          style={{ marginLeft: depth * 20 }}
          onClick={() => onOpen(node.id)}
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: KIND_COLOR[node.kind] ?? '#3b82f6' }}
          />
          <span>{node.content}</span>
          <span className="text-[10px] uppercase opacity-40">{node.kind || 'idea'}</span>
        </button>
      ))}
    </div>
  );
}

function NodeDialog({
  title,
  initialContent = '',
  initialKind = 'idea',
  extraFooter,
  onSave,
  onClose,
}: {
  title: string;
  initialContent?: string;
  initialKind?: string;
  extraFooter?: React.ReactNode;
  onSave: (content: string, kind: string) => void | Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [content, setContent] = useState(initialContent);
  const [kind, setKind] = useState(initialKind === '' ? 'idea' : initialKind);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      footer={
        <div className="flex w-full items-center justify-between">
          <div>{extraFooter}</div>
          <Button onClick={() => void onSave(content.trim(), kind)} disabled={content.trim() === ''}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <textarea
          className="min-h-20 rounded-md border bg-transparent p-2 text-sm"
          placeholder="What's the idea?"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoFocus
        />
        <div className="flex items-center gap-2 text-sm">
          <label className="opacity-70">Kind</label>
          {KINDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              className={`rounded-full border px-2 py-0.5 text-xs ${kind === option ? 'text-white' : 'opacity-60'}`}
              style={kind === option ? { backgroundColor: KIND_COLOR[option], borderColor: 'transparent' } : {}}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function EditNodeDialog({ node, onClose }: { node: Node; onClose: () => void }): React.JSX.Element {
  const remove = async (): Promise<void> => {
    try {
      await getPbClient().call((pb) => pb.collection('nodes').delete(node.id));
      toast.success('Node deleted (with its branch)');
      onClose();
    } catch {
      /* surfaced by shell */
    }
  };

  return (
    <NodeDialog
      title="Edit node"
      initialContent={node.content}
      initialKind={node.kind}
      extraFooter={
        node.parent !== '' ? (
          <Button variant="destructive" size="sm" onClick={() => void remove()}>
            Delete branch
          </Button>
        ) : undefined
      }
      onSave={async (content, kind) => {
        try {
          await getPbClient().call((pb) =>
            pb.collection('nodes').update(node.id, { content, kind }),
          );
          onClose();
        } catch {
          /* surfaced by shell */
        }
      }}
      onClose={onClose}
    />
  );
}

function NewSessionDialog({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');

  const create = async (): Promise<void> => {
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') return;
    try {
      const session = await getPbClient().call((pb) =>
        pb.collection('sessions').create<Session>({ title: trimmedTitle, topic: topic.trim() }),
      );
      // Every session starts with a root node holding the central question.
      await getPbClient().call((pb) =>
        pb.collection('nodes').create({
          session: session.id,
          content: topic.trim() !== '' ? topic.trim() : trimmedTitle,
          kind: 'question',
        }),
      );
      toast.success('Session created');
      onCreated(session.id);
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
      title="New brainstorm session"
      footer={
        <Button onClick={() => void create()} disabled={title.trim() === ''}>
          Create
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Input value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
        <Input
          value={topic}
          placeholder="Central question / topic (becomes the root node)"
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
      </div>
    </Dialog>
  );
}

function EditSessionDialog({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(session.title);
  const [topic, setTopic] = useState(session.topic);

  const save = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed === '') return;
    try {
      await getPbClient().call((pb) =>
        pb.collection('sessions').update(session.id, { title: trimmed, topic: topic.trim() }),
      );
      toast.success('Session updated');
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
      title="Edit session"
      footer={
        <Button onClick={() => void save()} disabled={title.trim() === ''}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Input value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
        <Input
          value={topic}
          placeholder="Central question / topic"
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
