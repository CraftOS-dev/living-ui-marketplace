// Continuous feedback and praise (visibility, requests, moderation),
// the skill library and matrix, and training (programs, sessions,
// enrolment, attendance, certificates as protected files, external
// completions, required trainings and compliance, reminders).
import { AGENT, ANANYA, emp, ENG, eq, fresh, HARUTO, HR, newApi, ok, OWNER, refuses, SALES, SAM, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const today = (await api.op('app.status', {}, OWNER)).today;
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const sam = await emp(api, 'sam@northwind.test');
const haruto = await emp(api, 'haruto@northwind.test');
const ananya = await emp(api, 'ananya@northwind.test');
const mei = await emp(api, 'eng.lead@northwind.test');
const emily = await emp(api, 'emily@northwind.test');

/** A multipart op call as a member (or the agent): { status, body }. */
async function upload(name, fields, file, as) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  if (file) fd.append('file', new Blob([file.data], { type: file.type }), file.name);
  const headers = {};
  if (as === 'agent') headers['X-A2App-Token'] = (await import('node:fs')).readFileSync(api.app + '/.agent-token', 'utf8').trim();
  else {
    if (!api.tokens.has(as)) await api.login(as);
    headers.authorization = api.tokens.get(as);
  }
  const res = await fetch(api.base + '/api/ops/' + name.replace('.', '/'), { method: 'POST', headers, body: fd });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}
async function getRaw(name, params, as) {
  if (!api.tokens.has(as)) await api.login(as);
  const res = await fetch(api.base + '/api/ops/' + name.replace('.', '/') + '?' + new URLSearchParams(params), { headers: { authorization: api.tokens.get(as) } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type'), size: buf.length, text: buf.toString('utf8').slice(0, 300) };
}

section('praise and the wall');
await api.op('perf.settings-update', { values: [{ name: 'Customers first', icon: 'Heart' }, { name: 'Own it', icon: 'Flag' }] }, HR);
await refuses(api, 'perf.settings-update', { values: [{ name: 'Bad', icon: 'Sparkle' }] }, HR, 400, 'invalid_param', 'value icons come from the curated list');
const pr = (await api.op('feedback.give', { to: mei.employee, text: 'Thank you for the clear roadmap', values: ['own-it'] }, SAM)).feedback;
eq([pr.kind, pr.visibility, pr.values[0].name], ['praise', 'public', 'Own it'], 'praise is public by default, tagged with a value');
await refuses(api, 'feedback.give', { to: mei.employee, text: 'x', values: ['nope'] }, SAM, 400, 'invalid_param', 'an unknown value is refused');
await refuses(api, 'feedback.give', { to: sam.employee, text: 'Me' }, SAM, 400, 'invalid_param', 'not to yourself');
await refuses(api, 'feedback.give', { to: mei.employee, text: 'x' }, AGENT, 403, 'agent_not_permitted', 'your AI agent never gives feedback');
const wall = await api.op('feedback.list', { view: 'wall' }, HARUTO);
ok(wall.feedback.some((f) => f.id === pr.id) && wall.values.length === 2, 'everyone sees the wall and the values');
eq((await api.op('feedback.list', { view: 'wall', value: 'customers-first' }, HARUTO)).feedback.length, 0, 'filter the wall by value');
eq((await api.op('feedback.list', { view: 'wall' }, AGENT)).feedback.length, 1, 'your AI agent reads the wall');
ok((await api.op('notifications.list', {}, ENG)).notifications.some((x) => x.title.indexOf('praised you') > 0), 'the person is told');
const home = await api.op('perf.home', {}, HARUTO);
eq(home.praise_total, 1, 'Home shows praise this week');

section('private and manager feedback');
const pf = (await api.op('feedback.give', { to: haruto.employee, kind: 'feedback', text: 'Your code reviews could be kinder', visibility: 'private' }, SAM)).feedback;
const mf = (await api.op('feedback.give', { to: haruto.employee, kind: 'feedback', text: 'Haruto carried the release', visibility: 'manager' }, SAM)).feedback;
const hr = await api.op('feedback.list', {}, HARUTO);
ok(hr.feedback.some((f) => f.id === pf.id) && !hr.feedback.some((f) => f.id === mf.id), 'the person sees private feedback, not feedback meant for their manager');
const ab = await api.op('feedback.list', { view: 'about', employee: haruto.employee }, ENG);
ok(ab.feedback.some((f) => f.id === mf.id) && !ab.feedback.some((f) => f.id === pf.id), 'the manager sees manager feedback, not private feedback');
const abh = await api.op('feedback.list', { view: 'about', employee: haruto.employee }, HR);
ok(abh.feedback.some((f) => f.id === mf.id) && !abh.feedback.some((f) => f.id === pf.id), 'HR too');
await refuses(api, 'feedback.list', { view: 'about', employee: haruto.employee }, SALES, 403, 'not_permitted', 'a stranger cannot look');
ok((await api.op('notifications.list', {}, ENG)).notifications.some((x) => x.title.indexOf('shared feedback about') > 0), 'the manager is told about manager feedback');
eq((await api.op('feedback.list', { view: 'given' }, SAM)).feedback.length, 3, 'Sam sees what he gave');

section('requests');
const rq = await api.op('feedback.request', { from: [haruto.employee, ananya.employee], text: 'How did the beta launch go from your side?', due: add(today, 7) }, SAM);
eq(rq.requests.length, 2, 'Sam asks two people');
const hq = (await api.op('feedback.list', { view: 'requests' }, HARUTO)).feedback[0];
eq([hq.kind, hq.status, hq.about.id], ['request', 'open', sam.employee], 'Haruto has a request about Sam');
ok((await api.op('perf.home', {}, HARUTO)).requests.length === 1, 'Home lists it');
const ans = (await api.op('feedback.give', { request: hq.id, text: 'Smooth, with good release notes' }, HARUTO)).feedback;
eq([ans.to.id, ans.visibility, ans.request], [sam.employee, 'private', hq.id], 'the answer goes privately to Sam');
const asked = await api.op('feedback.list', { view: 'asked' }, SAM);
ok(asked.feedback.some((f) => f.status === 'answered' && f.answer && f.answer.id === ans.id), 'Sam sees his request answered');
await refuses(api, 'feedback.give', { request: hq.id, text: 'again' }, HARUTO, 409, 'conflict', 'a request is answered once');
const aq = (await api.op('feedback.list', { view: 'requests' }, ANANYA)).feedback[0];
await refuses(api, 'feedback.give', { request: aq.id, text: 'x' }, HARUTO, 403, 'not_permitted', 'only the person asked answers');
eq((await api.op('feedback.decline', { request: aq.id, reason: 'I did not work with Sam' }, ANANYA)).request.status, 'declined', 'Ananya declines');
const mrq = await api.op('feedback.request', { from: [haruto.employee], about: sam.employee }, ENG);
const mhq = (await api.op('feedback.list', { view: 'requests' }, HARUTO)).feedback.find((f) => f.id === mrq.requests[0].id);
const mans = (await api.op('feedback.give', { request: mhq.id, text: 'Sam mentors the interns well' }, HARUTO)).feedback;
eq(mans.visibility, 'manager', 'an answer about a report goes to their manager');
ok(!(await api.op('feedback.list', {}, SAM)).feedback.some((f) => f.id === mans.id), 'and not to the report');
await refuses(api, 'feedback.request', { from: [ananya.employee], about: haruto.employee }, SAM, 403, 'not_permitted', 'only about yourself or people you manage');

section('removing feedback');
await refuses(api, 'feedback.delete', { feedback: pr.id }, HARUTO, 403, 'not_permitted', 'not someone else\'s praise');
await refuses(api, 'feedback.delete', { feedback: pr.id }, AGENT, 403, 'agent_not_permitted', 'not your AI agent');
await api.op('feedback.delete', { feedback: pr.id }, HR);
eq((await api.op('feedback.list', { view: 'wall' }, HARUTO)).feedback.length, 0, 'HR removes a wall post');
await api.op('feedback.delete', { feedback: pf.id }, SAM);
await api.op('perf.settings-update', { praise_wall: false }, HR);
await refuses(api, 'feedback.give', { to: mei.employee, text: 'x', visibility: 'public' }, SAM, 400, 'invalid_param', 'no public praise with the wall off');
eq((await api.op('feedback.give', { to: mei.employee, text: 'Private thanks' }, SAM)).feedback.visibility, 'private', 'praise then defaults to private');
await api.op('perf.settings-update', { praise_wall: true }, HR);

section('skill library');
await refuses(api, 'skills.add', { name: 'Go' }, SAM, 403, 'not_permitted', 'employees do not edit the library');
const many = await api.op('skills.add', { names: ['TypeScript', 'SQL', 'Kubernetes', 'typescript'], category: 'Engineering' }, HR);
eq(many.skills.length, 3, 'three added, the duplicate skipped');
ok((await api.op('skills.add', { name: 'Go' }, AGENT)).proposed === true, "your AI agent's skill is a proposal");
await api.op('skills.update', { skill: 'TypeScript', levels: ['Reads it', 'Writes small changes', 'Owns features', 'Designs systems', 'Sets direction'], expected: [{ job_title: 'Software Engineer', level: 3 }] }, HR);
await api.op('employee-skills.set', { employee: sam.employee, skill: 'TypeScript', level: 2 }, SAM);
await api.op('employee-skills.set', { employee: sam.employee, skill: 'SQL', level: 4 }, SAM);
await api.op('employee-skills.set', { employee: haruto.employee, skill: 'Rust', level: 3 }, HARUTO);
await api.op('employee-skills.set', { employee: sam.employee, skill: 'SQL', verified: true }, ENG);
const lib = await api.op('skills.list', {}, SAM);
ok(lib.skills.find((x) => x.name === 'SQL').verified === 1 && lib.unlisted.some((x) => x.name === 'Rust'), 'counts, verification and skills not in the library yet');
await refuses(api, 'skills.update', { skill: 'SQL', name: 'PostgreSQL' }, HR, 409, 'in_use', 'a skill people hold keeps its name');
await refuses(api, 'skills.delete', { skill: 'SQL' }, HR, 409, 'in_use', 'and is not deleted');
await api.op('skills.delete', { skill: 'Kubernetes' }, HR);
const mx = await api.op('skills.matrix', {}, ENG);
const samRow = mx.people.find((p) => p.employee.id === sam.employee);
const ts = mx.skills.find((x) => x.name === 'TypeScript');
const sq = mx.skills.find((x) => x.name === 'SQL');
eq([mx.scope, samRow.cells[ts.id].level, samRow.cells[ts.id].expected, samRow.gaps, samRow.cells[sq.id].verified, samRow.can_verify], ['team', 2, 3, 1, true, true], 'team matrix: levels, expected level, gap, verified');
const me = await api.op('skills.matrix', {}, SAM);
eq([me.scope, me.people.length, me.people[0].can_verify], ['me', 1, false], 'an employee sees their own row');
const all = await api.op('skills.matrix', { scope: 'all', all_skills: true }, HR);
ok(all.people.length >= 20 && all.skills.length === 2, 'HR sees everyone and every library skill');
ok((await api.op('skills.export', {}, ENG)).csv.indexOf('TypeScript') > 0, 'matrix CSV');
const ps = await api.op('perf.profile', { employee: sam.employee }, SAM);
ok(ps.skills.skills.some((x) => x.skill === 'TypeScript' && x.expected === 3), 'the profile shows the expected level');

section('training programs and sessions');
await refuses(api, 'training-programs.add', { name: 'Fire safety' }, SAM, 403, 'not_permitted', 'employees do not add programs');
ok((await api.op('training-programs.add', { name: 'Agent course' }, AGENT)).proposed === true, "your AI agent's program is a proposal");
const fs = (await api.op('training-programs.add', { name: 'Fire safety', kind: 'course', valid_months: 12, duration_hours: 2 }, HR)).program;
const t1 = (await api.op('trainings.add', { program: 'Fire safety', start: add(today, -2), capacity: 2, cost: '150.00', location: 'Level 3' }, HR)).training;
eq([t1.title, t1.status, t1.currency, t1.cost_minor], ['Fire safety', 'open', 'SGD', 15000], 'a session: title from the program, open, cost in minor units');
const t2 = (await api.op('trainings.add', { program_name: 'Negotiation workshop', kind: 'workshop', start: add(today, 10), start_time: '09:30', end_time: '12:00' }, HR)).training;
ok(t2.program_name === 'Negotiation workshop', 'a session with a new program');
eq((await api.op('trainings.enrol', { training: t1.id }, SAM)).enrolled, 1, 'Sam enrols himself');
await api.op('trainings.enrol', { training: t1.id }, HARUTO);
await refuses(api, 'trainings.enrol', { training: t1.id }, ANANYA, 409, 'full', 'a full session refuses more');
eq((await api.op('trainings.enrol', { training: t2.id, employees: [ananya.employee] }, ENG)).enrolled, 1, 'a manager enrols a report');
await refuses(api, 'trainings.enrol', { training: t2.id, employees: [emily.employee] }, ENG, 403, 'not_permitted', 'not someone else\'s report');
ok((await api.op('trainings.enrol', { training: t2.id, employees: [emily.employee] }, AGENT)).proposed === true, 'enrolment by your AI agent is a proposal');
const up = await api.op('perf.home', {}, ANANYA);
eq(up.upcoming_trainings.length, 1, 'Home lists the upcoming session');
const ana = (await api.op('trainings.get', { training: t2.id }, ANANYA)).training;
await api.op('training-attendees.cancel', { attendee: ana.my.attendee }, ANANYA);
eq((await api.op('trainings.get', { training: t2.id }, ANANYA)).training.my.status, 'cancelled', 'Ananya cancels her place');

section('attendance, results, feedback');
const g1 = (await api.op('trainings.get', { training: t1.id }, HR)).training;
const samA = g1.attendees.find((a) => a.employee.id === sam.employee);
const harA = g1.attendees.find((a) => a.employee.id === haruto.employee);
await refuses(api, 'trainings.attendance', { training: t1.id, rows: [{ attendee: samA.id, status: 'completed' }] }, ENG, 403, 'not_permitted', 'a manager does not mark attendance');
const at = await api.op('trainings.attendance', { training: t1.id, rows: [{ attendee: samA.id, status: 'completed', score: 92, result: 'pass' }, { employee: haruto.employee, status: 'no_show' }] }, HR);
const samDone = at.training.attendees.find((a) => a.id === samA.id);
eq([samDone.completed_on, samDone.expires_on, at.training.status], [add(today, -2), new Date(Date.UTC(Number(add(today, -2).slice(0, 4)) + 1, Number(add(today, -2).slice(5, 7)) - 1, Number(add(today, -2).slice(8, 10)))).toISOString().slice(0, 10), 'done'], 'completed: completion day, expiry a year later, session done');
await api.op('trainings.feedback', { training: t1.id, rating: 5, feedback: 'Practical' }, SAM);
await refuses(api, 'trainings.feedback', { training: t1.id, rating: 4 }, HARUTO, 409, 'conflict', 'no feedback from a no show');
eq((await api.op('trainings.get', { training: t1.id }, HR)).training.feedback_summary.avg_rating, 5, 'feedback average');
eq((await api.op('trainings.get', { training: t1.id }, HARUTO)).training.attendees.length, 1, 'an attendee sees only their own row');
await refuses(api, 'trainings.delete', { training: t1.id }, HR, 409, 'in_use', 'a session with people is cancelled, not deleted');

section('certificates (protected files)');
const pdf = { data: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), type: 'application/pdf', name: 'fire.pdf' };
const upc = await upload('training-attendees.certificate', { attendee: samA.id }, pdf, 'sam@northwind.test');
ok(upc.status === 200 && upc.body.attendee.has_certificate, 'Sam attaches his certificate', upc.body);
const noFile = await upload('training-attendees.certificate', { attendee: samA.id }, null, 'sam@northwind.test');
eq(noFile.status, 400, 'a certificate needs a file');
const other = await upload('training-attendees.certificate', { attendee: samA.id }, pdf, 'haruto@northwind.test');
eq(other.status, 403, 'a colleague cannot attach one');
const mgrFile = await getRaw('training-attendees.file', { attendee: samA.id }, 'eng.lead@northwind.test');
ok(mgrFile.status === 200 && mgrFile.type === 'application/pdf' && mgrFile.text.startsWith('%PDF'), 'the manager opens it through the op', mgrFile);
const stranger = await getRaw('training-attendees.file', { attendee: samA.id }, 'sales.lead@northwind.test');
eq(stranger.status, 403, 'a stranger cannot');
const agentFile = await api.op('training-attendees.file', { attendee: samA.id }, AGENT);
ok(typeof agentFile.path === 'string' && agentFile.mime === 'application/pdf', 'your AI agent gets the path');

section('external completions');
const ext = await upload('training-attendees.record', { program_name: 'AWS Solutions Architect', kind: 'certification', valid_months: 36, completed_on: '2026-06-01', score: 870 }, pdf, 'sam@northwind.test');
ok(ext.status === 200 && ext.body.attendee.verified === false && ext.body.attendee.expires_on === '2029-06-01' && ext.body.attendee.has_certificate, 'Sam records an external certification (to verify)', ext.body);
await refuses(api, 'training-attendees.verify', { attendee: ext.body.attendee.id }, SAM, 403, 'not_permitted', 'not by himself');
eq((await api.op('training-attendees.verify', { attendee: ext.body.attendee.id }, ENG)).attendee.verified, true, 'his manager verifies it');
await api.op('training-attendees.record', { employee: haruto.employee, program: 'Fire safety', completed_on: '2025-09-01' }, HR);

section('required trainings and compliance');
await refuses(api, 'training-requirements.add', { program: 'Fire safety' }, SAM, 403, 'not_permitted', 'employees do not set requirements');
const req = (await api.op('training-requirements.add', { program: 'Fire safety', due_days: 30 }, HR)).requirement;
eq([req.program_name, req.due_days], ['Fire safety', 30], 'Fire safety required for everyone within 30 days');
const cs = await api.op('trainings.compliance', {}, SAM);
eq([cs.total, cs.rows[0].state], [1, 'done'], 'Sam: done');
const ch = await api.op('trainings.compliance', { employee: haruto.employee }, ENG);
eq([ch.rows[0].state, ch.rows[0].due], ['overdue', '2026-09-01'], 'Haruto: his completion expired on 2026-09-01, overdue');
const call = await api.op('trainings.compliance', {}, HR);
ok(call.counts.done === 1 && call.counts.overdue === 1 && call.counts.due >= 20, 'everyone else: due within 30 days of the requirement, not overdue', call.counts);
const team = await api.op('trainings.compliance', { state: 'open' }, ENG);
ok(team.rows.every((r) => r.state !== 'done') && team.rows.length >= 6, "a manager sees their team's open items");
const strict = (await api.op('training-requirements.add', { program: 'Negotiation workshop', department: 'Sales', due_day: '2026-10-15' }, HR)).requirement;
const sales = await api.op('trainings.compliance', { requirement: strict.id }, HR);
ok(sales.rows.length >= 4 && sales.rows.every((r) => r.state === 'overdue'), 'a requirement with a past day: Sales is overdue', sales.rows.length);
const hh = await api.op('perf.home', {}, HARUTO);
ok(hh.trainings.some((x) => x.state === 'overdue'), 'Home warns about overdue training');
const pgh = await api.op('people.get', { employee: haruto.employee }, ENG);
ok((pgh.facts.find((m) => m.module === 'performance') || { facts: [] }).facts.some((f) => f.label === 'Training overdue' && f.tone === 'bad'), 'profile fact: training overdue');
const rl = await api.op('training-requirements.list', {}, HR);
ok(rl.requirements.find((r) => r.id === req.id).counts.overdue === 1, 'requirement counts');
const rem = await api.op('perftest.remind', { training: true }, OWNER);
ok(rem.training >= 5, 'training reminders go out (' + rem.training + ')');
eq((await api.op('perftest.remind', { training: true }, OWNER)).training, 0, 'once a week');
ok((await api.op('trainings.export', {}, HR)).csv.indexOf('Fire safety') > 0, 'compliance CSV');
await api.op('trainings.update', { training: t2.id, status: 'cancelled' }, HR);
eq((await api.op('trainings.list', {}, SAM)).trainings.filter((t) => t.id === t2.id).length, 0, 'a cancelled session leaves the upcoming list');
await refuses(api, 'training-programs.delete', { program: fs.id }, HR, 409, 'in_use', 'a program with sessions is archived, not deleted');

const s = summary('t04_feedback_skills_training');
process.exitCode = s.failed > 0 ? 1 : 0;
