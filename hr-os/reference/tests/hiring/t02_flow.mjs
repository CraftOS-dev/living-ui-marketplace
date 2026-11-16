// Hiring end to end on the demo company: plan, requisition and its approval,
// an opening with a job post your AI agent drafts, candidates (by hand, CSV,
// resume), the board, an interview with scorecards and the blind rule, a
// neutral summary, an offer with approval, letter, acceptance, the kernel
// hire linking back, rejection with a message, a referral, retention and
// messages through a stand-in bridge, Google Calendar.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { FIXTURES, eq, fresh, member, newApi, ok, refuses, section, summary } from './lib.mjs';

// A port nobody else holds (other builders run their own stand-ins on fixed ports).
const BRIDGE_PORT = await new Promise((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const BRIDGE_LOG = join(FIXTURES, '..', 'bridge_log.jsonl');
const bridge = spawn('node', [join(FIXTURES, '..', 'fake_bridge.mjs'), String(BRIDGE_PORT), BRIDGE_LOG], { stdio: 'ignore' });
process.on('exit', () => bridge.kill());
await new Promise((r) => setTimeout(r, 600));
const bridgeCalls = () =>
  readFileSync(BRIDGE_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));

try {
  fresh({ seed: true, env: { CRAFTBOT_BRIDGE_URL: 'http://127.0.0.1:' + BRIDGE_PORT, CRAFTBOT_BRIDGE_TOKEN: 'test-bridge-token' } });
  const api = newApi();
  const OWNER = { as: 'owner' };
  const HR = { as: 'hr@northwind.test' };
  const MGR = { as: 'eng.lead@northwind.test' };
  const SAM = { as: 'sam@northwind.test' };
  const REC = { as: 'rita@northwind.test' };
  const AGENT = { as: 'agent' };
  await member(api, 'rita@northwind.test', 'Rita Recruiter', 'recruiter');

  section('staffing plan');
  const sg = (await api.op('entities.list', {}, OWNER)).entities.find((e) => e.country === 'SG');
  const plan = (await api.op('staffing-plans.save', { entity: sg.id, name: '2027 plan', from_day: '2027-01-01', to_day: '2027-12-31' }, HR)).plan;
  eq(plan.currency, 'SGD', 'plan currency from the entity');
  const lineOut = await api.op('staffing-plans.line-save', { plan: plan.id, department: 'Engineering', planned: 6, budget: '600000' }, HR);
  eq(lineOut.line.current, 3, 'three engineers in SG today (from the job records)');
  eq(lineOut.line.gap, 3, 'gap of three');
  await refuses(api, 'staffing-plans.save', { entity: sg.id, name: 'x' }, MGR, 403, 'not_permitted', 'a manager cannot make staffing plans');

  section('requisition and approval');
  const req0 = (await api.op('requisitions.save', { entity: 'Northwind Pte Ltd', title: 'Backend engineer', department: 'Engineering', plan_line: lineOut.line.id, headcount: 1, reason: 'growth', pay_min: '7000', pay_max: '9500', pay_per: 'month', justification: 'Payments work in 2027' }, MGR)).requisition;
  eq(req0.status, 'draft', 'manager drafts a requisition');
  eq(req0.number, 'R0001', 'numbered R0001');
  eq(req0.hiring_manager_name, 'Mei Lin Chua', 'the manager is the hiring manager');
  const sub = await api.op('requisitions.submit', { requisition: 'R0001' }, MGR);
  eq(sub.requisition.status, 'pending', 'sent for approval');
  ok(sub.approval.approvers.length >= 1, 'the approval has approvers', sub.approval);
  await refuses(api, 'requisitions.list', {}, SAM, 403, 'not_permitted', 'an employee cannot list requisitions');
  const inbox = await api.op('approvals.list', {}, HR);
  const ap = inbox.approvals.find((a) => a.kind === 'requisition');
  ok(ap !== undefined, 'HR sees the requisition in the Inbox');
  await api.op('approvals.decide', { approval: ap.id, decision: 'approved', note: 'Budgeted' }, HR);
  eq((await api.op('requisitions.get', { requisition: 'R0001' }, MGR)).requisition.status, 'approved', 'requisition approved');
  const home0 = await api.op('hiring.home', {}, REC);
  ok(home0.requisitions_waiting.some((r) => r.number === 'R0001'), 'recruiter Home shows the approved requisition waiting for an opening');

  section('opening and job post by your AI agent');
  const rita = (await api.op('auth.me', {}, REC)).member;
  const op1 = (await api.op('openings.add', { requisition: 'R0001', team: [rita.id], show_pay: true }, REC)).opening;
  eq([op1.number, op1.title, op1.status, op1.positions], ['J0001', 'Backend engineer', 'draft', 1], 'opening J0001 from the requisition');
  eq(op1.stages.map((s) => s.name), ['Applied', 'Screen', 'Interview', 'Offer', 'Hired'], 'default stages');
  eq(op1.salary_min, '7000.00', 'pay range from the requisition');
  const draft = await api.op('openings.draft-post', { opening: 'J0001', notes: 'Stress the payments platform' }, REC);
  ok(draft.agent !== null && draft.agent.trigger === 'job_post_draft' && draft.agent.record === op1.id, 'your AI agent is asked about the opening (job_post_draft)', draft.agent);
  const seen = (await api.op('openings.get', { opening: 'J0001' }, AGENT)).opening;
  ok(seen.title === 'Backend engineer' && seen.agent.note === 'Stress the payments platform' && seen.agent.open === true, 'agent reads the opening and what the person asked for', seen.agent);
  const prop = await api.op('openings.update', { opening: 'J0001', description: '## Backend engineer\n\nBuild our payments platform.', why: 'Drafted from the requisition' }, AGENT);
  ok(prop.proposed === true, 'the job post is a proposal');
  const delivered = (await api.op('openings.get', { opening: 'J0001' }, REC)).opening.agent;
  ok(delivered.ended_at !== '' && delivered.open === false, 'its proposal closes the ask', delivered);
  await api.op('proposals.accept', { proposal: prop.proposal }, REC);
  ok((await api.op('openings.get', { opening: 'J0001' }, REC)).opening.description.indexOf('payments platform') > 0, 'accepted post is on the opening');
  await refuses(api, 'openings.set-status', { opening: 'J0001', status: 'open' }, AGENT, 403, 'agent_not_permitted', 'your AI agent cannot open an opening');
  await refuses(api, 'openings.set-status', { opening: 'J0001', status: 'open' }, MGR, 403, 'not_permitted', 'a manager cannot publish');
  const opened = await api.op('openings.set-status', { opening: 'J0001', status: 'open' }, REC);
  eq(opened.opening.status, 'open', 'recruiter opens J0001');
  eq(opened.issues.length, 0, 'no pay transparency warning in SG');
  const us = (await api.op('openings.add', { entity: 'Northwind Inc', title: 'Account executive', location: 'San Francisco' }, REC)).opening;
  eq([us.country, us.region], ['US', 'CA'], 'US opening works in California (from its location)');
  ok(us.issues.some((i) => i.code === 'pay_range_missing'), 'California opening without a pay range warns', us.issues);
  const us2 = (await api.op('openings.update', { opening: us.id, salary_min: '90000', salary_max: '120000', pay_per: 'year' }, REC)).opening;
  eq(us2.issues.length, 0, 'warning goes once the range is there');
  eq(us2.pay_text, 'USD 90,000.00 to 120,000.00 a year', 'pay text');
  await api.op('openings.set-status', { opening: us.id, status: 'open' }, REC);

  section('candidates');
  const jane = await api.op('candidates.add', { name: 'Jane Doe', email: 'Jane@Example.com', current_title: 'Engineer', source: 'job_board', opening: 'J0001', consent: true }, REC);
  eq(jane.candidate.email, 'jane@example.com', 'email stored lower case');
  eq(jane.application.stage, 'applied', 'Jane lands in Applied');
  ok(jane.candidate.retain_until > '2027-01-01' && jane.candidate.consent_at !== '', 'retention day set (consent keeps longer)', jane.candidate);
  await refuses(api, 'candidates.add', { name: 'Jane Again', email: 'jane@example.com' }, REC, 409, 'duplicate_candidate', 'duplicate email refused');
  eq((await api.op('candidates.check', { email: 'JANE@example.com' }, REC)).exists, true, 'duplicate check by email');
  const dry = await api.op('candidates.import', { path: join(FIXTURES, 'candidates.csv'), opening: 'J0001', dry_run: true }, AGENT);
  eq([dry.summary.added, dry.summary.duplicates, dry.summary.invalid], [2, 1, 2], 'dry run: 2 new, 1 duplicate, 2 invalid');
  eq((await api.op('candidates.list', {}, REC)).total, 1, 'dry run changed nothing');
  const imp = await api.op('candidates.import', { path: join(FIXTURES, 'candidates.csv'), opening: 'J0001' }, AGENT);
  eq(imp.summary.added, 2, 'your AI agent imported two candidates from a file it was given');
  ok(imp.report.find((r) => r.row === 4).status === 'duplicate', 'Jane (same email, other case) not duplicated');
  const resume = await api.op('candidates.resume-set', { candidate: jane.candidate.id, path: join(FIXTURES, 'jane_doe_cv.pdf') }, AGENT);
  eq([resume.candidate.has_resume, resume.candidate.resume_name], [true, 'jane_doe_cv.pdf'], 'agent attached the resume');
  const file = await api.call('candidates.resume', { candidate: jane.candidate.id }, REC);
  eq(file.status, 200, 'recruiter opens the resume');
  const board = await api.op('openings.board', { opening: 'J0001' }, REC);
  eq(board.columns[0].cards.length, 3, 'three candidates in Applied');

  section('moving is a person\'s decision');
  const alice = board.columns[0].cards.find((c) => c.name === 'Alice Ong');
  const ben = board.columns[0].cards.find((c) => c.name === 'Ben Ito');
  const janeApp = jane.application.id;
  await refuses(api, 'applications.move', { application: janeApp, stage: 'screen' }, AGENT, 403, 'agent_not_permitted', 'your AI agent cannot move candidates');
  await refuses(api, 'applications.reject', { application: janeApp, reason: 'Role filled' }, AGENT, 403, 'agent_not_permitted', 'your AI agent cannot reject');
  await refuses(api, 'applications.move', { application: janeApp, stage: 'hired' }, REC, 409, 'not_moved', 'nobody drags a candidate to Hired');
  const mv = await api.op('applications.move', { applications: [alice.application, ben.application], stage: 'Screen' }, REC);
  eq(mv.moved.length, 2, 'bulk move by stage name');
  await api.op('applications.move', { application: janeApp, stage: 'interview' }, MGR);
  const b2 = await api.op('openings.board', { opening: 'J0001' }, MGR);
  eq(b2.columns.map((c) => c.cards.length), [0, 2, 1, 0, 0], 'board after moves (hiring manager view)');

  section('interview, scorecards and the blind rule');
  const kits = (await api.op('interview-kits.list', { opening: 'J0001' }, REC)).kits;
  const kit = kits.find((k) => k.name === 'Skills interview');
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const sch = await api.op('interviews.schedule', { application: janeApp, day: tomorrow, start: '10:00', interviewers: ['eng.lead@northwind.test', 'sam@northwind.test'], kit: kit.id, link: 'https://meet.example.com/abc', calendar: true }, REC);
  const iv = sch.interview;
  eq([iv.duration_min, iv.kind, iv.timezone, iv.scorecards.total], [60, 'video', 'Asia/Singapore', 2], 'interview from the kit in the entity time zone, two scorecards');
  ok(iv.at === new Date(Date.UTC(Number(tomorrow.slice(0, 4)), Number(tomorrow.slice(5, 7)) - 1, Number(tomorrow.slice(8, 10)), 2, 0)).toISOString(), '10:00 Singapore is 02:00 UTC', iv.at);
  const ivEvent = (await api.op('candidates.get', { candidate: jane.candidate.id }, REC)).timeline.find((e) => e.kind === 'interview' && e.ref === iv.id);
  ok(ivEvent && ivEvent.day === tomorrow && ivEvent.start === '10:00' && ivEvent.zone === 'Asia/Singapore' && !/\d{4}-\d{2}/.test(ivEvent.text), 'the timeline keeps the interview time as data, not written into the text', ivEvent);
  ok(sch.calendar && sch.calendar.ok === true && iv.calendar_event === 'evt_1', 'Google Calendar event created through the bridge', sch.calendar);
  const calCall = bridgeCalls().find((c) => c.body && c.body.action === 'create_google_calendar_event');
  ok(calCall && calCall.body.confirm_irreversible === true && calCall.body.params.event_data.attendees.length === 3, 'event has the panel and the candidate as guests', calCall && calCall.body);
  ok(calCall.auth === 'Bearer test-bridge-token', 'bridge called with its token');
  const samIvs = await api.op('interviews.list', { mine: true }, SAM);
  eq(samIvs.interviews.length, 1, 'Sam (an employee) sees the interview he is on');
  await refuses(api, 'candidates.list', {}, SAM, 403, 'not_permitted', 'Sam cannot list candidates');
  await refuses(api, 'openings.board', { opening: 'J0001' }, SAM, 403, 'not_permitted', 'Sam cannot see the board');
  const samCand = await api.op('candidates.get', { candidate: jane.candidate.id }, SAM);
  ok(samCand.candidate.access === 'interviewer' && samCand.candidate.email === undefined && samCand.timeline.length === 0, 'interviewer sees the basics only (no email, no timeline)', samCand.candidate);
  eq((await api.call('candidates.resume', { candidate: jane.candidate.id }, SAM)).status, 200, 'interviewer opens the resume');
  const sc = await api.op('scorecards.get', { interview: iv.id }, SAM);
  eq(sc.interview.kit_detail.criteria.length, 3, 'scorecard carries the kit criteria');
  await refuses(api, 'scorecards.save', { interview: iv.id, submit: true }, SAM, 400, 'missing_param', 'a submit needs a recommendation');
  await refuses(api, 'scorecards.save', { interview: iv.id, recommendation: 'yes', scores: { skills: 5 } }, SAM, 400, 'invalid_param', 'scores are 1 to 4');
  await refuses(api, 'scorecards.save', { interview: iv.id, recommendation: 'yes', scores: { charm: 3 } }, SAM, 400, 'invalid_param', 'only kit criteria are scored');
  await api.op('scorecards.save', { interview: iv.id, recommendation: 'yes', scores: { skills: 3, problem_solving: 4 }, notes: 'Clear on payments flows', submit: true }, SAM);
  const mgrView = await api.op('interviews.get', { interview: iv.id }, MGR);
  ok(mgrView.interview.scorecard.others.length === 0 && mgrView.interview.scorecard.hidden === 1, 'Mei Lin (on the panel, not submitted) cannot see Sam\'s scorecard yet', mgrView.interview.scorecard);
  const recView = await api.op('interviews.get', { interview: iv.id }, REC);
  eq(recView.interview.scorecard.others.length, 1, 'the recruiter (not on the panel) sees submitted scorecards');
  await refuses(api, 'scorecards.save', { interview: iv.id, recommendation: 'strong_yes', submit: true }, AGENT, 403, 'agent_not_permitted', 'your AI agent never writes a scorecard');
  await refuses(api, 'scorecards.save', { interview: iv.id, recommendation: 'yes' }, REC, 403, 'not_on_panel', 'only panel members write scorecards');
  await api.op('scorecards.save', { interview: iv.id, recommendation: 'strong_yes', scores: { skills: 4, collaboration: 3 }, notes: 'Strong system design', submit: true }, MGR);
  const mgrView2 = await api.op('interviews.get', { interview: iv.id }, MGR);
  eq(mgrView2.interview.scorecard.others.length, 1, 'after submitting, Mei Lin sees Sam\'s');
  const samView = await api.op('interviews.get', { interview: iv.id }, SAM);
  eq(samView.interview.scorecard.others.map((s) => s.interviewer_name), ['Mei Lin Chua'], 'and Sam sees hers');

  section('neutral summary by your AI agent');
  const ask = await api.op('interviews.summarize', { interview: iv.id }, REC);
  ok(ask.asked === true && ask.agent.trigger === 'interview_summary' && ask.agent.record === iv.id, 'your AI agent is asked about the interview (interview_summary)', ask);
  eq((await api.op('interviews.summarize', { interview: iv.id }, REC)).asked, false, 'asking again while that ask is open asks nothing');
  const agentIv = await api.op('interviews.get', { interview: iv.id }, AGENT);
  eq(agentIv.interview.scorecard.others.length, 2, 'agent reads both submitted scorecards');
  const sp = await api.op('interviews.summary', { interview: iv.id, summary: 'Both interviewers noted clear thinking on payments; one asked for more on testing.', why: 'Summary of 2 scorecards' }, AGENT);
  ok(sp.proposed === true, 'summary is a proposal');
  await api.op('proposals.accept', { proposal: sp.proposal }, REC);
  ok((await api.op('interviews.get', { interview: iv.id }, REC)).interview.summary.indexOf('payments') > 0, 'summary on the interview after a person accepts');

  section('offer, approval, letter, acceptance');
  const terms = (await api.op('offer-terms.list', {}, REC)).terms;
  const offer0 = (await api.op('offers.create', { application: janeApp, start_day: '2026-12-01', amount: '8800', pay_per: 'month', components: [{ name: 'Signing bonus', amount: '3000', per: 'once' }], terms: [terms[0].id, terms[1].id] }, REC)).offer;
  eq([offer0.number, offer0.status, offer0.amount, offer0.currency], ['OF0001', 'draft', '8800.00', 'SGD'], 'draft offer OF0001');
  ok(offer0.letter.indexOf('SGD 8,800.00 a month') > 0 && offer0.letter.indexOf('Signing bonus') > 0 && offer0.letter.indexOf('**Probation**') >= 0, 'letter rendered from the template', offer0.letter.slice(0, 400));
  ok(offer0.letter.indexOf('{{') < 0, 'no placeholder left in the letter');
  eq((await api.op('applications.get', { application: janeApp }, REC)).application.stage, 'offer', 'Jane moved to Offer with the offer');
  await refuses(api, 'offers.create', { application: janeApp, amount: '9000' }, REC, 409, 'offer_open', 'one open offer per application');
  await refuses(api, 'offers.create', { application: alice.application, amount: '9000' }, AGENT, 403, 'agent_not_permitted', 'your AI agent cannot make offers');
  const subm = await api.op('offers.submit', { offer: 'OF0001' }, REC);
  eq(subm.offer.status, 'pending', 'offer waits for approval');
  ok(subm.approval.summary.indexOf('8,800') < 0 && subm.approval.summary.indexOf('8800') < 0, 'no amount in the approval title (it may be emailed)');
  const hrAp = (await api.op('approvals.list', {}, HR)).approvals.find((a) => a.kind === 'offer');
  ok(hrAp && hrAp.payload.amount_minor === 880000 && hrAp.payload.currency === 'SGD' && hrAp.payload.pay_per === 'month', 'HR sees the pay in the approval (minor units and currency, written by the UI)', hrAp && hrAp.payload);
  ok(hrAp && hrAp.summary.indexOf('2026-') < 0 && hrAp.summary.indexOf('starting') < 0, 'no written date in the approval title (the UI writes dates)', hrAp && hrAp.summary);
  await api.op('approvals.decide', { approval: hrAp.id, decision: 'approved' }, HR);
  const sent = await api.op('offers.send', { offer: 'OF0001' }, REC);
  eq([sent.offer.status, sent.offer.letter_frozen], ['sent', true], 'offer sent, letter frozen');
  const letter = await api.op('offers.letter', { offer: 'OF0001' }, REC);
  ok(letter.markdown.indexOf('Jane Doe') >= 0 && letter.entity_name === 'Northwind Pte. Ltd.', 'print letter data');
  const acc = await api.op('offers.respond', { offer: 'OF0001', answer: 'accepted' }, REC);
  eq(acc.offer.status, 'accepted', 'accepted');
  ok(acc.hire && acc.hire.from_application === janeApp && acc.hire.pay_amount === '8800.00' && acc.hire.personal_email === 'jane@example.com', 'answer carries the prefilled hire', acc.hire);
  const hrHome = await api.op('hiring.home', {}, HR);
  ok(hrHome.ready_to_hire.some((o) => o.id === acc.offer.id) && hrHome.can.hire === true, 'HR Home: ready to hire');

  section('kernel hire links back');
  const draftH = (await api.op('offers.hire-draft', { offer: 'OF0001' }, HR)).hire;
  const hired = await api.op('people.hire', draftH, HR);
  const link = hired.events.find((e) => e.fn === 'lib_hiring_offers.onHired');
  ok(link && link.ok && link.result.linked === true && link.result.opening_closed === true && link.result.requisition_status === 'filled', 'employment.hired linked the application, closed J0001 and filled R0001', link);
  const app2 = (await api.op('applications.get', { application: janeApp }, REC)).application;
  eq([app2.status, app2.stage, app2.hired_employment], ['hired', 'hired', hired.employment.id], 'application hired');
  eq((await api.op('requisitions.get', { requisition: 'R0001' }, MGR)).requisition.status, 'filled', 'requisition filled');
  eq((await api.op('openings.get', { opening: 'J0001' }, REC)).opening.status, 'closed', 'opening closed as filled');
  eq((await api.op('candidates.get', { candidate: jane.candidate.id }, REC)).candidate.employee, hired.employee.id, 'candidate linked to the employee');
  const again = await api.op('applications.link-hire', { application: janeApp, employment: hired.employment.id }, HR);
  eq(again.already, true, 'linking twice is harmless');
  eq((await api.op('offers.list', {}, REC)).offers.length, 0, 'no open offers left (the accepted one is hired)');

  section('closing the others, messages');
  await api.op('hiring.settings-update', { email_candidates: true }, OWNER);
  const rej = await api.op('applications.reject', { application: alice.application, reason: 'Role filled', message: true, note: 'Strong, keep in mind' }, REC);
  eq(rej.done.length, 1, 'Alice rejected with a reason');
  eq(rej.messages, { queued: 1 }, 'her message is queued as an email');
  const wd = await api.op('applications.withdraw', { application: ben.application, reason: 'Accepted another offer' }, REC);
  eq(wd.done.length, 1, 'Ben withdrew');
  const sentMsgs = await api.op('testhiring.cron', { which: 'messages' }, OWNER);
  eq(sentMsgs.sent, 1, 'the minute job sent the email');
  const mail = bridgeCalls().find((c) => c.body && c.body.action === 'send_gmail');
  ok(mail && mail.body.params.to === 'alice.ong@example.com' && mail.body.params.body.indexOf('Alice Ong') >= 0 && mail.body.params.body.indexOf('{{') < 0, 'email through send_gmail with the placeholders filled', mail && mail.body);
  const aliceTl = (await api.op('candidates.get', { candidate: alice.candidate }, REC)).timeline;
  ok(aliceTl.some((e) => e.kind === 'message' && e.delivery === 'sent') && aliceTl.some((e) => e.kind === 'rejected'), 'timeline shows the rejection and the sent message');
  await refuses(api, 'applications.reopen', { application: alice.application }, REC, 409, 'opening_closed', 'reopening waits until the opening is open again');

  section('referral');
  const roles = await api.op('openings.open-roles', {}, SAM);
  ok(roles.openings.some((o) => o.title === 'Account executive') && !roles.openings.some((o) => o.title === 'Backend engineer'), 'employees see the open roles');
  const refd = await api.op('referrals.add', { opening: us.id, name: 'Kim Tan', email: 'kim.tan@example.com', relationship: 'Former colleague' }, SAM);
  eq(refd.referral.status, 'submitted', 'Sam refers Kim');
  await refuses(api, 'referrals.add', { opening: us.id, name: 'Kim Tan', email: 'kim.tan@example.com' }, SAM, 409, 'already_applied', 'same person twice is refused politely');
  const kim = (await api.op('candidates.list', { q: 'Kim' }, REC)).candidates[0];
  eq([kim.source, kim.source_detail], ['referral', 'Referred by Sam Wong'], 'candidate from the referral');
  await api.op('applications.move', { application: kim.applications[0].id, stage: 'screen' }, REC);
  const mine = await api.op('referrals.mine', {}, SAM);
  eq(mine.referrals.map((r) => r.status), ['in_process'], 'Sam sees only that it is in process');
  ok(mine.referrals[0].candidate === undefined && mine.referrals[0].application === undefined, 'no stage or record ids for the referrer');

  section('retention review');
  await api.op('testhiring.backdate', { candidate: ben.candidate, retain_until: '2026-01-01' }, OWNER);
  const ret = await api.op('hiring.retention', {}, REC);
  eq(ret.candidates.map((c) => c.name), ['Ben Ito'], 'Ben is past retention (nothing in process)');
  const cron = await api.op('testhiring.cron', { which: 'retention' }, OWNER);
  eq([cron.due, cron.flagged], [1, 1], 'daily job flags him once');
  eq((await api.op('testhiring.cron', { which: 'retention' }, OWNER)).flagged, 0, 'and not twice');
  ok((await api.op('notifications.list', {}, REC)).notifications.some((n) => n.title.indexOf('past the retention day') >= 0), 'the recruiter is told');
  ok((await api.op('candidates.get', { candidate: ben.candidate }, REC)).candidate.name === 'Ben Ito', 'nothing was deleted automatically');
  await refuses(api, 'candidates.delete', { candidate: ben.candidate, confirm: true }, AGENT, 403, 'agent_not_permitted', 'your AI agent never deletes candidates');
  const del = await api.op('candidates.delete', { candidates: [ben.candidate, jane.candidate.id] }, REC);
  eq([del.deleted.length, del.kept.length], [1, 1], 'a person deletes Ben; Jane (hired) is kept');

  section('profile facts and home');
  const samEmp = (await api.op('auth.me', {}, SAM)).employee.employments[0].id;
  const facts = await api.op('testhiring.facts', { employment: samEmp }, SAM);
  ok(Array.isArray(facts.facts), 'profile facts answer for the interviewer', facts);
  const profile = await api.op('people.get', { employee: 'sam@northwind.test' }, SAM);
  ok(profile.facts.some((m) => m.module === 'hiring'), 'hiring facts reach the profile', profile.facts);
  const mgrHome = await api.op('hiring.home', {}, MGR);
  ok(mgrHome.broad === false && mgrHome.openings.length === 0, 'Mei Lin sees only openings she is part of (J0001 closed)', mgrHome);

  const s = summary('t02_flow');
  process.exitCode = s.failed > 0 ? 1 : 0;
} finally {
  bridge.kill();
}
