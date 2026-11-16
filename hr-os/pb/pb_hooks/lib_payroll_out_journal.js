/// <reference path="../pb_data/types.d.ts" />
/**
 * The GL journal of a pay run: debits and credits by account, split by the
 * employments' cost centre and department, balanced, in three layouts
 * (generic CSV, Xero manual journal CSV, QuickBooks journal CSV).
 *
 * Accounts per line: the pay component's gl_account (debit) and
 * liability_account (credit); else the entity's GL settings by line code,
 * then by payee, then the defaults. Each payslip balances by itself:
 * earnings + reimbursements + employer cost = deductions + employer
 * liabilities + net pay, so every cost centre and department group balances.
 *
 * build() is pure (Node tests call it); the ops read the database.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const ROLES = {
  wages_expense: 'Wages and salaries',
  employer_expense: 'Employer taxes and contributions',
  reimbursement_expense: 'Employee reimbursements',
  liabilities: 'Payroll liabilities',
  net_pay: 'Net pay (bank clearing)',
};

const FORMATS = {
  generic_csv: { name: 'Generic CSV', label: 'One row per account, cost centre and department' },
  xero_csv: { name: 'Xero manual journal CSV', label: 'Check the column mapping on import: Xero manual journal template, positive debits and negative credits' },
  quickbooks_csv: { name: 'QuickBooks journal CSV', label: 'Check the column mapping on import: QuickBooks Online journal entry import' },
};

/** GL settings as stored: account codes as short text, maps by code and payee. */
function cleanGl(gl) {
  const t = (v) => String(v === undefined || v === null ? '' : v).trim().slice(0, 60);
  const out = {};
  for (const k of Object.keys(ROLES)) if (gl[k] !== undefined) out[k] = t(gl[k]);
  out.by_code = {};
  for (const code of Object.keys(gl.by_code || {})) {
    const v = gl.by_code[code] || {};
    out.by_code[String(code).toUpperCase().slice(0, 40)] = { debit: t(v.debit), credit: t(v.credit) };
  }
  out.by_payee = {};
  for (const payee of Object.keys(gl.by_payee || {})) out.by_payee[String(payee).slice(0, 80)] = t(gl.by_payee[payee]);
  if (gl.xero_tax_rate !== undefined) out.xero_tax_rate = t(gl.xero_tax_rate) || 'Tax Exempt';
  return out;
}

function accountFor(role, gl, warn) {
  const v = (gl && gl[role]) || '';
  if (v !== '') return v;
  warn[role] = true;
  return ROLES[role];
}

/**
 * input = { run: { number, pay_date, currency }, gl, components: { <id or code>: { gl_account, liability_account } },
 *           slips: [{ payslip, cost_center, department, net_minor, lines: [{ code, name, kind, amount_minor, component, payee }] }] }
 * -> { lines: [{ account, description, debit_minor, credit_minor, cost_center, department }], debit_minor, credit_minor, balanced, unset: [roles], problems }
 */
function build(input) {
  const gl = input.gl || {};
  const byCode = gl.by_code || {};
  const byPayee = gl.by_payee || {};
  const comps = input.components || {};
  const warn = {};
  const groups = {};
  const order = [];
  const problems = [];
  const post = (account, description, signed, cc, dept) => {
    if (signed === 0) return;
    const key = account + '\u0001' + cc + '\u0001' + dept + '\u0001' + description;
    if (groups[key] === undefined) {
      groups[key] = { account: account, description: description, value: 0, cost_center: cc, department: dept };
      order.push(key);
    }
    groups[key].value += signed;
  };
  for (const s of input.slips || []) {
    const cc = s.cost_center || '';
    const dept = s.department || '';
    let debit = 0;
    let credit = 0;
    for (const l of s.lines || []) {
      const a = Number(l.amount_minor) || 0;
      if (a === 0 || l.kind === 'info') continue;
      const comp = comps[l.component] || comps[l.code] || {};
      const map = byCode[l.code] || {};
      const payeeAcct = l.payee ? byPayee[l.payee] || '' : '';
      if (l.kind === 'earning') {
        post(comp.gl_account || map.debit || accountFor('wages_expense', gl, warn), ROLES.wages_expense, a, cc, dept);
        debit += a;
      } else if (l.kind === 'reimbursement') {
        post(comp.gl_account || map.debit || (gl.reimbursement_expense ? gl.reimbursement_expense : accountFor('wages_expense', gl, warn)), ROLES.reimbursement_expense, a, cc, dept);
        debit += a;
      } else if (l.kind === 'deduction') {
        post(comp.liability_account || map.credit || payeeAcct || accountFor('liabilities', gl, warn), ROLES.liabilities + (l.payee ? ': ' + l.payee : ''), -a, cc, dept);
        credit += a;
      } else if (l.kind === 'employer') {
        post(comp.gl_account || map.debit || accountFor('employer_expense', gl, warn), ROLES.employer_expense, a, cc, dept);
        post(comp.liability_account || map.credit || payeeAcct || accountFor('liabilities', gl, warn), ROLES.liabilities + (l.payee ? ': ' + l.payee : ''), -a, cc, dept);
        debit += a;
        credit += a;
      }
    }
    const net = Number(s.net_minor) || 0;
    post(accountFor('net_pay', gl, warn), ROLES.net_pay, -net, cc, dept);
    credit += net;
    if (debit !== credit) problems.push({ payslip: s.payslip, code: 'slip_unbalanced', message: 'Payslip ' + s.payslip + ': lines give ' + debit + ' against ' + credit + ' (net pay does not match its lines)' });
  }
  const lines = [];
  let dr = 0;
  let cr = 0;
  for (const k of order) {
    const g = groups[k];
    if (g.value === 0) continue;
    const line = { account: g.account, description: g.description, debit_minor: g.value > 0 ? g.value : 0, credit_minor: g.value < 0 ? -g.value : 0, cost_center: g.cost_center, department: g.department };
    dr += line.debit_minor;
    cr += line.credit_minor;
    lines.push(line);
  }
  lines.sort((a, b) => (a.cost_center + a.department).localeCompare(b.cost_center + b.department) || (b.debit_minor > 0 ? 1 : 0) - (a.debit_minor > 0 ? 1 : 0) || a.account.localeCompare(b.account));
  return { lines: lines, debit_minor: dr, credit_minor: cr, balanced: dr === cr && problems.length === 0, unset: Object.keys(warn), problems: problems };
}

function major(minor, currency) {
  const B = require(`${typeof __hooks === 'string' ? __hooks : '.'}/lib_bankfiles.js`);
  return B.majorText(minor, B.exponentOf(currency));
}

function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function usDate(day) {
  return day.slice(5, 7) + '/' + day.slice(8, 10) + '/' + day.slice(0, 4);
}

function dmyDate(day) {
  return day.slice(8, 10) + '/' + day.slice(5, 7) + '/' + day.slice(0, 4);
}

/** The CSV text of a built journal in one layout. */
function csv(format, run, built, opts) {
  const o = opts || {};
  const cur = run.currency;
  const rows = [];
  const date = o.country === 'US' ? usDate(run.pay_date) : dmyDate(run.pay_date);
  const narration = 'Payroll ' + run.number + ' ' + run.pay_date;
  if (format === 'xero_csv') {
    rows.push(['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Amount', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2']);
    for (const l of built.lines) rows.push([narration, date, l.description, l.account, o.tax_rate || 'Tax Exempt', l.debit_minor > 0 ? major(l.debit_minor, cur) : '-' + major(l.credit_minor, cur), l.department ? 'Department' : '', l.department, l.cost_center ? 'Cost centre' : '', l.cost_center]);
  } else if (format === 'quickbooks_csv') {
    rows.push(['JournalNo', 'JournalDate', 'AccountName', 'Debits', 'Credits', 'Description', 'Name', 'Location', 'Class', 'Currency']);
    for (const l of built.lines) rows.push([run.number, date, l.account, l.debit_minor > 0 ? major(l.debit_minor, cur) : '', l.credit_minor > 0 ? major(l.credit_minor, cur) : '', l.description, '', l.cost_center, l.department, cur]);
  } else {
    rows.push(['date', 'journal', 'account', 'description', 'debit', 'credit', 'currency', 'cost_center', 'department']);
    for (const l of built.lines) rows.push([run.pay_date, run.number, l.account, l.description, l.debit_minor > 0 ? major(l.debit_minor, cur) : '', l.credit_minor > 0 ? major(l.credit_minor, cur) : '', cur, l.cost_center, l.department]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/* ---------------------------------------------------------------- data */

/** The journal input of a locked or paid run. */
function inputOf(app, run, gl) {
  const u = L('lib_util');
  const slips = u.rows(app, "SELECT id, employment, net_minor, period_end FROM payslips WHERE payrun = {:r} AND status != 'void' ORDER BY id", { id: '', employment: '', net_minor: 0, period_end: '' }, { r: run.id });
  const lines = u.rows(app, 'SELECT payslip, code, name, kind, amount_minor, component, payee FROM payslip_lines WHERE payrun = {:r} ORDER BY payslip, sort', { payslip: '', code: '', name: '', kind: '', amount_minor: 0, component: '', payee: '' }, { r: run.id });
  const byslip = {};
  for (const l of lines) (byslip[l.payslip] = byslip[l.payslip] || []).push(l);
  const comps = {};
  for (const c of u.rows(app, "SELECT id, code, gl_account, liability_account FROM pay_components WHERE entity = {:e} OR entity = ''", { id: '', code: '', gl_account: '', liability_account: '' }, { e: run.getString('entity') })) {
    const v = { gl_account: c.gl_account, liability_account: c.liability_account };
    comps[c.id] = v;
    if (comps[c.code] === undefined || c.gl_account !== '' || c.liability_account !== '') comps[c.code] = v;
  }
  const out = [];
  const ccCache = {};
  const deptCache = {};
  for (const s of slips) {
    const job = u.one(app, 'SELECT cost_center, department FROM job_records WHERE employment = {:e} AND effective_from <= {:d} ORDER BY effective_from DESC LIMIT 1', { cost_center: '', department: '' }, { e: s.employment, d: s.period_end });
    let cc = '';
    let dept = '';
    if (job !== null) {
      if (job.cost_center !== '') cc = ccCache[job.cost_center] !== undefined ? ccCache[job.cost_center] : (ccCache[job.cost_center] = codeOf(app, 'cost_centers', job.cost_center));
      if (job.department !== '') dept = deptCache[job.department] !== undefined ? deptCache[job.department] : (deptCache[job.department] = codeOf(app, 'departments', job.department));
    }
    out.push({ payslip: s.id, cost_center: cc, department: dept, net_minor: s.net_minor, lines: byslip[s.id] || [] });
  }
  return { run: { number: run.getString('number'), pay_date: run.getString('pay_date'), currency: run.getString('currency') }, gl: gl, components: comps, slips: out };
}

function codeOf(app, collection, id) {
  try {
    const r = app.findRecordById(collection, id);
    return r.getString('code') || r.getString('name');
  } catch {
    return '';
  }
}

function journalFor(ctx, p) {
  const u = L('lib_util');
  const po = L('lib_payroll_out');
  const run = po.runRec(ctx, p.payrun);
  if (['locked', 'paid'].indexOf(run.getString('status')) < 0) throw u.fail(409, 'A journal is written from a locked run (this one is ' + run.getString('status') + ').', 'not_locked');
  const entity = ctx.app.findRecordById('entities', run.getString('entity'));
  const s = po.settingsOf(ctx.app, entity);
  const format = u.oneOf(p, 'format', Object.keys(FORMATS), s.journal_format);
  const input = inputOf(ctx.app, run, s.gl);
  const built = build(input);
  const text = csv(format, input.run, built, { country: entity.getString('country'), tax_rate: s.gl.xero_tax_rate });
  return { run: run, entity: entity, format: format, built: built, text: text };
}

/* ----------------------------------------------------------------- ops */

function preview(ctx, p) {
  L('lib_auth').need(ctx, 'payroll', 'view');
  L('lib_payroll_out').gatePay(ctx);
  const j = journalFor(ctx, p);
  return {
    run: L('lib_payroll_out').runView(ctx.app, j.run), format: j.format, formats: Object.keys(FORMATS).map((k) => Object.assign({ code: k }, FORMATS[k])),
    lines: j.built.lines, debit_minor: j.built.debit_minor, credit_minor: j.built.credit_minor, balanced: j.built.balanced, unset: j.built.unset.map((r) => ({ role: r, label: ROLES[r] })), problems: j.built.problems,
    csv: j.text,
  };
}

function exportJournal(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit', 'export GL journals');
  const j = journalFor(ctx, p);
  if (!j.built.balanced) throw u.fail(409, 'The journal does not balance (' + j.built.debit_minor + ' against ' + j.built.credit_minor + '); nothing was exported.', 'unbalanced', { problems: j.built.problems });
  const bytes = L('lib_bankfiles').utf8Bytes(j.text);
  const name = 'journal-' + j.run.getString('number') + '-' + j.format.replace('_csv', '') + '.csv';
  const rec = u.newRecord(ctx.app, 'journal_exports');
  rec.set('payrun', j.run.id);
  rec.set('entity', j.entity.id);
  rec.set('format', j.format);
  rec.set('file', L('lib_payroll_out').fileFrom(bytes, name));
  rec.set('filename', name);
  rec.set('lines', j.built.lines);
  rec.set('debit_minor', j.built.debit_minor);
  rec.set('credit_minor', j.built.credit_minor);
  rec.set('currency', j.run.getString('currency'));
  rec.set('hash', L('lib_bankfiles').sha256(bytes));
  if (ctx.memberId) rec.set('exported_by', ctx.memberId);
  rec.set('exported_at', u.nowIso());
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'journal_exports', record: rec.id, summary: 'Exported the GL journal of ' + j.run.getString('number') + ' (' + j.format + ', ' + j.built.lines.length + ' lines)' });
  return { journal: { id: rec.id, filename: name, format: j.format, lines: j.built.lines.length, debit_minor: j.built.debit_minor, credit_minor: j.built.credit_minor, unset: j.built.unset } };
}

function downloadJournal(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit', 'download GL journals');
  const rec = u.byId(ctx.app, 'journal_exports', String(p.journal || ''));
  if (rec === null) throw u.fail(404, 'No journal export "' + p.journal + '".', 'not_found');
  if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw u.fail(403, 'That journal is outside your access.', 'not_permitted');
  L('lib_audit').write(ctx, { op: 'journal.download', collection: 'journal_exports', record: rec.id, summary: 'Downloaded journal ' + rec.getString('filename') });
  return L('lib_files').serve(ctx, rec, 'file', rec.getString('filename'), true);
}

function accounts(ctx, p) {
  L('lib_auth').need(ctx, 'payroll', 'view');
  const po = L('lib_payroll_out');
  const entity = po.entityRec(ctx, p.entity);
  const s = po.settingsOf(ctx.app, entity);
  const u = L('lib_util');
  const comps = u.rows(ctx.app, "SELECT id, code, name, kind, gl_account, liability_account FROM pay_components WHERE (entity = {:e} OR entity = '') AND archived = FALSE ORDER BY sort, code", { id: '', code: '', name: '', kind: '', gl_account: '', liability_account: '' }, { e: entity.id });
  const codes = u.rows(ctx.app, "SELECT l.code AS code, l.kind AS kind, l.payee AS payee, MAX(l.name) AS name FROM payslip_lines l JOIN payruns r ON r.id = l.payrun WHERE r.entity = {:e} AND l.source = 'pack' AND l.kind != 'info' GROUP BY l.code, l.kind, l.payee ORDER BY l.code", { code: '', kind: '', payee: '', name: '' }, { e: entity.id });
  return { gl: s.gl, roles: Object.keys(ROLES).map((k) => ({ role: k, label: ROLES[k], account: s.gl[k] || '' })), components: comps, pack_lines: codes, journal_format: s.journal_format, formats: Object.keys(FORMATS).map((k) => Object.assign({ code: k }, FORMATS[k])) };
}

function setAccounts(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit', 'change GL accounts');
  const params = { entity: p.entity, gl: u.obj(p, 'gl') || {} };
  if (u.has(p, 'journal_format')) params.journal_format = p.journal_format;
  // payout.settings-set needs payroll full; GL accounts are a payroll edit, so write here directly
  const po = L('lib_payroll_out');
  const entity = po.entityRec(ctx, params.entity);
  let rec = u.findOne(ctx.app, 'payout_settings', 'entity = {:e}', { e: entity.id });
  if (rec === null) {
    rec = u.newRecord(ctx.app, 'payout_settings');
    rec.set('entity', entity.id);
  }
  const before = po.jsonField(rec, 'gl', {});
  rec.set('gl', cleanGl(Object.assign({}, before, params.gl)));
  if (params.journal_format !== undefined) rec.set('journal_format', u.oneOf(params, 'journal_format', Object.keys(FORMATS), 'generic_csv'));
  if (ctx.memberId) rec.set('updated_by', ctx.memberId);
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'payout_settings', record: rec.id, summary: 'Changed the GL accounts of ' + entity.getString('name'), before: before, after: po.jsonField(rec, 'gl', {}) });
  return accounts(ctx, { entity: entity.id });
}

module.exports = { ROLES: ROLES, FORMATS: FORMATS, cleanGl: cleanGl, build: build, csv: csv, preview: preview, exportJournal: exportJournal, downloadJournal: downloadJournal, accounts: accounts, setAccounts: setAccounts };
