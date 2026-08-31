/**
 * Roadmap: the company milestone canvas (the Command Center's Strategy roadmap,
 * generalised — no product scoping, no GitHub tie-in). Milestones are a DAG:
 * drag a card's orange port onto another to declare a prerequisite; drag the
 * dashed dividers to carve the canvas into time columns.
 *
 * Editor affordances layered on top: shift-click and marquee multi-select,
 * group drag, copy/paste (Ctrl/⌘ C·V), and a linear undo stack (Ctrl/⌘ Z)
 * whose entries are inverse operations recorded at mutation time. Records are
 * roadmap_items + roadmap_dividers; prerequisites are a client-side-cycle-safe
 * id list.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import {
  Button,
  Dialog,
  Input,
  Select,
  Textarea,
  getPbClient,
  toast,
  useCollection,
  useConfirm,
} from '../../kit/index.ts';
import type { RoadmapDivider, RoadmapItem, RoadmapStatus, TeamMember } from '../lib/types.ts';
import { currentQuarter } from '../lib/useCompany.ts';
import { NodeGraph, type GraphDivider } from './NodeGraph.tsx';
import { EmptyHint } from './ui.tsx';

const STATUS_COLOR: Record<RoadmapStatus, string> = {
  planned: '#9ca3af',
  in_progress: '#0ea5e9',
  done: '#10b981',
  cut: '#ef4444',
};
const STATUS_LABEL: Record<RoadmapStatus, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  cut: 'Cut',
};
const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as RoadmapStatus[]).map((v) => ({
  value: v,
  label: STATUS_LABEL[v],
}));

const NODE_W = 220;
const NODE_H = 92;

/** The fields that define a milestone, independent of its PB row identity. */
interface Snapshot {
  id: string;
  title: string;
  description: string;
  status: RoadmapStatus;
  quarter: string;
  target_date: string;
  owner: string;
  pos_x: number;
  pos_y: number;
  prerequisites: string[];
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function genId(): string {
  let s = '';
  for (let i = 0; i < 15; i++) s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return s;
}

function snap(i: RoadmapItem): Snapshot {
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    status: i.status,
    quarter: i.quarter,
    target_date: i.target_date,
    owner: i.owner,
    pos_x: i.pos_x,
    pos_y: i.pos_y,
    prerequisites: (i.prerequisites ?? []).slice(),
  };
}
/** The writable body of a snapshot (everything but its identity metadata). */
function body(s: Snapshot): Record<string, unknown> {
  return {
    title: s.title,
    description: s.description,
    status: s.status,
    quarter: s.quarter,
    target_date: s.target_date,
    owner: s.owner,
    pos_x: Math.round(s.pos_x),
    pos_y: Math.round(s.pos_y),
    prerequisites: s.prerequisites,
  };
}

/** ISO 8601 week number — the "WW n" teams plan against. */
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function createsCycle(items: RoadmapItem[], parentId: string, childId: string): boolean {
  if (parentId === childId) return true;
  const map = new Map(items.map((r) => [r.id, r]));
  const visited = new Set<string>();
  const stack = [parentId];
  while (stack.length) {
    const id = stack.pop();
    if (id === undefined) continue;
    if (id === childId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const r = map.get(id);
    if (!r) continue;
    (r.prerequisites ?? []).forEach((pid) => stack.push(pid));
  }
  return false;
}

const pb = (): ReturnType<typeof getPbClient> => getPbClient();
const rmUpdate = (id: string, data: Record<string, unknown>): Promise<unknown> =>
  pb().call((c) => c.collection('roadmap_items').update(id, data));
const rmCreate = (data: Record<string, unknown>): Promise<unknown> =>
  pb().call((c) => c.collection('roadmap_items').create(data));
const rmDelete = (id: string): Promise<unknown> =>
  pb().call((c) => c.collection('roadmap_items').delete(id));

export function RoadmapCanvas(): React.JSX.Element {
  const { records: items } = useCollection<RoadmapItem>('roadmap_items');
  const { records: dividerRows } = useCollection<RoadmapDivider>('roadmap_dividers', { sort: 'x' });
  const { records: members } = useCollection<TeamMember>('team_members');
  const [confirmEl, confirm] = useConfirm();

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Undo: a stack of inverse operations recorded at mutation time.
  const undoStack = useRef<Array<() => Promise<void>>>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const pushUndo = (fn: () => Promise<void>): void => {
    undoStack.current.push(fn);
    if (undoStack.current.length > 60) undoStack.current.shift();
    setUndoDepth(undoStack.current.length);
  };
  const undo = (): void => {
    const fn = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (!fn) return;
    void fn()
      .then(() => toast.success('Undone'))
      .catch(() => undefined);
  };

  // Clipboard is in-memory (per session); pasteCount grows the offset.
  const clipboard = useRef<Snapshot[]>([]);
  const pasteCount = useRef(0);

  const memberName = (id: string): string => members.find((m) => m.id === id)?.name ?? '';

  const graphNodes = useMemo(
    () =>
      items.map((r) => ({
        id: r.id,
        x: r.pos_x || 0,
        y: r.pos_y || 0,
        parentIds: (r.prerequisites ?? []).filter((pid) => items.some((v) => v.id === pid)),
        raw: r,
      })),
    [items],
  );

  const dividers: GraphDivider[] = useMemo(
    () => dividerRows.map((d) => ({ id: d.id, label: d.label, x: d.x || 0 })),
    [dividerRows],
  );

  // ── selection ───────────────────────────────────────────────────────────
  const selectOne = (id: string, additive: boolean): void => {
    setSelectedIds((prev) => {
      if (!additive) return new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectBox = (ids: string[], additive: boolean): void => {
    setSelectedIds((prev) => (additive ? new Set([...prev, ...ids]) : new Set(ids)));
  };
  const selectClear = (): void => setSelectedIds(new Set());

  // ── milestone mutations (each records its inverse for undo) ─────────────
  const onMoveMany = (updates: { id: string; x: number; y: number }[]): void => {
    const prev = updates.map((u) => {
      const it = items.find((i) => i.id === u.id);
      return { id: u.id, x: it?.pos_x ?? 0, y: it?.pos_y ?? 0 };
    });
    pushUndo(async () => {
      await Promise.all(prev.map((p) => rmUpdate(p.id, { pos_x: Math.round(p.x), pos_y: Math.round(p.y) }).catch(() => undefined)));
    });
    void Promise.all(updates.map((u) => rmUpdate(u.id, { pos_x: Math.round(u.x), pos_y: Math.round(u.y) }))).catch(() => undefined);
  };
  const onConnect = (parentId: string, childId: string): void => {
    if (createsCycle(items, parentId, childId)) {
      toast.error('That would create a cycle');
      return;
    }
    const child = items.find((r) => r.id === childId);
    if (!child) return;
    const prev = (child.prerequisites ?? []).slice();
    const next = Array.from(new Set([...prev, parentId]));
    pushUndo(async () => {
      await rmUpdate(childId, { prerequisites: prev }).catch(() => undefined);
    });
    void rmUpdate(childId, { prerequisites: next }).catch(() => undefined);
  };
  const onDisconnect = (parentId: string, childId: string): void => {
    const child = items.find((r) => r.id === childId);
    if (!child) return;
    const prev = (child.prerequisites ?? []).slice();
    const next = prev.filter((p) => p !== parentId);
    pushUndo(async () => {
      await rmUpdate(childId, { prerequisites: prev }).catch(() => undefined);
    });
    void rmUpdate(childId, { prerequisites: next }).catch(() => undefined);
  };
  const onAddAt = (x: number, y: number): void => {
    const id = genId();
    pushUndo(async () => {
      await rmDelete(id).catch(() => undefined);
    });
    void rmCreate({
      id,
      title: 'New milestone',
      status: 'planned',
      quarter: currentQuarter(),
      pos_x: Math.round(x),
      pos_y: Math.round(y),
      prerequisites: [],
    })
      .then(() => {
        setSelectedIds(new Set([id]));
        setRenamingId(id);
      })
      .catch(() => undefined);
  };
  const changeStatus = (id: string, status: RoadmapStatus): void => {
    const prev = items.find((r) => r.id === id)?.status ?? 'planned';
    pushUndo(async () => {
      await rmUpdate(id, { status: prev }).catch(() => undefined);
    });
    void rmUpdate(id, { status }).catch(() => undefined);
  };
  const commitRename = (id: string, title: string): void => {
    setRenamingId(null);
    const trimmed = title.trim();
    const row = items.find((r) => r.id === id);
    if (!row || trimmed === '' || trimmed === row.title) return;
    const prev = row.title;
    pushUndo(async () => {
      await rmUpdate(id, { title: prev }).catch(() => undefined);
    });
    void rmUpdate(id, { title: trimmed }).catch(() => undefined);
  };
  const saveDetails = async (item: RoadmapItem, fields: Record<string, unknown>): Promise<void> => {
    const prev = body(snap(item));
    pushUndo(async () => {
      await rmUpdate(item.id, prev).catch(() => undefined);
    });
    await pb().call((c) => c.collection('roadmap_items').update(item.id, fields));
  };

  const deleteItems = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    const recs = items.filter((i) => ids.includes(i.id));
    if (recs.length === 0) return;
    const label =
      recs.length === 1 ? `Delete milestone "${recs[0]?.title}"?` : `Delete ${recs.length} milestones?`;
    if (!(await confirm(label))) return;
    const snaps = recs.map(snap);
    setSelectedIds(new Set());
    await Promise.all(ids.map((id) => rmDelete(id).catch(() => undefined)));
    pushUndo(async () => {
      // Recreate with the same ids so links from surviving cards light back up.
      await Promise.all(snaps.map((s) => rmCreate({ id: s.id, ...body(s) }).catch(() => undefined)));
    });
  };

  // ── copy / paste ────────────────────────────────────────────────────────
  const copy = (): void => {
    const sel = items.filter((i) => selectedIds.has(i.id));
    if (sel.length === 0) return;
    clipboard.current = sel.map(snap);
    pasteCount.current = 0;
    toast.success(`Copied ${sel.length} milestone${sel.length === 1 ? '' : 's'}`);
  };
  const paste = (): void => {
    const src = clipboard.current;
    if (src.length === 0) return;
    pasteCount.current += 1;
    const off = 24 + pasteCount.current * 12;
    const copiedIds = new Set(src.map((s) => s.id));
    const idMap = new Map(src.map((s) => [s.id, genId()] as const));
    const newIds = src.map((s) => idMap.get(s.id) as string);
    pushUndo(async () => {
      await Promise.all(newIds.map((id) => rmDelete(id).catch(() => undefined)));
    });
    void Promise.all(
      src.map((s) => {
        const prereqs = s.prerequisites.filter((p) => copiedIds.has(p)).map((p) => idMap.get(p) as string);
        return rmCreate({
          id: idMap.get(s.id),
          title: s.title,
          description: s.description,
          status: s.status,
          quarter: s.quarter,
          target_date: s.target_date,
          owner: s.owner,
          pos_x: Math.round(s.pos_x) + off,
          pos_y: Math.round(s.pos_y) + off,
          prerequisites: prereqs,
        });
      }),
    )
      .then(() => {
        setSelectedIds(new Set(newIds));
        toast.success(`Pasted ${src.length} milestone${src.length === 1 ? '' : 's'}`);
      })
      .catch(() => undefined);
  };

  // ── auto-layout: longest-path depth → columns ──────────────────────────
  const onAutoLayout = (): void => {
    if (items.length === 0) return;
    const idSet = new Set(items.map((n) => n.id));
    const depth: Record<string, number> = {};
    const visit = (id: string, stack: Set<string>): number => {
      if (depth[id] !== undefined) return depth[id];
      if (stack.has(id)) return 0;
      stack.add(id);
      const node = items.find((n) => n.id === id);
      const parents = (node?.prerequisites ?? []).filter((p) => idSet.has(p));
      const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => visit(p, stack))) + 1;
      stack.delete(id);
      depth[id] = d;
      return d;
    };
    items.forEach((n) => visit(n.id, new Set()));
    const cols: Record<number, RoadmapItem[]> = {};
    items.forEach((n) => {
      const d = depth[n.id] ?? 0;
      (cols[d] ||= []).push(n);
    });
    const COL_W = 280;
    const ROW_H = 120;
    const prevPos = items.map((i) => ({ id: i.id, x: i.pos_x, y: i.pos_y }));
    const updates: { id: string; x: number; y: number }[] = [];
    Object.keys(cols)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((d) => {
        (cols[d] ?? []).forEach((n, i) => {
          updates.push({ id: n.id, x: d * COL_W + 40, y: i * ROW_H + 40 });
        });
      });
    pushUndo(async () => {
      await Promise.all(prevPos.map((p) => rmUpdate(p.id, { pos_x: Math.round(p.x), pos_y: Math.round(p.y) }).catch(() => undefined)));
    });
    void Promise.all(updates.map((u) => rmUpdate(u.id, { pos_x: u.x, pos_y: u.y })))
      .then(() => toast.success('Auto-laid-out'))
      .catch(() => undefined);
  };

  // ── divider mutations ──────────────────────────────────────────────────
  const addDivider = (): void => {
    const rightmost = Math.max(
      120,
      ...dividers.map((d) => d.x + 300),
      ...items.map((r) => (r.pos_x || 0) + 300),
    );
    const wwNumbers = dividers
      .map((d) => /ww\s*(\d+)/i.exec(d.label)?.[1])
      .filter((s): s is string => Boolean(s))
      .map(Number);
    const nextWw = wwNumbers.length > 0 ? Math.max(...wwNumbers) + 1 : isoWeek(new Date());
    void pb()
      .call((c) => c.collection('roadmap_dividers').create({ label: `WW ${nextWw}`, x: Math.round(rightmost) }))
      .catch(() => undefined);
  };
  const onDividersChange = (next: GraphDivider[]): void => {
    const nextIds = new Set(next.map((d) => d.id));
    for (const cur of dividerRows) {
      if (!nextIds.has(cur.id)) {
        void pb().call((c) => c.collection('roadmap_dividers').delete(cur.id)).catch(() => undefined);
        continue;
      }
      const n = next.find((d) => d.id === cur.id);
      if (n && (Math.round(n.x) !== Math.round(cur.x) || n.label !== cur.label)) {
        void pb()
          .call((c) => c.collection('roadmap_dividers').update(cur.id, { x: Math.round(n.x), label: n.label }))
          .catch(() => undefined);
      }
    }
  };

  // ── keyboard: copy / paste / undo / select-all (host-level) ─────────────
  const actionsRef = useRef({ copy, paste, undo, selectAll: (): void => undefined });
  actionsRef.current = { copy, paste, undo, selectAll: () => setSelectedIds(new Set(items.map((i) => i.id))) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'c') {
        actionsRef.current.copy();
      } else if (k === 'v') {
        e.preventDefault();
        actionsRef.current.paste();
      } else if (k === 'z') {
        e.preventDefault();
        actionsRef.current.undo();
      } else if (k === 'a') {
        e.preventDefault();
        actionsRef.current.selectAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const editing = editingId !== null ? (items.find((r) => r.id === editingId) ?? null) : null;

  if (items.length === 0) {
    return (
      <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
        <EmptyHint
          icon={MapIcon}
          title="No roadmap yet"
          message="Lay out the milestones ahead as cards, link what must ship before what, and carve the canvas into time columns. Start with one milestone."
          action={<Button onClick={() => onAddAt(80, 80)}>Add the first milestone</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <NodeGraph
        nodes={graphNodes}
        selectedIds={selectedIds}
        height={620}
        nodeWidth={NODE_W}
        nodeHeight={NODE_H}
        entityLabel="milestone"
        dividers={dividers}
        onDividersChange={onDividersChange}
        undoDisabled={undoDepth === 0}
        onUndo={undo}
        onAddDivider={addDivider}
        dividerLabel="time column"
        renderNode={({ node, width, height, selected, hover }) => (
          <MilestoneCard
            r={(node as { raw: RoadmapItem }).raw}
            width={width}
            height={height}
            selected={selected}
            hover={hover}
            ownerName={memberName((node as { raw: RoadmapItem }).raw.owner)}
            renaming={renamingId === node.id}
            onStartRename={() => setRenamingId(node.id)}
            onCommitRename={(title) => commitRename(node.id, title)}
            onCancelRename={() => setRenamingId(null)}
            onEdit={() => setEditingId(node.id)}
            onChangeStatus={(s) => changeStatus(node.id, s)}
          />
        )}
        edgeColor={(_, child) => STATUS_COLOR[(child as { raw: RoadmapItem }).raw.status] ?? STATUS_COLOR.planned}
        onMoveMany={onMoveMany}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onSelect={selectOne}
        onSelectBox={selectBox}
        onSelectClear={selectClear}
        onAddAt={onAddAt}
        onAutoLayout={onAutoLayout}
        onDeleteSelected={() => void deleteItems(Array.from(selectedIds))}
      />

      {confirmEl}

      {editing !== null && (
        <MilestoneDetails
          key={editing.id}
          item={editing}
          allItems={items}
          members={members}
          onClose={() => setEditingId(null)}
          onSave={saveDetails}
          onDelete={(id) => void deleteItems([id])}
          onDisconnect={onDisconnect}
          onOpenItem={(id) => setEditingId(id)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Milestone card (rendered inside the SVG foreignObject).                     */
/* -------------------------------------------------------------------------- */

function MilestoneCard({
  r,
  width,
  height,
  selected,
  hover,
  ownerName,
  renaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onEdit,
  onChangeStatus,
}: {
  r: RoadmapItem;
  width: number;
  height: number;
  selected: boolean;
  hover: boolean;
  ownerName: string;
  renaming: boolean;
  onStartRename: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onEdit: () => void;
  onChangeStatus: (status: RoadmapStatus) => void;
}): React.JSX.Element {
  const tint = STATUS_COLOR[r.status] ?? STATUS_COLOR.planned;
  return (
    <div
      style={{
        width,
        height,
        position: 'relative',
        display: 'flex',
        overflow: 'hidden',
        userSelect: 'none',
        background: 'var(--lui-surface)',
        border: `1.5px solid ${selected ? 'var(--lui-accent)' : 'var(--lui-border)'}`,
        boxShadow: selected ? '0 0 0 1px var(--lui-accent)' : 'none',
      }}
    >
      <div style={{ width: 4, background: tint }} />
      {(hover || selected) && !renaming && (
        <button
          title="Edit details"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--lui-bg)',
            border: '1px solid var(--lui-border)',
            color: 'var(--lui-muted)',
            cursor: 'pointer',
            padding: 0,
            fontSize: 12,
          }}
        >
          ✎
        </button>
      )}
      <div style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        {renaming ? (
          <input
            autoFocus
            defaultValue={r.title}
            onFocus={(e) => e.currentTarget.select()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename(e.currentTarget.value);
              if (e.key === 'Escape') onCancelRename();
            }}
            onBlur={(e) => onCommitRename(e.currentTarget.value)}
            style={{
              width: '100%',
              fontWeight: 600,
              fontSize: 13,
              color: 'var(--lui-text)',
              background: 'var(--lui-bg)',
              border: '1px solid var(--lui-accent)',
              padding: '2px 6px',
              outline: 'none',
            }}
          />
        ) : (
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartRename();
            }}
            title="Double-click to rename"
            style={{
              fontWeight: 600,
              fontSize: 13,
              color: 'var(--lui-text)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              lineHeight: 1.2,
              paddingRight: hover || selected ? 22 : 0,
            }}
          >
            {r.title || 'Untitled'}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto', fontSize: 11, color: 'var(--lui-muted)' }}>
          <select
            value={r.status}
            title="Change status"
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChangeStatus(e.target.value as RoadmapStatus)}
            style={{
              appearance: 'none',
              WebkitAppearance: 'none',
              background: tint,
              color: 'white',
              padding: '1px 6px',
              border: 'none',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {(Object.keys(STATUS_LABEL) as RoadmapStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {r.target_date !== '' ? (
            <span>{r.target_date.slice(0, 10)}</span>
          ) : r.quarter !== '' ? (
            <span>{r.quarter}</span>
          ) : null}
          {ownerName !== '' && (
            <span style={{ marginLeft: 'auto', maxWidth: 74, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ownerName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Details dialog.                                                             */
/* -------------------------------------------------------------------------- */

function MilestoneDetails({
  item,
  allItems,
  members,
  onClose,
  onSave,
  onDelete,
  onDisconnect,
  onOpenItem,
}: {
  item: RoadmapItem;
  allItems: RoadmapItem[];
  members: TeamMember[];
  onClose: () => void;
  onSave: (item: RoadmapItem, fields: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => void;
  onDisconnect: (parentId: string, childId: string) => void;
  onOpenItem: (id: string) => void;
}): React.JSX.Element {
  const [form, setForm] = useState({
    title: item.title,
    description: item.description,
    status: item.status,
    quarter: item.quarter,
    target_date: item.target_date,
    owner: item.owner,
  });
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await onSave(item, {
        title: form.title.trim() || 'Untitled',
        description: form.description,
        status: form.status,
        quarter: form.quarter,
        target_date: form.target_date,
        owner: form.owner,
      });
      toast.success('Saved');
      onClose();
    } catch {
      /* surfaced by shell */
    } finally {
      setBusy(false);
    }
  };

  const prereqs = (item.prerequisites ?? [])
    .map((pid) => allItems.find((r) => r.id === pid))
    .filter((r): r is RoadmapItem => r !== undefined);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Milestone · ${item.title}`}
      description={`${item.quarter || '—'} · ${STATUS_LABEL[item.status]}`}
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onDelete(item.id);
              onClose();
            }}
          >
            Delete
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Textarea
          label="Description"
          rows={4}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="What ships when this milestone is done?"
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Quarter"
            value={form.quarter}
            onChange={(e) => setForm({ ...form, quarter: e.target.value })}
            placeholder="2026-Q3"
          />
          <Input
            label="Target date"
            type="date"
            value={form.target_date.slice(0, 10)}
            onChange={(e) => setForm({ ...form, target_date: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Status"
            value={form.status}
            options={STATUS_OPTIONS}
            onChange={(e) => setForm({ ...form, status: e.target.value as RoadmapStatus })}
          />
          <Select
            label="Owner"
            value={form.owner}
            placeholder="Unassigned"
            options={members.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(e) => setForm({ ...form, owner: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--lui-muted)]">Prerequisites</p>
          {prereqs.length === 0 ? (
            <p className="text-xs text-[var(--lui-muted)]">
              None. Drag the port between two cards on the canvas to connect them.
            </p>
          ) : (
            prereqs.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 border border-[var(--lui-border)]/70 bg-[var(--lui-bg)] px-2 py-1.5 text-sm"
              >
                <span aria-hidden className="size-2 shrink-0" style={{ background: STATUS_COLOR[p.status] }} />
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer truncate text-left"
                  onClick={() => onOpenItem(p.id)}
                >
                  {p.title}
                </button>
                <Button variant="ghost" size="sm" onClick={() => onDisconnect(p.id, item.id)}>
                  Remove
                </Button>
              </div>
            ))
          )}
          <p className="text-[11px] text-[var(--lui-muted)]">These must finish before this milestone can ship.</p>
        </div>
      </div>
    </Dialog>
  );
}
