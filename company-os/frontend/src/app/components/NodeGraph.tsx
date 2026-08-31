/**
 * NodeGraph — interactive DAG editor (pan, zoom, multi-select, marquee,
 * group drag, drag-to-connect, edge delete, time dividers, minimap). Ported
 * from the Command Center's roadmap canvas and retinted to the Company OS
 * token set, then extended with editor-grade selection.
 *
 * Selection model (owned by the host so copy/paste/undo can read it):
 *  - plain click a card → select only it; shift-click → toggle it in/out
 *  - drag on empty canvas → marquee (rubber-band) select; shift keeps the
 *    current selection and adds; plain marquee replaces it
 *  - drag a selected card → the whole selection moves together; drag an
 *    unselected card → it becomes the selection and moves alone
 *  - pan with Space-drag / middle-mouse / Alt-drag (so left-drag is free for
 *    marquee); wheel zooms
 *
 * Implementation: pure SVG, world lives in one matrix <g>; drag state in a ref
 * with window-level handlers registered once so mouseup is never dropped.
 */
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Columns3, Expand, Maximize2, Minus, Plus, Shrink, Trash2, Undo2, Zap } from 'lucide-react';
import { Button } from '../../kit/index.ts';

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  parentIds: string[];
}

/** Vertical draggable divider (e.g. a work-week / quarter boundary) at world X. */
export interface GraphDivider {
  id: string;
  label: string;
  x: number;
}

export interface NodeRenderProps<T> {
  node: T;
  width: number;
  height: number;
  selected: boolean;
  hover: boolean;
}

interface NodeGraphProps<T extends GraphNode> {
  nodes: T[];
  selectedIds: ReadonlySet<string>;
  renderNode: (props: NodeRenderProps<T>) => ReactNode;
  /** Stroke colour for edges entering this child. Default = accent. */
  edgeColor?: ((parent: T, child: T) => string) | undefined;
  /** Persist positions for one or more nodes. Called once on mouseup. */
  onMoveMany: (updates: { id: string; x: number; y: number }[]) => void;
  /** Add child→parent prerequisite. (parentId is the source of the edge.) */
  onConnect: (parentId: string, childId: string) => void;
  /** Remove a prerequisite link. */
  onDisconnect: (parentId: string, childId: string) => void;
  /** Click a node. additive = shift-click (toggle). */
  onSelect: (id: string, additive: boolean) => void;
  /** Marquee result. additive = shift was held (union with current). */
  onSelectBox: (ids: string[], additive: boolean) => void;
  /** Click on empty canvas with nothing dragged. */
  onSelectClear: () => void;
  /** Double-click empty canvas → fires with world coords. */
  onAddAt?: ((x: number, y: number) => void) | undefined;
  /** Optional auto-layout (computed by the host since it knows the schema). */
  onAutoLayout?: (() => void) | undefined;
  /** Triggered on Delete key when something is selected. */
  onDeleteSelected?: (() => void) | undefined;
  /** Optional undo hook shown in the toolbar and bound to the host. */
  onUndo?: (() => void) | undefined;
  undoDisabled?: boolean | undefined;
  /** Optional "add a divider" action, surfaced as a toolbar button. */
  onAddDivider?: (() => void) | undefined;
  dividerLabel?: string | undefined;
  nodeWidth?: number | undefined;
  nodeHeight?: number | undefined;
  height?: number | undefined;
  canEdit?: boolean | undefined;
  dividers?: GraphDivider[] | undefined;
  onDividersChange?: ((next: GraphDivider[]) => void) | undefined;
  entityLabel?: string | undefined;
}

const ERROR_COLOR = '#ef4444';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true;
}

export function NodeGraph<T extends GraphNode>(props: NodeGraphProps<T>): React.JSX.Element {
  const {
    nodes,
    selectedIds,
    renderNode,
    edgeColor,
    onMoveMany,
    onConnect,
    onDisconnect,
    onSelect,
    onSelectBox,
    onSelectClear,
    onAddAt,
    onAutoLayout,
    onDeleteSelected,
    onUndo,
    undoDisabled = false,
    onAddDivider,
    dividerLabel = 'divider',
    nodeWidth = 220,
    nodeHeight = 92,
    height = 620,
    canEdit = true,
    dividers,
    onDividersChange,
    entityLabel = 'milestone',
  } = props;

  const svgRef = useRef<SVGSVGElement>(null);

  const [view, setView] = useState({ tx: 60, ty: 60, scale: 1 });
  const [localPos, setLocalPos] = useState<Record<string, { x: number; y: number }>>({});
  const [pending, setPending] = useState<{ fromId: string; wx: number; wy: number } | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<{ parent: string; child: string } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [panMode, setPanMode] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [vpH, setVpH] = useState(0);
  const [localDivX, setLocalDivX] = useState<Record<string, number>>({});
  const [hoverDividerId, setHoverDividerId] = useState<string | null>(null);
  const [renamingDividerId, setRenamingDividerId] = useState<string | null>(null);
  const [dividerDraft, setDividerDraft] = useState('');

  type DragState =
    | { kind: 'pan'; startMx: number; startMy: number; startTx: number; startTy: number }
    | {
        kind: 'node';
        ids: string[];
        primaryId: string;
        wasInSelection: boolean;
        shift: boolean;
        startMx: number;
        startMy: number;
        start: Record<string, { x: number; y: number }>;
        moved: boolean;
      }
    | { kind: 'edge'; fromId: string }
    | { kind: 'marquee'; startWx: number; startWy: number; additive: boolean; moved: boolean }
    | { kind: 'divider'; id: string; startMx: number; startX: number; moved: boolean }
    | { kind: 'minimap' }
    | { kind: null };
  const drag = useRef<DragState>({ kind: null });

  const viewRef = useRef(view);
  viewRef.current = view;
  const localPosRef = useRef(localPos);
  localPosRef.current = localPos;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const cbRef = useRef({ onMoveMany, onConnect, onSelect, onSelectBox, onSelectClear, onDividersChange });
  cbRef.current = { onMoveMany, onConnect, onSelect, onSelectBox, onSelectClear, onDividersChange };
  const dividersRef = useRef(dividers);
  dividersRef.current = dividers;
  const localDivXRef = useRef(localDivX);
  localDivXRef.current = localDivX;
  const spaceRef = useRef(false);
  const maximizedRef = useRef(maximized);
  maximizedRef.current = maximized;

  // Effective drawn height: the viewport when maximized (fixed inset-0),
  // otherwise the fixed prop height.
  const effHeight = maximized ? vpH || height : height;
  const toggleMaximize = (): void => {
    setVpH(typeof window !== 'undefined' ? window.innerHeight : height);
    setMaximized((m) => !m);
  };

  const toWorld = useCallback(
    (sx: number, sy: number) => ({ x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale }),
    [view],
  );
  const screenFromEvent = (e: MouseEvent | React.MouseEvent): { sx: number; sy: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { sx: e.clientX - (rect?.left ?? 0), sy: e.clientY - (rect?.top ?? 0) };
  };
  const nodePos = useCallback(
    (n: T): { x: number; y: number } => localPos[n.id] ?? { x: n.x, y: n.y },
    [localPos],
  );

  // ── minimap ───────────────────────────────────────────────────────────
  const MM_W = 240;
  const MM_H = 120;
  const mmSvgRef = useRef<SVGSVGElement>(null);
  const mm = useMemo(() => {
    if (nodes.length === 0) return null;
    const ps = nodes.map((n) => localPos[n.id] ?? { x: n.x, y: n.y });
    const pad = 60;
    const minX = Math.min(...ps.map((p) => p.x)) - pad;
    const minY = Math.min(...ps.map((p) => p.y)) - pad;
    const maxX = Math.max(...ps.map((p) => p.x)) + nodeWidth + pad;
    const maxY = Math.max(...ps.map((p) => p.y)) + nodeHeight + pad;
    const w = maxX - minX;
    const h = maxY - minY;
    const scale = Math.min(MM_W / w, MM_H / h);
    return { minX, minY, scale, ox: (MM_W - w * scale) / 2, oy: (MM_H - h * scale) / 2 };
  }, [nodes, localPos, nodeWidth, nodeHeight]);
  const mmRef = useRef(mm);
  mmRef.current = mm;

  const centerViewOnMinimapPoint = useCallback((clientX: number, clientY: number): void => {
    const m = mmRef.current;
    const rect = mmSvgRef.current?.getBoundingClientRect();
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!m || !rect || !svgRect) return;
    const wx = (clientX - rect.left - m.ox) / m.scale + m.minX;
    const wy = (clientY - rect.top - m.oy) / m.scale + m.minY;
    setView((v) => ({ ...v, tx: svgRect.width / 2 - wx * v.scale, ty: svgRect.height / 2 - wy * v.scale }));
  }, []);

  const onMinimapDown = (e: React.MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    centerViewOnMinimapPoint(e.clientX, e.clientY);
    drag.current = { kind: 'minimap' };
  };

  // ── wheel zoom (non-passive so we can preventDefault) ─────────────────
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0012);
      setView((v) => {
        const newScale = clamp(v.scale * factor, 0.15, 3.0);
        const wx = (sx - v.tx) / v.scale;
        const wy = (sy - v.ty) / v.scale;
        return { scale: newScale, tx: sx - wx * newScale, ty: sy - wy * newScale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Space held → pan mode (so left-drag stays a marquee) ───────────────
  useEffect(() => {
    const kd = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        spaceRef.current = true;
        setPanMode(true);
        e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setPanMode(false);
      }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  // Keep the maximized canvas sized to the viewport across window resizes.
  useEffect(() => {
    if (!maximized) return undefined;
    const measure = (): void => setVpH(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [maximized]);

  // ── global mouse listeners for drag (registered once; state via refs) ──
  useEffect(() => {
    const worldFromClient = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = svgRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      const v = viewRef.current;
      return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale };
    };
    const onMoveEvt = (e: MouseEvent): void => {
      const d = drag.current;
      if (d.kind !== null && e.buttons === 0) {
        drag.current = { kind: null };
        setPending(null);
        setMarquee(null);
        return;
      }
      if (d.kind === 'pan') {
        setView((v) => ({ ...v, tx: d.startTx + (e.clientX - d.startMx), ty: d.startTy + (e.clientY - d.startMy) }));
        return;
      }
      if (d.kind === 'node') {
        const scale = viewRef.current.scale;
        const dxScreen = e.clientX - d.startMx;
        const dyScreen = e.clientY - d.startMy;
        if (!d.moved && Math.hypot(dxScreen, dyScreen) <= 5) return;
        d.moved = true;
        const ddx = dxScreen / scale;
        const ddy = dyScreen / scale;
        setLocalPos((p) => {
          const next = { ...p };
          for (const id of d.ids) {
            const s = d.start[id];
            if (s) next[id] = { x: s.x + ddx, y: s.y + ddy };
          }
          return next;
        });
        return;
      }
      if (d.kind === 'edge') {
        const w = worldFromClient(e.clientX, e.clientY);
        setPending({ fromId: d.fromId, wx: w.x, wy: w.y });
        return;
      }
      if (d.kind === 'marquee') {
        const w = worldFromClient(e.clientX, e.clientY);
        if (!d.moved && Math.hypot(w.x - d.startWx, w.y - d.startWy) * viewRef.current.scale <= 3) {
          setMarquee({ x0: d.startWx, y0: d.startWy, x1: w.x, y1: w.y });
          return;
        }
        d.moved = true;
        setMarquee({ x0: d.startWx, y0: d.startWy, x1: w.x, y1: w.y });
        return;
      }
      if (d.kind === 'divider') {
        const scale = viewRef.current.scale;
        const dxScreen = e.clientX - d.startMx;
        if (!d.moved && Math.abs(dxScreen) <= 3) return;
        d.moved = true;
        setLocalDivX((p) => ({ ...p, [d.id]: d.startX + dxScreen / scale }));
        return;
      }
      if (d.kind === 'minimap') {
        centerViewOnMinimapPoint(e.clientX, e.clientY);
      }
    };
    const onUp = (e: MouseEvent): void => {
      const d = drag.current;
      drag.current = { kind: null };
      setPending(null);
      if (d.kind === 'node') {
        if (d.moved) {
          const updates = d.ids.map((id) => {
            const p = localPosRef.current[id] ?? d.start[id] ?? { x: 0, y: 0 };
            return { id, x: p.x, y: p.y };
          });
          if (!d.wasInSelection) cbRef.current.onSelect(d.primaryId, false);
          cbRef.current.onMoveMany(updates);
        } else {
          cbRef.current.onSelect(d.primaryId, d.shift);
        }
        return;
      }
      if (d.kind === 'edge') {
        const w = worldFromClient(e.clientX, e.clientY);
        const positioned = nodesRef.current.map((n) => {
          const p = localPosRef.current[n.id] ?? { x: n.x, y: n.y };
          return { ...n, x: p.x, y: p.y };
        });
        const target = findNodeAt(positioned, w.x, w.y, nodeWidth, nodeHeight);
        if (target && target.id !== d.fromId && !target.parentIds.includes(d.fromId)) {
          cbRef.current.onConnect(d.fromId, target.id);
        }
        return;
      }
      if (d.kind === 'marquee') {
        if (d.moved) {
          const w = worldFromClient(e.clientX, e.clientY);
          const rx0 = Math.min(d.startWx, w.x);
          const rx1 = Math.max(d.startWx, w.x);
          const ry0 = Math.min(d.startWy, w.y);
          const ry1 = Math.max(d.startWy, w.y);
          const ids = nodesRef.current
            .filter((n) => {
              const p = localPosRef.current[n.id] ?? { x: n.x, y: n.y };
              return !(p.x + nodeWidth < rx0 || p.x > rx1 || p.y + nodeHeight < ry0 || p.y > ry1);
            })
            .map((n) => n.id);
          cbRef.current.onSelectBox(ids, d.additive);
        } else if (!d.additive) {
          cbRef.current.onSelectClear();
        }
        setMarquee(null);
        return;
      }
      if (d.kind === 'divider' && d.moved) {
        const x = localDivXRef.current[d.id];
        const list = dividersRef.current;
        if (x !== undefined && list && cbRef.current.onDividersChange) {
          cbRef.current.onDividersChange(list.map((dd) => (dd.id === d.id ? { ...dd, x } : dd)));
        }
      }
    };
    const onBlur = (): void => {
      drag.current = { kind: null };
      setPending(null);
      setMarquee(null);
    };
    window.addEventListener('mousemove', onMoveEvt);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMoveEvt);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [nodeWidth, nodeHeight, centerViewOnMinimapPoint]);

  // ── keyboard: Escape clears drag/selection, Delete removes selection ───
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setPending(null);
        setMarquee(null);
        drag.current = { kind: null };
        // Escape leaves full screen first; otherwise it clears the selection.
        if (maximizedRef.current) setMaximized(false);
        else onSelectClear();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0 && canEdit) {
        if (isTyping(e.target)) return;
        onDeleteSelected?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, onSelectClear, onDeleteSelected, canEdit]);

  useEffect(() => {
    setLocalPos({});
  }, [nodes]);
  useEffect(() => {
    setLocalDivX({});
  }, [dividers]);

  const fitToView = useCallback((): void => {
    if (nodes.length === 0 || !svgRef.current) return;
    const positions = nodes.map((n) => nodePos(n));
    const minX = Math.min(...positions.map((p) => p.x));
    const minY = Math.min(...positions.map((p) => p.y));
    const maxX = Math.max(...positions.map((p) => p.x)) + nodeWidth;
    const maxY = Math.max(...positions.map((p) => p.y)) + nodeHeight;
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const rect = svgRef.current.getBoundingClientRect();
    const pad = 50;
    const scale = clamp(Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h), 0.15, 1.2);
    setView({
      scale,
      tx: (rect.width - w * scale) / 2 - minX * scale,
      ty: (rect.height - h * scale) / 2 - minY * scale,
    });
  }, [nodes, nodeWidth, nodeHeight, nodePos]);

  const didInitialFit = useRef(false);
  useLayoutEffect(() => {
    if (didInitialFit.current || nodes.length === 0) return;
    didInitialFit.current = true;
    fitToView();
  }, [nodes.length, fitToView]);

  // Reframe when entering/leaving full screen (the canvas size just changed).
  // Ref-indirected so this only fires on the maximize toggle, not on every
  // fitToView identity change (which would reset the view on data updates).
  const fitRef = useRef(fitToView);
  fitRef.current = fitToView;
  const firstMaxRun = useRef(true);
  useEffect(() => {
    if (firstMaxRun.current) {
      firstMaxRun.current = false;
      return undefined;
    }
    const t = window.setTimeout(() => fitRef.current(), 60);
    return () => window.clearTimeout(t);
  }, [maximized]);

  const screenHitsNode = useCallback(
    (sx: number, sy: number): T | null => {
      const w = toWorld(sx, sy);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n === undefined) continue;
        const p = nodePos(n);
        if (w.x >= p.x && w.x <= p.x + nodeWidth && w.y >= p.y && w.y <= p.y + nodeHeight) return n;
      }
      return null;
    },
    [nodes, nodeWidth, nodeHeight, nodePos, toWorld],
  );

  const addAtCenter = (): void => {
    if (!canEdit || !onAddAt) return;
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const w = toWorld(r.width / 2, r.height / 2);
    onAddAt(w.x - nodeWidth / 2, w.y - nodeHeight / 2);
  };

  const onCanvasDown = (e: React.MouseEvent): void => {
    e.preventDefault();
    const wantPan = e.button === 1 || spaceRef.current || e.altKey;
    const { sx, sy } = screenFromEvent(e);
    if (!wantPan && screenHitsNode(sx, sy)) return; // node handler picks it up
    if (wantPan) {
      drag.current = { kind: 'pan', startMx: e.clientX, startMy: e.clientY, startTx: view.tx, startTy: view.ty };
      return;
    }
    const w = toWorld(sx, sy);
    drag.current = { kind: 'marquee', startWx: w.x, startWy: w.y, additive: e.shiftKey, moved: false };
    setMarquee({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
  };
  const onCanvasDblClick = (e: React.MouseEvent): void => {
    if (!canEdit || !onAddAt) return;
    const { sx, sy } = screenFromEvent(e);
    if (screenHitsNode(sx, sy)) return;
    const w = toWorld(sx, sy);
    onAddAt(w.x - nodeWidth / 2, w.y - nodeHeight / 2);
  };

  const onNodeDown = (e: React.MouseEvent, n: T): void => {
    e.stopPropagation();
    e.preventDefault();
    if (!canEdit) {
      onSelect(n.id, e.shiftKey);
      return;
    }
    const wasInSelection = selectedIds.has(n.id);
    const groupIds = wasInSelection && selectedIds.size > 0 ? Array.from(selectedIds) : [n.id];
    const start: Record<string, { x: number; y: number }> = {};
    for (const id of groupIds) {
      const nn = nodesRef.current.find((x) => x.id === id);
      if (nn) start[id] = localPos[id] ?? { x: nn.x, y: nn.y };
    }
    drag.current = {
      kind: 'node',
      ids: groupIds,
      primaryId: n.id,
      wasInSelection,
      shift: e.shiftKey,
      startMx: e.clientX,
      startMy: e.clientY,
      start,
      moved: false,
    };
  };
  const onPortDown = (e: React.MouseEvent, n: T): void => {
    e.stopPropagation();
    e.preventDefault();
    if (!canEdit) return;
    const { sx, sy } = screenFromEvent(e);
    const w = toWorld(sx, sy);
    drag.current = { kind: 'edge', fromId: n.id };
    setPending({ fromId: n.id, wx: w.x, wy: w.y });
  };

  const divX = (d: GraphDivider): number => localDivX[d.id] ?? d.x;
  const onDividerDown = (e: React.MouseEvent, d: GraphDivider): void => {
    e.stopPropagation();
    e.preventDefault();
    if (!canEdit || !onDividersChange) return;
    drag.current = { kind: 'divider', id: d.id, startMx: e.clientX, startX: divX(d), moved: false };
  };
  const startDividerRename = (d: GraphDivider): void => {
    if (!canEdit || !onDividersChange) return;
    setRenamingDividerId(d.id);
    setDividerDraft(d.label);
  };
  const commitDividerRename = (): void => {
    const id = renamingDividerId;
    setRenamingDividerId(null);
    if (!id || !dividers || !onDividersChange) return;
    const label = dividerDraft.trim();
    if (!label) return;
    onDividersChange(dividers.map((d) => (d.id === id ? { ...d, label } : d)));
  };
  const deleteDivider = (d: GraphDivider): void => {
    if (!dividers || !onDividersChange) return;
    onDividersChange(dividers.filter((x) => x.id !== d.id));
  };

  const edges = useMemo(() => {
    const idMap = new Map(nodes.map((n) => [n.id, n]));
    const list: { parent: T; child: T }[] = [];
    nodes.forEach((child) => {
      child.parentIds.forEach((pid) => {
        const parent = idMap.get(pid);
        if (parent) list.push({ parent, child });
      });
    });
    return list;
  }, [nodes]);

  const pendingNode = pending ? nodes.find((n) => n.id === pending.fromId) : null;
  const cursor = marquee !== null ? 'crosshair' : panMode ? 'grab' : 'default';

  return (
    <div
      className={
        maximized
          ? 'fixed inset-0 z-40 select-none overflow-hidden bg-[var(--lui-bg)]'
          : 'relative w-full select-none overflow-hidden border border-[var(--lui-border)] bg-[var(--lui-bg)]'
      }
      style={maximized ? undefined : { height }}
    >
      {/* Toolbar */}
      <div className="absolute inset-x-2 top-2 z-[5] flex flex-wrap items-center justify-between gap-1">
        <div className="flex gap-1 border border-[var(--lui-border)] bg-[var(--lui-surface)] p-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canEdit || !onAddAt}
            onClick={addAtCenter}
            aria-label={`Add ${entityLabel}`}
            title={`Add ${entityLabel}`}
          >
            <Plus size={13} aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canEdit || selectedIds.size === 0 || !onDeleteSelected}
            onClick={() => {
              if (canEdit && selectedIds.size > 0) onDeleteSelected?.();
            }}
            aria-label="Delete"
            title="Delete selected"
          >
            <Trash2 size={13} aria-hidden />
          </Button>
          {onUndo && (
            <Button size="sm" variant="ghost" disabled={undoDisabled} onClick={onUndo} aria-label="Undo" title="Undo">
              <Undo2 size={13} aria-hidden />
            </Button>
          )}
          {onAddDivider && (
            <Button size="sm" variant="ghost" disabled={!canEdit} onClick={onAddDivider}>
              <Columns3 size={13} aria-hidden />
              Add {dividerLabel}
            </Button>
          )}
          {selectedIds.size > 1 && (
            <span className="self-center whitespace-nowrap px-2 text-[11px] font-medium tabular-nums text-[var(--lui-muted)]">
              {selectedIds.size} selected
            </span>
          )}
        </div>

        <div className="flex gap-1 border border-[var(--lui-border)] bg-[var(--lui-surface)] p-1">
          <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => setView((v) => zoomToCenter(v, 1.25, svgRef.current))}>
            <Plus size={13} aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => setView((v) => zoomToCenter(v, 0.8, svgRef.current))}>
            <Minus size={13} aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={fitToView} aria-label="Fit to view" title="Fit to view">
            <Maximize2 size={13} aria-hidden />
          </Button>
          {onAutoLayout && (
            <Button size="sm" variant="ghost" onClick={onAutoLayout}>
              <Zap size={13} aria-hidden />
              Auto-layout
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={toggleMaximize} title={maximized ? 'Exit full screen (Esc)' : 'Full screen'}>
            {maximized ? <Shrink size={13} aria-hidden /> : <Expand size={13} aria-hidden />}
            {maximized ? 'Exit' : 'Full screen'}
          </Button>
        </div>
      </div>

      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center text-[13px] text-[var(--lui-muted)]">
          <div>No {entityLabel}s yet.</div>
          {canEdit && (
            <div className="text-xs">
              Click <strong>Add {entityLabel}</strong> above, or double-click anywhere on the canvas.
            </div>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        width="100%"
        height={effHeight}
        onMouseDown={onCanvasDown}
        onDoubleClick={onCanvasDblClick}
        style={{ display: 'block', cursor }}
      >
        <defs>
          <pattern
            id="ng-grid-sm"
            width={20}
            height={20}
            patternUnits="userSpaceOnUse"
            patternTransform={`scale(${view.scale}) translate(${view.tx / view.scale} ${view.ty / view.scale})`}
          >
            <circle cx={1} cy={1} r={0.7} fill="var(--lui-border)" />
          </pattern>
          <marker id="ng-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="currentColor" />
          </marker>
        </defs>
        <rect width="100%" height={effHeight} fill="url(#ng-grid-sm)" pointerEvents="none" />
        {/* Transparent catcher so empty-canvas mousedowns (pan / marquee) have a
            real hit target — an inline SVG's bare background is not reliably
            hit-testable, and the grid pattern above is mostly transparent. */}
        <rect width="100%" height={effHeight} fill="transparent" pointerEvents="all" />

        {(dividers ?? []).map((d) => {
          const sx = divX(d) * view.scale + view.tx;
          const active = hoverDividerId === d.id || drag.current.kind === 'divider';
          return (
            <g key={`div-${d.id}`}>
              <line
                x1={sx}
                y1={0}
                x2={sx}
                y2={effHeight}
                stroke={active ? 'var(--lui-accent)' : 'var(--lui-border)'}
                strokeWidth={active ? 2 : 1.5}
                strokeDasharray="7 6"
                pointerEvents="none"
              />
              {canEdit && onDividersChange && (
                <line
                  x1={sx}
                  y1={0}
                  x2={sx}
                  y2={effHeight}
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: 'col-resize' }}
                  onMouseDown={(e) => onDividerDown(e, d)}
                  onMouseEnter={() => setHoverDividerId(d.id)}
                  onMouseLeave={() => setHoverDividerId(null)}
                />
              )}
            </g>
          );
        })}

        <g transform={`matrix(${view.scale} 0 0 ${view.scale} ${view.tx} ${view.ty})`}>
          {edges.map(({ parent, child }) => {
            const p = nodePos(parent);
            const c = nodePos(child);
            const color = edgeColor ? edgeColor(parent, child) : 'var(--lui-accent)';
            const isHover = hoverEdge !== null && hoverEdge.parent === parent.id && hoverEdge.child === child.id;
            return (
              <EdgePath
                key={`${parent.id}-${child.id}`}
                fromX={p.x + nodeWidth}
                fromY={p.y + nodeHeight / 2}
                toX={c.x}
                toY={c.y + nodeHeight / 2}
                color={color}
                isHover={isHover}
                canEdit={canEdit}
                onHover={(h) => setHoverEdge(h ? { parent: parent.id, child: child.id } : null)}
                onDelete={() => onDisconnect(parent.id, child.id)}
              />
            );
          })}

          {pending && pendingNode && (
            <PendingEdge
              fromX={nodePos(pendingNode).x + nodeWidth}
              fromY={nodePos(pendingNode).y + nodeHeight / 2}
              toX={pending.wx}
              toY={pending.wy}
            />
          )}

          {nodes.map((n) => {
            const pos = nodePos(n);
            const selected = selectedIds.has(n.id);
            const hover = n.id === hoverNodeId;
            return (
              <g
                key={n.id}
                transform={`translate(${pos.x} ${pos.y})`}
                onMouseDown={(e) => onNodeDown(e, n)}
                onMouseEnter={() => setHoverNodeId(n.id)}
                onMouseLeave={() => setHoverNodeId(null)}
                style={{ cursor: canEdit ? 'grab' : 'pointer' }}
              >
                <foreignObject width={nodeWidth} height={nodeHeight} style={{ pointerEvents: 'none' }}>
                  <div style={{ width: nodeWidth, height: nodeHeight, pointerEvents: 'auto' }}>
                    {renderNode({ node: n, width: nodeWidth, height: nodeHeight, selected, hover })}
                  </div>
                </foreignObject>
                {canEdit && (hover || selected) && (
                  <g transform={`translate(${nodeWidth} ${nodeHeight / 2})`} onMouseDown={(e) => onPortDown(e, n)} style={{ cursor: 'crosshair' }}>
                    <circle r={10} fill="transparent" />
                    <circle r={6} fill="var(--lui-accent)" stroke="white" strokeWidth={1.5} />
                    <PlusGlyph />
                  </g>
                )}
                {canEdit && (hover || selected) && (
                  <circle cx={0} cy={nodeHeight / 2} r={4} fill="var(--lui-surface)" stroke="var(--lui-muted)" strokeWidth={1} />
                )}
              </g>
            );
          })}

          {marquee && (
            <rect
              x={Math.min(marquee.x0, marquee.x1)}
              y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)}
              height={Math.abs(marquee.y1 - marquee.y0)}
              fill="var(--lui-accent)"
              fillOpacity={0.08}
              stroke="var(--lui-accent)"
              strokeWidth={1 / view.scale}
              strokeDasharray={`${4 / view.scale} ${3 / view.scale}`}
              pointerEvents="none"
            />
          )}
        </g>
      </svg>

      {(dividers ?? []).map((d) => {
        const sx = divX(d) * view.scale + view.tx;
        const hovering = hoverDividerId === d.id;
        const renaming = renamingDividerId === d.id;
        return (
          <div
            key={`divlabel-${d.id}`}
            className="absolute z-[4] flex items-center"
            style={{ left: sx, top: 52, transform: 'translateX(-50%)' }}
            onMouseEnter={() => setHoverDividerId(d.id)}
            onMouseLeave={() => setHoverDividerId(null)}
          >
            {renaming ? (
              <input
                autoFocus
                value={dividerDraft}
                onChange={(e) => setDividerDraft(e.target.value)}
                onBlur={commitDividerRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitDividerRename();
                  if (e.key === 'Escape') setRenamingDividerId(null);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-20 border border-[var(--lui-accent)] bg-[var(--lui-surface)] px-1.5 py-0.5 text-center text-[11px] font-bold text-[var(--lui-text)] outline-none"
              />
            ) : (
              <div
                onMouseDown={(e) => onDividerDown(e, d)}
                onDoubleClick={() => startDividerRename(d)}
                title={canEdit && onDividersChange ? 'Drag to move this boundary · double-click to rename' : d.label}
                className="flex items-center gap-1.5 whitespace-nowrap border border-[var(--lui-accent)] px-2 py-0.5 text-[11px] font-bold tracking-[0.04em]"
                style={{
                  background: hovering ? 'var(--lui-accent)' : 'var(--lui-surface)',
                  color: hovering ? 'white' : 'var(--lui-accent)',
                  cursor: canEdit && onDividersChange ? 'col-resize' : 'default',
                }}
              >
                {d.label}
                {hovering && canEdit && onDividersChange && (
                  <span
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      deleteDivider(d);
                    }}
                    title="Remove this divider"
                    style={{ cursor: 'pointer', fontWeight: 400, lineHeight: 1 }}
                  >
                    ×
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {mm && nodes.length > 0 && (() => {
        const svgRect = svgRef.current?.getBoundingClientRect();
        const vx0 = (0 - view.tx) / view.scale;
        const vy0 = (0 - view.ty) / view.scale;
        const vx1 = ((svgRect?.width ?? 0) - view.tx) / view.scale;
        const vy1 = ((svgRect?.height ?? 0) - view.ty) / view.scale;
        return (
          <div
            className="absolute bottom-2 right-2 z-[5] border border-[var(--lui-border)] bg-[var(--lui-surface)] opacity-90"
            title="Minimap — click or drag to move the view"
          >
            <svg ref={mmSvgRef} width={MM_W} height={MM_H} onMouseDown={onMinimapDown} style={{ display: 'block', cursor: 'pointer' }}>
              {edges.map(({ parent, child }) => {
                const pp = nodePos(parent);
                const cp = nodePos(child);
                return (
                  <line
                    key={`mm-${parent.id}-${child.id}`}
                    x1={(pp.x + nodeWidth - mm.minX) * mm.scale + mm.ox}
                    y1={(pp.y + nodeHeight / 2 - mm.minY) * mm.scale + mm.oy}
                    x2={(cp.x - mm.minX) * mm.scale + mm.ox}
                    y2={(cp.y + nodeHeight / 2 - mm.minY) * mm.scale + mm.oy}
                    stroke="var(--lui-border)"
                    strokeWidth={1}
                  />
                );
              })}
              {nodes.map((n) => {
                const np = nodePos(n);
                return (
                  <rect
                    key={`mm-${n.id}`}
                    x={(np.x - mm.minX) * mm.scale + mm.ox}
                    y={(np.y - mm.minY) * mm.scale + mm.oy}
                    width={Math.max(3, nodeWidth * mm.scale)}
                    height={Math.max(2, nodeHeight * mm.scale)}
                    fill={selectedIds.has(n.id) ? 'var(--lui-accent)' : 'var(--lui-muted)'}
                  />
                );
              })}
              {svgRect && (
                <rect
                  x={(vx0 - mm.minX) * mm.scale + mm.ox}
                  y={(vy0 - mm.minY) * mm.scale + mm.oy}
                  width={Math.max(4, (vx1 - vx0) * mm.scale)}
                  height={Math.max(4, (vy1 - vy0) * mm.scale)}
                  fill="var(--lui-accent)"
                  fillOpacity={0.12}
                  stroke="var(--lui-accent)"
                  strokeWidth={1}
                />
              )}
            </svg>
          </div>
        );
      })()}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function zoomToCenter(
  v: { tx: number; ty: number; scale: number },
  factor: number,
  svg: SVGSVGElement | null,
): { tx: number; ty: number; scale: number } {
  if (!svg) return v;
  const r = svg.getBoundingClientRect();
  const sx = r.width / 2;
  const sy = r.height / 2;
  const wx = (sx - v.tx) / v.scale;
  const wy = (sy - v.ty) / v.scale;
  const newScale = clamp(v.scale * factor, 0.15, 3);
  return { scale: newScale, tx: sx - wx * newScale, ty: sy - wy * newScale };
}

function findNodeAt<T extends GraphNode>(nodes: T[], wx: number, wy: number, w: number, h: number): T | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n === undefined) continue;
    if (wx >= n.x && wx <= n.x + w && wy >= n.y && wy <= n.y + h) return n;
  }
  return null;
}

function PlusGlyph(): React.JSX.Element {
  return (
    <g pointerEvents="none">
      <line x1={-3} y1={0} x2={3} y2={0} stroke="white" strokeWidth={1.5} strokeLinecap="round" />
      <line x1={0} y1={-3} x2={0} y2={3} stroke="white" strokeWidth={1.5} strokeLinecap="round" />
    </g>
  );
}

function EdgePath({
  fromX,
  fromY,
  toX,
  toY,
  color,
  isHover,
  canEdit,
  onHover,
  onDelete,
}: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  isHover: boolean;
  canEdit: boolean;
  onHover: (h: boolean) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const dx = Math.max(40, Math.abs(toX - fromX) * 0.5);
  const path = `M ${fromX} ${fromY} C ${fromX + dx} ${fromY} ${toX - dx} ${toY} ${toX} ${toY}`;
  const c1x = fromX + dx;
  const c2x = toX - dx;
  const t = 0.5;
  const mx = (1 - t) ** 3 * fromX + 3 * (1 - t) ** 2 * t * c1x + 3 * (1 - t) * t * t * c2x + t ** 3 * toX;
  const my = (1 - t) ** 3 * fromY + 3 * (1 - t) ** 2 * t * fromY + 3 * (1 - t) * t * t * toY + t ** 3 * toY;
  return (
    <g onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} style={{ color }}>
      <path d={path} fill="none" stroke="transparent" strokeWidth={14} />
      <path d={path} fill="none" stroke={color} strokeWidth={isHover ? 2.6 : 1.8} markerEnd="url(#ng-arrowhead)" />
      {isHover && canEdit && (
        <g
          transform={`translate(${mx} ${my})`}
          onMouseDown={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{ cursor: 'pointer' }}
        >
          <circle r={10} fill={ERROR_COLOR} stroke="white" strokeWidth={1.5} />
          <g pointerEvents="none">
            <line x1={-4} y1={-4} x2={4} y2={4} stroke="white" strokeWidth={1.5} strokeLinecap="round" />
            <line x1={-4} y1={4} x2={4} y2={-4} stroke="white" strokeWidth={1.5} strokeLinecap="round" />
          </g>
        </g>
      )}
    </g>
  );
}

function PendingEdge({ fromX, fromY, toX, toY }: { fromX: number; fromY: number; toX: number; toY: number }): React.JSX.Element {
  const dx = Math.max(40, Math.abs(toX - fromX) * 0.5);
  const path = `M ${fromX} ${fromY} C ${fromX + dx} ${fromY} ${toX - dx} ${toY} ${toX} ${toY}`;
  return <path d={path} fill="none" stroke="var(--lui-accent)" strokeWidth={1.8} strokeDasharray="6 5" pointerEvents="none" />;
}
