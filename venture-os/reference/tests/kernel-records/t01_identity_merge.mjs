// Identity rules, provenance and your AI agent's fill-or-propose rule, merges and their undo.
import { newApi, fresh, setupFirm, section, ok, eq, refuses, summary, PEOPLE } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };

section('same email twice is one person');
const p1 = (await api.op('people.upsert', { email: 'Jane@Acme.com', name: 'Jane Doe', title: 'CEO' }, O)).person;
ok(p1.created === true, 'first upsert creates');
eq(p1.email, 'jane@acme.com', 'email kept lower case');
const p2 = (await api.op('people.upsert', { email: '  JANE@acme.com ' }, O)).person;
ok(p2.created === false && p2.id === p1.id, 'second upsert with the same email finds the same person');
const got = (await api.op('people.get', { person: 'jane@ACME.com' }, O)).person;
eq(got.id, p1.id, 'people.get resolves by email');
eq((await api.op('people.get', { person: 'jane DOE' }, O)).person.id, p1.id, 'and by its exact name when only one person has it');

section('same root domain is one company');
const c1 = (await api.op('companies.upsert', { domain: 'https://www.acme.com/about', name: 'Acme Robotics' }, O)).company;
eq(c1.domain, 'acme.com', 'domain reduced to the root');
const c2 = (await api.op('companies.upsert', { domain: 'mail.eu.acme.com' }, O)).company;
ok(c2.id === c1.id && c2.created === false, 'a subdomain finds the same company');
eq(p1.company && p1.company.id, c1.id, 'the work email named the company');
const p3 = (await api.op('people.upsert', { email: 'bob@eu.acme.com', name: 'Bob' }, O)).person;
eq(p3.company && p3.company.id, c1.id, 'an email on a subdomain names the same company');
const uk = (await api.op('companies.upsert', { domain: 'acme.co.uk' }, O)).company;
ok(uk.id !== c1.id && uk.domain === 'acme.co.uk', 'acme.co.uk (second-level suffix) is another company');
eq(uk.name, 'Acme', 'a company created from a domain is named from it');

section('free mail never makes a company');
const g = (await api.op('people.upsert', { email: 'john.smith@gmail.com' }, O)).person;
ok(g.company === null, 'a gmail person has no company');
eq(g.name, 'John Smith', 'the name comes from the email when none is given');
await refuses(api, 'companies.upsert', { domain: 'gmail.com' }, O, 400, 'free_mail_domain', 'a company from gmail.com is refused');
const solo = (await api.op('companies.upsert', { name: 'Solo Labs', domain: 'outlook.com' }, O)).company;
ok(solo.created && solo.domain === '', 'a named company keeps no free-mail domain');
await refuses(api, 'people.upsert', { person: p3.id, email: 'jane@acme.com' }, O, 409, 'duplicate', 'an email of another person is refused');

section('name matching');
await api.op('companies.upsert', { name: 'Twin Co' }, O);
await api.op('companies.upsert', { name: 'Twin Co Ltd', domain: 'twin2.com' }, O);
const tw = await api.call('companies.upsert', { name: 'Twin Co', description: 'x' }, O);
ok(tw.status === 200, 'a lone exact name match updates the company (the other has a domain and another legal suffix only)', tw.body);

section('your AI agent fills empty fields, proposes changes to a person\'s values');
const sam = (await api.op('people.upsert', { email: 'sam@beta.io', name: 'Sam Lee', title: 'CTO' }, O)).person;
const ag = (await api.op('people.upsert', { email: 'sam@beta.io', title: 'CEO', location: 'Berlin', source_ref: 'https://beta.io/team' }, A)).person;
ok(ag.changed.indexOf('location') >= 0, 'the empty location was filled');
ok(ag.proposal !== null && ag.proposal.fields.indexOf('title') >= 0, 'the title a person entered became a proposal');
eq(ag.title, 'CTO', 'the title is unchanged');
// Answers to your AI agent leave provenance out (qa-cli RULING CLI-09); a person's read shows it.
const agProv = (await api.op('people.get', { person: sam.id }, O)).person.prov;
eq(agProv.location.by, 'agent', 'prov says your AI agent filled location');
eq(agProv.location.source, 'https://beta.io/team', 'prov keeps the source');
ok(ag.prov === undefined, 'the answer to your AI agent leaves prov out');
const props = await api.op('proposals.list', { status: 'pending' }, O);
const prop = props.proposals.filter((x) => x.id === ag.proposal.id)[0];
ok(prop && prop.kind === 'note_fields' && prop.items[0].op === 'people.update', 'the proposal is a people.update of kind note_fields', prop);
const fld = prop ? prop.items[0].fields.filter((f) => f.name === 'title')[0] : null;
ok(fld && fld.before === 'CTO' && fld.after === 'CEO', 'the proposal shows before and after', fld);
const acc = await api.op('proposals.accept', { proposal: ag.proposal.id }, O);
eq(acc.applied, 1, 'a person accepts it');
const sam2 = (await api.op('people.get', { person: sam.id }, O)).person;
eq(sam2.title, 'CEO', 'the title changed once accepted');
eq(sam2.prov.title.by, 'person', 'the accepted value is the person\'s');
const own = (await api.op('people.upsert', { email: 'sam@beta.io', location: 'Munich', source_ref: 'https://beta.io' }, A)).person;
ok(own.location === 'Munich' && own.proposal === null, 'your AI agent may change a value it wrote itself');
const add = (await api.op('people.upsert', { person: sam.id, email: 'sam.lee@beta.io', source_ref: 'signature' }, A)).person;
ok(add.email === 'sam@beta.io' && add.emails.indexOf('sam.lee@beta.io') >= 0 && add.proposal === null, 'a second email is added, the primary stays');
const direct = await api.call('people.update', { person: sam.id, title: 'CFO', why: 'deck' }, A);
ok(direct.status === 200 && direct.body.proposed === true, 'people.update from your AI agent is a proposal', direct.body);

section('records.enrich');
await refuses(api, 'records.enrich', { company: 'acme.com', fields: { sector: 'robotics' } }, A, 400, 'missing_param', 'your AI agent must give source_ref');
await api.op('companies.update', { company: 'acme.com', description: 'Warehouse robots' }, O);
const en = (await api.op('records.enrich', { company: 'acme.com', fields: { sector: 'robotics', description: 'Robots for warehouses', founded_year: 2021 }, source_ref: 'https://acme.com' }, A)).company;
ok(en.sector === 'robotics' && en.founded_year === 2021, 'empty fields filled');
ok(en.description === 'Warehouse robots' && en.proposal !== null, 'a person\'s description is kept and the change proposed');
const keep = (await api.op('records.enrich', { company: 'acme.com', fields: { description: 'Other' } }, O)).company;
ok(keep.kept.indexOf('description') >= 0 && keep.description === 'Warehouse robots', 'enrich by a person keeps filled fields');
await refuses(api, 'records.enrich', { company: 'acme.com', fields: { colour: 'red' }, source_ref: 'x' }, A, 400, 'unknown_key', 'an unknown field is named');
await refuses(api, 'people.delete', { person: sam.id }, A, 403, 'agent_not_permitted', 'deleting a person is people only');

section('merge and undo as one unit');
const keepCo = (await api.op('companies.upsert', { name: 'Gamma', domain: 'gamma.ai' }, O)).company;
const dropCo = (await api.op('companies.upsert', { name: 'Gamma AI', domain: 'gammaai.com', sector: 'ai' }, O)).company;
const gp = (await api.op('people.upsert', { email: 'eve@gammaai.com', name: 'Eve' }, O)).person;
eq(gp.company.id, dropCo.id, 'a person at the second record');
const gd = (await api.op('deals.create', { company: dropCo.id }, O)).deal;
const pm = await api.call('companies.merge', { keep: keepCo.id, drop: dropCo.id, why: 'same company' }, A);
ok(pm.status === 200 && pm.body.proposed === true, 'a merge from your AI agent is a proposal', pm.body);
await api.op('testkit.events', { clear: true }, O);
const mg = await api.op('companies.merge', { keep: keepCo.id, drop: dropCo.id }, O);
ok(mg.kept.domains.indexOf('gammaai.com') >= 0 && mg.kept.sector === 'ai', 'domains combined, empty sector filled');
ok(typeof mg._activity === 'string' && mg._activity !== '', 'the merge is one activity unit');
eq((await api.op('people.get', { person: gp.id }, O)).person.company.id, keepCo.id, 'the person moved to the kept company');
eq((await api.op('deals.get', { deal: gd.number }, O)).deal.company.id, keepCo.id, 'the deal moved');
eq((await api.op('companies.get', { company: dropCo.id }, O)).company.id, keepCo.id, 'the dropped id resolves to the kept company');
eq((await api.op('companies.get', { company: 'gammaai.com' }, O)).company.id, keepCo.id, 'the dropped domain resolves to the kept company');
const ev = (await api.op('testkit.events', {}, O)).events.filter((e) => e.name === 'record.merged');
ok(ev.length === 1 && ev[0].payload.keep === keepCo.id && ev[0].payload.drop === dropCo.id, 'record.merged emitted', ev);
const und = await api.call('activity.undo', { entry: mg._activity }, O);
ok(und.status === 200, 'activity.undo of the merge', und.body);
const back = (await api.op('companies.get', { company: dropCo.id }, O)).company;
ok(back.id === dropCo.id && back.merged_into === '' && back.domain === 'gammaai.com', 'the dropped company is back with its domain', back);
eq((await api.op('people.get', { person: gp.id }, O)).person.company.id, dropCo.id, 'the person is back at it');
eq((await api.op('deals.get', { deal: gd.number }, O)).deal.company.id, dropCo.id, 'the deal is back');
eq((await api.op('companies.get', { company: keepCo.id }, O)).company.domains, ['gamma.ai'], 'the kept company lost the merged domain');

section('dupes');
await api.op('companies.upsert', { name: 'Delta', domain: 'delta.io' }, O);
await api.op('companies.upsert', { name: 'Delta Inc', domain: 'delta.co' }, O);
const bare = (await api.op('companies.upsert', { name: 'Delta Inc.', domain: 'delta.net' }, O)).company;
ok(bare.created === true, 'a same-name company with another domain is a new record');
await api.op('people.upsert', { email: 'max@one.com', name: 'Max Muster' }, O);
await api.op('people.upsert', { email: 'max@two.com', name: 'Max Muster' }, O);
const pd = await api.op('records.dupes', { kind: 'person' }, O);
await refuses(api, 'people.get', { person: 'Max Muster' }, O, 409, 'ambiguous', 'a name two people share asks for the email');
ok(pd.groups.some((x) => x.records.length === 2 && x.records[0].name === 'Max Muster'), 'two people with the same name are likely duplicates');
const du = await api.op('records.dupes', { kind: 'company' }, O);
const grp = du.groups.filter((x) => x.records.some((r) => r.name === 'Delta'))[0];
ok(grp && grp.pairs.length === 3, 'Delta, Delta Inc and Delta Inc. are likely duplicates (three pairs)', grp);
await api.op('records.ignore-dupe', { kind: 'company', a: grp.pairs[0][0], b: grp.pairs[0][1] }, O);
const du2 = await api.op('records.dupes', { kind: 'company' }, O);
const grp2 = du2.groups.filter((x) => x.records.some((r) => r.name === 'Delta'))[0];
ok(grp2 && grp2.pairs.length === 2, 'an ignored pair is not listed again', grp2);

section('rights');
await refuses(api, 'people.upsert', { email: 'x@y.com' }, { as: PEOPLE.finance }, 403, 'not_permitted', 'finance cannot edit people');
const fl = await api.call('people.list', {}, { as: PEOPLE.analyst });
ok(fl.status === 200 && fl.body.total >= 4, 'an analyst lists people (network view)');
await refuses(api, 'people.upsert', { email: 'x@y.com' }, { as: PEOPLE.analyst }, 403, 'not_permitted', 'an analyst cannot edit people');

summary('t01 identity and merges');
