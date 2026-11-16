/**
 * Distribution waterfalls (REPORT Table 33; AngelList on carried interest;
 * iCapital's four-step European waterfall). Every output is an estimate
 * (`estimate: true`) until the fund administrator confirms it.
 *
 * Each distribution, in day order, runs through four tiers:
 *   1. return of capital: 100% to LPs until contributions are back;
 *   2. preferred return (only with a hurdle): 100% to LPs until the accrued
 *      pref is paid; pref accrues on unreturned capital (and on unpaid pref
 *      when compounding) at hurdle_ppm a year over actual days / 365;
 *   3. catch-up (only with catchup_ppm): the GP takes catchup_ppm of each
 *      unit until it holds carry_ppm of all profit paid so far, i.e. the
 *      tier's volume reaches carry x pref paid / (catchup - carry);
 *   4. split: carry_ppm to the GP, the rest to LPs.
 * Without a hurdle, tiers 2 and 3 are empty: carry is carry_ppm of profit
 * ($5K returning $100K pays $19K at 20%).
 *
 * European: one machine over the whole fund's flows.
 * American: one machine per deal; the sum of deal carry is compared with the
 * whole-fund carry over the same flows and any excess is the clawback.
 *
 * Exact BigInt per tier; the GP part of a tier is rounded half away and the
 * LP part is the rest, so the tiers always sum to the distribution.
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

const COMPOUNDING = ['compound', 'simple'];

function readTerms(t) {
  const c = C();
  const x = t || {};
  c.ppmCheck(x.carry_ppm, 'carry_ppm');
  const hurdle = c.isNil(x.hurdle_ppm) ? null : c.ppmCheck(x.hurdle_ppm, 'hurdle_ppm');
  const catchup = c.isNil(x.catchup_ppm) ? null : c.ppmCheck(x.catchup_ppm, 'catchup_ppm');
  if (catchup !== null && catchup <= x.carry_ppm) throw c.fail(400, 'catchup_ppm must be above carry_ppm, or null for no catch-up', 'invalid_ppm', { field: 'catchup_ppm' });
  const comp = c.isNil(x.compounding) ? 'compound' : x.compounding;
  if (COMPOUNDING.indexOf(comp) < 0) throw c.fail(400, "compounding must be 'compound' or 'simple'", 'invalid_param', { field: 'compounding' });
  return { carry: x.carry_ppm, hurdle: hurdle === 0 ? null : hurdle, catchup: catchup, compounding: comp };
}

function readEvents(events, where) {
  const c = C();
  if (!Array.isArray(events)) throw c.fail(400, where + ' must be a list', 'invalid_param', { field: where });
  const out = events.map((e, i) => {
    const w = where + '[' + i + ']';
    if (e.type !== 'contribution' && e.type !== 'distribution') throw c.fail(400, w + ".type must be 'contribution' or 'distribution'", 'invalid_param', { field: w + '.type' });
    return { n: c.dayNum(e.day, w + '.day'), type: e.type, amount: c.bigPos(e.amount_minor, w + '.amount_minor'), i: i };
  });
  // Same day: contributions first.
  out.sort((a, b) => a.n - b.n || (a.type === b.type ? a.i - b.i : a.type === 'contribution' ? -1 : 1));
  return out;
}

/** The tier machine over sorted events. */
function machine(events, T, asOfDay) {
  const c = C();
  const E6 = c.BE6;
  let unreturned = c.B0;
  let prefOwed = c.B0;
  let prefPaid = c.B0;
  let cuVolume = c.B0;
  let last = null;
  const tiers = { roc: c.B0, pref: c.B0, catchup_gp: c.B0, catchup_lp: c.B0, split_gp: c.B0, split_lp: c.B0 };
  let contributed = c.B0;
  let distributed = c.B0;
  const rows = [];
  const accrue = (n) => {
    if (T.hurdle === null || last === null || n <= last) return;
    const days = n - last;
    if (T.compounding === 'simple') {
      prefOwed = prefOwed + c.divRound(unreturned * BigInt(T.hurdle) * BigInt(days), E6 * BigInt(365));
    } else {
      const base = unreturned + prefOwed;
      const factor = Math.pow(1 + T.hurdle / c.E6, days / 365) - 1;
      prefOwed = prefOwed + BigInt(Math.round(Number(base) * factor));
    }
  };
  for (const ev of events) {
    accrue(ev.n);
    last = ev.n;
    if (ev.type === 'contribution') {
      unreturned = unreturned + ev.amount;
      contributed = contributed + ev.amount;
      continue;
    }
    distributed = distributed + ev.amount;
    let left = ev.amount;
    const take = (cap) => {
      const t = left < cap ? left : cap;
      left = left - t;
      return t;
    };
    const roc = take(unreturned);
    unreturned = unreturned - roc;
    const pref = take(prefOwed);
    prefOwed = prefOwed - pref;
    prefPaid = prefPaid + pref;
    let cuGp = c.B0;
    let cuLp = c.B0;
    if (T.catchup !== null && T.hurdle !== null) {
      const span = BigInt(T.catchup - T.carry);
      const target = c.divRound(BigInt(T.carry) * prefPaid, span);
      const room = target > cuVolume ? target - cuVolume : c.B0;
      const t3 = take(room);
      cuVolume = cuVolume + t3;
      cuGp = c.divRound(t3 * BigInt(T.catchup), E6);
      cuLp = t3 - cuGp;
    }
    const splitGp = c.divRound(left * BigInt(T.carry), E6);
    const splitLp = left - splitGp;
    left = c.B0;
    tiers.roc = tiers.roc + roc;
    tiers.pref = tiers.pref + pref;
    tiers.catchup_gp = tiers.catchup_gp + cuGp;
    tiers.catchup_lp = tiers.catchup_lp + cuLp;
    tiers.split_gp = tiers.split_gp + splitGp;
    tiers.split_lp = tiers.split_lp + splitLp;
    rows.push({
      day: c.dayText(ev.n),
      amount_minor: c.num(ev.amount),
      roc_minor: c.num(roc),
      pref_minor: c.num(pref),
      catchup_gp_minor: c.num(cuGp),
      catchup_lp_minor: c.num(cuLp),
      split_gp_minor: c.num(splitGp),
      split_lp_minor: c.num(splitLp),
      gp_minor: c.num(cuGp + splitGp),
      lp_minor: c.num(roc + pref + cuLp + splitLp),
    });
  }
  if (!c.isNil(asOfDay)) {
    const n = c.dayNum(asOfDay, 'as_of_day');
    if (last !== null && n < last) throw c.fail(400, 'as_of_day is before the last flow', 'invalid_day', { field: 'as_of_day' });
    accrue(n);
    last = n;
  }
  const gp = tiers.catchup_gp + tiers.split_gp;
  const lp = tiers.roc + tiers.pref + tiers.catchup_lp + tiers.split_lp;
  return {
    estimate: true,
    contributed_minor: c.num(contributed),
    distributed_minor: c.num(distributed),
    profit_minor: c.num(distributed - contributed),
    gp_minor: c.num(gp),
    lp_minor: c.num(lp),
    unreturned_minor: c.num(unreturned),
    pref_owed_minor: c.num(prefOwed),
    tiers: {
      roc_minor: c.num(tiers.roc),
      pref_minor: c.num(tiers.pref),
      catchup_gp_minor: c.num(tiers.catchup_gp),
      catchup_lp_minor: c.num(tiers.catchup_lp),
      split_gp_minor: c.num(tiers.split_gp),
      split_lp_minor: c.num(tiers.split_lp),
    },
    rows: rows,
  };
}

/**
 * European (whole fund).
 * input: { events: [{ day, type: contribution|distribution, amount_minor }], carry_ppm,
 *          hurdle_ppm|null, compounding: compound|simple, catchup_ppm|null, as_of_day? }
 * -> { estimate: true, gp_minor, lp_minor, contributed_minor, distributed_minor, profit_minor,
 *      unreturned_minor, pref_owed_minor, tiers: {...}, rows: [per distribution] }
 */
function european(input) {
  const x = input || {};
  const T = readTerms(x);
  return machine(readEvents(x.events, 'events'), T, x.as_of_day);
}

/**
 * American (deal by deal) with clawback.
 * input: { deals: [{ id, events: [...] }], carry_ppm, hurdle_ppm|null, compounding, catchup_ppm|null }
 * -> { estimate: true, deals: [{ id, gp_minor, lp_minor, contributed_minor, distributed_minor }],
 *      deal_carry_minor, fund_carry_minor, clawback_minor, carry_after_clawback_minor }
 */
function american(input) {
  const c = C();
  const x = input || {};
  const T = readTerms(x);
  if (!Array.isArray(x.deals) || x.deals.length === 0) throw c.fail(400, 'deals must be a non-empty list', 'invalid_param', { field: 'deals' });
  const all = [];
  let dealCarry = 0;
  const deals = x.deals.map((d, i) => {
    const raw = Array.isArray(d.events) ? d.events : [];
    for (const e of raw) all.push(e);
    const r = machine(readEvents(d.events, 'deals[' + i + '].events'), T, null);
    dealCarry += r.gp_minor;
    return { id: d.id, gp_minor: r.gp_minor, lp_minor: r.lp_minor, contributed_minor: r.contributed_minor, distributed_minor: r.distributed_minor };
  });
  const fund = machine(readEvents(all, 'events'), T, null);
  const claw = dealCarry > fund.gp_minor ? dealCarry - fund.gp_minor : 0;
  return { estimate: true, deals: deals, deal_carry_minor: dealCarry, fund_carry_minor: fund.gp_minor, clawback_minor: claw, carry_after_clawback_minor: dealCarry - claw };
}

module.exports = { european: european, american: american };
