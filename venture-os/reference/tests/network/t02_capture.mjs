// t02: capture end to end with the mock bridge. Consent is opt-in (nothing
// is logged before it); mail headers become touches by structure (SENT,
// members on the headers, bulk skipped, excluded domains left out, free
// mail makes no company); the calendar stores meetings, logs past ones,
// queues a brief 18 hours ahead and emits meeting.ended once; strength
// comes from the engine; the brief your AI agent is asked for (meeting_brief) is written as your AI agent; the Next
// "note" item and its actions; the bridge offline and 200-with-error shapes.
import { bridge, firesOf, eq, firm, fresh, newApi, ok, refuses, section, sleep, summary } from './lib.mjs';

await fresh();
const api = newApi();
const { O, P, AN, A } = await firm(api);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
// Fix 8: briefs before external meetings are asked only while the switch meeting_briefs is on (off by default).
eq((await api.op('settings.update', { agent_policy: '{"meeting_briefs":true}' }, O)).agent_policy.meeting_briefs, true, 'the switch Brief me before external meetings is on');

section('before anyone opts in');
const s0 = await api.op('capture.sync', {}, O);
eq(s0.mail[0].state, 'skipped', 'mail is not read at all while nobody opted in');
eq(s0.calendar.state, 'ok', 'the owner\'s calendar is read (meetings for Today and briefs)');
const ints0 = await api.op('interactions.list', {}, O);
eq(ints0.total, 0, 'no touch is logged without consent');
const ppl0 = await api.op('network.people', {}, O);
eq(ppl0.total, 0, 'no person is created from an invite without consent');
const cal0 = await api.op('calendar.list', { day: day(-2), days: 4 }, O);
const titles0 = cal0.events.map((e) => e.title);
ok(titles0.includes('Acme Robotics first meeting') && !titles0.includes('Partners weekly'), 'external meetings are listed, internal ones only with --all', titles0);
const calAll = await api.op('calendar.list', { day: day(-2), days: 4, all: true }, O);
ok(calAll.events.some((e) => e.title === 'Partners weekly' && e.external === false), 'calendar.list --all shows the internal meeting');
const soon = cal0.events.find((e) => e.title === 'Acme Robotics first meeting');
ok(soon && soon.brief && soon.brief.state === 'queued', 'the meeting within 18 hours has a brief queued', soon && soon.brief);
const later = cal0.events.find((e) => e.title === 'KitePay catch-up');
ok(later && later.brief === null, 'a meeting 30 hours away has no brief yet');
const calP = await api.op('calendar.list', { day: day(-2), days: 4 }, P);
ok(calP.events.every((e) => e.attendees.some((a) => a.member)) && calP.events.some((e) => e.title === 'Call: Lumen Health') && !calP.events.some((e) => e.title === 'KitePay catch-up'), 'a partner sees only the meetings they attend', calP.events.map((e) => e.title));

section('consent');
await refuses(api, 'capture.consent', { consent: true }, A, 403, 'agent_not_permitted', 'your AI agent never sets consent');
await refuses(api, 'capture.consent', { exclude_domains: '["not a domain"]' }, O, 400, 'invalid_param', 'a bad domain is refused naming it');
const c1 = await api.op('capture.consent', { consent: true, exclude_domains: '["family.example"]' }, O);
eq([c1.consent, c1.exclude_domains], [true, ['family.example']], 'the owner opts in and leaves a family domain out');
await api.op('capture.consent', { consent: true }, P);
const st1 = await api.op('capture.status', {}, P);
eq(st1.members.filter((m) => m.consent).length, 2, 'two members opted in');
ok(st1.members.find((m) => m.email === 'owner@venture.test').exclude_domains.length === 0, 'another member\'s excluded domains are not shown, only their count');

section('a deal for Acme first');
const acme = (await api.op('companies.upsert', { name: 'Acme Robotics', domain: 'acmerobotics.ai' }, O)).company;
const deal = await api.op('deals.create', { company: acme.id }, P);
const dealView = deal.deal || deal;

section('mail headers');
await refuses(api, 'capture.sync', { what: 'all' }, O, 409, 'too_soon', 'a second sync within 30 seconds waits');
const s1 = await api.op('capture.sync', { what: 'mail' }, O);
const owner = s1.mail[0];
ok(owner.state === 'ok' && owner.logged >= 6, 'the owner mailbox logged its touches', owner);
eq(s1.mail[1].state, 'never', 'no capture mailbox is set up');
const ints = await api.op('interactions.list', { limit: 100 }, O);
const subjects = ints.interactions.map((i) => i.subject);
ok(!subjects.includes('This week in venture') && !subjects.includes('Digest'), 'bulk mail (category label, List-Unsubscribe) is skipped');
ok(!subjects.includes('Dinner'), 'the excluded domain is left out');
const sent = ints.interactions.find((i) => i.subject === 'Re: Acme Robotics: seed round');
ok(sent && sent.direction === 'out' && sent.member.name === 'Olivia Owner', 'a SENT message is the owner writing out (even from another address)', sent);
const rajTouches = ints.interactions.filter((i) => i.subject === 'Lumen Health follow up');
eq(rajTouches.length, 2, 'both consenting members on the headers get the touch');
const acmeIn = ints.interactions.find((i) => i.subject === 'Acme Robotics: seed round');
ok(acmeIn && acmeIn.people.length === 2 && acmeIn.direction === 'in', 'an inbound mail to a firm alias touches the owner with the sender and the Cc', acmeIn);
ok(acmeIn && acmeIn.deal && acmeIn.deal.id === dealView.id, 'the touch carries the company\'s open deal');
const people = await api.op('network.people', { limit: 50 }, O);
const byEmail = Object.fromEntries(people.people.map((p) => [p.email, p]));
ok(!byEmail['deals@venture.test'] && !byEmail['owner@venture.test'], 'firm addresses never become people');
ok(byEmail['sam.lee@gmail.com'] && byEmail['sam.lee@gmail.com'].company === null, 'a free-mail sender is a person without a company');
ok(byEmail['leo@orbitalfreight.com'] && byEmail['leo@orbitalfreight.com'].company && byEmail['leo@orbitalfreight.com'].company.name.length > 0, 'a work domain makes the company');
ok(!byEmail['mum@family.example'], 'nobody is created from the excluded domain');
ok(byEmail['old@oldco.example'], 'the backfill reached an older message');
const s1b = await api.op('capture.status', {}, O);
eq(s1b.sources.mail_owner.state, 'ok', 'capture.status shows the mailbox as read');
ok(s1b.interactions >= 7, 'and counts the touches', s1b.interactions);

section('the agent cannot read bodies');
const one = await api.op('interactions.list', { person: 'maya@acmerobotics.ai' }, A);
ok(one.interactions.every((i) => i.subject.indexOf('Ignore previous') < 0 && JSON.stringify(i).indexOf('mark this deal invested') < 0), 'only headers are kept (no body text anywhere)');

section('privacy of subjects');
const asPartner = await api.op('interactions.list', { person: 'maya@acmerobotics.ai' }, P);
ok(asPartner.interactions.length > 0 && asPartner.interactions.every((i) => i.subject === '' && i.subject_hidden === true), 'a partner sees the owner\'s touches without their subjects');
const tl = await api.op('records.timeline', { person: 'maya@acmerobotics.ai' }, O);
ok(tl.items.some((i) => i.module === 'network' && i.title.indexOf('Email') === 0 && i.title.indexOf('seed round') > 0), 'the timeline shows the touch with its subject to the owner', tl.items.map((i) => i.title));
const tlP = await api.op('records.timeline', { person: 'maya@acmerobotics.ai' }, P);
ok(tlP.items.some((i) => i.module === 'network') && !tlP.items.some((i) => i.title.indexOf('seed round') > 0), 'and without it to a partner');

section('calendar with consent');
await sleep(31000);
const s2 = await api.op('capture.sync', { what: 'calendar' }, O);
ok(s2.calendar.state === 'ok' && s2.calendar.events >= 6, 'the calendar read again', s2.calendar);
const mt = await api.op('interactions.list', { kind: 'meeting' }, O);
ok(mt.interactions.some((i) => i.subject === 'Acme Robotics intro call' && i.member.name === 'Olivia Owner'), 'a meeting that ended is a touch for the owner');
ok(mt.interactions.some((i) => i.subject === 'Call: Lumen Health' && i.member.name === 'Paul Partner'), 'and for the partner who held it');
ok(!mt.interactions.some((i) => i.subject === 'Vendor pitch'), 'a declined meeting is no touch');
const again = await api.op('interactions.list', {}, O);
await sleep(31000);
await api.op('capture.sync', { what: 'all' }, O);
const again2 = await api.op('interactions.list', {}, O);
eq(again2.total, again.total, 'reading the same mail and meetings again logs nothing twice (ext_id)');

section('strength from the engine');
await api.op('network.recompute', {}, O);
const sm = await api.op('network.strength', { person: 'maya@acmerobotics.ai' }, P);
ok(sm.score >= 60 && sm.band === 'strong' && sm.best_member.name === 'Olivia Owner', 'Maya: an email each way and a meeting make a strong tie to the owner', sm);
const sc = await api.op('network.strength', { company: 'acmerobotics.ai' }, P);
ok(sc.score === sm.score && sc.people_known === 2, 'the company is as strong as its best person; two people known', sc);
const sOld = await api.op('network.strength', { person: 'old@oldco.example' }, P);
ok(sOld.score === 34 && sOld.band === 'good' && sOld.score < sm.score, 'one email received 17 days ago scores 34 (1.5 halved every 60 days), below Maya', sOld);
const cov = await api.op('network.coverage', {}, O);
ok(cov.total === 1 && cov.companies[0].band === 'strong' && cov.groups.pipeline.strong === 1, 'coverage: the pipeline company is strong', cov);
const tbl = await api.op('network.companies', { relation: 'pipeline' }, AN);
ok(tbl.companies.length === 1 && tbl.companies[0].relation === 'pipeline' && tbl.companies[0].owner.name === 'Olivia Owner', 'the companies table: pipeline relation, owner = who knows them best', tbl.companies);
const strongPeople = await api.op('network.people', { band: 'strong' }, AN);
ok(strongPeople.people.every((p) => p.band === 'strong') && strongPeople.total >= 1, 'the people table filters by band');
const rec = await api.op('network.record', { company: acme.id }, O);
ok(rec.score === sc.score && rec.deals === 1 && rec.invested === false && rec.holdings === 0 && rec.next_meeting && rec.next_meeting.title === 'Acme Robotics first meeting', 'network.record: the figure strip of the company page', rec);

section('logging a touch');
const logged = await api.op('interactions.log', { kind: 'call', people: '["sara@foundry-capital.vc"]', subject: 'Catch up' }, P);
ok(logged.logged === true && logged.strength[0].score > 0, 'a partner logs a call; the answer shows the new strength at once', logged);
const dup = await api.op('interactions.log', { kind: 'call', people: '["sara@foundry-capital.vc"]', member: 'partner@venture.test', ext_id: 'call-77' }, P);
const dup2 = await api.op('interactions.log', { kind: 'call', people: '["sara@foundry-capital.vc"]', member: 'partner@venture.test', ext_id: 'call-77' }, P);
ok(dup.logged === true && dup2.duplicate === true, 'the same ext_id counts once');
await refuses(api, 'interactions.log', { kind: 'call', people: '["sara@foundry-capital.vc"]', member: 'analyst@venture.test' }, A, 403, 'no_consent', 'your AI agent logs only for members who opted in');
const ag = await api.op('interactions.log', { kind: 'call', people: '["sara@foundry-capital.vc"]', member: 'partner@venture.test', subject: 'Call Paul mentioned' }, A);
ok(ag.logged === true, 'your AI agent logs a touch for a consenting member');
await refuses(api, 'interactions.log', { kind: 'call', people: '["partner@venture.test"]' }, O, 400, 'invalid_param', 'a touch is with people outside the firm');
await sleep(65000);
const sara = await api.op('network.strength', { person: 'sara@foundry-capital.vc' }, O);
ok(sara.members.some((m) => m.member.name === 'Paul Partner' && m.score > 0), 'the minute job saved the partner\'s edge to Sara', sara.members);

section('the brief your AI agent is asked for');
const evSoon = (await api.op('calendar.list', { day: day(-1), days: 3 }, O)).events.find((e) => e.title === 'Acme Robotics first meeting');
const q0 = await api.op('briefs.get', { event: evSoon.id }, O);
const mb = await firesOf('meeting_brief');
ok(q0.brief.state === 'queued' && q0.brief.ask && q0.brief.ask.pending && mb.some((f) => f.request_id === q0.brief.ask.request), 'the switch asked once for the meeting soon (meeting_brief with its event)', { brief: q0.brief.state, ask: q0.brief.ask, mb });
const start = await api.op('briefs.request', { event: evSoon.id }, A);
const reading = await api.op('briefs.get', { event: evSoon.id }, O);
eq([reading.brief.state, reading.brief.steps.at], ['reading', 1], 'while it works the brief shows Reading');
const job = { payload: { brief: start.brief.id } };
const b = await api.op('briefs.get', { brief: job.payload.brief }, A);
ok(b.brief.attendees.some((a) => a.email === 'maya@acmerobotics.ai' && a.strength && a.strength.band === 'strong'), 'the brief carries the app\'s strength for each attendee', b.brief.attendees);
await refuses(api, 'briefs.save', { brief: job.payload.brief, sections: JSON.stringify({ news: [{ title: 'No link', url: 'not a link' }] }) }, A, 400, 'invalid_param', 'news needs its link');
const saved = await api.op('briefs.save', { brief: job.payload.brief, sections: JSON.stringify({ who: [{ name: 'Maya Chen', email: 'maya@acmerobotics.ai', text: 'CEO of Acme Robotics.' }], history: 'Deck received this week; one intro call.', deal: 'Deal at Sourced.', questions: ['Unit economics per arm?'], news: [{ title: 'Acme opens Rotterdam pilot', url: 'https://example.com/acme', day: '2026-11-01', source: 'Example News' }] }) }, A);
eq([saved.brief.state, saved.brief.agent], ['ready', true], 'your AI agent wrote it');
const sa = (await api.op('briefs.get', { event: evSoon.id }, O)).brief.ask;
ok(sa && !sa.pending && sa.done_at !== '', 'the save landed the ask', sa);
const ready = await api.op('calendar.list', { day: day(-1), days: 3 }, O);
eq(ready.events.find((e) => e.id === evSoon.id).brief.state, 'ready', 'Today shows the brief as ready');
const req = await api.op('briefs.request', { event: evSoon.id }, P);
eq([req.queued, req.brief.state], [false, 'ready'], 'asking again answers the ready brief (no new fire)');
const kite = ready.events.find((e) => e.title === 'KitePay catch-up');
const r2 = await api.op('briefs.request', { event: kite.id }, O);
eq([r2.queued, r2.brief.state], [true, 'queued'], 'a brief on request is asked at once');
ok(r2.request !== '' && (await firesOf('meeting_brief')).some((f) => f.request_id === r2.request), 'one fire of meeting_brief for that meeting', r2);
await refuses(api, 'briefs.request', { event: kite.id }, P, 404, 'not_found', 'a partner cannot ask about a meeting they do not attend');
const byHand = await api.op('briefs.save', { event: kite.id, sections: JSON.stringify({ history: 'Met at a conference.' }) }, O);
eq([byHand.brief.state, byHand.brief.agent], ['ready', false], 'a person can write the brief by hand');
const ha = (await api.op('briefs.get', { event: kite.id }, O)).brief.ask;
ok(ha && !ha.pending && ha.done_at !== '', 'and the ask is answered', ha);

section('meeting ended: the note item');
const nxO = await api.op('next.list', { kinds: 'note' }, O);
const noteO = nxO.items.find((i) => i.title === 'Acme Robotics intro call');
const noteK = nxO.items.find((i) => i.title === 'KitePay intro');
ok(noteO && noteO.actions.length === 2 && noteO.actions[0].op === 'calendar.add-note' && noteO.actions[1].label === 'No note', 'the owner has a note item for the Acme call with Add note and No note', nxO.items);
ok(noteK, 'and one for the KitePay call');
ok(!nxO.items.some((i) => JSON.stringify(i).indexOf('Vendor pitch') >= 0), 'not for the meeting the owner declined');
const nxP = await api.op('next.list', { kinds: 'note' }, P);
const noteP = nxP.items.find((i) => i.data && i.data.title === 'Call: Lumen Health');
ok(noteP, 'the partner has one for the Lumen call', nxP.items);
const nxAN = await api.op('next.list', { kinds: 'note' }, AN);
eq(nxAN.items.length, 0, 'the analyst attended nothing');
// The call ended before the deal opened, so deals made no draft at meeting.ended: open the meeting's note (empty).
const made = await api.op('notes.create', { deal: dealView.id, cal_event: noteO.data.event }, O);
const draft = made.note;
const nxO1 = await api.op('next.list', { kinds: 'note' }, O);
ok(draft && draft.empty === true && nxO1.items.some((i) => i.key === noteO.key), 'an empty draft note for the meeting leaves the item in Next', draft);
const key = draft.template.sections[0].key;
await api.op('notes.update', { note: draft.id, sections: JSON.stringify({ [key]: 'Met Maya; pilots in Rotterdam.' }), save: true }, O);
const nxO2 = await api.op('next.list', { kinds: 'note' }, O);
ok(!nxO2.items.some((i) => i.key === noteO.key), 'a written note for the meeting clears the item (deals forDeal)');
const add = await api.op('calendar.add-note', { event: noteO.data.event }, O);
ok(add.href === '#/deals/' + dealView.number + '?tab=notes&event=' + noteO.data.event, 'Add note answers the deal note editor link', add);
await api.op('calendar.skip-note', { event: noteK.data.event }, O);
const nxO3 = await api.op('next.list', { kinds: 'note' }, O);
ok(!nxO3.items.some((i) => i.key === noteK.key), 'No note clears the KitePay item');
const addP = await api.op('calendar.add-note', { event: noteP.data.event }, P);
ok(/^#\/companies\/[a-z0-9]{15}\?tab=notes&event=/.test(addP.href), 'without a deal, Add note answers the company note editor link', addP);
const nxP2 = await api.op('next.list', { kinds: 'note' }, P);
ok(!nxP2.items.some((i) => i.key === noteP.key), 'and the partner item goes');
await refuses(api, 'calendar.skip-note', { event: noteP.data.event }, AN, 404, 'not_found', 'nobody else can touch a meeting they did not attend');

section('briefs of a deal');
const bd = await api.op('briefs.list', { deal: dealView.number }, O);
ok(bd.briefs.length === 1 && bd.briefs[0].event.title === 'Acme Robotics first meeting' && bd.briefs[0].state === 'ready', 'briefs.list --deal answers the deal briefs, latest first', bd.briefs);
const bc = await api.op('briefs.list', { company: 'acmerobotics.ai' }, P);
ok(bc.briefs.length === 1, 'and --company the company briefs');

section('the bridge offline and the 200-with-error shape');
await bridge.mode('search_gmail', 'offline');
await sleep(31000);
await api.op('capture.sync', { what: 'mail' }, O);
const st3 = await api.op('capture.status', {}, O);
eq([st3.gmail, st3.sources.mail_owner.state], ['offline', 'offline'], 'offline: Settings says Connect Gmail in CraftBot');
await bridge.mode('search_gmail', 'ok');
await bridge.mode('list_google_calendar_events', 'error', 'Failed to list events: quota');
await sleep(31000);
await api.op('capture.sync', { what: 'calendar' }, O);
const st4 = await api.op('capture.status', {}, O);
ok(st4.sources.calendar.state === 'error' && st4.sources.calendar.error.indexOf('quota') >= 0, 'a provider failure inside HTTP 200 is an error with its message', st4.sources.calendar);
await bridge.mode('list_google_calendar_events', 'ok');

section('consent off stops capture');
await api.op('capture.consent', { consent: false }, O);
await api.op('capture.consent', { consent: false }, P);
const before = (await api.op('interactions.list', {}, O)).total;
await sleep(31000);
const s5 = await api.op('capture.sync', { what: 'mail' }, O);
eq(s5.mail[0].state, 'skipped', 'with nobody opted in the mailbox is not read');
eq((await api.op('interactions.list', {}, O)).total, before, 'and nothing new is logged');

const s = summary('t02_capture');
process.exitCode = s.failed > 0 ? 1 : 0;
