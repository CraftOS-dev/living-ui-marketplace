// The company globe in home.admin (lib_home_globe.js), on the seeded company of seed_reports.mjs (run t02 first:
// it adds the Singapore-only HR member):
//   node t04_globe.mjs            (HR_PORT 3190, HR_APP as lib.mjs)
// Offices per entity with coordinates, zones and counts that add up; a clock-in now counts as in now and live;
// one entity in scope turns the globe to locations; time, pay and scope rights; next pay day and this month's
// payroll; a centre for every country the app has; and the read stays fast.
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { AGENT, APP, DEMO, newApi, ok, OWNER, PIN, section, summary } from './lib.mjs';

const api = newApi();
const require = createRequire(import.meta.url);

section('country and region centres');
{
  const geo = require(join(APP, 'pb', 'pb_hooks', 'lib_home_geo.js'));
  const codes = readdirSync(join(APP, 'pb', 'pb_hooks', 'data', 'countries')).filter((f) => /^[a-z]{2}\.js$/.test(f)).map((f) => f.slice(0, 2).toUpperCase());
  const missing = codes.filter((c) => geo.centre(c, '') === null);
  ok(codes.length > 0 && missing.length === 0, `every country in data/countries has a centre (${codes.length}; missing: ${missing.join(', ') || 'none'})`);
  const regions = [];
  for (const c of codes) {
    const data = require(join(APP, 'pb', 'pb_hooks', 'data', 'countries', c.toLowerCase() + '.js'));
    for (const r of data.regions || []) {
      const x = geo.centre(c, r.code);
      if (x === null || x.source !== 'region') regions.push(c + '-' + r.code);
    }
  }
  ok(regions.length === 0 || regions.every((x) => ['US', 'CA', 'AU', 'GB', 'IN', 'JP', 'MY'].indexOf(x.slice(0, 2)) < 0), 'the regions of the countries with a region table all resolve: ' + (regions.slice(0, 5).join(', ') || 'all'));
  const ca = geo.centre('US', 'CA');
  ok(ca !== null && ca.lat > 32 && ca.lat < 42 && ca.lng < -114 && ca.lng > -125, 'US-CA sits in California');
}

section('offices of the owner (four entities)');
const ents = (await api.op('entities.list', {}, OWNER)).entities;
let h = await api.op('home.admin', {}, OWNER);
let g = h.globe;
ok(g !== null && g.mode === 'entities' && g.offices.length === ents.length, `one office per entity (${g?.offices.length} of ${ents.length})`);
ok(g.offices.every((o) => o.lat >= -90 && o.lat <= 90 && o.lng >= -180 && o.lng <= 180 && !(o.lat === 0 && o.lng === 0) && o.timezone !== ''), 'every office has coordinates and a time zone');
ok(g.offices.every((o) => o.source === 'location'), 'offices with a located office sit at its coordinates');
ok(g.head === 'e:' + ents[0].id, 'the head office is the first entity');
const heads = g.offices.reduce((a, o) => a + o.headcount, 0);
ok(heads >= h.readouts.headcount && heads > 0, `office headcounts cover the company (${heads} for ${h.readouts.headcount})`);
ok(g.offices.every((o) => o.in_now + o.remote + o.on_leave <= o.headcount + 1), 'in now, remote and on leave fit inside each office');
ok(g.totals.open_roles === h.readouts.open_roles, `open roles add up to the readout (${g.totals.open_roles})`);
ok(g.time_visible === true && typeof g.totals.in_now === 'number', 'the owner sees who is in');
const minPay = h.pay.schedules.map((s) => s.pay_date).sort()[0];
ok(g.next_pay !== null && g.next_pay.day === minPay && Number.isFinite(Date.parse(g.next_pay.at)), `next pay run is the soonest schedule (${g.next_pay?.day})`);
ok(g.payroll_month !== null && g.payroll_month.month === h.today.slice(0, 7) && g.payroll_month.runs >= 0 && (g.payroll_month.minor === null || g.payroll_month.minor >= 0), 'payroll this month, in ' + g.payroll_month?.currency + ': ' + g.payroll_month?.minor);

section('the office view (floors)');
{
  const fl = g.floors;
  ok(Array.isArray(fl) && fl.length === ents.length && fl.every((f, i) => f.entity === ents[i].id), `one floor per entity, head first (${fl?.length})`);
  ok(fl.every((f) => /^\d\d:\d\d$/.test(f.local_time) && f.timezone !== ''), 'every floor has its time zone and local time');
  const drawn = fl.reduce((a, f) => a + f.departments.reduce((b, d) => b + d.people.length, 0), 0);
  ok(drawn + fl.reduce((a, f) => a + f.more, 0) === fl.reduce((a, f) => a + f.headcount, 0) && drawn <= 300, `people on floors add up to the headcount (${drawn} drawn)`);
  const states = new Set(['in_now', 'remote', 'on_leave', 'late', 'not_in', 'unknown']);
  const people = fl.flatMap((f) => f.departments.flatMap((d) => d.people));
  ok(people.every((x) => states.has(x.state) && /^E\d+/.test(x.id) && x.name !== ''), 'every person has an employee number, a name and a state');
  ok(fl.every((f) => f.in_now === f.departments.reduce((a, d) => a + d.people.filter((x) => x.state === 'in_now').length, 0) + 0 || f.more > 0), 'in now per floor matches its people');
  ok(people.filter((x) => x.state === 'in_now').every((x) => x.since_min === null || x.since_min >= 0) && people.filter((x) => x.state !== 'in_now').every((x) => x.since_min === null), 'minutes since clock-in only for people in now');
  ok(fl.every((f) => f.departments.every((d, i, a) => i === 0 || d.id === '' || a[i - 1].id === '' || a[i - 1].name <= d.name)), 'rooms in name order');
}

section('a clock-in now');
{
  const sgEnt = ents.find((e) => e.name === 'Northwind Pte Ltd');
  const board = await api.op('attendance.board', { entity: sgEnt.id }, OWNER);
  const p = board.people.find((x) => x.state !== 'in' && x.state !== 'break' && x.state !== 'on_leave' && x.state !== 'remote' && x.state !== 'off' && x.state !== 'out');
  const before = g.offices.find((o) => o.entity === sgEnt.id);
  if (p === undefined) ok(true, 'nobody left to clock in (skipped)');
  else {
    const now = new Intl.DateTimeFormat('en-GB', { timeZone: sgEnt.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const r = await api.call('checkins.add', { employment: p.employment, day: board.today, time: now, kind: 'in', note: 'Globe test: clocked in now' }, OWNER);
    ok(r.status === 200, 'HR adds a clock-in at the current time');
    h = await api.op('home.admin', {}, OWNER);
    g = h.globe;
    const after = g.offices.find((o) => o.entity === sgEnt.id);
    ok(after.in_now === before.in_now + 1 && after.ins_recent >= before.ins_recent + 1 && after.last_in >= before.last_in, `in now ${before.in_now} to ${after.in_now}, clock-ins of the last half hour ${before.ins_recent} to ${after.ins_recent}`);
    const desk = g.floors.flatMap((f) => f.departments.flatMap((d) => d.people)).find((x) => x.name === p.name);
    ok(desk !== undefined && desk.state === 'in_now' && desk.since_min !== null && desk.since_min <= 2, 'their desk turns in now, clocked in minutes ago (they walk in from the lift): ' + JSON.stringify(desk));
  }
}

section('scope, time and pay rights');
{
  const sgHome = await api.call('home.admin', {}, { as: 'sg.hr@northwind.test' });
  if (sgHome.status !== 200) ok(false, 'the Singapore-only HR member (made by t02) reads Home');
  else {
    const sg = sgHome.body.globe;
    ok(sg.mode === 'locations' && sg.offices.every((o) => o.entity_name === 'Northwind Pte Ltd'), 'one entity in scope: the globe shows its locations only');
    ok(sg.floors.length === 1 && sg.floors[0].name === 'Northwind Pte Ltd', 'and the office view one floor');
    ok(sg.offices.reduce((a, o) => a + o.headcount, 0) === sgHome.body.readouts.headcount, 'and they hold its people');
  }
  const inv = await api.call('members.invite', { email: 'finance.globe@northwind.test', name: 'Fin Globe', role: 'finance' }, PIN);
  if (inv.status === 200) await api.op('auth.accept-invite', { email: 'finance.globe@northwind.test', code: inv.body.code, password: DEMO.password });
  const FIN = { as: 'finance.globe@northwind.test' };
  const me = await api.op('auth.me', {}, FIN);
  const fin = await api.call('home.admin', {}, FIN);
  if (fin.status === 200) {
    const tv = me.owner === true || ['view', 'edit', 'full'].indexOf(me.levels.time) >= 0;
    const fg = fin.body.globe;
    ok(fg.time_visible === tv && (tv || (fg.totals.in_now === null && fg.offices.every((o) => o.in_now === null && o.remote === null))), `finance (time ${me.levels.time}): in now ${tv ? 'shown' : 'hidden'}`);
    ok(tv || fg.floors.every((f) => f.in_now === null && f.departments.every((d) => d.people.every((x) => x.state === 'unknown' || x.state === 'on_leave'))), 'without Time the desks say unknown (or on leave)');
    const pv = ['view', 'edit', 'full'].indexOf(me.levels.payroll) >= 0;
    ok((fg.payroll_month !== null) === pv && (fg.next_pay !== null) === pv, `finance (payroll ${me.levels.payroll}): pay figures ${pv ? 'shown' : 'hidden'}`);
  } else ok(fin.status === 403, 'finance without an admin Home is refused');
  await api.op('settings.update', { agent_sees_pay: false }, OWNER);
  const ag = await api.op('home.admin', {}, AGENT);
  ok(ag.globe !== null && ag.globe.payroll_month === null && ag.globe.next_pay === null, 'pay hidden from your AI agent: no payroll on the globe');
  await api.op('settings.update', { agent_sees_pay: true }, OWNER);
}

section('speed');
{
  for (let i = 0; i < 3; i++) await api.op('home.admin', {}, OWNER);
  const times = [];
  for (let i = 0; i < 7; i++) {
    const t0 = Date.now();
    await api.op('home.admin', {}, OWNER);
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  ok(times[3] < 2000, `home.admin median ${times[3]} ms (${times.join(' ')})`);
}

const s = summary('t04_globe');
process.exit(s.failed > 0 ? 1 : 0);
