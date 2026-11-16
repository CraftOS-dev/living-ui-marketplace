/**
 * Post-money SAFEs and convertible notes (REPORT Table 33; Y Combinator's
 * post-money SAFE documents).
 *
 * At signing, a capped post-money SAFE owns investment / post-money cap of
 * the Company Capitalization ($500k on a $6.7M cap is about 7.5%). A
 * discount-only or MFN SAFE has no ownership until it converts.
 *
 * At a priced round (price per share P of the new preferred):
 *   Company Capitalization C = pre_shares (common, options, promised options
 *     and the unissued pool before the round; not the new money, not the
 *     pool increase) + every converting security's shares.
 *   Safe price     = cap / C          (post-money cap)
 *   Discount price = P x (1 - discount)
 *   Conversion price = the lowest of the safe price, the discount price and
 *     P; shares = floor(amount / conversion price).
 *   C contains the capped SAFEs' own shares, so C is solved exactly:
 *     C = (pre_shares + note shares + fixed-price SAFE shares) / (1 - sum of amount/cap over capped SAFEs)
 *   An MFN SAFE takes the complete terms (cap and discount together) of the
 *   later SAFE that gives it the lowest conversion price at this round, or P
 *   when no later SAFE has better terms.
 * Notes accrue simple interest, actual days over 365, from the issue day to
 * the conversion day; principal plus interest converts at the lowest of
 * cap / pre_shares (a pre-money cap), P x (1 - discount) and P.
 *
 * Exact: amounts are BigInt, prices are exact fractions of minor units per
 * share, shares are floored once. Prices are reported in `_e8` of the major
 * unit per share.
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

const INSTRUMENTS = ['safe_cap', 'safe_discount', 'safe_mfn', 'note', 'priced'];

function optPos(x, field) {
  const c = C();
  if (c.isNil(x)) return null;
  const b = c.bigPos(x, field);
  if (b === c.B0) throw c.fail(400, field + ' must be positive', 'invalid_number', { field: field });
  return b;
}

function optPpm(x, field) {
  const c = C();
  if (c.isNil(x)) return null;
  c.ppmCheck(x, field);
  if (x === 0 || x >= c.E6) throw c.fail(400, field + ' must be above 0 and below 1000000', 'invalid_ppm', { field: field });
  return x;
}

/** Ownership at signing of a capped post-money SAFE. -> { ownership_ppm } */
function ownership(input) {
  const c = C();
  const x = input || {};
  const amount = c.bigPos(x.amount_minor, 'amount_minor');
  const cap = optPos(x.cap_minor, 'cap_minor');
  if (cap === null) throw c.fail(400, 'cap_minor is required', 'invalid_number', { field: 'cap_minor' });
  return { ownership_ppm: c.num(c.divRound(amount * c.BE6, cap), 'ownership_ppm') };
}

/**
 * Several SAFEs at signing. safes: [{ id, amount_minor, cap_minor|null }]
 * -> { safes: [{ id, ownership_ppm|null, reason }], capped_ppm }
 */
function stack(safes) {
  const c = C();
  if (!Array.isArray(safes)) throw c.fail(400, 'safes must be a list', 'invalid_param', {});
  let total = 0;
  const out = safes.map((s, i) => {
    const amount = c.bigPos(s.amount_minor, 'safes[' + i + '].amount_minor');
    const cap = optPos(s.cap_minor, 'safes[' + i + '].cap_minor');
    if (cap === null) return { id: s.id, ownership_ppm: null, reason: 'set_at_conversion' };
    const ppm = c.num(c.divRound(amount * c.BE6, cap));
    total += ppm;
    return { id: s.id, ownership_ppm: ppm, reason: null };
  });
  return { safes: out, capped_ppm: total };
}

/**
 * Simple interest on a note: principal x rate x days / 365, rounded half away.
 * input: { principal_minor, rate_ppm (per year), from_day, to_day }
 * -> { days, interest_minor, amount_minor }
 */
function interest(input) {
  const c = C();
  const x = input || {};
  const p = c.bigPos(x.principal_minor, 'principal_minor');
  c.ppmCheck(x.rate_ppm, 'rate_ppm');
  const days = c.diffDays(x.from_day, x.to_day);
  if (days < 0) throw c.fail(400, 'to_day is before from_day', 'invalid_day', { field: 'to_day' });
  const i = c.divRound(p * BigInt(x.rate_ppm) * BigInt(days), c.BE6 * BigInt(365));
  return { days: days, interest_minor: c.num(i), amount_minor: c.num(p + i) };
}

function priceE8(price, e) {
  const c = C();
  return c.num(c.divRound(price.n * c.BE8, price.d * c.bpow10(e)), 'price_e8');
}

/** The fixed-price part of a set of terms: min(P, P x (1 - d)). -> { price, basis } */
function fixedOf(P, discountPpm) {
  const c = C();
  if (discountPpm === null) return { price: P, basis: 'round' };
  return { price: c.rmul(P, c.rat(BigInt(c.E6 - discountPpm), c.BE6)), basis: 'discount' };
}

/**
 * Convert SAFEs and notes at a priced round.
 * input: {
 *   currency, price_e8 (price per share of the new preferred, major unit x 10^8),
 *   pre_shares, new_money_minor | new_shares, pool_increase_shares (0),
 *   day (closing day; needed for notes and MFN),
 *   safes: [{ id, amount_minor, cap_minor|null, discount_ppm|null, mfn: false, issued_day }],
 *   notes: [{ id, principal_minor, rate_ppm, issued_day, cap_minor|null, discount_ppm|null }]
 * }
 * -> { currency, price_e8, pre_shares, capitalization_shares,
 *      safes:[{ id, amount_minor, basis: cap|discount|round, terms_from, conversion_price_e8, shares, capitalization_ppm, ownership_ppm }],
 *      notes: [{ id, principal_minor, days, interest_minor, amount_minor, basis, conversion_price_e8, shares, ownership_ppm }],
 *      new_shares, pool_increase_shares, post_shares }
 */
function convert(input) {
  const c = C();
  const x = input || {};
  const e = c.exponent(x.currency);
  const priceE8In = c.bigPos(x.price_e8, 'price_e8');
  if (priceE8In === c.B0) throw c.fail(400, 'price_e8 must be positive', 'invalid_number', { field: 'price_e8' });
  const P = c.rat(priceE8In * c.bpow10(e), c.BE8);
  const S0 = c.bigPos(x.pre_shares, 'pre_shares');
  if (S0 === c.B0) throw c.fail(400, 'pre_shares must be positive', 'invalid_number', { field: 'pre_shares' });
  const pool = c.isNil(x.pool_increase_shares) ? c.B0 : c.bigPos(x.pool_increase_shares, 'pool_increase_shares');
  let newShares;
  if (!c.isNil(x.new_shares)) newShares = c.bigPos(x.new_shares, 'new_shares');
  else if (!c.isNil(x.new_money_minor)) newShares = c.rfloor(c.rdiv(c.rat(c.bigPos(x.new_money_minor, 'new_money_minor')), P));
  else throw c.fail(400, 'Give new_money_minor or new_shares', 'invalid_number', { field: 'new_money_minor' });
  const safesIn = c.isNil(x.safes) ? [] : x.safes;
  const notesIn = c.isNil(x.notes) ? [] : x.notes;
  if (!Array.isArray(safesIn) || !Array.isArray(notesIn)) throw c.fail(400, 'safes and notes are lists', 'invalid_param', {});

  // Notes first: their shares do not depend on C.
  let noteShares = c.B0;
  const notes = notesIn.map((n, i) => {
    const w = 'notes[' + i + ']';
    if (c.isNil(x.day)) throw c.fail(400, 'day (the closing day) is required to accrue note interest', 'invalid_day', { field: 'day' });
    const acc = interest({ principal_minor: n.principal_minor, rate_ppm: n.rate_ppm, from_day: n.issued_day, to_day: x.day });
    const cap = optPos(n.cap_minor, w + '.cap_minor');
    const fx = fixedOf(P, optPpm(n.discount_ppm, w + '.discount_ppm'));
    let price = fx.price;
    let basis = fx.basis;
    if (cap !== null) {
      const cp = c.rat(cap, S0);
      if (c.rcmp(cp, price) < 0) {
        price = cp;
        basis = 'cap';
      }
    }
    const shares = c.rfloor(c.rdiv(c.rat(BigInt(acc.amount_minor)), price));
    noteShares = noteShares + shares;
    return { id: n.id, principal_minor: c.num(c.big(n.principal_minor, w + '.principal_minor')), days: acc.days, interest_minor: acc.interest_minor, amount_minor: acc.amount_minor, basis: basis, conversion_price_e8: priceE8(price, e), shares: shares };
  });

  // SAFEs: each has term options; an MFN SAFE may take any later SAFE's terms.
  const safes = safesIn.map((s, i) => {
    const w = 'safes[' + i + ']';
    return { id: s.id, i: i, amount: c.bigPos(s.amount_minor, w + '.amount_minor'), cap: optPos(s.cap_minor, w + '.cap_minor'), discount: optPpm(s.discount_ppm, w + '.discount_ppm'), mfn: s.mfn === true, issued_day: c.isNil(s.issued_day) ? null : s.issued_day };
  });
  for (const s of safes) {
    if (s.amount === c.B0) throw c.fail(400, 'safes[' + s.i + '].amount_minor must be positive', 'invalid_number', {});
    if (s.mfn && (s.cap !== null || s.discount !== null)) throw c.fail(400, 'safes[' + s.i + ']: an MFN SAFE has no cap or discount of its own', 'invalid_param', {});
  }
  safes.forEach((s) => {
    const own = { cap: s.cap, fixed: fixedOf(P, s.discount), from: s.id };
    s.options = [own];
    if (!s.mfn) return;
    if (s.issued_day === null) throw c.fail(400, 'safes[' + s.i + ']: an MFN SAFE needs issued_day', 'invalid_day', {});
    const at = c.dayNum(s.issued_day, 'issued_day');
    for (const o of safes) {
      if (o === s || o.mfn || o.issued_day === null) continue;
      if (c.dayNum(o.issued_day, 'issued_day') > at) s.options.push({ cap: o.cap, fixed: fixedOf(P, o.discount), from: o.id });
    }
  });

  const base = S0 + noteShares;
  // Binding term of each SAFE at capitalization Cr: the option with the lowest price.
  const bind = (Cr) =>
    safes.map((s) => {
      let bestPrice = null;
      let best = null;
      for (const o of s.options) {
        let price = o.fixed.price;
        let basis = o.fixed.basis;
        if (o.cap !== null) {
          const cp = c.rdiv(c.rat(o.cap), Cr);
          if (c.rcmp(cp, price) < 0) {
            price = cp;
            basis = 'cap';
          }
        }
        if (bestPrice === null || c.rcmp(price, bestPrice) < 0) {
          bestPrice = price;
          best = { basis: basis, cap: basis === 'cap' ? o.cap : null, price: price, from: o.from };
        }
      }
      return best;
    });
  // Start at the smallest capitalization; the binding set only grows, so this ends.
  let Cr = c.rat(base);
  let b = bind(Cr);
  for (let it = 0; ; it++) {
    if (it > safes.length + 2) throw c.fail(400, 'SAFE conversion did not settle', 'no_convergence', {});
    let own = c.rat(0);
    let fixedShares = c.B0;
    safes.forEach((s, k) => {
      if (b[k].basis === 'cap') own = c.radd(own, c.rat(s.amount, b[k].cap));
      else fixedShares = fixedShares + c.rfloor(c.rdiv(c.rat(s.amount), b[k].price));
    });
    const room = c.rsub(c.rat(1), own);
    if (c.rcmp(room, c.rat(0)) <= 0) throw c.fail(400, 'The capped SAFEs would own all of the company: check the caps and amounts', 'safes_exceed_capitalization', {});
    const next = c.rdiv(c.rat(base + fixedShares), room);
    const nb = bind(next);
    const same = nb.every((v, k) => v.basis === b[k].basis && v.from === b[k].from);
    Cr = next;
    if (same) break;
    b = nb;
  }

  let safeShares = c.B0;
  const safeRows = safes.map((s, k) => {
    const t = b[k];
    const price = t.basis === 'cap' ? c.rdiv(c.rat(t.cap), Cr) : t.price;
    const shares = c.rfloor(c.rdiv(c.rat(s.amount), price));
    safeShares = safeShares + shares;
    return { id: s.id, amount_minor: c.num(s.amount), basis: t.basis, terms_from: t.from, conversion_price_e8: priceE8(price, e), shares: shares };
  });
  const capShares = base + safeShares;
  const post = capShares + newShares + pool;
  const ppm = (sh) => c.num(c.divRound(sh * c.BE6, post));
  const capRows = safeRows.map((r) => Object.assign(r, { capitalization_ppm: c.num(c.divRound(r.shares * c.BE6, capShares)), ownership_ppm: ppm(r.shares), shares: c.num(r.shares) }));
  const noteRows = notes.map((r) => Object.assign(r, { ownership_ppm: ppm(r.shares), shares: c.num(r.shares) }));
  return {
    currency: String(x.currency).toUpperCase(),
    price_e8: c.num(priceE8In),
    pre_shares: c.num(S0),
    capitalization_shares: c.num(capShares),
    safes: capRows,
    notes: noteRows,
    new_shares: c.num(newShares),
    pool_increase_shares: c.num(pool),
    post_shares: c.num(post),
  };
}

/**
 * The Mark invested preview for one instrument.
 * input: { instrument: safe_cap|safe_discount|safe_mfn|note|priced, currency, amount_minor,
 *          cap_minor?, discount_ppm?, rate_ppm?, issued_day?,          (SAFE and note terms)
 *          post_money_minor? | pre_money_minor? + raise_minor?, price_e8?, post_shares?,   (priced)
 *          pre_shares?,                                                 (implied SAFE price)
 *          scenario?: { price_e8, pre_shares, new_money_minor, day, pool_increase_shares? } }
 * -> { instrument, ownership_ppm|null, reason, implied_price_e8|null, conversion|null }
 */
function preview(input) {
  const c = C();
  const x = input || {};
  if (INSTRUMENTS.indexOf(x.instrument) < 0) throw c.fail(400, 'instrument must be one of ' + INSTRUMENTS.join(', '), 'invalid_param', { field: 'instrument' });
  const e = c.exponent(x.currency);
  const amount = c.bigPos(x.amount_minor, 'amount_minor');
  const out = { instrument: x.instrument, ownership_ppm: null, reason: null, implied_price_e8: null, conversion: null };
  if (x.instrument === 'safe_cap') {
    const cap = optPos(x.cap_minor, 'cap_minor');
    if (cap === null) throw c.fail(400, 'A capped SAFE needs cap_minor', 'invalid_number', { field: 'cap_minor' });
    out.ownership_ppm = ownership({ amount_minor: x.amount_minor, cap_minor: x.cap_minor }).ownership_ppm;
    if (!c.isNil(x.pre_shares)) {
      const S0 = c.bigPos(x.pre_shares, 'pre_shares');
      const room = c.rsub(c.rat(1), c.rat(amount, cap));
      if (S0 > c.B0 && c.rcmp(room, c.rat(0)) > 0) out.implied_price_e8 = priceE8(c.rdiv(c.rat(cap), c.rdiv(c.rat(S0), room)), e);
    }
  } else if (x.instrument === 'priced') {
    let post = null;
    if (!c.isNil(x.post_money_minor)) post = optPos(x.post_money_minor, 'post_money_minor');
    else if (!c.isNil(x.pre_money_minor) && !c.isNil(x.raise_minor)) post = c.bigPos(x.pre_money_minor, 'pre_money_minor') + c.bigPos(x.raise_minor, 'raise_minor');
    if (post === null || post === c.B0) throw c.fail(400, 'A priced round needs post_money_minor, or pre_money_minor and raise_minor', 'invalid_number', { field: 'post_money_minor' });
    out.ownership_ppm = c.num(c.divRound(amount * c.BE6, post));
    if (!c.isNil(x.price_e8)) out.implied_price_e8 = c.num(c.bigPos(x.price_e8, 'price_e8'));
    else if (!c.isNil(x.post_shares)) {
      const ps = optPos(x.post_shares, 'post_shares');
      out.implied_price_e8 = priceE8(c.rat(post, ps), e);
    }
  } else {
    out.reason = 'set_at_conversion';
  }
  if (!c.isNil(x.scenario) && x.instrument !== 'priced') {
    const s = x.scenario;
    const conv = { currency: x.currency, price_e8: s.price_e8, pre_shares: s.pre_shares, new_money_minor: s.new_money_minor, pool_increase_shares: s.pool_increase_shares, day: s.day, safes: [], notes: [] };
    if (x.instrument === 'note') conv.notes.push({ id: 'this', principal_minor: x.amount_minor, rate_ppm: x.rate_ppm, issued_day: x.issued_day, cap_minor: x.cap_minor, discount_ppm: x.discount_ppm });
    else conv.safes.push({ id: 'this', amount_minor: x.amount_minor, cap_minor: x.instrument === 'safe_mfn' ? null : x.cap_minor, discount_ppm: x.instrument === 'safe_mfn' ? null : x.discount_ppm, mfn: x.instrument === 'safe_mfn', issued_day: x.issued_day });
    out.conversion = convert(conv);
  }
  return out;
}

module.exports = {
  INSTRUMENTS: INSTRUMENTS,
  ownership: ownership,
  stack: stack,
  interest: interest,
  convert: convert,
  preview: preview,
};
