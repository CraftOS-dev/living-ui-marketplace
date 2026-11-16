import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, expected, rng, code } from './_load.mjs';

const M = eng('lib_eng_metrics');
const R = eng('lib_eng_reserves');
const X = expected.metrics;
const PP = 100; // 0.01 percentage points in ppm

const LP = [
  { day: '2020-01-15', amount_minor: -100000000 },
  { day: '2020-09-30', amount_minor: -200000000 },
  { day: '2021-06-30', amount_minor: -150000000 },
  { day: '2022-12-31', amount_minor: 50000000 },
  { day: '2024-03-31', amount_minor: 120000000 },
];
const CO = [
  { day: '2020-03-01', amount_minor: -100000000 },
  { day: '2021-03-01', amount_minor: -50000000 },
  { day: '2023-06-30', amount_minor: 30000000 },
];

test("XIRR matches the spreadsheet's documented example to 0.01 percentage points", () => {
  const r = M.xirr([
    { day: '2008-01-01', amount_minor: -10000 },
    { day: '2008-03-01', amount_minor: 2750 },
    { day: '2008-10-30', amount_minor: 4250 },
    { day: '2009-02-15', amount_minor: 3250 },
    { day: '2009-04-01', amount_minor: 2750 },
  ]);
  assert.ok(Math.abs(r.irr_ppm - Math.round(X.excel_doc_value * 1e6)) <= PP);
  assert.ok(Math.abs(r.rate - X.excel_xirr) < 1e-8);
  assert.deepEqual(M.xirr([{ day: '2020-01-01', amount_minor: -5 }]), { rate: null, irr_ppm: null, reason: 'no_sign_change' });
});

test('DPI, RVPI and TVPI = DPI + RVPI; net IRR with the NAV as the final inflow', () => {
  const f = M.fund({ currency: 'USD', as_of_day: '2026-09-30', lp_flows: LP, nav_minor: 600000000, company_flows: CO, holdings_value_minor: 400000000 });
  assert.equal(f.paid_in_minor, 450000000);
  assert.equal(f.distributed_minor, 170000000);
  assert.equal(f.dpi_e8, X.dpi_e8);
  assert.equal(f.rvpi_e8, X.rvpi_e8);
  assert.equal(f.tvpi_e8, f.dpi_e8 + f.rvpi_e8);
  assert.ok(Math.abs(f.tvpi_e8 - X.tvpi_direct_e8) <= 1);
  assert.ok(Math.abs(f.net_irr_ppm - Math.round(X.fund_net_irr * 1e6)) <= PP);
  assert.equal(f.gross_moic_e8, X.gross_moic_e8);
  assert.ok(Math.abs(f.gross_irr_ppm - Math.round(X.gross_irr * 1e6)) <= PP);
});

test('unknowns are null with a reason, never 0', () => {
  const noNav = M.fund({ currency: 'USD', as_of_day: '2026-09-30', lp_flows: LP, nav_minor: null, company_flows: CO, holdings_value_minor: null });
  assert.equal(noNav.rvpi_e8, null);
  assert.equal(noNav.tvpi_e8, null);
  assert.equal(noNav.net_irr_ppm, null);
  assert.equal(noNav.reasons.tvpi, 'no_nav');
  assert.equal(noNav.dpi_e8, X.dpi_e8);
  assert.equal(noNav.gross_moic_e8, null);
  const empty = M.fund({ currency: 'USD', as_of_day: '2026-09-30', lp_flows: [], nav_minor: 0, company_flows: [], holdings_value_minor: 0 });
  assert.equal(empty.dpi_e8, null);
  assert.equal(empty.reasons.dpi, 'no_paid_in');
  assert.equal(empty.gross_moic_e8, null);
  assert.throws(() => M.netIrr({ lp_flows: LP, nav_minor: 1, as_of_day: '2024-01-01' }), code('invalid_day'));
});

test('property: TVPI = DPI + RVPI on every fund, and within 1e-8 of the direct ratio', () => {
  const r = rng(4242);
  for (let k = 0; k < 2000; k++) {
    const paid = 1 + Math.floor(r() * 1e12);
    const dist = Math.floor(r() * 3e12);
    const nav = Math.floor(r() * 3e12);
    const m = M.multiples({ paid_in_minor: paid, distributed_minor: dist, nav_minor: nav });
    assert.equal(m.tvpi_e8, m.dpi_e8 + m.rvpi_e8);
    const direct = Number((BigInt(dist + nav) * BigInt(1e8) * BigInt(2) + BigInt(paid)) / (BigInt(paid) * BigInt(2)));
    assert.ok(Math.abs(m.tvpi_e8 - direct) <= 1);
  }
});

const TWO = {
  id: 'acme',
  ownership_ppm: 100000,
  rounds: 2,
  allocated_minor: 250000000,
  assumptions: [
    { round: 1, raise_minor: 1000000000, post_money_minor: 5000000000, source: 'Series A term sheet draft (file F-12)' },
    { round: 2, raise_minor: 3000000000, post_money_minor: 15000000000, source: 'Partner estimate, A. Tan' },
  ],
};

test('reserves: hand-computed two-round case', () => {
  const p = R.plan({ holdings: [TWO], reserve_budget_minor: 1000000000 });
  const h = p.holdings[0];
  const x = expected.reserves.two_rounds;
  assert.equal(h.needed_minor, x.needed);
  assert.equal(h.needed_minor, 400000000);
  assert.deepEqual(
    h.rounds.map((r) => [r.needed_minor, r.plan_minor, r.ownership_after_ppm, r.ownership_after_plan_ppm]),
    x.rounds.map((r) => [r.needed, r.plan, r.after_ppm, r.after_plan_ppm]),
  );
  assert.equal(h.rounds[0].ownership_if_skip_ppm, 80000);
  assert.equal(h.ownership_end_plan_ppm, 90000);
  assert.equal(h.shortfall_minor, 150000000);
  assert.deepEqual(p.totals, { needed_minor: 400000000, allocated_minor: 250000000, budget_minor: 1000000000, available_minor: 750000000, shortfall_minor: 150000000 });
  const pool = R.plan({ holdings: [{ id: 'b', ownership_ppm: 100000, rounds: 1, allocated_minor: 500000000, assumptions: [{ round: 1, raise_minor: 1000000000, post_money_minor: 5000000000, pool_ppm: 50000, source: 'Benchmark' }] }], reserve_budget_minor: 0 });
  assert.equal(pool.holdings[0].needed_minor, expected.reserves.with_pool.needed);
});

test('reserves: an unsourced assumption is refused with unsourced_assumption', () => {
  const bad = JSON.parse(JSON.stringify(TWO));
  bad.assumptions[1].source = '  ';
  assert.throws(() => R.plan({ holdings: [bad], reserve_budget_minor: 0 }), code('unsourced_assumption'));
  assert.throws(() => R.validate([bad]), (e) => e.code === 'unsourced_assumption' && e.extra.round === 2 && e.extra.holding === 'acme');
  delete bad.assumptions[1].source;
  assert.throws(() => R.validate([bad]), code('unsourced_assumption'));
  const missing = JSON.parse(JSON.stringify(TWO));
  missing.assumptions.pop();
  assert.throws(() => R.validate([missing]), code('missing_assumption'));
  const wrong = JSON.parse(JSON.stringify(TWO));
  wrong.assumptions[0].post_money_minor = 100;
  assert.throws(() => R.validate([wrong]), code('invalid_assumption'));
  assert.equal(R.validate([TWO]), true);
});
