// Pure tests of the cohort funnel math (lib_deals_funnel.js): node --test t00_funnel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
const F = createRequire(import.meta.url)(join(APP, 'pb', 'pb_hooks', 'lib_deals_funnel.js'));

const stages = [
  { key: 'a', label: 'A' },
  { key: 'b', label: 'B' },
  { key: 'c', label: 'C' },
  { key: 'd', label: 'D' },
];

test('empty cohort: Inbound and every stage 0, every percentage unknown', () => {
  const r = F.funnel({ stages, cohort: [], inbound: true, counts: {}, moves: [] });
  assert.equal(r.cohort, 0);
  assert.deepEqual(
    r.stages.map((s) => s.key),
    ['inbound', 'a', 'b', 'c', 'd'],
  );
  for (const s of r.stages) {
    assert.equal(s.count, 0);
    assert.equal(s.conversion_ppm, null);
    assert.equal(s.median_days, null);
  }
  assert.equal(r.stages[0].now, null);
  assert.equal(r.stages[1].now, 0);
});

test('one cohort: Inbound 5, then how many of THEM reached each stage; a skipped stage counts as passed', () => {
  // 5 items: 2 never advanced, one reached A only, one skipped from A to C, one reached D.
  const cohort = [
    { id: '1', reached: -1 },
    { id: '2', reached: -1 },
    { id: '3', reached: 0 },
    { id: '4', reached: 2 },
    { id: '5', reached: 3 },
  ];
  const r = F.funnel({ stages, cohort, inbound: true, counts: { a: 7, c: 1 }, moves: [] });
  const [inb, a, b, c, d] = r.stages;
  assert.deepEqual([inb.count, a.count, b.count, c.count, d.count], [5, 3, 2, 2, 1]);
  assert.equal(inb.conversion_ppm, null);
  assert.equal(a.conversion_ppm, 600000); // 3 of 5
  assert.equal(b.conversion_ppm, 666667); // 2 of 3
  assert.equal(c.conversion_ppm, 1000000); // 2 of 2
  assert.equal(d.conversion_ppm, 500000); // 1 of 2
  assert.deepEqual([a.now, b.now, c.now, d.now], [7, 0, 1, 0]); // deals in the stage now, apart from the cohort
});

test('bars only shrink and no percentage passes 100%', () => {
  const cohort = [];
  for (let i = 0; i < 40; i++) cohort.push({ id: String(i), reached: (i * 7) % 5 - 1 });
  const r = F.funnel({ stages, cohort, inbound: true, counts: {}, moves: [] });
  for (let i = 1; i < r.stages.length; i++) {
    assert.ok(r.stages[i].count <= r.stages[i - 1].count);
    if (r.stages[i].conversion_ppm !== null) assert.ok(r.stages[i].conversion_ppm <= 1000000);
  }
});

test('a bar after an empty bar has no percentage; without inbound the first stage bar has none', () => {
  const r = F.funnel({ stages, cohort: [{ id: 'x', reached: 0 }], inbound: false, counts: {}, moves: [] });
  assert.equal(r.stages[0].key, 'a');
  assert.equal(r.stages[0].count, 1);
  assert.equal(r.stages[0].conversion_ppm, null);
  assert.equal(r.stages[1].conversion_ppm, 0);
  assert.equal(r.stages[2].conversion_ppm, null); // the bar before is 0
});

test('median days in stage from the moves out of it in the period (lower middle)', () => {
  const moves = [
    { from_stage: 'a', days_in_from: 7 },
    { from_stage: 'a', days_in_from: 10 },
    { from_stage: 'c', days_in_from: 3.4 },
    { from_stage: 'zz', days_in_from: 99 },
  ];
  const r = F.funnel({ stages, cohort: [], inbound: true, counts: {}, moves });
  const by = Object.fromEntries(r.stages.map((s) => [s.key, s]));
  assert.equal(by.a.median_days, 7);
  assert.equal(by.b.median_days, null);
  assert.equal(by.c.median_days, 3);
  assert.equal(by.inbound.median_days, null);
});

test('quarters', () => {
  assert.deepEqual(F.quarterOf('2026-11-12'), { key: '2026-Q4', start_day: '2026-10-01', end_day: '2027-01-01' });
  assert.deepEqual(F.parseQuarter('2026-Q1'), { key: '2026-Q1', start_day: '2026-01-01', end_day: '2026-04-01' });
  assert.equal(F.parseQuarter('2026-Q5'), null);
});
