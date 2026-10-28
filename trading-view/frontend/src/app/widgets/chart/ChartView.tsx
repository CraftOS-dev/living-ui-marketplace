/**
 * One live chart: loads bars (and older history as the person scrolls
 * back), follows the live feed, draws indicators, comparisons, alert lines
 * and the AI agent's levels, and runs the drawing tools: place, select,
 * drag points or whole drawings, restyle, lock, delete, set an alert on a
 * line. Keyboard: Alt+T/H/V/F/R, Escape, Delete; typing a letter searches a
 * symbol, typing digits changes the interval.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignJustify,
  ArrowBigDown,
  ArrowBigUp,
  ArrowRightToLine,
  Bell,
  BellPlus,
  Copy,
  Equal,
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  RectangleHorizontal,
  RotateCcw,
  Ruler,
  SeparatorVertical,
  Settings2,
  Slash,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Type,
  Unlock,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api, errMessage } from '../../lib/api.ts';
import { price as fmtPrice, pct, signed } from '../../lib/format.ts';
import { useQuote, useTail } from '../../lib/live.ts';
import { useAnalyses, useApp, useDrawings } from '../../lib/store.tsx';
import { chartColors, onThemeChange } from '../../lib/themeColors.ts';
import { chartZone } from '../../lib/time.ts';
import { INTERVALS, INTRADAY, IV_SEC } from '../../lib/types.ts';
import type { Bar, ChartType, Drawing, DrawingStyle, IndicatorConf, Interval, Meta, Point, Row, Scale, Tool } from '../../lib/types.ts';
import { ContextMenu, IconBtn, Spinner, useConfirm } from '../../components/ui.tsx';
import type { MenuEntry } from '../../components/ui.tsx';
import { ChartEngine } from './engine.ts';
import type { Legend } from './engine.ts';
import { POINTS, draftPoints } from './drawings.ts';

const INITIAL: Record<Interval, number> = { '1m': 1000, '5m': 1000, '15m': 1000, '30m': 1000, '1h': 1000, '4h': 700, '1D': 1500, '1W': 800, '1M': 400 };

const TOOLS: { tool: Tool | 'cursor'; icon: LucideIcon; label: string; key?: string }[] = [
  { tool: 'cursor', icon: MousePointer2, label: 'Cursor', key: 'Esc' },
  { tool: 'trend', icon: Slash, label: 'Trend line', key: 'Alt+T' },
  { tool: 'ray', icon: MoveUpRight, label: 'Ray' },
  { tool: 'hline', icon: Minus, label: 'Horizontal line', key: 'Alt+H' },
  { tool: 'hray', icon: ArrowRightToLine, label: 'Horizontal ray' },
  { tool: 'vline', icon: SeparatorVertical, label: 'Vertical line', key: 'Alt+V' },
  { tool: 'rect', icon: RectangleHorizontal, label: 'Rectangle' },
  { tool: 'channel', icon: Equal, label: 'Parallel channel' },
  { tool: 'fib', icon: AlignJustify, label: 'Fibonacci retracement', key: 'Alt+F' },
  { tool: 'long', icon: TrendingUp, label: 'Long position' },
  { tool: 'short', icon: TrendingDown, label: 'Short position' },
  { tool: 'text', icon: Type, label: 'Text' },
  { tool: 'arrow_up', icon: ArrowBigUp, label: 'Arrow up' },
  { tool: 'arrow_down', icon: ArrowBigDown, label: 'Arrow down' },
  { tool: 'measure', icon: Ruler, label: 'Measure' },
];

const SWATCHES = ['ink', 'accent', 'up', 'down', 'amber', 'violet', 'teal'];

function toBars(rows: Row[]): Bar[] {
  return rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
}

export interface ChartViewProps {
  symbol: string;
  interval: Interval;
  type: ChartType;
  scale: Scale;
  indicators: IndicatorConf[];
  compare: string[];
  ext: boolean;
  compact?: boolean;
  /** The person typed a letter on the chart: open the symbol search with it. */
  onTypeSymbol?: (text: string) => void;
  onInterval?: (iv: Interval) => void;
  onIndicators?: (list: IndicatorConf[]) => void;
  onEditIndicator?: (index: number) => void;
  onAlert?: (preset: { price?: number; drawing?: string }) => void;
  onAskAI?: () => void;
  onEngine?: (e: ChartEngine | null) => void;
  onMeta?: (m: Meta | null) => void;
}

interface Placing {
  tool: Tool;
  points: Point[];
  downAt: { x: number; y: number } | null;
}

interface Dragging {
  id: string;
  handle: number;
  start: Point;
  orig: Drawing;
  moved: boolean;
}

export function ChartView(props: ChartViewProps): React.JSX.Element {
  const { symbol, interval, type, scale, indicators, compare, ext, compact = false } = props;
  const app = useApp();
  const settings = app.settings;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const [legend, setLegend] = useState<Legend | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stale, setStale] = useState('');
  const [reload, setReload] = useState(0);
  const [tool, setTool] = useState<Tool | 'cursor'>('cursor');
  const [magnet, setMagnet] = useState(false);
  const [selected, setSelected] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; price: number | null; time: number | null } | null>(null);
  const [typed, setTyped] = useState('');
  const [textEdit, setTextEdit] = useState<{ id: string; value: string } | null>(null);
  const [paneTops, setPaneTops] = useState<number[]>([0]);
  const [confirmEl, confirm] = useConfirm();
  const completeRef = useRef(false);
  const olderRef = useRef(false);
  const placing = useRef<Placing | null>(null);
  const dragging = useRef<Dragging | null>(null);
  const measureRef = useRef<Drawing | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const drawingsLive = useDrawings(symbol);
  const [localDrawings, setLocalDrawings] = useState<Drawing[]>([]);
  useEffect(() => setLocalDrawings(drawingsLive.data ?? []), [drawingsLive.data]);
  const drawingsRef = useRef(localDrawings);
  drawingsRef.current = localDrawings;

  const analyses = useAnalyses(compact ? '' : symbol);
  const quote = useQuote(symbol);
  const tzMode = settings?.tz_mode ?? 'exchange';
  const agentMarkup = settings?.agent_markup !== false;

  /* ---------------------------------------------------------- lifecycle */

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const e = new ChartEngine(host);
    engineRef.current = e;
    e.onLegend = (l) => {
      setLegend(l);
      const panes = e.chart.panes();
      let top = 0;
      const tops: number[] = [];
      for (const p of panes) {
        tops.push(top);
        top += p.getHeight() + 1;
      }
      setPaneTops((prev) => (prev.length === tops.length && prev.every((v, i) => v === tops[i]) ? prev : tops));
    };
    propsRef.current.onEngine?.(e);
    const off = onThemeChange(() => e.applyTheme());
    return () => {
      off();
      propsRef.current.onEngine?.(null);
      e.destroy();
      engineRef.current = null;
    };
  }, []);

  // Bars: a new symbol, interval, extended hours or time zone reloads.
  useEffect(() => {
    const e = engineRef.current;
    if (e === null) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    completeRef.current = false;
    olderRef.current = false;
    api
      .bars(symbol, interval, { count: INITIAL[interval], ext })
      .then((r) => {
        if (cancelled) return;
        const z = chartZone(tzMode, r.meta.tz, INTRADAY[interval]);
        e.setBars(toBars(r.bars), r.meta, interval, z, r.ext);
        completeRef.current = r.complete;
        setMeta(r.meta);
        propsRef.current.onMeta?.(r.meta);
        setStale(r.stale ? r.error || 'Showing cached data' : '');
        e.chart.timeScale().applyOptions({ barSpacing: compact ? 5 : 7 });
        e.chart.timeScale().scrollToRealTime();
        if (r.bars.length === 0) setError('No bars for ' + symbol + ' at ' + interval);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, ext, tzMode, reload, compact]);

  // Dividends and splits on daily charts.
  useEffect(() => {
    const e = engineRef.current;
    if (e === null || INTRADAY[interval] || symbol.startsWith('BINANCE:')) {
      e?.setEvents(null);
      return;
    }
    let cancelled = false;
    api
      .events(symbol)
      .then((ev) => !cancelled && e.setEvents(ev))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, loading]);

  // Older history when scrolled near the start.
  useEffect(() => {
    const e = engineRef.current;
    if (e === null) return;
    const ts = e.chart.timeScale();
    const handler = (range: { from: number; to: number } | null): void => {
      if (range === null || range.from > 40 || completeRef.current || olderRef.current || e.bars.length === 0) return;
      olderRef.current = true;
      const first = e.bars[0] as Bar;
      const want = INITIAL[interval];
      api
        .bars(symbol, interval, { count: want, before: first.t, ext })
        .then((r) => {
          if (e.interval !== interval || e.bars[0]?.t !== first.t) return;
          const added = e.prepend(toBars(r.bars));
          if (added === 0 || r.complete) completeRef.current = true;
        })
        .catch(() => {
          completeRef.current = true;
        })
        .finally(() => {
          olderRef.current = false;
        });
    };
    ts.subscribeVisibleLogicalRangeChange(handler);
    return () => ts.unsubscribeVisibleLogicalRangeChange(handler);
  }, [symbol, interval, ext]);

  // Live: newest bars and the quote.
  useTail(loading ? null : `${symbol}|${interval}${ext ? '|x' : ''}`, (rows, isStale, err) => {
    const e = engineRef.current;
    if (e === null || rows.length === 0) return;
    e.applyTail(toBars(rows));
    setStale(isStale ? err || 'Showing cached data' : '');
  });
  useEffect(() => {
    const e = engineRef.current;
    if (e === null || loading || quote === undefined || quote.price === null || quote.stale === true) return;
    if (quote.state !== 'open' && quote.provider !== 'binance') return;
    e.patchLast(quote.price);
  }, [quote, loading]);

  useEffect(() => engineRef.current?.setType(type), [type]);
  useEffect(() => engineRef.current?.setScale(scale), [scale]);
  useEffect(() => engineRef.current?.setIndicators(indicators), [indicators, loading]);

  // Comparison symbols.
  const compareKey = compare.join(',');
  useEffect(() => {
    const e = engineRef.current;
    if (e === null || loading) return;
    const want = compareKey === '' ? [] : compareKey.split(',');
    for (const s of e.compareSymbols()) if (!want.includes(s)) e.setCompare(s, null);
    let cancelled = false;
    for (const s of want) {
      api
        .bars(s, interval, { count: Math.min(5000, e.bars.length + 50) })
        .then((r) => !cancelled && e.setCompare(s, toBars(r.bars)))
        .catch((err: unknown) => toast.error(s + ': ' + errMessage(err)));
    }
    return () => {
      cancelled = true;
    };
  }, [compareKey, interval, loading]);

  // Drawings and markup visibility.
  useEffect(() => {
    const e = engineRef.current;
    if (e === null) return;
    e.drawings.items = localDrawings;
    e.drawings.showAgent = agentMarkup;
    e.drawings.selected = selected;
    e.drawings.update();
  }, [localDrawings, agentMarkup, selected, loading]);

  // Price lines: alerts, the AI agent's levels, the extended-hours price.
  const latestAnalysis = useMemo(() => (analyses.data ?? []).find((a) => a.state === 'done' && a.levels.length > 0) ?? null, [analyses.data]);
  const alertLines = useMemo(
    () =>
      app.alerts
        .filter((a) => a.symbol === symbol && (a.status === 'active' || a.status === 'paused') && a.condition !== null && a.condition.left.type === 'price' && a.condition.right.type === 'value')
        .map((a) => ({ price: (a.condition?.right as { value: number }).value, status: a.status })),
    [app.alerts, symbol],
  );
  useEffect(() => {
    const e = engineRef.current;
    if (e === null || loading) return;
    const c = chartColors();
    const lines: { price: number; title: string; color: string; dashed?: boolean; axis?: boolean }[] = [];
    for (const a of alertLines) lines.push({ price: a.price, title: a.status === 'paused' ? 'Alert (paused)' : 'Alert', color: a.status === 'paused' ? c.muted : c.accent });
    if (agentMarkup && latestAnalysis !== null && !compact) for (const l of latestAnalysis.levels) lines.push({ price: l.price, title: 'AI ' + l.kind, color: c.accent, axis: true });
    if (quote !== undefined && quote.ext_price !== null && !compact) lines.push({ price: quote.ext_price, title: quote.state === 'pre' ? 'Pre' : 'Post', color: c.muted, axis: true });
    e.setPriceLines(lines);
  }, [alertLines, latestAnalysis, agentMarkup, quote?.ext_price, quote?.state, loading, type, compact, quote]);

  /* ---------------------------------------------------------- geometry */

  const local = (ev: { clientX: number; clientY: number }): { x: number; y: number; inPane: boolean } => {
    const host = hostRef.current;
    const e = engineRef.current;
    if (host === null || e === null) return { x: 0, y: 0, inPane: false };
    const r = host.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    const w = e.chart.timeScale().width();
    const h = e.chart.panes()[0]?.getHeight() ?? r.height;
    return { x, y, inPane: x >= 0 && x <= w && y >= 0 && y <= h };
  };

  const pointAt = (x: number, y: number, snap: boolean): Point => {
    const e = engineRef.current;
    if (e === null) return { t: null, p: null };
    const t = e.xToTime(x);
    let p = e.main.coordinateToPrice(y) as number | null;
    if (snap && p !== null) {
      const b = e.barAt(x);
      if (b !== null) {
        let bestV = b.c;
        for (const v of [b.o, b.h, b.l, b.c]) if (Math.abs(v - p) < Math.abs(bestV - p)) bestV = v;
        const by = e.main.priceToCoordinate(bestV);
        if (by !== null && Math.abs(by - y) < 30) p = bestV;
      }
    }
    if (t !== null && INTRADAY[interval] === false && e.bars.length > 0) {
      // Daily and longer: snap to the bar's own time so points sit on bars.
      const b = e.barAt(x);
      if (b !== null && Math.abs(e.logicalOf(t) - e.logicalOf(b.t)) < 0.5) return { t: b.t, p };
    }
    return { t, p };
  };

  /* ------------------------------------------------------------ drawing */

  const saveNew = useCallback(
    async (d: Drawing) => {
      const tempId = d.id;
      setLocalDrawings((list) => [...list, d]);
      try {
        const style: DrawingStyle = d.style;
        const r = await api.addDrawing({ symbol, tool: d.tool, points: d.points, style, text: d.text });
        setLocalDrawings((list) => list.map((x) => (x.id === tempId ? r.drawing : x)));
        setSelected(r.drawing.id);
        if (d.tool === 'text') setTextEdit({ id: r.drawing.id, value: r.drawing.text });
      } catch (err) {
        setLocalDrawings((list) => list.filter((x) => x.id !== tempId));
        toast.error(errMessage(err));
      }
    },
    [symbol],
  );

  const updateDrawing = useCallback((id: string, patch: Partial<Pick<Drawing, 'points' | 'style' | 'text' | 'locked' | 'hidden'>>) => {
    const before = drawingsRef.current.find((d) => d.id === id);
    setLocalDrawings((list) => list.map((d) => (d.id === id ? { ...d, ...patch, style: patch.style !== undefined ? { ...d.style, ...patch.style } : d.style } : d)));
    api.updateDrawing(id, patch, true).catch((err: unknown) => {
      if (before !== undefined) setLocalDrawings((list) => list.map((d) => (d.id === id ? before : d)));
      toast.error(errMessage(err));
    });
  }, []);

  const deleteDrawing = useCallback((id: string) => {
    const before = drawingsRef.current;
    setLocalDrawings((list) => list.filter((d) => d.id !== id));
    setSelected('');
    api.deleteDrawings([id]).catch((err: unknown) => {
      setLocalDrawings(before);
      toast.error(errMessage(err));
    });
  }, []);

  const blank = (tool: Tool, points: Point[]): Drawing => ({
    id: 'draft' + Math.random().toString(36).slice(2),
    symbol,
    tool,
    points,
    style: tool === 'trend' || tool === 'ray' ? { color: 'ink', width: 1.5 } : { color: 'ink' },
    text: '',
    locked: false,
    hidden: false,
    added_by: 'user',
    run: '',
    note: '',
    created: '',
  });

  const setDraft = (d: Drawing | null): void => {
    const e = engineRef.current;
    if (e === null) return;
    e.drawings.draft = d;
    e.drawings.update();
  };

  const finishPlacing = (pl: Placing): void => {
    placing.current = null;
    setDraft(null);
    setTool('cursor');
    if (pl.tool === 'measure') return;
    void saveNew(blank(pl.tool, pl.points));
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>): void => {
    if (ev.button !== 0) return;
    // Only presses on the plot itself: the legend, the drawing toolbar and
    // other overlays handle their own clicks.
    if (!(ev.target instanceof HTMLCanvasElement)) return;
    const e = engineRef.current;
    if (e === null || loading) return;
    const { x, y, inPane } = local(ev);
    if (!inPane) return;
    wrapRef.current?.focus({ preventScroll: true });
    if (measureRef.current !== null && tool !== 'measure') {
      measureRef.current = null;
      setDraft(null);
    }
    const snap = magnet !== ev.ctrlKey;
    if (tool !== 'cursor') {
      ev.stopPropagation();
      ev.preventDefault();
      const pt = pointAt(x, y, snap);
      if (pt.t === null || pt.p === null) return;
      if (tool === 'long' || tool === 'short') {
        const last = e.bars[e.bars.length - 1];
        const ref = pt.p;
        const risk = Math.abs(ref) * (INTRADAY[interval] ? 0.006 : 0.03);
        const dir = tool === 'long' ? 1 : -1;
        const end = pt.t + IV_SEC[interval] * 24;
        placing.current = null;
        setTool('cursor');
        void saveNew(blank(tool, [{ t: pt.t, p: ref }, { t: Math.max(end, last?.t ?? end), p: ref + dir * risk * 2 }, { t: null, p: ref - dir * risk }]));
        return;
      }
      const need = POINTS[tool];
      const pl = placing.current ?? { tool, points: [], downAt: null };
      const pts = tool === 'hline' ? [{ t: pt.t, p: pt.p }] : tool === 'vline' ? [{ t: pt.t, p: pt.p }] : [...pl.points, pt];
      pl.points = pts;
      pl.downAt = { x, y };
      placing.current = pl;
      if (pts.length >= need) {
        if (tool === 'measure') {
          const d = blank('measure', pts);
          measureRef.current = d;
          placing.current = null;
          setDraft(d);
          setTool('cursor');
          return;
        }
        finishPlacing(pl);
        return;
      }
      setDraft(blank(tool, draftPoints(tool, pts, pt)));
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
      return;
    }
    const hit = e.drawings.hit(x, y);
    if (hit === null) {
      if (selected !== '') setSelected('');
      return;
    }
    ev.stopPropagation();
    ev.preventDefault();
    setSelected(hit.id);
    const d = drawingsRef.current.find((q) => q.id === hit.id);
    if (d === undefined || d.locked) return;
    dragging.current = { id: hit.id, handle: hit.handle, start: pointAt(x, y, false), orig: d, moved: false };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>): void => {
    const e = engineRef.current;
    if (e === null) return;
    const { x, y, inPane } = local(ev);
    const snap = magnet !== ev.ctrlKey;
    const pl = placing.current;
    if (pl !== null) {
      const pt = pointAt(x, y, snap);
      if (pt.t === null || pt.p === null) return;
      setDraft(blank(pl.tool, draftPoints(pl.tool, pl.points, pt)));
      return;
    }
    const dr = dragging.current;
    if (dr !== null) {
      const pt = pointAt(x, y, snap && dr.handle >= 0);
      if (pt.t === null || pt.p === null || dr.start.t === null || dr.start.p === null) return;
      dr.moved = true;
      const dt = pt.t - dr.start.t;
      const dp = pt.p - dr.start.p;
      const pts = dr.orig.points.map((q, i) => {
        if (dr.handle >= 0) {
          if (i !== dr.handle) return q;
          if (dr.orig.tool === 'hline') return { t: q.t, p: pt.p };
          if (dr.orig.tool === 'vline') return { t: pt.t, p: q.p };
          if ((dr.orig.tool === 'long' || dr.orig.tool === 'short') && i === 2) return { t: null, p: pt.p };
          return pt;
        }
        return { t: q.t === null ? null : q.t + dt, p: q.p === null ? null : q.p + dp };
      });
      setDraft({ ...dr.orig, points: pts });
      return;
    }
    if (!inPane) {
      if (e.drawings.hover !== '') {
        e.drawings.hover = '';
        e.drawings.update();
      }
      return;
    }
    const hit = tool === 'cursor' ? e.drawings.hit(x, y) : null;
    const id = hit?.id ?? '';
    if (hostRef.current !== null) hostRef.current.style.cursor = tool !== 'cursor' ? 'crosshair' : hit !== null ? (hit.handle >= 0 ? 'grab' : 'pointer') : '';
    if (id !== e.drawings.hover) {
      e.drawings.hover = id;
      e.drawings.update();
    }
  };

  const onPointerUp = (ev: React.PointerEvent<HTMLDivElement>): void => {
    const e = engineRef.current;
    if (e === null) return;
    const pl = placing.current;
    if (pl !== null && pl.downAt !== null && pl.points.length === 1 && POINTS[pl.tool] === 2) {
      // Click-drag-release places both points of a two-point tool.
      const { x, y } = local(ev);
      if (Math.hypot(x - pl.downAt.x, y - pl.downAt.y) > 6) {
        const pt = pointAt(x, y, magnet !== ev.ctrlKey);
        if (pt.t !== null && pt.p !== null) {
          pl.points = [...pl.points, pt];
          if (pl.tool === 'measure') {
            const d = blank('measure', pl.points);
            measureRef.current = d;
            placing.current = null;
            setDraft(d);
            setTool('cursor');
            return;
          }
          finishPlacing(pl);
        }
      }
      return;
    }
    const dr = dragging.current;
    dragging.current = null;
    if (dr === null) return;
    const draft = e.drawings.draft;
    setDraft(null);
    if (!dr.moved || draft === null) return;
    updateDrawing(dr.id, { points: draft.points });
  };

  const cancelAll = useCallback(() => {
    placing.current = null;
    dragging.current = null;
    measureRef.current = null;
    setDraft(null);
    setTool('cursor');
    setSelected('');
  }, []);

  /* ------------------------------------------------------------ keyboard */

  const typedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>): void => {
    if (ev.target !== wrapRef.current) return;
    const k = ev.key;
    if (k === 'Escape') {
      if (typed !== '') setTyped('');
      cancelAll();
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && selected !== '') {
      ev.preventDefault();
      deleteDrawing(selected);
      return;
    }
    if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      const map: Record<string, Tool> = { t: 'trend', h: 'hline', v: 'vline', f: 'fib' };
      const key = k.toLowerCase();
      if (map[key] !== undefined) {
        ev.preventDefault();
        setTool(map[key] as Tool);
        return;
      }
      if (key === 'r') {
        ev.preventDefault();
        engineRef.current?.autoScale();
        return;
      }
      if (key === 'a') {
        ev.preventDefault();
        const last = quote?.price ?? engineRef.current?.bars.at(-1)?.c ?? null;
        props.onAlert?.(last !== null ? { price: last } : {});
        return;
      }
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (/^[0-9]$/.test(k) || (typed !== '' && /^[0-9mhdwMHDW]$/.test(k))) {
      ev.preventDefault();
      const next = (typed + k).slice(0, 4);
      setTyped(next);
      if (typedTimer.current !== null) clearTimeout(typedTimer.current);
      typedTimer.current = setTimeout(() => setTyped(''), 2500);
      return;
    }
    if (k === 'Enter' && typed !== '') {
      ev.preventDefault();
      const iv = parseInterval(typed);
      setTyped('');
      if (iv !== null) props.onInterval?.(iv);
      else toast.error('"' + typed + '" is not an interval');
      return;
    }
    if (/^[a-zA-Z^]$/.test(k) && props.onTypeSymbol !== undefined) {
      ev.preventDefault();
      props.onTypeSymbol(k.toUpperCase());
    }
  };

  /* -------------------------------------------------------- context menu */

  const onContextMenu = (ev: React.MouseEvent<HTMLDivElement>): void => {
    if (!(ev.target instanceof HTMLCanvasElement)) return;
    const e = engineRef.current;
    if (e === null) return;
    const { x, y, inPane } = local(ev);
    if (!inPane) return;
    ev.preventDefault();
    const hit = e.drawings.hit(x, y);
    if (hit !== null) setSelected(hit.id);
    setMenu({ x: ev.clientX, y: ev.clientY, price: e.main.coordinateToPrice(y), time: e.xToTime(x) });
  };

  const hint = meta?.price_hint;
  const menuItems = (): MenuEntry[] => {
    if (menu === null) return [];
    const p = menu.price;
    const items: MenuEntry[] = [];
    const sel = localDrawings.find((d) => d.id === selected);
    if (sel !== undefined) {
      items.push({ heading: sel.added_by === 'agent' ? 'AI agent drawing' : 'Drawing' });
      if (sel.added_by === 'agent') items.push({ label: 'Keep as my drawing', icon: Sparkles, onClick: () => void api.adopt({ drawing: sel.id }).catch((err: unknown) => toast.error(errMessage(err))) });
      if (['trend', 'ray', 'extended', 'hline', 'hray'].includes(sel.tool)) items.push({ label: 'Alert when price crosses it', icon: BellPlus, onClick: () => props.onAlert?.({ drawing: sel.id }) });
      items.push({ label: sel.locked ? 'Unlock' : 'Lock', icon: sel.locked ? Unlock : Lock, onClick: () => updateDrawing(sel.id, { locked: !sel.locked }) });
      items.push({ label: 'Delete drawing', icon: Trash2, danger: true, hint: 'Del', onClick: () => deleteDrawing(sel.id) });
      items.push('divider');
    }
    if (p !== null) {
      items.push({ label: 'Alert at ' + fmtPrice(p, hint), icon: Bell, hint: 'Alt+A', onClick: () => props.onAlert?.({ price: p }) });
      items.push({ label: 'Horizontal line at ' + fmtPrice(p, hint), icon: Minus, onClick: () => void saveNew(blank('hline', [{ t: menu.time ?? Math.floor(Date.now() / 1000), p }])) });
      items.push({ label: 'Copy price ' + fmtPrice(p, hint), icon: Copy, onClick: () => void navigator.clipboard?.writeText(fmtPrice(p, hint).replace(/,/g, '')) });
      items.push('divider');
    }
    items.push({ label: 'Reset chart view', icon: RotateCcw, hint: 'Alt+R', onClick: () => engineRef.current?.autoScale() });
    items.push({ label: agentMarkup ? 'Hide AI markup' : 'Show AI markup', icon: agentMarkup ? EyeOff : Eye, onClick: () => app.updateSettings({ agent_markup: !agentMarkup }) });
    if (props.onAskAI !== undefined) items.push({ label: 'Ask AI about this chart', icon: Sparkles, onClick: () => props.onAskAI?.() });
    if (localDrawings.some((d) => d.added_by === 'user')) {
      items.push('divider');
      items.push({
        label: 'Remove my drawings on ' + symbol.replace('BINANCE:', ''),
        icon: Trash2,
        danger: true,
        onClick: () =>
          void confirm('Every drawing you made on ' + symbol + ' goes away (on every chart of it). Undo brings them back.', 'Remove your drawings?', 'Remove').then((ok) => {
            if (ok) void api.clearDrawings(symbol, 'user').catch((err: unknown) => toast.error(errMessage(err)));
          }),
      });
    }
    return items;
  };

  /* ------------------------------------------------------------- render */

  const bar = legend?.bar ?? null;
  const prev = legend?.prev ?? null;
  const chg = bar !== null && prev !== null ? bar.c - prev.c : null;
  const chgPct = chg !== null && prev !== null && prev.c !== 0 ? (chg / prev.c) * 100 : null;
  const barTone = bar === null ? 'text-[var(--tv-ink)]' : bar.c >= bar.o ? 'text-[var(--tv-up-text)]' : 'text-[var(--tv-down-text)]';
  const sel = localDrawings.find((d) => d.id === selected) ?? null;

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative flex h-full min-h-0 w-full min-w-0 outline-none"
      onContextMenu={onContextMenu}
    >
      {!compact && (
        <div className="tv-nodrag flex w-[30px] shrink-0 flex-col items-center gap-px overflow-y-auto border-r border-[var(--tv-hair)] py-1">
          {TOOLS.map((t) => (
            <IconBtn
              key={t.tool}
              icon={t.icon}
              size={26}
              label={t.label + (t.key !== undefined ? ' (' + t.key + ')' : '')}
              active={tool === t.tool}
              onClick={() => {
                placing.current = null;
                setDraft(measureRef.current);
                setTool(t.tool);
                wrapRef.current?.focus({ preventScroll: true });
              }}
            />
          ))}
          <span className="my-1 h-px w-5 shrink-0 bg-[var(--tv-hair)]" />
          <IconBtn icon={Magnet} size={26} label="Magnet: snap to open, high, low and close (Ctrl inverts)" active={magnet} onClick={() => setMagnet((m) => !m)} />
          <IconBtn icon={Sparkles} size={26} label={agentMarkup ? 'Hide AI markup' : 'Show AI markup'} active={agentMarkup} onClick={() => app.updateSettings({ agent_markup: !agentMarkup })} />
        </div>
      )}
      <div className="relative min-h-0 min-w-0 flex-1" onPointerDownCapture={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <div ref={hostRef} className="absolute inset-0" />

        {/* Legend */}
        <div className="pointer-events-none absolute left-2 top-1 z-[2] flex max-w-[calc(100%-80px)] flex-col gap-px text-[11.5px] leading-[17px] [text-shadow:0_0_3px_var(--tv-card),0_0_2px_var(--tv-card)]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0">
            {bar !== null && (
              <span className="num flex flex-wrap gap-x-2 font-semibold">
                <span className="text-[var(--tv-muted)]">
                  O <span className={barTone}>{fmtPrice(bar.o, hint)}</span>
                </span>
                <span className="text-[var(--tv-muted)]">
                  H <span className={barTone}>{fmtPrice(bar.h, hint)}</span>
                </span>
                <span className="text-[var(--tv-muted)]">
                  L <span className={barTone}>{fmtPrice(bar.l, hint)}</span>
                </span>
                <span className="text-[var(--tv-muted)]">
                  C <span className={barTone}>{fmtPrice(bar.c, hint)}</span>
                </span>
                {chg !== null && (
                  <span className={chg >= 0 ? 'text-[var(--tv-up-text)]' : 'text-[var(--tv-down-text)]'}>
                    {signed(chg, hint)} ({pct(chgPct)})
                  </span>
                )}
              </span>
            )}
            {stale !== '' && (
              <span title={stale} className="pointer-events-auto rounded-[3px] bg-[var(--tv-row)] px-1 text-[10.5px] font-bold uppercase text-[var(--tv-warn)]">
                Cached
              </span>
            )}
          </div>
          {legend?.compare.map((c) => (
            <span key={c.symbol} className="num font-semibold" style={{ color: c.color }}>
              {c.symbol.replace('BINANCE:', '')} {c.value}
            </span>
          ))}
          {!compact &&
            legend?.indicators
              .filter((i) => i.pane === 0)
              .map((i) => <IndicatorLegend key={i.key} item={i} props={props} />)}
        </div>
        {!compact &&
          legend?.indicators
            .filter((i) => i.pane > 0)
            .map((i) => (
              <div key={i.key} className="pointer-events-none absolute left-2 z-[2] text-[11.5px] leading-[17px] [text-shadow:0_0_3px_var(--tv-card),0_0_2px_var(--tv-card)]" style={{ top: (paneTops[i.pane] ?? 0) + 3 }}>
                <IndicatorLegend item={i} props={props} />
              </div>
            ))}

        {/* Selected drawing toolbar */}
        {sel !== null && !compact && (
          <DrawingBar
            d={sel}
            onStyle={(style) => updateDrawing(sel.id, { style })}
            onLock={() => updateDrawing(sel.id, { locked: !sel.locked })}
            onDelete={() => deleteDrawing(sel.id)}
            onText={() => setTextEdit({ id: sel.id, value: sel.text })}
            onAlert={['trend', 'ray', 'extended', 'hline', 'hray'].includes(sel.tool) ? () => props.onAlert?.({ drawing: sel.id }) : undefined}
            onAdopt={sel.added_by === 'agent' ? () => void api.adopt({ drawing: sel.id }).catch((err: unknown) => toast.error(errMessage(err))) : undefined}
            onClose={() => setSelected('')}
          />
        )}

        {textEdit !== null && (
          <div className="tv-pop absolute left-1/2 top-10 z-[5] flex -translate-x-1/2 items-center gap-1 rounded-[6px] border border-[var(--tv-line)] bg-[var(--tv-card)] p-1 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)]">
            <input
              autoFocus
              value={textEdit.value}
              maxLength={500}
              placeholder="Label"
              aria-label="Drawing label"
              onChange={(ev) => setTextEdit({ ...textEdit, value: ev.target.value })}
              onKeyDown={(ev) => {
                ev.stopPropagation();
                if (ev.key === 'Enter') {
                  updateDrawing(textEdit.id, { text: textEdit.value.trim() });
                  setTextEdit(null);
                }
                if (ev.key === 'Escape') setTextEdit(null);
              }}
              onBlur={() => {
                updateDrawing(textEdit.id, { text: textEdit.value.trim() });
                setTextEdit(null);
              }}
              className="h-7 w-56 rounded-[4px] border border-[var(--tv-line)] bg-[var(--tv-card)] px-2 text-[12.5px] outline-none"
            />
          </div>
        )}

        {typed !== '' && (
          <div className="tv-pop pointer-events-none absolute left-1/2 top-1/2 z-[5] -translate-x-1/2 -translate-y-1/2 rounded-[6px] border border-[var(--tv-line)] bg-[var(--tv-card)] px-4 py-2 text-center shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)]">
            <div className="text-[11px] font-semibold text-[var(--tv-muted)]">Interval</div>
            <div className="num text-[22px] font-bold">{typed}</div>
            <div className="text-[11px] text-[var(--tv-muted)]">{parseInterval(typed) ?? 'm, h, D, W or M'} · Enter</div>
          </div>
        )}

        {tool !== 'cursor' && !compact && (
          <div className="pointer-events-none absolute bottom-[30px] left-1/2 z-[3] -translate-x-1/2 rounded-[4px] bg-[var(--tv-tooltip)] px-2 py-0.5 text-[11px] font-semibold text-[var(--tv-on-tooltip)]">
            {TOOLS.find((t) => t.tool === tool)?.label}: {tool === 'long' || tool === 'short' ? 'click the entry' : POINTS[tool as Tool] === 1 ? 'click to place' : 'click or drag'} · Esc cancels
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-[4] flex items-center justify-center bg-[var(--tv-card)]/40">
            <Spinner size={18} className="text-[var(--tv-muted)]" />
          </div>
        )}
        {error !== '' && !loading && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-2 bg-[var(--tv-card)] px-6 text-center">
            <p className="text-[12.5px] font-semibold">Could not load {symbol}</p>
            <p className="max-w-sm text-[12px] text-[var(--tv-muted)]">{error}</p>
            <button type="button" className="text-[12px] font-semibold text-[var(--tv-accent-text)] hover:underline" onClick={() => setReload((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}
      </div>
      <ContextMenu at={menu} items={menuItems()} onClose={() => setMenu(null)} />
      {confirmEl}
    </div>
  );
}

function parseInterval(s: string): Interval | null {
  const m = /^(\d+)([mhdwMHDW]?)$/.exec(s);
  if (m === null) return null;
  const n = Number(m[1]);
  const u = m[2] ?? '';
  let iv = '';
  if (u === '' || u === 'm') iv = n === 60 ? '1h' : n === 240 ? '4h' : n + 'm';
  else if (u.toLowerCase() === 'h') iv = n + 'h';
  else if (u.toLowerCase() === 'd') iv = n + 'D';
  else if (u.toLowerCase() === 'w') iv = n + 'W';
  else if (u === 'M') iv = n + 'M';
  return (INTERVALS as string[]).includes(iv) ? (iv as Interval) : null;
}

function IndicatorLegend({ item, props }: { item: Legend['indicators'][number]; props: ChartViewProps }): React.JSX.Element {
  const list = props.indicators;
  return (
    <span className="group pointer-events-auto flex flex-wrap items-center gap-x-1.5">
      <span className={cn('font-semibold', item.hidden ? 'text-[var(--tv-muted)]' : 'text-[var(--tv-ink-2)]')}>{item.label}</span>
      {!item.hidden &&
        item.values.map((v) => (
          <span key={v.label} className="num font-semibold" style={{ color: v.color }} title={v.label}>
            {v.value}
          </span>
        ))}
      {props.onIndicators !== undefined && (
        <span className="hidden items-center gap-px group-hover:inline-flex">
          <IconBtn
            icon={item.hidden ? Eye : EyeOff}
            size={18}
            label={item.hidden ? 'Show' : 'Hide'}
            onClick={() => props.onIndicators?.(list.map((x, i) => (i === item.index ? { ...x, hidden: !(x.hidden === true) } : x)))}
          />
          {props.onEditIndicator !== undefined && <IconBtn icon={Settings2} size={18} label="Settings" onClick={() => props.onEditIndicator?.(item.index)} />}
          <IconBtn icon={X} size={18} label="Remove" onClick={() => props.onIndicators?.(list.filter((_, i) => i !== item.index))} />
        </span>
      )}
    </span>
  );
}

function DrawingBar({
  d,
  onStyle,
  onLock,
  onDelete,
  onText,
  onAlert,
  onAdopt,
  onClose,
}: {
  d: Drawing;
  onStyle: (s: DrawingStyle) => void;
  onLock: () => void;
  onDelete: () => void;
  onText: () => void;
  onAlert: (() => void) | undefined;
  onAdopt: (() => void) | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const c = chartColors();
  return (
    <div className="tv-pop tv-nodrag absolute left-1/2 top-1 z-[4] flex -translate-x-1/2 items-center gap-0.5 rounded-[6px] border border-[var(--tv-line)] bg-[var(--tv-card)] p-0.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)]" onPointerDown={(e) => e.stopPropagation()}>
      {d.added_by === 'agent' && (
        <span className="flex items-center gap-1 px-1.5 text-[11px] font-bold text-[var(--tv-accent-text)]" title={d.note || 'Drawn by your AI agent'}>
          <Sparkles size={12} /> AI
        </span>
      )}
      {SWATCHES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={'Color ' + s}
          title={s}
          onClick={() => onStyle({ color: s })}
          className={cn('flex size-6 items-center justify-center rounded-[4px] hover:bg-[var(--tv-row)]', (d.style.color ?? (d.added_by === 'agent' ? 'accent' : 'ink')) === s && 'bg-[var(--tv-row-hover)]')}
        >
          <span className="size-3 rounded-full" style={{ background: c.named[s] }} />
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-[var(--tv-hair)]" />
      {[1, 2, 3].map((w) => (
        <button key={w} type="button" aria-label={'Width ' + w} title={'Width ' + w} onClick={() => onStyle({ width: w })} className={cn('flex h-6 w-6 items-center justify-center rounded-[4px] hover:bg-[var(--tv-row)]', Math.round(d.style.width ?? 1) === w && 'bg-[var(--tv-row-hover)]')}>
          <span className="w-3.5 rounded-full bg-[var(--tv-ink)]" style={{ height: w }} />
        </button>
      ))}
      <button type="button" title="Dashed" aria-label="Dashed" onClick={() => onStyle({ dash: !(d.style.dash === true) })} className={cn('flex h-6 w-6 items-center justify-center rounded-[4px] text-[13px] font-bold hover:bg-[var(--tv-row)]', d.style.dash === true && 'bg-[var(--tv-row-hover)]')}>
        ┄
      </button>
      {d.tool === 'trend' && (
        <button type="button" title="Extend right" aria-label="Extend right" onClick={() => onStyle({ extend_right: !(d.style.extend_right === true) })} className={cn('flex h-6 items-center rounded-[4px] px-1 text-[11px] font-bold hover:bg-[var(--tv-row)]', d.style.extend_right === true && 'bg-[var(--tv-row-hover)]')}>
          →
        </button>
      )}
      <span className="mx-0.5 h-4 w-px bg-[var(--tv-hair)]" />
      <IconBtn icon={Pencil} size={24} label="Label" onClick={onText} />
      {onAlert !== undefined && <IconBtn icon={BellPlus} size={24} label="Alert when price crosses it" onClick={onAlert} />}
      {onAdopt !== undefined && (
        <button type="button" onClick={onAdopt} className="h-6 rounded-[4px] px-1.5 text-[11.5px] font-semibold text-[var(--tv-accent-text)] hover:bg-[var(--tv-row)]">
          Keep
        </button>
      )}
      <IconBtn icon={d.locked ? Lock : Unlock} size={24} label={d.locked ? 'Unlock' : 'Lock'} active={d.locked} onClick={onLock} />
      <IconBtn icon={Trash2} size={24} label="Delete (Del)" onClick={onDelete} />
      <IconBtn icon={X} size={24} label="Done" onClick={onClose} />
    </div>
  );
}
