/**
 * The UI calls the same operations the AI agent calls through the agent-app
 * CLI (pb_hooks/ops_*.pb.js), so every rule enforced there (locks, the
 * posting policy, reconciled entries) holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type {
  Account,
  ActivityEntry,
  Aged,
  Ask,
  Balance,
  BudgetReport,
  CashFlow,
  Contact,
  Currency,
  Dashboard,
  Doc,
  DocKind,
  DocSummary,
  Drill,
  FileRec,
  ImportRec,
  Line,
  Mapping,
  NetWorth,
  Period,
  PeriodRow,
  PnL,
  Policy,
  Preview,
  ReconOverview,
  ReconSession,
  ReconState,
  Region,
  Register,
  Rule,
  Run,
  Schedule,
  Settings,
  Spending,
  Summary,
  TaxCode,
  TaxReport,
  Trial,
  TxnDetail,
  TxnRow,
  Check,
} from './types.ts';

type Params = Record<string, unknown>;

function clean(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  }
  return out;
}

function get<T>(path: string, params: Params = {}, silent = true): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>('/api/ops/' + path, { method: 'GET', query: clean(params) }), { silent });
}

function post<T>(path: string, body: Params, silent = true): Promise<T> {
  const b: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) b[k] = v;
  return getPbClient().call((pb) => pb.send<T>('/api/ops/' + path, { method: 'POST', body: b }), { silent });
}

function form<T>(path: string, data: FormData): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>('/api/ops/' + path, { method: 'POST', body: data }), { silent: true });
}

export interface AgentAsk {
  asked: boolean;
  reason: string;
}

export interface Decision {
  account?: string | undefined;
  splits?: { account: string; percent: number | string }[] | undefined;
  transfer_account?: string | undefined;
  match?: { type: 'posting' | 'document' | 'line'; id: string } | undefined;
  contact?: string | undefined;
  tax_code?: string | undefined;
  narration?: string | undefined;
  memo?: string | undefined;
  amount_other?: string | undefined;
}

export interface EntryInput {
  kind?: 'expense' | 'income' | 'transfer' | 'journal' | undefined;
  date?: string | undefined;
  amount?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  category?: string | undefined;
  tax_code?: string | undefined;
  inclusive?: boolean | undefined;
  amount_to?: string | undefined;
  postings?: { account: string; debit?: string | undefined; credit?: string | undefined; amount?: string | undefined; memo?: string | undefined; tax_code?: string | undefined; tax_role?: string | undefined }[] | undefined;
  narration?: string | undefined;
  contact?: string | undefined;
  reference?: string | undefined;
  tags?: string[] | undefined;
  memo?: string | undefined;
  status?: 'posted' | 'proposed' | undefined;
  file?: string | undefined;
}

export interface DocInput {
  kind?: DocKind | undefined;
  contact?: string | undefined;
  issue_date?: string | undefined;
  due_date?: string | undefined;
  terms_days?: number | undefined;
  lines?: { description: string; quantity: string; unit_price: string; account?: string | undefined; tax_code?: string | undefined }[] | undefined;
  currency?: string | undefined;
  rate?: string | undefined;
  inclusive?: boolean | undefined;
  number?: string | undefined;
  reference?: string | undefined;
  notes?: string | undefined;
  terms?: string | undefined;
  file?: string | undefined;
  approve?: boolean | undefined;
}

export const api = {
  /* app */
  summary: (): Promise<Summary> => get('app/summary'),
  dashboard: (range: string): Promise<Dashboard> => get('app/dashboard', { range }),
  ui: (p: { view?: string | undefined; selection?: { type: string; id: string } | null | undefined; filters?: Record<string, unknown> | undefined }): Promise<unknown> => post('app/ui', p),
  setup: (): Promise<{ settings: Settings; regions: Region[]; currencies: Currency[]; accounts: number }> => get('setup/get'),
  applySetup: (p: { business_name: string; entity: string; home_currency: string; region: string; fiscal_year_start: number }): Promise<{ settings: Settings }> => post('setup/apply', p, false),
  updateSettings: (p: Record<string, unknown>): Promise<{ settings: Settings }> => post('settings/update', p, false),
  updatePolicy: (p: Partial<Policy>): Promise<{ policy: Policy }> => post('policy/update', p, false),
  setLocks: (p: { lock_date?: string | undefined; agent_lock_date?: string | undefined; tax_lock_date?: string | undefined }): Promise<{ settings: Settings }> => post('locks/set', p, false),

  /* accounts, contacts, tax */
  accounts: (p: { archived?: boolean | undefined } = {}): Promise<{ accounts: Account[]; home_currency: string }> => get('accounts/list', p),
  createAccount: (p: Record<string, unknown>): Promise<{ account: Account }> => post('accounts/create', p, false),
  updateAccount: (account: string, p: Record<string, unknown>): Promise<{ account: Account }> => post('accounts/update', { account, ...p }, false),
  archiveAccount: (account: string, archived: boolean): Promise<{ account: Account }> => post('accounts/archive', { account, archived }, false),
  deleteAccount: (account: string): Promise<unknown> => post('accounts/delete', { account }, false),
  opening: (date: string, balances: { account: string; amount: string }[]): Promise<{ transaction: TxnDetail }> => post('accounts/opening', { date, balances }, false),
  contacts: (p: { q?: string | undefined; kind?: string | undefined; archived?: boolean | undefined } = {}): Promise<{ contacts: Contact[] }> => get('contacts/list', p),
  contact: (contact: string): Promise<{ contact: Contact & { documents: Doc[]; transactions: TxnDetail[]; spent_12m: number; earned_12m: number } }> => get('contacts/get', { contact }),
  createContact: (p: Record<string, unknown>): Promise<{ contact: Contact }> => post('contacts/create', p, false),
  updateContact: (contact: string, p: Record<string, unknown>): Promise<{ contact: Contact }> => post('contacts/update', { contact, ...p }, false),
  archiveContact: (contact: string, archived: boolean): Promise<unknown> => post('contacts/archive', { contact, archived }, false),
  mergeContacts: (from: string, into: string): Promise<{ contact: Contact; moved: number }> => post('contacts/merge', { from, into }, false),
  taxCodes: (archived = false): Promise<{ tax_codes: TaxCode[] }> => get('tax/list', { archived }),
  createTax: (p: Record<string, unknown>): Promise<{ tax_code: TaxCode }> => post('tax/create', p, false),
  updateTax: (tax_code: string, p: Record<string, unknown>): Promise<{ tax_code: TaxCode }> => post('tax/update', { tax_code, ...p }, false),

  /* transactions */
  transactions: (p: Record<string, unknown>): Promise<{ total: number; transactions: TxnRow[] }> => get('transactions/list', p),
  transaction: (txn: string): Promise<{ transaction: TxnDetail }> => get('transactions/get', { txn }),
  createEntry: (p: EntryInput): Promise<{ transaction: TxnDetail }> => post('transactions/create', { ...p }, false),
  updateEntry: (txn: string, p: EntryInput): Promise<{ transaction: TxnDetail }> => post('transactions/update', { txn, ...p }, false),
  voidEntry: (txn: string, reason: string): Promise<{ transaction: TxnDetail }> => post('transactions/void', { txn, reason }, false),
  approve: (txns: string[]): Promise<{ approved: number }> => post('transactions/approve', { txns }, false),
  reject: (txns: string[]): Promise<{ rejected: number }> => post('transactions/reject', { txns }, false),
  reverse: (txn: string, date: string): Promise<{ transaction: TxnDetail }> => post('transactions/reverse', { txn, date }, false),
  register: (account: string, p: Record<string, unknown> = {}): Promise<Register> => get('ledger/register', { account, ...p }),

  /* inbox */
  inbox: (p: Record<string, unknown>): Promise<{ total: number; counts: Record<string, number>; lines: Line[] }> => get('inbox/list', p),
  line: (line: string): Promise<{ line: Line }> => get('inbox/get', { line }),
  preview: (account: string, src: { content?: string | undefined; file_name?: string | undefined; file?: File | undefined }, p: { mapping?: Mapping | null | undefined; date_order?: string | undefined; format?: string | undefined } = {}): Promise<{ preview: Preview }> => {
    const fd = new FormData();
    fd.append('account', account);
    if (src.file !== undefined) fd.append('file', src.file);
    if (src.content !== undefined) fd.append('content', src.content);
    if (src.file_name !== undefined) fd.append('file_name', src.file_name);
    if (p.mapping) fd.append('mapping', JSON.stringify(p.mapping));
    if (p.date_order) fd.append('date_order', p.date_order);
    if (p.format) fd.append('format', p.format);
    return form('inbox/preview', fd);
  },
  importFile: (account: string, src: { content?: string | undefined; file_name?: string | undefined; file?: File | undefined }, p: { mapping?: Mapping | null | undefined; date_order?: string | undefined; format?: string | undefined; save_profile?: boolean | undefined; force?: boolean | undefined } = {}): Promise<{ import: ImportRec; new_count: number; dup_count: number; auto_posted: number; suggested: number; open: number; agent_waiting: number }> => {
    const fd = new FormData();
    fd.append('account', account);
    if (src.file !== undefined) fd.append('file', src.file);
    if (src.content !== undefined) fd.append('content', src.content);
    if (src.file_name !== undefined) fd.append('file_name', src.file_name);
    if (p.mapping) fd.append('mapping', JSON.stringify(p.mapping));
    if (p.date_order) fd.append('date_order', p.date_order);
    if (p.format) fd.append('format', p.format);
    if (p.save_profile) fd.append('save_profile', 'true');
    if (p.force) fd.append('force', 'true');
    return form('inbox/import', fd);
  },
  imports: (account?: string): Promise<{ imports: ImportRec[] }> => get('inbox/imports', { account }),
  undoImport: (id: string): Promise<{ removed: number; unbooked: number }> => post('inbox/undo_import', { import: id }, false),
  accept: (line: string, d: Decision | null, make_rule = false): Promise<{ line: Line; transaction: string }> => post('inbox/accept', { line, ...(d ?? {}), make_rule }, false),
  acceptMany: (lines: string[], d: Decision | null = null): Promise<{ booked: number; skipped: { line: string; reason: string }[] }> => post('inbox/accept_many', { lines, ...(d ?? {}) }, false),
  exclude: (lines: string[], restore = false, reason?: string): Promise<{ count: number }> => post('inbox/exclude', { lines, restore, reason }, false),
  unmatch: (line: string): Promise<{ line: Line }> => post('inbox/unmatch', { line }, false),
  refreshInbox: (): Promise<{ suggested: number; auto_posted: number }> => post('inbox/refresh', {}, false),
  askAgentLines: (lines?: string[]): Promise<AgentAsk & { waiting: number }> => post('inbox/ask_agent', { lines }, false),

  /* rules, layouts */
  rules: (): Promise<{ rules: Rule[]; fields: string[]; ops: string[] }> => get('rules/list'),
  createRule: (p: Record<string, unknown>): Promise<{ rule: Rule }> => post('rules/create', p, false),
  updateRule: (rule: string, p: Record<string, unknown>): Promise<{ rule: Rule }> => post('rules/update', { rule, ...p }, false),
  deleteRule: (rule: string): Promise<unknown> => post('rules/delete', { rule }, false),
  reorderRules: (order: string[]): Promise<unknown> => post('rules/reorder', { order }, false),
  testRule: (conditions: Rule['conditions'], match: string): Promise<{ count: number; open: number; lines: Line[] }> => post('rules/test', { conditions, match }),
  profiles: (): Promise<{ profiles: { id: string; name: string; account: string; signature: string; updated: string }[] }> => get('profiles/list'),
  deleteProfile: (profile: string): Promise<unknown> => post('profiles/delete', { profile }, false),

  /* files */
  files: (p: Record<string, unknown> = {}): Promise<{ files: FileRec[] }> => get('files/list', p),
  file: (file: string): Promise<{ file: FileRec }> => get('files/get', { file }),
  upload: (files: File[], p: { link_type?: string | undefined; link_id?: string | undefined; kind?: string | undefined } = {}): Promise<{ files: FileRec[] }> => {
    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    if (p.link_type) fd.append('link_type', p.link_type);
    if (p.link_id) fd.append('link_id', p.link_id);
    if (p.kind) fd.append('kind', p.kind);
    return form('files/upload', fd);
  },
  updateFile: (file: string, p: Record<string, unknown>): Promise<{ file: FileRec }> => post('files/update', { file, ...p }, false),
  linkFile: (file: string, type: string, id: string): Promise<{ file: FileRec }> => post('files/link', { file, type, id }, false),
  archiveFile: (file: string, archived = true): Promise<{ file: FileRec }> => post('files/archive', { file, archived }, false),
  deleteFile: (file: string): Promise<unknown> => post('files/delete', { file }, false),
  askAgentFile: (file: string, note?: string): Promise<AgentAsk> => post('files/ask_agent', { file, note }, false),
  fileUrl: (file: string, download = false): string => `/api/ops/files/download?file=${encodeURIComponent(file)}${download ? '&download=true' : ''}`,

  /* documents */
  docs: (p: Record<string, unknown>): Promise<{ total: number; docs: Doc[] }> => get('docs/list', p),
  doc: (doc: string): Promise<{ document: Doc }> => get('docs/get', { doc }),
  docSummary: (): Promise<{ sales: DocSummary; purchases: DocSummary; currency: string }> => get('docs/summary'),
  createDoc: (p: DocInput): Promise<{ document: Doc; warnings: Doc['warnings'] }> => post('docs/create', { ...p }, false),
  updateDoc: (doc: string, p: DocInput): Promise<{ document: Doc; warnings: Doc['warnings'] }> => post('docs/update', { doc, ...p }, false),
  approveDoc: (doc: string): Promise<{ documents: Doc[] }> => post('docs/approve', { doc }, false),
  voidDoc: (doc: string, reason: string): Promise<{ document: Doc }> => post('docs/void', { doc, reason }, false),
  pay: (p: { doc?: string | undefined; docs?: string[] | undefined; account: string; amount?: string | undefined; doc_amount?: string | undefined; date?: string | undefined; memo?: string | undefined }): Promise<{ transaction: string; applied: number; fx_diff: number }> => post('docs/pay', p, false),
  applyCredit: (credit: string, doc: string, amount?: string): Promise<unknown> => post('docs/apply_credit', { credit, doc, amount }, false),
  writeOff: (doc: string, reason: string, date?: string): Promise<unknown> => post('docs/write_off', { doc, reason, date }, false),
  removeAllocation: (allocation: string): Promise<unknown> => post('docs/remove_allocation', { allocation }, false),
  duplicateDoc: (doc: string, kind?: DocKind): Promise<{ document: Doc }> => post('docs/duplicate', { doc, kind }, false),
  remind: (doc: string, note?: string): Promise<AgentAsk & { ask: Ask }> => post('docs/remind', { doc, note }, false),
  markSent: (doc: string, sent: boolean): Promise<{ document: Doc }> => post('docs/mark_sent', { doc, sent }, false),

  /* reconcile */
  reconOverview: (): Promise<{ accounts: ReconOverview[] }> => get('reconcile/overview'),
  reconList: (account?: string): Promise<{ reconciliations: ReconSession[] }> => get('reconcile/list', { account }),
  reconGet: (p: { reconciliation?: string | undefined; account?: string | undefined }): Promise<{ state: ReconState | null; hint?: ReconState['hint'] | undefined; last?: ReconSession | null | undefined }> => get('reconcile/get', p),
  reconStart: (account: string, statement_date: string, statement_balance: string): Promise<{ state: ReconState }> => post('reconcile/start', { account, statement_date, statement_balance }, false),
  reconToggle: (reconciliation: string, postings: string[], cleared: boolean): Promise<{ state: ReconState }> => post('reconcile/toggle', { reconciliation, postings, cleared }, false),
  reconFinish: (reconciliation: string, adjust = false, adjust_account?: string): Promise<{ reconciliation: ReconSession }> => post('reconcile/finish', { reconciliation, adjust, adjust_account }, false),
  reconUndo: (reconciliation: string): Promise<unknown> => post('reconcile/undo', { reconciliation }, false),
  reconCancel: (reconciliation: string): Promise<unknown> => post('reconcile/cancel', { reconciliation }, false),

  /* reports */
  pnl: (p: Record<string, unknown>): Promise<PnL> => get('reports/pnl', p),
  balance: (p: Record<string, unknown>): Promise<Balance> => get('reports/balance', p),
  cashflow: (p: Record<string, unknown>): Promise<CashFlow> => get('reports/cashflow', p),
  trial: (p: Record<string, unknown>): Promise<Trial> => get('reports/trial', p),
  aged: (p: Record<string, unknown>): Promise<Aged> => get('reports/aged', p),
  taxReport: (p: Record<string, unknown>): Promise<TaxReport> => get('reports/tax', p),
  networth: (months: number): Promise<NetWorth> => get('reports/networth', { months }),
  spending: (p: Record<string, unknown>): Promise<Spending> => get('reports/spending', p),
  drill: (p: { account: string; from?: string | undefined; to?: string | undefined }): Promise<Drill> => get('reports/drill', p),
  explain: (report: string, params: Record<string, unknown>, question?: string): Promise<AgentAsk & { ask: Ask }> => post('reports/explain', { report, params, question }, false),
  budget: (year?: number): Promise<BudgetReport> => get('budgets/get', { year }),
  setBudget: (account: string, year: number, p: { months?: string[] | undefined; monthly?: string | undefined; annual?: string | undefined }): Promise<unknown> => post('budgets/set', { account, year, ...p }, false),

  /* close */
  periods: (): Promise<{ periods: PeriodRow[] }> => get('close/list'),
  period: (period: string): Promise<{ period: Period }> => get('close/get', { period }),
  checks: (p: Record<string, unknown>): Promise<{ from: string; to: string; checks: Check[] }> => get('close/checks', p),
  tick: (period: string, p: { item?: string | undefined; done?: boolean | undefined; notes?: string | undefined }): Promise<unknown> => post('close/tick', { period, ...p }, false),
  signOff: (period: string, lock: boolean, force: boolean): Promise<unknown> => post('close/sign_off', { period, lock, force }, false),
  reopen: (period: string): Promise<unknown> => post('close/reopen', { period }, false),
  requestReview: (period: string, note?: string): Promise<AgentAsk> => post('close/request_review', { period, note }, false),

  /* fx, recurring */
  fx: (): Promise<{ home_currency: string; in_use: { currency: string; latest: string }[]; rates: { id: string; date: string; currency: string; rate: string; source: string }[] }> => get('fx/list'),
  setRate: (currency: string, date: string, rate: string): Promise<unknown> => post('fx/set', { currency, date, rate }, false),
  deleteRate: (rate: string): Promise<unknown> => post('fx/delete', { rate }, false),
  fetchRates: (days = 1): Promise<{ stored: number; dates: string[]; missing: string[] }> => post('fx/fetch', { days }, false),
  revalue: (date: string): Promise<{ transaction: string | null; detail: unknown[] }> => post('fx/revalue', { date }, false),
  schedules: (): Promise<{ schedules: Schedule[] }> => get('recurring/list'),
  createSchedule: (p: Record<string, unknown>): Promise<{ schedule: Schedule }> => post('recurring/create', p, false),
  updateSchedule: (schedule: string, p: Record<string, unknown>): Promise<{ schedule: Schedule }> => post('recurring/update', { schedule, ...p }, false),
  deleteSchedule: (schedule: string): Promise<unknown> => post('recurring/delete', { schedule }, false),
  runSchedules: (schedule?: string): Promise<{ made: { name: string; date: string; type: string; id: string }[]; errors: { name: string; error: string }[] }> => post('recurring/run', { schedule }, false),
  templateFrom: (type: 'transaction' | 'document', id: string): Promise<{ kind: Schedule['kind']; date: string; template: Record<string, unknown> }> => get('recurring/from', { type, id }),

  /* asks, activity, export */
  ask: (question: string, kind = 'question'): Promise<AgentAsk & { ask: Ask }> => post('asks/create', { question, kind }, false),
  asks: (limit = 30): Promise<{ asks: Ask[] }> => get('asks/list', { limit }),
  deleteAsk: (ask: string): Promise<unknown> => post('asks/delete', { ask }, false),
  activity: (p: Record<string, unknown> = {}): Promise<{ activity: ActivityEntry[] }> => get('activity/list', p),
  undo: (entry?: string): Promise<{ entry: ActivityEntry }> => post('activity/undo', { entry }, false),
  redo: (entry?: string): Promise<{ entry: ActivityEntry }> => post('activity/redo', { entry }, false),
  runs: (): Promise<{ runs: Run[] }> => get('activity/runs'),
  revertRun: (run: string): Promise<{ reverted: number; skipped: { summary: string; reason: string }[] }> => post('activity/revert_run', { run }, false),
  exportBooks: (format: string, from?: string, to?: string): Promise<{ file_name: string; mime: string; content: string }> => get('export/books', { format, from, to }),
};

/** The message an op error carries (PocketBase shape { message }). */
export function errMessage(err: unknown): string {
  const e = err as { message?: string | undefined; response?: { message?: string } | undefined };
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
