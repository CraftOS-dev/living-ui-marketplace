/**
 * Printing a receipt on a receipt printer (58 or 80 mm roll) or any printer.
 * The receipt is laid out in a hidden frame of its own, sized to the roll,
 * so nothing of the app prints with it. A gift receipt leaves the prices
 * out. Downloads (CSV exports) use the same pattern: a file the browser
 * saves, never a new window.
 */
import { qty } from './format.ts';
import type { Money } from './format.ts';
import { toDate } from './format.ts';
import type { CsvFile, Receipt, Shift } from './types.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function lines(text: string): string {
  return esc(text).replace(/\n/g, '<br>');
}

const TENDER_NAMES: Record<string, string> = { cash: 'Cash', card: 'Card', gift_card: 'Gift card', store_credit: 'Store credit', points: 'Points' };

export function tenderName(tender: string, label: string): string {
  return label !== '' ? label : (TENDER_NAMES[tender] ?? tender);
}

export function receiptHtml(r: Receipt, m: Money, gift = false): string {
  const width = r.store.width === '58' ? 58 : 80;
  const d = toDate(r.date);
  const stamp = d === null ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const row = (left: string, right: string, cls = ''): string => `<div class="row ${cls}"><span>${left}</span><span>${right}</span></div>`;
  const parts: string[] = [];
  if (r.store.logo !== '') parts.push(`<img class="logo" src="${esc(new URL(r.store.logo, window.location.origin).href)}" alt="">`);
  parts.push(`<div class="store">${esc(r.store.name)}</div>`);
  const contact = [r.store.address, r.store.phone, r.store.email, r.store.website].filter((x) => x !== '').join('\n');
  if (contact !== '') parts.push(`<div class="center small">${lines(contact)}</div>`);
  if (r.store.tax_number !== '') parts.push(`<div class="center small">Tax no. ${esc(r.store.tax_number)}</div>`);
  if (r.store.header !== '') parts.push(`<div class="center gap">${lines(r.store.header)}</div>`);
  parts.push('<hr>');
  if (gift) parts.push('<div class="title">Gift receipt</div>');
  else if (r.total < 0) parts.push('<div class="title">Refund</div>');
  parts.push(row('Receipt ' + esc(r.number), esc(stamp)));
  parts.push(row(esc(r.register), esc(r.cashier)));
  if (r.label !== '') parts.push(row('Ticket', esc(r.label)));
  if (r.customer !== null) parts.push(row('Customer', esc(r.customer.name)));
  parts.push('<hr>');
  for (const l of r.lines) {
    const q = l.unit !== '' ? qty(l.qty) + ' ' + esc(l.unit) : qty(l.qty);
    const name = (l.is_return ? 'Return: ' : '') + esc(l.name);
    if (gift) {
      parts.push(row(`${q} &times; ${name}`, ''));
    } else {
      parts.push(row(`${q} &times; ${name}`, esc(m.fmt(l.gross))));
      if (l.qty !== 1 && l.qty !== -1) parts.push(`<div class="sub">@ ${esc(m.fmt(l.each))}${l.unit !== '' ? ' / ' + esc(l.unit) : ''}</div>`);
    }
    for (const mod of l.modifiers) parts.push(`<div class="sub">+ ${esc(mod.name)}</div>`);
    if (!gift && l.promotion !== null) parts.push(row(`<span class="sub">${esc(l.promotion.label)}</span>`, esc(m.fmt(-l.promotion.amount))));
    if (!gift && l.line_discount !== null) parts.push(row(`<span class="sub">${esc(l.line_discount.label + (l.line_discount.reason !== '' ? ' (' + l.line_discount.reason + ')' : ''))}</span>`, esc(m.fmt(-l.line_discount.amount))));
    if (l.gift_code !== '') parts.push(`<div class="sub">Card ${esc(l.gift_code)}</div>`);
    if (l.note !== '') parts.push(`<div class="sub">${esc(l.note)}</div>`);
  }
  if (!gift) {
    parts.push('<hr>');
    parts.push(row('Subtotal', esc(m.fmt(r.subtotal))));
    if (r.order_discount !== null) parts.push(row(esc(r.order_discount.name), esc(m.fmt(-r.order_discount.amount))));
    for (const t of r.taxes) parts.push(row(esc(t.name) + ' ' + t.rate + '%' + (r.prices_include_tax ? ' (included)' : ''), esc(m.fmt(t.tax))));
    if (r.tip !== 0) parts.push(row('Tip', esc(m.fmt(r.tip))));
    if (r.rounding !== 0) parts.push(row('Cash rounding', esc(m.fmt(r.rounding))));
    parts.push(row('Total', esc(m.fmt(r.due)), 'total'));
    parts.push('<hr>');
    for (const p of r.payments) {
      parts.push(row(esc(tenderName(p.tender, p.label)) + (p.reference !== '' ? ' ' + esc(p.reference) : ''), esc(m.fmt(p.amount))));
      if (p.tender === 'cash' && p.tendered > 0 && p.change > 0) {
        parts.push(row('<span class="sub">Cash given</span>', esc(m.fmt(p.tendered))));
        parts.push(row('<span class="sub">Change</span>', esc(m.fmt(p.change))));
      }
    }
    if (r.points_earned !== 0) parts.push(`<div class="center gap small">${r.points_earned > 0 ? 'Points earned' : 'Points returned'}: ${Math.abs(r.points_earned)}${r.customer !== null ? ' &middot; Balance ' + r.customer.points : ''}</div>`);
  }
  if (r.note !== '') parts.push(`<div class="gap small">${lines(r.note)}</div>`);
  if (r.store.footer !== '') parts.push(`<div class="center gap">${lines(r.store.footer)}</div>`);
  parts.push(`<div class="center gap small">${esc(r.number)}</div>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(r.number)}</title><style>
@page { size: ${width}mm auto; margin: 3mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: ${width - 6}mm; font: ${width === 58 ? 11 : 12}px/1.35 ui-monospace, 'Cascadia Mono', Consolas, monospace; }
.logo { display: block; max-width: 60%; max-height: 22mm; margin: 0 auto 2mm; }
.store { text-align: center; font-weight: 700; font-size: 1.25em; margin-bottom: 1mm; }
.title { text-align: center; font-weight: 700; margin-bottom: 1mm; text-transform: uppercase; letter-spacing: 0.08em; }
.center { text-align: center; }
.small { font-size: 0.9em; }
.gap { margin-top: 2mm; }
.row { display: flex; justify-content: space-between; gap: 3mm; }
.row > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.row > span:last-child { white-space: nowrap; text-align: right; }
.sub { padding-left: 3mm; font-size: 0.92em; }
.total { font-weight: 700; font-size: 1.2em; margin-top: 1mm; }
hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
</style></head><body>${parts.join('')}</body></html>`;
}

/** A drawer session's Z report (or X report while it is open), for the receipt printer. */
export function zReportHtml(sh: Shift, m: Money, store: string): string {
  const r = sh.report;
  const row = (left: string, right: string, cls = ''): string => `<div class="row ${cls}"><span>${left}</span><span>${right}</span></div>`;
  const stamp = (s: string): string => {
    const d = toDate(s);
    return d === null ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };
  const parts: string[] = [];
  parts.push(`<div class="store">${esc(store)}</div>`);
  parts.push(`<div class="title">${sh.status === 'closed' ? 'Z report' : 'X report'}</div>`);
  parts.push(row(esc(sh.register.name), 'Session ' + sh.number));
  parts.push(row('Opened', esc(stamp(sh.opened_at))));
  parts.push(row('', esc(sh.opened_by)));
  if (sh.status === 'closed') {
    parts.push(row('Closed', esc(stamp(sh.closed_at))));
    parts.push(row('', esc(sh.closed_by)));
  }
  if (r !== undefined) {
    parts.push('<hr>');
    parts.push(row('Sales', String(r.summary.sales)));
    parts.push(row('Gross sales', esc(m.fmt(r.summary.gross_sales))));
    parts.push(row('Discounts', esc(m.fmt(-r.summary.discounts))));
    parts.push(row('Returns', esc(m.fmt(-r.summary.returns))));
    parts.push(row('Net sales', esc(m.fmt(r.summary.net_sales)), 'total'));
    parts.push(row('Tax', esc(m.fmt(r.summary.tax))));
    if (r.summary.tips !== 0) parts.push(row('Tips', esc(m.fmt(r.summary.tips))));
    if (r.summary.gift_cards !== 0) parts.push(row('Gift cards sold', esc(m.fmt(r.summary.gift_cards))));
    parts.push('<hr>');
    for (const p of r.payments) parts.push(row(esc(p.label) + ' (' + p.count + ')', esc(m.fmt(p.amount))));
    parts.push('<hr>');
    parts.push(row('Opening float', esc(m.fmt(r.cash.opening_float))));
    parts.push(row('Cash sales', esc(m.fmt(r.cash.cash_sales))));
    parts.push(row('Cash refunds', esc(m.fmt(-r.cash.cash_refunds))));
    parts.push(row('Paid in', esc(m.fmt(r.cash.pay_ins))));
    parts.push(row('Paid out', esc(m.fmt(-r.cash.pay_outs))));
    parts.push(row('Expected', esc(m.fmt(r.cash.expected)), 'total'));
    if (sh.status === 'closed') {
      parts.push(row('Counted', esc(m.fmt(sh.counted))));
      parts.push(row(sh.difference === 0 ? 'Even' : sh.difference < 0 ? 'Short' : 'Over', esc(m.fmt(Math.abs(sh.difference)))));
    }
    parts.push('<hr>');
    parts.push(row('No-sale opens', String(r.cash.no_sales)));
    parts.push(row('Cleared sales', String(r.voids.sales)));
    parts.push(row('Voided payments', String(r.voids.payments)));
    parts.push(row('Removed lines', String(r.voids.lines)));
  }
  if (sh.note !== '') parts.push(`<div class="gap small">${lines(sh.note)}</div>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Report</title><style>
@page { size: 80mm auto; margin: 3mm; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: 74mm; font: 12px/1.35 ui-monospace, 'Cascadia Mono', Consolas, monospace; }
.store { text-align: center; font-weight: 700; font-size: 1.2em; }
.title { text-align: center; font-weight: 700; margin: 1mm 0 2mm; text-transform: uppercase; letter-spacing: 0.08em; }
.row { display: flex; justify-content: space-between; gap: 3mm; }
.total { font-weight: 700; }
.gap { margin-top: 2mm; }
.small { font-size: 0.9em; }
hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
</style></head><body>${parts.join('')}</body></html>`;
}

/** Print through a hidden frame; resolves when the print dialog has been handed the page. */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (doc === null || win === null) {
      frame.remove();
      resolve();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const go = (): void => {
      win.focus();
      win.print();
      resolve();
      // Leave the frame long enough for the print dialog to read it.
      setTimeout(() => frame.remove(), 60000);
    };
    const imgs = Array.from(doc.images);
    if (imgs.length === 0) setTimeout(go, 50);
    else {
      let left = imgs.length;
      const done = (): void => {
        left -= 1;
        if (left === 0) go();
      };
      for (const img of imgs) {
        if (img.complete) done();
        else {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        }
      }
    }
  });
}

export function printReceipt(r: Receipt, m: Money, gift = false): Promise<void> {
  return printHtml(receiptHtml(r, m, gift));
}

/** Save text as a file (CSV exports). */
export function download(file: CsvFile): void {
  // A byte-order mark so spreadsheet apps read UTF-8 names correctly.
  const blob = new Blob(['﻿' + file.csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
