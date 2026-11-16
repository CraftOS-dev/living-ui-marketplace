import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, expected, code } from './_load.mjs';

const S = eng('lib_eng_safe');
const X = expected.safe;
const ROUND = { currency: 'USD', price_e8: 200000000, pre_shares: 9000000, new_money_minor: 500000000 };

test('YC vector: $500k on a $6.7M post-money cap is about 7.5%; $1M about 15%', () => {
  const a = S.ownership({ amount_minor: 50000000, cap_minor: 670000000 });
  const b = S.ownership({ amount_minor: 100000000, cap_minor: 670000000 });
  assert.equal(a.ownership_ppm, X.own_500k_6_7m_ppm);
  assert.equal(b.ownership_ppm, X.own_1m_6_7m_ppm);
  assert.ok(Math.abs(a.ownership_ppm - 75000) < 500);
  assert.ok(Math.abs(b.ownership_ppm - 150000) < 1000);
  const st = S.stack([{ id: 'a', amount_minor: 50000000, cap_minor: 670000000 }, { id: 'b', amount_minor: 10000000, cap_minor: null }]);
  assert.equal(st.capped_ppm, 74627);
  assert.equal(st.safes[1].reason, 'set_at_conversion');
});

test('one capped SAFE converts at cap / Company Capitalization', () => {
  const r = S.convert(Object.assign({}, ROUND, { safes: [{ id: 'a', amount_minor: 100000000, cap_minor: 1000000000 }] }));
  assert.equal(r.capitalization_shares, X.single.cap_shares);
  assert.equal(r.safes[0].shares, X.single.safe_shares);
  assert.equal(r.safes[0].conversion_price_e8, 100000000);
  assert.equal(r.safes[0].basis, 'cap');
  assert.equal(r.safes[0].capitalization_ppm, 100000);
  assert.equal(r.new_shares, X.single.new_shares);
  assert.equal(r.post_shares, X.single.post);
  assert.equal(r.safes[0].ownership_ppm, X.single.own_ppm);
});

test('a capped SAFE and a discount SAFE: the lower of cap price and discount price', () => {
  const r = S.convert(Object.assign({}, ROUND, { safes: [{ id: 'a', amount_minor: 100000000, cap_minor: 1000000000, discount_ppm: 200000 }, { id: 'b', amount_minor: 50000000, discount_ppm: 200000 }] }));
  assert.equal(r.safes[0].basis, 'cap');
  assert.equal(r.safes[0].shares, X.two.a_shares);
  assert.equal(r.safes[0].conversion_price_e8, X.two.cap_price_e8);
  assert.equal(r.safes[1].basis, 'discount');
  assert.equal(r.safes[1].shares, X.two.b_shares);
  assert.equal(r.safes[1].conversion_price_e8, 160000000);
  assert.equal(r.capitalization_shares, X.two.capitalization);
  assert.equal(r.post_shares, X.two.post);
  // Post-money: the capped SAFE holds amount / cap of the Company Capitalization.
  assert.ok(Math.abs(r.safes[0].capitalization_ppm - 100000) <= 1);
});

test('a cap above the round converts at the round price', () => {
  const r = S.convert(Object.assign({}, ROUND, { safes: [{ id: 'a', amount_minor: 100000000, cap_minor: 3000000000 }] }));
  assert.equal(r.safes[0].basis, 'round');
  assert.equal(r.safes[0].shares, X.cap_above_round.shares);
});

test('MFN takes the later SAFE terms that convert best', () => {
  const r = S.convert(
    Object.assign({}, ROUND, {
      safes: [
        { id: 'm', amount_minor: 25000000, mfn: true, issued_day: '2025-01-01' },
        { id: 's1', amount_minor: 100000000, cap_minor: 1000000000, issued_day: '2025-03-01' },
        { id: 's2', amount_minor: 50000000, discount_ppm: 200000, issued_day: '2025-06-01' },
      ],
    }),
  );
  assert.equal(r.safes[0].terms_from, 's1');
  assert.equal(r.safes[0].basis, 'cap');
  assert.equal(r.safes[0].shares, X.mfn.mfn_shares);
  assert.equal(r.safes[1].shares, X.mfn.s1_shares);
  assert.equal(r.safes[2].shares, X.mfn.s2_shares);
  assert.equal(r.safes[0].conversion_price_e8, X.mfn.cap_price_e8);
  // An MFN with no later SAFE converts at the round price.
  const alone = S.convert(Object.assign({}, ROUND, { safes: [{ id: 'm', amount_minor: 25000000, mfn: true, issued_day: '2025-01-01' }] }));
  assert.equal(alone.safes[0].basis, 'round');
  assert.equal(alone.safes[0].shares, 125000);
  assert.throws(() => S.convert(Object.assign({}, ROUND, { safes: [{ id: 'm', amount_minor: 1, mfn: true, cap_minor: 5, issued_day: '2025-01-01' }] })), code('invalid_param'));
});

test('notes: simple interest to conversion, pre-money cap, then SAFEs count the note shares', () => {
  assert.deepEqual(S.interest({ principal_minor: 10000000, rate_ppm: 80000, from_day: '2025-01-01', to_day: '2026-01-01' }), { days: 365, interest_minor: X.note_and_safe.interest_minor, amount_minor: 10800000 });
  assert.equal(S.interest({ principal_minor: 10000000, rate_ppm: 60000, from_day: '2024-01-01', to_day: '2024-07-01' }).interest_minor, X.interest_6pct_182d_minor);
  const r = S.convert(
    Object.assign({}, ROUND, {
      day: '2026-01-01',
      notes: [{ id: 'n', principal_minor: 10000000, rate_ppm: 80000, issued_day: '2025-01-01', cap_minor: 800000000, discount_ppm: 200000 }],
      safes: [{ id: 's', amount_minor: 100000000, cap_minor: 1000000000 }],
    }),
  );
  assert.equal(r.notes[0].basis, 'cap');
  assert.equal(r.notes[0].interest_minor, 800000);
  assert.equal(r.notes[0].shares, X.note_and_safe.note_shares);
  assert.equal(r.safes[0].shares, X.note_and_safe.safe_shares);
  assert.equal(r.post_shares, X.note_and_safe.post);
  assert.throws(() => S.convert(Object.assign({}, ROUND, { notes: [{ id: 'n', principal_minor: 1, rate_ppm: 1, issued_day: '2025-01-01' }] })), code('invalid_day'));
});

test('refusals: SAFEs owning everything, bad inputs', () => {
  assert.throws(() => S.convert(Object.assign({}, ROUND, { safes: [{ id: 'a', amount_minor: 1000, cap_minor: 1000 }] })), code('safes_exceed_capitalization'));
  assert.throws(() => S.ownership({ amount_minor: 1, cap_minor: 0 }), code('invalid_number'));
  assert.throws(() => S.convert(Object.assign({}, ROUND, { price_e8: 0 })), code('invalid_number'));
  assert.throws(() => S.preview({ instrument: 'warrant', currency: 'USD', amount_minor: 1 }), code('invalid_param'));
});

test('Mark invested preview for each instrument', () => {
  const cap = S.preview({ instrument: 'safe_cap', currency: 'USD', amount_minor: 50000000, cap_minor: 670000000, pre_shares: 9000000 });
  assert.equal(cap.ownership_ppm, X.own_500k_6_7m_ppm);
  assert.equal(cap.implied_price_e8, X.implied_price_e8);
  const disc = S.preview({ instrument: 'safe_discount', currency: 'USD', amount_minor: 50000000, discount_ppm: 200000, scenario: { price_e8: 200000000, pre_shares: 9000000, new_money_minor: 500000000 } });
  assert.equal(disc.ownership_ppm, null);
  assert.equal(disc.reason, 'set_at_conversion');
  assert.equal(disc.conversion.safes[0].shares, 312500);
  const priced = S.preview({ instrument: 'priced', currency: 'USD', amount_minor: 200000000, pre_money_minor: 800000000, raise_minor: 200000000, price_e8: 150000000 });
  assert.equal(priced.ownership_ppm, 200000);
  assert.equal(priced.implied_price_e8, 150000000);
  const note = S.preview({ instrument: 'note', currency: 'USD', amount_minor: 10000000, rate_ppm: 80000, issued_day: '2025-01-01', cap_minor: 800000000, scenario: { price_e8: 200000000, pre_shares: 9000000, new_money_minor: 500000000, day: '2026-01-01' } });
  assert.equal(note.conversion.notes[0].shares, 121500);
});
