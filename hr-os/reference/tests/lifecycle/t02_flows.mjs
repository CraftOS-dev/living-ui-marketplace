/**
 * Lifecycle flows end to end on the demo company (tools/dev/seed_demo.mjs):
 * onboarding on hire, task lanes and rights, pre-boarding welcome, letters,
 * separations with the two-step approval, exit interview, the full and
 * final statement, assets, handbook, grievances, the daily job, and your AI
 * agent's allow, propose and deny paths.
 *
 *   node tests/t02_flows.mjs            (fresh database, seeded)
 */
import { fresh, ok, eq, refused, section, done, PORT, DEMO, hasStubs, hasOp } from './lib.mjs';

// The full and final statement and the daily job need the scratch-only stubs of expenses,
// leave and payroll (stubs.add, stubs.cron); without them those checks are skipped.
const STUBS = hasStubs();
// With the real leave module merged, its own leave types and balances are used (no stub rows).
const REAL_LEAVE = hasOp('leave.balance');
// With the real expenses and payroll modules merged, claims and advances go through expenses,
// and the termination run is calculated by payroll (the statement then shows its payslip).
const REAL_EXP = hasOp('claims.create');
const REAL_PAY = hasOp('payruns.calculate');

const api = fresh({ seed: true });
const OWNER = { as: 'owner' };
const HR = { as: 'hr@northwind.test' };
const PAY = { as: 'payroll@northwind.test' };
const MGR = { as: 'eng.lead@northwind.test' };
const SAM = { as: 'sam@northwind.test' };
const HARUTO = { as: 'haruto@northwind.test' };
const AGENT = { as: 'agent' };
const call = (n, p, o) => api.call(n, p || {}, o);
const op = (n, p, o) => api.op(n, p || {}, o);
/** Approve every step of an approval with whoever is its approver now. */
async function approveAll(id) {
  for (let i = 0; i < 5; i++) {
    const a = (await op('approvals.get', { approval: id }, OWNER)).approval;
    if (a.status !== 'pending') return a.status;
    let moved = false;
    for (const as of [MGR, HR, PAY, OWNER]) {
      const m = await op('auth.me', {}, as);
      if (a.approvers.includes(m.member.id)) {
        await op('approvals.decide', { approval: id, decision: 'approved' }, as);
        moved = true;
        break;
      }
    }
    if (!moved) return a.status;
  }
  return 'pending';
}

const me = await op('auth.me', {}, OWNER);
const today = me.today;
const add = (d, n) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const ents = (await op('entities.list', {}, OWNER)).entities;
const SG = ents.find((e) => e.country === 'SG');
const dir = (await op('people.directory', { status: 'all', limit: 100 }, OWNER)).people;
const person = (num) => dir.find((x) => x.number === num);
const byEmail = (email) => dir.find((x) => x.work_email === email);
const meiLin = byEmail('eng.lead@northwind.test');
const sam = byEmail('sam@northwind.test');

/* -------------------------------------------------------- seeding */
section('country defaults');
{
  const t = await op('checklist-templates.list', {}, HR);
  ok(t.templates.filter((x) => x.is_default).length === 8, 'every entity has a default onboarding and offboarding template', t.templates.map((x) => x.name));
  const jp = t.templates.find((x) => x.kind === 'onboarding' && x.country === 'JP');
  ok(jp && jp.tasks.some((x) => x.title.indexOf('マイナンバー') >= 0) && jp.tasks.some((x) => x.title.indexOf('扶養控除等申告書') >= 0), 'Japan onboarding collects My Number consent and the dependants declaration');
  const us = t.templates.find((x) => x.kind === 'onboarding' && x.country === 'US');
  ok(us && us.tasks.some((x) => x.title.indexOf('I-9') >= 0) && us.tasks.some((x) => x.title.indexOf('W-4') >= 0), 'US onboarding has I-9 and W-4');
  const inn = t.templates.find((x) => x.kind === 'onboarding' && x.country === 'IN');
  ok(inn && ['PAN', 'Aadhaar', 'UAN'].every((w) => inn.tasks.some((x) => x.title.indexOf(w) >= 0)), 'India onboarding has PAN, Aadhaar and UAN');
  const sg = t.templates.find((x) => x.kind === 'onboarding' && x.country === 'SG');
  ok(sg && sg.tasks.some((x) => x.title.indexOf('work pass') >= 0), 'Singapore onboarding checks the work pass');
  const e = await op('entities.get', { entity: SG.id }, OWNER);
  ok(e.entity.default_onboarding_template === sg.id, 'the entity points at its default onboarding template');
  const gt = await op('grievance-types.list', {}, SAM);
  ok(gt.types.length >= 8, 'grievance types are seeded and readable by employees');
  const ef = await op('exit-forms.list', {}, HR);
  ok(ef.forms.length === 1 && ef.forms[0].questions.length >= 6, 'one default exit form');
  refused(await call('checklist-templates.list', {}, SAM), 403, 'not_permitted', 'an employee cannot list templates');
}

/* ------------------------------------------------------ onboarding */
section('onboarding starts on hire');
const start = add(today, 10);
const hired = await op('people.hire', { entity: SG.id, legal_name: 'Tan Li Na', family_name: 'Tan', given_name: 'Li Na', name_order: 'family_first', work_email: 'lina@northwind.test', start_day: start, probation_end: add(start, 90), title: 'Software Engineer', department: 'Engineering', manager: meiLin.employee, pay_basis: 'salary', pay_amount: '7200.00', pay_per: 'month' }, HR);
const lina = hired.employee;
const linaEmp = hired.employment;
ok(hired.events.some((x) => x.module === 'lifecycle' && x.ok && x.result.started), 'the lifecycle subscriber started onboarding', hired.events);
const lists = await op('checklists.list', { employee: lina.number }, HR);
eq(lists.total, 1, 'one onboarding checklist for the new hire');
const cl = (await op('checklists.get', { checklist: lists.checklists[0].id }, HR)).checklist;
ok(cl.anchor_day === start && cl.tasks.length === 17, 'tasks from the Singapore template, due from the first day', { anchor: cl.anchor_day, n: cl.tasks.length });
const welcomeTask = cl.tasks.find((x) => x.title.indexOf('welcome message') >= 0);
eq(welcomeTask.due, add(start, -5), 'due day = first day plus the offset');
const mgrTask = cl.tasks.find((x) => x.assignee_kind === 'manager');
ok(mgrTask && mgrTask.assignee_label === 'Mei Lin Chua', 'manager tasks go to the manager', mgrTask);
const itTask = cl.tasks.find((x) => x.assignee_kind === 'it');
ok(itTask && itTask.can.act, 'with no IT role, HR takes IT tasks');
// Automatic work is off by default: a hire asks your AI agent nothing; HR asks from the checklist.
eq((await op('checklists.get', { checklist: lists.checklists[0].id }, HR)).checklist.agent, null, 'with Automatic work off, the hire asked your AI agent nothing');
const askCl = await op('checklists.ask-agent', { checklist: lists.checklists[0].id }, HR);
ok(askCl.asked === true && askCl.agent.trigger === 'onboarding_help' && askCl.agent.record === lists.checklists[0].id, 'HR asks your AI agent about its task (onboarding_help with the checklist)', askCl);
eq((await op('checklists.ask-agent', { checklist: lists.checklists[0].id }, HR)).asked, false, 'asked once: asking again while it is open asks nothing');
const late = await op('people.hire', { entity: SG.id, legal_name: 'Old Timer', start_day: '2024-01-15', title: 'Operations Associate' }, HR);
ok(late.events.some((x) => x.module === 'lifecycle' && x.ok && x.result.started === false), 'no onboarding for a first day long past', late.events);

section('task lanes and rights');
{
  const mine = await op('tasks.list', { view: 'mine' }, MGR);
  ok(mine.tasks.length > 0 && mine.tasks.every((x) => x.assignee_kind === 'manager' || x.assignee_kind === 'member'), 'the manager sees their tasks', mine.tasks.map((x) => x.assignee_kind));
  const mgrAll = await op('checklists.get', { checklist: cl.id }, MGR);
  eq(mgrAll.checklist.see, 'all', 'the manager of a pre-hire sees the whole board');
  refused(await call('checklists.get', { checklist: cl.id }, HARUTO), 403, 'not_permitted', 'another employee cannot see the board');
  refused(await call('tasks.complete', { task: welcomeTask.id }, MGR), 403, 'not_permitted', 'the manager cannot complete an HR task');
  const r = await op('tasks.complete', { task: mgrTask.id, note: 'Buddy: Sam' }, MGR);
  ok(r.task.status === 'done' && r.task.done_by_name === 'Mei Lin Chua', 'the manager completes their task');
  const re = await op('tasks.reopen', { task: mgrTask.id }, MGR);
  eq(re.task.status, 'open', 'and can reopen it');
  await op('tasks.complete', { task: mgrTask.id }, MGR);
  refused(await call('tasks.skip', { task: welcomeTask.id }, MGR), 403, 'not_permitted', 'only HR skips');
}

section('pre-boarding welcome');
{
  const inv = await op('members.invite', { email: 'lina@northwind.test', name: 'Li Na Tan', role: 'employee', employee: lina.id }, { as: 'owner', pin: true });
  const joined = await op('auth.accept-invite', { email: 'lina@northwind.test', code: inv.code, password: DEMO.password });
  api.setToken('lina@northwind.test', joined.token);
  const LINA = { as: 'lina@northwind.test' };
  await op('checklists.first-day', { checklist: cl.id, time: '09:30', place: 'Level 12 reception, 1 Raffles Place', contact: meiLin.employee, bring: 'Passport and bank details', note: 'Lunch with the team.' }, HR);
  const w = await op('lifecycle.welcome', {}, LINA);
  ok(w.linked && w.pre_hire && w.first_day.time === '09:30' && w.first_day.contact === 'Mei Lin Chua' && w.first_day.days_to_go === 10, 'the welcome page shows first-day details', w.first_day);
  ok(w.tasks.length > 0 && w.tasks.every((x) => x.assignee_kind === 'employee'), 'and the new hire\'s own tasks', w.tasks.map((x) => x.title));
  const own = await op('checklists.get', { checklist: cl.id }, LINA);
  ok(own.checklist.see === 'own' && own.checklist.tasks.every((x) => x.assignee_kind === 'employee'), 'the new hire sees only their tasks on the board');
  const idTask = w.tasks.find((x) => x.kind === 'document');
  refused(await call('tasks.complete', { task: idTask.id }, LINA), 400, 'file_required', 'a document task needs the file');
  const fd = new FormData();
  fd.append('task', idTask.id);
  fd.append('note', 'Passport');
  fd.append('file', new Blob([Buffer.from('%PDF-1.4\n% test passport\n')], { type: 'application/pdf' }), 'passport.pdf');
  const up = await fetch(`http://127.0.0.1:${PORT}/api/ops/tasks/complete`, { method: 'POST', headers: { authorization: api.tokens.get('lina@northwind.test') }, body: fd });
  const upBody = await up.json();
  ok(up.status === 200 && upBody.task.document && upBody.task.document.has_file, 'the upload completes it and is stored as a document', upBody);
  const docs = await op('documents.list', { employee: lina.number }, HR);
  ok(docs.documents.some((x) => x.category === 'identity' && x.has_file), 'the document is on the person', docs.documents);
  const pt = w.tasks.find((x) => x.kind === 'task');
  ok((await op('tasks.complete', { task: pt.id }, LINA)).task.status === 'done', 'the new hire completes a task');
  refused(await call('tasks.complete', { task: welcomeTask.id }, LINA), 403, 'not_permitted', 'the new hire cannot complete HR tasks');
}

section('your AI agent on checklists');
{
  const mine = await op('tasks.list', { view: 'mine' }, AGENT);
  ok(mine.tasks.length >= 1 && mine.tasks.every((x) => x.assignee_kind === 'agent'), 'your AI agent lists its own tasks');
  const at = mine.tasks.find((x) => x.employee === lina.id);
  ok((await op('tasks.complete', { task: at.id, note: 'Welcome note: ...' }, AGENT)).task.done_actor === 'agent', 'and completes them');
  refused(await call('tasks.complete', { task: welcomeTask.id }, AGENT), 403, 'agent_not_permitted', 'but not a person\'s task');
  refused(await call('tasks.skip', { task: welcomeTask.id }, AGENT), 403, 'agent_not_permitted', 'skip is for people');
  const pr = await op('tasks.add', { checklist: cl.id, title: 'Order business cards', assignee: 'hr', due_offset_days: 2 }, AGENT);
  ok(pr.proposal && pr.status !== 'applied', 'adding a task is a proposal', pr);
  const pr2 = await op('checklists.start', { employment: sam.number, kind: 'custom' }, AGENT);
  ok(!!pr2.proposal, 'starting a checklist is a proposal', pr2);
  refused(await call('checklists.cancel', { checklist: cl.id }, AGENT), 403, 'agent_not_permitted', 'cancel is for people');
  const props = await op('proposals.list', {}, HR);
  const p1 = props.proposals.find((x) => x.items.some((i) => i.op === 'tasks.add'));
  await op('proposals.accept', { proposal: p1.id }, HR);
  const after = await op('checklists.get', { checklist: cl.id }, HR);
  ok(after.checklist.tasks.some((x) => x.title === 'Order business cards'), 'HR accepted the proposal: the task is on the board');
}

section('finish onboarding');
{
  const all = (await op('checklists.get', { checklist: cl.id }, HR)).checklist.tasks.filter((x) => x.status === 'open');
  await op('tasks.skip', { task: all[0].id, note: 'Not needed' }, HR);
  let last = null;
  for (const t of all.slice(1)) {
    last = await call('tasks.complete', { task: t.id }, HR);
    if (t.kind === 'document') ok(last.status === 400, 'HR still needs a file for a document task');
  }
  for (const t of (await op('checklists.get', { checklist: cl.id }, HR)).checklist.tasks.filter((x) => x.status === 'open')) await op('tasks.skip', { task: t.id }, HR);
  const c = (await op('checklists.get', { checklist: cl.id }, HR)).checklist;
  ok(c.status === 'done' && c.progress.percent === 100, 'the checklist closes when every task is done or skipped', c.progress);
  ok(c.agent === null || c.agent.ended_at !== '', 'no ask stays open on a finished checklist', c.agent);
}

/* ---------------------------------------------------------- letters */
section('letters');
const tpls = (await op('letter-templates.list', {}, HR)).templates;
const appointment = tpls.find((x) => x.kind === 'appointment');
let letterId = '';
{
  const pv = await op('letters.preview', { employee: lina.number, template: appointment.id }, HR);
  ok(pv.missing.length === 0 && pv.rendered.indexOf('SGD 7,200.00') >= 0 && pv.rendered.indexOf('Engineering') >= 0, 'the preview fills the appointment letter (pay for HR)', pv);
  ok(pv.rendered.indexOf(start.slice(8, 10) + '/' + start.slice(5, 7) + '/' + start.slice(0, 4)) >= 0, 'days in the entity format (DD/MM/YYYY for Singapore)', pv.rendered.slice(0, 400));
  refused(await call('letters.draft', { employee: lina.number, template: appointment.id }, MGR), 403, 'not_permitted', 'a manager cannot draft letters');
  const d = await op('letters.draft', { employee: lina.number, template: appointment.id }, HR);
  letterId = d.letter.id;
  ok(d.letter.status === 'draft' && /^L\d{4}$/.test(d.letter.number) && d.letter.needs_ack, 'a draft with a number', d.letter);
  refused(await call('letters.get', { letter: letterId }, { as: 'lina@northwind.test' }), 403, 'not_permitted', 'the person cannot see a draft');
  refused(await call('letters.issue', { letter: letterId }, AGENT), 403, 'agent_not_permitted', 'your AI agent never issues');
  const is = await op('letters.issue', { letter: letterId }, HR);
  ok(is.letter.status === 'issued' && is.letter.rendered.indexOf('Priya Raman') >= 0 && is.letter.document !== '', 'issued, signed by HR and stored as a document', is.letter);
  const docs = await op('documents.list', { employee: lina.number }, { as: 'lina@northwind.test' });
  ok(docs.documents.some((x) => x.source === 'letter' && x.needs_ack && x.has_file), 'the person sees it in their documents');
  const mine = await op('letters.list', {}, { as: 'lina@northwind.test' });
  eq(mine.letters.length, 1, 'the person lists their letter');
  const ack = await op('letters.acknowledge', { letter: letterId }, { as: 'lina@northwind.test' });
  ok(ack.letter.acked_at !== '', 'and acknowledges it');
  refused(await call('letters.update', { letter: letterId, body: 'x' }, HR), 409, 'conflict', 'an issued letter cannot change');
  const v = await op('letters.void', { letter: letterId, reason: 'Wrong title' }, HR);
  eq(v.letter.status, 'void', 'void an issued letter');
  const docs2 = await op('documents.list', { employee: lina.number }, { as: 'lina@northwind.test' });
  ok(!docs2.documents.some((x) => x.source === 'letter'), 'a void letter leaves the person\'s documents');
}
{
  const salary = tpls.find((x) => x.kind === 'salary_certificate');
  // --kind alone: the kind's template for the person's entity or country, never an empty letter.
  const byKind = await op('letters.draft', { employee: sam.number, kind: 'salary_certificate', values: { purpose: 'a visa' } }, HR);
  ok(byKind.letter.template !== '' && byKind.letter.kind === 'salary_certificate' && byKind.letter.rendered.trim() !== '' && byKind.letter.rendered.indexOf('a visa') >= 0, '--kind without --template uses the template of that kind', { template: byKind.letter.template, kind: byKind.letter.kind });
  const pr = await call('letters.draft', { employee: sam.number, kind: 'salary_certificate', why: 'asked in chat' }, AGENT);
  ok(pr.status === 200 && pr.body.proposed === true && pr.body.preview.fields.some((f) => f.name === 'text' && f.after.trim() !== ''), 'your AI agent proposes the filled template, not an empty letter', pr.body);
  if (pr.body.proposal) await call('proposals.withdraw', { proposal: pr.body.proposal }, AGENT);
  // A kind with no template here (relieving, archived for the check): refused with what exists, then put back.
  const rel = tpls.filter((x) => x.kind === 'relieving');
  for (const x of rel) await op('letter-templates.save', { template: x.id, archived: true }, HR);
  const none = await call('letters.draft', { employee: sam.number, kind: 'relieving' }, HR);
  refused(none, 400, 'no_template', 'a kind with no template is refused');
  for (const x of rel) await op('letter-templates.save', { template: x.id, archived: false }, HR);
  refused(await call('letters.draft', { employee: sam.number }, HR), 400, 'missing_param', 'no template, kind or text: refused, never an empty draft');
  refused(await call('letters.draft', { employee: sam.number, kind: 'custom' }, HR), 400, 'missing_param', 'a custom letter needs its text');
  ok((await call('letters.delete', { letter: byKind.letter.id }, HR)).status === 200, 'the test draft is deleted');
  const d = await op('letters.draft', { employee: sam.number, template: salary.id }, HR);
  ok(d.letter.missing.indexOf('letter.purpose') >= 0, 'a custom value is missing until given', d.letter.missing);
  refused(await call('letters.issue', { letter: d.letter.id }, HR), 409, 'missing_values', 'cannot issue with a missing value');
  const u2 = await op('letters.update', { letter: d.letter.id, values: { purpose: 'a housing loan' } }, HR);
  ok(u2.letter.missing.length === 0 && u2.letter.rendered.indexOf('a housing loan') >= 0, 'the value fills in');
  refused(await call('letter-templates.save', { name: 'Bad', kind: 'custom', body: 'Hello {{employee.nam}}' }, HR), 400, 'unknown_placeholder', 'unknown placeholders are refused');
  await op('roles.add', { name: 'People officer', code: 'people_officer', levels: { people: 'full' } }, { as: 'owner', pin: true });
  const inv = await op('members.invite', { email: 'officer@northwind.test', name: 'Pat Officer', role: 'people_officer' }, { as: 'owner', pin: true });
  const j = await op('auth.accept-invite', { email: 'officer@northwind.test', code: inv.code, password: DEMO.password });
  api.setToken('officer@northwind.test', j.token);
  const OFF = { as: 'officer@northwind.test' };
  const d2 = await op('letters.draft', { employee: sam.number, template: appointment.id }, OFF);
  ok(d2.letter.hidden.indexOf('pay.amount') >= 0 && d2.letter.rendered.indexOf('[hidden]') >= 0, 'pay stays hidden from a role without payroll view');
  refused(await call('letters.issue', { letter: d2.letter.id }, OFF), 403, 'pay_hidden', 'and that role cannot issue a letter with pay');
}
{
  const ad = await op('letters.draft', { employee: sam.number, kind: 'custom', title: 'Visa support', body: 'Dear {{employee.name}}, ...' }, AGENT);
  ok(!!ad.proposal, 'your AI agent\'s draft is a proposal', ad);
  const rq = await op('letters.request-draft', { employee: sam.number, title: 'Visa support letter', instructions: 'For the Japan trip in March: confirm role and employment since the start day.' }, HR);
  ok(rq.letter.status === 'draft' && rq.letter.agent_drafting && rq.letter.agent.trigger === 'letter_draft' && rq.letter.agent.note.indexOf('Japan trip') >= 0, 'HR asks your AI agent: a draft and the letter_draft trigger with its instructions', rq);
  refused(await call('letters.request-draft', { employee: sam.number, instructions: 'x' }, AGENT), 403, 'agent_not_permitted', 'only people ask');
  const pu = await op('letters.update', { letter: rq.letter.id, body: '# Visa support\n\n{{letter.date}}\n\nThis confirms {{employee.legal_name}} works for {{entity.legal_name}} as {{job.title}} since {{employment.start_day}}.\n\n{{signer.name}}', why: 'From the records' }, AGENT);
  ok(!!pu.proposal, 'your AI agent writes the text as a proposal');
  const prop = (await op('proposals.list', {}, HR)).proposals.find((x) => x.items.some((i) => i.op === 'letters.update'));
  ok(prop && prop.items[0].fields.some((f) => f.name === 'body'), 'the proposal shows the text before and after', prop && prop.items[0].fields);
  await op('proposals.accept', { proposal: prop.id }, HR);
  const is = await op('letters.issue', { letter: rq.letter.id }, HR);
  ok(is.letter.status === 'issued' && is.letter.rendered.indexOf('Sam Wong Kai Xiang') >= 0, 'HR issues the drafted letter');
  ok(is.letter.agent.ended_at !== '' && is.letter.agent_drafting === false, 'the ask closed with your AI agent\'s text', is.letter.agent);
}

/* ------------------------------------------------------ separations */
section('separations');
let sepId = '';
const lastDay = add(today, 30);
{
  refused(await call('separations.request', { kind: 'termination', last_day: lastDay }, SAM), 403, 'not_permitted', 'an employee can only resign or retire');
  refused(await call('separations.request', { last_day: lastDay }, AGENT), 403, 'agent_not_permitted', 'your AI agent never starts a separation');
  const r = await op('separations.request', { kind: 'resignation', last_day: lastDay, reason: 'Moving to Melbourne', reason_code: 'relocation' }, SAM);
  sepId = r.separation.id;
  ok(r.separation.status === 'pending' && /^S\d{4}$/.test(r.separation.number), 'a resignation waits for approval', r.separation);
  refused(await call('separations.request', { kind: 'resignation', last_day: lastDay }, SAM), 409, 'duplicate', 'one open separation per employment');
  const mgrView = await op('separations.get', { separation: sepId }, MGR);
  ok(mgrView.separation.see === 'manager' && mgrView.separation.reason === undefined && mgrView.separation.reason_code === undefined, 'the manager sees no reason', mgrView.separation);
  const ap = await op('approvals.list', {}, MGR);
  const a = ap.approvals.find((x) => x.kind === 'separation');
  ok(!!a, 'step 1: the manager has it in the Inbox');
  refused(await call('approvals.decide', { approval: a.id, decision: 'approved' }, AGENT), 403, 'agent_not_permitted', 'your AI agent never approves');
  await op('approvals.decide', { approval: a.id, decision: 'approved', note: 'Sad to see you go' }, MGR);
  const s1 = await op('separations.get', { separation: sepId }, HR);
  eq(s1.separation.status, 'pending', 'still pending after the manager (HR step next)');
  const a2 = (await op('approvals.list', {}, HR)).approvals.find((x) => x.kind === 'separation');
  ok(!!a2, 'step 2: HR has it');
  if (STUBS) {
    if (REAL_EXP) {
      const own = (await op('claims.create', { title: 'Phone and internet, last month' }, SAM)).claim;
      await op('claim-lines.add', { claim: own.number, category: 'phone_internet', amount: '125.50', day: today, merchant: 'Singtel' }, SAM);
      eq(await approveAll((await op('claims.submit', { claim: own.number }, SAM)).approval.id), 'approved', 'a real expense claim approved');
      const adv = (await op('advances.request', { amount: '500.00', purpose: 'Float for the client visit' }, SAM)).advance;
      eq(await approveAll(adv.approval), 'approved', 'a real advance approved');
      await op('advances.mark-paid', { advance: adv.number, reference: 'TT-50000' }, OWNER);
    } else {
      await op('stubs.add', { kind: 'claim', employment: sam.employment, amount_minor: 12550, currency: 'SGD' }, OWNER);
      await op('stubs.add', { kind: 'advance', employment: sam.employment, amount_minor: 50000, currency: 'SGD' }, OWNER);
    }
    await op('stubs.add', { kind: 'loan', employment: sam.employment, amount_minor: 120000, currency: 'SGD' }, OWNER);
    if (!REAL_LEAVE) {
      await op('stubs.add', { kind: 'leave_type', code: 'annual', name: 'Annual leave', entity: SG.id }, OWNER);
      await op('stubs.add', { kind: 'leave', employment: sam.employment, code: 'annual', days: 4.5 }, OWNER);
    }
  }
  await op('approvals.decide', { approval: a2.id, decision: 'approved' }, HR);
  const s2 = (await op('separations.get', { separation: sepId }, HR)).separation;
  ok(s2.status === 'approved' && s2.checklist && s2.checklist.kind === 'offboarding', 'approved: offboarding started', s2);
  if (STUBS) ok(s2.settlement_payrun !== '' && s2.events.some((x) => x.module === 'payroll' && x.ok), 'separation.approved reached payroll, which answered with its termination run', s2.events);
  const emp = (await op('people.get', { employee: sam.number }, HR)).employments.find((x) => x.id === sam.employment);
  ok(emp.end_day === lastDay && emp.notice_day === today && emp.status === 'notice', 'the employment ends on the last day (kernel)', emp);
  const pf = ((await op('people.get', { employee: sam.number }, HR)).facts.find((x) => x.module === 'lifecycle') || { facts: [] }).facts;
  ok(pf.some((f) => f.key === 'lifecycle.last_day' && f.kind === 'date' && f.value === lastDay) && pf.some((f) => f.key === 'lifecycle.offboarding.open' && f.kind === 'count' && typeof f.value === 'number') && pf.every((f) => typeof f.key === 'string' && f.key !== ''), 'profile facts are typed: the last day as a date, open tasks as a count', pf);
  const off = (await op('checklists.get', { checklist: s2.checklist.id }, HR)).checklist;
  ok(off.anchor_day === lastDay && off.separation === sepId && off.tasks.some((x) => x.title.indexOf('Collect equipment') >= 0), 'offboarding counts from the last day', { a: off.anchor_day });
  ok(off.tasks.some((x) => x.assignee_kind === 'agent'), 'the offboarding has your AI agent\'s letter task');
}
section('exit interview');
{
  const mine = await op('separations.get', { separation: sepId }, SAM);
  ok(mine.separation.see === 'self' && mine.separation.exit_interview.questions.length >= 6 && mine.separation.can.exit_interview, 'the person gets the questions');
  refused(await call('separations.exit-interview', { separation: sepId, answers: { overall: 9 } }, SAM), 400, 'invalid_param', 'ratings are 1 to 5');
  refused(await call('separations.exit-interview', { separation: sepId, answers: { nope: 'x' } }, SAM), 400, 'invalid_param', 'unknown questions are refused');
  await op('separations.exit-interview', { separation: sepId, answers: { reason: 'Moving away', overall: 4, manager: 5, tools: 'yes', change: 'More remote days' }, done: true }, SAM);
  refused(await call('separations.exit-interview', { separation: sepId, answers: { overall: 1 } }, SAM), 409, 'conflict', 'sent once');
  const hr = await op('separations.get', { separation: sepId }, HR);
  ok(hr.separation.exit_interview.answers.change === 'More remote days', 'HR reads the answers');
  const ag = await op('separations.get', { separation: sepId }, AGENT);
  ok(ag.separation.exit_interview === undefined && ag.separation.exit_interview_done === true, 'your AI agent sees only that it was done');
  const mg = await op('separations.get', { separation: sepId }, MGR);
  ok(mg.separation.exit_interview === undefined, 'the manager never sees the answers');
  const audit = await op('audit.list', { collection: 'separations', record: sepId }, OWNER);
  ok(!JSON.stringify(audit).includes('More remote days') && !JSON.stringify(audit).includes('Moving to Melbourne'), 'answers and reasons stay out of the audit trail');
}
section('assets and the full and final statement');
{
  const a = await op('assets.add', { name: 'MacBook Air 13', category: 'laptop', serial: 'C02XYZ', value: '1899.00', entity: SG.id }, HR);
  ok(/^A\d{4}$/.test(a.asset.tag) && a.asset.value_minor === 189900 && a.asset.currency === 'SGD', 'an asset with a tag and a value in minor units', a.asset);
  await op('assets.issue', { asset: a.asset.tag, employee: sam.number }, HR);
  const card = await op('assets.add', { name: 'Access card', category: 'access_card', employee: sam.number, entity: SG.id }, HR);
  eq(card.asset.status, 'issued', 'issued at once with --employee');
  const prof = await op('lifecycle.profile', { employee: sam.number }, HR);
  eq(prof.assets.length, 2, 'the person\'s assets are on their profile');
  const fnf = STUBS ? await op('separations.settlement', { separation: sepId }, HR) : null;
  if (fnf !== null) {
  ok(fnf.pay.some((x) => x.kind === 'claim' && x.amount_minor === 12550), 'claims to reimburse (expenses contract)', fnf.pay);
  ok(fnf.recover.some((x) => x.kind === 'advance' && x.amount_minor === 50000) && fnf.recover.some((x) => x.kind === 'loan' && x.amount_minor === 120000), 'advances and loans to recover', fnf.recover);
  if (REAL_LEAVE) ok(Array.isArray(fnf.leave) && fnf.leave.every((x) => typeof x.balance === 'number' && x.balance !== 0), 'leave left to encash from the real leave module', fnf.leave);
  if (REAL_LEAVE && hasOp('leave.encashments')) {
    // Exactly what final pay pays: the leave module's approved exit cash-ins of this separation.
    const ex = (await op('leave.encashments', { employment: sam.employment, status: 'approved' }, HR)).encashments ?? [];
    const exits = ex.filter((x) => x.kind === 'exit');
    if (exits.length > 0) ok(fnf.leave_from === 'requests' && fnf.leave.length === exits.length && exits.every((x) => fnf.leave.some((l) => l.request === x.id && l.balance === Number(x.days))), 'leave rows are the exit cash-ins final pay will pay', { from: fnf.leave_from, leave: fnf.leave, exits });
    else ok(fnf.leave_from === 'balance', 'no exit cash-in: the balances of types paid out on exit', fnf.leave_from);
  }
  else ok(fnf.leave.some((x) => x.type === 'annual' && x.balance === 4.5), 'leave left to encash (leave contract)', fnf.leave);
  ok(fnf.recover.filter((x) => x.kind === 'asset').length === 2 && fnf.assets.length === 2, 'assets not returned', fnf.assets);
  const tot = fnf.totals.find((x) => x.currency === 'SGD');
  ok(tot && tot.source === 'estimate' && tot.pay_minor === 12550 && tot.recover_minor === 50000 + 120000 + 189900 && tot.net_minor === 12550 - (50000 + 120000 + 189900), 'before the final pay run: an estimate per currency', fnf.totals);
  ok(fnf.payrun && fnf.payrun.kind === 'termination' && fnf.payrun.calculated === false && fnf.payrun.net_minor === null, 'the termination run, not calculated yet', fnf.payrun);
  ok(fnf.leave.every((x) => x.amount_minor === null && x.valued === 'final_pay') && ['requests', 'balance'].includes(fnf.leave_from), 'leave days before the run are valued in final pay (payroll exposes no daily rate)', { from: fnf.leave_from, leave: fnf.leave });
  if (REAL_PAY && fnf.payrun) {
    let c = await op('payruns.calculate', { payrun: fnf.payrun.id }, PAY);
    for (let i = 0; i < 20 && c.done === false; i++) c = await op('payruns.calculate', { payrun: fnf.payrun.id, continue: true }, PAY);
    const run = await op('payruns.get', { payrun: fnf.payrun.id }, PAY);
    const slip = run.payslips.find((x) => x.employment === sam.employment);
    const after = await op('separations.settlement', { separation: sepId }, HR);
    const t2 = after.totals.find((x) => x.currency === 'SGD');
    ok(slip && t2 && t2.source === 'payrun' && t2.gross_minor === slip.gross_minor && t2.deductions_minor === slip.deductions_minor && t2.reimbursement_minor === slip.reimbursement_minor && t2.net_minor === slip.net_minor, 'after payroll calculates it: the totals are the final payslip', { t2, slip });
    ok(after.payrun.calculated === true && after.payrun.net_minor === slip.net_minor && typeof after.payrun.number === 'string', 'the run shows as calculated with its net', after.payrun);
    ok(after.leave_from === 'payrun' ? after.leave.every((x) => x.valued === 'payrun' && typeof x.amount_minor === 'number') : after.leave.every((x) => x.valued === 'final_pay'), 'leave rows: valued from the run when it pays them', { from: after.leave_from, leave: after.leave });
    const hidden = await op('separations.settlement', { separation: sepId }, AGENT).catch(() => null);
    if (hidden !== null && hidden.pay_hidden) ok(hidden.totals.every((x) => x.net_minor === null && x.gross_minor === null), 'no pay rights: no totals', hidden.totals);
  }
  }
  refused(await call('separations.settlement', { separation: sepId }, MGR), 403, 'not_permitted', 'the manager cannot see the statement');
  await op('assets.return', { asset: a.asset.tag, condition: 'good' }, HR);
  if (STUBS) eq((await op('separations.settlement', { separation: sepId }, HR)).assets.length, 1, 'a returned asset leaves the statement');
  refused(await call('assets.export', {}, AGENT), 403, 'agent_not_permitted', 'exports are for people');
  const pr = await op('assets.issue', { asset: a.asset.tag, employee: lina.number }, AGENT);
  ok(!!pr.proposal, 'your AI agent\'s asset change is a proposal');
  const chk = await op('assets.import-check', { csv: 'name,category,value,employee\nMonitor 27,monitor,320.00,' + lina.number + '\nBad,spaceship,1,\n' }, HR);
  ok(chk.ok === 1 && chk.errors.length === 1, 'the CSV check finds the bad row', chk);
  refused(await call('assets.import', { csv: 'name,category\nMonitor,monitor\nBad,spaceship\n' }, HR), 400, 'import_errors', 'an import with problems imports nothing');
  const imp = await op('assets.import', { csv: 'name,category,value,currency\nMonitor 27,monitor,320.00,SGD\nDock,peripheral,180.00,SGD\n' }, HR);
  eq(imp.imported, 2, 'a clean CSV imports');
}
section('last day moves after approval');
{
  const newLast = add(lastDay, 7);
  const before = (await op('checklists.list', { employee: sam.number, kind: 'offboarding' }, HR)).checklists[0];
  const tBefore = (await op('checklists.get', { checklist: before.id }, HR)).checklist.tasks.find((x) => x.status === 'open' && x.due !== '');
  const r = await op('separations.update', { separation: sepId, last_day: newLast }, HR);
  ok(r.separation.last_day === newLast && r.events.length >= 0, 'the last day moves');
  const emp = (await op('people.get', { employee: sam.number }, HR)).employments.find((x) => x.id === sam.employment);
  eq(emp.end_day, newLast, 'the employment end moves with it');
  const tAfter = (await op('checklists.get', { checklist: before.id }, HR)).checklist.tasks.find((x) => x.id === tBefore.id);
  eq(tAfter.due, add(tBefore.due, 7), 'offboarding due days move by the same days');
}
section('withdraw');
{
  const haru = byEmail('haruto@northwind.test');
  const r = await op('separations.request', { employment: haru.number, kind: 'termination', last_day: add(today, 14), reason: 'Performance', reason_code: 'performance', rehire_eligible: 'no' }, HR);
  const w = await op('separations.withdraw', { separation: r.separation.id, note: 'Resolved' }, HR);
  eq(w.separation.status, 'withdrawn', 'HR withdraws a pending separation');
  const ap = await op('approvals.get', { approval: r.separation.approval }, OWNER);
  eq(ap.approval.status, 'cancelled', 'its approval is cancelled');
  refused(await call('separations.withdraw', { separation: sepId }, SAM), 409, 'conflict', 'an approved separation cannot be withdrawn');
}

/* --------------------------------------------------------- handbook */
section('handbook');
{
  const pg = await op('handbook.save', { title: 'Working hours', category: 'Time', body: '# Working hours\n\nCore hours are 10:00 to 16:00.', needs_ack: true }, HR);
  const pid = pg.page.id;
  let l = await op('handbook.list', {}, SAM);
  eq(l.pages.length, 0, 'a draft is not shown to people');
  const pub = await op('handbook.publish', { page: pid, note: 'First version' }, HR);
  ok(pub.page.version === 1 && pub.notified > 0, 'published as version 1 and people told', { v: pub.page.version, n: pub.notified });
  l = await op('handbook.list', {}, SAM);
  ok(l.pages.length === 1 && l.pages[0].to_ack && l.to_ack === 1, 'people see it to acknowledge');
  await op('handbook.save', { page: pid, body: '# Working hours\n\nCore hours are 10:00 to 15:00.' }, HR);
  const read = await op('handbook.get', { page: pid }, SAM);
  ok(read.page.body.indexOf('16:00') >= 0, 'people read the published version until the draft is published');
  await op('handbook.acknowledge', { page: pid }, SAM);
  ok((await op('handbook.list', {}, SAM)).to_ack === 0, 'acknowledged');
  await op('handbook.publish', { page: pid }, HR);
  ok((await op('handbook.list', {}, SAM)).to_ack === 1, 'a new version asks again');
  const acks = await op('handbook.acks', { page: pid }, HR);
  ok(acks.total > 0 && acks.acked === 0, 'HR sees who has acknowledged the current version', { acked: acks.acked, total: acks.total });
  const txt = await op('handbook.text', { employee: sam.number }, AGENT);
  ok(txt.pages.length === 1 && txt.pages[0].version === 2 && txt.pages[0].body.indexOf('15:00') >= 0, 'your AI agent reads the published text with its version');
  const ap = await op('handbook.save', { title: 'Remote work', body: 'Two days a week.' }, AGENT);
  ok(!!ap.proposal, 'your AI agent\'s page is a proposal');
  refused(await call('handbook.publish', { page: pid }, AGENT), 403, 'agent_not_permitted', 'publishing is for people');
  refused(await call('handbook.save', { title: 'X' }, SAM), 403, 'not_permitted', 'employees cannot edit');
  const v1 = await op('handbook.get', { page: pid, version: '1' }, HR);
  ok(v1.page.version_body.indexOf('16:00') >= 0 && v1.page.versions.length === 2, 'HR reads older versions');
}

/* ------------------------------------------------------- grievances */
section('grievances');
{
  const harass = (await op('grievance-types.list', {}, SAM)).types.find((x) => x.code === 'harassment');
  const g = await op('grievances.report', { type: harass.code, subject: 'Comments in meetings', description: 'Repeated remarks about my accent.', against: meiLin.number, anonymous: true }, SAM);
  const gid = g.grievance.id;
  ok(g.grievance.see === 'reporter' && g.grievance.status === 'open', 'the person reports a concern');
  const hr = await op('grievances.get', { grievance: gid }, HR);
  ok(hr.grievance.reporter_name === 'Anonymous' && hr.grievance.reporter === '' && hr.grievance.description.indexOf('accent') >= 0, 'HR sees the case but not the anonymous reporter');
  refused(await call('grievances.get', { grievance: gid }, MGR), 403, 'not_permitted', 'the manager never sees it');
  eq((await op('grievances.list', {}, MGR)).grievances.length, 0, 'not even in a list');
  refused(await call('grievances.get', { grievance: gid }, AGENT), 403, 'agent_not_permitted', 'your AI agent does not see it');
  const al = await op('grievances.list', {}, AGENT);
  ok(al.grievances.length === 0 && al.not_shared_active === 1, 'your AI agent sees only the count');
  refused(await call('grievances.assign', { grievance: gid, member: 'eng.lead@northwind.test' }, HR), 409, 'conflict_of_interest', 'the person concerned cannot investigate');
  await op('grievances.assign', { grievance: gid, member: 'payroll@northwind.test' }, HR);
  const inv = await op('grievances.get', { grievance: gid }, PAY);
  ok(inv.grievance.see === 'assignee' && inv.grievance.status === 'investigating', 'the investigator sees it and it is investigating');
  await op('grievances.note', { grievance: gid, text: 'Spoke to two witnesses.' }, PAY);
  await op('grievances.note', { grievance: gid, text: 'We are looking into this and will update you within a week.', visible_to_reporter: true }, HR);
  const rep = await op('grievances.get', { grievance: gid }, SAM);
  ok(rep.grievance.notes.length === 1 && rep.grievance.notes[0].text.indexOf('within a week') >= 0 && rep.grievance.assignee === undefined, 'the reporter sees only the notes for them');
  await op('grievances.share', { grievance: gid, agent: true }, HR);
  const ag = await op('grievances.get', { grievance: gid }, AGENT);
  ok(ag.grievance.see === 'agent', 'shared with your AI agent, it can read the case');
  refused(await call('grievances.status', { grievance: gid, status: 'resolved' }, HR), 400, 'missing_param', 'a resolution is needed to resolve');
  await op('grievances.status', { grievance: gid, status: 'resolved', resolution: 'Coaching given; the remarks stopped.' }, PAY);
  const done2 = await op('grievances.get', { grievance: gid }, SAM);
  ok(done2.grievance.status === 'resolved' && done2.grievance.resolution.indexOf('Coaching') >= 0, 'the reporter sees the outcome');
  const audit = await op('audit.list', { collection: 'grievances', record: gid }, OWNER);
  ok(!JSON.stringify(audit).includes('accent') && !JSON.stringify(audit).includes('witnesses'), 'grievance text stays out of the audit trail');
  const notes = await op('notifications.list', {}, HR);
  ok(notes.notifications.some((x) => x.kind === 'grievance' && x.title.indexOf('accent') < 0), 'HR was told without the details');
}

/* ------------------------------------------------- home and the job */
section('home, profile and the daily job');
{
  const h = await op('lifecycle.home', { days: 60 }, HR);
  ok(h.hr && h.leaving.some((x) => x.employee === sam.employee) && typeof h.grievances_open === 'number' && h.letters_to_issue >= 1, 'HR home: leaving people, letters to issue, grievances', { leaving: h.leaving.length, g: h.grievances_open, l: h.letters_to_issue });
  const hm = await op('lifecycle.home', { days: 60 }, MGR);
  ok(hm.grievances_open === undefined && hm.letters_to_issue === undefined && hm.leaving.some((x) => x.employee === sam.employee), 'manager home: their leaver, no HR counts', hm);
  const he = await op('lifecycle.home', {}, HARUTO);
  ok(he.starting.length === 0 && he.leaving.length === 0 && he.grievances_open === undefined, 'employee home: only their own tasks');
  const pf = await op('lifecycle.profile', { employee: sam.number }, MGR);
  ok(pf.separations.length === 1 && pf.separations[0].reason === undefined, 'the manager\'s profile tab hides the reason');
  refused(await call('lifecycle.profile', { employee: sam.number }, HARUTO), 403, 'not_permitted', 'another employee cannot open the tab');
  if (STUBS) {
  const before = (await op('notifications.list', {}, MGR)).total;
  const cron = await op('stubs.cron', { day: add(today, 60) }, { as: 'owner', pin: false });
  ok(cron.reminded > 0, 'the daily job sends reminders for due and overdue tasks', cron);
  const after = await op('notifications.list', {}, MGR);
  ok(after.total > before && after.notifications.some((x) => x.kind === 'task'), 'the manager got a digest', after.notifications.slice(0, 3));
  const again = await op('stubs.cron', { day: add(today, 60) }, OWNER);
  eq(again.reminded, 0, 'once a day only');
  const done3 = await op('stubs.cron', { day: add(today, 90) }, OWNER);
  ok(done3.completed === 0, 'a separation with open offboarding is not completed');
  }
}

done('t02_flows');
