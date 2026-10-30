/** What the operations answer (pb_hooks/lib_*.js views). Money is in major units. */

export type PlatformId = 'shopify' | 'woocommerce' | 'shopee' | 'lazada' | 'tiktok_shop' | 'amazon' | 'ebay' | 'etsy' | 'tokopedia' | 'zalora' | 'rakuten' | 'yahoo_shopping' | 'walmart' | 'mercado_libre' | 'direct' | 'other';
export type Autonomy = 'ask' | 'auto';
export type AutonomyKind = 'listings' | 'prices' | 'stock' | 'replies' | 'orders';

export interface Platform {
  id: PlatformId;
  name: string;
  kind: 'store' | 'marketplace' | 'direct';
  blurb: string;
  regions: string[];
  ship_days: number;
  title_max: number;
  chat: 'email' | 'marketplace' | 'direct';
  start: Record<string, string>;
  admin: Record<string, string>;
}

export interface Country {
  code: string;
  name: string;
  currency: string;
}

export interface Catalog {
  platforms: Platform[];
  countries: Country[];
  currencies: string[];
}

export interface Settings {
  business_name: string;
  owner_name: string;
  country: string;
  base_currency: string;
  timezone: string;
  utc_offset: number;
  autonomy: Record<AutonomyKind, Autonomy>;
  guards: { max_price_drop_pct: number; min_margin_pct: number };
  pii_days: number;
  low_stock: number;
  fx: { base: string; date: string; source: string; currencies: number; error: string };
  onboarded: boolean;
}

export type TaskKind = 'sync' | 'publish' | 'push_stock' | 'setup_help' | 'prepare_listing' | 'draft_reply' | 'send_reply' | 'tracking' | 'exception' | 'chat';
export type TaskState = 'queued' | 'asked' | 'working' | 'done' | 'failed' | 'cancelled';

export interface TaskBrief {
  id: string;
  kind: TaskKind;
  state: TaskState;
  label: string;
}

export interface Task extends TaskBrief {
  target: string;
  params: Record<string, unknown>;
  request: string;
  note: string;
  by: string;
  asked_at: string;
  started_at: string;
  done_at: string;
  created: string;
}

export interface ShopRef {
  id: string;
  name: string;
  platform: PlatformId;
}

export interface Shop extends ShopRef {
  platform_name: string;
  kind: 'store' | 'marketplace' | 'direct';
  chat: 'email' | 'marketplace' | 'direct';
  region: string;
  currency: string;
  url: string;
  admin_url: string;
  status: 'setting_up' | 'active' | 'paused';
  connection: 'agent' | 'files' | 'manual';
  commission_pct: number;
  payment_pct: number;
  fixed_fee: number;
  ship_days: number;
  reply_hours: number;
  stock_share: number;
  stock_buffer: number;
  stock_max: number;
  title_max: number;
  policies: { returns: string; shipping: string; faq: string; voice: string };
  setup: { done: number; total: number };
  sync_at: string;
  sync_note: string;
  to_ship: number;
  late: number;
  open_threads: number;
  live_listings: number;
  task: TaskBrief | null;
  sort: number;
}

export interface SetupStep {
  key: string;
  title: string;
  body: string;
  help: boolean;
  link: string;
  done: boolean;
  done_at: string;
}

export interface ImportRow {
  id: string;
  kind: 'orders' | 'products';
  file_name: string;
  rows: number;
  created_n: number;
  updated_n: number;
  skipped_n: number;
  problems: number | string[];
  created: string;
}

export interface ShopDetail extends Shop {
  steps: SetupStep[];
  imports: ImportRow[];
  tasks: Task[];
  stock_plan: number;
  orders: number;
}

export interface Kpi {
  value: number | null;
  previous?: number | null;
  delta_pct?: number | null;
}

export interface SeriesPoint {
  key: string;
  net: number;
  profit: number;
  orders: number;
  prev_net: number;
  by_shop: Record<string, number>;
}

export interface ShopPerf {
  id: string;
  name: string;
  platform: PlatformId;
  net: number;
  profit: number;
  orders: number;
  margin: number | null;
  delta_pct: number | null;
  spark: number[];
}

export interface TopProduct {
  product: string;
  title: string;
  image: string;
  units: number;
  net: number;
}

export interface Overview {
  range: Range;
  currency: string;
  monthly: boolean;
  from: string;
  to: string;
  kpis: { net_sales: Kpi; profit: Kpi; orders: Kpi; aov: Kpi; margin: Kpi; refunds: Kpi; units: Kpi };
  fees_estimated_share: number;
  quality: { orders_missing_cost: number; orders_without_ship_cost: number };
  from_day: string;
  to_day: string;
  series: SeriesPoint[];
  shops: ShopPerf[];
  top_products: TopProduct[];
  unconverted: number;
}

export type Range = '7d' | '30d' | '90d' | '12m';

export interface Attention {
  to_ship: number;
  late: number;
  late_orders: string[];
  due_soon: number;
  unpaid: number;
  exceptions: number;
  messages_open: number;
  messages_overdue: number;
  drafts_ready: number;
  approvals: number;
  listing_issues: number;
  low_stock: number;
  out_of_stock: number;
  missing_cost_products: number;
  missing_cost_orders: number;
  unlinked_lines: number;
  stock_to_push: number;
  tasks_open: number;
}

export interface Activity {
  id: string;
  actor: 'person' | 'agent' | 'system';
  text: string;
  target: string;
  created: string;
}

export interface Home {
  settings: Settings;
  shops: Shop[];
  attention: Attention;
  report: Overview | null;
  recent_orders: OrderRow[];
  activity: Activity[];
  counts: { products: number; orders: number };
}

/* ----------------------------------------------------------------- orders */

export type OrderStatus = 'unpaid' | 'to_ship' | 'shipped' | 'delivered' | 'returned' | 'cancelled';
export type Payment = 'paid' | 'pending' | 'cod' | 'refunded' | 'partial_refund';
export type Health = 'late' | 'due_soon' | 'ok' | 'exception' | 'stalled' | 'done';
export type TrackStatus = 'pending' | 'info_received' | 'in_transit' | 'out_for_delivery' | 'available_for_pickup' | 'delivered' | 'failed_attempt' | 'exception' | 'returned';
export type OrderView = 'to_ship' | 'unpaid' | 'at_risk' | 'shipped' | 'exceptions' | 'delivered' | 'returns' | 'cancelled' | 'unlinked' | 'all';

export interface OrderRow {
  id: string;
  number: string;
  shop: ShopRef;
  placed_at: string;
  buyer_name: string;
  customer: string;
  units: number;
  first_item: string;
  lines: number;
  total: number;
  currency: string;
  status: OrderStatus;
  payment: Payment;
  ship_by: string;
  hours_left: number | null;
  health: Health;
  carrier: string;
  tracking: string;
  tracking_status: TrackStatus | '';
  unlinked: boolean;
  source: string;
  task: TaskBrief | null;
}

export interface OrderList {
  view: OrderView;
  total: number;
  counts: Record<OrderView, number>;
  orders: OrderRow[];
}

export interface OrderLine {
  id: string;
  /** item: a catalog SKU (or not linked yet); extra: not a product (gift card, gift wrap) with its own cost. */
  kind: 'item' | 'extra';
  sku: string;
  title: string;
  option: string;
  qty: number;
  price: number;
  cost: number;
  qty_shipped: number;
  qty_returned: number;
  variant: string;
  product: string;
  image: string;
}

export interface Shipment {
  id: string;
  carrier: string;
  tracking: string;
  url: string;
  status: TrackStatus;
  last_event: string;
  last_event_at: string;
  shipped_at: string;
  delivered_at: string;
  eta: string;
  events: { at: string; text: string; status: string }[];
  checked_at: string;
}

export interface Money {
  currency: string;
  base: string;
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  refund: number;
  fees: number;
  fees_estimated: boolean;
  ship_cost: number;
  net_sales: number;
  net_sales_base: number | null;
  cogs_base: number;
  profit_base: number | null;
  margin_pct: number | null;
  cost_missing: boolean;
}

export interface Address {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  phone?: string;
  text?: string;
}

export interface OrderDetail extends OrderRow {
  buyer_email: string;
  buyer_phone: string;
  address: Address;
  purged: boolean;
  note: string;
  shipped_at: string;
  delivered_at: string;
  cancelled_at: string;
  cancel_reason: string;
  shop_detail: { id: string; name: string; platform: PlatformId; admin_url: string; ship_days: number };
  money: Money;
  lines_detail: OrderLine[];
  shipments: Shipment[];
  customer_detail: { id: string; name: string; email: string; phone: string; orders: number } | null;
  threads: { id: string; subject: string; status: string; last_at: string }[];
  timeline: { at: string; kind: string; text: string }[];
  tasks: Task[];
}

/* --------------------------------------------------------------- products */

export type ListingStatus = 'draft' | 'ready' | 'live' | 'paused';
export type StockState = 'ok' | 'low' | 'out' | 'none';

export interface ProductRow {
  id: string;
  title: string;
  brand: string;
  category: string;
  status: 'active' | 'draft' | 'archived';
  image: string;
  variants: number;
  skus: string[];
  price_min: number;
  price_max: number;
  available: number;
  stock_state: StockState;
  cost_missing: boolean;
  listings: { id: string; shop: string; shop_name: string; platform: PlatformId; status: ListingStatus; blocking: number; warnings: number }[];
  task: TaskBrief | null;
  created: string;
}

export interface ProductList {
  currency: string;
  total: number;
  counts: { all: number; issues: number; unlisted: number; low: number; out: number; missing_cost: number; draft: number; archived: number };
  products: ProductRow[];
}

export interface Variant {
  id: string;
  sku: string;
  option: string;
  price: number;
  cost: number;
  barcode: string;
  weight_g: number;
  cost_missing: boolean;
  on_hand: number;
  reserved: number;
  available: number;
  low_stock: number;
  state: 'ok' | 'low' | 'out';
}

export interface Issue {
  level: 'blocking' | 'warning';
  field: string;
  text: string;
}

export interface Listing {
  id: string;
  product: string;
  shop: { id: string; name: string; platform: PlatformId; currency: string };
  status: ListingStatus;
  title: string;
  description: string;
  price: number;
  currency: string;
  keywords: string[];
  external_id: string;
  url: string;
  source: string;
  pushed_at: string;
  published_at: string;
  needs_update: boolean;
  issues: Issue[];
  blocking: number;
  updated: string;
}

export interface ProductDetail {
  id: string;
  title: string;
  brand: string;
  category: string;
  description: string;
  status: 'active' | 'draft' | 'archived';
  note: string;
  tags: string[];
  facts: { key: string; value: string; source: string }[];
  images: { name: string; url: string; thumb: string }[];
  variants: Variant[];
  listings: Listing[];
  not_listed_on: ShopRef[];
  sold_30d: number;
  task: Task | null;
  tasks: Task[];
  currency: string;
  created: string;
  updated: string;
}

export interface StockRow {
  variant: string;
  product: string;
  title: string;
  sku: string;
  option: string;
  price: number;
  cost: number;
  cost_missing: boolean;
  value: number;
  image: string;
  on_hand: number;
  reserved: number;
  available: number;
  low_stock: number;
  state: 'ok' | 'low' | 'out';
}

export interface StockOverview {
  currency: string;
  totals: { skus: number; low: number; out: number; units: number; value: number };
  rows: StockRow[];
}

export interface PlanRow {
  shop: ShopRef;
  listing: string;
  product: string;
  title: string;
  variant: string;
  sku: string;
  option: string;
  qty: number;
  last: number | null;
  available: number;
}

export interface StockMove {
  id: string;
  qty: number;
  reason: string;
  ref: string;
  note: string;
  actor: string;
  balance: number;
  created: string;
}

/* ------------------------------------------------------------------ inbox */

export type ThreadView = 'due' | 'drafted' | 'waiting' | 'open' | 'closed' | 'all';
export type Intent = 'where_is_order' | 'return' | 'refund' | 'cancel' | 'change_address' | 'product_question' | 'complaint' | 'other';

export interface ThreadRow {
  id: string;
  shop: ShopRef | null;
  customer: { id: string; name: string } | null;
  buyer: string;
  order: { id: string; number: string; status: OrderStatus } | null;
  subject: string;
  channel: string;
  status: 'open' | 'waiting' | 'closed';
  intent: Intent | '';
  due_at: string;
  hours_left: number | null;
  last_at: string;
  unread: boolean;
  snippet: string;
  last_from: string;
  has_draft: boolean;
  draft_by: string;
  task: TaskBrief | null;
}

export interface ThreadList {
  view: ThreadView;
  total: number;
  counts: Record<ThreadView, number>;
  threads: ThreadRow[];
}

export interface Message {
  id: string;
  direction: 'in' | 'out' | 'note';
  author: 'buyer' | 'you' | 'agent';
  body: string;
  via: string;
  state: 'sent' | 'sending' | 'failed';
  error: string;
  at: string;
}

export interface ThreadDetail extends ThreadRow {
  messages: Message[];
  draft: string;
  draft_why: string;
  draft_at: string;
  draft_lint: string[];
  external_id: string;
  customer_detail: { id: string; name: string; email: string; phone: string; note: string } | null;
  order_detail: OrderDetail | null;
  customer_orders: OrderRow[];
  /** Orders this conversation may be about, when none is linked. */
  suggested_orders: OrderRow[];
  shop_detail: { id: string; name: string; platform: PlatformId; platform_name: string; chat: string; admin_url: string; reply_hours: number; policies: Shop['policies'] } | null;
}

/* -------------------------------------------------------------- customers */

export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  note: string;
  tags: string[];
  shops: string[];
  orders: number;
  last_order: string;
  spent: number;
  currency: string;
}

export interface CustomerDetail extends CustomerRow {
  order_list: OrderRow[];
  threads: { id: string; subject: string; status: string; last_at: string }[];
}

/* -------------------------------------------------------------- proposals */

export interface ProposalField {
  name: string;
  before: unknown;
  after: unknown;
  money: string;
}

export interface ProposalItem {
  index: number;
  op: string;
  label: string;
  fields: ProposalField[];
  notes: string[];
  risk: 'low' | 'medium' | 'high';
  state: 'pending' | 'applied' | 'stale' | 'failed' | 'rejected' | 'undone';
  error: string;
  irreversible: boolean;
  undoable: boolean;
}

export interface Proposal {
  id: string;
  kind: string;
  title: string;
  why: string;
  origin: 'agent' | 'rule';
  status: 'pending' | 'applied' | 'partial' | 'failed' | 'rejected' | 'withdrawn' | 'expired' | 'undone';
  risk: 'low' | 'medium' | 'high';
  target: string;
  note: string;
  items: ProposalItem[];
  decided_at: string;
  created: string;
}

export interface Chat {
  id: string;
  text: string;
  reply: string;
  state: 'sent' | 'answered';
  task: string;
  context: string;
  created: string;
  updated: string;
}

export interface Profit {
  range: Range;
  currency: string;
  total: ProfitBlock;
  shops: (ProfitBlock & { id: string; name: string; platform: PlatformId })[];
  unconverted: number;
}

export interface ProfitBlock {
  items: number;
  discount: number;
  shipping_charged: number;
  refunds: number;
  net_sales: number;
  fees: number;
  ship_cost: number;
  cogs: number;
  profit: number;
  margin: number | null;
  orders: number;
  estimates: { fees_estimated_pct: number; orders_missing_cost: number; orders_without_ship_cost: number };
}

export interface SearchResult {
  orders: { id: string; number: string; buyer: string; status: OrderStatus; shop: string; shop_name: string }[];
  products: { id: string; title: string; image: string }[];
  customers: { id: string; name: string; email: string }[];
  threads: { id: string; subject: string; status: string }[];
}
