/// <reference path="../pb_data/types.d.ts" />
/**
 * Payroll out: how a locked pay run leaves the company. Bank payment files
 * (lib_bankfiles writes the bytes), split pay across a person's accounts,
 * cash and cheque lists, confirming the bank upload (the run becomes paid
 * through payroll-core's lib_payroll_runs.markPaid), and the entity's
 * pay-out settings. Shared helpers for the other lib_payroll_out_* files
 * live here too.
 *
 * Sealed bank numbers are unsealed only inside `payments()` and passed
 * straight to the writer; they are never returned, stored outside the file
 * itself, or logged. Stored items and problems carry masked numbers.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/* ----------------------------------------------------------- helpers */

/** Your AI agent reads pay figures only when the company allows it. */
function gatePay(ctx) {
  if (!ctx.isAgent) return;
  if (!L('lib_settings').row(ctx.app).getBool('agent_sees_pay')) throw L('lib_util').fail(403, 'The company has turned off pay figures for your AI agent.', 'pay_hidden');
}

function entityRec(ctx, ref) {
  const u = L('lib_util');
  const rec = u.byIdOrName(ctx.app, 'entities', ref, 'name', 'entities.list');
  if (!L('lib_auth').inScope(ctx, rec.id)) throw u.fail(403, 'That entity is outside your access.', 'not_permitted');
  return rec;
}

/** Entity ids the caller may see, optionally narrowed to one. */
function entityIds(ctx, ref) {
  const u = L('lib_util');
  if (ref !== undefined && ref !== null && String(ref).trim() !== '') return [entityRec(ctx, ref).id];
  const scope = L('lib_auth').scope(ctx);
  const all = u.rows(ctx.app, 'SELECT id FROM entities WHERE active = TRUE ORDER BY name', { id: '' });
  return all.map((r) => r.id).filter((id) => scope.length === 0 || scope.indexOf(id) >= 0);
}

function runRec(ctx, ref) {
  const u = L('lib_util');
  const r = String(ref || '').trim();
  if (r === '') throw u.fail(400, 'Give the pay run (id or number, e.g. PR-0001).', 'missing_param');
  let rec = u.byId(ctx.app, 'payruns', r);
  if (rec === null) rec = u.findOne(ctx.app, 'payruns', 'number = {:n}', { n: r.toUpperCase() });
  if (rec === null) throw u.fail(404, 'No pay run "' + r + '".', 'not_found');
  if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw u.fail(403, 'That pay run is outside your access.', 'not_permitted');
  return rec;
}

function runView(app, run) {
  const ent = app.findRecordById('entities', run.getString('entity'));
  return {
    id: run.id, number: run.getString('number'), label: run.getString('label'), kind: run.getString('kind'), status: run.getString('status'),
    entity: ent.id, entity_name: ent.getString('name'), country: ent.getString('country'), currency: run.getString('currency') || ent.getString('currency'),
    period_start: run.getString('period_start'), period_end: run.getString('period_end'), pay_date: run.getString('pay_date'),
    employee_count: run.getInt('employee_count'), gross_minor: run.getInt('gross_minor'), deductions_minor: run.getInt('deductions_minor'),
    employer_minor: run.getInt('employer_minor'), net_minor: run.getInt('net_minor'), locked_at: run.getString('locked_at'), paid_at: run.getString('paid_at'),
    year_end: run.getBool('year_end'),
  };
}

function memberName(app, id) {
  if (!id) return '';
  try {
    const m = app.findRecordById('members', id);
    return m.getString('name') || m.getString('email');
  } catch {
    return '';
  }
}

/** 'YYYY-MM-DD HH:MM:SS' in the entity's time zone (bank file creation stamps). */
function localStamp(app, entityId) {
  const n = L('lib_util').localNow(app, entityId);
  return n.day + ' ' + n.time + ':00';
}

/** A file value for a record from bytes (a JS array of 0..255). */
function fileFrom(bytes, name) {
  return $filesystem.fileFromBytes(bytes, name);
}

function settingsRec(app, entityId) {
  return L('lib_util').findOne(app, 'payout_settings', 'entity = {:e}', { e: entityId });
}

function jsonField(rec, field, dflt) {
  if (rec === null) return dflt;
  const v = L('lib_util').jsonOf(rec, field, dflt);
  return v === null || v === undefined ? dflt : v;
}

/** The entity's country data (or null). */
function countryOf(entity) {
  try {
    return L('lib_countries').get(entity.getString('country'));
  } catch {
    return null;
  }
}

function defaultFormat(entity) {
  const c = countryOf(entity);
  const list = (c && c.bank_formats) || [];
  return list.length > 0 ? list[0] : 'generic_csv';
}

/** The pay-out settings of an entity as plain data (with defaults). */
function settingsOf(app, entity) {
  const rec = settingsRec(app, entity.id);
  const fmt = rec !== null && rec.getString('bank_format') !== '' ? rec.getString('bank_format') : defaultFormat(entity);
  return {
    entity: entity.id,
    bank_format: fmt,
    payer: jsonField(rec, 'payer', {}),
    bank_options: jsonField(rec, 'bank_options', {}),
    gl: jsonField(rec, 'gl', {}),
    journal_format: rec !== null && rec.getString('journal_format') !== '' ? rec.getString('journal_format') : 'generic_csv',
    filing_prefs: jsonField(rec, 'filing_prefs', {}),
    updated: rec !== null ? rec.getString('updated') : '',
  };
}

/** The employer's details for one bank format: the entity's kernel bank json, then the format's own block. */
function payerFor(app, entity, format) {
  const s = settingsOf(app, entity);
  const base = L('lib_util').jsonOf(entity, 'bank', {}) || {};
  const own = (s.payer && s.payer[format]) || {};
  const out = {};
  for (const k of Object.keys(base)) if (typeof base[k] !== 'object') out[k] = base[k];
  for (const k of Object.keys(own)) out[k] = own[k];
  if (out.name === undefined || out.name === '') out.name = entity.getString('legal_name') || entity.getString('name');
  return out;
}

/**
 * How a run's net pay reaches people: net pay of the run, less held pay
 * (never in a bank file), plus holds released into this run, equals what
 * goes to the bank plus cash plus cheques. Same figures as payroll-core's
 * lock dialog shows, so the screens reconcile.
 */
function reconcile(app, run, items) {
  const u = L('lib_util');
  const held = u.one(app, "SELECT COUNT(*) AS n, CAST(COALESCE(SUM(net_minor),0) AS INTEGER) AS t FROM payslips WHERE payrun = {:r} AND held = TRUE AND status != 'void'", { n: 0, t: 0 }, { r: run.id });
  const out = { net_minor: run.getInt('net_minor'), held_minor: held.t, held_count: held.n, released_minor: 0, released_count: 0, bank_minor: 0, bank_people: 0, cash_minor: 0, cash_count: 0, cheque_minor: 0, cheque_count: 0, zero_count: 0 };
  for (const it of items || L('lib_payroll_runs').payoutItems(app, run.id)) {
    if (it.kind === 'hold_release') {
      out.released_minor += it.amount_minor;
      out.released_count += 1;
    }
    if (it.pay_method === 'bank') {
      out.bank_minor += it.amount_minor;
      out.bank_people += 1;
    } else if (it.pay_method === 'cash') {
      out.cash_minor += it.amount_minor;
      out.cash_count += 1;
    } else if (it.pay_method === 'cheque') {
      out.cheque_minor += it.amount_minor;
      out.cheque_count += 1;
    }
  }
  out.to_pay_minor = out.net_minor - out.held_minor + out.released_minor;
  out.balanced = out.to_pay_minor === out.bank_minor + out.cash_minor + out.cheque_minor;
  return out;
}

/* --------------------------------------------------------- payments */

function kanaOf(employee) {
  const k = L('lib_util').jsonOf(employee, 'kana', {}) || {};
  return [k.family || '', k.given || ''].filter((x) => String(x).trim() !== '').join(' ');
}

function idFor(app, employeeId, types) {
  for (const t of types) {
    const r = L('lib_util').findOne(app, 'identity_docs', 'employee = {:e} && type = {:t}', { e: employeeId, t: t });
    if (r !== null) return { type: t, sealed: r.getString('number_sealed') };
  }
  return null;
}

const ID_TYPE_FOR_BANK = { mykad: 'nric', mypr: 'other', passport: 'passport' };

/**
 * Bank payments of a run as the writer takes them, one per account part.
 * `plain: true` unseals account numbers (only for the writer); otherwise
 * the numbers stay masked (for screens). Returns { payments, people, problems }.
 */
function payments(app, run, format, plain) {
  const seal = L('lib_seal');
  const B = L('lib_bankfiles');
  const u = L('lib_util');
  const items = L('lib_payroll_runs').payoutItems(app, run.id);
  const out = [];
  const people = [];
  const problems = [];
  const reference = referenceFor(run);
  for (const it of items) {
    if (it.pay_method !== 'bank') continue;
    const emp = app.findRecordById('employees', it.employee);
    const accounts = app.findRecordsByFilter('bank_accounts', 'employee = {:e} && status = "active"', 'created', 0, 0, { e: it.employee });
    const person = { payslip: it.payslip, employment: it.employment, employee: it.employee, employee_number: it.employee_number, name: it.name, amount_minor: it.amount_minor, currency: it.currency, kind: it.kind, parts: [], problems: [], warnings: [] };
    if (accounts.length === 0) {
      const pr = { ref: it.employee_number, employee: it.employee, name: it.name, field: 'bank_account', code: 'no_bank_account', message: 'No approved bank account: add one on the profile or pay this person by cash or cheque' };
      person.problems.push(pr);
      problems.push(pr);
      people.push(person);
      continue;
    }
    const byId = {};
    for (const a of accounts) byId[a.id] = a;
    let parts = [];
    const stored = Array.isArray(it.bank_split) ? it.bank_split.filter((x) => x && byId[x.bank_account] && Number(x.amount_minor) > 0) : [];
    const storedSum = stored.reduce((s, x) => s + Number(x.amount_minor), 0);
    if (stored.length > 0 && storedSum === it.amount_minor) parts = stored.map((x) => ({ account: byId[x.bank_account], amount_minor: Number(x.amount_minor) }));
    else {
      const sp = B.splitNet(it.amount_minor, accounts.map((a) => ({ rec: a, split: u.jsonOf(a, 'split', {}) || {} })));
      parts = sp.parts.map((x) => ({ account: x.account.rec, amount_minor: x.amount_minor }));
      for (const w of sp.warnings) person.warnings.push({ code: 'split_' + w, message: 'Split: ' + w.replace(/_/g, ' ') });
    }
    let idDoc = null;
    if (format === 'my_maybank_csv' || format === 'my_cimb_txt') idDoc = idFor(app, it.employee, ['mykad', 'mypr', 'passport']);
    for (const pt of parts) {
      const a = pt.account;
      const holder = a.getString('holder');
      const pay = {
        ref: it.employee_number, employee: it.employee, name: holder !== '' ? holder : it.name,
        kana: format === 'zengin' ? (holder !== '' && B.zenginKana(holder).bad.length === 0 ? holder : kanaOf(emp)) : '',
        bank_name: a.getString('bank_name'), bank_code: a.getString('bank_code'), branch_code: a.getString('branch_code'),
        account_type: accountType(a.getString('account_type')), bic: a.getString('swift'), email: emp.getString('work_email'),
        amount_minor: pt.amount_minor, reference: reference,
        account: plain ? seal.unseal(app, a.getString('number_sealed')) : '',
        iban: plain ? seal.unseal(app, a.getString('iban_sealed')) : '',
        id_type: idDoc ? ID_TYPE_FOR_BANK[idDoc.type] || 'other' : '',
        id_number: idDoc && plain ? seal.unseal(app, idDoc.sealed) : '',
      };
      out.push(pay);
      person.parts.push({ bank_account: a.id, label: a.getString('label'), bank_name: a.getString('bank_name'), bank_code: a.getString('bank_code'), branch_code: a.getString('branch_code'), number_masked: a.getString('number_masked') || a.getString('iban_masked'), amount_minor: pt.amount_minor });
    }
    people.push(person);
  }
  return { payments: out, people: people, problems: problems, items: items };
}

/** Account type words people type, to the writer's words. */
function accountType(v) {
  const t = String(v || '').trim().toLowerCase();
  if (t === '' || t === 'checking' || t === 'chequing' || t === 'cheque') return t === '' ? '' : 'checking';
  if (t === 'savings' || t === 'saving') return 'savings';
  if (t === 'futsu' || t === 'ordinary' || t === '普通' || t === 'normal') return 'ordinary';
  if (t === 'toza' || t === 'touza' || t === 'current' || t === '当座') return 'current';
  if (t === 'chochiku' || t === '貯蓄' || t === 'deposit') return 'deposit';
  return t;
}

function referenceFor(run) {
  const label = run.getString('label');
  if (label !== '') return label.slice(0, 18);
  const kind = run.getString('kind') === 'bonus' ? 'BONUS ' : 'PAY ';
  return kind + run.getString('period_end').slice(0, 7);
}

/** Write the file for a run (problems come back instead of bytes). */
function writeFile(app, run, entity, format) {
  const B = L('lib_bankfiles');
  const pay = payments(app, run, format, true);
  if (pay.problems.length > 0) return { ok: false, problems: pay.problems, warnings: [], people: pay.people };
  const s = settingsOf(app, entity);
  const res = B.write(format, {
    payer: payerFor(app, entity, format), pay_date: run.getString('pay_date'), created: localStamp(app, entity.id), reference: referenceFor(run),
    currency: run.getString('currency') || entity.getString('currency'), kind: run.getString('kind') === 'bonus' ? 'bonus' : 'salary',
    payments: pay.payments, options: (s.bank_options && s.bank_options[format]) || {}, file_stem: run.getString('number'),
  });
  // drop the plain numbers as soon as the bytes exist
  for (const p of pay.payments) {
    p.account = '';
    p.iban = '';
    p.id_number = '';
  }
  res.people = pay.people;
  return res;
}

/* -------------------------------------------------------------- views */

function bankFileView(app, r) {
  return {
    id: r.id, payrun: r.getString('payrun'), entity: r.getString('entity'), format: r.getString('format'), filename: r.getString('filename'),
    total_minor: r.getInt('total_minor'), currency: r.getString('currency'), count: r.getInt('count'), hash: r.getString('hash'), status: r.getString('status'),
    reference: r.getString('reference'), paid_on: r.getString('paid_on'), exported_by: memberName(app, r.getString('exported_by')), exported_at: r.getString('exported_at'),
    uploaded_by: memberName(app, r.getString('uploaded_by')), uploaded_at: r.getString('uploaded_at'), warnings: jsonField(r, 'warnings', []), control: jsonField(r, 'control', {}),
    items: jsonField(r, 'items', []), void_reason: r.getString('void_reason'), downloads: r.getInt('downloads'),
  };
}

function listView(r) {
  return { id: r.id, payrun: r.getString('payrun'), method: r.getString('method'), items: jsonField(r, 'items', []), total_minor: r.getInt('total_minor'), currency: r.getString('currency'), count: r.getInt('count'), status: r.getString('status'), done_at: r.getString('done_at') };
}

/* ---------------------------------------------------------------- ops */

/** Locked and recently paid runs waiting for (or done with) pay-out, newest first. */
function overview(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'view');
  gatePay(ctx);
  const ids = entityIds(ctx, p.entity);
  if (ids.length === 0) return { runs: [], total: 0 };
  const pg = u.page(p, 50, 200);
  const status = u.oneOf(p, 'status', ['open', 'paid', 'all'], 'all');
  const st = status === 'open' ? "('locked')" : status === 'paid' ? "('paid')" : "('locked','paid')";
  const marks = ids.map((_, i) => '{:e' + i + '}').join(',');
  const bind = {};
  ids.forEach((id, i) => (bind['e' + i] = id));
  const rows = u.rows(ctx.app, 'SELECT id FROM payruns WHERE entity IN (' + marks + ') AND status IN ' + st + ' ORDER BY (status = \'locked\') DESC, pay_date DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const total = u.count(ctx.app, 'SELECT COUNT(*) AS n FROM payruns WHERE entity IN (' + marks + ') AND status IN ' + st, bind);
  const runs = rows.map((r) => {
    const run = ctx.app.findRecordById('payruns', r.id);
    const v = runView(ctx.app, run);
    const methods = u.rows(ctx.app, "SELECT pay_method AS m, COUNT(*) AS n, CAST(COALESCE(SUM(net_minor),0) AS INTEGER) AS t FROM payslips WHERE payrun = {:r} AND status != 'void' AND held = FALSE GROUP BY pay_method", { m: '', n: 0, t: 0 }, { r: run.id });
    v.methods = {};
    for (const m of methods) v.methods[m.m] = { count: m.n, total_minor: m.t };
    v.totals = reconcile(ctx.app, run);
    const bf = u.findMany(ctx.app, 'bank_files', 'payrun = {:r} && status != "void" && status != "superseded"', '-created', 1, { r: run.id });
    v.bank_file = bf.length > 0 ? { id: bf[0].id, status: bf[0].getString('status'), format: bf[0].getString('format'), exported_at: bf[0].getString('exported_at'), reference: bf[0].getString('reference') } : null;
    v.journal = u.count(ctx.app, 'SELECT COUNT(*) AS n FROM journal_exports WHERE payrun = {:r}', { r: run.id }) > 0;
    v.next = v.status === 'paid' ? (v.journal ? 'done' : 'journal') : (v.methods.bank && !v.bank_file ? 'export' : v.bank_file && v.bank_file.status === 'exported' ? 'confirm' : 'mark_paid');
    return v;
  });
  return { runs: runs, total: total };
}

/** One run's pay-out: who is paid how, the split across accounts, problems to fix before a bank file, files, lists and journals. */
function runPayout(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'view');
  gatePay(ctx);
  const run = runRec(ctx, p.payrun);
  const entity = ctx.app.findRecordById('entities', run.getString('entity'));
  const s = settingsOf(ctx.app, entity);
  const format = u.str(p, 'format', s.bank_format);
  const B = L('lib_bankfiles');
  if (!B.info(format)) throw u.fail(400, 'Unknown bank file format ' + format + '.', 'invalid_param');
  const view = runView(ctx.app, run);
  const masked = payments(ctx.app, run, format, false);
  const cash = [];
  const cheque = [];
  for (const it of masked.items) {
    if (it.pay_method === 'cash') cash.push(it);
    else if (it.pay_method === 'cheque') cheque.push(it);
  }
  // A dry run of the writer finds problems now (plain numbers stay inside writeFile).
  let check = { ok: true, problems: [], warnings: [] };
  const bankCount = masked.people.length;
  if (bankCount > 0 && view.status === 'locked') {
    const r = writeFile(ctx.app, run, entity, format);
    check = { ok: r.ok, problems: r.problems || [], warnings: r.warnings || [], count: r.count, total_minor: r.total_minor };
  }
  const files = u.findMany(ctx.app, 'bank_files', 'payrun = {:r}', '-created', 50, { r: run.id }).map((r) => bankFileView(ctx.app, r));
  for (const f of files) delete f.items;
  const lists = u.findMany(ctx.app, 'payout_lists', 'payrun = {:r}', 'method', 5, { r: run.id }).map(listView);
  const journals = u.findMany(ctx.app, 'journal_exports', 'payrun = {:r}', '-created', 20, { r: run.id }).map((r) => ({ id: r.id, format: r.getString('format'), filename: r.getString('filename'), debit_minor: r.getInt('debit_minor'), credit_minor: r.getInt('credit_minor'), exported_at: r.getString('exported_at'), exported_by: memberName(ctx.app, r.getString('exported_by')) }));
  const totals = reconcile(ctx.app, run, masked.items);
  const held = totals.held_count;
  const payer = payerFor(ctx.app, entity, format);
  const fmt = B.info(format);
  const payerMissing = fmt.payer_fields.filter((f) => f.required && (payer[f.key] === undefined || String(payer[f.key]).trim() === '') && f.default === undefined).map((f) => ({ key: f.key, label: f.label }));
  const full = L('lib_auth').can(ctx, 'payroll', 'full') && !ctx.isAgent;
  return {
    run: view, format: format, format_info: fmt, formats: (countryOf(entity) || {}).bank_formats || ['generic_csv'],
    bank: masked.people.map((x) => ({ payslip: x.payslip, employee: x.employee, employee_number: x.employee_number, name: x.name, amount_minor: x.amount_minor, kind: x.kind, parts: x.parts, problems: x.problems, warnings: x.warnings })),
    cash: cash.map(itemRow), cheque: cheque.map(itemRow), held: held, totals: totals,
    check: check, payer_missing: payerMissing, files: files, lists: lists, journals: journals,
    can: { export: full && view.status === 'locked' && bankCount > 0, confirm: full && view.status === 'locked', mark_paid: full && view.status === 'locked' },
  };
}

function itemRow(it) {
  return { payslip: it.payslip, employee: it.employee, employee_number: it.employee_number, name: it.name, amount_minor: it.amount_minor, currency: it.currency, kind: it.kind };
}

/** Write the bank file of a locked run, keep it with its hash, and hand back what it holds. */
function exportFile(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'full', 'export bank files');
  const run = runRec(ctx, p.payrun);
  if (run.getString('status') !== 'locked') throw u.fail(409, run.getString('status') === 'paid' ? 'This run is already paid.' : 'Lock the pay run before you export its bank file.', 'not_locked');
  const entity = ctx.app.findRecordById('entities', run.getString('entity'));
  const s = settingsOf(ctx.app, entity);
  const format = u.str(p, 'format', s.bank_format);
  if (!L('lib_bankfiles').info(format)) throw u.fail(400, 'Unknown bank file format ' + format + '.', 'invalid_param');
  const res = writeFile(ctx.app, run, entity, format);
  if (!res.ok) throw u.fail(422, 'The bank file was not written: ' + res.problems.length + ' thing' + (res.problems.length === 1 ? '' : 's') + ' to fix first.', 'bank_file_problems', { problems: res.problems });
  const items = [];
  for (const person of res.people) for (const part of person.parts) items.push({ payslip: person.payslip, employee: person.employee, employee_number: person.employee_number, name: person.name, bank_account: part.bank_account, number_masked: part.number_masked, bank_code: part.bank_code, amount_minor: part.amount_minor });
  let out = null;
  ctx.app.runInTransaction((tx) => {
    for (const old of tx.findRecordsByFilter('bank_files', 'payrun = {:r} && status = "exported"', '', 0, 0, { r: run.id })) {
      old.set('status', 'superseded');
      tx.save(old);
    }
    const rec = u.newRecord(tx, 'bank_files');
    rec.set('payrun', run.id);
    rec.set('entity', entity.id);
    rec.set('format', format);
    rec.set('file', fileFrom(res.bytes, res.filename));
    rec.set('filename', res.filename);
    rec.set('total_minor', res.total_minor);
    rec.set('currency', res.currency);
    rec.set('count', res.count);
    rec.set('hash', res.sha256);
    rec.set('status', 'exported');
    rec.set('items', items);
    rec.set('warnings', res.warnings);
    rec.set('control', res.control || {});
    if (ctx.memberId) rec.set('exported_by', ctx.memberId);
    rec.set('exported_at', u.nowIso());
    rec.set('downloads', 0);
    tx.save(rec);
    out = bankFileView(tx, rec);
  });
  L('lib_audit').note(ctx, { collection: 'bank_files', record: out.id, summary: 'Exported the ' + format + ' bank file of ' + run.getString('number') + ' (' + res.count + ' payments, SHA-256 ' + res.sha256.slice(0, 12) + ')', after: { format: format, count: res.count, total_minor: res.total_minor, currency: res.currency, hash: res.sha256 } });
  out.totals = reconcile(ctx.app, run);
  out.next = 'Download the file, upload it to your bank, then confirm the upload with the bank reference.';
  return { bank_file: out };
}

function fileRec(ctx, ref) {
  const u = L('lib_util');
  const rec = u.byId(ctx.app, 'bank_files', String(ref || ''));
  if (rec === null) throw u.fail(404, 'No bank file "' + ref + '".', 'not_found');
  if (!L('lib_auth').inScope(ctx, rec.getString('entity'))) throw u.fail(403, 'That bank file is outside your access.', 'not_permitted');
  return rec;
}

/** Stream a stored bank file to a person (audited). */
function download(ctx, p) {
  L('lib_auth').need(ctx, 'payroll', 'full', 'download bank files');
  const rec = fileRec(ctx, p.bank_file);
  if (rec.getString('status') === 'void') throw L('lib_util').fail(409, 'This bank file was voided.', 'void');
  rec.set('downloads', rec.getInt('downloads') + 1);
  ctx.app.save(rec);
  L('lib_audit').write(ctx, { op: 'bankfiles.download', collection: 'bank_files', record: rec.id, summary: 'Downloaded bank file ' + rec.getString('filename') + ' (SHA-256 ' + rec.getString('hash').slice(0, 12) + ')' });
  return L('lib_files').serve(ctx, rec, 'file', rec.getString('filename'), true);
}

function listFiles(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'view');
  gatePay(ctx);
  let rows;
  if (u.str(p, 'payrun', '') !== '') rows = u.findMany(ctx.app, 'bank_files', 'payrun = {:r}', '-created', 100, { r: runRec(ctx, p.payrun).id });
  else {
    const ids = entityIds(ctx, p.entity);
    rows = [];
    for (const id of ids) rows = rows.concat(u.findMany(ctx.app, 'bank_files', 'entity = {:e}', '-created', 100, { e: id }));
  }
  return { files: rows.map((r) => {
    const v = bankFileView(ctx.app, r);
    delete v.items;
    return v;
  }) };
}

/** Void a bank file that must not be used (it was wrong, or the bank refused it). */
function voidFile(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'full', 'void bank files');
  const rec = fileRec(ctx, p.bank_file);
  if (rec.getString('status') === 'uploaded') throw u.fail(409, 'This file was confirmed as uploaded and the run is paid; it cannot be voided.', 'uploaded');
  rec.set('status', 'void');
  rec.set('void_reason', u.text(p, 'reason', 500, ''));
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'bank_files', record: rec.id, summary: 'Voided bank file ' + rec.getString('filename') });
  return { bank_file: bankFileView(ctx.app, rec) };
}

/** A person confirms they uploaded the file to the bank: the file is marked uploaded and the run paid. */
function confirmUpload(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'full', 'confirm bank uploads');
  const rec = fileRec(ctx, p.bank_file);
  if (rec.getString('status') !== 'exported') throw u.fail(409, 'Only the latest exported file can be confirmed (this one is ' + rec.getString('status') + ').', 'not_current');
  const run = ctx.app.findRecordById('payruns', rec.getString('payrun'));
  if (run.getString('status') !== 'locked') throw u.fail(409, 'The pay run is ' + run.getString('status') + ', not locked.', 'not_locked');
  const reference = u.text(p, 'reference', 120, '').trim();
  if (reference === '') throw u.fail(400, 'Give the bank\'s reference for the upload (batch or transaction number).', 'missing_param', { param: 'reference' });
  const paidOn = u.day(p, 'paid_on', run.getString('pay_date'));
  let view = null;
  ctx.app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    const f = tx.findRecordById('bank_files', rec.id);
    f.set('status', 'uploaded');
    f.set('reference', reference);
    f.set('paid_on', paidOn);
    if (ctx.memberId) f.set('uploaded_by', ctx.memberId);
    f.set('uploaded_at', u.nowIso());
    tx.save(f);
    L('lib_payroll_runs').markPaid(t, run.id, { paid_at: paidOn, note: 'Bank file ' + f.getString('filename') + ' uploaded, reference ' + reference });
    view = bankFileView(tx, f);
  });
  L('lib_audit').note(ctx, { collection: 'bank_files', record: rec.id, summary: 'Confirmed the bank upload of ' + run.getString('number') + ', reference ' + reference + '; the run is paid' });
  delete view.items;
  return { bank_file: view, run: runView(ctx.app, ctx.app.findRecordById('payruns', run.id)), next: 'Export the GL journal for your accounts.' };
}

/** Mark a run paid without a bank file: cash and cheque runs, or pay sent outside HR OS. */
function markPaid(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'full', 'mark pay runs paid');
  const run = runRec(ctx, p.payrun);
  if (run.getString('status') !== 'locked') throw u.fail(409, 'The pay run is ' + run.getString('status') + ', not locked.', 'not_locked');
  const reference = u.text(p, 'reference', 200, '').trim();
  if (reference === '') throw u.fail(400, 'Give a reference (the bank batch, the cash book page or the cheque run).', 'missing_param', { param: 'reference' });
  const bankSlips = u.count(ctx.app, "SELECT COUNT(*) AS n FROM payslips WHERE payrun = {:r} AND pay_method = 'bank' AND held = FALSE AND status != 'void'", { r: run.id });
  if (bankSlips > 0 && u.bool(p, 'outside', false) !== true) throw u.fail(409, bankSlips + ' people are paid by bank. Export the bank file and confirm the upload, or say the bank payments went outside HR OS (outside true).', 'bank_payments_open', { bank: bankSlips });
  const paidOn = u.day(p, 'paid_on', run.getString('pay_date'));
  ctx.app.runInTransaction((tx) => {
    const t = L('lib_auth').withApp(ctx, tx);
    for (const old of tx.findRecordsByFilter('bank_files', 'payrun = {:r} && status = "exported"', '', 0, 0, { r: run.id })) {
      old.set('status', 'superseded');
      tx.save(old);
    }
    L('lib_payroll_runs').markPaid(t, run.id, { paid_at: paidOn, note: 'Paid outside a bank file, reference ' + reference + (u.str(p, 'note', '') !== '' ? ': ' + u.str(p, 'note', '') : '') });
  });
  L('lib_audit').note(ctx, { collection: 'payruns', record: run.id, summary: 'Marked ' + run.getString('number') + ' paid, reference ' + reference });
  return { run: runView(ctx.app, ctx.app.findRecordById('payruns', run.id)), next: 'Export the GL journal for your accounts.' };
}

/** Cash or cheque list of a run (with cheque numbers and who received their pay). */
function cashList(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'view');
  gatePay(ctx);
  const run = runRec(ctx, p.payrun);
  const method = u.oneOf(p, 'method', ['cash', 'cheque'], 'cash');
  const items = L('lib_payroll_runs').payoutItems(ctx.app, run.id).filter((x) => x.pay_method === method);
  const rec = u.findOne(ctx.app, 'payout_lists', 'payrun = {:r} && method = {:m}', { r: run.id, m: method });
  const marks = {};
  for (const x of jsonField(rec, 'items', [])) marks[x.payslip] = x;
  const rows = items.map((x) => Object.assign(itemRow(x), { cheque_number: (marks[x.payslip] || {}).cheque_number || '', handed: (marks[x.payslip] || {}).handed === true }));
  let total = 0;
  for (const r of rows) total += r.amount_minor;
  const view = runView(ctx.app, run);
  // Cash: the notes and coins to draw, for the currency's common denominations.
  return { run: view, method: method, rows: rows, total_minor: total, currency: view.currency, status: rec !== null ? rec.getString('status') : 'open', denominations: method === 'cash' ? denominations(rows, view.currency) : [] };
}

const NOTES = {
  JPY: [10000, 5000, 1000, 500, 100, 50, 10, 5, 1], USD: [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1], SGD: [10000, 5000, 1000, 500, 200, 100, 50, 20, 10, 5],
  MYR: [10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5], INR: [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100], GBP: [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  AUD: [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5], EUR: [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
};

/** Notes and coins per person, summed (largest first). Empty when the currency is not listed. */
function denominations(rows, currency) {
  const list = NOTES[currency] || [];
  if (list.length === 0) return [];
  const count = {};
  for (const r of rows) {
    let left = r.amount_minor;
    for (const d of list) {
      const n = Math.floor(left / d);
      if (n > 0) {
        count[d] = (count[d] || 0) + n;
        left -= n * d;
      }
    }
  }
  return list.filter((d) => count[d]).map((d) => ({ value_minor: d, count: count[d] }));
}

/** Record cheque numbers and who received their pay. */
function setList(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'edit', 'update cash and cheque lists');
  const run = runRec(ctx, p.payrun);
  if (['locked', 'paid'].indexOf(run.getString('status')) < 0) throw u.fail(409, 'Lists exist for locked runs only.', 'not_locked');
  const method = u.oneOf(p, 'method', ['cash', 'cheque'], 'cash');
  const marks = u.list(p, 'items') || [];
  const items = L('lib_payroll_runs').payoutItems(ctx.app, run.id).filter((x) => x.pay_method === method);
  const known = {};
  for (const x of items) known[x.payslip] = x;
  let rec = u.findOne(ctx.app, 'payout_lists', 'payrun = {:r} && method = {:m}', { r: run.id, m: method });
  const prev = {};
  for (const x of jsonField(rec, 'items', [])) prev[x.payslip] = x;
  for (const m of marks) {
    if (!m || !known[m.payslip]) throw u.fail(400, 'Payslip ' + (m && m.payslip) + ' is not on the ' + method + ' list of this run.', 'invalid_param', { param: 'items' });
    prev[m.payslip] = { payslip: m.payslip, cheque_number: String(m.cheque_number || '').slice(0, 40), handed: m.handed === true };
  }
  const out = items.map((x) => Object.assign({ payslip: x.payslip, cheque_number: '', handed: false }, prev[x.payslip] || {}));
  if (rec === null) {
    rec = u.newRecord(ctx.app, 'payout_lists');
    rec.set('payrun', run.id);
    rec.set('entity', run.getString('entity'));
    rec.set('method', method);
  }
  let total = 0;
  for (const x of items) total += x.amount_minor;
  rec.set('items', out);
  rec.set('total_minor', total);
  rec.set('currency', run.getString('currency'));
  rec.set('count', items.length);
  const done = out.length > 0 && out.every((x) => x.handed);
  rec.set('status', done ? 'done' : 'open');
  rec.set('done_at', done ? u.nowIso() : '');
  if (ctx.memberId) rec.set('updated_by', ctx.memberId);
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'payout_lists', record: rec.id, summary: 'Updated the ' + method + ' list of ' + run.getString('number') });
  return { list: listView(rec) };
}

/** The entity's pay-out settings (bank format and employer details per format, GL accounts, filing preferences). */
function getSettings(ctx, p) {
  L('lib_auth').need(ctx, 'payroll', 'view');
  const entity = entityRec(ctx, p.entity);
  const s = settingsOf(ctx.app, entity);
  const B = L('lib_bankfiles');
  const formats = ((countryOf(entity) || {}).bank_formats || ['generic_csv']).slice();
  if (formats.indexOf('generic_csv') < 0) formats.push('generic_csv');
  s.formats = formats.map((f) => B.info(f)).filter((f) => f !== null);
  s.all_formats = B.list().map((f) => ({ code: f.code, name: f.name, country: f.country, official: f.official, label: f.label }));
  s.payer_effective = payerFor(ctx.app, entity, s.bank_format);
  s.entity_name = entity.getString('name');
  s.country = entity.getString('country');
  s.currency = entity.getString('currency');
  if (!L('lib_auth').can(ctx, 'payroll', 'edit') || ctx.isAgent) {
    // employer account numbers are company data, shown in full only to payroll editors
    for (const f of Object.keys(s.payer)) for (const k of ['account', 'iban']) if (s.payer[f] && s.payer[f][k]) s.payer[f][k] = L('lib_bankfiles').masked(s.payer[f][k]);
    for (const k of ['account', 'iban']) if (s.payer_effective[k]) s.payer_effective[k] = L('lib_bankfiles').masked(s.payer_effective[k]);
  }
  return { settings: s };
}

function setSettings(ctx, p) {
  const u = L('lib_util');
  L('lib_auth').need(ctx, 'payroll', 'full', 'change pay-out settings');
  const entity = entityRec(ctx, p.entity);
  const B = L('lib_bankfiles');
  let rec = settingsRec(ctx.app, entity.id);
  const before = rec !== null ? settingsOf(ctx.app, entity) : null;
  if (rec === null) {
    rec = u.newRecord(ctx.app, 'payout_settings');
    rec.set('entity', entity.id);
  }
  if (u.has(p, 'bank_format')) {
    const f = u.str(p, 'bank_format', '');
    if (f !== '' && !B.info(f)) throw u.fail(400, 'Unknown bank file format ' + f + '.', 'invalid_param', { param: 'bank_format' });
    rec.set('bank_format', f);
  }
  if (u.has(p, 'payer')) {
    const payer = u.obj(p, 'payer');
    for (const f of Object.keys(payer)) {
      if (!B.info(f)) throw u.fail(400, 'payer keys are bank file formats; ' + f + ' is not one.', 'invalid_param', { param: 'payer' });
      if (payer[f] === null || typeof payer[f] !== 'object' || Array.isArray(payer[f])) throw u.fail(400, 'payer.' + f + ' must be an object of fields.', 'invalid_param', { param: 'payer' });
      const allowed = B.info(f).payer_fields.map((x) => x.key);
      for (const k of Object.keys(payer[f])) if (allowed.indexOf(k) < 0) throw u.fail(400, 'payer.' + f + ' has no field ' + k + ' (fields: ' + allowed.join(', ') + ').', 'invalid_param', { param: 'payer' });
    }
    const merged = jsonField(rec, 'payer', {});
    for (const f of Object.keys(payer)) merged[f] = payer[f];
    rec.set('payer', merged);
  }
  if (u.has(p, 'bank_options')) {
    const o = u.obj(p, 'bank_options');
    for (const f of Object.keys(o)) if (!B.info(f)) throw u.fail(400, 'bank_options keys are bank file formats; ' + f + ' is not one.', 'invalid_param', { param: 'bank_options' });
    const merged = jsonField(rec, 'bank_options', {});
    for (const f of Object.keys(o)) merged[f] = o[f];
    rec.set('bank_options', merged);
  }
  if (u.has(p, 'gl')) rec.set('gl', L('lib_payroll_out_journal').cleanGl(u.obj(p, 'gl')));
  if (u.has(p, 'journal_format')) rec.set('journal_format', u.oneOf(p, 'journal_format', ['generic_csv', 'xero_csv', 'quickbooks_csv'], 'generic_csv'));
  if (u.has(p, 'filing_prefs')) {
    const fp = u.obj(p, 'filing_prefs');
    const merged = jsonField(rec, 'filing_prefs', {});
    for (const k of Object.keys(fp)) merged[k] = String(fp[k]);
    rec.set('filing_prefs', merged);
  }
  if (ctx.memberId) rec.set('updated_by', ctx.memberId);
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'payout_settings', record: rec.id, summary: 'Changed pay-out settings of ' + entity.getString('name'), before: before ? { bank_format: before.bank_format, journal_format: before.journal_format } : undefined, after: { bank_format: rec.getString('bank_format'), journal_format: rec.getString('journal_format') } });
  return getSettings(ctx, { entity: entity.id });
}

function formats() {
  return { formats: L('lib_bankfiles').list() };
}

module.exports = {
  L: L,
  gatePay: gatePay,
  entityRec: entityRec,
  entityIds: entityIds,
  runRec: runRec,
  runView: runView,
  memberName: memberName,
  localStamp: localStamp,
  fileFrom: fileFrom,
  settingsOf: settingsOf,
  payerFor: payerFor,
  countryOf: countryOf,
  jsonField: jsonField,
  payments: payments,
  accountType: accountType,
  denominations: denominations,
  reconcile: reconcile,
  overview: overview,
  runPayout: runPayout,
  exportFile: exportFile,
  download: download,
  listFiles: listFiles,
  voidFile: voidFile,
  confirmUpload: confirmUpload,
  markPaid: markPaid,
  cashList: cashList,
  setList: setList,
  getSettings: getSettings,
  setSettings: setSettings,
  formats: formats,
};
