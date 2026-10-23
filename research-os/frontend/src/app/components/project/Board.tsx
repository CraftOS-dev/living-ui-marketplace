/**
 * A board: a free canvas of cards. Claims and evidence (with their real
 * links), passages, papers, notes, sticky text and sections.
 *
 *   Drag from the drawer onto the board, or press its "+" to place a card
 *   in view. Drag cards to move them (a section carries what is inside),
 *   the corner to resize, a claim's top dot onto another to link them.
 *   Double click empty space for a sticky note; Shift and drag to select
 *   several; Delete takes cards off the board (the records stay).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpenText, Check, CircleHelp, FileText, Frame, Highlighter, Library, Lightbulb, NotebookPen, PanelLeft, Plus, Quote, Search, SquareKanban, StickyNote, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { changed, READS, useLive } from '../../lib/live.ts';
import { clip, plural } from '../../lib/format.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { Anchor, Annotation, GNode, Note, Project, RelKind, Relation, WorkRow } from '../../lib/types.ts';
import { Cover, hueOfSlot, openPaper } from '../paper.tsx';
import { Button, Empty, IconButton, LoadError, Spinner, Tabs, useConfirm } from '../ui.tsx';
import { anyVisible, bounds, gridStyle, linkPath, LinkMarkers, useCanvas, ZoomControls } from './canvas.tsx';
import type { Box, Viewport } from './canvas.tsx';
import { allowedLinks, KIND_ICON, NodeCard, NodeInspector } from './ClaimsMap.tsx';
import type { ReadingRow } from '../../pages/Project.tsx';

type RefKind = 'node' | 'anchor' | 'work' | 'note' | 'text' | 'section';

interface Item {
  id: string;
  ref_kind: RefKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  color: string;
  text: string;
  ref: (GNode & { passage?: { quote: string; page: number } | null }) | Anchor | WorkRow | { id: string; title: string; snippet: string; kind: string } | null;
}

interface BoardData {
  board: { id: string; project: string; name: string; viewport: Viewport | null; items: number };
  items: Item[];
  relations: Relation[];
}

const DRAG_CARD = 'application/x-research-card';
const COLORS = ['plain', 'amber', 'green', 'blue', 'violet', 'red', 'teal', 'accent'];

function refId(it: Item): string {
  return it.ref !== null && 'id' in it.ref ? it.ref.id : '';
}

export function BoardView({ project, boardId }: { project: Project; boardId: string }): React.JSX.Element {
  if (boardId === '') return <NoBoard project={project} />;
  return <Board key={boardId} project={project} boardId={boardId} />;
}

function NoBoard({ project }: { project: Project }): React.JSX.Element {
  const make = async (): Promise<void> => {
    const r = await op<{ board: { id: string } }>('boards.create', { project: project.id });
    changed('boards');
    replaceQuery({ view: 'board', board: r.board.id });
  };
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Empty icon={SquareKanban} title="No boards yet" action={<Button variant="primary" icon={Plus} onClick={() => void make()}>New board</Button>}>
        Lay out claims, passages and papers your way.
      </Empty>
    </div>
  );
}

function Board({ project, boardId }: { project: Project; boardId: string }): React.JSX.Element {
  const data = useLive((signal) => op<BoardData>('boards.get', { board: boardId }, { quiet: true, signal }), ['boards', 'board_items', ...READS.graph, 'notes', 'works'], [boardId], 150);
  const [drawer, setDrawer] = useState(() => {
    try {
      return localStorage.getItem('ro_board_drawer') !== '0';
    } catch {
      return true;
    }
  });
  const [inspect, setInspect] = useState('');
  const toggleDrawer = (): void =>
    setDrawer((d) => {
      try {
        localStorage.setItem('ro_board_drawer', d ? '0' : '1');
      } catch {
        /* a convenience */
      }
      return !d;
    });
  if (data.error !== null) return <div className="p-4"><LoadError message={data.error} onRetry={data.reload} /></div>;
  if (data.data === null) return <div className="flex flex-1 items-center justify-center"><Spinner size={20} /></div>;
  const d = data.data;
  const nodes = d.items.filter((i) => i.ref_kind === 'node' && i.ref !== null).map((i) => i.ref as GNode);
  return (
    <div className="flex min-h-0 flex-1">
      {drawer && <Drawer project={project} board={d} />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Canvas project={project} d={d} drawerOpen={drawer} onToggleDrawer={toggleDrawer} onInspect={setInspect} />
      </div>
      {inspect !== '' && nodes.some((n) => n.id === inspect) && <NodeInspector key={inspect} id={inspect} nodes={nodes} onSelect={setInspect} onClose={() => setInspect('')} />}
    </div>
  );
}

/* --------------------------------------------------------------- canvas */

function Canvas({ project, d, drawerOpen, onToggleDrawer, onInspect }: { project: Project; d: BoardData; drawerOpen: boolean; onToggleDrawer: () => void; onInspect: (id: string) => void }): React.JSX.Element {
  const c = useCanvas(d.board.viewport);
  const [confirmNode, confirm] = useConfirm();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [local, setLocal] = useState<Record<string, Partial<Box>>>({});
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const [pick, setPick] = useState<{ from: string; to: string; kinds: RelKind[]; sx: number; sy: number } | null>(null);
  const [editing, setEditing] = useState('');
  const [name, setName] = useState(d.board.name);
  const fitted = useRef(d.board.viewport !== null);
  const refit = useRef(false);
  useEffect(() => setLocal({}), [d]);
  useEffect(() => setName(d.board.name), [d.board.name]);
  const items = d.items;
  const boxOf = useCallback((it: Item): Box => ({ x: local[it.id]?.x ?? it.x, y: local[it.id]?.y ?? it.y, w: local[it.id]?.w ?? it.w, h: local[it.id]?.h ?? it.h }), [local]);
  const fitAll = useCallback(() => c.fit(bounds(items.map(boxOf)), 1), [c, items, boxOf]);
  useEffect(() => {
    if (items.length === 0) return;
    if (!fitted.current) {
      fitted.current = true;
      setTimeout(fitAll, 0);
      return;
    }
    // A remembered view that shows none of the cards (they moved, or the window changed): fit once.
    const el = c.ref.current;
    if (el !== null && el.clientWidth > 0 && !anyVisible(items.map(boxOf), c.vp, el.clientWidth, el.clientHeight) && !refit.current) {
      refit.current = true;
      setTimeout(fitAll, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, fitAll]);
  // Remember the view.
  const vpKey = `${Math.round(c.vp.x)}:${Math.round(c.vp.y)}:${c.vp.zoom.toFixed(3)}`;
  useEffect(() => {
    const t = setTimeout(() => void op('boards.update', { board: d.board.id, viewport: { x: Math.round(c.vp.x), y: Math.round(c.vp.y), zoom: Math.round(c.vp.zoom * 1000) / 1000 } }, { quiet: true }).catch(() => undefined), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vpKey, d.board.id]);

  const nodeItems = useMemo(() => new Map(items.filter((i) => i.ref_kind === 'node' && i.ref !== null).map((i) => [refId(i), i])), [items]);

  const place = async (cards: { ref_kind: RefKind; id?: string; x: number; y: number; text?: string; w?: number; h?: number; color?: string }[]): Promise<string[]> => {
    const r = await op<{ placed: string[] }>('boards.place', { board: d.board.id, items: cards });
    changed('board_items');
    return r.placed ?? [];
  };

  const center = (): { x: number; y: number } => {
    const el = c.ref.current;
    return c.toWorld((el?.getBoundingClientRect().left ?? 0) + (el?.clientWidth ?? 600) / 2, (el?.getBoundingClientRect().top ?? 0) + (el?.clientHeight ?? 400) / 2);
  };

  const addText = async (at?: { x: number; y: number }): Promise<void> => {
    const p = at ?? center();
    const placed = await place([{ ref_kind: 'text', x: Math.round(p.x - 110), y: Math.round(p.y - 50), text: '', color: 'amber' }]);
    if (placed[0]) setEditing(placed[0]);
  };

  const addSection = async (): Promise<void> => {
    const inside = items.filter((i) => sel.has(i.id));
    const b = bounds(inside.map(boxOf));
    const p = center();
    const box = b !== null ? { x: b.x - 24, y: b.y - 48, w: b.w + 48, h: b.h + 72 } : { x: p.x - 260, y: p.y - 180, w: 520, h: 360 };
    const placed = await place([{ ref_kind: 'section', x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h), text: 'Section', color: 'blue' }]);
    if (placed[0]) setEditing(placed[0]);
  };

  const removeSel = async (): Promise<void> => {
    const ids = [...sel];
    if (ids.length === 0) return;
    await op('boards.remove-items', { board: d.board.id, items: ids });
    changed('board_items');
    setSel(new Set());
  };

  const startDrag = (e: React.PointerEvent, it: Item): void => {
    if (e.button !== 0 || editing === it.id) return;
    e.stopPropagation();
    const start = c.toWorld(e.clientX, e.clientY);
    let group = sel.has(it.id) ? items.filter((i) => sel.has(i.id)) : [it];
    // A section carries the cards inside it.
    for (const s of group.filter((g) => g.ref_kind === 'section')) {
      const sb = boxOf(s);
      for (const i of items) {
        const b = boxOf(i);
        if (i.id !== s.id && !group.includes(i) && b.x >= sb.x && b.y >= sb.y && b.x + b.w <= sb.x + sb.w && b.y + b.h <= sb.y + sb.h) group = [...group, i];
      }
    }
    const origin = new Map(group.map((g) => [g.id, boxOf(g)]));
    let moved = false;
    const onMove = (ev: PointerEvent): void => {
      const p = c.toWorld(ev.clientX, ev.clientY);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) * c.vp.zoom < 4) return;
      moved = true;
      const next: Record<string, Partial<Box>> = {};
      for (const g of group) next[g.id] = { x: Math.round((origin.get(g.id)?.x ?? 0) + p.x - start.x), y: Math.round((origin.get(g.id)?.y ?? 0) + p.y - start.y) };
      setLocal((l) => ({ ...l, ...next }));
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) {
        if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
          setSel((s) => {
            const n = new Set(s);
            if (n.has(it.id)) n.delete(it.id);
            else n.add(it.id);
            return n;
          });
        } else {
          setSel(new Set([it.id]));
          if (it.ref_kind === 'node') onInspect(refId(it));
          else onInspect('');
        }
        return;
      }
      const p = c.toWorld(ev.clientX, ev.clientY);
      const positions = group.map((g) => ({ item: g.id, x: Math.round((origin.get(g.id)?.x ?? 0) + p.x - start.x), y: Math.round((origin.get(g.id)?.y ?? 0) + p.y - start.y) }));
      void op('boards.move', { board: d.board.id, positions }, { quiet: true }).then(() => changed('board_items')).catch(() => setLocal({}));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResize = (e: React.PointerEvent, it: Item): void => {
    e.stopPropagation();
    e.preventDefault();
    const start = c.toWorld(e.clientX, e.clientY);
    const b0 = boxOf(it);
    const min = it.ref_kind === 'section' ? { w: 200, h: 120 } : { w: 160, h: 70 };
    const size = (ev: PointerEvent): { w: number; h: number } => {
      const p = c.toWorld(ev.clientX, ev.clientY);
      return { w: Math.round(Math.max(min.w, b0.w + p.x - start.x)), h: Math.round(Math.max(min.h, b0.h + p.y - start.y)) };
    };
    const onMove = (ev: PointerEvent): void => setLocal((l) => ({ ...l, [it.id]: { ...l[it.id], ...size(ev) } }));
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      void op('boards.update-item', { item: it.id, ...size(ev) }, { quiet: true }).then(() => changed('board_items'));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startLink = (e: React.PointerEvent, it: Item): void => {
    e.stopPropagation();
    e.preventDefault();
    const from = it.ref as GNode;
    const onMove = (ev: PointerEvent): void => {
      const p = c.toWorld(ev.clientX, ev.clientY);
      setLink({ from: it.id, x: p.x, y: p.y });
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLink(null);
      const el = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.hasAttribute('data-node'));
      const to = el?.getAttribute('data-node');
      const target = to ? nodeItems.get(to) : undefined;
      if (target === undefined || refId(target) === from.id) return;
      const tn = target.ref as GNode;
      const kinds = allowedLinks(from.kind, tn.kind);
      if (kinds.length === 0) {
        toast.error('A ' + from.kind + ' cannot link to a ' + tn.kind + '.');
        return;
      }
      if (kinds.length === 1) void makeLink(from.id, tn.id, kinds[0] as RelKind);
      else setPick({ from: from.id, to: tn.id, kinds, sx: ev.clientX, sy: ev.clientY });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const makeLink = async (from: string, to: string, kind: RelKind): Promise<void> => {
    setPick(null);
    await op('relations.create', { from, to, kind }).catch(() => undefined);
    changed('relations');
  };

  const startMarquee = (e: React.PointerEvent): void => {
    const s = c.toWorld(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent): void => {
      const p = c.toWorld(ev.clientX, ev.clientY);
      setMarquee({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const p = c.toWorld(ev.clientX, ev.clientY);
      const m = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
      setMarquee(null);
      setSel(new Set(items.filter((i) => i.ref_kind !== 'section').filter((i) => {
        const b = boxOf(i);
        return b.x < m.x + m.w && b.x + b.w > m.x && b.y < m.y + m.h && b.y + b.h > m.y;
      }).map((i) => i.id)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    const raw = e.dataTransfer.getData(DRAG_CARD);
    if (raw === '') return;
    e.preventDefault();
    const card = JSON.parse(raw) as { ref_kind: RefKind; id: string };
    const p = c.toWorld(e.clientX, e.clientY);
    await place([{ ref_kind: card.ref_kind, id: card.id, x: Math.round(p.x - 120), y: Math.round(p.y - 40) }]);
  };

  const onKey = async (e: React.KeyboardEvent): Promise<void> => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size > 0) {
      if (sel.size === 1 || (await confirm('Take ' + plural(sel.size, 'card') + ' off the board? The records stay.', 'Remove cards', 'Remove'))) await removeSel();
    } else if (e.key === 'Escape') {
      setSel(new Set());
      onInspect('');
    } else if (e.key === 'f' || e.key === 'F') fitAll();
    else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSel(new Set(items.map((i) => i.id)));
    }
  };

  const rename = async (): Promise<void> => {
    if (name.trim() === '' || name.trim() === d.board.name) {
      setName(d.board.name);
      return;
    }
    await op('boards.update', { board: d.board.id, name: name.trim() });
    changed('boards');
  };

  const ordered = [...items].sort((a, b) => (a.ref_kind === 'section' ? -1 : 0) - (b.ref_kind === 'section' ? -1 : 0) || a.z - b.z);
  const fromItem = link !== null ? items.find((i) => i.id === link.from) : undefined;
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-2">
        <IconButton icon={PanelLeft} label={drawerOpen ? 'Hide the drawer' : 'Show the drawer'} active={drawerOpen} onClick={onToggleDrawer} />
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Board name" className="h-7 min-w-0 max-w-[280px] flex-1 rounded-[var(--ro-r-sm)] bg-transparent px-1.5 text-[13px] font-bold outline-none hover:bg-[var(--ro-row)] focus:bg-[var(--ro-shell)] focus:ring-1 focus:ring-[var(--ro-ink)]" />
        <span className="flex-1" />
        {sel.size > 0 && <span className="text-[12px] text-[var(--ro-muted)]">{plural(sel.size, 'card')} selected</span>}
        {sel.size > 0 && <IconButton icon={Trash2} label="Take off the board (Delete)" variant="danger" onClick={() => void removeSel()} />}
        <Button size="sm" icon={StickyNote} onClick={() => void addText()}>
          Text
        </Button>
        <Button size="sm" icon={Frame} onClick={() => void addSection()} title={sel.size > 0 ? 'Put the selected cards in a section' : 'Add a section'}>
          Section
        </Button>
      </div>
      <div className="relative min-h-0 flex-1" tabIndex={0} onKeyDown={(e) => void onKey(e)} aria-label="Board">
        <div
          ref={c.ref}
          className={cn('ro-canvas absolute inset-0', c.panning && 'ro-panning')}
          style={gridStyle(c.vp)}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget && !(e.target as HTMLElement).hasAttribute('data-bg')) return;
            if (e.shiftKey) {
              e.preventDefault();
              startMarquee(e);
              return;
            }
            if (c.onBackgroundPointerDown(e)) {
              setSel(new Set());
              setEditing('');
              onInspect('');
            }
          }}
          onDoubleClick={(e) => {
            if (e.target !== e.currentTarget && !(e.target as HTMLElement).hasAttribute('data-bg')) return;
            void addText(c.toWorld(e.clientX, e.clientY));
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_CARD)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(e) => void onDrop(e)}
          data-own-drop
        >
          <div data-bg className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${c.vp.x}px, ${c.vp.y}px) scale(${c.vp.zoom})` }}>
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
              <LinkMarkers />
              {d.relations.map((r) => {
                const a = nodeItems.get(r.from);
                const b = nodeItems.get(r.to);
                if (a === undefined || b === undefined) return null;
                const prop = r.status === 'agent_proposed';
                return <path key={r.id} d={linkPath(boxOf(a), boxOf(b)).d} fill="none" style={{ stroke: prop ? 'var(--ro-accent)' : `var(--ro-rel-${r.kind})` }} strokeWidth={1.75} strokeDasharray={prop ? '6 5' : undefined} markerEnd={`url(#ro-arrow-${prop ? 'proposed' : r.kind})`} />;
              })}
              {link !== null && fromItem !== undefined && <path d={linkPath(boxOf(fromItem), { x: link.x - 1, y: link.y - 1, w: 2, h: 2 }).d} fill="none" style={{ stroke: 'var(--ro-ink-2)' }} strokeWidth={2} strokeDasharray="4 4" markerEnd="url(#ro-arrow-draft)" />}
            </svg>
            {ordered.map((it) => (
              <Card key={it.id} it={it} b={boxOf(it)} selected={sel.has(it.id)} editing={editing === it.id} linking={link !== null} onPointerDown={(e) => startDrag(e, it)} onResize={(e) => startResize(e, it)} onLinkStart={(e) => startLink(e, it)} onEdit={() => setEditing(it.id)} onDoneEdit={() => setEditing('')} project={project.id} />
            ))}
            {marquee !== null && <div className="pointer-events-none absolute rounded-[3px] border border-[var(--ro-accent)] bg-[var(--ro-accent-soft)]/50" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
          </div>
        </div>
        {items.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto">
              <Empty icon={SquareKanban} title="An empty board" action={<span className="flex gap-2">{!drawerOpen && <Button icon={PanelLeft} onClick={onToggleDrawer}>Open the drawer</Button>}<Button icon={StickyNote} onClick={() => void addText()}>Add text</Button></span>}>
                Drag claims, highlights, papers and notes here from the drawer.
              </Empty>
            </div>
          </div>
        )}
        <div className="absolute bottom-3 right-3">
          <ZoomControls zoom={c.vp.zoom} onZoom={c.zoomBy} onFit={fitAll} />
        </div>
        {pick !== null && (
          <div style={{ position: 'fixed', left: pick.sx + 8, top: pick.sy + 8 }} className="ro-pop z-50 flex flex-col gap-0.5 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-1 shadow-[var(--ro-shadow)]">
            {pick.kinds.map((k, i) => (
              <button key={k} autoFocus={i === 0} type="button" onClick={() => void makeLink(pick.from, pick.to, k)} className="flex h-8 items-center gap-2 rounded-[var(--ro-r-sm)] px-2.5 text-[13px] font-semibold hover:bg-[var(--ro-row)]">
                <span className="h-0.5 w-5 rounded-full" style={{ background: `var(--ro-rel-${k})` }} /> {k === 'supports' ? 'Supports' : 'Opposes'}
              </button>
            ))}
            <button type="button" onClick={() => setPick(null)} className="h-7 rounded-[var(--ro-r-sm)] px-2.5 text-left text-[12px] text-[var(--ro-muted)] hover:bg-[var(--ro-row)]">
              Cancel
            </button>
          </div>
        )}
      </div>
      {confirmNode}
    </>
  );
}

function Card({ it, b, selected, editing, linking, onPointerDown, onResize, onLinkStart, onEdit, onDoneEdit, project }: { it: Item; b: Box; selected: boolean; editing: boolean; linking: boolean; onPointerDown: (e: React.PointerEvent) => void; onResize: (e: React.PointerEvent) => void; onLinkStart: (e: React.PointerEvent) => void; onEdit: () => void; onDoneEdit: () => void; project: string }): React.JSX.Element {
  const resize = <span role="presentation" onPointerDown={onResize} className="absolute bottom-0 right-0 z-10 size-3 cursor-nwse-resize opacity-0 group-hover:opacity-100" style={{ background: 'linear-gradient(135deg, transparent 50%, var(--ro-line-strong, var(--ro-muted)) 50%)' }} />;
  if (it.ref_kind === 'node' && it.ref !== null) {
    return (
      <div className="group">
        <NodeCard n={it.ref as GNode} b={b} selected={selected} dim={false} hit={false} linkTarget={linking} onPointerDown={onPointerDown} onLinkStart={onLinkStart} />
      </div>
    );
  }
  if (it.ref_kind === 'section') {
    return (
      <div onPointerDown={onPointerDown} className={cn('group absolute cursor-pointer rounded-[var(--ro-r-lg)] border-2 border-dashed', selected && 'ring-2 ring-[var(--ro-ink)]')} style={{ left: b.x, top: b.y, width: b.w, height: b.h, borderColor: it.color === 'plain' ? 'var(--ro-line)' : `var(--ro-pc-${it.color})`, background: it.color === 'plain' ? 'transparent' : `color-mix(in srgb, var(--ro-pc-${it.color}-soft) 45%, transparent)` }}>
        <EditableText it={it} editing={editing} onEdit={onEdit} onDone={onDoneEdit} className="absolute left-2 top-1.5 max-w-[90%] text-[14px] font-bold" single />
        {selected && <ColorDots it={it} />}
        {resize}
      </div>
    );
  }
  if (it.ref_kind === 'text') {
    return (
      <div onPointerDown={onPointerDown} onDoubleClick={onEdit} className={cn('group absolute flex cursor-pointer flex-col rounded-[var(--ro-r-md)] p-2.5 shadow-[var(--ro-shadow-sm)]', selected && 'ring-2 ring-[var(--ro-ink)]')} style={{ left: b.x, top: b.y, width: b.w, height: b.h, background: it.color === 'plain' ? 'var(--ro-card)' : `var(--ro-pc-${it.color}-soft)`, border: '1px solid var(--ro-line)' }}>
        <EditableText it={it} editing={editing} onEdit={onEdit} onDone={onDoneEdit} className="min-h-0 flex-1 overflow-hidden text-[13px] leading-[18px]" />
        {selected && <ColorDots it={it} />}
        {resize}
      </div>
    );
  }
  const shell = (icon: LucideIcon, color: string, label: string, body: React.ReactNode, open: () => void): React.JSX.Element => {
    const Icon = icon;
    return (
      <div onPointerDown={onPointerDown} onDoubleClick={open} className={cn('group absolute flex cursor-pointer flex-col gap-1 overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-2.5 py-2 shadow-[var(--ro-shadow-sm)]', selected && 'ring-2 ring-[var(--ro-ink)]')} style={{ left: b.x, top: b.y, width: b.w, height: b.h }} title="Double click to open">
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ro-muted)]">
          <Icon size={12} style={{ color }} /> <span className="truncate">{label}</span>
        </span>
        {body}
        {resize}
      </div>
    );
  };
  if (it.ref_kind === 'anchor' && it.ref !== null) {
    const a = it.ref as Anchor;
    return shell(Quote, 'var(--ro-kind-evidence)', a.work_label + ', p. ' + a.page, <span className="serif min-h-0 flex-1 overflow-hidden text-[12px] leading-[17px]">{a.quote}</span>, () => navigate('read', { file: a.file, page: String(a.page) }));
  }
  if (it.ref_kind === 'work' && it.ref !== null) {
    const w = it.ref as WorkRow;
    return shell(
      BookOpenText,
      'var(--ro-ink-2)',
      w.label,
      <span className="flex min-h-0 flex-1 gap-2">
        <Cover work={w} width={44} />
        <span className="line-clamp-4 min-w-0 flex-1 text-[12px] font-semibold leading-4">{w.title}</span>
      </span>,
      () => openPaper(w),
    );
  }
  if (it.ref_kind === 'note' && it.ref !== null) {
    const n = it.ref as { id: string; title: string; snippet: string };
    return shell(NotebookPen, 'var(--ro-amber)', n.title || 'Note', <span className="min-h-0 flex-1 overflow-hidden text-[12px] leading-4 text-[var(--ro-ink-2)]">{n.snippet}</span>, () => navigate('project', { id: project, view: 'notes', note: n.id }));
  }
  return <></>;
}

function EditableText({ it, editing, onEdit, onDone, className, single = false }: { it: Item; editing: boolean; onEdit: () => void; onDone: () => void; className?: string; single?: boolean }): React.JSX.Element {
  const [v, setV] = useState(it.text);
  useEffect(() => setV(it.text), [it.text]);
  const save = (): void => {
    onDone();
    if (v !== it.text) void op('boards.update-item', { item: it.id, text: v }, { quiet: true }).then(() => changed('board_items'));
  };
  if (editing) {
    return single ? (
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && save()} onPointerDown={(e) => e.stopPropagation()} className={cn(className, 'rounded-[3px] bg-[var(--ro-card)] px-1 outline-none ring-1 ring-[var(--ro-ink)]')} aria-label="Section name" />
    ) : (
      <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Escape' && save()} onPointerDown={(e) => e.stopPropagation()} className={cn(className, 'resize-none bg-transparent outline-none')} aria-label="Text" />
    );
  }
  return (
    <span onDoubleClick={(e) => { e.stopPropagation(); onEdit(); }} className={cn(className, 'whitespace-pre-wrap', v === '' && 'text-[var(--ro-muted)]')}>
      {v === '' ? (single ? 'Section' : 'Double click to write') : v}
    </span>
  );
}

function ColorDots({ it }: { it: Item }): React.JSX.Element {
  return (
    <span onPointerDown={(e) => e.stopPropagation()} className="absolute -top-8 left-0 z-20 flex items-center gap-1 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-1 shadow-[var(--ro-shadow-sm)]">
      {COLORS.map((c) => (
        <button key={c} type="button" aria-label={c} title={c} onClick={() => void op('boards.update-item', { item: it.id, color: c }, { quiet: true }).then(() => changed('board_items'))} className={cn('size-4 rounded-full border border-[var(--ro-line)]', it.color === c && 'ring-2 ring-[var(--ro-ink)] ring-offset-1 ring-offset-[var(--ro-card)]')} style={{ background: c === 'plain' ? 'var(--ro-card)' : `var(--ro-pc-${c})` }} />
      ))}
    </span>
  );
}

/* --------------------------------------------------------------- drawer */

type DrawerTab = 'nodes' | 'marks' | 'papers' | 'notes';

function Drawer({ project, board }: { project: Project; board: BoardData }): React.JSX.Element {
  const [tab, setTab] = useState<DrawerTab>('nodes');
  const [q, setQ] = useState('');
  const onBoard = useMemo(() => new Set(board.items.map((i) => i.ref_kind + ':' + refId(i))), [board.items]);
  const nodes = useLive((signal) => op<{ nodes: GNode[] }>('nodes.list', { project: project.id, passages: false, limit: 2000 }, { quiet: true, signal }).then((r) => r.nodes.filter((n) => n.status !== 'researcher_rejected')), ['nodes'], [project.id], 300);
  const marks = useLive((signal) => (tab === 'marks' ? op<{ annotations: Annotation[] }>('annotations.list', { project: project.id }, { quiet: true, signal }).then((r) => r.annotations.filter((a) => a.anchor !== null)) : Promise.resolve(null)), ['annotations'], [project.id, tab], 300);
  const papers = useLive((signal) => (tab === 'papers' ? op<{ works: ReadingRow[] }>('projects.works', { project: project.id }, { quiet: true, signal }).then((r) => r.works.map((x) => x.work)) : Promise.resolve(null)), ['project_works', 'works'], [project.id, tab], 300);
  const notes = useLive((signal) => (tab === 'notes' ? op<{ notes: Note[] }>('notes.list', { project: project.id, limit: 200 }, { quiet: true, signal }).then((r) => r.notes) : Promise.resolve(null)), ['notes'], [project.id, tab], 300);
  const match = (s: string): boolean => q.trim() === '' || s.toLowerCase().includes(q.trim().toLowerCase());
  const placeInView = async (ref_kind: RefKind, id: string): Promise<void> => {
    const el = document.querySelector('.ro-canvas');
    const r = el?.getBoundingClientRect();
    const vp = board.board.viewport ?? { x: 40, y: 40, zoom: 1 };
    const x = r ? (r.width / 2 - vp.x) / vp.zoom : 100;
    const y = r ? (r.height / 2 - vp.y) / vp.zoom : 100;
    await op('boards.place', { board: board.board.id, items: [{ ref_kind, id, x: Math.round(x - 120 + Math.random() * 60), y: Math.round(y - 50 + Math.random() * 60) }] });
    changed('board_items');
  };
  const entry = (ref_kind: RefKind, id: string, icon: LucideIcon, color: string, title: string, sub: string): React.JSX.Element => {
    const Icon = icon;
    const there = onBoard.has(ref_kind + ':' + id);
    return (
      <li key={ref_kind + id}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_CARD, JSON.stringify({ ref_kind, id }));
            e.dataTransfer.effectAllowed = 'copy';
          }}
          className={cn('group flex cursor-grab items-start gap-2 rounded-[var(--ro-r)] px-2 py-1.5 hover:bg-[var(--ro-row)] active:cursor-grabbing', there && 'opacity-55')}
        >
          <Icon size={13} className="mt-0.5 shrink-0" style={{ color }} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[12px] font-semibold leading-4">{title}</span>
            {sub !== '' && <span className="block truncate text-[12px] text-[var(--ro-muted)]">{sub}</span>}
          </span>
          {there ? <Check size={13} className="mt-0.5 shrink-0 text-[var(--ro-muted)]" aria-label="On the board" /> : <IconButton icon={Plus} label="Place on the board" size={22} className="opacity-0 group-hover:opacity-100" onClick={() => void placeInView(ref_kind, id)} />}
        </div>
      </li>
    );
  };
  const loading = <div className="flex justify-center p-4"><Spinner /></div>;
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--ro-line)] bg-[var(--ro-card)] max-[760px]:hidden">
      <Tabs label="Drawer" value={tab} onChange={setTab} className="px-2" options={[{ value: 'nodes', label: 'Claims' }, { value: 'marks', label: 'Highlights' }, { value: 'papers', label: 'Papers' }, { value: 'notes', label: 'Notes' }]} />
      <label className="mx-2 my-2 flex h-7 items-center gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] px-2 focus-within:border-[var(--ro-ink)]">
        <Search size={13} className="text-[var(--ro-muted)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" aria-label="Find in the drawer" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
      </label>
      <div data-scroll className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {tab === 'nodes' &&
          (nodes.data === null ? (
            loading
          ) : nodes.data.length === 0 ? (
            <Empty compact icon={Lightbulb} title="No claims yet" />
          ) : (
            <ul>{nodes.data.filter((n) => match(n.title)).map((n) => entry('node', n.id, KIND_ICON[n.kind], `var(--ro-kind-${n.kind})`, n.title, n.kind === 'evidence' ? n.work_label : ''))}</ul>
          ))}
        {tab === 'marks' &&
          (marks.data === null ? (
            loading
          ) : marks.data.length === 0 ? (
            <Empty compact icon={Highlighter} title="No highlights in this project's papers" />
          ) : (
            <ul>{marks.data.filter((a) => match(a.anchor?.quote ?? '')).map((a) => entry('anchor', a.anchor?.id ?? '', Highlighter, `var(--ro-hl-${hueOfSlot(a.color_slot)})`, clip(a.anchor?.quote ?? '', 140), (a.anchor?.work_label ?? '') + ', p. ' + a.page))}</ul>
          ))}
        {tab === 'papers' &&
          (papers.data === null ? (
            loading
          ) : papers.data.length === 0 ? (
            <Empty compact icon={Library} title="No papers in this project" />
          ) : (
            <ul>{papers.data.filter((w) => match(w.title)).map((w) => entry('work', w.id, FileText, 'var(--ro-ink-2)', w.title, w.label))}</ul>
          ))}
        {tab === 'notes' &&
          (notes.data === null ? (
            loading
          ) : notes.data.length === 0 ? (
            <Empty compact icon={NotebookPen} title="No notes in this project" />
          ) : (
            <ul>{notes.data.filter((n) => match(n.title + ' ' + n.snippet)).map((n) => entry('note', n.id, NotebookPen, 'var(--ro-amber)', n.title || 'Untitled note', clip(n.snippet, 60)))}</ul>
          ))}
      </div>
      <div className="flex items-center gap-1.5 border-t border-[var(--ro-hair)] px-3 py-2 text-[12px] text-[var(--ro-muted)]">
        <CircleHelp size={12} /> {plural(board.items.length, 'card')} on this board
      </div>
    </aside>
  );
}
