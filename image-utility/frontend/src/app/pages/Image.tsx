/**
 * The image workspace, laid out like a desktop editor: the image's name and
 * actions on top, the toolbar, the layers and edits on the left, the stage
 * in the middle, the inspector (Image, Export, History, Agent) on the right.
 *
 * The photo's tools (crop, size, tone, cut out) open as a dialog over the
 * stage, and every change in one is saved as it is made: the first real
 * change adds the edit, later ones update it (slider and typing changes a
 * moment after they stop, drags when they end), and a tool brought back to
 * doing nothing removes its edit. There is no Apply or Cancel: undo and redo
 * sit in the tool's bar.
 *
 * Text, arrows, boxes, highlights, steps, drawings, redactions and logos are
 * layers over the photo. The stage shows the photo without them and draws
 * them live (LayersOverlay), so moving, resizing and turning one shows at
 * once; each change is saved when the drag ends. The selected layer's
 * properties float over the stage; the Layers list restacks, hides, locks
 * and renames them.
 *
 * Shortcuts: C R B A F K open the photo tools, [ ] rotate, H flips, Shift+A
 * is Auto; V T L Shift+L U E M N P X G pick the layer tools; Delete removes
 * the selected layer, the arrow keys nudge it (Shift for 10), Ctrl+D
 * duplicates it, Ctrl+] and Ctrl+[ move it up and down (with Shift to the
 * top and bottom), Enter edits its text, Esc lets go; 0 fits, 1 is 100 %,
 * + and − zoom, hold \ to see the original, Ctrl+Z / Ctrl+Y undo and redo,
 * Ctrl+E goes to Export.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, Ellipsis, FileDown, ImageOff, Pin, PinOff, Redo2, Sparkles, Stamp, Trash2, Undo2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { EngineSetupNote } from '../components/EngineSetup.tsx';
import { AgentPanel } from '../components/workspace/AgentPanel.tsx';
import { ExportPanel } from '../components/workspace/ExportPanel.tsx';
import { FormFor, ratioRect, removeBgReady } from '../components/workspace/forms.tsx';
import { HistoryPanel } from '../components/workspace/HistoryPanel.tsx';
import { InfoPanel } from '../components/workspace/InfoPanel.tsx';
import { LayerDialog, LogoPicker } from '../components/workspace/LayerDialog.tsx';
import { LayersList } from '../components/workspace/LayersList.tsx';
import type { LayerRow } from '../components/workspace/LayersList.tsx';
import { LayersOverlay } from '../components/workspace/LayersOverlay.tsx';
import type { DrawStyle, DrawTool } from '../components/workspace/LayersOverlay.tsx';
import { CropOverlay, RegionOverlay } from '../components/workspace/overlays.tsx';
import { StackPanel } from '../components/workspace/StackPanel.tsx';
import { BarButton, Stage } from '../components/workspace/Stage.tsx';
import type { Backdrop, OverlayApi, Picture, StageHandle } from '../components/workspace/Stage.tsx';
import { ToolDialog } from '../components/workspace/ToolDialog.tsx';
import type { ToolStatus } from '../components/workspace/ToolDialog.tsx';
import { Toolbar } from '../components/workspace/Toolbar.tsx';
import { LAYER_TOOLS, TOOLS } from '../components/workspace/tools.ts';
import type { LayerTool, PixelKind, QuickId, ToolDef } from '../components/workspace/tools.ts';
import { Badge, Button, ButtonGroup, Empty, IconButton, Popover, Spinner, Tabs, errMessage, menuItem, useConfirm } from '../components/ui.tsx';
import { api, fileUrl } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { dims as fmtDims } from '../lib/format.ts';
import { cropBase, dims as dimsOf, padOf, ratioOf } from '../lib/geom.ts';
import { IDENTITY, defaultStroke, defaultTextSize, newLayer, place, shapeOf, unplace } from '../lib/layers.ts';
import type { Frame } from '../lib/layers.ts';
import { useLive } from '../lib/live.ts';
import { back, navigate } from '../lib/router.ts';
import type { Dims, Edit, ImageDetail, Json, LayerType, Params, Region } from '../lib/types.ts';

type Side = 'image' | 'export' | 'history' | 'agent';

interface ToolState {
  /** One opening of a tool. */
  sid: number;
  kind: PixelKind;
  /** The edit this session saves to, once its first change is saved. */
  editId: string | null;
  params: Params;
}

/**
 * A layer as changed here and not yet seen back from the server: what is
 * shown until the image reloads with the saved change.
 */
interface LayerOver {
  params?: Params;
  visible?: boolean;
  removed?: boolean;
  /** A change not sent yet (dragging, or resting before its save). */
  dirty: boolean;
  inflight: number;
  /** The edit's `updated` once the server took the change. */
  savedAt: string;
}

/** A layer drawn here, shown while the server adds it. */
interface NewLayer {
  id: string;
  real: string | null;
  params: Params;
}

type Arrange = 'front' | 'back' | 'forward' | 'backward';

const ROT_KEYS = ['turns', 'flip_h', 'flip_v', 'angle'];
const TEMP = 'new-';

/** How long a change rests before it is saved (sliders and typing). */
const SAVE_AFTER_MS = 320;

function pick(p: Params, keys: string[]): Params {
  const out: Params = {};
  for (const k of keys) if (p[k] !== undefined) out[k] = p[k] as Json;
  return out;
}

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return el !== null && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

const BACKDROP_KEY = 'iu.backdrop';

function readBackdrop(): Backdrop {
  try {
    const v = localStorage.getItem(BACKDROP_KEY);
    return v === 'light' || v === 'dark' ? v : 'checker';
  } catch {
    return 'checker';
  }
}

/** What to do while the tool's params change nothing yet (nothing is saved until they do). */
function waitingFor(kind: PixelKind, p: Params, frame: Dims, input: Dims): string | null {
  if (kind === 'crop') {
    const rect = p['rect'] as unknown as Region | undefined;
    const rot = ROT_KEYS.some((k) => p[k] !== undefined);
    const full = rect === undefined || (rect.x === 0 && rect.y === 0 && rect.w >= frame[0] && rect.h >= frame[1]);
    if (!rot && full && p['ratio'] === undefined) return 'Drag the box, pick a ratio, straighten or rotate.';
  }
  if (kind === 'resize') {
    const out = dimsOf('resize', p, input[0], input[1]);
    if (out[0] === input[0] && out[1] === input[1]) return 'Set a new size.';
  }
  if (kind === 'canvas' && padOf(p).every((v) => v === 0) && p['ratio'] === undefined && !p['radius'] && p['shadow'] !== true) return 'Add padding, a ratio, rounded corners or a shadow.';
  if (kind === 'adjust' && Object.keys(p).length === 0) return 'Move a slider or press Auto.';
  if (kind === 'filter' && (p['name'] === undefined || p['name'] === '')) return 'Pick a look.';
  return null;
}

/** The params as they are saved: a crop box that covers everything is no box. */
function finalParams(kind: PixelKind, params: Params, frame: Dims): Params {
  if (kind !== 'crop') return params;
  const rect = params['rect'] as unknown as Region | undefined;
  if (rect !== undefined && rect.x === 0 && rect.y === 0 && rect.w >= frame[0] && rect.h >= frame[1]) {
    const { rect: _r, ...rest } = params;
    return rest;
  }
  return params;
}

function statusOf(err: unknown): number {
  return (err as { status?: number }).status ?? 0;
}

/** The photo's own edits, as they decide what the photo looks like (layers left out). */
function pixelKey(d: ImageDetail | null): string {
  if (d === null) return '';
  return JSON.stringify([d.id, d.hash ?? '', d.status, d.stack.filter((e) => e.state === 'active' && e.kind !== 'layer').map((e) => [e.id, e.enabled, e.params, e.updated])]);
}

/** The order the layers go in after an arrange (bottom first). */
function arranged(ids: string[], id: string, to: Arrange): string[] {
  const i = ids.indexOf(id);
  if (i < 0) return ids;
  const rest = ids.filter((x) => x !== id);
  const at = to === 'front' ? rest.length : to === 'back' ? 0 : to === 'forward' ? Math.min(rest.length, i + 1) : Math.max(0, i - 1);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Picking the logo for a new logo layer. */
function LogoChooser({ onPick, onClose }: { onPick: (asset: string, w: number, h: number) => void; onClose: () => void }): React.JSX.Element {
  return (
    <section aria-label="Logo" className="iu-pop pointer-events-auto flex w-[min(260px,calc(100vw-24px))] flex-col overflow-hidden rounded-[var(--iu-r-md)] border border-[var(--iu-line)] bg-[var(--iu-card)] shadow-[var(--iu-shadow)]">
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--iu-hair)] pl-2 pr-1">
        <Stamp size={14} aria-hidden className="text-[var(--iu-ink-2)]" />
        <h2 className="min-w-0 flex-1 truncate pl-0.5 text-[13px] font-bold">Logo</h2>
        <BarButton label="Close (Esc)" onClick={onClose}>
          <X size={14} aria-hidden />
        </BarButton>
      </header>
      <div className="flex flex-col gap-2 p-2">
        <p className="text-[12px] leading-4 text-[var(--iu-muted)]">Pick a logo or add one; it lands in the middle as a layer you can move, resize, turn, fade or tile.</p>
        <LogoPicker value="" onPick={onPick} />
      </div>
    </section>
  );
}

export function ImagePage({ id }: { id: string }): React.JSX.Element {
  const { status } = useApp();
  const live = useLive(() => api.image(id, true), ['images', 'edits', 'proposals', 'exports', 'requests'], [id], 120);
  const d = live.data;
  const assets = useLive(() => api.assets(), ['assets'], []);
  const stage = useRef<StageHandle | null>(null);
  const [side, setSide] = useState<Side>('image');
  const [mobileTab, setMobileTab] = useState<'image' | 'edits' | 'panel'>('image');
  const [backdrop, setBackdropState] = useState<Backdrop>(readBackdrop);
  const setBackdrop = (b: Backdrop): void => {
    setBackdropState(b);
    try {
      localStorage.setItem(BACKDROP_KEY, b);
    } catch {
      /* the backdrop is a convenience */
    }
  };

  // The open tool and what it shows.
  const [tool, setTool] = useState<ToolState | null>(null);
  const [base, setBase] = useState<Picture | null>(null);
  const [baseBusy, setBaseBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Layers: the selected one, the drawing tool, the text being typed, the ink new ones get.
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [layerTool, setLayerTool] = useState<LayerTool>('select');
  const [editingText, setEditingText] = useState<string | null>(null);
  const [ink, setInk] = useState({ color: '#ff4f18', font: 'sans-bold', mode: 'solid' });

  // Compare with the original, an agent proposal's preview, a region for the agent.
  const [comparing, setComparing] = useState(false);
  const [original, setOriginal] = useState<Picture | null>(null);
  const [proposal, setProposal] = useState<string | null>(null);
  const [proposalPic, setProposalPic] = useState<Picture | null>(null);
  const [picking, setPicking] = useState(false);
  const [region, setRegion] = useState<Region | null>(null);
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const [confirmEl, confirm] = useConfirm();

  const current: Picture | null = useMemo(() => (d !== null && d.preview_url !== '' ? { url: d.preview_url, w: d.out_width, h: d.out_height, detail: { image: d.id } } : null), [d?.preview_url, d?.out_width, d?.out_height, d?.id]);
  // The edit the open tool saves to, and the size it starts from.
  const toolEdit: Edit | null = tool !== null && tool.editId !== null && d !== null ? (d.stack.find((e) => e.id === tool.editId) ?? null) : null;
  const inDims: Dims = toolEdit !== null ? toolEdit.in : d !== null ? [d.out_width, d.out_height] : [1, 1];
  const def = tool !== null ? TOOLS[tool.kind] : null;
  const cropFrame: Dims = tool?.kind === 'crop' ? cropBase(tool.params, inDims[0], inDims[1]) : inDims;

  /* ------------------------------------------- the photo, without layers */

  // The stage shows the photo and draws the layers over it; the frame maps
  // the original photo's pixels to the result's (crops, turns, resizes).
  const [photo, setPhoto] = useState<{ pic: Picture; fr: Frame } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const pk = pixelKey(d);
  useEffect(() => {
    setPhoto(null);
  }, [id]);
  useEffect(() => {
    if (d === null || d.status !== 'ready') return;
    let alive = true;
    setPhotoBusy(true);
    api
      .render(d.id, { layers: false }, true)
      .then((r) => {
        if (alive) setPhoto({ pic: { url: r.url, w: r.width, h: r.height, detail: { image: d.id, layers: false } }, fr: { F: r.transform ?? IDENTITY, W: r.width, H: r.height } });
      })
      .catch((err: unknown) => alive && toast.error(errMessage(err)))
      .finally(() => alive && setPhotoBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pk]);
  const frame = photo?.fr ?? null;

  /* ------------------------------------------------- saving as you go */

  // Every write goes through one queue, so the server sees them in order.
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const serial = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = writes.current.then(fn, fn);
    writes.current = run.catch(() => undefined);
    return run;
  }, []);

  // Saves run one at a time, newest change last; a session's edit id lives
  // in a ref so a quick second change updates the edit the first one made.
  const sidRef = useRef(0);
  const toolRef = useRef<ToolState | null>(null);
  toolRef.current = tool;
  const latest = useRef({ d, inDims });
  latest.current = { d, inDims };
  const editOf = useRef(new Map<number, string>());
  const lastEditOf = useRef(new Map<number, string>());
  const savedKey = useRef(new Map<number, string>());
  const queued = useRef<{ sid: number; kind: PixelKind; params: Params } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pumping = useRef(false);
  const reload = live.reload;

  const saveOne = useCallback(async (job: { sid: number; kind: PixelKind; params: Params }): Promise<void> => {
    const img = latest.current.d;
    if (img === null) return;
    const key = JSON.stringify(job.params);
    if (savedKey.current.get(job.sid) === key) return;
    const input = latest.current.inDims;
    const frame: Dims = job.kind === 'crop' ? cropBase(job.params, input[0], input[1]) : input;
    const editId = editOf.current.get(job.sid) ?? null;
    const setEdit = (eid: string | null): void => {
      if (eid === null) editOf.current.delete(job.sid);
      else {
        editOf.current.set(job.sid, eid);
        lastEditOf.current.set(job.sid, eid);
      }
      setTool((t) => (t !== null && t.sid === job.sid ? { ...t, editId: eid } : t));
    };
    // Brought back to doing nothing: the edit goes, so the stack shows what you see.
    if (waitingFor(job.kind, job.params, frame, input) !== null) {
      if (editId !== null) {
        await api.removeEdits([editId]);
        setEdit(null);
      }
      savedKey.current.set(job.sid, key);
      return;
    }
    const params = finalParams(job.kind, job.params, frame);
    let r;
    if (editId !== null) {
      try {
        r = await api.updateEdit(editId, { params, replace: true }, { silent: true });
      } catch (err) {
        if (statusOf(err) !== 404) throw err;
        // Removed meanwhile (from the stack or by an undo): start a new one.
        setEdit(null);
        r = await api.addEdit(img.id, job.kind, params, {}, { silent: true });
        if (r.edit !== undefined) setEdit(r.edit.id);
      }
    } else {
      r = await api.addEdit(img.id, job.kind, params, {}, { silent: true });
      if (r.edit !== undefined) setEdit(r.edit.id);
    }
    savedKey.current.set(job.sid, key);
    if (toolRef.current?.sid === job.sid) setWarnings(r.warnings);
  }, []);

  const pump = useCallback(async (): Promise<void> => {
    if (pumping.current) return;
    pumping.current = true;
    setSaving(true);
    try {
      while (queued.current !== null) {
        const job = queued.current;
        queued.current = null;
        try {
          await serial(() => saveOne(job));
          if (toolRef.current?.sid === job.sid) setProblem(null);
        } catch (err) {
          if (toolRef.current?.sid === job.sid) setProblem(errMessage(err));
        }
      }
    } finally {
      pumping.current = false;
      setSaving(false);
      reload();
    }
  }, [saveOne, serial, reload]);

  const schedule = useCallback(
    (job: { sid: number; kind: PixelKind; params: Params }, now: boolean): void => {
      queued.current = job;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      if (now) void pump();
      else
        timer.current = setTimeout(() => {
          timer.current = null;
          void pump();
        }, SAVE_AFTER_MS);
    },
    [pump],
  );

  /** Save what is waiting now (before another tool opens or this one closes). */
  const flush = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (queued.current !== null) void pump();
  }, [pump]);

  /** Change the open tool's params; drags pass `dragging` until they end (`now`). */
  const setParams = useCallback(
    (p: Params, opts: { now?: boolean; dragging?: boolean } = {}): void => {
      const t = toolRef.current;
      if (t === null) return;
      const next = { ...t, params: p };
      toolRef.current = next;
      setTool(next);
      if (opts.dragging === true) return;
      schedule({ sid: t.sid, kind: t.kind, params: p }, opts.now === true);
    },
    [schedule],
  );

  /* ------------------------------------------------------------ layers */

  // What the server has, then what was changed here and not yet seen back.
  const overs = useRef(new Map<string, LayerOver>());
  const temps = useRef<NewLayer[]>([]);
  const realOf = useRef(new Map<string, string>());
  const tempSeq = useRef(0);
  const order = useRef<{ ids: string[]; settled: number } | null>(null);
  const layerTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [, bumpLayers] = useReducer((x: number) => x + 1, 0);
  const [layerSaving, setLayerSaving] = useState(0);

  const serverLayers: LayerRow[] = useMemo(
    () => (d === null ? [] : d.stack.filter((e) => e.kind === 'layer' && e.state === 'active').map((e) => ({ id: e.id, params: e.params, visible: e.enabled, locked: e.params['locked'] === true, author: e.author }))),
    [d?.stack],
  );

  const resolve = (lid: string): string => realOf.current.get(lid) ?? lid;
  const overOf = (lid: string): LayerOver => {
    let o = overs.current.get(lid);
    if (o === undefined) {
      o = { dirty: false, inflight: 0, savedAt: '' };
      overs.current.set(lid, o);
    }
    return o;
  };

  // A change seen back from the server (or a layer gone from it) needs its stand-in no more.
  useEffect(() => {
    if (d === null) return;
    const byId = new Map(d.stack.map((e) => [e.id, e]));
    let changed = false;
    const before = temps.current.length;
    temps.current = temps.current.filter((t) => t.real === null || !byId.has(t.real));
    if (temps.current.length !== before) changed = true;
    const pendingNew = new Set(temps.current.map((t) => t.real ?? t.id));
    for (const [lid, o] of overs.current) {
      if (o.dirty || o.inflight > 0 || pendingNew.has(lid)) continue;
      const e = byId.get(lid);
      const gone = e === undefined || e.state !== 'active';
      if (o.removed === true ? gone : gone || (o.savedAt !== '' && e !== undefined && e.updated >= o.savedAt)) {
        overs.current.delete(lid);
        changed = true;
      }
    }
    if (order.current !== null && order.current.settled > 0) {
      const now = serverLayers.map((l) => l.id).join(',');
      const want = order.current.ids.filter((x) => byId.has(x)).join(',');
      if (now === want || Date.now() - order.current.settled > 1500) {
        order.current = null;
        changed = true;
      }
    }
    if (changed) bumpLayers();
  }, [d, serverLayers]);

  // Bottom first, as drawn.
  const layers: LayerRow[] = (() => {
    const serverIds = new Set(serverLayers.map((l) => l.id));
    const all: LayerRow[] = [...serverLayers];
    for (const t of temps.current) {
      const lid = t.real ?? t.id;
      if (!serverIds.has(lid)) all.push({ id: lid, params: t.params, visible: true, locked: false, author: 'you' });
    }
    const out: LayerRow[] = [];
    for (const l of all) {
      const o = overs.current.get(l.id);
      if (o === undefined) {
        out.push(l);
        continue;
      }
      if (o.removed === true) continue;
      const params = o.params ?? l.params;
      out.push({ ...l, params, visible: o.visible ?? l.visible, locked: params['locked'] === true });
    }
    if (order.current !== null) {
      const at = new Map(order.current.ids.map((x, i) => [x, i]));
      out.sort((a, b) => (at.get(a.id) ?? 1e9) - (at.get(b.id) ?? 1e9));
    }
    return out;
  })();
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const selLayer = selectedLayer !== null ? (layers.find((l) => l.id === selectedLayer) ?? null) : null;

  // The layer's panel floats on the side away from it (decided when it is selected, so it stays put while you drag).
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('left');
  const selRealId = selectedLayer !== null ? resolve(selectedLayer) : null;
  useEffect(() => {
    if (selectedLayer === null || frame === null) return;
    const l = layersRef.current.find((x) => x.id === selectedLayer);
    if (l === undefined) return;
    setPanelSide(place(l.params, frame).cx < frame.W * 0.45 ? 'right' : 'left');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRealId]);

  const saveLayer = useCallback(
    (lid: string): Promise<void> =>
      serial(async () => {
        const real = realOf.current.get(lid) ?? lid;
        if (real.startsWith(TEMP)) return;
        const o = overs.current.get(real);
        if (o === undefined || !o.dirty || o.removed === true) return;
        o.dirty = false;
        o.inflight += 1;
        setLayerSaving((n) => n + 1);
        const body: { params?: Params; replace?: boolean; enabled?: boolean } = {};
        if (o.params !== undefined) {
          body.params = o.params;
          body.replace = true;
        }
        if (o.visible !== undefined) body.enabled = o.visible;
        try {
          const r = await api.updateEdit(real, body, { silent: true });
          o.savedAt = r.edit?.updated ?? '';
        } catch (err) {
          if (statusOf(err) !== 404) toast.error(errMessage(err));
          // Show what the server has.
          if (overs.current.get(real) === o) overs.current.delete(real);
        } finally {
          o.inflight -= 1;
          setLayerSaving((n) => n - 1);
          bumpLayers();
          reload();
        }
      }),
    [serial, reload],
  );

  const queueLayerSave = useCallback(
    (lid: string, now: boolean): void => {
      const t = layerTimers.current.get(lid);
      if (t !== undefined) clearTimeout(t);
      layerTimers.current.delete(lid);
      if (now) void saveLayer(lid);
      else
        layerTimers.current.set(
          lid,
          setTimeout(() => {
            layerTimers.current.delete(lid);
            void saveLayer(lid);
          }, SAVE_AFTER_MS),
        );
    },
    [saveLayer],
  );

  const removeLayer = useCallback(
    (lid: string): void => {
      const o = overOf(resolve(lid));
      o.removed = true;
      o.dirty = true;
      temps.current = temps.current.filter((t) => t.id !== lid && t.real !== lid);
      const t = layerTimers.current.get(lid);
      if (t !== undefined) clearTimeout(t);
      layerTimers.current.delete(lid);
      setSelectedLayer((s) => (s === lid ? null : s));
      setEditingText((s) => (s === lid ? null : s));
      bumpLayers();
      void serial(async () => {
        const real = realOf.current.get(lid) ?? lid;
        const ov = overOf(real);
        ov.removed = true;
        ov.dirty = false;
        if (real.startsWith(TEMP)) {
          overs.current.delete(real);
          return;
        }
        ov.inflight += 1;
        try {
          await api.removeEdits([real]);
        } catch (err) {
          if (statusOf(err) !== 404) toast.error(errMessage(err));
          overs.current.delete(real);
        } finally {
          ov.inflight -= 1;
          bumpLayers();
          reload();
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serial, reload],
  );

  /** A layer's new params: `drag` shows them, `soon` saves after a rest, `now` saves at once. */
  const changeLayer = useCallback(
    (lid: string, params: Params, mode: 'drag' | 'soon' | 'now'): void => {
      // Text typed away to nothing: the layer goes.
      if (mode === 'now' && params['type'] === 'text' && String(params['text'] ?? '').trim() === '') {
        removeLayer(lid);
        return;
      }
      const o = overOf(resolve(lid));
      o.params = params;
      o.dirty = true;
      bumpLayers();
      if (mode !== 'drag') queueLayerSave(lid, mode === 'now');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueLayerSave, removeLayer],
  );

  const setLayerVisible = useCallback(
    (lid: string, on: boolean): void => {
      const o = overOf(resolve(lid));
      o.visible = on;
      o.dirty = true;
      bumpLayers();
      queueLayerSave(lid, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueLayerSave],
  );

  /** Add a layer: shown and selected at once, saved in the queue. */
  const createLayer = useCallback(
    (params: Params, opts: { text?: boolean; at?: number | undefined } = {}): void => {
      const img = latest.current.d;
      if (img === null) return;
      const tmp = TEMP + String(++tempSeq.current);
      temps.current = [...temps.current, { id: tmp, real: null, params }];
      bumpLayers();
      setSelectedLayer(tmp);
      if (opts.text === true) setEditingText(tmp);
      void serial(async () => {
        setLayerSaving((n) => n + 1);
        try {
          const r = await api.addEdit(img.id, 'layer', params, { at: opts.at }, { silent: true });
          const real = r.edit?.id;
          if (real === undefined) throw new Error('The layer was not added');
          realOf.current.set(tmp, real);
          temps.current = temps.current.map((t) => (t.id === tmp ? { ...t, real } : t));
          const o = overs.current.get(tmp);
          if (o !== undefined) {
            overs.current.delete(tmp);
            overs.current.set(real, o);
          }
          setSelectedLayer((s) => (s === tmp ? real : s));
          setEditingText((s) => (s === tmp ? real : s));
        } catch (err) {
          toast.error(errMessage(err));
          temps.current = temps.current.filter((t) => t.id !== tmp);
          overs.current.delete(tmp);
          setSelectedLayer((s) => (s === tmp ? null : s));
          setEditingText((s) => (s === tmp ? null : s));
        } finally {
          setLayerSaving((n) => n - 1);
          bumpLayers();
          reload();
        }
      });
    },
    [serial, reload],
  );

  /** Restack: the new order shows at once, the server catches up. */
  const restack = useCallback(
    (ids: string[], send: () => Promise<unknown>): void => {
      order.current = { ids, settled: 0 };
      bumpLayers();
      void serial(async () => {
        try {
          await send();
        } catch (err) {
          toast.error(errMessage(err));
          order.current = null;
        } finally {
          if (order.current !== null) order.current.settled = Date.now();
          bumpLayers();
          reload();
        }
      });
    },
    [serial, reload],
  );

  const arrangeLayer = useCallback(
    (lid: string, to: Arrange): void => {
      const ids = layersRef.current.map((l) => l.id);
      const next = arranged(ids, lid, to);
      if (next.join(',') === ids.join(',')) return;
      restack(next, () => api.arrangeLayer(resolve(lid), to));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restack],
  );

  /** Put a layer just above (or below) another, from the Layers list. */
  const moveLayer = useCallback(
    (lid: string, target: string, above: boolean): void => {
      const img = latest.current.d;
      if (img === null) return;
      const ids = layersRef.current.map((l) => l.id).filter((x) => x !== lid);
      const ti = ids.indexOf(target);
      if (ti < 0) return;
      const next = [...ids.slice(0, above ? ti + 1 : ti), lid, ...ids.slice(above ? ti + 1 : ti)];
      restack(next, async () => {
        // The move's index is in the whole stack (photo edits and layers), without the layer moved.
        const cur = latest.current.d ?? img;
        const rest = cur.stack.filter((e) => e.state === 'active' && e.id !== resolve(lid));
        const i = rest.findIndex((e) => e.id === resolve(target));
        if (i < 0) return;
        await api.moveEdit(resolve(lid), above ? i + 1 : i);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [restack],
  );

  const duplicateLayer = useCallback(
    (lid: string): void => {
      const l = layersRef.current.find((x) => x.id === lid);
      const img = latest.current.d;
      if (l === undefined || frame === null || img === null) return;
      const g = place(l.params, frame);
      const off = Math.max(8, Math.round(Math.min(frame.W, frame.H) * 0.025));
      const type = String(l.params['type'] ?? 'rect') as LayerType;
      let p = shapeOf(type) === 'line' ? unplace(l.params, { x1: g.x1 + off, y1: g.y1 + off, x2: g.x2 + off, y2: g.y2 + off }, frame) : unplace(l.params, { cx: g.cx + off, cy: g.cy + off }, frame);
      if (typeof p['name'] === 'string' && p['name'] !== '') p = { ...p, name: p['name'] + ' copy' };
      const all = img.stack.filter((e) => e.state === 'active');
      const i = all.findIndex((e) => e.id === resolve(lid));
      createLayer(p, { at: i >= 0 ? i + 1 : undefined });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame, createLayer],
  );

  const nudgeLayer = useCallback(
    (lid: string, dx: number, dy: number): void => {
      const l = layersRef.current.find((x) => x.id === lid);
      if (l === undefined || frame === null || l.locked) return;
      const g = place(l.params, frame);
      const type = String(l.params['type'] ?? 'rect') as LayerType;
      const p = shapeOf(type) === 'line' ? unplace(l.params, { x1: g.x1 + dx, y1: g.y1 + dy, x2: g.x2 + dx, y2: g.y2 + dy }, frame) : unplace(l.params, { cx: g.cx + dx, cy: g.cy + dy }, frame);
      changeLayer(lid, p, 'soon');
    },
    [frame, changeLayer],
  );

  /** The ink and look new layers take follow the last ones you set. */
  const learnInk = (p: Params): void => {
    const type = String(p['type'] ?? '');
    setInk((s) => ({
      color: typeof p['color'] === 'string' && type !== 'highlight' && type !== 'redact' ? p['color'] : s.color,
      font: typeof p['font'] === 'string' ? p['font'] : s.font,
      mode: type === 'redact' && typeof p['mode'] === 'string' ? p['mode'] : s.mode,
    }));
  };

  const drawStyle: DrawStyle = { ...ink, width: frame !== null ? defaultStroke(frame) : 6, size: frame !== null ? defaultTextSize(frame) : 48 };

  const onCreate = (type: DrawTool, g: Parameters<typeof newLayer>[1]): void => {
    if (frame === null) return;
    const extra: Params = {};
    let geo = g;
    if (type === 'step') {
      extra['n'] = layers.reduce((m, l) => (l.params['type'] === 'step' ? Math.max(m, Number(l.params['n'] ?? 0)) : m), 0) + 1;
      geo = { ...g, size: Math.max(20, Math.round(Math.min(frame.W, frame.H) / 20)) };
    }
    createLayer(newLayer(type, geo, frame, drawStyle, extra), { text: type === 'text' });
    // Pens and steps keep drawing (one stroke, one number after another); the rest hand back to Select.
    if (type !== 'pen' && type !== 'step') setLayerTool('select');
  };

  const addLogo = (asset: string, w: number, h: number): void => {
    if (frame === null) return;
    const bw = Math.round(frame.W * 0.25);
    const bh = w > 0 && h > 0 ? Math.round((bw * h) / w) : bw;
    createLayer(newLayer('logo', { cx: frame.W / 2, cy: frame.H / 2, w: bw, h: bh, angle: 0 }, frame, drawStyle, { asset }));
    setLayerTool('select');
  };

  /* ------------------------------------------------------------ tools */

  const closeTool = useCallback((): void => {
    flush();
    setTool(null);
    setBase(null);
    setProblem(null);
    setWarnings([]);
  }, [flush]);

  const startTool = useCallback(
    (kind: PixelKind, edit: Edit | null = null): void => {
      if (d === null) return;
      flush();
      setPicking(false);
      setProposal(null);
      setProblem(null);
      setWarnings([]);
      setBase(null);
      setSelectedLayer(null);
      setEditingText(null);
      setLayerTool('select');
      const dims: Dims = edit !== null ? edit.in : [d.out_width, d.out_height];
      const sid = ++sidRef.current;
      const params = edit !== null ? { ...edit.params } : TOOLS[kind].start(dims);
      if (edit !== null) {
        editOf.current.set(sid, edit.id);
        lastEditOf.current.set(sid, edit.id);
      }
      // A one-shot tool (cut out) does its job on opening; the others wait for a change.
      const oneShot = edit === null && kind === 'remove_bg';
      savedKey.current.set(sid, oneShot ? '' : JSON.stringify(params));
      const t: ToolState = { sid, kind, editId: edit?.id ?? null, params };
      toolRef.current = t;
      setTool(t);
      setMobileTab('image');
      if (oneShot && removeBgReady(params, status)) schedule({ sid, kind, params }, true);
    },
    [d, flush, schedule, status],
  );

  /** Select a layer (on the image or in the list); a photo tool that is open closes. */
  const selectLayer = useCallback(
    (lid: string | null): void => {
      if (lid !== null && toolRef.current !== null) closeTool();
      if (lid !== null) {
        setPicking(false);
        setProposal(null);
      }
      setSelectedLayer(lid);
      setEditingText((s) => (s !== null && s !== lid ? null : s));
    },
    [closeTool],
  );

  const pickLayerTool = useCallback(
    (t: LayerTool): void => {
      if (toolRef.current !== null) closeTool();
      setPicking(false);
      setProposal(null);
      setEditingText(null);
      setLayerTool(t);
      setMobileTab('image');
    },
    [closeTool],
  );

  // Cut out opened before its model was installed: it runs once the model is in.
  const bgReady = tool?.kind === 'remove_bg' && removeBgReady(tool.params, status);
  useEffect(() => {
    const t = toolRef.current;
    if (!bgReady || t === null || t.editId !== null) return;
    if (savedKey.current.get(t.sid) !== JSON.stringify(t.params)) schedule({ sid: t.sid, kind: t.kind, params: t.params }, true);
  }, [bgReady, schedule]);

  // Overlay tools: the picture the edit is placed on (the photo as it enters the edit).
  const rotKey = tool?.kind === 'crop' ? JSON.stringify(pick(tool.params, ROT_KEYS)) : '';
  const enters = toolEdit?.id;
  useEffect(() => {
    if (tool === null || d === null || TOOLS[tool.kind].view !== 'overlay') return;
    const rot = tool.kind === 'crop' ? pick(tool.params, ROT_KEYS) : {};
    const hasRot = Object.keys(rot).length > 0;
    if (enters === undefined && !hasRot && photo !== null) {
      setBase(photo.pic);
      return;
    }
    let alive = true;
    const t = setTimeout(
      () => {
        setBaseBusy(true);
        const draft = hasRot ? { kind: 'crop' as const, params: rot } : undefined;
        api
          .render(d.id, { upto: enters, draft, layers: false }, true)
          .then((r) => {
            if (alive) setBase({ url: r.url, w: r.width, h: r.height, detail: { image: d.id, upto: enters, draft, layers: false } });
          })
          .catch((err: unknown) => alive && setProblem(errMessage(err)))
          .finally(() => alive && setBaseBusy(false));
      },
      hasRot ? 220 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool?.kind, tool?.sid, enters, rotKey, d?.id, d?.updated, photo === null]);

  const waiting = tool !== null ? waitingFor(tool.kind, tool.params, cropFrame, inDims) : null;

  /* ---------------------------------------------------- quick actions */

  const quick = useCallback(
    async (q: QuickId): Promise<void> => {
      if (d === null) return;
      closeTool();
      const act = d.stack.filter((e) => e.state === 'active' && e.enabled && e.kind !== 'layer');
      const last = act[act.length - 1];
      try {
        if (q === 'auto') {
          if (act.some((e) => e.kind === 'adjust' && e.params['auto'] === true)) {
            toast.info('Auto is already on (in Adjust)');
            return;
          }
          await serial(() => api.addEdit(d.id, 'adjust', { auto: true }));
          return;
        }
        // Rotations and flips fold into a trailing rotate-only crop instead of piling up.
        const rotOnly = last !== undefined && last.kind === 'crop' && Object.keys(last.params).every((k) => k === 'turns' || k === 'flip_h' || k === 'flip_v');
        const cur = rotOnly && last !== undefined ? last.params : {};
        const next: Params = { ...cur };
        if (q === 'flip') {
          // A flip after a quarter turn mirrors what you see: across the vertical axis on screen.
          const turns = Number(cur['turns'] ?? 0);
          const key = turns % 2 === 1 ? 'flip_v' : 'flip_h';
          if (next[key] === true) delete next[key];
          else next[key] = true;
        } else {
          const turns = (Number(cur['turns'] ?? 0) + (q === 'rotate_right' ? 1 : 3)) % 4;
          if (turns === 0) delete next['turns'];
          else next['turns'] = turns;
        }
        if (rotOnly && last !== undefined) {
          if (Object.keys(next).length === 0) await serial(() => api.removeEdits([last.id]));
          else await serial(() => api.updateEdit(last.id, { params: next, replace: true }));
        } else await serial(() => api.addEdit(d.id, 'crop', next));
      } catch (err) {
        toast.error(errMessage(err));
      }
    },
    [d, closeTool, serial],
  );

  /**
   * Undo and redo, here or in a tool's bar. A change still resting before
   * its save is dropped (undo steps back from what is saved), and the open
   * tool then shows its edit as it now is, or starts over when the step took
   * its edit away. Layers show what the server has after the step.
   */
  const undo = useCallback(
    async (redo: boolean): Promise<void> => {
      if (d === null) return;
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      queued.current = null;
      for (const t of layerTimers.current.values()) clearTimeout(t);
      layerTimers.current.clear();
      while (pumping.current) await new Promise((r) => setTimeout(r, 40));
      await writes.current;
      try {
        const r = redo ? await api.redo(d.id) : await api.undo(d.id);
        overs.current.clear();
        temps.current = [];
        order.current = null;
        setEditingText(null);
        setSelectedLayer((s) => (s !== null && r.stack.some((e) => e.id === resolve(s) && e.state === 'active') ? resolve(s) : null));
        bumpLayers();
        const t = toolRef.current;
        if (t !== null) {
          const known = lastEditOf.current.get(t.sid) ?? null;
          const e = known !== null ? r.stack.find((x) => x.id === known && x.state === 'active') : undefined;
          let next: ToolState;
          if (e !== undefined) {
            editOf.current.set(t.sid, e.id);
            next = { ...t, editId: e.id, params: { ...e.params } };
          } else {
            editOf.current.delete(t.sid);
            const img = r.image as { out_width?: number; out_height?: number };
            next = { ...t, editId: null, params: TOOLS[t.kind].start([img.out_width ?? d.out_width, img.out_height ?? d.out_height]) };
          }
          savedKey.current.set(t.sid, JSON.stringify(next.params));
          toolRef.current = next;
          setTool(next);
          setProblem(null);
        }
      } catch (err) {
        toast.error(errMessage(err));
      } finally {
        reload();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, reload],
  );

  /* ------------------------------------------------- original, proposal */

  useEffect(() => {
    setOriginal(null);
  }, [d?.hash]);
  useEffect(() => {
    if (!comparing || original !== null || d === null) return;
    api
      .render(d.id, { original: true }, true)
      .then((r) => setOriginal({ url: r.url, w: r.width, h: r.height, detail: { image: d.id, original: true } }))
      .catch((err: unknown) => toast.error(errMessage(err)));
  }, [comparing, original, d]);
  useEffect(() => {
    if (proposal === null || d === null) {
      setProposalPic(null);
      return;
    }
    let alive = true;
    api
      .render(d.id, { proposal }, true)
      .then((r) => alive && setProposalPic({ url: r.url, w: r.width, h: r.height, detail: { image: d.id, proposal } }))
      .catch((err: unknown) => toast.error(errMessage(err)));
    return () => {
      alive = false;
    };
  }, [proposal, d?.id, d?.updated]);
  useEffect(() => {
    if (proposal !== null && d !== null && !d.proposals.some((p) => p.id === proposal)) setProposal(null);
  }, [d, proposal]);

  /* --------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (typing(e.target) || document.querySelector('[role="dialog"]') !== null) return;
      const k = e.key;
      const sel = selectedLayer !== null ? (layersRef.current.find((l) => l.id === selectedLayer) ?? null) : null;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const lk = k.toLowerCase();
        if (lk === 'z') {
          e.preventDefault();
          void undo(e.shiftKey);
        } else if (lk === 'y') {
          e.preventDefault();
          void undo(true);
        } else if (lk === 'e') {
          e.preventDefault();
          setSide('export');
          setMobileTab('panel');
        } else if (lk === 'd' && sel !== null) {
          e.preventDefault();
          duplicateLayer(sel.id);
        } else if ((e.code === 'BracketRight' || e.code === 'BracketLeft') && sel !== null) {
          e.preventDefault();
          const up = e.code === 'BracketRight';
          arrangeLayer(sel.id, e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward');
        }
        return;
      }
      if (e.altKey) return;
      if (k === '\\') {
        e.preventDefault();
        setComparing(true);
        return;
      }
      // The selected layer: remove, nudge, type, let go.
      if (sel !== null && tool === null) {
        if ((k === 'Delete' || k === 'Backspace') && !sel.locked) {
          e.preventDefault();
          removeLayer(sel.id);
          return;
        }
        const step = e.shiftKey ? 10 : 1;
        const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const n = nudge[k];
        if (n !== undefined) {
          e.preventDefault();
          nudgeLayer(sel.id, n[0], n[1]);
          return;
        }
        if (k === 'Enter' && sel.params['type'] === 'text' && !sel.locked) {
          e.preventDefault();
          setEditingText(sel.id);
          return;
        }
      }
      if (k === 'Escape') {
        if (selectedLayer !== null) setSelectedLayer(null);
        else if (layerTool !== 'select') setLayerTool('select');
        return;
      }
      if (k === '0') stage.current?.fit();
      else if (k === '1') stage.current?.actual();
      else if (k === '2') stage.current?.zoomTo(2);
      else if (k === '+' || k === '=') stage.current?.zoomBy(1.25);
      else if (k === '-' || k === '_') stage.current?.zoomBy(0.8);
      else if (tool === null && k === '[') void quick('rotate_left');
      else if (tool === null && k === ']') void quick('rotate_right');
      else if (tool === null && (k === 'h' || k === 'H') && !e.shiftKey) void quick('flip');
      else if (tool === null && k === 'A' && e.shiftKey) void quick('auto');
      else {
        const combo = (e.shiftKey ? 'Shift+' : '') + k.toUpperCase();
        const lt = LAYER_TOOLS.find((t) => t.key === combo);
        if (lt !== undefined) {
          e.preventDefault();
          pickLayerTool(lt.id);
          return;
        }
        if (e.shiftKey) return;
        const hit = (Object.values(TOOLS) as ToolDef[]).find((t) => t.key.toLowerCase() === k.toLowerCase());
        if (hit !== undefined && (tool === null || tool.kind !== hit.kind)) {
          e.preventDefault();
          startTool(hit.kind);
        }
      }
    };
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === '\\') setComparing(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [tool, quick, startTool, undo, selectedLayer, layerTool, duplicateLayer, arrangeLayer, removeLayer, nudgeLayer, pickLayerTool]);

  // What is on screen, for the AI agent (app.context).
  const reportTool = tool?.kind ?? (selectedLayer !== null ? 'layer' : layerTool !== 'select' ? 'layer:' + layerTool : '');
  const reportEdit = tool?.editId ?? (selectedLayer !== null && !resolve(selectedLayer).startsWith(TEMP) ? resolve(selectedLayer) : '');
  useEffect(() => {
    if (d === null) return;
    const t = setTimeout(() => {
      void api.reportUi({ view: 'workspace', image: d.id, tool: reportTool, edit: reportEdit, selection: region }).catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id, reportTool, reportEdit, region]);

  /* ----------------------------------------------------------- render */

  if (live.error !== null && d === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty icon={ImageOff} title="This image is not here" action={<Button onClick={() => navigate('home')}>Go to the library</Button>}>
          It may have been deleted. {live.error}
        </Empty>
      </div>
    );
  }
  if (d === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={18} className="text-[var(--iu-muted)]" />
      </div>
    );
  }

  const overlayTool = tool !== null && TOOLS[tool.kind].view === 'overlay';
  // Layers are drawn live over the photo, except while cropping, comparing or previewing a proposal.
  const showLayers = photo !== null && !comparing && proposalPic === null && !overlayTool;
  const picture: Picture | null = comparing ? original : proposalPic !== null ? proposalPic : overlayTool ? base : photo !== null ? photo.pic : current;
  const drawing = showLayers && !picking && layerTool !== 'select' && layerTool !== 'logo';

  const toolStatus: ToolStatus = {
    busy: saving || baseBusy || photoBusy,
    problem,
    warnings,
    out: tool !== null && tool.editId !== null && waiting === null && problem === null && !overlayTool ? [d.out_width, d.out_height] : null,
    waiting: tool?.kind === 'remove_bg' && !removeBgReady(tool.params, status) ? 'Install the model above; it cuts out as soon as it is in.' : waiting,
  };

  const logos: Record<string, string> = {};
  for (const a of assets.data?.assets ?? []) logos[a.id] = a.url;

  const layersEl = (o: OverlayApi): React.JSX.Element | null =>
    showLayers && photo !== null ? (
      <LayersOverlay
        o={o}
        fr={photo.fr}
        baseUrl={photo.pic.url}
        layers={layers}
        selected={selectedLayer}
        tool={drawing ? (layerTool as DrawTool) : 'select'}
        style={drawStyle}
        editingText={editingText}
        logos={logos}
        interactive={!picking && d.status === 'ready'}
        onSelect={selectLayer}
        onChange={(lid, params, done) => changeLayer(lid, params, done ? 'now' : 'drag')}
        onCreate={onCreate}
        onEditText={setEditingText}
      />
    ) : null;

  const overlay =
    tool?.kind === 'crop' && base !== null
      ? (o: OverlayApi) => {
          const fr: Dims = [base.w, base.h];
          const r = ratioOf(tool.params['ratio'], fr[0], fr[1]);
          const rect = (tool.params['rect'] as unknown as Region | undefined) ?? ratioRect(r, fr);
          return <CropOverlay o={o} base={fr} rect={rect} ratio={r} onChange={(nr, done) => setParams({ ...tool.params, rect: nr as unknown as Json }, done ? { now: true } : { dragging: true })} />;
        }
      : picking && tool === null && current !== null
        ? (o: OverlayApi) => (
            <>
              {layersEl(o)}
              <RegionOverlay o={o} size={[picture?.w ?? current.w, picture?.h ?? current.h]} region={region} onChange={setRegion} />
            </>
          )
        : showLayers
          ? layersEl
          : undefined;

  const badge = comparing ? (
    <Badge tone="info">Original · {original !== null ? fmtDims(original.w, original.h) : 'loading'}</Badge>
  ) : proposal !== null ? (
    <span className="iu-pop inline-flex items-center gap-1.5 rounded-[var(--iu-r)] border border-[var(--iu-accent)] bg-[var(--iu-card)] px-2 py-1 text-[12px] font-semibold shadow-[var(--iu-shadow)]">
      <Sparkles size={13} aria-hidden className="text-[var(--iu-accent-text)]" /> Preview of your AI agent's proposal
      <button type="button" onClick={() => setProposal(null)} className="ml-1 text-[var(--iu-muted)] hover:text-[var(--iu-ink)]">
        Close
      </button>
    </span>
  ) : picking ? (
    <Badge tone="info">Drag over the part your AI agent should look at</Badge>
  ) : tool !== null && overlayTool ? (
    <Badge tone="neutral">{tool.editId !== null ? 'Shown as it enters this edit, without layers' : 'Layers are hidden while you crop'}</Badge>
  ) : drawing ? (
    <Badge tone="neutral">{layerTool === 'text' || layerTool === 'step' ? 'Click to place' : layerTool === 'pen' ? 'Drag to draw' : 'Drag on the image'} · Esc to stop</Badge>
  ) : null;

  const empty =
    d.status === 'pending' ? (
      <div className="iu-on-dark flex max-w-sm flex-col items-center gap-2 rounded-[var(--iu-r-md)] bg-[var(--iu-dark)] p-4 text-center text-[var(--iu-on-dark)]">
        <Spinner size={16} />
        <p className="text-[13px] font-bold">Waiting for the image engine</p>
        <p className="text-[12px] leading-4 text-[var(--iu-on-dark-muted)]">The image is saved; it shows as soon as the engine is ready.</p>
        {status !== null && <EngineSetupNote setup={status.setup} />}
      </div>
    ) : d.status === 'failed' ? (
      <Empty icon={ImageOff} title="This image could not be shown">
        {d.error}
      </Empty>
    ) : undefined;

  const st = d.status === 'pending' ? { label: 'Waiting', tone: 'warn' as const } : d.status === 'failed' ? { label: 'Problem', tone: 'bad' as const } : d.edits_count > 0 ? { label: d.edits_count + (d.edits_count === 1 ? ' edit' : ' edits'), tone: 'neutral' as const } : { label: 'Original', tone: 'neutral' as const };
  const pending = d.proposals.filter((p) => p.kind === 'edits').length;

  const panel =
    tool !== null && def !== null ? (
      <ToolDialog def={def} status={toolStatus} canUndo={d.undo.can_undo} canRedo={d.undo.can_redo} onUndo={() => void undo(false)} onRedo={() => void undo(true)} onClose={closeTool}>
        <FormFor kind={tool.kind} params={tool.params} set={(p) => setParams(p)} dims={inDims} image={d} edit={toolEdit} />
      </ToolDialog>
    ) : showLayers && layerTool === 'logo' && !picking ? (
      <LogoChooser onPick={addLogo} onClose={() => setLayerTool('select')} />
    ) : showLayers && selLayer !== null && frame !== null && !picking && !drawing ? (
      <LayerDialog
        key={selLayer.id}
        layer={selLayer}
        fr={frame}
        busy={layerSaving > 0}
        canUndo={d.undo.can_undo}
        canRedo={d.undo.can_redo}
        onUndo={() => void undo(false)}
        onRedo={() => void undo(true)}
        onChange={(p, now) => {
          learnInk(p);
          changeLayer(selLayer.id, p, now === true ? 'now' : 'soon');
        }}
        onVisible={(on) => setLayerVisible(selLayer.id, on)}
        onLock={(on) => changeLayer(selLayer.id, on ? { ...selLayer.params, locked: true } : (({ locked: _l, ...rest }) => rest)(selLayer.params), 'now')}
        onArrange={(to) => arrangeLayer(selLayer.id, to)}
        onDuplicate={() => duplicateLayer(selLayer.id)}
        onRemove={() => removeLayer(selLayer.id)}
        onClose={() => setSelectedLayer(null)}
      />
    ) : undefined;

  const right = (
    <>
      <Tabs<Side>
        label="Panel"
        value={side}
        onChange={setSide}
        options={[
          { value: 'image', label: 'Image' },
          { value: 'export', label: 'Export' },
          { value: 'history', label: 'History' },
          {
            value: 'agent',
            label: (
              <span className="inline-flex items-center gap-1">
                <Sparkles size={12} aria-hidden className="text-[var(--iu-accent-text)]" />
                Agent
                {d.requests.some((r) => r.status === 'sent' || r.status === 'working') && <span aria-hidden className="iu-pulse size-1.5 rounded-full bg-[var(--iu-accent)]" />}
              </span>
            ),
          },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {side === 'image' && (
          <InfoPanel
            d={d}
            onAskDescribe={() => {
              setSide('agent');
              api
                .createRequest({ kind: 'describe', image: d.id })
                .then((r) => (r.asked ? toast.success(r.message) : toast.error(r.message)))
                .catch((err: unknown) => toast.error(errMessage(err)));
            }}
          />
        )}
        {side === 'export' && <ExportPanel d={d} />}
        {side === 'history' && <HistoryPanel d={d} />}
        {side === 'agent' && (
          <AgentPanel
            d={d}
            region={region}
            picking={picking}
            onPick={(on) => {
              if (on) {
                closeTool();
                setLayerTool('select');
                setSelectedLayer(null);
              }
              setPicking(on);
              if (on) setMobileTab('image');
            }}
            onClearRegion={() => {
              setRegion(null);
              setPicking(false);
            }}
          />
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {/* The image and what to do with it. */}
      <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--iu-line)] bg-[var(--iu-card)] px-2">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => back('home')} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-[13px] font-bold" title={d.name}>
            {d.name}
          </h1>
          <Badge tone={st.tone} pulse={d.status === 'pending'}>
            {st.label}
          </Badge>
          {pending > 0 && (
            <Badge tone="info" className="hidden sm:inline-flex">
              {pending === 1 ? 'A proposal' : pending + ' proposals'}
            </Badge>
          )}
          <span className="num hidden truncate text-[12px] text-[var(--iu-muted)] lg:inline">
            {d.format} {fmtDims(d.width, d.height)}
            {(d.out_width !== d.width || d.out_height !== d.height) && ' → ' + fmtDims(d.out_width, d.out_height)}
          </span>
        </div>
        <ButtonGroup label="Undo and redo">
          <IconButton icon={Undo2} size={24} label="Undo (Ctrl+Z)" disabled={!d.undo.can_undo} onClick={() => void undo(false)} />
          <IconButton icon={Redo2} size={24} label="Redo (Ctrl+Y)" disabled={!d.undo.can_redo} onClick={() => void undo(true)} />
        </ButtonGroup>
        <Button
          size="md"
          variant="accent"
          icon={FileDown}
          onClick={() => {
            setSide('export');
            setMobileTab('panel');
          }}
          className="hidden sm:inline-flex"
        >
          Export
        </Button>
        <div className="relative">
          <button ref={menuBtn} type="button" aria-label="More" title="More" onClick={() => setMenu((m) => !m)} className="flex size-7 items-center justify-center rounded-[var(--iu-r)] text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)]">
            <Ellipsis size={15} aria-hidden />
          </button>
          <Popover open={menu} onClose={() => setMenu(false)} align="right" keep={menuBtn} className="w-56">
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMenu(false);
                api.updateImage(d.id, { pinned: !d.pinned }).catch((err: unknown) => toast.error(errMessage(err)));
              }}
            >
              {d.pinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />} {d.pinned ? 'Unpin' : 'Pin to the top'}
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMenu(false);
                api
                  .duplicate(d.id)
                  .then((r) => navigate('image', { id: r.image.id }))
                  .catch((err: unknown) => toast.error(errMessage(err)));
              }}
            >
              <Copy size={14} aria-hidden /> Duplicate (try another version)
            </button>
            <a className={menuItem} href={fileUrl(d.original_url, true)} download onClick={() => setMenu(false)}>
              <Download size={14} aria-hidden /> Download the original
            </a>
            <div className="my-1 border-t border-[var(--iu-hair)]" />
            <button
              type="button"
              className={cn(menuItem, 'text-[var(--iu-red-text)] [&>svg]:text-[var(--iu-red-text)]')}
              onClick={() => {
                setMenu(false);
                void (async () => {
                  if (!(await confirm('The image, its edits and its history are deleted. Files you exported stay in Exports.', 'Delete "' + d.name + '"?'))) return;
                  try {
                    await api.deleteImages([d.id]);
                    navigate('home');
                  } catch (err) {
                    toast.error(errMessage(err));
                  }
                })();
              }}
            >
              <Trash2 size={14} aria-hidden /> Delete image
            </button>
          </Popover>
        </div>
      </header>

      {/* The toolbar. */}
      <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--iu-line)] bg-[var(--iu-card)] px-1.5">
        <Toolbar active={tool?.kind ?? null} layerTool={layerTool} disabled={d.status !== 'ready'} onTool={(k) => (tool?.kind === k ? closeTool() : startTool(k))} onQuick={(q) => void quick(q)} onLayerTool={pickLayerTool} />
      </div>

      {/* Phones and tablets: one area at a time. */}
      <Tabs
        className="bg-[var(--iu-card)] lg:hidden"
        label="Show"
        value={mobileTab}
        onChange={setMobileTab}
        options={[
          { value: 'image', label: 'Image' },
          { value: 'edits', label: 'Layers' + (pending > 0 ? ' ·' : '') },
          { value: 'panel', label: side === 'export' ? 'Export' : side === 'history' ? 'History' : side === 'agent' ? 'Agent' : 'Details' },
        ]}
      />

      <div className="flex min-h-0 flex-1">
        <aside className={cn('min-h-0 w-full flex-col bg-[var(--iu-card)] lg:flex lg:w-[248px] lg:shrink-0 lg:border-r lg:border-[var(--iu-line)] xl:w-[264px]', mobileTab === 'edits' ? 'flex' : 'hidden')}>
          <StackPanel
            d={d}
            activeEdit={tool?.editId ?? null}
            previewProposal={proposal}
            onEdit={(e) => {
              if (e.kind === 'layer') selectLayer(e.id);
              else startTool(e.kind, e);
            }}
            onPreviewProposal={(pid) => {
              closeTool();
              setSelectedLayer(null);
              setProposal(pid);
              setMobileTab('image');
            }}
            layerCount={layers.length}
            layers={
              <LayersList
                layers={layers}
                selected={selectedLayer}
                onSelect={(lid) => {
                  selectLayer(lid);
                  setLayerTool('select');
                }}
                onVisible={setLayerVisible}
                onLock={(lid, on) => {
                  const l = layers.find((x) => x.id === lid);
                  if (l === undefined) return;
                  changeLayer(lid, on ? { ...l.params, locked: true } : (({ locked: _l, ...rest }) => rest)(l.params), 'now');
                }}
                onRename={(lid, name) => {
                  const l = layers.find((x) => x.id === lid);
                  if (l === undefined) return;
                  const cur = typeof l.params['name'] === 'string' ? l.params['name'] : '';
                  if (name === cur) return;
                  changeLayer(lid, name === '' ? (({ name: _n, ...rest }) => rest)(l.params) : { ...l.params, name }, 'now');
                }}
                onRemove={removeLayer}
                onRestack={moveLayer}
              />
            }
          />
        </aside>
        <div className={cn('min-h-0 min-w-0 flex-1 flex-col lg:flex', mobileTab === 'image' ? 'flex' : 'hidden')}>
          <Stage
            handle={stage}
            picture={picture}
            overlay={overlay}
            captures={overlayTool || picking || drawing}
            backdrop={backdrop}
            onBackdrop={setBackdrop}
            busy={(saving && tool !== null) || (comparing && original === null) || (photoBusy && photo !== null)}
            badge={badge}
            empty={empty}
            panel={panel}
            panelSide={tool === null && layerTool !== 'logo' && selLayer !== null ? panelSide : 'left'}
            bar={
              <>
                <button
                  type="button"
                  title="Hold to see the original (or hold \)"
                  aria-label="Hold to see the original"
                  aria-pressed={comparing}
                  onPointerDown={() => setComparing(true)}
                  onPointerUp={() => setComparing(false)}
                  onPointerLeave={() => setComparing(false)}
                  disabled={d.edits_count === 0}
                  className={cn('inline-flex h-6 items-center gap-1 rounded-[var(--iu-r-sm)] px-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40', comparing ? 'iu-on-ink bg-[var(--iu-ink)] text-[var(--iu-shell)]' : 'text-[var(--iu-ink-2)] hover:bg-[var(--iu-row)] hover:text-[var(--iu-ink)]')}
                >
                  Original
                </button>
                {picking && (
                  <BarButton label="Stop pointing" on onClick={() => setPicking(false)}>
                    Done
                  </BarButton>
                )}
              </>
            }
            className="min-h-[300px] flex-1"
          />
        </div>
        <aside className={cn('min-h-0 w-full flex-col bg-[var(--iu-card)] lg:flex lg:w-[304px] lg:shrink-0 lg:border-l lg:border-[var(--iu-line)] xl:w-[320px]', mobileTab === 'panel' ? 'flex' : 'hidden')}>{right}</aside>
      </div>
      {confirmEl}
    </div>
  );
}
