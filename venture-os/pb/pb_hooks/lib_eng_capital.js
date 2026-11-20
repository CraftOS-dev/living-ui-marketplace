/**
 * Capital accounts, allocation and management fees (REPORT Table 33; the
 * ILPA 2025 sample cover letter; AngelList on management fees).
 *
 * Capital account per LP, separate running totals (ILPA sample):
 *   contributed  every call and recall
 *   recalled     calls made against recallable capital
 *   unfunded     commitment - (contributed - recalled)
 *   distributed  every distribution
 *   recallable   recallable distributions - recalled
 *   callable     unfunded + recallable
 * Vector: commitment 50,000,000; after a 1,750,000 call 40% is contributed
 * and 30,000,000 is unfunded; 10,000,000 distributed, 5,000,000 recallable.
 *
 * Allocation: pro rata of commitments with largest-remainder rounding, so
 * the lines always sum to the total to the minor unit.
 *
 * Management fee: rate x basis (committed or invested) per period. A period
 * is measured in months: a full month is 1/12 of a year, a part month is its
 * days over the month's days; the fee is rounded once per LP and period.
 * Step-downs are schedule rows from a day on; waivers are a ppm of the fee.
 * Fee lines go only to fee-paying LPs, each at its own schedule.
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

const EVENT_TYPES = ['opening', 'call', 'recall', 'distribution'];
const BASES = ['committed', 'invested'];
// Least common multiple of 28, 29, 30 and 31: every month's day count divides it.
const MONTH_LCM = 377580;

/**
 * A capital account.
 * input: { commitment_minor, events: [{ day, type: opening|call|recall|distribution, amount_minor,
 *          recallable_minor (distribution), contributed_minor, distributed_minor, recallable_minor, recalled_minor (opening) }] }
 * -> { commitment_minor, contributed_minor, contributed_ppm, recalled_minor, unfunded_minor, distributed_minor,
 *      recallable_minor, callable_minor, warnings: [code], rows: [{ day, type, amount_minor, ...totals }] }
 */
function account(input) {
  const c = C();
  const x = input || {};
  const commitment = c.bigPos(x.commitment_minor, 'commitment_minor');
  if (!Array.isArray(x.events)) throw c.fail(400, 'events must be a list', 'invalid_param', { field: 'events' });
  const events = x.events.map((ev, i) => {
    const w = 'events[' + i + ']';
    if (EVENT_TYPES.indexOf(ev.type) < 0) throw c.fail(400, w + '.type must be one of ' + EVENT_TYPES.join(', '), 'invalid_param', { field: w + '.type' });
    return { n: c.dayNum(ev.day, w + '.day'), ev: ev, i: i, w: w };
  });
  events.sort((a, b) => a.n - b.n || a.i - b.i);
  let contributed = c.B0;
  let recalled = c.B0;
  let distributed = c.B0;
  let recallable = c.B0;
  const warnings = [];
  const warn = (code) => {
    if (warnings.indexOf(code) < 0) warnings.push(code);
  };
  const totals = () => ({
    contributed_minor: c.num(contributed),
    recalled_minor: c.num(recalled),
    unfunded_minor: c.num(commitment - (contributed - recalled)),
    distributed_minor: c.num(distributed),
    recallable_minor: c.num(recallable),
    callable_minor: c.num(commitment - (contributed - recalled) + recallable),
  });
  const rows = events.map((e, k) => {
    const ev = e.ev;
    let amount = c.B0;
    if (ev.type === 'opening') {
      if (k !== 0) throw c.fail(400, e.w + ': an opening balance comes before every other event', 'invalid_param', { field: e.w + '.type' });
      contributed = c.isNil(ev.contributed_minor) ? c.B0 : c.bigPos(ev.contributed_minor, e.w + '.contributed_minor');
      distributed = c.isNil(ev.distributed_minor) ? c.B0 : c.bigPos(ev.distributed_minor, e.w + '.distributed_minor');
      recallable = c.isNil(ev.recallable_minor) ? c.B0 : c.bigPos(ev.recallable_minor, e.w + '.recallable_minor');
      recalled = c.isNil(ev.recalled_minor) ? c.B0 : c.bigPos(ev.recalled_minor, e.w + '.recalled_minor');
      if (recallable > distributed) throw c.fail(400, e.w + ': recallable cannot exceed distributed', 'invalid_number', { field: e.w + '.recallable_minor' });
      if (recalled > contributed) throw c.fail(400, e.w + ': recalled cannot exceed contributed', 'invalid_number', { field: e.w + '.recalled_minor' });
    } else {
      amount = c.bigPos(ev.amount_minor, e.w + '.amount_minor');
      if (ev.type === 'call') contributed = contributed + amount;
      else if (ev.type === 'recall') {
        if (amount > recallable) warn('over_recall');
        contributed = contributed + amount;
        recalled = recalled + amount;
        recallable = recallable - amount;
      } else {
        const r = c.isNil(ev.recallable_minor) ? c.B0 : c.bigPos(ev.recallable_minor, e.w + '.recallable_minor');
        if (r > amount) throw c.fail(400, e.w + ': recallable_minor cannot exceed amount_minor', 'invalid_number', { field: e.w + '.recallable_minor' });
        distributed = distributed + amount;
        recallable = recallable + r;
      }
    }
    if (commitment - (contributed - recalled) < c.B0) warn('over_commitment');
    return Object.assign({ day: c.dayText(e.n), type: ev.type, amount_minor: c.num(amount) }, totals());
  });
  const t = totals();
  return Object.assign(
    {
      commitment_minor: c.num(commitment),
      contributed_ppm: commitment === c.B0 ? null : c.num(c.divRound(contributed * c.BE6, commitment)),
      warnings: warnings,
      rows: rows,
    },
    t
  );
}

/**
 * Pro rata of commitments, exact.
 * input: { total_minor, lps: [{ lp, commitment_minor }] } -> [{ lp, amount_minor }] summing to total_minor
 */
function allocate(input) {
  const c = C();
  const x = input || {};
  if (!Array.isArray(x.lps) || x.lps.length === 0) throw c.fail(400, 'lps must be a non-empty list', 'invalid_param', { field: 'lps' });
  const total = c.big(x.total_minor, 'total_minor');
  const w = x.lps.map((l, i) => c.bigPos(l.commitment_minor, 'lps[' + i + '].commitment_minor'));
  const parts = c.largestRemainder(total, w);
  return x.lps.map((l, i) => ({ lp: l.lp, amount_minor: c.num(parts[i]) }));
}

function readSchedule(schedule, where) {
  const c = C();
  if (!Array.isArray(schedule) || schedule.length === 0) throw c.fail(400, where + ' must be a non-empty list of { from_day, rate_ppm, basis }', 'invalid_param', { field: where });
  const rows = schedule.map((s, i) => {
    const w = where + '[' + i + ']';
    c.ppmCheck(s.rate_ppm, w + '.rate_ppm');
    if (BASES.indexOf(s.basis) < 0) throw c.fail(400, w + ".basis must be 'committed' or 'invested'", 'invalid_param', { field: w + '.basis' });
    return { n: c.dayNum(s.from_day, w + '.from_day'), day: s.from_day, rate: s.rate_ppm, basis: s.basis };
  });
  rows.sort((a, b) => a.n - b.n);
  for (let i = 1; i < rows.length; i++) if (rows[i].n === rows[i - 1].n) throw c.fail(400, where + ': two steps start on ' + rows[i].day, 'invalid_param', { field: where });
  return rows;
}

/**
 * Management fee for one LP and period.
 * input: { from_day, to_day (inclusive), schedule: [{ from_day, rate_ppm (per year), basis: committed|invested }],
 *          committed_minor, invested_minor (needed when an invested step applies), waiver_ppm (0) }
 * -> { gross_minor, waiver_minor, fee_minor, months_e6, segments: [{ from_day, to_day, days, month_days, rate_ppm, basis, basis_minor }] }
 */
function fee(input) {
  const c = C();
  const x = input || {};
  const a = c.dayNum(x.from_day, 'from_day');
  const b = c.dayNum(x.to_day, 'to_day');
  if (b < a) throw c.fail(400, 'to_day is before from_day', 'invalid_day', { field: 'to_day' });
  const steps = readSchedule(x.schedule, 'schedule');
  const committed = c.isNil(x.committed_minor) ? null : c.bigPos(x.committed_minor, 'committed_minor');
  const invested = c.isNil(x.invested_minor) ? null : c.bigPos(x.invested_minor, 'invested_minor');
  const waiver = c.isNil(x.waiver_ppm) ? 0 : c.ppmCheck(x.waiver_ppm, 'waiver_ppm');
  // Break points: month starts and step starts inside the period.
  const cuts = [a];
  for (let d = c.dayNum(c.monthStart(c.dayText(a))); d <= b; d = c.dayNum(c.addDays(c.monthEnd(c.dayText(d)), 1))) if (d > a) cuts.push(d);
  for (const s of steps) if (s.n > a && s.n <= b && cuts.indexOf(s.n) < 0) cuts.push(s.n);
  cuts.sort((p, q) => p - q);
  cuts.push(b + 1);
  let numer = c.B0;
  let monthsNumer = c.B0;
  const denom = c.BE6 * BigInt(12) * BigInt(MONTH_LCM);
  const segments = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const s = cuts[k];
    const e = cuts[k + 1] - 1;
    const day = c.dayText(s);
    const p = { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) };
    const dim = c.daysInMonth(p.y, p.m);
    const days = e - s + 1;
    let step = null;
    for (const st of steps) if (st.n <= s) step = st;
    const seg = { from_day: day, to_day: c.dayText(e), days: days, month_days: dim, rate_ppm: step === null ? 0 : step.rate, basis: step === null ? null : step.basis, basis_minor: null };
    monthsNumer = monthsNumer + BigInt(days) * BigInt(MONTH_LCM / dim);
    if (step !== null) {
      const basis = step.basis === 'committed' ? committed : invested;
      if (basis === null) throw c.fail(400, step.basis + '_minor is required for the fee step from ' + step.day, 'missing_basis', { field: step.basis + '_minor' });
      seg.basis_minor = c.num(basis);
      numer = numer + basis * BigInt(step.rate) * BigInt(days) * BigInt(MONTH_LCM / dim);
    }
    segments.push(seg);
  }
  const gross = c.divRound(numer, denom);
  const waived = c.divRound(gross * BigInt(waiver), c.BE6);
  return {
    gross_minor: c.num(gross),
    waiver_minor: c.num(waived),
    fee_minor: c.num(gross - waived),
    months_e6: c.num(c.divRound(monthsNumer * c.BE6, BigInt(MONTH_LCM))),
    segments: segments,
  };
}

/**
 * The lines of a capital call.
 * input: {
 *   investment_minor (0), expenses_minor (0),                 // pro rata of commitments over every LP
 *   fees: { from_day, to_day, schedule, fund_invested_minor? } | null,
 *   lps: [{ lp, commitment_minor, fee_paying: bool, schedule? (the LP's own rates), waiver_ppm? }]
 * }
 * -> { lines: [{ lp, investment_minor, expenses_minor, fee_minor, fee_gross_minor, fee_waiver_minor, total_minor }],
 *      totals: { investment_minor, expenses_minor, fee_minor, total_minor } }
 */
function callLines(input) {
  const c = C();
  const x = input || {};
  if (!Array.isArray(x.lps) || x.lps.length === 0) throw c.fail(400, 'lps must be a non-empty list', 'invalid_param', { field: 'lps' });
  const weights = x.lps.map((l, i) => c.bigPos(l.commitment_minor, 'lps[' + i + '].commitment_minor'));
  const inv = c.largestRemainder(c.isNil(x.investment_minor) ? c.B0 : c.bigPos(x.investment_minor, 'investment_minor'), weights);
  const exp = c.largestRemainder(c.isNil(x.expenses_minor) ? c.B0 : c.bigPos(x.expenses_minor, 'expenses_minor'), weights);
  const f = c.isNil(x.fees) ? null : x.fees;
  let investedShares = null;
  if (f !== null && !c.isNil(f.fund_invested_minor)) investedShares = c.largestRemainder(c.bigPos(f.fund_invested_minor, 'fees.fund_invested_minor'), weights);
  const totals = { investment_minor: 0, expenses_minor: 0, fee_minor: 0, total_minor: 0 };
  const lines = x.lps.map((l, i) => {
    let feeRes = { gross_minor: 0, waiver_minor: 0, fee_minor: 0 };
    if (f !== null && l.fee_paying === true) {
      feeRes = fee({
        from_day: f.from_day,
        to_day: f.to_day,
        schedule: c.isNil(l.schedule) ? f.schedule : l.schedule,
        committed_minor: c.num(weights[i]),
        invested_minor: investedShares === null ? null : c.num(investedShares[i]),
        waiver_ppm: c.isNil(l.waiver_ppm) ? 0 : l.waiver_ppm,
      });
    }
    const line = {
      lp: l.lp,
      investment_minor: c.num(inv[i]),
      expenses_minor: c.num(exp[i]),
      fee_minor: feeRes.fee_minor,
      fee_gross_minor: feeRes.gross_minor,
      fee_waiver_minor: feeRes.waiver_minor,
      total_minor: c.num(inv[i] + exp[i] + BigInt(feeRes.fee_minor)),
    };
    totals.investment_minor += line.investment_minor;
    totals.expenses_minor += line.expenses_minor;
    totals.fee_minor += line.fee_minor;
    totals.total_minor += line.total_minor;
    return line;
  });
  return { lines: lines, totals: totals };
}

module.exports = {
  EVENT_TYPES: EVENT_TYPES,
  account: account,
  allocate: allocate,
  fee: fee,
  callLines: callLines,
};
