/// <reference path="../pb_data/types.d.ts" />
/**
 * Banking: bank, cash and card accounts, statement lines (imported from CSV
 * or added by hand) and reconciliation.
 *
 * Each bank account has its own ledger account. Reconciling a statement line
 * links it to what is already in the books (a posted payment or journal
 * entry), or creates that: a payment from a customer or to a supplier, a
 * journal entry against an account (fees, interest, tax), or a transfer
 * between two accounts.
 *
 * Suggestions are structured: the same amount near the same date, open
 * invoices or bills of that amount, and document or payment numbers that
 * appear as a whole word in the line. Your AI agent proposes the rest.
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

function canView(ctx) {
  return ctx.isAgent || auth().can(ctx, 'banking', 'view');
}

function needView(ctx) {
  if (!canView(ctx)) auth().need(ctx, 'banking', 'view', 'see bank accounts');
}

function needEdit(ctx) {
  if (!ctx.isAgent) auth().need(ctx, 'banking', 'edit', 'reconcile bank accounts');
}

function bankCur(app, bank) {
  return bank.getString('currency') || core().currency(app);
}

/** The bank's balance in its own currency (through `to`). */
function balanceOf(app, bank, to) {
  const util = u();
  const base = core().currency(app);
  const cur = bankCur(app, bank);
  const acc = bank.getString('account');
  const t = to || '9999-12-31';
  if (cur === base) {
    const sign = isLiability(app, bank) ? -1 : 1;
    return sign * util.one(app, 'SELECT IFNULL(SUM(debit), 0) - IFNULL(SUM(credit), 0) AS b FROM journal_lines WHERE account = {:a} AND date <= {:t}', { b: 0 }, { a: acc, t: t }).b;
  }
  return util.one(app, 'SELECT IFNULL(SUM(amount_cur), 0) AS b FROM journal_lines WHERE account = {:a} AND date <= {:t} AND currency = {:c}', { b: 0 }, { a: acc, t: t, c: cur }).b;
}

function isLiability(app, bank) {
  const acc = u().byId(app, 'accounts', bank.getString('account'));
  return acc !== null && acc.getString('type') === 'liability';
}

function bankOut(app, b, full) {
  const util = u();
  const acc = util.byId(app, 'accounts', b.getString('account'));
  const out = {
    id: b.id,
    name: b.getString('name'),
    kind: b.getString('kind'),
    currency: bankCur(app, b),
    bank_name: b.getString('bank_name'),
    account_number: b.getString('account_number'),
    color: b.getInt('color'),
    archived: b.getBool('archived'),
    account: acc !== null ? { id: acc.id, code: acc.getString('code'), name: acc.getString('name') } : null,
  };
  if (full) {
    out.balance = balanceOf(app, b, '');
    out.unmatched = util.one(app, "SELECT COUNT(id) AS n FROM bank_lines WHERE bank = {:b} AND status = 'unmatched'", { n: 0 }, { b: b.id }).n;
    const last = util.one(app, 'SELECT IFNULL(MAX(date), \'\') AS d FROM bank_lines WHERE bank = {:b}', { d: '' }, { b: b.id });
    out.last_statement_date = last ? last.d : '';
    const withBal = util.findOne(app, 'bank_lines', 'bank = {:b} && balance != 0', { b: b.id });
    out.statement_balance = null;
    if (withBal !== null) {
      const latest = util.one(app, 'SELECT balance FROM bank_lines WHERE bank = {:b} AND balance != 0 ORDER BY date DESC, created DESC LIMIT 1', { balance: 0 }, { b: b.id });
      out.statement_balance = latest ? latest.balance : null;
    }
  }
  return out;
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const all = util.bool(p, 'archived', false);
  const recs = app.findRecordsByFilter('banks', all ? '' : 'archived = false', 'sort,name', 0, 0);
  // People who record payments see the accounts to choose from; balances need Banking.
  if (!canView(ctx)) {
    if (!auth().can(ctx, 'sales', 'view') && !auth().can(ctx, 'purchasing', 'view') && !auth().can(ctx, 'people', 'view') && !auth().can(ctx, 'payroll', 'view')) needView(ctx);
    return { banks: recs.map((b) => bankOut(app, b, false)), currency: core().currency(app) };
  }
  const banks = recs.map((b) => bankOut(app, b, true));
  const base = core().currency(app);
  const total = banks.filter((b) => b.currency === base && b.kind !== 'card').reduce((s, b) => s + b.balance, 0);
  return { banks: banks, total: total, currency: base };
}

function get(ctx, p) {
  const util = u();
  needView(ctx);
  const app = ctx.app;
  const b = core().resolve(app, 'banks', util.req(p, 'bank'));
  const out = bankOut(app, b, true);
  const today = util.today();
  const from = util.addDays(today, -89);
  const start = balanceOf(app, b, util.addDays(from, -1));
  const base = core().currency(app);
  const foreign = bankCur(app, b) !== base;
  const sign = isLiability(app, b) ? -1 : 1;
  const byDay = {};
  for (const r of util.rows(app, 'SELECT date, IFNULL(SUM(debit), 0) - IFNULL(SUM(credit), 0) AS net, IFNULL(SUM(amount_cur), 0) AS cur FROM journal_lines WHERE account = {:a} AND date >= {:f} GROUP BY date', { date: '', net: 0, cur: 0 }, { a: b.getString('account'), f: from })) {
    byDay[r.date] = foreign ? r.cur : sign * r.net;
  }
  let bal = start;
  const series = [];
  for (let i = 89; i >= 0; i--) {
    const d = util.addDays(today, -i);
    bal += byDay[d] || 0;
    series.push({ date: d, balance: bal });
  }
  out.history = series;
  out.recent = util
    .rows(app, 'SELECT jl.date AS date, jl.debit AS debit, jl.credit AS credit, jl.amount_cur AS amount_cur, jl.memo AS memo, j.number AS journal, j.kind AS kind, j.source_entity AS entity, j.source_id AS source, j.source_label AS label FROM journal_lines jl JOIN journals j ON j.id = jl.journal WHERE jl.account = {:a} ORDER BY jl.date DESC, j.created DESC LIMIT 30', { date: '', debit: 0, credit: 0, amount_cur: 0, memo: '', journal: '', kind: '', entity: '', source: '', label: '' }, { a: b.getString('account') })
    .map((r) => ({ date: r.date, amount: foreign ? r.amount_cur : sign * (r.debit - r.credit), memo: r.memo, journal: r.journal, kind: r.kind, entity: r.entity, source: r.source, label: r.label }));
  out.can = { edit: ctx.isAgent || auth().can(ctx, 'banking', 'edit'), full: !ctx.isAgent && auth().can(ctx, 'banking', 'full') };
  return out;
}

function nextCode(app, kind) {
  const util = u();
  const prefix = kind === 'card' ? '21' : '10';
  const rows = util.rows(app, 'SELECT code FROM accounts WHERE code LIKE {:p}', { code: '' }, { p: prefix + '%' });
  let max = Number(prefix + '10') - 1;
  for (const r of rows) {
    if (/^\d{4}$/.test(r.code) && Number(r.code) > max && Number(r.code) < Number(prefix + '99')) max = Number(r.code);
  }
  let n = Math.max(max + 1, Number(prefix + '11'));
  while (util.findOne(app, 'accounts', 'code = {:c}', { c: String(n) }) !== null && n < Number(prefix + '99')) n++;
  return String(n);
}

function add(ctx, p) {
  const util = u();
  const app = ctx.app;
  const name = util.squash(util.text(p, 'name', 80, ''));
  if (name === '') throw util.fail(400, 'name is required', 'missing_param');
  if (util.idsNocaseFind(app, 'banks', 'name', name, '')) throw util.fail(409, 'There is already an account called ' + name + '.', 'duplicate');
  const kind = util.oneOf(p, 'kind', ['bank', 'cash', 'card'], 'bank');
  const cur = (util.str(p, 'currency', '') || core().currency(app)).toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw util.fail(400, 'currency must be a 3-letter code', 'invalid_param');
  if (cur !== core().currency(app)) {
    const c = util.findOne(app, 'currencies', 'code = {:c}', { c: cur });
    if (c === null) throw util.fail(400, 'Add ' + cur + ' with its exchange rate under Settings, Currencies first.', 'fx_missing');
  }
  let id = '';
  app.runInTransaction((tx) => {
    const code = util.str(p, 'code', '') || nextCode(tx, kind);
    if (util.findOne(tx, 'accounts', 'code = {:c}', { c: code }) !== null) throw util.fail(409, 'The account code ' + code + ' is taken.', 'duplicate');
    const acc = util.newRecord(tx, 'accounts');
    acc.set('code', code);
    acc.set('name', name);
    acc.set('type', kind === 'card' ? 'liability' : 'asset');
    acc.set('subtype', kind === 'card' ? 'current_liability' : kind === 'cash' ? 'cash' : 'bank');
    acc.set('system_key', '');
    acc.set('control', false);
    acc.set('archived', false);
    tx.save(acc);
    const b = util.newRecord(tx, 'banks');
    b.set('name', name);
    b.set('account', acc.id);
    b.set('kind', kind);
    b.set('currency', cur);
    b.set('bank_name', util.text(p, 'bank_name', 80, ''));
    b.set('account_number', util.text(p, 'account_number', 40, ''));
    b.set('color', util.one(tx, 'SELECT COUNT(id) AS n FROM banks', { n: 0 }).n % 8);
    b.set('archived', false);
    b.set('sort', 100);
    tx.save(b);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'create', entity: 'banks', ref: b.id, label: name, summary: 'Added the ' + kind + ' account ' + name + ' (' + code + ', ' + cur + ')' });
    id = b.id;
  });
  return get(ctx, { bank: id });
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const b = core().resolve(app, 'banks', util.req(p, 'bank'));
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('banks', b.id);
    if (util.has(p, 'name')) {
      const n = util.squash(util.text(p, 'name', 80, ''));
      if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
      if (util.idsNocaseFind(tx, 'banks', 'name', n, r.id)) throw util.fail(409, 'There is already an account called ' + n + '.', 'duplicate');
      r.set('name', n);
      const acc = tx.findRecordById('accounts', r.getString('account'));
      acc.set('name', n);
      tx.save(acc);
    }
    if (util.has(p, 'bank_name')) r.set('bank_name', util.text(p, 'bank_name', 80, ''));
    if (util.has(p, 'account_number')) r.set('account_number', util.text(p, 'account_number', 40, ''));
    if (util.has(p, 'color')) r.set('color', util.int(p, 'color', 0, 0, 7));
    if (util.has(p, 'archived')) r.set('archived', util.bool(p, 'archived', false));
    tx.save(r);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'update', entity: 'banks', ref: r.id, label: r.getString('name'), summary: 'Changed the bank account ' + r.getString('name') });
  });
  return get(ctx, { bank: b.id });
}

/* ================================================================= lines */

function lineOut(app, l, cache) {
  const util = u();
  let match = null;
  if (l.getString('payment') !== '') {
    const pay = util.byId(app, 'payments', l.getString('payment'));
    if (pay !== null) {
      const party = util.byId(app, 'parties', pay.getString('party'));
      match = { kind: 'payment', id: pay.id, label: require(`${__hooks}/lib_payments.js`).payLabel(pay), party: party ? party.getString('name') : '' };
    }
  } else if (l.getString('journal') !== '') {
    const j = util.byId(app, 'journals', l.getString('journal'));
    if (j !== null) match = { kind: 'journal', id: j.id, label: j.getString('number') + (j.getString('memo') !== '' ? ': ' + j.getString('memo') : ''), party: '' };
  }
  return {
    id: l.id,
    bank: l.getString('bank'),
    date: l.getString('date'),
    description: l.getString('description'),
    reference: l.getString('reference'),
    amount: l.getInt('amount'),
    balance: l.getInt('balance'),
    status: l.getString('status'),
    match: match,
    suggestion: util.jsonOf(l, 'suggestion'),
    matched_by: l.getString('matched_actor') === 'agent' ? 'Your AI agent' : l.getString('matched_by') !== '' ? require(`${__hooks}/lib_audit.js`).memberName(app, l.getString('matched_by'), cache) : '',
    matched_at: l.getString('matched_at'),
    import: l.getString('import'),
  };
}

function lines(ctx, p) {
  const util = u();
  needView(ctx);
  const app = ctx.app;
  const b = core().resolve(app, 'banks', util.req(p, 'bank'));
  const pg = util.page(p, 100, 1000);
  const where = ['bank = {:b}'];
  const bind = { b: b.id };
  const status = util.oneOf(p, 'status', ['unmatched', 'matched', 'ignored'], '');
  if (status !== '') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('date >= {:f}');
    bind.f = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('date <= {:t}');
    bind.t = to;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(description LIKE {:q} ESCAPE '\\' OR reference LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const sql = ' FROM bank_lines WHERE ' + where.join(' AND ');
  const total = util.one(app, 'SELECT COUNT(id) AS n, IFNULL(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS money_in, IFNULL(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS money_out' + sql, { n: 0, money_in: 0, money_out: 0 }, bind);
  const ids = util.rows(app, 'SELECT id' + sql + ' ORDER BY date DESC, created DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const counts = {};
  for (const r of util.rows(app, 'SELECT status, COUNT(id) AS n FROM bank_lines WHERE bank = {:b} GROUP BY status', { status: '', n: 0 }, { b: b.id })) counts[r.status] = r.n;
  const cache = {};
  return { lines: ids.map((x) => lineOut(app, app.findRecordById('bank_lines', x.id), cache)), total: total.n, money_in: total.money_in, money_out: total.money_out, counts: counts, bank: bankOut(app, b, false) };
}

function dedupeKey(bankId, date, amount, desc, ref, n) {
  return u().sha([bankId, date, amount, u().squash(desc).toLowerCase(), u().squash(ref).toLowerCase(), n].join('|'));
}

function addLine(ctx, p) {
  const util = u();
  needEdit(ctx);
  const app = ctx.app;
  const b = core().resolve(app, 'banks', util.req(p, 'bank'));
  const cur = bankCur(app, b);
  const amount = util.money(p, 'amount', cur, { required: true, allowNegative: true });
  if (amount === 0) throw util.fail(400, 'amount cannot be 0', 'invalid_amount');
  const r = util.newRecord(app, 'bank_lines');
  r.set('bank', b.id);
  r.set('date', util.day(p, 'date', util.today()));
  r.set('amount', amount);
  r.set('description', util.text(p, 'description', 500, ''));
  r.set('reference', util.text(p, 'reference', 200, ''));
  r.set('status', 'unmatched');
  r.set('dedupe', '');
  app.save(r);
  return lineOut(app, r, {});
}

function deleteLine(ctx, p) {
  const util = u();
  needEdit(ctx);
  const l = core().resolve(ctx.app, 'bank_lines', util.req(p, 'line'));
  if (l.getString('status') === 'matched') throw util.fail(409, 'Unmatch the line first.', 'matched');
  if (util.bool(p, 'preview', false)) return { preview: true };
  ctx.app.delete(l);
  return { deleted: true };
}

/* ================================================================ import */

/**
 * Values that are letters joined to digits (INV-00017, PO 778, #A12) once the
 * account's currency code and CR/DR markers are set aside: references.
 */
function refLike(values, cur) {
  if (values.length === 0) return false;
  let n = 0;
  for (const v of values) {
    const t = String(v)
      .split(/\s+/)
      .filter((w) => w.toUpperCase() !== cur && w.toUpperCase() !== 'CR' && w.toUpperCase() !== 'DR')
      .join(' ');
    if (/[A-Za-z]{2,}\s*[-/#]?\s*\d/.test(t)) n++;
  }
  return n / values.length >= 0.5;
}

/** Work out columns and rows of a statement CSV (preview and run share it). */
function planImport(app, rec, p) {
  const util = u();
  const csv = require(`${__hooks}/lib_csv.js`);
  const bank = app.findRecordById('banks', rec.getString('target'));
  const cur = bankCur(app, bank);
  const saved = util.jsonOf(rec, 'mapping') || {};
  const text = csv.readStored(app, rec, 'file');
  const t = csv.table(text, saved.delimiter);
  const rows = t.rows;
  if (rows.length === 0) throw util.fail(400, 'The file has no rows.', 'empty');
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  // Header: the first row reads as text where the second has dates or numbers.
  let hasHeader = saved.has_header;
  if (util.has(p, 'has_header')) hasHeader = util.bool(p, 'has_header', true);
  if (hasHeader === undefined) {
    const first = rows[0];
    const second = rows[1] || [];
    let looksHeader = false;
    for (let c = 0; c < width; c++) {
      const a = csv.analyzeColumn([first[c] || '']);
      const b2 = csv.analyzeColumn([second[c] || '']);
      if (a.kind === 'text' && (b2.kind === 'date' || b2.kind === 'amount')) looksHeader = true;
    }
    hasHeader = looksHeader;
  }
  const header = hasHeader ? rows[0].map((h, i) => (h !== '' ? h : 'Column ' + i)) : Array.from({ length: width }, (_, i) => 'Column ' + i);
  const data = hasHeader ? rows.slice(1) : rows;
  const kinds = [];
  // A column of references (INV-00017, PO-778) reads as digits once letters are dropped: it is a reference, not money.
  let detRef = null;
  for (let c = 0; c < width; c++) {
    const vals = csv.columnValues(data, c);
    let k = csv.analyzeColumn(vals);
    if (k.kind === 'amount' && refLike(vals, cur)) {
      k = { kind: 'text', reference: true };
      if (detRef === null) detRef = c;
    }
    kinds.push(k);
  }
  const pick = (name, detected) => {
    if (util.has(p, name)) {
      const v = p[name];
      if (v === '' || v === null || v === -1 || v === '-1') return null;
      return csv.resolveColumn(v, header);
    }
    if (saved[name] !== undefined) return saved[name];
    return detected;
  };
  const dateCols = kinds.map((k, i) => (k.kind === 'date' ? i : -1)).filter((i) => i >= 0);
  const amountCols = kinds.map((k, i) => (k.kind === 'amount' && !k.reference ? i : -1)).filter((i) => i >= 0);
  const textCols = kinds.map((k, i) => (k.kind === 'text' ? i : -1)).filter((i) => i >= 0);
  // A signed amount column; else a money-out and a money-in pair.
  let detAmount = null;
  let detDebit = null;
  let detCredit = null;
  const signed = amountCols.find((i) => kinds[i].mixedSigns);
  if (signed !== undefined) detAmount = signed;
  else if (amountCols.length >= 2) {
    // Two columns where each row fills one of them: money out, then money in.
    const a = amountCols[0];
    const b2 = amountCols[1];
    const exclusive = data.every((r) => (r[a] || '') === '' || (r[b2] || '') === '');
    if (exclusive) {
      detDebit = a;
      detCredit = b2;
    } else detAmount = a;
  } else if (amountCols.length === 1) detAmount = amountCols[0];
  let detDesc = null;
  let best = -1;
  for (const c of textCols) {
    if (c === detRef) continue;
    const vals = csv.columnValues(data, c);
    const avg = vals.reduce((s, v) => s + v.length, 0) / Math.max(1, vals.length);
    if (avg > best) {
      best = avg;
      detDesc = c;
    }
  }
  const map = {
    date_col: pick('date_col', dateCols.length > 0 ? dateCols[0] : null),
    amount_col: pick('amount_col', detAmount),
    debit_col: pick('debit_col', detDebit),
    credit_col: pick('credit_col', detCredit),
    description_col: pick('description_col', detDesc),
    reference_col: pick('reference_col', detRef),
  };
  if (map.date_col === null) throw util.fail(400, 'No date column found. Give date_col (0 is the first column).', 'mapping');
  if (map.amount_col === null && (map.debit_col === null || map.credit_col === null)) throw util.fail(400, 'No amount column found. Give amount_col, or debit_col and credit_col.', 'mapping');
  // Date layout: the reading that is sorted, in the past and spans the least.
  const dateVals = csv.columnValues(data, map.date_col);
  const formats = csv.dateFormatsFor(dateVals);
  let fmt = util.str(p, 'date_format', '') || saved.date_format || '';
  if (fmt !== '' && csv.DATE_FORMATS.indexOf(fmt) < 0) throw util.fail(400, 'date_format must be one of: ' + csv.DATE_FORMATS.join(', '), 'invalid_param');
  if (fmt === '' || (formats.indexOf(fmt) < 0 && !util.has(p, 'date_format'))) {
    let top = null;
    let score = null;
    const today = util.today();
    for (const f of formats) {
      const s2 = csv.plausibility(data.map((r) => csv.parseDate(r[map.date_col] || '', f)), today);
      if (score === null || csv.better(s2, score)) {
        score = s2;
        top = f;
      }
    }
    fmt = top || 'YYYY-MM-DD';
  }
  const amountVals = map.amount_col !== null ? csv.columnValues(data, map.amount_col) : csv.columnValues(data, map.debit_col).concat(csv.columnValues(data, map.credit_col));
  const decimal = util.str(p, 'decimal', '') || saved.decimal || csv.detectDecimal(amountVals);
  const flip = util.has(p, 'flip') ? util.bool(p, 'flip', false) : saved.flip === true;
  const planned = [];
  const seen = {};
  const counts = { total: 0, new: 0, duplicate: 0, invalid: 0 };
  let sumIn = 0;
  let sumOut = 0;
  let minD = '';
  let maxD = '';
  data.forEach((r, i) => {
    counts.total++;
    const date = csv.parseDate(r[map.date_col] || '', fmt);
    let amount = null;
    let problem = '';
    if (map.amount_col !== null) {
      const a = csv.parseAmount(r[map.amount_col] || '', decimal);
      if (a !== null && a !== 'empty') {
        const m = money().toMinor(a.text, cur, false);
        if (m !== null) amount = a.neg ? -m : m;
      }
    } else {
      const d = csv.parseAmount(r[map.debit_col] || '', decimal);
      const c = csv.parseAmount(r[map.credit_col] || '', decimal);
      const dm = d !== null && d !== 'empty' ? money().toMinor(d.text, cur, false) : null;
      const cm = c !== null && c !== 'empty' ? money().toMinor(c.text, cur, false) : null;
      if (dm !== null && dm !== 0) amount = -dm;
      else if (cm !== null && cm !== 0) amount = cm;
    }
    if (flip && amount !== null) amount = -amount;
    if (date === null) problem = 'The date cannot be read with ' + fmt;
    else if (amount === null || amount === 0) problem = 'No amount';
    const desc = map.description_col !== null ? String(r[map.description_col] || '').slice(0, 500) : '';
    const ref = map.reference_col !== null ? String(r[map.reference_col] || '').slice(0, 200) : '';
    let status = 'new';
    let key = '';
    if (problem !== '') {
      status = 'invalid';
      counts.invalid++;
    } else {
      const base = [date, amount, util.squash(desc).toLowerCase(), util.squash(ref).toLowerCase()].join('|');
      seen[base] = (seen[base] || 0) + 1;
      key = dedupeKey(bank.id, date, amount, desc, ref, seen[base]);
      if (util.findOne(app, 'bank_lines', 'bank = {:b} && dedupe = {:k}', { b: bank.id, k: key }) !== null) {
        status = 'duplicate';
        counts.duplicate++;
      } else {
        counts.new++;
        if (amount > 0) sumIn += amount;
        else sumOut -= amount;
        if (minD === '' || date < minD) minD = date;
        if (maxD === '' || date > maxD) maxD = date;
      }
    }
    planned.push({ row: i + (hasHeader ? 2 : 1), date: date || '', amount: amount, description: desc, reference: ref, status: status, problem: problem, key: key });
  });
  const mapping = Object.assign({}, map, { delimiter: t.delimiter, has_header: hasHeader, date_format: fmt, decimal: decimal, flip: flip });
  return {
    bank: bank,
    currency: cur,
    mapping: mapping,
    columns: header.map((h, i) => ({ index: i, name: h, kind: kinds[i] ? kinds[i].kind : 'empty', sample: csv.columnValues(data, i).slice(0, 3) })),
    date_formats: formats,
    rows: planned,
    counts: counts,
    money_in: sumIn,
    money_out: sumOut,
    date_from: minD,
    date_to: maxD,
  };
}

function importOut(app, rec, plan) {
  return {
    import_id: rec.id,
    filename: rec.getString('filename'),
    status: rec.getString('status'),
    bank: bankOut(app, plan.bank, false),
    currency: plan.currency,
    mapping: plan.mapping,
    columns: plan.columns,
    date_formats: plan.date_formats,
    counts: plan.counts,
    money_in: plan.money_in,
    money_out: plan.money_out,
    date_from: plan.date_from,
    date_to: plan.date_to,
    rows: plan.rows.slice(0, 60).map((r) => ({ row: r.row, date: r.date, amount: r.amount, description: r.description, reference: r.reference, status: r.status, problem: r.problem })),
  };
}

function importPreview(ctx, p) {
  const util = u();
  needEdit(ctx);
  const app = ctx.app;
  let rec = null;
  const existing = util.str(p, 'import_id', '');
  if (existing !== '') {
    rec = core().resolve(app, 'imports', existing);
    if (rec.getString('status') !== 'previewed') throw util.fail(409, 'That import already ran.', 'invalid_state');
  } else {
    const b = core().resolve(app, 'banks', util.req(p, 'bank'));
    const f = util.fileParam(ctx, p, 'file', 'path');
    if (f === null) throw util.fail(400, 'Upload the statement CSV, or give --path "<absolute path>".', 'missing_param');
    rec = util.newRecord(app, 'imports');
    rec.set('kind', 'bank');
    rec.set('file', f);
    rec.set('filename', String(f.originalName || f.name || 'statement.csv').slice(0, 200));
    rec.set('status', 'previewed');
    rec.set('target', b.id);
    rec.set('actor', ctx.isAgent ? 'agent' : 'person');
    rec.set('member', ctx.memberId);
    app.save(rec);
  }
  const plan = planImport(app, rec, p);
  rec.set('mapping', plan.mapping);
  rec.set('rows', plan.counts.total);
  app.save(rec);
  return importOut(app, rec, plan);
}

function importRun(ctx, p) {
  const util = u();
  needEdit(ctx);
  const app = ctx.app;
  const rec = core().resolve(app, 'imports', util.req(p, 'import_id'));
  if (rec.getString('kind') !== 'bank') throw util.fail(400, 'Not a statement import.', 'invalid');
  if (rec.getString('status') !== 'previewed') throw util.fail(409, 'That import already ran.', 'invalid_state');
  const plan = planImport(app, rec, p);
  const added = [];
  app.runInTransaction((tx) => {
    for (const r of plan.rows) {
      if (r.status !== 'new') continue;
      const l = util.newRecord(tx, 'bank_lines');
      l.set('bank', plan.bank.id);
      l.set('date', r.date);
      l.set('amount', r.amount);
      l.set('description', r.description);
      l.set('reference', r.reference);
      l.set('import', rec.id);
      l.set('status', 'unmatched');
      l.set('dedupe', r.key);
      tx.save(l);
      added.push(l.id);
    }
    const x = tx.findRecordById('imports', rec.id);
    x.set('status', 'imported');
    x.set('mapping', plan.mapping);
    x.set('added', added.length);
    x.set('skipped', plan.counts.duplicate + plan.counts.invalid);
    x.set('result', { lines: added });
    tx.save(x);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'import', entity: 'banks', ref: plan.bank.id, label: rec.getString('filename'), summary: 'Imported ' + added.length + ' statement lines into ' + plan.bank.getString('name') + ' (' + (plan.counts.duplicate + plan.counts.invalid) + ' skipped)' });
  });
  if (added.length > 0) {
    try {
      require(`${__hooks}/_triggers_lib.js`).fire(app, 'bank_lines_waiting', { bank_id: plan.bank.id }, 'hook');
    } catch (err) {
      console.error('[erp] asking about new statement lines failed:', err);
    }
  }
  return { added: added.length, skipped: plan.counts.duplicate + plan.counts.invalid, duplicates: plan.counts.duplicate, invalid: plan.counts.invalid, bank: bankOut(app, plan.bank, true) };
}

function importUndo(ctx, p) {
  const util = u();
  needEdit(ctx);
  const app = ctx.app;
  const rec = core().resolve(app, 'imports', util.req(p, 'import_id'));
  if (rec.getString('kind') !== 'bank' || rec.getString('status') !== 'imported') throw util.fail(409, 'Only a statement import that ran can be undone.', 'invalid_state');
  let removed = 0;
  let kept = 0;
  app.runInTransaction((tx) => {
    for (const l of tx.findRecordsByFilter('bank_lines', 'import = {:i}', '', 0, 0, { i: rec.id })) {
      if (l.getString('status') === 'matched') {
        kept++;
        continue;
      }
      tx.delete(tx.findRecordById('bank_lines', l.id));
      removed++;
    }
    const x = tx.findRecordById('imports', rec.id);
    x.set('status', 'undone');
    tx.save(x);
  });
  return { removed: removed, kept_matched: kept };
}

function imports(ctx, p) {
  const util = u();
  needView(ctx);
  const app = ctx.app;
  const bankRef = util.str(p, 'bank', '');
  const filter = bankRef !== '' ? "kind = 'bank' && target = {:t}" : "kind = 'bank'";
  const recs = app.findRecordsByFilter('imports', filter, '-created', 50, 0, { t: bankRef !== '' ? core().resolve(app, 'banks', bankRef).id : '' });
  return {
    imports: recs.map((r) => ({ id: r.id, filename: r.getString('filename'), status: r.getString('status'), rows: r.getInt('rows'), added: r.getInt('added'), skipped: r.getInt('skipped'), created: r.getString('created'), bank: r.getString('target') })),
  };
}

/* ============================================================ reconcile */

/** Whole words of a line (letters and digits), upper-cased: exact reference matching. */
function words(text) {
  return String(text || '')
    .toUpperCase()
    .split(/[^A-Z0-9\-/]+/)
    .filter((w) => w.length >= 3);
}

function suggest(ctx, p) {
  const util = u();
  needView(ctx);
  const app = ctx.app;
  const l = core().resolve(app, 'bank_lines', util.req(p, 'line'));
  const bank = app.findRecordById('banks', l.getString('bank'));
  const cur = bankCur(app, bank);
  const base = core().currency(app);
  const a = l.getInt('amount');
  const abs = Math.abs(a);
  const d = l.getString('date');
  const lo = util.addDays(d, -14);
  const hi = util.addDays(d, 14);
  const toks = words(l.getString('description') + ' ' + l.getString('reference'));
  const out = [];
  // Posted payments on this bank of the same amount, not matched yet.
  const dir = a > 0 ? 'in' : 'out';
  for (const r of util.rows(app, "SELECT p.id AS id, p.number AS number, p.date AS date, p.amount AS amount, p.reference AS reference, IFNULL(pa.name, '') AS party FROM payments p LEFT JOIN parties pa ON pa.id = p.party WHERE p.bank = {:b} AND p.direction = {:d} AND p.state = 'posted' AND p.amount = {:a} AND p.date >= {:lo} AND p.date <= {:hi} AND NOT EXISTS (SELECT 1 FROM bank_lines bl WHERE bl.payment = p.id) LIMIT 20", { id: '', number: '', date: '', amount: 0, reference: '', party: '' }, { b: bank.id, d: dir, a: abs, lo: lo, hi: hi })) {
    let score = 80 - Math.abs(util.daysBetween(d, r.date));
    const exact = toks.indexOf(r.number.toUpperCase()) >= 0 || (r.reference !== '' && toks.indexOf(r.reference.toUpperCase()) >= 0);
    if (exact) score += 30;
    out.push({ kind: 'payment', id: r.id, label: r.number, party: r.party, date: r.date, amount: r.amount, score: score, why: 'Payment of the same amount ' + (r.date === d ? 'on the same day' : Math.abs(util.daysBetween(d, r.date)) + ' days apart') + (exact ? ', and its number is on the line' : '') });
  }
  // Other entries on the bank account (transfers, manual entries) of the same amount.
  const field = cur === base ? (a > 0 ? 'jl.debit' : 'jl.credit') : 'ABS(jl.amount_cur)';
  for (const r of util.rows(app, "SELECT j.id AS id, j.number AS number, j.date AS date, j.memo AS memo, j.kind AS kind FROM journal_lines jl JOIN journals j ON j.id = jl.journal WHERE jl.account = {:acc} AND " + field + " = {:a} AND j.kind NOT IN ('payment_in', 'payment_out') AND j.state = 'posted' AND j.date >= {:lo} AND j.date <= {:hi} AND NOT EXISTS (SELECT 1 FROM bank_lines bl WHERE bl.journal = j.id) LIMIT 20", { id: '', number: '', date: '', memo: '', kind: '' }, { acc: bank.getString('account'), a: abs, lo: lo, hi: hi })) {
    out.push({ kind: 'journal', id: r.id, label: r.number + (r.memo !== '' ? ': ' + r.memo : ''), party: '', date: r.date, amount: abs, score: 70 - Math.abs(util.daysBetween(d, r.date)), why: r.kind.replace(/_/g, ' ') + ' of the same amount' });
  }
  // Open invoices (money in) or bills (money out) for exactly this amount, or named on the line.
  const type = a > 0 ? 'invoice' : 'bill';
  const docs = util.rows(app, "SELECT d.id AS id, d.number AS number, d.date AS date, d.due_date AS due, d.balance AS balance, d.reference AS reference, d.party AS party_id, IFNULL(pa.name, '') AS party FROM documents d LEFT JOIN parties pa ON pa.id = d.party WHERE d.type = {:t} AND d.state = 'posted' AND d.balance > 0 AND d.currency = {:c} AND (d.balance = {:a} OR UPPER(d.number) IN (" + (toks.length > 0 ? toks.map((_, i) => '{:w' + i + '}').join(', ') : "''") + ')) LIMIT 30', { id: '', number: '', date: '', due: '', balance: 0, reference: '', party_id: '', party: '' }, Object.assign({ t: type, c: cur, a: abs }, toks.reduce((m, w, i) => {
    m['w' + i] = w;
    return m;
  }, {})));
  for (const r of docs) {
    const named = toks.indexOf(r.number.toUpperCase()) >= 0 || (r.reference !== '' && toks.indexOf(r.reference.toUpperCase()) >= 0);
    const same = r.balance === abs;
    let score = (same ? 50 : 20) + (named ? 40 : 0);
    out.push({ kind: type, id: r.id, label: r.number, party: r.party, party_id: r.party_id, date: r.date, amount: r.balance, score: score, why: (same ? 'Open ' + type + ' for exactly this amount' : 'Open ' + type) + (named ? ', named on the line' : '') });
  }
  out.sort((x, y) => y.score - x.score);
  return { line: lineOut(app, l, {}), suggestions: out.slice(0, 12) };
}

function setMatch(tx, ctx, lineId, payment, journal) {
  const util = u();
  const l = tx.findRecordById('bank_lines', lineId);
  l.set('status', 'matched');
  l.set('payment', payment || '');
  l.set('journal', journal || '');
  l.set('matched_by', ctx.memberId || '');
  l.set('matched_actor', ctx.isAgent ? 'agent' : 'person');
  l.set('matched_at', util.nowIso());
  l.set('suggestion', null);
  tx.save(l);
  return l;
}

function match(ctx, p) {
  const util = u();
  needEdit(ctx);
  const app = ctx.app;
  const l = core().resolve(app, 'bank_lines', util.req(p, 'line'));
  if (l.getString('status') === 'matched') throw util.fail(409, 'This line is already matched. Unmatch it first.', 'matched');
  const bank = app.findRecordById('banks', l.getString('bank'));
  const a = l.getInt('amount');
  const payRef = util.str(p, 'payment', '');
  const jRef = util.str(p, 'journal', '');
  if ((payRef === '') === (jRef === '')) throw util.fail(400, 'Give payment or journal (one of them).', 'missing_param');
  let payId = '';
  let jId = '';
  if (payRef !== '') {
    const pay = core().resolvePayment(app, payRef);
    if (pay.getString('state') !== 'posted') throw util.fail(409, 'Only a posted payment can be matched.', 'invalid_state');
    if (pay.getString('bank') !== bank.id) throw util.fail(409, 'That payment went through another account.', 'other_bank');
    const signed = pay.getString('direction') === 'in' ? pay.getInt('amount') : -pay.getInt('amount');
    if (signed !== a) throw util.fail(409, 'The amounts differ: the line is ' + money().fmt(a, bankCur(app, bank)) + ', the payment ' + money().fmt(signed, bankCur(app, bank)) + '.', 'amount_mismatch');
    if (util.findOne(app, 'bank_lines', 'payment = {:p}', { p: pay.id }) !== null) throw util.fail(409, 'That payment is already matched to another line.', 'matched');
    payId = pay.id;
  } else {
    const j = core().resolve(app, 'journals', jRef);
    const cur = bankCur(app, bank);
    const base = core().currency(app);
    const sums = util.one(app, 'SELECT IFNULL(SUM(debit), 0) - IFNULL(SUM(credit), 0) AS net, IFNULL(SUM(amount_cur), 0) AS cur FROM journal_lines WHERE journal = {:j} AND account = {:a}', { net: 0, cur: 0 }, { j: j.id, a: bank.getString('account') });
    const net = cur === base ? (isLiability(app, bank) ? sums.net : sums.net) : sums.cur;
    if (net !== a && !(cur === base && net === a)) throw util.fail(409, 'The amounts differ: the line is ' + money().fmt(a, cur) + ' and the entry moves ' + money().fmt(net, cur) + ' on this account.', 'amount_mismatch');
    if (util.findOne(app, 'bank_lines', 'journal = {:j}', { j: j.id }) !== null) throw util.fail(409, 'That entry is already matched to another line.', 'matched');
    jId = j.id;
  }
  app.runInTransaction((tx) => {
    setMatch(tx, ctx, l.id, payId, jId);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'match', entity: 'banks', ref: bank.id, label: l.getString('description').slice(0, 80), summary: 'Matched a statement line of ' + money().fmt(a, bankCur(app, bank)) });
  });
  return lineOut(app, app.findRecordById('bank_lines', l.id), {});
}

function unmatch(ctx, p) {
  const util = u();
  needEdit(ctx);
  const l = core().resolve(ctx.app, 'bank_lines', util.req(p, 'line'));
  if (l.getString('status') !== 'matched') throw util.fail(409, 'This line is not matched.', 'invalid_state');
  l.set('status', 'unmatched');
  l.set('payment', '');
  l.set('journal', '');
  l.set('matched_by', '');
  l.set('matched_actor', '');
  l.set('matched_at', '');
  ctx.app.save(l);
  return lineOut(ctx.app, l, {});
}

function ignore(ctx, p) {
  const util = u();
  needEdit(ctx);
  const l = core().resolve(ctx.app, 'bank_lines', util.req(p, 'line'));
  if (l.getString('status') === 'matched') throw util.fail(409, 'Unmatch the line first.', 'matched');
  l.set('status', util.bool(p, 'ignore', true) ? 'ignored' : 'unmatched');
  ctx.app.save(l);
  return lineOut(ctx.app, l, {});
}

/* -------------------------------------------- create from a statement line */

function paymentParams(app, l, p) {
  const util = u();
  const bank = app.findRecordById('banks', l.getString('bank'));
  const a = l.getInt('amount');
  const out = {
    direction: a > 0 ? 'in' : 'out',
    party: util.req(p, 'party'),
    bank: bank.id,
    date: l.getString('date'),
    amount: money().minorText(Math.abs(a), bankCur(app, bank)),
    reference: (l.getString('reference') || l.getString('description')).slice(0, 120),
    memo: util.text(p, 'memo', 500, ''),
  };
  if (util.has(p, 'allocations')) out.allocations = p.allocations;
  return out;
}

function createPayment(ctx, p) {
  const util = u();
  const app = ctx.app;
  const l = core().resolve(app, 'bank_lines', util.req(p, 'line'));
  if (l.getString('status') !== 'unmatched') throw util.fail(409, 'This line is already ' + l.getString('status') + '.', 'invalid_state');
  const pay = require(`${__hooks}/lib_payments.js`).record(ctx, paymentParams(app, l, p));
  app.runInTransaction((tx) => {
    setMatch(tx, ctx, l.id, pay.id, '');
  });
  return { payment: pay, line: lineOut(app, app.findRecordById('bank_lines', l.id), {}) };
}

function previewCreatePayment(ctx, p) {
  const util = u();
  const l = core().resolve(ctx.app, 'bank_lines', util.req(p, 'line'));
  const out = require(`${__hooks}/lib_payments.js`).previewRecord(ctx, paymentParams(ctx.app, l, p));
  out.target = { entity: 'banks', id: l.getString('bank'), label: l.getString('description').slice(0, 80) };
  return out;
}

/** The journal lines of a statement line booked against an account. */
function entryLines(app, l, p) {
  const util = u();
  const c = core();
  const m = money();
  const bank = app.findRecordById('banks', l.getString('bank'));
  const cur = bankCur(app, bank);
  const base = c.currency(app);
  const acc = c.resolve(app, 'accounts', util.req(p, 'account'));
  if (acc.getBool('control')) throw util.fail(409, acc.getString('name') + ' is a control account: record a payment from or to the customer or supplier instead.', 'control_account');
  if (acc.id === bank.getString('account')) throw util.fail(400, 'Choose the other side of the entry, not the bank account itself.', 'invalid_param');
  const a = l.getInt('amount');
  let fx = m.E8;
  if (cur !== base) {
    const rate = util.findOne(app, 'currencies', 'code = {:c}', { c: cur });
    if (rate === null || rate.getInt('rate_e8') <= 0) throw util.fail(400, 'There is no exchange rate for ' + cur + '.', 'fx_missing');
    fx = rate.getInt('rate_e8');
  }
  const total = m.convert(Math.abs(a), cur, base, fx);
  let taxAmt = 0;
  let taxAcc = '';
  const taxRef = util.str(p, 'tax', '');
  if (taxRef !== '' && taxRef.toLowerCase() !== 'none') {
    const t = c.resolve(app, 'taxes', taxRef);
    const rate = t.getInt('rate_bp');
    if (a > 0) {
      if (t.getString('scope') === 'purchase') throw util.fail(400, t.getString('name') + ' is a purchase tax; money in takes a sales tax.', 'invalid_tax');
      taxAmt = m.mulDiv(total, rate, 10000 + rate);
      taxAcc = t.getString('sales_account');
    } else {
      if (t.getString('scope') === 'sales') throw util.fail(400, t.getString('name') + ' is a sales tax; money out takes a purchase tax.', 'invalid_tax');
      if (t.getBool('recoverable')) {
        taxAmt = m.mulDiv(total, rate, 10000 + rate);
        taxAcc = t.getString('purchase_account');
      }
    }
    if (taxAmt > 0 && taxAcc === '') throw util.fail(409, 'The tax ' + t.getString('name') + ' has no account. Set it under Settings, Taxes.', 'tax_account_missing');
  }
  const net = total - taxAmt;
  const memo = util.text(p, 'memo', 300, '') || l.getString('description').slice(0, 300);
  const project = c.resolveOpt(app, 'projects', util.str(p, 'project', ''));
  const dept = c.resolveOpt(app, 'departments', util.str(p, 'department', ''));
  const dims = { project: project ? project.id : '', department: dept ? dept.id : '' };
  const lines = [];
  if (a > 0) {
    lines.push({ account: bank.getString('account'), debit: total, credit: 0, memo: memo, currency: cur, amount_cur: a });
    lines.push(Object.assign({ account: acc.id, debit: 0, credit: net, memo: memo }, dims));
    if (taxAmt > 0) lines.push({ account: taxAcc, debit: 0, credit: taxAmt, memo: memo });
  } else {
    lines.push(Object.assign({ account: acc.id, debit: net, credit: 0, memo: memo }, dims));
    if (taxAmt > 0) lines.push({ account: taxAcc, debit: taxAmt, credit: 0, memo: memo });
    lines.push({ account: bank.getString('account'), debit: 0, credit: total, memo: memo, currency: cur, amount_cur: a });
  }
  return { lines: lines, total: total, bank: bank, account: acc, memo: memo };
}

function createEntry(ctx, p) {
  const util = u();
  const app = ctx.app;
  const l = core().resolve(app, 'bank_lines', util.req(p, 'line'));
  if (l.getString('status') !== 'unmatched') throw util.fail(409, 'This line is already ' + l.getString('status') + '.', 'invalid_state');
  const e = entryLines(app, l, p);
  let jid = '';
  app.runInTransaction((tx) => {
    const j = ledger().post(tx, ctx, { kind: 'bank_entry', date: l.getString('date'), memo: e.memo, source: { entity: 'banks', id: e.bank.id, label: e.bank.getString('name') }, lines: e.lines });
    jid = j.id;
    setMatch(tx, ctx, l.id, '', j.id);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'post', entity: 'banks', ref: e.bank.id, label: j.getString('number'), summary: 'Booked a statement line to ' + e.account.getString('code') + ' ' + e.account.getString('name') + (ctx.approving ? ' (proposed by your AI agent)' : '') });
  });
  return { journal: ledger().journalOut(app, app.findRecordById('journals', jid), true), line: lineOut(app, app.findRecordById('bank_lines', l.id), {}) };
}

function previewCreateEntry(ctx, p) {
  const util = u();
  const l = core().resolve(ctx.app, 'bank_lines', util.req(p, 'line'));
  const e = entryLines(ctx.app, l, p);
  return {
    kind: 'journal',
    auto: 'journal',
    amount: e.total,
    title: 'Book ' + money().fmt(l.getInt('amount'), bankCur(ctx.app, e.bank)) + ' to ' + e.account.getString('code') + ' ' + e.account.getString('name'),
    summary: 'Statement line of ' + l.getString('date') + ': ' + l.getString('description').slice(0, 200),
    lines: ledger().describeLines(ctx.app, e.lines),
    currency: core().currency(ctx.app),
    target: { entity: 'banks', id: e.bank.id, label: e.bank.getString('name') },
  };
}

function transferLines(app, p) {
  const util = u();
  const c = core();
  const m = money();
  const from = c.resolve(app, 'banks', util.req(p, 'from_bank'));
  const to = c.resolve(app, 'banks', util.req(p, 'to_bank'));
  if (from.id === to.id) throw util.fail(400, 'Choose two different accounts.', 'invalid_param');
  const base = c.currency(app);
  const fc = bankCur(app, from);
  const tc = bankCur(app, to);
  const amount = util.money(p, 'amount', fc, { required: true, positive: true });
  let toAmount = amount;
  if (fc !== tc) {
    toAmount = util.money(p, 'to_amount', tc, { positive: true });
    if (toAmount === null) throw util.fail(400, 'The accounts are in ' + fc + ' and ' + tc + ': give to_amount, what arrived.', 'missing_param');
  }
  let fx = m.E8;
  if (fc !== base) {
    const r = util.findOne(app, 'currencies', 'code = {:c}', { c: fc });
    if (r === null || r.getInt('rate_e8') <= 0) throw util.fail(400, 'There is no exchange rate for ' + fc + '.', 'fx_missing');
    fx = r.getInt('rate_e8');
  }
  const value = m.convert(amount, fc, base, fx);
  const memo = util.text(p, 'memo', 300, '') || 'Transfer from ' + from.getString('name') + ' to ' + to.getString('name');
  return {
    from: from,
    to: to,
    amount: amount,
    toAmount: toAmount,
    value: value,
    memo: memo,
    lines: [
      { account: to.getString('account'), debit: value, credit: 0, memo: memo, currency: tc, amount_cur: toAmount },
      { account: from.getString('account'), debit: 0, credit: value, memo: memo, currency: fc, amount_cur: -amount },
    ],
  };
}

function transfer(ctx, p) {
  const util = u();
  const app = ctx.app;
  const t = transferLines(app, p);
  const date = util.day(p, 'date', util.today());
  let line = null;
  const lineRef = util.str(p, 'line', '');
  if (lineRef !== '') {
    line = core().resolve(app, 'bank_lines', lineRef);
    if (line.getString('status') !== 'unmatched') throw util.fail(409, 'That statement line is already ' + line.getString('status') + '.', 'invalid_state');
    const ok = (line.getString('bank') === t.from.id && line.getInt('amount') === -t.amount) || (line.getString('bank') === t.to.id && line.getInt('amount') === t.toAmount);
    if (!ok) throw util.fail(409, 'The statement line does not show this transfer (account or amount differ).', 'amount_mismatch');
  }
  let jid = '';
  app.runInTransaction((tx) => {
    const j = ledger().post(tx, ctx, { kind: 'transfer', date: line !== null ? line.getString('date') : date, memo: t.memo, source: { entity: 'banks', id: t.from.id, label: t.from.getString('name') }, lines: t.lines });
    jid = j.id;
    if (line !== null) setMatch(tx, ctx, line.id, '', j.id);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'post', entity: 'banks', ref: t.from.id, label: j.getString('number'), summary: t.memo + ': ' + money().fmt(t.amount, bankCur(tx, t.from)) });
  });
  return ledger().journalOut(app, app.findRecordById('journals', jid), true);
}

function previewTransfer(ctx, p) {
  const t = transferLines(ctx.app, p);
  return {
    kind: 'journal',
    auto: '',
    amount: t.value,
    title: 'Transfer ' + money().fmt(t.amount, bankCur(ctx.app, t.from)) + ' from ' + t.from.getString('name') + ' to ' + t.to.getString('name'),
    summary: t.memo,
    lines: ledger().describeLines(ctx.app, t.lines),
    currency: core().currency(ctx.app),
    target: { entity: 'banks', id: t.from.id, label: t.from.getString('name') },
  };
}

/** Statement against the books at a date. */
function summary(ctx, p) {
  const util = u();
  needView(ctx);
  const app = ctx.app;
  const b = core().resolve(app, 'banks', util.req(p, 'bank'));
  const date = util.day(p, 'date', util.today());
  const book = balanceOf(app, b, date);
  const unmatched = util.one(app, "SELECT COUNT(id) AS n, IFNULL(SUM(amount), 0) AS s FROM bank_lines WHERE bank = {:b} AND status = 'unmatched' AND date <= {:d}", { n: 0, s: 0 }, { b: b.id, d: date });
  const cur = bankCur(app, b);
  const base = core().currency(app);
  const amountExpr = cur === base ? 'jl.debit - jl.credit' : 'jl.amount_cur';
  const notOnStatement = util.one(
    app,
    'SELECT COUNT(DISTINCT j.id) AS n, IFNULL(SUM(' + amountExpr + '), 0) AS s FROM journal_lines jl JOIN journals j ON j.id = jl.journal WHERE jl.account = {:a} AND jl.date <= {:d} AND NOT EXISTS (SELECT 1 FROM bank_lines bl WHERE bl.journal = j.id) AND NOT EXISTS (SELECT 1 FROM bank_lines bl JOIN payments p ON p.id = bl.payment WHERE p.journal = j.id)',
    { n: 0, s: 0 },
    { a: b.getString('account'), d: date },
  );
  const statementNet = util.one(app, "SELECT IFNULL(SUM(amount), 0) AS s FROM bank_lines WHERE bank = {:b} AND status != 'ignored' AND date <= {:d}", { s: 0 }, { b: b.id, d: date }).s;
  return {
    bank: bankOut(app, b, false),
    date: date,
    book_balance: book,
    statement_net: statementNet,
    unmatched_lines: unmatched.n,
    unmatched_amount: unmatched.s,
    book_entries_not_on_statement: notOnStatement.n,
    book_amount_not_on_statement: notOnStatement.s,
    currency: cur,
  };
}

module.exports = {
  balanceOf: balanceOf,
  bankOut: bankOut,
  list: list,
  get: get,
  add: add,
  update: update,
  lines: lines,
  addLine: addLine,
  deleteLine: deleteLine,
  importPreview: importPreview,
  importRun: importRun,
  importUndo: importUndo,
  imports: imports,
  suggest: suggest,
  match: match,
  unmatch: unmatch,
  ignore: ignore,
  createPayment: createPayment,
  previewCreatePayment: previewCreatePayment,
  createEntry: createEntry,
  previewCreateEntry: previewCreateEntry,
  transfer: transfer,
  previewTransfer: previewTransfer,
  summary: summary,
};
