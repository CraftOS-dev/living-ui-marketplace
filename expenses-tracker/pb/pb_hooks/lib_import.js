/// <reference path="../pb_data/types.d.ts" />
/**
 * Import sessions: every CSV is stored as an `imports` record first (from a
 * local path given by the AI agent, or a file uploaded in the app), previewed
 * with lib_csv.plan(), then imported in one transaction. The mapping chosen
 * at preview (exchange rate included) is remembered, so `import.run
 * --import_id X` imports exactly what was previewed unless an option says
 * otherwise. Undo removes every expense the import added; the session can
 * then be previewed again and re-imported with the new choices.
 */

const COLUMN_KEYS = ['date_column', 'amount_column', 'note_column', 'category_column'];

function filePath(app, imp) {
  return $filepath.join(app.dataDir(), 'storage', imp.baseFilesPath(), imp.getString('file'));
}

function basename(path) {
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] || 'statement.csv';
}

/** The import to work on: an existing one (import_id) or a new one from path / upload. */
function source(app, p, ev) {
  const u = require(`${__hooks}/lib_util.js`);
  const id = u.str(p, 'import_id', '');
  if (id !== '') {
    const imp = u.byId(app, 'imports', id);
    if (imp === null) throw u.fail(404, 'No import with id "' + id + '"; start with import.preview --path <file>');
    return imp;
  }
  let file = null;
  let filename = '';
  const path = u.str(p, 'path', '');
  if (path !== '') {
    try {
      if ($os.stat(path).isDir()) throw new Error('folder');
    } catch {
      throw u.fail(400, 'No file at path "' + path + '". Give the absolute path of the CSV file.');
    }
    file = $filesystem.fileFromPath(path);
    filename = basename(path);
  } else {
    let uploaded = [];
    try {
      uploaded = ev.findUploadedFiles('file');
    } catch {
      uploaded = [];
    }
    if (uploaded.length > 0) {
      file = uploaded[0];
      filename = String(file.originalName || 'statement.csv');
    }
  }
  if (file === null) throw u.fail(400, 'Give path (absolute path of a CSV file), import_id, or upload a file');
  const rec = new Record(app.findCollectionByNameOrId('imports'));
  rec.set('file', file);
  rec.set('filename', filename.slice(0, 255));
  rec.set('status', 'previewed');
  rec.set('rows', 0);
  rec.set('added', 0);
  rec.set('skipped', 0);
  rec.set('mapping', {});
  app.save(rec);
  return rec;
}

function readMapping(imp) {
  const raw = imp.getString('mapping');
  if (raw === '' || raw === 'null') return {};
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

/**
 * Options = the mapping remembered from the last preview, then the params.
 * Choosing another date column drops the remembered date format; another
 * amount column drops the remembered decimal mark and sign rule; another
 * currency drops the remembered exchange rate.
 */
function options(imp, p) {
  const csv = require(`${__hooks}/lib_csv.js`);
  const saved = readMapping(imp);
  const given = csv.optsFromParams(p);
  const o = {};
  if (saved.has_header !== undefined) o.has_header = saved.has_header;
  for (const k of COLUMN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(saved, k)) o[k] = saved[k] === null ? 'none' : String(saved[k]);
  }
  for (const k of ['date_format', 'decimal', 'expenses_are', 'currency', 'rate', 'create_categories', 'skip_duplicates']) {
    if (saved[k] !== undefined && saved[k] !== null) o[k] = saved[k];
  }
  if (given.currency !== undefined && given.currency !== o.currency) delete o.rate;
  if (given.date_column !== undefined && String(given.date_column) !== String(o.date_column)) delete o.date_format;
  if (given.amount_column !== undefined && String(given.amount_column) !== String(o.amount_column)) {
    delete o.decimal;
    delete o.expenses_are;
  }
  if (given.has_header !== undefined && given.has_header !== o.has_header) {
    for (const k of COLUMN_KEYS) delete o[k];
    delete o.date_format;
    delete o.decimal;
    delete o.expenses_are;
  }
  for (const k of Object.keys(given)) o[k] = given[k];
  return o;
}

function savedMapping(pl) {
  const out = { has_header: pl.has_header };
  for (const k of Object.keys(pl.mapping)) out[k] = pl.mapping[k];
  return out;
}

function previewOut(imp, pl, show) {
  return {
    import_id: imp.id,
    filename: imp.getString('filename'),
    status: imp.getString('status'),
    delimiter: pl.delimiter,
    has_header: pl.has_header,
    header: pl.header,
    columns: pl.columns,
    mapping: pl.mapping,
    date_formats: pl.date_formats,
    date_format_ambiguous: pl.date_format_ambiguous,
    counts: pl.counts,
    total: pl.total,
    total_minor: pl.total_minor,
    home_currency: pl.home_currency,
    new_categories: pl.new_categories,
    rows: pl.planned.slice(0, show),
    problems: pl.planned.filter((x) => x.status === 'invalid').slice(0, 20),
  };
}

function run(app, imp, opts) {
  const u = require(`${__hooks}/lib_util.js`);
  const csv = require(`${__hooks}/lib_csv.js`);
  const money = require(`${__hooks}/lib_money.js`);
  if (imp.getString('status') === 'imported') {
    throw u.fail(409, 'This file was already imported (' + imp.getInt('added') + ' added). Undo it first (import.undo) or preview a new file.');
  }
  const pl = csv.plan(app, filePath(app, imp), opts);
  const toAdd = pl.planned.filter((x) => x.status === 'new');
  const mapping = savedMapping(pl);
  let created = 0;
  app.runInTransaction((tx) => {
    const lib = require(`${__hooks}/lib_expenses.js`);
    const util = require(`${__hooks}/lib_util.js`);
    const byName = {};
    let maxSort = 0;
    for (const c of tx.findRecordsByFilter('categories', "id != ''", 'sort', 0, 0)) {
      byName[util.squash(c.getString('name')).toLowerCase()] = c;
      maxSort = Math.max(maxSort, c.getInt('sort'));
    }
    const catCollection = tx.findCollectionByNameOrId('categories');
    for (const item of toAdd) {
      let cat = null;
      if (item.category) {
        const key = util.squash(item.category).toLowerCase();
        cat = byName[key] || null;
        if (cat === null) {
          cat = new Record(catCollection);
          cat.set('name', item.category);
          cat.set('icon', 'tag');
          cat.set('budget', 0);
          maxSort += 1;
          cat.set('sort', maxSort);
          tx.save(cat);
          byName[key] = cat;
        }
      }
      lib.create(tx, {
        amount: item.amount_minor,
        date: item.date,
        note: item.note,
        category: cat,
        source: 'csv',
        import: imp.id,
        original_amount: item.original_amount || 0,
        original_currency: item.original_currency || '',
        fx_rate: item.fx_rate || 0,
      });
      created++;
    }
    const row = tx.findRecordById('imports', imp.id);
    row.set('status', 'imported');
    row.set('rows', pl.counts.rows);
    row.set('added', created);
    row.set('skipped', pl.counts.rows - created);
    row.set('mapping', mapping);
    tx.save(row);
  });
  return {
    import_id: imp.id,
    added: created,
    total: pl.total,
    currency: pl.home_currency,
    counts: pl.counts,
    new_categories: pl.new_categories,
    message:
      'Imported ' +
      created +
      ' expense' +
      (created === 1 ? '' : 's') +
      ' (' +
      money.format(pl.total_minor, pl.home_currency) +
      '). Skipped: ' +
      pl.counts.duplicate +
      ' already added, ' +
      pl.counts.not_expense +
      ' money in, ' +
      pl.counts.empty +
      ' without an amount, ' +
      pl.counts.invalid +
      ' unreadable.',
  };
}

module.exports = {
  filePath: filePath,
  source: source,
  options: options,
  savedMapping: savedMapping,
  previewOut: previewOut,
  run: run,
};
