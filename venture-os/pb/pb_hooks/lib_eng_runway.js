/**
 * Runway (REPORT Table 33; Visible's computed runway).
 *
 * Runway = verified cash / average monthly net burn of the last three
 * verified months, where:
 * - only verified rows count; the cash is the latest verified cash, at the
 *   end of month M;
 * - the burn window is months M-2, M-1 and M, each covered exactly once by a
 *   verified net burn (a monthly row, or a quarterly row ending at M);
 * - a month of the window without a verified burn makes runway unknown
 *   (reason missing_month), never zero;
 * - average burn zero or negative is `not_burning`;
 * - net burn is positive when the company burns cash.
 * Months come with one decimal; zero_day is M's last day plus
 * months x 365.25 / 12 days.
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

/**
 * input: { rows: [{ period_end: 'YYYY-MM-DD' (month end), months: 1|3, cash_minor|null, net_burn_minor|null, verified: bool }] }
 * -> { state: known|not_burning|unknown, months: number|null, reason, cash_minor, avg_burn_minor,
 *      as_of_day, window: ['YYYY-MM'...], missing: ['YYYY-MM'...], zero_day }
 */
function runway(input) {
  const c = C();
  const x = input || {};
  if (!Array.isArray(x.rows)) throw c.fail(400, 'rows must be a list', 'invalid_param', { field: 'rows' });
  const rows = x.rows.map((r, i) => {
    const w = 'rows[' + i + ']';
    c.dayNum(r.period_end, w + '.period_end');
    if (r.period_end !== c.monthEnd(r.period_end)) throw c.fail(400, w + '.period_end must be the last day of a month', 'invalid_day', { field: w + '.period_end' });
    const months = c.isNil(r.months) ? 1 : r.months;
    if (months !== 1 && months !== 3) throw c.fail(400, w + '.months must be 1 or 3', 'invalid_param', { field: w + '.months' });
    return {
      end: c.monthIndex(r.period_end),
      day: r.period_end,
      months: months,
      cash: c.isNil(r.cash_minor) ? null : c.big(r.cash_minor, w + '.cash_minor'),
      burn: c.isNil(r.net_burn_minor) ? null : c.big(r.net_burn_minor, w + '.net_burn_minor'),
      verified: r.verified === true,
      i: i,
    };
  });
  const unknown = (reason, extra) => Object.assign({ state: 'unknown', months: null, reason: reason, cash_minor: null, avg_burn_minor: null, as_of_day: null, window: [], missing: [], zero_day: null }, extra || {});

  const cashRows = rows.filter((r) => r.verified && r.cash !== null).sort((a, b) => b.end - a.end || a.i - b.i);
  if (cashRows.length === 0) return unknown('no_cash');
  const cash = cashRows[0];
  const M = cash.end;
  const label = (k) => {
    const y = Math.floor(k / 12);
    const m = k - y * 12 + 1;
    return y + '-' + (m < 10 ? '0' + m : String(m));
  };
  const window = [M - 2, M - 1, M];
  const cover = {};
  let dup = false;
  for (const r of rows) {
    if (!r.verified || r.burn === null) continue;
    const first = r.end - r.months + 1;
    if (first < M - 2 || r.end > M) continue;
    for (let k = first; k <= r.end; k++) {
      if (cover[k] !== undefined) dup = true;
      cover[k] = r;
    }
  }
  const base = { cash_minor: c.num(cash.cash), as_of_day: cash.day, window: window.map(label) };
  if (dup) return unknown('overlapping_rows', base);
  const missing = window.filter((k) => cover[k] === undefined).map(label);
  if (missing.length > 0) return unknown('missing_month', Object.assign(base, { missing: missing }));
  const used = [];
  let total = c.B0;
  for (const k of window) {
    if (used.indexOf(cover[k]) >= 0) continue;
    used.push(cover[k]);
    total = total + cover[k].burn;
  }
  const avg = c.divRound(total, BigInt(3));
  const out = { state: 'known', months: null, reason: null, cash_minor: c.num(cash.cash), avg_burn_minor: c.num(avg), as_of_day: cash.day, window: window.map(label), missing: [], zero_day: null };
  if (avg <= c.B0) {
    out.state = 'not_burning';
    out.reason = 'not_burning';
    return out;
  }
  const cashPos = cash.cash > c.B0 ? cash.cash : c.B0;
  out.months = Number(c.divRound(cashPos * BigInt(10), avg)) / 10;
  out.zero_day = c.addDays(cash.day, c.num(c.divRound(cashPos * BigInt(36525), avg * BigInt(1200))));
  return out;
}

module.exports = { runway: runway };
