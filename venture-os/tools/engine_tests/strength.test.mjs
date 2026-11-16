import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, expected, rng, code } from './_load.mjs';

const S = eng('lib_eng_strength');
const NOW = '2026-11-12T00:00:00Z';
const ago = (days) => new Date(Date.parse(NOW) - days * 86400000).toISOString();

// The CRM's own function (crm_9f859ca6 lib_interactions.js lines 15 to 37), ported verbatim.
const CRM_WEIGHT = { meeting: 3, call: 2, email_in: 1.5, email_out: 1, email: 1, message: 1 };
function crmWeight(kind, direction) {
  if (kind === 'email') return direction === 'in' ? CRM_WEIGHT.email_in : CRM_WEIGHT.email_out;
  return CRM_WEIGHT[kind] || 1;
}
function crmStrengthOf(rows, now) {
  let s = 0;
  for (const r of rows) {
    const t = Date.parse(String(r.at).replace(' ', 'T'));
    if (!isFinite(t)) continue;
    const age = Math.max(0, (now - t) / 86400000);
    if (age > 365) continue;
    s += crmWeight(r.kind, r.direction) * Math.pow(0.5, age / 60);
  }
  return Math.round(100 * (1 - Math.exp(-s / 3)));
}

test('weights: meeting 3, call 2, email in 1.5, email out 1, message 1', () => {
  assert.equal(S.weightOf('meeting'), 3);
  assert.equal(S.weightOf('call'), 2);
  assert.equal(S.weightOf('email', 'in'), 1.5);
  assert.equal(S.weightOf('email', 'out'), 1);
  assert.equal(S.weightOf('message', 'in'), 1);
  assert.throws(() => S.weightOf('email'), code('invalid_touch'));
  assert.throws(() => S.weightOf('lunch'), code('invalid_touch'));
});

test('display 100 x (1 - e^(-s/3)) and the 60-day half-life', () => {
  assert.equal(S.score([{ kind: 'meeting', at: NOW }], NOW).score, expected.strength.meeting_today);
  assert.equal(S.score([{ kind: 'meeting', at: ago(60) }], NOW).score, expected.strength.meeting_60d);
  assert.equal(S.decayed(3, 120), 0.75);
  assert.equal(S.display(0), 0);
});

test('mixed touches match the independent sum; old and future touches do not count', () => {
  const touches = [
    { kind: 'meeting', at: NOW },
    { kind: 'call', at: ago(30) },
    { kind: 'email', direction: 'in', at: ago(60) },
    { kind: 'email', direction: 'out', at: ago(120) },
    { kind: 'message', direction: 'out', at: ago(400) },
    { kind: 'meeting', at: ago(-5) },
  ];
  const r = S.score(touches, NOW);
  assert.ok(Math.abs(r.s - expected.strength.s) < 1e-9);
  assert.equal(r.score, expected.strength.score);
  assert.equal(r.counted, 4);
  assert.equal(r.last_at, new Date(Date.parse(NOW)).toISOString());
  assert.equal(r.band, 'strong');
});

test('bands', () => {
  assert.equal(S.band(60), 'strong');
  assert.equal(S.band(59), 'good');
  assert.equal(S.band(30), 'good');
  assert.equal(S.band(29), 'weak');
  assert.equal(S.band(1), 'weak');
  assert.equal(S.band(0), 'none');
});

test("CRM's own function agrees on 300 random past touch sets", () => {
  const r = rng(7);
  const kinds = ['meeting', 'call', 'email', 'message'];
  for (let k = 0; k < 300; k++) {
    const n = Math.floor(r() * 12);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const kind = kinds[Math.floor(r() * 4)];
      rows.push({ kind: kind, direction: r() < 0.5 ? 'in' : 'out', at: ago(Math.floor(r() * 500)) });
    }
    assert.equal(S.score(rows, NOW).score, crmStrengthOf(rows, Date.parse(NOW)));
  }
});

test('edges group by member and person; best picks the strongest, then the most recent', () => {
  const ints = [
    { member: 'm1', people: ['p1', 'p2'], kind: 'meeting', at: ago(1) },
    { member: 'm1', people: ['p1'], kind: 'email', direction: 'in', at: ago(10) },
    { member: 'm2', people: ['p2'], kind: 'meeting', at: ago(1) },
    { member: 'm2', people: ['p3'], kind: 'call', at: ago(200) },
  ];
  const e = S.edges(ints, NOW);
  assert.deepEqual(
    e.map((x) => x.member + '-' + x.person),
    ['m1-p1', 'm1-p2', 'm2-p2', 'm2-p3'],
  );
  assert.equal(e[1].score, e[2].score);
  // Company strength over its people p2 and p3: the strongest member-to-person edge.
  const company = S.best(e.filter((x) => x.person === 'p2' || x.person === 'p3'));
  assert.equal(company.member, 'm1');
  assert.equal(company.person, 'p2');
  const tie = S.best([
    { member: 'a', person: 'x', score: 50, last_at: ago(30) },
    { member: 'b', person: 'x', score: 50, last_at: ago(3) },
  ]);
  assert.equal(tie.member, 'b');
  assert.deepEqual(S.best([]), { score: 0, band: 'none', member: null, person: null, last_at: null });
});
