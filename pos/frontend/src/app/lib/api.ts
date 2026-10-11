/**
 * The UI calls the same operations the AI agent calls through the agent-app
 * CLI (pb_hooks/ops*.pb.js), so every rule enforced there holds for both.
 * Each call carries this device's session (X-Pos-Session).
 *
 * Errors come back as OpError with the operation's machine `code`; the UI
 * acts on the code (approval_required opens the manager's PIN pad,
 * session_required locks the register), never on the wording.
 */
import { ClientResponseError } from 'pocketbase';
import { getPbClient, toast } from '../../kit/index.ts';
import type { NormalizedPbError } from '../../kit/index.ts';
import { session } from './session.ts';
import type {
  Approvable,
  AppStatus,
  AuditEvent,
  Board,
  Catalog,
  CartLineInput,
  Category,
  Customer,
  CustomerDetail,
  Discount,
  ImportRec,
  KitchenList,
  KitchenTicket,
  Lookup,
  ModifierGroup,
  Product,
  ProductList,
  Refundable,
  Region,
  Register,
  ReportSummary,
  Sale,
  SaleListItem,
  SessionInfo,
  Settings,
  ShiftListItem,
  ShiftReport,
  Staff,
  StockItem,
  StockMove,
  TaxClass,
  Tender,
  Ticket,
} from './types.ts';

export class OpError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;
  constructor(status: number, message: string, code: string, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

type Value = string | number | boolean | null | undefined;
type Params = Record<string, Value | unknown[] | object>;

interface CallOpts {
  /** Do not toast the error (the caller shows it). */
  silent?: boolean;
}

function headers(): Record<string, string> {
  const t = session.token();
  return t !== '' ? { 'X-Pos-Session': t } : {};
}

function toOpError(err: unknown): OpError {
  const n = err as NormalizedPbError;
  const raw = n.raw instanceof ClientResponseError ? n.raw : null;
  const body = (raw?.response ?? {}) as Record<string, unknown>;
  const code = typeof body['code'] === 'string' ? body['code'] : n.status === 0 ? 'offline' : 'error';
  const message = typeof body['message'] === 'string' && body['message'] !== '' ? body['message'] : n.status === 0 ? 'The register cannot reach the app. Check that it is running.' : (n.message ?? 'Something went wrong');
  return new OpError(n.status ?? 0, message, code, body);
}

async function call<T>(method: 'GET' | 'POST', op: string, params: Params | FormData, opts: CallOpts = {}): Promise<T> {
  try {
    return await getPbClient().call(
      (pb) => {
        if (params instanceof FormData) return pb.send<T>(`/api/ops/${op}`, { method, body: params, headers: headers() });
        if (method === 'GET') {
          const query: Record<string, string> = {};
          for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') query[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return pb.send<T>(`/api/ops/${op}`, { method, query, headers: headers() });
        }
        const body: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(params)) if (v !== undefined) body[k] = v;
        return pb.send<T>(`/api/ops/${op}`, { method, body, headers: headers() });
      },
      { silent: true },
    );
  } catch (err) {
    const e = toOpError(err);
    if (e.code === 'session_required') session.clear();
    if (opts.silent !== true && e.code !== 'approval_required' && e.code !== 'session_required') toast.error(e.message);
    throw e;
  }
}

const get = <T>(op: string, params: Params = {}, opts?: CallOpts): Promise<T> => call<T>('GET', op, params, opts);
const post = <T>(op: string, params: Params | FormData = {}, opts?: CallOpts): Promise<T> => call<T>('POST', op, params, opts);

/* ----------------------------------------------------- manager approvals */

type ApprovalHandler = (actions: Approvable[], why: string) => Promise<string[] | null>;
let approvalHandler: ApprovalHandler | null = null;

/** The approval overlay registers itself here (components/Approval.tsx). */
export function setApprovalHandler(fn: ApprovalHandler | null): void {
  approvalHandler = fn;
}

/** Ask a manager now (a discount over the limit, a price change), before the sale is paid. */
export async function requestApproval(actions: Approvable[], why: string): Promise<string[] | null> {
  if (approvalHandler === null) return null;
  return approvalHandler(actions, why);
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/**
 * Run an operation; when it answers approval_required, ask a manager (the
 * PIN overlay) and run it again with their approvals. Throws Cancelled when
 * nobody approves.
 */
export async function withApproval<T>(run: (approvals: string[]) => Promise<T>, why = ''): Promise<T> {
  const got: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await run(got);
    } catch (err) {
      if (!(err instanceof OpError) || err.code !== 'approval_required' || approvalHandler === null) throw err;
      const listed = Array.isArray(err.data['actions']) ? (err.data['actions'] as Approvable[]) : [err.data['action'] as Approvable];
      const tokens = await approvalHandler(listed, why);
      if (tokens === null) throw new Cancelled();
      got.push(...tokens);
    }
  }
  return run(got);
}

/* ------------------------------------------------------------ operations */

export const api = {
  status: () => get<AppStatus>('app/status'),
  regions: () => get<{ regions: Region[] }>('setup/regions'),
  setup: (p: { business_name: string; region: string; currency: string; owner_name: string; pin: string }) => post<{ settings: Settings; session: SessionInfo }>('setup/complete', p),

  me: () => get<{ staff: Staff | null; expires: string }>('auth/me', {}, { silent: true }),
  login: (staff: string, pin: string, register: string) => post<SessionInfo>('auth/login', { staff, pin, register }, { silent: true }),
  logout: () => post<{ ok: boolean }>('auth/logout', {}, { silent: true }),
  firstPin: (staff: string, pin: string, register: string) => post<SessionInfo>('auth/first-pin', { staff, pin, register }, { silent: true }),
  changePin: (current: string, pin: string) => post<{ ok: boolean }>('auth/change-pin', { current, pin }, { silent: true }),
  approve: (staff: string, pin: string, action: Approvable, scope: string) =>
    post<{ approval: string; action: Approvable; approver: { id: string; name: string } }>('auth/approve', { staff, pin, action, scope }, { silent: true }),

  staff: (includeInactive = false) => get<{ staff: Staff[] }>('staff/list', { include_inactive: includeInactive }),
  addStaff: (p: { name: string; role: string; pin: string; color: number }) => post<{ staff: Staff }>('staff/add', p),
  updateStaff: (p: Params) => post<{ staff: Staff }>('staff/update', p),
  setPin: (staff: string, pin: string) => post<{ staff: Staff }>('staff/set-pin', { staff, pin }),
  resetPin: (staff: string) => post<{ staff: Staff }>('staff/reset-pin', { staff }),

  settings: () => get<Settings>('settings/get'),
  updateSettings: (p: Params | FormData) => post<Settings>('settings/update', p),
  taxes: (includeArchived = false) => get<{ tax_classes: TaxClass[] }>('tax/list', { include_archived: includeArchived }),
  addTax: (p: Params) => post<TaxClass>('tax/add', p),
  updateTax: (p: Params) => post<TaxClass>('tax/update', p),
  archiveTax: (tax_class: string, archived: boolean) => post<TaxClass>('tax/archive', { tax_class, archived }),
  tenders: (includeInactive = false) => get<{ tenders: Tender[] }>('tenders/list', { include_inactive: includeInactive }),
  addTender: (p: Params) => post<Tender>('tenders/add', p),
  updateTender: (p: Params | FormData) => post<Tender>('tenders/update', p),
  registers: (includeArchived = false) => get<{ registers: Register[] }>('registers/list', { include_archived: includeArchived }),
  addRegister: (name: string) => post<Register>('registers/add', { name }),
  updateRegister: (p: Params) => post<Register>('registers/update', p),

  catalog: () => get<Catalog>('catalog/register'),
  categories: () => get<{ categories: Category[]; icons: string[] }>('categories/list'),
  addCategory: (p: Params) => post<Category>('categories/add', p),
  updateCategory: (p: Params) => post<Category>('categories/update', p),
  deleteCategory: (category: string) => post<{ deleted: string; uncategorized: number }>('categories/delete', { category }),
  reorderCategories: (ids: string[]) => post<{ categories: Category[] }>('categories/reorder', { categories: ids }),
  products: (p: Params) => get<ProductList>('products/list', p),
  product: (id: string) => get<Product>('products/get', { product: id }),
  addProduct: (p: Params | FormData) => post<Product>('products/add', p),
  updateProduct: (p: Params | FormData) => post<Product>('products/update', p),
  setAvailable: (product: string, available: boolean) => post<{ id: string; available: boolean }>('products/set-available', { product, available }),
  archiveProduct: (product: string) => post<{ id: string }>('products/archive', { product }),
  restoreProduct: (product: string) => post<{ id: string }>('products/restore', { product }),
  reorderProducts: (ids: string[], favorites: boolean) => post<{ ok: boolean }>('products/reorder', { products: ids, favorites }),
  approveProducts: (ids: string[]) => post<{ done: number }>('products/approve', { products: ids }),
  discardProducts: (ids: string[]) => post<{ done: number }>('products/discard', { products: ids }),
  importProducts: (rows: Record<string, unknown>[]) => post<{ created: number; categories_created: number }>('products/import', { rows, status: 'active' }),
  groups: () => get<{ groups: ModifierGroup[] }>('modifiers/list'),
  addGroup: (p: Params) => post<ModifierGroup>('modifiers/add-group', p),
  updateGroup: (p: Params) => post<ModifierGroup>('modifiers/update-group', p),
  deleteGroup: (group: string) => post<{ deleted: string }>('modifiers/delete-group', { group }),
  setOptionAvailable: (option: string, available: boolean) => post<{ id: string }>('modifiers/set-available', { option, available }),
  discounts: () => get<{ discounts: Discount[] }>('discounts/list'),
  addDiscount: (p: Params) => post<Discount>('discounts/add', p),
  updateDiscount: (p: Params) => post<Discount>('discounts/update', p),
  deleteDiscount: (discount: string) => post<{ deleted: string }>('discounts/delete', { discount }),
  lookup: (code: string) => get<Lookup>('lookup/code', { code }, { silent: true }),

  stock: (p: Params) => get<{ items: StockItem[]; counts: { all: number; low: number; out: number } }>('stock/list', p),
  stockHistory: (product: string) => get<{ product: { id: string; name: string }; moves: StockMove[] }>('stock/history', { product }),
  receiveStock: (p: Params) => post<{ on_hand: number }>('stock/receive', p),
  adjustStock: (p: Params) => post<{ on_hand: number }>('stock/adjust', p),
  countStock: (p: Params) => post<{ on_hand: number; difference: number }>('stock/count', p),

  imports: () => get<{ imports: ImportRec[]; counts: Record<string, number>; drafts: number }>('imports/list'),
  addImport: (form: FormData) => post<ImportRec>('imports/add', form),
  retryImport: (id: string) => post<ImportRec>('imports/retry', { import: id }),
  deleteImport: (id: string) => post<{ deleted: string }>('imports/delete', { import: id }),

  tickets: (status = 'open') => get<{ tickets: Ticket[]; open: number }>('tickets/list', { status }),
  park: (p: Params) => post<Ticket>('tickets/park', p),
  resume: (ticket: string, register: string) => post<Ticket>('tickets/resume', { ticket, register }),
  release: (ticket: string) => post<Ticket>('tickets/release', { ticket }, { silent: true }),
  voidTicket: (ticket: string, reason: string, approval: string) => post<Ticket>('tickets/void', { ticket, reason, approval }, { silent: true }),

  finalize: (p: {
    ref: string;
    register: string;
    lines: CartLineInput[];
    payments: { tender: string; amount: number; tendered: number; reference: string }[];
    discount: { kind: 'percent' | 'amount'; value: number; name: string } | null;
    order_type: string;
    customer: string;
    name: string;
    note: string;
    expected_total: number;
    approvals: string[];
    cart: string;
  }) => post<Sale>('sales/finalize', p, { silent: true }),
  sales: (p: Params) => get<{ sales: SaleListItem[]; total: number; offset: number }>('sales/list', p),
  sale: (sale: string) => get<Sale>('sales/get', { sale }),
  refundable: (sale: string) => get<Refundable>('sales/refundable', { sale }, { silent: true }),
  emailReceipt: (sale: string, email: string) => post<{ request: string }>('receipts/email', { sale, email }),
  reprint: (sale: string) => post<Sale>('receipts/reprint', { sale }),

  currentShift: (register: string) => get<{ register: { id: string; name: string; code: string }; shift: ShiftReport | null }>('shifts/current', { register }),
  shifts: (p: Params) => get<{ shifts: ShiftListItem[] }>('shifts/list', p),
  shiftReport: (shift: string) => get<ShiftReport>('shifts/report', { shift }),
  openShift: (register: string, counts: Record<string, number>) => post<ShiftReport>('shifts/open', { register, counts }),
  closeShift: (register: string, counts: Record<string, number>, note: string) => post<ShiftReport>('shifts/close', { register, counts, note }),
  cashMove: (p: Params) => post<{ id: string }>('cash/move', p, { silent: true }),

  kitchen: (view: 'active' | 'done') => get<KitchenList>('kitchen/list', { view }),
  board: () => get<Board>('kitchen/board'),
  bump: (ticket: string) => post<KitchenTicket>('kitchen/bump', { ticket }),
  recall: (ticket: string) => post<KitchenTicket>('kitchen/recall', { ticket }),

  customers: (p: Params) => get<{ customers: Customer[]; total: number }>('customers/list', p),
  customer: (id: string) => get<CustomerDetail>('customers/get', { customer: id }),
  addCustomer: (p: Params) => post<CustomerDetail>('customers/add', p),
  updateCustomer: (p: Params) => post<CustomerDetail>('customers/update', p),
  archiveCustomer: (customer: string, archived: boolean) => post<{ id: string }>('customers/archive', { customer, archived }),

  report: (p: Params) => get<ReportSummary>('reports/summary', p),
  exportCsv: (p: Params) => get<{ filename: string; rows: number; csv: string }>('reports/export', p),
  audit: (p: Params) => get<{ events: AuditEvent[]; total: number; offset: number; kinds: string[] }>('audit/list', p),
};
