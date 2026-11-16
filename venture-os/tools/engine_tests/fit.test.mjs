import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, code } from './_load.mjs';

const F = eng('lib_eng_fit');

const CRITERIA = [
  { key: 'stage', op: 'in', values: ['pre_seed', 'seed'], required: true },
  { key: 'raise_minor', op: 'between', min: 100000000, max: 500000000, currency: 'USD', required: true },
  { key: 'hq_country', op: 'in', values: ['US', 'CA'] },
  { key: 'technical_founder', op: 'bool', value: true, required: true },
  { key: 'arr_minor', op: 'gte', value: 50000000, currency: 'USD' },
  { key: 'lead_investor', op: 'exists' },
  { key: 'team_size', op: 'lte', value: 20 },
];

const FACTS = {
  stage: { value: 'Seed', grade: 'artifact' },
  raise_minor: { value: 300000000, grade: 'artifact' },
  currency: { value: 'USD', grade: 'artifact' },
  technical_founder: { value: true, grade: 'unknown' },
  arr_minor: { value: 30000000, grade: 'founder_reported' },
  lead_investor: { value: '', grade: 'artifact' },
  team_size: { value: 12, grade: 'public' },
};

test('tri-state: a required unknown stays unknown, never unmet', () => {
  const r = F.fit(CRITERIA, FACTS);
  assert.deepEqual(
    r.checks.map((c) => c.key + ':' + c.status),
    ['stage:met', 'raise_minor:met', 'hq_country:unknown', 'technical_founder:unknown', 'arr_minor:unmet', 'lead_investor:unmet', 'team_size:met'],
  );
  assert.deepEqual(r.counts, { met: 3, unmet: 2, unknown: 2 });
  assert.deepEqual(r.required, { met: 2, unmet: 0, unknown: 1, state: 'unknown' });
  assert.equal(r.checks[2].reason, 'missing');
  assert.equal(r.checks[5].reason, 'empty');
  assert.equal(r.score, undefined);
});

test('a required unmet criterion makes the state unmet', () => {
  const facts = Object.assign({}, FACTS, { raise_minor: { value: 800000000, grade: 'artifact' } });
  const r = F.fit(CRITERIA, facts);
  assert.equal(r.checks[1].status, 'unmet');
  assert.equal(r.required.state, 'unmet');
});

test('all required met gives met; no facts give unknown, not unmet', () => {
  const facts = Object.assign({}, FACTS, { technical_founder: { value: true, grade: 'artifact' } });
  assert.equal(F.fit(CRITERIA, facts).required.state, 'met');
  const none = F.fit(CRITERIA, {});
  assert.deepEqual(none.counts, { met: 0, unmet: 0, unknown: 7 });
  assert.equal(none.required.state, 'unknown');
});

test('money in another currency converts through fx, or stays unknown', () => {
  const facts = Object.assign({}, FACTS, { currency: { value: 'EUR', grade: 'artifact' } });
  assert.equal(F.fit(CRITERIA, facts).checks[1].reason, 'no_rate');
  const fx = (from, to) => (from === 'EUR' && to === 'USD' ? 110000000 : null);
  const r = F.fit(CRITERIA, facts, { fx: fx });
  assert.equal(r.checks[1].status, 'met');
  assert.equal(r.checks[1].value, 330000000);
  const nocur = Object.assign({}, FACTS, { currency: { value: null } });
  assert.equal(F.fit(CRITERIA, nocur).checks[1].reason, 'currency_unknown');
});

test('operators eq, gte, lte, exists, bool; bad fact values are unknown', () => {
  const crit = [
    { key: 'business_model', op: 'eq', value: 'saas' },
    { key: 'founded_year', op: 'gte', value: 2020 },
    { key: 'runway_months', op: 'lte', value: 18 },
    { key: 'prior_exit', op: 'exists' },
    { key: 'product_live', op: 'bool', value: false },
    { key: 'customers', op: 'in', values: [1, 2, 3] },
    { key: 'sector', op: 'in', values: ['fintech'] },
  ];
  const facts = {
    business_model: { value: 'SaaS' },
    founded_year: { value: 2019 },
    runway_months: { value: 14.5 },
    prior_exit: { value: false },
    product_live: { value: 'no' },
    customers: { value: 2 },
    sector: { value: ['ai', 'fintech'] },
  };
  assert.deepEqual(
    F.fit(crit, facts).checks.map((c) => c.status),
    ['met', 'unmet', 'met', 'met', 'unknown', 'met', 'met'],
  );
});

test('criteria are validated against the fact vocabulary', () => {
  assert.equal(F.FACT_KEYS.length, 25);
  assert.throws(() => F.validate([{ key: 'vibes', op: 'eq', value: 'good' }]), code('invalid_criterion'));
  assert.throws(() => F.validate([{ key: 'stage', op: 'gte', value: 3 }]), code('invalid_criterion'));
  assert.throws(() => F.validate([{ key: 'raise_minor', op: 'gte', value: 5 }]), code('invalid_currency'));
  assert.throws(() => F.validate([{ key: 'team_size', op: 'between', min: 9, max: 3 }]), code('invalid_criterion'));
  assert.throws(() => F.validate([{ key: 'stage', op: 'in', values: [] }]), code('invalid_criterion'));
  assert.deepEqual(F.validate([{ key: 'stage', op: 'eq', value: 'seed', required: 1 }]), [{ key: 'stage', op: 'eq', required: false, value: 'seed' }]);
});
