/**
 * The UI calls the same operations the AI agent calls through the agent-app
 * CLI (pb_hooks/ops*.pb.js), so a rule enforced there holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type {
  ActivityEntry,
  Alert,
  AlertEvent,
  Analysis,
  BarsResponse,
  Channel,
  Criterion,
  Drawing,
  DrawingStyle,
  Events,
  Field,
  Health,
  Info,
  Interval,
  NewsItem,
  Point,
  Quote,
  Row,
  Run,
  Screen,
  ScreenResult,
  SearchResult,
  Settings,
  Tile,
  Tool,
  Universe,
  WatchItem,
  WatchList,
  Widget,
  WidgetConfig,
  WidgetType,
  Workspace,
} from './types.ts';
import type { IndicatorDef } from './ta.js';

type Params = Record<string, unknown>;

function clean(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  }
  return out;
}

function get<T>(path: string, params: Params = {}, silent = false): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>('/api/ops/' + path, { method: 'GET', query: clean(params) }), { silent });
}

function post<T>(path: string, body: Params, silent = false): Promise<T> {
  const b: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) b[k] = v;
  return getPbClient().call((pb) => pb.send<T>('/api/ops/' + path, { method: 'POST', body: b }), { silent });
}

export interface AlertInput {
  symbol?: string;
  interval?: Interval;
  op?: string;
  value?: number;
  indicator?: string;
  params?: Record<string, number | string>;
  output?: string;
  against?: string;
  against_params?: Record<string, number | string>;
  against_output?: string;
  drawing?: string;
  watch?: 'price' | 'change';
  frequency?: string;
  expires?: string;
  message?: string;
  notify_agent?: boolean;
  status?: 'active' | 'paused';
}

export const api = {
  settings: (): Promise<Settings> => get('settings/get'),
  updateSettings: (p: Partial<Settings>): Promise<Settings> => post('settings/update', p),

  search: (q: string, limit = 12): Promise<{ results: SearchResult[] }> => get('market/search', { q, limit }, true),
  quotes: (symbols: string[]): Promise<{ quotes: Record<string, Quote>; missing: string[] }> => get('market/quotes', { symbols }, true),
  bars: (symbol: string, interval: Interval, p: { count?: number; before?: number; ext?: boolean; fresh?: boolean } = {}): Promise<BarsResponse> =>
    get('market/bars', { symbol, interval, count: p.count, before: p.before, ext: p.ext, fresh: p.fresh }, true),
  info: (symbol: string): Promise<Info> => get('market/info', { symbol }, true),
  news: (p: { symbol?: string; q?: string; limit?: number }): Promise<{ news: NewsItem[] }> => get('market/news', p, true),
  health: (): Promise<Record<string, Health>> => get('market/health', {}, true),
  events: (symbol: string): Promise<Events> => get('market/events', { symbol }, true),
  live: (symbols: string[], series: string[]): Promise<{ quotes: Record<string, Quote>; missing: string[]; tails: Record<string, { bars: Row[]; stale: boolean; error: string }>; health: Record<string, Health>; fired: number; at: number }> =>
    post('market/live', { symbols, series }, true),
  catalogue: (): Promise<{ indicators: IndicatorDef[] }> => get('indicators/catalogue', {}, true),
  levels: (symbol: string, interval: Interval): Promise<{ levels: { price: number; kind: string; touches: number; distance_pct: number }[]; close: number }> => get('chart/levels', { symbol, interval }, true),

  workspaces: (): Promise<{ active: string; workspaces: (Workspace & { widgets: number })[]; settings: Settings }> => get('workspaces/list'),
  workspace: (id: string): Promise<{ workspace: Workspace & { widgets: Widget[] } }> => get('workspaces/get', { workspace: id }),
  createWorkspace: (name: string, template: string): Promise<{ workspace: Workspace }> => post('workspaces/create', { name, template }),
  updateWorkspace: (id: string, p: { name?: string; locked?: boolean }): Promise<{ workspace: Workspace }> => post('workspaces/update', { workspace: id, ...p }),
  deleteWorkspace: (id: string): Promise<{ active: string }> => post('workspaces/delete', { workspace: id }),
  duplicateWorkspace: (id: string): Promise<{ workspace: Workspace }> => post('workspaces/duplicate', { workspace: id }),
  activate: (id: string): Promise<unknown> => post('workspaces/activate', { workspace: id }, true),
  reorderWorkspaces: (order: string[]): Promise<unknown> => post('workspaces/reorder', { order }),
  focus: (workspace: string, channel: string, p: Partial<Channel>): Promise<Channel & { channel: string }> => post('workspaces/focus', { workspace, channel, ...p }),

  addWidget: (workspace: string, type: WidgetType, p: { link?: string; config?: WidgetConfig; x?: number; y?: number; w?: number; h?: number } = {}): Promise<{ widget: Widget }> =>
    post('widgets/add', { workspace, type, ...p }),
  updateWidget: (id: string, p: { link?: string; config?: WidgetConfig }, silent = false): Promise<{ widget: Widget }> => post('widgets/update', { widget: id, ...p }, silent),
  layout: (workspace: string, items: { id: string; x: number; y: number; w: number; h: number }[]): Promise<{ moved: number }> => post('widgets/layout', { workspace, items }, true),
  removeWidget: (id: string): Promise<unknown> => post('widgets/remove', { widget: id }),
  chartSet: (widget: string, p: { symbol?: string; interval?: Interval; type?: string; scale?: string; ext?: boolean; compare?: string[]; own?: boolean }): Promise<{ widget: Widget }> =>
    post('charts/set', { widget, ...p }),

  watchlists: (): Promise<{ watchlists: WatchList[] }> => get('watchlists/list'),
  watchlist: (list: string): Promise<{ watchlist: WatchList & { items: WatchItem[] } }> => get('watchlists/get', { list }),
  createWatchlist: (name: string, symbols: string[] = []): Promise<{ watchlist: WatchList & { items: WatchItem[] } }> => post('watchlists/create', { name, symbols }),
  updateWatchlist: (list: string, p: { name?: string; columns?: string[] }): Promise<unknown> => post('watchlists/update', { list, ...p }),
  deleteWatchlist: (list: string): Promise<unknown> => post('watchlists/delete', { list }),
  addToList: (list: string, p: { symbols?: string[]; section?: string; index?: number }): Promise<{ added: WatchItem[]; skipped: number }> => post('watchlists/add', { list, ...p }),
  removeFromList: (p: { item?: string; items?: string[]; list?: string; symbol?: string }): Promise<unknown> => post('watchlists/remove', p),
  moveItem: (item: string, index: number, list?: string): Promise<unknown> => post('watchlists/move', { item, index, list }, true),
  editItem: (item: string, p: { flag?: string; note?: string; label?: string }): Promise<{ item: WatchItem }> => post('watchlists/item', { item, ...p }),

  drawings: (symbol: string): Promise<{ drawings: Drawing[] }> => get('drawings/list', { symbol }, true),
  addDrawing: (p: { symbol: string; tool: Tool; points: Point[]; style?: DrawingStyle; text?: string; note?: string }): Promise<{ drawing: Drawing }> => post('drawings/add', p),
  updateDrawing: (id: string, p: { points?: Point[]; style?: DrawingStyle; text?: string; note?: string; locked?: boolean; hidden?: boolean }, silent = false): Promise<{ drawing: Drawing }> =>
    post('drawings/update', { drawing: id, ...p }, silent),
  deleteDrawings: (ids: string[]): Promise<unknown> => post('drawings/delete', { drawings: ids }),
  clearDrawings: (symbol: string, added_by?: 'user' | 'agent'): Promise<{ deleted: number }> => post('drawings/clear', { symbol, added_by }),
  adopt: (p: { symbol?: string; run?: string; drawing?: string }): Promise<{ adopted: number }> => post('drawings/adopt', p),

  alerts: (): Promise<{ alerts: Alert[]; unseen_events: number }> => get('alerts/list', {}, true),
  createAlert: (p: AlertInput): Promise<{ alert: Alert; fired_now: boolean }> => post('alerts/create', { ...p }),
  updateAlert: (id: string, p: AlertInput): Promise<{ alert: Alert }> => post('alerts/update', { alert: id, ...p }),
  deleteAlert: (id: string): Promise<unknown> => post('alerts/delete', { alert: id }),
  alertEvents: (p: { unseen?: boolean; limit?: number; symbol?: string } = {}): Promise<{ events: AlertEvent[] }> => get('alerts/events', p, true),
  seen: (events?: string[]): Promise<unknown> => post('alerts/seen', { events }, true),

  requestAnalysis: (p: { symbol?: string; interval?: Interval; watchlist?: string; focus?: string }): Promise<{ analysis: Analysis; asked: boolean; reason: string }> => post('analyses/request', p),
  analyses: (p: { symbol?: string; watchlist?: string; state?: string; limit?: number }): Promise<{ analyses: Analysis[] }> => get('analyses/list', p, true),
  cancelAnalysis: (id: string): Promise<unknown> => post('analyses/cancel', { analysis: id }),
  deleteAnalysis: (id: string): Promise<unknown> => post('analyses/delete', { analysis: id }),

  universes: (): Promise<{ universes: Universe[] }> => get('screener/universes', {}, true),
  fields: (): Promise<{ fields: Field[] }> => get('screener/fields', {}, true),
  screen: (p: { universe: string; criteria?: Criterion[]; sort?: string; desc?: boolean; limit?: number; technical?: boolean }): Promise<ScreenResult> => post('screener/run', p, true),
  heatmap: (universe: string): Promise<{ universe: { id: string; name: string }; tiles: Tile[] }> => get('screener/heatmap', { universe }, true),
  screens: (): Promise<{ screens: Screen[] }> => get('screens/list', {}, true),
  saveScreen: (p: { screen?: string; name?: string; universe?: string; criteria?: Criterion[]; sort?: string }): Promise<{ screen: Screen }> => post('screens/save', p),
  deleteScreen: (id: string): Promise<unknown> => post('screens/delete', { screen: id }),

  activity: (p: { actor?: string | undefined; run?: string; symbol?: string; limit?: number } = {}): Promise<{ activity: ActivityEntry[] }> => get('activity/list', p, true),
  undo: (entry?: string): Promise<{ entry: ActivityEntry }> => post('activity/undo', { entry, actor: entry === undefined ? 'user' : undefined }),
  redo: (entry?: string): Promise<{ entry: ActivityEntry }> => post('activity/redo', { entry, actor: entry === undefined ? 'user' : undefined }),
  runs: (): Promise<{ runs: Run[] }> => get('activity/runs', {}, true),
  revertRun: (run: string): Promise<{ reverted: number }> => post('activity/revert_run', { run }),
};

/** The message an op error carries (PocketBase shape { message }). */
export function errMessage(err: unknown): string {
  const e = err as { message?: string; response?: { message?: string } };
  return e.response?.message ?? e.message ?? 'Something went wrong';
}

/** Hand a file to the browser as a download. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
