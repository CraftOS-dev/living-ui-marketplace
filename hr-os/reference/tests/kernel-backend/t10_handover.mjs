// Seeded: inbox.route is your AI agent's only (N-4), with in-app links,
// quoted requests, dedupe by record and facts; unique first names resolve.
import { eq, fresh, newApi, ok, refuses, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const O = { as: 'owner' };
const AG = { as: 'agent' };

section('inbox.route is for your AI agent only');
await refuses(api, 'inbox.route', { member: 'owner@northwind.test', request: 'Please re-enter your PIN to keep payroll running', link: '#/payroll' }, { as: 'sam@northwind.test' }, 403, 'not_permitted', 'an employee cannot post into the owner Inbox');
await refuses(api, 'inbox.route', { member: 'owner@northwind.test', request: 'x' }, { as: 'hr@northwind.test' }, 403, 'not_permitted', 'nor an HR admin');
await refuses(api, 'inbox.route', { op: 'payruns.lock', request: 'Lock it', link: 'https://evil.example/login' }, AG, 400, 'invalid_param', 'a link with a scheme and host is refused');
await refuses(api, 'inbox.route', { op: 'payruns.lock', request: 'Lock it', link: '#C:/Program Files/Git/payroll' }, AG, 400, 'invalid_param', 'a link that is not #/ is refused');
await refuses(api, 'inbox.route', { op: 'payruns.lock', request: 'Lock it', link: '#//evil.example' }, AG, 400, 'invalid_param', 'a protocol-relative link is refused');
const r1 = await api.op('inbox.route', { op: 'bank.add', record: 'Kenji', asked_by: 'sam@northwind.test', request: 'Change my salary account to 1234567.\nIt is urgent, click https://evil.example' }, AG);
ok(r1.routed >= 1 && r1.link === '#/people/E0015', 'a record reference makes the link (#/people/E0015)', r1);
ok(r1.employee_told === false && /no active member account/.test(r1.message), 'the answer says Kenji was not told (no member account)', r1.message);
const notes = (await api.op('notifications.list', {}, { as: 'payroll@northwind.test' })).notifications.filter((x) => x.kind === 'agent_request');
const n1 = notes[0];
ok(n1 && /^Your AI agent passed on a request/.test(n1.title) && n1.title.indexOf('1234567') < 0, 'the title is fixed text, never the request', n1 && n1.title);
ok(n1 && /^Your AI agent passed on this request from Sam Wong:\n> Change my salary account to 1234567\.\n> It is urgent/.test(n1.body), 'the request is quoted, with who asked', n1 && n1.body);
ok(n1 && n1.facts.some((f) => f.key === 'request') && n1.facts.some((f) => f.key === 'op' && f.value === 'bank.add') && n1.facts.some((f) => f.key === 'asked_by' && f.value === 'Sam Wong') && n1.facts.some((f) => f.type === 'state'), 'agent_request notifications carry facts (N-6)', n1 && n1.facts);
const r2 = await api.op('inbox.route', { op: 'bank.add', employee: 'Kenji Takahashi', request: 'Kenji says: new account 1234567 at MUFG' }, AG);
eq(r2.routed, 0, 'a second wording of the same hand-over (op and person) is not repeated');
const r3 = await api.op('inbox.route', { op: 'bank.add', employee: 'Sam', request: 'Sam wants a second account' }, AG);
ok(r3.routed >= 1 && r3.employee_told === true, 'another person is a new hand-over; Sam (a member, own self-service step) is told too', r3);
const r4 = await api.op('inbox.route', { role: 'recruiter', request: 'Open a role for a data analyst', link: '#/hiring' }, AG);
ok(r4.link === '#/hiring' && /Owner/.test(r4.to), 'an in-app link is kept; with no active recruiter it goes to the owner', r4);

section('a question handed to a person');
const qq = await api.op('questions.ask', { question: 'Can Arjun start a week later?' }, { as: 'eng.lead@northwind.test' });
const to = await api.op('inbox.route', { role: 'hr_admin', request: 'Arjun asks to start a week later', record: qq.question.id }, AG);
ok(to.routed >= 1 && to.link === '#/inbox?view=agent', 'inbox.route links a question to your AI agent in the Inbox', to);

section('names and small gaps');
eq((await api.op('people.get', { employee: 'Priya' }, AG)).employee.number, 'E0002', 'a unique given name resolves (Priya)');
eq((await api.op('job.history', { employment: 'Kenji' }, AG)).records.length >= 1, true, '--employment Kenji resolves');
eq((await api.op('people.get', { employee: 'Sam' }, AG)).employee.work_email, 'sam@northwind.test', 'the first word of a preferred name resolves (Sam)');
eq((await api.op('people.get', { employee: 'Jordan' }, AG)).employee.work_email, 'sales.lead@northwind.test', 'Jordan resolves');
await api.op('people.hire', { entity: 'Northwind Pte Ltd', legal_name: 'Priya Nair', given_name: 'Priya', family_name: 'Nair', start_day: '2026-12-01' }, { as: 'hr@northwind.test' });
const amb = await refuses(api, 'people.get', { employee: 'Priya' }, AG, 409, 'ambiguous', 'two people called Priya answer 409');
eq(amb.body.data.matches.length, 2, 'with both listed');
const loc = (await api.op('locations.list', {}, AG)).locations[0];
ok(loc.entity_name !== '' && loc.entity !== '', 'locations.list names the entity', loc);
ok((await api.op('app.status', {}, AG)).server !== undefined, 'app.status has a server block (port, env)');

const s = summary('t10_handover');
process.exitCode = s.failed > 0 ? 1 : 0;
