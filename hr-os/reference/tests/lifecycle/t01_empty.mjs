/**
 * Empty database: after the first-run setup only (one entity, the owner),
 * every lifecycle operation is called as the owner, an employee (member
 * without an employee record) and your AI agent, with no params or
 * placeholder ids: never a 5xx; reads without required params answer 200.
 * Also checks the first entity got its country defaults and that the
 * empty states read well (lifecycle.home, lists).
 *
 *   node tests/t01_empty.mjs
 */
import { fresh, ok, eq, section, done, lifecycleOps, no5xx, DEMO } from './lib.mjs';

const api = fresh();
await api.op('setup.complete', { company_name: 'Empty Co', country: 'JP', region: '13', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
const inv = await api.op('members.invite', { email: 'emp@empty.test', name: 'Eve Employee', role: 'employee' }, { as: 'owner', pin: true });
const j = await api.op('auth.accept-invite', { email: 'emp@empty.test', code: inv.code, password: DEMO.password });
api.setToken('emp@empty.test', j.token);
const WHO = [
  ['owner', { as: 'owner' }],
  ['employee', { as: 'emp@empty.test' }],
  ['agent', { as: 'agent' }],
];

section('first entity defaults');
{
  const t = await api.op('checklist-templates.list', {}, { as: 'owner' });
  eq(t.templates.length, 2, 'the Japanese entity got an onboarding and an offboarding template');
  const l = await api.op('letter-templates.list', { country: 'JP' }, { as: 'owner' });
  ok(l.templates.some((x) => x.language === 'ja'), 'and the Japanese letter templates');
  const h = await api.op('lifecycle.home', {}, { as: 'owner' });
  ok(h.starting.length === 0 && h.leaving.length === 0 && h.overdue_total === 0 && h.templates_missing.length === 0 && h.grievances_open === 0, 'an empty home', h);
  const w = await api.op('lifecycle.welcome', {}, { as: 'emp@empty.test' });
  eq(w.linked, false, 'the welcome page of a member without an employee record');
  const hb = await api.op('handbook.list', {}, { as: 'emp@empty.test' });
  eq(hb.pages.length, 0, 'an empty handbook for employees');
  const g = await api.call('grievances.report', { subject: 'x', description: 'y' }, { as: 'emp@empty.test' });
  ok(g.status === 409 && g.body.code === 'not_linked', 'a member without an employee record cannot report (told to ask HR)', g.body);
}

section('every op, every caller, no 5xx');
const ops = await lifecycleOps();
// letters.preview takes --employee or --employment (one of them), so neither is marked required.
const NEEDS_PERSON = ['letters.preview'];
ok(ops.length > 70, 'the lifecycle catalog is loaded (' + ops.length + ' ops)');
for (const o of ops) {
  for (const [label, who] of WHO) {
    const r0 = await api.call(o.name, {}, who);
    no5xx(r0, o.name + ' as ' + label + ' without params');
    const req = Object.keys(o.params).filter((k) => o.params[k].required && k !== 'pin');
    const agentDenied = label === 'agent' && (o.description || '').indexOf('[People only') >= 0;
    if (o.method === 'GET' && req.length === 0 && label !== 'employee' && !agentDenied && NEEDS_PERSON.indexOf(o.name) < 0) ok(r0.status === 200, o.name + ' as ' + label + ' answers 200 on an empty database', { status: r0.status, body: r0.body });
    if (req.length > 0) {
      const p = {};
      for (const k of req) p[k] = o.params[k].enum ? o.params[k].enum[0] : k === 'last_day' ? '2026-12-31' : 'missing-ref';
      const r1 = await api.call(o.name, p, who);
      no5xx(r1, o.name + ' as ' + label + ' with placeholder ids');
    }
  }
}

section('employee reads answer 200 or a clean refusal');
for (const name of ['lifecycle.home', 'lifecycle.welcome', 'tasks.list', 'checklists.list', 'letters.list', 'separations.list', 'handbook.list', 'handbook.text', 'grievance-types.list', 'grievances.list']) {
  const r = await api.call(name, {}, { as: 'emp@empty.test' });
  ok(r.status === 200, name + ' as an employee answers 200', r.body);
}
for (const name of ['checklist-templates.list', 'letter-templates.list', 'assets.list', 'exit-forms.list']) {
  const r = await api.call(name, {}, { as: 'emp@empty.test' });
  ok(r.status === 403, name + ' is refused for an employee', r.body);
}

done('t01_empty');
