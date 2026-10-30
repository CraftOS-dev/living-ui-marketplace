/** Shapes returned by the operations (pb/pb_hooks/ops*.pb.js). */

export type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M';
export const INTERVALS: Interval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'];
export const IV_SEC: Record<Interval, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1D': 86400, '1W': 604800, '1M': 2592000 };
export const INTRADAY: Record<Interval, boolean> = { '1m': true, '5m': true, '15m': true, '30m': true, '1h': true, '4h': true, '1D': false, '1W': false, '1M': false };

export type WidgetType = 'chart' | 'watchlist' | 'details' | 'news' | 'alerts' | 'screener' | 'heatmap' | 'ticker' | 'analyst' | 'activity' | 'chartgrid';
export type ChartType = 'candles' | 'hollow' | 'bars' | 'line' | 'area' | 'baseline' | 'heikin';
export type Scale = 'normal' | 'log' | 'percent' | 'indexed';
export type Palette = 'green_red' | 'blue_orange' | 'red_green';
export type TzMode = 'exchange' | 'local' | 'utc';

export interface Settings {
  id: string;
  palette: Palette;
  tz_mode: TzMode;
  active_workspace: string;
  agent_markup: boolean;
  sound: boolean;
}

export interface Channel {
  symbol: string;
  interval: Interval;
}

export interface IndicatorConf {
  id: string;
  params: Record<string, number | string>;
  hidden?: boolean;
  color?: string;
}

export interface WidgetConfig {
  symbol?: string;
  interval?: Interval;
  interval_own?: boolean;
  type?: ChartType;
  scale?: Scale;
  indicators?: IndicatorConf[];
  compare?: string[];
  ext?: boolean;
  intervals?: Interval[];
  layout?: string;
  list?: string;
  columns?: string[];
  scope?: 'symbol' | 'market';
  tab?: 'active' | 'log';
  universe?: string;
  criteria?: Criterion[];
  sort?: string;
  desc?: boolean;
  size?: 'equal' | 'volume';
  group?: boolean;
  symbols?: string[];
  actor?: '' | 'user' | 'agent';
  screen?: string;
}

export interface Widget {
  id: string;
  workspace: string;
  type: WidgetType;
  link: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: WidgetConfig;
  shows?: { symbol: string; interval: Interval; link: string };
}

export interface Workspace {
  id: string;
  name: string;
  sort: number;
  links: Record<string, Channel>;
  locked: boolean;
  widgets?: Widget[];
}

export interface Sessions {
  regular: [number, number];
  pre?: [number, number];
  post?: [number, number];
}

export interface Meta {
  symbol: string;
  provider: 'yahoo' | 'binance';
  name: string;
  exchange: string;
  type: string;
  currency: string;
  tz: string;
  price_hint: number;
  sessions: Sessions | null;
  gmtoffset: number;
  first_trade?: number | null;
  ext_hours?: boolean;
}

/** [time, open, high, low, close, volume] */
export type Row = [number, number, number, number, number, number];

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface BarsResponse {
  symbol: string;
  interval: Interval;
  ext: boolean;
  meta: Meta;
  count: number;
  complete: boolean;
  stale: boolean;
  error: string;
  bars: Row[];
}

export type MarketState = 'open' | 'pre' | 'post' | 'closed' | 'unknown';

export interface Quote {
  symbol: string;
  provider: 'yahoo' | 'binance';
  name: string;
  price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  quote_volume?: number | null;
  high_52w: number | null;
  low_52w: number | null;
  currency: string;
  exchange: string;
  type: string;
  tz: string;
  price_hint: number;
  state: MarketState;
  time: number | null;
  ext_price: number | null;
  ext_change_pct: number | null;
  spark: number[];
  stale?: boolean;
  error?: string;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  provider: 'yahoo' | 'binance';
}

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  time: number;
  tickers: string[];
  thumb: string;
}

export interface Health {
  provider: string;
  state: 'ok' | 'throttled' | 'down' | 'unknown';
  message: string;
  at: number;
  cool_until: number;
}

export interface Stats {
  rsi14?: number | null;
  perf_1w?: number | null;
  perf_1m?: number | null;
  perf_3m?: number | null;
  perf_6m?: number | null;
  perf_ytd?: number | null;
  perf_1y?: number | null;
  sma20_dist?: number | null;
  sma50_dist?: number | null;
  sma200_dist?: number | null;
  atr_pct?: number | null;
  atr14?: number | null;
  hv20?: number | null;
  rvol?: number | null;
  gap_pct?: number | null;
  avg_volume_30d?: number | null;
  open?: number;
  high_52w?: number;
  low_52w?: number;
  error?: string;
}

export interface Events {
  dividends: { t: number; amount: number }[];
  splits: { t: number; ratio: string }[];
}

export interface Info {
  meta: Meta;
  quote: Quote | null;
  stats: Stats | null;
  events: Events | null;
  live: boolean;
}

export interface WatchList {
  id: string;
  name: string;
  sort: number;
  columns: string[];
  count?: number;
}

export interface WatchItem {
  id: string;
  list: string;
  kind: 'symbol' | 'section';
  symbol: string;
  label: string;
  flag: '' | 'red' | 'amber' | 'green' | 'blue' | 'violet';
  note: string;
  sort: number;
}

export type Tool = 'trend' | 'ray' | 'extended' | 'hline' | 'hray' | 'vline' | 'rect' | 'channel' | 'fib' | 'long' | 'short' | 'measure' | 'text' | 'arrow_up' | 'arrow_down';

export interface Point {
  t: number | null;
  p: number | null;
}

export interface DrawingStyle {
  color?: string;
  width?: number;
  dash?: boolean;
  extend_left?: boolean;
  extend_right?: boolean;
  fill?: boolean;
  size?: number;
  levels?: number[];
}

export interface Drawing {
  id: string;
  symbol: string;
  tool: Tool;
  points: Point[];
  style: DrawingStyle;
  text: string;
  locked: boolean;
  hidden: boolean;
  added_by: 'user' | 'agent';
  run: string;
  note: string;
  created: string;
}

export type Side =
  | { type: 'price' }
  | { type: 'change' }
  | { type: 'value'; value: number }
  | { type: 'indicator'; id: string; params: Record<string, number | string>; output: string }
  | { type: 'drawing'; id: string };

export interface Condition {
  left: Side;
  op: 'crosses' | 'crosses_up' | 'crosses_down' | 'above' | 'below';
  right: Side;
}

export interface Alert {
  id: string;
  symbol: string;
  interval: Interval;
  condition: Condition | null;
  text: string;
  frequency: 'once' | 'once_per_bar' | 'every';
  expires: string;
  status: 'active' | 'paused' | 'triggered' | 'expired';
  message: string;
  notify_agent: boolean;
  added_by: 'user' | 'agent';
  run: string;
  last_value: number;
  last_checked: string;
  last_fired: string;
  fired_count: number;
  error: string;
  created: string;
}

export interface AlertEvent {
  id: string;
  alert: string;
  symbol: string;
  price: number;
  value: number;
  detail: string;
  seen: boolean;
  agent_state: '' | 'waiting' | 'working' | 'done' | 'failed';
  agent_note: string;
  created: string;
}

export interface AnalysisLevel {
  price: number;
  kind: 'support' | 'resistance' | 'target' | 'stop' | 'entry' | 'pivot';
  label: string;
}

export interface Analysis {
  id: string;
  kind: 'symbol' | 'watchlist';
  symbol: string;
  watchlist: string;
  interval: string;
  state: 'waiting' | 'working' | 'done' | 'failed';
  focus: string;
  summary: string;
  bias: '' | 'bullish' | 'bearish' | 'neutral' | 'mixed';
  levels: AnalysisLevel[];
  facts: {
    as_of?: string;
    price?: number;
    change_pct?: number;
    rsi14?: number;
    rsi_state?: string;
    atr_pct?: number;
    trend?: string;
    performance_pct?: Record<string, number | null>;
    range_52w_position_pct?: number;
    relative_volume?: number;
  } | null;
  error: string;
  requested_at: string;
  added_by: 'user' | 'agent';
  run: string;
  created: string;
  updated: string;
}

export interface Criterion {
  field: string;
  op: '>' | '>=' | '<' | '<=' | 'between';
  value: number;
  value2?: number;
}

export interface Field {
  key: string;
  label: string;
  group: 'quote' | 'technical' | 'fundamental';
  unit: string;
}

export interface Universe {
  id: string;
  name: string;
  count: number | null;
}

export interface ScreenRow {
  symbol: string;
  name: string;
  group: string;
  currency: string;
  price: number;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
  spark: number[];
  state: string;
  [field: string]: unknown;
}

export interface ScreenResult {
  universe: { id: string; name: string };
  criteria: Criterion[];
  sort: string;
  desc: boolean;
  total: number;
  count: number;
  rows: ScreenRow[];
  missing: string[];
  errors: string[];
}

export interface Screen {
  id: string;
  name: string;
  universe: string;
  criteria: Criterion[];
  sort: string;
  note: string;
  added_by: 'user' | 'agent';
}

export interface Tile {
  symbol: string;
  name: string;
  group: string;
  price: number;
  change_pct: number | null;
  dollar_volume: number | null;
  market_cap: number | null;
  currency: string;
}

export interface ActivityEntry {
  id: string;
  actor: 'user' | 'agent';
  run: string;
  op: string;
  summary: string;
  target_type: string;
  target_id: string;
  symbol: string;
  undoable: boolean;
  redoable: boolean;
  undone: boolean;
  created: string;
}

export interface Run {
  run: string;
  started: string;
  last: string;
  changes: number;
  undone: number;
  symbols: string[];
  summaries: string[];
}
