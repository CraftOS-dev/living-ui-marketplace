/**
 * Pro rata (REPORT Table 33; AngelList's pro rata explainer).
 *
 * Shares to keep ownership = ownership x post-round fully diluted shares.
 * Skipping a round that issues a fraction f of the post-round shares leaves
 * ownership x (1 - f): 2.5% falls to 2% when the round issues 20% new shares.
 * The pro rata amount in money is ownership x the round's new money.
 * A major-investor right applies from a threshold (shares or money).
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

/**
 * Ownership after skipping a round.
 * input: { ownership_ppm, new_ppm (new shares as a share of the post-round total) }
 * -> { ownership_ppm }
 */
function afterSkip(input) {
  const c = C();
  const x = input || {};
  c.ppmCheck(x.ownership_ppm, 'ownership_ppm');
  c.ppmCheck(x.new_ppm, 'new_ppm');
  return { ownership_ppm: c.num(c.divRound(BigInt(x.ownership_ppm) * BigInt(c.E6 - x.new_ppm), c.BE6)) };
}

/**
 * Shares and money to keep ownership through a round.
 * input: { held_shares, pre_shares (fully diluted before the round), new_shares (issued in the round),
 *          price_e8?, currency? (both for the cost) }
 * -> { ownership_before_ppm, ownership_if_skip_ppm, shares_to_keep, shares_to_buy, cost_minor|null, post_shares }
 */
function toMaintain(input) {
  const c = C();
  const x = input || {};
  const held = c.bigPos(x.held_shares, 'held_shares');
  const pre = c.bigPos(x.pre_shares, 'pre_shares');
  const add = c.bigPos(x.new_shares, 'new_shares');
  if (pre === c.B0) throw c.fail(400, 'pre_shares must be positive', 'invalid_number', { field: 'pre_shares' });
  if (held > pre) throw c.fail(400, 'held_shares cannot exceed pre_shares', 'invalid_number', { field: 'held_shares' });
  const post = pre + add;
  const keep = c.divRound(held * post, pre);
  const buy = keep - held;
  let cost = null;
  if (!c.isNil(x.price_e8)) {
    const e = c.exponent(x.currency);
    cost = c.num(c.divRound(buy * c.bigPos(x.price_e8, 'price_e8') * c.bpow10(e), c.BE8), 'cost_minor');
  }
  return {
    ownership_before_ppm: c.num(c.divRound(held * c.BE6, pre)),
    ownership_if_skip_ppm: c.num(c.divRound(held * c.BE6, post)),
    shares_to_keep: c.num(keep),
    shares_to_buy: c.num(buy),
    cost_minor: cost,
    post_shares: c.num(post),
  };
}

/**
 * The pro rata allocation in money: ownership x the round's new money.
 * input: { ownership_ppm, round_minor } -> { amount_minor }
 */
function amount(input) {
  const c = C();
  const x = input || {};
  c.ppmCheck(x.ownership_ppm, 'ownership_ppm');
  return { amount_minor: c.num(c.divRound(c.bigPos(x.round_minor, 'round_minor') * BigInt(x.ownership_ppm), c.BE6)) };
}

/**
 * Major-investor test: the holding meets the threshold (shares or money; same unit as value).
 * input: { value, threshold } -> { major: boolean }
 */
function isMajor(input) {
  const c = C();
  const x = input || {};
  return { major: c.bigPos(x.value, 'value') >= c.bigPos(x.threshold, 'threshold') };
}

module.exports = { afterSkip: afterSkip, toMaintain: toMaintain, amount: amount, isMajor: isMajor };
