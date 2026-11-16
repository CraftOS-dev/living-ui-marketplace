/**
 * Fund metrics (REPORT Table 33; AngelList on TVPI; XIRR as a spreadsheet
 * computes it; Newton then bisection as in Advance Life OS lib_portfolio.js).
 *
 *   DPI  = distributions / paid-in         (e8)
 *   RVPI = NAV / paid-in                   (e8)
 *   TVPI = DPI + RVPI                      (e8, an identity by construction)
 *   Net IRR = XIRR of LP flows (calls negative, distributions positive) with
 *     the ending NAV as a final inflow on the as-of day.
 *   Gross MOIC = (proceeds + holdings value) / invested, from fund-to-company
 *     flows; gross IRR = XIRR of those flows with the value as a final inflow.
 * XIRR: sum of amount / (1 + r)^((day - first day) / 365) = 0, solved by
 * Newton from 10% with a bisection fallback; null (reason no_sign_change)
 * without both a negative and a positive flow.
 * Unknown NAV or no paid-in capital gives null with a reason, never 0.
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

/**
 * Multiples on paid-in capital.
 * input: { paid_in_minor, distributed_minor, nav_minor|null }
 * -> { dpi_e8, rvpi_e8, tvpi_e8, reasons: { dpi, rvpi, tvpi } }
 */
function multiples(input) {
  const c = C();
  const x = input || {};
  const paid = c.bigPos(x.paid_in_minor, 'paid_in_minor');
  const dist = c.bigPos(x.distributed_minor, 'distributed_minor');
  const nav = c.isNil(x.nav_minor) ? null : c.big(x.nav_minor, 'nav_minor');
  if (paid === c.B0) return { dpi_e8: null, rvpi_e8: null, tvpi_e8: null, reasons: { dpi: 'no_paid_in', rvpi: 'no_paid_in', tvpi: 'no_paid_in' } };
  const dpi = c.num(c.divRound(dist * c.BE8, paid), 'dpi_e8');
  if (nav === null) return { dpi_e8: dpi, rvpi_e8: null, tvpi_e8: null, reasons: { dpi: null, rvpi: 'no_nav', tvpi: 'no_nav' } };
  const rvpi = c.num(c.divRound(nav * c.BE8, paid), 'rvpi_e8');
  return { dpi_e8: dpi, rvpi_e8: rvpi, tvpi_e8: dpi + rvpi, reasons: { dpi: null, rvpi: null, tvpi: null } };
}

function readFlows(flows, where) {
  const c = C();
  if (!Array.isArray(flows)) throw c.fail(400, where + ' must be a list of { day, amount_minor }', 'invalid_param', { field: where });
  return flows.map((f, i) => ({ n: c.dayNum(f.day, where + '[' + i + '].day'), v: Number(c.big(f.amount_minor, where + '[' + i + '].amount_minor')) }));
}

/**
 * XIRR of dated flows.
 * flows: [{ day, amount_minor (signed) }]
 * -> { rate: number|null, irr_ppm: integer|null, reason }
 */
function xirr(flows) {
  const c = C();
  const fl = readFlows(flows, 'flows').filter((f) => f.v !== 0);
  fl.sort((a, b) => a.n - b.n);
  let pos = false;
  let neg = false;
  let scale = 0;
  for (const f of fl) {
    if (f.v > 0) pos = true;
    if (f.v < 0) neg = true;
    scale += Math.abs(f.v);
  }
  if (!pos || !neg) return { rate: null, irr_ppm: null, reason: 'no_sign_change' };
  const t0 = fl[0].n;
  const npv = (r) => {
    let s = 0;
    for (const f of fl) s += f.v / Math.pow(1 + r, (f.n - t0) / 365);
    return s;
  };
  const dnpv = (r) => {
    let s = 0;
    for (const f of fl) {
      const t = (f.n - t0) / 365;
      s -= (t * f.v) / Math.pow(1 + r, t + 1);
    }
    return s;
  };
  const tol = 1e-9 * Math.max(1, scale);
  const done = (r) => ({ rate: r, irr_ppm: Math.round(r * c.E6), reason: null });
  let r = 0.1;
  for (let it = 0; it < 100; it++) {
    const y = npv(r);
    const d = dnpv(r);
    if (!isFinite(y) || !isFinite(d) || Math.abs(d) < 1e-12) break;
    const nr = r - y / d;
    if (!isFinite(nr) || nr <= -0.999999) break;
    if (Math.abs(nr - r) < 1e-12) {
      if (Math.abs(npv(nr)) < tol) return done(nr);
      break;
    }
    r = nr;
  }
  let lo = -0.999999;
  let hi = 1;
  let flo = npv(lo);
  let fhi = npv(hi);
  let guard = 0;
  while (isFinite(flo) && isFinite(fhi) && flo * fhi > 0 && guard < 60) {
    hi = hi * 2 + 1;
    fhi = npv(hi);
    guard++;
  }
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return { rate: null, irr_ppm: null, reason: 'no_solution' };
  for (let it = 0; it < 400; it++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (!isFinite(fm)) return { rate: null, irr_ppm: null, reason: 'no_solution' };
    if (Math.abs(fm) < tol || hi - lo < 1e-14) return done(mid);
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return done((lo + hi) / 2);
}

/**
 * Net IRR of LP flows with the NAV as a final inflow.
 * input: { lp_flows: [{ day, amount_minor (calls negative, distributions positive) }], nav_minor|null, as_of_day }
 * -> { irr_ppm|null, rate|null, reason }
 */
function netIrr(input) {
  const c = C();
  const x = input || {};
  if (c.isNil(x.nav_minor)) return { irr_ppm: null, rate: null, reason: 'no_nav' };
  c.dayNum(x.as_of_day, 'as_of_day');
  const flows = (Array.isArray(x.lp_flows) ? x.lp_flows : []).slice();
  readFlows(flows, 'lp_flows').forEach((f, i) => {
    if (f.n > c.dayNum(x.as_of_day)) throw c.fail(400, 'lp_flows[' + i + '] is after as_of_day', 'invalid_day', { field: 'lp_flows' });
  });
  flows.push({ day: x.as_of_day, amount_minor: x.nav_minor });
  const r = xirr(flows);
  return { irr_ppm: r.irr_ppm, rate: r.rate, reason: r.reason };
}

/**
 * Gross MOIC and IRR from fund-to-company flows.
 * input: { company_flows: [{ day, amount_minor (investments negative, proceeds positive) }], value_minor|null, as_of_day }
 * -> { invested_minor, proceeds_minor, value_minor, moic_e8|null, irr_ppm|null, rate|null, reasons: { moic, irr } }
 */
function gross(input) {
  const c = C();
  const x = input || {};
  const fl = readFlows(Array.isArray(x.company_flows) ? x.company_flows : [], 'company_flows');
  let invested = c.B0;
  let proceeds = c.B0;
  (x.company_flows || []).forEach((f, i) => {
    const v = c.big(f.amount_minor, 'company_flows[' + i + '].amount_minor');
    if (v < c.B0) invested = invested - v;
    else proceeds = proceeds + v;
  });
  const out = { invested_minor: c.num(invested), proceeds_minor: c.num(proceeds), value_minor: null, moic_e8: null, irr_ppm: null, rate: null, reasons: { moic: null, irr: null } };
  if (c.isNil(x.value_minor)) {
    out.reasons.moic = 'no_value';
    out.reasons.irr = 'no_value';
    return out;
  }
  const value = c.bigPos(x.value_minor, 'value_minor');
  out.value_minor = c.num(value);
  if (invested === c.B0) {
    out.reasons.moic = 'no_investment';
    out.reasons.irr = 'no_investment';
    return out;
  }
  out.moic_e8 = c.num(c.divRound((proceeds + value) * c.BE8, invested), 'moic_e8');
  const asOf = c.dayNum(x.as_of_day, 'as_of_day');
  fl.forEach((f, i) => {
    if (f.n > asOf) throw c.fail(400, 'company_flows[' + i + '] is after as_of_day', 'invalid_day', { field: 'company_flows' });
  });
  const flows = (x.company_flows || []).slice();
  flows.push({ day: x.as_of_day, amount_minor: c.num(value) });
  const r = xirr(flows);
  out.irr_ppm = r.irr_ppm;
  out.rate = r.rate;
  out.reasons.irr = r.reason;
  return out;
}

/**
 * Everything lib_funds.metrics returns (SPEC 4.6).
 * input: { currency, as_of_day, lp_flows: [{ day, amount_minor }], nav_minor|null,
 *          company_flows: [{ day, amount_minor }], holdings_value_minor|null }
 * paid-in = minus the sum of negative LP flows; distributed = the sum of positive ones.
 * -> { paid_in_minor, distributed_minor, nav_minor, dpi_e8, rvpi_e8, tvpi_e8, net_irr_ppm,
 *      gross_moic_e8, gross_irr_ppm, currency, reasons }
 */
function fund(input) {
  const c = C();
  const x = input || {};
  c.exponent(x.currency);
  const lp = Array.isArray(x.lp_flows) ? x.lp_flows : [];
  let paid = c.B0;
  let dist = c.B0;
  lp.forEach((f, i) => {
    const v = c.big(f.amount_minor, 'lp_flows[' + i + '].amount_minor');
    if (v < c.B0) paid = paid - v;
    else dist = dist + v;
  });
  const m = multiples({ paid_in_minor: c.num(paid), distributed_minor: c.num(dist), nav_minor: x.nav_minor });
  const net = netIrr({ lp_flows: lp, nav_minor: x.nav_minor, as_of_day: x.as_of_day });
  const g = gross({ company_flows: Array.isArray(x.company_flows) ? x.company_flows : [], value_minor: x.holdings_value_minor, as_of_day: x.as_of_day });
  return {
    currency: String(x.currency).toUpperCase(),
    as_of_day: x.as_of_day,
    paid_in_minor: c.num(paid),
    distributed_minor: c.num(dist),
    nav_minor: c.isNil(x.nav_minor) ? null : c.num(c.big(x.nav_minor, 'nav_minor')),
    dpi_e8: m.dpi_e8,
    rvpi_e8: m.rvpi_e8,
    tvpi_e8: m.tvpi_e8,
    net_irr_ppm: net.irr_ppm,
    gross_moic_e8: g.moic_e8,
    gross_irr_ppm: g.irr_ppm,
    reasons: { dpi: m.reasons.dpi, rvpi: m.reasons.rvpi, tvpi: m.reasons.tvpi, net_irr: net.reason, gross_moic: g.reasons.moic, gross_irr: g.reasons.irr },
  };
}

module.exports = { multiples: multiples, xirr: xirr, netIrr: netIrr, gross: gross, fund: fund };
