/// <reference path="../pb_data/types.d.ts" />
/**
 * A receipt as plain text: what the AI agent emails to a customer, and what
 * it reads when asked about a sale. The printed receipt (frontend
 * components/Receipt.tsx) shows the same fields in the same order.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

const WIDTH = 42;

function line(left, right) {
  const l = String(left);
  const r = String(right);
  const space = WIDTH - l.length - r.length;
  if (space >= 1) return l + ' '.repeat(space) + r;
  return l + '\n' + ' '.repeat(Math.max(0, WIDTH - r.length)) + r;
}

function center(text) {
  const t = String(text);
  if (t.length >= WIDTH) return t;
  return ' '.repeat(Math.floor((WIDTH - t.length) / 2)) + t;
}

function localTime(ts) {
  const util = u();
  const d = util.parseTs(ts);
  if (d === null) return '';
  return util.dayOf(d) + ' ' + util.pad(d.getHours()) + ':' + util.pad(d.getMinutes());
}

const ORDER_TYPE = { dine_in: 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery' };

function text(sale) {
  const util = u();
  const exp = sale.currency_decimals;
  const m = (n) => util.moneyText(n, exp, '');
  const h = sale.header || {};
  const out = [];
  if (h.business_name) out.push(center(h.business_name));
  for (const part of String(h.address || '').split('\n')) if (part.trim() !== '') out.push(center(part.trim()));
  if (h.phone) out.push(center(h.phone));
  if (h.company_reg_no) out.push(center(h.company_reg_no));
  if (h.tax_reg_no) out.push(center((h.tax_reg_label ? h.tax_reg_label + ' ' : '') + h.tax_reg_no));
  if (h.receipt_header) {
    out.push('');
    for (const part of String(h.receipt_header).split('\n')) out.push(center(part));
  }
  out.push('');
  if (sale.training) out.push(center('*** TRAINING - NOT A RECEIPT ***'));
  out.push(center(sale.kind === 'refund' ? 'REFUND' : sale.kind === 'exchange' ? 'EXCHANGE' : 'RECEIPT'));
  if (sale.order_no > 0) out.push(center('Order ' + sale.order_no));
  out.push(line(sale.number, localTime(sale.created)));
  out.push(line(h.register || '', h.staff ? 'Served by ' + h.staff : ''));
  if (sale.order_type) out.push(ORDER_TYPE[sale.order_type] || sale.order_type);
  if (sale.name) out.push('Ticket: ' + sale.name);
  if (h.customer) out.push('Customer: ' + h.customer);
  if (sale.returns_from && sale.returns_from.length > 0) out.push('Returns from ' + sale.returns_from.map((x) => x.number).join(', '));
  out.push('-'.repeat(WIDTH));
  for (const l of sale.lines) {
    const name = (l.mark ? l.mark + ' ' : '') + l.name + (l.variant_name ? ' ' + l.variant_name : '') + (l.qty < 0 ? ' (returned)' : '');
    out.push(line(name, m(l.gross)));
    if (Math.abs(l.qty) !== 1) out.push('  ' + l.qty + ' x ' + m(l.unit));
    for (const mod of l.modifiers || []) out.push('  + ' + mod.name + (mod.price !== 0 ? ' ' + m(mod.price) : ''));
    if (l.line_discount !== 0) out.push(line('  Discount' + (l.discount_name ? ' ' + l.discount_name : ''), m(-l.line_discount)));
    if (l.note) out.push('  ' + l.note);
  }
  out.push('-'.repeat(WIDTH));
  out.push(line('Subtotal', m(sale.subtotal)));
  const orderDiscount = sale.lines.reduce((s, l) => s + l.order_discount, 0);
  if (orderDiscount !== 0) out.push(line('Order discount', m(-orderDiscount)));
  if (sale.service_charge !== 0) out.push(line('Service charge', m(sale.service_charge)));
  if (sale.price_mode === 'exclusive') {
    for (const t of sale.taxes) if (t.tax !== 0) out.push(line(t.name, m(t.tax)));
  }
  if (sale.rounding !== 0) out.push(line('Rounding', m(sale.rounding)));
  out.push(line('TOTAL ' + sale.currency, m(sale.total + sale.rounding)));
  out.push('');
  for (const p of sale.payments) {
    out.push(line(p.name + (p.reference ? ' ' + p.reference : ''), m(p.kind === 'cash' && p.amount > 0 ? p.tendered : p.amount)));
  }
  if (sale.change > 0) out.push(line('Change', m(sale.change)));
  if (sale.taxes.length > 0) {
    out.push('');
    for (const t of sale.taxes) {
      out.push(line((t.mark ? t.mark + ' ' : '') + util.bpText(t.rate_bp) + '% on ' + m(sale.price_mode === 'inclusive' ? t.gross : t.base), m(t.tax)));
    }
    if (sale.price_mode === 'inclusive') out.push(line('Tax included', m(sale.tax_total)));
    const marks = sale.taxes.filter((t) => t.mark);
    for (const t of marks) out.push(t.mark + ' ' + t.name);
  }
  if (h.receipt_footer) {
    out.push('');
    for (const part of String(h.receipt_footer).split('\n')) out.push(center(part));
  }
  return out.join('\n');
}

module.exports = { text: text, localTime: localTime };
