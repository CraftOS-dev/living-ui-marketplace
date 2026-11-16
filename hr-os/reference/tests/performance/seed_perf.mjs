// Performance demo data on top of tools/dev/seed_demo.mjs (scratch only): company values, goals with key
// results and check-ins, a running annual cycle with some reviews in, praise and feedback, a skill
// library with levels, training programs, sessions and requirements.
//   node seed_perf.mjs            (HR_PORT, HR_APP as lib.mjs)
// Prints the ids the screenshot pass needs as JSON on the last line.
import { AGENT, ANANYA, emp, ENG, HARUTO, HR, newApi, OWNER, SAM } from './lib.mjs';

const api = newApi();
const today = (await api.op('app.status', {}, OWNER)).today;
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const sam = await emp(api, 'sam@northwind.test');
const haruto = await emp(api, 'haruto@northwind.test');
const mei = await emp(api, 'eng.lead@northwind.test');
const nurul = await emp(api, 'nurul@northwind.test');
const ananya = await emp(api, 'ananya@northwind.test');

await api.op('perf.settings-update', { values: [{ name: 'Customers first', icon: 'Heart', description: 'We start from what the customer needs.' }, { name: 'Own it', icon: 'Flag', description: 'We finish what we start.' }, { name: 'Better together', icon: 'Handshake', description: 'We help each other win.' }, { name: 'Keep learning', icon: 'BookOpen', description: 'We grow every quarter.' }] }, HR);
await api.op('perf.settings-update', { entity: 'Northwind Pte Ltd', signoff: true }, HR);

const co = (await api.op('goals.create', { title: 'Grow ARR to 12 million', company: true, due: '2026-12-31', key_results: [{ title: 'Annual recurring revenue', start: 8, target: 12, current: 10.1, unit: 'USD m' }, { title: 'Net revenue retention', start: 100, target: 115, current: 108, unit: '%' }] }, HR)).goal;
const co2 = (await api.op('goals.create', { title: 'Make Northwind a great place to work', company: true, due: '2026-12-31', key_results: [{ title: 'Engagement score', start: 62, target: 75, current: 70, unit: 'pts' }] }, HR)).goal;
const eng = (await api.op('goals.create', { title: 'Ship the mobile app to every customer', department: 'Engineering', parent: co.id, due: '2026-12-15' }, ENG)).goal;
const g1 = (await api.op('goals.create', { title: 'Launch the mobile beta', parent: eng.id, weight: 50, due: '2026-11-30', start_day: '2026-07-01', key_results: [{ title: 'Beta users', target: 500, unit: 'users' }, { title: 'Crash-free sessions', start: 90, target: 99.5, current: 92, unit: '%' }] }, SAM)).goal;
await api.op('goals.checkin', { goal: g1.id, key_results: { kr1: 180 }, note: 'Opened the beta to staff and two pilot customers' }, SAM);
await api.op('goals.checkin', { goal: g1.id, key_results: { kr1: 320, kr2: 96.4 }, status: 'at_risk', note: 'Android crash on older phones; fix in review' }, SAM);
const g2 = (await api.op('goals.create', { title: 'Cut build time in half', weight: 30, start_day: '2026-06-01', due: '2026-10-31', key_results: [{ title: 'Build minutes', start: 22, target: 11, current: 16, unit: 'min' }] }, SAM)).goal;
await api.op('goals.create', { title: 'Mentor the two new interns', weight: 20, employee: sam.employee, due: '2027-01-31' }, ENG);
const g4 = (await api.op('goals.create', { title: 'Payments API v2', employee: nurul.employee, parent: eng.id, due: '2026-12-20', key_results: [{ title: 'Endpoints migrated', target: 24, current: 15, unit: 'endpoints' }] }, ENG)).goal;
await api.op('goals.checkin', { goal: g4.id, key_results: { kr1: 17 }, note: 'Refunds and payouts done' }, ENG);
await api.op('goals.create', { title: 'Japanese localisation', employee: haruto.employee, parent: eng.id, due: '2027-02-28', key_results: [{ title: 'Screens translated', target: 140, current: 96, unit: 'screens' }] }, ENG);
await api.op('goals.create', { title: 'Learn the payments stack', employee: ananya.employee, due: '2027-03-31' }, ENG);
await api.op('goals.create', { title: 'Hire four engineers in Mumbai', department: 'Engineering', parent: co2.id, due: '2027-03-31', key_results: [{ title: 'Offers accepted', target: 4, current: 1, unit: 'people' }] }, ENG);

const phases = [
  { key: 'self', start: add(today, -6), end: add(today, 7) },
  { key: 'peer', start: add(today, -6), end: add(today, 7) },
  { key: 'manager', start: add(today, -2), end: add(today, 12) },
  { key: 'calibration', start: add(today, 13), end: add(today, 18) },
  { key: 'sharing', start: add(today, 19), end: add(today, 30) },
];
const c = (await api.op('cycles.create', { kind: 'annual', name: 'Annual review 2026', participants: { departments: ['Engineering', 'Leadership', 'People and Finance'] }, phases }, HR)).cycle;
await api.op('cycles.launch', { cycle: c.id }, HR);
await api.op('cycles.create', { kind: 'quarterly', name: 'Q1 check-in 2027' }, HR);

async function fill(rv, as, overall, rating) {
  const r = (await api.op('reviews.get', { review: rv }, as)).review;
  const answers = {};
  const ratings = {};
  for (const s of r.sections) {
    if (s.kind === 'questions')
      for (const it of s.items) answers[s.key + '.' + it.key] = it.key === 'went_well' ? 'Shipped the beta to pilot customers and kept quality high while the team grew.' : it.key === 'improve' ? 'Plan releases earlier and write decisions down for the team.' : 'More time with design.';
    if (s.kind === 'competencies') for (const it of s.items) ratings[s.key + '.' + it.key] = rating;
    if (s.kind === 'goals' && s.rate !== false) for (const g of s.goals) ratings[s.key + '.' + g.id] = rating;
  }
  return Object.assign({ answers: answers, ratings: ratings }, r.overall_enabled ? { overall: overall } : {});
}

const samRevs = (await api.op('reviews.list', {}, SAM)).reviews;
const samSelf = samRevs.find((x) => x.kind === 'self');
await api.op('reviews.submit', Object.assign({ review: samSelf.id }, await fill(samSelf.id, SAM, 4, 4)), SAM);
await api.op('reviews.add-peer', { participant: samSelf.participant, reviewer: haruto.employee }, SAM);
const hp = (await api.op('reviews.list', {}, HARUTO)).reviews.find((x) => x.kind === 'peer');
await api.op('reviews.submit', Object.assign({ review: hp.id }, await fill(hp.id, HARUTO, 0, 4)), HARUTO);
const meiRevs = (await api.op('reviews.list', {}, ENG)).reviews.filter((x) => x.kind === 'manager');
let k = 0;
for (const r of meiRevs) {
  if (r.employee.id === sam.employee) continue;
  if (k >= 2) break;
  await api.op('reviews.submit', Object.assign({ review: r.id }, await fill(r.id, ENG, 3 + (k % 2), 3)), ENG);
  k++;
}
const samMgr = meiRevs.find((x) => x.employee.id === sam.employee);
await api.op('reviews.save', Object.assign({ review: samMgr.id }, await fill(samMgr.id, ENG, 4, 4)), ENG);
const sumReq = await api.op('reviews.request-summary', { review: samMgr.id }, ENG);
await api.op(
  'review-summaries.submit',
  {
    summary: sumReq.summary.id,
    text: 'Goals in the period\nLaunch the mobile beta: 59% (320 of 500 beta users; crash-free sessions 96.4% against 99.5%). Marked at risk at the last check-in because of an Android crash on older phones.\nCut build time in half: 55% (16 minutes against a target of 11, from 22).\n\nFeedback\nHaruto noted pairing on the release and clear release notes. Praise from Mei Lin tagged Own it.\n\nGaps in the record\nNo check-ins on the build time goal since it was set.',
    sources: [{ kind: 'goal', id: g1.id }, { kind: 'goal', id: g2.id }],
  },
  AGENT,
);

await api.op('feedback.give', { to: sam.employee, text: 'Thanks for staying late to get the beta out. The pilot customers noticed.', values: ['own-it', 'customers-first'] }, ENG);
await api.op('feedback.give', { to: mei.employee, text: 'The new planning board made this sprint calm. Thank you.', values: ['better-together'] }, SAM);
await api.op('feedback.give', { to: haruto.employee, text: 'Great Japanese copy review, our Tokyo customers love it.', values: ['customers-first'] }, ANANYA);
await api.op('feedback.give', { to: sam.employee, kind: 'feedback', visibility: 'private', text: 'In design reviews, let others finish before answering.' }, HARUTO);
await api.op('feedback.request', { from: [haruto.employee, ananya.employee], text: 'How did the beta launch go from your side?', due: add(today, 6) }, SAM);

await api.op('skills.add', { names: ['TypeScript', 'React', 'SQL', 'Kubernetes', 'System design'], category: 'Engineering' }, HR);
await api.op('skills.add', { names: ['Japanese', 'Mentoring'], category: 'People' }, HR);
await api.op('skills.update', { skill: 'TypeScript', levels: ['Reads it', 'Small changes', 'Owns features', 'Designs modules', 'Sets direction'], expected: [{ job_title: 'Software Engineer', level: 3 }, { job_title: 'Senior Software Engineer', level: 4 }] }, HR);
await api.op('skills.update', { skill: 'System design', expected: [{ job_title: 'Senior Software Engineer', level: 3 }] }, HR);
const levels = [[sam, 'TypeScript', 4], [sam, 'React', 3], [sam, 'SQL', 2], [haruto, 'TypeScript', 2], [haruto, 'Japanese', 5], [haruto, 'React', 3], [ananya, 'SQL', 3], [ananya, 'TypeScript', 2]];
for (const [p, s, l] of levels) await api.op('employee-skills.set', { employee: p.employee, skill: s, level: l }, OWNER);
await api.op('employee-skills.set', { employee: sam.employee, skill: 'TypeScript', verified: true }, ENG);
await api.op('employee-skills.set', { employee: haruto.employee, skill: 'Japanese', verified: true }, ENG);

await api.op('training-programs.add', { name: 'Fire safety', kind: 'course', valid_months: 12, duration_hours: 2, provider: 'SafeWork Academy' }, HR);
await api.op('training-programs.add', { name: 'Data protection basics', kind: 'course', valid_months: 24, duration_hours: 1 }, HR);
await api.op('training-programs.add', { name: 'Negotiation workshop', kind: 'workshop', duration_hours: 6, provider: 'Northwind Learning' }, HR);
const t1 = (await api.op('trainings.add', { program: 'Fire safety', start: add(today, -3), capacity: 20, location: 'Level 3, Raffles Place', cost: '120.00' }, HR)).training;
await api.op('trainings.enrol', { training: t1.id, employees: [sam.employee, haruto.employee, nurul.employee] }, HR);
const t1v = (await api.op('trainings.get', { training: t1.id }, HR)).training;
await api.op('trainings.attendance', { training: t1.id, rows: t1v.attendees.map((a, i) => (i < 2 ? { attendee: a.id, status: 'completed', score: 88 + i * 5, result: 'pass' } : { attendee: a.id, status: 'no_show' })) }, HR);
await api.op('trainings.feedback', { training: t1.id, rating: 5, feedback: 'Short and practical.' }, SAM);
const t2 = (await api.op('trainings.add', { program: 'Negotiation workshop', start: add(today, 9), start_time: '09:30', end_time: '15:30', capacity: 12, location: 'Tokyo Office' }, HR)).training;
await api.op('trainings.enrol', { training: t2.id }, ANANYA);
await api.op('trainings.add', { program: 'Data protection basics', start: add(today, 4), link: 'https://learn.example.com/dp' }, HR);
await api.op('training-requirements.add', { program: 'Fire safety', due_days: 30 }, HR);
await api.op('training-requirements.add', { program: 'Data protection basics', department: 'Engineering', due_day: add(today, -2) }, HR);

console.log(JSON.stringify({ cycle: c.id, goal: g1.id, session: t1.id, sam_self: samSelf.id, sam_manager: samMgr.id, peer: hp.id, participant: samSelf.participant }));
