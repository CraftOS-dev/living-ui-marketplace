import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, code } from './_load.mjs';

const P = eng('lib_eng_paths');

// Three members (m1..m3), ten contacts (p1..p10); the target company's people are p9 and p10.
const FIXTURE = {
  targets: ['p9', 'p10'],
  member_edges: [
    { member: 'm1', person: 'p9', score: 45, last_at: '2026-10-01T00:00:00Z' },
    { member: 'm2', person: 'p10', score: 45, last_at: '2026-11-01T00:00:00Z' },
    { member: 'm3', person: 'p9', score: 20, last_at: '2026-11-10T00:00:00Z' },
    { member: 'm1', person: 'p1', score: 80, last_at: '2026-11-05T00:00:00Z' },
    { member: 'm2', person: 'p2', score: 90, last_at: '2026-11-01T00:00:00Z' },
    { member: 'm3', person: 'p3', score: 30, last_at: '2026-11-02T00:00:00Z' },
    { member: 'm1', person: 'p4', score: 60, last_at: '2026-11-03T00:00:00Z' },
    { member: 'm2', person: 'p6', score: 0, last_at: '2025-01-01T00:00:00Z' },
    { member: 'm3', person: 'p7', score: 55, last_at: '2026-10-20T00:00:00Z' },
    { member: 'm1', person: 'p8', score: 75, last_at: '2026-11-11T00:00:00Z' },
  ],
  links: [
    { a: 'p1', b: 'p9', score: 70, last_at: '2026-09-01T00:00:00Z' },
    { a: 'p10', b: 'p2', score: 70, last_at: '2026-10-15T00:00:00Z' },
    { a: 'p3', b: 'p9', score: 95, last_at: '2026-10-30T00:00:00Z' },
    { a: 'p4', b: 'p5', score: 90, last_at: '2026-10-30T00:00:00Z' },
    { a: 'p6', b: 'p10', score: 80, last_at: '2026-10-30T00:00:00Z' },
    { a: 'p7', b: 'p10', score: 55, last_at: '2026-10-25T00:00:00Z' },
    { a: 'p9', b: 'p10', score: 99, last_at: '2026-10-30T00:00:00Z' },
  ],
};

test('three members, ten contacts: direct first, then weakest edge, then recency', () => {
  const r = P.rank(FIXTURE);
  assert.deepEqual(
    r.map((x) => x.path.map((n) => n.member || n.person).join('>')),
    ['m2>p10', 'm1>p9', 'm3>p9', 'm2>p2>p10', 'm1>p1>p9', 'm3>p7>p10', 'm3>p3>p9'],
  );
  assert.deepEqual(
    r.map((x) => x.weakest),
    [45, 45, 20, 70, 70, 55, 30],
  );
  // A one-hop path's contact day is its stalest edge.
  assert.equal(r[3].last_at, '2026-10-15T00:00:00Z');
  assert.equal(r[4].last_at, '2026-09-01T00:00:00Z');
  assert.equal(r[0].kind, 'direct');
  assert.equal(r[3].kind, 'one_hop');
  assert.equal(r[3].connector, 'p2');
});

test('limit, empty input and bad edges', () => {
  assert.equal(P.rank(Object.assign({}, FIXTURE, { limit: 2 })).length, 2);
  assert.deepEqual(P.rank({ targets: ['x'], member_edges: [], links: [] }), []);
  assert.throws(() => P.rank({ targets: ['x'], member_edges: [{ member: 'm', person: 'x', score: 120 }] }), code('invalid_edge'));
  assert.throws(() => P.rank({ targets: ['x'], member_edges: [{ person: 'x', score: 10 }] }), code('invalid_edge'));
});
