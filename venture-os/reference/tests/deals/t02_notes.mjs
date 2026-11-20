// Deals module: meeting notes end to end. A partner writes a First call note, saves it; your AI agent
// (simulated through ops with the agent token) reviews it: summary, one deals.update proposal per field
// with its quote, a task for the stated next step, a reference; the partner accepts and dismisses the
// changes one by one. Transcripts, consent, restricted deals, the meeting draft, timeline, search, undo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, PORT, DEMO, newApi, fresh, setupFirm, member, section, ok, eq, refuses, summary, until, bridge } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const partner = await member(api, 'partner@venture.test', 'partner', 'Pat Partner');
const partner2 = await member(api, 'paula@venture.test', 'partner', 'Paula Second');
const analyst = await member(api, 'analyst@venture.test', 'analyst', 'Ana Analyst');

const tokenOf = async (email) => (await api.op('auth.login', { email, password: DEMO.password })).token;

/** Multipart upload of a transcript as a person (the screen's way). */
async function upload(email, note, name, text, extra = {}) {
  const token = await tokenOf(email);
  const fd = new FormData();
  fd.set('note', note);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  fd.set('file', new Blob([text], { type: 'text/plain' }), name);
  const res = await fetch(`http://127.0.0.1:${PORT}/api/ops/notes/attach-transcript`, { method: 'POST', headers: { authorization: token }, body: fd });
  return { status: res.status, body: await res.json() };
}

const deal = (await api.op('deals.create', { company: 'acme-robotics.com', name: 'Acme Robotics' }, { as: partner })).deal;
ok(deal.number === 'D-0001' && deal.stage === 'sourced', 'a deal at Sourced with the partner as point');

section('Writing a note: draft, autosave, rights');
let note = (await api.op('notes.create', { deal: deal.number, sections: { team: 'Two founders, ex Boston Dynamics.' } }, { as: partner })).note;
eq([note.template.key, note.status, note.review.state, note.review.steps], ['first_call', 'draft', 'draft', null], 'First call template by stage; a draft has no StepTrack');
ok(note.can_edit === true && note.mine === true && note.author.name === 'Pat Partner', 'the author can edit');
note = (
  await api.op('notes.update', { note: note.id, sections: { round: 'Raising USD 3M seed on a post-money SAFE. We would put in USD 500k.', next_steps: 'Pat sends the data room request by 2026-11-20. Catch up with the founders soon.' } }, { as: partner })
).note;
eq(Object.keys(note.body).sort(), ['next_steps', 'round', 'team'], 'autosave merges sections by key');
await refuses(api, 'notes.update', { note: note.id, sections: { nope: 'x' } }, { as: partner }, 400, 'invalid_param', 'an unknown section key');
await refuses(api, 'notes.update', { note: note.id, sections: { team: 'mine now' } }, { as: analyst }, 403, 'not_permitted', 'an analyst (Deals view) cannot write');
await refuses(api, 'notes.update', { note: note.id, sections: { team: 'mine now' } }, { as: partner2 }, 403, 'not_permitted', "another partner cannot change Pat's note");
await refuses(api, 'notes.update', { note: note.id, template: 'board' }, { as: partner }, 409, 'has_text', 'the template stays once there is text');
{
  const g = await api.op('notes.get', { note: note.id }, { as: analyst });
  ok(g.note.can_edit === false && g.note.body.team.indexOf('Boston') >= 0, 'an analyst reads it, cannot edit');
}

section('Save, then Ask your AI agent to review: the StepTrack starts');
const saved = await api.op('notes.update', { note: note.id, save: true }, { as: partner });
note = saved.note;
eq([note.status, note.review.state, saved.request], ['saved', 'saved', undefined], 'a note with typed text only is saved; nothing is asked of your AI agent by itself');
{
  const asked = await api.op('notes.review', { note: note.id }, { as: partner });
  note = asked.note;
  eq([note.review.state, note.review.steps.at, note.review.steps.labels], ['waiting', 1, ['Saved', 'Reading', 'Summary', 'Ready']], 'Ask your AI agent to review: waiting for your AI agent');
  const all0 = (await bridge.fires()).fires;
  const f = all0.filter((x) => x.request_id === asked.request);
  ok(asked.request !== '' && f.length === 1 && f[0].trigger === 'note_review' && note.review.request === asked.request, 'one fire of note_review, its request kept on the note', { asked: asked.request, f });
  await refuses(api, 'notes.review', { note: note.id }, { as: partner }, 409, 'pending', 'asking again while it waits is refused');
  await api.op('notes.update', { note: note.id, save: true }, { as: partner });
  eq((await bridge.fires()).fires.length, all0.length, 'saving again asks nothing new (0 more fires)');
}

section('Your AI agent reviews the note');
{
  // Fix 8: the fire named the note (note_id); your AI agent reads it, no queue to claim from.
  const g = await api.op('notes.get', { note: note.id }, { as: 'agent' });
  eq([g.note.review.state, g.note.review.steps.at, g.note.deal.id], ['waiting', 1, deal.id], 'your AI agent opens the note the fire named, on its deal');
  ok(g.note.template.sections.length === 6 && g.note.body.round.indexOf('USD 3M') >= 0, 'your AI agent reads the sections and the text');
}
await refuses(api, 'notes.update', { note: note.id, sections: { team: 'rewritten' } }, { as: 'agent' }, 403, 'not_permitted', "your AI agent never edits a person's note");
const quote = 'Raising USD 3M seed on a post-money SAFE.';
const p1 = await api.op('deals.update', { deal: deal.id, round_type: 'seed', evidence: quote, confidence: 0.9, why: 'Stated in the note' }, { as: 'agent' });
const p2 = await api.op('deals.update', { deal: deal.id, raise: '3000000', evidence: quote, confidence: 0.9 }, { as: 'agent' });
const p3 = await api.op('deals.update', { deal: deal.id, check: '500000', evidence: 'We would put in USD 500k.', confidence: 0.7 }, { as: 'agent' });
ok(p1.proposed && p2.proposed && p3.proposed, 'three proposals, one per field, nothing changed yet');
{
  const d = (await api.op('deals.get', { deal: deal.id }, { as: partner })).deal;
  ok(d.round.type === '' && d.check_minor === null, 'the deal is unchanged until a person accepts');
}
const task = (await api.op('tasks.save', { title: 'Send the data room request', ref_collection: 'deals', ref_id: deal.id, assignee: partner, due_day: '2026-11-20' }, { as: 'agent' })).task;
ok(task.deal === deal.id && task.actor === 'agent' && task.due_day === '2026-11-20', 'a task for the stated next step, with its date');
const ref = (await api.op('refs.log', { deal: deal.id, kind: 'provided', signal: 'positive', name: 'Jane Doe', note: 'Former manager' }, { as: 'agent' })).reference;
await refuses(api, 'notes.summary-save', { note: note.id, sections: { nope: 'x' } }, { as: 'agent' }, 400, 'invalid_param', 'a summary section outside the template');
await refuses(api, 'notes.summary-save', { note: note.id, proposals: '["abcdefghijklmno"]' }, { as: 'agent' }, 404, 'not_found', 'a proposal that is not there');
note = (
  await api.op(
    'notes.summary-save',
    {
      note: note.id,
      headline: 'Robotics seed, USD 3M on a SAFE; data room next.',
      sections: { team: 'Two founders from Boston Dynamics.', round: 'USD 3M seed, post-money SAFE; firm check USD 500k discussed.', next_steps: 'Data room request by 20 Nov.' },
      proposals: JSON.stringify([p1.proposal, p2.proposal, p3.proposal]),
      tasks: JSON.stringify([task.id]),
      refs: JSON.stringify([ref.id]),
    },
    { as: 'agent' },
  )
).note;
// The agent's write answer is trimmed (fix 6): read the note back.
note = (await api.op('notes.get', { note: note.id }, { as: 'agent' })).note;
eq([note.review.state, note.review.steps.at, note.summary_by], ['ready', 3, 'agent'], "your AI agent's summary lands the review: Ready");

section('The partner sees the result in place and decides change by change');
let g = (await api.op('notes.get', { note: note.id }, { as: partner })).note;
eq([g.review.state, g.review.steps.at], ['ready', 3], 'Ready');
ok(g.review.proposals.length === 3 && g.review.proposals.every((p) => p.status === 'pending' && p.evidence && p.evidence.quote), 'three pending proposals, each with its quote');
ok(g.review.proposals[0].items[0].fields[0].name === 'round_type' && /^seed$/i.test(g.review.proposals[0].items[0].fields[0].after), 'the first is round type seed', g.review.proposals[0]);
ok(g.review.tasks.length === 1 && g.review.tasks[0].title === 'Send the data room request', 'the task shows in the note');
eq(g.review.refs, [ref.id], 'the reference is linked');
ok(g.summary.headline.indexOf('Robotics seed') === 0 && g.summary.sections.round.indexOf('USD 3M') >= 0, 'the summary in the template sections');
{
  const l = await api.op('notes.list', { deal: deal.id }, { as: partner });
  eq(l.notes.find((x) => x.id === note.id).review.pending, 3, 'the list row counts the changes waiting');
}
await api.op('proposals.accept', { proposal: p1.proposal }, { as: partner });
await api.op('proposals.accept', { proposal: p2.proposal }, { as: partner });
await api.op('proposals.dismiss', { proposal: p3.proposal, note: 'Not agreed yet' }, { as: partner });
{
  const d = (await api.op('deals.get', { deal: deal.id }, { as: partner })).deal;
  eq([d.round.type, d.round.raise_minor, d.check_minor], ['seed', 300000000, null], 'accepted: seed, USD 3M; dismissed: no check');
  g = (await api.op('notes.get', { note: note.id }, { as: partner })).note;
  eq(g.review.proposals.map((p) => p.status), ['accepted', 'accepted', 'dismissed'], 'each change shows its state in the note');
  eq(g.review.pending, 0, 'nothing left waiting');
}
{
  const n = await api.op('next.list', {}, { as: partner });
  ok(n.items.filter((i) => i.kind === 'proposal').length === 0, 'decided proposals left Next');
}

section('Transcripts and consent');
await refuses(api, 'notes.update', { note: note.id, consent: 'bogus' }, { as: partner }, 400, 'invalid_param', 'consent is an enum');
{
  const bad = await upload(partner, note.id, 'call.pdf', 'x');
  ok(bad.status === 400 && bad.body.code === 'invalid_param', 'a .pdf is not a transcript', bad);
  await api.op('notes.update', { note: note.id, consent: 'not_recorded' }, { as: partner });
  const refused = await upload(partner, note.id, 'call.vtt', 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello');
  ok(refused.status === 409 && refused.body.code === 'consent', 'a note marked not recorded takes no transcript', refused);
}
const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Jane>We closed USD 1.2M ARR last month.\n\n00:00:05.000 --> 00:00:08.000\n<v Pat>Great, we would like to see the data room.\n';
const up = await upload(partner, note.id, 'acme-call.vtt', vtt, { consent: 'informed' });
ok(up.status === 200 && up.body.note.transcript && up.body.note.consent === 'informed', 'a .vtt transcript attached with consent informed', up.body);
ok(['reading', 'waiting'].includes(up.body.note.review.state), 'the review waits for the transcript to be read (' + up.body.note.review.state + ')');
await refuses(api, 'notes.update', { note: note.id, consent: 'not_recorded' }, { as: partner }, 409, 'has_transcript', 'with a transcript the meeting was recorded');
const fileId = up.body.file.id;
const ready = await until(async () => {
  const f = await api.op('files.get', { file: fileId }, { as: partner });
  return ['ready', 'none', 'failed'].includes(f.file.text_state) ? f.file.text_state : false;
}, 60000);
eq(ready, 'ready', 'the kernel text step read the transcript');
{
  const st = await until(async () => {
    const x = (await api.op('notes.get', { note: note.id }, { as: partner })).note;
    return x.review.state === 'waiting' ? x : false;
  }, 20000);
  ok(st === false, 'the transcript asks nothing by itself (a person asks again)');
  const rv2 = await api.op('notes.review', { note: note.id }, { as: partner });
  ok(rv2.request !== '' && rv2.note.review.state === 'waiting', 'Ask your AI agent again: the review covers the transcript', rv2.note.review);
  const a = (await api.op('notes.get', { note: note.id }, { as: 'agent' })).note;
  ok(a.transcript.text.indexOf('USD 1.2M ARR') >= 0 && a.transcript.ext === 'vtt', 'your AI agent reads the transcript text');
  const p = (await api.op('notes.get', { note: note.id }, { as: partner })).note;
  ok(p.transcript.text === undefined && p.transcript.name === 'acme-call.vtt', 'people get the transcript without its text unless asked');
  const files = await api.op('files.list', { deal: deal.id }, { as: partner });
  ok(files.files.some((f) => f.id === fileId && f.folder === 'Notes'), 'the transcript sits in the deal room, folder Notes');
}

section('Your AI agent with its own notes, and asking again');
{
  const own = (await api.op('notes.create', { deal: deal.id, template: 'free', sections: { notes: 'Public: Acme raised a pre-seed in 2025.' } }, { as: 'agent' })).note;
  ok(own.author === null && own.actor === 'agent', 'your AI agent may write its own note');
  const upd = await api.op('notes.update', { note: own.id, sections: { notes: 'Public: Acme raised a pre-seed in 2025 (TechCrunch).' } }, { as: 'agent' });
  ok(upd.note.body.notes.indexOf('TechCrunch') > 0, 'and change it');
  const rv = await api.call('notes.review', { note: note.id }, { as: partner });
  ok(rv.status === 409 && rv.body.code === 'pending', 'notes.review again while that review waits: refused', rv.body);
}

section('Restricted deals');
const deal2 = (await api.op('deals.create', { company: 'stealth-bio.com', name: 'Stealth Bio' }, { as: partner })).deal;
await api.op('deals.restrict', { deal: deal2.id, restricted: true }, { as: partner });
const n2 = (await api.op('notes.create', { deal: deal2.id, sections: { team: 'Confidential founders.' }, save: true }, { as: partner })).note;
eq(n2.review.state, 'off', 'no review on a restricted deal your AI agent may not see');
await refuses(api, 'notes.get', { note: n2.id }, { as: 'agent' }, 403, 'restricted', 'your AI agent cannot read it');
await refuses(api, 'notes.list', { deal: deal2.id }, { as: partner2 }, 403, 'restricted', 'a partner off the team cannot list them');
{
  const all = await api.op('notes.list', {}, { as: partner2 });
  ok(all.hidden >= 1 && all.notes.every((x) => x.id !== n2.id), 'lists say hidden for notes of restricted deals');
}
await api.op('deals.restrict', { deal: deal2.id, restricted: true, agent_allowed: true }, { as: partner });
{
  await new Promise((r) => setTimeout(r, 10500)); // the platform's 10 s cooldown of note_review
  const rv = await api.op('notes.review', { note: n2.id }, { as: partner });
  ok(rv.request !== '', 'with agent_allowed the review runs', rv);
}

section('A meeting ends: the draft note waits in the template its stage calls for');
await api.op('deals.move', { deal: deal.id, stage: 'diligence' }, { as: partner });
await api.op('zz.emit', { event: 'meeting.ended', payload: JSON.stringify({ cal_event: 'calev000000001', deal: deal.id, company: deal.company.id }) }, { as: 'owner' });
{
  const l = await api.op('notes.list', { deal: deal.id, status: 'draft' }, { as: partner });
  const d = l.notes.find((x) => x.cal_event === 'calev000000001');
  ok(d && d.template.key === 'partner_meeting' && d.empty === true && d.author.name === 'Pat Partner', 'an empty Partner meeting draft for the point partner');
  const again = await api.op('notes.create', { deal: deal.id, cal_event: 'calev000000001' }, { as: partner });
  ok(again.existing === true && again.note.id === d.id, 'Add note opens the same draft');
  await api.op('zz.emit', { event: 'meeting.ended', payload: JSON.stringify({ cal_event: 'calev000000001', deal: deal.id }) }, { as: 'owner' });
  const l2 = await api.op('notes.list', { deal: deal.id, status: 'draft' }, { as: partner });
  eq(l2.notes.filter((x) => x.cal_event === 'calev000000001').length, 1, 'the same meeting never makes two drafts');
}

section('Timeline, search, delete and undo');
{
  const t = await api.op('records.timeline', { deal: deal.id }, { as: partner });
  ok(t.items.some((i) => i.module === 'deals' && i.kind === 'note' && i.href.indexOf('tab=notes') > 0), 'the saved note is on the deal timeline');
  const s = await api.op('search.query', { q: 'Boston Dynamics' }, { as: partner });
  ok(s.results.some((r) => r.kind === 'note' && r.id === note.id), 'Ctrl-K finds the note by its text');
  const s2 = await api.op('search.query', { q: 'Confidential founders' }, { as: partner2 });
  ok(!s2.results.some((r) => r.kind === 'note'), 'search hides notes of restricted deals');
  await refuses(api, 'notes.delete', { note: note.id }, { as: partner2 }, 403, 'not_permitted', 'only the author or the owner deletes');
  const del = await api.op('notes.delete', { note: note.id }, { as: partner });
  ok(del.deleted === true, 'the author deletes it');
  await refuses(api, 'notes.get', { note: note.id }, { as: partner }, 404, 'not_found', 'gone');
  await api.op('activity.undo', { entry: del._activity }, { as: partner });
  const back = await api.op('notes.get', { note: note.id }, { as: partner });
  ok(back.note.id === note.id, 'Undo brings it back');
}

section('Templates');
{
  const t = await api.op('notes.template-save', { name: 'Customer call', sections: '["Who","Use case","Pain","Would pay"]', stages: '[]' }, { as: 'owner' });
  eq([t.template.key, t.template.sections.map((s) => s.key)], ['customer_call', ['who', 'use_case', 'pain', 'would_pay']], 'a new template with keys from the labels');
  const r = await api.op('notes.template-save', { template: 'customer_call', sections: '["Who","Pain","Budget"]' }, { as: 'owner' });
  eq(r.template.sections.map((s) => s.key), ['who', 'pain', 'budget'], 'kept labels keep their keys');
  const pr = await api.op('notes.template-save', { name: 'Expert call', sections: '["Expert","Views"]' }, { as: 'agent' });
  ok(pr.proposed === true, 'for your AI agent a template change is a proposal');
  await refuses(api, 'notes.template-save', { name: 'Free', sections: '["X"]' }, { as: 'owner' }, 409, 'duplicate', 'names are unique');
}

summary('t02_notes');
