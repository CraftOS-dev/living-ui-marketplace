import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, expected, rng, code } from './_load.mjs';

const K = eng('lib_eng_capital');
const X = expected.capital;
const FUND = [{ from_day: '2020-01-01', rate_ppm: 20000, basis: 'committed' }];

test('ILPA sample: 50,000,000 commitment, a 1,750,000 call leaves 40% contributed and 30,000,000 unfunded', () => {
  const a = K.account({
    commitment_minor: 5000000000,
    events: [
      { day: '2026-01-10', type: 'call', amount_minor: 1825000000 },
      { day: '2026-06-01', type: 'distribution', amount_minor: 1000000000, recallable_minor: 500000000 },
      { day: '2026-10-01', type: 'call', amount_minor: 175000000 },
    ],
  });
  assert.equal(a.contributed_minor, X.ilpa.contributed_minor);
  assert.equal(a.contributed_ppm, X.ilpa.contributed_ppm);
  assert.equal(a.contributed_ppm, 400000);
  assert.equal(a.unfunded_minor, X.ilpa.unfunded_minor);
  assert.equal(a.distributed_minor, X.ilpa.distributed_minor);
  assert.equal(a.recallable_minor, X.ilpa.recallable_minor);
  assert.equal(a.callable_minor, 3500000000);
  assert.equal(a.rows.length, 3);
  assert.deepEqual(a.warnings, []);
});

test('recalls draw on recallable capital, not on the unfunded commitment', () => {
  const a = K.account({
    commitment_minor: 10000000000,
    events: [
      { day: '2026-01-01', type: 'call', amount_minor: 6000000000 },
      { day: '2026-02-01', type: 'distribution', amount_minor: 2000000000, recallable_minor: 1000000000 },
      { day: '2026-03-01', type: 'recall', amount_minor: 400000000 },
    ],
  });
  assert.deepEqual(
    [a.contributed_minor, a.recalled_minor, a.unfunded_minor, a.recallable_minor, a.callable_minor],
    [6400000000, 400000000, 4000000000, 600000000, 4600000000],
  );
  const over = K.account({ commitment_minor: 100, events: [{ day: '2026-01-01', type: 'call', amount_minor: 150 }] });
  assert.deepEqual(over.warnings, ['over_commitment']);
  assert.equal(over.unfunded_minor, -50);
  const open = K.account({ commitment_minor: 1000, events: [{ day: '2025-12-31', type: 'opening', contributed_minor: 400, distributed_minor: 100, recallable_minor: 50 }, { day: '2026-01-01', type: 'call', amount_minor: 100 }] });
  assert.deepEqual([open.contributed_minor, open.unfunded_minor, open.recallable_minor], [500, 500, 50]);
  assert.throws(() => K.account({ commitment_minor: 1, events: [{ day: '2026-01-01', type: 'call', amount_minor: 1 }, { day: '2026-01-02', type: 'opening' }] }), code('invalid_param'));
  assert.throws(() => K.account({ commitment_minor: 1, events: [{ day: '2026-01-01', type: 'distribution', amount_minor: 1, recallable_minor: 2 }] }), code('invalid_number'));
});

test('property: allocation lines always sum to the total to the minor unit', () => {
  const r = rng(20261112);
  for (let k = 0; k < 2000; k++) {
    const n = 1 + Math.floor(r() * 60);
    const lps = [];
    for (let i = 0; i < n; i++) lps.push({ lp: 'L' + i, commitment_minor: Math.floor(r() * (r() < 0.1 ? 1e3 : 1e12)) + (i === 0 ? 1 : 0) });
    const total = Math.floor(r() * 1e13) * (r() < 0.05 ? -1 : 1);
    const lines = K.allocate({ total_minor: total, lps: lps });
    assert.equal(lines.reduce((s, l) => s + l.amount_minor, 0), total);
    // No line strays more than one unit from its exact share.
    const W = lps.reduce((s, l) => s + BigInt(l.commitment_minor), BigInt(0));
    lines.forEach((l, i) => {
      const exact = (BigInt(Math.abs(total)) * BigInt(lps[i].commitment_minor) * BigInt(2)) / W;
      assert.ok(Math.abs(Math.abs(l.amount_minor) * 2 - Number(exact)) <= 2);
    });
  }
});

test('management fee: 2% of committed capital a year, by month fractions', () => {
  const year = K.fee({ from_day: '2026-01-01', to_day: '2026-12-31', schedule: FUND, committed_minor: 1000000000 });
  assert.equal(year.fee_minor, X.fee_year_minor);
  assert.equal(year.fee_minor, 20000000);
  assert.equal(year.months_e6, 12000000);
  assert.equal(K.fee({ from_day: '2026-01-01', to_day: '2026-03-31', schedule: FUND, committed_minor: 1000000000 }).fee_minor, X.fee_q1_minor);
  assert.equal(K.fee({ from_day: '2026-02-15', to_day: '2026-03-31', schedule: FUND, committed_minor: 1000000000 }).fee_minor, X.fee_partial_minor);
  // A leap year is still 2%.
  assert.equal(K.fee({ from_day: '2028-01-01', to_day: '2028-12-31', schedule: FUND, committed_minor: 1000000000 }).fee_minor, 20000000);
});

test('step-down to invested capital, waivers, steps inside a month, before the first step', () => {
  const steps = [
    { from_day: '2020-01-01', rate_ppm: 20000, basis: 'committed' },
    { from_day: '2026-07-01', rate_ppm: 15000, basis: 'invested' },
  ];
  const r = K.fee({ from_day: '2026-01-01', to_day: '2026-12-31', schedule: steps, committed_minor: 1000000000, invested_minor: 600000000 });
  assert.equal(r.fee_minor, X.fee_stepdown_minor);
  const half = K.fee({ from_day: '2026-01-01', to_day: '2026-12-31', schedule: steps, committed_minor: 1000000000, invested_minor: 600000000, waiver_ppm: 500000 });
  assert.deepEqual([half.gross_minor, half.waiver_minor, half.fee_minor], [14500000, 7250000, X.fee_stepdown_waived_half_minor]);
  const split = K.fee({ from_day: '2026-03-10', to_day: '2026-04-20', schedule: [FUND[0], { from_day: '2026-04-01', rate_ppm: 10000, basis: 'committed' }], committed_minor: 1000000000 });
  assert.equal(split.fee_minor, X.fee_split_month_minor);
  const early = K.fee({ from_day: '2019-12-01', to_day: '2019-12-31', schedule: FUND, committed_minor: 1000000000 });
  assert.equal(early.fee_minor, 0);
  assert.throws(() => K.fee({ from_day: '2026-07-01', to_day: '2026-07-31', schedule: steps, committed_minor: 1 }), code('missing_basis'));
});

test('call lines: investment and expenses pro rata, fees only to fee-paying LPs at their own rates', () => {
  const r = K.callLines({
    investment_minor: 160000000,
    expenses_minor: 1600000,
    fees: { from_day: '2026-01-01', to_day: '2026-03-31', schedule: FUND },
    lps: [
      { lp: 'A', commitment_minor: 1000000000, fee_paying: true },
      { lp: 'B', commitment_minor: 500000000, fee_paying: true, schedule: [{ from_day: '2020-01-01', rate_ppm: 15000, basis: 'committed' }] },
      { lp: 'GP', commitment_minor: 100000000, fee_paying: false },
    ],
  });
  assert.deepEqual(
    r.lines.map((l) => [l.lp, l.investment_minor, l.expenses_minor, l.fee_minor, l.total_minor]),
    [
      ['A', 100000000, 1000000, 5000000, 106000000],
      ['B', 50000000, 500000, 1875000, 52375000],
      ['GP', 10000000, 100000, 0, 10100000],
    ],
  );
  assert.deepEqual(r.totals, { investment_minor: 160000000, expenses_minor: 1600000, fee_minor: 6875000, total_minor: 168475000 });
});
