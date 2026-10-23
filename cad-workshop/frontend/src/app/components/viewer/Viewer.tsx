/**
 * The model view: the three.js engine (loaded lazily) with the floating
 * pieces around it. Top left holds the open tool or the sketch palette; drag
 * handles carry value boxes you can type into; a left drag draws a selection
 * box; the bar at the bottom holds what clicks select, the standard views,
 * fit, projection, see-through, a section plane and full screen. The
 * readout at the bottom left names what is under the pointer.
 */
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { Box, ChevronDown, Eye, Focus, Maximize2, Minimize2, MousePointer2, Scissors, Square, Spline as EdgeIcon, TriangleAlert } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { area, length } from '../../lib/format.ts';
import type { Unit } from '../../lib/format.ts';
import { featureTitle, keyLabel } from '../../lib/keys.ts';
import { onThemeColors, viewportPalette } from '../../lib/themeColors.ts';
import type { BodySlot, Json, Topology } from '../../lib/types.ts';
import { fromText } from '../../lib/expr.ts';
import { Popover, menuItem } from '../ui.tsx';
import type { ToolHandle } from '../workspace/tools.ts';
import type { CadViewer, GhostSpec, Navigation, Pick, PickFilter, Projection, SectionAxis, SketchOverlay, SketchPointer, SketchShow, StdView } from './engine.ts';
import type { Frame, P2, P3 } from './overlays.ts';
import type { ViewData } from './viewbin.ts';

export interface ViewerHandle {
  view: (v: StdView) => void;
  fit: () => void;
  zoomTo: (keys: string[]) => void;
  project: (p: P3) => { x: number; y: number } | null;
  planePoint: (x: number, y: number) => P2 | null;
  pixelAt: (p: P3) => number;
  sketchStep: () => number;
  lookAlong: (normal: P3, up: P3 | null, target: P3 | null) => void;
  setSketchOverlay: (o: SketchOverlay | null) => void;
  /** Run after every frame drawn (to pin HTML labels to the model); returns the unsubscribe. */
  onRender: (cb: () => void) => () => void;
}

export interface MeasureMark {
  from: [number, number, number];
  to: [number, number, number];
  label: string;
}

export interface ViewerProps {
  data: ViewData | null;
  topo: Topology | null;
  slot: BodySlot;
  selection: string[];
  marked: string[];
  filter: PickFilter;
  onFilter: (f: PickFilter) => void;
  navigation: Navigation;
  projection: Projection;
  onProjection: (p: Projection) => void;
  grid: boolean;
  unit: Unit;
  measure: MeasureMark | null;
  compare: { added: ViewData | null; removed: ViewData | null } | null;
  hidden: string[];
  xray: boolean;
  onXray: (on: boolean) => void;
  handles: ToolHandle[];
  ghost: GhostSpec;
  sketches: SketchShow[];
  originPlanes: boolean;
  sketchFrame: Frame | null;
  pickModel: boolean;
  /** CSS cursor while sketching. */
  cursor?: string | undefined;
  onPick: (pick: Pick | null, additive: boolean) => void;
  onBoxSelect: (picks: Pick[], additive: boolean) => void;
  onContext: (pick: Pick | null, client: { x: number; y: number }) => void;
  onDoubleClick: (pick: Pick | null) => void;
  onHandle: (id: string, phase: 'start' | 'move' | 'end', value: number | P3) => void;
  onHandleType: (id: string, value: Json) => void;
  onSketchPointer: (ev: SketchPointer) => void;
  /** Keep the camera where it is when the model changes (edits); reset it for a new part. */
  keepCamera: boolean;
  /** Top left: the open tool or the sketch palette. */
  panel?: ReactNode;
  /** Labels pinned to the sketch plane. */
  labels?: ReactNode;
  /** Shown over the model, top center (build state, preview). */
  badge?: ReactNode;
  empty?: ReactNode;
  handle?: Ref<ViewerHandle>;
  className?: string;
}

const VIEWS: { v: StdView; label: string }[] = [
  { v: 'iso', label: 'Home (isometric)' },
  { v: 'front', label: 'Front' },
  { v: 'back', label: 'Back' },
  { v: 'left', label: 'Left' },
  { v: 'right', label: 'Right' },
  { v: 'top', label: 'Top' },
  { v: 'bottom', label: 'Bottom' },
];

const BAR = 'flex items-center gap-0.5 rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] p-0.5 shadow-[var(--cw-shadow-sm)]';

function ToolButton({ on = false, label, onClick, children }: { on?: boolean; label: string; onClick: () => void; children: ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-[var(--cw-r-sm)] px-1 text-[12px] font-semibold transition-colors',
        on ? 'cw-on-ink bg-[var(--cw-ink)] text-[var(--cw-shell)]' : 'text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]',
      )}
    >
      {children}
    </button>
  );
}

const Sep = (): React.JSX.Element => <span className="mx-0.5 h-4 w-px bg-[var(--cw-line)]" />;

export function Viewer(props: ViewerProps): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const measureEl = useRef<HTMLDivElement | null>(null);
  const engine = useRef<CadViewer | null>(null);
  const subs = useRef(new Set<() => void>());
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [hover, setHover] = useState<Pick | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [boxRect, setBoxRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [section, setSection] = useState<{ axis: SectionAxis; offset: number; flip: boolean } | null>(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewsBtn = useRef<HTMLButtonElement | null>(null);
  const cbs = useRef(props);
  cbs.current = props;

  useImperativeHandle(props.handle, () => ({
    view: (v) => engine.current?.view(v),
    fit: () => engine.current?.fit(),
    zoomTo: (keys) => engine.current?.zoomTo(keys),
    project: (p) => engine.current?.project(p) ?? null,
    planePoint: (x, y) => engine.current?.planePoint(x, y) ?? null,
    pixelAt: (p) => engine.current?.pixelAt(p) ?? 0.1,
    sketchStep: () => engine.current?.sketchStep() ?? 5,
    lookAlong: (n, up, t) => engine.current?.lookAlong(n, up, t),
    setSketchOverlay: (o) => engine.current?.setSketchOverlay(o),
    onRender: (cb) => {
      subs.current.add(cb);
      return () => subs.current.delete(cb);
    },
  }));

  const placeMeasure = useCallback((): void => {
    const el = measureEl.current;
    const v = engine.current;
    const m = cbs.current.measure;
    if (el === null || v === null || m === null) return;
    const p = v.project([(m.from[0] + m.to[0]) / 2, (m.from[1] + m.to[1]) / 2, (m.from[2] + m.to[2]) / 2]);
    if (p === null) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -130%)`;
  }, []);

  // Create the engine once.
  useEffect(() => {
    let alive = true;
    let off: (() => void) | null = null;
    import('./engine.ts')
      .then((mod) => {
        if (!alive || host.current === null) return;
        try {
          const v = new mod.CadViewer(host.current, viewportPalette(), {
            onHover: (p) => setHover(p),
            onPick: (p, add) => cbs.current.onPick(p, add),
            onBoxSelect: (picks, add) => cbs.current.onBoxSelect(picks, add),
            onBoxRect: (r) => setBoxRect(r),
            onContext: (p, c) => cbs.current.onContext(p, c),
            onDoubleClick: (p) => cbs.current.onDoubleClick(p),
            onHandle: (id, phase, value) => cbs.current.onHandle(id, phase, value),
            onSketchPointer: (ev) => cbs.current.onSketchPointer(ev),
            onRender: () => {
              placeMeasure();
              for (const cb of subs.current) cb();
            },
          });
          engine.current = v;
          off = onThemeColors(() => v.setPalette(viewportPalette()));
          setState('ready');
        } catch {
          setState('failed');
        }
      })
      .catch(() => setState('failed'));
    return () => {
      alive = false;
      off?.();
      engine.current?.dispose();
      engine.current = null;
    };
  }, [placeMeasure]);

  const v = engine.current;
  useEffect(() => {
    if (v === null) return;
    if (props.data !== null && props.topo !== null) v.setModel(props.data, props.topo, props.keepCamera);
    else v.clearModel();
    // Only a new mesh resets the model; colors and options follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, props.data, props.topo]);
  useEffect(() => v?.setBodySlot(props.slot), [v, props.slot]);
  useEffect(() => v?.setSelection(props.selection), [v, props.selection, props.data]);
  useEffect(() => v?.setMarked(props.marked), [v, props.marked, props.data]);
  useEffect(() => v?.setFilter(props.filter), [v, props.filter]);
  useEffect(() => v?.setNavigation(props.navigation), [v, props.navigation]);
  useEffect(() => v?.setProjection(props.projection), [v, props.projection]);
  useEffect(() => v?.setGrid(props.grid), [v, props.grid]);
  useEffect(() => v?.setHidden(props.hidden), [v, props.hidden, props.data]);
  useEffect(() => v?.setXray(props.xray), [v, props.xray, props.data]);
  useEffect(() => v?.setGhost(props.ghost), [v, props.ghost, props.data]);
  useEffect(() => v?.setSketches(props.sketches), [v, props.sketches]);
  useEffect(() => v?.setOriginPlanes(props.originPlanes), [v, props.originPlanes, props.data]);
  useEffect(() => v?.setSketchMode(props.sketchFrame), [v, props.sketchFrame]);
  useEffect(() => v?.setPickModel(props.pickModel), [v, props.pickModel]);
  useEffect(() => v?.setHandles(props.handles.map((h) => h.spec)), [v, props.handles]);
  useEffect(() => {
    if (v === null) return;
    v.setMeasure(props.measure?.from ?? null, props.measure?.to ?? null);
  }, [v, props.measure]);
  useEffect(() => {
    if (v === null) return;
    v.setCompare(props.compare?.added ?? null, props.compare?.removed ?? null);
  }, [v, props.compare]);
  useEffect(() => {
    if (v === null) return;
    v.setSection(section?.axis ?? null, section?.offset ?? 0, section?.flip ?? false);
  }, [v, section, props.data]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.querySelector('[role="dialog"]') === null) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const extent = v !== null && section !== null ? v.extent(section.axis) : ([0, 1] as [number, number]);
  const startSection = (axis: SectionAxis): void => {
    if (v === null) return;
    const [lo, hi] = v.extent(axis);
    setSection({ axis, offset: (lo + hi) / 2, flip: false });
  };
  const sketching = props.sketchFrame !== null;
  const hoverText = describe(hover, props.topo, props.unit);

  return (
    <div className={cn('relative flex min-h-0 flex-col overflow-hidden bg-[var(--cw-stage)]', expanded && 'fixed inset-0 z-[55]', props.className)}>
      <div ref={host} className="cw-viewport absolute inset-0" style={props.cursor !== undefined ? { cursor: props.cursor } : undefined} />
      {state === 'failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[var(--cw-on-stage)]">
          <TriangleAlert size={22} aria-hidden />
          <p className="text-[13px] font-bold">This browser cannot show 3D here</p>
          <p className="max-w-sm text-[12px] text-[var(--cw-on-stage-muted)]">WebGL is off or unavailable. The part still builds, measures and exports.</p>
        </div>
      )}
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span aria-label="Loading the viewer" className="size-5 animate-spin rounded-full border-2 border-[var(--cw-on-stage)] border-t-transparent" />
        </div>
      )}
      {state === 'ready' && props.data === null && !sketching && !props.originPlanes && props.empty !== undefined && <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 [&>*]:pointer-events-auto">{props.empty}</div>}

      {props.labels}
      {state === 'ready' && <HandleLabels engine={engine} subs={subs} handles={props.handles} onType={props.onHandleType} />}

      {boxRect !== null && (
        <div className="pointer-events-none absolute border border-dashed border-[var(--cw-on-stage)] bg-[var(--cw-on-stage)]/8" style={{ left: boxRect.x, top: boxRect.y, width: boxRect.w, height: boxRect.h }} />
      )}

      {/* Top left: the open tool or the sketch palette. */}
      {props.panel !== undefined && props.panel !== null && <div className="pointer-events-none absolute bottom-12 left-2 top-2 flex flex-col items-start">{props.panel}</div>}

      {/* Bottom center: selection, views and display. */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-col items-center gap-1.5">
        {section !== null && (
          <div className="pointer-events-auto flex w-[min(300px,calc(100vw-48px))] items-center gap-1.5 rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] px-1.5 py-1 shadow-[var(--cw-shadow)]">
            <div className="flex gap-0.5" role="radiogroup" aria-label="Section axis">
              {(['x', 'y', 'z'] as SectionAxis[]).map((a) => (
                <ToolButton key={a} on={section.axis === a} label={'Cut across ' + a.toUpperCase()} onClick={() => startSection(a)}>
                  {a.toUpperCase()}
                </ToolButton>
              ))}
            </div>
            <input
              type="range"
              className="cw-range min-w-0 flex-1"
              aria-label="Section position"
              min={extent[0]}
              max={extent[1]}
              step={(extent[1] - extent[0]) / 400 || 0.1}
              value={section.offset}
              onChange={(e) => setSection({ ...section, offset: Number(e.target.value) })}
            />
            <span className="num w-14 text-right text-[12px] text-[var(--cw-muted)]">{section.offset.toFixed(1)}</span>
            <ToolButton on={section.flip} label="Keep the other side" onClick={() => setSection({ ...section, flip: !section.flip })}>
              Flip
            </ToolButton>
          </div>
        )}
        <div className={cn(BAR, 'pointer-events-auto max-w-full flex-wrap justify-center')}>
          {!sketching && (
            <>
              <div className="flex gap-0.5" role="radiogroup" aria-label="What clicks select">
                <ToolButton on={props.filter === 'any'} label="Select faces and edges" onClick={() => props.onFilter('any')}>
                  <MousePointer2 size={14} aria-hidden />
                </ToolButton>
                <ToolButton on={props.filter === 'faces'} label="Select faces only" onClick={() => props.onFilter('faces')}>
                  <Square size={14} aria-hidden />
                </ToolButton>
                <ToolButton on={props.filter === 'edges'} label="Select edges only" onClick={() => props.onFilter('edges')}>
                  <EdgeIcon size={14} aria-hidden />
                </ToolButton>
              </div>
              <Sep />
            </>
          )}
          <ToolButton label="Fit (F)" onClick={() => engine.current?.fit()}>
            <Focus size={14} aria-hidden />
          </ToolButton>
          <div className="relative">
            <button ref={viewsBtn} type="button" aria-label="Views" title="Views" aria-expanded={viewsOpen} onClick={() => setViewsOpen((o) => !o)} className="inline-flex h-6 items-center gap-0.5 rounded-[var(--cw-r-sm)] px-1.5 text-[12px] font-semibold text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)] hover:text-[var(--cw-ink)]">
              Views <ChevronDown size={12} aria-hidden />
            </button>
            <Popover open={viewsOpen} onClose={() => setViewsOpen(false)} align="left" keep={viewsBtn} className="bottom-8 top-auto w-44">
              {VIEWS.map((x) => (
                <button
                  key={x.v}
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setViewsOpen(false);
                    engine.current?.view(x.v);
                  }}
                >
                  {x.label}
                </button>
              ))}
            </Popover>
          </div>
          <Sep />
          <ToolButton on={props.projection === 'orthographic'} label={props.projection === 'orthographic' ? 'Orthographic' : 'Perspective'} onClick={() => props.onProjection(props.projection === 'orthographic' ? 'perspective' : 'orthographic')}>
            <Box size={14} aria-hidden />
          </ToolButton>
          {!sketching && (
            <ToolButton on={props.xray} label="See through" onClick={() => props.onXray(!props.xray)}>
              <Eye size={14} aria-hidden />
            </ToolButton>
          )}
          <ToolButton on={section !== null} label="Section view" onClick={() => (section === null ? startSection('z') : setSection(null))}>
            <Scissors size={14} aria-hidden />
          </ToolButton>
          <Sep />
          <ToolButton label={expanded ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setExpanded((x) => !x)}>
            {expanded ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
          </ToolButton>
        </div>
      </div>

      {/* Bottom left: what is under the pointer. */}
      {hoverText !== null && !sketching && (
        <div className="pointer-events-none absolute bottom-11 left-2 hidden max-w-[min(320px,calc(100%-16px))] rounded-[var(--cw-r)] border border-[var(--cw-line)] bg-[var(--cw-card)] px-2 py-1 shadow-[var(--cw-shadow-sm)] sm:block">
          <p className="truncate text-[12px] font-semibold">{hoverText.title}</p>
          {hoverText.detail !== '' && <p className="num truncate text-[12px] text-[var(--cw-muted)]">{hoverText.detail}</p>}
        </div>
      )}

      {props.measure !== null && (
        <div ref={measureEl} className="num pointer-events-none absolute left-0 top-0 rounded-[var(--cw-r)] bg-[var(--cw-ink)] px-2 py-0.5 text-[12px] font-bold text-[var(--cw-shell)] shadow-[var(--cw-shadow)]" style={{ display: 'none' }}>
          {props.measure.label}
        </div>
      )}

      {props.badge !== undefined && <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 [&>*]:pointer-events-auto">{props.badge}</div>}
    </div>
  );
}

/** What the hover readout says about a pick. */
function describe(p: Pick | null, topo: Topology | null, unit: Unit): { title: string; detail: string } | null {
  if (p === null) return null;
  if (p.kind === 'plane') return { title: (p.plane ?? '') + ' plane', detail: 'Click to sketch on it' };
  if (p.kind === 'profile') return { title: 'Profile ' + (p.item ?? '') + ' of ' + featureTitle(p.sketch ?? ''), detail: '' };
  if (topo === null) return null;
  const info = p.kind === 'face' ? topo.faces.find((f) => f.key === p.key) : topo.edges.find((e) => e.key === p.key);
  if (info === undefined) return null;
  const parts: string[] = [info.type];
  if ('area' in info) parts.push(area(info.area, unit));
  if ('length' in info) parts.push(length(info.length, unit));
  if (info.radius !== undefined) parts.push('r ' + length(info.radius, unit));
  return { title: keyLabel(p.key), detail: parts.join(' · ') };
}

/** Value boxes beside the drag handles: they follow the handles and take a typed value. */
function HandleLabels({ engine, subs, handles, onType }: { engine: React.RefObject<CadViewer | null>; subs: React.RefObject<Set<() => void>>; handles: ToolHandle[]; onType: (id: string, value: Json) => void }): React.JSX.Element {
  const els = useRef(new Map<string, HTMLDivElement>());
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const place = useCallback((): void => {
    const v = engine.current;
    if (v === null) return;
    const at = new Map(v.handleLabels().map((l) => [l.id, l]));
    for (const [id, el] of els.current) {
      const p = at.get(id);
      if (p === undefined) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      const beside = el.dataset['point'] === '1';
      el.style.transform = `translate(${Math.round(p.x + (beside ? 16 : 0))}px, ${Math.round(p.y - (beside ? 16 : 0))}px) translate(${beside ? '0' : '-50%'}, -50%)`;
    }
  }, [engine]);
  useLayoutEffect(place);
  useEffect(() => {
    const set = subs.current;
    set.add(place);
    return () => {
      set.delete(place);
    };
  }, [subs, place]);
  const labelled = handles.filter((h) => h.label !== undefined);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {labelled.map((h) => (
        <div
          key={h.spec.id}
          ref={(el) => {
            if (el === null) els.current.delete(h.spec.id);
            else els.current.set(h.spec.id, el);
          }}
          className="absolute left-0 top-0"
          data-point={h.spec.kind === 'point' ? '1' : '0'}
          style={{ display: 'none' }}
        >
          {editing === h.spec.id ? (
            <input
              autoFocus
              aria-label="Value"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => setEditing(null)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  const v = fromText(text);
                  if (v !== null) onType(h.spec.id, v as Json);
                  setEditing(null);
                }
                if (e.key === 'Escape') setEditing(null);
              }}
              className="num pointer-events-auto h-6 w-20 rounded-[var(--cw-r-sm)] border border-[var(--cw-accent-text)] bg-[var(--cw-card)] px-1 text-center text-[12px] text-[var(--cw-ink)] shadow-[var(--cw-shadow)] outline-none"
              spellCheck={false}
            />
          ) : (
            <button
              type="button"
              title="Click to type a value"
              onClick={() => {
                setText(h.label ?? '');
                setEditing(h.spec.id);
              }}
              className="num pointer-events-auto inline-flex h-5 items-center gap-0.5 whitespace-nowrap rounded-[var(--cw-r-sm)] border border-[var(--cw-line)] bg-[var(--cw-card)] px-1 text-[12px] font-semibold text-[var(--cw-ink)] shadow-[var(--cw-shadow-sm)] hover:border-[var(--cw-ink)]"
            >
              {h.label}
              {h.unit !== undefined && h.unit !== '' && <span className="font-normal text-[var(--cw-muted)]">{h.unit}</span>}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
