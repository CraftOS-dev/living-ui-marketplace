/**
 * The UI calls the same operations the AI agent calls through the agent-app
 * CLI (pb_hooks/ops*.pb.js), so a rule enforced there holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type {
  BatchResult,
  Category,
  CountBrief,
  CsvFile,
  Dashboard,
  Doc,
  ImportPreview,
  ImportRecord,
  ItemDetail,
  ItemList,
  LocationDetail,
  LocationTree,
  Lookup,
  MapData,
  Movement,
  Order,
  OrderCounts,
  OrderDetail,
  ReorderList,
  Settings,
  StockCount,
  StockResult,
  Supplier,
  SupplierDetail,
} from './types.ts';

type Value = string | number | boolean | null | undefined;
type Params = Record<string, Value>;

function clean(params: Params): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function get<T>(op: string, params: Params = {}, silent = false): Promise<T> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(clean(params))) query[k] = String(v);
  return getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'GET', query }), { silent });
}

function post<T>(op: string, body: Params | Record<string, unknown> = {}, silent = false): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'POST', body }), { silent });
}

function postForm<T>(op: string, form: FormData): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(`/api/ops/${op}`, { method: 'POST', body: form }));
}

function form(fields: Params, files: Record<string, File | File[] | null | undefined>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(clean(fields))) f.append(k, String(v));
  for (const [k, v] of Object.entries(files)) {
    if (v === null || v === undefined) continue;
    for (const file of Array.isArray(v) ? v : [v]) f.append(k, file);
  }
  return f;
}

export interface ItemInput {
  name?: string;
  sku?: string;
  category?: string;
  unit?: string;
  fractional?: boolean;
  description?: string;
  min_qty?: string;
  max_qty?: string;
  unit_cost?: string;
  supplier?: string;
  lead_time_days?: string;
  default_location?: string;
  barcodes?: string[];
  qty?: string;
  location?: string;
  archived?: boolean;
  remove_photo?: boolean;
}

function itemFields(p: ItemInput): Params {
  const { barcodes, ...rest } = p;
  return { ...rest, barcodes: barcodes !== undefined && barcodes.length > 0 ? JSON.stringify(barcodes) : undefined };
}

export type StockLine = { kind: 'in' | 'out' | 'move' | 'set'; item: string; qty: string; location?: string; from?: string; to?: string; reason?: string; unit_cost?: string; note?: string };

export const api = {
  /* settings and overview */
  settings: (): Promise<Settings> => get('settings/get'),
  updateSettings: (p: Partial<Pick<Settings, 'currency' | 'currency_confirmed' | 'allow_negative' | 'auto_restock'>>): Promise<Settings> => post('settings/update', p),
  dashboard: (): Promise<Dashboard> => get('dashboard/summary'),
  /** What a code is: an item, a location, or nothing yet (type none). */
  lookup: (code: string): Promise<Lookup> => get('lookup/code', { code }),

  /* categories */
  categories: (): Promise<{ categories: Category[]; icons: string[] }> => get('categories/list'),
  addCategory: (name: string, icon: string): Promise<{ category: Category }> => post('categories/add', { name, icon }),
  updateCategory: (category: string, p: { name?: string; icon?: string; sort?: number }): Promise<unknown> => post('categories/update', { category, ...p }),
  deleteCategory: (category: string, preview = false): Promise<{ items_uncategorized: number }> => post('categories/delete', { category, preview }),

  /* the stockroom map (silent: it refreshes on every change) */
  map: (): Promise<MapData> => get('map/get', {}, true),
  /** Several places' layout at once, all or nothing (arrange mode). */
  arrangeMap: (positions: { location: string; x: number; z: number; w?: number; d?: number }[]): Promise<{ saved: number }> =>
    post('locations/arrange', { positions: JSON.stringify(positions) }),
  resetMap: (): Promise<{ reset: number }> => post('locations/place', { all: true, reset: true }),

  /* locations */
  locations: (): Promise<LocationTree> => get('locations/list'),
  location: (location: string): Promise<LocationDetail> => get('locations/get', { location }),
  addLocation: (p: { name: string; parent?: string; kind?: string; code?: string; notes?: string }): Promise<LocationDetail> => post('locations/add', p),
  updateLocation: (location: string, p: { name?: string; parent?: string; kind?: string; code?: string; notes?: string }): Promise<LocationDetail> =>
    post('locations/update', { location, ...p }),
  deleteLocation: (location: string, preview = false): Promise<{ blocked: string | null; moves_up: string[]; moves_up_to: string; history_entries_removed: number }> =>
    post('locations/delete', { location, preview }),

  /* suppliers */
  suppliers: (): Promise<{ suppliers: Supplier[] }> => get('suppliers/list'),
  supplier: (supplier: string): Promise<SupplierDetail> => get('suppliers/get', { supplier }),
  addSupplier: (p: Partial<Record<'name' | 'contact' | 'email' | 'phone' | 'website' | 'lead_time_days' | 'notes', string>>): Promise<SupplierDetail> => post('suppliers/add', p),
  updateSupplier: (supplier: string, p: Partial<Record<'name' | 'contact' | 'email' | 'phone' | 'website' | 'lead_time_days' | 'notes', string>>): Promise<SupplierDetail> =>
    post('suppliers/update', { supplier, ...p }),
  deleteSupplier: (supplier: string, preview = false): Promise<{ items_unlinked: number; orders_without_supplier: number; open_orders: number }> =>
    post('suppliers/delete', { supplier, preview }),

  /* items */
  items: (p: Params): Promise<ItemList> => get('items/list', p),
  item: (item: string): Promise<ItemDetail> => get('items/get', { item }),
  addItem: (p: ItemInput, photo?: File | null): Promise<{ item: ItemDetail }> =>
    photo !== null && photo !== undefined ? postForm('items/add', form(itemFields(p), { photo })) : post('items/add', itemFields(p)),
  updateItem: (item: string, p: ItemInput, photo?: File | null): Promise<{ item: ItemDetail }> =>
    photo !== null && photo !== undefined ? postForm('items/update', form({ item, ...itemFields(p) }, { photo })) : post('items/update', { item, ...itemFields(p) }),
  deleteItem: (item: string, preview = false): Promise<{ on_hand: number; places: number; history_entries: number; order_lines: number; barcodes: number }> =>
    post('items/delete', { item, preview }),
  deleteItems: (ids: string[]): Promise<{ deleted: number }> => post('items/delete-many', { ids: JSON.stringify(ids) }),
  setCategory: (ids: string[], category: string): Promise<{ updated: number }> => post('items/set-category', { ids: JSON.stringify(ids), category }),
  setArchived: (ids: string[], archived: boolean): Promise<{ updated: number }> => post('items/set-archived', { ids: JSON.stringify(ids), archived }),
  addBarcode: (item: string, code: string): Promise<{ item: ItemDetail }> => post('items/add-barcode', { item, code }),
  removeBarcode: (item: string, code: string): Promise<{ item: ItemDetail }> => post('items/remove-barcode', { item, code }),

  /* stock */
  stockIn: (p: { item: string; qty: string; location?: string; reason?: string; unit_cost?: string; note?: string }): Promise<StockResult> => post('stock/in', p),
  stockOut: (p: { item: string; qty: string; location?: string; reason?: string; note?: string }): Promise<StockResult> => post('stock/out', p),
  stockMove: (p: { item: string; qty: string; from?: string; to: string; note?: string }): Promise<StockResult> => post('stock/move', p),
  stockSet: (p: { item: string; qty: string; location?: string; reason?: string; note?: string }): Promise<StockResult> => post('stock/set', p),
  stockBatch: (lines: StockLine[], note?: string): Promise<BatchResult> => post('stock/batch', { lines: JSON.stringify(lines), note }),

  /* history */
  movements: (p: Params): Promise<{ movements: Movement[]; more: boolean }> => get('movements/list', p),
  undo: (batch: string): Promise<{ undone: string; batch: string; entries: number }> => post('movements/undo', { batch }),
  deleteBatch: (batch: string, preview = false): Promise<{ batches: string[]; entries: number; stock_changes: number }> => post('movements/delete', { batch, preview }),

  /* reorder and orders */
  reorder: (): Promise<ReorderList> => get('reorder/list'),
  createOrders: (items: { item: string; qty: string }[] | null, note?: string): Promise<{ orders: Order[] }> =>
    post('reorder/create-orders', { items: items !== null ? JSON.stringify(items) : undefined, note }),
  orders: (p: Params): Promise<{ orders: Order[]; more: boolean; counts: OrderCounts; currency: string }> => get('orders/list', p),
  order: (order: string): Promise<OrderDetail> => get('orders/get', { order }),
  orderText: (order: string): Promise<{ number: string; to: string; subject: string; text: string }> => get('orders/text', { order }),
  createOrder: (p: { supplier?: string; location?: string; expected_on?: string; note?: string; lines?: { item: string; qty: string; unit_cost?: string }[] }): Promise<Order> =>
    post('orders/create', { ...p, lines: p.lines !== undefined ? JSON.stringify(p.lines) : undefined }),
  updateOrder: (order: string, p: { supplier?: string; location?: string; expected_on?: string; note?: string }): Promise<Order> => post('orders/update', { order, ...p }),
  addLine: (order: string, item: string, qty: string, unit_cost?: string): Promise<Order> => post('orders/add-line', { order, item, qty, unit_cost }),
  updateLine: (line: string, p: { qty?: string; unit_cost?: string }): Promise<Order> => post('orders/update-line', { line, ...p }),
  removeLine: (line: string): Promise<Order> => post('orders/remove-line', { line }),
  markOrdered: (order: string, expected_on?: string): Promise<Order> => post('orders/mark-ordered', { order, expected_on }),
  backToDraft: (order: string): Promise<Order> => post('orders/back-to-draft', { order }),
  receive: (order: string, p: { lines?: { line: string; qty: string }[]; all?: boolean; location?: string; note?: string }): Promise<Order & { batch: string }> =>
    post('orders/receive', { order, lines: p.lines !== undefined ? JSON.stringify(p.lines) : undefined, all: p.all, location: p.location, note: p.note }),
  closeOrder: (order: string): Promise<Order> => post('orders/close', { order }),
  cancelOrder: (order: string): Promise<Order> => post('orders/cancel', { order }),
  reopenOrder: (order: string): Promise<Order> => post('orders/reopen', { order }),
  deleteOrder: (order: string, preview = false): Promise<{ lines: number; receipts_kept_in_history: number }> => post('orders/delete', { order, preview }),

  /* counts */
  counts: (p: Params): Promise<{ counts: CountBrief[] }> => get('counts/list', p),
  count: (count: string, reveal = false): Promise<StockCount> => get('counts/get', { count, reveal }),
  startCount: (p: { location?: string; include_sub?: boolean; blind?: boolean; note?: string; items?: string[] }): Promise<StockCount> =>
    post('counts/start', { ...p, items: p.items !== undefined ? JSON.stringify(p.items) : undefined }),
  setCountLine: (line: string, p: { counted?: string; add?: string; clear?: boolean }): Promise<StockCount> => post('counts/set-line', { line, ...p }),
  /** Quiet: an unknown code is shown in place on the count screen. */
  scanCount: (count: string, code: string, location?: string): Promise<StockCount> => post('counts/scan', { count, code, location }, true),
  addCountItem: (count: string, item: string, location?: string): Promise<StockCount> => post('counts/add-item', { count, item, location }),
  completeCount: (count: string, uncounted: 'keep' | 'zero'): Promise<StockCount> => post('counts/complete', { count, uncounted }),
  cancelCount: (count: string): Promise<StockCount> => post('counts/cancel', { count }),
  reopenCount: (count: string): Promise<StockCount> => post('counts/reopen', { count }),
  deleteCount: (count: string): Promise<unknown> => post('counts/delete', { count }),

  /* documents */
  documents: (status?: string): Promise<{ documents: Doc[]; counts: Record<string, number> }> => get('documents/list', { status, limit: 100 }),
  addDocuments: (files: File[]): Promise<{ documents: Doc[] }> => postForm('documents/add', form({}, { file: files })),
  retryDocument: (document: string): Promise<Doc & { asked_agent: boolean }> => post('documents/retry', { document }),
  deleteDocument: (document: string): Promise<unknown> => post('documents/delete', { document }),

  /* import and export */
  previewUpload: (file: File): Promise<ImportPreview> => postForm('import/preview', form({}, { file })),
  preview: (importId: string, options: Record<string, Value>): Promise<ImportPreview> => post('import/preview', { import_id: importId, ...options }),
  runImport: (importId: string, options: Record<string, Value>): Promise<{ added: number; changed: number; skipped: number; message: string }> =>
    post('import/run', { import_id: importId, ...options }),
  imports: (): Promise<{ imports: ImportRecord[] }> => get('import/list'),
  undoImport: (importId: string): Promise<{ removed: number; restored: number; message: string }> => post('import/undo', { import_id: importId }),
  deleteImport: (importId: string): Promise<unknown> => post('import/delete', { import_id: importId }),
  exportItems: (): Promise<CsvFile> => get('export/items'),
  exportStock: (): Promise<CsvFile> => get('export/stock'),
  exportMovements: (from: string, to: string): Promise<CsvFile> => get('export/movements', { from, to }),
  exportTemplate: (): Promise<CsvFile> => get('export/template'),
};

/** Hand a text file to the browser as a download (CSV gets a BOM so spreadsheets read UTF-8). */
export function download(filename: string, content: string, mime = 'text/csv'): void {
  const body = mime === 'text/csv' ? `﻿${content}` : content;
  const blob = new Blob([body], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
