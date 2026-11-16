// Inbound deck to first reply, end to end, as the right roles, with your AI agent simulated through
// its ops and the agent token: the Gmail sweep, one-drop upload, triage with grades and anchors,
// thesis fit, Next verdicts, Advance, Pass with the drafted email approved and sent, Hold, Reopen,
// revisit, merge proposals, scouts, CSV import, DocSend links, the reply SLA, search and undo.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { newApi, fresh, setupFirm, section, ok, eq, summary, PEOPLE, APP, upload, waitText, deck, refuses, bridge, sleep } from './lib.mjs';

const P = PEOPLE.partner;
const A = PEOPLE.analyst;
const SC = PEOPLE.scout;

function sql(q, ...args) {
  const d = new DatabaseSync(join(APP, 'pb', 'pb_data', 'data.db'));
  try {
    return q.trim().toUpperCase().startsWith('SELECT') ? d.prepare(q).all(...args) : d.prepare(q).run(...args);
  } finally {
    d.close();
  }
}

fresh();
await bridge.reset();
await bridge.mode('search_gmail', 'offline');
const api = newApi();
const firm = await setupFirm(api);
await api.op('settings.update', { modules: { intake: { sweep: false } } }, { as: 'owner' });
// Fix 8: an email deck asks your AI agent only while the switch email_decks is on (off by default).
const auto = await api.op('settings.update', { agent_policy: '{"email_decks":true}' }, { as: 'owner' });
ok(auto.agent_policy.email_decks === true, 'the switch Read decks that arrive by email is on', auto.agent_policy);
await bridge.mode('search_gmail', 'ok');

const thesis = (await api.op('theses.save', { name: 'Seed robotics', criteria: [{ key: 'round_type', op: 'in', values: ['seed', 'pre_seed'], required: true }, { key: 'raise_minor', op: 'lte', value: 500000000, currency: 'USD' }, { key: 'technical_founder', op: 'bool', value: true }] }, { as: 'owner' })).thesis;
ok(thesis && thesis.id, 'a thesis to check against', thesis);

/* ---------------------------------------------------------------- sweep */
section('Gmail sweep of the deals label');
const sw = await api.op('intake.sweep', {}, { as: P });
ok(sw.ok && sw.found === 3 && sw.added === 3, 'three labelled messages became items (the newsletter without the label was left alone)', sw);
const l1 = await api.op('intake.list', { segment: 'all' }, { as: P });
const byName = (n) => l1.items.find((x) => x.name.indexOf(n) >= 0);
const acmeMail = byName('Acme');
const lumen = byName('Lumen');
const orbit = byName('Orbital');
ok(acmeMail && lumen && orbit, 'items named from the email subject until the company is known', l1.items.map((x) => x.name));
ok(acmeMail.channel === 'email' && acmeMail.files === 1 && acmeMail.source.label === 'Maya Chen', 'Acme: email channel, its deck attached, Maya Chen the source', acmeMail);
ok(orbit.files === 0 && orbit.triage_state === 'waiting', 'Orbital (a link-only intro): no file, your AI agent asked to read the email', orbit);
const g1 = await api.op('intake.get', { item: acmeMail.id }, { as: P });
ok(g1.text.indexOf('USD 1.2M ARR') >= 0 && g1.email_subject === 'Acme Robotics: seed round deck', 'the body is kept and the subject', g1.email_subject);
ok(/^\d{4}-\d{2}-\d{2}$/.test(g1.due.day) && g1.due.state === 'open', 'reply due day set (business days)', g1.due);
const sw2 = await api.op('intake.sweep', {}, { as: P });
ok(sw2.ok && sw2.found === 3 && sw2.added === 0, 'a second sweep files nothing twice (dedupe by message id)', sw2);
await bridge.mode('search_gmail', 'error', 'Gmail is not connected.');
const sw3 = await api.op('intake.sweep', {}, { as: P });
ok(sw3.ok === false && /not connected/.test(sw3.error), 'a provider error (HTTP 200 with error) is reported, not swallowed', sw3);
await bridge.mode('search_gmail', 'ok');
const st = await api.op('intake.settings', {}, { as: 'owner' });
ok(st.last_sweep && st.last_sweep.ok === false && st.sweep === false && st.bridge === true, 'settings show the last sweep and the switch', st);

/* --------------------------------------------------------- one drop */
section('Add deal: one drop');
const up = await upload(api, 'intake.add', {}, [{ name: 'Acme deck v2.pdf', bytes: deck('acme_robotics_seed.pdf') }], P);
ok(up.status === 200 && up.body.status === 'new' && up.body.step === 'received' && up.body.files_list.length === 1, 'a dropped deck is an item at once (Received)', up.body);
const drop = up.body;
ok(drop.name === 'Acme deck v2' && drop.channel === 'upload', 'named from the file until the company is known', drop.name);
const bad = await upload(api, 'intake.add', {}, [{ name: 'notes.txt', bytes: Buffer.from('hello') }], P);
ok(bad.status === 400 && bad.body.code === 'invalid_file', 'a non-deck file is refused in one line', bad.body);
await refuses(api, 'intake.add', {}, { as: P }, 400, 'missing_param', 'nothing to add');
const site = await api.op('intake.add', { text: 'https://www.boltlabs.dev/' }, { as: P });
ok(site.company && site.company.domain === 'boltlabs.dev' && site.name === 'Boltlabs' && site.link_kind === 'website', 'a pasted website becomes the company', site);
const ds = await api.op('intake.add', { url: 'https://docsend.com/view/abc123', name: 'Kite Robotics' }, { as: P });
ok(ds.link_kind === 'docsend' && ds.read_trigger === 'deck_fetch' && ds.triage_state === 'waiting', 'a DocSend link alone asks your AI agent to fetch it (deck_fetch)', ds);
const fires0 = (await bridge.fires()).fires.map((f) => f.trigger);
ok(fires0.includes('deck_triage') && fires0.includes('deck_fetch'), 'the reads were asked: deck_triage and deck_fetch fired (one trigger per task)', fires0);
const waiting0 = (await api.op('intake.list', { segment: 'all' }, { as: P })).items.filter((x) => x.triage_state === 'waiting');
ok(waiting0.length >= 5, 'every item with something to read waits for your AI agent (fired now or in a minute, after the cooldown)', waiting0.map((x) => x.name));

/* ------------------------------------------------------------ triage */
section('triage by your AI agent');
// Fix 8: no queue to claim from; your AI agent works on the record a fire named (item_id).
ok((await api.op('intake.get', { item: acmeMail.id }, { as: P })).triage_state === 'waiting', 'the Acme email waits for your AI agent');
const wk = await api.op('triage.start', { item: acmeMail.id }, { as: 'agent' });
ok(wk.files.length === 1 && wk.fact_keys.length === 25 && wk.slides.length === 10 && wk.theses.length === 1, 'triage.start answers the files, 25 fact keys, the slides and the theses', { files: wk.files, n: wk.fact_keys.length });
const reading = await api.op('intake.get', { item: acmeMail.id }, { as: P });
ok(reading.step === 'reading' && reading.steps.at === 1, 'the StepTrack shows Reading', reading.steps);
const fileId = wk.files[0].id;
const n0 = await api.op('next.list', {}, { as: P });
ok(!n0.items.some((x) => x.key === 'intake:' + acmeMail.id), 'not in Next before your AI agent finished', n0.items.map((x) => x.key));
const ft = await waitText(api, fileId, 'agent');
ok(ft && ft.file.text_state === 'ready', 'the deck text layer is ready', ft && ft.file);
const facts = [
  { key: 'round_type', value: 'seed', grade: 'founder_reported', file: fileId, page: 1, quote: 'Seed round, November 2026' },
  { key: 'raise_minor', value: '3000000', currency: 'USD', grade: 'founder_reported', file: fileId, page: 7, quote: 'Raising USD 3,000,000 on a post-money SAFE' },
  { key: 'post_money_minor', value: 15000000, currency: 'USD', grade: 'founder_reported', file: fileId, page: 7, quote: 'Valuation cap: USD 15,000,000 post-money' },
  { key: 'arr_minor', value: '1200000', currency: 'USD', grade: 'founder_reported', file: fileId, page: 4, quote: 'ARR: USD 1.2M (October 2026)' },
  { key: 'growth_mom_ppm', value: '15', grade: 'founder_reported', file: fileId, page: 4, quote: 'Revenue growth: 15% month over month' },
  { key: 'technical_founder', value: true, grade: 'founder_reported', file: fileId, page: 5, quote: 'PhD Carnegie Mellon (grasp planning)' },
  { key: 'currency', value: 'USD', grade: 'founder_reported', file: fileId, page: 7 },
  { key: 'customers', value: null, grade: 'unknown' },
];
await refuses(api, 'triage.facts-save', { item: acmeMail.id, facts: [{ key: 'raise', value: '3000000', currency: 'USD', grade: 'artifact', file: fileId, page: 7 }] }, { as: 'agent' }, 400, 'invalid_fact', 'an unknown fact key is refused naming the nearest');
await refuses(api, 'triage.facts-save', { item: acmeMail.id, facts: [{ key: 'growth_mom_ppm', value: '15', grade: 'founder_reported', num_kind: 'computed', file: fileId, page: 4 }] }, { as: 'agent' }, 400, 'invalid_fact', 'your AI agent never computes a number');
await refuses(api, 'triage.facts-save', { item: acmeMail.id, facts: [{ key: 'raise_minor', value: '3000000', currency: 'USD', grade: 'founder_reported', file: fileId, page: 7, quote: 'Raising USD 9 billion' }] }, { as: 'agent' }, 400, 'quote_not_found', 'a quote not on the page is refused');
const fs0 = await api.op('triage.facts-save', { item: acmeMail.id, facts: facts, company: { name: 'Acme Robotics', domain: 'acmerobotics.ai' }, one_liner: 'Mobile picking arms for mid-size warehouses', founders: [{ name: 'Maya Chen', email: 'maya@acmerobotics.ai', title: 'CEO' }, { name: 'Tomas Varga', title: 'CTO' }], missing: ['competition'], questions: ['What does a site deployment cost the firm up front?'] }, { as: 'agent' });
// Your AI agent's write answer is short (ids, states, what changed: qa-cli RULING CLI-11); the item in full is a person's read.
ok(JSON.stringify(fs0).length < 6000 && fs0.saved === 8, 'the answer to your AI agent is short', JSON.stringify(fs0).length);
const fs1 = { saved: fs0.saved, item: await api.op('intake.get', { item: acmeMail.id }, { as: P }) };
ok(fs1.saved === 8 && fs1.item.step === 'ready', "eight facts saved; your AI agent's save makes it Ready", { saved: fs1.saved, step: fs1.item.step });
const f = (k) => fs1.item.facts.find((x) => x.key === k);
ok(f('raise_minor').value === 300000000 && f('raise_minor').anchor !== '' && f('raise_minor').page === 7, 'raise in minor units with a page anchor', f('raise_minor'));
ok(f('growth_mom_ppm').value === 150000 && f('growth_mom_ppm').text === '15% MoM', 'growth in ppm, shown as 15% MoM', f('growth_mom_ppm'));
ok(f('customers').grade === 'unknown' && f('customers').text === 'Unknown', 'unknown stays unknown', f('customers'));
ok(fs1.item.name === 'Acme Robotics' && fs1.item.company.domain === 'acmerobotics.ai', 'the company is set from the deck', fs1.item.company);
const fit = fs1.item.fit[0];
ok(fit && fit.state === 'met' && fit.checks.every((c) => c.status === 'met'), 'thesis fit: every criterion met (computed, no score)', fit);
eq(fs1.item.figures.map((x) => x.text), ['USD 3M', 'USD 15M', 'USD 1.2M', '15% MoM'], 'the figure strip: Raise, Valuation, ARR, Growth');
ok(fs1.item.people.some((x) => x.role === 'founder' && x.name === 'Maya Chen') && fs1.item.people.some((x) => x.name === 'Tomas Varga'), 'founders recorded', fs1.item.people);
ok(fs1.item.missing[0].label === 'Competition' && fs1.item.questions.length === 1, 'missing slides and questions', fs1.item.missing);
const anc = await api.op('anchors.resolve', { anchors: [f('raise_minor').anchor] }, { as: P });
ok(anc.anchors && anc.anchors[0] && anc.anchors[0].page === 7 && anc.anchors[0].valid === true, 'the anchor resolves to page 7 (the Citation opens it)', anc);
const ready = await api.op('intake.get', { item: acmeMail.id }, { as: P });
ok(ready.step === 'ready' && ready.triage_state === 'done' && ready.agent_facts === true, 'Ready', { step: ready.step, st: ready.triage_state });
ok(!Object.values(ready.agent || {}).some((x) => x.pending), 'the read landed: nothing waits on your AI agent', ready.agent);

section('Next: the verdict card');
const n1 = await api.op('next.list', {}, { as: P });
const v = n1.items.find((x) => x.key === 'intake:' + acmeMail.id);
ok(v && v.kind === 'verdict' && v.card === 'triage' && v.rank === 20 && v.agent === true, 'a verdict item (rank 20) with the triage card', v);
eq(v && v.actions.map((a) => a.label), ['Advance', 'Pass', 'Hold'], 'three actions');
ok(v && v.actions[0].primary && v.actions[1].choose.param === 'reason' && v.actions[1].choose.options.length === 8 && v.actions[2].choose.param === 'days', 'Advance primary; Pass asks a reason chip; Hold asks how long', v && v.actions);
eq(v && v.figures.map((x) => x.value), ['USD 3M', 'USD 15M', 'USD 1.2M'], 'Next figures');
const nScout = await api.op('next.list', {}, { as: SC });
ok(!nScout.items.some((x) => x.module === 'intake'), 'a scout gets no verdicts');

section('a person confirms; your AI agent never overwrites it');
await api.op('triage.confirm', { item: acmeMail.id, keys: ['raise_minor'] }, { as: P });
const fs2 = await api.op('triage.facts-save', { item: acmeMail.id, facts: [{ key: 'raise_minor', value: '4000000', currency: 'USD', grade: 'founder_reported', file: fileId, page: 7 }] }, { as: 'agent' });
ok(fs2.saved === 0 && fs2.kept.length === 1 && fs2.kept[0].key === 'raise_minor', 'the confirmed value is kept and reported', fs2.kept);
await refuses(api, 'triage.confirm', { item: acmeMail.id }, { as: 'agent' }, 403, 'agent_not_permitted', 'confirming is people only');

section('merge a duplicate (your AI agent proposes)');
await api.op('triage.start', { item: drop.id }, { as: 'agent' });
await api.op('triage.facts-save', { item: drop.id, company: { name: 'Acme Robotics', domain: 'acmerobotics.ai' }, facts: [{ key: 'sector', value: 'robotics', grade: 'founder_reported', file: drop.files_list[0].id, page: 1 }] }, { as: 'agent' });
const dropFull = await api.op('intake.get', { item: drop.id }, { as: P });
ok(dropFull.history.prior.some((h) => h.label === acmeMail.number && h.same === 'company'), 'prior history: the same company already waits in the Inbox', dropFull.history);
const prop = await api.op('intake.merge', { item: drop.id, into: acmeMail.id, why: 'Same deck, same company', evidence: 'acmerobotics.ai' }, { as: 'agent' });
ok(prop.proposed === true && prop.proposal, 'your AI agent\'s merge becomes a proposal', prop);
const np = await api.op('next.list', {}, { as: P });
ok(np.items.some((x) => x.kind === 'proposal'), 'the proposal waits in Next');
await api.op('proposals.accept', { proposal: prop.proposal }, { as: P });
const merged = await api.op('intake.get', { item: drop.id }, { as: P });
const kept = await api.op('intake.get', { item: acmeMail.id }, { as: P });
ok(merged.status === 'merged' && merged.merged_into.number === acmeMail.number, 'the duplicate is merged', merged.status);
ok(kept.files_list.length === 2 && kept.facts.some((x) => x.key === 'sector'), 'its deck and the fact the kept item lacked moved over', { files: kept.files_list.length });

section('Advance: a deal at Screen');
await refuses(api, 'intake.advance', { item: acmeMail.id }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent never advances');
await refuses(api, 'intake.advance', { item: acmeMail.id }, { as: SC }, 403, 'not_permitted', 'a scout never decides\'s item');
const adv = await api.op('intake.advance', { item: acmeMail.id }, { as: P });
ok(adv.deal && adv.deal.number === 'D-0001' && adv.deal.stage === 'screen', 'D-0001 opened at Screen', adv.deal);
ok(adv._activity, 'the answer names its undo unit');
const deal = (await api.op('deals.get', { deal: 'D-0001' }, { as: P })).deal;
ok(deal.point && deal.point.name === 'Pat Partner', 'point partner = the person who advanced', deal.point);
ok(deal.round.raise_minor === 300000000 && deal.round.type === 'seed' && deal.round.post_money_minor === 1500000000 && deal.currency === 'USD', 'round terms from the facts', deal.round);
ok(deal.source === 'inbound' && deal.fund && deal.intake_item === acmeMail.id, 'source inbound (the founder wrote), the only fund, linked to the item', { s: deal.source, f: deal.fund });
ok((deal.people || []).some((x) => x.role === 'founder'), 'founders on the deal', deal.people);
const room = await api.op('files.list', { deal: 'D-0001' }, { as: P });
ok(room.files.length === 2 && room.files.every((x) => x.folder === 'Deck'), 'the decks moved to the deal room', room.files.map((x) => x.folder + '/' + x.name));
const vd = await api.op('intake.verdict', { deal: 'D-0001' }, { as: P });
ok(vd.item.number === acmeMail.number && vd.facts.length >= 8 && vd.checks.length === 1 && vd.missing.length === 1, 'intake.verdict gives the deal page its facts and checks', { n: vd.facts.length });
await refuses(api, 'intake.advance', { item: acmeMail.id }, { as: P }, 409, 'not_open', 'advancing twice is refused');
const n2 = await api.op('next.list', {}, { as: P });
ok(!n2.items.some((x) => x.key === 'intake:' + acmeMail.id), 'the verdict left Next');

section('Pass: one chip, the email drafted, one Approve');
await refuses(api, 'intake.pass', { item: lumen.id, reason: 'traction' }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent never passes');
await refuses(api, 'intake.pass', { item: lumen.id, reason: 'boring' }, { as: P }, 400, 'invalid_param', 'reasons are chips, not text');
const ps = await api.op('intake.pass', { item: lumen.id, reason: 'traction', criterion: 'Revenue under USD 10K', revisit_milestone: 'USD 50K MRR', revisit_day: '2027-03-01' }, { as: P });
ok(ps.item.status === 'passed' && ps.pass.reason_label === 'Traction' && ps.pass.email_state === 'waiting' && ps.pass.to[0] === 'raj@lumenhealth.io', 'passed; the email goes to the founder; your AI agent asked', ps.pass);
const lst = await api.op('intake.list', { segment: 'waiting' }, { as: P });
ok(lst.items.length === 1 && lst.counts.waiting === 1, 'the item waits in Waiting until its email is sent', lst.counts);
const pf = (await bridge.fires()).fires.filter((f) => f.trigger === 'pass_draft');
ok(pf.length === 1 && ps.pass.agent.pass_draft && ps.pass.agent.pass_draft.request === pf[0].request_id, 'Pass with an email fired pass_draft once, kept on the pass', { pf, agent: ps.pass.agent });
const dr = await api.op('passes.draft', { pass: ps.pass.id, subject: 'Re: Lumen Health pre-seed', body: 'Hi Raj,\n\nThank you for sharing Lumen Health. We liked the pilot results in Austin.\n\nWe are not yet convinced on traction at this stage.\n\nWhat would change our view: USD 50K MRR.\n\nBest,\nPat' }, { as: 'agent' });
ok(dr.outbound.status === 'draft' && dr.outbound.kind === 'pass' && dr.outbound.approver !== '', 'the draft is an outbound message for the person who passed', dr.outbound);
ok(!(await api.op('intake.get', { item: lumen.id }, { as: P })).pass.agent.pass_draft.pending, 'the draft landed: the ask is answered');
const n3 = await api.op('next.list', {}, { as: P });
const di = n3.items.find((x) => x.kind === 'draft' && x.data && x.data.outbound === dr.outbound.id);
ok(di && di.actions[0].op === 'outbound.approve', 'the draft is in Next with Approve and send', di);
const nA = await api.op('next.list', {}, { as: A });
ok(!nA.items.some((x) => x.data && x.data.outbound === dr.outbound.id), 'only the person who passed (or the owner) approves it');
await refuses(api, 'outbound.approve', { outbound: dr.outbound.id }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent never sends');
await api.op('outbound.approve', { outbound: dr.outbound.id }, { as: P });
const sent = (await bridge.sent()).sent;
ok(sent.length === 1 && /raj@lumenhealth.io/.test(sent[0].to), 'sent once from the firm\'s Gmail', sent);
const lp = await api.op('intake.get', { item: lumen.id }, { as: P });
ok(lp.pass.email_state === 'sent', 'the pass email is sent', lp.pass.email_state);
eq((await api.op('intake.list', { segment: 'waiting' }, { as: P })).counts.waiting, 0, 'Waiting is empty');

section('revisit: Re-open or Keep passed');
sql("UPDATE intake_items SET revisit_day = '2026-01-05' WHERE id = ?", lumen.id);
sql("UPDATE passes SET revisit_day = '2026-01-05' WHERE id = ?", ps.pass.id);
const n4 = await api.op('next.list', {}, { as: P });
const rv = n4.items.find((x) => x.key === 'intake:revisit:' + lumen.id);
ok(rv && rv.kind === 'verdict' && rv.actions.map((a) => a.label).join() === 'Re-open,Keep passed', 'on the revisit day Next asks Re-open or Keep passed', rv);
await api.op('intake.keep', { item: lumen.id }, { as: P });
const n5 = await api.op('next.list', {}, { as: P });
ok(!n5.items.some((x) => x.key === 'intake:revisit:' + lumen.id), 'kept passed: the revisit left Next');

section('Hold, then back in Next');
const hd = await api.op('intake.hold', { item: orbit.id, days: 7 }, { as: A });
ok(hd.item.status === 'held' && hd.item.hold_until !== '', 'an analyst held it for a week', hd.item.hold_until);
eq((await api.op('intake.list', { segment: 'held' }, { as: P })).counts.held, 1, 'Held segment');
sql("UPDATE intake_items SET hold_until = '2026-01-05' WHERE id = ?", orbit.id);
const n6 = await api.op('next.list', {}, { as: P });
const hv = n6.items.find((x) => x.key === 'intake:' + orbit.id);
ok(hv && hv.chips[0].label === 'Held', 'on its day it is back in Next', hv);
await api.op('intake.reopen', { item: orbit.id }, { as: P });
eq((await api.op('intake.get', { item: orbit.id }, { as: P })).status, 'new', 'reopened to New');

section('your AI agent cannot; a person asks again');
const o0 = await api.op('intake.get', { item: orbit.id }, { as: P });
await api.op('agent.cannot', { trigger: o0.read_trigger, record: orbit.id, reason: 'The email holds only a Drive link that needs a sign-in.' }, { as: 'agent' });
const of = await api.op('intake.get', { item: orbit.id }, { as: P });
ok(of.triage_state === 'failed' && /sign-in/.test(of.triage_note), 'the reason shows on the card', of.triage_note);
await sleep(10500); // the platform's 10 s cooldown of the trigger
const rt = await api.op('intake.retriage', { item: orbit.id }, { as: P });
ok(rt.item.triage_state === 'waiting' && rt.request !== '' && rt.trigger === o0.read_trigger, 'asked again: one fire', rt);

section('DocSend link: fetched and attached by your AI agent');
const dsw = await api.op('intake.get', { item: ds.id }, { as: 'agent' });
ok(dsw.link_kind === 'docsend' && dsw.url === 'https://docsend.com/view/abc123', 'your AI agent reads the link of the item the fire named', dsw.url);
const deckPath = join(APP, '..', 'tmp', 'kite_deck.pdf');
mkdirSync(join(APP, '..', 'tmp'), { recursive: true });
copyFileSync(join(APP, 'tools', 'dev', 'fixtures', 'decks', 'lumen_health_preseed.pdf'), deckPath);
const att = await api.op('files.upload', { owner_collection: 'intake_items', owner_id: ds.id, folder: 'Deck', paths: [deckPath], origin: 'link', source_ref: 'https://docsend.com/view/abc123' }, { as: 'agent' });
ok(att.files.length === 1, 'the fetched deck is attached', att);
const dsg = await api.op('intake.get', { item: ds.id }, { as: P });
ok(dsg.files_list.length === 1 && dsg.read_trigger === 'deck_triage' && dsg.triage_state === 'waiting', 'the deck is attached; your AI agent reads it next in the same task (no second ask)', dsg);

section('Advance needs a company');
await refuses(api, 'intake.advance', { item: ds.id }, { as: P }, 400, 'company_needed', 'an item without a company asks for one (the sender firm is never guessed into the deal)');
const adv2 = await api.op('intake.advance', { item: ds.id, company: 'kiterobotics.com' }, { as: P });
ok(adv2.deal && adv2.item.company && adv2.item.company.domain === 'kiterobotics.com', 'with --company it opens the deal', adv2.item.company);

section('scouts');
const sc = await upload(api, 'intake.add', {}, [{ name: 'Lumen pre-seed.pdf', bytes: deck('lumen_health_preseed.pdf') }], SC);
ok(sc.status === 200 && sc.body.channel === 'scout' && sc.body.source.kind === 'scout' && sc.body.source.label === 'Sam Scout', 'a scout\'s drop is a scout submission', sc.body);
const sl = await api.op('intake.list', { segment: 'all' }, { as: SC });
ok(sl.items.length === 1 && sl.items[0].id === sc.body.id && sl.counts.new === 1, 'a scout sees only their own items', sl.counts);
await refuses(api, 'intake.pass', { item: sc.body.id, reason: 'team' }, { as: SC }, 403, 'not_permitted', 'a scout does not decide');
await refuses(api, 'intake.get', { item: lumen.id }, { as: SC }, 404, 'not_found', 'nor see others\' items');
const s2 = await api.op('intake.list', {}, { as: PEOPLE.scout2 });
ok(s2.items.length === 0, 'the other scout sees nothing of it');
const sco = await api.op('scouts.list', {}, { as: P });
ok(sco.scouts.length === 1 && sco.scouts[0].items === 1 && sco.scouts[0].account.name === 'Sam Scout', 'scouts with their counts', sco.scouts);
const ext = await api.op('scouts.save', { name: 'Ext Scout', email: 'ext@angels.test' }, { as: P });
ok(ext.id && ext.status === 'active', 'an outside scout added', ext);
await refuses(api, 'scouts.save', { name: 'X' }, { as: 'agent' }, 403, 'agent_not_permitted', 'scouts are people only');
await refuses(api, 'intake.list', {}, { as: PEOPLE.finance }, 403, 'not_permitted', 'finance has no Inbox');

section('bulk pass without email, and Undo');
const b1 = await api.op('intake.add', { company: 'Tidal Grid', paths: [deckPath] }, { as: 'agent' });
ok(b1.channel === 'sourced' && b1.files_list.length === 1, 'your AI agent adds a sourced deal with --paths', b1);
const b2 = await api.op('intake.add', { company: 'Quill Health', text: 'Met at a demo day.' }, { as: P });
const bp = await api.op('intake.pass', { items: [b1.id, b2.id], reason: 'thesis_fit', email: false }, { as: P });
ok(bp.passed === 2 && bp.items.every((x) => x.email_state === 'none'), 'two passed at once, no email', bp);
const p1 = await api.op('intake.pass', { item: site.id, reason: 'market' }, { as: P });
ok(p1.pass.email_state === 'none', 'no address known: no email to draft', p1.pass);
const un = await api.op('activity.undo', { entry: p1._activity }, { as: P });
ok(un && (await api.op('intake.get', { item: site.id }, { as: P })).status === 'new', 'Undo puts it back in New', un);

section('licence: internal only');
await refuses(api, 'intake.add', { company: 'Paid Data Co', licence: 'secret' }, { as: 'agent' }, 400, 'invalid_param', 'licence takes public or internal_only');
const lic = await api.op('intake.add', { company: 'Paid Data Co', licence: 'internal_only', text: 'From a licensed database.' }, { as: 'agent' });
ok(lic.licence === 'internal_only', 'a licensed source keeps the internal_only tag', lic.licence);
const pub0 = await api.op('intake.add', { company: 'Open Data Co' }, { as: P });
ok(pub0.licence === 'public', 'public by default');

section('the person writes the pass email');
const sp = await api.op('intake.add', { company: 'Nimbus Fleet', source_person: { name: 'Lee Nimbus', email: 'lee@nimbusfleet.com' } }, { as: P });
const pw = await api.op('intake.pass', { item: sp.id, reason: 'valuation', criterion: 'Cap above USD 30M' }, { as: P });
const wr = await api.op('passes.write', { pass: pw.pass.id }, { as: P });
ok(wr.outbound.status === 'draft' && /Hi Lee/.test(wr.outbound.body) && /the valuation \(Cap above USD 30M\)/.test(wr.outbound.body) && wr.outbound.ai_chars === 0, 'the template opens editable at once', wr.outbound.body);
ok(!(wr.pass.agent.pass_draft && wr.pass.agent.pass_draft.pending), "the person wrote it: the ask for a draft is answered", wr.pass.agent);
const late = await api.call('passes.draft', { pass: pw.pass.id, subject: 'x', body: 'y' }, { as: 'agent' });
ok(late.status === 409 && late.body.code === 'person_draft', 'a late agent draft does not overwrite the person\'s', late.body);

section('reply SLA: past due is a stall (rank 10)');
const old = await api.op('intake.add', { company: 'Late Labs', text: 'Old email', received_at: '2026-10-01T10:00:00Z' }, { as: P });
ok(old.due.state === 'overdue', 'received weeks ago: overdue', old.due);
const n7 = await api.op('next.list', {}, { as: P });
const stl = n7.items.find((x) => x.key === 'intake:' + old.id);
ok(stl && stl.kind === 'stall' && stl.rank === 10 && stl.chips[0].label === 'Reply overdue', 'a stall item at the top of Next', stl);
ok(n7.items[0].rank <= 10, 'Next sorts it first');

section('CSV import of a deal list');
const csv = 'Company,Website,Founder,Founder email,Description,Date added\nHarbor AI,harborai.com,Ana Ruiz,ana@harborai.com,Port logistics copilots,2026-11-02\nTidal Grid,,,,,\n';
const pv = await api.op('imports.preview', { target: 'intake', csv: csv }, { as: P });
ok(pv.mapping.Company === 'company' && pv.mapping['Founder email'] === 'founder_email' && pv.mapping['Date added'] === 'received', 'columns matched by synonyms', pv.mapping);
const rn = await api.op('imports.run', { target: 'intake', csv: csv }, { as: P });
ok(rn.counts.created === 2, 'two created (a company still waiting in the Inbox would be skipped)', rn.counts);
const rn2 = await api.op('imports.run', { target: 'intake', csv: csv }, { as: P });
ok(rn2.counts.skipped === 2, 'the same list again: both skipped while they wait', rn2.counts);
const tg = (await api.op('intake.list', { q: 'Tidal' }, { as: P })).items[0];
const tgd = await api.op('intake.get', { item: tg.id }, { as: P });
ok(tgd.history.prior.some((h) => h.status === 'passed' && h.reason === 'thesis_fit'), 'Tidal Grid again: its earlier pass and reason show as history', tgd.history);
const hb = (await api.op('intake.list', { q: 'Harbor' }, { as: P })).items[0];
ok(hb && hb.channel === 'csv' && hb.one_liner === 'Port logistics copilots', 'the imported deal is in the Inbox', hb);

section('search and timeline');
const sr = await api.op('search.query', { q: 'Lumen' }, { as: P });
ok(sr.results.some((x) => x.kind === 'intake'), 'Ctrl K finds intake items', sr.results.map((x) => x.kind + ':' + x.title));
const sr2 = await api.op('search.query', { q: 'Maya' }, { as: P });
ok(sr2.results.some((x) => x.kind === 'intake'), 'and by founder', sr2.results.map((x) => x.kind + ':' + x.title));
const tl = await api.op('companies.timeline', { company: 'acmerobotics.ai' }, { as: P });
ok(tl.items.some((x) => x.module === 'intake'), 'the company timeline shows its inbound history', tl.items.map((x) => x.title));

section('pass reasons from Settings');
await api.op('settings.update', { modules: { intake: { pass_reasons: ['team', 'traction', 'thesis_fit'] } } }, { as: 'owner' });
const n8 = await api.op('next.list', {}, { as: P });
const any = n8.items.find((x) => x.module === 'intake' && x.kind !== 'draft' && x.actions.length === 3);
eq(any && any.actions[1].choose.options.map((o) => o.label), ['Team', 'Traction', 'Fit with thesis'], 'Pass chips follow the firm\'s list');

summary('t02 flows');
