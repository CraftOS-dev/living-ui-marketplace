/// <reference path="../pb_data/types.d.ts" />
/**
 * The pricing engine: a pure function from lines to exact totals, in minor
 * units. Used for every change to a sale, so the register, receipts and
 * reports always agree.
 *
 * Per line: gross = (unit price + options) x qty. Then one item discount:
 * the person's own (percent or amount, given by hand), else the best of the
 * automatic and coupon item promotions that match it. Then the order
 * discount (by hand, by coupon, or the best automatic one) shared across
 * the discountable lines in proportion. What is left is what the line
 * costs. Tax is computed per rate on the total of the lines with that rate
 * (sales and returns apart), then shared back to the lines so they add up
 * exactly. Returned lines keep the price paid and are never discounted;
 * gift card lines are neither discounted nor taxed.
 */

function M() {
  return require(`${__hooks}/lib_money.js`);
}

/** Whether a promotion's item scope covers a line. */
function covers(d, line) {
  if (d.applies === 'categories') return line.category !== '' && d.categories.indexOf(line.category) >= 0;
  if (d.applies === 'products') return line.product !== '' && d.products.indexOf(line.product) >= 0;
  return true;
}

/** Lines a promotion may touch: sold (not returned) items without a discount given by hand. */
function promotable(line) {
  return (line.kind === 'item' || line.kind === 'custom') && line.qty > 0 && !line.isReturn && line.lineDiscount === null;
}

/** What one item promotion takes off each line (an array aligned with lines). */
function itemAmounts(d, lines, gross) {
  const round = M().round;
  const out = lines.map(() => 0);
  const idx = [];
  lines.forEach((l, i) => {
    if (promotable(l) && covers(d, l)) idx.push(i);
  });
  if (idx.length === 0) return out;
  const qty = idx.reduce((a, i) => a + lines[i].qty, 0);
  if (d.min_qty > 0 && qty + 1e-9 < d.min_qty) return out;
  if (d.kind === 'percent') {
    for (const i of idx) out[i] = round((gross[i] * d.value) / 100);
  } else if (d.kind === 'amount') {
    for (const i of idx) out[i] = Math.min(gross[i], round(d.value * lines[i].qty));
  } else if (d.kind === 'bogo') {
    // Units most expensive first; in each full group of buy+get, the last
    // `get` units (the cheapest of the group) are discounted.
    const units = [];
    for (const i of idx) {
      const whole = Math.floor(lines[i].qty + 1e-9);
      const each = lines[i].qty > 0 ? gross[i] / lines[i].qty : 0;
      for (let k = 0; k < whole; k++) units.push({ i: i, price: each });
    }
    units.sort((a, b) => b.price - a.price || a.i - b.i);
    const size = d.buy_qty + d.get_qty;
    if (size <= 0) return out;
    const groups = Math.floor(units.length / size);
    const raw = lines.map(() => 0);
    for (let g = 0; g < groups; g++) {
      for (let k = g * size + d.buy_qty; k < (g + 1) * size; k++) raw[units[k].i] += (units[k].price * d.value) / 100;
    }
    for (const i of idx) out[i] = Math.min(gross[i], round(raw[i]));
  }
  return out;
}

/**
 * Price a sale. input: { includeTax, taxExempt, lines: [{ id, kind, qty,
 * unitPrice, modifiersEach, fixedGross (returns), product, category,
 * taxId, taxName, taxRate (null = no tax), lineDiscount ({ kind
 * percent|amount, value } or null), isReturn }], orderDiscount ({ id, name, kind, value, source manual|code,
 * min_subtotal } or null), promotions (live auto and code promotions as
 * lib_discounts.plain) }.
 */
function price(input) {
  const money = M();
  const round = money.round;
  const lines = input.lines;
  const n = lines.length;
  // A returned line refunds exactly what was paid for it (fixedGross); others are price x qty.
  const gross = lines.map((l) => (typeof l.fixedGross === 'number' ? l.fixedGross : round((l.unitPrice + (l.modifiersEach || 0)) * l.qty)));

  // 1. Item discounts: by hand, else the best promotion.
  const lineDisc = lines.map(() => 0);
  const lineDiscInfo = lines.map(() => null);
  lines.forEach((l, i) => {
    if (l.lineDiscount === null || l.kind === 'gift_card' || l.isReturn || l.qty <= 0) return;
    const d = l.lineDiscount;
    const amt = d.kind === 'percent' ? round((gross[i] * d.value) / 100) : Math.min(gross[i], round(d.value));
    lineDisc[i] = Math.max(0, Math.min(gross[i], amt));
    lineDiscInfo[i] = { source: 'manual', kind: d.kind, value: d.value, reason: d.reason || '', amount: lineDisc[i] };
  });
  const itemPromos = (input.promotions || []).filter((d) => d.scope === 'item');
  const promoAmounts = itemPromos.map((d) => itemAmounts(d, lines, gross));
  const autoInfo = lines.map(() => null);
  for (let i = 0; i < n; i++) {
    if (!promotable(lines[i])) continue;
    let best = -1;
    let amt = 0;
    promoAmounts.forEach((a, k) => {
      if (a[i] > amt) {
        amt = a[i];
        best = k;
      }
    });
    if (best >= 0 && amt > 0) {
      lineDisc[i] = Math.min(gross[i], amt);
      autoInfo[i] = { id: itemPromos[best].id, name: itemPromos[best].name, source: itemPromos[best].mode, amount: lineDisc[i] };
    }
  }

  // 2. The order discount over the discountable lines.
  const after = gross.map((g, i) => g - lineDisc[i]);
  const eligible = lines.map((l) => (l.kind === 'item' || l.kind === 'custom') && l.qty > 0 && !l.isReturn);
  const base = after.reduce((a, x, i) => a + (eligible[i] ? Math.max(x, 0) : 0), 0);
  let orderDisc = null;
  const candidates = [];
  if (input.orderDiscount) candidates.push(input.orderDiscount);
  else for (const d of (input.promotions || []).filter((x) => x.scope === 'order')) candidates.push({ id: d.id, name: d.name, kind: d.kind, value: d.value, source: d.mode, min_subtotal: d.min_subtotal });
  for (const d of candidates) {
    if (base <= 0) break;
    if (d.min_subtotal && base < d.min_subtotal) continue;
    const amt = Math.min(base, d.kind === 'percent' ? round((base * d.value) / 100) : round(d.value));
    if (amt > 0 && (orderDisc === null || amt > orderDisc.amount)) orderDisc = { id: d.id || '', name: d.name || 'Discount', kind: d.kind, value: d.value, source: d.source || 'manual', reason: d.reason || '', amount: amt };
    if (input.orderDiscount) break;
  }
  const orderAlloc = orderDisc === null ? lines.map(() => 0) : money.allocate(orderDisc.amount, after.map((x, i) => (eligible[i] ? Math.max(x, 0) : 0)));
  const paid = after.map((x, i) => x - orderAlloc[i]);

  // 3. Tax per rate (sales and returns apart), shared back to the lines.
  const tax = lines.map(() => 0);
  const groups = {};
  lines.forEach((l, i) => {
    const rate = input.taxExempt || l.kind === 'gift_card' || l.taxRate === null || l.taxRate === undefined ? 0 : l.taxRate;
    if (rate <= 0 || paid[i] === 0) return;
    const key = (l.taxId || 'r' + rate) + '|' + (paid[i] < 0 ? '-' : '+');
    if (!groups[key]) groups[key] = { id: l.taxId || '', name: l.taxName || 'Tax', rate: rate, idx: [], base: 0 };
    groups[key].idx.push(i);
    groups[key].base += paid[i];
  });
  const byRate = {};
  for (const key of Object.keys(groups)) {
    const g = groups[key];
    const t = input.includeTax ? round((g.base * g.rate) / (100 + g.rate)) : round((g.base * g.rate) / 100);
    const parts = money.allocate(t, g.idx.map((i) => paid[i]));
    g.idx.forEach((i, k) => (tax[i] = parts[k]));
    const rk = g.id + '|' + g.rate;
    if (!byRate[rk]) byRate[rk] = { id: g.id, name: g.name, rate: g.rate, base: 0, tax: 0 };
    byRate[rk].base += input.includeTax ? g.base - t : g.base;
    byRate[rk].tax += t;
  }

  // 4. Line results and totals.
  const out = lines.map((l, i) => {
    const net = input.includeTax ? paid[i] - tax[i] : paid[i];
    return {
      id: l.id,
      gross: gross[i],
      discount: lineDisc[i] + orderAlloc[i],
      line_discount: lineDisc[i],
      order_discount: orderAlloc[i],
      manual: lineDiscInfo[i],
      auto: autoInfo[i],
      tax: tax[i],
      net: net,
      total: net + tax[i],
    };
  });
  const sum = (k) => out.reduce((a, x) => a + x[k], 0);
  return {
    lines: out,
    subtotal: sum('gross'),
    discount_total: sum('discount'),
    tax_total: sum('tax'),
    net_total: sum('net'),
    total: sum('total'),
    order_discount: orderDisc,
    taxes: Object.keys(byRate).map((k) => byRate[k]),
  };
}

module.exports = { price: price, itemAmounts: itemAmounts, covers: covers };
