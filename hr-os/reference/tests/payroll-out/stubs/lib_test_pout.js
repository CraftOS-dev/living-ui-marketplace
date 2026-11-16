/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH ONLY (payroll-out tests, never copied to APP): insert locked pay
 * runs with payslips and lines, and active bank accounts, so payroll-out
 * can be tested without payroll-core's calculation.
 */
let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

let seq = 0;

function seedRun(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const entity = u.byIdOrName(app, 'entities', p.entity, 'name');
  const slips = u.list(p, 'slips') || [];
  let out = null;
  app.runInTransaction((tx) => {
    const run = u.newRecord(tx, 'payruns');
    seq += 1;
    const n = u.count(tx, 'SELECT COUNT(*) AS n FROM payruns') + 1;
    run.set('entity', entity.id);
    run.set('kind', p.kind || 'regular');
    run.set('number', 'PR-T' + String(n).padStart(4, '0'));
    run.set('label', p.label || '');
    run.set('period_start', p.period_start);
    run.set('period_end', p.period_end);
    run.set('pay_date', p.pay_date);
    run.set('status', p.status || 'locked');
    run.set('currency', entity.getString('currency'));
    run.set('version', 1);
    run.set('year_end', p.year_end === true || p.year_end === 'true');
    if (p.status !== 'draft') run.set('locked_at', u.nowIso());
    tx.save(run);
    const tot = { gross: 0, ded: 0, er: 0, re: 0, net: 0, pre: 0, stat: 0, post: 0 };
    for (const s of slips) {
      const emp = u.findOne(tx, 'employees', 'number = {:n}', { n: s.employee });
      const em = u.findOne(tx, 'employments', 'employee = {:e} && entity = {:x}', { e: emp.id, x: entity.id }) || u.findOne(tx, 'employments', 'employee = {:e}', { e: emp.id });
      const t = { gross: 0, pre: 0, stat: 0, post: 0, er: 0, re: 0 };
      for (const l of s.lines) {
        if (l.kind === 'earning') t.gross += l.amount_minor;
        else if (l.kind === 'deduction') t[l.stage === 'pre' ? 'pre' : l.stage === 'statutory' ? 'stat' : 'post'] += l.amount_minor;
        else if (l.kind === 'employer') t.er += l.amount_minor;
        else if (l.kind === 'reimbursement') t.re += l.amount_minor;
      }
      const ded = t.pre + t.stat + t.post;
      const net = t.gross - ded + t.re;
      const slip = u.newRecord(tx, 'payslips');
      slip.set('payrun', run.id);
      slip.set('employment', em.id);
      slip.set('employee', emp.id);
      slip.set('entity', entity.id);
      slip.set('kind', p.kind || 'regular');
      slip.set('period_start', p.period_start);
      slip.set('period_end', p.period_end);
      slip.set('pay_date', p.pay_date);
      slip.set('currency', entity.getString('currency'));
      slip.set('gross_minor', t.gross);
      slip.set('pre_minor', t.pre);
      slip.set('statutory_minor', t.stat);
      slip.set('post_minor', t.post);
      slip.set('deductions_minor', ded);
      slip.set('employer_minor', t.er);
      slip.set('reimbursement_minor', t.re);
      slip.set('net_minor', net);
      slip.set('status', p.status === 'draft' ? 'calculated' : 'locked');
      slip.set('pay_method', s.pay_method || 'bank');
      slip.set('held', s.held === true);
      tx.save(slip);
      let sort = 0;
      for (const l of s.lines) {
        const line = u.newRecord(tx, 'payslip_lines');
        line.set('payslip', slip.id);
        line.set('payrun', run.id);
        line.set('employment', em.id);
        line.set('code', l.code);
        line.set('name', l.name || l.code);
        line.set('kind', l.kind);
        line.set('stage', l.stage || '');
        line.set('amount_minor', l.amount_minor);
        line.set('source', l.source || (l.payee ? 'pack' : 'input'));
        line.set('tags', l.tags || []);
        line.set('payee', l.payee || '');
        line.set('filing', l.filing || '');
        line.set('pack', l.pack || '');
        line.set('component', l.component || '');
        line.set('sort', sort++);
        tx.save(line);
      }
      tot.gross += t.gross;
      tot.ded += ded;
      tot.er += t.er;
      tot.re += t.re;
      tot.net += net;
    }
    run.set('employee_count', slips.length);
    run.set('gross_minor', tot.gross);
    run.set('deductions_minor', tot.ded);
    run.set('employer_minor', tot.er);
    run.set('reimbursement_minor', tot.re);
    run.set('net_minor', tot.net);
    tx.save(run);
    out = { id: run.id, number: run.getString('number'), net_minor: tot.net };
  });
  ctx.audited = true;
  return out;
}

function bank(ctx, p) {
  const u = L('lib_util');
  const seal = L('lib_seal');
  const app = ctx.app;
  const emp = u.findOne(app, 'employees', 'number = {:n}', { n: p.employee });
  for (const old of app.findRecordsByFilter('bank_accounts', 'employee = {:e}', '', 0, 0, { e: emp.id })) app.delete(old);
  const out = [];
  for (const a of u.list(p, 'accounts') || []) {
    const r = u.newRecord(app, 'bank_accounts');
    r.set('employee', emp.id);
    r.set('label', a.label || 'Salary');
    r.set('country', a.country || '');
    r.set('bank_name', a.bank_name || '');
    r.set('bank_code', a.bank_code || '');
    r.set('branch_code', a.branch_code || '');
    r.set('account_type', a.account_type || '');
    r.set('holder', a.holder || '');
    if (a.number) {
      r.set('number_sealed', seal.seal(app, a.number));
      r.set('number_masked', seal.mask(a.number, 'last4'));
    }
    if (a.iban) {
      r.set('iban_sealed', seal.seal(app, a.iban));
      r.set('iban_masked', seal.mask(a.iban, 'last4'));
    }
    r.set('swift', a.swift || '');
    r.set('split', a.split || { kind: 'rest' });
    r.set('status', a.status || 'active');
    app.save(r);
    out.push(r.id);
  }
  ctx.audited = true;
  return { accounts: out };
}

function kana(ctx, p) {
  const u = L('lib_util');
  const emp = u.findOne(ctx.app, 'employees', 'number = {:n}', { n: p.employee });
  emp.set('kana', u.obj(p, 'kana'));
  ctx.app.save(emp);
  ctx.audited = true;
  return { ok: true };
}

/** Void a run as payroll-core does (status void, then the payrun.voided event). */
function voidRun(ctx, p) {
  const u = L('lib_util');
  const run = u.byId(ctx.app, 'payruns', String(p.payrun || '')) || u.findOne(ctx.app, 'payruns', 'number = {:n}', { n: String(p.payrun || '') });
  run.set('status', 'void');
  ctx.app.save(run);
  ctx.audited = true;
  const events = L('lib_events').emit(ctx, 'payrun.voided', { payrun: run.id, replaced_by: '' });
  return { id: run.id, events: events };
}

module.exports = { seedRun: seedRun, bank: bank, kana: kana, voidRun: voidRun };
