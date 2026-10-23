/// <reference path="../pb_data/types.d.ts" />
/**
 * Accounting setup and entries: the chart of accounts, manual journal
 * entries and reversals, taxes, payment terms, currencies and opening
 * balances (accounts, open invoices and bills, stock).
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function money() {
  return require(`${__hooks}/lib_money.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}
function ledger() {
  return require(`${__hooks}/lib_ledger.js`);
}

const SUBTYPES = {
  asset: ['cash', 'bank', 'receivable', 'inventory', 'current_asset', 'fixed_asset', 'accumulated_depreciation', 'tax_receivable', 'other_asset'],
  liability: ['payable', 'current_liability', 'tax_payable', 'payroll_liability', 'long_term_liability'],
  equity: ['equity', 'retained_earnings', 'opening_balance'],
  income: ['revenue', 'other_income'],
  expense: ['cogs', 'expense', 'payroll_expense', 'depreciation', 'other_expense'],
};

/** Accounts whose balance reads as a positive debit (assets, expenses). */
function debitNatured(type) {
  return type === 'asset' || type === 'expense';
}

/* ============================================================ accounts */

function canSeeBalances(ctx) {
  return ctx.isAgent || auth().can(ctx, 'accounting', 'view') || auth().can(ctx, 'reports', 'view');
}

function accOut(a, bal) {
  const out = {
    id: a.getString('id') || a.id,
    code: a.getString('code'),
    name: a.getString('name'),
    type: a.getString('type'),
    subtype: a.getString('subtype'),
    system_key: a.getString('system_key'),
    control: a.getBool('control'),
    parent: a.getString('parent'),
    description: a.getString('description'),
    archived: a.getBool('archived'),
  };
  if (bal !== undefined) {
    const b = bal[out.id] || { debit: 0, credit: 0 };
    out.balance = debitNatured(out.type) ? b.debit - b.credit : b.credit - b.debit;
  }
  return out;
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const anyEdit = ['sales', 'purchasing', 'inventory', 'banking', 'people', 'payroll', 'projects', 'manufacturing'].some((m) => auth().can(ctx, m, 'view'));
  if (!canSeeBalances(ctx) && !anyEdit) auth().need(ctx, 'accounting', 'view', 'see the chart of accounts');
  const filters = [];
  const bind = {};
  const type = util.oneOf(p, 'type', Object.keys(SUBTYPES), '');
  if (type !== '') {
    filters.push('type = {:t}');
    bind.t = type;
  }
  if (!util.bool(p, 'archived', false)) filters.push('archived = false');
  const q = util.str(p, 'q', '');
  if (q !== '') {
    filters.push('(code ~ {:q} || name ~ {:q})');
    bind.q = q;
  }
  const recs = app.findRecordsByFilter('accounts', filters.join(' && '), 'code', 0, 0, bind);
  const withBal = canSeeBalances(ctx) && util.bool(p, 'balances', true);
  const bal = withBal ? ledger().balances(app, '', util.day(p, 'date', util.today())) : undefined;
  const banks = {};
  for (const b of app.findRecordsByFilter('banks', '', '', 0, 0)) banks[b.getString('account')] = b.id;
  return {
    accounts: recs.map((a) => Object.assign(accOut(a, bal), { bank: banks[a.id] || '' })),
    subtypes: SUBTYPES,
    currency: core().currency(app),
  };
}

function get(ctx, p) {
  const util = u();
  if (!canSeeBalances(ctx)) auth().need(ctx, 'accounting', 'view', 'see account ledgers');
  const app = ctx.app;
  const a = core().resolve(app, 'accounts', util.req(p, 'account'));
  const today = util.today();
  const from = util.day(p, 'from', util.addMonths(today.slice(0, 7), -2) + '-01');
  const to = util.day(p, 'to', today);
  const pg = util.page(p, 100, 1000);
  const sign = debitNatured(a.getString('type')) ? 1 : -1;
  const opening = sign * util.one(app, 'SELECT IFNULL(SUM(debit), 0) - IFNULL(SUM(credit), 0) AS b FROM journal_lines WHERE account = {:a} AND date < {:f}', { b: 0 }, { a: a.id, f: from }).b;
  const totals = util.one(app, 'SELECT COUNT(id) AS n, IFNULL(SUM(debit), 0) AS d, IFNULL(SUM(credit), 0) AS c FROM journal_lines WHERE account = {:a} AND date >= {:f} AND date <= {:t}', { n: 0, d: 0, c: 0 }, { a: a.id, f: from, t: to });
  // Running balance: opening plus everything before this page.
  const before = pg.offset > 0 ? util.one(app, 'SELECT IFNULL(SUM(debit), 0) - IFNULL(SUM(credit), 0) AS b FROM (SELECT debit, credit FROM journal_lines jl JOIN journals j ON j.id = jl.journal WHERE jl.account = {:a} AND jl.date >= {:f} AND jl.date <= {:t} ORDER BY jl.date, j.created, jl.sort LIMIT ' + pg.offset + ')', { b: 0 }, { a: a.id, f: from, t: to }).b : 0;
  let run = opening + sign * before;
  const rows = util.rows(
    app,
    "SELECT jl.id AS id, jl.date AS date, jl.debit AS debit, jl.credit AS credit, jl.memo AS memo, jl.currency AS currency, jl.amount_cur AS amount_cur, IFNULL(pa.name, '') AS party, j.id AS journal_id, j.number AS journal, j.kind AS kind, j.source_entity AS entity, j.source_id AS source, j.source_label AS label FROM journal_lines jl JOIN journals j ON j.id = jl.journal LEFT JOIN parties pa ON pa.id = jl.party WHERE jl.account = {:a} AND jl.date >= {:f} AND jl.date <= {:t} ORDER BY jl.date, j.created, jl.sort LIMIT " + pg.limit + ' OFFSET ' + pg.offset,
    { id: '', date: '', debit: 0, credit: 0, memo: '', currency: '', amount_cur: 0, party: '', journal_id: '', journal: '', kind: '', entity: '', source: '', label: '', balance: 0 },
    { a: a.id, f: from, t: to },
  );
  const lines = rows.map((r) => {
    run += sign * (r.debit - r.credit);
    return Object.assign(r, { balance: run });
  });
  const months = [];
  const start = util.addMonths(today.slice(0, 7), -11);
  const byMonth = {};
  for (const r of util.rows(app, 'SELECT month, debit, credit FROM ledger_months WHERE account = {:a} AND month >= {:m}', { month: '', debit: 0, credit: 0 }, { a: a.id, m: start })) byMonth[r.month] = r;
  for (const m of util.monthsBetween(start, today.slice(0, 7))) {
    const r = byMonth[m] || { debit: 0, credit: 0 };
    months.push({ month: m, debit: r.debit, credit: r.credit, net: sign * (r.debit - r.credit) });
  }
  const closing = opening + sign * (totals.d - totals.c);
  const out = accOut(a, undefined);
  out.balance = sign * ledger().balanceOf(app, a.id, today);
  out.bank = (util.findOne(app, 'banks', 'account = {:a}', { a: a.id }) || { id: '' }).id;
  return Object.assign(out, { from: from, to: to, opening: opening, debits: totals.d, credits: totals.c, closing: closing, lines: lines, total: totals.n, months: months, currency: core().currency(app), can: { edit: ctx.isAgent || auth().can(ctx, 'accounting', 'edit') } });
}

function readAccount(ctx, app, a, p, isNew) {
  const util = u();
  if (util.has(p, 'code')) {
    const c = util.text(p, 'code', 20, '');
    if (!/^[A-Za-z0-9.\-]+$/.test(c)) throw util.fail(400, 'An account code uses letters, digits, . and - only.', 'invalid_param');
    const other = util.findOne(app, 'accounts', 'code = {:c} && id != {:i}', { c: c, i: a.id || '' });
    if (other !== null) throw util.fail(409, 'The code ' + c + ' is taken by ' + other.getString('name') + '.', 'duplicate');
    a.set('code', c);
  }
  if (isNew && a.getString('code') === '') throw util.fail(400, 'code is required', 'missing_param');
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
    a.set('name', n);
  }
  if (isNew && a.getString('name') === '') throw util.fail(400, 'name is required', 'missing_param');
  if (util.has(p, 'type')) {
    const t = util.oneOf(p, 'type', Object.keys(SUBTYPES), '');
    if (!isNew && t !== a.getString('type')) {
      const used = util.one(app, 'SELECT COUNT(id) AS n FROM journal_lines WHERE account = {:a}', { n: 0 }, { a: a.id }).n;
      if (used > 0) throw util.fail(409, 'An account with entries keeps its type. Add a new account instead.', 'has_history');
    }
    a.set('type', t);
  }
  if (isNew && a.getString('type') === '') throw util.fail(400, 'type is required: ' + Object.keys(SUBTYPES).join(', '), 'missing_param');
  if (util.has(p, 'subtype')) a.set('subtype', util.str(p, 'subtype', ''));
  if (a.getString('subtype') === '' || SUBTYPES[a.getString('type')].indexOf(a.getString('subtype')) < 0) {
    if (util.has(p, 'subtype')) throw util.fail(400, 'subtype for ' + a.getString('type') + ' must be one of: ' + SUBTYPES[a.getString('type')].join(', '), 'invalid_param');
    a.set('subtype', SUBTYPES[a.getString('type')][a.getString('type') === 'asset' ? 4 : a.getString('type') === 'liability' ? 1 : a.getString('type') === 'expense' ? 1 : 0]);
  }
  if (util.has(p, 'parent')) {
    const par = core().resolveOpt(app, 'accounts', util.str(p, 'parent', ''));
    if (par !== null && par.id === a.id) throw util.fail(400, 'An account cannot be its own parent.', 'invalid_param');
    if (par !== null && par.getString('type') !== a.getString('type')) throw util.fail(400, 'The parent must be of the same type.', 'invalid_param');
    a.set('parent', par !== null ? par.id : '');
  }
  if (util.has(p, 'description')) a.set('description', util.text(p, 'description', 500, ''));
  if (util.has(p, 'archived')) {
    const arch = util.bool(p, 'archived', false);
    if (arch && a.getString('system_key') !== '') throw util.fail(409, 'This account is used by the app (' + a.getString('system_key').replace(/_/g, ' ') + '). Point that default at another account first.', 'system_account');
    if (arch && ledger().balanceOf(app, a.id, '9999-12-31') !== 0) throw util.fail(409, 'Only accounts with a zero balance are archived.', 'has_balance');
    a.set('archived', arch);
  }
}

function needAccounting(ctx, level) {
  if (ctx.isAgent && level !== 'full') return;
  auth().need(ctx, 'accounting', level, level === 'full' ? 'change the chart of accounts' : 'change accounts');
}

function add(ctx, p) {
  needAccounting(ctx, 'edit');
  const util = u();
  const a = util.newRecord(ctx.app, 'accounts');
  a.set('system_key', '');
  a.set('control', false);
  a.set('archived', false);
  readAccount(ctx, ctx.app, a, p, true);
  ctx.app.save(a);
  require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'create', entity: 'accounts', ref: a.id, label: a.getString('code'), summary: 'Added the account ' + a.getString('code') + ' ' + a.getString('name') });
  return accOut(a, undefined);
}

function update(ctx, p) {
  needAccounting(ctx, 'edit');
  const util = u();
  const a = core().resolve(ctx.app, 'accounts', util.req(p, 'account'));
  readAccount(ctx, ctx.app, a, p, false);
  ctx.app.save(a);
  require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'update', entity: 'accounts', ref: a.id, label: a.getString('code'), summary: 'Changed the account ' + a.getString('code') + ' ' + a.getString('name') });
  return accOut(a, undefined);
}

function remove(ctx, p) {
  needAccounting(ctx, 'full');
  const util = u();
  const app = ctx.app;
  const a = core().resolve(app, 'accounts', util.req(p, 'account'));
  if (a.getString('system_key') !== '') throw util.fail(409, 'This account is used by the app.', 'system_account');
  const used = util.one(app, 'SELECT COUNT(id) AS n FROM journal_lines WHERE account = {:a}', { n: 0 }, { a: a.id }).n;
  if (used > 0) throw util.fail(409, 'This account has entries. Archive it instead.', 'has_history');
  const refs = [
    ['banks', 'account'], ['taxes', 'sales_account'], ['taxes', 'purchase_account'], ['items', 'income_account'], ['items', 'expense_account'], ['item_categories', 'income_account'],
    ['item_categories', 'expense_account'], ['document_lines', 'account'], ['claim_lines', 'account'], ['pay_components', 'account'], ['pay_components', 'liability_account'], ['budgets', 'account'], ['accounts', 'parent'],
  ];
  for (const r of refs) {
    const n = util.one(app, 'SELECT COUNT(id) AS n FROM ' + r[0] + ' WHERE ' + r[1] + ' = {:a}', { n: 0 }, { a: a.id }).n;
    if (n > 0) throw util.fail(409, 'This account is used by ' + n + ' ' + r[0].replace(/_/g, ' ') + '. Change them first, or archive it.', 'in_use');
  }
  if (util.bool(p, 'preview', false)) return { preview: true };
  app.delete(a);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'delete', entity: 'accounts', ref: a.id, label: a.getString('code'), summary: 'Deleted the account ' + a.getString('code') + ' ' + a.getString('name') });
  return { deleted: true };
}

/* ============================================================ journals */

/** Lines of a manual entry. Opening balances take one line or more (the difference goes to opening balance equity). */
function journalLines(app, p, minLines) {
  const util = u();
  const c = core();
  const cur = c.currency(app);
  const input = util.list(p, 'lines') || [];
  if (minLines === 1 && input.length < 1) throw util.fail(400, 'Enter at least one account balance: [{"account":"1010","debit":"25000.00"}]', 'invalid_param');
  if (minLines !== 1 && input.length < 2) throw util.fail(400, 'An entry needs at least two lines: [{"account":"6100","debit":"500.00"},{"account":"1010","credit":"500.00"}]', 'invalid_param');
  if (input.length > 500) throw util.fail(400, 'At most 500 lines per entry.', 'invalid_param');
  const lines = input.map((raw, i) => {
    util.keysOnly(raw, ['account', 'debit', 'credit', 'memo', 'party', 'project', 'department', 'employee'], 'Line ' + (i + 1));
    if (!raw || !raw.account) throw util.fail(400, 'Line ' + (i + 1) + ' needs an account.', 'invalid_param');
    const acc = c.resolve(app, 'accounts', String(raw.account));
    const d = raw.debit === undefined || raw.debit === null || raw.debit === '' ? 0 : money().toMinor(String(raw.debit), cur, false);
    const cr = raw.credit === undefined || raw.credit === null || raw.credit === '' ? 0 : money().toMinor(String(raw.credit), cur, false);
    if (d === null || cr === null) throw util.fail(400, 'Line ' + (i + 1) + ': debit and credit are amounts like 500.00', 'invalid_amount');
    if ((d > 0) === (cr > 0)) throw util.fail(400, 'Line ' + (i + 1) + ' needs a debit or a credit (one of them).', 'invalid_param');
    const party = c.resolveOpt(app, 'parties', raw.party);
    const emp = c.resolveOpt(app, 'employees', raw.employee);
    const dept = c.resolveOpt(app, 'departments', raw.department);
    const proj = c.resolveOpt(app, 'projects', raw.project);
    return { account: acc.id, debit: d, credit: cr, party: party ? party.id : '', employee: emp ? emp.id : '', department: dept ? dept.id : '', project: proj ? proj.id : '', memo: String(raw.memo || '').slice(0, 300), keep: true };
  });
  return lines;
}

function previewJournal(ctx, p) {
  const util = u();
  const app = ctx.app;
  const lines = journalLines(app, p);
  let d = 0;
  let c = 0;
  for (const l of lines) {
    d += l.debit;
    c += l.credit;
  }
  if (d !== c) throw util.fail(409, 'The entry does not balance: debits ' + money().fmt(d, core().currency(app)) + ', credits ' + money().fmt(c, core().currency(app)) + '.', 'unbalanced');
  for (const l of lines) {
    const acc = app.findRecordById('accounts', l.account);
    if (acc.getBool('control')) throw util.fail(409, acc.getString('code') + ' ' + acc.getString('name') + ' is a control account: it changes only through its documents.', 'control_account');
  }
  const date = util.day(p, 'date', util.today());
  ledger().checkDate(app, ctx, date);
  return {
    kind: 'journal',
    auto: 'journal',
    amount: d,
    title: 'Journal entry of ' + money().fmt(d, core().currency(app)) + ' on ' + date,
    summary: util.text(p, 'memo', 500, '') || 'Manual journal entry',
    lines: ledger().describeLines(app, lines),
    currency: core().currency(app),
    target: { entity: 'accounts', id: lines[0].account, label: 'Journal entry' },
  };
}

function postJournal(ctx, p) {
  const util = u();
  const app = ctx.app;
  const lines = journalLines(app, p);
  const date = util.day(p, 'date', util.today());
  const memo = util.text(p, 'memo', 500, '');
  let id = '';
  app.runInTransaction((tx) => {
    const j = ledger().post(tx, ctx, { kind: 'manual', date: date, memo: memo, source: { entity: '', id: '', label: '' }, lines: lines }, { allowControl: false, compact: false });
    if (j === null) throw util.fail(400, 'The entry is all zero.', 'invalid');
    id = j.id;
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'post', entity: 'journals', ref: j.id, label: j.getString('number'), summary: 'Posted journal entry ' + j.getString('number') + (memo !== '' ? ': ' + memo : '') + (ctx.approving ? ' (proposed by your AI agent)' : '') });
  });
  return ledger().journalOut(app, app.findRecordById('journals', id), true);
}

function journalRec(app, ref) {
  return core().resolve(app, 'journals', ref);
}

function checkReversible(app, j) {
  const util = u();
  const src = j.getString('source_entity');
  if (src === 'documents' || src === 'payments' || src === 'stock_changes' || src === 'builds' || src === 'expense_claims' || src === 'payroll_runs') {
    throw util.fail(409, j.getString('number') + ' belongs to ' + (j.getString('source_label') || src) + ': void that instead, so everything it did is undone together.', 'use_source');
  }
  if (j.getString('state') === 'reversed') throw util.fail(409, j.getString('number') + ' is already reversed.', 'already_reversed');
  if (j.getString('kind') === 'reversal') throw util.fail(409, 'A reversal cannot itself be reversed.', 'invalid');
  if (j.getString('kind') === 'allocation_fx') throw util.fail(409, 'Remove the allocation instead (payments.unallocate).', 'use_source');
}

function previewReverse(ctx, p) {
  const util = u();
  const app = ctx.app;
  const j = journalRec(app, util.req(p, 'journal'));
  checkReversible(app, j);
  const lines = ledger().linesOf(app, j.id).map((l) => Object.assign({}, l, { debit: l.credit, credit: l.debit }));
  return {
    kind: 'journal',
    auto: '',
    amount: j.getInt('total'),
    title: 'Reverse ' + j.getString('number'),
    summary: j.getString('memo'),
    lines: ledger().describeLines(app, lines),
    currency: core().currency(app),
    target: { entity: 'journals', id: j.id, label: j.getString('number') },
  };
}

function reverseJournal(ctx, p) {
  const util = u();
  const app = ctx.app;
  const j = journalRec(app, util.req(p, 'journal'));
  checkReversible(app, j);
  let rid = '';
  app.runInTransaction((tx) => {
    const r = ledger().reverse(tx, ctx, j.id, { date: util.day(p, 'date', '') || undefined, memo: util.text(p, 'memo', 500, '') || undefined });
    rid = r.id;
    // A reversed bank entry or transfer frees its statement line.
    for (const bl of tx.findRecordsByFilter('bank_lines', 'journal = {:j}', '', 0, 0, { j: j.id })) {
      const x = tx.findRecordById('bank_lines', bl.id);
      x.set('status', 'unmatched');
      x.set('journal', '');
      tx.save(x);
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'reverse', entity: 'journals', ref: j.id, label: j.getString('number'), summary: 'Reversed ' + j.getString('number') + ' with ' + r.getString('number') });
  });
  return ledger().journalOut(app, app.findRecordById('journals', rid), true);
}

function listJournals(ctx, p) {
  const util = u();
  if (!canSeeBalances(ctx)) auth().need(ctx, 'accounting', 'view', 'see journal entries');
  const app = ctx.app;
  const pg = util.page(p, 50, 500);
  const where = ['1 = 1'];
  const bind = {};
  const kind = util.str(p, 'kind', '');
  if (kind !== '') {
    where.push('j.kind = {:k}');
    bind.k = kind;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('j.date >= {:f}');
    bind.f = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('j.date <= {:t}');
    bind.t = to;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(j.number LIKE {:q} ESCAPE '\\' OR j.memo LIKE {:q} ESCAPE '\\' OR j.source_label LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const acc = util.str(p, 'account', '');
  if (acc !== '') {
    where.push('j.id IN (SELECT journal FROM journal_lines WHERE account = {:a})');
    bind.a = core().resolve(app, 'accounts', acc).id;
  }
  if (util.bool(p, 'agent', false)) where.push("j.actor = 'agent'");
  const sql = ' FROM journals j WHERE ' + where.join(' AND ');
  const total = util.one(app, 'SELECT COUNT(j.id) AS n' + sql, { n: 0 }, bind).n;
  // One query for the page (names joined in): a record and lookups per entry are slow on long lists.
  const cur = core().currency(app);
  const m = money();
  const rows = util.rows(
    app,
    "SELECT j.id AS id, j.number AS number, j.date AS date, j.kind AS kind, j.memo AS memo, j.source_entity AS source_entity, j.source_id AS source_id, j.source_label AS source_label, j.state AS state, j.total AS total, j.actor AS actor, j.member AS member, IFNULL(mb.name, '') AS member_name, j.approved_by AS approved_by, IFNULL(ap.name, '') AS approver, j.reverses AS reverses, j.reversed_by AS reversed_by, j.created AS created FROM journals j LEFT JOIN members mb ON mb.id = j.member LEFT JOIN members ap ON ap.id = j.approved_by WHERE " +
      where.join(' AND ') +
      ' ORDER BY j.date DESC, j.created DESC LIMIT ' +
      pg.limit +
      ' OFFSET ' +
      pg.offset,
    { id: '', number: '', date: '', kind: '', memo: '', source_entity: '', source_id: '', source_label: '', state: '', total: 0, actor: '', member: '', member_name: '', approved_by: '', approver: '', reverses: '', reversed_by: '', created: '' },
    bind,
  );
  const name = (id, n) => (id === '' ? '' : n !== '' ? n : 'Former member');
  const journals = rows.map((r) => ({
    id: r.id,
    number: r.number,
    date: r.date,
    kind: r.kind,
    memo: r.memo,
    source: { entity: r.source_entity, id: r.source_id, label: r.source_label },
    state: r.state,
    total: r.total,
    total_text: m.minorText(r.total, cur),
    actor: r.actor,
    who: r.actor === 'agent' ? 'Your AI agent' : name(r.member, r.member_name),
    approved_by: name(r.approved_by, r.approver),
    reverses: r.reverses,
    reversed_by: r.reversed_by,
    created: r.created,
    currency: cur,
  }));
  return { journals: journals, total: total, currency: cur };
}

function getJournal(ctx, p) {
  const util = u();
  if (!canSeeBalances(ctx)) auth().need(ctx, 'accounting', 'view', 'see journal entries');
  const j = journalRec(ctx.app, util.req(p, 'journal'));
  const out = ledger().journalOut(ctx.app, j, true);
  let reversible = true;
  try {
    checkReversible(ctx.app, j);
  } catch {
    reversible = false;
  }
  out.can = { reverse: reversible && !ctx.isAgent && auth().can(ctx, 'accounting', 'full'), propose_reverse: reversible && ctx.isAgent };
  return out;
}

/* =============================================================== taxes */

function taxOut(app, t) {
  const util = u();
  const acc = (id) => {
    const a = util.byId(app, 'accounts', id);
    return a === null ? null : { id: a.id, code: a.getString('code'), name: a.getString('name') };
  };
  return {
    id: t.id,
    code: t.getString('code'),
    name: t.getString('name'),
    rate: money().bpText(t.getInt('rate_bp')),
    rate_bp: t.getInt('rate_bp'),
    scope: t.getString('scope'),
    recoverable: t.getBool('recoverable'),
    sales_account: acc(t.getString('sales_account')),
    purchase_account: acc(t.getString('purchase_account')),
    description: t.getString('description'),
    archived: t.getBool('archived'),
  };
}

function listTaxes(ctx, p) {
  const util = u();
  const all = util.bool(p, 'archived', false);
  return { taxes: ctx.app.findRecordsByFilter('taxes', all ? '' : 'archived = false', 'sort,name', 0, 0).map((t) => taxOut(ctx.app, t)) };
}

function needTaxes(ctx) {
  if (ctx.isAgent) throw u().fail(403, 'Your AI agent cannot change taxes. A person with full Accounting rights does.', 'agent_not_permitted');
  if (!ctx.admin) auth().need(ctx, 'accounting', 'full', 'change taxes');
}

function saveTax(ctx, t, p, isNew) {
  const util = u();
  const app = ctx.app;
  if (util.has(p, 'name')) t.set('name', util.squash(util.text(p, 'name', 60, '')));
  if (util.has(p, 'code')) {
    const c = util.text(p, 'code', 20, '').toUpperCase();
    if (!/^[A-Z0-9.\-_]+$/.test(c)) throw util.fail(400, 'A tax code uses letters and digits.', 'invalid_param');
    const other = util.findOne(app, 'taxes', 'code = {:c} && id != {:i}', { c: c, i: t.id || '' });
    if (other !== null) throw util.fail(409, 'The tax code ' + c + ' is taken.', 'duplicate');
    t.set('code', c);
  }
  if (isNew && (t.getString('name') === '' || t.getString('code') === '')) throw util.fail(400, 'name and code are required', 'missing_param');
  if (util.has(p, 'rate')) {
    const used = isNew ? 0 : util.one(app, "SELECT COUNT(dl.id) AS n FROM document_lines dl JOIN documents d ON d.id = dl.doc WHERE dl.tax = {:t} AND d.state != 'draft'", { n: 0 }, { t: t.id }).n;
    const bp = util.percent(p, 'rate', 100000);
    if (used > 0 && bp !== t.getInt('rate_bp')) throw util.fail(409, 'Posted documents use this tax at ' + money().bpText(t.getInt('rate_bp')) + '%. Archive it and add a new tax for the new rate.', 'in_use');
    t.set('rate_bp', bp || 0);
  }
  if (util.has(p, 'scope')) t.set('scope', util.oneOf(p, 'scope', ['sales', 'purchase', 'both'], 'both'));
  if (isNew && t.getString('scope') === '') t.set('scope', 'both');
  if (util.has(p, 'recoverable')) t.set('recoverable', util.bool(p, 'recoverable', true));
  for (const f of ['sales_account', 'purchase_account']) {
    if (!util.has(p, f)) continue;
    const a = core().resolveOpt(app, 'accounts', util.str(p, f, ''));
    if (a !== null && a.getBool('control')) throw util.fail(400, f + ' cannot be a control account.', 'control_account');
    t.set(f, a !== null ? a.id : '');
  }
  const sc = t.getString('scope');
  if (sc !== 'purchase' && t.getString('sales_account') === '') t.set('sales_account', core().systemAccount(app, 'tax_payable').id);
  if (sc !== 'sales' && t.getString('purchase_account') === '') t.set('purchase_account', core().systemAccount(app, 'tax_receivable').id);
  if (util.has(p, 'description')) t.set('description', util.text(p, 'description', 300, ''));
  if (util.has(p, 'archived')) t.set('archived', util.bool(p, 'archived', false));
  app.save(t);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: isNew ? 'create' : 'update', entity: 'taxes', ref: t.id, label: t.getString('code'), summary: (isNew ? 'Added' : 'Changed') + ' the tax ' + t.getString('name') });
  return taxOut(app, t);
}

function addTax(ctx, p) {
  needTaxes(ctx);
  const t = u().newRecord(ctx.app, 'taxes');
  t.set('archived', false);
  t.set('recoverable', true);
  t.set('sort', 100);
  return saveTax(ctx, t, p, true);
}

function updateTax(ctx, p) {
  needTaxes(ctx);
  const t = core().resolve(ctx.app, 'taxes', u().req(p, 'tax'));
  return saveTax(ctx, t, p, false);
}

/* ========================================================= payment terms */

function listTerms(ctx) {
  return {
    terms: ctx.app.findRecordsByFilter('payment_terms', 'archived = false', 'sort,name', 0, 0).map((t) => ({ id: t.id, name: t.getString('name'), days: t.getInt('days'), end_of_month: t.getBool('end_of_month') })),
  };
}

function saveTerms(ctx, t, p, isNew) {
  const util = u();
  if (ctx.isAgent || !(ctx.admin || auth().can(ctx, 'accounting', 'edit') || auth().can(ctx, 'sales', 'full'))) auth().need(ctx, 'accounting', 'edit', 'change payment terms');
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 60, ''));
    if (n !== '' && util.idsNocaseFind(ctx.app, 'payment_terms', 'name', n, t.id || '')) throw util.fail(409, 'There are already payment terms called ' + n + '.', 'duplicate');
    t.set('name', n);
  }
  if (isNew && t.getString('name') === '') throw util.fail(400, 'name is required', 'missing_param');
  if (util.has(p, 'days')) t.set('days', util.int(p, 'days', 0, 0, 3650));
  if (util.has(p, 'end_of_month')) t.set('end_of_month', util.bool(p, 'end_of_month', false));
  if (util.has(p, 'archived')) t.set('archived', util.bool(p, 'archived', false));
  ctx.app.save(t);
  return { id: t.id, name: t.getString('name'), days: t.getInt('days'), end_of_month: t.getBool('end_of_month'), archived: t.getBool('archived') };
}

function addTerms(ctx, p) {
  const t = u().newRecord(ctx.app, 'payment_terms');
  t.set('archived', false);
  t.set('sort', 100);
  return saveTerms(ctx, t, p, true);
}

function updateTerms(ctx, p) {
  const t = core().resolve(ctx.app, 'payment_terms', u().req(p, 'terms'));
  return saveTerms(ctx, t, p, false);
}

/* =========================================================== currencies */

function curOut(c, base) {
  return { id: c.id, code: c.getString('code'), name: c.getString('name'), rate: money().e8Text(c.getInt('rate_e8')), rate_e8: c.getInt('rate_e8'), rate_date: c.getString('rate_date'), base: c.getString('code') === base, archived: c.getBool('archived') };
}

function listCurrencies(ctx) {
  const base = core().currency(ctx.app);
  return { currencies: ctx.app.findRecordsByFilter('currencies', '', 'code', 0, 0).map((c) => curOut(c, base)), base: base };
}

function needCurrencies(ctx) {
  if (ctx.isAgent) return;
  if (!ctx.admin) auth().need(ctx, 'accounting', 'edit', 'change exchange rates');
}

function setCurrency(ctx, p) {
  const util = u();
  needCurrencies(ctx);
  const app = ctx.app;
  const code = util.req(p, 'code', 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw util.fail(400, 'code must be a 3-letter currency code', 'invalid_param');
  const base = core().currency(app);
  let c = util.findOne(app, 'currencies', 'code = {:c}', { c: code });
  if (c === null) {
    c = util.newRecord(app, 'currencies');
    c.set('code', code);
    c.set('archived', false);
  }
  if (util.has(p, 'name')) c.set('name', util.text(p, 'name', 60, ''));
  if (code === base) c.set('rate_e8', money().E8);
  else if (util.has(p, 'rate')) {
    const r = util.rate(p, 'rate');
    if (r === null) throw util.fail(400, 'rate is required: how many ' + base + ' one ' + code + ' is worth', 'missing_param');
    c.set('rate_e8', r);
    c.set('rate_date', util.day(p, 'rate_date', util.today()));
  } else if (c.getInt('rate_e8') <= 0) throw util.fail(400, 'rate is required: how many ' + base + ' one ' + code + ' is worth', 'missing_param');
  if (util.has(p, 'archived')) c.set('archived', util.bool(p, 'archived', false));
  app.save(c);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'rate', entity: 'currencies', ref: c.id, label: code, summary: '1 ' + code + ' = ' + money().e8Text(c.getInt('rate_e8')) + ' ' + base });
  return curOut(c, base);
}

/** Today's rates for every currency in use, from the ECB (Frankfurter) or currency-api. */
function refreshRates(ctx) {
  const util = u();
  needCurrencies(ctx);
  const app = ctx.app;
  const base = core().currency(app);
  const list = app.findRecordsByFilter('currencies', "code != {:b} && archived = false", 'code', 0, 0, { b: base });
  if (list.length === 0) return { updated: 0, message: 'No other currencies to update.' };
  const codes = list.map((c) => c.getString('code'));
  let rates = null;
  let source = '';
  try {
    const res = $http.send({ url: 'https://api.frankfurter.dev/v1/latest?base=' + base + '&symbols=' + codes.join(','), method: 'GET', timeout: 8 });
    if (res.statusCode === 200 && res.json && res.json.rates) {
      rates = res.json.rates;
      source = 'European Central Bank (Frankfurter)';
    }
  } catch {
    rates = null;
  }
  if (rates === null) {
    try {
      const res = $http.send({ url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/' + base.toLowerCase() + '.json', method: 'GET', timeout: 8 });
      if (res.statusCode === 200 && res.json && res.json[base.toLowerCase()]) {
        const r = res.json[base.toLowerCase()];
        rates = {};
        for (const c of codes) if (r[c.toLowerCase()] !== undefined) rates[c] = r[c.toLowerCase()];
        source = 'currency-api';
      }
    } catch {
      rates = null;
    }
  }
  if (rates === null) throw util.fail(502, 'No exchange rate source answered. Set the rates by hand.', 'rates_unavailable');
  let n = 0;
  const missing = [];
  app.runInTransaction((tx) => {
    for (const c of list) {
      const per = rates[c.getString('code')];
      if (typeof per !== 'number' || per <= 0) {
        missing.push(c.getString('code'));
        continue;
      }
      const x = tx.findRecordById('currencies', c.id);
      x.set('rate_e8', Math.round(money().E8 / per));
      x.set('rate_date', util.today());
      tx.save(x);
      n++;
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'rate', entity: 'currencies', ref: '', label: source, summary: 'Updated ' + n + ' exchange rates from ' + source });
  });
  return { updated: n, missing: missing, source: source, currencies: listCurrencies(ctx).currencies };
}

/* ====================================================== opening balances */

function openingAccounts(ctx, p) {
  const util = u();
  if (ctx.isAgent) throw util.fail(403, 'Opening balances are entered by a person with full Accounting rights.', 'agent_not_permitted');
  auth().need(ctx, 'accounting', 'full', 'enter opening balances');
  const app = ctx.app;
  const date = util.req(p, 'date', '2026-01-01');
  if (!util.isDay(date)) throw util.fail(400, 'date must be YYYY-MM-DD', 'invalid_param');
  const lines = journalLines(app, p, 1);
  let d = 0;
  let c = 0;
  for (const l of lines) {
    const acc = app.findRecordById('accounts', l.account);
    if (acc.getBool('control')) throw util.fail(409, acc.getString('code') + ' ' + acc.getString('name') + ' is a control account: enter open invoices and bills with opening.documents, and stock with opening.stock.', 'control_account');
    d += l.debit;
    c += l.credit;
  }
  const ob = core().systemAccount(app, 'opening_balance').id;
  if (d > c) lines.push({ account: ob, debit: 0, credit: d - c, memo: 'Opening balance difference' });
  if (c > d) lines.push({ account: ob, debit: c - d, credit: 0, memo: 'Opening balance difference' });
  let id = '';
  app.runInTransaction((tx) => {
    const j = ledger().post(tx, ctx, { kind: 'opening', date: date, memo: 'Opening balances as at ' + date, source: { entity: '', id: '', label: 'Opening balances' }, lines: lines }, { compact: false });
    id = j.id;
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'post', entity: 'journals', ref: j.id, label: j.getString('number'), summary: 'Opening balances as at ' + date });
  });
  return ledger().journalOut(app, app.findRecordById('journals', id), true);
}

/** Open invoices or bills at the cut-over: each becomes a posted document against opening balance equity. */
function openingDocuments(ctx, p) {
  const util = u();
  if (ctx.isAgent) throw util.fail(403, 'Opening balances are entered by a person with full Accounting rights.', 'agent_not_permitted');
  auth().need(ctx, 'accounting', 'full', 'enter opening balances');
  const app = ctx.app;
  const type = util.oneOf(p, 'type', ['invoice', 'bill'], '');
  if (type === '') throw util.fail(400, 'type is required: invoice or bill', 'missing_param');
  const cutover = util.req(p, 'date', '2026-01-01');
  if (!util.isDay(cutover)) throw util.fail(400, 'date must be YYYY-MM-DD', 'invalid_param');
  const input = util.list(p, 'lines') || [];
  if (input.length === 0) throw util.fail(400, 'lines is required: [{"party":"Acme","number":"INV-0981","date":"2026-09-15","due_date":"2026-10-15","amount":"1200.00"}]', 'missing_param');
  const base = core().currency(app);
  const ob = core().systemAccount(app, 'opening_balance').id;
  const control = core().systemAccount(app, type === 'invoice' ? 'ar' : 'ap').id;
  const rows = input.map((raw, i) => {
    util.keysOnly(raw, ['party', 'number', 'date', 'due_date', 'amount', 'currency', 'fx_rate', 'reference'], 'Line ' + (i + 1));
    const party = core().resolve(app, 'parties', String(raw.party || ''));
    const cur = String(raw.currency || base).toUpperCase();
    const amount = money().toMinor(String(raw.amount || ''), cur, false);
    if (amount === null || amount <= 0) throw util.fail(400, 'Line ' + (i + 1) + ': amount must be like 1200.00', 'invalid_amount');
    let fx = money().E8;
    if (cur !== base) {
      fx = raw.fx_rate ? money().toE8(String(raw.fx_rate)) : (util.findOne(app, 'currencies', 'code = {:c}', { c: cur }) || { getInt: () => 0 }).getInt('rate_e8');
      if (!fx) throw util.fail(400, 'Line ' + (i + 1) + ': no exchange rate for ' + cur + '. Give fx_rate.', 'fx_missing');
    }
    const date = raw.date && util.isDay(String(raw.date)) ? String(raw.date) : cutover;
    const due = raw.due_date && util.isDay(String(raw.due_date)) ? String(raw.due_date) : date;
    return { party: party, number: String(raw.number || '').slice(0, 40), date: date, due: due, cur: cur, fx: fx, amount: amount, base: money().convert(amount, cur, base, fx), reference: String(raw.reference || '').slice(0, 120) };
  });
  const made = [];
  app.runInTransaction((tx) => {
    for (const r of rows) {
      const d = util.newRecord(tx, 'documents');
      d.set('type', type);
      let number = r.number;
      if (number === '' || util.findOne(tx, 'documents', 'type = {:t} && number = {:n}', { t: type, n: number }) !== null) number = core().nextNumber(tx, type);
      d.set('number', number);
      d.set('state', 'posted');
      d.set('party', r.party.id);
      d.set('date', r.date);
      d.set('due_date', r.due);
      d.set('currency', r.cur);
      d.set('fx_e8', r.fx);
      d.set('reference', r.reference !== '' ? r.reference : 'Opening balance');
      d.set('moves_stock', false);
      d.set('subtotal', r.amount);
      d.set('discount', 0);
      d.set('tax', 0);
      d.set('total', r.amount);
      d.set('total_base', r.base);
      d.set('paid', 0);
      d.set('balance', r.amount);
      d.set('fulfil_status', 'none');
      d.set('bill_status', 'none');
      d.set('internal_note', 'Opening balance at ' + cutover);
      d.set('prepared_by', ctx.memberId);
      d.set('prepared_actor', 'person');
      d.set('posted_by', ctx.memberId);
      d.set('posted_at', util.nowIso());
      d.set('lines_count', 1);
      tx.save(d);
      const l = util.newRecord(tx, 'document_lines');
      l.set('doc', d.id);
      l.set('sort', 0);
      l.set('description', 'Opening balance');
      l.set('qty', 1);
      l.set('unit_price', money().minorToE4(r.amount, r.cur));
      l.set('account', ob);
      l.set('net', r.amount);
      l.set('total', r.amount);
      l.set('net_base', r.base);
      tx.save(l);
      const lines =
        type === 'invoice'
          ? [
              { account: control, debit: r.base, credit: 0, party: r.party.id, doc: d.id, currency: r.cur, amount_cur: r.amount, memo: 'Opening balance ' + number },
              { account: ob, debit: 0, credit: r.base, memo: 'Opening balance ' + number },
            ]
          : [
              { account: ob, debit: r.base, credit: 0, memo: 'Opening balance ' + number },
              { account: control, debit: 0, credit: r.base, party: r.party.id, doc: d.id, currency: r.cur, amount_cur: -r.amount, memo: 'Opening balance ' + number },
            ];
      const j = ledger().post(tx, ctx, { kind: 'opening', date: cutover, memo: 'Opening ' + type + ' ' + number, source: { entity: 'documents', id: d.id, label: (type === 'invoice' ? 'Invoice ' : 'Bill ') + number }, lines: lines }, { allowControl: true });
      d.set('journal', j.id);
      tx.save(d);
      made.push({ id: d.id, number: number, party: r.party.getString('name'), amount: r.amount, currency: r.cur });
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'post', entity: 'documents', ref: '', label: 'Opening ' + type + 's', summary: 'Entered ' + made.length + ' open ' + type + 's at ' + cutover });
  });
  return { documents: made };
}

function openingStock(ctx, p) {
  const util = u();
  if (ctx.isAgent) throw util.fail(403, 'Opening balances are entered by a person with full Accounting rights.', 'agent_not_permitted');
  auth().need(ctx, 'accounting', 'full', 'enter opening balances');
  auth().need(ctx, 'inventory', 'edit', 'enter opening stock');
  const app = ctx.app;
  const items = require(`${__hooks}/lib_items.js`);
  const lines = (util.list(p, 'lines') || []).map((x, i) => {
    util.keysOnly(x, ['item', 'qty', 'unit_cost'], 'Line ' + (i + 1));
    return { item: x.item, qty: x.qty, unit_cost: x.unit_cost };
  });
  if (lines.some((l) => Number(l.qty) <= 0)) throw util.fail(400, 'Opening stock quantities are positive.', 'invalid_param');
  return items.change(ctx, { kind: 'adjust', reason: 'opening', warehouse: util.str(p, 'warehouse', ''), date: util.req(p, 'date', '2026-01-01'), note: 'Opening stock', lines: lines, account: core().systemAccount(app, 'opening_balance').id });
}

module.exports = {
  SUBTYPES: SUBTYPES,
  debitNatured: debitNatured,
  list: list,
  get: get,
  add: add,
  update: update,
  remove: remove,
  previewJournal: previewJournal,
  postJournal: postJournal,
  previewReverse: previewReverse,
  reverseJournal: reverseJournal,
  listJournals: listJournals,
  getJournal: getJournal,
  listTaxes: listTaxes,
  addTax: addTax,
  updateTax: updateTax,
  listTerms: listTerms,
  addTerms: addTerms,
  updateTerms: updateTerms,
  listCurrencies: listCurrencies,
  setCurrency: setCurrency,
  refreshRates: refreshRates,
  openingAccounts: openingAccounts,
  openingDocuments: openingDocuments,
  openingStock: openingStock,
};
