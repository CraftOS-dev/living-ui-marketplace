import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eng, expected, code } from './_load.mjs';

const D = eng('lib_eng_days');
const X = expected.days;
const FRI_SAT = [5, 6];
const XMAS = ['2026-12-25', '2027-01-01'];

test('every zone matches the IANA database at each 2025 to 2027 transition', () => {
  assert.equal(Object.keys(D.ZONES).length, X.zone_count);
  const bad = [];
  for (const ch of X.zone_checks) {
    const off = D.offsetMinutes(ch.zone, ch.at);
    const day = D.localDay(ch.zone, ch.at);
    if (off !== ch.offset || day !== ch.day) bad.push(ch.zone + ' ' + ch.at + ' got ' + off + '/' + day + ' want ' + ch.offset + '/' + ch.day);
  }
  assert.deepEqual(bad, []);
  assert.ok(X.zone_checks.length > 800);
});

test('reply SLA across zone edges: the same instant is Friday in Tokyo, Thursday in New York', () => {
  const tokyo = D.slaDue({ received_at: '2026-11-12T23:30:00Z', zone: 'Asia/Tokyo', days: 5 });
  const ny = D.slaDue({ received_at: '2026-11-12T23:30:00Z', zone: 'America/New_York', days: 5 });
  assert.deepEqual(tokyo, { received_day: X.tokyo_received, due_day: X.tokyo_due, days: 5 });
  assert.deepEqual(ny, { received_day: X.ny_received, due_day: X.ny_due, days: 5 });
});

test('weekends: Saturday receipt, a Friday-Saturday weekend, holidays', () => {
  assert.equal(D.addBusinessDays('2026-11-14', 5), X.sat_due);
  assert.equal(D.addBusinessDays('2026-11-12', 5, { weekend: FRI_SAT }), X.frisat_due);
  assert.equal(D.addBusinessDays('2026-12-22', 5, { holidays: XMAS }), X.holiday_due);
  assert.equal(D.addBusinessDays('2026-12-18', 10, { holidays: XMAS }), X.ten_bd_due);
  assert.equal(D.addBusinessDays('2026-11-16', -1), '2026-11-13');
  assert.equal(D.addBusinessDays('2026-11-14', 0), '2026-11-14');
  assert.equal(D.isBusinessDay('2026-11-13', { weekend: FRI_SAT }), false);
  assert.equal(D.isBusinessDay('2026-11-15', { weekend: FRI_SAT }), true);
});

test('business days between', () => {
  assert.equal(D.businessDaysBetween('2026-11-13', '2026-11-16'), X.between_fri_mon);
  assert.equal(D.businessDaysBetween('2026-11-01', '2026-11-30'), X.between_month);
  assert.equal(D.businessDaysBetween('2026-12-20', '2027-01-05', { holidays: XMAS }), X.between_holidays);
  assert.equal(D.businessDaysBetween('2026-11-16', '2026-11-13'), -X.between_fri_mon);
});

test('SLA state: open, due today, overdue', () => {
  assert.deepEqual(D.slaState({ due_day: '2026-11-19', today: '2026-11-16' }), { state: 'open', business_days_left: 3 });
  assert.deepEqual(D.slaState({ due_day: '2026-11-19', today: '2026-11-19' }), { state: 'due_today', business_days_left: 0 });
  assert.deepEqual(D.slaState({ due_day: '2026-11-19', today: '2026-11-23' }), { state: 'overdue', business_days_left: -2 });
});

test('stall: days in stage are local; the zone decides whether day 8 has come', () => {
  const input = { entered_at: '2026-11-01T14:30:00Z', now: '2026-11-08T15:30:00Z', stall_days: 7 };
  const utc = D.stall(Object.assign({ zone: 'UTC' }, input));
  const tokyo = D.stall(Object.assign({ zone: 'Asia/Tokyo' }, input));
  assert.equal(utc.days_in_stage, 7);
  assert.equal(utc.stalled, false);
  assert.equal(tokyo.days_in_stage, 8);
  assert.equal(tokyo.stalled, true);
  assert.equal(tokyo.stalls_on, '2026-11-09');
  assert.equal(X.stall_tokyo_now, '2026-11-09');
  assert.equal(X.stall_utc_now, '2026-11-08');
  const never = D.stall({ zone: 'UTC', entered_at: '2020-01-01T00:00:00Z', now: '2026-11-08T00:00:00Z', stall_days: 0 });
  assert.equal(never.stalled, false);
  assert.equal(never.stalls_on, null);
});

test('refusals: unknown zone, bad weekend, bad day', () => {
  assert.throws(() => D.localDay('Mars/Olympus', '2026-11-12T00:00:00Z'), code('invalid_timezone'));
  assert.throws(() => D.addBusinessDays('2026-11-12', 1, { weekend: [0, 1, 2, 3, 4, 5, 6] }), code('invalid_calendar'));
  assert.throws(() => D.addBusinessDays('2026-11-12', 1, { weekend: [7] }), code('invalid_calendar'));
  assert.throws(() => D.addBusinessDays('2026-11-31', 1), code('invalid_day'));
  assert.equal(D.isZone('Europe/Luxembourg'), true);
  assert.equal(D.today('Asia/Tokyo', '2026-11-12T15:00:00Z'), '2026-11-13');
});
