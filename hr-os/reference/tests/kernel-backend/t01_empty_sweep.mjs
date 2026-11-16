// Empty database: every read op answers without a server error, as nobody,
// the owner, an employee and your AI agent; setup works once.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, DEMO, eq, fresh, newApi, ok, refuses, sample, section, summary } from './lib.mjs';

fresh();
const api = newApi();
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => !o.system && o.executor.method === 'GET');

async function sweep(as, ctx, label) {
  const statuses = {};
  const bad = [];
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k, ctx);
    const r = await api.call(o.name, params, { as });
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, label + ': ' + reads.length + ' reads, no 5xx ' + JSON.stringify(statuses), bad);
  return statuses;
}

section('before setup');
const st = await api.op('setup.status');
eq(st.needs_setup, true, 'needs setup');
const anon = await sweep('anon', {}, 'nobody signed in');
ok((anon['401'] || 0) > 0, 'reads that need sign-in answer 401');
await refuses(api, 'auth.me', {}, { as: 'anon' }, 401, 'session_required', 'auth.me without a session');
await refuses(api, 'setup.complete', { company_name: 'X', country: 'ZZ', owner_name: 'O', email: 'o@x.test', password: 'demo-pass-1', pin: '123456' }, { as: 'anon' }, 400, 'unknown_country', 'unknown country refused');
await refuses(api, 'setup.complete', { company_name: 'X', country: 'SG', owner_name: 'O', email: 'o@x.test', password: 'short', pin: '123456' }, { as: 'anon' }, 400, 'weak_password', 'weak password refused');
await refuses(api, 'setup.complete', { company_name: 'X', country: 'SG', owner_name: 'O', email: 'o@x.test', password: 'demo-pass-1', pin: '111111' }, { as: 'anon' }, 400, 'weak_pin', 'one-digit PIN refused');
await refuses(api, 'setup.complete', { company_name: 'X', country: 'SG', owner_name: 'O', email: 'o@x.test', password: 'demo-pass-1', pin: '123456' }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot run setup');

section('setup');
const setup = await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Owner One', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
ok(typeof setup.token === 'string' && setup.token.length > 20, 'setup answers a session token');
ok(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(setup.recovery_code), 'recovery code shown once (XXXXX-XXXXX-XXXXX-XXXXX)', setup.recovery_code);
eq(setup.entity.country, 'SG', 'first entity in SG');
ok(setup.entity.default_calendar !== '' && setup.entity.default_schedule !== '', 'entity got a holiday calendar and a work week');
await refuses(api, 'setup.complete', { company_name: 'Again', country: 'SG', owner_name: 'O', email: 'x@x.test', password: 'demo-pass-1', pin: '123456' }, { as: 'anon' }, 409, 'already_set_up', 'setup runs once');
const me = await api.op('auth.me', {}, { as: 'owner' });
eq(me.owner, true, 'owner signed in');
eq(me.has_pin, true, 'owner has the PIN');
const cal = await api.op('calendars.get', { calendar: 'SG', year: 2026 }, { as: 'owner' });
ok(cal.holidays.length > 0, 'country holidays of 2026 seeded (' + cal.holidays.length + ')');

section('empty sweeps');
await sweep('owner', {}, 'owner');
const inv = await api.op('members.invite', { email: 'emp@northwind.test', name: 'Erin Employee', role: 'employee' }, { as: 'owner', pin: true });
const joined = await api.op('auth.accept-invite', { email: 'emp@northwind.test', code: inv.code, password: DEMO.password });
api.setToken('emp@northwind.test', joined.token);
await sweep('emp@northwind.test', {}, 'employee (no employee record)');
await sweep('agent', {}, 'your AI agent');
const dir = await api.op('people.directory', {}, { as: 'owner' });
eq(dir.total, 0, 'directory is empty');
const home = await api.op('app.home', {}, { as: 'owner' });
ok(home.setup && home.setup.total > 0, 'home shows setup steps', home.setup);
const guide = await api.op('app.guide', {}, { as: 'agent' });
ok(guide.rules.length > 5 && guide.modules.length >= 1 && guide.conventions.length >= 2 && guide.ops === undefined, 'guide has the frame, conventions and a module index (no ops list)');
ok(guide.units === undefined && dir.units === undefined, 'answers do not repeat the units note');
const kmod = await api.op('app.guide', { module: 'kernel' }, { as: 'agent' });
ok(kmod.rules.length > 3 && kmod.recipes.question_asked !== undefined && kmod.op_groups.indexOf('people') >= 0, 'app.guide --module kernel gives the section in full');
const csv = await api.call('people.export', {}, { as: 'owner' });
eq(csv.status, 200, 'export on an empty database');

const s = summary('t01_empty_sweep');
process.exitCode = s.failed > 0 ? 1 : 0;
