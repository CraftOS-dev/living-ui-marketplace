// QA t03: your AI agent's rules on the demo seed. Every agent: 'deny' op is
// refused (403 agent_not_permitted, before parameters); every propose op
// becomes a proposal visible in proposals.list (or a clean 4xx when its
// record does not exist), never a direct change; sealed values never appear
// in any agent read; pay hides when the owner turns agent_sees_pay off; the
// questions to your AI agent work (questions.ask fires question_asked once ->
// questions.answer; people cannot answer, your AI agent cannot ask);
// proposals.create refuses non-propose ops; a deletion needs --confirm.
//
//   QA_APP=<app> QA_PORT=3191 node t03_agent_rules.mjs [--seed]
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { newApi, catalog, timed, sealedIn, cleanError, section, ok, eq, summary, writeResult, freshServer, dummyParams, logSize, serverErrors, APP, PORT, O, AG, DEMO } from './lib.mjs';

const api = newApi();
if (process.argv.includes('--seed')) {
  freshServer();
  execFileSync('node', [join(APP, 'tools', 'dev', 'seed_demo.mjs'), '--port', String(PORT), '--app', APP], { stdio: 'pipe' });
}
const ops = catalog();
const log0 = logSize();

// Seeded references.
const ents = (await api.op('entities.list', {}, O)).entities;
const sg = ents.find((e) => e.country === 'SG');
const dir = (await api.op('people.directory', { status: 'all', limit: 500 }, O)).people;
const sam = dir.find((p) => p.number === 'E0005');
// A sealed identity number and a second bank account, to look for in every agent answer.
const NRIC = 'S9612345D';
await api.op('ids.add', { employee: sam.employee, type: 'nric', number: NRIC, country: 'SG' }, O);
const BANK = '1234567890';
const PLAINS = [NRIC, BANK, '9612345'];

const SAMPLE = {
  employment: 'E0005', employee: 'E0005', employments: '["E0005"]', entity: sg.id, type: 'annual', start: '2026-12-21', worked_day: '2026-11-01',
  name: 'QA thing', code: 'QA1', country: 'SG', title: 'QA goal', reason: 'raise', amount: '10.00', day: '2026-12-01', from_day: '2026-12-01',
  component: 'SG_ALLOWANCE', status: 'present', note: 'QA', time: '09:00', kind: 'in', start_day: '2026-12-01', entries: '[]', rows: '[]',
  stages: '[]', week: '[{"dow":1,"start":"09:00","end":"17:00","break_min":60}]', body: '{}', gl: '{}', summary: 'QA summary', policy: 'zzzzzzzzzzzzzzz',
  end: '17:00', calendar: 'zzzzzzzzzzzzzzz',
};

/* ------------------------------------------------------------ deny ops */
section('Every agent: deny op is refused for your AI agent');
const deny = ops.filter((o) => o.agent === 'deny');
const denyRows = [];
for (const op of deny) {
  for (const mode of ['none', 'dummy']) {
    const p = mode === 'none' ? {} : Object.assign(dummyParams(op, SAMPLE), op.effect === 'confirm' ? { pin: '123456' } : {});
    const r = await timed(api, op.name, p, AG);
    denyRows.push({ op: op.name, mode, status: r.status, code: r.body && r.body.code });
  }
}
const badDeny = denyRows.filter((r) => !(r.status === 403 && r.code === 'agent_not_permitted'));
ok(badDeny.length === 0, deny.length + ' deny ops x 2: all refused with 403 agent_not_permitted (' + badDeny.length + ' not)', badDeny.slice(0, 10));
const groups = ['payruns.lock', 'payruns.void', 'bankfiles.export', 'seal.reveal', 'approvals.decide', 'bank.add', 'packs.activate', 'members.invite', 'roles.update', 'applications.move', 'applications.reject', 'offers.send', 'calibration.set', 'reviews.submit', 'scorecards.save', 'people.delete', 'yearend.issue', 'filings.submit', 'payout.confirm-upload', 'payruns.publish'];
for (const g of groups) ok(deny.some((o) => o.name === g) || !ops.some((o) => o.name === g), g + ' is deny' + (ops.some((o) => o.name === g) ? '' : ' (no such op)'));

/* ---------------------------------------------------------- propose ops */
section('Every propose op becomes a proposal (or a clean refusal), never a change');
const prop = ops.filter((o) => o.agent === 'propose');
const propRows = [];
const before = (await api.op('proposals.list', { status: 'all', limit: 300 }, O)).total;
for (const op of prop) {
  const p = Object.assign(dummyParams(op, SAMPLE), { why: 'QA: checking the proposal path' });
  const r = await timed(api, op.name, p, AG);
  const created = r.status === 200 && r.body && r.body.proposed === true && typeof r.body.proposal === 'string';
  propRows.push({ op: op.name, status: r.status, created, proposal: created ? r.body.proposal : '', code: r.body && r.body.code, message: r.status >= 400 ? r.body && r.body.message : undefined, clean: r.status < 400 || cleanError(r) });
}
const created = propRows.filter((r) => r.created);
const direct = propRows.filter((r) => r.status === 200 && !r.created);
const unclean = propRows.filter((r) => !r.clean || r.status >= 500);
ok(direct.length === 0, 'no propose op ran directly for your AI agent (' + direct.length + ')', direct.map((r) => r.op));
ok(unclean.length === 0, 'no 5xx or unclean error on propose ops (' + unclean.length + ')', unclean.slice(0, 8));
console.log('  propose ops: ' + prop.length + ', proposals created ' + created.length + ', clean refusals ' + propRows.filter((r) => r.status >= 400).length);
const listed = (await api.op('proposals.list', { status: 'pending', limit: 300 }, O)).proposals.map((p) => p.id);
const missing = created.filter((r) => !listed.includes(r.proposal));
ok(missing.length === 0, 'every created proposal is in proposals.list (Inbox) for the owner (' + missing.length + ' missing)', missing.slice(0, 5));
const hrSees = (await api.op('proposals.list', { status: 'pending', limit: 300 }, { as: 'hr@northwind.test' })).proposals.length;
const empSees = await api.call('proposals.list', { status: 'pending' }, { as: 'sam@northwind.test' });
ok(empSees.status === 200 && (empSees.body.proposals || []).length === 0, 'an employee sees no proposals (' + (empSees.body.proposals || []).length + ')');
console.log('  hr sees ' + hrSees + ' of ' + listed.length);
const after = (await api.op('proposals.list', { status: 'all', limit: 300 }, O)).total;
eq(after - before, created.length, 'proposal count grew by the created ones');

// One accept, one dismiss.
const adj = created.find((r) => r.op === 'leave.adjust') || created[0];
if (adj) {
  const acc = await api.call('proposals.accept', { proposal: adj.proposal }, O);
  ok(acc.status === 200, 'the owner accepts a proposal (' + adj.op + ': ' + (acc.body.proposal && acc.body.proposal.status) + ')', acc.body);
  const agentAcc = await api.call('proposals.accept', { proposal: (created[1] || adj).proposal }, AG);
  eq(agentAcc.status, 403, 'your AI agent cannot accept its own proposal');
}

/* ------------------------------------------- proposals.create, confirm */
section('proposals.create and deletions');
const pc = await api.call('proposals.create', { items: [{ op: 'payruns.lock', params: { payrun: 'x' } }] }, AG);
ok(pc.status === 400, 'proposals.create refuses a people-only op inside a proposal (' + pc.status + ')', pc.body);
const pc2 = await api.call('proposals.create', { items: [{ op: 'bank.add', params: { employee: 'E0005', number: '999' } }] }, AG);
ok(pc2.status === 400, 'proposals.create refuses bank.add inside a proposal (' + pc2.status + ')', pc2.body);
const docs = await api.call('documents.list', { employee: 'E0005' }, AG);
void docs;
const delNoConfirm = await api.call('employee-skills.remove', { skill: 'nothing' }, AG);
ok(delNoConfirm.status === 409 && delNoConfirm.body.code === 'confirm_required', 'a deletion without --confirm is refused for your AI agent (' + delNoConfirm.status + ')', delNoConfirm.body);

/* ---------------------------------------------------------------- sealed */
section('Sealed values never reach your AI agent');
const reads = ops.filter((o) => o.effect === 'read' && o.agent !== 'deny');
const SAMPLE_READ = Object.assign({}, SAMPLE, { employee: sam.employee, employment: sam.employment, person: 'E0005' });
const sealedHits = [];
const slow = [];
const fives = [];
for (const op of reads) {
  const r = await timed(api, op.name, dummyParams(op, SAMPLE_READ), AG);
  const s = sealedIn(r.body, PLAINS);
  if (s.length) sealedHits.push({ op: op.name, hits: s.slice(0, 4) });
  if (r.ms > 1500) slow.push({ op: op.name, ms: Math.round(r.ms) });
  if (r.status >= 500) fives.push({ op: op.name, status: r.status, message: r.body && r.body.message });
}
ok(sealedHits.length === 0, 'no sealed key or plain identity or bank number in ' + reads.length + ' agent reads (' + sealedHits.length + ')', sealedHits.slice(0, 6));
ok(fives.length === 0, 'no 5xx in seeded agent reads (' + fives.length + ')', fives.slice(0, 8));
ok(slow.length === 0, 'no seeded agent read over 1.5 s (' + slow.length + ')', slow.slice(0, 8));
const reveal = await api.call('seal.reveal', { kind: 'identity', id: 'x', pin: '123456' }, AG);
eq(reveal.status, 403, 'seal.reveal refused for your AI agent');
const pg = await api.op('people.get', { employee: 'E0005' }, AG);
ok(!JSON.stringify(pg).includes(NRIC) && !JSON.stringify(pg).includes(BANK), 'people.get for your AI agent carries masked numbers only');

section('Pay hidden from your AI agent when the owner turns it off');
const pr = await api.op('payruns.list', {}, AG);
void pr;
await api.op('settings.update', { agent_sees_pay: false }, O);
const payReads = ['pay.history', 'payslips.recent', 'reports.cost', 'payroll.home', 'home.admin', 'people.get', 'payruns.list'];
const payLeak = [];
for (const name of payReads) {
  const r = await api.call(name, { employment: sam.employment, employee: 'E0005' }, AG);
  const t = JSON.stringify(r.body || '');
  // Sam's salary 7,800.00 SGD = 780000 minor.
  if (r.status === 200 && /"amount_minor":780000|780000/.test(t)) payLeak.push(name);
}
ok(payLeak.length === 0, 'with agent_sees_pay off, Sam\'s 780000 salary is in no agent answer (' + payLeak.join(', ') + ')');
await api.op('settings.update', { agent_sees_pay: true }, O);

/* ------------------------------------------------------------ questions */
section('Questions to your AI agent');
const ask = await api.op('questions.ask', { question: 'How many leave days do I have left?' }, { as: 'sam@northwind.test' });
const qId = ask.question.id;
ok(qId && ask.question.ask && ask.question.ask.trigger === 'question_asked', 'a person asks a question: its own question_asked ask', ask.question.ask);
const seen = (await api.op('questions.list', {}, AG)).questions.find((x) => x.id === qId);
ok(seen && seen.question.indexOf('leave days') >= 0, 'your AI agent reads the question');
const dn = await api.call('questions.answer', { question: qId, answer: 'You have 14 days of annual leave.' }, AG);
ok(dn.status === 200 && dn.body.question.status === 'answered', 'questions.answer answers it', dn.body);
eq((await api.op('questions.get', { question: qId }, { as: 'sam@northwind.test' })).question.answer, 'You have 14 days of annual leave.', 'the person reads the answer');
const byPerson = await api.call('questions.answer', { question: qId, answer: 'x' }, O);
eq(byPerson.status, 403, 'a person cannot answer for your AI agent');
const self = await api.call('questions.ask', { question: 'x' }, AG);
eq(self.status, 403, 'your AI agent does not ask itself');
const ownerList = await api.call('questions.list', { everyone: true }, O);
ok(ownerList.status === 200 && ownerList.body.questions.some((x) => x.id === qId), 'the owner sees everyone\'s questions with --everyone');

const errs = serverErrors(log0);
writeResult('t03_deny.json', denyRows);
writeResult('t03_propose.json', propRows);
writeResult('t03_server_errors.txt', errs.lines.join('\n'));
console.log('server error lines: ' + errs.lines.length);
const s = summary('t03_agent_rules');
process.exitCode = s.failed > 0 ? 1 : 0;
