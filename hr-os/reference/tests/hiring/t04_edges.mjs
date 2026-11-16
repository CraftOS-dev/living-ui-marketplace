// Edges and contracts: declined approvals, cancelled ones, stage edits with
// candidates in them, closing with people still active, Google Calendar
// when it is not connected, the EU pay rule before interviews, the
// employment.hired subscriber with bad links, panel changes, an open offer
// blocking a rejection, retention days with consent, CSV export, profile
// facts and messages when email is off.
import { eq, fresh, member, newApi, ok, refuses, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const OWNER = { as: 'owner' };
const HR = { as: 'hr@northwind.test' };
const ENG = { as: 'eng.lead@northwind.test' };
const SAM = { as: 'sam@northwind.test' };
const REC = { as: 'rita@northwind.test' };
await member(api, 'rita@northwind.test', 'Rita Recruiter', 'recruiter');
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const decide = async (kind, decision, as) => {
  const ap = (await api.op('approvals.list', {}, as)).approvals.find((a) => a.kind === kind);
  return api.op('approvals.decide', { approval: ap.id, decision, note: decision === 'rejected' ? 'Not this quarter' : '' }, as);
};

section('requisition declined, changed, sent again, closed while pending');
await api.op('requisitions.save', { entity: 'Northwind Pte Ltd', title: 'Designer', budget: '90000' }, ENG);
await api.op('requisitions.submit', { requisition: 'R0001' }, ENG);
await decide('requisition', 'rejected', HR);
const rj = (await api.op('requisitions.get', { requisition: 'R0001' }, ENG)).requisition;
eq([rj.status, rj.decided_note], ['rejected', 'Not this quarter'], 'declined with the note');
await refuses(api, 'openings.add', { requisition: 'R0001' }, REC, 409, 'not_approved', 'no opening from a declined requisition');
const rj2 = (await api.op('requisitions.save', { requisition: 'R0001', headcount: 2 }, ENG)).requisition;
eq(rj2.status, 'draft', 'changing a declined one makes it a draft');
await api.op('requisitions.submit', { requisition: 'R0001' }, ENG);
const cl = await api.op('requisitions.close', { requisition: 'R0001', reason: 'Plans changed' }, HR);
eq(cl.requisition.status, 'closed', 'closed');
eq((await api.op('approvals.list', { status: 'cancelled', view: 'all' }, HR)).approvals.filter((a) => a.kind === 'requisition').length, 1, 'its pending approval was cancelled');

section('stages with candidates in them');
const op1 = (await api.op('openings.add', { entity: 'Northwind Pte Ltd', title: 'Analyst' }, REC)).opening;
await api.op('openings.set-status', { opening: op1.id, status: 'open' }, REC);
const a1 = (await api.op('candidates.add', { name: 'Ann Lee', email: 'ann@example.com', opening: op1.id }, REC)).application;
const a2 = (await api.op('candidates.add', { name: 'Bo Wu', email: 'bo@example.com', opening: op1.id }, REC)).application;
await api.op('applications.move', { applications: [a1.id, a2.id], stage: 'screen' }, REC);
const noScreen = [{ key: 'applied', name: 'Applied', kind: 'applied' }, { key: 'phone', name: 'Phone call', kind: 'screen' }, { key: 'interview', name: 'Interviews', kind: 'interview' }, { key: 'offer', name: 'Offer', kind: 'offer' }, { key: 'hired', name: 'Hired', kind: 'hired' }];
await refuses(api, 'openings.stages', { opening: op1.id, stages: noScreen }, REC, 409, 'stage_in_use', 'removing a stage with people in it asks where they go');
await refuses(api, 'openings.stages', { opening: op1.id, stages: noScreen.slice(0, 4) }, REC, 400, 'invalid_param', 'the last stage must be the hired one');
const st = await api.op('openings.stages', { opening: op1.id, stages: noScreen, moves: { screen: 'phone' } }, REC);
eq([st.moved[0].n, st.opening.stages[1].count], [2, 2], 'two candidates moved to the new stage');
ok(op1.employment_type_name !== '', 'a new opening gets the full-time type by default', op1.employment_type_name);
const copy = (await api.op('openings.add', { copy_from: op1.id, title: 'Analyst II' }, REC)).opening;
eq([copy.title, copy.stages.map((s) => s.name).join(','), copy.status, copy.entity], ['Analyst II', 'Applied,Phone call,Interviews,Offer,Hired', 'draft', op1.entity], 'a new opening like an earlier one (its stages, place and type)');

section('offer approval declined, offer withdrawn while pending, rejection blocked by an open offer');
const of1 = (await api.op('offers.create', { application: a1.id, start_day: '2027-01-04', amount: '5000' }, HR)).offer;
const sub = await api.op('offers.submit', { offer: of1.id }, HR);
ok(sub.approval.approvers.indexOf((await api.op('auth.me', {}, HR)).member.id) < 0, 'HR, who made the offer, is not its approver');
await decide('offer', 'rejected', OWNER);
const of1b = (await api.op('offers.get', { offer: of1.id }, HR)).offer;
eq([of1b.status, of1b.approval_status, of1b.approval_note], ['draft', 'rejected', 'Not this quarter'], 'a declined offer is a draft again with the note');
await api.op('offers.update', { offer: of1.id, amount: '5200' }, HR);
await api.op('offers.submit', { offer: of1.id }, HR);
const blocked = await api.call('applications.reject', { application: a1.id, reason: 'Role filled' }, REC);
ok(blocked.status === 409 && blocked.body.message.indexOf('withdraw it first') > 0, 'rejecting with an open offer is refused', blocked.body);
const wd = await api.op('offers.withdraw', { offer: of1.id, reason: 'Role re-scoped' }, HR);
eq([wd.offer.status, wd.offer.approval_status], ['withdrawn', 'cancelled'], 'withdrawn, approval cancelled');
const bulk = await api.op('applications.reject', { applications: [a1.id, a2.id], reason: 'Role closed or put on hold', message: true }, REC);
eq([bulk.done.length, bulk.messages.email_off], [2, 2], 'bulk reject; with candidate email off the messages are only kept on the timeline');

section('closing with people still active');
const a3 = (await api.op('candidates.add', { name: 'Cy Ho', email: 'cy@example.com', opening: op1.id }, REC)).application;
const closed = await api.op('openings.set-status', { opening: op1.id, status: 'closed' }, REC);
eq([closed.opening.close_reason, closed.active_left], ['cancelled', 1], 'close tells how many are still active');
await refuses(api, 'applications.add', { candidate: 'cy@example.com', opening: op1.id }, REC, 409, 'opening_closed', 'nobody is added to a closed opening');

section('Google Calendar not connected, EU pay rule, panel changes');
const de = (await api.op('entities.add', { name: 'Northwind GmbH', country: 'DE', legal_name: 'Northwind GmbH' }, OWNER)).entity;
const op2 = (await api.op('openings.add', { entity: de.id, title: 'Field engineer', positions: 5 }, REC)).opening;
ok(op2.pay_rule && op2.pay_rule.when === 'before_interview' && op2.issues.some((i) => i.code === 'pay_range_missing'), 'EU opening: the pay rule applies before the first interview', op2);
await api.op('openings.set-status', { opening: op2.id, status: 'open' }, REC);
const dApp = (await api.op('candidates.add', { name: 'Dana Roth', email: 'dana@example.com', opening: op2.id }, REC)).application;
const sch = await api.op('interviews.schedule', { application: dApp.id, day: tomorrow, start: '14:00', interviewers: ['sam@northwind.test', 'eng.lead@northwind.test'], calendar: true }, REC);
ok(sch.warnings.some((w) => w.code === 'pay_range_missing'), 'scheduling warns to give the pay range first');
eq(sch.interview.timezone, 'Europe/Berlin', 'interview in the entity\'s time zone');
ok(sch.calendar && sch.calendar.ok === false, 'calendar not connected: the interview is still made', sch.calendar);
await refuses(api, 'interviews.calendar', { interview: sch.interview.id }, REC, 409, 'calendar_not_connected', 'adding it later says why');
await api.op('scorecards.save', { interview: sch.interview.id, recommendation: 'no', notes: 'Not enough field experience', submit: true }, ENG);
const up = await api.op('interviews.update', { interview: sch.interview.id, interviewers: ['haruto@northwind.test'], start: '15:00' }, REC);
eq(up.interview.interviewers.map((i) => i.name), ['Haruto Sato'], 'panel replaced');
eq(up.interview.scorecards, { submitted: 1, total: 2 }, 'the submitted scorecard stays, Sam\'s empty one went, Haruto got one');
await refuses(api, 'scorecards.get', { interview: sch.interview.id }, SAM, 404, 'not_found', 'Sam is off the panel');
const cx = await api.op('interviews.cancel', { interview: sch.interview.id, reason: 'Candidate asked to move' }, REC);
eq([cx.interview.status, cx.interview.scorecards.total], ['cancelled', 1], 'cancelled; only the submitted scorecard is kept');
await refuses(api, 'scorecards.save', { interview: sch.interview.id, recommendation: 'yes' }, ENG, 409, 'conflict', 'no scorecards on a cancelled interview');

section('employment.hired subscriber');
const out1 = await api.op('people.hire', { entity: 'Northwind Pte Ltd', legal_name: 'Ann Lee', start_day: '2027-02-01', from_application: a1.id }, HR);
const ev1 = out1.events.find((e) => e.fn === 'lib_hiring_offers.onHired');
ok(ev1.ok && ev1.result.linked === false && ev1.result.reason.indexOf('rejected') > 0, 'a hire naming a rejected application is not linked (and says why)', ev1);
const out2 = await api.op('people.hire', { entity: 'Northwind Pte Ltd', legal_name: 'Zed Nobody', start_day: '2027-02-01', from_application: 'nope00000000000' }, HR);
ok(out2.events.find((e) => e.fn === 'lib_hiring_offers.onHired').result.linked === false, 'an unknown application is not linked');
const out3 = await api.op('people.hire', { entity: 'Northwind Pte Ltd', legal_name: 'Plain Hire', start_day: '2027-02-01' }, HR);
eq(out3.events.find((e) => e.fn === 'lib_hiring_offers.onHired').result, null, 'a hire without an application is left alone');
const a4 = (await api.op('candidates.add', { name: 'Eve Tan', email: 'eve@example.com', opening: op2.id }, REC)).application;
const lk = await api.op('applications.link-hire', { application: a4.id, employment: out3.employment.id }, HR);
ok(lk.linked === true, 'a hire made outside the offer flow is linked by hand');
await refuses(api, 'applications.link-hire', { application: a4.id, employment: out2.employment.id }, HR, 409, 'not_linked', 'and cannot be linked to a second hire');

section('retention days and consent');
const c5 = (await api.op('candidates.add', { name: 'Fay Ong', email: 'fay@example.com', opening: op2.id }, REC)).candidate;
const days = (d) => Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(+c5.created.slice(0, 4), +c5.created.slice(5, 7) - 1, +c5.created.slice(8, 10))) / 86400000);
eq([c5.country, days(c5.retain_until)], ['DE', 180], 'German entity: 180 days');
const c5b = (await api.op('candidates.update', { candidate: c5.id, consent: true }, REC)).candidate;
eq(days(c5b.retain_until), 730, 'with consent for future roles: 730 days');
await api.op('hiring.settings-update', { retention: { DE: 200, US: 365 } }, OWNER);
eq(days((await api.op('candidates.get', { candidate: c5.id }, REC)).candidate.retain_until), 730, 'consent days still win');
await api.op('candidates.update', { candidate: c5.id, consent: false }, REC);
eq(days((await api.op('candidates.get', { candidate: c5.id }, REC)).candidate.retain_until), 200, 'settings change applies to existing candidates');

section('export, facts');
const csv = await api.op('candidates.export', { view: 'all' }, REC);
ok(csv.csv.split('\r\n')[0].indexOf('name,email,phone') === 0 && csv.rows >= 5, 'CSV export with a header row', csv.rows);
await refuses(api, 'candidates.export', {}, ENG, 403, 'not_permitted', 'export needs full hiring access');
const a6 = (await api.op('candidates.add', { name: 'Gus Ray', email: 'gus@example.com', opening: op2.id }, REC)).application;
await api.op('interviews.schedule', { application: a6.id, day: tomorrow, start: '10:00', interviewers: ['sam@northwind.test'] }, REC);
const past = await api.op('interviews.schedule', { application: a6.id, day: yesterday, start: '10:00', interviewers: ['sam@northwind.test'] }, REC);
const samEmp = (await api.op('auth.me', {}, SAM)).employee.employments[0].id;
const own = await api.op('testhiring.facts', { employment: samEmp }, SAM);
const fv = Object.fromEntries(own.facts.map((f) => [f.label, f.value]));
eq([fv['Interviews this week'], fv['Scorecards you owe']], ['1', '1'], 'Sam: one interview ahead, one scorecard owed');
const other = await api.op('testhiring.facts', { employment: samEmp }, REC);
ok(other.facts.some((f) => f.label === 'Interviewing this week'), 'others see it in the third person');
const nobody = await api.op('testhiring.facts', { employment: samEmp }, { as: 'haruto@northwind.test' });
eq(nobody.facts.length, 0, 'a colleague without hiring access sees nothing');
const owed = await api.op('scorecards.mine', { status: 'owed' }, SAM);
eq(owed.owed.map((o) => o.interview), [past.interview.id], 'the started interview is owed');
const home = await api.op('hiring.home', {}, SAM);
eq([home.feedback_owed.length, home.interviews_week.length + home.interviews_today.length], [1, 1], 'Sam\'s hiring home: one owed, one coming');

const s = summary('t04_edges');
process.exitCode = s.failed > 0 ? 1 : 0;
