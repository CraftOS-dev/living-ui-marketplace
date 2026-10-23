/// <reference path="../pb_data/types.d.ts" />
/**
 * Settings, numbering and name resolution shared by every module.
 *
 * Resolution: every parameter that points at a record takes its id or the
 * handle people use (a number, code, SKU, email or exact name). A name that
 * matches more than one record is refused with the candidates, never
 * guessed.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/** The single settings row. */
function settings(app) {
  const rows = app.findRecordsByFilter('settings', '', '', 1, 0);
  if (rows.length === 0) throw u().fail(500, 'The settings row is missing.', 'error');
  return rows[0];
}

/** The base currency (ISO code); 'USD' until setup chooses one. */
function currency(app) {
  const c = settings(app).getString('base_currency');
  return c === '' ? 'USD' : c;
}

function defaults(app) {
  return u().jsonOf(settings(app), 'defaults') || {};
}

function modules(app) {
  return u().jsonOf(settings(app), 'modules') || {};
}

function roleByKey(app, key) {
  const r = u().findOne(app, 'roles', 'key = {:k}', { k: key });
  if (r === null) throw u().fail(500, 'Built-in role ' + key + ' is missing.', 'error');
  return r;
}

/* ---------------------------------------------------------- numbering */

const SERIES_DEFAULTS = {
  quote: 'QT-',
  sales_order: 'SO-',
  delivery: 'DN-',
  invoice: 'INV-',
  credit_note: 'CN-',
  purchase_order: 'PO-',
  goods_receipt: 'GR-',
  bill: 'BILL-',
  supplier_credit: 'SC-',
  payment_in: 'RCV-',
  payment_out: 'PAY-',
  journal: 'JE-',
  stock_change: 'ADJ-',
  claim: 'EXP-',
  payroll: 'PR-',
  build: 'MO-',
  asset: 'FA-',
  employee: 'EMP-',
  party: 'P',
  project: 'PRJ-',
  item: 'SKU-',
};

function seriesConfig(app, series) {
  const all = u().jsonOf(settings(app), 'numbering') || {};
  const c = all[series] || {};
  return {
    prefix: typeof c.prefix === 'string' ? c.prefix : SERIES_DEFAULTS[series] || series.toUpperCase() + '-',
    width: typeof c.width === 'number' && c.width >= 1 && c.width <= 10 ? c.width : 5,
  };
}

/**
 * The next number of a series, gapless: the counter row is bumped in the
 * caller's transaction, so a failed post returns its number. Call it with
 * the transaction handle.
 */
function nextNumber(tx, series) {
  const util = u();
  const cfg = seriesConfig(tx, series);
  const res = util.exec(tx, 'UPDATE counters SET num = num + 1 WHERE key = {:k}', { k: series });
  let affected = 0;
  try {
    affected = res.rowsAffected();
  } catch {
    affected = 0;
  }
  if (affected === 0) {
    const rec = util.newRecord(tx, 'counters');
    rec.set('key', series);
    rec.set('num', 1);
    tx.save(rec);
  }
  const n = util.one(tx, 'SELECT num FROM counters WHERE key = {:k}', { num: 0 }, { k: series }).num;
  let digits = String(n);
  while (digits.length < cfg.width) digits = '0' + digits;
  return cfg.prefix + digits;
}

/** What the next number of a series will look like (for previews; nothing is reserved). */
function peekNumber(app, series) {
  const cfg = seriesConfig(app, series);
  const row = u().one(app, 'SELECT num FROM counters WHERE key = {:k}', { num: 0 }, { k: series });
  let digits = String((row ? row.num : 0) + 1);
  while (digits.length < cfg.width) digits = '0' + digits;
  return cfg.prefix + digits;
}

/* --------------------------------------------------------- resolution */

const ID = /^[a-z0-9]{15}$/;

/**
 * How each collection is looked up: the columns tried in order (exact,
 * case-insensitive), the column that names a record in messages, and the
 * hint that tells the agent how to find one.
 */
const LOOKUP = {
  parties: { by: ['code', 'email', 'name'], label: 'name', what: 'customer or supplier', hint: 'Find it with parties.list --q "..."' },
  items: { by: ['sku', 'barcode', 'name'], label: 'name', what: 'item', hint: 'Find it with items.list --q "..."' },
  accounts: { by: ['code', 'system_key', 'name'], label: 'name', what: 'account', hint: 'See accounts.list' },
  warehouses: { by: ['code', 'name'], label: 'name', what: 'warehouse', hint: 'See warehouses.list' },
  taxes: { by: ['code', 'name'], label: 'name', what: 'tax', hint: 'See taxes.list' },
  payment_terms: { by: ['name'], label: 'name', what: 'payment term', hint: 'See terms.list' },
  banks: { by: ['name'], label: 'name', what: 'bank account', hint: 'See banks.list' },
  employees: { by: ['number', 'email', 'name'], label: 'name', what: 'employee', hint: 'Find them with employees.list --q "..."' },
  projects: { by: ['code', 'name'], label: 'name', what: 'project', hint: 'See projects.list' },
  members: { by: ['email', 'name'], label: 'name', what: 'member', hint: 'See members.list' },
  departments: { by: ['code', 'name'], label: 'name', what: 'department', hint: 'See departments.list' },
  item_categories: { by: ['name'], label: 'name', what: 'category', hint: 'See categories.list' },
  roles: { by: ['key', 'name'], label: 'name', what: 'role', hint: 'See roles.list' },
  journals: { by: ['number'], label: 'number', what: 'journal entry', hint: 'See journals.list' },
  stock_changes: { by: ['number'], label: 'number', what: 'stock change', hint: 'See stock.changes' },
  leave_types: { by: ['name'], label: 'name', what: 'leave type', hint: 'See leave.types' },
  pay_components: { by: ['name'], label: 'name', what: 'pay component', hint: 'See payroll.components' },
  payroll_runs: { by: ['number', 'month'], label: 'number', what: 'pay run', hint: 'See payroll.runs' },
  expense_claims: { by: ['number'], label: 'number', what: 'expense claim', hint: 'See claims.list' },
  boms: { by: ['name'], label: 'name', what: 'bill of materials', hint: 'See boms.list' },
  builds: { by: ['number'], label: 'number', what: 'build', hint: 'See builds.list' },
  assets: { by: ['number', 'name'], label: 'name', what: 'asset', hint: 'See assets.list' },
  currencies: { by: ['code'], label: 'code', what: 'currency', hint: 'See currencies.list' },
  project_tasks: { by: ['title'], label: 'title', what: 'task', hint: 'See tasks.list --project "..."' },
  proposals: { by: [], label: 'title', what: 'proposal', hint: 'See proposals.list' },
  inbox: { by: ['filename'], label: 'filename', what: 'inbox file', hint: 'See inbox.list' },
  imports: { by: [], label: 'filename', what: 'import', hint: 'See import.list' },
  asks: { by: [], label: 'question', what: 'question', hint: 'See asks.list' },
  leave_requests: { by: [], label: 'id', what: 'leave request', hint: 'See leave.list' },
  timesheets: { by: [], label: 'id', what: 'time entry', hint: 'See timesheets.list' },
  bank_lines: { by: [], label: 'description', what: 'statement line', hint: 'See bank.lines' },
  allocations: { by: [], label: 'id', what: 'allocation', hint: 'See payments.get' },
  contacts: { by: [], label: 'name', what: 'contact', hint: 'See parties.get' },
  attachments: { by: [], label: 'name', what: 'attachment', hint: 'See attachments.list' },
  notes: { by: [], label: 'body', what: 'note', hint: 'See activity.list' },
  payslips: { by: [], label: 'id', what: 'payslip', hint: 'See payroll.run-get' },
  holidays: { by: ['date', 'name'], label: 'name', what: 'holiday', hint: 'See leave.holidays' },
  claim_lines: { by: [], label: 'description', what: 'claim line', hint: 'See claims.get' },
  document_lines: { by: [], label: 'description', what: 'line', hint: 'See docs.get' },
  bom_lines: { by: [], label: 'id', what: 'line', hint: 'See boms.get' },
};

/**
 * Find a record by id or handle. Throws 404 (not found, with a hint) or 409
 * (several match, with the candidates).
 */
function resolve(app, collection, ref, opts) {
  const util = u();
  const o = opts || {};
  const spec = LOOKUP[collection] || { by: ['name'], label: 'name', what: collection, hint: '' };
  const r = String(ref === undefined || ref === null ? '' : ref).trim();
  if (r === '') throw util.fail(400, spec.what + ' is required', 'missing_param');
  if (ID.test(r)) {
    const hit = util.byId(app, collection, r);
    if (hit !== null) return hit;
  }
  for (const col of spec.by) {
    const extra = o.where ? ' AND (' + o.where + ')' : '';
    const ids = util.rows(app, 'SELECT id FROM ' + collection + ' WHERE LOWER([[' + col + ']]) = LOWER({:v})' + extra + ' LIMIT 6', { id: '' }, Object.assign({ v: r }, o.bind || {}));
    if (ids.length === 1) return app.findRecordById(collection, ids[0].id);
    if (ids.length > 1) {
      const names = ids.slice(0, 5).map((x) => describe(app, collection, app.findRecordById(collection, x.id)));
      throw util.fail(409, 'More than one ' + spec.what + ' matches "' + r + '": ' + names.join('; ') + '. Use its number, code or id.', 'ambiguous', { candidates: ids.map((x) => x.id) });
    }
  }
  const near = closest(app, collection, spec, r, o);
  throw util.fail(404, 'No ' + spec.what + ' "' + r + '".' + (near.length > 0 ? ' Did you mean ' + near.join('; ') + '?' : '') + ' ' + spec.hint, 'not_found', near.length > 0 ? { suggestions: near } : {});
}

/**
 * Up to three records whose label is close to a reference that matched
 * nothing ("Harbor Cafe" -> "Harbour Cafe (P00012)"): candidates sharing its
 * first letters or one of its words, ranked by edit distance.
 */
function closest(app, collection, spec, ref, o) {
  const util = u();
  const col = spec.label || 'name';
  const low = ref.toLowerCase();
  const words = low.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (low.length < 3) return [];
  const likes = ['LOWER([[' + col + "]]) LIKE {:p0} ESCAPE '\\'"];
  const bind = Object.assign({ p0: util.like(low.slice(0, 3)).slice(1) }, o.bind || {});
  words.slice(0, 4).forEach((w, i) => {
    likes.push('LOWER([[' + col + ']]) LIKE {:w' + i + "} ESCAPE '\\'");
    bind['w' + i] = util.like(w);
  });
  let rows = [];
  try {
    rows = util.rows(app, 'SELECT id, [[' + col + ']] AS label FROM ' + collection + ' WHERE (' + likes.join(' OR ') + ")" + (o.where ? ' AND (' + o.where + ')' : '') + ' LIMIT 60', { id: '', label: '' }, bind);
  } catch {
    return [];
  }
  return rows
    .map((x) => ({ id: x.id, d: util.editDistance(low, String(x.label).toLowerCase()) }))
    .filter((x) => x.d <= Math.max(3, Math.floor(low.length / 2)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => describe(app, collection, app.findRecordById(collection, x.id)));
}

/** resolve(), or null for an empty ref. */
function resolveOpt(app, collection, ref, opts) {
  const r = String(ref === undefined || ref === null ? '' : ref).trim();
  if (r === '') return null;
  return resolve(app, collection, r, opts);
}

function describe(app, collection, rec) {
  const spec = LOOKUP[collection] || { label: 'name' };
  const label = rec.getString(spec.label);
  if (collection === 'parties') return label + ' (' + rec.getString('code') + ')';
  if (collection === 'items') return label + ' (' + rec.getString('sku') + ')';
  if (collection === 'accounts') return rec.getString('code') + ' ' + label;
  if (collection === 'employees') return label + ' (' + rec.getString('number') + ')';
  return label + ' (' + rec.id + ')';
}

/**
 * A document by id or number. Numbers are unique per type; without `type`
 * a number shared by two types is refused with both.
 */
function resolveDoc(app, ref, type) {
  const util = u();
  const r = String(ref === undefined || ref === null ? '' : ref).trim();
  if (r === '') throw util.fail(400, 'doc is required, e.g. --doc INV-00012', 'missing_param');
  if (ID.test(r)) {
    const hit = util.byId(app, 'documents', r);
    if (hit !== null && (type === undefined || hit.getString('type') === type)) return hit;
  }
  const bind = { n: r };
  let sql = 'SELECT id, type FROM documents WHERE LOWER(number) = LOWER({:n})';
  if (type !== undefined) {
    sql += ' AND type = {:t}';
    bind.t = type;
  }
  const ids = util.rows(app, sql + ' LIMIT 5', { id: '', type: '' }, bind);
  if (ids.length === 1) return app.findRecordById('documents', ids[0].id);
  if (ids.length > 1) throw util.fail(409, 'More than one document is numbered ' + r + ' (' + ids.map((x) => x.type).join(', ') + '). Give its id.', 'ambiguous');
  throw util.fail(404, 'No ' + (type ? type.replace(/_/g, ' ') : 'document') + ' ' + r + '. Find it with docs.list --type ' + (type || 'invoice') + ' --q "..."', 'not_found');
}

function resolvePayment(app, ref) {
  const util = u();
  const r = String(ref === undefined || ref === null ? '' : ref).trim();
  if (r === '') throw util.fail(400, 'payment is required, e.g. --payment RCV-00003', 'missing_param');
  if (ID.test(r)) {
    const hit = util.byId(app, 'payments', r);
    if (hit !== null) return hit;
  }
  const ids = util.rows(app, 'SELECT id FROM payments WHERE LOWER(number) = LOWER({:n}) LIMIT 2', { id: '' }, { n: r });
  if (ids.length === 1) return app.findRecordById('payments', ids[0].id);
  throw util.fail(404, 'No payment ' + r + '. Find it with payments.list --q "..."', 'not_found');
}

/** A system account by its key (ar, ap, inventory, ...). */
function systemAccount(app, key) {
  const util = u();
  const d = defaults(app);
  if (typeof d[key] === 'string' && d[key] !== '') {
    const rec = util.byId(app, 'accounts', d[key]);
    if (rec !== null) return rec;
  }
  const rec = util.findOne(app, 'accounts', 'system_key = {:k}', { k: key });
  if (rec === null) throw util.fail(409, 'The ' + key.replace(/_/g, ' ') + ' account is not set up. Set it under Settings, Default accounts.', 'account_missing', { key: key });
  return rec;
}

/** id -> small display object for a relation (null-safe). */
function brief(app, collection, id, fields) {
  if (typeof id !== 'string' || id === '') return null;
  const rec = u().byId(app, collection, id);
  if (rec === null) return null;
  const out = { id: rec.id };
  for (const f of fields) out[f] = rec.get(f);
  return out;
}

module.exports = {
  settings: settings,
  currency: currency,
  defaults: defaults,
  modules: modules,
  roleByKey: roleByKey,
  SERIES_DEFAULTS: SERIES_DEFAULTS,
  seriesConfig: seriesConfig,
  nextNumber: nextNumber,
  peekNumber: peekNumber,
  LOOKUP: LOOKUP,
  resolve: resolve,
  resolveOpt: resolveOpt,
  resolveDoc: resolveDoc,
  resolvePayment: resolvePayment,
  describe: describe,
  systemAccount: systemAccount,
  brief: brief,
};
