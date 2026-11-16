// Hiring demo data on top of tools/dev/seed_demo.mjs (Northwind Global), all
// through operations: a recruiter, a staffing plan, requisitions (one
// approved, one waiting), three openings (SG, US-CA, JP), candidates on the
// boards, interviews today and this week with scorecards, an offer waiting
// for approval, a referral, and a candidate past retention.
//   node seed_hiring.mjs   (HR_APP, HR_PORT as for the tests; writes fixtures/seed_ids.json)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, member, newApi } from './lib.mjs';

const api = newApi();
const OWNER = { as: 'owner' };
const HR = { as: 'hr@northwind.test' };
const MGR = { as: 'eng.lead@northwind.test' };
const SALES = { as: 'sales.lead@northwind.test' };
const SAM = { as: 'sam@northwind.test' };
const REC = { as: 'rita@northwind.test' };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

await member(api, 'rita@northwind.test', 'Rita Okafor', 'recruiter');
const rita = (await api.op('auth.me', {}, REC)).member;
const mei = (await api.op('auth.me', {}, MGR)).member;
const jordan = (await api.op('auth.me', {}, SALES)).member;
const ents = (await api.op('entities.list', {}, OWNER)).entities;
const sg = ents.find((e) => e.country === 'SG');

const plan = (await api.op('staffing-plans.save', { entity: sg.id, name: '2027 plan', from_day: '2027-01-01', to_day: '2027-12-31', status: 'active' }, HR)).plan;
const line = (await api.op('staffing-plans.line-save', { plan: plan.id, department: 'Engineering', planned: 6, budget: '640000' }, HR)).line;
await api.op('staffing-plans.line-save', { plan: plan.id, department: 'Operations', planned: 3, budget: '160000' }, HR);

const r1 = (await api.op('requisitions.save', { entity: sg.id, title: 'Backend engineer', department: 'Engineering', plan_line: line.id, headcount: 1, reason: 'growth', pay_min: '7000', pay_max: '9500', pay_per: 'month', target_start_day: day(60), justification: 'Payments platform work planned for next year needs a second backend engineer.' }, MGR)).requisition;
await api.op('requisitions.submit', { requisition: r1.id }, MGR);
const ap = (await api.op('approvals.list', {}, HR)).approvals.find((a) => a.kind === 'requisition');
await api.op('approvals.decide', { approval: ap.id, decision: 'approved', note: 'In the plan' }, HR);
const r2 = (await api.op('requisitions.save', { entity: sg.id, title: 'Data analyst', department: 'Operations', headcount: 1, reason: 'new_role', pay_min: '5500', pay_max: '7000', pay_per: 'month', justification: 'Reporting for the operations team.' }, SALES)).requisition;
await api.op('requisitions.submit', { requisition: r2.id }, SALES);

const o1 = (await api.op('openings.add', { requisition: r1.id, team: [rita.id], show_pay: true, location: 'Singapore HQ', location_text: 'Singapore (hybrid)', remote: 'hybrid' }, REC)).opening;
await api.op('openings.update', { opening: o1.id, description: '## About the role\n\nYou will build the payments platform that pays people in four countries on time.\n\n## What you will do\n\n- Design and run services for pay runs and bank files\n- Work with payroll specialists on rules and checks\n- Keep the system fast, observable and safe\n\n## What you need\n\n- Three or more years building backend services\n- Comfort with SQL and one of Go, TypeScript or Python\n\n## How we work\n\nHybrid from Singapore HQ, two days a week in the office.' }, REC);
await api.op('openings.set-status', { opening: o1.id, status: 'open' }, REC);
const o2 = (await api.op('openings.add', { entity: 'Northwind Inc', title: 'Account executive', location: 'San Francisco', hiring_manager: jordan.id, salary_min: '90000', salary_max: '120000', pay_per: 'year', positions: 2, team: [rita.id] }, REC)).opening;
await api.op('openings.set-status', { opening: o2.id, status: 'open' }, REC);
const o3 = (await api.op('openings.add', { entity: 'Northwind KK', title: 'Customer success manager', positions: 1 }, REC)).opening;

const people = [
  ['Jane Doe', 'jane.doe@example.com', 'Senior engineer', 'Stripe', 'job_board', o1.id],
  ['Arun Pillai', 'arun.p@example.com', 'Backend developer', 'Grab', 'sourced', o1.id],
  ['Mia Tan', 'mia.tan@example.com', 'Software engineer', 'Shopee', 'career_site', o1.id],
  ['Leo Park', 'leo.park@example.com', 'Platform engineer', 'Sea', 'agency', o1.id],
  ['Chloe Martin', 'chloe.m@example.com', 'Account executive', 'HubSpot', 'job_board', o2.id],
  ['Diego Alvarez', 'diego.a@example.com', 'Sales development rep', 'Gong', 'sourced', o2.id],
  ['Priya Shah', 'priya.shah@example.com', 'Account manager', 'Zendesk', 'event', o2.id],
];
const apps = {};
const cands = {};
for (const [name, email, title, company, source, opening] of people) {
  const r = await api.op('candidates.add', { name, email, current_title: title, current_company: company, source, opening, links: ['https://www.linkedin.com/in/' + email.split('@')[0].replace('.', '-')], consent: name === 'Mia Tan' }, REC);
  apps[name] = r.application.id;
  cands[name] = r.candidate.id;
}
await api.op('candidates.resume-set', { candidate: cands['Jane Doe'], path: join(FIXTURES, 'jane_doe_cv.pdf') }, { as: 'agent' });
await api.op('applications.move', { applications: [apps['Jane Doe'], apps['Arun Pillai']], stage: 'interview' }, REC);
await api.op('applications.move', { application: apps['Mia Tan'], stage: 'screen' }, REC);
await api.op('applications.move', { applications: [apps['Chloe Martin'], apps['Priya Shah']], stage: 'screen' }, REC);

const kits = (await api.op('interview-kits.list', {}, REC)).kits;
const skills = kits.find((k) => k.name === 'Skills interview');
const phone = kits.find((k) => k.name === 'Phone screen');
const ivJane = (await api.op('interviews.schedule', { application: apps['Jane Doe'], day: day(0), start: '15:00', interviewers: ['eng.lead@northwind.test', 'sam@northwind.test'], kit: skills.id, link: 'https://meet.example.com/jane-doe' }, REC)).interview;
const ivArun = (await api.op('interviews.schedule', { application: apps['Arun Pillai'], day: day(-1), start: '10:00', interviewers: ['eng.lead@northwind.test', 'sam@northwind.test'], kit: skills.id, link: 'https://meet.example.com/arun' }, REC)).interview;
await api.op('interviews.schedule', { application: apps['Mia Tan'], day: day(3), start: '11:30', interviewers: ['rita@northwind.test'], kit: phone.id, kind: 'phone' }, REC);
await api.op('interviews.schedule', { application: apps['Chloe Martin'], day: day(2), start: '09:00', timezone: 'America/Los_Angeles', interviewers: ['sales.lead@northwind.test'], kit: phone.id, kind: 'phone' }, REC);
await api.op('scorecards.save', { interview: ivArun.id, recommendation: 'yes', scores: { skills: 3, problem_solving: 3, collaboration: 4 }, notes: 'Walked through a queue design clearly. Asked good questions about pay run timing.', submit: true }, MGR);

const ivJane2 = (await api.op('interviews.schedule', { application: apps['Jane Doe'], day: day(-3), start: '14:00', interviewers: ['eng.lead@northwind.test', 'rita@northwind.test'], kit: phone.id, kind: 'phone', title: 'Phone screen' }, REC)).interview;
await api.op('scorecards.save', { interview: ivJane2.id, recommendation: 'strong_yes', scores: { role_fit: 4, communication: 4, logistics: 3 }, notes: 'Clear on why payments. Available from December.', submit: true }, MGR);
await api.op('scorecards.save', { interview: ivJane2.id, recommendation: 'yes', scores: { role_fit: 3, communication: 4, logistics: 4 }, notes: 'Good fit for hybrid. Salary expectation inside the range.', submit: true }, REC);
await api.op('interviews.summary', { interview: ivJane2.id, summary: 'Both interviewers noted a clear reason for the role and strong communication. One noted the start date fits December; the other that the pay expectation sits inside the posted range. No concerns were raised.' }, REC);

await api.op('applications.move', { application: apps['Leo Park'], stage: 'offer' }, REC);
const offer = (await api.op('offers.create', { application: apps['Leo Park'], start_day: day(30), amount: '8800', pay_per: 'month', components: [{ name: 'Signing bonus', amount: '3000', per: 'once' }], terms: (await api.op('offer-terms.list', {}, REC)).terms.slice(0, 3).map((x) => x.id) }, REC)).offer;
await api.op('offers.submit', { offer: offer.id }, REC);

await api.op('applications.reject', { application: apps['Diego Alvarez'], reason: 'Another candidate was a closer match', note: 'Strong energy, light on enterprise deals.' }, REC);
await api.op('referrals.add', { opening: o2.id, name: 'Kim Tan', email: 'kim.tan@example.com', relationship: 'Former colleague at Acme', note: 'Closed our biggest deal last year.' }, SAM);
const pool = await api.op('candidates.add', { name: 'Old Applicant', email: 'old.applicant@example.com', source: 'applied' }, REC);
await api.op('testhiring.backdate', { candidate: pool.candidate.id, retain_until: day(-20) }, OWNER);

const ids = { opening: o1.id, opening_us: o2.id, opening_jp: o3.id, candidate: cands['Jane Doe'], application: apps['Jane Doe'], interview: ivJane.id, interview_past: ivArun.id, interview_done: ivJane2.id, offer: offer.id, requisition: r1.id, requisition_pending: r2.id, plan: plan.id };
writeFileSync(join(FIXTURES, 'seed_ids.json'), JSON.stringify(ids, null, 2));
console.log('hiring demo seeded', JSON.stringify(ids));
