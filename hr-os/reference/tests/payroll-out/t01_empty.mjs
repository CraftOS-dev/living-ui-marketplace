// Empty database: every payroll-out read answers without a server error as the
// owner, an employee and your AI agent; the cron jobs run on nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, DEMO, fresh, newApi, ok, refuses, section, summary, eq } from './lib.mjs';

fresh();
const api = newApi();
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const MINE = /^(payout|bankfiles|journal|filings|yearend|payreports|packs)\./;
const reads = manifest.operations.filter((o) => MINE.test(o.name) && o.executor.method === 'GET');
const SAMPLE = { payrun: 'PR-0001', entity: 'Empty Co', filing: 'nope00000000000', bank_file: 'nope00000000000', journal: 'nope00000000000', doc: 'sg_ir8a', pack: 'generic', id: 'nope00000000000' };

async function sweep(as, label) {
  const statuses = {};
  const bad = [];
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = SAMPLE[k] ?? 'x';
    const r = await api.call(o.name, params, { as });
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status >= 500) bad.push(o.name + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  }
  ok(bad.length === 0, label + ': ' + reads.length + ' reads, no 5xx ' + JSON.stringify(statuses), bad);
}

section('setup');
await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Owner One', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
ok(true, 'company set up');

section('empty sweeps');
await sweep('owner', 'owner');
const inv = await api.op('members.invite', { email: 'emp@northwind.test', name: 'Erin Employee', role: 'employee' }, { as: 'owner', pin: true });
const joined = await api.op('auth.accept-invite', { email: 'emp@northwind.test', code: inv.code, password: DEMO.password });
api.setToken('emp@northwind.test', joined.token);
await sweep('emp@northwind.test', 'employee');
await sweep('agent', 'your AI agent');

section('empty answers');
const ov = await api.op('payout.overview', {}, { as: 'owner' });
eq(ov.runs.length, 0, 'no runs to pay out');
const fl = await api.op('filings.list', { show: 'all' }, { as: 'owner' });
ok(fl.filings.length > 0, 'the ledger exists without filings.generate (built when the entity was created): ' + fl.filings.length + ' rows');
ok(fl.filings.some((f) => f.kind === 'sg_cpf' && f.period === fl.today.slice(0, 7)), 'this month\'s CPF row is there');
const prev = new Date(Date.parse(fl.today + 'T00:00:00Z') - 25 * 86400000).toISOString().slice(0, 7);
const cpfPrev = fl.filings.find((f) => f.kind === 'sg_cpf' && f.period === prev);
ok(cpfPrev === undefined, 'a company set up today with nobody is not told to file last month\'s CPF', cpfPrev);
const gen = await api.op('filings.generate', {}, { as: 'owner' });
eq(gen.created, 0, 'generating again adds nothing (idempotent)');
const due = await api.op('filings.list', { show: 'due' }, { as: 'owner' });
eq(due.days, 30, 'the due list defaults to 30 days');
const fl2 = await api.op('filings.list', { show: 'all' }, { as: 'owner' });
ok(fl2.filings.every((f) => f.amount_minor === 0), 'amounts are 0 without locked runs');
const ye = await api.op('yearend.overview', {}, { as: 'owner' });
ok(ye.documents.every((d) => d.people === 0), 'year-end documents with nobody');
const doc = await api.op('yearend.document', { entity: 'Empty Co', doc: 'sg_ir8a' }, { as: 'owner' });
eq(doc.rows.length, 0, 'IR8A empty');
const mine = await api.op('yearend.mine', {}, { as: 'emp@northwind.test' });
eq(mine.documents.length, 0, 'employee has no documents');
const st = await api.op('payout.settings', { entity: 'Empty Co' }, { as: 'owner' });
eq(st.settings.bank_format, 'sg_giro_csv', 'Singapore defaults to the GIRO CSV');
const packs = await api.op('packs.list', {}, { as: 'owner' });
ok(packs.packs.length > 20, 'rule packs listed (' + packs.packs.length + ')');
for (const n of ['payreports.cost', 'payreports.remittance', 'payreports.headcount']) {
  const r = await api.op(n, {}, { as: 'owner' });
  ok(r !== null, n + ' answers on nothing');
}

section('cron on an empty database');
const r1 = await api.call('filings.generate', { year: 2027 }, { as: 'owner' });
eq(r1.status, 200, 'next year generates without runs');
const inUse = (await api.op('packs.list', {}, { as: 'owner' })).packs.filter((p) => p.status === 'active' && p.in_use > 0);
const chk = await api.op('packs.check-updates', { pack: inUse[0].id }, { as: 'owner' });
ok(chk.asked === true && chk.agent.trigger === 'pack_update_draft' && chk.agent.record === inUse[0].id, 'one pack in use: your AI agent is asked about it (pack_update_draft with its id)', chk);
const seen = await api.op('packs.get', { pack: inUse[0].id }, { as: 'agent' });
eq(seen.last_checked, '', 'never checked before');
ok(seen.agent.open === true && seen.agent.note !== '', 'the pack shows the open ask and what to check', seen.agent);
await api.op('packs.checked', { pack: inUse[0].id, changed: 'no', note: 'Read the official rates page; nothing changed.' }, { as: 'agent' });
const after = await api.op('packs.get', { pack: inUse[0].id }, { as: 'owner' });
ok(after.agent.ended_at !== '' && after.agent.outcome === 'unchanged' && after.last_checked.slice(0, 10) === new Date().toISOString().slice(0, 10), 'packs.checked closes the ask and records the day of the check', after);
const chk2 = await api.call('packs.check-updates', { pack: inUse[0].id }, { as: 'owner' });
ok((chk2.status === 200 && chk2.body.asked === true) || (chk2.status === 409 && chk2.body.code === 'cooldown'), 'asking again after it was done asks once more (or waits out the cooldown)', chk2.body);
await refuses(api, 'packs.checked', { pack: inUse[0].id, note: 'x' }, { as: 'owner' }, 403, 'not_permitted', 'packs.checked is for your AI agent');

section('payroll before HR OS');
const hired = await api.call('people.hire', { entity: 'Empty Co', legal_name: 'Tan Wei Ling', start_day: '2025-03-03', title: 'Engineer' }, { as: 'owner' });
eq(hired.status, 200, 'a person who joined last year is hired', hired.body);
await api.op('filings.generate', {}, { as: 'owner' });
const fl3 = await api.op('filings.list', { show: 'all' }, { as: 'owner' });
const cpfEarlier = fl3.filings.find((f) => f.kind === 'sg_cpf' && f.period === prev);
ok(cpfEarlier !== undefined || Number(fl3.today.slice(8, 10)) > 14, 'with people last month, last month\'s CPF (paid by the earlier system) is in the ledger while its payment is ahead', { today: fl3.today, prev });
ok(cpfEarlier === undefined || cpfEarlier.due_day >= fl3.today, 'and never as late', cpfEarlier);
ok(!fl3.filings.some((f) => f.payruns.length === 0 && f.due_day !== '' && f.due_day < fl3.today), 'nothing from before HR OS is late', fl3.filings.filter((f) => f.due_day !== '' && f.due_day < fl3.today).map((f) => f.kind + ' ' + f.period));

const s = summary('t01_empty');
process.exitCode = s.failed > 0 ? 1 : 0;
