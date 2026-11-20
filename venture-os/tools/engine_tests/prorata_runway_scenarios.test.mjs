import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, expected, code } from './_load.mjs';

const PR = eng('lib_eng_prorata');
const RW = eng('lib_eng_runway');
const SC = eng('lib_eng_scenarios');

test('AngelList vector: 2.5% falls to 2% when the fund skips a round issuing 20% new shares', () => {
  assert.equal(PR.afterSkip({ ownership_ppm: 25000, new_ppm: 200000 }).ownership_ppm, expected.prorata.after_skip_ppm);
  assert.equal(expected.prorata.after_skip_ppm, 20000);
  const r = PR.toMaintain({ held_shares: 25000, pre_shares: 1000000, new_shares: 250000, price_e8: 200000000, currency: 'USD' });
  assert.equal(r.ownership_before_ppm, 25000);
  assert.equal(r.ownership_if_skip_ppm, 20000);
  assert.equal(r.shares_to_keep, expected.prorata.keep);
  assert.equal(r.shares_to_buy, 6250);
  assert.equal(r.cost_minor, 1250000);
  assert.equal(PR.amount({ ownership_ppm: 25000, round_minor: 1000000000 }).amount_minor, 25000000);
  assert.equal(PR.isMajor({ value: 50000000, threshold: 50000000 }).major, true);
  assert.equal(PR.isMajor({ value: 49999999, threshold: 50000000 }).major, false);
  assert.throws(() => PR.toMaintain({ held_shares: 5, pre_shares: 4, new_shares: 1 }), code('invalid_number'));
});

const MONTHS = [
  { period_end: '2026-07-31', cash_minor: 198000000, net_burn_minor: 10000000, verified: true },
  { period_end: '2026-08-31', cash_minor: 186000000, net_burn_minor: 12000000, verified: true },
  { period_end: '2026-09-30', cash_minor: 165000000, net_burn_minor: 11000000, verified: true },
];

test('runway: verified cash over the average burn of the last three verified months', () => {
  const r = RW.runway({ rows: MONTHS });
  assert.equal(r.state, 'known');
  assert.equal(r.avg_burn_minor, expected.runway.avg);
  assert.equal(r.months, expected.runway.months);
  assert.equal(r.zero_day, expected.runway.zero_day);
  assert.deepEqual(r.window, ['2026-07', '2026-08', '2026-09']);
  // A quarterly row ending at the cash month covers the window too.
  const q = RW.runway({ rows: [{ period_end: '2026-09-30', months: 3, cash_minor: 165000000, net_burn_minor: 33000000, verified: true }] });
  assert.equal(q.months, 15);
});

test('runway: a missing month is unknown, never zero', () => {
  const rows = MONTHS.map((m) => (m.period_end === '2026-08-31' ? Object.assign({}, m, { verified: false }) : m));
  const r = RW.runway({ rows: rows });
  assert.equal(r.state, 'unknown');
  assert.equal(r.months, null);
  assert.equal(r.reason, 'missing_month');
  assert.deepEqual(r.missing, ['2026-08']);
  const gap = RW.runway({ rows: [MONTHS[0], MONTHS[2]] });
  assert.equal(gap.reason, 'missing_month');
});

test('runway: not burning, no cash, unverified cash, bad month ends', () => {
  const nb = RW.runway({ rows: MONTHS.map((m, i) => Object.assign({}, m, { net_burn_minor: [-1000000, 500000, -2000000][i] })) });
  assert.equal(nb.state, 'not_burning');
  assert.equal(nb.months, null);
  assert.equal(RW.runway({ rows: [] }).reason, 'no_cash');
  assert.equal(RW.runway({ rows: MONTHS.map((m) => Object.assign({}, m, { verified: false })) }).reason, 'no_cash');
  const zero = RW.runway({ rows: MONTHS.map((m, i) => (i === 2 ? Object.assign({}, m, { cash_minor: 0 }) : m)) });
  assert.equal(zero.state, 'known');
  assert.equal(zero.months, 0);
  assert.throws(() => RW.runway({ rows: [{ period_end: '2026-09-15', cash_minor: 1, verified: true }] }), code('invalid_day'));
});

test('scenarios: expected multiple, probabilities must sum to 100%', () => {
  const sc = [
    { label: 'Loss', probability_ppm: 500000, multiple_e8: 0 },
    { label: 'Base', probability_ppm: 300000, multiple_e8: 300000000 },
    { label: 'Good', probability_ppm: 150000, multiple_e8: 1000000000 },
    { label: 'Outlier', probability_ppm: 50000, multiple_e8: 3000000000 },
  ];
  const r = SC.expected({ scenarios: sc, check_minor: 100000000 });
  assert.equal(r.expected_multiple_e8, expected.scenarios.expected_e8);
  assert.equal(r.expected_proceeds_minor, expected.scenarios.proceeds_minor);
  assert.equal(r.rows[3].weighted_e8, 150000000);
  const off = sc.map((s, i) => (i === 0 ? Object.assign({}, s, { probability_ppm: 490000 }) : s));
  assert.throws(() => SC.expected({ scenarios: off }), code('probabilities_not_100'));
  assert.equal(SC.multipleFromExit({ exit_value_minor: 50000000000, ownership_ppm: 50000, invested_minor: 100000000 }).multiple_e8, 2500000000);
});
