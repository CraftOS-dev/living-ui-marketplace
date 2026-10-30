/**
 * App state shared by the top bar and the widgets: settings, workspaces, the
 * active workspace with its widgets and link channels, watchlists and
 * alerts, all kept live (an AI agent's change shows up at once). Edits are
 * applied locally first, then sent to the operations.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from '../../kit/index.ts';
import { api, errMessage } from './api.ts';
import { onRecord, useLive } from './live.ts';
import type { Alert, Analysis, Channel, Drawing, Interval, Settings, WatchList, Widget, WidgetConfig, WidgetType, Workspace } from './types.ts';
import type { Live } from './live.ts';

export interface Shows {
  symbol: string;
  interval: Interval;
  link: string;
}

interface AppState {
  settings: Settings | null;
  workspaces: (Workspace & { widgets: number })[];
  activeId: string;
  ws: (Workspace & { widgets: Widget[] }) | null;
  wsLoading: boolean;
  lists: WatchList[];
  alerts: Alert[];
  unseen: number;
  focused: string;
  setFocused: (id: string) => void;
  maximized: string;
  setMaximized: (id: string) => void;
  activate: (id: string) => void;
  reloadWorkspaces: () => void;
  shows: (w: Widget) => Shows;
  /** Show a symbol (and/or interval) on a widget: its channel, or its own config. */
  show: (w: Widget | null, p: { symbol?: string; interval?: Interval }) => void;
  focusChannel: (channel: string, p: { symbol?: string; interval?: Interval }) => void;
  configure: (w: Widget, patch: WidgetConfig, link?: string) => void;
  addWidget: (type: WidgetType, p?: { link?: string; config?: WidgetConfig; w?: number; h?: number }) => Promise<Widget | null>;
  removeWidget: (w: Widget) => void;
  saveLayout: (items: { id: string; x: number; y: number; w: number; h: number }[]) => void;
  updateSettings: (p: Partial<Settings>) => void;
  reloadAlerts: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (c === null) throw new Error('useApp outside AppProvider');
  return c;
}

/** A short beep for fired alerts (no audio file needed). */
function beep(): void {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    o.onended = () => void ctx.close();
  } catch {
    /* audio blocked until the person interacts: the toast still shows */
  }
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const spaces = useLive(() => api.workspaces(), ['workspaces', 'settings'], []);
  const [settingsLocal, setSettingsLocal] = useState<Settings | null>(null);
  const settings = settingsLocal ?? spaces.data?.settings ?? null;
  useEffect(() => {
    if (spaces.data !== null) setSettingsLocal(null);
  }, [spaces.data]);

  const [activeId, setActiveId] = useState('');
  useEffect(() => {
    const d = spaces.data;
    if (d === null) return;
    if (activeId === '' || !d.workspaces.some((w) => w.id === activeId)) setActiveId(d.active);
  }, [spaces.data, activeId]);

  const wsLive = useLive(
    () => (activeId === '' ? Promise.resolve(null) : api.workspace(activeId).then((r) => r.workspace)),
    ['workspaces', 'widgets'],
    [activeId],
    (e) => e.record['workspace'] === activeId || e.record['id'] === activeId || e.record['collectionName'] === 'widgets',
  );
  const [wsLocal, setWsLocal] = useState<(Workspace & { widgets: Widget[] }) | null>(null);
  useEffect(() => setWsLocal(wsLive.data), [wsLive.data]);
  const ws = wsLocal !== null && wsLocal.id === activeId ? wsLocal : null;

  const lists = useLive(() => api.watchlists().then((r) => r.watchlists), ['watchlists', 'watch_items'], []);
  const alerts = useLive(() => api.alerts(), ['alerts', 'alert_events'], []);

  const [focused, setFocused] = useState('');
  const [maximized, setMaximized] = useState('');

  // Palette and sound follow settings.
  useEffect(() => {
    document.documentElement.dataset['palette'] = settings?.palette ?? 'green_red';
  }, [settings?.palette]);
  const soundRef = useRef(true);
  soundRef.current = settings?.sound !== false;

  // A fired alert: toast it (and beep) wherever the person is.
  useEffect(
    () =>
      onRecord('alert_events', (e) => {
        if (e.action !== 'create') return;
        const detail = String(e.record['detail'] ?? 'An alert fired');
        toast.info('Alert: ' + detail);
        if (soundRef.current) beep();
      }),
    [],
  );

  const wsRef = useRef(ws);
  wsRef.current = ws;

  const activate = useCallback((id: string) => {
    setActiveId(id);
    setFocused('');
    setMaximized('');
    void api.activate(id).catch(() => undefined);
  }, []);

  const shows = useCallback(
    (w: Widget): Shows => {
      const cur = wsRef.current;
      const c = w.config;
      if (w.link !== '' && cur !== null) {
        const ch: Partial<Channel> = cur.links[w.link] ?? {};
        return { symbol: ch.symbol ?? c.symbol ?? 'AAPL', interval: c.interval_own === true ? (c.interval ?? '1D') : (ch.interval ?? c.interval ?? '1D'), link: w.link };
      }
      return { symbol: c.symbol ?? 'AAPL', interval: c.interval ?? '1D', link: '' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws],
  );

  const focusChannel = useCallback((channel: string, p: { symbol?: string; interval?: Interval }) => {
    const cur = wsRef.current;
    if (cur === null) return;
    const prev = cur.links[channel] ?? { symbol: 'AAPL', interval: '1D' as Interval };
    const next: Channel = { symbol: p.symbol ?? prev.symbol, interval: p.interval ?? prev.interval };
    setWsLocal({ ...cur, links: { ...cur.links, [channel]: next } });
    api.focus(cur.id, channel, p).catch((err: unknown) => {
      setWsLocal(wsRef.current === null ? null : { ...wsRef.current, links: { ...wsRef.current.links, [channel]: prev } });
      toast.error(errMessage(err));
    });
  }, []);

  const configure = useCallback((w: Widget, patch: WidgetConfig, link?: string) => {
    const cur = wsRef.current;
    if (cur === null) return;
    const before = cur.widgets.find((x) => x.id === w.id);
    setWsLocal({ ...cur, widgets: cur.widgets.map((x) => (x.id === w.id ? { ...x, link: link ?? x.link, config: { ...x.config, ...patch } } : x)) });
    api.updateWidget(w.id, link === undefined ? { config: patch } : { config: patch, link }, true).catch((err: unknown) => {
      const now = wsRef.current;
      if (now !== null && before !== undefined) setWsLocal({ ...now, widgets: now.widgets.map((x) => (x.id === w.id ? before : x)) });
      toast.error(errMessage(err));
    });
  }, []);

  const show = useCallback(
    (w: Widget | null, p: { symbol?: string; interval?: Interval }) => {
      if (w === null) {
        focusChannel('1', p);
        return;
      }
      if (w.link !== '') {
        if (p.interval !== undefined && w.config.interval_own === true) {
          configure(w, { interval: p.interval });
          if (p.symbol !== undefined) focusChannel(w.link, { symbol: p.symbol });
          return;
        }
        focusChannel(w.link, p);
        return;
      }
      const patch: WidgetConfig = {};
      if (p.symbol !== undefined) patch.symbol = p.symbol;
      if (p.interval !== undefined) patch.interval = p.interval;
      configure(w, patch);
    },
    [focusChannel, configure],
  );

  const addWidget = useCallback(async (type: WidgetType, p: { link?: string; config?: WidgetConfig; w?: number; h?: number } = {}): Promise<Widget | null> => {
    const cur = wsRef.current;
    if (cur === null) return null;
    try {
      const r = await api.addWidget(cur.id, type, p);
      const now = wsRef.current;
      if (now !== null && !now.widgets.some((x) => x.id === r.widget.id)) setWsLocal({ ...now, widgets: [...now.widgets, r.widget] });
      return r.widget;
    } catch (err) {
      toast.error(errMessage(err));
      return null;
    }
  }, []);

  const removeWidget = useCallback((w: Widget) => {
    const cur = wsRef.current;
    if (cur === null) return;
    setWsLocal({ ...cur, widgets: cur.widgets.filter((x) => x.id !== w.id) });
    setMaximized((m) => (m === w.id ? '' : m));
    api.removeWidget(w.id).catch((err: unknown) => {
      toast.error(errMessage(err));
      wsLive.reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveLayout = useCallback((items: { id: string; x: number; y: number; w: number; h: number }[]) => {
    const cur = wsRef.current;
    if (cur === null) return;
    const byId = new Map(items.map((i) => [i.id, i]));
    let changed = false;
    const widgets = cur.widgets.map((w) => {
      const i = byId.get(w.id);
      if (i === undefined || (i.x === w.x && i.y === w.y && i.w === w.w && i.h === w.h)) return w;
      changed = true;
      return { ...w, x: i.x, y: i.y, w: i.w, h: i.h };
    });
    if (!changed) return;
    setWsLocal({ ...cur, widgets });
    if (layoutTimer.current !== null) clearTimeout(layoutTimer.current);
    const id = cur.id;
    layoutTimer.current = setTimeout(() => {
      void api.layout(id, items).catch((err: unknown) => toast.error(errMessage(err)));
    }, 250);
  }, []);

  const updateSettings = useCallback(
    (p: Partial<Settings>) => {
      if (settings !== null) setSettingsLocal({ ...settings, ...p });
      api.updateSettings(p).catch((err: unknown) => {
        setSettingsLocal(null);
        toast.error(errMessage(err));
      });
    },
    [settings],
  );

  const value = useMemo<AppState>(
    () => ({
      settings,
      workspaces: spaces.data?.workspaces ?? [],
      activeId,
      ws,
      wsLoading: wsLive.loading,
      lists: lists.data ?? [],
      alerts: alerts.data?.alerts ?? [],
      unseen: alerts.data?.unseen_events ?? 0,
      focused,
      setFocused,
      maximized,
      setMaximized,
      activate,
      reloadWorkspaces: spaces.reload,
      shows,
      show,
      focusChannel,
      configure,
      addWidget,
      removeWidget,
      saveLayout,
      updateSettings,
      reloadAlerts: alerts.reload,
    }),
    [settings, spaces.data, spaces.reload, activeId, ws, wsLive.loading, lists.data, alerts.data, alerts.reload, focused, maximized, activate, shows, show, focusChannel, configure, addWidget, removeWidget, saveLayout, updateSettings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Drawings of a symbol, live. */
export function useDrawings(symbol: string): Live<Drawing[]> {
  return useLive(() => (symbol === '' ? Promise.resolve([]) : api.drawings(symbol).then((r) => r.drawings)), ['drawings'], [symbol], (e) => e.record['symbol'] === symbol);
}

/** Analyses of a symbol, live, newest first. */
export function useAnalyses(symbol: string): Live<Analysis[]> {
  return useLive(() => (symbol === '' ? Promise.resolve([]) : api.analyses({ symbol, limit: 20 }).then((r) => r.analyses)), ['analyses'], [symbol], (e) => e.record['symbol'] === symbol || e.record['kind'] === 'watchlist');
}
