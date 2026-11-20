import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, expected, rng, code } from './_load.mjs';

const W = eng('lib_eng_waterfall');
const X = expected.waterfall;
const ONE_YEAR = [
  { day: '2025-01-01', type: 'contribution', amount_minor: 100000000 },
  { day: '2026-01-01', type: 'distribution', amount_minor: 150000000 },
];

function tiersOf(r) {
  const t = r.tiers;
  return { roc: t.roc_minor, pref: t.pref_minor, cu_gp: t.catchup_gp_minor, cu_lp: t.catchup_lp_minor, sp_gp: t.split_gp_minor, sp_lp: t.split_lp_minor };
}

test('AngelList vector: a $5K investment returning $100K pays $19K carry at 20%', () => {
  const r = W.european({ carry_ppm: 200000, events: [{ day: '2025-01-01', type: 'contribution', amount_minor: 500000 }, { day: '2026-01-01', type: 'distribution', amount_minor: 10000000 }] });
  assert.equal(r.gp_minor, 1900000);
  assert.equal(r.gp_minor, X.angellist.gp);
  assert.equal(r.lp_minor, X.angellist.lp);
  assert.equal(r.estimate, true);
});

test('European with an 8% hurdle and a full catch-up', () => {
  const r = W.european({ carry_ppm: 200000, hurdle_ppm: 80000, catchup_ppm: 1000000, events: ONE_YEAR });
  assert.deepEqual(tiersOf(r), X.hurdle_full_catchup.tiers);
  assert.equal(r.gp_minor, 10000000);
  assert.equal(r.lp_minor, 140000000);
  assert.equal(r.rows[0].gp_minor + r.rows[0].lp_minor, 150000000);
});

test('80% catch-up reaches 20% of profit within one minor unit; tiers sum exactly', () => {
  const r = W.european({ carry_ppm: 200000, hurdle_ppm: 80000, catchup_ppm: 800000, events: ONE_YEAR });
  assert.deepEqual(tiersOf(r), X.hurdle_80_catchup.tiers);
  assert.ok(Math.abs(r.gp_minor - 10000000) <= 1);
  assert.equal(r.gp_minor + r.lp_minor, 150000000);
});

test('catch-up cut short by proceeds; hurdle without catch-up; simple vs compound pref', () => {
  const short = W.european({ carry_ppm: 200000, hurdle_ppm: 80000, catchup_ppm: 1000000, events: [ONE_YEAR[0], { day: '2026-01-01', type: 'distribution', amount_minor: 109000000 }] });
  assert.deepEqual(tiersOf(short), X.catchup_short.tiers);
  const hard = W.european({ carry_ppm: 200000, hurdle_ppm: 80000, events: ONE_YEAR });
  assert.deepEqual(tiersOf(hard), X.hurdle_no_catchup.tiers);
  const two = [{ day: '2024-01-01', type: 'contribution', amount_minor: 100000000 }, { day: '2026-01-01', type: 'distribution', amount_minor: 100000000 }];
  const comp = W.european({ carry_ppm: 200000, hurdle_ppm: 80000, catchup_ppm: 1000000, events: two });
  const simp = W.european({ carry_ppm: 200000, hurdle_ppm: 80000, catchup_ppm: 1000000, compounding: 'simple', events: two });
  assert.equal(comp.pref_owed_minor, X.pref_compound_2y.pref_owed);
  assert.equal(simp.pref_owed_minor, X.pref_simple_2y.pref_owed);
  assert.equal(comp.gp_minor, 0);
});

test('several contributions and distributions in day order', () => {
  const r = W.european({
    carry_ppm: 200000,
    hurdle_ppm: 80000,
    catchup_ppm: 1000000,
    events: [
      { day: '2026-06-30', type: 'distribution', amount_minor: 120000000 },
      { day: '2024-01-01', type: 'contribution', amount_minor: 60000000 },
      { day: '2025-06-30', type: 'distribution', amount_minor: 50000000 },
      { day: '2024-07-01', type: 'contribution', amount_minor: 40000000 },
    ],
  });
  assert.deepEqual(tiersOf(r), X.multi.tiers);
  assert.equal(r.gp_minor, 14000000);
  assert.equal(r.gp_minor, Math.round(0.2 * r.profit_minor));
});

test('American: deal-by-deal carry with clawback against the whole fund', () => {
  const r = W.american({
    carry_ppm: 200000,
    deals: [
      { id: 'A', events: [{ day: '2024-01-01', type: 'contribution', amount_minor: 10000 }, { day: '2026-01-01', type: 'distribution', amount_minor: 30000 }] },
      { id: 'B', events: [{ day: '2024-01-01', type: 'contribution', amount_minor: 10000 }] },
    ],
  });
  assert.deepEqual(
    r.deals.map((d) => d.gp_minor),
    [X.american.deal_a_gp, X.american.deal_b_gp],
  );
  assert.equal(r.fund_carry_minor, X.american.fund_gp);
  assert.equal(r.clawback_minor, X.american.clawback);
  assert.equal(r.carry_after_clawback_minor, r.fund_carry_minor);
  assert.equal(r.estimate, true);
});

test('property: tiers always add up to every distribution', () => {
  const r = rng(99);
  for (let k = 0; k < 300; k++) {
    const events = [];
    const n = 1 + Math.floor(r() * 8);
    for (let i = 0; i < n; i++) {
      const day = new Date(Date.UTC(2020, 0, 1) + Math.floor(r() * 2500) * 86400000).toISOString().slice(0, 10);
      events.push({ day: day, type: r() < 0.5 ? 'contribution' : 'distribution', amount_minor: Math.floor(r() * 1e10) });
    }
    const res = W.european({ carry_ppm: 200000, hurdle_ppm: r() < 0.5 ? 80000 : null, catchup_ppm: r() < 0.5 ? 1000000 : null, events: events });
    for (const row of res.rows) assert.equal(row.gp_minor + row.lp_minor, row.amount_minor);
    assert.equal(res.gp_minor + res.lp_minor, res.distributed_minor);
    assert.ok(res.gp_minor >= 0);
  }
});

test('refusals', () => {
  assert.throws(() => W.european({ carry_ppm: 200000, catchup_ppm: 150000, events: [] }), code('invalid_ppm'));
  assert.throws(() => W.european({ carry_ppm: 2000000, events: [] }), code('invalid_ppm'));
  assert.throws(() => W.european({ carry_ppm: 200000, events: [{ day: '2026-01-01', type: 'fee', amount_minor: 1 }] }), code('invalid_param'));
  assert.throws(() => W.american({ carry_ppm: 200000, deals: [] }), code('invalid_param'));
});
