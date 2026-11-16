/// <reference path="../pb_data/types.d.ts" />
/**
 * Assets: company property issued to people (laptops, phones, access
 * cards, keys, vehicles...). Each asset has a tag (A0001 when none is
 * given), a condition and a value in minor units; issue and return add to
 * its history. A person's assets show on their profile and in offboarding;
 * the full and final statement lists the ones not returned.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function lc() {
  return L('lib_lifecycle');
}

const CATEGORIES = ['laptop', 'phone', 'tablet', 'monitor', 'peripheral', 'access_card', 'keys', 'vehicle', 'uniform', 'furniture', 'license', 'other'];
const CONDITIONS = ['new', 'good', 'fair', 'damaged', 'lost'];
const STATUSES = ['in_stock', 'issued', 'retired'];
const CSV_COLUMNS = ['tag', 'name', 'category', 'serial', 'entity', 'value', 'currency', 'purchased_day', 'condition', 'employee', 'issued_day', 'note'];

function assetView(app, a, full) {
  const util = u();
  const e = util.byId(app, 'employees', a.getString('employee'));
  const v = {
    id: a.id,
    tag: a.getString('tag'),
    name: a.getString('name'),
    category: a.getString('category'),
    serial: a.getString('serial'),
    entity: a.getString('entity'),
    entity_name: lc().entityName(app, a.getString('entity')),
    employee: a.getString('employee'),
    employee_name: e !== null ? L('lib_people').displayName(e) : '',
    employee_number: e !== null ? e.getString('number') : '',
    status: a.getString('status'),
    condition: a.getString('condition'),
    issued_day: a.getString('issued_day'),
    returned_day: a.getString('returned_day'),
    currency: a.getString('currency'),
  };
  if (full) {
    v.value_minor = a.getInt('value_minor');
    v.purchased_day = a.getString('purchased_day');
    v.note = a.getString('note');
    v.history = util.jsonOf(a, 'history', []) || [];
  }
  return v;
}

function assetRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  const rec = util.byId(app, 'assets', r) || util.findOne(app, 'assets', 'tag = {:t}', { t: r });
  if (rec === null) throw util.fail(404, 'No asset ' + r + '. Run assets.list.', 'not_found');
  return rec;
}

function event(app, a, ctx, o) {
  const util = u();
  const h = util.jsonOf(a, 'history', []) || [];
  h.push(Object.assign({ at: util.nowIso(), by: ctx.memberId || '', actor: ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system', by_name: ctx.isAgent ? 'Your AI agent' : ctx.name || '' }, o));
  a.set('history', h.slice(-200));
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 100, 500);
  const where = [];
  const bind = {};
  where.push('(' + lc().scopeSql(ctx, 'a', bind) + " OR a.entity = '')");
  const status = util.oneOf(p, 'status', STATUSES.concat(['all']), 'all');
  if (status !== 'all') {
    where.push('a.status = {:st}');
    bind.st = status;
  } else if (!util.bool(p, 'retired', false)) where.push("a.status != 'retired'");
  const cat = util.oneOf(p, 'category', CATEGORIES, '');
  if (cat !== '') {
    where.push('a.category = {:c}');
    bind.c = cat;
  }
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') {
    where.push('a.employee = {:e}');
    bind.e = L('lib_people').employeeRef(app, empRef).id;
  }
  const ent = util.str(p, 'entity', '');
  if (ent !== '') {
    where.push('a.entity = {:en}');
    bind.en = L('lib_org').entityRef(app, ent).id;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(a.name LIKE {:q} ESCAPE '\\' OR a.tag LIKE {:q} ESCAPE '\\' OR a.serial LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const w = where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM assets a WHERE ' + w, bind);
  const rows = util.rows(app, 'SELECT a.id AS id FROM assets a WHERE ' + w + " ORDER BY a.status = 'issued' DESC, a.name COLLATE NOCASE, a.tag LIMIT " + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const counts = {};
  const b2 = {};
  for (const r of util.rows(app, 'SELECT a.status AS status, COUNT(*) AS n FROM assets a WHERE (' + lc().scopeSql(ctx, 'a', b2) + " OR a.entity = '') GROUP BY a.status", { status: '', n: 0 }, b2)) counts[r.status] = r.n;
  return { assets: rows.map((r) => assetView(app, app.findRecordById('assets', r.id), true)), total: total, counts: counts, categories: CATEGORIES, conditions: CONDITIONS, limit: pg.limit, offset: pg.offset };
}

function get(ctx, p) {
  return { asset: assetView(ctx.app, assetRef(ctx.app, u().req(p, 'asset')), true) };
}

function currencyFor(app, entityId, p) {
  const util = u();
  const c = util.str(p, 'currency', '').toUpperCase();
  if (c !== '') {
    if (!/^[A-Z]{3}$/.test(c)) throw util.fail(400, 'currency is a three-letter code, e.g. SGD', 'invalid_param', { param: 'currency' });
    return c;
  }
  const ent = util.byId(app, 'entities', entityId || '');
  if (ent !== null) return ent.getString('currency');
  return L('lib_settings').row(app).getString('reporting_currency') || 'USD';
}

function setFields(ctx, a, p, creating) {
  const util = u();
  const app = ctx.app;
  if (creating || util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 160, ''));
    if (n === '') throw util.fail(400, 'name is required, e.g. --name "MacBook Air 13"', 'missing_param', { param: 'name' });
    a.set('name', n);
  }
  if (util.has(p, 'tag') && util.str(p, 'tag', '') !== '') {
    const t = util.squash(util.text(p, 'tag', 40, '')).toUpperCase();
    const dup = util.findOne(app, 'assets', 'tag = {:t} && id != {:id}', { t: t, id: a.id || '' });
    if (dup !== null) throw util.fail(409, 'The tag ' + t + ' is already used by ' + dup.getString('name') + '.', 'duplicate', { param: 'tag' });
    a.set('tag', t);
  }
  if (creating || util.has(p, 'category')) a.set('category', util.oneOf(p, 'category', CATEGORIES, creating ? 'other' : a.getString('category')));
  if (util.has(p, 'serial')) a.set('serial', util.text(p, 'serial', 120, ''));
  if (util.has(p, 'entity')) a.set('entity', util.str(p, 'entity', '') === '' ? '' : L('lib_org').entityRef(app, util.str(p, 'entity', '')).id);
  if (creating || util.has(p, 'currency') || util.has(p, 'value')) {
    const cur = util.has(p, 'currency') || creating ? currencyFor(app, a.getString('entity'), p) : a.getString('currency');
    a.set('currency', cur);
    if (util.has(p, 'value')) a.set('value_minor', util.money(p, 'value', cur) || 0);
  }
  if (creating || util.has(p, 'condition')) a.set('condition', util.oneOf(p, 'condition', CONDITIONS, creating ? 'new' : a.getString('condition')));
  if (util.has(p, 'purchased_day')) a.set('purchased_day', util.day(p, 'purchased_day', ''));
  if (util.has(p, 'note')) a.set('note', util.text(p, 'note', 2000, ''));
}

/** assets.add: a new asset (in stock, or issued at once with --employee). */
function add(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = util.newRecord(app, 'assets');
  setFields(ctx, a, p, true);
  lc().needHr(ctx, a.getString('entity'), 'edit', 'add assets');
  a.set('status', 'in_stock');
  a.set('history', []);
  const empRef = util.str(p, 'employee', '');
  lc().inTx(app, (tx) => {
    if (a.getString('tag') === '') {
      let t;
      do t = 'A' + String(util.nextNumber(tx, 'asset')).padStart(4, '0');
      while (util.findOne(tx, 'assets', 'tag = {:t}', { t: t }) !== null);
      a.set('tag', t);
    }
    event(tx, a, ctx, { event: 'added', condition: a.getString('condition') });
    if (empRef !== '') {
      const e = L('lib_people').employeeRef(tx, empRef);
      const day = util.day(p, 'issued_day', util.today(tx, a.getString('entity') || undefined));
      a.set('employee', e.id);
      a.set('status', 'issued');
      a.set('issued_day', day);
      event(tx, a, ctx, { event: 'issued', employee: e.id, employee_name: L('lib_people').displayName(e), day: day, condition: a.getString('condition') });
    }
    tx.save(a);
  });
  L('lib_audit').note(ctx, { collection: 'assets', record: a.id, summary: 'Added the asset ' + a.getString('tag') + ' ' + a.getString('name') + (a.getString('employee') !== '' ? ' issued to ' + lc().employeeName(app, a.getString('employee')) : '') });
  return { asset: assetView(app, a, true) };
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = assetRef(app, util.req(p, 'asset'));
  lc().needHr(ctx, a.getString('entity'), 'edit', 'change assets');
  const before = assetView(app, a, true);
  delete before.history;
  const cond = a.getString('condition');
  setFields(ctx, a, p, false);
  lc().needHr(ctx, a.getString('entity'), 'edit', 'change assets');
  if (a.getString('condition') !== cond) event(app, a, ctx, { event: 'condition', condition: a.getString('condition'), note: util.text(p, 'note', 2000, '') });
  app.save(a);
  const after = assetView(app, a, true);
  delete after.history;
  L('lib_audit').note(ctx, { collection: 'assets', record: a.id, summary: 'Changed the asset ' + a.getString('tag') + ' ' + a.getString('name'), before: before, after: after });
  return { asset: assetView(app, a, true) };
}

/** assets.issue: hand an asset in stock to a person. */
function issue(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = assetRef(app, util.req(p, 'asset'));
  lc().needHr(ctx, a.getString('entity'), 'edit', 'issue assets');
  if (a.getString('status') !== 'in_stock') throw util.fail(409, a.getString('tag') + ' is ' + (a.getString('status') === 'issued' ? 'with ' + lc().employeeName(app, a.getString('employee')) + '; return it first' : 'retired') + '.', 'conflict');
  const e = L('lib_people').employeeRef(app, util.req(p, 'employee', 'E0001'));
  if (!L('lib_people').canSeeEmployee(ctx, e)) throw util.fail(403, 'You cannot see this person.', 'not_permitted');
  const day = util.day(p, 'day', util.today(app, a.getString('entity') || undefined));
  if (util.has(p, 'condition')) a.set('condition', util.oneOf(p, 'condition', CONDITIONS, a.getString('condition')));
  a.set('employee', e.id);
  a.set('status', 'issued');
  a.set('issued_day', day);
  a.set('returned_day', '');
  event(app, a, ctx, { event: 'issued', employee: e.id, employee_name: L('lib_people').displayName(e), day: day, condition: a.getString('condition'), note: util.text(p, 'note', 2000, '') });
  app.save(a);
  L('lib_audit').note(ctx, { collection: 'assets', record: a.id, summary: 'Issued ' + a.getString('tag') + ' ' + a.getString('name') + ' to ' + L('lib_people').displayName(e) });
  return { asset: assetView(app, a, true) };
}

function previewIssue(ctx, p) {
  const util = u();
  const a = assetRef(ctx.app, util.str(p, 'asset', ''));
  const e = L('lib_people').employeeRef(ctx.app, util.str(p, 'employee', ''));
  return { label: 'Issue ' + a.getString('tag') + ' ' + a.getString('name') + ' to ' + L('lib_people').displayName(e), target: 'assets:' + a.id, fields: [{ name: 'with', before: a.getString('employee') !== '' ? lc().employeeName(ctx.app, a.getString('employee')) : 'In stock', after: L('lib_people').displayName(e) }], notes: [], risk: 'low' };
}

/** assets.return: the person gave it back (condition on return; lost or damaged can retire it). */
function giveBack(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = assetRef(app, util.req(p, 'asset'));
  lc().needHr(ctx, a.getString('entity'), 'edit', 'return assets');
  if (a.getString('status') !== 'issued') throw util.fail(409, a.getString('tag') + ' is not issued to anyone.', 'conflict');
  const day = util.day(p, 'day', util.today(app, a.getString('entity') || undefined));
  const cond = util.oneOf(p, 'condition', CONDITIONS, a.getString('condition') === 'new' ? 'good' : a.getString('condition') || 'good');
  const from = a.getString('employee');
  a.set('condition', cond);
  a.set('returned_day', day);
  a.set('employee', '');
  a.set('status', cond === 'lost' || util.bool(p, 'retire', false) ? 'retired' : 'in_stock');
  event(app, a, ctx, { event: cond === 'lost' ? 'lost' : 'returned', employee: from, employee_name: lc().employeeName(app, from), day: day, condition: cond, note: util.text(p, 'note', 2000, '') });
  app.save(a);
  L('lib_audit').note(ctx, { collection: 'assets', record: a.id, summary: (cond === 'lost' ? 'Recorded as lost: ' : 'Returned: ') + a.getString('tag') + ' ' + a.getString('name') + ' from ' + lc().employeeName(app, from) });
  return { asset: assetView(app, a, true) };
}

function previewReturn(ctx, p) {
  const util = u();
  const a = assetRef(ctx.app, util.str(p, 'asset', ''));
  return { label: 'Return ' + a.getString('tag') + ' ' + a.getString('name') + ' from ' + lc().employeeName(ctx.app, a.getString('employee')), target: 'assets:' + a.id, fields: [{ name: 'condition', before: a.getString('condition'), after: util.str(p, 'condition', '') || a.getString('condition') }], notes: [], risk: 'low' };
}

function retire(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = assetRef(app, util.req(p, 'asset'));
  lc().needHr(ctx, a.getString('entity'), 'edit', 'retire assets');
  if (a.getString('status') === 'issued') throw util.fail(409, a.getString('tag') + ' is with ' + lc().employeeName(app, a.getString('employee')) + '. Return it first (or record it as lost with assets.return --condition lost).', 'conflict');
  if (a.getString('status') === 'retired') return { asset: assetView(app, a, true) };
  a.set('status', 'retired');
  event(app, a, ctx, { event: 'retired', note: util.text(p, 'note', 2000, '') });
  app.save(a);
  L('lib_audit').note(ctx, { collection: 'assets', record: a.id, summary: 'Retired ' + a.getString('tag') + ' ' + a.getString('name') });
  return { asset: assetView(app, a, true) };
}

function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = assetRef(app, util.req(p, 'asset'));
  lc().needHr(ctx, a.getString('entity'), 'full', 'delete assets');
  const h = util.jsonOf(a, 'history', []) || [];
  if (a.getString('status') === 'issued' || h.some((x) => x.event === 'issued')) throw util.fail(409, a.getString('tag') + ' has been issued; retire it instead so its history stays.', 'has_history');
  app.delete(a);
  L('lib_audit').note(ctx, { collection: 'assets', record: a.id, summary: 'Deleted the asset ' + a.getString('tag') + ' ' + a.getString('name') });
  return { deleted: true };
}

function exportCsv(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rows = [CSV_COLUMNS];
  let offset = 0;
  for (let i = 0; i < 40; i++) {
    const page = list(ctx, Object.assign({}, p, { limit: 500, offset: offset, retired: true }));
    for (const a of page.assets) rows.push([a.tag, a.name, a.category, a.serial, a.entity_name, L('lib_money').fromMinor(a.value_minor, a.currency || 'USD'), a.currency, a.purchased_day, a.condition, a.employee_number, a.status === 'issued' ? a.issued_day : '', a.note]);
    offset += page.assets.length;
    if (offset >= page.total || page.assets.length === 0) break;
  }
  L('lib_audit').write(ctx, { op: 'assets.export', collection: 'assets', summary: 'Exported ' + (rows.length - 1) + ' assets to CSV' });
  return { filename: 'assets-' + util.today(app) + '.csv', rows: rows.length - 1, csv: util.csvText(rows) };
}

/** Check every row of an assets CSV: { rows, ok, errors, plan }. */
function importPlan(ctx, csvText) {
  const util = u();
  const app = ctx.app;
  const parsed = util.csvObjects(csvText);
  const errors = [];
  for (const h of parsed.header) if (CSV_COLUMNS.indexOf(h) < 0) errors.push({ line: 1, message: 'Unknown column "' + h + '". Columns: ' + CSV_COLUMNS.join(', ') });
  if (parsed.header.indexOf('name') < 0) errors.push({ line: 1, message: 'The CSV needs a name column.' });
  const plan = [];
  const tags = {};
  parsed.items.forEach((row, i) => {
    const line = i + 2;
    const params = {};
    try {
      if (String(row.name || '').trim() === '') throw util.fail(400, 'name is empty');
      for (const k of ['tag', 'name', 'category', 'serial', 'value', 'currency', 'purchased_day', 'condition', 'note', 'issued_day']) if (row[k] !== undefined && row[k] !== '') params[k] = row[k];
      if (params.category !== undefined) params.category = String(params.category).toLowerCase().replace(/\s+/g, '_');
      if (params.condition !== undefined) params.condition = String(params.condition).toLowerCase();
      if (params.category !== undefined && CATEGORIES.indexOf(params.category) < 0) throw util.fail(400, 'category must be one of ' + CATEGORIES.join(', '));
      if (params.condition !== undefined && CONDITIONS.indexOf(params.condition) < 0) throw util.fail(400, 'condition must be one of ' + CONDITIONS.join(', '));
      if (row.entity) params.entity = L('lib_org').entityRef(app, row.entity).id;
      if (row.employee) params.employee = L('lib_people').employeeRef(app, row.employee).id;
      for (const k of ['purchased_day', 'issued_day']) if (params[k] !== undefined && !util.isDay(params[k])) throw util.fail(400, k + ' must be YYYY-MM-DD');
      if (params.value !== undefined) {
        const cur = params.currency ? String(params.currency).toUpperCase() : currencyFor(app, params.entity || '', {});
        if (L('lib_money').toMinor(String(params.value), cur) === null) throw util.fail(400, 'value is not an amount in ' + cur);
      }
      if (params.tag !== undefined) {
        const t = String(params.tag).toUpperCase();
        if (tags[t]) throw util.fail(400, 'the tag ' + t + ' is twice in the file');
        tags[t] = true;
        if (util.findOne(app, 'assets', 'tag = {:t}', { t: t }) !== null) throw util.fail(409, 'the tag ' + t + ' already exists');
      }
      plan.push({ line: line, params: params });
    } catch (err) {
      errors.push({ line: line, message: String((err && err.message) || err) });
    }
  });
  return { rows: parsed.items.length, ok: plan.length, errors: errors, plan: plan };
}

function importCheck(ctx, p) {
  lc().needHr(ctx, '', 'edit', 'import assets');
  const out = importPlan(ctx, L('lib_files').csvInput(ctx, p, 'file', 'csv'));
  return { dry_run: true, rows: out.rows, ok: out.ok, errors: out.errors, preview: out.plan.slice(0, 20).map((x) => Object.assign({ line: x.line }, x.params)) };
}

function importCommit(ctx, p) {
  const util = u();
  lc().needHr(ctx, '', 'edit', 'import assets');
  const out = importPlan(ctx, L('lib_files').csvInput(ctx, p, 'file', 'csv'));
  if (out.errors.length > 0) throw util.fail(400, 'The CSV has ' + out.errors.length + ' problem(s); nothing was imported. Run assets.import-check to see them.', 'import_errors', { errors: out.errors.slice(0, 50) });
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    const tctx = L('lib_auth').withApp(ctx, tx);
    for (const x of out.plan) {
      add(tctx, x.params);
      n++;
    }
  });
  L('lib_audit').note(ctx, { collection: 'assets', summary: 'Imported ' + n + ' assets from CSV' });
  return { imported: n };
}

module.exports = {
  CATEGORIES: CATEGORIES,
  CONDITIONS: CONDITIONS,
  assetView: assetView,
  list: list,
  get: get,
  add: add,
  update: update,
  issue: issue,
  previewIssue: previewIssue,
  giveBack: giveBack,
  previewReturn: previewReturn,
  retire: retire,
  remove: remove,
  exportCsv: exportCsv,
  importCheck: importCheck,
  importCommit: importCommit,
};
