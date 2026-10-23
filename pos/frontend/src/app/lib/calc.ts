/**
 * The totals engine, the same rules as pb_hooks/lib_calc.js (keep them in
 * step): integer minor units, line then order discounts (shared by largest
 * remainder), tax once per rate per receipt with the shop's rounding, the
 * service charge, fixed amounts for returns, and cash rounding on the part
 * settled in cash. The counter shows these numbers; finalize re-computes
 * them on the server and refuses a sale whose total differs.
 */

export interface TaxRef {
  id: string;
  name: string;
  rate_bp: number;
  dine_in_rate_bp: number;
  mark: string;
}

export interface DiscountInput {
  kind: 'percent' | 'amount';
  value: number;
}

export interface FixedAmounts {
  gross: number;
  line_discount: number;
  order_discount: number;
  net: number;
  tax: number;
  rate_bp: number;
  tax_id: string;
  tax_name: string;
  mark: string;
}

export type CalcLine = { qty: number; unit: number; tax: TaxRef | null; discount: DiscountInput | null } | { qty: number; fixed: FixedAmounts };

export interface CalcInput {
  price_mode: 'inclusive' | 'exclusive';
  tax_rounding: 'half_up' | 'floor' | 'ceil';
  order_type: string;
  service: { bp: number; scope: 'dine_in' | 'all'; tax: TaxRef | null } | null;
  discount: DiscountInput | null;
  lines: CalcLine[];
}

export interface CalcLineOut {
  gross: number;
  line_discount: number;
  order_discount: number;
  net: number;
  tax: number;
  rate_bp: number;
  tax_id: string;
  tax_name: string;
  mark: string;
}

export interface TaxSummaryRow {
  tax_id: string;
  name: string;
  rate_bp: number;
  mark: string;
  base: number;
  tax: number;
  gross: number;
}

export interface CalcOut {
  lines: CalcLineOut[];
  subtotal: number;
  discount_total: number;
  order_discount: number;
  items_net: number;
  service_charge: number;
  service_tax: number;
  tax_total: number;
  taxes: TaxSummaryRow[];
  total: number;
}

/** a / b rounded by mode. */
export function roundDiv(a: number, b: number, mode: 'half_up' | 'floor' | 'ceil'): number {
  if (b <= 0) return 0;
  if (a < 0) return -roundDiv(-a, b, mode === 'floor' ? 'ceil' : mode === 'ceil' ? 'floor' : mode);
  if (mode === 'floor') return Math.floor(a / b);
  if (mode === 'ceil') return Math.ceil(a / b);
  return Math.floor((2 * a + b) / (2 * b));
}

/** Share `total` across `weights` by largest remainder (ties to the earlier line). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const out = weights.map(() => 0);
  if (total === 0 || sum === 0) return out;
  const rema: { i: number; r: number }[] = [];
  let given = 0;
  weights.forEach((w, i) => {
    let q: number;
    let r: number;
    const exact = total * w;
    if (Number.isSafeInteger(exact)) {
      q = Math.floor(exact / sum);
      r = exact - q * sum;
    } else {
      const big = BigInt(total) * BigInt(w);
      q = Number(big / BigInt(sum));
      r = Number(big % BigInt(sum));
    }
    out[i] = q;
    given += q;
    rema.push({ i, r });
  });
  rema.sort((x, y) => (y.r !== x.r ? y.r - x.r : x.i - y.i));
  for (let k = 0; k < total - given; k++) {
    const target = rema[k % rema.length];
    if (target !== undefined) out[target.i] = (out[target.i] ?? 0) + 1;
  }
  return out;
}

export function rateFor(tax: TaxRef | null, orderType: string): number {
  if (tax === null) return 0;
  if (orderType === 'dine_in' && tax.dine_in_rate_bp >= 0) return tax.dine_in_rate_bp;
  return tax.rate_bp;
}

export function discountOn(base: number, d: DiscountInput | null): number {
  if (d === null || base <= 0) return 0;
  if (d.kind === 'percent') return Math.min(base, roundDiv(base * d.value, 10000, 'half_up'));
  return Math.min(base, Math.max(0, d.value));
}

/** A return's share of one figure of the original line (see lib_calc.returnShare). */
export function returnShare(total: number, origQty: number, qty: number, prevQty: number, prevAmount: number): number {
  if (prevQty + qty >= origQty) return total - prevAmount;
  return roundDiv(total * qty, origQty, 'half_up');
}

export function compute(input: CalcInput): CalcOut {
  const mode = input.tax_rounding;
  const inclusive = input.price_mode === 'inclusive';
  const orderType = input.order_type;
  const out: CalcLineOut[] = [];
  const saleIdx: number[] = [];
  const after: number[] = [];
  input.lines.forEach((l, i) => {
    if ('fixed' in l) {
      out.push({ ...l.fixed });
      return;
    }
    const gross = l.unit * l.qty;
    const ld = discountOn(gross, l.discount);
    out.push({
      gross,
      line_discount: ld,
      order_discount: 0,
      net: gross - ld,
      tax: 0,
      rate_bp: rateFor(l.tax, orderType),
      tax_id: l.tax?.id ?? '',
      tax_name: l.tax?.name ?? '',
      mark: l.tax?.mark ?? '',
    });
    saleIdx.push(i);
    after.push(gross - ld);
  });

  const base = after.reduce((s, x) => s + x, 0);
  const orderDiscount = discountOn(base, input.discount);
  const shares = allocate(orderDiscount, after);
  saleIdx.forEach((i, k) => {
    const line = out[i];
    if (line === undefined) return;
    line.order_discount = shares[k] ?? 0;
    line.net -= shares[k] ?? 0;
  });

  const groups = new Map<string, number[]>();
  for (const i of saleIdx) {
    const line = out[i];
    if (line === undefined) continue;
    // Tax once per rate on each receipt: classes with the same rate are one group.
    const key = String(line.rate_bp);
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [i]);
    else g.push(i);
  }
  for (const idx of groups.values()) {
    const rate = out[idx[0] ?? 0]?.rate_bp ?? 0;
    const nets = idx.map((i) => out[i]?.net ?? 0);
    const sum = nets.reduce((s, x) => s + x, 0);
    const tax = rate === 0 ? 0 : inclusive ? roundDiv(sum * rate, 10000 + rate, mode) : roundDiv(sum * rate, 10000, mode);
    const parts = allocate(tax, nets);
    idx.forEach((i, k) => {
      const line = out[i];
      if (line !== undefined) line.tax = parts[k] ?? 0;
    });
  }

  let service = 0;
  let serviceTax = 0;
  let serviceRate = 0;
  const sv = input.service;
  if (sv !== null && sv.bp > 0 && saleIdx.length > 0 && (sv.scope === 'all' || orderType === 'dine_in')) {
    const pre = saleIdx.reduce((s, i) => {
      const line = out[i];
      return line === undefined ? s : s + (inclusive ? line.net - line.tax : line.net);
    }, 0);
    service = roundDiv(pre * sv.bp, 10000, 'half_up');
    if (sv.tax !== null) {
      serviceRate = rateFor(sv.tax, orderType);
      serviceTax = roundDiv(service * serviceRate, 10000, mode);
    }
  }

  let subtotal = 0;
  let discountTotal = 0;
  let itemsNet = 0;
  let lineTax = 0;
  const rows = new Map<string, TaxSummaryRow>();
  const addRow = (taxId: string, name: string, rate: number, mark: string, baseAmt: number, taxAmt: number): void => {
    const key = String(rate);
    let row = rows.get(key);
    if (row === undefined) {
      row = { tax_id: taxId, name, rate_bp: rate, mark, base: 0, tax: 0, gross: 0 };
      rows.set(key, row);
    } else {
      if (name !== '' && !row.name.split(' + ').includes(name)) row.name = row.name === '' ? name : `${row.name} + ${name}`;
      if (row.mark === '' && mark !== '') row.mark = mark;
    }
    row.base += baseAmt;
    row.tax += taxAmt;
    row.gross += baseAmt + taxAmt;
  };
  for (const l of out) {
    subtotal += l.gross;
    discountTotal += l.line_discount + l.order_discount;
    itemsNet += l.net;
    lineTax += l.tax;
    addRow(l.tax_id, l.tax_name, l.rate_bp, l.mark, inclusive ? l.net - l.tax : l.net, l.tax);
  }
  if (service !== 0 && sv !== null) {
    if (sv.tax !== null) addRow(sv.tax.id, sv.tax.name, serviceRate, sv.tax.mark, service, serviceTax);
    else addRow('', 'No tax', 0, '', service, 0);
  }
  const taxes = [...rows.values()].filter((r) => r.base !== 0 || r.tax !== 0).sort((a, b) => b.rate_bp - a.rate_bp);
  const total = inclusive ? itemsNet + service + serviceTax : itemsNet + lineTax + service + serviceTax;
  return {
    lines: out,
    subtotal,
    discount_total: discountTotal,
    order_discount: orderDiscount,
    items_net: itemsNet,
    service_charge: service,
    service_tax: serviceTax,
    tax_total: lineTax + serviceTax,
    taxes,
    total,
  };
}

export function roundTo(value: number, inc: number): number {
  if (inc <= 0) return value;
  const sign = value < 0 ? -1 : 1;
  const a = Math.abs(value);
  return sign * Math.floor((2 * a + inc) / (2 * inc)) * inc;
}

/** What cash settles: the total less non-cash payments, rounded to the smallest coin. */
export function cashDue(total: number, nonCash: number, inc: number): { due: number; rounded: number; rounding: number } {
  const due = total - nonCash;
  const rounded = roundTo(due, inc);
  return { due, rounded, rounding: rounded - due };
}
