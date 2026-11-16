// Seeded: QA findings for your AI agent's CLI use: people-only refusals come
// first and name inbox.route, proposals are checked before they are stored,
// names work as employee and employment references, what wakes your AI
// agent is one trigger per piece of work, inbox.route reaches the right
// people, the guide is an index and operations.json shows no PIN for
// people-only ops.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, eq, fresh, newApi, ok, refuses, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const O = { as: 'owner' };
const AG = { as: 'agent' };

section('people-only refusals');
const r1 = await refuses(api, 'members.invite', {}, AG, 403, 'agent_not_permitted', 'a people-only op without its params refuses with 403 first (no param or PIN error)');
ok(/inbox\.route/.test(r1.body.message) && /never ask them for their PIN/.test(r1.body.message) && r1.body.data.route_with === 'inbox.route', 'the refusal names inbox.route and says never to ask for the PIN', r1.body.message);
const r2 = await refuses(api, 'approvals.decide', { approval: 'x', decision: 'approved' }, AG, 403, 'agent_not_permitted', 'approvals.decide refuses your AI agent');
ok(/inbox\.route/.test(r2.body.message), 'and names inbox.route');
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const deny = manifest.operations.filter((o) => /\[People only/.test(o.description));
ok(deny.length > 10 && deny.every((o) => o.params.pin === undefined && Object.values(o.params).every((d) => d.required !== true)), 'operations.json: people-only ops show no PIN and no required params (' + deny.length + ' ops)');
const pinOp = manifest.operations.find((o) => o.name === 'members.invite');
ok(pinOp && /inbox\.route/.test(pinOp.description), 'their description says how to hand them over');

section('proposals are checked first');
await refuses(api, 'people.hire', { entity: 'Northwind KK', legal_name: 'Probe', location: 'Atlantis', start_day: '2026-12-01', why: 'probe' }, AG, 404, 'not_found', 'a hire at an unknown location is not proposed');
const near = await refuses(api, 'people.hire', { entity: 'Northwind KK', legal_name: 'Probe', location: 'Tokyo', start_day: '2026-12-01', why: 'probe' }, AG, 404, 'not_found', 'a near miss is not proposed either');
ok(/Tokyo Office/.test(near.body.message) && near.body.data.matches.indexOf('Tokyo Office') >= 0, 'and the answer names the close match', near.body);
await refuses(api, 'people.import', { why: 'x' }, AG, 400, 'empty_proposal', 'a proposal without any params is refused');
await refuses(api, 'job.update', { employment: 'E0005', reason: 'transfer', department: 'Nowhere', why: 'x' }, AG, 404, 'not_found', 'a job change to an unknown department is refused');
const before = (await api.op('proposals.list', {}, O)).total;
const good = await api.op('people.hire', { entity: 'Northwind KK', legal_name: 'Probe Person', location: 'Tokyo Office', department: 'Engineering', job_title: 'Software Engineer', pay_amount: '6000000', pay_per: 'year', start_day: '2026-12-01', why: 'probe' }, AG);
ok(good.proposed && (await api.op('proposals.list', {}, O)).total === before + 1, 'a valid hire is proposed (and the check left nothing behind)');
const names = Object.fromEntries(good.preview.fields.map((f) => [f.name, f.after]));
ok(names.location === 'Tokyo Office' && names.department === 'Engineering' && names.pay === 'JPY 6,000,000 per year', 'the preview shows resolved names and formatted pay', names);
eq((await api.op('people.directory', { q: 'Probe Person', status: 'all' }, O)).total, 0, 'the check created nobody');

section('names as references');
eq((await api.op('job.history', { employment: 'Priya Raman' }, AG)).records.length >= 1, true, '--employment takes a name');
eq((await api.op('people.get', { employee: 'priya raman' }, AG)).employee.number, 'E0002', '--employee takes a name (any case)');
eq((await api.op('people.get', { employee: 'Kenji Takahashi' }, AG)).employee.legal_name, 'Takahashi Kenji', 'given and family name in either order');
await api.op('people.hire', { entity: 'Northwind Pte Ltd', legal_name: 'Priya Raman', preferred_name: '', start_day: '2026-12-01' }, { as: 'hr@northwind.test' });
const amb = await refuses(api, 'people.get', { employee: 'Priya Raman' }, AG, 409, 'ambiguous', 'two people with one name answer 409');
ok(amb.body.data.matches.length === 2 && amb.body.data.matches.every((m) => /^E\d{4}$/.test(m.number)), 'listing both with their numbers', amb.body.data.matches);
const miss = await refuses(api, 'people.get', { employee: 'Hui Mi' }, AG, 404, 'not_found', 'no exact name answers 404');
ok(miss.body.data.matches.some((m) => m.name === 'Hui Min Lim'), 'with close names');

section('what wakes your AI agent');
const wk = await api.op('agent.triggers', {}, AG);
ok(wk.triggers.length >= 10 && wk.triggers.every((t) => t.param.endsWith('_id') && t.fires !== '' && t.cooldown_seconds >= 15), 'one trigger per piece of work, each naming its record', wk.triggers.map((t) => t.name));
ok(wk.automatic.length === 3 && wk.automatic.every((a) => a.on === false && a.tip !== ''), 'Automatic work: every switch off by default, each with a tip', wk.automatic);
const tj = JSON.parse(readFileSync(join(APP, 'triggers.json'), 'utf8')).triggers;
eq(Object.keys(tj).sort(), wk.triggers.map((t) => t.name).sort(), 'triggers.json declares exactly those triggers');
ok(Object.values(tj).every((t) => t.instruction.length < 1000 && Object.keys(t.params).length === 1), 'each instruction under 1,000 characters, one param naming the record');

section('inbox.route');
const kenji = (await api.op('people.get', { employee: 'Kenji Takahashi' }, O)).employee;
const rt = await api.op('inbox.route', { op: 'bank.add', employee: kenji.number, request: 'Kenji asked to change his salary account to 1234567 at MUFG' }, AG);
ok(rt.routed >= 1 && /Payroll/.test(rt.to), 'a bank change goes to the payroll administrators', rt);
const pn = await api.op('notifications.list', {}, { as: 'payroll@northwind.test' });
ok(pn.notifications.some((x) => x.kind === 'agent_request' && x.link === '#/people/' + kenji.number && /MUFG/.test(x.body)), 'it is in their Inbox with the request and a link');
const again = await api.op('inbox.route', { op: 'bank.add', employee: kenji.number, request: 'Kenji asked to change his salary account to 1234567 at MUFG' }, AG);
eq(again.routed, 0, 'the same request is not repeated');
const lead = await api.op('inbox.route', { op: 'payruns.lock', request: 'Lock the October run for Northwind Pte Ltd' }, AG);
ok(lead.routed >= 1, 'a pay run lock goes to payroll too');
await refuses(api, 'inbox.route', { op: 'bank.add' }, AG, 400, 'missing_param', 'a request text is needed');

section('overseen approvals, dates, short job answers');
const dan = (await api.op('people.get', { employee: 'payroll@northwind.test' }, O)).employee;
const own = await api.op('bank.add', { employee: dan.number, number: '5550001111', bank_name: 'OCBC' }, { as: 'payroll@northwind.test' });
const hrView = await api.op('approvals.list', { view: 'overseen' }, { as: 'hr@northwind.test' });
const ownerMine = await api.op('approvals.list', {}, O);
const ownerSeen = await api.op('approvals.list', { view: 'overseen' }, O);
const inMine = ownerMine.approvals.some((a) => a.id === own.approval.id);
const inSeen = ownerSeen.approvals.some((a) => a.id === own.approval.id && a.can_decide === true);
ok(inMine || inSeen, 'the owner sees the payroll admin own bank approval (as approver or overseen)', { mine: ownerMine.approvals.map((a) => a.kind), overseen: ownerSeen.approvals.map((a) => a.kind) });
ok(Array.isArray(own.approval.approver_names) && own.approval.approver_names.length === own.approval.approvers.length, 'approvals name who they wait for', own.approval.approver_names);
ok(hrView.approvals.every((a) => a.kind !== 'bank_account'), 'the HR admin (payroll view) does not oversee bank approvals');
const meO = await api.op('auth.me', {}, O);
ok(meO.company.date_format === 'DD/MM/YYYY' && meO.entities.every((e) => e.date_format && e.week_start !== undefined), 'auth.me gives the date format (entity style: Singapore DD/MM/YYYY) and each entity format', meO.company);
const meK = await api.op('auth.me', {}, { as: 'haruto@northwind.test' });
eq(meK.company.date_format, 'YYYY/MM/DD', 'a person in Japan gets the Japanese format');
await api.op('settings.update', { date_style: 'iso' }, O);
eq((await api.op('app.home', {}, { as: 'haruto@northwind.test' })).date_format, 'YYYY-MM-DD', 'the company style wins over the entity (app.home too)');
await api.op('settings.update', { date_style: 'entity' }, O);

section('guide and answers');
const g = await api.op('app.guide', {}, AG);
const size = JSON.stringify(g).length;
ok(size < 20000 && g.ops === undefined && g.modules.some((m) => m.module === 'kernel'), 'the guide is an index (' + size + ' chars)');
const rec = await api.op('app.guide', { recipe: 'question_asked' }, AG);
ok(Array.isArray(rec.steps) && rec.steps.length >= 2, 'app.guide --recipe gives one recipe');
await refuses(api, 'app.guide', { module: 'nope' }, AG, 404, 'not_found', 'an unknown module answers 404 with the list');
const st = await api.op('app.status', {}, AG);
ok(st.units === undefined && st.counts.questions_asked !== undefined && st.counts.jobs_waiting === undefined, 'app.status counts the questions waiting for an answer (no job counts); no units text');

const s = summary('t08_agent_cli');
process.exitCode = s.failed > 0 ? 1 : 0;
