// The overtime rules engine (lib_time_rules.js), pure: no server needed.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { APP, eq, ok, section, summary } from './lib.mjs';

const require = createRequire(import.meta.url);
const R = require(join(APP, 'pb', 'pb_hooks', 'lib_time_rules.js'));

const parts = (res, comp) => res.reduce((t, d) => t + d.parts.filter((p) => p.component === comp).reduce((s, p) => s + p.minutes, 0), 0);
const regular = (res) => res.reduce((t, d) => t + d.regular, 0);
const week = (start, mins, kinds) => mins.map((m, i) => ({ day: R.dayAdd(start, i), kind: (kinds && kinds[i]) || 'work', worked: m, night: 0, leave: 0 }));

section('US FLSA: weekly over 40');
{
  const d = R.defaultsFor('US', 'TX');
  const rules = R.normaliseRules(d.rules);
  // Sunday-start week, 5 days of 9h = 45h -> 5h OT
  const res = R.classify(week('2026-11-01', [0, 540, 540, 540, 540, 540, 0]), rules, { week_start: 0 });
  eq(parts(res, 'OT150'), 300, 'weekly overtime 300 minutes');
  eq(regular(res), 2400, 'regular 40 hours');
  eq(res[5].parts[0].minutes, 300, 'overtime lands on the day the 40 hours are passed');
}

section('US-CA: daily, double time and the seventh day');
{
  const rules = R.normaliseRules(R.defaultsFor('US', 'CA').rules);
  // Mon 13h: 8 regular, 4 OT150, 1 OT200
  let res = R.classify(week('2026-11-02', [780]), rules, { week_start: 0 });
  eq(parts(res, 'OT150'), 240, 'over 8 to 12 hours at 1.5');
  eq(parts(res, 'OT200'), 60, 'over 12 hours at 2');
  eq(regular(res), 480, 'first 8 hours regular');
  // Seven days of 8h in a Sunday-start week: day 7 is all 1.5 (first 8h), weekly over 40 not double counted
  res = R.classify(week('2026-11-01', [480, 480, 480, 480, 480, 480, 600]), rules, { week_start: 0 });
  const seventh = res[6];
  eq(seventh.parts.filter((p) => p.when === 'seventh_day').reduce((s, p) => s + p.minutes, 0), 600, 'the seventh day is all overtime');
  eq(seventh.parts.filter((p) => p.component === 'OT200').reduce((s, p) => s + p.minutes, 0), 120, 'beyond 8h on the seventh day at 2x');
  eq(parts(res, 'OT150') + parts(res, 'OT200'), 480 + 600, 'weekly over 40 (8h on day 6) plus the seventh day');
  eq(regular(res), 2400, '40 regular hours');
}

section('JP: daily, weekly, over 60 hours a month, rest day, night');
{
  const rules = R.normaliseRules(R.defaultsFor('JP').rules);
  // A week of 11h a day Mon to Fri (Monday start): 3h daily OT each = 15h
  let res = R.classify(week('2026-11-02', [660, 660, 660, 660, 660, 0, 0]), rules, { week_start: 1 });
  eq(parts(res, 'OT125'), 900, 'daily over 8h at 25%');
  eq(regular(res), 2400, 'regular 40 hours (no weekly overtime on top)');
  // Saturday 8h as a sixth day: weekly over 40 -> OT125; Sunday statutory rest day -> OT135
  res = R.classify(week('2026-11-02', [480, 480, 480, 480, 480, 480, 240], ['work', 'work', 'work', 'work', 'work', 'rest', 'rest']), rules, { week_start: 1 });
  eq(res[5].parts.filter((p) => p.component === 'OT125').reduce((s, p) => s + p.minutes, 0), 480, 'Saturday (not the statutory rest day) is weekly overtime');
  eq(parts(res, 'OT135'), 240, 'Sunday (statutory rest day) at 35%');
  // A month with 70 hours of daily overtime: 10 hours move to OT150
  const days = [];
  for (let i = 0; i < 20; i++) days.push({ day: R.dayAdd('2026-11-02', i + Math.floor(i / 5) * 2), kind: 'work', worked: 690, night: 0, leave: 0 });
  res = R.classify(days.sort((a, b) => (a.day < b.day ? -1 : 1)), rules, { week_start: 1 });
  eq(parts(res, 'OT125') + parts(res, 'OT150'), 20 * 210, '70 hours of overtime in all');
  eq(parts(res, 'OT150'), 20 * 210 - 3600, 'beyond 60 hours a month at 50%');
  // Night premium on top
  res = R.classify([{ day: '2026-11-02', kind: 'work', worked: 600, night: 120, leave: 0 }], rules, { week_start: 1 });
  eq(parts(res, 'NIGHT25'), 120, 'night minutes get the 25% premium');
  eq(regular(res), 480, 'the night premium does not reduce regular minutes');
}

section('MY: public holiday tiers, IN: double time');
{
  const my = R.normaliseRules(R.defaultsFor('MY').rules);
  const res = R.classify([{ day: '2026-08-31', kind: 'holiday', worked: 600, night: 0, leave: 0 }], my, { week_start: 1 });
  eq(parts(res, 'PH200'), 480, 'normal hours on a public holiday at 2x');
  eq(parts(res, 'OT300'), 120, 'beyond normal hours on a public holiday at 3x');
  eq(regular(res), 0, 'nothing regular on a public holiday');
  const inr = R.normaliseRules(R.defaultsFor('IN').rules);
  const r2 = R.classify(week('2026-11-02', [600, 600, 600, 600, 600, 0, 0]), inr, { week_start: 1 });
  eq(parts(r2, 'OT200'), 300, 'India: over 9 hours a day at 2x');
}

section('counts_leave, GB none, defaults for any country');
{
  const rules = R.normaliseRules([{ when: 'weekly_over', threshold_min: 2400, multiplier: 1.5, component: 'OT150' }]);
  const days = week('2026-11-02', [0, 600, 600, 600, 600, 0, 0]);
  days[0].leave = 480;
  eq(parts(R.classify(days, rules, { week_start: 1 }), 'OT150'), 0, 'leave does not count toward 40 hours by default');
  eq(parts(R.classify(days, rules, { week_start: 1, counts_leave: true }), 'OT150'), 480, 'with counts_leave it does');
  eq(R.defaultsFor('GB').rules.length, 0, 'GB has no statutory overtime premium');
  ok(R.defaultsFor('ZZ').rules.length === 0 && R.defaultsFor('ZZ').notes.length > 0, 'an unknown country gets an empty set with a note');
  for (const cc of ['US', 'JP', 'SG', 'IN', 'MY', 'GB', 'AU']) {
    let fine = true;
    try {
      R.normaliseRules(R.defaultsFor(cc, cc === 'US' ? 'CA' : '').rules);
      R.normaliseCaps(R.defaultsFor(cc).caps);
      R.normaliseSettings(R.defaultsFor(cc).settings);
    } catch (e) {
      fine = false;
    }
    ok(fine, cc + ' defaults pass their own checks');
  }
  ok(!/[–—]/.test(JSON.stringify(['US', 'JP', 'SG', 'IN', 'MY', 'GB', 'AU'].map((c) => R.defaultsFor(c)))), 'no en or em dashes in the defaults');
}

section('caps (36 agreement)');
{
  const caps = R.normaliseCaps(R.defaultsFor('JP').caps);
  const months = { '2026-10': { ot: 2000, rest: 0 }, '2026-11': { ot: 2800, rest: 600 } };
  const iss = R.capIssues(caps, months, '2026-11', ['2026-10', '2026-11'], 'blocker');
  ok(iss.some((x) => x.code === 'ot_month_over_warn' && x.severity === 'warning'), 'over 45 hours a month is a warning');
  ok(!iss.some((x) => x.code === 'ot_month_over_limit'), 'under 100 hours with rest-day work: no ceiling issue');
  const iss2 = R.capIssues(caps, { '2026-10': { ot: 5000, rest: 0 }, '2026-11': { ot: 5000, rest: 1200 } }, '2026-11', ['2026-10', '2026-11'], 'blocker');
  ok(iss2.some((x) => x.code === 'ot_month_over_limit' && x.severity === 'blocker'), '100 hours with rest-day work hits the ceiling (blocker as set)');
  ok(iss2.some((x) => x.code === 'ot_average_over_limit'), 'the 2-month average over 80 hours is caught');
}

section('validation');
{
  const bad = (fn, msg) => {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = e.status === 400;
    }
    ok(threw, msg);
  };
  bad(() => R.normaliseRules([{ when: 'sometimes', threshold_min: 0, multiplier: 1.5, component: 'OT150' }]), 'unknown when refused');
  bad(() => R.normaliseRules([{ when: 'night', multiplier: 0.25, component: 'N' }]), 'night needs from and to');
  bad(() => R.normaliseRules([{ when: 'daily_over', threshold_min: 480, multiplier: 1.5, component: 'ot 150' }]), 'bad component code refused');
  bad(() => R.normaliseSettings({ tracking: 'gps' }), 'unknown tracking refused');
  bad(() => R.normaliseSettings({ colour: 'x' }), 'unknown settings key refused');
  bad(() => R.normaliseCaps({ monthly: 1 }), 'unknown caps key refused');
}

const s = summary('t00_rules');
process.exitCode = s.failed > 0 ? 1 : 0;
