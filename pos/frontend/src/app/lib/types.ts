/** Shapes of what the operations return (pb_hooks/lib_*.js). Money is integer minor units. */

export type Role = 'owner' | 'manager' | 'cashier';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type TenderKind = 'cash' | 'card' | 'qr' | 'other';
export type PriceMode = 'inclusive' | 'exclusive';
export type TaxRounding = 'half_up' | 'floor' | 'ceil';
export type Approvable = 'discount_over' | 'price_override' | 'refund' | 'refund_blind' | 'void_ticket' | 'cash_move';
export type Action =
  | 'sell'
  | 'park'
  | 'discount'
  | 'discount_over'
  | 'price_override'
  | 'refund'
  | 'refund_blind'
  | 'void_ticket'
  | 'cash_move'
  | 'shift'
  | 'reports'
  | 'catalog'
  | 'customers'
  | 'customers_admin'
  | 'stock'
  | 'kitchen'
  | 'reprint'
  | 'imports'
  | 'settings'
  | 'staff';

export interface Settings {
  setup_done: boolean;
  business_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  tax_reg_label: string;
  tax_reg_no: string;
  company_reg_no: string;
  region: string;
  currency: string;
  currency_decimals: number;
  price_mode: PriceMode;
  tax_rounding: TaxRounding;
  cash_rounding: number;
  cash_rounding_text: string;
  order_types: OrderType[];
  default_order_type: OrderType | '';
  service_charge_bp: number;
  service_charge: string;
  service_charge_scope: 'dine_in' | 'all';
  service_charge_tax: string;
  receipt_header: string;
  receipt_footer: string;
  receipt_width: '80' | '58';
  receipt_barcode: boolean;
  after_sale: 'ask' | 'print' | 'none';
  logo: string;
  logo_url: string;
  kitchen_enabled: boolean;
  order_numbers: boolean;
  show_tile_prices: boolean;
  lock_minutes: number;
  cashier_discount_bp: number;
  cashier_discount: string;
  day_cutoff_hour: number;
  today: string;
}

export interface Region {
  code: string;
  label: string;
  currency: string;
  price_mode: PriceMode;
  tax_rounding: TaxRounding;
  cash_rounding: number;
  tax_reg_label: string;
  order_types: OrderType[];
  default_order_type: OrderType | '';
  classes: { name: string; rate_bp: number; dine_in_rate_bp: number; mark: string; is_default?: boolean }[];
}

export interface TaxClass {
  id: string;
  name: string;
  rate_bp: number;
  rate: string;
  dine_in_rate_bp: number;
  dine_in_rate: string;
  mark: string;
  sort: number;
  is_default: boolean;
  archived: boolean;
  products?: number;
}

export interface Tender {
  id: string;
  name: string;
  kind: TenderKind;
  ask_reference: boolean;
  active: boolean;
  sort: number;
  qr: string;
  qr_url: string;
}

export interface Register {
  id: string;
  name: string;
  code: string;
  archived: boolean;
  receipts: number;
  shift: { id: string; number: number; opened: string } | null;
}

export interface Staff {
  id: string;
  name: string;
  role: Role;
  color: number;
  active: boolean;
  training: boolean;
  pin_set: boolean;
  locked: boolean;
  permissions: Action[];
}

export interface SessionInfo {
  token: string;
  expires: string;
  staff: Staff;
}

export interface Category {
  id: string;
  name: string;
  color: number;
  icon: string;
  sort: number;
  kitchen: boolean;
  products: number;
}

export interface ModifierOption {
  id: string;
  name: string;
  price: number;
  price_text: string;
  is_default: boolean;
  available: boolean;
  sort: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  sort: number;
  options: ModifierOption[];
  products: number;
}

export interface Discount {
  id: string;
  name: string;
  kind: 'percent' | 'amount';
  value: number;
  value_text: string;
  scope: 'order' | 'item';
  sort: number;
}

export interface CatalogVariant {
  id: string;
  name: string;
  price: number;
  sku: string;
  stock: number | null;
}

export interface CatalogProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  open_price: boolean;
  tax_class: string;
  sku: string;
  thumb_url: string;
  tile_url: string;
  color: number;
  icon: string;
  kitchen: boolean;
  available: boolean;
  favorite: boolean;
  sort: number;
  fav_sort: number;
  modifier_groups: string[];
  track_stock: boolean;
  stock: number | null;
  low: boolean;
  variants: CatalogVariant[];
  barcodes: { code: string; variant: string }[];
}

export interface Catalog {
  categories: Category[];
  products: CatalogProduct[];
  groups: ModifierGroup[];
  discounts: Discount[];
  currency_decimals: number;
  generated: string;
}

export interface ProductVariant {
  id: string;
  name: string;
  price: number;
  price_text: string;
  sku: string;
  cost: number;
  cost_text: string;
  sort: number;
  stock: number | null;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  category_name: string;
  price: number;
  price_text: string;
  open_price: boolean;
  tax_class: string;
  tax_name: string;
  sku: string;
  description: string;
  photo: string;
  photo_url: string;
  thumb_url: string;
  tile_url: string;
  color: number;
  own_color: number;
  icon: string;
  kitchen: boolean;
  cost: number;
  cost_text: string;
  available: boolean;
  archived: boolean;
  status: 'active' | 'draft';
  track_stock: boolean;
  low_stock: number;
  stock: number | null;
  low: boolean;
  favorite: boolean;
  sort: number;
  fav_sort: number;
  modifier_groups: string[];
  variants: ProductVariant[];
  barcodes: { code: string; variant: string }[];
  import_ref: string;
  created: string;
  updated: string;
  sold_30d?: { qty: number; net: number; net_text: string };
  ever_sold?: boolean;
}

export interface ProductList {
  products: Product[];
  total: number;
  counts: { active: number; draft: number; archived: number; sold_out: number };
}

export type Lookup =
  | { type: 'product'; via: string; code: string; product: Product; variant: string }
  | { type: 'sale'; code: string; sale: { id: string; number: string; kind: SaleKind } }
  | { type: 'none'; code: string; message: string };

export type SaleKind = 'sale' | 'refund' | 'exchange';

export interface SaleLine {
  id: string;
  line_no: number;
  product: string;
  variant: string;
  name: string;
  variant_name: string;
  sku: string;
  category: string;
  qty: number;
  unit: number;
  modifiers: { name: string; price: number }[];
  gross: number;
  line_discount: number;
  order_discount: number;
  discount_name: string;
  net: number;
  tax_class: string;
  tax_name: string;
  rate_bp: number;
  mark: string;
  tax: number;
  note: string;
  origin: string;
  restock: boolean;
  price_changed: boolean;
  kitchen: boolean;
  returned: number;
}

export interface TaxRow {
  tax_id: string;
  name: string;
  rate_bp: number;
  mark: string;
  base: number;
  tax: number;
  gross: number;
}

export interface SalePayment {
  id: string;
  tender: string;
  kind: TenderKind;
  name: string;
  amount: number;
  tendered: number;
  change: number;
  reference: string;
}

export interface ReceiptHeader {
  business_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  tax_reg_label: string;
  tax_reg_no: string;
  company_reg_no: string;
  receipt_header: string;
  receipt_footer: string;
  logo_url: string;
  register: string;
  register_code: string;
  staff: string;
  customer: string;
  customer_phone: string;
}

export interface Sale {
  id: string;
  ref: string;
  number: string;
  register: string;
  shift: string;
  staff: string;
  staff_name: string;
  customer: string;
  order_type: OrderType | '';
  order_no: number;
  name: string;
  kind: SaleKind;
  training: boolean;
  currency: string;
  currency_decimals: number;
  price_mode: PriceMode;
  item_count: number;
  subtotal: number;
  discount_total: number;
  service_charge: number;
  tax_total: number;
  taxes: TaxRow[];
  rounding: number;
  total: number;
  total_text: string;
  paid: number;
  change: number;
  business_day: string;
  note: string;
  header: ReceiptHeader;
  approvals: { action: Approvable; approver: string; why: string[] }[];
  hash: string;
  created: string;
  lines: SaleLine[];
  payments: SalePayment[];
  returns: { id: string; number: string; kind: SaleKind; created: string }[];
  returns_from: { id: string; number: string }[];
  ticket: { id: string; status: 'new' | 'ready' | 'done' } | null;
  replayed?: boolean;
}

export interface SaleListItem {
  id: string;
  number: string;
  kind: SaleKind;
  total: number;
  /** What changed hands: the total plus cash rounding. */
  collected: number;
  total_text: string;
  items: number;
  order_no: number;
  order_type: OrderType | '';
  name: string;
  business_day: string;
  created: string;
  staff_name: string;
  customer_name: string;
  tenders: string[];
  training: boolean;
}

export interface RefundableLine extends SaleLine {
  left: number;
  returned_amounts: { qty: number; gross: number; line_discount: number; order_discount: number; net: number; tax: number };
}

export interface Refundable {
  sale: { id: string; number: string; created: string; training: boolean; customer: string; order_type: OrderType | ''; payments: SalePayment[]; total: number; price_mode: PriceMode };
  lines: RefundableLine[];
}

/** A cart line as the counter keeps it and the operations take it. */
export interface CartLineInput {
  product: string;
  variant: string;
  qty: number;
  modifiers: string[];
  price: number | null;
  discount: { kind: 'percent' | 'amount'; value: number; name: string } | null;
  note: string;
  name: string;
  tax_class: string;
  return_of: string;
  restock: boolean;
  blind: boolean;
}

export interface Ticket {
  id: string;
  ref: string;
  status: 'parked' | 'resumed' | 'done' | 'void';
  source: 'counter' | 'agent';
  name: string;
  order_type: OrderType | '';
  customer: string;
  customer_name: string;
  staff: string;
  staff_name: string;
  register: string;
  register_code: string;
  lines: (CartLineInput & { label: string })[];
  discount: { kind: 'percent' | 'amount'; value: number; name: string } | null;
  note: string;
  total: number;
  total_text: string;
  items: number;
  sale: string;
  void_reason: string;
  created: string;
  updated: string;
}

export interface ShiftReport {
  kind: 'x' | 'z';
  shift: {
    id: string;
    number: number;
    status: 'open' | 'closed';
    register: { id: string; name: string; code: string } | null;
    opened_at: string;
    opened_by: string;
    closed_at: string;
    closed_by: string;
    note: string;
  };
  currency: string;
  currency_decimals: number;
  sales: {
    orders: number;
    refunds: number;
    items: number;
    returned_items: number;
    gross: number;
    discounts: number;
    returns: number;
    net: number;
    service_charge: number;
    tax: number;
    rounding: number;
    total: number;
  };
  taxes: { name: string; rate_bp: number; mark: string; base: number; tax: number; gross: number }[];
  tenders: { name: string; kind: TenderKind; count: number; amount: number }[];
  cash: {
    opening_float: number;
    cash_taken: number;
    cash_refunded: number;
    pay_in: number;
    pay_out: number;
    drops: number;
    expected: number;
    counted: number | null;
    variance: number | null;
    opening_counts: Record<string, number>;
    closing_counts: Record<string, number>;
  };
  moves: { id: string; kind: 'pay_in' | 'pay_out' | 'drop'; amount: number; reason: string; staff: string; approver: string; created: string }[];
  categories: { name: string; qty: number; net: number }[];
  staff: { name: string; orders: number; total: number }[];
  overrides: number;
  voided_tickets: number;
  open_tickets: number;
  training_sales: number;
}

export interface ShiftListItem {
  id: string;
  number: number;
  status: 'open' | 'closed';
  register: { id: string; name: string; code: string } | null;
  opened_at: string;
  opened_by: string;
  closed_at: string;
  closed_by: string;
  orders: number;
  total: number;
  total_text: string;
  expected_cash: number | null;
  counted_cash: number | null;
  variance: number | null;
}

export interface KitchenTicket {
  id: string;
  sale: string;
  number: string;
  order_no: number;
  name: string;
  order_type: OrderType | '';
  items: { name: string; variant: string; qty: number; modifiers: string[]; note: string }[];
  note: string;
  status: 'new' | 'ready' | 'done';
  ready_at: string;
  done_at: string;
  training: boolean;
  created: string;
}

export interface KitchenList {
  tickets: KitchenTicket[];
  counts: { new: number; ready: number };
  all_day: { name: string; qty: number }[];
}

export interface Board {
  preparing: { id: string; order_no: number; name: string }[];
  ready: { id: string; order_no: number; name: string }[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  marketing: boolean;
  archived: boolean;
  visits: number;
  spent: number;
  spent_text: string;
  last_visit: string;
  created: string;
}

export interface CustomerDetail extends Customer {
  recent: SaleListItem[];
  favorites: { name: string; qty: number }[];
}

export interface Kpis {
  net_sales: number;
  gross: number;
  discounts: number;
  returns: number;
  tax: number;
  service_charge: number;
  collected: number;
  orders: number;
  refunds: number;
  average: number;
  items: number;
  gross_profit: number;
  costed_sales: number;
}

export interface ReportSummary {
  from: string;
  to: string;
  days: number;
  register: string;
  currency: string;
  currency_decimals: number;
  price_mode: PriceMode;
  kpis: Kpis;
  previous: Kpis & { from: string; to: string };
  by_day: { day: string; orders: number; collected: number; net: number }[];
  by_hour: { hour: number; orders: number; collected: number }[];
  products: { name: string; qty: number; net: number }[];
  categories: { name: string; qty: number; net: number }[];
  tenders: { name: string; kind: TenderKind; count: number; amount: number }[];
  staff: { name: string; orders: number; collected: number }[];
  order_types: { type: OrderType | ''; orders: number; collected: number }[];
  discounts: { name: string; sales: number; amount: number }[];
  taxes: { name: string; rate_bp: number; base: number; tax: number; gross: number }[];
}

export interface AuditEvent {
  id: string;
  kind: string;
  actor: 'staff' | 'agent' | 'system';
  staff: string;
  approver: string;
  register: string;
  ref: string;
  summary: string;
  created: string;
}

export interface ImportRec {
  id: string;
  status: 'waiting' | 'reading' | 'done' | 'failed';
  filename: string;
  file: string;
  file_path: string;
  url: string;
  thumb: string;
  kind: 'image' | 'pdf' | 'sheet';
  summary: string;
  error: string;
  created_count: number;
  to_review: number;
  added_by: 'staff' | 'agent';
  created: string;
  updated: string;
}

export interface StockItem {
  id: string;
  name: string;
  sku: string;
  category_name: string;
  icon: string;
  color: number;
  thumb_url: string;
  stock: number;
  low_stock: number;
  low: boolean;
  out: boolean;
  variants: { id: string; name: string; stock: number }[];
}

export interface StockMove {
  id: string;
  variant: string;
  variant_name: string;
  qty: number;
  kind: 'sale' | 'refund' | 'receive' | 'adjust' | 'count';
  reason: string;
  sale: string;
  sale_number: string;
  balance: number;
  by: string;
  actor: 'staff' | 'agent';
  created: string;
}

export interface AppStatus {
  setup_done: boolean;
  business_name: string;
  currency: string;
  today: string;
  registers: Register[];
  open_tickets: number;
  agent_tickets: number;
  drafts: number;
  imports_waiting: number;
  kitchen_open: number;
  low_stock: number;
  products: number;
}
