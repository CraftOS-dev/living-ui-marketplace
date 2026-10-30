/**
 * Import a seller centre's export (CSV or Excel), read in the browser: pick
 * the shop and the file, match its columns to Store OS fields (matched for
 * you from the usual export headers), map its order statuses, check a
 * preview, then send it in batches of 200. The server matches orders on
 * their number and products on SKU, so importing a file twice changes
 * nothing.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import { ArrowLeft, FileSpreadsheet, TriangleAlert, Upload, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { errMessage, op } from '../lib/api.ts';
import { money, num, plural, STATUS_LABEL } from '../lib/format.ts';
import { changed } from '../lib/live.ts';
import { useBase, useStore } from '../lib/store.tsx';
import type { OrderStatus } from '../lib/types.ts';
import { Button, Dialog, Field, IconButton, Meter, Pill, Select, Td, Th, Tip, Tr } from './ui.tsx';

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  kind: 'orders' | 'products';
  /** Preselected shop id (orders always need a shop; products optionally record listings on it). */
  shopId?: string;
}

/* ----------------------------------------------------------------- cells */

type Cell = string | number | boolean | Date | null;

interface Table {
  headers: string[];
  rows: Cell[][];
}

function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

function blank(c: Cell): boolean {
  return c === null || (typeof c === 'string' && c.trim() === '');
}

function text(c: Cell): string {
  if (c === null) return '';
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? '' : c.toISOString();
  if (typeof c === 'number') return Number.isInteger(c) ? c.toFixed(0) : String(c);
  return String(c).trim();
}

/** Currencies written without decimals, where "12.500" means twelve thousand five hundred. */
const WHOLE = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'UGX', 'PYG']);

/**
 * An amount from an export: "RM 1,299.00", "1.299,00", "(12.50)", "-5".
 * Currency signs and thousands separators go; a lone comma decimal becomes a point.
 */
function amount(c: Cell, whole: boolean): number | undefined {
  if (c === null || typeof c === 'boolean' || c instanceof Date) return undefined;
  if (typeof c === 'number') return Number.isFinite(c) ? c : undefined;
  const raw = c.trim();
  if (raw === '' || !/\d/.test(raw)) return undefined;
  const negative = /^\(.*\)$/.test(raw) || /^[^\d]*-/.test(raw);
  let s = raw.replace(/[^\d.,]/g, '');
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma >= 0) {
    const parts = s.split(',');
    s = parts.length === 2 && (parts[1] ?? '').length !== 3 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (dot >= 0) {
    const parts = s.split('.');
    if (parts.length > 2 || (whole && (parts[1] ?? '').length === 3)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (s === '' || !Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

/** A date as the server reads it: Excel dates and serials as ISO, text as it is (offsets made ISO). */
function dateText(c: Cell): string {
  if (c === null || typeof c === 'boolean') return '';
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? '' : c.toISOString();
  if (typeof c === 'number') {
    let ms = NaN;
    if (c > 20000 && c < 80000) ms = Math.round((c - 25569) * 86400000);
    else if (c > 1e9 && c < 1e10) ms = c * 1000;
    else if (c > 1e12 && c < 1e13) ms = c;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const s = c.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)\s*(?:UTC|GMT)?\s*([+-]\d{2}):?(\d{2})$/);
  if (m) {
    const d = new Date(m[1] + 'T' + (m[2] ?? '').padStart(5, '0') + (m[3] ?? '') + ':' + (m[4] ?? ''));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return s;
}

/* ---------------------------------------------------------------- files */

const ACCEPT = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

function uniqueHeaders(list: string[]): string[] {
  const seen = new Map<string, number>();
  return list.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : h + ' (' + n + ')';
  });
}

function readCsv(file: File): Promise<Table> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h, i) => h.replace(/^﻿/, '').trim() || 'Column ' + (i + 1),
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        const rows = res.data.map((r) => headers.map((h) => toCell(r[h]))).filter((r) => r.some((c) => !blank(c)));
        resolve({ headers, rows });
      },
      error: (err) => reject(err),
    });
  });
}

async function readExcel(file: File): Promise<Table> {
  const data = await readSheet(file);
  const rows = data.map((r) => r.map(toCell)).filter((r) => r.some((c) => !blank(c)));
  const head = rows.shift() ?? [];
  const headers = uniqueHeaders(head.map((c, i) => text(c) || 'Column ' + (i + 1)));
  return { headers, rows: rows.map((r) => headers.map((_, i) => r[i] ?? null)) };
}

async function readFile(file: File): Promise<Table> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    try {
      return await readExcel(file);
    } catch {
      throw new Error(name.endsWith('.xls') ? 'This older .xls file could not be read. Save it as .xlsx or .csv and try again.' : 'This Excel file could not be read. Save it as .csv and try again.');
    }
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') return readCsv(file);
  throw new Error('Choose a .csv, .xlsx or .xls file.');
}

/* ---------------------------------------------------------------- fields */

interface FieldDef {
  key: string;
  label: string;
  group: string;
  synonyms: string[];
  required?: boolean;
}

const ORDER_FIELDS: FieldDef[] = [
  { key: 'number', label: 'Order number', group: 'Order', required: true, synonyms: ['Order ID', 'Order No', 'Order No.', 'Order Number', 'Order #', 'Name', 'order_sn', 'Order SN', 'Order'] },
  { key: 'placed_at', label: 'Placed', group: 'Order', synonyms: ['Order Creation Date', 'Created at', 'Order Date', 'Create Time', 'Created Time', 'Order Created Time', 'Order Time', 'Purchase Date', 'Date'] },
  { key: 'status', label: 'Status', group: 'Order', synonyms: ['Order Status', 'Status', 'Fulfillment Status', 'Financial Status'] },
  { key: 'currency', label: 'Currency', group: 'Order', synonyms: ['Currency', 'Currency Code'] },
  { key: 'buyer_name', label: 'Buyer', group: 'Buyer', synonyms: ['Receiver Name', 'Recipient', 'Recipient Name', 'Shipping Name', 'Billing Name', 'Customer Name', 'Buyer Name', 'Username (Buyer)', 'Customer', 'Buyer'] },
  { key: 'buyer_phone', label: 'Phone', group: 'Buyer', synonyms: ['Phone Number', 'Shipping Phone', 'Phone', 'Billing Phone', 'Recipient Phone', 'Receiver Phone', 'Contact Number'] },
  { key: 'buyer_email', label: 'Email', group: 'Buyer', synonyms: ['Email', 'Buyer Email', 'Customer Email', 'E-mail'] },
  { key: 'address', label: 'Address', group: 'Buyer', synonyms: ['Delivery Address', 'Shipping Address1', 'Shipping Address 1', 'Shipping Address', 'Address', 'Address1', 'Detail Address', 'Full Address', 'Shipping Street'] },
  { key: 'city', label: 'City', group: 'Buyer', synonyms: ['City', 'Shipping City', 'Town'] },
  { key: 'state', label: 'State', group: 'Buyer', synonyms: ['State', 'Province', 'Shipping Province', 'Shipping Province Name', 'Shipping State', 'Region'] },
  { key: 'postcode', label: 'Postcode', group: 'Buyer', synonyms: ['Zip Code', 'Postcode', 'Postal Code', 'Shipping Zip', 'Zip', 'Post Code'] },
  { key: 'country', label: 'Country', group: 'Buyer', synonyms: ['Country', 'Shipping Country', 'Country Code'] },
  { key: 'sku', label: 'SKU', group: 'Items', synonyms: ['SKU Reference No.', 'Lineitem sku', 'Seller SKU', 'SKU', 'Variant SKU', 'SellerSKU', 'Merchant SKU'] },
  { key: 'title', label: 'Item', group: 'Items', synonyms: ['Product Name', 'Lineitem name', 'Item Name', 'Product', 'Item', 'Product Title', 'Item Title', 'Title'] },
  { key: 'option', label: 'Option', group: 'Items', synonyms: ['Variation Name', 'Variation', 'Variant', 'Variant Name', 'Lineitem variant', 'Option'] },
  { key: 'qty', label: 'Quantity', group: 'Items', synonyms: ['Quantity', 'Lineitem quantity', 'Qty', 'Item Quantity'] },
  { key: 'price', label: 'Unit price', group: 'Items', synonyms: ['Deal Price', 'Lineitem price', 'Unit Price', 'Original Price', 'Item Price', 'Paid Price', 'Price'] },
  { key: 'shipping', label: 'Shipping charged', group: 'Money', synonyms: ['Buyer Paid Shipping Fee', 'Shipping', 'Shipping Fee', 'Shipping Fee Paid by Buyer', 'Shipping Charged', 'Delivery Fee'] },
  { key: 'discount', label: 'Discount', group: 'Money', synonyms: ['Seller Voucher', 'Discount Amount', 'Discount', 'Seller Discount', 'Total Discount'] },
  { key: 'tax', label: 'Tax', group: 'Money', synonyms: ['Taxes', 'Tax', 'Tax Amount', 'VAT'] },
  { key: 'total', label: 'Total', group: 'Money', synonyms: ['Grand Total', 'Order Total', 'Total', 'Total Amount', 'Order Amount'] },
  { key: 'tracking', label: 'Tracking number', group: 'Delivery', synonyms: ['Tracking Number*', 'Tracking Number', 'Tracking', 'Tracking No', 'Tracking ID', 'Tracking Code', 'AWB'] },
  { key: 'carrier', label: 'Carrier', group: 'Delivery', synonyms: ['Shipping Option', 'Shipping Provider', 'Carrier', 'Shipping Company', 'Courier', 'Shipment Provider', 'Delivery Option'] },
  { key: 'ship_by', label: 'Ship by', group: 'Delivery', synonyms: ['Ship By Date', 'Estimated Ship Out Date', 'Ship By', 'Ship Before', 'Shipping Deadline', 'Latest Ship Date'] },
  { key: 'shipped_at', label: 'Shipped', group: 'Delivery', synonyms: ['Shipped at', 'Ship Time', 'Order Ship Time', 'Shipped Date', 'Fulfilled at', 'Ship Date'] },
  { key: 'cancel_reason', label: 'Cancel reason', group: 'Delivery', synonyms: ['Cancel reason', 'Cancellation Reason', 'Reason for Cancellation'] },
];

const FEE_SYNONYMS = ['Commission Fee', 'Service Fee', 'Transaction Fee', 'Payment Fee', 'Platform Fee', 'Marketplace Fee', 'Fees', 'Seller Fees'];

const PRODUCT_FIELDS: FieldDef[] = [
  { key: 'title', label: 'Title', group: 'Product', synonyms: ['Product Name', 'Title', 'Name', 'Item Name', 'Product Title', 'Product'] },
  { key: 'sku', label: 'SKU', group: 'Product', synonyms: ['SKU', 'Seller SKU', 'SellerSKU', 'Variant SKU', 'SKU Reference No.', 'Merchant SKU', 'Item SKU'] },
  { key: 'option', label: 'Option', group: 'Product', synonyms: ['Variation Name', 'Variation', 'Option', 'Variant', 'Variant Name', 'Option1 Value', 'Variant Title'] },
  { key: 'group', label: 'Parent SKU', group: 'Product', synonyms: ['Parent SKU', 'Handle', 'Parent', 'Product Group'] },
  { key: 'brand', label: 'Brand', group: 'Product', synonyms: ['Brand', 'Vendor', 'Manufacturer'] },
  { key: 'category', label: 'Category', group: 'Product', synonyms: ['Category', 'Product Category', 'Product Type', 'Type'] },
  { key: 'description', label: 'Description', group: 'Product', synonyms: ['Description', 'Body (HTML)', 'Product Description', 'Body'] },
  { key: 'barcode', label: 'Barcode', group: 'Product', synonyms: ['Barcode', 'Variant Barcode', 'EAN', 'UPC', 'GTIN'] },
  { key: 'price', label: 'Price', group: 'Price and stock', synonyms: ['Price', 'Variant Price', 'Selling Price', 'Retail Price', 'Sale Price', 'Unit Price'] },
  { key: 'cost', label: 'Cost', group: 'Price and stock', synonyms: ['Cost', 'Cost per item', 'Cost Price', 'Unit Cost', 'Purchase Price'] },
  { key: 'stock', label: 'Stock', group: 'Price and stock', synonyms: ['Stock', 'Quantity', 'Qty', 'Inventory', 'Variant Inventory Qty', 'Available', 'On Hand', 'Stock Quantity'] },
  { key: 'external_id', label: 'Listing ID', group: 'On the shop', synonyms: ['Product ID', 'Item ID', 'Listing ID', 'ASIN', 'Item Number', 'ShopSku'] },
  { key: 'url', label: 'Link', group: 'On the shop', synonyms: ['URL', 'Link', 'Product URL', 'Product Link', 'Listing URL'] },
  { key: 'listing_price', label: 'Shop price', group: 'On the shop', synonyms: ['Listing Price', 'Shop Price', 'Platform Price'] },
];

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

type Mapping = Record<string, string>;

/** Each field takes the first header that matches one of its names, in order. */
function autoMatch(fields: FieldDef[], headers: string[], withFees: boolean): { map: Mapping; fees: string[] } {
  const byNorm = new Map<string, string>();
  for (const h of headers) {
    const k = norm(h);
    if (k !== '' && !byNorm.has(k)) byNorm.set(k, h);
  }
  const used = new Set<string>();
  const map: Mapping = {};
  for (const f of fields) {
    for (const syn of f.synonyms) {
      const h = byNorm.get(norm(syn));
      if (h !== undefined && !used.has(h)) {
        map[f.key] = h;
        used.add(h);
        break;
      }
    }
  }
  const fees: string[] = [];
  if (withFees) {
    for (const syn of FEE_SYNONYMS) {
      const h = byNorm.get(norm(syn));
      if (h !== undefined && !used.has(h) && fees.length < 3) {
        fees.push(h);
        used.add(h);
      }
    }
  }
  return { map, fees };
}

/* -------------------------------------------------------------- statuses */

type StatusChoice = OrderStatus | 'skip';

const STATUS_CHOICES: { key: StatusChoice; label: string }[] = [
  { key: 'unpaid', label: STATUS_LABEL.unpaid ?? 'Unpaid' },
  { key: 'to_ship', label: STATUS_LABEL.to_ship ?? 'To ship' },
  { key: 'shipped', label: STATUS_LABEL.shipped ?? 'Shipped' },
  { key: 'delivered', label: STATUS_LABEL.delivered ?? 'Delivered' },
  { key: 'returned', label: STATUS_LABEL.returned ?? 'Returned' },
  { key: 'cancelled', label: STATUS_LABEL.cancelled ?? 'Cancelled' },
  { key: 'skip', label: 'Leave these out' },
];

/** A platform's status word as a Store OS status; null when it is not a word we know. */
function guessStatus(raw: string): OrderStatus | null {
  const v = raw.toLowerCase().replace(/[_-]+/g, ' ');
  if (v.trim() === '') return 'to_ship';
  if (/cancel/.test(v)) return 'cancelled';
  if (/return|refund/.test(v)) return 'returned';
  if (/unpaid|pending payment|awaiting payment|not paid/.test(v)) return 'unpaid';
  if (/to ship|ready to ship|processing|unfulfilled|not shipped|awaiting shipment/.test(v)) return 'to_ship';
  if (/completed|complete|delivered/.test(v)) return 'delivered';
  if (/shipped|shipping|in transit|fulfilled/.test(v)) return 'shipped';
  if (/paid/.test(v)) return 'to_ship';
  return null;
}

/* ----------------------------------------------------------------- build */

type Payload = Record<string, unknown>;

interface BuiltOrder {
  number: string;
  buyer: string;
  lines: number;
  item: string;
  total: number | null;
  currency: string;
  payload: Payload;
}

interface BuiltProduct {
  row: number;
  title: string;
  sku: string;
  option: string;
  price: number | null;
  stock: number | null;
  payload: Payload;
}

function put(p: Payload, key: string, v: string | number | undefined | Payload): void {
  if (v === undefined || v === '') return;
  p[key] = v;
}

function buildOrders(table: Table, map: Mapping, fees: string[], statuses: Record<string, StatusChoice>, currency: string): { orders: BuiltOrder[]; left: number } {
  const idx = (k: string): number => (map[k] ? table.headers.indexOf(map[k] ?? '') : -1);
  const at = (row: Cell[], k: string): Cell => {
    const i = idx(k);
    return i >= 0 ? (row[i] ?? null) : null;
  };
  const feeIdx = fees.map((h) => table.headers.indexOf(h)).filter((i) => i >= 0);

  const groups = new Map<string, Cell[][]>();
  let left = 0;
  for (const row of table.rows) {
    const n = text(at(row, 'number')).replace(/^#/, '');
    if (n === '') {
      left++;
      continue;
    }
    const g = groups.get(n);
    if (g === undefined) groups.set(n, [row]);
    else g.push(row);
  }

  const orders: BuiltOrder[] = [];
  for (const [number, rows] of groups) {
    const first = (k: string): Cell => {
      for (const r of rows) {
        const c = at(r, k);
        if (!blank(c)) return c;
      }
      return null;
    };
    const cur0 = text(first('currency')).toUpperCase();
    const cur = /^[A-Z]{3}$/.test(cur0) ? cur0 : currency;
    const whole = WHOLE.has(cur);
    const amt = (k: string): number | undefined => amount(first(k), whole);

    let status: OrderStatus | undefined;
    if (idx('status') >= 0) {
      const raw = text(first('status'));
      const choice = statuses[raw] ?? guessStatus(raw) ?? 'to_ship';
      if (choice === 'skip') {
        left += rows.length;
        continue;
      }
      status = choice;
    }

    const p: Payload = { number };
    put(p, 'placed_at', dateText(first('placed_at')));
    put(p, 'status', status);
    if (cur0 !== '' && cur === cur0) p.currency = cur;
    const buyer = text(first('buyer_name'));
    put(p, 'buyer_name', buyer);
    put(p, 'buyer_email', text(first('buyer_email')));
    put(p, 'buyer_phone', text(first('buyer_phone')));
    const address: Payload = {};
    put(address, 'line1', text(first('address')));
    put(address, 'city', text(first('city')));
    put(address, 'state', text(first('state')));
    put(address, 'postcode', text(first('postcode')));
    put(address, 'country', text(first('country')));
    if (Object.keys(address).length > 0) {
      put(address, 'name', buyer);
      put(address, 'phone', text(first('buyer_phone')));
      p.address = address;
    }
    const shipping = amt('shipping');
    const discount = amt('discount');
    const tax = amt('tax');
    const total = amt('total');
    put(p, 'shipping', shipping);
    put(p, 'discount', discount === undefined ? undefined : Math.abs(discount));
    put(p, 'tax', tax);
    put(p, 'total', total);
    if (feeIdx.length > 0) {
      const feeRow = rows.find((r) => feeIdx.some((i) => !blank(r[i] ?? null))) ?? rows[0] ?? [];
      let sum = 0;
      let found = false;
      for (const i of feeIdx) {
        const v = amount(feeRow[i] ?? null, whole);
        if (v !== undefined) {
          sum += Math.abs(v);
          found = true;
        }
      }
      if (found) p.fees = Math.round(sum * 1000) / 1000;
    }
    put(p, 'ship_by', dateText(first('ship_by')));
    put(p, 'carrier', text(first('carrier')));
    put(p, 'tracking', text(first('tracking')));
    put(p, 'shipped_at', dateText(first('shipped_at')));
    put(p, 'cancel_reason', text(first('cancel_reason')));

    const lines: Payload[] = [];
    let itemsValue = 0;
    let priced = false;
    for (const r of rows) {
      const sku = text(at(r, 'sku'));
      const title = text(at(r, 'title'));
      if (sku === '' && title === '') continue;
      const q = amount(at(r, 'qty'), true);
      const qty = q === undefined ? 1 : Math.round(q);
      if (qty <= 0) continue;
      const line: Payload = { qty };
      put(line, 'sku', sku);
      put(line, 'title', title);
      put(line, 'option', text(at(r, 'option')));
      const price = amount(at(r, 'price'), whole);
      if (price !== undefined) {
        line.price = price;
        itemsValue += price * qty;
        priced = true;
      }
      lines.push(line);
    }
    if (lines.length > 0) p.lines = lines;
    const firstLine = lines[0];
    const item = firstLine === undefined ? '' : String(firstLine.title ?? firstLine.sku ?? '');
    const shown = total ?? (priced ? itemsValue + (shipping ?? 0) + (tax ?? 0) - Math.abs(discount ?? 0) : null);
    orders.push({ number, buyer, lines: lines.length, item, total: shown, currency: cur, payload: p });
  }
  return { orders, left };
}

function buildProducts(table: Table, map: Mapping, base: string, shopCurrency: string, withShop: boolean): { products: BuiltProduct[]; left: number } {
  const at = (row: Cell[], k: string): Cell => {
    const h = map[k];
    if (!h) return null;
    const i = table.headers.indexOf(h);
    return i >= 0 ? (row[i] ?? null) : null;
  };
  const whole = WHOLE.has(base);
  const products: BuiltProduct[] = [];
  let left = 0;
  table.rows.forEach((row, i) => {
    const title = text(at(row, 'title'));
    const sku = text(at(row, 'sku'));
    if (title === '' && sku === '') {
      left++;
      return;
    }
    const p: Payload = {};
    put(p, 'title', title);
    put(p, 'sku', sku);
    const option = text(at(row, 'option'));
    put(p, 'option', option);
    put(p, 'group', text(at(row, 'group')));
    const price = amount(at(row, 'price'), whole);
    put(p, 'price', price);
    put(p, 'cost', amount(at(row, 'cost'), whole));
    const s = amount(at(row, 'stock'), true);
    const stock = s === undefined ? undefined : Math.round(s);
    put(p, 'stock', stock);
    put(p, 'brand', text(at(row, 'brand')));
    put(p, 'category', text(at(row, 'category')));
    put(p, 'description', text(at(row, 'description')));
    put(p, 'barcode', text(at(row, 'barcode')));
    if (withShop) {
      put(p, 'external_id', text(at(row, 'external_id')));
      put(p, 'url', text(at(row, 'url')));
      put(p, 'listing_price', amount(at(row, 'listing_price'), WHOLE.has(shopCurrency)));
      put(p, 'shop_stock', stock);
    }
    products.push({ row: i + 2, title, sku, option, price: price ?? null, stock: stock ?? null, payload: p });
  });
  return { products, left };
}

/* ---------------------------------------------------------------- dialog */

type Step = 'choose' | 'match' | 'status' | 'preview' | 'running' | 'result';
type StockMode = 'new_only' | 'set' | 'ignore';

interface Result {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  listed: number;
  problems: string[];
  unlinked: string[];
  error: string;
}

interface OrdersAnswer {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  problems: string[];
  unlinked: string[];
}

interface ProductsAnswer {
  created: number;
  updated: number;
  skipped: number;
  listed: number;
  problems: string[];
}

const BATCH = 200;
const EMPTY_RESULT: Result = { created: 0, updated: 0, unchanged: 0, skipped: 0, listed: 0, problems: [], unlinked: [], error: '' };

export function ImportDialog({ open, onClose, kind, shopId }: ImportDialogProps): React.JSX.Element | null {
  const { shops } = useStore();
  const base = useBase();
  const orders = kind === 'orders';
  const fields = orders ? ORDER_FIELDS : PRODUCT_FIELDS;

  const [step, setStep] = useState<Step>('choose');
  const [shop, setShop] = useState('');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<Table | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [map, setMap] = useState<Mapping>({});
  const [fees, setFees] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, StatusChoice>>({});
  const [stockMode, setStockMode] = useState<StockMode>('new_only');
  const [sent, setSent] = useState(0);
  const [result, setResult] = useState<Result>(EMPTY_RESULT);
  const input = useRef<HTMLInputElement>(null);
  /** The running import; closing the dialog moves it on so a running loop stops. */
  const runSeq = useRef(0);

  const defaultShop = (): string => {
    if (shopId !== undefined && shops.some((s) => s.id === shopId)) return shopId;
    if (!orders) return '';
    const online = shops.filter((s) => s.platform !== 'direct');
    return online.length === 1 ? (online[0]?.id ?? '') : '';
  };

  const resetFile = (): void => {
    setStep('choose');
    setFileName('');
    setTable(null);
    setFileError('');
    setMap({});
    setFees([]);
    setStatuses({});
    setSent(0);
    setResult(EMPTY_RESULT);
  };

  useEffect(() => {
    if (!open) return;
    resetFile();
    setShop(defaultShop());
    setStockMode('new_only');
    // Fresh each time the dialog opens (the shop list is read at that moment).
  }, [open, kind, shopId]);

  const shopRec = shops.find((s) => s.id === shop);
  const shopCurrency = shopRec?.currency || base;
  const shopChoices = orders ? shops : shops.filter((s) => s.platform !== 'direct');

  const take = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setReading(true);
    setFileError('');
    try {
      const t = await readFile(file);
      if (t.headers.length === 0 || t.rows.length === 0) throw new Error('This file has no rows under its header.');
      const auto = autoMatch(fields, t.headers, orders);
      setTable(t);
      setFileName(file.name);
      setMap(auto.map);
      setFees(auto.fees);
      setStatuses({});
    } catch (err) {
      setTable(null);
      setFileName('');
      setFileError(errMessage(err));
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  };

  /* status values in the file, most common first */
  const statusValues = useMemo(() => {
    if (!orders || table === null || !map.status) return [];
    const i = table.headers.indexOf(map.status);
    const ni = map.number ? table.headers.indexOf(map.number) : -1;
    if (i < 0 || ni < 0) return [];
    // One value per order: its first filled status, as the import reads it.
    const byOrder = new Map<string, string>();
    for (const r of table.rows) {
      const n = text(r[ni] ?? null).replace(/^#/, '');
      if (n === '') continue;
      const v = text(r[i] ?? null);
      const had = byOrder.get(n);
      if (had === undefined || (had === '' && v !== '')) byOrder.set(n, v);
    }
    const count = new Map<string, number>();
    for (const v of byOrder.values()) count.set(v, (count.get(v) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n, guess: guessStatus(value) }));
  }, [orders, table, map.status, map.number]);

  const choiceOf = (v: string, guess: OrderStatus | null): StatusChoice => statuses[v] ?? guess ?? 'to_ship';

  const built = useMemo(() => {
    if (table === null || (step !== 'preview' && step !== 'running')) return null;
    if (orders) {
      const full: Record<string, StatusChoice> = {};
      for (const s of statusValues) full[s.value] = statuses[s.value] ?? s.guess ?? 'to_ship';
      const out = buildOrders(table, map, fees, full, shopCurrency);
      return { count: out.orders.length, left: out.left, items: out.orders as (BuiltOrder | BuiltProduct)[], orders: out.orders, products: [] as BuiltProduct[] };
    }
    const out = buildProducts(table, map, base, shopCurrency, shop !== '');
    return { count: out.products.length, left: out.left, items: out.products as (BuiltOrder | BuiltProduct)[], orders: [] as BuiltOrder[], products: out.products };
  }, [table, step, orders, map, fees, statuses, statusValues, shopCurrency, base, shop]);

  const steps: Step[] = orders && map.status ? ['choose', 'match', 'status', 'preview'] : ['choose', 'match', 'preview'];
  const stepNames: Record<Step, string> = { choose: 'the file', match: 'match columns', status: 'statuses', preview: 'check', running: 'importing', result: 'done' };
  const at = steps.indexOf(step);

  const needed = orders ? (map.number ?? '') !== '' : (map.title ?? '') !== '' || (map.sku ?? '') !== '';
  const canChoose = table !== null && (!orders || shop !== '');

  const next = (): void => {
    const i = steps.indexOf(step);
    const n = steps[i + 1];
    if (n !== undefined) setStep(n);
  };
  const back = (): void => {
    const i = steps.indexOf(step);
    const p = steps[i - 1];
    if (p !== undefined) setStep(p);
  };

  const run = async (): Promise<void> => {
    if (built === null || built.count === 0) return;
    const mine = ++runSeq.current;
    setStep('running');
    setSent(0);
    const acc: Result = { ...EMPTY_RESULT, problems: [], unlinked: [] };
    const items = built.items;
    const parts = Math.ceil(items.length / BATCH);
    for (let b = 0; b < parts; b++) {
      if (runSeq.current !== mine) break;
      const slice = items.slice(b * BATCH, (b + 1) * BATCH);
      const name = parts > 1 ? fileName + ' (part ' + (b + 1) + ' of ' + parts + ')' : fileName;
      // "Row 3: ..." from the server counts within the batch: name the order or the file row instead.
      const where = (msg: string): string =>
        msg.replace(/^Row (\d+): /, (_m, d: string) => {
          const it = slice[Number(d) - 1];
          if (it === undefined) return 'Row ' + d + ': ';
          return 'row' in it ? 'Row ' + num(it.row) + ': ' : 'Order ' + it.number + ': ';
        });
      try {
        if (orders) {
          const res = await op<OrdersAnswer>('imports.orders', { shop, items: slice.map((x) => x.payload), file_name: name }, { quiet: true });
          acc.created += res.created;
          acc.updated += res.updated;
          acc.unchanged += res.unchanged;
          acc.skipped += res.skipped;
          acc.problems.push(...res.problems.map(where));
          acc.unlinked.push(...res.unlinked);
        } else {
          const res = await op<ProductsAnswer>('imports.products', { shop: shop === '' ? undefined : shop, items: slice.map((x) => x.payload), file_name: name, stock_mode: stockMode }, { quiet: true });
          acc.created += res.created;
          acc.updated += res.updated;
          acc.skipped += res.skipped;
          acc.listed += res.listed;
          acc.problems.push(...res.problems.map(where));
        }
      } catch (err) {
        acc.error = (parts > 1 ? 'Stopped at part ' + (b + 1) + ' of ' + parts + ': ' : '') + errMessage(err);
        break;
      }
      setSent(Math.min(items.length, (b + 1) * BATCH));
    }
    if (orders) changed('orders', 'order_lines', 'shipments', 'customers', 'shops', 'imports', 'variants', 'stock_moves', 'activity');
    else changed('products', 'variants', 'stock_moves', 'listings', 'shops', 'imports', 'activity');
    if (runSeq.current !== mine) return;
    setResult(acc);
    setStep('result');
  };

  const close = (): void => {
    runSeq.current++;
    onClose();
  };

  const noun = orders ? 'order' : 'product';
  const title = orders ? 'Import orders' : 'Import products';
  const subtitle = at >= 0 ? 'Step ' + (at + 1) + ' of ' + steps.length + ': ' + stepNames[step] : step === 'running' ? 'Importing' : 'Done';

  let footer: React.ReactNode = null;
  if (step === 'choose')
    footer = (
      <>
        <Button variant="tile" onClick={close}>
          Cancel
        </Button>
        <Button disabled={!canChoose} onClick={next}>
          Next
        </Button>
      </>
    );
  else if (step === 'match' || step === 'status')
    footer = (
      <>
        <Button variant="tile" icon={ArrowLeft} onClick={back}>
          Back
        </Button>
        <Button disabled={!needed} onClick={next}>
          Next
        </Button>
      </>
    );
  else if (step === 'preview')
    footer = (
      <>
        <Button variant="tile" icon={ArrowLeft} onClick={back}>
          Back
        </Button>
        <Button icon={Upload} disabled={built === null || built.count === 0} onClick={() => void run()}>
          {'Import ' + plural(built?.count ?? 0, noun)}
        </Button>
      </>
    );
  else if (step === 'result')
    footer = (
      <>
        <Button variant="secondary" onClick={resetFile}>
          Import another
        </Button>
        <Button onClick={close}>Done</Button>
      </>
    );

  return (
    <Dialog open={open} onClose={close} title={title} subtitle={subtitle} width={720} {...(footer !== null ? { footer } : {})}>
      {step === 'choose' && (
        <div className="grid gap-4 pb-2">
          <Field label={orders ? 'Shop' : 'Record listings on this shop'} {...(orders && shop === '' ? { hint: 'Needed' } : {})}>
            <Select value={shop} onChange={(e) => setShop(e.target.value)}>
              <option value="">{orders ? 'Choose a shop' : 'No shop'}</option>
              {shopChoices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          {table === null ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void take(e.dataTransfer.files[0]);
              }}
              className={cn('flex flex-col items-center rounded-[16px] border-[1.5px] border-dashed px-6 py-10 text-center transition-colors', dragging ? 'border-[var(--so-ink)] bg-[var(--so-tile-hover)]' : 'border-[var(--so-border)] bg-[var(--so-tile)]')}
            >
              <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-[var(--so-card)]">
                <FileSpreadsheet size={20} strokeWidth={1.8} aria-hidden />
              </span>
              <p className="text-[14px] font-semibold">Drop the export here</p>
              <p className="mt-1 text-[12px] text-[var(--so-muted)]">CSV or Excel, as the seller centre gives it</p>
              <Button className="mt-4" icon={Upload} loading={reading} onClick={() => input.current?.click()}>
                Choose file
              </Button>
              <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void take(e.target.files?.[0])} />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-[14px] bg-[var(--so-tile)] p-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--so-card)]">
                <FileSpreadsheet size={18} strokeWidth={2} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{fileName}</p>
                <p className="num text-[12px] text-[var(--so-muted)]">
                  {plural(table.rows.length, 'row')}, {plural(table.headers.length, 'column')}
                </p>
              </div>
              <IconButton icon={X} label="Choose another file" variant="card" size={32} className="hover:bg-[var(--so-tile-hover)]" onClick={resetFile} />
            </div>
          )}
          {fileError !== '' && <p className="rounded-[12px] bg-[var(--so-red-soft)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--so-red-text)]">{fileError}</p>}
        </div>
      )}

      {step === 'match' && table !== null && <MatchStep fields={fields} table={table} map={map} setMap={setMap} fees={orders ? fees : null} setFees={setFees} shopChosen={shop !== ''} />}

      {step === 'status' && (
        <div className="pb-2">
          <p className="mb-3 text-[13px] text-[var(--so-muted)]">{plural(statusValues.length, 'status', 'statuses')} in this file</p>
          <ul>
            {statusValues.map((s) => (
              <li key={s.value} className="flex flex-wrap items-center gap-3 border-t border-[var(--so-line)] py-2 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{s.value !== '' ? s.value : '(blank)'}</p>
                  <p className="num text-[12px] text-[var(--so-muted)]">{plural(s.n, 'order')}</p>
                </div>
                {s.guess === null && statuses[s.value] === undefined && <Pill tone="warn">Check</Pill>}
                <Select className="w-full sm:w-[200px]" aria-label={'Status for ' + (s.value || 'blank')} value={choiceOf(s.value, s.guess)} onChange={(e) => setStatuses((m) => ({ ...m, [s.value]: e.target.value as StatusChoice }))}>
                  {STATUS_CHOICES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 'preview' && table !== null && built !== null && (
        <div className="pb-2">
          <p className="num mb-1 text-[14px] font-semibold">
            {plural(table.rows.length, 'row')}, {plural(built.count, noun)}
          </p>
          {built.left > 0 && (
            <p className="num mb-1 text-[12px] text-[var(--so-amber-text)]">{plural(built.left, 'row') + (orders ? ' left out (no order number, or a status you leave out)' : ' left out (no title or SKU)')}</p>
          )}
          <p className="mb-3 text-[12px] text-[var(--so-muted)]">{built.count > 5 ? 'The first 5' : 'As they will be imported'}</p>
          <div className="overflow-x-auto rounded-[14px] shadow-[inset_0_0_0_1px_var(--so-line)]">
            {orders ? (
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr>
                    <Th>Number</Th>
                    <Th>Buyer</Th>
                    <Th>Lines</Th>
                    <Th align="right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {built.orders.slice(0, 5).map((o) => (
                    <Tr key={o.number}>
                      <Td className="font-semibold">{o.number}</Td>
                      <Td>{o.buyer !== '' ? o.buyer : <span className="text-[var(--so-faint)]">None</span>}</Td>
                      <Td>
                        <span className="block max-w-[240px] truncate">{o.lines === 0 ? <span className="text-[var(--so-faint)]">No items</span> : plural(o.lines, 'line') + (o.item !== '' ? ': ' + o.item : '')}</span>
                      </Td>
                      <Td align="right">{o.total !== null ? money(o.total, o.currency) : ''}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr>
                    <Th>Title</Th>
                    <Th>SKU</Th>
                    <Th>Option</Th>
                    <Th align="right">Price</Th>
                    <Th align="right">Stock</Th>
                  </tr>
                </thead>
                <tbody>
                  {built.products.slice(0, 5).map((p) => (
                    <Tr key={p.row}>
                      <Td>
                        <span className="block max-w-[220px] truncate font-semibold">{p.title !== '' ? p.title : p.sku}</span>
                      </Td>
                      <Td>{p.sku}</Td>
                      <Td>{p.option}</Td>
                      <Td align="right">{p.price !== null && base !== '' ? money(p.price, base) : p.price !== null ? num(p.price) : ''}</Td>
                      <Td align="right">{p.stock !== null ? num(p.stock) : ''}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {!orders && (map.stock ?? '') !== '' && (
            <Field label={<Tip text="What to do with the stock column for SKUs you already have">Stock counts</Tip>} className="mt-4 max-w-[320px]">
              <Select value={stockMode} onChange={(e) => setStockMode(e.target.value as StockMode)}>
                <option value="new_only">Only for new SKUs</option>
                <option value="set">Set every count</option>
                <option value="ignore">Ignore stock</option>
              </Select>
            </Field>
          )}
        </div>
      )}

      {step === 'running' && (
        <div className="py-8">
          <p className="num mb-3 text-[14px] font-semibold">
            Importing {num(sent)} of {plural(built?.count ?? 0, noun)}
          </p>
          <Meter value={sent} max={built?.count ?? 1} />
        </div>
      )}

      {step === 'result' && <ResultStep result={result} orders={orders} withShop={shop !== ''} />}
    </Dialog>
  );
}

/* --------------------------------------------------------- match columns */

function MatchStep({
  fields,
  table,
  map,
  setMap,
  fees,
  setFees,
  shopChosen,
}: {
  fields: FieldDef[];
  table: Table;
  map: Mapping;
  setMap: (m: Mapping) => void;
  fees: string[] | null;
  setFees: (f: string[]) => void;
  shopChosen: boolean;
}): React.JSX.Element {
  const groups = useMemo(() => {
    const out: { name: string; list: FieldDef[] }[] = [];
    for (const f of fields) {
      if (f.group === 'On the shop' && !shopChosen) continue;
      const g = out.find((x) => x.name === f.group);
      if (g === undefined) out.push({ name: f.group, list: [f] });
      else g.list.push(f);
    }
    return out;
  }, [fields, shopChosen]);

  /** First filled value of a column, to show what it holds. */
  const sample = (h: string): string => {
    const i = table.headers.indexOf(h);
    if (i < 0) return '';
    for (const r of table.rows.slice(0, 30)) {
      const v = text(r[i] ?? null);
      if (v !== '') return v.length > 28 ? v.slice(0, 27) + '...' : v;
    }
    return '';
  };

  const matched = Object.values(map).filter((h) => h !== '').length + (fees?.length ?? 0);

  const columnSelect = (value: string, onChange: (v: string) => void, label: string): React.JSX.Element => (
    <Select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not in the file</option>
      {table.headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="pb-2">
      <p className="num mb-4 text-[13px] text-[var(--so-muted)]">
        {num(matched)} of {plural(table.headers.length, 'column')} matched
      </p>
      {groups.map((g) => (
        <section key={g.name} className="mb-5">
          <p className="mb-2 text-[12px] font-semibold text-[var(--so-muted)]">{g.name}</p>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {g.list.map((f) => {
              const v = map[f.key] ?? '';
              const s = v !== '' ? sample(v) : '';
              return (
                <Field
                  key={f.key}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      {f.label}
                      {f.required === true && v === '' && <Pill tone="warn">Needed</Pill>}
                    </span>
                  }
                  {...(s !== '' ? { hint: <span className="block max-w-[160px] truncate">{s}</span> } : {})}
                >
                  {columnSelect(v, (h) => setMap({ ...map, [f.key]: h }), f.label)}
                </Field>
              );
            })}
            {g.name === 'Money' && fees !== null && (
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-[12px] font-semibold text-[var(--so-ink-2)]">
                  <Tip text="Commission, service and transaction fees: up to three columns, added together">Fees</Tip>
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[0, 1, 2].map((i) =>
                    columnSelect(
                      fees[i] ?? '',
                      (h) => {
                        const next = [fees[0] ?? '', fees[1] ?? '', fees[2] ?? ''];
                        next[i] = h;
                        setFees(next.filter((x) => x !== ''));
                      },
                      'Fee column ' + (i + 1),
                    ),
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      ))}
      {fields === PRODUCT_FIELDS && (map.title ?? '') === '' && (map.sku ?? '') === '' && <p className="text-[12px] font-medium text-[var(--so-amber-text)]">Match a title or a SKU to go on.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- result */

function ResultStep({ result: r, orders, withShop }: { result: Result; orders: boolean; withShop: boolean }): React.JSX.Element {
  const figures: { label: string; value: number; warn?: boolean }[] = [
    { label: 'New', value: r.created },
    { label: 'Updated', value: r.updated },
    ...(orders ? [{ label: 'Unchanged', value: r.unchanged }] : withShop ? [{ label: 'Listed', value: r.listed }] : []),
    { label: 'Skipped', value: r.skipped, warn: r.skipped > 0 },
  ];
  return (
    <div className="grid gap-4 pb-2">
      {r.error !== '' && <p className="rounded-[12px] bg-[var(--so-red-soft)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--so-red-text)]">{r.error}</p>}
      <div className={cn('grid grid-cols-2 gap-2', figures.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        {figures.map((f) => (
          <div key={f.label} className="rounded-[14px] bg-[var(--so-tile)] px-4 py-3">
            <p className={cn('num text-[26px] font-semibold leading-[34px]', f.warn === true && 'text-[var(--so-amber-text)]')}>{num(f.value)}</p>
            <p className="text-[12px] font-medium text-[var(--so-muted)]">{f.label}</p>
          </div>
        ))}
      </div>
      {r.problems.length > 0 && <Lines title={plural(r.problems.length, 'problem')} lines={r.problems} />}
      {r.unlinked.length > 0 && <Lines title={'Not in your catalog (' + num(r.unlinked.length) + ')'} tip="Lines whose SKU is not one of your products yet: add the products or link the lines on the order" lines={r.unlinked} />}
    </div>
  );
}

function Lines({ title, lines, tip }: { title: string; lines: string[]; tip?: string }): React.JSX.Element {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
        <TriangleAlert size={14} strokeWidth={2} className="text-[var(--so-amber-text)]" aria-hidden />
        {tip !== undefined ? <Tip text={tip}>{title}</Tip> : title}
      </p>
      <ul className="max-h-48 overflow-y-auto rounded-[14px] bg-[var(--so-tile)] px-4 py-2">
        {lines.map((l, i) => (
          <li key={i} className="border-t border-[var(--so-line)] py-1.5 text-[12px] leading-[18px] text-[var(--so-ink-2)] first:border-t-0">
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}
