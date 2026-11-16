// t05: the committee's pure rules (scales, tally, rules, juniors first, text markers, AI-use counters). node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.VO_APP ?? join(HERE, '..', 'app');
const R = createRequire(import.meta.url)(join(APP, 'pb', 'pb_hooks', 'lib_committee_rules.js'));

const v = (member, choice, extra = {}) => Object.assign({ member, name: member, choice, veto: false, seniority: 5, joined: '2026-01-01' }, extra);

test('scales: no 3 on the default scale; 5 and 6 left out of 1 to 10', () => {
  assert.deepEqual(R.scale('no_three').choices, ['1', '2', '4', '5']);
  assert.throws(() => R.choiceOf('no_three', '3'), (e) => e.code === 'invalid_choice');
  assert.throws(() => R.choiceOf('ten_no_mid', '6'), (e) => e.code === 'invalid_choice');
  assert.equal(R.choiceOf('yes_no', 'YES'), 'yes');
  assert.throws(() => R.scale('nope'), (e) => e.code === 'invalid_scale');
});

test('consensus: every vote for; one against passes', () => {
  assert.equal(R.tally({ scale: 'no_three', rule: 'consensus', votes: [v('a', '4'), v('b', '5')] }).result, 'invest');
  const t = R.tally({ scale: 'no_three', rule: 'consensus', votes: [v('a', '4'), v('b', '2')] });
  assert.equal(t.result, 'pass');
  assert.equal(t.reason, 'not_unanimous');
});

test('champion: the champion decides unless vetoed', () => {
  assert.equal(R.tally({ scale: 'no_three', rule: 'champion', champion: 'a', votes: [v('a', '5'), v('b', '1'), v('c', '1')] }).result, 'invest');
  assert.equal(R.tally({ scale: 'no_three', rule: 'champion', champion: 'a', votes: [v('a', '2'), v('b', '5')] }).result, 'pass');
  assert.equal(R.tally({ scale: 'no_three', rule: 'champion', champion: 'z', votes: [v('a', '5')] }).reason, 'champion_missing');
  assert.equal(R.tally({ scale: 'no_three', rule: 'champion', votes: [v('a', '5')] }).reason, 'no_champion');
  const t = R.tally({ scale: 'no_three', rule: 'champion', champion: 'a', votes: [v('a', '5'), v('b', '4', { veto: true })] });
  assert.equal(t.result, 'pass');
  assert.equal(t.reason, 'vetoed');
});

test('majority: more than half for; a tie passes; a neutral 3 counts neither way', () => {
  assert.equal(R.tally({ scale: 'no_three', rule: 'majority', votes: [v('a', '4'), v('b', '4'), v('c', '1')] }).result, 'invest');
  assert.equal(R.tally({ scale: 'no_three', rule: 'majority', votes: [v('a', '4'), v('b', '1')] }).result, 'pass');
  const t = R.tally({ scale: 'one_to_five', rule: 'majority', votes: [v('a', '4'), v('b', '3'), v('c', '3')] });
  assert.equal(t.neutral, 2);
  assert.equal(t.result, 'pass');
  assert.equal(R.tally({ scale: 'yes_no', rule: 'majority', votes: [v('a', 'yes'), v('b', 'yes'), v('c', 'no')] }).result, 'invest');
});

test('tally counts per choice, missing voters, no votes', () => {
  const t = R.tally({ scale: 'no_three', rule: 'consensus', eligible: 5, votes: [v('a', '4'), v('b', '4'), v('c', '1')] });
  assert.deepEqual(t.choices.map((c) => c.n), [1, 0, 2, 0]);
  assert.equal(t.missing, 2);
  assert.equal(R.tally({ scale: 'no_three', rule: 'consensus', votes: [] }).result, 'none');
});

test('juniors first: seniority, then the newest member, then the name', () => {
  const t = R.tally({ scale: 'no_three', rule: 'majority', votes: [v('owner', '4', { seniority: 8, name: 'Olivia' }), v('p1', '4', { seniority: 7, joined: '2026-02-01', name: 'Paula' }), v('p2', '2', { seniority: 7, joined: '2026-03-01', name: 'Peter' }), v('vp', '5', { seniority: 6, name: 'Vera' })] });
  assert.deepEqual(t.votes.map((x) => x.member), ['vp', 'p2', 'p1', 'owner']);
});

test('markers: [n] citations and [?] uncited figures; the visible length leaves them out', () => {
  const m = R.markers('ARR 1.2M [1], margin 70% [?], churn 2% [12].');
  assert.deepEqual(m.cites, [1, 12]);
  assert.equal(m.uncited, 1);
  assert.equal(m.chars, 'ARR 1.2M , margin 70% , churn 2% .'.length);
});

test('AI-use counters: an edit takes the removed characters off in proportion and adds typed or pasted', () => {
  assert.deepEqual(R.recount({ typed: 0, pasted: 0, agent: 100 }, 'a'.repeat(100), 'a'.repeat(50) + 'XYZ', 0), { typed: 3, pasted: 0, agent: 50 });
  assert.deepEqual(R.recount({ typed: 10, pasted: 0, agent: 0 }, 'hello', 'hello world', 6), { typed: 10, pasted: 6, agent: 0 });
  assert.deepEqual(R.shares({ typed: 1, pasted: 1, agent: 2 }), { typed: 25, pasted: 25, agent: 50, chars: 4 });
});
