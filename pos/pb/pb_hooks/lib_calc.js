/// <reference path="../pb_data/types.d.ts" />
/**
 * The totals engine: pure integer arithmetic on minor units, no records.
 * The counter's screen runs the same rules (frontend/src/app/lib/calc.ts),
 * so the total a cashier sees is the total the sale records; finalize
 * re-computes it here and refuses a sale whose total changed underneath.
 *
 * Rules, in order:
 * 1. A line's unit price is its base price plus its modifiers; gross = unit x qty.
 * 2. A line discount (percent or amount) comes off that line.
 * 3. An order discount is shared across the sale lines in proportion to what
 *    is left of each (largest remainder, so the shares add up exactly).
 * 4. Tax is computed ONCE per tax rate per receipt (classes with the same
 *    rate are one group) and rounded once with the shop's rounding (half up,
 *    down or up), then shared back to the lines by largest remainder. With tax-inclusive prices the tax is the part of the
 *    price that is tax (price x rate / (1 + rate)); with tax-exclusive prices
 *    it is added on top. This is the rule the Japanese qualified invoice
 *    requires and it gives a receipt whose per-rate tax matches its lines.
 * 5. A rate can change when the order is eaten in (dine_in_rate_bp).
 * 6. A service charge is a percentage of the sale lines before tax, taxed
 *    with its own tax class if it has one.
 * 7. Return lines carry fixed amounts taken from the line they return
 *    (a share of what was actually paid), never re-priced.
 * 8. Cash rounding is not part of the total: it applies only to the part of
 *    a total that is settled in cash (see cashDue).
 */

/** a / b rounded by mode, for a >= 0 and b > 0. */
function roundDiv(a, b, mode) {
  if (b <= 0) return 0;
  if (a < 0) return -roundDiv(-a, b, mode === 'floor' ? 'ceil' : mode === 'ceil' ? 'floor' : mode);
  if (mode === 'floor') return Math.floor(a / b);
  if (mode === 'ceil') return Math.ceil(a / b);
  return Math.floor((2 * a + b) / (2 * b));
}

/**
 * Share `total` across `weights` in proportion (largest remainder): the
 * shares are whole numbers that add up to `total` exactly. Ties go to the
 * earlier line. Weights and total are >= 0.
 */
function allocate(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  const out = weights.map(() => 0);
  if (total === 0 || sum === 0) return out;
  const rema = [];
  let given = 0;
  for (let i = 0; i < weights.length; i++) {
    let q;
    let r;
    const exact = total * weights[i];
    if (Number.isSafeInteger(exact)) {
      q = Math.floor(exact / sum);
      r = exact - q * sum;
    } else {
      // Past 2^53 a float product is no longer exact: do this one in BigInt.
      const big = BigInt(total) * BigInt(weights[i]);
      q = Number(big / BigInt(sum));
      r = Number(big % BigInt(sum));
    }
    out[i] = q;
    given += q;
    rema.push({ i: i, r: r });
  }
  rema.sort((x, y) => (y.r !== x.r ? y.r - x.r : x.i - y.i));
  for (let k = 0; k < total - given; k++) out[rema[k % rema.length].i] += 1;
  return out;
}

/** The rate a tax class charges for this order type. */
function rateFor(tax, orderType) {
  if (tax === null || tax === undefined) return 0;
  if (orderType === 'dine_in' && typeof tax.dine_in_rate_bp === 'number' && tax.dine_in_rate_bp >= 0) return tax.dine_in_rate_bp;
  return tax.rate_bp || 0;
}

/** A discount on `base`: { kind: 'percent', value: bp } or { kind: 'amount', value: minor }. */
function discountOn(base, d) {
  if (d === null || d === undefined || base <= 0) return 0;
  if (d.kind === 'percent') return Math.min(base, roundDiv(base * d.value, 10000, 'half_up'));
  return Math.min(base, Math.max(0, d.value));
}

/**
 * A return's share of one figure of the original line: the same proportion
 * of the quantity, and on the last units exactly what is left, so returning
 * a line in parts refunds what it cost in total, to the unit.
 */
function returnShare(total, origQty, qty, prevQty, prevAmount) {
  if (prevQty + qty >= origQty) return total - prevAmount;
  return roundDiv(total * qty, origQty, 'half_up');
}

/**
 * input = {
 *   price_mode: 'inclusive' | 'exclusive', tax_rounding: 'half_up' | 'floor' | 'ceil',
 *   order_type: '' | 'dine_in' | 'takeaway' | 'delivery',
 *   service: { bp, scope: 'dine_in' | 'all', tax: taxClass | null } | null,
 *   discount: { kind, value } | null,                      (the order discount)
 *   lines: [
 *     { qty > 0, unit, tax: { id, name, rate_bp, dine_in_rate_bp, mark }, discount: { kind, value } | null }
 *     { qty < 0, fixed: { gross, line_discount, order_discount, net, tax, rate_bp, tax_id, tax_name, mark } }
 *   ]
 * }
 * Every amount is an integer of minor units; fixed return amounts are negative.
 */
function compute(input) {
  const mode = input.tax_rounding || 'half_up';
  const inclusive = input.price_mode === 'inclusive';
  const orderType = input.order_type || '';
  const lines = input.lines || [];
  const out = lines.map(() => null);

  // 1-2. Gross and line discounts for sale lines.
  const saleIdx = [];
  const after = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.qty < 0) {
      const f = l.fixed;
      out[i] = {
        gross: f.gross,
        line_discount: f.line_discount,
        order_discount: f.order_discount,
        net: f.net,
        tax: f.tax,
        rate_bp: f.rate_bp,
        tax_id: f.tax_id,
        tax_name: f.tax_name,
        mark: f.mark || '',
      };
      continue;
    }
    const gross = l.unit * l.qty;
    const ld = discountOn(gross, l.discount);
    const rate = rateFor(l.tax, orderType);
    out[i] = {
      gross: gross,
      line_discount: ld,
      order_discount: 0,
      net: gross - ld,
      tax: 0,
      rate_bp: rate,
      tax_id: l.tax ? l.tax.id : '',
      tax_name: l.tax ? l.tax.name : '',
      mark: l.tax ? l.tax.mark || '' : '',
    };
    saleIdx.push(i);
    after.push(gross - ld);
  }

  // 3. The order discount, shared across the sale lines.
  const base = after.reduce((s, x) => s + x, 0);
  const orderDiscount = discountOn(base, input.discount);
  const shares = allocate(orderDiscount, after);
  saleIdx.forEach((i, k) => {
    out[i].order_discount = shares[k];
    out[i].net = out[i].net - shares[k];
  });

  // 4-5. Tax once per rate, shared back to the lines.
  const groups = {};
  const order = [];
  for (const i of saleIdx) {
    const key = String(out[i].rate_bp);
    if (groups[key] === undefined) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(i);
  }
  for (const key of order) {
    const idx = groups[key];
    const rate = out[idx[0]].rate_bp;
    const nets = idx.map((i) => out[i].net);
    const sum = nets.reduce((s, x) => s + x, 0);
    const tax = rate === 0 ? 0 : inclusive ? roundDiv(sum * rate, 10000 + rate, mode) : roundDiv(sum * rate, 10000, mode);
    const parts = allocate(tax, nets);
    idx.forEach((i, k) => {
      out[i].tax = parts[k];
    });
  }

  // 6. Service charge on the sale lines before tax.
  let service = 0;
  let serviceTax = 0;
  let serviceRate = 0;
  const sv = input.service;
  if (sv && sv.bp > 0 && saleIdx.length > 0 && (sv.scope === 'all' || orderType === 'dine_in')) {
    const pre = saleIdx.reduce((s, i) => s + (inclusive ? out[i].net - out[i].tax : out[i].net), 0);
    service = roundDiv(pre * sv.bp, 10000, 'half_up');
    if (sv.tax) {
      serviceRate = rateFor(sv.tax, orderType);
      serviceTax = roundDiv(service * serviceRate, 10000, mode);
    }
  }

  // Totals and the per-rate summary.
  let subtotal = 0;
  let discountTotal = 0;
  let itemsNet = 0;
  let lineTax = 0;
  const rows = {};
  const rowOrder = [];
  // One summary row per rate (what a receipt prints: "8% on 324, tax 24").
  const addRow = (taxId, name, rate, mark, baseAmt, taxAmt) => {
    const key = String(rate);
    if (rows[key] === undefined) {
      rows[key] = { tax_id: taxId, name: name, rate_bp: rate, mark: mark, base: 0, tax: 0, gross: 0 };
      rowOrder.push(key);
    } else {
      if (name !== '' && rows[key].name.split(' + ').indexOf(name) < 0) rows[key].name = rows[key].name === '' ? name : rows[key].name + ' + ' + name;
      if (rows[key].mark === '' && mark) rows[key].mark = mark;
    }
    rows[key].base += baseAmt;
    rows[key].tax += taxAmt;
    rows[key].gross += baseAmt + taxAmt;
  };
  for (const l of out) {
    subtotal += l.gross;
    discountTotal += l.line_discount + l.order_discount;
    itemsNet += l.net;
    lineTax += l.tax;
    addRow(l.tax_id, l.tax_name, l.rate_bp, l.mark, inclusive ? l.net - l.tax : l.net, l.tax);
  }
  if (service !== 0) {
    if (sv.tax) addRow(sv.tax.id, sv.tax.name, serviceRate, sv.tax.mark || '', service, serviceTax);
    else addRow('', 'No tax', 0, '', service, 0);
  }
  const taxes = rowOrder.map((k) => rows[k]).filter((r) => r.base !== 0 || r.tax !== 0);
  taxes.sort((a, b) => b.rate_bp - a.rate_bp);
  const total = inclusive ? itemsNet + service + serviceTax : itemsNet + lineTax + service + serviceTax;

  return {
    lines: out,
    subtotal: subtotal,
    discount_total: discountTotal,
    order_discount: orderDiscount,
    items_net: itemsNet,
    service_charge: service,
    service_tax: serviceTax,
    tax_total: lineTax + serviceTax,
    taxes: taxes,
    total: total,
  };
}

/** Round an amount to the nearest `inc` minor units (half up, away from zero). */
function roundTo(amount, inc) {
  if (!inc || inc <= 0) return amount;
  const sign = amount < 0 ? -1 : 1;
  const a = Math.abs(amount);
  return sign * Math.floor((2 * a + inc) / (2 * inc)) * inc;
}

/**
 * What cash settles: the total less the non-cash payments, rounded to the
 * smallest coin when the shop rounds cash. Returns { due, rounded, rounding }.
 */
function cashDue(total, nonCash, inc) {
  const due = total - nonCash;
  const rounded = roundTo(due, inc);
  return { due: due, rounded: rounded, rounding: rounded - due };
}

module.exports = {
  roundDiv: roundDiv,
  allocate: allocate,
  rateFor: rateFor,
  discountOn: discountOn,
  returnShare: returnShare,
  compute: compute,
  roundTo: roundTo,
  cashDue: cashDue,
};
