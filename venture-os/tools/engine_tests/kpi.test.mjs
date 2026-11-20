import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, expected, code } from './_load.mjs';

const K = eng('lib_eng_kpi');
const X = expected.kpi;

test('fiscal periods by fiscal year end', () => {
  assert.deepEqual(K.fiscalOf('2026-05-15', 3), { fy: 2027, q: 1, month: 2, fy_start: '2026-04-01', fy_end: '2027-03-31', q_start: '2026-04-01', q_end: '2026-06-30' });
  assert.deepEqual(K.fiscalOf('2026-12-31', 12), { fy: 2026, q: 4, month: 12, fy_start: '2026-01-01', fy_end: '2026-12-31', q_start: '2026-10-01', q_end: '2026-12-31' });
  const june = K.fiscalOf('2026-01-10', 6);
  assert.equal(june.fy, 2026);
  assert.equal(june.q, 3);
  assert.equal(june.fy_start, '2025-07-01');
  assert.throws(() => K.fiscalOf('2026-01-10', 13), code('invalid_param'));
});

const months = (from, values) => {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (const v of values) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ period_end: y + '-' + String(m).padStart(2, '0') + '-' + last, value: v });
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
  }
  return out;
};

test('flows sum, stocks take the end, ratios average; gaps give null', () => {
  const rev = months('2026-04', [100, 110, 120, 130, null, 150]);
  const q = K.rollup({ points: rev, kind: 'flow', fy_end_month: 3, to: 'quarter' });
  assert.deepEqual(
    q.map((r) => [r.fy, r.q, r.value, r.reason]),
    [
      [2027, 1, 330, null],
      [2027, 2, null, 'incomplete'],
    ],
  );
  const cash = K.rollup({ points: months('2026-04', [900, 800, 700, 600, 500, null]), kind: 'stock', fy_end_month: 3, to: 'quarter' });
  assert.deepEqual(
    cash.map((r) => [r.value, r.reason]),
    [
      [700, null],
      [null, 'missing_end'],
    ],
  );
  const gm = K.rollup({ points: months('2026-01', [600000, 650000, 700000]), kind: 'ratio', fy_end_month: 12, to: 'quarter' });
  assert.equal(gm[0].value, 650000);
  // Quarterly points roll up to a calendar year.
  const qs = [
    { period_end: '2026-03-31', months: 3, value: 10 },
    { period_end: '2026-06-30', months: 3, value: 20 },
    { period_end: '2026-09-30', months: 3, value: 30 },
    { period_end: '2026-12-31', months: 3, value: 40 },
  ];
  assert.equal(K.rollup({ points: qs, kind: 'flow', fy_end_month: 12, to: 'year' })[0].value, 100);
  // A calendar quarter cannot fill a fiscal quarter that ends in another month
  // (fiscal year ending January: quarters Nov to Jan, Feb to Apr, May to Jul).
  assert.deepEqual(
    K.rollup({ points: qs.slice(0, 2), kind: 'flow', fy_end_month: 1, to: 'quarter' }).map((r) => [r.start, r.value, r.reason]),
    [
      ['2025-11-01', null, 'incomplete'],
      ['2026-02-01', null, 'misaligned'],
      ['2026-05-01', null, 'misaligned'],
    ],
  );
});

test('growth, growth series and CMGR', () => {
  assert.deepEqual(K.growth(120, 100), { growth_ppm: 200000, reason: null });
  assert.deepEqual(K.growth(80, -100), { growth_ppm: 1800000, reason: null });
  assert.deepEqual(K.growth(5, 0), { growth_ppm: null, reason: 'no_base' });
  assert.deepEqual(K.growth(5, null), { growth_ppm: null, reason: 'missing' });
  const s = K.growthSeries(months('2026-01', [100, 110, null, 121]), 1);
  assert.deepEqual(
    s.map((r) => r.growth_ppm),
    [null, 100000, null, null],
  );
  assert.equal(K.cmgr(100, 200, 12).cmgr_ppm, X.cmgr_ppm);
});

const day = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
function rates(spec) {
  const out = [];
  for (const [m, last, v] of spec) for (let d = 1; d <= last; d++) out.push({ day: day(2026, m, d), rate_e8: v });
  return out;
}

test('fixture 1, one fixed rate: avg and end agree', () => {
  const r = rates([
    [1, 31, 110000000],
    [2, 28, 110000000],
    [3, 31, 110000000],
  ]);
  const flow = K.convertSeries({ points: [{ period_end: '2026-03-31', months: 3, value: 30000000 }], kind: 'flow', from: 'EUR', to: 'USD', rates: r });
  const stock = K.convertSeries({ points: [{ period_end: '2026-03-31', months: 3, value: 30000000 }], kind: 'stock', from: 'EUR', to: 'USD', rates: r });
  assert.equal(flow[0].value, 33000000);
  assert.equal(stock[0].value, 33000000);
});

test('fixture 2, rates moving 1.08, 1.10, 1.12: flows at the average, balances at the end', () => {
  const r = rates([
    [1, 31, 108000000],
    [2, 28, 110000000],
    [3, 31, 112000000],
  ]);
  assert.equal(K.rateFor({ rates: r, mode: 'avg', start_day: '2026-01-01', end_day: '2026-03-31' }).rate_e8, X.q1_avg_rate_e8);
  const flow = K.convertSeries({ points: [{ period_end: '2026-03-31', months: 3, value: 30000000 }], kind: 'flow', from: 'EUR', to: 'USD', rates: r });
  assert.deepEqual([flow[0].value, flow[0].mode], [X.q1_flow_usd_minor, 'avg']);
  const cash = K.convertSeries({ points: [{ period_end: '2026-03-31', months: 1, value: 100000000 }], kind: 'stock', from: 'EUR', to: 'USD', rates: r });
  assert.deepEqual([cash[0].value, cash[0].mode, cash[0].rate_e8], [X.mar_cash_usd_minor, 'end', 112000000]);
  const feb = K.convertSeries({ points: [{ period_end: '2026-02-28', value: 10000000 }], kind: 'flow', from: 'EUR', to: 'USD', rates: r });
  assert.equal(feb[0].value, X.feb_flow_usd_minor);
  const ratio = K.convertSeries({ points: [{ period_end: '2026-02-28', value: 650000 }], kind: 'ratio', from: 'EUR', to: 'USD', rates: r });
  assert.deepEqual([ratio[0].value, ratio[0].mode], [650000, null]);
});

test('currency exponents, missing rates, the end lookback', () => {
  const jpy = K.convertSeries({ points: [{ period_end: '2026-01-31', value: 100000 }], kind: 'stock', from: 'EUR', to: 'JPY', rates: [{ day: '2026-01-30', rate_e8: 16000000000 }] });
  assert.equal(jpy[0].value, X.eur_to_jpy_minor);
  const stale = K.convertSeries({ points: [{ period_end: '2026-01-31', value: 100000 }], kind: 'stock', from: 'EUR', to: 'USD', rates: [{ day: '2026-01-20', rate_e8: 110000000 }] });
  assert.deepEqual([stale[0].value, stale[0].reason], [null, 'no_rate']);
  const none = K.convertSeries({ points: [{ period_end: '2026-01-31', value: 100000 }], kind: 'flow', from: 'EUR', to: 'USD', rates: [] });
  assert.equal(none[0].reason, 'no_rate');
  const same = K.convertSeries({ points: [{ period_end: '2026-01-31', value: 100000 }], kind: 'flow', from: 'USD', to: 'USD', rates: [] });
  assert.equal(same[0].value, 100000);
  assert.equal(K.modeFor('flow'), 'avg');
  assert.equal(K.modeFor('stock'), 'end');
});
