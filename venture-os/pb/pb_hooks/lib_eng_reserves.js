/**
 * Reserves (REPORT Table 33; Tactyc as described by Kauffman Fellows:
 * follow on to the next rounds to hold the fund's target ownership until the
 * reserve is met).
 *
 * For each holding and each of its next N rounds (assumed raise R and
 * post-money V, optional pool increase p as a share of the post-round):
 *   dilution f = R / V + p
 *   ownership if the fund skips: o x (1 - f)
 *   follow-on needed to hold the target t: A = (t - o x (1 - f)) x V,
 *     at least 0 and at most R (the fund cannot buy more than the round);
 *   ownership after: o x (1 - f) + A / V.
 * `needed` ignores the reserve; `plan` spends the holding's allocated reserve
 * round by round until it runs out.
 * Fund totals: needed, allocated, available = budget - allocated, shortfall.
 *
 * Every assumption row needs a source (a file, link or named judgment); one
 * without is refused with code unsourced_assumption before anything is
 * computed.
 *
 * Exact: ownership is a fraction until it is shown in ppm.
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

const MAX_ROUNDS = 8;

/**
 * Check a holding's assumptions; throws unsourced_assumption, missing_assumption or invalid_assumption.
 * holding: { id, ownership_ppm, target_ppm?, rounds, allocated_minor, assumptions: [{ round, raise_minor, post_money_minor, pool_ppm?, source }] }
 */
function checkHolding(h, i) {
  const c = C();
  const w = 'holdings[' + i + ']';
  if (c.isNil(h) || typeof h !== 'object') throw c.fail(400, w + ' must be an object', 'invalid_param', { field: w });
  c.ppmCheck(h.ownership_ppm, w + '.ownership_ppm');
  const target = c.isNil(h.target_ppm) ? h.ownership_ppm : c.ppmCheck(h.target_ppm, w + '.target_ppm');
  if (!Number.isInteger(h.rounds) || h.rounds < 0 || h.rounds > MAX_ROUNDS) throw c.fail(400, w + '.rounds must be 0 to ' + MAX_ROUNDS, 'invalid_param', { field: w + '.rounds' });
  const list = Array.isArray(h.assumptions) ? h.assumptions : [];
  const byRound = {};
  list.forEach((a, k) => {
    const wa = w + '.assumptions[' + k + ']';
    if (c.isNil(a.source) || typeof a.source !== 'string' || a.source.trim() === '') {
      throw c.fail(400, wa + ' (round ' + a.round + ') has no source: cite a file, a link or the person whose judgment it is', 'unsourced_assumption', { holding: c.isNil(h.id) ? null : h.id, round: c.isNil(a.round) ? null : a.round, field: wa + '.source' });
    }
    if (!Number.isInteger(a.round) || a.round < 1 || a.round > MAX_ROUNDS) throw c.fail(400, wa + '.round must be 1 to ' + MAX_ROUNDS, 'invalid_assumption', { field: wa + '.round' });
    if (byRound[a.round] !== undefined) throw c.fail(400, w + ': round ' + a.round + ' is assumed twice', 'invalid_assumption', { field: wa + '.round' });
    const raise = c.bigPos(a.raise_minor, wa + '.raise_minor');
    const post = c.bigPos(a.post_money_minor, wa + '.post_money_minor');
    const pool = c.isNil(a.pool_ppm) ? 0 : c.ppmCheck(a.pool_ppm, wa + '.pool_ppm');
    if (raise === c.B0 || post <= raise) throw c.fail(400, wa + ': the raise must be positive and below the post-money', 'invalid_assumption', { field: wa });
    const f = c.radd(c.rat(raise, post), c.rat(pool, c.E6));
    if (c.rcmp(f, c.rat(1)) >= 0) throw c.fail(400, wa + ': the round and pool dilute 100% or more', 'invalid_assumption', { field: wa });
    byRound[a.round] = { round: a.round, raise: raise, post: post, pool: pool, f: f, source: a.source.trim() };
  });
  const rounds = [];
  for (let k = 1; k <= h.rounds; k++) {
    if (byRound[k] === undefined) throw c.fail(400, w + ': round ' + k + ' has no assumption', 'missing_assumption', { holding: c.isNil(h.id) ? null : h.id, round: k });
    rounds.push(byRound[k]);
  }
  return { id: h.id, o: c.rat(h.ownership_ppm, c.E6), t: c.rat(target, c.E6), target: target, rounds: rounds, allocated: c.isNil(h.allocated_minor) ? c.B0 : c.bigPos(h.allocated_minor, w + '.allocated_minor') };
}

/** Validate every holding's assumptions (the save check). Throws; returns true. */
function validate(holdings) {
  if (!Array.isArray(holdings)) throw C().fail(400, 'holdings must be a list', 'invalid_param', { field: 'holdings' });
  holdings.forEach((h, i) => checkHolding(h, i));
  return true;
}

function ppm(r) {
  const c = C();
  return c.num(c.rround(c.rmul(r, c.rat(c.E6))));
}

/** Follow-on to reach t from o x (1 - f) at post-money V, within [0, cap]. */
function need(o, t, f, post, cap) {
  const c = C();
  const left = c.rmul(o, c.rsub(c.rat(1), f));
  const gap = c.rsub(t, left);
  if (c.rcmp(gap, c.rat(0)) <= 0) return { amount: c.B0, after: left, skip: left };
  let a = c.rround(c.rmul(gap, c.rat(post)));
  if (a > cap) a = cap;
  return { amount: a, after: c.radd(left, c.rat(a, post)), skip: left };
}

/**
 * Reserve plan.
 * input: { holdings: [...as checkHolding], reserve_budget_minor }
 * -> { holdings: [{ id, target_ppm, needed_minor, allocated_minor, shortfall_minor, surplus_minor,
 *        ownership_end_ppm, ownership_end_plan_ppm,
 *        rounds: [{ round, raise_minor, post_money_minor, pool_ppm, dilution_ppm, ownership_if_skip_ppm,
 *                   needed_minor, ownership_after_ppm, plan_minor, ownership_after_plan_ppm, source }] }],
 *      totals: { needed_minor, allocated_minor, budget_minor, available_minor, shortfall_minor } }
 */
function plan(input) {
  const c = C();
  const x = input || {};
  if (!Array.isArray(x.holdings)) throw c.fail(400, 'holdings must be a list', 'invalid_param', { field: 'holdings' });
  const hs = x.holdings.map((h, i) => checkHolding(h, i));
  const budget = c.big(x.reserve_budget_minor, 'reserve_budget_minor');
  let tNeeded = c.B0;
  let tAlloc = c.B0;
  let tShort = c.B0;
  const out = hs.map((h) => {
    let o = h.o;
    let op = h.o;
    let left = h.allocated;
    let needed = c.B0;
    const rows = h.rounds.map((r) => {
      const n = need(o, h.t, r.f, r.post, r.raise);
      const pl = need(op, h.t, r.f, r.post, left < r.raise ? left : r.raise);
      left = left - pl.amount;
      needed = needed + n.amount;
      o = n.after;
      op = pl.after;
      return {
        round: r.round,
        raise_minor: c.num(r.raise),
        post_money_minor: c.num(r.post),
        pool_ppm: r.pool,
        dilution_ppm: ppm(r.f),
        ownership_if_skip_ppm: ppm(n.skip),
        needed_minor: c.num(n.amount),
        ownership_after_ppm: ppm(n.after),
        plan_minor: c.num(pl.amount),
        ownership_after_plan_ppm: ppm(pl.after),
        source: r.source,
      };
    });
    const short = needed > h.allocated ? needed - h.allocated : c.B0;
    tNeeded = tNeeded + needed;
    tAlloc = tAlloc + h.allocated;
    tShort = tShort + short;
    return {
      id: h.id,
      target_ppm: h.target,
      needed_minor: c.num(needed),
      allocated_minor: c.num(h.allocated),
      shortfall_minor: c.num(short),
      surplus_minor: c.num(h.allocated > needed ? h.allocated - needed : c.B0),
      ownership_end_ppm: ppm(o),
      ownership_end_plan_ppm: ppm(op),
      rounds: rows,
    };
  });
  return {
    holdings: out,
    totals: { needed_minor: c.num(tNeeded), allocated_minor: c.num(tAlloc), budget_minor: c.num(budget), available_minor: c.num(budget - tAlloc), shortfall_minor: c.num(tShort) },
  };
}

module.exports = { MAX_ROUNDS: MAX_ROUNDS, validate: validate, plan: plan };
