/// <reference path="../pb_data/types.d.ts" />
/**
 * Imports (Store OS importer, adapted): CSV and XLSX lists into any
 * module's records. The page reads the file (CSV or Excel) and sends rows;
 * your AI agent sends CSV text or a --path. Columns are matched to the
 * target's fields by header synonyms (a person can change the mapping), a
 * preview shows what each row would do (a dry run in a rolled-back
 * transaction), and a run commits rows in batches of at most 200 per call,
 * each batch one undoable unit, all batches of one file under one import
 * record (--import continues it).
 *
 * Targets are registered by modules in events_*.js:
 *
 *   imports: {
 *     companies: {
 *       label: 'Companies',
 *       perm: 'network:edit',                       // who may import (catalog perm syntax)
 *       fields: [{ key: 'name', label: 'Name', required: true, type: 'text', synonyms: ['Company', 'Company name'] }, ...],
 *       row: 'lib_records.importCompany',           // fn(ctx, row, info) -> { action: 'created'|'updated'|'skipped', id, message }
 *       pin: true,                                  // optional: a run needs the person's approval PIN (opening balances)
 *     },
 *   }
 *
 * A target with pin: true: imports.run asks the approval PIN of the person
 * running it (the dispatcher checks it through the op's pinIf), your AI
 * agent's run of it is always a proposal, and accepting that proposal asks
 * the accepting person's PIN.
 *
 * Field types: text, number, int, money (major-unit text, the mapper picks
 * the currency), percent (-> ppm integer), day (-> YYYY-MM-DD; d/m/y or
 * m/d/y follow settings.date_style; Excel serial days too), email, url,
 * bool, list (split on ; or ,). A row function throws lib_util.fail(...)
 * to refuse a row; it should check before it writes.
 */

const MAX_ROWS = 200;
const MAX_TOTAL = 20000;

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function norm(s) {
  return String(s === undefined || s === null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function targets() {
  return L('lib_events').importTargets();
}

/** pinIf of imports.run: a target registered with pin: true. */
function pinNeeded(ctx, p) {
  const t = targets()[String((p && p.target) || '')];
  return t !== undefined && t.pin === true;
}

function mayImport(ctx, t) {
  return L('lib_auth').passes(ctx, { name: 'imports.run', perm: t.perm || 'settings:edit', agent: 'propose' });
}

function targetOf(ctx, p) {
  const util = u();
  const name = util.req(p, 'target', 'companies');
  const t = targets()[name];
  if (t === undefined) throw util.fail(404, 'No import target ' + name + '. Targets: ' + Object.keys(targets()).sort().join(', ') + '.', 'not_found', { param: 'target' });
  if (!mayImport(ctx, t)) throw util.fail(403, 'You cannot import ' + (t.label || name) + '.', 'not_permitted');
  return Object.assign({ name: name }, t);
}

function fieldView(f) {
  return { key: f.key, label: f.label || f.key, required: f.required === true, type: f.type || 'text', synonyms: f.synonyms || [] };
}

/** imports.targets: what can be imported, with fields and synonyms (the page auto-matches columns with them). */
function targetsOp(ctx) {
  const all = targets();
  return {
    targets: Object.keys(all)
      .sort()
      .filter((k) => mayImport(ctx, all[k]))
      .map((k) => ({ target: k, module: all[k].module, label: all[k].label || k, pin: all[k].pin === true, fields: (all[k].fields || []).map(fieldView) })),
    max_rows_per_call: MAX_ROWS,
  };
}

/** The table sent: rows (objects or lists with --headers), CSV text, an upload or your AI agent's --path. */
function tableOf(ctx, p) {
  const util = u();
  if (util.has(p, 'rows')) {
    const rows = util.list(p, 'rows');
    if (rows.length === 0) return { headers: [], rows: [] };
    if (Array.isArray(rows[0])) {
      const headers = (util.list(p, 'headers') || []).map((h) => String(h));
      if (headers.length === 0) throw util.fail(400, 'Rows as lists need --headers (a JSON list of column names).', 'missing_param', { param: 'headers' });
      return { headers: headers, rows: rows.map((r) => headers.map((_, i) => (r[i] === undefined || r[i] === null ? '' : r[i]))) };
    }
    const headers = [];
    for (const r of rows) for (const k of Object.keys(r || {})) if (headers.indexOf(k) < 0) headers.push(k);
    return { headers: headers, rows: rows.map((r) => headers.map((h) => (r && r[h] !== undefined && r[h] !== null ? r[h] : ''))) };
  }
  const text = util.textInput(ctx, p, 'file', 'csv', 'path', 5000000);
  if (text.trim() === '') throw util.fail(400, 'Send the rows (--rows), the CSV text (--csv), a file, or (your AI agent) a --path.', 'missing_param', { param: 'csv' });
  const parsed = util.csvParse(text);
  if (parsed.length === 0) return { headers: [], rows: [] };
  const headers = parsed[0].map((h, i) => String(h).trim() || 'Column ' + (i + 1));
  return { headers: headers, rows: parsed.slice(1).map((r) => headers.map((_, i) => (r[i] === undefined ? '' : r[i]))) };
}

/** Header -> field key: the --mapping given, else by key, label and synonyms. */
function mappingOf(p, t, headers) {
  const util = u();
  const given = util.obj(p, 'mapping');
  const keys = (t.fields || []).map((f) => f.key);
  const out = {};
  if (given !== undefined) {
    for (const h of Object.keys(given)) {
      if (headers.indexOf(h) < 0) throw util.fail(400, 'mapping names a column the file does not have: ' + h, 'invalid_param', { param: 'mapping' });
      const k = String(given[h] || '');
      if (k !== '' && keys.indexOf(k) < 0) throw util.fail(400, 'mapping: ' + k + ' is not a field of ' + t.name + '. Fields: ' + keys.join(', '), 'invalid_param', { param: 'mapping' });
      out[h] = k;
    }
    return out;
  }
  const used = {};
  for (const h of headers) {
    const n = norm(h);
    let hit = '';
    for (const f of t.fields || []) {
      if (used[f.key]) continue;
      const names = [f.key, f.label || ''].concat(f.synonyms || []).map(norm);
      if (names.indexOf(n) >= 0) {
        hit = f.key;
        break;
      }
    }
    out[h] = hit;
    if (hit !== '') used[hit] = true;
  }
  return out;
}

/** A day from the usual spellings ('' when empty; throws when unreadable). */
function dayValue(app, raw) {
  const util = u();
  if (typeof raw === 'number' || /^\d{5}(\.\d+)?$/.test(String(raw).trim())) {
    const n = Number(raw);
    if (n > 20000 && n < 80000) return util.dayAdd('1899-12-30', Math.floor(n));
  }
  const s = String(raw).trim();
  if (s === '') return '';
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) {
    const d = m[1] + '-' + util.pad(Number(m[2])) + '-' + util.pad(Number(m[3]));
    if (util.isDay(d)) return d;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const mdy = L('lib_settings').row(app).getString('date_style') === 'mdy';
    const d = y + '-' + util.pad(Number(mdy ? m[1] : m[2])) + '-' + util.pad(Number(mdy ? m[2] : m[1]));
    if (util.isDay(d)) return d;
  }
  throw new Error('not a date (use YYYY-MM-DD)');
}

function convert(app, type, raw) {
  const util = u();
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (s === '' || s === null || s === undefined) return null;
  if (type === 'number' || type === 'int') {
    const n = typeof s === 'number' ? s : Number(String(s).replace(/,/g, ''));
    if (!Number.isFinite(n)) throw new Error('not a number');
    if (type === 'int' && !Number.isInteger(n)) throw new Error('not a whole number');
    return n;
  }
  if (type === 'money') {
    const t = String(s).replace(/[^\d.,-]/g, '');
    if (L('lib_money').parseScaled(t, 4, true) === null) throw new Error('not an amount');
    return t.replace(/,/g, '');
  }
  if (type === 'percent') {
    const v = L('lib_money').parseScaled(String(s).replace(/%$/, '').trim(), 4, true);
    if (v === null) throw new Error('not a percent');
    return v;
  }
  if (type === 'day') return dayValue(app, s);
  if (type === 'email') {
    const e = String(s).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('not an email address');
    return e;
  }
  if (type === 'url') {
    const t = String(s);
    if (/\s/.test(t)) throw new Error('not a web address');
    return t;
  }
  if (type === 'bool') {
    const t = String(s).toLowerCase();
    if (['true', 'yes', 'y', '1'].indexOf(t) >= 0) return true;
    if (['false', 'no', 'n', '0'].indexOf(t) >= 0) return false;
    throw new Error('not yes or no');
  }
  if (type === 'list')
    return String(s)
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter((x) => x !== '');
  return util.clip(String(s), 4000);
}

/** Rows as field objects: [{ index, row, problems }]. */
function shape(app, t, table, mapping) {
  const fields = {};
  for (const f of t.fields || []) fields[f.key] = f;
  return table.rows.map((cells, i) => {
    const row = {};
    const problems = [];
    table.headers.forEach((h, j) => {
      const k = mapping[h];
      if (!k) return;
      try {
        const v = convert(app, fields[k].type || 'text', cells[j]);
        if (v !== null) row[k] = v;
      } catch (err) {
        problems.push(fields[k].label + ': ' + String((err && err.message) || err));
      }
    });
    for (const f of t.fields || []) if (f.required && (row[f.key] === undefined || row[f.key] === '')) problems.push((f.label || f.key) + ' is empty');
    return { index: i + 1, row: row, problems: problems };
  });
}

function rowFn(t) {
  return L('lib_events').resolve(t.row);
}

/** Run the row function over rows with a handle; answers one result per row. */
function apply(ctx, t, rows, importId, dry) {
  const fn = rowFn(t);
  const out = [];
  for (const r of rows) {
    if (r.problems.length > 0) {
      out.push({ row: r.index, action: 'error', message: r.problems.join('; ') });
      continue;
    }
    try {
      const res = fn(ctx, r.row, { index: r.index, target: t.name, import_id: importId, dry_run: dry }) || {};
      const action = ['created', 'updated', 'skipped'].indexOf(res.action) >= 0 ? res.action : 'skipped';
      out.push({ row: r.index, action: action, id: res.id ? String(res.id) : '', message: res.message ? String(res.message) : '' });
    } catch (err) {
      if (u().statusOf(err) >= 500) console.error('[vo] import row ' + r.index + ' of ' + t.name + ' failed:', err);
      out.push({ row: r.index, action: 'error', message: u().statusOf(err) >= 500 ? 'This row could not be imported.' : String((err && err.message) || err) });
    }
  }
  return out;
}

/** A dry run of rows in a rolled-back transaction. */
function dryRun(ctx, t, rows) {
  const OK = '__vo_import_dry__';
  let results = [];
  if (ctx.app.isTransactional()) throw new Error('import dry run inside a transaction');
  try {
    ctx.app.runInTransaction((tx) => {
      results = apply(Object.assign({}, ctx, { app: tx, dryRun: true }), t, rows, '', true);
      throw new Error(OK);
    });
  } catch (err) {
    if (String((err && err.message) || err).indexOf(OK) < 0) throw err;
  }
  return results;
}

function counts(results) {
  const c = { created: 0, updated: 0, skipped: 0, error: 0 };
  for (const r of results) c[r.action] = (c[r.action] || 0) + 1;
  return c;
}

/** imports.preview: the mapping and what each row (up to 200) would do; nothing changes. */
function preview(ctx, p) {
  const t = targetOf(ctx, p);
  const table = tableOf(ctx, p);
  if (table.rows.length > MAX_TOTAL) throw u().fail(400, 'At most ' + MAX_TOTAL + ' rows in one file.', 'too_many');
  const mapping = mappingOf(p, t, table.headers);
  const mapped = Object.keys(mapping)
    .map((h) => mapping[h])
    .filter((k) => k !== '');
  const missing = (t.fields || []).filter((f) => f.required && mapped.indexOf(f.key) < 0).map((f) => f.key);
  const rows = shape(ctx.app, t, { headers: table.headers, rows: table.rows.slice(0, MAX_ROWS) }, mapping);
  const results = missing.length > 0 ? [] : dryRun(ctx, t, rows);
  ctx.audited = true;
  return {
    target: t.name,
    label: t.label || t.name,
    headers: table.headers,
    mapping: mapping,
    unmapped: table.headers.filter((h) => mapping[h] === ''),
    missing_required: missing,
    fields: (t.fields || []).map(fieldView),
    rows: table.rows.length,
    sample: rows.slice(0, 10).map((r) => ({ row: r.index, values: r.row, problems: r.problems })),
    results: results,
    counts: counts(results),
    checked: rows.length,
  };
}

/** The proposal preview of imports.run: what is imported, how many rows, from which file. */
function previewRun(ctx, p) {
  const t = targetOf(ctx, p);
  const table = tableOf(ctx, p);
  const P = L('lib_proposals');
  const fields = [P.line('Rows', '', table.rows.length, 'int', 'rows'), P.line('File', '', u().str(p, 'file_name', ''), 'text', 'file_name')].filter((f) => f !== null);
  return { label: (t.label || t.name) + ': Import', target: '', fields: fields, notes: [], risk: t.pin === true ? 'high' : 'medium' };
}

function importView(r) {
  const util = u();
  return { id: r.id, target: r.getString('target'), file_name: r.getString('file_name'), status: r.getString('status'), rows: r.getInt('rows'), created_n: r.getInt('created_n'), updated_n: r.getInt('updated_n'), skipped_n: r.getInt('skipped_n'), error_n: r.getInt('error_n'), batches: r.getInt('batches'), problems: util.jsonOf(r, 'problems', []) || [], mapping: util.jsonOf(r, 'mapping', {}) || {}, actor: r.getString('actor'), member: r.getString('member'), created: r.getString('created'), updated: r.getString('updated') };
}

/**
 * imports.run: commit up to 200 rows (one undoable unit). Rows that would
 * fail are found by a dry run first and left out with their reasons; the
 * rest commit together. --import continues an earlier import of the same
 * file (the page sends batches of 200).
 */
function run(ctx, p) {
  const util = u();
  const t = targetOf(ctx, p);
  const table = tableOf(ctx, p);
  if (table.rows.length > MAX_ROWS) throw util.fail(400, 'Send at most ' + MAX_ROWS + ' rows per call; continue the same import with --import <id>.', 'too_many', { max: MAX_ROWS });
  const mapping = mappingOf(p, t, table.headers);
  const mapped = Object.keys(mapping)
    .map((h) => mapping[h])
    .filter((k) => k !== '');
  const missing = (t.fields || []).filter((f) => f.required && mapped.indexOf(f.key) < 0).map((f) => f.key);
  if (missing.length > 0) throw util.fail(400, 'Map a column to: ' + missing.join(', '), 'missing_param', { param: 'mapping', missing: missing });
  const app = ctx.app;
  let imp = null;
  const importId = util.str(p, 'import', '');
  if (importId !== '') {
    imp = util.byId(app, 'imports', importId);
    if (imp === null || imp.getString('target') !== t.name) throw util.fail(404, 'No import ' + importId + ' of ' + t.name + '.', 'not_found', { param: 'import' });
  }
  const rows = shape(app, t, table, mapping);
  // The dispatcher checked the PIN (pinIf); a caller that went around it is refused.
  if (t.pin === true && !ctx.dryRun && ctx.pinChecked !== true) throw util.fail(400, 'Importing ' + (t.label || t.name) + ' needs your approval PIN.', 'missing_param', { param: 'pin' });
  if (ctx.dryRun) {
    // The dispatcher's check before a proposal: already inside a rolled-back transaction.
    const checked = apply(ctx, t, rows, '', true);
    return { import: null, results: checked, counts: counts(checked) };
  }
  const first = dryRun(ctx, t, rows);
  const bad = {};
  for (const r of first) if (r.action === 'error') bad[r.row] = r.message;
  const good = rows.filter((r) => bad[r.index] === undefined);
  let results = [];
  let entry = '';
  let impRec = null;
  app.runInTransaction((tx) => {
    const act = L('lib_activity');
    const tr = act.tracker(tx);
    const c = Object.assign({}, ctx, { app: tr, audited: false, auditInfo: null });
    const committed = apply(c, t, good, imp !== null ? imp.id : '', false);
    const failedNow = committed.filter((r) => r.action === 'error');
    if (failedNow.length > 0) throw util.fail(409, 'Row ' + failedNow[0].row + ' failed while importing (' + failedNow[0].message + '); nothing in this batch was imported. Preview again.', 'import_failed', { row: failedNow[0].row });
    results = committed.concat(first.filter((r) => r.action === 'error')).sort((a, b) => a.row - b.row);
    const n = counts(results);
    const rec = imp !== null ? tx.findRecordById('imports', imp.id) : util.newRecord(tx, 'imports');
    if (imp === null) {
      rec.set('target', t.name);
      rec.set('file_name', util.text(p, 'file_name', 200, ''));
      rec.set('actor', ctx.isAgent ? 'agent' : 'person');
      rec.set('member', ctx.memberId || '');
      rec.set('mapping', mapping);
      rec.set('problems', []);
    }
    rec.set('status', 'done');
    rec.set('rows', rec.getInt('rows') + rows.length);
    rec.set('created_n', rec.getInt('created_n') + n.created);
    rec.set('updated_n', rec.getInt('updated_n') + n.updated);
    rec.set('skipped_n', rec.getInt('skipped_n') + n.skipped);
    rec.set('error_n', rec.getInt('error_n') + n.error);
    rec.set('batches', rec.getInt('batches') + 1);
    const probs = (util.jsonOf(rec, 'problems', []) || []).concat(results.filter((r) => r.action === 'error').map((r) => ({ batch: rec.getInt('batches'), row: r.row, message: r.message })));
    rec.set('problems', probs.slice(0, 2000));
    tx.save(rec);
    impRec = rec;
    const summary = 'Imported ' + (n.created + n.updated) + ' of ' + rows.length + ' rows into ' + (t.label || t.name);
    L('lib_audit').write(L('lib_auth').withApp(ctx, tx), { op: 'imports.run', collection: 'imports', record: rec.id, summary: summary });
    entry = act.record(tx, c, { op: 'imports.run', summary: summary, target_collection: 'imports', target_id: rec.id, steps: tr.steps() });
  });
  ctx.audited = true;
  return { import: importView(app.findRecordById('imports', impRec.id)), results: results, counts: counts(results), _activity: entry };
}

function list(ctx, p) {
  const util = u();
  const target = util.str(p, 'target', '');
  const rows = util.findMany(ctx.app, 'imports', target !== '' ? 'target = {:t}' : '1=1', '-created', util.int(p, 'limit', 30, 1, 200), { t: target });
  const all = targets();
  return { imports: rows.filter((r) => all[r.getString('target')] === undefined || mayImport(ctx, all[r.getString('target')])).map(importView) };
}

module.exports = { MAX_ROWS: MAX_ROWS, targets: targetsOp, preview: preview, previewRun: previewRun, run: run, list: list, pinNeeded: pinNeeded, convert: convert, dayValue: dayValue };
