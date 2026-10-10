/** Shapes of what the operations return (pb_hooks/lib_*.js serializers). */

export type Status = 'ok' | 'low' | 'out' | 'over' | 'archived';
export type LocationKind = 'site' | 'room' | 'area' | 'container' | 'vehicle' | 'rack' | 'shelf' | 'cabinet' | 'fridge' | 'drawer' | 'pallet' | 'bin' | 'box' | 'other';
export type Actor = 'you' | 'agent' | 'system';
export type MoveKind = 'in' | 'out' | 'move' | 'adjust' | 'count';
export type OrderStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';
export type CountStatus = 'counting' | 'completed' | 'cancelled';
export type DocStatus = 'waiting' | 'reading' | 'done' | 'failed';

export interface Settings {
  currency: string;
  currency_decimals: number;
  currency_confirmed: boolean;
  allow_negative: boolean;
  auto_restock: boolean;
  restock_asked_on: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  sort: number;
  items: number;
}

export interface CategoryRef {
  id: string;
  name: string;
  icon: string;
}

export interface Ref {
  id: string;
  name: string;
}

export interface TinyItem {
  id: string;
  name: string;
  sku: string;
  unit: string;
  fractional?: boolean;
  photo: string | null;
  icon: string;
  archived?: boolean;
}

export interface Item {
  id: string;
  name: string;
  sku: string;
  unit: string;
  fractional: boolean;
  photo: string | null;
  photo_large: string | null;
  category: CategoryRef | null;
  icon: string;
  on_hand: number;
  places: number;
  incoming: number;
  min_qty: number;
  max_qty: number;
  status: Status;
  unit_cost: string;
  unit_cost_e4: number;
  value: number;
  value_text: string;
  usage_30d: number;
  usage_per_day: number;
  days_left: number | null;
  reorder_qty: number;
  supplier: Ref | null;
  lead_time_days: number;
  archived: boolean;
  updated: string;
}

export interface LocationRef {
  id: string;
  name: string;
  path: string;
  code?: string;
  kind?: LocationKind;
}

export interface Movement {
  id: string;
  batch: string;
  item: TinyItem;
  location: LocationRef;
  qty: number;
  kind: MoveKind;
  reason: string;
  reason_label: string;
  balance: number;
  unit_cost: string;
  value: number;
  actor: Actor;
  note: string;
  ref_type: '' | 'order' | 'count' | 'import' | 'document';
  ref: string;
  ref_label: string;
  reverses: string;
  undone_by: string;
  created: string;
}

export interface ItemDetail extends Omit<Item, 'supplier'> {
  description: string;
  codes: { id: string; code: string }[];
  stock: { location: LocationRef & { code: string; kind: LocationKind }; qty: number }[];
  open_lines: { id: string; order: { id: string; number: string; status: OrderStatus; expected_on: string }; qty: number; received: number; remaining: number }[];
  recent: Movement[];
  series: { day: string; qty: number }[];
  in_30d: number;
  out_30d: number;
  last_counted: string | null;
  default_location: LocationRef | null;
  supplier: { id: string; name: string; email: string; phone: string } | null;
  item_lead_time_days: number;
  created: string;
  currency: string;
}

export interface ItemList {
  currency: string;
  items: Item[];
  total: number;
  offset: number;
  limit: number;
  counts: { all: number; ok: number; low: number; out: number; over: number; reorder: number };
  value: number;
  value_text: string;
}

export interface LocationNode {
  id: string;
  name: string;
  code: string;
  kind: LocationKind;
  notes: string;
  parent: string | null;
  path: string;
  depth: number;
  own: { items: number; units: number; value: number; value_text: string };
  total: { items: number; units: number; value: number };
  children: LocationNode[];
}

export interface LocationTree {
  currency: string;
  tree: LocationNode[];
  count: number;
}

export interface LocationDetail {
  id: string;
  name: string;
  code: string;
  kind: LocationKind;
  notes: string;
  parent: LocationRef | null;
  path: string;
  children: { id: string; name: string; kind: LocationKind; code: string }[];
  currency: string;
  stock: { item: Item; location: LocationRef; qty: number }[];
  units: number;
  value: number;
  value_text: string;
  item_count: number;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  lead_time_days: number;
  notes: string;
  items: number;
  open_orders: number;
  last_ordered_on: string;
}

export interface SupplierDetail extends Supplier {
  currency: string;
  supplied: Item[];
  orders: Order[];
}

export interface OrderLine {
  id: string;
  item: TinyItem;
  qty: number;
  received: number;
  remaining: number;
  unit_cost: string;
  unit_cost_e4: number;
  total: number;
  total_text: string;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  supplier: { id: string; name: string; email: string; phone: string; contact: string; lead_time_days: number } | null;
  location: LocationRef | null;
  expected_on: string;
  ordered_on: string;
  received_on: string;
  closed_short: boolean;
  note: string;
  agent_note: string;
  origin: 'you' | 'agent' | 'reorder';
  lines: OrderLine[];
  line_count: number;
  qty: number;
  received: number;
  progress: number;
  value: number;
  value_text: string;
  currency: string;
  late: boolean;
  created: string;
  updated: string;
}

export interface OrderDetail extends Order {
  documents: Doc[];
  receipts: Movement[];
}

export interface OrderCounts {
  draft: number;
  ordered: number;
  partial: number;
  received: number;
  cancelled: number;
  open: number;
  late: number;
}

export interface ReorderLine extends Item {
  suggested: number;
  suggested_value: number;
  in_drafts: { id: string; number: string; qty: number }[];
  why: string;
}

export interface ReorderGroup {
  supplier: { id: string; name: string; email: string; lead_time_days: number } | null;
  items: ReorderLine[];
  value: number;
  value_text: string;
}

export interface ReorderList {
  currency: string;
  groups: ReorderGroup[];
  count: number;
  value: number;
  value_text: string;
  auto_restock: boolean;
}

export interface CountLine {
  id: string;
  item: TinyItem;
  location: LocationRef;
  expected: number | null;
  counted: number | null;
  counted_set: boolean;
  difference: number | null;
  value_difference: string | null;
  updated: string;
}

export interface CountSummary {
  lines: number;
  counted: number;
  changed: number;
  missing: number;
  surplus: number;
  units: number;
  value: number;
  value_text: string;
  uncounted: 'keep' | 'zero';
}

export interface StockCount {
  id: string;
  number: string;
  status: CountStatus;
  blind: boolean;
  hidden: boolean;
  location: LocationRef | null;
  include_sub: boolean;
  note: string;
  lines: CountLine[];
  line_count: number;
  counted: number;
  progress: number;
  differences: { lines: number; units: number; value: number; value_text: string } | null;
  summary: CountSummary | null;
  batch: string;
  completed_on: string;
  currency: string;
  created: string;
  updated: string;
  scanned?: { line: string; item: { id: string; name: string; sku: string } };
}

export interface CountBrief {
  id: string;
  number: string;
  status: CountStatus;
  blind: boolean;
  location: LocationRef | null;
  note: string;
  line_count: number;
  counted: number;
  summary: CountSummary | null;
  completed_on: string;
  created: string;
}

export interface Doc {
  id: string;
  status: DocStatus;
  summary: string;
  error: string;
  file: string;
  file_path: string;
  url: string;
  thumb: string | null;
  is_pdf: boolean;
  order: { id: string; number: string } | null;
  batch: string;
  added_by: 'you' | 'agent';
  created: string;
  updated: string;
}

export interface DayFlow {
  day: string;
  in: number;
  out: number;
  in_value: number;
  out_value: number;
  entries: number;
}

export interface Dashboard {
  currency: string;
  currency_confirmed: boolean;
  totals: { items: number; units: number; value: number; value_text: string; locations: number; suppliers: number };
  status: { ok: number; low: number; out: number; over: number };
  reorder: number;
  attention: Item[];
  days: DayFlow[];
  in_30d: number;
  out_30d: number;
  movers: { id: string; name: string; sku: string; unit: string; photo: string | null; icon: string; used: number; on_hand: number; status: Status; days_left: number | null }[];
  idle: { items: number; value: number; value_text: string };
  recent: Movement[];
  incoming: { counts: OrderCounts; orders: Order[] };
  places: { id: string; name: string; kind: LocationKind; units: number; items: number; value: number; value_text: string }[];
  counting: number;
  documents: { waiting: number; reading: number; failed: number };
  setup: { locations: boolean; items: boolean; stock: boolean; reorder_points: boolean; suppliers: boolean; barcodes: boolean };
}

export interface StockResult {
  batch: string;
  entries: number;
  message: string;
  item: Item;
}

export interface BatchResult {
  batch: string;
  entries: number;
  message: string;
  items: { id: string; name: string; sku: string; unit: string; on_hand: number }[];
}

export type Lookup =
  | { type: 'item'; via: string; item: ItemDetail }
  | { type: 'location'; via: string; location: { id: string; name: string; code: string; kind: LocationKind; path: string } }
  | { type: 'none'; code: string; message: string };

export interface ImportField {
  key: string;
  label: string;
  column: number;
}

export interface ImportPreview {
  import_id: string;
  filename: string;
  status: string;
  columns: string[];
  fields: ImportField[];
  quantities: 'set' | 'add';
  create_missing: boolean;
  counts: { rows: number; create: number; update: number; skip: number; invalid: number };
  creates: { categories: string[]; suppliers: string[]; locations: string[] };
  rows: { n: number; action: 'create' | 'update' | 'skip' | 'invalid'; name: string; sku: string; errors: string[]; values: Record<string, string> }[];
  invalid: { n: number; errors: string[] }[];
}

export interface ImportRecord {
  id: string;
  filename: string;
  status: 'previewed' | 'imported' | 'undone';
  rows: number;
  added: number;
  changed: number;
  skipped: number;
  created: string;
  updated: string;
}

export interface CsvFile {
  filename: string;
  content: string;
  rows?: number;
}

/* ------------------------------------------------------------ stockroom map */

export interface MapPlace {
  id: string;
  name: string;
  code: string;
  kind: LocationKind;
  parent: string | null;
  depth: number;
  path: string;
  sort: number;
  /**
   * Its layout on the map, null for the automatic one: the centre of its
   * footprint (top level: on the floor; inside a space: from that space's far
   * corner) and its size (null: what its contents need).
   */
  map: { x: number; z: number; w: number | null; d: number | null } | null;
  /** Its own stock (not the places inside it). */
  items: number;
  units: number;
  value: number;
  value_text: string;
}

export interface MapItem {
  id: string;
  name: string;
  sku: string;
  unit: string;
  fractional: boolean;
  icon: string;
  photo: string | null;
  category: string | null;
  status: Status;
  on_hand: number;
  min_qty: number;
  max_qty: number;
  unit_cost_e4: number;
  value_text: string;
  /** Its home place: where an empty slot shows while it is out of stock. */
  home: string | null;
}

export interface MapStock {
  item: string;
  location: string;
  qty: number;
}

export interface MapData {
  currency: string;
  places: MapPlace[];
  items: MapItem[];
  stock: MapStock[];
  counts: { ok: number; low: number; out: number; over: number };
  totals: { places: number; items: number; units: number; value: number; value_text: string };
}
