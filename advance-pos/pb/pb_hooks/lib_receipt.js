/// <reference path="../pb_data/types.d.ts" />
/**
 * A receipt: the store header, what was sold and returned, totals, tax by
 * rate, payments, change, points and the footer; as data (the app prints
 * it) and as plain 40-column text (your AI agent sends it).
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

const WIDTH = 40;

function pad(left, right, width) {
  const w = width || WIDTH;
  const r = String(right);
  let l = String(left);
  if (l.length + r.length + 1 > w) l = l.slice(0, Math.max(0, w - r.length - 2)) + '.';
  return l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r;
}

function center(s) {
  const t = String(s).slice(0, WIDTH);
  return ' '.repeat(Math.max(0, Math.floor((WIDTH - t.length) / 2))) + t;
}

function wrap(text) {
  const out = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + ' ' + word).trim().length > WIDTH) {
        out.push(line);
        line = word;
      } else line = (line + ' ' + word).trim();
    }
    out.push(line);
  }
  return out.filter((x, i, a) => !(x === '' && i === a.length - 1));
}

/** The receipt of a sale (paid, or open as a quote). */
function build(app, p) {
  const util = u();
  const s = auth().settingsRow(app);
  const money = require(`${__hooks}/lib_money.js`).of(s);
  const O = require(`${__hooks}/lib_orders.js`);
  const o = O.orderRef(app, util.req(p, 'order', '<order id or receipt number>'));
  const j = O.orderJson(app, o);
  const m = (x) => money.plain(x);
  const store = {
    name: s.getString('business_name'),
    address: s.getString('address'),
    phone: s.getString('phone'),
    email: s.getString('email'),
    website: s.getString('website'),
    tax_number: s.getString('tax_number'),
    header: s.getString('receipt_header'),
    footer: s.getString('receipt_footer'),
    logo: s.getString('logo') === '' ? '' : util.fileUrl(s, 'logo'),
    width: s.getString('receipt_width') || '80',
  };
  const lines = j.lines.map((l) => ({
    name: l.name + (l.variant_title ? ' (' + l.variant_title + ')' : ''),
    qty: l.qty,
    unit: l.unit,
    each: l.unit_price + l.modifiers.reduce((a, x) => a + x.price, 0),
    total: l.total,
    gross: l.gross,
    modifiers: l.modifiers.map((x) => ({ name: x.name, price: x.price })),
    discount: l.discount,
    line_discount: l.line_discount && l.line_discount.amount ? { amount: l.line_discount.amount, label: l.line_discount.kind === 'percent' ? util.fmt(l.line_discount.value) + '% off' : 'Discount', reason: l.line_discount.reason || '' } : null,
    promotion: l.auto_discount ? { amount: l.auto_discount.amount, label: l.auto_discount.name } : null,
    is_return: l.qty < 0,
    gift_code: l.gift_code ? '•••• ' + l.gift_code.slice(-4) : '',
    note: l.note,
    kind: l.kind,
  }));
  const data = {
    store: store,
    number: j.number,
    status: j.status,
    date: j.paid_at || j.updated,
    cashier: j.closed_by || j.opened_by,
    register: j.register ? j.register.name : '',
    customer: j.customer ? { name: j.customer.name, points: j.customer.points } : null,
    label: j.label,
    note: j.note,
    lines: lines,
    subtotal: j.subtotal,
    discount_total: j.discount_total,
    order_discount: j.applied_discount ? { name: j.applied_discount.name, amount: j.applied_discount.amount } : null,
    taxes: j.taxes,
    tax_total: j.tax_total,
    prices_include_tax: s.getBool('prices_include_tax'),
    total: j.total,
    tip: j.tip,
    rounding: j.rounding,
    due: j.due,
    payments: j.payments.filter((x) => x.status === 'captured').map((x) => ({ tender: x.tender, label: x.label || require(`${__hooks}/lib_reports.js`).tenderLabel(x.tender), amount: x.amount, tendered: x.tendered, change: x.change, reference: x.reference })),
    change: j.change_total,
    points_earned: j.points_earned,
    currency: money.currency,
  };
  // Plain text.
  const t = [];
  if (store.name) t.push(center(store.name.toUpperCase()));
  for (const x of wrap(store.address)) if (x) t.push(center(x));
  if (store.phone) t.push(center('Tel ' + store.phone));
  if (store.tax_number) t.push(center('Tax no. ' + store.tax_number));
  for (const x of wrap(store.header)) if (x) t.push(center(x));
  t.push('-'.repeat(WIDTH));
  // The app runs on the shop's computer: its local time is the shop's.
  const d = data.date ? new Date(data.date.replace(' ', 'T')) : null;
  const two = (n) => (n < 10 ? '0' : '') + n;
  const when = d === null || isNaN(d.getTime()) ? '' : util.dayOf(d) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  t.push(pad(j.status === 'paid' ? 'Receipt ' + j.number : j.status === 'void' ? 'VOID' : 'Quote (not paid)', when));
  if (data.cashier) t.push('Served by ' + data.cashier + (data.register ? ', ' + data.register : ''));
  if (data.customer) t.push('Customer: ' + data.customer.name);
  t.push('-'.repeat(WIDTH));
  for (const l of lines) {
    const q = util.fmt(Math.abs(l.qty)) + (l.unit ? ' ' + l.unit : '');
    t.push(pad((l.is_return ? 'RETURN ' : '') + (Math.abs(l.qty) !== 1 || l.unit ? q + ' x ' : '') + l.name, m(l.gross)));
    for (const x of l.modifiers) t.push(pad('   ' + x.name, x.price ? m(x.price * l.qty) : ''));
    if (l.promotion) t.push(pad('   ' + l.promotion.label, '-' + m(l.promotion.amount)));
    if (l.line_discount) t.push(pad('   ' + l.line_discount.label + (l.line_discount.reason ? ' (' + l.line_discount.reason + ')' : ''), '-' + m(l.line_discount.amount)));
    if (l.gift_code) t.push('   Card ' + l.gift_code);
    if (l.note) for (const x of wrap('   ' + l.note)) t.push(x);
  }
  t.push('-'.repeat(WIDTH));
  t.push(pad('Subtotal', m(data.subtotal)));
  if (data.order_discount) t.push(pad(data.order_discount.name, '-' + m(data.order_discount.amount)));
  for (const x of data.taxes) t.push(pad((data.prices_include_tax ? 'Incl. ' : '') + x.name + ' ' + util.fmt(x.rate) + '%', m(x.tax)));
  t.push(pad('TOTAL', money.currency + ' ' + m(data.total)));
  if (data.tip) t.push(pad('Tip', m(data.tip)));
  if (data.rounding) t.push(pad('Rounding', m(data.rounding)));
  if (data.tip || data.rounding) t.push(pad('Paid', m(data.due)));
  for (const x of data.payments) {
    t.push(pad(x.label + (x.reference ? ' ' + x.reference : ''), m(x.tender === 'cash' && x.tendered > 0 ? x.tendered : x.amount)));
    if (x.change > 0) t.push(pad('Change', m(x.change)));
  }
  if (data.customer && data.points_earned) {
    t.push('-'.repeat(WIDTH));
    t.push(pad('Points ' + (data.points_earned > 0 ? 'earned' : 'returned'), String(data.points_earned)));
    t.push(pad('Points balance', String(data.customer.points)));
  }
  if (store.footer) {
    t.push('-'.repeat(WIDTH));
    for (const x of wrap(store.footer)) t.push(center(x));
  }
  data.text = t.join('\n');
  return { receipt: data };
}

module.exports = { build: build, pad: pad };
