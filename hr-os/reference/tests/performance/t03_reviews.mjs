// Review cycles end to end on the demo company: templates, a cycle with
// every phase, launch, self, peer, upward and manager reviews, visibility,
// your AI agent's neutral summary, calibration, sharing, acknowledgement
// and HR sign-off (approve and reject), reminders, late joiners, leavers,
// close and export.
import { AGENT, ANANYA, emp, ENG, eq, fresh, HARUTO, HR, newApi, ok, OWNER, refuses, SALES, SAM, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const today = (await api.op('app.status', {}, OWNER)).today;
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const sam = await emp(api, 'sam@northwind.test');
const haruto = await emp(api, 'haruto@northwind.test');
const ananya = await emp(api, 'ananya@northwind.test');
const mei = await emp(api, 'eng.lead@northwind.test');
const rohan = await emp(api, 'rohan@northwind.test');
const jordan = await emp(api, 'sales.lead@northwind.test');

section('templates');
await refuses(api, 'review-templates.create', { name: 'Bad', sections: [{ kind: 'stars' }] }, HR, 400, 'invalid_param', 'an unknown section kind is refused');
await refuses(api, 'review-templates.create', { name: 'Bad scale', sections: [{ kind: 'questions', items: ['Why?'] }], scale: { points: 9, labels: [] } }, HR, 400, 'invalid_param', 'a 9-point scale is refused');
const copy = await api.op('review-templates.create', { name: 'Engineering annual', copy_of: 'Annual review', scale: { points: 4, labels: ['Not yet', 'Solid', 'Strong', 'Exceptional'] } }, HR);
eq([copy.template.scale.points, copy.template.sections.length, copy.template.builtin], [4, 3, false], 'a copy with a four-point scale');
const ap = await api.op('review-templates.create', { name: 'Agent template', sections: [{ kind: 'questions', items: [{ text: 'Highlights?', required: true }] }] }, AGENT);
ok(ap.proposed === true, "your AI agent's template is a proposal");
await refuses(api, 'review-templates.list', {}, SAM, 403, 'not_permitted', 'employees do not browse templates');

section('settings: HR sign-off in Singapore');
await api.op('perf.settings-update', { entity: 'Northwind Pte Ltd', signoff: true }, HR);
const st = await api.op('perf.settings', {}, SAM);
ok(st.entities.find((e) => e.name === 'Northwind Pte Ltd').signoff === true && st.entities.find((e) => e.name === 'Northwind KK').signoff === false, 'sign-off on for SG only');
await api.op('perf.settings-update', { values: [{ name: 'Customers first', icon: 'Heart' }, { name: 'Own it', icon: 'Flag' }] }, HR);

section('cycle draft and launch');
const phases = [
  { key: 'self', start: add(today, -1), end: add(today, 10) },
  { key: 'peer', start: today, end: add(today, 10) },
  { key: 'upward', start: today, end: add(today, 10) },
  { key: 'manager', start: today, end: add(today, 14) },
  { key: 'calibration', start: add(today, 15), end: add(today, 20) },
  { key: 'sharing', start: add(today, 21), end: add(today, 30) },
];
const c = (await api.op('cycles.create', { kind: 'annual', name: 'Engineering 2026', template: 'Engineering annual', participants: { departments: ['Engineering'] }, phases }, HR)).cycle;
eq([c.status, c.name, c.template_name, c.phases.length], ['draft', 'Engineering 2026', 'Engineering annual', 6], 'draft cycle');
await refuses(api, 'cycles.get', { cycle: c.id }, SAM, 403, 'not_permitted', 'a draft is invisible to employees');
const pv = await api.op('cycles.preview', { cycle: c.id }, HR);
eq(pv.total, 8, 'preview: the 8 people in Engineering');
await refuses(api, 'cycles.launch', { cycle: c.id }, AGENT, 403, 'agent_not_permitted', 'your AI agent cannot launch');
await refuses(api, 'cycles.launch', { cycle: c.id }, ENG, 403, 'not_permitted', 'a manager cannot launch');
const la = await api.op('cycles.launch', { cycle: c.id }, HR);
eq([la.participants, la.cycle.status], [8, 'active'], 'launched for 8');
eq([la.cycle.counts.reviews.self.total, la.cycle.counts.reviews.manager.total, la.cycle.counts.reviews.upward.total], [8, 8, 7], 'self, manager and upward reviews (Mei Lin 5, Vikram 2)');
await refuses(api, 'cycles.update', { cycle: c.id, template: 'Annual review' }, HR, 409, 'conflict', 'the template is fixed once launched');
await api.op('review-templates.update', { template: 'Engineering annual', description: 'changed' }, HR);
await refuses(api, 'review-templates.delete', { template: 'Engineering annual' }, HR, 409, 'in_use', 'a used template cannot be deleted');
const ag = await api.op('cycles.create', { kind: 'quarterly' }, AGENT);
ok(ag.proposed === true, "your AI agent's cycle draft is a proposal");

section('self review');
const samList = (await api.op('reviews.list', {}, SAM)).reviews;
eq(samList.map((x) => x.kind).sort(), ['self', 'upward'], 'Sam owes a self review and an upward review of Mei Lin');
const samSelf = samList.find((x) => x.kind === 'self');
const sv = (await api.op('reviews.get', { review: samSelf.id }, SAM)).review;
eq([sv.can.write, sv.overall_enabled, sv.scale.points], [true, true, 4], 'Sam can write it, with an overall rating on 4 points');
const qs = sv.sections.find((x) => x.kind === 'questions');
const cs = sv.sections.find((x) => x.kind === 'competencies');
await api.op('reviews.save', { review: samSelf.id, answers: { [qs.key + '.' + qs.items[0].key]: 'Shipped the app beta' } }, SAM);
const miss = await api.call('reviews.submit', { review: samSelf.id }, SAM);
ok(miss.status === 400 && miss.body.code === 'incomplete' && miss.body.data.missing.length === 2, 'submit refused: one required question and the overall rating missing', miss.body);
await refuses(api, 'reviews.save', { review: samSelf.id, answers: { 'questions.nope': 'x' } }, SAM, 400, 'invalid_param', 'unknown answer key');
await refuses(api, 'reviews.save', { review: samSelf.id, ratings: { [cs.key + '.' + cs.items[0].key]: 7 } }, SAM, 400, 'invalid_param', 'a rating above the scale');
await refuses(api, 'reviews.save', { review: samSelf.id, answers: { 'questions.went_well': 'x' } }, HARUTO, 403, 'not_permitted', 'only the reviewer writes');
await refuses(api, 'reviews.save', { review: samSelf.id, answers: {} }, AGENT, 403, 'agent_not_permitted', 'your AI agent never writes reviews');
const sub = await api.op('reviews.submit', { review: samSelf.id, answers: { [qs.key + '.' + qs.items[1].key]: 'More tests' }, overall: 3, ratings: { [cs.key + '.' + cs.items[0].key]: 3 } }, SAM);
eq(sub.review.status, 'submitted', 'self review submitted (saving with the submit)');
ok((await api.op('notifications.list', {}, ENG)).notifications.some((x) => x.title.indexOf('submitted their self review') >= 0), 'the manager is told');
await refuses(api, 'reviews.save', { review: samSelf.id, answers: {} }, SAM, 409, 'conflict', 'a submitted review no longer changes');
await refuses(api, 'reviews.get', { review: samSelf.id }, HARUTO, 403, 'not_permitted', "a colleague cannot read Sam's self review");
eq((await api.op('reviews.get', { review: samSelf.id }, ENG)).review.hidden, false, 'the manager reads it');

section('peer and upward');
const pa = await api.op('reviews.add-peer', { participant: samSelf.participant, reviewer: haruto.employee }, SAM);
eq(pa.added, 1, 'Sam asks Haruto for a peer review');
await refuses(api, 'reviews.add-peer', { participant: samSelf.participant, reviewer: sam.employee }, SAM, 400, 'invalid_param', 'not yourself');
await refuses(api, 'reviews.add-peer', { participant: samSelf.participant, reviewer: haruto.employee }, ANANYA, 403, 'not_permitted', 'not a stranger');
const hp = (await api.op('reviews.list', {}, HARUTO)).reviews.find((x) => x.kind === 'peer');
const hpv = (await api.op('reviews.get', { review: hp.id }, HARUTO)).review;
eq(hpv.overall_enabled, false, 'peers give no overall rating');
const hq = hpv.sections.find((x) => x.kind === 'questions');
await api.op('reviews.submit', { review: hp.id, answers: { [hq.key + '.went_well']: 'Great pairing', [hq.key + '.improve']: 'Write docs' } }, HARUTO);
const peerAsSam = await api.call('reviews.get', { review: hp.id }, SAM);
ok(peerAsSam.status === 403, 'the person never reads peer reviews', peerAsSam.body);
eq((await api.op('reviews.get', { review: hp.id }, ENG)).review.answers[hq.key + '.went_well'], 'Great pairing', 'the manager reads the peer review');
const up = samList.find((x) => x.kind === 'upward');
const upv = (await api.op('reviews.get', { review: up.id }, SAM)).review;
const uq = upv.sections.find((x) => x.kind === 'questions');
await api.op('reviews.submit', { review: up.id, answers: { [uq.key + '.went_well']: 'Clear priorities', [uq.key + '.improve']: 'More one to ones' } }, SAM);
const upAsMei = await api.call('reviews.get', { review: up.id }, ENG);
ok(upAsMei.status === 403 || (upAsMei.body.review && upAsMei.body.review.hidden), 'the manager does not read upward reviews about themself', upAsMei.body);
eq((await api.op('reviews.get', { review: up.id }, OWNER)).review.hidden, false, 'their own manager (and HR) can');

section('feedback for the period');
await api.op('feedback.give', { to: sam.employee, kind: 'feedback', visibility: 'private', text: 'Private note to Sam only' }, HARUTO);
await api.op('feedback.give', { to: sam.employee, kind: 'feedback', visibility: 'manager', text: 'For the manager: Sam unblocked the release' }, HARUTO);
await api.op('feedback.give', { to: sam.employee, kind: 'praise', text: 'Thanks for the late night fix', values: ['customers-first'] }, HARUTO);

section('manager review and your AI agent summary');
const mw = (await api.op('reviews.list', {}, ENG)).reviews;
const samMgr = mw.find((x) => x.kind === 'manager' && x.employee.id === sam.employee);
ok(samMgr !== undefined && mw.filter((x) => x.kind === 'manager').length === 5, 'Mei Lin owes five manager reviews (her direct reports)');
await refuses(api, 'reviews.get', { review: samMgr.id }, SAM, 403, 'not_shared', 'Sam cannot read his manager review before it is shared');
const ctxRead = await api.op('reviews.context', { review: samMgr.id }, ENG);
ok(ctxRead.feedback.some((f) => f.visibility === 'manager') && !ctxRead.feedback.some((f) => f.visibility === 'private') && ctxRead.feedback.some((f) => f.kind === 'praise'), 'the reviewer context holds manager and public feedback, not private feedback');
const rq = await api.op('reviews.request-summary', { review: samMgr.id }, ENG);
eq(rq.summary.status, 'requested', 'the manager asks your AI agent for a summary');
eq((await api.op('reviews.request-summary', { review: samMgr.id }, ENG)).already, true, 'asking twice reuses the open request');
await refuses(api, 'reviews.request-summary', { review: samMgr.id }, AGENT, 403, 'agent_not_permitted', 'your AI agent does not ask itself');
ok(rq.summary.agent !== null && rq.summary.agent.trigger === 'review_summary_draft' && rq.summary.agent.record === rq.summary.id && rq.summary.review === samMgr.id, 'your AI agent is asked with the summary request (review_summary_draft), which names the review', rq.summary);
const actx = await api.op('reviews.context', { review: samMgr.id, summary: rq.summary.id }, AGENT);
eq(actx.as_reviewer, 'Mei Lin Chua', "your AI agent reads the period as the reviewer sees it");
ok(!actx.feedback.some((f) => f.visibility === 'private'), 'and not private feedback');
await refuses(api, 'review-summaries.submit', { summary: rq.summary.id, text: 'x' }, ENG, 403, 'not_permitted', 'people do not submit summaries');
await refuses(api, 'review-summaries.submit', { summary: rq.summary.id, text: 'x', sources: [{ kind: 'rating', id: '1' }] }, AGENT, 400, 'invalid_param', 'a source must be a goal, check-in, feedback, praise, training or review');
await refuses(api, 'review-summaries.submit', { summary: rq.summary.id, text: 'x', rating: 3 }, AGENT, 400, 'unknown_param', 'a summary has no rating field');
const sm = await api.op('review-summaries.submit', { summary: rq.summary.id, text: 'Sam had no goals with check-ins this period. Feedback: Haruto noted he unblocked the release and praised a late night fix.', sources: [{ kind: 'feedback', id: actx.feedback[0].id }] }, AGENT);
eq(sm.summary.status, 'ready', 'summary ready');
ok(sm.summary.agent.ended_at !== '' && sm.summary.agent.open === false, 'the submit closes the ask', sm.summary.agent);
const mrv = (await api.op('reviews.get', { review: samMgr.id }, ENG)).review;
ok(mrv.summaries.length === 1 && mrv.summaries[0].text.indexOf('unblocked') > 0 && mrv.related.some((r) => r.kind === 'self') && mrv.related.some((r) => r.kind === 'peer'), 'the manager sees the summary, the self and the peer review beside the form');
ok(Object.keys(mrv.summaries[0]).every((k) => ['id', 'review', 'status', 'text', 'sources', 'error', 'requested_by', 'agent', 'created', 'updated'].includes(k)), 'nothing rating-like in a summary');
await api.op('review-summaries.mark', { summary: rq.summary.id, status: 'used' }, ENG);

const mq = mrv.sections.find((x) => x.kind === 'questions');
const mc = mrv.sections.find((x) => x.kind === 'competencies');
const mg = mrv.sections.find((x) => x.kind === 'goals');
const ratings = {};
for (const it of mc.items) ratings[mc.key + '.' + it.key] = 3;
await api.op('reviews.save', { review: samMgr.id, answers: { [mq.key + '.went_well']: 'Owned the beta', [mq.key + '.improve']: 'Delegate more' } }, ENG);
const mm = await api.call('reviews.submit', { review: samMgr.id }, ENG);
ok(mm.status === 400 && mm.body.data.missing.some((x) => x.key === 'overall') && mm.body.data.missing.filter((x) => x.what === 'rating').length === mc.items.length + 1, 'a manager review needs every competency rating and the overall rating', mm.body);
ok(mg && Array.isArray(mg.goals), 'the goals section lists the person\'s goals of the period');
const ms = await api.op('reviews.submit', { review: samMgr.id, ratings: ratings, overall: 3 }, ENG);
eq([ms.review.status, ms.review.participant.stage, ms.review.participant.overall, ms.review.score], ['submitted', 'submitted', 3, 3], 'manager review submitted: stage submitted, overall 3, score 3');

section('calibration');
const cal = await api.op('calibration.view', { cycle: c.id }, HR);
eq([cal.rows.length, cal.pending, cal.distribution[0].counts], [1, 7, [0, 0, 1, 0]], 'one rating in, seven pending, distribution on four points');
const lead = await api.op('calibration.view', { cycle: c.id }, ENG);
eq(lead.rows.length, 1, 'a people leader sees their team');
await refuses(api, 'calibration.view', { cycle: c.id }, SAM, 403, 'not_permitted', 'employees do not calibrate');
const samP = samSelf.participant;
await refuses(api, 'calibration.adjust', { participant: samP, final: 4 }, HR, 400, 'missing_param', 'a reason is required');
await refuses(api, 'calibration.adjust', { participant: samP, final: 4, reason: 'x' }, AGENT, 403, 'agent_not_permitted', 'your AI agent never changes ratings');
await refuses(api, 'calibration.adjust', { participant: samP, final: 4, reason: 'x' }, SAM, 403, 'not_permitted', 'nobody calibrates themself');
await refuses(api, 'calibration.adjust', { participant: samP, final: 5, reason: 'x' }, HR, 400, 'invalid_param', 'above the scale');
const adj = await api.op('calibration.adjust', { participant: samP, final: 4, reason: 'Delivered the beta two months early; aligned in the calibration meeting' }, HR);
eq([adj.participant.final, adj.participant.rating_label, adj.history.length, adj.history[0].from, adj.history[0].to], [4, 'Exceptional', 1, 3, 4], 'final rating 4 with history');
const audit = await api.op('audit.list', { collection: 'review_participants', record: samP }, OWNER).catch((e) => e.body);
ok(audit && JSON.stringify(audit).indexOf('Calibrated') >= 0, 'the change is in the audit trail', audit);

section('sharing, acknowledgement, HR sign-off');
await refuses(api, 'reviews.share', { participant: samP }, ENG, 403, 'not_permitted', 'the manager waits for the sharing phase');
await refuses(api, 'reviews.share', { participant: samP }, AGENT, 403, 'agent_not_permitted', 'your AI agent never shares');
await api.op('reviews.share', { participant: samP }, HR);
const samMgrRead = (await api.op('reviews.get', { review: samMgr.id }, SAM)).review;
eq([samMgrRead.hidden, samMgrRead.participant.rating_label], [false, 'Exceptional'], 'Sam reads his shared review with the final rating');
await refuses(api, 'calibration.adjust', { participant: samP, final: 3, reason: 'late' }, HR, 409, 'conflict', 'no calibration after sharing');
const shome = await api.op('perf.home', {}, SAM);
eq(shome.to_acknowledge.length, 1, 'Home asks Sam to acknowledge');
await refuses(api, 'reviews.acknowledge', { participant: samP }, ENG, 403, 'not_permitted', 'only the person acknowledges');
const ack = await api.op('reviews.acknowledge', { participant: samP, comment: 'Thank you, agreed' }, SAM);
eq([ack.participant.stage, ack.participant.signoff !== ''], ['signoff', true], 'Singapore requires HR sign-off: an approval opens');
const appr = (await api.op('approvals.list', {}, HR)).approvals.find((a) => a.kind === 'review_signoff');
ok(appr !== undefined && appr.ref_id === samP, 'HR has the sign-off in the Inbox');
await refuses(api, 'approvals.decide', { approval: appr.id, decision: 'approved' }, SAM, 403, 'not_permitted', 'the person cannot sign off their own review');
await api.op('approvals.decide', { approval: appr.id, decision: 'approved', note: 'Signed' }, HR);
eq((await api.op('participants.get', { participant: samP }, SAM)).participant.stage, 'signed', 'signed after approval');

section('a second person: reassign, share, reject sign-off');
const anMgr = (await api.op('participants.list', { cycle: c.id, q: 'Ananya' }, HR)).participants[0];
ok(anMgr.reviews.manager.reviewer === (await emp(api, 'vikram@northwind.test')).employee, "Ananya's manager review is Vikram's (no sign-in)");
await api.op('reviews.reassign', { review: anMgr.reviews.manager.id, reviewer: mei.employee }, HR);
const anv = (await api.op('reviews.get', { review: anMgr.reviews.manager.id }, ENG)).review;
const anq = anv.sections.find((x) => x.kind === 'questions');
const anc = anv.sections.find((x) => x.kind === 'competencies');
const anr = {};
for (const it of anc.items) anr[anc.key + '.' + it.key] = 2;
await api.op('reviews.submit', { review: anv.id, answers: { [anq.key + '.went_well']: 'Learning fast', [anq.key + '.improve']: 'Ask earlier' }, ratings: anr, overall: 2 }, ENG);
await api.op('perf.settings-update', { entity: 'Northwind India Pvt Ltd', signoff: true }, HR);
await api.op('reviews.share-all', { cycle: c.id }, HR);
await api.op('reviews.acknowledge', { participant: anMgr.id }, ANANYA);
const appr2 = (await api.op('approvals.list', {}, HR)).approvals.find((a) => a.kind === 'review_signoff' && a.ref_id === anMgr.id);
await api.op('approvals.decide', { approval: appr2.id, decision: 'rejected', note: 'Add examples to the improvement part' }, HR);
const anAfter = (await api.op('participants.get', { participant: anMgr.id }, HR)).participant;
eq([anAfter.stage, anAfter.returned_note], ['open', 'Add examples to the improvement part'], 'a rejected sign-off sends the review back');
eq((await api.op('reviews.get', { review: anv.id }, ENG)).review.status, 'draft', 'the manager review is a draft again');
ok((await api.op('notifications.list', {}, ENG)).notifications.some((x) => x.title.indexOf('HR asked for changes') >= 0), 'the manager is told');

section('phases, reminders, joiners and leavers');
await refuses(api, 'cycles.phase', { cycle: c.id, phase: 'sharing', action: 'start_now' }, AGENT, 403, 'agent_not_permitted', 'your AI agent does not move phases');
const ph = await api.op('cycles.phase', { cycle: c.id, phase: 'sharing', action: 'start_now' }, HR);
eq(ph.cycle.phases.find((x) => x.key === 'sharing').state, 'open', 'sharing starts now');
const rem = await api.op('cycles.remind', { cycle: c.id }, HR);
ok(rem.reminded >= 2, 'reminders go to reviewers with drafts', rem);
eq((await api.op('cycles.remind', { cycle: c.id }, HR)).reminded, 0, 'once a day per review');
const pt = await api.op('perftest.remind', {}, OWNER);
ok(typeof pt.reviews === 'number', 'the cron path runs (' + pt.reviews + ')');
const cr = await api.op('perftest.cron', {}, OWNER);
ok(cr.ran.some((x) => x.name === 'performance_reminders' && x.ok), 'the performance cron job is discovered and runs', cr);
const missing = await api.op('participants.list', { cycle: c.id, missing: 'self' }, HR);
ok(missing.total === 7, 'who has not submitted their self review: 7', missing.total);
const late = await api.op('participants.add', { cycle: c.id, employee: jordan.employee }, HR);
eq(late.participant.stage, 'open', 'a late joiner added');
await refuses(api, 'participants.add', { cycle: c.id, employee: jordan.employee }, HR, 409, 'conflict', 'not twice');
await api.op('participants.remove', { participant: late.participant.id, note: 'Wrong department' }, HR);
const rp = (await api.op('participants.list', { cycle: c.id, q: 'Rohan' }, HR)).participants[0];
await api.op('employments.end', { employment: rohan.employment, end_day: today, reason: 'Resigned' }, OWNER);
eq((await api.op('participants.get', { participant: rp.id }, HR)).participant.stage, 'removed', 'a leaver leaves the open cycle (employment.ended)');

section('profile, facts, Home');
const prof = await api.op('perf.profile', { employee: sam.employee }, ENG);
ok(prof.reviews.length === 1 && prof.reviews[0].rating_label === 'Exceptional', 'the profile tab lists the review with its rating for the manager');
const profSelf = await api.op('perf.profile', { employee: sam.employee }, SAM);
ok(profSelf.reviews[0].reviews.some((r) => r.kind === 'manager') && !profSelf.reviews[0].reviews.some((r) => r.kind === 'peer'), 'the person sees their self and manager review, never peers');
await refuses(api, 'perf.profile', { employee: sam.employee }, SALES, 403, 'not_permitted', 'another team manager cannot');
const pg = await api.op('people.get', { employee: sam.employee }, ENG);
const facts = (pg.facts.find((m) => m.module === 'performance') || { facts: [] }).facts;
ok(facts.some((f) => f.label === 'Last review'), 'profile facts carry the last review', facts);
const ehome = await api.op('perf.home', {}, ENG);
ok(ehome.cycles.length === 1 && ehome.cycles[0].phases.length === 6 && ehome.owe.length >= 3, 'manager Home: the cycle with its phases and the reviews owed', ehome.owe.length);

section('reopen, close, export');
const hs = (await api.op('reviews.list', {}, HARUTO)).reviews.find((x) => x.kind === 'self');
const hsv = (await api.op('reviews.get', { review: hs.id }, HARUTO)).review;
const hsq = hsv.sections.find((x) => x.kind === 'questions');
await api.op('reviews.submit', { review: hs.id, answers: { [hsq.key + '.went_well']: 'a', [hsq.key + '.improve']: 'b' }, overall: 3 }, HARUTO);
await refuses(api, 'reviews.reopen', { review: hs.id }, ENG, 403, 'not_permitted', 'a manager does not reopen');
eq((await api.op('reviews.reopen', { review: hs.id, note: 'Please add your goals' }, HR)).review.status, 'draft', 'HR reopens a submitted review');
await refuses(api, 'cycles.close', { cycle: c.id }, ENG, 403, 'not_permitted', 'a manager does not close');
await api.op('cycles.close', { cycle: c.id }, HR);
await refuses(api, 'reviews.save', { review: hs.id, answers: {} }, HARUTO, 409, 'conflict', 'nothing is written once closed');
const ex = await api.op('cycles.export', { cycle: c.id }, HR);
ok(ex.rows === 7 && ex.csv.indexOf('calibration_reason') > 0 && ex.csv.indexOf('Delivered the beta') > 0, 'the export lists everyone still in the cycle (not the two taken out) with the calibration reason', ex.rows);
const exm = await api.op('cycles.export', { cycle: c.id }, ENG);
ok(exm.rows === 6, "a manager's export holds their team only", exm.rows);
await refuses(api, 'cycles.export', { cycle: c.id }, AGENT, 403, 'agent_not_permitted', 'your AI agent does not export');
await refuses(api, 'cycles.delete', { cycle: c.id }, HR, 409, 'conflict', 'only drafts are deleted');

const s = summary('t03_reviews');
process.exitCode = s.failed > 0 ? 1 : 0;
