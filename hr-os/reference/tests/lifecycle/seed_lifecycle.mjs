/**
 * Lifecycle demo data on top of tools/dev/seed_demo.mjs (through the ops
 * only): a new hire starting in 10 days with onboarding and a sign-in, a
 * resignation approved by the manager and HR, letters (a draft, an issued
 * one, one your AI agent is drafting), assets, a published handbook page,
 * a reported concern. Returns the ids the screenshot pass opens.
 */
import { DEMO, hasOp, hasStubs } from './lib.mjs';

export async function seedLifecycle(api) {
  const OWNER = { as: 'owner' };
  const HR = { as: 'hr@northwind.test' };
  const op = (n, p, o) => api.op(n, p || {}, o);
  const me = await op('auth.me', {}, OWNER);
  const add = (d, n) => {
    const t = new Date(d + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  const today = me.today;
  const ents = (await op('entities.list', {}, OWNER)).entities;
  const SG = ents.find((e) => e.country === 'SG');
  const JP = ents.find((e) => e.country === 'JP');
  const dir = (await op('people.directory', { status: 'all', limit: 100 }, OWNER)).people;
  const byEmail = (email) => dir.find((x) => x.work_email === email);
  const meiLin = byEmail('eng.lead@northwind.test');
  const sam = byEmail('sam@northwind.test');

  const hired = await op('people.hire', { entity: SG.id, legal_name: 'Tan Li Na', family_name: 'Tan', given_name: 'Li Na', name_order: 'family_first', preferred_name: 'Li Na Tan', work_email: 'lina@northwind.test', start_day: add(today, 10), probation_end: add(today, 100), title: 'Software Engineer', department: 'Engineering', location: 'Singapore HQ', manager: meiLin.employee, pay_basis: 'salary', pay_amount: '7200.00', pay_per: 'month' }, HR);
  const lina = hired.employee;
  const inv = await op('members.invite', { email: 'lina@northwind.test', name: 'Li Na Tan', role: 'employee', employee: lina.id }, { as: 'owner', pin: true });
  const j = await op('auth.accept-invite', { email: 'lina@northwind.test', code: inv.code, password: DEMO.password });
  api.setToken('lina@northwind.test', j.token);
  await op('people.hire', { entity: JP.id, legal_name: 'Kobayashi Mio', family_name: 'Kobayashi', given_name: 'Mio', name_order: 'family_first', preferred_name: 'Mio Kobayashi', start_day: add(today, 21), title: 'Account Executive', department: 'Sales', location: 'Tokyo Office' }, HR);
  const board = (await op('checklists.list', { employee: lina.number }, HR)).checklists[0];
  await op('checklists.first-day', { checklist: board.id, time: '09:30', place: 'Level 12 reception, 1 Raffles Place', contact: meiLin.number, bring: 'Passport and bank details', note: 'We have lunch with the team on your first day.' }, HR);
  const tasks = (await op('checklists.get', { checklist: board.id }, HR)).checklist.tasks;
  for (const tk of tasks.filter((x) => x.assignee_kind === 'hr').slice(0, 2)) await op('tasks.complete', { task: tk.id, note: 'Sent' }, HR);
  const at = tasks.find((x) => x.assignee_kind === 'agent');
  if (at) await op('tasks.complete', { task: at.id, note: 'Welcome note: Hi Li Na, we are glad you are joining the Engineering team...\nFirst week: Monday setup and buddy lunch; Tuesday codebase tour; Wednesday first small change.' }, { as: 'agent' });

  const tpls = (await op('letter-templates.list', {}, HR)).templates;
  const appointment = tpls.find((x) => x.kind === 'appointment');
  const draft = (await op('letters.draft', { employee: lina.number, template: appointment.id }, HR)).letter;
  const salary = tpls.find((x) => x.kind === 'salary_certificate');
  const issued = (await op('letters.draft', { employee: sam.number, template: salary.id, values: { purpose: 'a housing loan' } }, HR)).letter;
  await op('letters.issue', { letter: issued.id }, HR);
  await op('letters.request-draft', { employee: sam.number, title: 'Visa support letter', instructions: 'For the Japan trip in March: confirm role and employment since the start day.' }, HR);

  // A claim to reimburse and an advance to recover for the full and final statement (real expenses module).
  if (hasOp('claims.create')) {
    const SAM = { as: 'sam@northwind.test' };
    const approveAll = async (id) => {
      for (let i = 0; i < 5; i++) {
        const a = (await op('approvals.get', { approval: id }, OWNER)).approval;
        if (a.status !== 'pending') return;
        let moved = false;
        for (const as of [{ as: 'eng.lead@northwind.test' }, HR, { as: 'payroll@northwind.test' }, OWNER]) {
          const m = await op('auth.me', {}, as);
          if (a.approvers.includes(m.member.id)) {
            await op('approvals.decide', { approval: id, decision: 'approved' }, as);
            moved = true;
            break;
          }
        }
        if (!moved) return;
      }
    };
    // A claim of its own, never Sam's open draft (another seed may leave lines there that block submitting).
    const own = (await op('claims.create', { title: 'Phone and internet, last month' }, SAM)).claim;
    await op('claim-lines.add', { claim: own.number, category: 'phone_internet', amount: '125.50', day: today, merchant: 'Singtel' }, SAM);
    await approveAll((await op('claims.submit', { claim: own.number }, SAM)).approval.id);
    const adv = (await op('advances.request', { amount: '500.00', purpose: 'Float for the client visit' }, SAM)).advance;
    await approveAll(adv.approval);
    await op('advances.mark-paid', { advance: adv.number, reference: 'TT-50000' }, OWNER);
  }
  const sep = (await op('separations.request', { kind: 'resignation', last_day: add(today, 24), reason: 'Moving to Melbourne with my family', reason_code: 'relocation' }, { as: 'sam@northwind.test' })).separation;
  const a1 = (await op('approvals.list', {}, { as: 'eng.lead@northwind.test' })).approvals.find((x) => x.kind === 'separation');
  await op('approvals.decide', { approval: a1.id, decision: 'approved' }, { as: 'eng.lead@northwind.test' });
  const a2 = (await op('approvals.list', {}, HR)).approvals.find((x) => x.kind === 'separation');
  await op('approvals.decide', { approval: a2.id, decision: 'approved' }, HR);
  if (hasStubs() && !hasOp('claims.create')) {
    await op('stubs.add', { kind: 'claim', employment: sam.employment, amount_minor: 12550, currency: 'SGD' }, OWNER);
    await op('stubs.add', { kind: 'advance', employment: sam.employment, amount_minor: 50000, currency: 'SGD' }, OWNER);
  }
  if (hasStubs()) {
    if (!hasOp('leave.balance')) {
      await op('stubs.add', { kind: 'leave_type', code: 'annual', name: 'Annual leave', entity: SG.id }, OWNER);
      await op('stubs.add', { kind: 'leave', employment: sam.employment, code: 'annual', days: 4.5 }, OWNER);
    }
  }

  const laptop = (await op('assets.add', { name: 'MacBook Air 13', category: 'laptop', serial: 'C02XK1', value: '1899.00', entity: SG.id, employee: sam.number }, HR)).asset;
  await op('assets.add', { name: 'Access card', category: 'access_card', entity: SG.id, employee: sam.number }, HR);
  await op('assets.add', { name: 'Dell U2723QE monitor', category: 'monitor', value: '780.00', entity: SG.id }, HR);
  await op('assets.add', { name: 'iPhone 15', category: 'phone', serial: 'F2LX9', value: '1299.00', entity: SG.id, employee: meiLin.number }, HR);

  const page = (await op('handbook.save', { title: 'Working hours', category: 'Time', needs_ack: true, body: '# Working hours\n\nCore hours are **10:00 to 16:00**. Outside them you plan your day with your team.\n\n## Remote days\n\n- Up to two days a week from home\n- Tell your manager the week before\n\n## Overtime\n\nAsk your manager first. Overtime is paid or given back as time off, as your contract says.' }, HR)).page;
  await op('handbook.publish', { page: page.id, note: 'First version' }, HR);
  const p2 = (await op('handbook.save', { title: 'Expenses and travel', category: 'Money', body: '# Expenses and travel\n\nKeep every receipt. Claims are paid with the next payroll.' }, HR)).page;
  await op('handbook.publish', { page: p2.id }, HR);

  const g = (await op('grievances.report', { type: 'conditions', subject: 'Air conditioning on level 12', description: 'The air conditioning has been off for two weeks in the afternoon.', anonymous: false }, { as: 'sam@northwind.test' })).grievance;
  await op('grievances.note', { grievance: g.id, text: 'Facilities are checking the unit this week.', visible_to_reporter: true }, HR);

  return { board: board.id, draft: draft.id, issued: issued.id, separation: sep.id, laptop: laptop.id, page: page.id, grievance: g.id, appointment: appointment.id, lina: lina.number, sam: sam.number };
}
