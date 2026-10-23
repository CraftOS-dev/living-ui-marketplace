/**
 * The register calls the same operations your AI agent runs through the
 * agent-app CLI (pb_hooks/ops.pb.js), so every rule holds for both.
 *
 * One transport for all of them:
 * - the signed-in session ("till") rides along on every call;
 * - an action the person may not do alone ("approval_needed") asks for a
 *   manager's PIN and is sent again with it, once per attempt;
 * - an ended session ("signed_out") locks the register;
 * - other errors show as a toast unless the caller handles them (quiet).
 */
import { getPbClient, toast } from '../../kit/index.ts';
import type {
  AgentRequest,
  AppStatus,
  AuditEvent,
  Breakdown,
  BreakdownBy,
  Category,
  CsvFile,
  CurrentShift,
  Customer,
  CustomerDetail,
  DeletePreview,
  Discount,
  DisplayMessage,
  DisplayState,
  GiftCard,
  GiftCardList,
  ImportResult,
  Json,
  ModifierGroup,
  Order,
  OrderSummary,
  PaymentResult,
  PermissionCatalog,
  Permissions,
  Product,
  ProductList,
  Receipt,
  Register,
  RegisterCatalog,
  ReportSummary,
  Session,
  Settings,
  SetupStatus,
  Shift,
  Staff,
  StockLevels,
  StockMove,
  Tax,
  TimeEntry,
  TimeTotals,
  Unlock,
  AccountMove,
} from './types.ts';

type Params = Record<string, unknown>;

/** An operation's refusal: its HTTP status, message and typed code. */
export class OpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: Record<string, Json>;
  constructor(status: number, message: string, data: Record<string, Json>) {
    super(message);
    this.status = status;
    this.data = data;
    this.code = typeof data['code'] === 'string' ? data['code'] : '';
  }
}

/** The person closed the approval prompt: nothing to report. */
export const CANCELLED = 'cancelled';

export function isCancelled(err: unknown): boolean {
  return err instanceof OpError && err.code === CANCELLED;
}

export function errMessage(err: unknown): string {
  if (err instanceof OpError) return err.message;
  const e = err as { message?: string | undefined };
  return e.message ?? 'Something went wrong';
}

/* -------------------------------------------------------------- the seams */

export interface ApprovalAsk {
  /** What needs approving, e.g. "give discounts (up to the limit)". */
  label: string;
  message: string;
  wrong: boolean;
}

/** The manager-PIN prompt: ask for a PIN (null when cancelled); settle when the approved call is done. */
export interface Approver {
  ask: (ask: ApprovalAsk) => Promise<string | null>;
  settle: () => void;
}

let till = '';
let approver: Approver | null = null;
let signedOut: (() => void) | null = null;

export function setTill(token: string): void {
  till = token;
}

export function getTill(): string {
  return till;
}

/** The manager-PIN prompt (components/Approval.tsx). */
export function setApprover(a: Approver | null): void {
  approver = a;
}

export function onSignedOut(fn: (() => void) | null): void {
  signedOut = fn;
}

/* -------------------------------------------------------------- transport */

interface CallOptions {
  /** Handle errors yourself: no toast (approval prompts still show). */
  quiet?: boolean | undefined;
  /** No session needed (setup, unlock, the customer display). */
  open?: boolean | undefined;
}

function query(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}

function body(params: Params): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = v;
  return out;
}

function toOpError(err: unknown): OpError {
  const e = err as { status?: number | undefined; message?: string | undefined; raw?: { response?: { message?: string; data?: Record<string, Json> } } | undefined };
  const resp = e.raw?.response;
  const status = typeof e.status === 'number' ? e.status : 0;
  const message = status === 0 ? 'The register cannot reach the store server. Check the connection and try again.' : (resp?.message ?? e.message ?? 'Something went wrong');
  return new OpError(status, message, resp?.data ?? {});
}

async function send<T>(method: 'GET' | 'POST', op: string, params: Params, opts: CallOptions = {}): Promise<T> {
  const p: Params = { ...params };
  if (!opts.open && till !== '' && p['till'] === undefined) p['till'] = till;
  let asked = false;
  for (;;) {
    try {
      const path = `/api/ops/${op}`;
      const fn = method === 'GET' ? (pb: import('pocketbase').default) => pb.send<T>(path, { method, query: query(p), requestKey: null }) : (pb: import('pocketbase').default) => pb.send<T>(path, { method, body: body(p), requestKey: null });
      const out = await getPbClient().call(fn, { silent: true });
      if (asked) approver?.settle();
      return out;
    } catch (raw) {
      const err = toOpError(raw);
      if (err.code === 'approval_needed' && approver !== null) {
        const pin = await approver.ask({ label: typeof err.data['label'] === 'string' ? err.data['label'] : '', message: err.message, wrong: asked || err.data['wrong_pin'] === true });
        if (pin === null) throw new OpError(403, 'Cancelled', { code: CANCELLED });
        p['approve_pin'] = pin;
        asked = true;
        continue;
      }
      if (asked) approver?.settle();
      if (err.code === 'signed_out' && signedOut !== null && !opts.open) {
        signedOut();
        throw err;
      }
      if (!opts.quiet) toast.error(err.message);
      throw err;
    }
  }
}

async function upload<T>(op: string, form: FormData, opts: CallOptions = {}): Promise<T> {
  if (till !== '' && !form.has('till')) form.set('till', till);
  let asked = false;
  for (;;) {
    try {
      const out = await getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'POST', body: form, requestKey: null }), { silent: true });
      if (asked) approver?.settle();
      return out;
    } catch (raw) {
      const err = toOpError(raw);
      if (err.code === 'approval_needed' && approver !== null) {
        const pin = await approver.ask({ label: typeof err.data['label'] === 'string' ? err.data['label'] : '', message: err.message, wrong: asked });
        if (pin === null) throw new OpError(403, 'Cancelled', { code: CANCELLED });
        form.set('approve_pin', pin);
        asked = true;
        continue;
      }
      if (asked) approver?.settle();
      if (err.code === 'signed_out' && signedOut !== null) {
        signedOut();
        throw err;
      }
      if (!opts.quiet) toast.error(err.message);
      throw err;
    }
  }
}

const get = <T>(op: string, params: Params = {}, opts?: CallOptions | undefined): Promise<T> => send<T>('GET', op, params, opts);
const post = <T>(op: string, params: Params = {}, opts?: CallOptions | undefined): Promise<T> => send<T>('POST', op, params, opts);

/** Form fields for an upload: JSON values as text, files as files. */
function form(fields: Params, files: Record<string, File | null | undefined>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    f.set(k, v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  for (const [k, file] of Object.entries(files)) if (file) f.set(k, file);
  return f;
}

/* ----------------------------------------------------------- operations */

export interface SetupInput {
  business_name: string;
  currency: string;
  currency_digits?: number | undefined;
  prices_include_tax?: boolean | undefined;
  tax_name?: string | undefined;
  tax_rate?: number | undefined;
  owner_name: string;
  owner_pin: string;
  register_name?: string | undefined;
  address?: string | undefined;
  phone?: string | undefined;
}

export interface LineInput {
  order?: string | undefined;
  kind?: 'item' | 'custom' | 'gift_card' | undefined;
  variant?: string | undefined;
  code?: string | undefined;
  product?: string | undefined;
  qty?: number | undefined;
  modifiers?: string[] | undefined;
  price?: string | undefined;
  reason?: string | undefined;
  amount?: string | undefined;
  name?: string | undefined;
  tax?: string | undefined;
  gift_code?: string | undefined;
  note?: string | undefined;
  expected_version?: number | undefined;
}

export interface LineChange {
  line: string;
  qty?: number | undefined;
  price?: string | undefined;
  reason?: string | undefined;
  discount?: { kind: 'percent' | 'amount'; value: number | string; reason: string } | null | undefined;
  modifiers?: string[] | undefined;
  note?: string | undefined;
  restock?: boolean | undefined;
  name?: string | undefined;
  expected_version?: number | undefined;
}

export interface OrderChange {
  order?: string | undefined;
  customer?: string | undefined;
  label?: string | undefined;
  note?: string | undefined;
  discount?: { kind?: 'percent' | 'amount'; value?: number | string; reason?: string; promotion?: string } | null | undefined;
  code?: string | undefined;
  tax_exempt?: boolean | undefined;
  reason?: string | undefined;
  tip?: string | undefined;
  tip_percent?: number | undefined;
  expected_version?: number | undefined;
}

export interface PaymentInput {
  order: string;
  tender: string;
  amount?: string | undefined;
  tendered?: string | undefined;
  reference?: string | undefined;
  gift_code?: string | undefined;
  label?: string | undefined;
  client_ref: string;
}

export interface ProductInput {
  id?: string | undefined;
  name?: string | undefined;
  category?: string | undefined;
  price?: string | undefined;
  cost?: string | undefined;
  sku?: string | undefined;
  barcode?: string | undefined;
  track_stock?: boolean | undefined;
  stock?: number | undefined;
  low_at?: number | undefined;
  option_names?: string[] | undefined;
  variants?: { id?: string | undefined; options?: string[] | undefined; price?: string | undefined; cost?: string | undefined; sku?: string | undefined; barcode?: string | undefined; track_stock?: boolean | undefined; stock?: number | undefined; low_at?: number | undefined; archived?: boolean | undefined }[] | undefined;
  tax?: string | undefined;
  tax_exempt?: boolean | undefined;
  modifier_groups?: string[] | undefined;
  color?: string | undefined;
  favorite?: boolean | undefined;
  sold_by?: 'each' | 'weight' | undefined;
  unit?: string | undefined;
  description?: string | undefined;
  sort?: number | undefined;
  archived?: boolean | undefined;
  remove_image?: boolean | undefined;
}

export interface DiscountInput {
  id?: string | undefined;
  name?: string | undefined;
  kind?: Discount['kind'] | undefined;
  value?: string | undefined;
  scope?: Discount['scope'] | undefined;
  applies?: Discount['applies'] | undefined;
  categories?: string[] | undefined;
  products?: string[] | undefined;
  mode?: Discount['mode'] | undefined;
  code?: string | undefined;
  min_subtotal?: string | undefined;
  min_qty?: number | undefined;
  buy_qty?: number | undefined;
  get_qty?: number | undefined;
  days?: number[] | undefined;
  start_time?: string | undefined;
  end_time?: string | undefined;
  starts_on?: string | undefined;
  ends_on?: string | undefined;
  manager_only?: boolean | undefined;
  active?: boolean | undefined;
}

export const api = {
  /* the store */
  status: (opts?: CallOptions | undefined) => get<AppStatus>('app/status', {}, opts),
  setupStatus: () => get<SetupStatus>('setup/status', {}, { open: true, quiet: true }),
  setup: (input: SetupInput) => post<Unlock>('setup/complete', { ...input }, { open: true, quiet: true }),
  unlock: (pin: string, register: string) => post<Unlock>('auth/unlock', { pin, register }, { open: true, quiet: true }),
  session: () => get<Session>('auth/session', {}, { quiet: true }),
  settings: () => get<Settings>('settings/get'),
  saveSettings: (fields: Params, logo?: File | null | undefined) => (logo ? upload<Settings>('settings/update', form(fields, { logo })) : post<Settings>('settings/update', fields)),
  savePermissions: (permissions: Record<string, Partial<Permissions>>) => post<PermissionCatalog>('permissions/update', { permissions }),

  /* registers, display, staff */
  registers: () => get<{ registers: Register[] }>('registers/list'),
  saveRegister: (fields: { id?: string | undefined; name?: string | undefined; active?: boolean | undefined }) => post<{ register: Register }>('registers/save', fields),
  focus: (order: string, message?: DisplayMessage | null | undefined) => post<{ register: Register }>('registers/focus', { order, message }, { quiet: true }),
  display: (register: string) => get<DisplayState>('display/get', { register }, { open: true, quiet: true }),
  staff: () => get<{ staff: Staff[] }>('staff/list'),
  saveStaff: (fields: { id?: string | undefined; name?: string | undefined; role?: string | undefined; pin?: string | undefined; current_pin?: string | undefined; active?: boolean | undefined; color?: string | undefined; email?: string | undefined; phone?: string | undefined }, opts?: CallOptions | undefined) => post<{ staff: Staff }>('staff/save', fields, opts),
  /** Clock in or out: by PIN from the lock screen (no session), or the signed-in person. */
  clock: (pin: string | undefined, action: 'in' | 'out' | 'toggle' = 'toggle') => post<{ action: 'in' | 'out'; staff: { id: string; name: string }; entry: TimeEntry }>('staff/clock', { pin, action }, pin !== undefined ? { open: true, quiet: true } : undefined),
  timeclock: (q: { staff?: string | undefined; from?: string | undefined; to?: string | undefined }) => get<{ from: string; to: string; entries: TimeEntry[]; totals: TimeTotals[] }>('timeclock/list', q),
  saveTime: (fields: { id?: string | undefined; staff?: string | undefined; clock_in?: string | undefined; clock_out?: string | undefined; note?: string | undefined }) => post<{ entry: TimeEntry }>('timeclock/save', fields),

  /* catalog */
  catalog: () => get<RegisterCatalog>('catalog/register', {}, { quiet: true }),
  categories: () => get<{ categories: Category[] }>('categories/list'),
  saveCategory: (fields: { id?: string | undefined; name?: string | undefined; color?: string | undefined; sort?: number | undefined }) => post<{ category: Category }>('categories/save', fields),
  taxes: () => get<{ taxes: Tax[] }>('taxes/list'),
  saveTax: (fields: { id?: string | undefined; name?: string | undefined; rate?: number | undefined; is_default?: boolean | undefined }) => post<{ tax: Tax }>('taxes/save', fields),
  modifiers: () => get<{ modifier_groups: ModifierGroup[] }>('modifiers/list'),
  saveModifiers: (fields: { id?: string | undefined; name?: string | undefined; min?: number | undefined; max?: number | undefined; options?: { id?: string | undefined; name: string; price: string }[] | undefined; sort?: number | undefined }) => post<{ modifier_group: ModifierGroup }>('modifiers/save', fields),
  products: (q: { q?: string | undefined; category?: string | undefined; favorites?: boolean | undefined; archived?: boolean | undefined; stock?: string | undefined; sort?: string | undefined; limit?: number | undefined; page?: number | undefined }) => get<ProductList>('products/list', q),
  product: (product: string) => get<{ product: Product }>('products/get', { product }),
  lookup: (code: string) => get<{ product: Product; variant: Product['variants'][number] }>('products/lookup', { code }, { quiet: true }),
  saveProduct: (fields: ProductInput, image?: File | null | undefined) => (image ? upload<{ product: Product; notes: string[] }>('products/save', form({ ...fields }, { image })) : post<{ product: Product; notes: string[] }>('products/save', { ...fields })),
  importProducts: (csv: string, dry_run: boolean) => post<ImportResult>('products/import', { csv, dry_run }, { quiet: true }),
  exportProducts: (archived: boolean) => get<CsvFile>('products/export', { archived }),

  /* stock */
  stock: (q: { status?: string | undefined; q?: string | undefined }) => get<StockLevels>('stock/levels', q),
  changeStock: (reason: 'receive' | 'adjust' | 'count' | 'damage' | 'loss', lines: { variant: string; qty: number; cost?: string | undefined }[], note?: string | undefined) => post<{ reason: string; batch: string; lines: Json[] }>('stock/change', { reason, lines, note }),
  moves: (q: { variant?: string | undefined; product?: string | undefined; reason?: string | undefined; from?: string | undefined; to?: string | undefined; limit?: number | undefined; page?: number | undefined }) => get<{ moves: StockMove[]; more: boolean }>('stock/moves', q),

  /* customers, gift cards */
  customers: (q: { q?: string | undefined; sort?: string | undefined; limit?: number | undefined; page?: number | undefined }, opts?: CallOptions | undefined) => get<{ customers: Customer[]; more: boolean; total: number }>('customers/list', q, opts),
  customer: (customer: string) => get<CustomerDetail>('customers/get', { customer }),
  saveCustomer: (fields: { id?: string | undefined; name?: string | undefined; phone?: string | undefined; email?: string | undefined; notes?: string | undefined; tags?: string[] | undefined; tax_exempt?: boolean | undefined; marketing?: boolean | undefined; birthday?: string | undefined }) => post<{ customer: Customer }>('customers/save', fields),
  adjustCustomer: (customer: string, account: 'points' | 'credit', delta: string, note: string) => post<{ customer: Customer; before: number; after: number }>('customers/adjust', { customer, account, delta, note }),
  importCustomers: (csv: string, dry_run: boolean) => post<ImportResult>('customers/import', { csv, dry_run }, { quiet: true }),
  exportCustomers: () => get<CsvFile>('customers/export'),
  giftCards: (q: { q?: string | undefined; status?: string | undefined; limit?: number | undefined }) => get<GiftCardList>('giftcards/list', q),
  giftCard: (code: string, opts?: CallOptions | undefined) => get<{ gift_card: GiftCard; customer: { id: string; name: string } | null; moves: AccountMove[] }>('giftcards/get', { code }, opts),
  saveGiftCard: (fields: { id?: string | undefined; code?: string | undefined; amount?: string | undefined; status?: string | undefined; customer?: string | undefined; note?: string | undefined }) => post<{ gift_card: GiftCard }>('giftcards/save', fields),
  adjustGiftCard: (code: string, delta: string, note: string) => post<{ gift_card: GiftCard }>('giftcards/adjust', { code, delta, note }),

  /* promotions */
  discounts: (mode?: string | undefined) => get<{ discounts: Discount[] }>('discounts/list', { mode }),
  saveDiscount: (fields: DiscountInput) => post<{ discount: Discount }>('discounts/save', { ...fields }),

  /* selling */
  orders: (q: { status?: string | undefined; q?: string | undefined; register?: string | undefined; customer?: string | undefined; staff?: string | undefined; returns?: boolean | undefined; from?: string | undefined; to?: string | undefined; limit?: number | undefined; page?: number | undefined }) => get<{ orders: OrderSummary[]; more: boolean }>('orders/list', q),
  order: (order: string, opts?: CallOptions | undefined) => get<{ order: Order }>('orders/get', { order }, opts),
  add: (input: LineInput, opts?: CallOptions | undefined) => post<Order>('orders/add', { ...input }, opts),
  changeLine: (change: LineChange, opts?: CallOptions | undefined) => post<Order>('orders/line', { ...change }, opts),
  removeLine: (line: string, expected_version?: number | undefined) => post<Order>('orders/remove', { line, expected_version }),
  changeOrder: (change: OrderChange, opts?: CallOptions | undefined) => post<Order>('orders/update', { ...change }, opts),
  startReturn: (from: string, input: { order?: string | undefined; lines?: { line: string; qty: number; restock: boolean }[] | undefined; all?: boolean | undefined }) => post<Order>('orders/return', { from, ...input }),
  voidOrder: (order: string, reason?: string | undefined) => post<Order | { deleted: true; id: string }>('orders/void', { order, reason }),
  complete: (order: string) => post<Order>('orders/complete', { order }),
  receipt: (order: string) => get<{ receipt: Receipt }>('orders/receipt', { order }),
  pay: (input: PaymentInput) => post<PaymentResult>('payments/add', { ...input }),
  voidPayment: (payment: string, reason?: string | undefined) => post<{ order: Order }>('payments/void', { payment, reason }),

  /* the drawer */
  currentShift: (register?: string | undefined) => get<CurrentShift>('shifts/current', { register }, { quiet: true }),
  openShift: (input: { float?: string | undefined; counts?: Record<string, number> | undefined }) => post<{ shift: Shift }>('shifts/open', input),
  cash: (kind: 'pay_in' | 'pay_out' | 'no_sale', amount?: string | undefined, reason?: string | undefined) => post<{ shift: Shift }>('shifts/cash', { kind, amount, reason }),
  closeShift: (input: { counted?: string | undefined; counts?: Record<string, number> | undefined; note?: string | undefined }) => post<{ shift: Shift; difference: number; review: Json }>('shifts/close', input),
  shifts: (q: { register?: string | undefined; from?: string | undefined; to?: string | undefined; limit?: number | undefined }) => get<{ shifts: Shift[]; more: boolean }>('shifts/list', q),
  shift: (shift: string) => get<{ shift: Shift }>('shifts/get', { shift }),

  /* reports, activity */
  summary: (q: { from?: string | undefined; to?: string | undefined; register?: string | undefined; staff?: string | undefined }) => get<ReportSummary>('reports/summary', q),
  breakdown: (by: BreakdownBy, q: { from?: string | undefined; to?: string | undefined; register?: string | undefined; staff?: string | undefined; limit?: number | undefined }) => get<Breakdown>('reports/breakdown', { by, ...q }),
  exportSales: (kind: string, q: { from?: string | undefined; to?: string | undefined; register?: string | undefined; staff?: string | undefined }) => get<CsvFile>('reports/export', { kind, ...q }),
  events: (q: { kind?: string | undefined; staff?: string | undefined; order?: string | undefined; from?: string | undefined; to?: string | undefined; limit?: number | undefined; page?: number | undefined }) => get<{ events: AuditEvent[]; more: boolean; kinds: string[] }>('events/list', q),

  /* asking your AI agent */
  ask: (kind: AgentRequest['kind'], fields: { order?: string | undefined; contact?: string | undefined; shift?: string | undefined; body?: string | undefined }, opts?: CallOptions | undefined) => post<{ request: AgentRequest; asked: boolean; message: string }>('requests/create', { kind, ...fields }, opts),
  requests: (q: { status?: string | undefined; kind?: string | undefined; limit?: number | undefined }) => get<{ requests: AgentRequest[]; more: boolean }>('requests/list', q),

  /* deleting */
  deletePreview: (collection: string, id: string) => post<DeletePreview>('records/delete', { collection, id, preview: true }),
  delete: (collection: string, id: string) => post<{ deleted: boolean }>('records/delete', { collection, id }),
};

/** A random idempotency key for one payment attempt (a repeated submit never charges twice). */
export function clientRef(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return 'r' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
