/**
 * KPI periods, roll-ups, growth and currency (REPORT Table 33; Visible's
 * fiscal year end and currency settings; the flow vs balance gap of Part 1).
 *
 * - Fiscal periods: a company's fiscal year ends in month `fy_end_month`
 *   (1..12; 12 is the calendar year). A fiscal year is named by the calendar
 *   year it ends in; Q1 starts the month after the year end.
 * - Roll-ups by kind: flow (revenue, burn) sums its months; stock (cash,
 *   ARR, headcount, customers) takes the value at the period's end; ratio
 *   (gross margin, NRR) averages its months. A flow or ratio period with a
 *   missing month, or a stock period without its last month, is null
 *   (reason incomplete or missing_end), never a partial number.
 * - Growth: (current - prior) / |prior| in ppm; null when the prior is
 *   missing or zero. CMGR = (last / first)^(1 / months) - 1.
 * - Currency: flows convert at the average of the period's daily rates
 *   (mode avg), stocks at the rate of the period's last day, or the latest
 *   rate up to 7 days before it (mode end); ratios do not convert. Rates are
 *   to-units per one from-unit x 10^8.
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

const KINDS = ['flow', 'stock', 'ratio'];
const END_LOOKBACK_DAYS = 7;

function checkFyEnd(m) {
  if (!Number.isInteger(m) || m < 1 || m > 12) throw C().fail(400, 'fy_end_month must be 1 to 12', 'invalid_param', { field: 'fy_end_month' });
}

function kindOf(kind) {
  if (KINDS.indexOf(kind) < 0) throw C().fail(400, 'kind must be one of ' + KINDS.join(', '), 'invalid_param', { field: 'kind' });
  return kind;
}

/**
 * The fiscal period of a day.
 * -> { fy, q, month (1..12 within the fiscal year), fy_start, fy_end, q_start, q_end }
 */
function fiscalOf(day, fyEndMonth) {
  const c = C();
  checkFyEnd(fyEndMonth);
  const k = c.monthIndex(day);
  const y = Math.floor(k / 12);
  const m = k - y * 12 + 1;
  const offset = (m - fyEndMonth - 1 + 12) % 12;
  const fy = m > fyEndMonth ? y + 1 : y;
  const q = Math.floor(offset / 3) + 1;
  const firstK = k - offset;
  const qFirstK = firstK + (q - 1) * 3;
  const md = (kk, last) => {
    const yy = Math.floor(kk / 12);
    const mm = kk - yy * 12 + 1;
    const t = yy + '-' + (mm < 10 ? '0' + mm : String(mm)) + '-01';
    return last ? c.monthEnd(t) : t;
  };
  return { fy: fy, q: q, month: offset + 1, fy_start: md(firstK, false), fy_end: md(firstK + 11, true), q_start: md(qFirstK, false), q_end: md(qFirstK + 2, true) };
}

function readPoints(points) {
  const c = C();
  if (!Array.isArray(points)) throw c.fail(400, 'points must be a list', 'invalid_param', { field: 'points' });
  return points.map((p, i) => {
    const w = 'points[' + i + ']';
    c.dayNum(p.period_end, w + '.period_end');
    if (p.period_end !== c.monthEnd(p.period_end)) throw c.fail(400, w + '.period_end must be the last day of a month', 'invalid_day', { field: w + '.period_end' });
    const months = c.isNil(p.months) ? 1 : p.months;
    if ([1, 3, 12].indexOf(months) < 0) throw c.fail(400, w + '.months must be 1, 3 or 12', 'invalid_param', { field: w + '.months' });
    return { end: c.monthIndex(p.period_end), day: p.period_end, months: months, value: c.isNil(p.value) ? null : c.big(p.value, w + '.value'), i: i };
  });
}

/**
 * Roll monthly (or quarterly) points up to fiscal quarters or years.
 * input: { points: [{ period_end, months: 1|3|12, value|null }], kind: flow|stock|ratio, fy_end_month, to: quarter|year }
 * -> [{ fy, q|null, start, end, value|null, reason }] for every period touched, oldest first
 */
function rollup(input) {
  const c = C();
  const x = input || {};
  const kind = kindOf(x.kind);
  checkFyEnd(x.fy_end_month);
  if (x.to !== 'quarter' && x.to !== 'year') throw c.fail(400, "to must be 'quarter' or 'year'", 'invalid_param', { field: 'to' });
  const pts = readPoints(x.points);
  const span = x.to === 'quarter' ? 3 : 12;
  const buckets = {};
  const keys = [];
  // Month m (index) -> the point covering it.
  const cover = {};
  const clash = {};
  for (const p of pts) {
    for (let k = p.end - p.months + 1; k <= p.end; k++) {
      if (cover[k] !== undefined) clash[k] = true;
      cover[k] = p;
    }
  }
  const bucketOf = (k) => {
    const y = Math.floor(k / 12);
    const m = k - y * 12 + 1;
    const day = y + '-' + (m < 10 ? '0' + m : String(m)) + '-01';
    const f = fiscalOf(day, x.fy_end_month);
    const startK = c.monthIndex(span === 3 ? f.q_start : f.fy_start);
    return { key: f.fy + ':' + (span === 3 ? f.q : 0), fy: f.fy, q: span === 3 ? f.q : null, startK: startK };
  };
  for (const p of pts) {
    for (let k = p.end - p.months + 1; k <= p.end; k++) {
      const b = bucketOf(k);
      if (buckets[b.key] === undefined) {
        buckets[b.key] = b;
        keys.push(b.key);
      }
    }
  }
  const out = keys.map((key) => {
    const b = buckets[key];
    const months = [];
    for (let k = b.startK; k < b.startK + span; k++) months.push(k);
    const lastDay = (() => {
      const k = b.startK + span - 1;
      const y = Math.floor(k / 12);
      const m = k - y * 12 + 1;
      return c.monthEnd(y + '-' + (m < 10 ? '0' + m : String(m)) + '-01');
    })();
    const firstDay = (() => {
      const y = Math.floor(b.startK / 12);
      const m = b.startK - y * 12 + 1;
      return y + '-' + (m < 10 ? '0' + m : String(m)) + '-01';
    })();
    const row = { fy: b.fy, q: b.q, start: firstDay, end: lastDay, value: null, reason: null };
    if (months.some((k) => clash[k])) {
      row.reason = 'overlapping_points';
      return row;
    }
    if (kind === 'stock') {
      const p = cover[b.startK + span - 1];
      if (p === undefined || p.end !== b.startK + span - 1 || p.value === null) {
        row.reason = 'missing_end';
        return row;
      }
      row.value = c.num(p.value);
      return row;
    }
    const used = [];
    for (const k of months) {
      const p = cover[k];
      if (p === undefined || p.value === null) {
        row.reason = 'incomplete';
        return row;
      }
      const first = p.end - p.months + 1;
      if (first < b.startK || p.end > b.startK + span - 1) {
        row.reason = 'misaligned';
        return row;
      }
      if (used.indexOf(p) < 0) used.push(p);
    }
    // Flows sum; ratios average by months covered.
    let total = c.B0;
    let weighted = c.B0;
    let n = 0;
    for (const p of used) {
      total = total + p.value;
      weighted = weighted + p.value * BigInt(p.months);
      n += p.months;
    }
    row.value = kind === 'flow' ? c.num(total) : c.num(c.divRound(weighted, BigInt(n)));
    return row;
  });
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}

/** Growth from prior to current in ppm; null with a reason when it cannot be measured. -> { growth_ppm, reason } */
function growth(current, prior) {
  const c = C();
  if (c.isNil(current) || c.isNil(prior)) return { growth_ppm: null, reason: 'missing' };
  const cur = c.big(current, 'current');
  const pri = c.big(prior, 'prior');
  if (pri === c.B0) return { growth_ppm: null, reason: 'no_base' };
  return { growth_ppm: c.num(c.divRound((cur - pri) * c.BE6, c.babs(pri)), 'growth_ppm'), reason: null };
}

/**
 * Growth over a series: each point against the point `lag` periods earlier
 * (lag 1 period over period, 12 year over year for months, 4 for quarters).
 * points: [{ period_end, value|null }] equally spaced, oldest first.
 * -> [{ period_end, growth_ppm|null, reason }]
 */
function growthSeries(points, lag) {
  const c = C();
  if (!Array.isArray(points)) throw c.fail(400, 'points must be a list', 'invalid_param', {});
  if (!Number.isInteger(lag) || lag < 1) throw c.fail(400, 'lag must be a whole number of periods, 1 or more', 'invalid_param', { field: 'lag' });
  return points.map((p, i) => {
    if (i < lag) return { period_end: p.period_end, growth_ppm: null, reason: 'missing' };
    const g = growth(p.value, points[i - lag].value);
    return { period_end: p.period_end, growth_ppm: g.growth_ppm, reason: g.reason };
  });
}

/** Compound monthly growth from `first` to `last` over `months`. -> { cmgr_ppm, reason } */
function cmgr(first, last, months) {
  const c = C();
  if (c.isNil(first) || c.isNil(last)) return { cmgr_ppm: null, reason: 'missing' };
  if (!Number.isInteger(months) || months < 1) throw c.fail(400, 'months must be 1 or more', 'invalid_param', { field: 'months' });
  const f = Number(c.big(first, 'first'));
  const l = Number(c.big(last, 'last'));
  if (f <= 0 || l < 0) return { cmgr_ppm: null, reason: 'no_base' };
  return { cmgr_ppm: Math.round((Math.pow(l / f, 1 / months) - 1) * c.E6), reason: null };
}

/** avg for flows, end for stocks, null (no conversion) for ratios. */
function modeFor(kind) {
  const k = kindOf(kind);
  return k === 'flow' ? 'avg' : k === 'stock' ? 'end' : null;
}

function readRates(rates) {
  const c = C();
  if (!Array.isArray(rates)) throw c.fail(400, 'rates must be a list of { day, rate_e8 }', 'invalid_param', { field: 'rates' });
  const out = rates.map((r, i) => {
    const n = c.dayNum(r.day, 'rates[' + i + '].day');
    const v = c.bigPos(r.rate_e8, 'rates[' + i + '].rate_e8');
    if (v === c.B0) throw c.fail(400, 'rates[' + i + '].rate_e8 must be positive', 'invalid_number', {});
    return { n: n, day: r.day, v: v };
  });
  out.sort((a, b) => a.n - b.n);
  return out;
}

/**
 * The rate for a period.
 * input: { rates: [{ day, rate_e8 }], mode: avg|end, start_day, end_day }
 * -> { rate_e8|null, reason, days (rates used) }
 */
function rateFor(input) {
  const c = C();
  const x = input || {};
  const rates = readRates(x.rates);
  const a = c.dayNum(x.start_day, 'start_day');
  const b = c.dayNum(x.end_day, 'end_day');
  if (b < a) throw c.fail(400, 'end_day is before start_day', 'invalid_day', {});
  if (x.mode === 'end') {
    let pick = null;
    for (const r of rates) if (r.n <= b && r.n >= b - END_LOOKBACK_DAYS) pick = r;
    return pick === null ? { rate_e8: null, reason: 'no_rate', days: 0 } : { rate_e8: c.num(pick.v), reason: null, days: 1 };
  }
  if (x.mode === 'avg') {
    let total = c.B0;
    let n = 0;
    for (const r of rates) {
      if (r.n >= a && r.n <= b) {
        total = total + r.v;
        n++;
      }
    }
    return n === 0 ? { rate_e8: null, reason: 'no_rate', days: 0 } : { rate_e8: c.num(c.divRound(total, BigInt(n))), reason: null, days: n };
  }
  throw c.fail(400, "mode must be 'avg' or 'end'", 'invalid_param', { field: 'mode' });
}

/**
 * Convert a KPI series from one currency to another by its kind.
 * input: { points: [{ period_end, months: 1|3|12, value|null }], kind, from, to, rates: [{ day, rate_e8 }] }
 * -> [{ period_end, value|null, rate_e8|null, mode, reason }]
 */
function convertSeries(input) {
  const c = C();
  const x = input || {};
  const mode = modeFor(x.kind);
  const pts = readPoints(x.points);
  const from = String(x.from || '').toUpperCase();
  const to = String(x.to || '').toUpperCase();
  c.exponent(from);
  c.exponent(to);
  return pts.map((p) => {
    const row = { period_end: p.day, value: null, rate_e8: null, mode: mode, reason: null };
    if (p.value === null) {
      row.reason = 'missing';
      return row;
    }
    if (mode === null || from === to) {
      row.value = c.num(p.value);
      row.rate_e8 = mode === null ? null : c.E8;
      return row;
    }
    const startDay = c.monthStart(c.monthEndAfter(p.day, -(p.months - 1)));
    const r = rateFor({ rates: x.rates, mode: mode, start_day: startDay, end_day: p.day });
    if (r.rate_e8 === null) {
      row.reason = r.reason;
      return row;
    }
    row.rate_e8 = r.rate_e8;
    row.value = c.convertMinor(p.value, from, to, r.rate_e8);
    return row;
  });
}

module.exports = {
  KINDS: KINDS,
  fiscalOf: fiscalOf,
  rollup: rollup,
  growth: growth,
  growthSeries: growthSeries,
  cmgr: cmgr,
  modeFor: modeFor,
  rateFor: rateFor,
  convertSeries: convertSeries,
};
