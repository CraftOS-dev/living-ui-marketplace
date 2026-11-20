// Seeded: structured facts on approvals, notifications and search results;
// pack names in setup.countries; pin.verify answers 200 on a wrong PIN.
import { eq, fresh, newApi, ok, refuses, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const O = { as: 'owner' };
const PAY = { as: 'payroll@northwind.test' };

section('facts');
const appr = (await api.op('approvals.list', {}, PAY)).approvals.find((a) => a.kind === 'bank_account');
ok(appr && Array.isArray(appr.facts) && appr.facts.some((f) => f.type === 'text' && f.key === 'account' && /•/.test(f.value)), 'a bank approval carries facts (account, bank, person)', appr && appr.facts);
const t = await api.op('testkit.open', { employment: 'E0005', summary: 'Money test', amount_minor: 125050, currency: 'SGD' }, { as: 'sam@northwind.test' });
ok(t.approval.facts.some((f) => f.type === 'money' && f.amount_minor === 125050 && f.currency === 'SGD'), 'an amount without facts becomes a money fact', t.approval.facts);
const mgrNotes = await api.op('notifications.list', {}, { as: 'eng.lead@northwind.test' });
const n = mgrNotes.notifications.find((x) => x.link === '#/inbox/approvals/' + t.approval.id);
ok(n && n.facts.some((f) => f.type === 'money' && f.amount_minor === 125050), 'the approver notification carries the facts too', n);
await api.op('approvals.decide', { approval: t.approval.id, decision: 'approved' }, { as: 'eng.lead@northwind.test' });
const samNotes = await api.op('notifications.list', {}, { as: 'sam@northwind.test' });
const d = samNotes.notifications.find((x) => x.link === '#/inbox/requests/' + t.approval.id);
ok(d && d.facts.some((f) => f.type === 'state' && f.value === 'approved'), 'the decision notification carries the state', d);
const s = await api.op('search.query', { q: 'Sam' }, O);
const sp = s.results.find((r) => r.group === 'people');
ok(sp && sp.facts.some((f) => f.key === 'number' && /^E\d{4}$/.test(f.value)) && typeof sp.subtitle === 'string', 'search results carry facts (and a plain subtitle)', sp);

section('pack names');
const cs = (await api.op('setup.countries')).countries;
const us = cs.find((c) => c.code === 'US');
ok(us && us.pack_names['us-federal'] && us.pack_names['us-federal'] !== 'us-federal' && us.pack_names['us-ca'], 'setup.countries names the packs (country and region packs)', us && us.pack_names);

section('pin.verify');
const good = await api.op('pin.verify', { pin: '123456' }, PAY);
eq(good.ok, true, 'the right PIN answers ok');
const bad = await api.call('pin.verify', { pin: '000001' }, PAY);
ok(bad.status === 200 && bad.body.ok === false && bad.body.code === 'wrong_pin' && bad.body.attempts_left === 4, 'a wrong PIN answers 200 { ok: false, code: wrong_pin, attempts_left }', bad);
await refuses(api, 'members.invite', { email: 'q@x.test', name: 'Q', role: 'employee', pin: '000002' }, O, 403, 'wrong_pin', 'confirm ops still answer 403 on a wrong PIN');
await refuses(api, 'pin.verify', { pin: '123456' }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent has no PIN to verify');

const r = summary('t09_facts_pin');
process.exitCode = r.failed > 0 ? 1 : 0;
