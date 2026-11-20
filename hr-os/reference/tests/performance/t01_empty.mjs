// Empty database: every read op answers without a server error as nobody,
// the owner (no employee record), an employee member and your AI agent;
// the performance module's first actions behave on an empty company.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, DEMO, eq, fresh, newApi, ok, refuses, section, summary } from './lib.mjs';

fresh();
const api = newApi();
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => !o.system && o.executor.method === 'GET');
const mine = reads.filter((o) => /^(perf|goals|review-templates|cycles|participants|reviews|review-summaries|calibration|feedback|skills|training-programs|trainings|training-attendees|training-requirements)\./.test(o.name));
const SAMPLE = { employee: 'E0001', goal: 'nope00000000000', cycle: 'nope00000000000', review: 'nope00000000000', participant: 'nope00000000000', template: 'Annual review', skill: 'nope', program: 'nope', training: 'nope00000000000', attendee: 'nope00000000000', requirement: 'nope00000000000', summary: 'nope00000000000' };

async function sweep(list, as, label) {
  const statuses = {};
  const bad = [];
  for (const o of list) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = SAMPLE[k] ?? 'x';
    const r = await api.call(o.name, params, { as });
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, label + ': ' + list.length + ' reads, no 5xx ' + JSON.stringify(statuses), bad);
  return statuses;
}

section('before setup');
await sweep(mine, 'anon', 'nobody signed in (performance reads)');
const anon = await api.call('perf.home', {}, { as: 'anon' });
eq(anon.status, 401, 'perf.home needs sign-in');

section('setup and empty sweeps');
await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Owner One', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
await sweep(reads, 'owner', 'owner, all reads');
await sweep(mine, 'agent', 'your AI agent, performance reads');
const inv = await api.op('members.invite', { email: 'emp@northwind.test', name: 'Erin Employee', role: 'employee' }, { as: 'owner', pin: true });
const joined = await api.op('auth.accept-invite', { email: 'emp@northwind.test', code: inv.code, password: DEMO.password });
api.setToken('emp@northwind.test', joined.token);
await sweep(mine, 'emp@northwind.test', 'employee without an employee record, performance reads');

section('empty answers');
const home = await api.op('perf.home', {}, { as: 'owner' });
eq(home.cycles.length + home.owe.length + home.goals.length + home.praise.length, 0, 'home is empty');
eq(home.employee, null, 'owner has no employee record yet');
const tpl = await api.op('review-templates.list', {}, { as: 'owner' });
eq(tpl.templates.map((t) => t.name), ['Annual review', 'Probation review', 'Quarterly check-in'], 'three built-in templates');
const st = await api.op('perf.settings', {}, { as: 'owner' });
eq([st.praise_wall, st.checkin_days, st.reminder_days, st.values.length], [true, 14, 3, 0], 'default settings');
const flows = await api.op('approval-flows.list', {}, { as: 'owner' });
ok(flows.flows.some((f) => f.kind === 'review_signoff' && f.steps[0].role === 'hr_admin'), 'review_signoff flow seeded (HR administrator)');
ok(flows.kinds.includes('review_signoff'), 'review_signoff is a known approval kind');
eq((await api.op('goals.list', {}, { as: 'owner' })).total, 0, 'no goals');
eq((await api.op('skills.matrix', {}, { as: 'owner' })).people.length, 0, 'empty matrix');
eq((await api.op('trainings.compliance', {}, { as: 'owner' })).total, 0, 'no compliance rows');
eq((await api.op('calibration.view', { cycle: 'nope00000000000' }, { as: 'owner' }).catch((e) => e.status)), 404, 'calibration of an unknown cycle is a 404');

section('first actions on an empty company');
await refuses(api, 'goals.create', { title: 'My goal' }, { as: 'owner' }, 400, 'no_employee', 'a personal goal needs an employee record');
const cg = await api.op('goals.create', { title: 'Grow revenue 20%', company: true, key_results: [{ title: 'ARR', start: 100, target: 120, unit: 'USD m' }] }, { as: 'owner' });
eq([cg.goal.scope, cg.goal.progress, cg.goal.kind], ['company', 0, 'okr'], 'a company OKR on an empty database');
const c = await api.op('cycles.create', { kind: 'annual' }, { as: 'owner' });
eq(c.cycle.status, 'draft', 'a draft cycle with defaults');
ok(c.cycle.phases.length === 4 && c.cycle.template_name === 'Annual review', 'default phases and template', c.cycle.phases);
await refuses(api, 'cycles.launch', { cycle: c.cycle.id }, { as: 'owner' }, 400, 'no_participants', 'launching with nobody is refused');
eq((await api.op('cycles.preview', { cycle: c.cycle.id }, { as: 'owner' })).total, 0, 'preview shows nobody');
await api.op('cycles.delete', { cycle: c.cycle.id }, { as: 'owner' });
await refuses(api, 'feedback.give', { to: 'E0001', text: 'x' }, { as: 'owner' }, 400, 'no_employee', 'feedback needs an employee record');
const sk = await api.op('skills.add', { name: 'Python', category: 'Engineering' }, { as: 'owner' });
eq(sk.skill.people, 0, 'a library skill');
const pg = await api.op('training-programs.add', { name: 'Code of conduct', valid_months: 12 }, { as: 'owner' });
await api.op('training-requirements.add', { program: pg.program.id }, { as: 'owner' });
const rc = (await api.op('training-requirements.list', {}, { as: 'owner' })).requirements[0].counts;
eq([rc.done, rc.expiring, rc.due, rc.overdue], [0, 0, 0, 0], 'requirement with nobody to apply to');
await refuses(api, 'perf.settings-update', { praise_wall: false }, { as: 'emp@northwind.test' }, 403, 'not_permitted', 'an employee cannot change settings');
await refuses(api, 'perf.settings-update', { praise_wall: false }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot change settings');
await sweep(mine, 'owner', 'owner after first actions');

const s = summary('t01_empty');
process.exitCode = s.failed > 0 ? 1 : 0;
