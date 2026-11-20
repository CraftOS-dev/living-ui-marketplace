/// <reference path="../pb_data/types.d.ts" />
/**
 * Craft Sheets CSV import / export — server-side port for agent operations.
 *
 * PORT OF:
 *   - frontend/src/app/utils/fileio.ts worksheetToSheetInput() + importWorkbook()
 *     (Import button), with the SheetJS (xlsx@0.18.5) code it relies on for a
 *     CSV: PRN.dsv_to_sheet_str, guess_sep, fuzzynum, fuzzyfmla, fuzzydate,
 *     parseDate, datenum;
 *   - fileio.ts toWorksheet() + exportSheet() (CSV button), with SheetJS
 *     sheet_to_csv / make_csv_row / format_cell / SSF_general.
 *
 * Import reads the text the way the app reads a UTF-8 .csv file that starts with
 * a byte-order mark (SheetJS then always takes the delimited-text path).
 * One deliberate difference: SheetJS turns date-like text into Excel serial
 * numbers through the browser's Date parser and time zone. Only unambiguous
 * ISO-like values are converted here — YYYY-MM-DD, and YYYY-MM-DD HH:MM[:SS]
 * with a space — to the same serial number the app's code produces for them
 * (server local time zone); every other date-like field stays text.
 * No require() in here.
 */

var MAX_COLS = 256; // fileio.ts MAX_COLS
var MAX_ROWS = 5000; // fileio.ts MAX_ROWS

/* ----------------------------------------------------------- shared helpers */

function isEsSpace(c) {
  return (
    c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d || c === 0x20 ||
    c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 ||
    c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  );
}
function esTrim(s) {
  var a = 0;
  var b = s.length;
  while (a < b && isEsSpace(s.charCodeAt(a))) a++;
  while (b > a && isEsSpace(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

var DEC_LIT_RE = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/;
/** ECMAScript Number(string), independent of the host runtime. */
function jsNumber(str) {
  var s = esTrim(String(str));
  if (s === '') return 0;
  if (s === 'Infinity' || s === '+Infinity') return Infinity;
  if (s === '-Infinity') return -Infinity;
  var m = /^0[xX]([0-9a-fA-F]+)$/.exec(s);
  if (m) return parseInt(m[1], 16);
  m = /^0[oO]([0-7]+)$/.exec(s);
  if (m) return parseInt(m[1], 8);
  m = /^0[bB]([01]+)$/.exec(s);
  if (m) return parseInt(m[1], 2);
  if (DEC_LIT_RE.test(s)) return parseFloat(s);
  return NaN;
}

/** grid.ts colLetter / SheetJS encode_col. */
function colLetter(index) {
  var n = index + 1;
  var letters = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/* ------------------------------------------------------------ SheetJS bits */

/** SheetJS fuzzynum (xlsx.js:3310). */
function fuzzynum(s) {
  var v = jsNumber(s);
  if (!(v !== v)) return isFinite(v) ? v : NaN;
  if (!/\d/.test(s)) return v;
  var wt = 1;
  var ss = s
    .replace(/([\d]),([\d])/g, '$1$2')
    .replace(/[$]/g, '')
    .replace(/[%]/g, function () {
      wt *= 100;
      return '';
    });
  if (!((v = jsNumber(ss)) !== v)) return v / wt;
  ss = ss.replace(/[(](.*)[)]/, function ($$, $1) {
    wt = -wt;
    return $1;
  });
  if (!((v = jsNumber(ss)) !== v)) return v / wt;
  return v;
}

/** SheetJS fuzzyfmla (xlsx.js:12033). */
function fuzzyfmla(f) {
  if (f.length == 1) return false;
  return true;
}

function daysInMonth(y, m) {
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

var ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * The Date the browser builds for an ISO-like field (`new Date(s)` in SheetJS
 * fuzzydate/parseDate), or null when the field is not one of the two forms
 * this port converts. YYYY-MM-DD is parsed as UTC midnight (ECMAScript date-only
 * form); "YYYY-MM-DD HH:MM[:SS]" as local time (V8's fallback parser).
 */
function isoLikeDate(s) {
  var m = ISO_DATE_RE.exec(s);
  var y;
  var mo;
  var d;
  if (m) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
    if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return new Date(Date.UTC(y, mo - 1, d));
  }
  m = ISO_DATETIME_RE.exec(s);
  if (m) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
    var hh = +m[4];
    var mi = +m[5];
    var ss = m[6] === undefined ? 0 : +m[6];
    if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || hh > 23 || mi > 59 || ss > 59) return null;
    return new Date(y, mo - 1, d, hh, mi, ss);
  }
  return null;
}

/** SheetJS fuzzydate (xlsx.js:3322) acceptance rules, applied to that Date. */
function fuzzydateAccepts(s, o) {
  var y = o.getFullYear() - 1900; // o.getYear()
  var mo = o.getMonth();
  var d = o.getDate();
  if (d !== d) return false;
  // no letters in either ISO-like form
  if (y < 0 || y > 8099) return false;
  if ((mo > 0 || d > 1) && y != 101) return true;
  if (s.match(/[^-0-9:,\/\\]/)) return false;
  return true;
}

/** SheetJS datenum (xlsx.js:3198), evaluated in this server's time zone. */
function datenum(v) {
  var basedate = new Date(1899, 11, 30, 0, 0, 0);
  var epoch = v.getTime();
  var dnthresh = basedate.getTime() + (v.getTimezoneOffset() - basedate.getTimezoneOffset()) * 60000;
  return (epoch - dnthresh) / (24 * 60 * 60 * 1000);
}

/** SheetJS PRN guess_sep. */
var GUESS_SEPS = { 44: ',', 9: '\t', 59: ';', 124: '|' };
var GUESS_SEP_WEIGHTS = { 44: 3, 9: 2, 59: 1, 124: 0 };
function guessSep(str) {
  var cnt = {};
  var instr = false;
  var end;
  var cc = 0;
  for (end = 0; end < str.length; ++end) {
    if ((cc = str.charCodeAt(end)) == 0x22) instr = !instr;
    else if (!instr && GUESS_SEPS[cc] !== undefined) cnt[cc] = (cnt[cc] || 0) + 1;
  }
  var list = [];
  var k;
  for (k in cnt) if (Object.prototype.hasOwnProperty.call(cnt, k)) list.push([cnt[k], k]);
  if (!list.length) {
    for (k in GUESS_SEP_WEIGHTS) if (Object.prototype.hasOwnProperty.call(GUESS_SEP_WEIGHTS, k)) list.push([GUESS_SEP_WEIGHTS[k], k]);
  }
  list.sort(function (a, b) {
    return a[0] - b[0] || GUESS_SEP_WEIGHTS[a[1]] - GUESS_SEP_WEIGHTS[b[1]];
  });
  return GUESS_SEPS[list.pop()[1]] || ',';
}

/**
 * SheetJS PRN.dsv_to_sheet_str for the options the View uses (none): returns
 * { cells: { "R,C": { t, v?, f? } }, maxR, maxC } where maxR / maxC are the
 * worksheet range's end (empty fields included, as in SheetJS).
 */
function dsvToCells(str) {
  var sep = '';
  if (str.slice(0, 4) == 'sep=') {
    if (str.charCodeAt(5) == 13 && str.charCodeAt(6) == 10) {
      sep = str.charAt(4);
      str = str.slice(7);
    } else if (str.charCodeAt(5) == 13 || str.charCodeAt(5) == 10) {
      sep = str.charAt(4);
      str = str.slice(6);
    } else sep = guessSep(str.slice(0, 1024));
  } else sep = guessSep(str.slice(0, 1024));

  var R = 0;
  var C = 0;
  var start = 0;
  var end = 0;
  var sepcc = sep.charCodeAt(0);
  var instr = false;
  var cc = 0;
  var startcc = str.charCodeAt(0);
  str = str.replace(/\r\n/gm, '\n');
  var cells = {};
  var maxR = 0;
  var maxC = 0;

  function finishCell() {
    var s = str.slice(start, end);
    var cell = {};
    if (s.charAt(0) == '"' && s.charAt(s.length - 1) == '"') s = s.slice(1, -1).replace(/""/g, '"');
    var v;
    if (s.length === 0) cell.t = 'z';
    else if (esTrim(s).length === 0) {
      cell.t = 's';
      cell.v = s;
    } else if (s.charCodeAt(0) == 0x3d) {
      if (s.charCodeAt(1) == 0x22 && s.charCodeAt(s.length - 1) == 0x22) {
        cell.t = 's';
        cell.v = s.slice(2, -1).replace(/""/g, '"');
      } else if (fuzzyfmla(s)) {
        cell.t = 'n';
        cell.f = s.slice(1);
      } else {
        cell.t = 's';
        cell.v = s;
      }
    } else if (s == 'TRUE') {
      cell.t = 'b';
      cell.v = true;
    } else if (s == 'FALSE') {
      cell.t = 'b';
      cell.v = false;
    } else if (!((v = fuzzynum(s)) !== v)) {
      cell.t = 'n';
      cell.v = v;
    } else {
      var dt = isoLikeDate(s);
      if (dt && fuzzydateAccepts(s, dt)) {
        cell.t = 'n';
        cell.v = datenum(dt); // datenum(parseDate(s, 0))
      } else {
        cell.t = 's';
        cell.v = s;
      }
    }
    if (cell.t != 'z') cells[R + ',' + C] = cell;
    start = end + 1;
    startcc = str.charCodeAt(start);
    if (maxC < C) maxC = C;
    if (maxR < R) maxR = R;
    if (cc == sepcc) ++C;
    else {
      C = 0;
      ++R;
    }
  }

  for (; end < str.length; ++end) {
    cc = str.charCodeAt(end);
    if (cc === 0x22) {
      if (startcc === 0x22) instr = !instr;
    } else if (cc === sepcc || cc === 0x0a || cc === 0x0d) {
      if (!instr) finishCell();
    }
  }
  if (end - start > 0) finishCell();
  return { cells: cells, maxR: maxR, maxC: maxC };
}

/**
 * Import: CSV text -> the SheetInput the View would POST (fileio.ts
 * worksheetToSheetInput), plus what was cut by the 5,000 × 256 limits.
 * Returns { columns, numRows, cells, cellCount, truncated: { rows, columns } }
 * or { refused: message } when the app would not read the text as CSV.
 */
function importCsv(text) {
  var str = String(text);
  if (str.charCodeAt(0) === 0xfeff) str = str.slice(1); // the BOM the importer strips
  if (str.charAt(0) === '<') {
    return { refused: 'Text starting with "<" is read by the app as XML/HTML, not CSV.' };
  }
  var ws = dsvToCells(str);
  var cells = {};
  var maxCol = 0;
  var maxRow = 0;
  var count = 0;
  var endR = Math.min(ws.maxR, MAX_ROWS - 1);
  var endC = Math.min(ws.maxC, MAX_COLS - 1);
  var truncRows = false;
  var truncCols = false;
  var keys = Object.keys(ws.cells);
  for (var i = 0; i < keys.length; i++) {
    var rc = keys[i].split(',');
    if (+rc[0] > endR) truncRows = true;
    if (+rc[1] > endC) truncCols = true;
  }
  for (var r = 0; r <= endR; r++) {
    for (var c = 0; c <= endC; c++) {
      var cell = ws.cells[r + ',' + c];
      if (!cell) continue;
      var raw;
      if (cell.f != null && cell.f !== '') raw = '=' + cell.f;
      else if (cell.v == null) continue;
      else raw = String(cell.v);
      if (raw === '') continue;
      cells[colLetter(c) + (r + 1)] = { raw: raw };
      count++;
      maxCol = Math.max(maxCol, c);
      maxRow = Math.max(maxRow, r);
    }
  }
  var numCols = Math.max(maxCol + 1, 1);
  var numRows = Math.max(maxRow + 1, 1);
  var columns = [];
  for (var k = 0; k < numCols; k++) columns.push({ name: colLetter(k), type: 'text', width: 120 });
  return { columns: columns, numRows: numRows, cells: cells, cellCount: count, truncated: { rows: truncRows, columns: truncCols } };
}

/* ------------------------------------------------------------------ export */

function SSF_strip_decimal(o) {
  return o.indexOf('.') == -1 ? o : o.replace(/(?:\.0*|(\.\d*[1-9])0+)$/, '$1');
}
function SSF_normalize_exp(o) {
  if (o.indexOf('E') == -1) return o;
  return o.replace(/(?:\.0*|(\.\d*[1-9])0+)[Ee]/, '$1E').replace(/(E[+-])(\d)$/, '$10$2');
}
function SSF_small_exp(v) {
  var w = v < 0 ? 12 : 11;
  var o = SSF_strip_decimal(v.toFixed(12));
  if (o.length <= w) return o;
  o = v.toPrecision(10);
  if (o.length <= w) return o;
  return v.toExponential(5);
}
function SSF_large_exp(v) {
  var o = SSF_strip_decimal(v.toFixed(11));
  return o.length > (v < 0 ? 12 : 11) || o === '0' || o === '-0' ? v.toPrecision(6) : o;
}
function SSF_general_num(v) {
  var V = Math.floor(Math.log(Math.abs(v)) * Math.LOG10E);
  var o;
  if (V >= -4 && V <= -1) o = v.toPrecision(10 + V);
  else if (Math.abs(V) <= 9) o = SSF_small_exp(v);
  else if (V === 10) o = v.toFixed(10).substr(0, 12);
  else o = SSF_large_exp(v);
  return SSF_strip_decimal(SSF_normalize_exp(o.toUpperCase()));
}
/** SheetJS SSF_general — the "General" number format a CSV cell gets. */
function SSF_general(v) {
  switch (typeof v) {
    case 'string':
      return v;
    case 'boolean':
      return v ? 'TRUE' : 'FALSE';
    case 'number':
      return (v | 0) === v ? v.toString(10) : SSF_general_num(v);
    case 'undefined':
      return '';
  }
  if (v == null) return '';
  return '' + v;
}

/** fileio.ts toWorksheet: our cells -> SheetJS cell objects (values, not formulas). */
function toWorksheetCells(sheet, values) {
  var ws = {};
  var keys = Object.keys(sheet.cells);
  for (var i = 0; i < keys.length; i++) {
    var ref = keys[i];
    var cell = sheet.cells[ref];
    var raw = cell && cell.raw != null ? cell.raw : '';
    if (raw === '') continue;
    var value = values[ref];
    if (typeof raw === 'string' && raw.charAt(0) === '=') {
      var f = raw.slice(1);
      if (typeof value === 'number') ws[ref] = { t: 'n', v: value, f: f };
      else if (typeof value === 'boolean') ws[ref] = { t: 'b', v: value, f: f };
      else ws[ref] = { t: 's', v: value == null ? '' : String(value), f: f };
    } else if (typeof value === 'number') {
      ws[ref] = { t: 'n', v: value };
    } else if (typeof value === 'boolean') {
      ws[ref] = { t: 'b', v: value };
    } else {
      ws[ref] = { t: 's', v: raw };
    }
  }
  return ws;
}

/**
 * Export: the CSV text the View's CSV button writes for this sheet (without the
 * UTF-8 byte-order mark the downloaded file starts with). `values` are the
 * evaluated values (formula engine output). SheetJS sheet_to_csv defaults:
 * FS ",", RS "\n", every row of the grid kept, no trailing newline.
 */
function exportCsv(sheet, values) {
  var ws = toWorksheetCells(sheet, values);
  var nCols = Math.max(sheet.columns.length, 1);
  var nRows = Math.max(sheet.numRows, 1);
  var cols = [];
  for (var C = 0; C < nCols; C++) cols.push(colLetter(C));
  var out = [];
  for (var R = 0; R < nRows; R++) {
    var rr = String(R + 1);
    var row = [];
    for (var c = 0; c < nCols; c++) {
      var val = ws[cols[c] + rr];
      var txt;
      if (val == null) txt = '';
      else if (val.v != null) {
        txt = '' + SSF_general(val.v);
        for (var i = 0; i !== txt.length; ++i) {
          var cc = txt.charCodeAt(i);
          if (cc === 44 || cc === 10 || cc === 34) {
            txt = '"' + txt.replace(/"/g, '""') + '"';
            break;
          }
        }
        if (txt == 'ID') txt = '"ID"';
      } else if (val.f != null) {
        txt = '=' + val.f;
        if (txt.indexOf(',') >= 0) txt = '"' + txt.replace(/"/g, '""') + '"';
      } else txt = '';
      row.push(txt);
    }
    out.push((R ? '\n' : '') + row.join(','));
  }
  return out.join('');
}

/** fileio.ts exportSheet file name. */
function exportFileName(name) {
  return (name || 'sheet').replace(/[^\w.-]+/g, '_') + '.csv';
}

module.exports = {
  MAX_ROWS: MAX_ROWS,
  MAX_COLS: MAX_COLS,
  importCsv: importCsv,
  exportCsv: exportCsv,
  exportFileName: exportFileName,
  SSF_general: SSF_general,
  fuzzynum: fuzzynum,
};
