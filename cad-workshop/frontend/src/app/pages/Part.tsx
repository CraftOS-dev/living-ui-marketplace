/**
 * The part workspace, laid out as desktop CAD: the toolbar across the top,
 * the feature tree on the left, the model in the middle and the panels on
 * the right (selection, part, checks, history, your AI agent). A tool opens
 * as a small dialog over the model: clicks in the view fill it, handles on
 * the model drag its values, and the model previews the result live; OK
 * makes it one change in the history. A sketch is drawn right on its plane.
 * Everything here is an operation your AI agent can run too; what it
 * changes appears here live.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Diff,
  Ellipsis,
  Eye,
  EyeOff,
  FileDown,
  Focus,
  Home as HomeIcon,
  Link2,
  Pencil,
  Pin,
  PinOff,
  Redo2,
  ScanEye,
  Search,
  SquareStack,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { setupActive } from '../components/EngineSetup.tsx';
import { STARTERS } from '../components/NewPart.tsx';
import { Badge, ButtonGroup, IconButton, Popover, Spinner, Tabs, errMessage, inputCls, menuItem, useConfirm } from '../components/ui.tsx';
import type { Tone } from '../components/ui.tsx';
import { parseView } from '../components/viewer/viewbin.ts';
import type { ViewData } from '../components/viewer/viewbin.ts';
import { Viewer } from '../components/viewer/Viewer.tsx';
import type { MeasureMark, ViewerHandle } from '../components/viewer/Viewer.tsx';
import type { BasePlane, Pick, PickFilter, Projection, SketchShow } from '../components/viewer/engine.ts';
import { BASE_FRAMES } from '../components/viewer/frames.ts';
import type { Frame, P3 } from '../components/viewer/frames.ts';
import { AddFeature } from '../components/workspace/AddFeature.tsx';
import { AgentPanel } from '../components/workspace/AgentPanel.tsx';
import { ContextMenu } from '../components/workspace/ContextMenu.tsx';
import type { MenuEntry } from '../components/workspace/ContextMenu.tsx';
import { ExportDialog } from '../components/workspace/ExportDialog.tsx';
import type { FormContext } from '../components/workspace/fields.tsx';
import { ChecksPanel, HistoryPanel, PartPanel, SelectionPanel } from '../components/workspace/Panels.tsx';
import { useSketchSession } from '../components/workspace/SketchMode.tsx';
import type { SketchTarget } from '../components/workspace/SketchMode.tsx';
import { ToolDialog, missingFields } from '../components/workspace/ToolDialog.tsx';
import type { PreviewState, ToolState } from '../components/workspace/ToolDialog.tsx';
import { Toolbar } from '../components/workspace/Toolbar.tsx';
import type { ToolId } from '../components/workspace/Toolbar.tsx';
import { TOOLS, boundaryEdges, defaultsFor, dragTo, keysRef, patternPick, pickInto, pickWhatOf, pickable, refKeys, similar, tangentChain, toggleProfile, toolGhost, toolHandles, toolReady, typeAt, usedProfiles } from '../components/workspace/tools.ts';
import type { PickWhat, StartFrom, ToolCtx } from '../components/workspace/tools.ts';
import { Tree } from '../components/workspace/Tree.tsx';
import { api, fetchBinary, fetchJson } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { length, mass, ms, num, volume } from '../lib/format.ts';
import { creatorOf, edgeLabel, faceLabel, featureTitle, keyFeatures } from '../lib/keys.ts';
import { useLive } from '../lib/live.ts';
import { back, navigate } from '../lib/router.ts';
import { regions } from '../lib/sketchGeom.ts';
import type { Item } from '../lib/sketchGeom.ts';
import { iconByName } from '../lib/icons.ts';
import { rgbCss, useViewportPalette } from '../lib/themeColors.ts';
import type { Batch, Feature, FeatureKind, Json, KindDef, MeasureResult, Params, PartDetail, Topology } from '../lib/types.ts';

/* ------------------------------------------------------------ model data */

interface Loaded {
  data: ViewData;
  topo: Topology;
}

const cache = new Map<string, Promise<Loaded>>();

function load(view: string, topo: string): Promise<Loaded> {
  const key = view + '|' + topo;
  let p = cache.get(key);
  if (p === undefined) {
    p = Promise.all([fetchBinary(view), fetchJson<Topology>(topo)]).then(([buf, t]) => ({ data: parseView(buf), topo: t }));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 24) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
  }
  return p;
}

function useModel(view: string, topo: string): { model: Loaded | null; error: string | null } {
  const [model, setModel] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (view === '' || topo === '') {
      setModel(null);
      return;
    }
    let alive = true;
    load(view, topo)
      .then((m) => {
        if (alive) {
          setModel(m);
          setError(null);
        }
      })
      .catch((err: unknown) => alive && setError(errMessage(err)));
    return () => {
      alive = false;
    };
  }, [view, topo]);
  return { model, error };
}

/* --------------------------------------------------------------- helpers */

/** settingUp: the engine's first-run download is on its way, so queued builds wait for it. */
function statusOf(d: PartDetail, settingUp: boolean): { tone: Tone; label: string; pulse: boolean } {
  const pending = d.pending_build !== null || d.part.status === 'queued' || d.part.status === 'building';
  if (pending) return { tone: 'info', label: d.part.status === 'building' ? 'Building' : settingUp ? 'Waiting for the engine setup' : 'Queued', pulse: true };
  if (d.part.status === 'empty') return { tone: 'neutral', label: 'Empty', pulse: false };
  if (d.part.status === 'failed') return { tone: 'bad', label: d.build?.error?.feature !== undefined ? featureTitle(d.build.error.feature) + ' fails' : 'Build failed', pulse: false };
  if (d.part.status === 'warning') return { tone: 'warn', label: 'Built with warnings', pulse: false };
  return { tone: 'good', label: 'Built' + (d.build !== null ? ' in ' + ms(d.build.ms) : ''), pulse: false };
}

/** Every face and edge key a params object picks (to light them up while a tool is open). */
function pickedKeys(v: Json | undefined, out: string[] = []): string[] {
  if (v === null || v === undefined || typeof v !== 'object') return out;
  if (Array.isArray(v)) {
    for (const x of v) pickedKeys(x, out);
    return out;
  }
  for (const k of ['faces', 'edges'] as const) {
    const keys = refKeys(v, k);
    if (keys !== null) out.push(...keys);
  }
  for (const x of Object.values(v)) pickedKeys(x, out);
  return out;
}

/** What a pick field at a path accepts. */
function pickWhatAt(def: KindDef, path: string): PickWhat | null {
  const parts = path.split('.');
  const top = def.fields.find((f) => f.key === parts[0]);
  if (top === undefined) return null;
  if (parts.length === 1) return pickWhatOf(top.type);
  if (top.type === 'object') {
    const sub = top.fields?.find((f) => f.key === parts[1]);
    return sub === undefined ? null : pickWhatOf(sub.type);
  }
  if ((top.type === 'axis' || top.type === 'direction') && parts[1] === 'edge') return 'edges';
  if (top.type === 'plane' && parts[1] === 'face') return 'face';
  return null;
}

const PRIM_PARAMS: Record<'box' | 'cylinder' | 'sphere', Params> = {
  box: { shape: 'box', size: [20, 20, 20], position: [0, 0, 0], anchor: 'bottom' },
  cylinder: { shape: 'cylinder', diameter: 20, height: 20, axis: 'Z', position: [0, 0, 0], anchor: 'bottom' },
  sphere: { shape: 'sphere', diameter: 20, position: [0, 0, 10] },
};

type Side = 'part' | 'checks' | 'history' | 'agent';

export function PartPage({ id }: { id: string }): React.JSX.Element {
  const { schema, settings, unit, status } = useApp();
  const pal = useViewportPalette();
  const live = useLive(() => api.part(id, true), ['parts', 'features', 'parameters', 'builds', 'selections', 'checks', 'exports', 'assets'], [id], 90);
  const d = live.data;
  const viewer = useRef<ViewerHandle | null>(null);

  const [selection, setSelection] = useState<string[]>([]);
  const [profileSel, setProfileSel] = useState<{ sketch: string; item: string }[]>([]);
  const [treeSel, setTreeSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<PickFilter>('any');
  const [projection, setProjection] = useState<Projection>('perspective');
  const [xray, setXray] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [hoverFeature, setHoverFeature] = useState<string | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [measure, setMeasure] = useState<MeasureMark | null>(null);
  const [compare, setCompare] = useState<{ added: ViewData | null; removed: ViewData | null; addedMm3: number; removedMm3: number } | null>(null);
  const [side, setSide] = useState<Side>('part');
  const [askKind, setAskKind] = useState<'design' | 'review' | 'repair'>('design');
  const [palette, setPalette] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [mobileTab, setMobileTab] = useState<'model' | 'tree' | 'panel'>('model');
  const [menu, setMenu] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ at: { x: number; y: number }; entries: MenuEntry[] } | null>(null);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const lastSent = useRef<string>('');
  const iconOf = (kind: FeatureKind): LucideIcon => iconByName(schema?.kinds[kind]?.icon ?? 'Box');
  const [confirmEl, confirm] = useConfirm();
  const deleteFeature = async (name: string): Promise<void> => {
    const f = d?.features.find((x) => x.name === name);
    if (f === undefined) return;
    try {
      const pv = await api.deletePreview('features', f.id);
      const users = (Array.isArray(pv['blocked_by']) ? pv['blocked_by'] : []).filter((x): x is string => typeof x === 'string');
      if (users.length > 0) {
        toast.error(users.map(featureTitle).join(', ') + ' use' + (users.length === 1 ? 's' : '') + ' ' + featureTitle(name) + '; change or delete ' + (users.length === 1 ? 'it' : 'them') + ' first');
        return;
      }
      if (!(await confirm('Delete ' + featureTitle(name) + '? You can undo it.', 'Delete feature', 'Delete'))) return;
      await api.delete('features', f.id);
      setTreeSel(null);
    } catch (err) {
      toast.error(errMessage(err));
    }
  };

  // The open tool, its live preview, and the sketch being drawn.
  const [tool, setTool] = useState<ToolState | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ busy: false, result: null, problem: null });
  const [previewFiles, setPreviewFiles] = useState<{ view: string; topo: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sketch, setSketch] = useState<SketchTarget | null>(null);
  const [planePick, setPlanePick] = useState(false);

  useEffect(() => {
    if (settings !== null) setProjection(settings.projection);
  }, [settings]);

  // Load the geometry engine now, so the first edit does not wait for it.
  useEffect(() => {
    api.runJob('engine_start').catch(() => undefined);
  }, []);

  const baseView = d?.build?.status === 'failed' && d.build.files.view === '' ? '' : (d?.build?.files.view ?? '');
  const { model: baseModel, error: modelError } = useModel(baseView, d?.build?.files.topology ?? '');
  const { model: previewModel } = useModel(previewFiles?.view ?? '', previewFiles?.topo ?? '');
  const baseTopo = baseModel?.topo ?? null;
  const ghosting = tool !== null && TOOLS[tool.kind].ghost && (dragging || previewFiles === null);
  const shownModel = tool !== null && previewFiles !== null && previewModel !== null && !(dragging && TOOLS[tool.kind].ghost) ? previewModel : baseModel;

  const env = useMemo(() => {
    const e: Record<string, number> = {};
    for (const p of d?.parameters ?? []) e[p.name] = p.value;
    return e;
  }, [d?.parameters]);

  const toolCtx: ToolCtx = useMemo(
    () => ({ topo: baseTopo, env, summary: d?.build?.summary ?? null, features: d?.features ?? [], feature: tool?.feature ?? null }),
    [baseTopo, env, d?.build?.summary, d?.features, tool?.feature],
  );

  /* ------------------------------------------------------------ selection */

  // The selection follows the server when your AI agent changes it.
  useEffect(() => {
    if (d === null) return;
    const server = d.selection.join('\n');
    if (server !== lastSent.current) {
      lastSent.current = server;
      setSelection(d.selection);
    }
  }, [d]);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeSelection = useCallback(
    (keys: string[]) => {
      setSelection(keys);
      if (syncTimer.current !== null) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        lastSent.current = keys.join('\n');
        api.setSelection(id, keys).catch(() => undefined);
      }, 250);
    },
    [id],
  );
  // Keys that no longer exist after a rebuild drop out of the selection.
  useEffect(() => {
    if (baseTopo === null || selection.length === 0) return;
    const known = new Set([...baseTopo.faces.map((f) => f.key), ...baseTopo.edges.map((e) => e.key), ...baseTopo.bodies]);
    const kept = selection.filter((k) => known.has(k));
    if (kept.length !== selection.length) changeSelection(kept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseTopo]);

  const onMeasure = useCallback(
    (m: MeasureResult | null) => {
      if (m === null || m.distance === undefined || m.b === undefined) {
        setMeasure(null);
        return;
      }
      setMeasure({ from: m.distance.from, to: m.distance.to, label: length(m.axis_distance_mm ?? m.parallel_gap_mm ?? m.distance.min_mm, unit) });
    },
    [unit],
  );

  /* ---------------------------------------------------------------- tools */

  const closeTool = useCallback(() => {
    setTool(null);
    setPreview({ busy: false, result: null, problem: null });
    setPreviewFiles(null);
    setDragging(false);
  }, []);

  const openTool = (kind: FeatureKind, params: Params, feature: Feature | null): void => {
    // The tool takes the selection over (its defaults came from it), as in desktop CAD.
    changeSelection([]);
    setProfileSel([]);
    setPreview({ busy: false, result: null, problem: null });
    setPreviewFiles(null);
    setTool({ kind, feature, params, touched: feature === null ? [] : Object.keys(params), active: TOOLS[kind].pick?.path ?? null });
    setPlanePick(false);
    setMobileTab('model');
  };

  const startSketchOn = (frame: Frame, where: string, params: Params, target: P3): void => {
    closeTool();
    changeSelection([]);
    setProfileSel([]);
    setPlanePick(false);
    setSketch({ name: null, frame, where, params, items: [] });
    viewer.current?.lookAlong(frame.normal, frame.v, target);
    setMobileTab('model');
  };
  const sketchOnFace = (key: string): boolean => {
    const f = baseTopo?.faces.find((x) => x.key === key);
    if (f?.frame === undefined) return false;
    startSketchOn(f.frame, faceLabel(key), { plane: 'face', face: keysRef('faces', [key]) ?? null }, f.center);
    return true;
  };
  const sketchOnPlane = (plane: BasePlane): void => {
    const f = BASE_FRAMES[plane];
    startSketchOn(f, plane + ' plane', { plane }, f.origin);
  };
  const editSketch = (f: Feature): void => {
    const outline = baseTopo?.sketches.find((s) => s.name === f.name);
    const { items, ...rest } = f.params;
    const list = (Array.isArray(items) ? items : []).filter((x): x is Item => x !== null && typeof x === 'object' && !Array.isArray(x));
    let frame: Frame | null = outline?.frame ?? null;
    const plane = f.params['plane'];
    const faceKey = refKeys(getFace(f.params), 'faces')?.[0];
    if (frame === null && (plane === 'XY' || plane === 'XZ' || plane === 'YZ')) frame = BASE_FRAMES[plane];
    if (frame === null && faceKey !== undefined) frame = baseTopo?.faces.find((x) => x.key === faceKey)?.frame ?? null;
    if (frame === null) {
      toast.error('The plane of ' + featureTitle(f.name) + ' is not in the model; edit it from its dialog');
      openTool('sketch', f.params, f);
      return;
    }
    closeTool();
    setSketch({ name: f.name, frame, where: faceKey !== undefined ? faceLabel(faceKey) : String(plane ?? 'XY') + ' plane', params: rest, items: list });
    viewer.current?.lookAlong(frame.normal, frame.v, frame.origin);
    setMobileTab('model');
  };

  /** Open a tool, from what is selected (or what a menu passed). */
  const startTool = (t: ToolId, from?: StartFrom): void => {
    if (d === null) return;
    const start: StartFrom = from ?? { selection, profiles: profileSel };
    if (t === 'sketch') {
      const planar = start.selection.filter((k) => baseTopo?.faces.find((f) => f.key === k)?.type === 'plane');
      if (planar.length === 1 && sketchOnFace(planar[0] as string)) return;
      closeTool();
      setPlanePick(true);
      return;
    }
    if (t === 'box' || t === 'cylinder' || t === 'sphere') {
      openTool('primitive', { ...PRIM_PARAMS[t], operation: (d.build?.summary?.bodies.length ?? 0) > 0 ? 'add' : 'new' }, null);
      return;
    }
    openTool(t, defaultsFor(t, toolCtx, start), null);
  };

  const startEdit = (f: Feature): void => {
    if (f.kind === 'sketch') editSketch(f);
    else openTool(f.kind, f.params, f);
  };

  // A live preview of the tool's result: a dry run, a moment after values stop changing.
  const seq = useRef(0);
  useEffect(() => {
    if (tool === null || schema === null) return;
    if (dragging && TOOLS[tool.kind].ghost) return;
    const mine = ++seq.current;
    if (missingFields(schema.kinds[tool.kind].fields, tool.params).length > 0 || !toolReady(tool.kind, tool.params, env)) {
      setPreview({ busy: false, result: null, problem: null });
      setPreviewFiles(null);
      return;
    }
    const t = setTimeout(
      () => {
        setPreview((p) => ({ ...p, busy: true }));
        const run = tool.feature === null ? api.addFeature(id, tool.kind, tool.params, {}, { dry_run: true, silent: true }) : api.updateFeature(id, tool.feature.name, { params: tool.params, merge: false }, { dry_run: true, silent: true });
        run
          .then(async (r) => {
            if (mine !== seq.current) return;
            let files: { view: string; topo: string } | null = null;
            if (r.error === null && r.build !== null && r.build.preview && r.build.view !== '') {
              const b = await api.build(r.build.id);
              files = { view: b.build.files.view, topo: b.build.files.topology };
            }
            if (mine !== seq.current) return;
            setPreview({ busy: false, result: r, problem: null });
            setPreviewFiles(files);
          })
          .catch((err: unknown) => {
            if (mine !== seq.current) return;
            setPreview({ busy: false, result: null, problem: errMessage(err) });
            setPreviewFiles(null);
          });
      },
      dragging ? 450 : 300,
    );
    return () => clearTimeout(t);
  }, [tool?.params, tool?.kind, tool?.feature, dragging, schema, id, env]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTool = useCallback(async (): Promise<void> => {
    if (tool === null) return;
    setApplying(true);
    try {
      const r = tool.feature === null ? await api.addFeature(id, tool.kind, tool.params, {}, { wait_s: 12 }) : await api.updateFeature(id, tool.feature.name, { params: tool.params, merge: false }, { wait_s: 12 });
      if (r.error === null && (r.status === 'applied' || r.status === 'queued' || r.status === 'unchanged')) {
        closeTool();
        changeSelection([]);
        setProfileSel([]);
        return;
      }
      setPreview({ busy: false, result: r, problem: null });
      // Kept but failing: carry on editing the feature that now exists.
      const created = r.change?.created[0];
      if (tool.feature === null && created !== undefined) {
        const fresh = await api.part(id, true);
        const f = fresh.features.find((x) => x.name === created);
        if (f !== undefined) setTool((t) => (t === null ? t : { ...t, feature: f }));
      }
    } catch (err) {
      setPreview((p) => ({ ...p, problem: errMessage(err) }));
    } finally {
      setApplying(false);
    }
  }, [tool, id, closeTool, changeSelection]);

  const updateParams = (params: Params, key: string | null): void => {
    setTool((t) => (t === null ? t : { ...t, params, touched: key !== null && !t.touched.includes(key) ? [...t.touched, key] : t.touched }));
  };

  const handles = useMemo(() => (tool === null ? [] : toolHandles(tool.kind, tool.params, toolCtx)), [tool, toolCtx]);
  const ghost = useMemo(() => (tool !== null && ghosting ? toolGhost(tool.kind, tool.params, toolCtx) : null), [tool, ghosting, toolCtx]);

  const onHandle = (hid: string, phase: 'start' | 'move' | 'end', value: number | P3): void => {
    if (phase === 'start') setDragging(true);
    if (phase === 'end') setDragging(false);
    if (phase === 'start') return;
    setTool((t) => (t === null ? t : { ...t, params: dragTo(t.kind, t.params, hid, value, toolCtx, new Set(t.touched)) }));
  };

  /* ------------------------------------------------------------ sketching */

  const finishSketch = async (params: Params): Promise<boolean> => {
    if (sketch === null) return false;
    try {
      const r = sketch.name === null ? await api.addFeature(id, 'sketch', params, {}, { wait_s: 12 }) : await api.updateFeature(id, sketch.name, { params, merge: false }, { wait_s: 12 });
      if (r.error !== null && r.status !== 'applied' && r.status !== 'queued') {
        toast.error(r.error.message);
        return false;
      }
      const wasNew = sketch.name === null;
      setSketch(null);
      const name = r.change?.created[0];
      const items = (Array.isArray(params['items']) ? params['items'] : []).filter((x): x is Item => x !== null && typeof x === 'object' && !Array.isArray(x));
      // A new sketch with a profile goes straight on to Extrude.
      if (wasNew && name !== undefined && regions(items.filter((i) => i['type'] !== 'line'), env).length > 0) {
        const onFace = params['plane'] === 'face';
        openTool('extrude', { sketch: name, extent: { type: 'distance', distance: onFace ? 5 : 10 }, operation: (d?.build?.summary?.bodies.length ?? 0) > 0 ? 'add' : 'new' }, null);
      }
      return true;
    } catch (err) {
      toast.error(errMessage(err));
      return false;
    }
  };
  const session = useSketchSession({ target: sketch, viewer, env, schema, onFinish: finishSketch, onCancel: () => setSketch(null) });

  /* -------------------------------------------------------------- picking */

  const onPick = (p: Pick | null, additive: boolean): void => {
    setCtxMenu(null);
    if (sketch !== null) return;
    if (planePick) {
      if (p?.kind === 'plane' && p.plane !== undefined) sketchOnPlane(p.plane);
      else if (p?.kind === 'face' && baseTopo?.faces[p.index]?.type === 'plane') sketchOnFace(p.key);
      return;
    }
    if (tool !== null && schema !== null) {
      if (p === null) return;
      const kind = tool.kind;
      if (p.kind === 'profile' && TOOLS[kind].pick?.what === 'profiles') {
        const s = baseTopo?.sketches.find((x) => x.name === p.sketch);
        if (s !== undefined && p.item !== undefined) updateParams(toggleProfile(tool.params, s, p.item), 'items');
        return;
      }
      if ((p.kind !== 'face' && p.kind !== 'edge') || !pickable(toolCtx, p.key)) return;
      if (tool.active === null) {
        const next = patternPick(kind, tool.params, p.key, toolCtx);
        if (next !== null) updateParams(next, p.kind === 'face' ? 'source' : kind === 'pattern_linear' ? 'direction' : 'axis');
        return;
      }
      const what = pickWhatAt(schema.kinds[kind], tool.active);
      if (what === null) return;
      const path = tool.active;
      let next: Params | null;
      if (path.endsWith('.edge')) next = p.kind === 'edge' ? setPath(tool.params, path, keysRef('edges', [p.key])) : null;
      else next = pickInto(kind, tool.params, path, what, p.key, p.point, toolCtx);
      if (next !== null) updateParams(next, path.split('.')[0] ?? path);
      return;
    }
    setTreeSel(null);
    if (p !== null && p.kind === 'profile' && p.sketch !== undefined && p.item !== undefined) {
      const hit = { sketch: p.sketch, item: p.item };
      const has = profileSel.some((x) => x.sketch === hit.sketch && x.item === hit.item);
      setProfileSel(has ? profileSel.filter((x) => !(x.sketch === hit.sketch && x.item === hit.item)) : [...profileSel, hit]);
      return;
    }
    if (p === null || p.kind === 'plane') {
      if (!additive) {
        changeSelection([]);
        setProfileSel([]);
      }
      return;
    }
    changeSelection(selection.includes(p.key) ? selection.filter((k) => k !== p.key) : [...selection, p.key]);
  };

  const onBoxSelect = (picks: Pick[], additive: boolean): void => {
    if (sketch !== null) return;
    if (tool !== null && schema !== null && tool.active !== null) {
      const what = pickWhatAt(schema.kinds[tool.kind], tool.active);
      if (what !== 'edges' && what !== 'faces') return;
      const keys = picks.filter((p) => (what === 'edges' ? p.kind === 'edge' : p.kind === 'face') && pickable(toolCtx, p.key)).map((p) => p.key);
      const cur = refKeys(getPath(tool.params, tool.active), what) ?? [];
      updateParams(setPath(tool.params, tool.active, keysRef(what, [...cur, ...keys.filter((k) => !cur.includes(k))])), tool.active.split('.')[0] ?? tool.active);
      return;
    }
    const keys = picks.map((p) => p.key);
    changeSelection(additive ? [...selection, ...keys.filter((k) => !selection.includes(k))] : keys);
    setProfileSel([]);
  };

  const onDoubleClick = (p: Pick | null): void => {
    if (sketch !== null || tool !== null || d === null || p === null) return;
    const name = p.kind === 'profile' ? (p.sketch ?? '') : p.kind === 'plane' ? '' : creatorOf(p.key);
    const f = d.features.find((x) => x.name === name);
    if (f !== undefined) startEdit(f);
  };

  /* ---------------------------------------------------------- right click */

  const bodyOf = (key: string): string | undefined => baseTopo?.faces.find((f) => f.key === key)?.body ?? baseTopo?.edges.find((e) => e.key === key)?.body;
  const bodyEntries = (body: string | undefined): MenuEntry[] => {
    const all = d?.build?.summary?.bodies.map((b) => b.name) ?? [];
    const out: MenuEntry[] = [];
    if (body !== undefined) {
      out.push({ label: 'Hide ' + featureTitle(body), icon: EyeOff, onClick: () => setHidden((h) => [...h.filter((x) => x !== body), body]) });
      if (all.length > 1) out.push({ label: 'Show only ' + featureTitle(body), icon: Eye, onClick: () => setHidden(all.filter((x) => x !== body)) });
    }
    if (hidden.length > 0) out.push({ label: 'Show all bodies', icon: Eye, onClick: () => setHidden([]) });
    return out;
  };

  const onContext = (p: Pick | null, at: { x: number; y: number }): void => {
    if (d === null) return;
    if (sketch !== null) {
      session?.onContext();
      return;
    }
    let entries: MenuEntry[] = [];
    if (tool !== null) {
      entries = [
        { label: 'OK', icon: Check, shortcut: 'Enter', onClick: () => void applyTool() },
        { label: 'Cancel', icon: X, shortcut: 'Esc', onClick: closeTool },
      ];
    } else if (p !== null && p.kind === 'profile' && p.sketch !== undefined && p.item !== undefined) {
      const prof = [{ sketch: p.sketch, item: p.item }];
      const f = d.features.find((x) => x.name === p.sketch);
      entries = [
        { header: 'Profile of ' + featureTitle(p.sketch) },
        { label: 'Extrude', icon: iconOf('extrude'), shortcut: 'E', onClick: () => startTool('extrude', { selection: [], profiles: prof }) },
        { label: 'Revolve', icon: iconOf('revolve'), onClick: () => startTool('revolve', { selection: [], profiles: prof }) },
        ...(f !== undefined ? ['separator' as const, { label: 'Edit ' + featureTitle(f.name), icon: Pencil, onClick: () => editSketch(f) }] : []),
      ];
    } else if (p !== null && p.kind === 'face') {
      const face = baseTopo?.faces[p.index];
      const planar = face?.type === 'plane';
      const owner = d.features.find((x) => x.name === creatorOf(p.key));
      const sel = { selection: [p.key], profiles: [] };
      const edges = baseTopo !== null ? boundaryEdges(baseTopo, p.key) : [];
      entries = [
        { header: faceLabel(p.key) },
        ...(planar ? [{ label: 'Sketch on face', icon: iconOf('sketch'), shortcut: 'S', onClick: () => void sketchOnFace(p.key) }, { label: 'Push/pull', icon: iconOf('push_pull'), shortcut: 'Q', onClick: () => startTool('push_pull', sel) }, { label: 'Hole', icon: iconOf('hole'), shortcut: 'H', onClick: () => startTool('hole', sel) }] : []),
        { label: 'Shell, open here', icon: iconOf('shell'), onClick: () => startTool('shell', sel) },
        { label: 'Fillet its edges', icon: iconOf('fillet'), onClick: () => startTool('fillet', { selection: edges, profiles: [] }) },
        { label: 'Select its edges', icon: Link2, onClick: () => changeSelection(edges) },
        ...(baseTopo !== null && similar(baseTopo, p.key).length > 1 ? [{ label: 'Select similar (' + similar(baseTopo, p.key).length + ')', icon: SquareStack, onClick: () => changeSelection(similar(baseTopo, p.key)) }] : []),
        'separator',
        ...(planar && face?.normal !== undefined ? [{ label: 'Look at', icon: ScanEye, onClick: () => viewer.current?.lookAlong(face.normal as P3, face.frame?.v ?? null, face.center) }] : []),
        ...(owner !== undefined ? [{ label: 'Edit ' + featureTitle(owner.name), icon: Pencil, onClick: () => startEdit(owner) }] : []),
        ...bodyEntries(bodyOf(p.key)),
      ];
      if (!selection.includes(p.key)) changeSelection([p.key]);
    } else if (p !== null && p.kind === 'edge') {
      const owner = d.features.find((x) => x.name === creatorOf(p.key));
      const chain = baseTopo !== null ? tangentChain(baseTopo, p.key) : [p.key];
      const sel = { selection: selection.includes(p.key) ? selection : [p.key], profiles: [] };
      entries = [
        { header: edgeLabel(p.key) },
        { label: 'Fillet', icon: iconOf('fillet'), shortcut: 'Shift F', onClick: () => startTool('fillet', sel) },
        { label: 'Chamfer', icon: iconOf('chamfer'), shortcut: 'Shift C', onClick: () => startTool('chamfer', sel) },
        ...(chain.length > 1 ? [{ label: 'Select tangent chain (' + chain.length + ')', icon: Link2, onClick: () => changeSelection(chain) }] : []),
        ...(baseTopo !== null && similar(baseTopo, p.key).length > 1 ? [{ label: 'Select similar (' + similar(baseTopo, p.key).length + ')', icon: SquareStack, onClick: () => changeSelection(similar(baseTopo, p.key)) }] : []),
        'separator',
        ...(owner !== undefined ? [{ label: 'Edit ' + featureTitle(owner.name), icon: Pencil, onClick: () => startEdit(owner) }] : []),
        ...bodyEntries(bodyOf(p.key)),
      ];
      if (!selection.includes(p.key)) changeSelection([p.key]);
    } else {
      entries = [
        { label: 'Fit', icon: Focus, shortcut: 'F', onClick: () => viewer.current?.fit() },
        { label: 'Home view', icon: HomeIcon, onClick: () => viewer.current?.view('iso') },
        { label: xray ? 'Solid' : 'See through', icon: Eye, onClick: () => setXray((x) => !x) },
        ...(hidden.length > 0 ? [{ label: 'Show all bodies', icon: Eye, onClick: () => setHidden([]) }] : []),
        'separator',
        { label: 'New sketch', icon: iconOf('sketch'), shortcut: 'S', onClick: () => startTool('sketch', { selection: [], profiles: [] }) },
        { label: 'Undo', icon: Undo2, shortcut: 'Ctrl Z', onClick: () => void undo(false) },
      ];
    }
    setCtxMenu({ at, entries });
  };

  /* ---------------------------------------------------------------- undo */

  const undo = async (redo: boolean): Promise<void> => {
    try {
      const h = await api.changes({ part: id, limit: 200 });
      // Undo: the newest edit or redo still in effect. Redo: the newest undo
      // still in effect, unless an edit was made after it.
      let b: Batch | undefined;
      for (const x of h.batches) {
        if (redo && x.kind === 'edit') break;
        if (x.reverted_by !== '') continue;
        if (redo ? x.kind === 'undo' : x.kind !== 'undo') {
          b = x;
          break;
        }
      }
      if (b === undefined) {
        toast.info(redo ? 'Nothing to redo' : 'Nothing to undo');
        return;
      }
      const pv = await api.revert(b.batch, true);
      const r = await api.revert(b.batch, false, pv.needs_force === true);
      if (r.status === 'failed') toast.error((redo ? 'Redone' : 'Undone') + ', but the part does not build');
    } catch (err) {
      toast.error(errMessage(err));
    }
  };

  /* -------------------------------------------------------------- compare */

  const showCompare = async (batch: string): Promise<void> => {
    try {
      const c = await api.compare(id, { batch });
      const [a, r] = await Promise.all([c.files.added !== '' ? fetchBinary(c.files.added).then(parseView) : Promise.resolve(null), c.files.removed !== '' ? fetchBinary(c.files.removed).then(parseView) : Promise.resolve(null)]);
      setCompare({ added: a, removed: r, addedMm3: c.added_mm3, removedMm3: c.removed_mm3 });
      setMobileTab('model');
    } catch (err) {
      toast.error(errMessage(err));
    }
  };

  /* ------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const typing = t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (sketch === null) setPalette(true);
        return;
      }
      if (typing || document.querySelector('[role="dialog"]') !== null || sketch !== null) return;
      if (tool !== null) {
        if (e.key === 'f' || e.key === 'F') viewer.current?.fit();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undo(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        void undo(true);
        return;
      }
      if (mod || e.altKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && treeSel !== null) {
        e.preventDefault();
        void deleteFeature(treeSel);
        return;
      }
      if (e.key === 'Escape') {
        if (planePick) setPlanePick(false);
        else if (compare !== null) setCompare(null);
        else {
          if (selection.length) changeSelection([]);
          setProfileSel([]);
          setTreeSel(null);
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'f' && e.shiftKey) startTool('fillet');
      else if (k === 'c' && e.shiftKey) startTool('chamfer');
      else if (e.shiftKey) return;
      else if (k === 'f') viewer.current?.fit();
      else if (k === 's') startTool('sketch');
      else if (k === 'e') startTool('extrude');
      else if (k === 'q') startTool('push_pull');
      else if (k === 'h') startTool('hole');
      else if (k === 'm') startTool('transform');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ----------------------------------------------------------- the views */

  // Sketches to show: the open tool's, and every sketch nothing uses yet (their profiles are pickable).
  const sketches: SketchShow[] = useMemo(() => {
    if (baseTopo === null || d === null || sketch !== null) return [];
    const unused = new Set(d.features.filter((f) => f.kind === 'sketch' && f.used_by.length === 0 && !f.suppressed).map((f) => f.name));
    const toolSketch = tool !== null && TOOLS[tool.kind].pick?.what === 'profiles' && typeof tool.params['sketch'] === 'string' ? tool.params['sketch'] : null;
    if (toolSketch !== null) unused.add(toolSketch);
    if (tool !== null && toolSketch === null) return [];
    return baseTopo.sketches
      .filter((s) => unused.has(s.name))
      .map((s) => ({
        outline: s,
        selected: s.name === toolSketch && tool !== null ? usedProfiles(s, tool.params['items']) : tool === null ? profileSel.filter((x) => x.sketch === s.name).map((x) => x.item) : [],
        pickable: tool === null || s.name === toolSketch || TOOLS[tool.kind].pick?.what === 'profiles',
      }));
  }, [baseTopo, d, sketch, tool, profileSel]);

  const viewerSelection = useMemo(() => (tool !== null ? pickedKeys(tool.params) : selection), [tool, selection]);
  const marked = useMemo(() => {
    const out = [...shown];
    const feats = [hoverFeature, treeSel].filter((x): x is string => x !== null);
    if (feats.length && shownModel !== null) for (const f of shownModel.topo.faces) if (keyFeatures(f.base).some((n) => feats.includes(n))) out.push(f.key);
    return out;
  }, [hoverFeature, treeSel, shown, shownModel]);
  const current = useMemo(() => {
    const out = new Set<string>();
    for (const k of selection) out.add(creatorOf(k));
    for (const p of profileSel) out.add(p.sketch);
    if (treeSel !== null) out.add(treeSel);
    return [...out];
  }, [selection, profileSel, treeSel]);

  // Tools the selection is ready for.
  const ready = useMemo((): ToolId[] => {
    if (baseTopo === null) return [];
    const out: ToolId[] = [];
    const edges = selection.filter((k) => baseTopo.edges.some((e) => e.key === k));
    const faces = selection.filter((k) => baseTopo.faces.some((f) => f.key === k));
    const planar = faces.filter((k) => baseTopo.faces.find((f) => f.key === k)?.type === 'plane');
    if (edges.length > 0 && faces.length === 0) out.push('fillet', 'chamfer');
    if (planar.length === 1 && selection.length === 1) out.push('sketch', 'push_pull', 'hole');
    if (faces.length > 0 && edges.length === 0) out.push('shell');
    if (profileSel.length > 0) out.push('extrude', 'revolve');
    return out;
  }, [baseTopo, selection, profileSel]);

  const formCtx: FormContext | null = useMemo(() => {
    if (d === null || tool === null) return null;
    const idx = tool.feature !== null ? d.features.findIndex((f) => f.id === tool.feature?.id) : -1;
    const rb = d.rollback_after === '' ? d.features.length : d.rollback_after === 'start' ? 0 : d.features.findIndex((f) => f.name === d.rollback_after) + 1;
    return {
      kind: tool.kind,
      before: idx >= 0 ? d.features.slice(0, idx) : d.features.slice(0, rb),
      env,
      paramNames: d.parameters.map((p) => p.name),
      bodies: d.build?.summary?.bodies.map((b) => b.name) ?? [],
      assets: d.assets,
      topo: baseTopo,
      activePick: tool.active,
      onActivatePick: (path: string) => setTool((t) => (t === null ? t : { ...t, active: path })),
      onUploadAsset: async (file: File) => (await api.addAsset(id, file)).asset.id,
    };
  }, [d, tool, env, baseTopo, id]);

  if (d === null || schema === null) {
    return (
      <div className="flex h-full items-center justify-center">
        {live.error !== null ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-[13px] font-bold">This part could not be opened</p>
            <p className="text-[12px] text-[var(--cw-muted)]">{live.error}</p>
            <button type="button" onClick={() => navigate('parts')} className="text-[12px] font-semibold text-[var(--cw-accent-text)] hover:underline">
              All parts
            </button>
          </div>
        ) : (
          <Spinner size={20} />
        )}
      </div>
    );
  }

  const st = statusOf(d, status !== null && !status.engine.installed && setupActive(status.engine.setup));
  const failed = d.part.status === 'failed';
  const bbox = d.build?.summary?.bbox ?? null;
  const massG = d.build?.summary?.mass_g;
  const passing = d.checks.filter((c) => c.result === 'pass').length;
  const ask = (k: 'design' | 'review' | 'repair'): void => {
    setAskKind(k);
    setSide('agent');
    setMobileTab('panel');
  };

  const left = (
    <Tree
      detail={d}
      unit={unit}
      active={tool?.feature?.name ?? sketch?.name ?? null}
      current={current}
      hidden={hidden}
      onToggleBody={(b) => setHidden((h) => (h.includes(b) ? h.filter((x) => x !== b) : [...h, b]))}
      onSelect={(f) => {
        setTreeSel(f?.name ?? null);
        if (f !== null) {
          changeSelection([]);
          setProfileSel([]);
        }
      }}
      onEdit={startEdit}
      onHoverFeature={setHoverFeature}
      building={st.pulse}
    />
  );

  const right =
    sketch !== null && session !== null ? (
      session.properties
    ) : (
      <>
        <Tabs<Side>
          label="Panel"
          value={side}
          onChange={setSide}
          options={[
            { value: 'part', label: selection.length ? <>Selection <TabCount>{selection.length}</TabCount></> : 'Part' },
            { value: 'checks', label: <>Checks {d.checks.length > 0 && <TabCount tone={passing === d.checks.length ? 'good' : 'bad'}>{passing + '/' + d.checks.length}</TabCount>}</> },
            { value: 'history', label: 'History' },
            { value: 'agent', label: <span className="inline-flex items-center gap-1"><Sparkles size={12} aria-hidden className="text-[var(--cw-accent-text)]" />Agent</span> },
          ]}
        />
        <div className={cn('min-h-0 flex-1', side === 'agent' ? 'flex flex-col' : 'overflow-y-auto')}>
          {side === 'part' &&
            (selection.length > 0 ? (
              <SelectionPanel d={d} topo={baseTopo} selection={selection} unit={unit} onClear={() => changeSelection([])} onQuick={(k) => startTool(k)} onMeasure={onMeasure} />
            ) : (
              <PartPanel
                d={d}
                unit={unit}
                onShowKeys={(keys) => {
                  setShown(keys);
                  viewer.current?.zoomTo(keys);
                }}
                onAskFix={() => ask('repair')}
                onEditFeature={(n) => {
                  const f = d.features.find((x) => x.name === n);
                  if (f !== undefined) startEdit(f);
                }}
              />
            ))}
          {side === 'checks' && <ChecksPanel d={d} unit={unit} selection={selection} />}
          {side === 'history' && <HistoryPanel partId={id} onCompare={(b) => void showCompare(b)} />}
          {side === 'agent' && <AgentPanel part={id} selection={selection} failed={failed} initialKind={askKind} />}
        </div>
      </>
    );

  const overlay = 'pointer-events-auto inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] pl-2.5 pr-0.5 text-[12px] font-semibold shadow-[var(--cw-shadow)]';
  const badge =
    compare !== null ? (
      <span className={overlay}>
        <span aria-hidden className="size-2 rounded-full" style={{ background: rgbCss(pal.added) }} />
        Added <span className="num text-[var(--cw-ink-2)]">{volume(compare.addedMm3, unit)}</span>
        <span aria-hidden className="ml-1 size-2 rounded-full" style={{ background: rgbCss(pal.removed) }} />
        Removed <span className="num text-[var(--cw-ink-2)]">{volume(compare.removedMm3, unit)}</span>
        <IconButton icon={X} size={24} label="Close the comparison" onClick={() => setCompare(null)} />
      </span>
    ) : st.pulse && tool === null ? (
      <Badge tone="info" pulse>
        {st.label}
      </Badge>
    ) : shown.length > 0 ? (
      <span className={overlay}>
        {shown.length} found
        <IconButton icon={X} size={24} label="Stop showing" onClick={() => setShown([])} />
      </span>
    ) : undefined;

  const panel =
    sketch !== null && session !== null ? (
      session.palette
    ) : tool !== null && formCtx !== null ? (
      <ToolDialog key={(tool.feature?.id ?? 'new') + tool.kind} schema={schema} tool={tool} ctx={formCtx} unit={unit} preview={preview} applying={applying} ready={toolReady(tool.kind, tool.params, env)} onParams={updateParams} onOk={() => void applyTool()} onCancel={closeTool} />
    ) : planePick ? (
      <div className="pointer-events-auto flex items-center gap-2 rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] py-1 pl-2.5 pr-1 text-[12px] font-semibold shadow-[var(--cw-shadow)]">
        Select a plane or a flat face
        <IconButton icon={X} size={22} label="Cancel (Esc)" onClick={() => setPlanePick(false)} />
      </div>
    ) : null;

  const emptyBox = 'flex max-w-md flex-col items-center gap-3 rounded-[var(--cw-r-md)] border border-[var(--cw-line)] bg-[var(--cw-card)] p-4 text-center shadow-[var(--cw-shadow)]';
  const startBtn = 'flex h-16 w-[84px] flex-col items-center justify-center gap-1 rounded-[var(--cw-r)] border border-[var(--cw-line)] text-[12px] font-semibold text-[var(--cw-ink)] hover:border-[var(--cw-ink)] hover:bg-[var(--cw-row)]';
  const empty =
    d.features.length === 0 ? (
      <div className={emptyBox}>
        <div className="flex flex-wrap justify-center gap-1.5">
          <button type="button" className={startBtn} onClick={() => startTool('sketch')}>
            {(() => {
              const I = iconOf('sketch');
              return <I size={18} aria-hidden strokeWidth={1.75} />;
            })()}
            Sketch
          </button>
          <button type="button" className={startBtn} onClick={() => startTool('box')}>
            {(() => {
              const I = iconOf('primitive');
              return <I size={18} aria-hidden strokeWidth={1.75} />;
            })()}
            Box
          </button>
          {STARTERS.filter((s) => s.steps.length > 0).map((s) => {
            const I = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                title={s.text}
                className={startBtn}
                onClick={() => {
                  api.batch(id, s.steps, { note: 'Started from ' + s.label.toLowerCase() }).catch((err: unknown) => toast.error(errMessage(err)));
                }}
              >
                <I size={18} aria-hidden strokeWidth={1.75} />
                {s.label}
              </button>
            );
          })}
          <button type="button" className={startBtn} onClick={() => ask('design')}>
            <Sparkles size={18} aria-hidden strokeWidth={1.75} className="text-[var(--cw-accent-text)]" />
            Describe it
          </button>
        </div>
      </div>
    ) : failed && baseView === '' ? (
      <div className={emptyBox}>
        <p className="text-[13px] font-bold">{st.label}</p>
        {d.build?.error?.feature !== undefined && (
          <button
            type="button"
            className="text-[12px] font-semibold text-[var(--cw-accent-text)] hover:underline"
            onClick={() => {
              const f = d.features.find((x) => x.name === d.build?.error?.feature);
              if (f !== undefined) startEdit(f);
            }}
          >
            Edit {featureTitle(d.build.error.feature)}
          </button>
        )}
      </div>
    ) : modelError !== null ? (
      <p className="text-[12px] text-[var(--cw-on-stage)]">{modelError}</p>
    ) : undefined;

  const showSize = bbox !== null && (
    <span className="num hidden truncate text-[12px] text-[var(--cw-muted)] md:inline">
      {bbox.size.map((x) => num(unit === 'in' ? x / 25.4 : x, unit === 'in' ? 3 : 1)).join(' × ')} {unit}
      {massG !== undefined ? ' · ' + mass(massG) : ''}
    </span>
  );

  return (
    <div className="flex h-full flex-col">
      {/* The part and what to do with it. */}
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--cw-line)] bg-[var(--cw-card)] px-2">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => back('parts')} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <PartName id={id} name={d.part.name} />
          <Badge tone={st.tone} pulse={st.pulse}>
            {st.label}
          </Badge>
          {showSize}
        </div>
        <ButtonGroup label="Undo and redo">
          <IconButton icon={Undo2} size={24} label="Undo (Ctrl+Z)" onClick={() => void undo(false)} />
          <IconButton icon={Redo2} size={24} label="Redo (Ctrl+Y)" onClick={() => void undo(true)} />
        </ButtonGroup>
        <IconButton icon={FileDown} label="Export" onClick={() => setExporting(true)} />
        <div className="relative">
          <button ref={menuBtn} type="button" aria-label="More" title="More" onClick={() => setMenu((m) => !m)} className="flex size-7 items-center justify-center rounded-[var(--cw-r)] text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)]">
            <Ellipsis size={15} aria-hidden />
          </button>
          <Popover open={menu} onClose={() => setMenu(false)} align="right" keep={menuBtn} className="w-52">
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMenu(false);
                api.updatePart(id, { pinned: !d.part.pinned }).catch((err: unknown) => toast.error(errMessage(err)));
              }}
            >
              {d.part.pinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />} {d.part.pinned ? 'Unpin' : 'Pin to the top'}
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMenu(false);
                api
                  .duplicatePart(id)
                  .then((r) => navigate('part', { id: r.part.id }))
                  .catch((err: unknown) => toast.error(errMessage(err)));
              }}
            >
              <Copy size={14} aria-hidden /> Duplicate
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMenu(false);
                ask('review');
              }}
            >
              <Diff size={14} aria-hidden /> Ask for a review
            </button>
            <div className="my-1 border-t border-[var(--cw-hair)]" />
            <DeleteButton variant="menu" collection="parts" id={id} name={d.part.name} label="Delete part" onDeleted={() => navigate('parts')} />
          </Popover>
        </div>
      </header>

      {/* The toolbar, or the sketch tools while sketching. */}
      <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--cw-line)] bg-[var(--cw-card)] px-1.5">
        {sketch !== null && session !== null ? (
          session.toolbar
        ) : (
          <>
            <Toolbar schema={schema} ready={ready} disabled={tool !== null} onTool={(t) => startTool(t)} />
            <span className="ml-auto" />
            <button type="button" title="Find a tool (Ctrl+K)" aria-label="Find a tool" onClick={() => setPalette(true)} className="flex h-11 w-9 shrink-0 items-center justify-center rounded-[var(--cw-r-sm)] text-[var(--cw-ink-2)] hover:bg-[var(--cw-row)]">
              <Search size={16} aria-hidden />
            </button>
          </>
        )}
      </div>

      {/* Phones and tablets: one area at a time. */}
      <Tabs
        className="bg-[var(--cw-card)] lg:hidden"
        label="Show"
        value={mobileTab}
        onChange={setMobileTab}
        options={[
          { value: 'model', label: 'Model' },
          { value: 'tree', label: 'Tree' },
          { value: 'panel', label: sketch !== null ? 'Sketch' : 'Details' },
        ]}
      />

      <div className="flex min-h-0 flex-1">
        <aside className={cn('min-h-0 w-full flex-col bg-[var(--cw-card)] lg:flex lg:w-[240px] lg:shrink-0 lg:border-r lg:border-[var(--cw-line)] xl:w-[256px]', mobileTab === 'tree' ? 'flex' : 'hidden')}>{left}</aside>
        <div className={cn('min-h-0 min-w-0 flex-1 flex-col lg:flex', mobileTab === 'model' ? 'flex' : 'hidden')}>
          <Viewer
            handle={viewer}
            data={shownModel?.data ?? null}
            topo={shownModel?.topo ?? null}
            slot={d.part.color}
            selection={viewerSelection}
            marked={marked}
            filter={filter}
            onFilter={setFilter}
            navigation={settings?.navigation ?? 'right_rotates'}
            unit={unit}
            projection={projection}
            onProjection={setProjection}
            grid={settings?.show_grid ?? true}
            measure={tool === null ? measure : null}
            compare={compare === null ? null : { added: compare.added, removed: compare.removed }}
            hidden={hidden}
            xray={xray}
            onXray={setXray}
            handles={handles}
            ghost={ghost}
            sketches={sketches}
            originPlanes={planePick}
            sketchFrame={sketch?.frame ?? null}
            pickModel={sketch === null}
            cursor={session?.cursor}
            onPick={onPick}
            onBoxSelect={onBoxSelect}
            onContext={onContext}
            onDoubleClick={onDoubleClick}
            onHandle={onHandle}
            onHandleType={(hid, v) => tool !== null && updateParams(typeAt(tool.kind, tool.params, hid, v, toolCtx), null)}
            onSketchPointer={(ev) => session?.onPointer(ev)}
            keepCamera
            panel={panel}
            labels={session?.labels}
            badge={badge}
            empty={tool === null && !planePick ? empty : undefined}
            className="min-h-[300px] flex-1"
          />
        </div>
        <aside className={cn('min-h-0 w-full flex-col bg-[var(--cw-card)] lg:flex lg:w-[296px] lg:shrink-0 lg:border-l lg:border-[var(--cw-line)] xl:w-[316px]', mobileTab === 'panel' ? 'flex' : 'hidden')}>{right}</aside>
      </div>

      {confirmEl}
      {ctxMenu !== null && <ContextMenu at={ctxMenu.at} entries={ctxMenu.entries} onClose={() => setCtxMenu(null)} />}
      <AddFeature open={palette} onClose={() => setPalette(false)} schema={schema} onPick={(k) => startTool(k)} hint={{}} />
      <ExportDialog open={exporting} onClose={() => setExporting(false)} part={{ id, name: d.part.name }} />
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function getFace(params: Params): Json | undefined {
  return params['face'];
}

function getPath(params: Params, path: string): Json | undefined {
  let cur: Json | undefined = params;
  for (const k of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, Json>)[k];
  }
  return cur;
}

function setPath(params: Params, path: string, value: Json | undefined): Params {
  const keys = path.split('.');
  const go = (node: Json | undefined, i: number): Json | undefined => {
    if (i === keys.length) return value;
    const obj: Record<string, Json> = node !== null && node !== undefined && typeof node === 'object' && !Array.isArray(node) ? { ...(node as Record<string, Json>) } : {};
    const k = keys[i] as string;
    const next = go(obj[k], i + 1);
    if (next === undefined) delete obj[k];
    else obj[k] = next;
    return obj;
  };
  return (go(params, 0) ?? {}) as Params;
}

/** A small count beside a tab label. */
function TabCount({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'bad' }): React.JSX.Element {
  return (
    <span
      className={cn(
        'num rounded-[3px] px-1 text-[12px] leading-4',
        tone === 'neutral' && 'bg-[var(--cw-row)] text-[var(--cw-ink-2)]',
        tone === 'good' && 'bg-[var(--cw-green)]/12 text-[var(--cw-green-text)]',
        tone === 'bad' && 'bg-[var(--cw-red)]/12 text-[var(--cw-red-text)]',
      )}
    >
      {children}
    </span>
  );
}

/** The part's name, renamed in place. */
function PartName({ id, name }: { id: string; name: string }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const save = (): void => {
    setEditing(false);
    const v = value.trim();
    if (v === '' || v === name) {
      setValue(name);
      return;
    }
    api.updatePart(id, { name: v }).catch((err: unknown) => {
      toast.error(errMessage(err));
      setValue(name);
    });
  };
  if (editing)
    return (
      <input
        autoFocus
        aria-label="Part name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') {
            setValue(name);
            setEditing(false);
          }
        }}
        className={cn(inputCls, 'max-w-[320px] flex-1 text-[14px] font-bold')}
        maxLength={80}
      />
    );
  return (
    <button type="button" onClick={() => setEditing(true)} title="Rename" className="min-w-0 truncate rounded-[var(--cw-r)] px-1.5 py-0.5 text-left text-[14px] font-bold leading-6 hover:bg-[var(--cw-row)]">
      {name}
    </button>
  );
}
