// Contracts and edges: the Inbox read, what a peer reviewer may see, the sign-off approval's cancel
// path, a failed summary job, proposals accepted by HR, profile facts shape, the guide section and the
// trigger recipe, the agent's read sweep on seeded data, cron functions.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT, ANANYA, APP, emp, ENG, eq, fresh, HARUTO, HR, newApi, ok, OWNER, refuses, SAM, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const today = (await api.op('app.status', {}, OWNER)).today;
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const sam = await emp(api, 'sam@northwind.test');
const haruto = await emp(api, 'haruto@northwind.test');

section('setup: a cycle with a peer phase and HR sign-off');
await api.op('perf.settings-update', { entity: 'Northwind Pte Ltd', signoff: true }, HR);
await api.op('goals.create', { title: 'Private goal of Sam', due: add(today, 30) }, SAM);
const phases = [{ key: 'self', start: add(today, -1), end: add(today, 5) }, { key: 'peer', start: today, end: add(today, 5) }, { key: 'manager', start: today, end: add(today, 8) }];
const c = (await api.op('cycles.create', { kind: 'quarterly', participants: { employees: [sam.employee, haruto.employee] }, phases }, HR)).cycle;
const la = await api.op('cycles.launch', { cycle: c.id }, HR);
eq(la.participants, 2, 'a list cycle of two people');

section('perf.inbox');
const inb = await api.op('perf.inbox', {}, SAM);
ok(inb.reviews.length === 1 && inb.reviews[0].kind === 'self' && inb.total === 1, 'Sam: one self review to write', inb);
const mib = await api.op('perf.inbox', {}, ENG);
eq(mib.reviews.filter((r) => r.kind === 'manager').length, 2, 'Mei Lin: two manager reviews');
eq((await api.op('perf.inbox', {}, AGENT)).total, 0, 'your AI agent has no Inbox of its own');

section('a peer reviewer sees only what everyone may see');
const sp = (await api.op('participants.list', { cycle: c.id, q: 'Sam' }, HR)).participants[0];
await api.op('reviews.add-peer', { participant: sp.id, reviewer: haruto.employee }, SAM);
await api.op('feedback.give', { to: sam.employee, kind: 'praise', text: 'Public thanks' }, ANANYA);
await api.op('feedback.give', { to: sam.employee, kind: 'feedback', visibility: 'manager', text: 'For the manager only' }, ANANYA);
const peer = (await api.op('reviews.list', {}, HARUTO)).reviews.find((r) => r.kind === 'peer');
const pctx = await api.op('reviews.context', { review: peer.id }, HARUTO);
ok(pctx.goals.length === 0 && pctx.checkins.length === 0 && pctx.trainings.length === 0, 'no goals, check-ins or trainings for a peer', pctx);
ok(pctx.feedback.length === 1 && pctx.feedback[0].visibility === 'public', 'only public praise', pctx.feedback);
const mrev = (await api.op('reviews.list', {}, ENG)).reviews.find((r) => r.kind === 'manager' && r.employee.id === sam.employee);
const mctx = await api.op('reviews.context', { review: mrev.id }, ENG);
ok(mctx.goals.some((g) => g.title === 'Private goal of Sam') && mctx.feedback.length === 2, 'the manager sees the goals and the manager feedback', mctx.feedback.length);
await refuses(api, 'reviews.context', { review: mrev.id }, ANANYA, 403, 'not_permitted', 'a stranger cannot read the context');

section('a summary request follows its ask; dismissing it closes the ask');
const rq = await api.op('reviews.request-summary', { review: mrev.id }, ENG);
ok(rq.summary.status === 'requested' && rq.summary.agent.trigger === 'review_summary_draft' && rq.summary.agent.record === rq.summary.id, 'the reviewer asks: review_summary_draft with the summary request', rq.summary.agent);
eq((await api.op('reviews.request-summary', { review: mrev.id }, ENG)).already, true, 'asking again while it is open reuses the request');
await api.op('review-summaries.mark', { summary: rq.summary.id, status: 'dismissed' }, ENG);
const rv = (await api.op('reviews.get', { review: mrev.id }, ENG)).review;
const dm = (rv.summaries || []).find((x) => x.id === rq.summary.id);
ok(dm !== undefined && dm.status === 'dismissed' && dm.agent.ended_at !== '' && dm.agent.outcome === 'closed', 'dismissing a pending request closes its ask', dm);
await refuses(api, 'review-summaries.mark', { summary: rq.summary.id, status: 'used' }, SAM, 403, 'not_permitted', 'only the reviewer marks it');

section('sign-off cancelled goes back to acknowledged');
const ms = mrev.id;
const mv = (await api.op('reviews.get', { review: ms }, ENG)).review;
const answers = {};
const ratings = {};
for (const s of mv.sections) {
  if (s.kind === 'questions') for (const it of s.items) answers[s.key + '.' + it.key] = 'Answer';
  if (s.kind === 'competencies') for (const it of s.items) ratings[s.key + '.' + it.key] = 3;
}
await api.op('reviews.submit', { review: ms, answers, ratings }, ENG);
await api.op('reviews.share', { participant: sp.id }, HR);
await api.op('reviews.acknowledge', { participant: sp.id }, SAM);
const ap = (await api.op('approvals.list', {}, HR)).approvals.find((a) => a.kind === 'review_signoff');
ok(ap !== undefined && ap.payload.cycle === c.id, 'the sign-off approval carries the cycle', ap && ap.payload);
const vw = await api.op('approvals.get', { approval: ap.id }, SAM);
ok(vw.approval.can_decide === false, 'the person can see but not decide it');
await api.op('approvals.cancel', { approval: ap.id, note: 'Opened by mistake' }, HR);
eq((await api.op('participants.get', { participant: sp.id }, HR)).participant.stage, 'acknowledged', 'cancelled: acknowledged, no sign-off');
eq((await api.op('perf.inbox', {}, SAM)).acknowledge.length, 0, 'nothing left to acknowledge');

section('proposals from your AI agent, accepted by HR');
const pt = await api.op('review-templates.create', { name: 'Agent made template', sections: [{ kind: 'questions', items: [{ text: 'Highlights?', required: true }] }], why: 'HR asked for a short template' }, AGENT);
const acc = await api.op('proposals.accept', { proposal: pt.proposal }, HR);
eq(acc.applied, 1, 'template proposal applied');
ok((await api.op('review-templates.list', {}, HR)).templates.some((x) => x.name === 'Agent made template'), 'the template exists');
const pc = await api.op('cycles.create', { kind: 'probation', why: 'Two probations end this month' }, AGENT);
eq((await api.op('proposals.accept', { proposal: pc.proposal }, HR)).applied, 1, 'a draft cycle proposal applied');
await refuses(api, 'trainings.enrol', { training: 'nope00000000000', employees: [sam.employee] }, AGENT, 404, 'not_found', 'an impossible proposal is refused before it is stored');
const ts = (await api.op('trainings.add', { program_name: 'Proposal check session', kind: 'workshop', start: add(today, 12) }, HR)).training;
const pe = await api.op('trainings.enrol', { training: ts.id, employees: [sam.employee] }, AGENT);
await api.op('trainings.update', { training: ts.id, status: 'cancelled' }, HR);
const fail = await api.op('proposals.accept', { proposal: pe.proposal }, HR);
eq(fail.failed, 1, 'a proposal that no longer applies fails cleanly at accept');

section('facts, guide, triggers');
const pg = await api.op('people.get', { employee: sam.employee }, ENG);
const facts = (pg.facts.find((m) => m.module === 'performance') || {}).facts || [];
ok(facts.length > 0 && facts.every((f) => typeof f.label === 'string' && typeof f.value === 'string'), 'profile facts are [{ label, value, tone?, link? }]', facts);
const guide = await api.op('app.guide', {}, AGENT);
ok(guide.modules.some((m) => m.module === 'performance' && m.triggers.includes('review_summary_draft')) && typeof guide.recipes.review_summary_draft === 'string', 'the guide index lists performance and its trigger');
const sec = await api.op('app.guide', { module: 'performance' }, AGENT);
ok(sec.rules.length >= 5 && sec.events.length >= 7, 'the guide has the performance section');
const rcp = await api.op('app.guide', { recipe: 'review_summary_draft' }, AGENT);
ok(Array.isArray(rcp.steps) && rcp.steps.some((l) => l.indexOf('review-summaries.submit') >= 0), 'the guide has the summary recipe');
const trig = JSON.parse(readFileSync(join(APP, 'triggers.json'), 'utf8'));
ok(trig.triggers.review_summary_draft.instruction.indexOf('review-summaries.submit') >= 0 && trig.triggers.review_summary_draft.params.summary_id.required === true, 'the review_summary_draft trigger names the summary request and the op that answers it');
const st = await api.op('app.status', {}, OWNER);
ok(st.events.approvals.review_signoff === 'lib_performance_reviews.onSignoff' && (st.events.on['employment.ended'] || []).includes('lib_performance.onEmploymentEnded'), 'subscriptions registered', st.events);

section('your AI agent reads everything (seeded), never 5xx');
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => o.executor.method === 'GET' && /^(perf|goals|review-templates|cycles|participants|reviews|review-summaries|calibration|feedback|skills|training-programs|trainings|training-attendees|training-requirements)\./.test(o.name));
const SAMPLE = { employee: sam.employee, cycle: c.id, review: mrev.id, participant: sp.id, template: 'Annual review', goal: 'nope00000000000', training: 'nope00000000000', attendee: 'nope00000000000' };
const bad = [];
for (const as of [AGENT, OWNER, HR, ENG, SAM]) {
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = SAMPLE[k] ?? 'x';
    const r = await api.call(o.name, params, as);
    if (r.status >= 500) bad.push(as.as + ' ' + o.name + ' ' + r.status);
  }
}
ok(bad.length === 0, reads.length + ' reads x 5 callers on seeded data, no 5xx', bad);

section('cron');
const cr = await api.op('perftest.cron', {}, OWNER);
ok(cr.ran.some((x) => x.name === 'performance_reminders' && x.ok), 'the reminders job runs as the minute job would');

const s = summary('t05_contracts');
process.exitCode = s.failed > 0 ? 1 : 0;
