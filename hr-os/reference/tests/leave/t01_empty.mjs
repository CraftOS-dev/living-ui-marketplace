// t01: an EMPTY database. Before setup every leave read refuses cleanly; after
// setup (one SG entity, no people) every leave read answers for the owner and
// the agent without a 5xx, and the SG country defaults were seeded by the
// entity.created event.
//   bash tools/dev/reset.sh <app>; bash tools/dev/serve.sh <app> 3184; node tests/t01_empty.mjs
import { api, ok, eq, done, ops, section, DEMO } from './lib.mjs';

const reads = ops('leave.').filter((o) => o.executor.method === 'GET');
const fixture = { type: 'annual', start: '2026-12-21', employment: '', request: 'nope', approval: 'nope', policy: 'nope', entity: '' };

section('before setup');
const st = await api.op('setup.status');
ok(st.needs_setup === true, 'database is empty (run reset first)', st);
for (const o of reads) {
  const r = await api.call(o.name, {}, { as: 'anon' });
  ok(r.status < 500, 'anon ' + o.name + ' no 5xx', r);
  ok(r.status === 401 || r.status === 400, 'anon ' + o.name + ' refused (401)', r.status);
}

section('setup');
await api.op('setup.complete', { company_name: 'Empty Co', entity_name: 'Empty Pte Ltd', country: 'SG', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const types = await api.op('leave.types', {}, { as: 'owner' });
const codes = types.types.map((t) => t.code).sort();
eq(codes, ['annual', 'childcare', 'comp_off', 'hospitalisation', 'maternity', 'paternity', 'shared_parental', 'sick', 'unpaid'].sort(), 'SG types seeded on entity.created');
const pols = await api.op('leave.policies', {}, { as: 'owner' });
ok(pols.policies.length === 1 && pols.policies[0].is_default, 'one default policy', pols.policies.map((p) => p.name));
const ent = (await api.op('entities.list', {}, { as: 'owner' })).entities[0];
fixture.entity = ent.id;
fixture.policy = pols.policies[0].id;

section('reads on an empty company');
for (const as of ['owner', 'agent']) {
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = fixture[k] ?? 'x';
    const r = await api.call(o.name, params, { as });
    ok(r.status < 500, as + ' ' + o.name + ' no 5xx', r);
    if (['leave.home', 'leave.types', 'leave.policies', 'leave.blocks', 'leave.calendar', 'leave.out', 'leave.requests', 'leave.obligation', 'leave.register', 'leave.encashments', 'leave.comp-offs', 'leave.sync-log', 'leave.balances'].includes(o.name)) ok(r.status === 200, as + ' ' + o.name + ' answers 200', r);
  }
}
const home = await api.op('leave.home', {}, { as: 'owner' });
eq(home.out_today, [], 'nobody out');
eq(home.setup, [], 'no entity left to set up');
const mine = await api.op('leave.mine', {}, { as: 'owner' });
ok(mine.employment === null && typeof mine.reason === 'string', 'owner without an employee gets a reason', mine);
const ag = await api.op('leave.mine', {}, { as: 'agent' });
ok(ag.employment === null, 'agent has no own leave', ag);
const exp = await api.call('leave.register-export', {}, { as: 'agent' });
ok(exp.status === 403 && exp.body.code === 'agent_not_permitted', 'agent cannot export the register', exp.body);
const csv = await api.op('leave.register-export', {}, { as: 'owner' });
ok(typeof csv.csv === 'string' && csv.csv.startsWith('社員番号'), 'register export has headers', csv);

section('a second entity in Japan and one in the US-CA');
const jp = (await api.op('entities.add', { name: 'Empty KK', country: 'JP', region: '13' }, { as: 'owner' })).entity;
const us = (await api.op('entities.add', { name: 'Empty Inc', country: 'US', region: 'CA', timezone: 'America/Los_Angeles' }, { as: 'owner' })).entity;
const gb = (await api.op('entities.add', { name: 'Empty Ltd', country: 'GB', region: 'ENG' }, { as: 'owner' })).entity;
const au = (await api.op('entities.add', { name: 'Empty Pty', country: 'AU', region: 'NSW', timezone: 'Australia/Sydney' }, { as: 'owner' })).entity;
const my = (await api.op('entities.add', { name: 'Empty Sdn Bhd', country: 'MY', region: '14' }, { as: 'owner' })).entity;
const ind = (await api.op('entities.add', { name: 'Empty India', country: 'IN', region: 'MH' }, { as: 'owner' })).entity;
const de = (await api.op('entities.add', { name: 'Empty GmbH', country: 'DE' }, { as: 'owner' })).entity;
const codesOf = async (e) => (await api.op('leave.types', { entity: e.id }, { as: 'owner' })).types.map((t) => t.code).sort();
eq(await codesOf(jp), ['annual', 'care_days', 'child_nursing', 'childcare', 'comp_off', 'family_care', 'maternity', 'unpaid'].sort(), 'JP types');
eq(await codesOf(us), ['fmla', 'pto', 'sick_ca', 'unpaid'].sort(), 'US-CA types (with California sick leave)');
eq(await codesOf(gb), ['annual', 'comp_off', 'maternity', 'paternity', 'sick', 'unpaid'].sort(), 'GB types');
eq(await codesOf(au), ['annual', 'comp_off', 'compassionate', 'family_violence', 'long_service', 'personal_carer', 'unpaid'].sort(), 'AU types');
eq(await codesOf(my), ['annual', 'comp_off', 'hospitalisation', 'maternity', 'paternity', 'sick', 'unpaid'].sort(), 'MY types');
eq(await codesOf(ind), ['casual', 'comp_off', 'earned', 'maternity', 'sick', 'unpaid'].sort(), 'IN types');
eq(await codesOf(de), ['annual', 'comp_off', 'sick', 'unpaid'].sort(), 'DE generic types');
const jpPol = (await api.op('leave.policies', { entity: jp.id }, { as: 'owner' })).policies.filter((p) => p.entity === jp.id)[0];
ok(jpPol && jpPol.rules.find((r) => r.type === 'annual').method === 'statutory_jp', 'JP annual follows statutory_jp', jpPol);
ok(jpPol.period_start === '04-01', 'JP leave year from April');
const again = await api.op('leave.seed-defaults', { entity: jp.id }, { as: 'owner' });
ok(again.types_added === 0 && again.policy_created === false, 'seeding again adds nothing', again);
const agentSeed = await api.op('leave.seed-defaults', { entity: jp.id }, { as: 'agent' });
ok(typeof agentSeed.proposal === 'string', 'agent seed-defaults becomes a proposal', agentSeed);

section('an employee member on the empty company');
const inv = await api.op('members.invite', { email: 'emp@empty.test', name: 'Erin Employee', role: 'employee' }, { as: 'owner', pin: true });
const joined = await api.op('auth.accept-invite', { email: 'emp@empty.test', code: inv.code, password: DEMO.password });
api.setToken('emp@empty.test', joined.token);
for (const o of reads) {
  const params = {};
  for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = fixture[k] ?? 'x';
  const r = await api.call(o.name, params, { as: 'emp@empty.test' });
  ok(r.status < 500, 'employee ' + o.name + ' no 5xx', r);
}
const em = await api.op('leave.mine', {}, { as: 'emp@empty.test' });
ok(em.employment === null, 'an unlinked employee gets a reason, not an error', em);
const ec = await api.op('leave.calendar', {}, { as: 'emp@empty.test' });
ok(ec.mode === 'peers' && ec.rows.length === 0, 'an unlinked employee sees an empty wallchart', ec.mode);
await (async () => {
  const r = await api.call('leave.balances', {}, { as: 'emp@empty.test' });
  ok(r.status === 403, 'employees have no balance table', r.status);
})();

done('t01 empty');
