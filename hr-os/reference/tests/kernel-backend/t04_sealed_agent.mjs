// Seeded: sealed values never leave the app except seal.reveal (PIN), bank
// accounts wait for a payroll administrator's PIN (two-person rule), and your
// AI agent's deny, propose and auto paths.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, eq, fresh, newApi, ok, refuses, sample, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const O = { as: 'owner' };
const OP = { as: 'owner', pin: true };
const HR = { as: 'hr@northwind.test' };
const PAY = { as: 'payroll@northwind.test' };
const PAYP = { as: 'payroll@northwind.test', pin: true };
const SAM = { as: 'sam@northwind.test' };
const AG = { as: 'agent' };

const all = (await api.op('people.directory', { status: 'all', limit: 100 }, O)).people;
const by = {};
for (const p of all) by[p.work_email] = p;
const sam = by['sam@northwind.test'];
const emily = by['emily@northwind.test'];
const daniel = by['payroll@northwind.test'];

section('sealed values');
const BANK = '9876543210123';
const NRIC = 'S1234567D';
const IBAN = 'GB82WEST12345698765432';
const b1 = await api.op('bank.add', { employee: emily.number, number: BANK, iban: IBAN, bank_name: 'Chase', bank_code: '021000021' }, HR);
eq(b1.bank_account.number_masked, '•••• 0123', 'bank number masked');
eq(b1.bank_account.status, 'pending', 'a new bank account waits for approval');
const id1 = await api.op('ids.add', { employee: sam.number, type: 'nric', number: NRIC, country: 'SG' }, HR);
eq(id1.identity_doc.number_masked, '•••• 567D', 'identity number masked');
await refuses(api, 'ids.add', { employee: sam.number, type: 'nric', number: '12345', country: 'SG' }, HR, 400, 'invalid_param', 'an NRIC in the wrong format is refused');
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const reads = manifest.operations.filter((o) => !o.system && o.executor.method === 'GET');
const ctx = { employee: emily.number, employment: emily.employment, entity: 'Northwind Inc', calendar: 'SG' };
let leaks = [];
for (const as of ['owner', 'agent', 'hr@northwind.test', 'payroll@northwind.test']) {
  for (const o of reads) {
    const params = {};
    for (const [k, d] of Object.entries(o.params)) if (d.required) params[k] = sample(k, ctx);
    const r = await api.call(o.name, params, { as });
    const t = JSON.stringify(r.body);
    if (t.includes(BANK) || t.includes(NRIC) || t.includes(IBAN)) leaks.push(as + ' ' + o.name);
  }
  for (const emp of [emily.number, sam.number]) {
    const t = JSON.stringify((await api.call('people.get', { employee: emp }, { as })).body) + JSON.stringify((await api.call('bank.list', { employee: emp }, { as })).body) + JSON.stringify((await api.call('ids.list', { employee: emp }, { as })).body);
    if (t.includes(BANK) || t.includes(NRIC) || t.includes(IBAN)) leaks.push(as + ' people.get/bank.list/ids.list ' + emp);
  }
}
eq(leaks, [], 'no read op shows a sealed number, to anyone');
const auditDump = JSON.stringify(await api.op('audit.list', { limit: 500 }, O));
ok(!auditDump.includes(BANK) && !auditDump.includes(NRIC) && !auditDump.includes(IBAN), 'no audit row holds a sealed number');
await refuses(api, 'seal.reveal', { collection: 'bank_accounts', id: b1.bank_account.id }, AG, 403, 'agent_not_permitted', 'your AI agent cannot reveal');
await refuses(api, 'seal.reveal', { collection: 'bank_accounts', id: b1.bank_account.id }, { as: 'payroll@northwind.test', pin: '000000' }, 403, 'wrong_pin', 'reveal needs the right PIN');
const rv = await api.op('seal.reveal', { collection: 'bank_accounts', id: b1.bank_account.id }, PAYP);
eq(rv.value, BANK, 'reveal with the PIN shows the number');
ok(rv.minutes === 5 && rv.visible_until > new Date().toISOString(), 'for five minutes');
const iv = await api.op('seal.reveal', { collection: 'bank_accounts', id: b1.bank_account.id, field: 'iban' }, PAYP);
eq(iv.value, IBAN, 'and the IBAN');
await refuses(api, 'seal.reveal', { collection: 'identity_docs', id: id1.identity_doc.id }, { as: 'eng.lead@northwind.test', pin: true }, 403, 'not_permitted', 'a manager cannot reveal a report\'s ID');
eq((await api.op('seal.reveal', { collection: 'identity_docs', id: id1.identity_doc.id }, { as: 'sam@northwind.test', pin: true })).value, NRIC, 'a person reveals their own ID with their PIN');
const revealAudit = await api.op('audit.list', { op: 'seal.reveal' }, O);
ok(revealAudit.entries.filter((e) => e.summary.indexOf('Revealed') === 0).length === 3 && revealAudit.entries.some((e) => e.summary === 'Wrong approval PIN') && !JSON.stringify(revealAudit).includes(BANK), 'each reveal (and the wrong PIN) is audited without the value', revealAudit.entries.map((e) => e.summary));

section('bank approval (two-person rule)');
const pend = await api.op('approvals.list', {}, PAY);
const appr = pend.approvals.find((a) => a.ref_id === b1.bank_account.id);
ok(appr && appr.needs_pin, 'the payroll administrator has the bank approval in the Inbox');
await refuses(api, 'approvals.decide', { approval: appr.id, decision: 'approved' }, HR, 403, 'not_permitted', 'the HR admin who added it cannot approve it');
await refuses(api, 'approvals.decide', { approval: appr.id, decision: 'approved' }, PAY, 400, 'pin_required', 'approving bank details needs the PIN');
await refuses(api, 'approvals.decide', { approval: appr.id, decision: 'approved' }, AG, 403, 'agent_not_permitted', 'your AI agent never approves');
const dec = await api.op('approvals.decide', { approval: appr.id, decision: 'approved', note: 'Checked with Emily' }, PAYP);
eq(dec.approval.status, 'approved', 'approved with the PIN');
const emilyBanks = (await api.op('bank.list', { employee: emily.number }, HR)).bank_accounts;
eq(emilyBanks.find((b) => b.id === b1.bank_account.id).status, 'active', 'the account is active');
ok(emilyBanks.filter((b) => b.id !== b1.bank_account.id).every((b) => b.status === 'retired'), 'the earlier pay-the-rest account (seeded) is retired', emilyBanks.map((b) => b.status));
const samApproval = (await api.op('approvals.list', {}, PAY)).approvals.find((a) => a.kind === 'bank_account');
ok(samApproval && samApproval.employee_name === 'Sam Wong', "Sam's own request waits too");
await refuses(api, 'approvals.decide', { approval: samApproval.id, decision: 'approved' }, { as: 'sam@northwind.test', pin: true }, 403, 'not_permitted', 'Sam cannot approve his own bank account');
const rej = await api.op('approvals.decide', { approval: samApproval.id, decision: 'rejected', note: 'Account name does not match' }, PAY);
eq(rej.approval.status, 'rejected', 'rejecting needs no PIN');
const samBanks = (await api.op('bank.list', { employee: sam.number }, SAM)).bank_accounts;
eq(samBanks.find((b) => b.id === samApproval.ref_id).status, 'rejected', 'the account is rejected');
ok(samBanks.some((b) => b.id !== samApproval.ref_id && b.status === 'active'), 'his approved account keeps being paid', samBanks.map((b) => b.status));
const own = await api.op('bank.add', { employee: daniel.number, number: '5550001111', bank_name: 'OCBC' }, PAY);
eq(own.approval.approvers.length, 1, "a payroll admin's own account goes to the other approver (the owner)");
await refuses(api, 'approvals.decide', { approval: own.approval.id, decision: 'approved' }, PAYP, 403, 'not_permitted', 'and not to themself');
eq((await api.op('approvals.decide', { approval: own.approval.id, decision: 'approved' }, OP)).approval.status, 'approved', 'the owner approves it with the PIN');
const notes = await api.op('notifications.list', {}, { as: 'hr@northwind.test' });
ok(notes.notifications.some((n) => n.title.indexOf('Approved') === 0), 'the requester is told');

section('your AI agent: deny');
for (const [name, params] of [
  ['bank.add', { employee: sam.number, number: '1234567' }],
  ['people.export', {}],
  ['members.invite', { email: 'z@x.test', name: 'Z', role: 'employee' }],
  ['roles.add', { name: 'X' }],
  ['proposals.accept', { proposal: 'x' }],
  ['approvals.decide', { approval: 'x', decision: 'approved' }],
  ['people.delete', { employee: sam.number }],
  ['ids.add', { employee: sam.number, type: 'nric', number: NRIC }],
  ['settings.autonomy', { autonomy: { people: 'auto' } }],
  ['employments.end', { employment: sam.employment, end_day: '2026-12-31' }],
]) await refuses(api, name, params, AG, 403, 'agent_not_permitted', name + ' is people only');
const agentPay = await api.op('people.get', { employee: sam.number }, AG);
ok(agentPay.employments[0].pay !== null, 'your AI agent sees pay by default');
await api.op('settings.update', { agent_sees_pay: false }, O);
ok((await api.op('people.get', { employee: sam.number }, AG)).employments[0].pay === null, 'and not when the owner switches it off');
await api.op('settings.update', { agent_sees_pay: true }, O);

section('your AI agent: propose');
const pr = await api.op('job.update', { employment: sam.employment, effective_from: '2027-01-01', reason: 'promotion', title: 'Senior Software Engineer', why: 'Sam passed the promotion panel (agent test).' }, AG);
ok(pr.proposed === true && pr.proposal, 'job.update by your AI agent becomes a proposal');
eq((await api.op('job.history', { employment: sam.employment }, O)).records.length, 1, 'nothing changed yet');
ok(pr.preview.fields.some((f) => f.name === 'title' && f.before === 'Software Engineer' && f.after === 'Senior Software Engineer'), 'the proposal shows before and after', pr.preview);
const dup = await api.op('job.update', { employment: sam.employment, effective_from: '2027-01-01', reason: 'promotion', title: 'Senior Software Engineer', why: 'again' }, AG);
eq(dup.duplicate_of, pr.proposal, 'the same change proposed twice adds nothing');
await refuses(api, 'proposals.accept', { proposal: pr.proposal }, SAM, 403, 'not_permitted', 'an employee cannot accept people proposals');
const acc = await api.op('proposals.accept', { proposal: pr.proposal }, HR);
eq(acc.proposal.status, 'accepted', 'HR accepts it');
const jh = await api.op('job.history', { employment: sam.employment }, O);
ok(jh.records.length === 2 && jh.records[1].title === 'Senior Software Engineer' && jh.records[1].state === 'scheduled', 'the change ran as HR (scheduled promotion)');
const accAudit = await api.op('audit.list', { op: 'job.update' }, O);
ok(accAudit.entries.some((e) => e.actor === 'person') && accAudit.entries.some((e) => e.actor === 'agent'), 'audit shows the proposal by your AI agent and the change by the person');
const pu = await api.op('people.update', { employee: sam.number, preferred_name: 'Sammy', why: 'He asked in chat' }, AG);
ok(pu.proposed, 'people.update by your AI agent is a proposal');
const dis = await api.op('proposals.dismiss', { proposal: pu.proposal, note: 'Sam prefers Sam' }, HR);
eq(dis.proposal.status, 'dismissed', 'HR dismisses it');
const stale = await api.op('people.update', { employee: sam.number, preferred_name: 'Samuel', why: 'test stale' }, AG);
await api.op('people.update', { employee: sam.number, preferred_name: 'Sam W.' }, HR);
const stAcc = await api.op('proposals.accept', { proposal: stale.proposal }, HR);
ok(stAcc.proposal.items[0].state === 'stale' && stAcc.applied === 0, 'a proposal over a value that moved is skipped as stale', stAcc.proposal.items[0]);
await api.op('settings.autonomy', { autonomy: { people: 'auto' } }, O);
const auto = await api.op('people.update', { employee: sam.number, preferred_name: 'Sam Wong', why: 'auto test' }, AG);
ok(!auto.proposed && auto.employee.preferred_name === 'Sam Wong', 'with autonomy auto your AI agent changes it directly');
await api.op('settings.autonomy', { autonomy: { people: 'ask' } }, O);
const batch = await api.op('proposals.create', { title: 'Two titles', why: 'Batch test', items: [{ op: 'titles.add', params: { name: 'Data Analyst' } }, { op: 'titles.add', params: { name: 'Data Engineer' } }] }, AG);
eq(batch.proposal.items.length, 2, 'proposals.create groups two changes');
const ba = await api.op('proposals.accept', { proposal: batch.proposal.id, items: [1] }, HR);
ok(ba.applied === 1 && ba.proposal.status === 'partial', 'accept only the chosen item', ba.proposal.items.map((i) => i.state));
const doc = await api.op('documents.add', { employee: sam.number, title: 'Agent note', category: 'other' }, AG);
await refuses(api, 'documents.delete', { document: doc.document.id }, AG, 403, 'agent_not_permitted', 'documents.delete is people only');
const sk = await api.op('employee-skills.set', { employee: sam.number, skill: 'Kotlin', level: 3 }, AG);
await refuses(api, 'employee-skills.remove', { skill: sk.skill.id }, AG, 409, 'confirm_required', 'a deletion by your AI agent waits for --confirm true');
eq((await api.op('employee-skills.remove', { skill: sk.skill.id, confirm: true }, AG)).deleted, true, 'and runs with it');

const s = summary('t04_sealed_agent');
process.exitCode = s.failed > 0 ? 1 : 0;
