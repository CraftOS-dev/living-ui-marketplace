/**
 * Plain words for what your AI agent does: proposal kinds, the operation a
 * proposal runs and its parameters, kinds of events in its timeline, and
 * where each kind of record opens.
 */
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  Ban,
  Banknote,
  BookOpen,
  CheckCheck,
  CircleCheck,
  CirclePlus,
  CircleX,
  FileInput,
  FileText,
  Link2,
  Mail,
  Package,
  PenLine,
  Receipt,
  ScanText,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import { signed } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { Page } from '../../lib/router.ts';

/* ------------------------------------------------------- proposal kinds */

export const PROPOSAL_KINDS: { value: string; label: string; one: string; icon: LucideIcon }[] = [
  { value: 'post', label: 'Documents', one: 'Post a document', icon: FileText },
  { value: 'payment', label: 'Payments', one: 'Money in or out', icon: Banknote },
  { value: 'stock', label: 'Stock', one: 'Stock change', icon: Package },
  { value: 'journal', label: 'Journal entries', one: 'Journal entry', icon: BookOpen },
  { value: 'void', label: 'Voids', one: 'Void', icon: Ban },
  { value: 'payroll', label: 'Payroll', one: 'Payroll', icon: Wallet },
  { value: 'claim', label: 'Claims', one: 'Expense claim', icon: Receipt },
  { value: 'other', label: 'Other', one: 'Other', icon: Sparkles },
];

export function proposalKind(kind: string): { label: string; one: string; icon: LucideIcon } {
  return PROPOSAL_KINDS.find((k) => k.value === kind) ?? { label: 'Other', one: 'Other', icon: Sparkles };
}

/* ------------------------------------------------- operations in words */

export interface OpWords {
  /** What it does, as a short title. */
  label: string;
  /** What happens when it runs. */
  text: string;
  /** Parameter labels, in the order they read best. */
  params: Record<string, string>;
}

export const OP_WORDS: Record<string, OpWords> = {
  'docs.post': {
    label: 'Post a document',
    text: 'Writes the document into the books (its journal entry and stock moves). After that it can be paid.',
    params: { doc: 'Document', date: 'Date in the books', due_date: 'Due date', override_credit: 'Post over the credit limit' },
  },
  'docs.void': {
    label: 'Void a document',
    text: 'Reverses the document in the books: its journal entry and stock moves are undone with new entries.',
    params: { doc: 'Document', reason: 'Why', date: 'Date of the reversal' },
  },
  'payments.post': {
    label: 'Post a payment',
    text: 'The money moves in the books and settles the planned invoices or bills (or the oldest open ones).',
    params: { payment: 'Payment', auto_allocate: 'Settle the oldest open documents' },
  },
  'payments.record': {
    label: 'Record a payment',
    text: 'Records the payment and posts it in one step, settling the documents listed (or the oldest open ones).',
    params: { direction: 'Direction', party: 'Customer or supplier', amount: 'Amount', bank: 'Bank account', date: 'Date', method: 'Paid by', reference: 'Reference', allocations: 'Settles', auto_allocate: 'Settle the oldest open documents', fx_rate: 'Exchange rate', memo: 'Memo', agent_note: 'Where it came from' },
  },
  'payments.void': {
    label: 'Void a payment',
    text: 'Removes what the payment settled and reverses its entry.',
    params: { payment: 'Payment', reason: 'Why', date: 'Date of the reversal' },
  },
  'bank.create-payment': {
    label: 'Turn a statement line into a payment',
    text: 'Posts a payment for the bank statement line, settles the documents listed and matches the line.',
    params: { line: 'Statement line', party: 'Customer or supplier', allocations: 'Settles', memo: 'Memo' },
  },
  'bank.create-entry': {
    label: 'Turn a statement line into an entry',
    text: 'Posts the bank statement line against an account (fees, interest, a tax payment) and matches it.',
    params: { line: 'Statement line', account: 'Account', tax: 'Tax', memo: 'Memo', project: 'Project', department: 'Department' },
  },
  'bank.transfer': {
    label: 'Move money between your accounts',
    text: 'Posts a transfer from one of your accounts to another (and matches the statement line when given).',
    params: { from_bank: 'From', to_bank: 'To', amount: 'Amount', to_amount: 'Amount arriving', date: 'Date', line: 'Statement line', memo: 'Memo' },
  },
  'journals.post': {
    label: 'Post a journal entry',
    text: 'Posts a manual entry: the debits equal the credits.',
    params: { date: 'Date', memo: 'Memo', lines: 'Lines' },
  },
  'journals.reverse': {
    label: 'Reverse a journal entry',
    text: 'Posts the opposite entry, so the original no longer counts.',
    params: { journal: 'Journal entry', date: 'Date of the reversal', memo: 'Memo' },
  },
  'assets.depreciate': {
    label: 'Post depreciation',
    text: 'Posts one depreciation entry per month for every active asset (never twice for a month).',
    params: { month: 'Through' },
  },
  'claims.post': {
    label: 'Post an expense claim',
    text: 'Posts the approved claim: its expenses and tax against what is owed to the employee.',
    params: { claim: 'Claim' },
  },
  'claims.pay': {
    label: 'Pay expense claims',
    text: 'Pays the posted claims from a bank account in one entry.',
    params: { claims: 'Claims', claim: 'Claim', bank: 'Bank account', date: 'Date paid' },
  },
  'payroll.run-post': {
    label: 'Post a pay run',
    text: 'Posts salaries, deductions and employer costs as one entry on the pay date.',
    params: { run: 'Pay run' },
  },
  'payroll.run-pay': {
    label: 'Pay a pay run',
    text: 'Pays the net salaries of the posted run from a bank account.',
    params: { run: 'Pay run', bank: 'Bank account', date: 'Date paid' },
  },
  'stock.change': {
    label: 'Change stock',
    text: 'Adjusts, counts or transfers stock as one numbered stock change with its journal entry.',
    params: { kind: 'Kind of change', warehouse: 'Warehouse', to_warehouse: 'To warehouse', reason: 'Reason', lines: 'Items', account: 'Offset account', date: 'Date', note: 'Note' },
  },
  'stock.void-change': {
    label: 'Void a stock change',
    text: 'Reverses the stock change: its moves and its entry.',
    params: { change: 'Stock change' },
  },
  'builds.complete': {
    label: 'Complete a build',
    text: 'Components go out at average cost; the finished item comes in at their cost plus labor and overhead.',
    params: { build: 'Build', date: 'Date' },
  },
  'builds.void': {
    label: 'Void a build',
    text: 'Reverses the build: its stock moves and its entry.',
    params: { build: 'Build', reason: 'Why' },
  },
};

export function opWords(op: string): OpWords {
  return OP_WORDS[op] ?? { label: humanize(op.replace('.', ' ')), text: 'Runs this operation as the person who approves it.', params: {} };
}

/** 'due_date' -> 'Due date'. */
export function humanize(key: string): string {
  const s = key.replace(/[_.-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const VALUE_WORDS: Record<string, Record<string, string>> = {
  direction: { in: 'Money in', out: 'Money out' },
  kind: { adjust: 'Adjust', count: 'Count', transfer: 'Transfer' },
  reason: { count: 'Stock count', damage: 'Damaged', loss: 'Lost', found: 'Found', expiry: 'Expired', sample: 'Sample', correction: 'Correction', opening: 'Opening stock', other: 'Other' },
  method: { bank_transfer: 'Bank transfer', cash: 'Cash', card: 'Card', cheque: 'Cheque', online: 'Online', other: 'Other' },
};

/** One value of a parameter in words (lists become one line per entry). */
export function valueWords(key: string, v: unknown): string[] {
  if (v === null || v === undefined || v === '') return ['Not given'];
  if (typeof v === 'boolean') return [v ? 'Yes' : 'No'];
  if (typeof v === 'number') return [String(v)];
  if (typeof v === 'string') {
    if (v.trim().startsWith('[') || v.trim().startsWith('{')) {
      try {
        return valueWords(key, JSON.parse(v));
      } catch {
        return [v];
      }
    }
    return [VALUE_WORDS[key]?.[v] ?? v];
  }
  if (Array.isArray(v)) return v.length === 0 ? ['None'] : v.map((x) => entryWords(x));
  if (typeof v === 'object') return [entryWords(v)];
  return [String(v)];
}

function entryWords(x: unknown): string {
  if (x === null || typeof x !== 'object') return String(x);
  const o = x as Record<string, unknown>;
  const s = (k: string): string => (o[k] === undefined || o[k] === null ? '' : String(o[k]));
  if (o['doc'] !== undefined) return `${s('doc')}${s('amount') !== '' ? `: ${s('amount')}` : ', all that is open'}`;
  if (o['item'] !== undefined && o['counted'] !== undefined) return `${s('item')}: counted ${s('counted')}`;
  if (o['item'] !== undefined && o['qty'] !== undefined) {
    const q = Number(o['qty']);
    return `${s('item')}: ${Number.isFinite(q) ? signed(q) : s('qty')}${s('unit_cost') !== '' ? ` at ${s('unit_cost')}` : ''}`;
  }
  if (o['account'] !== undefined && (o['debit'] !== undefined || o['credit'] !== undefined)) {
    const side = s('debit') !== '' && s('debit') !== '0' ? `debit ${s('debit')}` : `credit ${s('credit')}`;
    return `${s('account')}: ${side}${s('memo') !== '' ? ` (${s('memo')})` : ''}`;
  }
  return Object.entries(o)
    .filter(([, val]) => val !== '' && val !== null && val !== undefined)
    .map(([k, val]) => `${humanize(k).toLowerCase()} ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`)
    .join(', ');
}

/* --------------------------------------------------- timeline of events */

export interface EventKind {
  value: string;
  label: string;
  icon: LucideIcon;
}

/** Filter groups for what your AI agent did. */
export const EVENT_GROUPS: { value: string; label: string; kinds: string[] }[] = [
  { value: 'created', label: 'Created', kinds: ['create', 'update', 'import'] },
  { value: 'proposed', label: 'Proposed', kinds: ['propose'] },
  { value: 'posted', label: 'Posted', kinds: ['post', 'void', 'reverse', 'pay', 'approve'] },
  { value: 'matched', label: 'Matched', kinds: ['match', 'unallocate'] },
  { value: 'read', label: 'Read files', kinds: ['read', 'read_failed', 'attach'] },
];

export function eventGroup(kind: string): string {
  return EVENT_GROUPS.find((g) => g.kinds.includes(kind))?.value ?? 'other';
}

const EVENT_ICON: Record<string, LucideIcon> = {
  create: CirclePlus,
  update: PenLine,
  import: Upload,
  propose: Sparkles,
  post: CircleCheck,
  approve: CheckCheck,
  void: Ban,
  reverse: ArrowLeftRight,
  pay: Banknote,
  match: Link2,
  unallocate: ArrowLeftRight,
  read: ScanText,
  read_failed: CircleX,
  attach: FileInput,
  sent: Send,
  delete: Trash2,
  reject: CircleX,
  ask_agent: Mail,
};

export function eventIcon(kind: string): LucideIcon {
  return EVENT_ICON[kind] ?? Sparkles;
}

/* -------------------------------------------------- where records open */

const ENTITY_PAGE: Record<string, { page: Page; withId: boolean; query?: Record<string, string> | undefined }> = {
  documents: { page: 'doc', withId: true },
  payments: { page: 'payment', withId: true },
  parties: { page: 'party', withId: true },
  items: { page: 'item', withId: true },
  stock_changes: { page: 'stock-change', withId: true },
  journals: { page: 'journal', withId: true },
  accounts: { page: 'account', withId: true },
  banks: { page: 'bank', withId: true },
  employees: { page: 'employee', withId: true },
  expense_claims: { page: 'claim', withId: true },
  leave_requests: { page: 'leave', withId: false },
  payroll_runs: { page: 'payrun', withId: true },
  projects: { page: 'project', withId: true },
  builds: { page: 'build', withId: true },
  boms: { page: 'bom', withId: true },
  assets: { page: 'asset', withId: true },
  warehouses: { page: 'warehouses', withId: false },
  proposals: { page: 'proposal', withId: true },
  inbox: { page: 'inbox', withId: false },
  members: { page: 'settings', withId: false, query: { tab: 'team' } },
  roles: { page: 'settings', withId: false, query: { tab: 'roles' } },
  currencies: { page: 'settings', withId: false, query: { tab: 'currencies' } },
};

/** A function that opens the record, or null when it has no page. */
export function openRecord(entity: string, id: string): (() => void) | null {
  const t = ENTITY_PAGE[entity];
  if (t === undefined) return null;
  if (t.withId && id === '') return null;
  return () => navigate(t.page, { ...(t.query ?? {}), ...(t.withId ? { id } : {}) });
}

/** What a kind of record is called, for "Open the ..." links. */
export const ENTITY_WORD: Record<string, string> = {
  documents: 'document',
  payments: 'payment',
  parties: 'customer or supplier',
  items: 'item',
  stock_changes: 'stock change',
  journals: 'journal entry',
  accounts: 'account',
  banks: 'bank account',
  employees: 'employee',
  expense_claims: 'expense claim',
  leave_requests: 'leave',
  payroll_runs: 'pay run',
  projects: 'project',
  builds: 'build',
  boms: 'bill of materials',
  assets: 'asset',
  warehouses: 'warehouse',
  proposals: 'proposal',
};

/* ---------------------------------------------------------------- time */

function parseTs(ts: string): Date | null {
  const t = Date.parse(ts.replace(' ', 'T'));
  return Number.isNaN(t) ? null : new Date(t);
}

/** "Oct 20, 13:36" (with the year when it is not this year). */
export function stamp(ts: string): string {
  const d = parseTs(ts);
  if (d === null) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** "13:36" */
export function clock(ts: string): string {
  const d = parseTs(ts);
  return d === null ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** The local day ('YYYY-MM-DD') of a timestamp. */
export function localDay(ts: string): string {
  const d = parseTs(ts);
  if (d === null) return '';
  const p = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Seconds since a timestamp. */
export function ageSeconds(ts: string): number {
  const d = parseTs(ts);
  return d === null ? 0 : Math.max(0, (Date.now() - d.getTime()) / 1000);
}
