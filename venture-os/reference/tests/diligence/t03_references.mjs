// References: candidates from the firm's records (shared past companies), Suggest names (trigger refs_suggest) worked by
// your AI agent through ops, logging a suggested name and a new call, dismiss, counts by kind and signal, merges, refusals.
import { fresh, newApi, team, seedDeals, section, ok, eq, refuses, summary, PARTNER, PARTNER2, VP } from './lib.mjs';

fresh();
const api = newApi();
await team(api);
const S = await seedDeals(api);
const P = { as: PARTNER };
const A = { as: 'agent' };
const acme = S.deals.acme;
const lumen = S.deals.lumen;

section('empty list');
let l = await api.op('refs.list', { deal: acme.number }, P);
ok(l.references.length === 0 && l.ask === null, 'no references, nothing asked');
eq(l.counts.by_kind, { provided: 0, backchannel: 0, customer: 0, expert: 0 }, 'counts by kind start at zero');

section('candidates from shared past companies');
const c = await api.op('refs.candidates', { deal: acme.number }, P);
eq(c.founders.map((f) => f.name).sort(), ['Ada Founder', 'Dan Chen'], 'the founders on record');
eq(c.candidates.map((x) => x.person.name), ['Bea Colleague', 'Dee Unknown', 'Cy Later'], 'overlapping years first, unknown dates next, no overlap last');
ok(c.candidates[0].company.name === 'Kiva Systems' && c.candidates[0].overlap_days > 1000, 'Bea worked with Ada at Kiva Systems for years', c.candidates[0]);
ok(c.candidates[1].overlap_days === null && c.candidates[2].overlap_days === 0, 'unknown overlap is null, none is 0');
const none = await api.op('refs.candidates', { deal: lumen.number }, { as: PARTNER2 });
ok(none.candidates.length === 0 && none.note, 'a deal without founders says so');

section('Suggest names: trigger refs_suggest');
const ask = await api.op('refs.ask', { deal: acme.number }, P);
ok(ask.request !== '' && ask.step.trigger === 'refs_suggest' && ask.step.labels.join() === 'Queued,Searching,Ready' && ask.step.at === 0 && ask.step.open, 'one fire, followed with a StepTrack', ask.step);
await refuses(api, 'refs.ask', { deal: acme.number }, P, 409, 'pending', 'asking again while it waits is refused');
l = await api.op('refs.list', { deal: acme.number }, P);
ok(l.ask.open && l.ask.request === ask.request, 'the list shows the ask it waits for', l.ask);
await refuses(api, 'refs.suggest', { deal: acme.number, suggestions: JSON.stringify([{ person: S.people.ada.id, why: 'x' }]) }, A, 400, undefined, 'a founder is not a reference');
await refuses(api, 'refs.suggest', { deal: acme.number, suggestions: JSON.stringify([{ person: 'nobody@nowhere.test' }]) }, A, 404, undefined, 'only people in the records');
await refuses(api, 'refs.suggest', { deal: acme.number, suggestions: JSON.stringify([{ person: S.people.bea.id, founder: S.people.bea.id }]) }, A, 400, undefined, 'founder must be a founder of the deal');
const sg = await api.op('refs.suggest', { deal: acme.number, suggestions: JSON.stringify([{ person: S.people.bea.id, founder: S.people.ada.id, company: S.companies.kiva.id, why: 'Both at Kiva Systems 2017 to 2020' }, { person: 'dee@example.com', founder: S.people.dan.id, company: 'stripe.com', why: 'Both at Stripe' }]) }, A);
ok(sg.added === 2 && sg.references.every((r) => r.status === 'suggested' && r.kind === 'backchannel' && r.actor === 'agent'), 'two suggested names', sg);
const again = await api.op('refs.suggest', { deal: acme.number, suggestions: JSON.stringify([{ person: S.people.bea.id, why: 'again' }]) }, A);
ok(again.added === 0 && again.kept === 1, 'a name already listed is kept, not doubled');
l = await api.op('refs.list', { deal: acme.number }, P);
ok(l.ask.at === 2 && !l.ask.open && l.counts.suggested === 2, 'Ready with two names', l.ask);
const bea = l.references.find((r) => r.name === 'Bea Colleague');
ok(bea.why.text === 'Both at Kiva Systems 2017 to 2020' && bea.company.name === 'Kiva Systems' && bea.founder.name === 'Ada Founder', 'the reason, shared company and founder travel with the name', bea);
const cand2 = await api.op('refs.candidates', { deal: acme.number }, P);
eq(cand2.candidates.map((x) => x.person.name), ['Cy Later'], 'listed names leave the candidates');

section('logging calls');
await refuses(api, 'refs.log', { reference: bea.id, kind: 'backchannel' }, P, 400, 'missing_param', 'a signal is required');
await refuses(api, 'refs.log', { reference: bea.id, kind: 'backchannel', signal: 'great' }, P, 400, 'invalid_param', 'signal is a chip value');
const lg = await api.op('refs.log', { reference: bea.id, signal: 'positive', note: 'Ran ops with Ada for 3 years; would back her again.' }, P);
ok(lg.reference.status === 'logged' && lg.reference.kind === 'backchannel' && lg.reference.called_by.name === 'Paula Partner' && /^\d{4}-\d{2}-\d{2}$/.test(lg.reference.day), 'a suggested name becomes a logged call (kind kept, today, by me)', lg.reference);
const nw = await api.op('refs.log', { deal: acme.number, name: 'Grace Customer', kind: 'customer', signal: 'neutral', note: 'Pilot went fine' }, P);
ok(nw.reference.name === 'Grace Customer' && nw.reference.person === null, 'a call with someone outside the records');
const pv = await api.op('refs.log', { deal: acme.number, person: 'cy@example.net', kind: 'provided', signal: 'negative', day: '2026-11-01' }, P);
ok(pv.reference.person.name === 'Cy Later' && pv.reference.day === '2026-11-01', 'a call with a person on record, on a given day');
const fromNote = await api.op('refs.log', { deal: acme.number, name: 'Hal Expert', kind: 'expert', signal: 'positive', note: 'From the partner meeting note' }, A);
ok(fromNote.reference.actor === 'agent' && fromNote.reference.called_by === null, 'your AI agent logs a call a person described in a note');
await refuses(api, 'refs.log', { deal: acme.number, name: 'x', kind: 'expert', signal: 'positive' }, { as: VP }, 403, 'not_permitted', 'a venture partner cannot log');
l = await api.op('refs.list', { deal: acme.number }, P);
eq(l.counts.by_kind, { provided: 1, backchannel: 1, customer: 1, expert: 1 }, 'counts by kind');
eq(l.counts.by_signal, { positive: 2, neutral: 1, negative: 1 }, 'counts by signal');
ok(l.references[l.references.length - 1].status === 'suggested', 'logged calls first, suggested names after');

section('dismiss');
const dee = l.references.find((r) => r.name === 'Dee Unknown');
await refuses(api, 'refs.dismiss', { reference: dee.id }, A, 403, 'agent_not_permitted', 'people only');
await api.op('refs.dismiss', { reference: dee.id }, P);
l = await api.op('refs.list', { deal: acme.number }, P);
ok(!l.references.some((r) => r.id === dee.id) && l.counts.suggested === 0, 'a dismissed name leaves the list');
await refuses(api, 'refs.dismiss', { reference: bea.id }, P, 409, 'conflict', 'a logged call is not dismissed');

section('timeline and merges');
const tl = await api.op('records.timeline', { deal: acme.number }, P);
ok(tl.items.filter((i) => i.module === 'diligence' && i.kind === 'reference').length === 4, 'logged calls are on the deal timeline', tl.items.map((i) => i.title));
const dup = (await api.op('people.upsert', { email: 'bea.c@kiva.example', name: 'Bea C' }, { as: 'owner' })).person;
await api.op('refs.log', { deal: acme.number, person: dup.id, kind: 'backchannel', signal: 'positive' }, P);
await api.op('people.merge', { keep: S.people.bea.id, drop: dup.id }, { as: 'owner' });
l = await api.op('refs.list', { deal: acme.number }, P);
ok(l.references.filter((r) => r.person && r.person.id === S.people.bea.id).length === 2 && !l.references.some((r) => r.person && r.person.id === dup.id), 'a merge moves references to the person kept');

summary('t03 references');
