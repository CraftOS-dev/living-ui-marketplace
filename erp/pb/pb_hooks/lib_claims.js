/// <reference path="../pb_data/types.d.ts" />
/**
 * Expense claims: an employee's out-of-pocket spending, line by line with
 * receipts, through approval to the books and back to their bank account.
 *
 *   draft -> submitted -> approved -> posted -> paid
 *                      -> rejected (edit and submit again)
 *
 * - Line amounts include tax; the tax part is amount x rate / (100% + rate),
 *   exact. Recoverable tax goes to the tax's purchase account when posted.
 * - Posting (full Accounting or full People rights): Dr each expense account
 *   (with the employee, department and project), Dr recoverable tax,
 *   Cr Employee reimbursements payable (with the employee).
 * - Paying (full Banking rights): one entry for any number of posted claims,
 *   Dr reimbursements per employee, Cr the bank account.
 * - Your AI agent drafts claims and proposes posting and paying; it never
 *   submits or decides on anyone's behalf.
 */

/* require() resolves the module path on every call (milliseconds each); each module is looked up once. */
let uMod = null;
function u() {
  if (uMod === null) uMod = require(`${__hooks}/lib_util.js`);
  return uMod;
}
let coreMod = null;
function core() {
  if (coreMod === null) coreMod = require(`${__hooks}/lib_core.js`);
  return coreMod;
}
let authMod = null;
function auth() {
  if (authMod === null) authMod = require(`${__hooks}/lib_auth.js`);
  return authMod;
}
let moneyMod = null;
function money() {
  if (moneyMod === null) moneyMod = require(`${__hooks}/lib_money.js`);
  return moneyMod;
}
let peopleMod = null;
function people() {
  if (peopleMod === null) peopleMod = require(`${__hooks}/lib_people.js`);
  return peopleMod;
}
let auditMod = null;
function audit() {
  if (auditMod === null) auditMod = require(`${__hooks}/lib_audit.js`);
  return auditMod;
}
let ledgerMod = null;
function ledger() {
  if (ledgerMod === null) ledgerMod = require(`${__hooks}/lib_ledger.js`);
  return ledgerMod;
}

const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'posted', 'paid'];
const MAX_LINES = 200;

/* ============================================================== rights */

function isOwnClaim(ctx, c) {
  return people().isOwn(ctx, c.getString('employee'));
}

function seesAll(ctx) {
  const P = people();
  return ctx.isAgent || P.has(ctx, 'people', 'view') || P.has(ctx, 'accounting', 'view');
}

function canSee(ctx, c) {
  return seesAll(ctx) || isOwnClaim(ctx, c) || people().manages(ctx.app, ctx.employeeId, c.getString('employee'));
}

function canEdit(ctx, c) {
  const s = c.getString('status');
  if (s !== 'draft' && s !== 'rejected') return false;
  return isOwnClaim(ctx, c) || people().has(ctx, 'people', 'edit');
}

function canDecide(ctx, c) {
  if (ctx.isAgent || c.getString('status') !== 'submitted' || isOwnClaim(ctx, c)) return false;
  return people().has(ctx, 'people', 'full') || people().manages(ctx.app, ctx.employeeId, c.getString('employee'));
}

function canPost(ctx) {
  const P = people();
  return P.has(ctx, 'accounting', 'full') || P.has(ctx, 'people', 'full');
}

function canPay(ctx) {
  return people().has(ctx, 'banking', 'full');
}

function loadClaim(ctx, ref) {
  const util = u();
  const c = core().resolve(ctx.app, 'expense_claims', ref);
  if (!canSee(ctx, c)) throw util.fail(403, 'You cannot see that expense claim.', 'not_permitted');
  return c;
}

function label(c) {
  return 'Expense claim ' + c.getString('number');
}

/* ============================================================= outputs */

function accBrief(app, id, cache) {
  if (typeof id !== 'string' || id === '') return null;
  const key = 'a:' + id;
  if (cache[key] === undefined) {
    const a = u().byId(app, 'accounts', id);
    cache[key] = a === null ? null : { id: a.id, code: a.getString('code'), name: a.getString('name') };
  }
  return cache[key];
}

function taxBrief(app, id, cache) {
  if (typeof id !== 'string' || id === '') return null;
  const key = 'x:' + id;
  if (cache[key] === undefined) {
    const t = u().byId(app, 'taxes', id);
    cache[key] = t === null ? null : { id: t.id, code: t.getString('code'), name: t.getString('name'), rate_bp: t.getInt('rate_bp'), recoverable: t.getBool('recoverable') };
  }
  return cache[key];
}

function projectBrief(app, id, cache) {
  if (typeof id !== 'string' || id === '') return null;
  const key = 'p:' + id;
  if (cache[key] === undefined) {
    const pr = u().byId(app, 'projects', id);
    cache[key] = pr === null ? null : { id: pr.id, code: pr.getString('code'), name: pr.getString('name') };
  }
  return cache[key];
}

function journalBrief(app, id) {
  const j = u().byId(app, 'journals', id);
  return j === null ? null : { id: j.id, number: j.getString('number'), date: j.getString('date'), state: j.getString('state') };
}

function lineOut(app, ctx, l, cur, cache) {
  const util = u();
  const file = l.getString('receipt');
  return {
    id: l.id,
    date: l.getString('date'),
    account: accBrief(app, l.getString('account'), cache),
    description: l.getString('description'),
    amount: l.getInt('amount'),
    amount_text: money().minorText(l.getInt('amount'), cur),
    tax: taxBrief(app, l.getString('tax'), cache),
    tax_amount: l.getInt('tax_amount'),
    tax_amount_text: money().minorText(l.getInt('tax_amount'), cur),
    project: projectBrief(app, l.getString('project'), cache),
    receipt: file === '' ? null : Object.assign({ name: file, url: '/api/ops/claims/receipt?line=' + l.id }, ctx.isAgent ? { file_path: util.filePath(app, l, 'receipt') } : {}),
    sort: l.getInt('sort'),
  };
}

/**
 * A claim for ctx. `shared` (lists) carries caches across claims and the
 * line and receipt counts of the page, so a list needs no query per claim.
 */
function claimOut(app, ctx, c, full, shared) {
  const P = people();
  const cur = P.currencyOf(ctx);
  const cache = shared ? shared.cache : {};
  const names = shared ? shared.names : {};
  const emp = P.empBrief(app, c.getString('employee'), cache);
  const ekey = 'dept:' + c.getString('employee');
  if (cache[ekey] === undefined) {
    const empRec = u().byId(app, 'employees', c.getString('employee'));
    cache[ekey] = empRec !== null ? P.deptBrief(app, empRec.getString('department'), cache) : null;
  }
  const bank = c.getString('bank') === '' ? null : u().byId(app, 'banks', c.getString('bank'));
  const counted = !full && shared ? shared.counts[c.id] || { n: 0, r: 0 } : null;
  const lines = counted !== null ? [] : app.findRecordsByFilter('claim_lines', 'claim = {:c}', 'sort,created', 0, 0, { c: c.id });
  const out = {
    id: c.id,
    number: c.getString('number'),
    title: c.getString('title'),
    date: c.getString('date'),
    employee: emp === null ? null : Object.assign({}, emp, { department: cache[ekey] }),
    status: c.getString('status'),
    total: c.getInt('total'),
    total_text: money().minorText(c.getInt('total'), cur),
    tax: c.getInt('tax'),
    tax_text: money().minorText(c.getInt('tax'), cur),
    project: projectBrief(app, c.getString('project'), cache),
    lines_count: counted !== null ? counted.n : lines.length,
    receipts: counted !== null ? counted.r : lines.filter((l) => l.getString('receipt') !== '').length,
    decided_by: audit().memberName(app, c.getString('decided_by'), names),
    decided_at: c.getString('decided_at'),
    decision_note: c.getString('decision_note'),
    journal: c.getString('journal') === '' ? null : journalBrief(app, c.getString('journal')),
    pay_journal: c.getString('pay_journal') === '' ? null : journalBrief(app, c.getString('pay_journal')),
    bank: bank !== null ? { id: bank.id, name: bank.getString('name') } : null,
    paid_on: c.getString('paid_on'),
    prepared_by: c.getString('actor') === 'agent' ? 'Your AI agent' : audit().memberName(app, c.getString('member'), names),
    actor: c.getString('actor'),
    created: c.getString('created'),
    currency: cur,
  };
  if (full) {
    out.lines = lines.map((l) => lineOut(app, ctx, l, cur, cache));
    out.can = {
      edit: canEdit(ctx, c),
      submit: !ctx.isAgent && canEdit(ctx, c) && lines.length > 0,
      decide: canDecide(ctx, c),
      post: c.getString('status') === 'approved' && canPost(ctx),
      pay: c.getString('status') === 'posted' && canPay(ctx),
      delete: c.getString('status') === 'draft' && (isOwnClaim(ctx, c) || P.has(ctx, 'people', 'edit')),
      add_receipt: isOwnClaim(ctx, c) || P.has(ctx, 'people', 'edit'),
    };
    if (c.getString('journal') !== '') {
      const j = u().byId(app, 'journals', c.getString('journal'));
      if (j !== null) out.entry = ledger().journalOut(app, j, true);
    }
    if (c.getString('pay_journal') !== '') {
      const j = u().byId(app, 'journals', c.getString('pay_journal'));
      if (j !== null) out.pay_entry = ledger().journalOut(app, j, true);
    }
  }
  return out;
}

/** An employee's latest claims (for the employee page). */
function recentFor(app, employeeId, n) {
  const cur = core().currency(app);
  return app.findRecordsByFilter('expense_claims', 'employee = {:e}', '-date,-created', n || 5, 0, { e: employeeId }).map((c) => ({
    id: c.id,
    number: c.getString('number'),
    title: c.getString('title'),
    date: c.getString('date'),
    status: c.getString('status'),
    total: c.getInt('total'),
    total_text: money().minorText(c.getInt('total'), cur),
  }));
}

/* ======================================================== reading lines */

/** An expense account a claim line may use. */
function expenseAccount(app, ref, where) {
  const util = u();
  const a = core().resolve(app, 'accounts', ref);
  if (a.getString('type') !== 'expense') throw util.fail(400, where + ': ' + a.getString('code') + ' ' + a.getString('name') + ' is not an expense account.', 'invalid_account');
  if (a.getBool('control')) throw util.fail(400, where + ': ' + a.getString('code') + ' ' + a.getString('name') + ' is a control account.', 'control_account');
  if (a.getBool('archived')) throw util.fail(409, where + ': ' + a.getString('code') + ' ' + a.getString('name') + ' is archived.', 'account_archived');
  return a;
}

/**
 * Lines from params into plain objects (no writes):
 * [{id, date, account, description, amount, tax, tax_amount, project}].
 * `known` maps the claim's existing line ids (an update may keep them).
 */
function readLines(ctx, app, input, claimDate, claimProject, known) {
  const util = u();
  const c = core();
  const cur = c.currency(app);
  const m = money();
  if (input.length > MAX_LINES) throw util.fail(400, 'At most ' + MAX_LINES + ' lines per claim.', 'invalid_param', { param: 'lines' });
  return input.map((raw, i) => {
    const where = 'Line ' + (i + 1);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw util.fail(400, where + ' must be an object like {"account":"6400","description":"Taxi","amount":"21.80","tax":"SR9"}', 'invalid_param', { param: 'lines' });
    util.keysOnly(raw, ['id', 'account', 'description', 'amount', 'date', 'project', 'tax'], where);
    let id = '';
    if (raw.id !== undefined && raw.id !== null && raw.id !== '') {
      id = String(raw.id);
      if (!known || known[id] === undefined) throw util.fail(400, where + ': line ' + id + ' is not on this claim.', 'invalid_param', { param: 'lines' });
    }
    let date = claimDate;
    if (raw.date !== undefined && raw.date !== null && raw.date !== '') {
      date = String(raw.date).trim();
      if (!util.isDay(date)) throw util.fail(400, where + ': date must be YYYY-MM-DD', 'invalid_param', { param: 'lines' });
    }
    if (raw.account === undefined || raw.account === null || String(raw.account).trim() === '') throw util.fail(400, where + ' needs an expense account (code or name), e.g. "6400".', 'invalid_param', { param: 'lines' });
    const acc = expenseAccount(app, String(raw.account), where);
    const description = String(raw.description === undefined || raw.description === null ? '' : raw.description).trim();
    if (description.length > 300) throw util.fail(400, where + ': description is too long (at most 300 characters)', 'invalid_param', { param: 'lines' });
    const amtRaw = raw.amount === undefined || raw.amount === null ? '' : String(raw.amount);
    const amount = m.toMinor(amtRaw, cur, false);
    if (amount === null || amount <= 0) throw util.fail(400, where + ': amount must be more than 0 in ' + cur + ', tax included, e.g. "21.80" (got "' + amtRaw + '")', 'invalid_amount', { param: 'lines' });
    let tax = null;
    const taxRef = raw.tax === undefined || raw.tax === null ? '' : String(raw.tax).trim();
    if (taxRef !== '' && taxRef.toLowerCase() !== 'none') {
      tax = c.resolve(app, 'taxes', taxRef);
      const scope = tax.getString('scope');
      if (scope !== 'purchase' && scope !== 'both') throw util.fail(400, where + ': the tax ' + tax.getString('name') + ' is for sales, not purchases.', 'invalid_tax', { param: 'lines' });
      if (tax.getBool('archived')) throw util.fail(409, where + ': the tax ' + tax.getString('name') + ' is archived.', 'invalid_tax', { param: 'lines' });
    }
    const rate = tax !== null ? tax.getInt('rate_bp') : 0;
    const taxAmount = rate > 0 ? m.mulDiv(amount, rate, 10000 + rate) : 0;
    let project = claimProject;
    if (raw.project !== undefined && raw.project !== null && String(raw.project).trim() !== '') project = c.resolve(app, 'projects', String(raw.project)).id;
    return { id: id, date: date, account: acc.id, description: description, amount: amount, tax: tax !== null ? tax.id : '', tax_amount: taxAmount, project: project };
  });
}

/** Write `lines` for a claim (in the transaction); returns {total, tax}. */
function writeLines(tx, claimId, lines, replace) {
  const keep = {};
  for (const l of lines) if (l.id !== '') keep[l.id] = true;
  if (replace) {
    for (const old of tx.findRecordsByFilter('claim_lines', 'claim = {:c}', '', 0, 0, { c: claimId })) {
      if (keep[old.id] !== true) tx.delete(tx.findRecordById('claim_lines', old.id));
    }
  }
  let total = 0;
  let tax = 0;
  const col = tx.findCollectionByNameOrId('claim_lines');
  lines.forEach((l, i) => {
    const r = l.id !== '' ? tx.findRecordById('claim_lines', l.id) : new Record(col);
    r.set('claim', claimId);
    r.set('date', l.date);
    r.set('account', l.account);
    r.set('description', l.description);
    r.set('amount', l.amount);
    r.set('tax', l.tax);
    r.set('tax_amount', l.tax_amount);
    r.set('project', l.project);
    r.set('sort', i + 1);
    tx.save(r);
    total += l.amount;
    tax += l.tax_amount;
  });
  return { total: total, tax: tax };
}

/** Totals from the stored lines (after a change). */
function retotal(tx, claimId) {
  const r = u().one(tx, 'SELECT IFNULL(SUM(amount), 0) AS total, IFNULL(SUM(tax_amount), 0) AS tax, COUNT(id) AS n FROM claim_lines WHERE claim = {:c}', { total: 0, tax: 0, n: 0 }, { c: claimId });
  const c = tx.findRecordById('expense_claims', claimId);
  c.set('total', r.total);
  c.set('tax', r.tax);
  tx.save(c);
  return r;
}

/* ============================================================ handlers */

/**
 * Claims in list shape (claimOut without lines), from one query with their
 * employee, department, project, entries, bank, the names of who prepared
 * and decided them, and their line and receipt counts.
 */
function summaries(app, ctx, where, bind, tail) {
  const util = u();
  const P = people();
  const cur = P.currencyOf(ctx);
  const m = money();
  const rows = util.rows(
    app,
    'SELECT c.id AS id, c.number AS number, c.title AS title, c.date AS date, c.status AS status, c.total AS total, c.tax AS tax, c.decided_by AS decided_by, c.decided_at AS decided_at, ' +
      'c.decision_note AS decision_note, c.paid_on AS paid_on, c.actor AS actor, c.member AS member, c.created AS created, c.employee AS e_id, ' +
      "IFNULL(e.name, '') AS e_name, IFNULL(e.number, '') AS e_number, IFNULL(e.job_title, '') AS e_title, IFNULL(e.photo, '') AS e_photo, IFNULL(e.status, '') AS e_status, " +
      "IFNULL(d.id, '') AS d_id, IFNULL(d.name, '') AS d_name, IFNULL(d.code, '') AS d_code, IFNULL(pr.id, '') AS p_id, IFNULL(pr.code, '') AS p_code, IFNULL(pr.name, '') AS p_name, " +
      "IFNULL(j.id, '') AS j_id, IFNULL(j.number, '') AS j_number, IFNULL(j.date, '') AS j_date, IFNULL(j.state, '') AS j_state, " +
      "IFNULL(pj.id, '') AS pj_id, IFNULL(pj.number, '') AS pj_number, IFNULL(pj.date, '') AS pj_date, IFNULL(pj.state, '') AS pj_state, " +
      "IFNULL(b.id, '') AS b_id, IFNULL(b.name, '') AS b_name, IFNULL(m1.name, '') AS member_name, IFNULL(m2.name, '') AS decided_name, " +
      "(SELECT COUNT(l.id) FROM claim_lines l WHERE l.claim = c.id) AS n_lines, (SELECT COUNT(l.id) FROM claim_lines l WHERE l.claim = c.id AND l.receipt != '') AS n_receipts " +
      'FROM expense_claims c LEFT JOIN employees e ON e.id = c.employee LEFT JOIN departments d ON d.id = e.department LEFT JOIN projects pr ON pr.id = c.project ' +
      'LEFT JOIN journals j ON j.id = c.journal LEFT JOIN journals pj ON pj.id = c.pay_journal LEFT JOIN banks b ON b.id = c.bank LEFT JOIN members m1 ON m1.id = c.member LEFT JOIN members m2 ON m2.id = c.decided_by WHERE ' +
      where +
      tail,
    {
      id: '', number: '', title: '', date: '', status: '', total: 0, tax: 0, decided_by: '', decided_at: '', decision_note: '', paid_on: '', actor: '', member: '', created: '', e_id: '',
      e_name: '', e_number: '', e_title: '', e_photo: '', e_status: '', d_id: '', d_name: '', d_code: '', p_id: '', p_code: '', p_name: '',
      j_id: '', j_number: '', j_date: '', j_state: '', pj_id: '', pj_number: '', pj_date: '', pj_state: '', b_id: '', b_name: '', member_name: '', decided_name: '', n_lines: 0, n_receipts: 0,
    },
    bind,
  );
  const name = (id, n) => (id === '' ? '' : n !== '' ? n : 'Former member');
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    date: r.date,
    employee:
      r.e_name === ''
        ? null
        : {
            id: r.e_id,
            name: r.e_name,
            number: r.e_number,
            job_title: r.e_title,
            photo: r.e_photo === '' ? '' : '/api/files/employees/' + r.e_id + '/' + r.e_photo,
            status: r.e_status,
            department: r.d_id !== '' ? { id: r.d_id, name: r.d_name, code: r.d_code } : null,
          },
    status: r.status,
    total: r.total,
    total_text: m.minorText(r.total, cur),
    tax: r.tax,
    tax_text: m.minorText(r.tax, cur),
    project: r.p_id !== '' ? { id: r.p_id, code: r.p_code, name: r.p_name } : null,
    lines_count: r.n_lines,
    receipts: r.n_receipts,
    decided_by: name(r.decided_by, r.decided_name),
    decided_at: r.decided_at,
    decision_note: r.decision_note,
    journal: r.j_id !== '' ? { id: r.j_id, number: r.j_number, date: r.j_date, state: r.j_state } : null,
    pay_journal: r.pj_id !== '' ? { id: r.pj_id, number: r.pj_number, date: r.pj_date, state: r.pj_state } : null,
    bank: r.b_id !== '' ? { id: r.b_id, name: r.b_name } : null,
    paid_on: r.paid_on,
    prepared_by: r.actor === 'agent' ? 'Your AI agent' : name(r.member, r.member_name),
    actor: r.actor,
    created: r.created,
    currency: cur,
  }));
}

function list(ctx, p) {
  const util = u();
  const P = people();
  const app = ctx.app;
  P.needOn(ctx, 'people');
  const cur = P.currencyOf(ctx);
  const scope = util.oneOf(p, 'scope', ['mine', 'team', 'all'], ctx.isAgent || (ctx.employeeId === '' && seesAll(ctx)) ? 'all' : 'mine');
  const pg = util.page(p, 50, 500);
  const where = ['1 = 1'];
  const bind = {};
  if (scope === 'mine') {
    where.push('c.employee = {:me}');
    bind.me = P.ownEmployee(ctx);
  } else if (scope === 'team') {
    bind.me = P.ownEmployee(ctx);
    where.push(P.inTeamSql(ctx, 'c.employee', bind));
  } else if (!seesAll(ctx)) {
    throw util.fail(403, "Your role cannot see everyone's claims (needs view access to People or Accounting). Use scope mine or team.", 'not_permitted');
  }
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') {
    const emp = core().resolve(app, 'employees', empRef);
    if (scope === 'team' && !P.manages(app, bind.me, emp.id)) throw util.fail(403, emp.getString('name') + ' is not in your team.', 'not_permitted');
    where.push('c.employee = {:emp}');
    bind.emp = emp.id;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(c.title LIKE {:q} ESCAPE '\\' OR c.number LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('c.date >= {:f}');
    bind.f = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('c.date <= {:t}');
    bind.t = to;
  }
  const scoped = where.slice();
  const status = util.oneOf(p, 'status', STATUSES, '');
  if (status !== '') {
    where.push('c.status = {:s}');
    bind.s = status;
  }
  const claims = summaries(app, ctx, where.join(' AND '), bind, ' ORDER BY c.date DESC, c.created DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset);
  // The counts per status also give the totals (one scan of the scope instead of two).
  const counts = {};
  for (const s of STATUSES) counts[s] = { count: 0, total: 0 };
  const tot = { n: 0, total: 0, tax: 0 };
  for (const r of util.rows(app, 'SELECT c.status AS status, COUNT(c.id) AS n, IFNULL(SUM(c.total), 0) AS total, IFNULL(SUM(c.tax), 0) AS tax FROM expense_claims c WHERE ' + scoped.join(' AND ') + ' GROUP BY c.status', { status: '', n: 0, total: 0, tax: 0 }, bind)) {
    counts[r.status] = { count: r.n, total: r.total, total_text: money().minorText(r.total, cur) };
    if (status === '' || r.status === status) {
      tot.n += r.n;
      tot.total += r.total;
      tot.tax += r.tax;
    }
  }
  return {
    scope: scope,
    claims: claims,
    total: tot.n,
    totals: { count: tot.n, total: tot.total, total_text: money().minorText(tot.total, cur), tax: tot.tax, tax_text: money().minorText(tot.tax, cur) },
    counts: counts,
    currency: cur,
  };
}

/**
 * The kinds of expense a claim line can use: every expense account that
 * takes postings, for anyone who files claims (the chart of accounts itself
 * needs Accounting rights). The caller's own most used come first.
 */
function expenseTypes(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  const q = util.str(p, 'q', '');
  const bind = { e: ctx.employeeId || '-' };
  let where = "a.type = 'expense' AND a.control = FALSE AND a.archived = FALSE";
  if (q !== '') {
    where += " AND (a.code LIKE {:q} ESCAPE '\\' OR a.name LIKE {:q} ESCAPE '\\')";
    bind.q = util.like(q);
  }
  const rows = util.rows(
    app,
    'SELECT a.id AS id, a.code AS code, a.name AS name, (SELECT COUNT(l.id) FROM claim_lines l JOIN expense_claims c ON c.id = l.claim WHERE l.account = a.id AND c.employee = {:e}) AS used FROM accounts a WHERE ' +
      where +
      ' ORDER BY used DESC, a.code LIMIT 200',
    { id: '', code: '', name: '', used: 0 },
    bind,
  );
  return { accounts: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, used: r.used })) };
}

function get(ctx, p) {
  const c = loadClaim(ctx, u().req(p, 'claim', 'EXP-00001'));
  return claimOut(ctx.app, ctx, c, true);
}

function create(ctx, p) {
  const util = u();
  const P = people();
  const app = ctx.app;
  P.needOn(ctx, 'people');
  const emp = P.targetEmployee(ctx, p, 'create claims for other employees');
  const title = util.squash(util.text(p, 'title', 160, ''));
  if (title === '') throw util.fail(400, 'title is required, e.g. title="Client visit, Penang"', 'missing_param', { param: 'title' });
  const date = util.day(p, 'date', util.today());
  const proj = core().resolveOpt(app, 'projects', util.str(p, 'project', ''));
  const input = util.list(p, 'lines') || [];
  const lines = readLines(ctx, app, input, date, proj !== null ? proj.id : '', null);
  let id = '';
  app.runInTransaction((tx) => {
    const c = util.newRecord(tx, 'expense_claims');
    c.set('number', core().nextNumber(tx, 'claim'));
    c.set('employee', emp.id);
    c.set('title', title);
    c.set('date', date);
    c.set('status', 'draft');
    c.set('total', 0);
    c.set('tax', 0);
    c.set('project', proj !== null ? proj.id : '');
    c.set('member', ctx.memberId || '');
    c.set('actor', ctx.isAgent ? 'agent' : 'person');
    tx.save(c);
    id = c.id;
    writeLines(tx, c.id, lines, false);
    const t = retotal(tx, c.id);
    audit().write(tx, ctx, {
      kind: 'create',
      entity: 'expense_claims',
      ref: c.id,
      label: c.getString('number'),
      summary: 'Drafted ' + label(c) + ' "' + title + '" for ' + emp.getString('name') + ' (' + money().fmt(t.total, core().currency(tx)) + ')',
    });
  });
  return claimOut(app, ctx, app.findRecordById('expense_claims', id), true);
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  const c = loadClaim(ctx, util.req(p, 'claim', 'EXP-00001'));
  if (c.getString('status') !== 'draft' && c.getString('status') !== 'rejected') throw util.fail(409, label(c) + ' is ' + c.getString('status') + '; only drafts and rejected claims change.', 'invalid_state');
  if (!canEdit(ctx, c)) throw util.fail(403, 'You can change only your own claims (or anyone\'s with edit access to People).', 'not_permitted');
  let title = c.getString('title');
  if (util.has(p, 'title')) {
    title = util.squash(util.text(p, 'title', 160, ''));
    if (title === '') throw util.fail(400, 'title cannot be empty', 'invalid_param', { param: 'title' });
  }
  const date = util.day(p, 'date', c.getString('date'));
  let project = c.getString('project');
  if (util.has(p, 'project')) {
    const pr = core().resolveOpt(app, 'projects', util.str(p, 'project', ''));
    project = pr !== null ? pr.id : '';
  }
  let lines = null;
  if (util.has(p, 'lines')) {
    const known = {};
    for (const l of app.findRecordsByFilter('claim_lines', 'claim = {:c}', '', 0, 0, { c: c.id })) known[l.id] = true;
    lines = readLines(ctx, app, util.list(p, 'lines') || [], date, project, known);
  }
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('expense_claims', c.id);
    if (x.getString('status') !== c.getString('status')) throw util.fail(409, label(x) + ' changed a moment ago. Open it again.', 'invalid_state');
    x.set('title', title);
    x.set('date', date);
    x.set('project', project);
    tx.save(x);
    if (lines !== null) writeLines(tx, c.id, lines, true);
    const t = retotal(tx, c.id);
    audit().write(tx, ctx, { kind: 'update', entity: 'expense_claims', ref: c.id, label: x.getString('number'), summary: 'Changed ' + label(x) + ' (' + money().fmt(t.total, core().currency(tx)) + ', ' + t.n + (t.n === 1 ? ' line)' : ' lines)') });
  });
  return claimOut(app, ctx, app.findRecordById('expense_claims', c.id), true);
}

function addReceipt(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  const c = loadClaim(ctx, util.req(p, 'claim', 'EXP-00001'));
  if (!isOwnClaim(ctx, c) && !people().has(ctx, 'people', 'edit')) throw util.fail(403, 'You can add receipts only to your own claims.', 'not_permitted');
  const lineId = util.req(p, 'line');
  const line = util.byId(app, 'claim_lines', lineId);
  if (line === null || line.getString('claim') !== c.id) throw util.fail(404, 'No line ' + lineId + ' on ' + label(c) + '. See claims.get for the line ids.', 'not_found');
  const file = util.fileParam(ctx, p, 'file', 'path');
  if (file === null) throw util.fail(400, 'Upload the receipt as file, or give --path "<absolute path>".', 'missing_param', { param: 'file' });
  app.runInTransaction((tx) => {
    const l = tx.findRecordById('claim_lines', line.id);
    l.set('receipt', file);
    tx.save(l);
    audit().write(tx, ctx, { kind: 'attach', entity: 'expense_claims', ref: c.id, label: c.getString('number'), summary: 'Added a receipt to line ' + l.getInt('sort') + ' of ' + label(c) + (l.getString('description') !== '' ? ' (' + l.getString('description') + ')' : '') });
  });
  return claimOut(app, ctx, app.findRecordById('expense_claims', c.id), true);
}

/** A line's receipt: streamed to screens, its file path for your AI agent. */
function receipt(ctx, p) {
  const util = u();
  const app = ctx.app;
  const lineId = util.req(p, 'line');
  const line = core().resolve(app, 'claim_lines', lineId);
  const c = app.findRecordById('expense_claims', line.getString('claim'));
  if (!canSee(ctx, c)) throw util.fail(403, 'You cannot see that expense claim.', 'not_permitted');
  const file = line.getString('receipt');
  if (file === '') throw util.fail(404, 'That line has no receipt yet.', 'not_found');
  const mime = audit().mimeOf(file);
  if (ctx.isAgent || ctx.e === null) return { claim: c.getString('number'), line: line.id, name: file, mime: mime, file_path: util.filePath(app, line, 'receipt') };
  return audit().streamFile(ctx, line, 'receipt', file, mime, util.bool(p, 'download', false));
}

function submit(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent drafts claims; the employee submits them.', 'agent_not_permitted');
  const c = loadClaim(ctx, util.req(p, 'claim', 'EXP-00001'));
  const s = c.getString('status');
  if (s !== 'draft' && s !== 'rejected') throw util.fail(409, label(c) + ' is already ' + s + '.', 'invalid_state');
  if (!canEdit(ctx, c)) throw util.fail(403, 'You can submit only your own claims (or anyone\'s with edit access to People).', 'not_permitted');
  const n = util.one(app, 'SELECT COUNT(id) AS n FROM claim_lines WHERE claim = {:c}', { n: 0 }, { c: c.id }).n;
  if (n === 0) throw util.fail(409, 'Add at least one line to ' + label(c) + ' before submitting it.', 'no_lines');
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('expense_claims', c.id);
    if (x.getString('status') !== s) throw util.fail(409, label(x) + ' changed a moment ago.', 'invalid_state');
    x.set('status', 'submitted');
    x.set('decided_by', '');
    x.set('decided_at', '');
    x.set('decision_note', '');
    tx.save(x);
    audit().write(tx, ctx, { kind: 'submit', entity: 'expense_claims', ref: c.id, label: x.getString('number'), summary: 'Submitted ' + label(x) + ' for approval (' + money().fmt(x.getInt('total'), core().currency(tx)) + ')' });
  });
  return claimOut(app, ctx, app.findRecordById('expense_claims', c.id), true);
}

function decide(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent does not decide claims; the manager does.', 'agent_not_permitted');
  const c = loadClaim(ctx, util.req(p, 'claim', 'EXP-00001'));
  if (c.getString('status') !== 'submitted') throw util.fail(409, label(c) + ' is ' + c.getString('status') + ', not waiting for a decision.', 'invalid_state');
  if (isOwnClaim(ctx, c)) throw util.fail(403, 'You cannot decide your own claim. Your manager does.', 'own_claim');
  if (!canDecide(ctx, c)) throw util.fail(403, "Only the employee's manager, or someone with full access to People, decides this.", 'not_permitted');
  if (!util.has(p, 'approve')) throw util.fail(400, 'approve is required: true to approve, false to reject.', 'missing_param', { param: 'approve' });
  const approve = util.bool(p, 'approve', true);
  const note = util.text(p, 'note', 500, '');
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('expense_claims', c.id);
    if (x.getString('status') !== 'submitted') throw util.fail(409, label(x) + ' was decided a moment ago.', 'invalid_state');
    x.set('status', approve ? 'approved' : 'rejected');
    x.set('decided_by', ctx.memberId);
    x.set('decided_at', util.nowIso());
    x.set('decision_note', note);
    tx.save(x);
    audit().write(tx, ctx, { kind: approve ? 'approve' : 'reject', entity: 'expense_claims', ref: c.id, label: x.getString('number'), summary: (approve ? 'Approved ' : 'Rejected ') + label(x) + (note !== '' ? ' (' + note + ')' : '') });
  });
  return claimOut(app, ctx, app.findRecordById('expense_claims', c.id), true);
}

/* ============================================================ posting */

/** The journal lines a claim posts (no writes). */
function postingLines(app, c) {
  const util = u();
  const cc = core();
  const emp = util.byId(app, 'employees', c.getString('employee'));
  const dept = emp !== null ? emp.getString('department') : '';
  const lines = app.findRecordsByFilter('claim_lines', 'claim = {:c}', 'sort,created', 0, 0, { c: c.id });
  if (lines.length === 0) throw util.fail(409, label(c) + ' has no lines.', 'no_lines');
  const jl = [];
  let total = 0;
  for (const l of lines) {
    const where = 'Line ' + l.getInt('sort');
    expenseAccount(app, l.getString('account'), where);
    const amount = l.getInt('amount');
    const taxAmt = l.getInt('tax_amount');
    const tax = util.byId(app, 'taxes', l.getString('tax'));
    let expense = amount;
    if (tax !== null && tax.getBool('recoverable') && taxAmt > 0) {
      if (tax.getString('purchase_account') === '') throw util.fail(409, 'The tax ' + tax.getString('name') + ' has no purchase tax account. Set it under Settings, Taxes.', 'tax_account_missing');
      expense = amount - taxAmt;
      jl.push({ account: tax.getString('purchase_account'), debit: taxAmt, credit: 0, memo: tax.getString('name') + ' on ' + c.getString('number') });
    }
    jl.push({ account: l.getString('account'), debit: expense, credit: 0, employee: c.getString('employee'), department: dept, project: l.getString('project') || c.getString('project'), memo: (l.getString('description') || c.getString('title')).slice(0, 200) });
    total += amount;
  }
  jl.push({ account: cc.systemAccount(app, 'reimbursements').id, debit: 0, credit: total, employee: c.getString('employee'), memo: c.getString('number') + ' ' + (emp !== null ? emp.getString('name') : '') });
  return { lines: jl, total: total, employee: emp };
}

function postDate(app, ctx, c) {
  return ledger().firstOpenDate(app, ctx, c.getString('date'));
}

function previewPost(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = loadClaim(ctx, util.req(p, 'claim', 'EXP-00001'));
  if (c.getString('status') !== 'approved') throw util.fail(409, label(c) + ' is ' + c.getString('status') + '; only approved claims post.', 'invalid_state');
  const r = postingLines(app, c);
  const cur = core().currency(app);
  const date = postDate(app, ctx, c);
  const name = r.employee !== null ? r.employee.getString('name') : '';
  return {
    kind: 'claim',
    auto: '',
    amount: r.total,
    title: 'Post ' + label(c) + ' for ' + name,
    summary: '"' + c.getString('title') + '": ' + money().fmt(r.total, cur) + ' owed to ' + name + ', dated ' + date + '.',
    lines: ledger().describeLines(app, ledger().compact(r.lines)),
    currency: cur,
    target: { entity: 'expense_claims', id: c.id, label: c.getString('number') },
  };
}

function post(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  const c = loadClaim(ctx, util.req(p, 'claim', 'EXP-00001'));
  if (!canPost(ctx)) throw util.fail(403, (ctx.isAgent ? 'Your AI agent' : 'Your role') + ' cannot post expense claims (needs full access to Accounting or People).', 'not_permitted', { level: 'full' });
  if (c.getString('status') !== 'approved') throw util.fail(409, label(c) + ' is ' + c.getString('status') + '; only approved claims post.', 'invalid_state');
  const r = postingLines(app, c);
  const date = postDate(app, ctx, c);
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('expense_claims', c.id);
    if (x.getString('status') !== 'approved') throw util.fail(409, label(x) + ' was posted a moment ago.', 'invalid_state');
    const j = ledger().post(
      tx,
      ctx,
      { kind: 'claim', date: date, memo: label(x) + ' ' + (r.employee !== null ? r.employee.getString('name') : '') + ': ' + x.getString('title'), source: { entity: 'expense_claims', id: x.id, label: x.getString('number') }, lines: r.lines },
      { allowControl: true },
    );
    x.set('status', 'posted');
    x.set('journal', j !== null ? j.id : '');
    tx.save(x);
    audit().write(tx, ctx, { kind: 'post', entity: 'expense_claims', ref: x.id, label: x.getString('number'), summary: 'Posted ' + label(x) + (j !== null ? ' as ' + j.getString('number') : '') + ' (' + money().fmt(r.total, core().currency(tx)) + ')' });
  });
  return claimOut(app, ctx, app.findRecordById('expense_claims', c.id), true);
}

/* ============================================================== paying */

/** The bank account money leaves from: `ref`, else the default, else the first bank account. */
function payBank(app, ref) {
  const util = u();
  const c = core();
  let bank = null;
  if (ref !== '') bank = c.resolve(app, 'banks', ref);
  else {
    const d = c.defaults(app).bank;
    if (typeof d === 'string' && d !== '') bank = util.byId(app, 'banks', d);
    if (bank === null) {
      const first = util.one(app, "SELECT id FROM banks WHERE archived = FALSE AND kind = 'bank' ORDER BY sort, name LIMIT 1", { id: '' });
      if (first !== null) bank = app.findRecordById('banks', first.id);
    }
  }
  if (bank === null) throw util.fail(400, 'bank is required: the bank account the money leaves from. See banks.list.', 'missing_param', { param: 'bank' });
  if (bank.getBool('archived')) throw util.fail(409, bank.getString('name') + ' is archived. Choose another bank account.', 'archived');
  const cur = c.currency(app);
  if (bank.getString('currency') !== '' && bank.getString('currency') !== cur) throw util.fail(409, bank.getString('name') + ' is in ' + bank.getString('currency') + '; pay from a ' + cur + ' account.', 'currency_mismatch');
  if (bank.getString('account') === '') throw util.fail(409, bank.getString('name') + ' has no ledger account.', 'account_missing');
  return bank;
}

/** Read claims.pay params (no writes): {claims, bank, date, lines, total}. */
function readPay(ctx, p) {
  const util = u();
  const app = ctx.app;
  let refs = util.list(p, 'claims');
  const one = util.str(p, 'claim', '');
  if (refs === undefined || refs.length === 0) refs = one !== '' ? [one] : [];
  else if (one !== '') refs = refs.concat([one]);
  if (refs.length === 0) throw util.fail(400, 'claims is required, e.g. claims=["EXP-00001","EXP-00002"] (or claim=EXP-00001)', 'missing_param', { param: 'claims' });
  if (refs.length > 500) throw util.fail(400, 'At most 500 claims in one payment.', 'invalid_param', { param: 'claims' });
  const claims = [];
  const seen = {};
  for (const ref of refs) {
    const c = loadClaim(ctx, String(ref));
    if (seen[c.id]) continue;
    seen[c.id] = true;
    if (c.getString('status') !== 'posted') throw util.fail(409, label(c) + ' is ' + c.getString('status') + '; only posted claims are paid.', 'invalid_state', { claim: c.getString('number') });
    claims.push(c);
  }
  const bank = payBank(app, util.str(p, 'bank', ''));
  const date = util.day(p, 'date', util.today());
  const reimb = core().systemAccount(app, 'reimbursements').id;
  const perEmp = {};
  const order = [];
  let total = 0;
  for (const c of claims) {
    const e = c.getString('employee');
    if (perEmp[e] === undefined) {
      perEmp[e] = { amount: 0, numbers: [] };
      order.push(e);
    }
    perEmp[e].amount += c.getInt('total');
    perEmp[e].numbers.push(c.getString('number'));
    total += c.getInt('total');
  }
  const lines = [];
  for (const e of order) {
    const emp = util.byId(app, 'employees', e);
    lines.push({ account: reimb, debit: perEmp[e].amount, credit: 0, employee: e, memo: (emp !== null ? emp.getString('name') + ': ' : '') + perEmp[e].numbers.join(', ') });
  }
  lines.push({ account: bank.getString('account'), debit: 0, credit: total, memo: 'Expense claims ' + claims.map((c) => c.getString('number')).join(', ') });
  return { claims: claims, bank: bank, date: date, lines: lines, total: total, employees: order.length };
}

function previewPay(ctx, p) {
  const app = ctx.app;
  const r = readPay(ctx, p);
  const cur = core().currency(app);
  const first = r.claims[0];
  return {
    kind: 'payment',
    auto: '',
    amount: r.total,
    title: 'Pay ' + (r.claims.length === 1 ? label(first) : r.claims.length + ' expense claims') + ': ' + money().fmt(r.total, cur),
    summary: 'Reimburse ' + r.employees + (r.employees === 1 ? ' employee' : ' employees') + ' from ' + r.bank.getString('name') + ' on ' + r.date + ' (' + r.claims.map((c) => c.getString('number')).join(', ') + ').',
    lines: ledger().describeLines(app, ledger().compact(r.lines)),
    currency: cur,
    target: { entity: 'expense_claims', id: first.id, label: first.getString('number') },
  };
}

function pay(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  auth().need(ctx, 'banking', 'full', 'pay expense claims');
  const r = readPay(ctx, p);
  ledger().checkDate(app, ctx, r.date);
  let jid = '';
  app.runInTransaction((tx) => {
    const j = ledger().post(
      tx,
      ctx,
      {
        kind: 'claim_payment',
        date: r.date,
        memo: 'Paid expense claims ' + r.claims.map((c) => c.getString('number')).join(', ').slice(0, 400),
        source: { entity: 'expense_claims', id: r.claims[0].id, label: r.claims.length === 1 ? r.claims[0].getString('number') : r.claims.length + ' claims' },
        lines: r.lines,
      },
      { allowControl: true },
    );
    jid = j !== null ? j.id : '';
    for (const c of r.claims) {
      const x = tx.findRecordById('expense_claims', c.id);
      if (x.getString('status') !== 'posted') throw util.fail(409, label(x) + ' was paid a moment ago.', 'invalid_state');
      x.set('status', 'paid');
      x.set('paid_on', r.date);
      x.set('bank', r.bank.id);
      x.set('pay_journal', jid);
      tx.save(x);
      audit().write(tx, ctx, { kind: 'pay', entity: 'expense_claims', ref: x.id, label: x.getString('number'), summary: 'Paid ' + label(x) + ' from ' + r.bank.getString('name') + ' on ' + r.date + (j !== null ? ' (' + j.getString('number') + ')' : '') });
    }
  });
  const j = util.byId(app, 'journals', jid);
  return {
    paid: r.claims.map((c) => claimOut(app, ctx, app.findRecordById('expense_claims', c.id), false)),
    total: r.total,
    total_text: money().minorText(r.total, core().currency(app)),
    bank: { id: r.bank.id, name: r.bank.getString('name') },
    date: r.date,
    journal: j !== null ? ledger().journalOut(app, j, true) : null,
  };
}

function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  people().needOn(ctx, 'people');
  const c = loadClaim(ctx, util.req(p, 'claim', 'EXP-00001'));
  if (c.getString('status') !== 'draft') throw util.fail(409, label(c) + ' is ' + c.getString('status') + '; only drafts are deleted.', 'invalid_state');
  if (!isOwnClaim(ctx, c) && !people().has(ctx, 'people', 'edit')) throw util.fail(403, 'You can delete only your own draft claims.', 'not_permitted');
  const n = util.one(app, 'SELECT COUNT(id) AS n FROM claim_lines WHERE claim = {:c}', { n: 0 }, { c: c.id }).n;
  if (util.bool(p, 'preview', false)) return { preview: true, number: c.getString('number'), title: c.getString('title'), lines: n };
  app.runInTransaction((tx) => {
    for (const l of tx.findRecordsByFilter('claim_lines', 'claim = {:c}', '', 0, 0, { c: c.id })) tx.delete(tx.findRecordById('claim_lines', l.id));
    tx.delete(tx.findRecordById('expense_claims', c.id));
    audit().write(tx, ctx, { kind: 'delete', entity: 'expense_claims', ref: c.id, label: c.getString('number'), summary: 'Deleted the draft ' + label(c) + ' "' + c.getString('title') + '"' });
  });
  return { deleted: true };
}

module.exports = {
  STATUSES: STATUSES,
  canSee: canSee,
  claimOut: claimOut,
  recentFor: recentFor,
  expenseTypes: expenseTypes,
  payBank: payBank,
  list: list,
  get: get,
  create: create,
  update: update,
  addReceipt: addReceipt,
  receipt: receipt,
  submit: submit,
  decide: decide,
  previewPost: previewPost,
  post: post,
  previewPay: previewPay,
  pay: pay,
  remove: remove,
};
