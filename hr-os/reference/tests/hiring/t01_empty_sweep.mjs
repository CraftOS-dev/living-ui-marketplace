// Empty database: every hiring read op answers without a server error as nobody,
// the owner, a recruiter, a manager, an employee and your AI agent; every
// hiring write with no or sample params answers 4xx (never 5xx); hiring
// home and settings are usable before any data exists.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, DEMO, eq, fresh, member, newApi, ok, sample, section, summary } from './lib.mjs';

fresh();
const api = newApi();
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
// Hiring's own ops (each module sweeps its own; all of them together outgrow a test run).
const HIRING = /^(hiring|staffing-plans|requisitions|openings|interview-kits|candidates|applications|interviews|scorecards|offers|offer-terms|offer-templates|rejection-reasons|referrals)\./;
const reads = manifest.operations.filter((o) => !o.system && o.executor.method === 'GET' && HIRING.test(o.name));
const hiringWrites = manifest.operations.filter((o) => !o.system && o.executor.method === 'POST' && HIRING.test(o.name));

async function sweep(list, as, ctx, label, withParams) {
  const statuses = {};
  const bad = [];
  for (const o of list) {
    const params = {};
    if (withParams) for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k, ctx);
    const r = await api.call(o.name, params, { as, pin: o.params && o.params.pin ? true : undefined });
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, label + ': ' + list.length + ' ops, no 5xx ' + JSON.stringify(statuses), bad);
  return statuses;
}

section('before setup');
await sweep(reads, 'anon', {}, 'reads, nobody signed in', true);

section('setup and members');
await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Owner One', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
await member(api, 'rec@northwind.test', 'Rae Recruiter', 'recruiter');
await member(api, 'mgr@northwind.test', 'Max Manager', 'manager');
await member(api, 'emp@northwind.test', 'Erin Employee', 'employee');

section('empty reads');
for (const who of ['owner', 'rec@northwind.test', 'mgr@northwind.test', 'emp@northwind.test', 'agent']) await sweep(reads, who, {}, 'reads as ' + who, true);
const home = await api.op('hiring.home', {}, { as: 'owner' });
eq([home.openings.length, home.interviews_today.length, home.feedback_owed.length, home.offers_waiting.length], [0, 0, 0, 0], 'hiring home is empty and answers');
eq(home.can.full, true, 'the owner may run hiring');
const empHome = await api.op('hiring.home', {}, { as: 'emp@northwind.test' });
eq([empHome.level, empHome.openings.length], ['none', 0], 'an employee gets an empty home, not an error');
const st = await api.op('hiring.settings', {}, { as: 'rec@northwind.test' });
eq(st.default_stages.map((s) => s.kind), ['applied', 'screen', 'interview', 'offer', 'hired'], 'default stages seeded');
ok(st.rejection_reasons.length >= 5 && st.offer_terms.length >= 3 && st.offer_templates.length === 1, 'reasons, terms and a letter template seeded');
ok(st.retention.countries.some((c) => c.country === 'US' && c.days === 365 && c.basis.indexOf('1602.14') > 0), 'retention suggestions carry their basis');
eq(st.calendar.connected, false, 'outside CraftBot Google Calendar is not offered');
const kits = await api.op('interview-kits.list', {}, { as: 'rec@northwind.test' });
eq(kits.kits.length, 2, 'two starter interview kits');
const roles = await api.op('openings.open-roles', {}, { as: 'emp@northwind.test' });
eq(roles.openings.length, 0, 'no open roles yet');
const refs = await api.op('referrals.mine', {}, { as: 'emp@northwind.test' });
eq(refs.referrals.length, 0, 'no referrals yet');
const owed = await api.op('scorecards.mine', {}, { as: 'emp@northwind.test' });
eq(owed.owed.length, 0, 'nothing owed');

section('empty writes answer 4xx');
for (const who of ['owner', 'rec@northwind.test', 'mgr@northwind.test', 'emp@northwind.test', 'agent']) {
  await sweep(hiringWrites, who, {}, 'hiring writes with no params as ' + who, false);
  await sweep(hiringWrites, who, {}, 'hiring writes with sample params as ' + who, true);
}

const s = summary('t01_empty_sweep');
process.exitCode = s.failed > 0 ? 1 : 0;
