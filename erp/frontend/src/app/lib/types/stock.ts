/**
 * Shapes of the inventory and manufacturing operations (pb_hooks/lib_items.js,
 * lib_mfg.js). Money is whole minor units unless the name ends in `_text`
 * (major units as text) or `_e4`; prices and costs arrive as text ("2.60").
 */
import type { CodeRef, Ref } from '../types.ts';

export type ItemKind = 'stock' | 'service' | 'non_stock';
/** `na` is a service or non-stock item (nothing counted). */
export type ItemStatus = 'ok' | 'low' | 'out' | 'over' | 'na';

export interface ItemCategoryRef {
  id: string;
  name: string;
  icon: string;
}

export interface Item {
  id: string;
  sku: string;
  name: string;
  kind: ItemKind;
  unit: string;
  fractional: boolean;
  barcode: string;
  sale_price: string;
  sale_price_e4: number;
  purchase_price: string;
  purchase_price_e4: number;
  min_qty: number;
  max_qty: number;
  archived: boolean;
  /** A path under the server ('/api/files/items/...'), or ''. */
  photo: string;
  category: ItemCategoryRef | null;
  supplier: Ref | null;
  on_hand: number;
  value: number;
  avg_cost: string;
  incoming: number;
  committed: number;
  available: number;
  status: ItemStatus;
}

export interface ItemCounts {
  all: number;
  ok: number;
  low: number;
  out: number;
  over: number;
  reorder: number;
}

export interface ItemList {
  items: Item[];
  total: number;
  value: number;
  counts: ItemCounts;
  currency: string;
}

export interface ItemMove {
  id: string;
  date: string;
  kind: MoveKind;
  qty: number;
  value: number;
  balance: number;
  entity: string;
  source: string;
  label: string;
  actor: string;
  warehouse: string;
}

export interface ItemDetail extends Item {
  description: string;
  lead_time_days: number;
  sale_tax: CodeRef | null;
  purchase_tax: CodeRef | null;
  income_account: CodeRef | null;
  expense_account: CodeRef | null;
  created: string;
  stock: { id: string; code: string; name: string; qty: number }[];
  moves: ItemMove[];
  open_lines: { id: string; type: string; number: string; date: string; expected: string; open: number; party: string }[];
  history: { date: string; qty: number }[];
  used_30d: number;
  days_left: number | null;
  bom: boolean;
  can: { edit: boolean; adjust: boolean };
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  income_account: string;
  expense_account: string;
  items: number;
}

export interface CategoryList {
  categories: Category[];
  icons: string[];
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string;
  archived: boolean;
  items: number;
  units: number;
  value: number;
}

export interface WarehouseList {
  warehouses: Warehouse[];
  currency: string;
}

export interface Level {
  item: { id: string; sku: string; name: string; unit: string };
  warehouse: Ref;
  qty: number;
  value: number;
}

export interface LevelList {
  levels: Level[];
  total: number;
  value: number;
  currency: string;
}

export type MoveKind = 'receipt' | 'delivery' | 'adjust_in' | 'adjust_out' | 'count' | 'transfer_in' | 'transfer_out' | 'build_in' | 'build_out' | 'opening' | 'return_in' | 'return_out';

export interface Move {
  id: string;
  date: string;
  kind: MoveKind;
  qty: number;
  value: number;
  balance: number;
  entity: string;
  source: string;
  label: string;
  actor: string;
  note: string;
  item: string;
  sku: string;
  name: string;
  unit: string;
  warehouse: string;
}

export interface MoveList {
  moves: Move[];
  total: number;
  currency: string;
}

export type ChangeKind = 'adjust' | 'count' | 'transfer';
export type ChangeReason = 'count' | 'damage' | 'loss' | 'found' | 'expiry' | 'sample' | 'correction' | 'opening' | 'other';

export interface StockChange {
  id: string;
  number: string;
  date: string;
  kind: ChangeKind;
  reason: ChangeReason | string;
  warehouse: Ref | null;
  to_warehouse: Ref | null;
  note: string;
  state: 'posted' | 'void' | string;
  value: number;
  lines_count: number;
  actor: string;
  who: string;
  journal: { id: string; number: string } | null;
  created: string;
}

export interface StockChangeDetail extends StockChange {
  moves: { id: string; qty: number; value: number; kind: MoveKind; item: string; sku: string; name: string; unit: string; warehouse: string }[];
  can: { void: boolean };
  currency: string;
}

export interface StockChangeList {
  changes: StockChange[];
  total: number;
  currency: string;
}

export interface ReorderLine {
  item: { id: string; sku: string; name: string; unit: string; icon: string };
  on_hand: number;
  incoming: number;
  committed: number;
  min_qty: number;
  target: number;
  qty: number;
  unit_price: string;
  value: number;
  why: string;
}

export interface ReorderGroup {
  supplier: Ref | null;
  items: ReorderLine[];
  value: number;
  draft: { id: string; number: string } | null;
}

export interface ReorderList {
  groups: ReorderGroup[];
  count: number;
  currency: string;
}

export interface ReorderResult {
  orders: { id: string; number: string; supplier: string; lines: number; total: number; updated: boolean }[];
  without_supplier: string[];
}

export interface StockReport {
  items: { id: string; sku: string; name: string; category: string; unit: string; qty: number; value: number; avg_cost: string }[];
  total: number;
  book: number;
  difference: number;
  currency: string;
  warehouse: Ref | null;
}

/* ------------------------------------------------------------ manufacturing */

export interface ItemBrief {
  id: string;
  sku: string;
  name: string;
  unit: string;
  kind?: string | undefined;
  fractional?: boolean | undefined;
}

export interface Bom {
  id: string;
  name: string;
  item: ItemBrief | null;
  output_qty: number;
  extra_cost: string;
  extra_cost_e4: number;
  notes: string;
  active: boolean;
  lines_count: number;
  components_cost: number;
  component_unit_cost: string;
  component_unit_cost_e4: number;
  unit_cost: string;
  unit_cost_e4: number;
  created: string;
  updated: string;
  currency: string;
}

export interface BomComponent {
  line: string;
  item: ItemBrief | null;
  qty: number;
  per_unit: number;
  avg_cost: string;
  avg_cost_e4: number;
  line_cost: number;
  on_hand: number;
}

export interface BomDetail extends Bom {
  components: BomComponent[];
  step: number;
  problems: string[];
  can_build: { warehouse: { id: string; code: string; name: string }; default: boolean; qty: number; limited_by: { id: string; sku: string; name: string } | null }[];
  builds: { draft: number; done: number; void: number };
  recent_builds: { id: string; number: string; status: BuildStatus; date: string; qty: number }[];
  can: { edit: boolean; build: boolean; delete: boolean };
}

export interface BomList {
  boms: Bom[];
  total: number;
  counts: { all: number; active: number; inactive: number };
  currency: string;
  can: { add: boolean };
}

export type BuildStatus = 'draft' | 'done' | 'void';

export interface Build {
  id: string;
  number: string;
  label: string;
  status: BuildStatus;
  date: string;
  qty: number;
  item: ItemBrief | null;
  bom: { id: string; name: string } | null;
  warehouse: { id: string; code: string; name: string } | null;
  cost: number;
  extra: number;
  unit_cost: string;
  note: string;
  actor: string;
  who: string;
  journal: { id: string; number: string } | null;
  void_journal: { id: string; number: string } | null;
  created: string;
  updated: string;
  currency: string;
}

export interface BuildList {
  builds: Build[];
  total: number;
  counts: { draft: number; done: number; void: number };
  currency: string;
  can: { create: boolean };
}

export interface BuildJournal {
  id: string;
  number: string;
  date: string;
  state: string;
  total: number;
  lines: { account: { id: string; code: string; name: string; type?: string | undefined }; debit: number; credit: number; memo: string; party: { name?: string | undefined } | string | null }[];
}

export interface BuildDraftComponent {
  line: string;
  item: ItemBrief;
  per_batch: number;
  need: number;
  on_hand: number;
  shortfall: number;
  avg_cost: string;
  value: number;
}

export interface BuildDoneComponent {
  line: string;
  item: ItemBrief;
  used: number;
  value: number;
}

export interface BuildDetail extends Omit<Build, 'bom' | 'journal' | 'void_journal'> {
  bom: { id: string; name: string; output_qty: number; extra_cost: string; active: boolean } | null;
  journal: BuildJournal | { id: string; number: string } | null;
  void_journal: BuildJournal | { id: string; number: string } | null;
  components: (BuildDraftComponent | BuildDoneComponent)[];
  components_value: number;
  estimated: boolean;
  step?: number | undefined;
  problems?: string[] | undefined;
  shortfalls?: number | undefined;
  allow_negative_stock?: boolean | undefined;
  ready?: boolean | undefined;
  moves?: { id: string; date: string; kind: MoveKind; item: ItemBrief; warehouse: string; qty: number; value: number; reversal: boolean }[] | undefined;
  can: { edit: boolean; complete: boolean; void: boolean; delete: boolean };
}
