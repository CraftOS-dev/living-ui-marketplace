/// <reference path="../pb_data/types.d.ts" />
/**
 * Craft Sheets agent operations — shared code for agent_ops.pb.js.
 *
 * The View does all spreadsheet work in the browser: a fetch shim
 * (frontend/src/app/services/apiAdapter.ts) turns its V1 REST calls into plain
 * `sheets` record CRUD, and grid.ts / formula.ts / FindReplace.tsx / fileio.ts do
 * the rest. These operations give an AI agent the same actions on the server by
 * running faithful ports of that code (lib_agent_grid.js, lib_agent_formula.js,
 * lib_agent_csv.js) and storing the record exactly as the View would:
 *   - create      = apiAdapter.ts handleCreateSheet (sid = max+1, position = count,
 *                   12 text columns × 30 rows by default)
 *   - update      = apiAdapter.ts handleUpdateSheet normalisation
 *   - read        = apiAdapter.ts toDict + withValues (formula evaluation)
 * Agents never get anything a person cannot do or see in the app.
 *
 * Conventions: handlers require() their modules inside themselves (isolated
 * VMs); query results are copied with Array.from() before sorting; errors are
 * answered with e.json(status, {status, message}) and never thrown out of a
 * handler; inside runInTransaction only the transaction handle is used.
 */

var DEFAULT_NUM_COLS = 12; // apiAdapter.ts DEFAULT_NUM_COLS
var DEFAULT_NUM_ROWS = 30; // apiAdapter.ts DEFAULT_NUM_ROWS
var MAX_ROWS = 5000; // fileio.ts MAX_ROWS — the app's import limit, applied to every op that grows a sheet
var MAX_COLS = 256; // fileio.ts MAX_COLS
var CHANGE_CAP = 200;
var READ_LIMIT_MAX = 5000;
var NOTE =
  "The person's open tab shows this only after they switch tabs or reload; their next edit from an already-open copy of this sheet overwrites it.";

/* ------------------------------------------------------------------ modules */

function libs() {
  return {
    G: require(`${__hooks}/lib_agent_grid.js`),
    F: require(`${__hooks}/lib_agent_formula.js`),
  };
}

/* ------------------------------------------------------------ request plumbing */

function fail(status, message, data) {
  var err = new Error(message);
  err.status = status;
  if (data !== undefined) err.data = data;
  return err;
}

/** Run an op: params = query + JSON body; answer 200 with its result or the error. */
function handle(e, fn) {
  try {
    var info = e.requestInfo();
    var params = {};
    var query = info.query || {};
    var qk = Object.keys(query);
    for (var i = 0; i < qk.length; i++) params[qk[i]] = query[qk[i]];
    var body = info.body || {};
    var bk = Object.keys(body);
    for (var j = 0; j < bk.length; j++) params[bk[j]] = body[bk[j]];
    var out = fn(params, e.app, e);
    return e.json(200, out === undefined ? { ok: true } : out);
  } catch (err) {
    var status = err && typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) console.error('[craft-sheets] agent op failed:', err);
    var res = { status: status, message: String((err && err.message) || err) };
    if (err && err.data !== undefined) res.data = err.data;
    return e.json(status, res);
  }
}

/* ------------------------------------------------------------------ params */

function scalar(v) {
  return Array.isArray(v) && v.length === 1 ? v[0] : v;
}
function present(p, k) {
  var v = scalar(p[k]);
  return v !== undefined && v !== null;
}
function given(p, k) {
  var v = scalar(p[k]);
  return v !== undefined && v !== null && v !== '';
}
function str(p, k) {
  var v = scalar(p[k]);
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object') throw fail(400, k + ' must be text');
  return String(v);
}
function requiredStr(p, k) {
  var v = str(p, k);
  if (v === undefined || v === '') throw fail(400, k + ' is required');
  return v;
}
function bool(p, k) {
  var v = scalar(p[k]);
  if (v === true || v === false) return v;
  var s = String(v).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  throw fail(400, k + ' must be true or false');
}
function num(p, k) {
  var v = scalar(p[k]);
  var n = typeof v === 'number' ? v : Number(String(v).trim());
  if (String(v).trim() === '' || !isFinite(n)) throw fail(400, k + ' must be a number');
  return n;
}
function int(p, k, dflt, min, max) {
  if (!given(p, k)) return dflt;
  var n = num(p, k);
  if (Math.floor(n) !== n) throw fail(400, k + ' must be a whole number');
  if (n < min || n > max) throw fail(400, k + ' must be between ' + min + ' and ' + max);
  return n;
}
function oneOf(p, k, values, dflt) {
  if (!given(p, k)) return dflt;
  var v = String(scalar(p[k])).toLowerCase();
  if (values.indexOf(v) < 0) throw fail(400, k + ' must be one of: ' + values.join(', '));
  return v;
}
function jsonObj(p, k) {
  var v = scalar(p[k]);
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch (_e) {
      throw fail(400, k + ' must be a JSON object');
    }
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw fail(400, k + ' must be a JSON object');
  return v;
}

/* ------------------------------------------------------- sheet records */

function asObject(v) {
  return v != null && typeof v === 'object' ? v : {};
}

function parseJsonField(rec, field) {
  var s = rec.getString(field);
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (_e) {
    return null;
  }
}

/** apiAdapter.ts toIso. */
function toIso(v) {
  if (v == null || v === '') return null;
  var d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** apiAdapter.ts toDict (the View's Sheet shape) + record id. */
function toSheet(rec) {
  var columns = parseJsonField(rec, 'columns');
  return {
    id: rec.getFloat('sid'),
    recordId: rec.id,
    name: rec.getString('name'),
    columns: Array.isArray(columns) ? columns : [],
    numRows: rec.getFloat('num_rows'),
    cells: asObject(parseJsonField(rec, 'cells')),
    rowHeights: asObject(parseJsonField(rec, 'row_heights')),
    frozenRows: rec.getFloat('frozen_rows') || 0,
    frozenCols: rec.getFloat('frozen_cols') || 0,
    position: rec.getFloat('position') || 0,
    created: toIso(rec.getString('created')),
    updated: toIso(rec.getString('updated')),
  };
}

/** The bytes the View sends: JSON.stringify drops undefined keys. */
function clean(v) {
  return JSON.parse(JSON.stringify(v));
}

function defaultColumns(G, count) {
  var out = [];
  for (var i = 0; i < (count || DEFAULT_NUM_COLS); i++) out.push({ name: G.colLetter(i), type: 'text', width: G.DEFAULT_COL_WIDTH });
  return out;
}

function utf8Length(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += c === 60 || c === 62 || c === 38 ? 6 : 1; // json escapes < > &
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Field limits from 1700000000_init_sheets.js, checked before saving. */
function checkLimits(sheet) {
  if (String(sheet.name).length > 255) throw fail(400, 'A sheet name can have at most 255 characters.');
  if (utf8Length(JSON.stringify(sheet.cells)) > 20000000) throw fail(400, 'The sheet would exceed the 20 MB the app can store for cells.');
  if (utf8Length(JSON.stringify(sheet.columns)) > 2000000) throw fail(400, 'Too many columns to store.');
  if (utf8Length(JSON.stringify(sheet.rowHeights || {})) > 2000000) throw fail(400, 'Too many row heights to store.');
}

/** apiAdapter.ts handleUpdateSheet: the fields a View save writes. */
function writeSheet(G, rec, s) {
  var columns = Array.isArray(s.columns) && s.columns.length ? s.columns : defaultColumns(G);
  var nr = Number(s.numRows);
  var numRows = isFinite(nr) && nr > 0 ? nr : DEFAULT_NUM_ROWS;
  rec.set('name', String(s.name == null ? '' : s.name) || rec.getString('name'));
  rec.set('columns', clean(columns));
  rec.set('num_rows', numRows);
  rec.set('cells', clean(asObject(s.cells)));
  rec.set('row_heights', clean(asObject(s.rowHeights)));
  rec.set('frozen_rows', Number(s.frozenRows == null ? 0 : s.frozenRows) || 0);
  rec.set('frozen_cols', Number(s.frozenCols == null ? 0 : s.frozenCols) || 0);
}

function allSheetRecords(app) {
  return Array.from(app.findAllRecords('sheets'));
}

function sortSheets(rows) {
  return rows.sort(function (a, b) {
    var pa = a.getFloat('position');
    var pb = b.getFloat('position');
    if (pa !== pb) return pa - pb;
    return a.getFloat('sid') - b.getFloat('sid');
  });
}

/** apiAdapter.ts handleCreateSheet. */
function createSheet(G, app, input) {
  var rows = allSheetRecords(app);
  var maxSid = 0;
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i].getFloat('sid');
    if (isFinite(s) && s > maxSid) maxSid = s;
  }
  var columns = Array.isArray(input.columns) && input.columns.length ? input.columns : defaultColumns(G);
  var nr = Number(input.numRows);
  var numRows = isFinite(nr) && nr > 0 ? nr : DEFAULT_NUM_ROWS;
  var rec = new Record(app.findCollectionByNameOrId('sheets'));
  rec.set('sid', maxSid + 1);
  rec.set('name', String(input.name == null ? '' : input.name) || 'Sheet 1');
  rec.set('columns', clean(columns));
  rec.set('num_rows', numRows);
  rec.set('cells', clean(asObject(input.cells)));
  rec.set('row_heights', clean(asObject(input.rowHeights)));
  rec.set('frozen_rows', Number(input.frozenRows == null ? 0 : input.frozenRows) || 0);
  rec.set('frozen_cols', Number(input.frozenCols == null ? 0 : input.frozenCols) || 0);
  rec.set('position', rows.length);
  saveRec(app, rec);
  return rec;
}

function saveRec(app, rec) {
  try {
    app.save(rec);
  } catch (err) {
    throw fail(400, 'The app refused the change: ' + String((err && err.message) || err));
  }
}

function tabListing(rows) {
  var sorted = sortSheets(rows.slice());
  var out = [];
  for (var i = 0; i < sorted.length; i++) out.push(sorted[i].getFloat('sid') + ' "' + sorted[i].getString('name') + '"');
  return out.join(', ');
}

/** The `sheet` param: integer id (sid), record id, or exact tab name. */
function resolveSheet(app, p, key) {
  key = key || 'sheet';
  var v = str(p, key);
  if (v === undefined || v.trim() === '') {
    var all = allSheetRecords(app);
    if (all.length === 1 && key === 'sheet') return all[0];
    if (all.length === 0) throw fail(404, 'The workbook has no sheets yet; create one with sheets.create.');
    throw fail(400, key + ' is required (id or exact tab name). Tabs: ' + tabListing(all));
  }
  if (/^\d+$/.test(v)) {
    try {
      return app.findFirstRecordByFilter('sheets', 'sid = {:sid}', { sid: Number(v) });
    } catch (_e) {
      /* not an id: maybe a name */
    }
  }
  if (/^[a-z0-9]{15}$/.test(v)) {
    try {
      return app.findRecordById('sheets', v);
    } catch (_e) {
      /* not a record id */
    }
  }
  var named = Array.from(app.findRecordsByFilter('sheets', 'name = {:n}', '', 0, 0, { n: v }));
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    var ids = [];
    for (var i = 0; i < named.length; i++) ids.push(named[i].getFloat('sid'));
    throw fail(409, 'Several tabs are named "' + v + '"; pass the id instead: ' + ids.join(', '), { candidates: ids });
  }
  throw fail(404, 'No sheet with id or name "' + v + '". Tabs: ' + tabListing(allSheetRecords(app)));
}

/** Optional `if_updated` guard: refuse when the sheet changed since the agent read it. */
function guardUpdated(rec, p) {
  if (!given(p, 'if_updated')) return;
  var want = toIso(str(p, 'if_updated'));
  if (want === null) throw fail(400, 'if_updated must be the "updated" value from an earlier read');
  var cur = toIso(rec.getString('updated'));
  if (cur !== want) {
    throw fail(409, 'The sheet changed since you read it (now updated ' + cur + '). Read it again, then retry.', { updated: cur });
  }
}

/* ----------------------------------------------------- evaluation + views */

/** apiAdapter.ts withValues: values/errors as the View receives them (via JSON, so -0 is 0). */
function evaluate(L, sheet) {
  var ev = L.F.evaluateSheet(sheet.columns, Number(sheet.numRows), sheet.cells);
  var keys = Object.keys(ev.values);
  for (var i = 0; i < keys.length; i++) if (ev.values[keys[i]] === 0) ev.values[keys[i]] = 0;
  sheet.values = ev.values;
  sheet.errors = ev.errors;
  return sheet;
}

function sheetRef(s) {
  return { id: s.id, record_id: s.recordId, name: s.name, updated: s.updated };
}

function columnsView(G, sheet) {
  var out = [];
  for (var i = 0; i < sheet.columns.length; i++) {
    var c = sheet.columns[i] || {};
    out.push({ letter: G.colLetter(i), name: c.name, type: c.type, width: c.width });
  }
  return out;
}

/** What one cell shows: raw text, value or error, display text, format. */
function cellView(G, sheet, ref) {
  var cell = sheet.cells[ref];
  var out = { ref: ref, raw: cell && cell.raw != null ? cell.raw : '' };
  if (sheet.errors[ref]) out.error = sheet.errors[ref];
  else if (sheet.values[ref] !== undefined) out.value = sheet.values[ref];
  out.shown = G.displayCell(sheet, ref).text;
  if (cell && cell.format && Object.keys(cell.format).length) out.format = cell.format;
  return out;
}

function sameCell(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

/** Before/after for the given refs (only those that changed), capped. */
function changes(G, before, after, refs, withFormat) {
  var seen = {};
  var list = [];
  var count = 0;
  for (var i = 0; i < refs.length; i++) {
    var ref = refs[i];
    if (seen[ref]) continue;
    seen[ref] = true;
    var b = before.cells[ref];
    var a = after.cells[ref];
    if (sameCell(b === undefined ? undefined : clean(b), a)) continue;
    count++;
    if (list.length >= CHANGE_CAP) continue;
    var v = cellView(G, after, ref);
    var item = { ref: ref, before: b && b.raw != null ? b.raw : null, after: a && a.raw != null ? a.raw : null };
    if (v.error) item.error = v.error;
    else if (v.value !== undefined) item.value = v.value;
    item.shown = v.shown;
    if (withFormat) {
      item.before_format = (b && b.format) || null;
      item.after_format = (a && a.format) || null;
    }
    list.push(item);
  }
  return { changed: list, changed_count: count, truncated: count > list.length };
}

/* ----------------------------------------------------------- ranges */

var PART_RE = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/;

function gridSize(G, sheet) {
  return 'columns A-' + G.colLetter(Math.max(sheet.columns.length - 1, 0)) + ', rows 1-' + sheet.numRows;
}

function checkRef(G, sheet, col, row, text) {
  if (row < 0 || col < 0 || col >= sheet.columns.length || row >= sheet.numRows) {
    throw fail(
      400,
      text + ' is outside the grid (' + gridSize(G, sheet) + '). Add rows or columns first (rows.add, columns.add), or use cells.paste, which grows the grid.',
    );
  }
}

/**
 * A range param: "A1", "A1:C5", or a comma list of those (a selection plus
 * Ctrl-clicked cells). Returns { parts: [rect], refs() } — rects are 0-based
 * {minCol,maxCol,minRow,maxRow}; refs() lists them row-major, deduplicated.
 */
function parseRange(G, sheet, text, name, single) {
  if (text === undefined || String(text).trim() === '') throw fail(400, name + ' is required, e.g. A1 or A1:C5');
  var raw = String(text);
  if (raw.indexOf('$') >= 0) throw fail(400, name + ': write plain references like B3 (no $).');
  var bits = raw.split(',');
  if (single && bits.length > 1) throw fail(400, name + ' must be one cell or one rectangle, e.g. A1:C5');
  var parts = [];
  for (var i = 0; i < bits.length; i++) {
    var t = bits[i].trim();
    var m = PART_RE.exec(t);
    if (!m) throw fail(400, name + ': "' + t + '" is not a cell like B3 or a range like A1:C5');
    var a = G.parseRef(m[1] + m[2]);
    var b = m[3] ? G.parseRef(m[3] + m[4]) : a;
    checkRef(G, sheet, a.col, a.row, (m[1] + m[2]).toUpperCase());
    checkRef(G, sheet, b.col, b.row, m[3] ? (m[3] + m[4]).toUpperCase() : (m[1] + m[2]).toUpperCase());
    parts.push({
      minCol: Math.min(a.col, b.col),
      maxCol: Math.max(a.col, b.col),
      minRow: Math.min(a.row, b.row),
      maxRow: Math.max(a.row, b.row),
    });
  }
  return {
    parts: parts,
    refs: function () {
      var seen = {};
      var out = [];
      for (var j = 0; j < parts.length; j++) {
        var r = parts[j];
        var list = G.getSelectionRefs(G.makeRef(r.minCol, r.minRow), G.makeRef(r.maxCol, r.maxRow));
        for (var k = 0; k < list.length; k++) {
          if (seen[list[k]]) continue;
          seen[list[k]] = true;
          out.push(list[k]);
        }
      }
      return out;
    },
  };
}

function rectText(G, r) {
  var a = G.makeRef(r.minCol, r.minRow);
  var b = G.makeRef(r.maxCol, r.maxRow);
  return a === b ? a : a + ':' + b;
}

function inRect(r, col, row) {
  return col >= r.minCol && col <= r.maxCol && row >= r.minRow && row <= r.maxRow;
}

/** Bounding box of every stored cell inside the grid (format-only cells too). */
function usedRect(G, sheet) {
  var keys = Object.keys(sheet.cells);
  var r = null;
  for (var i = 0; i < keys.length; i++) {
    var pos = G.parseRef(keys[i]);
    if (!pos || pos.col >= sheet.columns.length || pos.row >= sheet.numRows || pos.row < 0) continue;
    if (!r) r = { minCol: pos.col, maxCol: pos.col, minRow: pos.row, maxRow: pos.row };
    else {
      r.minCol = Math.min(r.minCol, pos.col);
      r.maxCol = Math.max(r.maxCol, pos.col);
      r.minRow = Math.min(r.minRow, pos.row);
      r.maxRow = Math.max(r.maxRow, pos.row);
    }
  }
  return r;
}

/** Row-major order (row, then column); positions parsed once. */
function sortRefs(G, refs) {
  var dec = [];
  for (var i = 0; i < refs.length; i++) {
    var p = G.parseRef(refs[i]);
    dec.push({ ref: refs[i], row: p.row, col: p.col, i: i });
  }
  dec.sort(function (a, b) {
    return a.row - b.row || a.col - b.col || a.i - b.i;
  });
  for (var j = 0; j < dec.length; j++) refs[j] = dec[j].ref;
  return refs;
}

function checkGrowth(sheet, newRows, newCols) {
  if (newRows > sheet.numRows && newRows > MAX_ROWS) {
    throw fail(400, 'That would make the sheet ' + newRows + ' rows long; the app allows at most ' + MAX_ROWS + ' rows (its import limit).');
  }
  if (newCols > sheet.columns.length && newCols > MAX_COLS) {
    throw fail(400, 'That would make the sheet ' + newCols + ' columns wide; the app allows at most ' + MAX_COLS + ' columns (its import limit).');
  }
}

function colParam(G, sheet, p, k) {
  var v = requiredStr(p, k).trim();
  if (!/^[A-Za-z]+$/.test(v)) throw fail(400, k + ' must be a column letter such as C');
  var idx = G.letterToIndex(v);
  if (idx >= sheet.columns.length) throw fail(400, 'Column ' + v.toUpperCase() + ' is outside the grid (' + gridSize(G, sheet) + ').');
  return idx;
}

function rowParam(sheet, p, k) {
  if (!given(p, k)) throw fail(400, k + ' is required (a row number, 1 = first row)');
  var n = num(p, k);
  if (Math.floor(n) !== n || n < 1 || n > sheet.numRows) throw fail(400, k + ' must be a row number from 1 to ' + sheet.numRows);
  return n;
}

/* --------------------------------------------------------- write pipeline */

/**
 * Load the sheet named by `p[opts.key || 'sheet']`, apply fn (a port of the View's
 * mutation; it returns { sheet, extra } or { unchanged: true, extra }), save it
 * the way a View save does, then evaluate what is stored now.
 */
function mutate(app, p, fn, opts) {
  opts = opts || {};
  var L = libs();
  var state = null;
  var caught = null;
  app.runInTransaction(function (tx) {
    try {
      var rec = resolveSheet(tx, p, opts.key || 'sheet');
      guardUpdated(rec, p);
      var before = toSheet(rec);
      var r = fn(before, L, tx) || {};
      if (r.unchanged) {
        state = { rec: rec, before: before, extra: r.extra, unchanged: true };
        return;
      }
      checkLimits(r.sheet);
      writeSheet(L.G, rec, r.sheet);
      saveRec(tx, rec);
      state = { rec: rec, before: before, extra: r.extra, unchanged: false };
    } catch (err) {
      caught = err;
    }
  });
  if (caught) throw caught;
  var after = evaluate(L, toSheet(state.rec));
  var before2 = state.before;
  return { L: L, G: L.G, before: before2, after: after, extra: state.extra || {}, unchanged: state.unchanged };
}

function withNote(out) {
  out.note = NOTE;
  return out;
}

/* ===================================================================== ops */

/* --------------------------------------------------------------- app.guide */

var GUIDE = [
  'Craft Sheets: a small spreadsheet. The workbook is a list of sheets (tabs along the bottom, in the order sheets.list gives).',
  'Sheets: each has an integer id, a name (names may repeat; then use the id), ordered columns (header name, type text|number|date|currency, width px >= 64) and a row count. A new sheet is 12 text columns (A-L) x 30 rows. Column letters follow position (A, B, ... Z, AA). A column name is only its header label.',
  'Cells: keyed by references like B3 (rows count from 1). Each cell stores the raw text exactly as typed; text starting with = is a formula. Formatting per cell: bold, italic, underline, align left|center|right, fill colour and font colour (#rrggbb).',
  'Values: the app computes formulas itself; cells.read returns raw, value (number, text or true/false) or error, and shown (the text in the grid, formatted by the column type: number and currency right-aligned, currency in USD; shown uses en-US formatting, the person sees their own locale).',
  'Formulas: references A1 and ranges A1:B5 (no $ and no other sheets); + - * / ^ (^ binds tighter than a leading minus, so =-2^2 is -4); & joins text; = <> < <= > >= compare; "text" with \\" escapes; TRUE/FALSE. Functions: SUM, AVERAGE (AVG), MIN, MAX, COUNT, COUNTA, PRODUCT, MEDIAN, ROUND, ABS, SQRT, POWER, MOD, LEN, CONCAT (CONCATENATE), IF, AND, OR, NOT. Anything else gives #NAME?.',
  'Errors: #DIV/0! (division by zero), #CIRC! (circular reference), #NAME? (unknown name), #VALUE! (text in arithmetic, wrong number of arguments, a range used as one value), #REF! (bad or deleted reference), #NUM! (impossible number), #ERROR! (cannot be parsed).',
  'Differences from Excel to keep in mind: MOD takes the sign of the divisor; ROUND rounds halves up (ROUND(-2.5) is -2); MIN/MAX of nothing is 0; IF without an else gives FALSE; text compares case-sensitively; numbers do not accept 1e3 inside formulas.',
  'Rows and columns: inserting shifts the cells and rewrites references in formulas; deleting a row or column turns references to it into #REF!. A sheet keeps at least 1 row and 1 column. Growth stops at 5,000 rows x 256 columns (the import limit).',
  'Recipes: see a table -> cells.read --view grid; type into cells -> cells.set; fill in a block of rows -> cells.paste with tab-separated text; add a total -> cells.set --ref {cell} --raw "=SUM(B2:B9)"; bring in data -> sheets.import-csv; give back a file -> sheets.export-csv.',
  'Undo: you have no undo. Every write returns what it changed (before and after), so you can put it back with another operation.',
  "The person's screen: a tab they already have open does not refresh by itself. Ask them to switch to another tab and back (or reload) to see your changes, and not to edit the same sheet while you work: their next edit (or their Undo) re-saves their older copy and silently replaces yours. Use if_updated to make a write refuse when the sheet changed since you read it.",
].join('\n');

function guide() {
  return { text: GUIDE };
}

/* ------------------------------------------------------------- sheets.* */

function summaryOf(rec) {
  var cols = parseJsonField(rec, 'columns');
  return {
    id: rec.getFloat('sid'),
    record_id: rec.id,
    name: rec.getString('name'),
    position: rec.getFloat('position') || 0,
    columns: Array.isArray(cols) ? cols.length : 0,
    rows: rec.getFloat('num_rows'),
    updated: toIso(rec.getString('updated')),
  };
}

/** apiAdapter.ts handleListSheets + toSummary. */
function sheetsList(app) {
  var rows = sortSheets(allSheetRecords(app));
  var out = [];
  for (var i = 0; i < rows.length; i++) out.push(summaryOf(rows[i]));
  return { sheets: out };
}

/** apiAdapter.ts toDict / withValues, shown as structure. */
function sheetsGet(app, p) {
  var L = libs();
  var G = L.G;
  var s = evaluate(L, toSheet(resolveSheet(app, p)));
  var rowHeights = {};
  var hk = Object.keys(s.rowHeights);
  for (var i = 0; i < hk.length; i++) rowHeights[String(Number(hk[i]) + 1)] = s.rowHeights[hk[i]];
  var keys = Object.keys(s.cells);
  var formulas = 0;
  for (var j = 0; j < keys.length; j++) {
    var c = s.cells[keys[j]];
    if (c && typeof c.raw === 'string' && c.raw.charAt(0) === '=') formulas++;
  }
  var used = usedRect(G, s);
  var ref = sheetRef(s);
  ref.position = s.position;
  ref.created = s.created;
  return {
    sheet: ref,
    columns: columnsView(G, s),
    rows: s.numRows,
    frozen_rows: s.frozenRows,
    frozen_cols: s.frozenCols,
    row_heights: rowHeights,
    used_range: used ? rectText(G, used) : null,
    cell_count: keys.length,
    formula_count: formulas,
    error_count: Object.keys(s.errors).length,
  };
}

/** MainView.tsx addSheet -> apiAdapter.ts handleCreateSheet. */
function sheetsCreate(app, p) {
  var L = libs();
  var name = given(p, 'name') ? str(p, 'name').trim() : '';
  if (name.length > 255) throw fail(400, 'A sheet name can have at most 255 characters.');
  var rec = null;
  var caught = null;
  app.runInTransaction(function (tx) {
    try {
      var count = allSheetRecords(tx).length;
      rec = createSheet(L.G, tx, { name: name || 'Sheet ' + (count + 1) });
    } catch (err) {
      caught = err;
    }
  });
  if (caught) throw caught;
  var s = toSheet(rec);
  var ref = sheetRef(s);
  ref.position = s.position;
  return withNote({ sheet: ref, columns: s.columns.length, rows: s.numRows });
}

/** SheetTabs.tsx commitRename -> MainView.tsx renameSheet. */
function sheetsRename(app, p) {
  var name = requiredStr(p, 'name').trim();
  if (name === '') throw fail(400, 'name must not be empty');
  if (name.length > 255) throw fail(400, 'A sheet name can have at most 255 characters.');
  var r = mutate(app, p, function (s, L) {
    var next = L.G.assign(s);
    next.name = name;
    return { sheet: next };
  });
  return withNote({ sheet: sheetRef(r.after), before: r.before.name });
}

/** MainView.tsx doDeleteSheet (after the confirm dialog). */
function sheetsDelete(app, p) {
  var L = libs();
  var deleted = null;
  var created = null;
  var caught = null;
  app.runInTransaction(function (tx) {
    var rec;
    try {
      rec = resolveSheet(tx, p);
      guardUpdated(rec, p);
    } catch (err) {
      caught = err;
      return;
    }
    var s = toSheet(rec);
    deleted = { id: s.id, record_id: s.recordId, name: s.name, cell_count: Object.keys(s.cells).length };
    tx.delete(rec);
    // The View never leaves the workbook empty: deleting the last tab opens a fresh "Sheet 1".
    if (allSheetRecords(tx).length === 0) created = createSheet(L.G, tx, { name: 'Sheet 1' });
  });
  if (caught) throw caught;
  return withNote({ deleted: deleted, created: created ? sheetRef(toSheet(created)) : null });
}

/** Toolbar freeze toggles -> grid.ts setFreezePanes. */
function sheetsFreeze(app, p) {
  if (!given(p, 'first_row') && !given(p, 'first_column')) throw fail(400, 'Pass first_row and/or first_column (true or false).');
  var fr = given(p, 'first_row') ? (bool(p, 'first_row') ? 1 : 0) : null;
  var fc = given(p, 'first_column') ? (bool(p, 'first_column') ? 1 : 0) : null;
  var r = mutate(app, p, function (s, L) {
    return { sheet: L.G.setFreezePanes(s, fr === null ? s.frozenRows : fr, fc === null ? s.frozenCols : fc) };
  });
  return withNote({ sheet: sheetRef(r.after), frozen_rows: r.after.frozenRows, frozen_cols: r.after.frozenCols });
}

/** Import (.csv) -> fileio.ts importWorkbook/worksheetToSheetInput -> handleCreateSheet. */
function sheetsImportCsv(app, p) {
  var L = libs();
  var C = require(`${__hooks}/lib_agent_csv.js`);
  if (!present(p, 'csv')) throw fail(400, 'csv is required (the file text)');
  var text = str(p, 'csv');
  var name = given(p, 'name') ? str(p, 'name') : '';
  if (name === '') name = 'Imported';
  if (name.length > 255) throw fail(400, 'A sheet name can have at most 255 characters.');
  var parsed = C.importCsv(text);
  if (parsed.refused) throw fail(400, parsed.refused);
  checkLimits({ name: name, cells: parsed.cells, columns: parsed.columns, rowHeights: {} });
  var rec = null;
  var caught = null;
  app.runInTransaction(function (tx) {
    try {
      rec = createSheet(L.G, tx, { name: name, columns: parsed.columns, numRows: parsed.numRows, cells: parsed.cells });
    } catch (err) {
      caught = err;
    }
  });
  if (caught) throw caught;
  var s = toSheet(rec);
  var ref = sheetRef(s);
  ref.position = s.position;
  return withNote({ sheet: ref, columns: s.columns.length, rows: s.numRows, cells: parsed.cellCount, truncated: parsed.truncated });
}

/** CSV button -> fileio.ts exportSheet(sheet, 'csv'). */
function sheetsExportCsv(app, p) {
  var L = libs();
  var C = require(`${__hooks}/lib_agent_csv.js`);
  var s = evaluate(L, toSheet(resolveSheet(app, p)));
  return {
    sheet: sheetRef(s),
    filename: C.exportFileName(s.name),
    content: C.exportCsv(s, s.values),
    rows: Math.max(s.numRows, 1),
    columns: Math.max(s.columns.length, 1),
  };
}

/* -------------------------------------------------------------- cells.* */

/** What the grid shows (Grid.tsx cells, FormulaBar raw) for a range. */
function cellsRead(app, p) {
  var L = libs();
  var G = L.G;
  var s = evaluate(L, toSheet(resolveSheet(app, p)));
  var view = oneOf(p, 'view', ['cells', 'grid'], 'cells');
  var parts;
  if (given(p, 'range')) parts = parseRange(G, s, str(p, 'range'), 'range', view === 'grid').parts;
  else {
    var used = usedRect(G, s);
    if (!used) {
      return { sheet: sheetRef(s), range: null, columns: columnsView(G, s), cells: [], total: 0, truncated: false };
    }
    parts = [used];
  }
  var cols = [];
  if (view === 'grid') {
    var r = parts[0];
    var size = (r.maxCol - r.minCol + 1) * (r.maxRow - r.minRow + 1);
    if (size > READ_LIMIT_MAX) throw fail(400, 'The grid view returns at most ' + READ_LIMIT_MAX + ' cells; narrow the range (this one has ' + size + ').');
    for (var c = r.minCol; c <= r.maxCol; c++) {
      var col = s.columns[c] || {};
      cols.push({ letter: G.colLetter(c), name: col.name, type: col.type });
    }
    var shown = [];
    var formulas = {};
    var errors = {};
    var formats = {};
    for (var row = r.minRow; row <= r.maxRow; row++) {
      var line = [];
      for (var cc = r.minCol; cc <= r.maxCol; cc++) {
        var ref = G.makeRef(cc, row);
        line.push(G.displayCell(s, ref).text);
        var cell = s.cells[ref];
        if (cell && typeof cell.raw === 'string' && cell.raw.charAt(0) === '=') formulas[ref] = cell.raw;
        if (s.errors[ref]) errors[ref] = s.errors[ref];
        if (cell && cell.format && Object.keys(cell.format).length) formats[ref] = cell.format;
      }
      shown.push(line);
    }
    return { sheet: sheetRef(s), range: rectText(G, r), columns: cols, shown: shown, formulas: formulas, errors: errors, formats: formats };
  }
  var limit = int(p, 'limit', 500, 1, READ_LIMIT_MAX);
  var offset = int(p, 'offset', 0, 0, 100000000);
  var keys = Object.keys(s.cells);
  var hits = [];
  for (var i = 0; i < keys.length; i++) {
    var pos = G.parseRef(keys[i]);
    if (!pos) continue;
    for (var j = 0; j < parts.length; j++) {
      if (inRect(parts[j], pos.col, pos.row)) {
        hits.push(keys[i]);
        break;
      }
    }
  }
  sortRefs(G, hits);
  var page = hits.slice(offset, offset + limit);
  var list = [];
  for (var k = 0; k < page.length; k++) list.push(cellView(G, s, page[k]));
  var rangeText = [];
  for (var m = 0; m < parts.length; m++) rangeText.push(rectText(G, parts[m]));
  for (var cx = 0; cx < s.columns.length; cx++) {
    var cl = s.columns[cx] || {};
    cols.push({ letter: G.colLetter(cx), name: cl.name, type: cl.type });
  }
  return {
    sheet: sheetRef(s),
    range: rangeText.join(','),
    columns: cols,
    cells: list,
    total: hits.length,
    offset: offset,
    truncated: offset + list.length < hits.length,
  };
}

/** FindReplace.tsx matches (Find, Find Next). */
function cellsFind(app, p) {
  var L = libs();
  var G = L.G;
  var query = requiredStr(p, 'query');
  var matchCase = given(p, 'match_case') ? bool(p, 'match_case') : false;
  var s = evaluate(L, toSheet(resolveSheet(app, p)));
  var refs = G.findMatches(s, query, matchCase);
  var list = [];
  for (var i = 0; i < refs.length && i < 500; i++) {
    list.push({ ref: refs[i], raw: s.cells[refs[i]].raw, shown: G.displayCell(s, refs[i]).text });
  }
  return { sheet: sheetRef(s), query: query, match_case: matchCase, count: refs.length, matches: list, truncated: refs.length > list.length };
}

/** The `<input>` value sanitiser in Grid.tsx / FormulaBar.tsx strips line breaks. */
function typed(v, k) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') throw fail(400, 'The value for ' + k + ' must be text, a number or true/false');
  return String(v).replace(/[\r\n]/g, '');
}

/** Typing into a cell or the formula bar -> MainView.tsx commitCell -> grid.ts setCellRaw. */
function cellsSet(app, p) {
  var entries = [];
  if (present(p, 'cells')) {
    if (present(p, 'ref')) throw fail(400, 'Pass either ref + raw, or cells, not both.');
    var obj = jsonObj(p, 'cells');
    var ks = Object.keys(obj);
    if (!ks.length) throw fail(400, 'cells is empty');
    for (var i = 0; i < ks.length; i++) entries.push({ text: ks[i], raw: typed(obj[ks[i]], ks[i]) });
  } else {
    var ref = requiredStr(p, 'ref');
    if (!present(p, 'raw')) throw fail(400, 'raw is required (what to type; an empty value clears the cell)');
    entries.push({ text: ref, raw: typed(scalar(p.raw), 'raw') });
  }
  var r = mutate(app, p, function (s, L) {
    var G = L.G;
    var list = [];
    for (var j = 0; j < entries.length; j++) {
      var m = /^([A-Za-z]+)(\d+)$/.exec(String(entries[j].text).trim());
      if (!m) throw fail(400, '"' + entries[j].text + '" is not a cell reference like B3');
      var pos = G.parseRef(m[1] + m[2]);
      var up = G.makeRef(pos.col, pos.row);
      checkRef(G, s, pos.col, pos.row, up);
      list.push({ ref: up, raw: entries[j].raw });
    }
    var cells = G.assign(s.cells);
    for (var k = 0; k < list.length; k++) G.setCellRawInPlace(cells, list[k].ref, list[k].raw);
    var next = G.assign(s);
    next.cells = cells;
    var refs = [];
    for (var q = 0; q < list.length; q++) refs.push(list[q].ref);
    return { sheet: next, extra: { refs: refs } };
  });
  var ch = changes(r.G, r.before, r.after, r.extra.refs, false);
  return withNote({ sheet: sheetRef(r.after), changed: ch.changed, changed_count: ch.changed_count, truncated: ch.truncated });
}

/** Pasting text (Grid.tsx handlePaste) -> MainView.tsx handlePaste -> grid.ts pasteRange. */
function cellsPaste(app, p) {
  if (!present(p, 'text') || str(p, 'text') === '') throw fail(400, 'text is required: rows separated by line breaks, cells by tabs');
  var text = str(p, 'text');
  var rows2d = text.split(/\r?\n/).map(function (row) {
    return row.split('\t');
  });
  while (rows2d.length > 0 && rows2d[rows2d.length - 1].every(function (v) {
    return v === '';
  })) rows2d.pop();
  if (rows2d.length === 0) throw fail(400, 'Nothing to paste: every row is empty.');
  var startText = requiredStr(p, 'start');
  var r = mutate(app, p, function (s, L) {
    var G = L.G;
    var m = /^([A-Za-z]+)(\d+)$/.exec(startText.trim());
    if (!m) throw fail(400, 'start must be one cell like B3');
    var pos = G.parseRef(m[1] + m[2]);
    var start = G.makeRef(pos.col, pos.row);
    checkRef(G, s, pos.col, pos.row, start);
    var width = 0;
    for (var i = 0; i < rows2d.length; i++) width = Math.max(width, rows2d[i].length);
    checkGrowth(s, pos.row + rows2d.length, pos.col + width);
    var next = G.pasteRange(s, start, rows2d);
    var refs = [];
    for (var rr = 0; rr < rows2d.length; rr++) for (var cc = 0; cc < rows2d[rr].length; cc++) refs.push(G.makeRef(pos.col + cc, pos.row + rr));
    var rect = { minCol: pos.col, maxCol: pos.col + width - 1, minRow: pos.row, maxRow: pos.row + rows2d.length - 1 };
    return { sheet: next, extra: { refs: refs, rect: rect } };
  });
  var ch = changes(r.G, r.before, r.after, r.extra.refs, false);
  return withNote({
    sheet: sheetRef(r.after),
    range_written: rectText(r.G, r.extra.rect),
    grew: { rows: r.after.numRows - r.before.numRows, columns: r.after.columns.length - r.before.columns.length },
    changed: ch.changed,
    changed_count: ch.changed_count,
    truncated: ch.truncated,
  });
}

/** Delete / Backspace over a selection -> MainView.tsx handleClearSelection. */
function cellsClear(app, p) {
  var r = mutate(app, p, function (s, L) {
    var G = L.G;
    var refs = parseRange(G, s, str(p, 'range'), 'range', false).refs();
    var cells = G.assign(s.cells);
    for (var i = 0; i < refs.length; i++) G.setCellRawInPlace(cells, refs[i], '');
    var next = G.assign(s);
    next.cells = cells;
    return { sheet: next, extra: { refs: refs } };
  });
  var ch = changes(r.G, r.before, r.after, r.extra.refs, false);
  var list = [];
  for (var i = 0; i < ch.changed.length; i++) list.push({ ref: ch.changed[i].ref, before: ch.changed[i].before });
  return withNote({ sheet: sheetRef(r.after), changed: list, changed_count: ch.changed_count, truncated: ch.truncated });
}

var HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Toolbar bold/italic/underline/align/fill/font colour -> grid.ts setRangeFormat. */
function cellsFormat(app, p) {
  var patch = {};
  var any = false;
  if (given(p, 'bold')) {
    patch.bold = bool(p, 'bold') || undefined;
    any = true;
  }
  if (given(p, 'italic')) {
    patch.italic = bool(p, 'italic') || undefined;
    any = true;
  }
  if (given(p, 'underline')) {
    patch.underline = bool(p, 'underline') || undefined;
    any = true;
  }
  if (given(p, 'align')) {
    patch.align = oneOf(p, 'align', ['left', 'center', 'right'], null);
    any = true;
  }
  if (given(p, 'fill')) {
    var f = str(p, 'fill').trim();
    if (f.toLowerCase() === 'none') patch.bg = null;
    else if (HEX_RE.test(f)) patch.bg = f.toLowerCase();
    else throw fail(400, 'fill must be a colour like #fff2cc, or none');
    any = true;
  }
  if (given(p, 'font_color')) {
    var fc = str(p, 'font_color').trim();
    if (fc.toLowerCase() === 'none') patch.color = undefined;
    else if (HEX_RE.test(fc)) patch.color = fc.toLowerCase();
    else throw fail(400, 'font_color must be a colour like #990000, or none');
    any = true;
  }
  if (!any) throw fail(400, 'Pass at least one of bold, italic, underline, align, fill, font_color.');
  var r = mutate(app, p, function (s, L) {
    var G = L.G;
    var refs = parseRange(G, s, str(p, 'range'), 'range', false).refs();
    var cells = G.assign(s.cells);
    for (var i = 0; i < refs.length; i++) G.setCellFormatInPlace(cells, refs[i], patch);
    var next = G.assign(s);
    next.cells = cells;
    return { sheet: next, extra: { refs: refs } };
  });
  var ch = changes(r.G, r.before, r.after, r.extra.refs, true);
  var list = [];
  for (var i = 0; i < ch.changed.length; i++) {
    list.push({ ref: ch.changed[i].ref, before_format: ch.changed[i].before_format, after_format: ch.changed[i].after_format });
  }
  return withNote({ sheet: sheetRef(r.after), changed: list, changed_count: ch.changed_count, truncated: ch.truncated });
}

/** Fill handle drag (Grid.tsx handleFillHover) -> grid.ts autofill. */
function cellsFill(app, p) {
  var r = mutate(app, p, function (s, L) {
    var G = L.G;
    var source = parseRange(G, s, str(p, 'source'), 'source', true).parts[0];
    var to = parseRange(G, s, str(p, 'to'), 'to', true).parts[0];
    if (to.minCol !== to.maxCol || to.minRow !== to.maxRow) throw fail(400, 'to must be one cell: where the drag ends');
    var dRight = to.minCol - source.maxCol;
    var dDown = to.minRow - source.maxRow;
    var target;
    if (dDown > 0 && dDown >= dRight) {
      target = { minCol: source.minCol, maxCol: source.maxCol, minRow: source.minRow, maxRow: to.minRow };
    } else if (dRight > 0) {
      target = { minCol: source.minCol, maxCol: to.minCol, minRow: source.minRow, maxRow: source.maxRow };
    } else {
      throw fail(400, 'to must be below or to the right of the source (the fill handle only drags down or right).');
    }
    var next = G.autofill(s, source, target);
    var refs = [];
    for (var row = target.minRow; row <= target.maxRow; row++) {
      for (var c = target.minCol; c <= target.maxCol; c++) if (!inRect(source, c, row)) refs.push(G.makeRef(c, row));
    }
    return { sheet: next, extra: { refs: refs, target: target } };
  });
  var ch = changes(r.G, r.before, r.after, r.extra.refs, false);
  return withNote({ sheet: sheetRef(r.after), filled: rectText(r.G, r.extra.target), changed: ch.changed, changed_count: ch.changed_count, truncated: ch.truncated });
}

/** Ctrl+C (Grid.tsx handleCopy) then Ctrl+V of the app's own clipboard -> grid.ts pasteRangeFull. */
function cellsCopy(app, p) {
  var targetKey = given(p, 'to_sheet') ? 'to_sheet' : 'sheet';
  var r = mutate(
    app,
    p,
    function (t, L, tx) {
      var G = L.G;
      var src = targetKey === 'sheet' ? t : toSheet(resolveSheet(tx, p, 'sheet'));
      var from = parseRange(G, src, str(p, 'from'), 'from', true).parts[0];
      var toText = requiredStr(p, 'to').trim();
      var m = /^([A-Za-z]+)(\d+)$/.exec(toText);
      if (!m) throw fail(400, 'to must be one cell like D1 (the top-left of where to paste)');
      var pos = G.parseRef(m[1] + m[2]);
      var start = G.makeRef(pos.col, pos.row);
      checkRef(G, t, pos.col, pos.row, start);
      var rich = [];
      for (var row = from.minRow; row <= from.maxRow; row++) {
        var line = [];
        for (var c = from.minCol; c <= from.maxCol; c++) {
          var cell = src.cells[G.makeRef(c, row)];
          line.push({ raw: cell && cell.raw != null ? cell.raw : '', format: (cell && cell.format) || null });
        }
        rich.push(line);
      }
      rich = clean(rich); // the clipboard carries JSON
      var h = from.maxRow - from.minRow + 1;
      var w = from.maxCol - from.minCol + 1;
      checkGrowth(t, pos.row + h, pos.col + w);
      var next = G.pasteRangeFull(t, start, rich);
      var refs = [];
      for (var rr = 0; rr < h; rr++) for (var cc = 0; cc < w; cc++) refs.push(G.makeRef(pos.col + cc, pos.row + rr));
      return { sheet: next, extra: { refs: refs, rect: { minCol: pos.col, maxCol: pos.col + w - 1, minRow: pos.row, maxRow: pos.row + h - 1 } } };
    },
    { key: targetKey },
  );
  var ch = changes(r.G, r.before, r.after, r.extra.refs, true);
  return withNote({
    sheet: sheetRef(r.after),
    range_written: rectText(r.G, r.extra.rect),
    grew: { rows: r.after.numRows - r.before.numRows, columns: r.after.columns.length - r.before.columns.length },
    changed: ch.changed,
    changed_count: ch.changed_count,
    truncated: ch.truncated,
  });
}

/** Find & Replace: Replace (one cell) / Replace All -> FindReplace.tsx replaceOccurrences + setCellRaw. */
function cellsReplace(app, p) {
  var find = requiredStr(p, 'find');
  var withText = given(p, 'replace_with') ? str(p, 'replace_with') : '';
  var matchCase = given(p, 'match_case') ? bool(p, 'match_case') : false;
  var r = mutate(app, p, function (s, L) {
    var G = L.G;
    var matches = G.findMatches(s, find, matchCase);
    var targets = matches;
    if (given(p, 'ref')) {
      var want = str(p, 'ref').trim().toUpperCase();
      if (matches.indexOf(want) < 0) throw fail(404, want + ' does not contain "' + find + '".');
      targets = [want];
    }
    if (!targets.length) return { unchanged: true, extra: { refs: [] } };
    var cells = G.assign(s.cells);
    for (var i = 0; i < targets.length; i++) {
      var raw = s.cells[targets[i]] && s.cells[targets[i]].raw != null ? s.cells[targets[i]].raw : '';
      G.setCellRawInPlace(cells, targets[i], G.replaceOccurrences(raw, find, withText, matchCase));
    }
    var next = G.assign(s);
    next.cells = cells;
    return { sheet: next, extra: { refs: targets } };
  });
  var ch = changes(r.G, r.before, r.after, r.extra.refs, false);
  return withNote({ sheet: sheetRef(r.after), replaced: r.extra.refs.length, changed: ch.changed, changed_count: ch.changed_count, truncated: ch.truncated });
}

/* --------------------------------------------------------- rows / columns */

/** Formulas whose text changed when rows/columns moved; mapRef(oldRef) -> newRef or null (removed). */
function rewrites(before, after, mapRef) {
  var out = [];
  var keys = Object.keys(before.cells);
  for (var i = 0; i < keys.length; i++) {
    var cell = before.cells[keys[i]];
    if (!cell || typeof cell.raw !== 'string' || cell.raw.charAt(0) !== '=') continue;
    var to = mapRef(keys[i]);
    if (!to) continue;
    var now = after.cells[to];
    if (now && now.raw !== cell.raw) {
      if (out.length < CHANGE_CAP) out.push({ ref: to, before: cell.raw, after: now.raw });
    }
  }
  return out;
}

function removedCells(G, before, test) {
  var out = [];
  var keys = Object.keys(before.cells);
  for (var i = 0; i < keys.length; i++) {
    var pos = G.parseRef(keys[i]);
    if (!pos || !test(pos)) continue;
    var cell = before.cells[keys[i]];
    var item = { ref: keys[i], raw: cell && cell.raw != null ? cell.raw : '' };
    if (cell && cell.format && Object.keys(cell.format).length) item.format = cell.format;
    out.push(item);
  }
  return sortCellsList(G, out);
}

function sortCellsList(G, list) {
  var refs = [];
  var byRef = {};
  for (var i = 0; i < list.length; i++) {
    refs.push(list[i].ref);
    byRef[list[i].ref] = list[i];
  }
  sortRefs(G, refs);
  var out = [];
  for (var j = 0; j < refs.length; j++) out.push(byRef[refs[j]]);
  return out;
}

/** Toolbar "Row" -> grid.ts addRow (once per click). */
function rowsAdd(app, p) {
  var count = int(p, 'count', 1, 1, MAX_ROWS);
  var r = mutate(app, p, function (s, L) {
    checkGrowth(s, s.numRows + count, s.columns.length);
    var next = s;
    for (var i = 0; i < count; i++) next = L.G.addRow(next);
    return { sheet: next };
  });
  return withNote({ sheet: sheetRef(r.after), rows: r.after.numRows, added: r.after.numRows - r.before.numRows });
}

/** Row menu "Insert above/below" -> grid.ts insertRow. */
function rowsInsert(app, p) {
  var side = oneOf(p, 'side', ['above', 'below'], null);
  if (!side) throw fail(400, 'side is required: above or below');
  var count = int(p, 'count', 1, 1, MAX_ROWS);
  var at = 0;
  var r = mutate(app, p, function (s, L) {
    var row = rowParam(s, p, 'row');
    checkGrowth(s, s.numRows + count, s.columns.length);
    at = side === 'above' ? row - 1 : row;
    var next = s;
    for (var i = 0; i < count; i++) next = L.G.insertRow(next, at);
    return { sheet: next };
  });
  var G = r.G;
  var rw = rewrites(r.before, r.after, function (ref) {
    var pos = G.parseRef(ref);
    return pos ? G.makeRef(pos.col, pos.row >= at ? pos.row + count : pos.row) : null;
  });
  return withNote({ sheet: sheetRef(r.after), rows: r.after.numRows, inserted: at + 1 + (count > 1 ? '-' + (at + count) : ''), rewritten: rw });
}

/** Row menu / toolbar "Delete row" -> grid.ts deleteRow. */
function rowsDelete(app, p) {
  var count = int(p, 'count', 1, 1, MAX_ROWS);
  var at = 0;
  var r = mutate(app, p, function (s, L) {
    var row = rowParam(s, p, 'row');
    if (row + count - 1 > s.numRows) throw fail(400, 'There are only ' + s.numRows + ' rows.');
    if (s.numRows - count < 1) throw fail(400, 'A sheet keeps at least one row.');
    at = row - 1;
    var next = s;
    for (var i = 0; i < count; i++) next = L.G.deleteRow(next, at);
    return { sheet: next };
  });
  var G = r.G;
  var removed = removedCells(G, r.before, function (pos) {
    return pos.row >= at && pos.row < at + count;
  });
  var rw = rewrites(r.before, r.after, function (ref) {
    var pos = G.parseRef(ref);
    if (!pos || (pos.row >= at && pos.row < at + count)) return null;
    return G.makeRef(pos.col, pos.row >= at + count ? pos.row - count : pos.row);
  });
  return withNote({ sheet: sheetRef(r.after), rows: r.after.numRows, removed: removed.slice(0, CHANGE_CAP), removed_count: removed.length, rewritten: rw });
}

/** Row border drag -> grid.ts setRowHeight. */
function rowsResize(app, p) {
  if (!given(p, 'height')) throw fail(400, 'height is required (pixels)');
  var height = num(p, 'height');
  var row = 0;
  var r = mutate(app, p, function (s, L) {
    row = rowParam(s, p, 'row');
    return { sheet: L.G.setRowHeight(s, row - 1, height) };
  });
  return withNote({ sheet: sheetRef(r.after), row: row, height: r.after.rowHeights[String(row - 1)] });
}

/** Toolbar "Column" -> grid.ts addColumn (once per click). */
function columnsAdd(app, p) {
  var count = int(p, 'count', 1, 1, MAX_COLS);
  var r = mutate(app, p, function (s, L) {
    checkGrowth(s, s.numRows, s.columns.length + count);
    var next = s;
    for (var i = 0; i < count; i++) next = L.G.addColumn(next);
    return { sheet: next };
  });
  var G = r.G;
  var added = [];
  for (var c = r.before.columns.length; c < r.after.columns.length; c++) added.push({ letter: G.colLetter(c), name: r.after.columns[c].name });
  return withNote({ sheet: sheetRef(r.after), added: added });
}

/** Column menu "Insert left/right" -> grid.ts insertColumn. */
function columnsInsert(app, p) {
  var side = oneOf(p, 'side', ['left', 'right'], null);
  if (!side) throw fail(400, 'side is required: left or right');
  var count = int(p, 'count', 1, 1, MAX_COLS);
  var at = 0;
  var r = mutate(app, p, function (s, L) {
    var col = colParam(L.G, s, p, 'column');
    checkGrowth(s, s.numRows, s.columns.length + count);
    at = side === 'left' ? col : col + 1;
    var next = s;
    for (var i = 0; i < count; i++) next = L.G.insertColumn(next, at);
    return { sheet: next };
  });
  var G = r.G;
  var inserted = [];
  for (var c = at; c < at + count; c++) inserted.push({ letter: G.colLetter(c), name: r.after.columns[c].name });
  // Shifted columns still named by their letter move to their new letter.
  var renamed = [];
  for (var b = 0; b < r.before.columns.length; b++) {
    var to = b >= at ? b + count : b;
    var was = r.before.columns[b].name;
    var now = r.after.columns[to].name;
    if (was !== now && renamed.length < CHANGE_CAP) renamed.push({ letter: G.colLetter(to), before: was, after: now });
  }
  var rw = rewrites(r.before, r.after, function (ref) {
    var pos = G.parseRef(ref);
    return pos ? G.makeRef(pos.col >= at ? pos.col + count : pos.col, pos.row) : null;
  });
  return withNote({ sheet: sheetRef(r.after), inserted: inserted, renamed: renamed, rewritten: rw });
}

/** Column menu / toolbar "Delete column" -> grid.ts deleteColumn. */
function columnsDelete(app, p) {
  var count = int(p, 'count', 1, 1, MAX_COLS);
  var at = 0;
  var r = mutate(app, p, function (s, L) {
    var col = colParam(L.G, s, p, 'column');
    if (col + count > s.columns.length) throw fail(400, 'There are only ' + s.columns.length + ' columns.');
    if (s.columns.length - count < 1) throw fail(400, 'A sheet keeps at least one column.');
    at = col;
    var next = s;
    for (var i = 0; i < count; i++) next = L.G.deleteColumn(next, at);
    return { sheet: next };
  });
  var G = r.G;
  var removedCols = [];
  for (var c = at; c < at + count; c++) removedCols.push({ letter: G.colLetter(c), name: r.before.columns[c].name, type: r.before.columns[c].type });
  var removed = removedCells(G, r.before, function (pos) {
    return pos.col >= at && pos.col < at + count;
  });
  var rw = rewrites(r.before, r.after, function (ref) {
    var pos = G.parseRef(ref);
    if (!pos || (pos.col >= at && pos.col < at + count)) return null;
    return G.makeRef(pos.col >= at + count ? pos.col - count : pos.col, pos.row);
  });
  return withNote({
    sheet: sheetRef(r.after),
    removed_columns: removedCols,
    removed: removed.slice(0, CHANGE_CAP),
    removed_count: removed.length,
    rewritten: rw,
  });
}

/** Column menu (name, type) and header border drag (width). */
function columnsUpdate(app, p) {
  if (!given(p, 'name') && !given(p, 'type') && !given(p, 'width')) throw fail(400, 'Pass name, type and/or width.');
  var type = oneOf(p, 'type', ['text', 'number', 'date', 'currency'], null);
  var name = given(p, 'name') ? str(p, 'name').trim() : null;
  if (given(p, 'name') && name === '') throw fail(400, 'name must not be empty');
  var width = given(p, 'width') ? num(p, 'width') : null;
  var idx = 0;
  var r = mutate(app, p, function (s, L) {
    var G = L.G;
    idx = colParam(G, s, p, 'column');
    var col = s.columns[idx] || {};
    var next = s;
    var changed = false;
    if (name !== null && name !== col.name) {
      next = G.renameColumn(next, idx, name); // ColumnMenu.tsx commitName: only when changed
      changed = true;
    }
    if (type !== null && type !== col.type) {
      next = G.setColumnType(next, idx, type); // the type <select> fires on change
      changed = true;
    }
    if (width !== null) {
      next = G.setColumnWidth(next, idx, width);
      changed = changed || next.columns[idx].width !== col.width;
    }
    return changed ? { sheet: next } : { unchanged: true };
  });
  var G = r.G;
  var before = r.before.columns[idx] || {};
  var after = r.after.columns[idx] || {};
  return withNote({
    sheet: sheetRef(r.after),
    column: { letter: G.colLetter(idx), name: after.name, type: after.type, width: after.width },
    before: { name: before.name, type: before.type, width: before.width },
    unchanged: r.unchanged,
  });
}

module.exports = {
  handle: handle,
  guide: guide,
  sheetsList: sheetsList,
  sheetsGet: sheetsGet,
  sheetsCreate: sheetsCreate,
  sheetsRename: sheetsRename,
  sheetsDelete: sheetsDelete,
  sheetsFreeze: sheetsFreeze,
  sheetsImportCsv: sheetsImportCsv,
  sheetsExportCsv: sheetsExportCsv,
  cellsRead: cellsRead,
  cellsFind: cellsFind,
  cellsSet: cellsSet,
  cellsPaste: cellsPaste,
  cellsClear: cellsClear,
  cellsFormat: cellsFormat,
  cellsFill: cellsFill,
  cellsCopy: cellsCopy,
  cellsReplace: cellsReplace,
  rowsAdd: rowsAdd,
  rowsInsert: rowsInsert,
  rowsDelete: rowsDelete,
  rowsResize: rowsResize,
  columnsAdd: columnsAdd,
  columnsInsert: columnsInsert,
  columnsDelete: columnsDelete,
  columnsUpdate: columnsUpdate,
};
