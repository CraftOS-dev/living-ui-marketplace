import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eng, engineFiles, HOOKS, code } from './_load.mjs';

const c = eng('lib_eng_core');

test('every engine file is pure and Goja-safe', () => {
  const files = engineFiles();
  assert.equal(files.length, 14);
  for (const f of files) {
    const src = readFileSync(HOOKS + f, 'utf8');
    for (const bad of ['$app', '$os', '$http', '$filesystem', 'e.app', 'Intl.', 'Date.now(', 'Math.random(', 'callLLM', 'agent_requests']) {
      assert.ok(!src.includes(bad), f + ' uses ' + bad);
    }
    assert.ok(!/https?:\/\//.test(src), f + ' holds a URL literal (the gate counts it as egress)');
    const dashes = String.fromCharCode(0x2013) + String.fromCharCode(0x2014);
    assert.ok(!src.split('').some((ch) => dashes.indexOf(ch) >= 0), f + ' holds an en or em dash');
    assert.ok(!/\?\.|\?\?/.test(src), f + ' uses optional chaining or nullish coalescing');
    assert.ok(!/\(\?[=!<]/.test(src), f + ' uses a lookaround regex');
    assert.ok(!/\b\d+n\b/.test(src), f + ' uses a BigInt literal');
    assert.ok(/module\.exports = \{/.test(src), f + ' exports with module.exports');
  }
});

test('mulDiv rounds half away from zero, exactly past 2^53', () => {
  assert.equal(c.mulDiv(5, 1, 2), 3);
  assert.equal(c.mulDiv(-5, 1, 2), -3);
  assert.equal(c.mulDiv(4, 1, 3), 1);
  assert.equal(c.mulDiv(-4, 1, 3), -1);
  assert.equal(c.mulDiv('900000000000000000', 3, '1000000000000'), 2700000);
  assert.equal(c.divFloor(BigInt(-7), BigInt(2)), BigInt(-4));
});

test('big() takes integers and digit strings, refuses the rest', () => {
  assert.equal(c.big('123', 'x'), BigInt(123));
  assert.equal(c.big(-4, 'x'), BigInt(-4));
  assert.throws(() => c.big(1.5, 'x'), code('invalid_number'));
  assert.throws(() => c.big('1e5', 'x'), code('invalid_number'));
  assert.throws(() => c.big(2 ** 60, 'x'), code('out_of_range'));
  assert.throws(() => c.bigPos(-1, 'x'), code('invalid_number'));
});

test('largest remainder: ties go to the larger weight, then the earlier line', () => {
  const r = c.largestRemainder(BigInt(10000), [BigInt(1), BigInt(1), BigInt(1)]).map(Number);
  assert.deepEqual(r, [3334, 3333, 3333]);
  const s = c.largestRemainder(BigInt(10), [BigInt(1), BigInt(2), BigInt(2)]).map(Number);
  assert.deepEqual(s, [2, 4, 4]);
  const n = c.largestRemainder(BigInt(-10), [BigInt(1), BigInt(1), BigInt(1)]).map(Number);
  assert.deepEqual(n, [-4, -3, -3]);
  assert.throws(() => c.largestRemainder(BigInt(5), [BigInt(0)]), code('no_weights'));
});

test('days: validation, month ends, weekdays', () => {
  assert.equal(c.isDay('2026-02-29'), false);
  assert.equal(c.isDay('2028-02-29'), true);
  assert.throws(() => c.dayNum('2026-13-01'), code('invalid_day'));
  assert.equal(c.monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(c.monthEndAfter('2026-01-31', 1), '2026-02-28');
  assert.equal(c.monthEndAfter('2026-03-31', -3), '2025-12-31');
  assert.equal(c.weekday('2026-11-12'), 4);
  assert.equal(c.diffDays('2024-01-01', '2024-07-01'), 182);
  assert.equal(c.instant('2026-11-12 09:00:00.000Z'), Date.UTC(2026, 10, 12, 9));
  assert.throws(() => c.instant('yesterday'), code('invalid_time'));
});

test('currency exponents and conversion', () => {
  assert.equal(c.exponent('JPY'), 0);
  assert.equal(c.exponent('KWD'), 3);
  assert.equal(c.exponent('usd'), 2);
  assert.throws(() => c.exponent('US'), code('invalid_currency'));
  assert.equal(c.convertMinor(100000, 'EUR', 'JPY', 16000000000), 160000);
  assert.equal(c.convertMinor(160000, 'JPY', 'EUR', 625000), 100000);
});
