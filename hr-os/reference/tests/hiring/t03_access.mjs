// Who sees and does what in hiring: managers only what they are part of,
// interviewers only their interview, employees nothing but open roles and
// referrals; your AI agent is refused every people-only op, its proposal ops
// become proposals, its allowed ops run (always the first stage), and it
// sees pay only when the owner allows it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, eq, fresh, member, newApi, ok, refuses, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const OWNER = { as: 'owner' };
const HR = { as: 'hr@northwind.test' };
const ENG = { as: 'eng.lead@northwind.test' };
const SALES = { as: 'sales.lead@northwind.test' };
const SAM = { as: 'sam@northwind.test' };
const HARUTO = { as: 'haruto@northwind.test' };
const REC = { as: 'rita@northwind.test' };
const AGENT = { as: 'agent' };
await member(api, 'rita@northwind.test', 'Rita Recruiter', 'recruiter');
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const HIRING = /^(hiring|staffing-plans|requisitions|openings|interview-kits|candidates|applications|interviews|scorecards|offers|offer-terms|offer-templates|rejection-reasons|referrals)\./;
const hiringOps = manifest.operations.filter((o) => HIRING.test(o.name));

section('catalog marks');
ok(hiringOps.length >= 80, hiringOps.length + ' hiring ops in the catalog');
const denied = hiringOps.filter((o) => o.agent === 'deny' || (o.marks && o.marks.agent === 'deny') || String(o.description || '').indexOf('[People only') >= 0);
const byName = Object.fromEntries(hiringOps.map((o) => [o.name, o]));
const mustDeny = ['applications.move', 'applications.reject', 'applications.withdraw', 'applications.reopen', 'applications.message', 'applications.link-hire', 'scorecards.save', 'offers.create', 'offers.update', 'offers.submit', 'offers.send', 'offers.respond', 'offers.withdraw', 'requisitions.submit', 'requisitions.close', 'openings.set-status', 'candidates.delete', 'candidates.export', 'hiring.settings-update', 'interviews.cancel', 'interviews.set-status', 'interviews.calendar', 'referrals.add'];
for (const n of mustDeny) {
  const r = await api.call(n, {}, AGENT);
  ok(r.status === 403 && r.body.code === 'agent_not_permitted', 'your AI agent is refused ' + n, { status: r.status, body: r.body });
}
ok(denied.length >= 0 && byName['interviews.summary'] !== undefined, 'interviews.summary is in the catalog');

section('set the scene');
const rita = (await api.op('auth.me', {}, REC)).member;
const mei = (await api.op('auth.me', {}, ENG)).member;
const opA = (await api.op('openings.add', { entity: 'Northwind Pte Ltd', title: 'Data engineer', hiring_manager: mei.id, salary_min: '6000', salary_max: '8000' }, REC)).opening;
const opB = (await api.op('openings.add', { entity: 'Northwind Inc', title: 'Sales development rep', salary_min: '60000', salary_max: '70000', pay_per: 'year' }, REC)).opening;
await api.op('openings.set-status', { opening: opA.id, status: 'open' }, REC);
await api.op('openings.set-status', { opening: opB.id, status: 'open' }, REC);
const c1 = await api.op('candidates.add', { name: 'Priya Nair', email: 'priya.n@example.com', opening: opA.id }, REC);
const c2 = await api.op('candidates.add', { name: 'Tom Hale', email: 'tom.h@example.com', opening: opB.id }, REC);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const ivA = (await api.op('interviews.schedule', { application: c1.application.id, day: tomorrow, start: '09:30', interviewers: ['haruto@northwind.test'] }, REC)).interview;
const ivA2 = (await api.op('interviews.schedule', { application: c1.application.id, day: tomorrow, start: '15:00', interviewers: ['eng.lead@northwind.test'] }, REC)).interview;

section('managers see what they are part of');
const engList = await api.op('openings.list', {}, ENG);
eq(engList.openings.map((o) => o.number), [opA.number], 'Mei Lin (hiring manager of A) sees only A');
await refuses(api, 'openings.get', { opening: opB.id }, ENG, 404, 'not_found', 'Mei Lin cannot open B');
await refuses(api, 'candidates.get', { candidate: c2.candidate.id }, ENG, 404, 'not_found', 'nor B\'s candidate');
eq((await api.op('candidates.list', {}, ENG)).candidates.map((c) => c.name), ['Priya Nair'], 'her candidate list is A\'s');
eq((await api.op('openings.list', {}, SALES)).openings.length, 0, 'Jordan (no part in either) sees no openings');
const moved = await api.op('applications.move', { application: c1.application.id, stage: 'screen' }, ENG);
eq(moved.moved.length, 1, 'the hiring manager moves candidates on her opening');
await refuses(api, 'applications.move', { application: c2.application.id, stage: 'screen' }, ENG, 404, 'not_found', 'but not on another opening');
await refuses(api, 'openings.set-status', { opening: opA.id, status: 'on_hold' }, ENG, 403, 'not_permitted', 'publishing needs full hiring access');
const engIvs = await api.op('interviews.list', {}, ENG);
eq(engIvs.interviews.length, 2, 'the hiring manager sees both interviews on her opening');

section('interviewers see their own interview');
const harIvs = await api.op('interviews.list', {}, HARUTO);
eq(harIvs.interviews.map((i) => i.id), [ivA.id], 'Haruto (employee on a panel) sees his interview only');
await refuses(api, 'interviews.get', { interview: ivA2.id }, HARUTO, 404, 'not_found', 'not the other round of the same candidate');
const harCand = await api.op('candidates.get', { candidate: c1.candidate.id }, HARUTO);
eq(harCand.applications[0].interviews.map((i) => i.id), [ivA.id], 'on the profile, only his interview');
eq(harCand.applications[0].offers.length, 0, 'no offers for interviewers');
await refuses(api, 'candidates.note', { candidate: c1.candidate.id, text: 'x' }, HARUTO, 403, 'not_permitted', 'interviewers write in the scorecard, not notes');
await refuses(api, 'candidates.get', { candidate: c2.candidate.id }, HARUTO, 404, 'not_found', 'another candidate is invisible');
await refuses(api, 'scorecards.get', { interview: ivA.id }, SAM, 404, 'not_found', 'Sam, not on the panel, cannot open it');
await refuses(api, 'interviews.schedule', { application: c1.application.id, day: tomorrow, start: '10:00', interviewers: ['sam@northwind.test'] }, HARUTO, 403, 'not_permitted', 'an interviewer cannot schedule');

section('employees');
for (const n of ['openings.list', 'candidates.list', 'offers.list', 'requisitions.list', 'staffing-plans.list', 'hiring.settings', 'referrals.list', 'applications.list']) await refuses(api, n, {}, SAM, 403, 'not_permitted', 'an employee cannot run ' + n);
eq((await api.op('openings.open-roles', {}, SAM)).openings.length, 2, 'but sees the open roles');
const samHome = await api.op('hiring.home', {}, SAM);
eq([samHome.level, samHome.openings.length], ['none', 0], 'and an empty hiring home');

section('your AI agent');
const p1 = await api.op('openings.add', { entity: 'Northwind KK', title: 'Support engineer', why: 'Asked by Kenji' }, AGENT);
ok(p1.proposed === true, 'openings.add by your AI agent is a proposal');
const p2 = await api.op('interviews.schedule', { application: c1.application.id, day: tomorrow, start: '11:00', interviewers: ['eng.lead@northwind.test'], why: 'Free slot' }, AGENT);
ok(p2.proposed === true, 'interviews.schedule is a proposal');
const p3 = await api.op('interview-kits.save', { name: 'Data modelling', criteria: [{ name: 'SQL' }], why: 'For the data role' }, AGENT);
ok(p3.proposed === true, 'interview-kits.save is a proposal');
const p4 = await api.op('openings.update', { opening: opA.id, description: 'New post', why: 'Draft' }, AGENT);
ok(p4.proposed === true && p4.preview.fields.some((f) => f.name === 'description' && f.after === 'New post'), 'job post proposal shows before and after', p4.preview);
eq(p1.label, 'Draft opening Support engineer (Northwind KK)', 'the proposal is labelled with the opening, not the op help', p1.label);
const p5 = await api.op('openings.add', { entity: 'Northwind India Pvt Ltd', title: 'Payroll Specialist', location_text: 'Bengaluru', country: 'IN', region: 'KA', description: '## Payroll Specialist\n\nRun payroll for India.', why: 'Job post asked for in chat' }, AGENT);
ok(p5.proposed === true && p5.label === 'Draft opening Payroll Specialist (Northwind India Pvt Ltd) with its job post' && p5.preview.fields.some((f) => f.name === 'description'), 'a job post with no opening: one proposal carries the opening and its post', p5);
ok(/^Interview with .+ for J\d{4} .+$/.test(p2.label) && p2.preview.fields.some((f) => f.name === 'timezone' && f.after === 'Asia/Singapore'), 'interview proposal names candidate and role; the zone is shown', p2);
eq(p3.label, 'Add interview kit "Data modelling"', 'kit proposal label');
eq(p4.label, 'Job post for ' + opA.number + ' ' + opA.title, 'job post proposal label');
await refuses(api, 'openings.add', { why: 'Nothing given' }, AGENT, 400, 'empty_proposal', 'an empty openings.add is not proposed');
await refuses(api, 'openings.add', { title: 'No entity', why: 'x' }, AGENT, 400, 'missing_param', 'a direct opening without its entity is not proposed');
await refuses(api, 'openings.update', { opening: opA.id, why: 'x' }, AGENT, 400, 'nothing_to_change', 'an update naming only the opening is not proposed');
await refuses(api, 'interviews.schedule', { application: c1.application.id, start: '11:00', why: 'x' }, AGENT, 400, 'missing_param', 'an interview without its day is not proposed');
await refuses(api, 'interview-kits.save', { kit: p3.proposal, name: 'Renamed', why: 'x' }, AGENT, 404, 'not_found', 'a kit change naming an unknown kit is not proposed');
await refuses(api, 'staffing-plans.save', { name: '', why: 'x' }, AGENT, 400, 'empty_proposal', 'an empty plan is not proposed');
const agentList = await api.op('openings.list', {}, AGENT);
eq(agentList.can_add, true, 'openings.list tells your AI agent it may add an opening (as a proposal)');
const agentCands = await api.op('candidates.list', {}, AGENT);
eq([agentCands.can.add, agentCands.can.delete, agentCands.can.export], [true, false, false], 'can flags follow what your AI agent may do');
const agentOpening = await api.op('openings.get', { opening: opA.id }, AGENT);
eq([agentOpening.opening.can.edit, agentOpening.opening.can.publish], [true, false], 'it may change a post (proposal), not publish');
const props = await api.op('proposals.list', { kind: 'hiring' }, REC);
ok(props.proposals.length >= 5, 'the recruiter sees the hiring proposals');
await refuses(api, 'proposals.list', { kind: 'hiring' }, SAM, 200, undefined, 'an employee may call the list');
eq((await api.op('proposals.list', { kind: 'hiring' }, SAM)).proposals.length, 0, 'but sees no hiring proposals');
const added = await api.op('candidates.add', { name: 'Lee Chan', email: 'lee.chan@example.com', opening: opA.id, stage: 'screen', source_detail: 'cv.pdf from Rita' }, AGENT);
eq([added.application.stage, added.candidate.created_actor, added.candidate.source], ['applied', 'agent', 'import'], 'your AI agent adds a candidate; they land in the first stage whatever it asks');
const ap2 = await api.op('applications.add', { candidate: c2.candidate.id, opening: opA.id, stage: 'interview' }, AGENT);
eq(ap2.application.stage, 'applied', 'applications.add by your AI agent: first stage');
const note = await api.op('candidates.note', { candidate: c1.candidate.id, text: 'Sent the coding exercise link' }, AGENT);
eq(note.event.who, 'Your AI agent', 'notes are attributed to your AI agent');
const rq = await api.op('requisitions.save', { entity: 'Northwind Pte Ltd', title: 'QA engineer' }, AGENT);
eq([rq.requisition.status, rq.requisition.requested_by_name], ['draft', 'Your AI agent'], 'your AI agent drafts a requisition (a person sends it)');
const offer = (await api.op('offers.create', { application: c1.application.id, start_day: '2027-01-04', amount: '7000', pay_per: 'month' }, REC)).offer;
const ag1 = await api.op('offers.get', { offer: offer.id }, AGENT);
eq(ag1.offer.amount, '7000.00', 'your AI agent sees the offer pay by default');
await api.op('settings.update', { agent_sees_pay: false }, OWNER);
const ag2 = await api.op('offers.get', { offer: offer.id }, AGENT);
ok(ag2.offer.amount === '' && ag2.offer.amount_minor === null && ag2.offer.letter === undefined, 'with pay switched off it does not', ag2.offer);
await refuses(api, 'offers.letter', { offer: offer.id }, AGENT, 403, 'not_permitted', 'nor the letter');
const hd = await api.op('offers.hire-draft', { offer: offer.id }, AGENT).catch((e) => e);
ok(hd.status === 409 && hd.code === 'not_accepted', 'hire draft waits for an accepted offer', hd.body);

section('settings rights');
await refuses(api, 'hiring.settings-update', { retention_default: 200 }, ENG, 403, 'not_permitted', 'a manager cannot change the hiring settings');
await refuses(api, 'rejection-reasons.save', { name: 'Too far' }, ENG, 403, 'not_permitted', 'nor the rejection reasons');
const r1 = await api.op('rejection-reasons.save', { name: 'Location does not work', kind: 'candidate' }, REC);
eq(r1.reason.kind, 'candidate', 'the recruiter adds a reason');
await refuses(api, 'interview-kits.save', { name: 'Shared kit' }, ENG, 403, 'not_permitted', 'a manager cannot add a shared kit');
const k1 = await api.op('interview-kits.save', { name: 'Data kit', opening: opA.id, criteria: [{ name: 'SQL' }, { name: 'Modelling' }], questions: [{ text: 'Design a schema', criterion: 'modelling' }] }, ENG);
eq(k1.kit.criteria.map((c) => c.key), ['sql', 'modelling'], 'but adds a kit to her own opening');

const s = summary('t03_access');
process.exitCode = s.failed > 0 ? 1 : 0;
