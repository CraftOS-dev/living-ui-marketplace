/**
 * The UI calls the same operations the AI agent calls through the agent-app CLI
 * (pb_hooks/ops*.pb.js), so a rule enforced there holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type {
  Category,
  Expense,
  ExpenseList,
  ImportPreview,
  ImportRecord,
  MonthSummary,
  Receipt,
  Recurring,
  Settings,
  Trend,
} from './types.ts';

type Params = Record<string, string | number | boolean | null | undefined>;

function clean(params: Params): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function get<T>(path: string, params: Params = {}, silent = false): Promise<T> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(clean(params))) query[k] = String(v);
  return getPbClient().call((pb) => pb.send<T>(path, { method: 'GET', query }), { silent });
}

function post<T>(path: string, body: Params | Record<string, unknown>): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(path, { method: 'POST', body }));
}

function postForm<T>(path: string, form: FormData): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(path, { method: 'POST', body: form }));
}

export interface ExpenseInput {
  amount: string;
  date: string;
  note: string;
  category: string;
  currency?: string | undefined;
}

export const api = {
  settings: (): Promise<Settings> => get('/api/ops/settings/get'),
  updateSettings: (p: { currency?: string; monthly_budget?: string; currency_confirmed?: boolean }): Promise<Settings> =>
    post('/api/ops/settings/update', p),

  month: (month: string): Promise<MonthSummary> => get('/api/ops/summary/month', { month }),
  trend: (months: number, end: string): Promise<Trend> => get('/api/ops/summary/trend', { months, end }),

  list: (p: Params): Promise<ExpenseList> => get('/api/ops/expenses/list', p),
  getExpense: (id: string): Promise<Expense> => get('/api/ops/expenses/get', { expense_id: id }),
  add: (p: ExpenseInput): Promise<{ expense: Expense; message: string }> => post('/api/ops/expenses/add', { ...p }),
  addWithReceipt: (p: ExpenseInput, file: File): Promise<{ expense: Expense; message: string }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(p)) if (v !== undefined) form.append(k, v);
    form.append('receipt', file);
    return postForm('/api/ops/expenses/add', form);
  },
  update: (id: string, p: Partial<ExpenseInput>): Promise<{ expense: Expense }> =>
    post('/api/ops/expenses/update', { expense_id: id, ...p }),
  remove: (id: string): Promise<unknown> => post('/api/ops/expenses/delete', { expense_id: id }),
  removeMany: (ids: string[]): Promise<{ deleted: number }> => post('/api/ops/expenses/delete-many', { ids }),
  setCategory: (ids: string[], category: string): Promise<{ updated: number }> =>
    post('/api/ops/expenses/set-category', { ids, category }),
  attachReceipt: (id: string, file: File): Promise<{ expense: Expense }> => {
    const form = new FormData();
    form.append('expense_id', id);
    form.append('file', file);
    return postForm('/api/ops/expenses/attach-receipt', form);
  },
  removeReceipt: (id: string): Promise<unknown> => post('/api/ops/expenses/remove-receipt', { expense_id: id }),

  categories: (month?: string): Promise<{ currency: string; categories: Category[] }> =>
    get('/api/ops/categories/list', { month }),
  addCategory: (p: { name: string; icon: string; budget?: string }): Promise<{ category: { id: string; name: string } }> =>
    post('/api/ops/categories/add', p),
  updateCategory: (id: string, p: { name?: string; icon?: string; budget?: string }): Promise<unknown> =>
    post('/api/ops/categories/update', { category_id: id, ...p }),
  deleteCategory: (id: string, moveTo: string): Promise<{ moved: number }> =>
    post('/api/ops/categories/delete', { category_id: id, move_to: moveTo }),

  receipts: (status?: string): Promise<{ receipts: Receipt[] }> => get('/api/ops/receipts/list', { status, limit: 200 }),
  uploadReceipts: (files: File[]): Promise<{ receipts: Receipt[]; asked_agent: boolean }> => {
    const form = new FormData();
    for (const f of files) form.append('file', f);
    return postForm('/api/ops/receipts/add', form);
  },
  completeReceipt: (id: string, p: ExpenseInput): Promise<{ expense: Expense }> =>
    post('/api/ops/receipts/complete', { receipt_id: id, ...p }),
  retryReceipt: (id: string): Promise<{ asked_agent: boolean }> => post('/api/ops/receipts/retry', { receipt_id: id }),
  deleteReceipt: (id: string): Promise<unknown> => post('/api/ops/receipts/delete', { receipt_id: id }),

  previewUpload: (file: File): Promise<ImportPreview> => {
    const form = new FormData();
    form.append('file', file);
    return postForm('/api/ops/import/preview', form);
  },
  preview: (importId: string, options: Record<string, unknown>): Promise<ImportPreview> =>
    post('/api/ops/import/preview', { import_id: importId, ...options }),
  runImport: (importId: string, options: Record<string, unknown>): Promise<{ added: number; message: string }> =>
    post('/api/ops/import/run', { import_id: importId, ...options }),
  imports: (): Promise<{ imports: ImportRecord[] }> => get('/api/ops/import/list'),
  undoImport: (id: string): Promise<{ removed: number }> => post('/api/ops/import/undo', { import_id: id }),
  exportCsv: (from: string, to: string): Promise<{ filename: string; content: string; rows: number }> =>
    get('/api/ops/export/csv', { from, to }),

  recurring: (): Promise<{ recurring: Recurring[] }> => get('/api/ops/recurring/list'),
  addRecurring: (p: { note: string; amount: string; cadence: string; start_date: string; category: string }): Promise<{
    added_now: number;
  }> => post('/api/ops/recurring/add', p),
  updateRecurring: (id: string, p: Record<string, string | boolean>): Promise<{ added_now: number }> =>
    post('/api/ops/recurring/update', { recurring_id: id, ...p }),
  deleteRecurring: (id: string): Promise<unknown> => post('/api/ops/recurring/delete', { recurring_id: id }),

  /** Quiet: the entry screen shows a failed preview in place instead of a toast per keystroke. */
  fx: (from: string, amount: string, date: string): Promise<{ rate: number; converted: string; rate_date: string }> =>
    get('/api/ops/fx/rate', { from, amount, date }, true),
};

/** Hand a text file to the browser as a download. */
export function download(filename: string, content: string, mime = 'text/csv'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
