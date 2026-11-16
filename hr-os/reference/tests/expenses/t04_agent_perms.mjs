// Your AI agent (drafts for someone, receipts by local path, proposals,
// automatic autonomy, flags, deny ops), HR acting for someone, permission
// refusals, asking again and the cron jobs.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP, EMAILS, PNG, eq, fresh, newApi, ok, refuses, section, summary, upload } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const O = { as: 'owner' };
const SAM = { as: EMAILS.sam };
const ENG = { as: EMAILS.eng };
const HR = { as: EMAILS.hr };
const AG = { as: 'agent' };
// The receipt your AI agent attaches by path must sit outside the app's folder
// (the app refuses its own files, checked below), so it goes to a temp folder
// that works wherever these tests live, inside the app's reference/tests or not.
const TMP = mkdtempSync(join(tmpdir(), 'hr-expenses-t04-'));
const FIXTURE = join(TMP, 'receipt.png');
writeFileSync(FIXTURE, PNG);

const dir = await api.op('people.directory', { status: 'all', limit: 100 }, O);
const sam = dir.people.find((x) => x.name === 'Sam Wong');
const ananya = dir.people.find((x) => x.name === 'Ananya Iyer');

section('your AI agent drafts for someone who asked');
await refuses(api, 'claim-lines.add', { amount: '10.00', category: 'meals' }, AG, 400, 'missing_param', 'your AI agent must say for whom');
const al = await api.op('claim-lines.add', { employment: sam.number, path: FIXTURE }, AG);
ok(al.line.receipt === true && al.line.receipt_status === 'waiting' && al.asked === false && al.claim.created_by_name === 'Your AI agent', 'a receipt by local path starts a draft for Sam; your AI agent does not ask itself (it reads it now)', al.claim);
await refuses(api, 'claim-lines.add', { employment: sam.number, path: join(APP, '.agent-token') }, AG, 403, 'not_permitted', "files inside the app's folder cannot be attached");
await refuses(api, 'claim-lines.add', { amount: '1.00', category: 'meals', path: FIXTURE }, SAM, 403, 'not_permitted', 'people upload; --path is for your AI agent');
await refuses(api, 'claims.submit', { claim: al.claim.number }, AG, 403, 'agent_not_permitted', 'your AI agent cannot submit');
await refuses(api, 'claim-lines.accept-reading', { line: al.line.id }, AG, 403, 'agent_not_permitted', 'your AI agent cannot accept its own reading');
const waiting = await api.op('claim-lines.waiting', {}, AG);
ok(waiting.total === 1 && waiting.lines[0].line === al.line.id && waiting.lines[0].claim === al.claim.id, 'receipts waiting, with their claim');
await refuses(api, 'claim-lines.waiting', {}, SAM, 403, 'not_permitted', 'an employee cannot list everyone\'s receipts');
await refuses(api, 'claim-lines.read-result', { line: al.line.id, amount: '10.00', category: 'nope' }, AG, 404, 'not_found', 'unknown category in a reading');
await refuses(api, 'claim-lines.read-result', { line: al.line.id, amount: '10.00', flags: ['looks_fishy'] }, AG, 400, 'invalid_param', 'flags are an enum');
await api.op('claim-lines.update', { line: al.line.id, merchant: 'My corner shop' }, SAM);

section('automatic autonomy fills the fields the person did not type');
await api.op('settings.autonomy', { autonomy: { expenses: 'auto' } }, O);
const rr = await api.op('claim-lines.read-result', { line: al.line.id, amount: '64.20', currency: 'SGD', day: '2026-11-02', merchant: 'Din Tai Fung', category: 'meals', flags: ['restricted_item'], note: 'Two beers on the bill' }, AG);
ok(rr.state === 'applied' && rr.line.amount_minor === 6420 && rr.line.merchant === 'My corner shop' && rr.line.category_code === 'meals' && rr.line.day === '2026-11-02', 'applied directly, never over what Sam typed', rr.line);
ok(rr.line.flags.some((f) => f.code === 'restricted_item' && f.source === 'agent'), 'its flag is on the line for the approver');
await api.op('settings.autonomy', { autonomy: { expenses: 'ask' } }, O);

section('flags of your AI agent');
const fl = await api.op('claim-lines.flag', { line: al.line.id, code: 'possible_duplicate', note: 'Looks like the receipt on EXP-0002' }, AG);
ok(fl.line.flags.some((f) => f.code === 'possible_duplicate'), 'flagged as a possible duplicate');
await refuses(api, 'claim-lines.flag', { line: al.line.id, code: 'possible_duplicate' }, SAM, 403, 'not_permitted', 'an employee cannot flag');
await refuses(api, 'claim-lines.clear-flag', { line: al.line.id, code: 'possible_duplicate' }, AG, 403, 'agent_not_permitted', 'your AI agent cannot clear flags');
const cl = await api.op('claim-lines.clear-flag', { line: al.line.id, code: 'possible_duplicate', note: 'Different dinner' }, HR);
ok(!cl.line.flags.some((f) => f.code === 'possible_duplicate') && cl.line.agent_flags.some((f) => f.cleared && f.cleared_note === 'Different dinner'), 'HR clears it, with a note kept');
const again = await api.op('claim-lines.flag', { line: al.line.id, code: 'possible_duplicate' }, AG);
ok(typeof again.message === 'string' && !again.line.flags.some((f) => f.code === 'possible_duplicate'), 'a cleared flag stays cleared');

section('a reading that failed');
const up = await upload(api, 'claim-lines.add', {}, { receipt: { data: PNG, type: 'image/png', name: 'blurry.png' } }, EMAILS.sam);
const rf = await api.op('claim-lines.read-failed', { line: up.body.line.id, code: 'unreadable', reason: 'The photo is blurred; the total cannot be read.' }, AG);
ok(rf.line.receipt_status === 'failed' && rf.line.agent_read.state === 'failed' && rf.line.flags.some((f) => f.code === 'no_amount'), 'failed: the person types the amount', rf.line);
const n = await api.op('notifications.list', {}, SAM);
ok(n.notifications.some((x) => x.title === 'Your AI agent could not read a receipt'), 'Sam was told');
const again2 = await api.op('claim-lines.read-again', { line: up.body.line.id }, SAM);
ok(again2.line.receipt_status === 'waiting' && again2.claim.agent !== null && again2.claim.agent.trigger === 'receipt_review', 'Sam asks again (receipt_review on the claim)', again2.claim.agent);

section('cron: reminders only (nothing asks your AI agent again on its own)');
const rem = await api.op('testexp.cron', { which: 'reminders' }, O);
ok(typeof rem.result.people === 'number', 'reminders run', rem.result);

section('proposals for settings');
const cats = await api.op('expense-categories.list', { entity: sam.entity }, AG);
const meals = cats.categories.find((c) => c.code === 'meals');
const pr = await api.op('expense-categories.save', { category: meals.id, limit: '60.00', why: 'Most team lunches are under 60' }, AG);
ok(pr.proposed === true && pr.preview.fields.some((f) => f.name === 'limit_minor' && f.after === 'SGD 60.00'), 'a category change is a proposal with before and after', pr.preview);
const pp = await api.op('expenses.policy-save', { entity: sam.entity, finance_over: '2000.00', why: 'Finance asked' }, AG);
ok(pp.proposed === true && pp.preview.fields.some((f) => f.name === 'finance_over_minor' && f.before === 'SGD 1,000.00' && f.after === 'SGD 2,000.00'), 'a policy change is a proposal', pp.preview);
await refuses(api, 'proposals.accept', { proposal: pr.proposal }, SAM, 403, 'not_permitted', 'an employee cannot accept it');
await api.op('proposals.accept', { proposal: pr.proposal }, HR);
const after = (await api.op('expense-categories.list', { entity: sam.entity }, HR)).categories.find((c) => c.code === 'meals');
eq(after.limit_minor, 6000, 'HR accepted: meals limit SGD 60');
await refuses(api, 'expense-categories.delete', { category: meals.id }, AG, 403, 'agent_not_permitted', 'your AI agent cannot delete categories');
await refuses(api, 'expense-categories.delete', { category: meals.id }, HR, 409, 'in_use', 'a used category cannot be deleted');
await refuses(api, 'expense-categories.save', { category: meals.id, limit: '1.00' }, SAM, 403, 'not_permitted', 'an employee cannot change categories');
const newCat = await api.op('expense-categories.save', { entity: sam.entity, name: 'Client gifts', limit: '100.00', receipt_rule: 'always', gl_account: '6420 Gifts', icon: 'Gift' }, HR);
ok(newCat.category.code === 'client_gifts' && newCat.category.gl_account === '6420 Gifts', 'HR adds a category');
await api.op('expense-categories.delete', { category: newCat.category.id }, HR);
const rate = await api.op('expense-categories.save', { category: cats.categories.find((c) => c.code === 'mileage').id, mileage_rate: '0.655' }, HR);
eq(rate.category.mileage_rate_minor, 65.5, 'a mileage rate with half a cent');

section('HR adds a claim for someone; the approval goes past the requester');
const hc = await api.op('claims.create', { employment: ananya.number, title: 'Paper receipts from October' }, HR);
await api.op('claim-lines.add', { claim: hc.claim.number, category: 'phone_internet', amount: '999.00', day: '2026-10-31', merchant: 'Jio' }, HR);
const hs = await api.op('claims.submit', { claim: hc.claim.number }, HR);
ok(hs.claim.status === 'submitted' && hs.claim.currency === 'INR', 'HR submits for Ananya (INR)');
const apv = (await api.op('approvals.get', { approval: hs.approval.id }, O)).approval;
const hrMe = await api.op('auth.me', {}, HR);
ok(!apv.approvers.includes(hrMe.member.id) && apv.approvers.length > 0, 'the requester is not an approver', apv.approvers);
await api.op('approvals.decide', { approval: hs.approval.id, decision: 'approved' }, O);
const an = await api.op('notifications.list', {}, { as: EMAILS.ananya });
ok(an.notifications.some((x) => x.title.indexOf('Approved: expense claim') === 0 && x.body.indexOf('INR') === 0), 'Ananya is told (amount in the body, never the title)', an.notifications.map((x) => x.title));
await refuses(api, 'claims.create', { employment: ananya.number }, SAM, 403, 'not_permitted', 'an employee cannot start a claim for someone else');
await refuses(api, 'claims.create', { pay_via: 'bank' }, SAM, 403, 'not_permitted', 'an employee cannot choose how a claim is paid');
await refuses(api, 'claims.get', { claim: hc.claim.number }, { as: EMAILS.sales }, 403, 'not_permitted', 'a manager of someone else cannot see it');
ok((await api.op('claims.get', { claim: hc.claim.number }, ENG)).claim.access === 'team', 'her indirect manager sees it');

section('deletions by your AI agent wait for the person');
const draft = await api.op('claims.create', { employment: sam.number }, AG);
await refuses(api, 'claims.delete', { claim: draft.claim.number }, AG, 409, 'confirm_required', 'without --confirm nothing is deleted');
const del = await api.op('claims.delete', { claim: draft.claim.number, confirm: true }, AG);
eq(del.deleted, true, 'deleted once the person asked');

section('reads as each role');
const engHome = await api.op('expenses.home', {}, ENG);
eq(engHome.scope, 'team', 'manager home: team scope');
const agHome = await api.op('expenses.home', {}, AG);
ok(agHome.scope === 'admin' && agHome.receipts_waiting >= 0, 'your AI agent reads the home');
const agList = await api.op('claims.list', { status: 'any' }, AG);
ok(agList.total >= 2 && agList.view === 'all', 'your AI agent reads every claim', agList.total);
await refuses(api, 'expenses.me', {}, AG, 400, 'not_permitted', 'expenses.me is for people');

rmSync(TMP, { recursive: true, force: true });
summary('t04_agent_perms');
