/**
 * What the operations answer (pb_hooks/lib_*.js). Money is always whole
 * minor units (cents); `*_text` fields are the server's own formatting.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type ColorSlot = 'neutral' | 'accent' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'graphite';
export const COLOR_SLOTS: ColorSlot[] = ['neutral', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'graphite'];

export type Role = 'owner' | 'manager' | 'cashier' | 'agent';

export type PermKey =
  | 'sell'
  | 'discount'
  | 'price_override'
  | 'tax_exempt'
  | 'return'
  | 'void'
  | 'no_sale'
  | 'cash_moves'
  | 'open_shift'
  | 'close_shift'
  | 'view_reports'
  | 'manage_catalog'
  | 'manage_stock'
  | 'manage_customers'
  | 'adjust_balances'
  | 'manage_discounts'
  | 'manage_staff'
  | 'manage_settings';

export type Permissions = Record<PermKey, boolean> & { max_discount: number };

export interface Ref {
  id: string;
  name: string;
}

/* ------------------------------------------------------------- the store */

export interface SetupStatus {
  needs_setup: boolean;
  setup_done: boolean;
  business_name: string;
  currency: string;
  currency_digits: number;
  currencies_with_other_digits: Record<string, number>;
  has_staff: boolean;
  lock_idle_minutes: number;
  logo: string;
  registers: Ref[];
}

export interface StaffBrief {
  id: string;
  name: string;
  role: Role;
  color: ColorSlot;
}

export interface Unlock {
  till: string;
  expires_in: number;
  staff: StaffBrief;
  register: Ref;
  permissions: Permissions;
}

export interface Session {
  actor: 'staff' | 'agent';
  staff: StaffBrief | null;
  register: Ref | null;
  role: Role;
  permissions: Permissions;
}

export interface Tender {
  id: string;
  label: string;
  custom?: boolean;
}

export interface PermissionCatalog {
  permissions: { key: PermKey; label: string }[];
  roles: Role[];
  matrix: Record<Role, Permissions>;
}

export interface Settings {
  setup_done: boolean;
  business_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  tax_number: string;
  receipt_header: string;
  receipt_footer: string;
  receipt_width: '58' | '80';
  receipt_prefix: string;
  next_receipt: number;
  logo: string;
  currency: string;
  currency_digits: number;
  prices_include_tax: boolean;
  cash_round_to: number;
  cash_round_to_text: string;
  denominations: number[];
  tips_enabled: boolean;
  tip_presets: number[];
  tip_basis: 'before_tax' | 'after_tax';
  card_reference: 'off' | 'optional' | 'required';
  tenders: Tender[];
  custom_tenders: Tender[];
  loyalty_enabled: boolean;
  points_per_unit: number;
  point_value: number;
  point_value_text: string;
  points_min_redeem: number;
  require_shift: boolean;
  allow_negative_stock: boolean;
  low_stock_default: number;
  lock_idle_minutes: number;
  lock_after_sale: boolean;
  auto_shift_review: boolean;
  show_tile_prices: boolean;
  has_sales: boolean;
  permissions: PermissionCatalog;
}

export interface AppStatus {
  store: string;
  currency: string;
  setup_done: boolean;
  now: string;
  today: { sales: number; total: number; total_text: string };
  open_shifts: { id: string; register: string; opened_at: string }[];
  open_tickets: number;
  low_stock: number;
  open_requests: number;
}

/* ------------------------------------------------------------- registers */

export interface Register {
  id: string;
  name: string;
  active: boolean;
  current_order: string;
  shift: { id: string; number: number; opened_at: string } | null;
}

export interface DisplayMessage {
  kind: 'thanks' | 'welcome' | 'text';
  change?: number;
  text?: string;
  number?: string;
}

export interface DisplayLine {
  name: string;
  qty: number;
  options: string[];
  total: number;
  discount: number;
}

export interface DisplayState {
  store: string;
  logo: string;
  currency: string;
  currency_digits: number;
  register: string;
  message: DisplayMessage | null;
  order: {
    id: string;
    status: OrderStatus;
    number: string;
    customer: { name: string; points: number } | null;
    lines: DisplayLine[];
    subtotal: number;
    discount_total: number;
    tax_total: number;
    total: number;
    tip: number;
    due: number;
    paid_total: number;
    balance: number;
    change: number;
    updated: string;
  } | null;
}

/* ----------------------------------------------------------------- staff */

export interface Staff extends StaffBrief {
  active: boolean;
  clocked_in: string | null;
  email?: string;
  phone?: string;
  last_signed_in?: string;
  has_pin?: boolean;
}

export interface TimeEntry {
  id: string;
  staff: Ref;
  clock_in: string;
  clock_out: string;
  open: boolean;
  minutes: number;
  note: string;
  edited_by: string | null;
}

export interface TimeTotals {
  staff: Ref;
  minutes: number;
  entries: number;
}

/* --------------------------------------------------------------- catalog */

export interface Category {
  id: string;
  name: string;
  color: ColorSlot;
  sort: number;
  products?: number | null;
}

export interface Tax {
  id: string;
  name: string;
  rate: number;
  is_default: boolean;
}

export interface ModifierOption {
  id: string;
  name: string;
  price: number;
  price_text: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  sort: number;
  options: ModifierOption[];
}

export type StockStatus = 'untracked' | 'ok' | 'low' | 'out';

export interface Variant {
  id: string;
  title: string;
  options: string[];
  sku: string;
  barcode: string;
  price: number;
  price_text: string;
  cost: number;
  cost_text: string;
  track_stock: boolean;
  stock: number;
  low_at: number;
  status: StockStatus;
  archived: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  category: Ref | null;
  color: ColorSlot;
  image: string;
  favorite: boolean;
  archived: boolean;
  sold_by: 'each' | 'weight';
  unit: string;
  sort: number;
  option_names: string[];
  modifier_groups: string[];
  tax: Tax | null;
  tax_own: string;
  tax_exempt: boolean;
  tracks_stock: boolean;
  stock: number;
  status: StockStatus;
  price_min: number;
  price_max: number;
  variants: Variant[];
  updated: string;
}

export interface RegisterCatalog {
  categories: Category[];
  products: Product[];
  modifier_groups: ModifierGroup[];
  taxes: Tax[];
}

export interface ProductList {
  products: Product[];
  total: number;
  more: boolean;
}

/* ----------------------------------------------------------------- stock */

export interface StockLevel {
  variant: string;
  product: string;
  name: string;
  sku: string;
  barcode: string;
  category: Ref | null;
  unit: string;
  stock: number;
  low_at: number;
  status: StockStatus;
  cost: number;
  price: number;
  value: number;
}

export interface StockLevels {
  levels: StockLevel[];
  low: number;
  out: number;
  units: number;
  value: number;
  value_text: string;
}

export type StockReason = 'sale' | 'return' | 'receive' | 'adjust' | 'count' | 'damage' | 'loss' | 'opening';

export interface StockMove {
  id: string;
  variant: string;
  product: string;
  name: string;
  delta: number;
  after: number;
  reason: StockReason;
  unit_cost: number;
  note: string;
  order: string;
  by: string;
  created: string;
}

/* ------------------------------------------------------------- customers */

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  tags: string[];
  tax_exempt: boolean;
  marketing: boolean;
  birthday: string;
  points: number;
  credit: number;
  credit_text: string;
  visits: number;
  spent: number;
  spent_text: string;
  last_visit: string;
  created: string;
}

export interface AccountMove {
  id: string;
  account: 'points' | 'credit' | 'gift_card';
  delta: number;
  after: number;
  reason: string;
  note: string;
  order: string;
  by: string;
  created: string;
}

export interface CustomerDetail {
  customer: Customer;
  orders: { id: string; number: string; total: number; total_text: string; items: number; paid_at: string; return_status: ReturnStatus }[];
  moves: AccountMove[];
  gift_cards: GiftCard[];
}

export interface GiftCard {
  id: string;
  code: string;
  masked: string;
  balance: number;
  balance_text: string;
  issued: number;
  status: 'active' | 'disabled';
  customer: string;
  note: string;
  last_used: string;
  created: string;
}

export interface GiftCardList {
  gift_cards: GiftCard[];
  more: boolean;
  outstanding: number;
  outstanding_text: string;
  active: number;
}

/* ------------------------------------------------------------- discounts */

export type DiscountMode = 'manual' | 'auto' | 'code';

export interface Discount {
  id: string;
  name: string;
  kind: 'percent' | 'amount' | 'bogo';
  value: number;
  value_text: string;
  scope: 'order' | 'item';
  applies: 'all' | 'categories' | 'products';
  categories: string[];
  products: string[];
  mode: DiscountMode;
  code: string;
  min_subtotal: number;
  min_subtotal_text: string;
  min_qty: number;
  buy_qty: number;
  get_qty: number;
  days: number[];
  start_time: string;
  end_time: string;
  starts_on: string;
  ends_on: string;
  manager_only: boolean;
  active: boolean;
  live: boolean;
  uses: number;
  summary: string;
}

/* ---------------------------------------------------------------- orders */

export type OrderStatus = 'open' | 'paid' | 'void';
export type ReturnStatus = 'none' | 'partial' | 'full';

export interface LineModifier {
  id: string;
  group: string;
  group_name: string;
  name: string;
  price: number;
}

export interface LineDiscount {
  kind: 'percent' | 'amount';
  value: number;
  reason: string;
  approved_by: string;
  amount?: number;
}

export interface AutoDiscount {
  id: string;
  name: string;
  source: DiscountMode;
  amount: number;
}

export interface OrderLine {
  id: string;
  kind: 'item' | 'custom' | 'gift_card';
  variant: string;
  product: string;
  category: string;
  name: string;
  variant_title: string;
  sku: string;
  qty: number;
  unit: string;
  unit_price: number;
  list_price: number;
  modifiers: LineModifier[];
  price_override: { from: number; to: number; reason: string; approved_by: string } | null;
  line_discount: LineDiscount | null;
  auto_discount: AutoDiscount | null;
  tax_name: string;
  tax_rate: number;
  gross: number;
  discount: number;
  tax: number;
  net: number;
  total: number;
  total_text: string;
  return_of: string;
  returned_qty: number;
  restock: boolean;
  gift_code: string;
  note: string;
}

export interface Payment {
  id: string;
  tender: string;
  label: string;
  amount: number;
  amount_text: string;
  tendered: number;
  change: number;
  reference: string;
  gift_card: string;
  points: number;
  status: 'captured' | 'voided';
  staff: string;
  approved_by: string;
  created: string;
}

export interface OrderDiscountSetting {
  source: 'manual' | 'code';
  id: string;
  name: string;
  code?: string;
  kind?: 'percent' | 'amount';
  value?: number;
  reason?: string;
  approved_by?: string;
}

export interface AppliedDiscount {
  id: string;
  name: string;
  kind: 'percent' | 'amount';
  value: number;
  source: string;
  reason: string;
  amount: number;
}

export interface TaxLine {
  id: string;
  name: string;
  rate: number;
  base: number;
  tax: number;
}

export interface OrderCustomer {
  id: string;
  name: string;
  phone: string;
  email: string;
  points: number;
  credit: number;
  tax_exempt: boolean;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  label: string;
  note: string;
  register: Ref | null;
  shift: string;
  opened_by: string;
  closed_by: string;
  customer: OrderCustomer | null;
  order_discount: OrderDiscountSetting | null;
  applied_discount: AppliedDiscount | null;
  tax_exempt: boolean;
  items: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  tip: number;
  rounding: number;
  due: number;
  paid_total: number;
  change_total: number;
  balance: number;
  total_text: string;
  due_text: string;
  balance_text: string;
  taxes: TaxLine[];
  has_returns: boolean;
  return_status: ReturnStatus;
  points_earned: number;
  lines: OrderLine[];
  sources: Record<string, { order: string; number: string }>;
  payments: Payment[];
  paid_at: string;
  voided_at: string;
  void_reason: string;
  version: number;
  created: string;
  updated: string;
  /** orders.get of a paid sale: what can still come back, per line id. */
  returnable?: Record<string, number>;
  /** orders.get of a paid sale: the sales that returned its items. */
  returns?: { id: string; number: string; status: OrderStatus }[];
}

export interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  label: string;
  customer: Ref | null;
  items: number;
  total: number;
  total_text: string;
  tip: number;
  balance: number;
  paid_total: number;
  has_returns: boolean;
  return_status: ReturnStatus;
  register: string;
  staff: string;
  paid_at: string;
  created: string;
  updated: string;
}

export interface PaymentResult {
  order: Order;
  payment: string;
  change: number;
  completed: boolean;
  repeated?: boolean;
}

export interface Receipt {
  number: string;
  status: OrderStatus;
  date: string;
  register: string;
  cashier: string;
  label: string;
  note: string;
  customer: { name: string; points: number } | null;
  currency: string;
  prices_include_tax: boolean;
  store: { name: string; address: string; phone: string; email: string; website: string; tax_number: string; header: string; footer: string; logo: string; width: '58' | '80' };
  lines: {
    kind: OrderLine['kind'];
    name: string;
    qty: number;
    unit: string;
    each: number;
    gross: number;
    discount: number;
    total: number;
    is_return: boolean;
    modifiers: { name: string; price: number }[];
    line_discount: { amount: number; label: string; reason: string } | null;
    promotion: { amount: number; label: string } | null;
    /** Masked: "•••• 1234". */
    gift_code: string;
    note: string;
  }[];
  subtotal: number;
  discount_total: number;
  order_discount: { name: string; amount: number } | null;
  taxes: TaxLine[];
  tax_total: number;
  total: number;
  tip: number;
  rounding: number;
  due: number;
  payments: { tender: string; label: string; amount: number; tendered: number; change: number; reference: string }[];
  change: number;
  points_earned: number;
  text: string;
}

/* ---------------------------------------------------------------- shifts */

export interface CashMove {
  id: string;
  kind: 'pay_in' | 'pay_out' | 'no_sale';
  amount: number;
  reason: string;
  staff: string;
  approved_by: string;
  created: string;
}

export interface SalesSummary {
  orders: number;
  sales: number;
  with_returns: number;
  items_sold: number;
  items_returned: number;
  gross_sales: number;
  discounts: number;
  returns: number;
  net_sales: number;
  net_ex_tax: number;
  tax: number;
  tips: number;
  rounding: number;
  gift_cards: number;
  collected: number;
  cost: number;
  profit: number;
  margin: number;
  average_sale: number;
  tenders: { tender: string; label: string; count: number; amount: number }[];
  [k: string]: unknown;
}

export interface ShiftReport {
  summary: SalesSummary;
  payments: { tender: string; label: string; count: number; amount: number; taken: number; refunded: number }[];
  cash: {
    opening_float: number;
    cash_sales: number;
    cash_refunds: number;
    pay_ins: number;
    pay_outs: number;
    no_sales: number;
    expected: number;
    expected_text: string;
    counted: number;
    difference: number;
  };
  voids: { sales: number; lines: number; payments: number };
  open_tickets: number;
}

export interface Shift {
  id: string;
  number: number;
  status: 'open' | 'closed';
  register: Ref;
  opened_by: string;
  opened_at: string;
  opening_float: number;
  closed_by: string;
  closed_at: string;
  counted: number;
  counts: { open?: Record<string, number>; close?: Record<string, number> } | null;
  expected: number;
  difference: number;
  difference_text: string;
  note: string;
  report?: ShiftReport;
  moves?: CashMove[];
}

export interface CurrentShift {
  register: Ref;
  shift: Shift | null;
  last_closed: { id: string; counted: number; closed_at: string } | null;
}

/* --------------------------------------------------------------- reports */

export interface ReportSummary {
  from: string;
  to: string;
  days: number;
  currency: string;
  summary: SalesSummary;
  previous: { from: string; to: string; net_sales: number; sales: number; average_sale: number; profit: number };
}

export type BreakdownBy = 'product' | 'category' | 'hour' | 'weekday' | 'day' | 'staff' | 'tender' | 'discount' | 'tax' | 'customer' | 'register';

export interface BreakdownRow {
  key: string;
  label: string;
  qty?: number;
  net_sales?: number;
  net_ex_tax?: number;
  discounts?: number;
  cost?: number;
  profit?: number;
  orders?: number;
  total?: number;
  average?: number;
  tips?: number;
  returns?: number;
  amount?: number;
  count?: number;
  uses?: number;
  base?: number;
  rate?: number;
  tax?: number;
}

export interface Breakdown {
  by: BreakdownBy;
  from: string;
  to: string;
  rows: BreakdownRow[];
  more: boolean;
}

/* ----------------------------------------------------- activity, requests */

export interface AuditEvent {
  id: string;
  kind: string;
  actor: 'staff' | 'agent' | 'system';
  staff: Ref | null;
  approved_by: Ref | null;
  register: string;
  order: string;
  amount: number | null;
  detail: string;
  data: Json;
  created: string;
}

export type RequestKind = 'receipt' | 'shift_review' | 'restock' | 'question';
export type RequestStatus = 'sent' | 'working' | 'done' | 'failed';

export interface AgentRequest {
  id: string;
  kind: RequestKind;
  title: string;
  body: string;
  contact: string;
  order: string;
  shift: string;
  customer: string;
  status: RequestStatus;
  result: string;
  staff: string;
  created: string;
  updated: string;
}

export interface DeletePreview {
  collection: string;
  id: string;
  name: string;
  affects: Record<string, number | boolean>;
  blocked: string;
  preview: boolean;
}

/** An import's report: dry_run plus counts (products_created, variants_updated, created, ...). */
export type ImportResult = { dry_run: boolean; rows: number } & Record<string, number | boolean>;

export interface CsvFile {
  filename: string;
  csv: string;
  rows?: number;
}
