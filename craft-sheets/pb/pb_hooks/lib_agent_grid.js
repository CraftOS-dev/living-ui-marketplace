/// <reference path="../pb_data/types.d.ts" />
/**
 * Craft Sheets grid helpers — server-side port for agent operations.
 *
 * PORT OF:
 *   - frontend/src/app/utils/grid.ts (A1 refs, every structural mutation the
 *     View performs, autofill, paste, selection refs, display formatting);
 *   - frontend/src/app/components/FindReplace.tsx (replaceOccurrences and the
 *     match list).
 * Every mutation is pure (returns a new sheet object), exactly like grid.ts, and
 * produces the same `cells` / `columns` / `rowHeights` shapes the View writes.
 * `sheet` here is the View's Sheet shape: { name, columns, numRows, cells,
 * rowHeights, frozenRows, frozenCols, values?, errors? }.
 *
 * Only displayCell/formatValue differ: the browser formats numbers with
 * Intl.NumberFormat in the person's locale; goja has no Intl, so this renders the
 * en-US form (shortest digits, half-expand rounding, ',' grouping, USD).
 * No require() in here.
 */

var DEFAULT_COL_WIDTH = 120;
var MIN_COL_WIDTH = 64;
var DEFAULT_ROW_HEIGHT = 28;
var MIN_ROW_HEIGHT = 20;

/* ------------------------------------------------------- object helpers */

/** `{ ...a, ...b }` (own enumerable keys, insertion order). */
function assign() {
  var out = {};
  for (var i = 0; i < arguments.length; i++) {
    var src = arguments[i];
    if (src == null) continue;
    var keys = Object.keys(src);
    for (var k = 0; k < keys.length; k++) out[keys[k]] = src[keys[k]];
  }
  return out;
}

/** Shallow copy of a sheet (`{ ...sheet }`). */
function copySheet(sheet) {
  return assign(sheet);
}

/* ---------------------------------------------------- A1 reference helpers */

/** grid.ts colLetter. */
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

/** grid.ts letterToIndex (letters upper-cased first). */
function letterToIndex(letters) {
  var up = letters.toUpperCase();
  var n = 0;
  for (var i = 0; i < up.length; i++) {
    n = n * 26 + (up.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** grid.ts makeRef. */
function makeRef(col, row) {
  return colLetter(col) + (row + 1);
}

var PARSE_REF_RE = /^([A-Za-z]+)(\d+)$/;

/** grid.ts parseRef: { col, row } (0-based) or null. */
function parseRef(ref) {
  var m = PARSE_REF_RE.exec(ref);
  if (!m) return null;
  return { col: letterToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

/* ------------------------------------------------------ value formatting */

/** ECMAScript whitespace trim (String.prototype.trim). */
function esTrim(s) {
  var ws = function (c) {
    return (
      c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d || c === 0x20 ||
      c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 ||
      c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
    );
  };
  var a = 0;
  var b = s.length;
  while (a < b && ws(s.charCodeAt(a))) a++;
  while (b > a && ws(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

var DEC_LIT_RE = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/;

/** ECMAScript Number(string) (StringToNumber), independent of the host runtime. */
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

/** Decimal digits of |v| (shortest round-trip form): { digits, point } = 0.digits × 10^point. */
function shortestDigits(v) {
  var s = String(Math.abs(v));
  var exp = 0;
  var e = s.indexOf('e');
  if (e >= 0) {
    exp = parseInt(s.slice(e + 1), 10);
    s = s.slice(0, e);
  }
  var dot = s.indexOf('.');
  var intPart = dot >= 0 ? s.slice(0, dot) : s;
  var frac = dot >= 0 ? s.slice(dot + 1) : '';
  var digits = intPart + frac;
  var point = intPart.length + exp;
  // strip leading zeros
  var lead = 0;
  while (lead < digits.length - 1 && digits.charAt(lead) === '0') {
    lead++;
    point--;
  }
  digits = digits.slice(lead);
  if (/^0*$/.test(digits)) return { digits: '0', point: 1, zero: true };
  return { digits: digits, point: point, zero: false };
}

function groupThousands(intStr) {
  var out = '';
  var count = 0;
  for (var i = intStr.length - 1; i >= 0; i--) {
    out = intStr.charAt(i) + out;
    count++;
    if (count % 3 === 0 && i > 0) out = ',' + out;
  }
  return out;
}

/**
 * Intl.NumberFormat('en-US', { minimumFractionDigits: minF, maximumFractionDigits: maxF })
 * for a finite number: rounds the shortest decimal form half-expand, groups with ','.
 * Returns { negative, text }.
 */
function enUsDecimal(v, minF, maxF) {
  var negative = v < 0 || (v === 0 && 1 / v < 0);
  var sd = shortestDigits(v);
  var intStr;
  var fracStr;
  if (sd.zero) {
    intStr = '0';
    fracStr = '';
  } else {
    // place digits around the point
    var digits = sd.digits;
    var point = sd.point;
    var all;
    var intLen;
    if (point <= 0) {
      all = new Array(1 - point + 1).join('0') + digits; // "0" + leading zeros + digits
      intLen = 1;
    } else if (point >= digits.length) {
      all = digits + new Array(point - digits.length + 1).join('0');
      intLen = point;
    } else {
      all = digits;
      intLen = point;
    }
    intStr = all.slice(0, intLen);
    fracStr = all.slice(intLen);
    // round to maxF fraction digits, half away from zero (on magnitude: half up)
    if (fracStr.length > maxF) {
      var roundUp = fracStr.charCodeAt(maxF) >= 53; // '5'
      fracStr = fracStr.slice(0, maxF);
      if (roundUp) {
        var num = (intStr + fracStr).split('');
        var i = num.length - 1;
        while (i >= 0) {
          if (num[i] === '9') {
            num[i] = '0';
            i--;
          } else {
            num[i] = String.fromCharCode(num[i].charCodeAt(0) + 1);
            break;
          }
        }
        var joined = num.join('');
        if (i < 0) joined = '1' + joined;
        intStr = joined.slice(0, joined.length - fracStr.length);
        fracStr = joined.slice(joined.length - fracStr.length);
      }
    }
    intStr = intStr.replace(/^0+(?=\d)/, '');
  }
  // trim trailing zeros beyond minF, pad to minF
  while (fracStr.length > minF && fracStr.charAt(fracStr.length - 1) === '0') {
    fracStr = fracStr.slice(0, -1);
  }
  while (fracStr.length < minF) fracStr += '0';
  var text = groupThousands(intStr) + (fracStr.length ? '.' + fracStr : '');
  return { negative: negative, text: text };
}

/** en-US form of grid.ts numberFmt (maximumFractionDigits 10). */
function formatNumberEnUs(v) {
  if (v !== v) return 'NaN';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '-∞';
  var r = enUsDecimal(v, 0, 10);
  return (r.negative ? '-' : '') + r.text;
}

/** en-US form of grid.ts currencyFmt (USD). */
function formatCurrencyEnUs(v) {
  if (v !== v) return 'NaN';
  if (v === Infinity) return '$∞';
  if (v === -Infinity) return '-$∞';
  var r = enUsDecimal(v, 2, 2);
  return (r.negative ? '-$' : '$') + r.text;
}

/** grid.ts formatValue (en-US rendering of the Intl formatters). */
function formatValue(value, type) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    if (type === 'currency') return formatCurrencyEnUs(value);
    return formatNumberEnUs(value);
  }
  if (type === 'currency') {
    var n = jsNumber(value);
    if (!(n !== n) && esTrim(value) !== '') return formatCurrencyEnUs(n);
  }
  return value;
}

/** grid.ts displayCell: { text, isError }. Needs sheet.values / sheet.errors. */
function displayCell(sheet, ref) {
  var errors = sheet.errors || {};
  if (errors[ref]) return { text: errors[ref], isError: true };
  var pos = parseRef(ref) || { col: 0 };
  var col = sheet.columns[pos.col];
  var type = (col && col.type) || 'text';
  var values = sheet.values || {};
  return { text: formatValue(values[ref], type), isError: false };
}

/* ------------------------------------------- structural mutations (pure) */

/** grid.ts cloneCells: `{ ...v, format: v.format ? { ...v.format } : undefined }`. */
function cloneCells(cells) {
  var out = {};
  var keys = Object.keys(cells);
  for (var i = 0; i < keys.length; i++) {
    var v = cells[keys[i]];
    var c = assign(v);
    c.format = v.format ? assign(v.format) : undefined;
    out[keys[i]] = c;
  }
  return out;
}

/** grid.ts setCellRaw. */
function setCellRaw(sheet, ref, raw) {
  var cells = cloneCells(sheet.cells);
  if (raw === '') {
    if (cells[ref] && cells[ref].format && Object.keys(cells[ref].format).length > 0) {
      cells[ref] = assign(cells[ref], { raw: '' });
    } else {
      delete cells[ref];
    }
  } else {
    cells[ref] = assign(cells[ref] || {}, { raw: raw });
  }
  var next = copySheet(sheet);
  next.cells = cells;
  return next;
}

/** grid.ts setCellFormat. */
function setCellFormat(sheet, ref, format) {
  var cells = cloneCells(sheet.cells);
  var existing = cells[ref] || { raw: '' };
  var nextFormat = assign(existing.format, format);
  var fkeys = Object.keys(nextFormat);
  for (var i = 0; i < fkeys.length; i++) {
    var v = nextFormat[fkeys[i]];
    if (v === null || v === undefined || v === false) delete nextFormat[fkeys[i]];
  }
  if (existing.raw === '' && Object.keys(nextFormat).length === 0) {
    delete cells[ref];
  } else {
    cells[ref] = assign(existing, { format: Object.keys(nextFormat).length ? nextFormat : undefined });
  }
  var next = copySheet(sheet);
  next.cells = cells;
  return next;
}

/**
 * setCellRaw / setCellFormat applied to a cells map the caller already copied
 * (`assign(sheet.cells)`). They change cells[ref] exactly as the pure versions do;
 * used when one View action applies the same function to many refs in a row
 * (Delete key, Replace All, a format button over a selection) so a big selection
 * does not re-clone the whole map per cell. Same stored result.
 */
function setCellRawInPlace(cells, ref, raw) {
  if (raw === '') {
    if (cells[ref] && cells[ref].format && Object.keys(cells[ref].format).length > 0) {
      cells[ref] = assign(cells[ref], { raw: '' });
    } else {
      delete cells[ref];
    }
  } else {
    cells[ref] = assign(cells[ref] || {}, { raw: raw });
  }
}

function setCellFormatInPlace(cells, ref, format) {
  var existing = cells[ref] || { raw: '' };
  var nextFormat = assign(existing.format, format);
  var fkeys = Object.keys(nextFormat);
  for (var i = 0; i < fkeys.length; i++) {
    var v = nextFormat[fkeys[i]];
    if (v === null || v === undefined || v === false) delete nextFormat[fkeys[i]];
  }
  if (existing.raw === '' && Object.keys(nextFormat).length === 0) {
    delete cells[ref];
  } else {
    cells[ref] = assign(existing, { format: Object.keys(nextFormat).length ? nextFormat : undefined });
  }
}

/** grid.ts getCellFormat. */
function getCellFormat(sheet, ref) {
  var c = sheet.cells[ref];
  return (c && c.format) || {};
}

/** grid.ts addRow. */
function addRow(sheet) {
  var next = copySheet(sheet);
  next.numRows = sheet.numRows + 1;
  return next;
}

/** grid.ts newColumnName: a new column at `index` takes its letter, or the next letter no other column has. */
function newColumnName(names, index) {
  var n = index;
  while (names.indexOf(colLetter(n)) !== -1) n++;
  return colLetter(n);
}

function columnNames(columns) {
  return columns.map(function (c) {
    return c.name;
  });
}

/** grid.ts addColumn. */
function addColumn(sheet) {
  var columns = sheet.columns.slice();
  columns.push({ name: newColumnName(columnNames(columns), sheet.columns.length), type: 'text', width: DEFAULT_COL_WIDTH });
  var next = copySheet(sheet);
  next.columns = columns;
  return next;
}

function mapColumn(sheet, index, patch) {
  var columns = [];
  for (var i = 0; i < sheet.columns.length; i++) {
    columns.push(i === index ? assign(sheet.columns[i], patch) : sheet.columns[i]);
  }
  var next = copySheet(sheet);
  next.columns = columns;
  return next;
}

/** grid.ts renameColumn. */
function renameColumn(sheet, index, name) {
  return mapColumn(sheet, index, { name: name });
}

/** grid.ts setColumnType. */
function setColumnType(sheet, index, type) {
  return mapColumn(sheet, index, { type: type });
}

/** grid.ts setColumnWidth. */
function setColumnWidth(sheet, index, width) {
  var w = Math.max(MIN_COL_WIDTH, Math.round(width));
  return mapColumn(sheet, index, { width: w });
}

/** grid.ts setRowHeight. */
function setRowHeight(sheet, rowIndex, height) {
  var h = Math.max(MIN_ROW_HEIGHT, Math.round(height));
  var rowHeights = assign(sheet.rowHeights);
  rowHeights[String(rowIndex)] = h;
  var next = copySheet(sheet);
  next.rowHeights = rowHeights;
  return next;
}

/** grid.ts setFreezePanes. */
function setFreezePanes(sheet, frozenRows, frozenCols) {
  var next = copySheet(sheet);
  next.frozenRows = Math.max(0, Math.min(frozenRows, sheet.numRows));
  next.frozenCols = Math.max(0, Math.min(frozenCols, sheet.columns.length));
  return next;
}

/** grid.ts shiftFormulaRefs (regex-based, as in the View). */
function shiftFormulaRefs(raw, kind, atIndex, delta) {
  if (raw.charAt(0) !== '=') return raw;
  return raw.replace(/([A-Za-z]+)(\d+)/g, function (token, colLetters, rowDigits) {
    var pos = parseRef(colLetters + rowDigits);
    if (!pos) return token;
    var value = kind === 'row' ? pos.row : pos.col;
    if (delta < 0 && value === atIndex) return '#REF!';
    var shifts = delta < 0 ? value > atIndex : value >= atIndex;
    if (shifts) {
      return kind === 'row' ? makeRef(pos.col, pos.row + delta) : makeRef(pos.col + delta, pos.row);
    }
    return token;
  });
}

/** grid.ts rewriteFormulaRefs (deletion path). */
function rewriteFormulaRefs(raw, kind, deletedIndex) {
  return shiftFormulaRefs(raw, kind, deletedIndex, -1);
}

/** grid.ts shiftFormulaRefsForInsert. */
function shiftFormulaRefsForInsert(raw, kind, atIndex) {
  return shiftFormulaRefs(raw, kind, atIndex, 1);
}

/** grid.ts shiftFormulaByDelta (relative-reference shift for autofill). */
function shiftFormulaByDelta(raw, colDelta, rowDelta) {
  if (raw.charAt(0) !== '=' || (colDelta === 0 && rowDelta === 0)) return raw;
  return raw.replace(/([A-Za-z]+)(\d+)/g, function (token, colLetters, rowDigits) {
    var pos = parseRef(colLetters + rowDigits);
    if (!pos) return token;
    var newCol = pos.col + colDelta;
    var newRow = pos.row + rowDelta;
    if (newCol < 0 || newRow < 0) return '#REF!';
    return makeRef(newCol, newRow);
  });
}

function startsWithEq(cell) {
  return typeof cell.raw === 'string' && cell.raw.charAt(0) === '=';
}

/** grid.ts insertRow. */
function insertRow(sheet, atIndex) {
  var cells = {};
  var keys = Object.keys(sheet.cells);
  for (var i = 0; i < keys.length; i++) {
    var pos = parseRef(keys[i]);
    if (!pos) continue;
    var cell = sheet.cells[keys[i]];
    var newRow = pos.row >= atIndex ? pos.row + 1 : pos.row;
    var rewritten = startsWithEq(cell) ? assign(cell, { raw: shiftFormulaRefsForInsert(cell.raw, 'row', atIndex) }) : cell;
    cells[makeRef(pos.col, newRow)] = rewritten;
  }
  var rowHeights = {};
  var hkeys = Object.keys(sheet.rowHeights || {});
  for (var j = 0; j < hkeys.length; j++) {
    var idx = Number(hkeys[j]);
    var newIdx = idx >= atIndex ? idx + 1 : idx;
    rowHeights[String(newIdx)] = sheet.rowHeights[hkeys[j]];
  }
  var next = copySheet(sheet);
  next.cells = cells;
  next.rowHeights = rowHeights;
  next.numRows = sheet.numRows + 1;
  return next;
}

/**
 * grid.ts insertColumn: the new column is named by its letter; shifted columns still
 * named by their letter take their new letter (when no other column has it); if another
 * column already has the new column's letter, it takes the next letter none has.
 */
function insertColumn(sheet, atIndex) {
  var names = sheet.columns.map(function (c) {
    return c.name;
  });
  for (var s = names.length - 1; s >= atIndex; s--) {
    if (names[s] === colLetter(s) && names.indexOf(colLetter(s + 1)) === -1) names[s] = colLetter(s + 1);
  }
  var columns = sheet.columns.map(function (c, ci) {
    return names[ci] === c.name ? c : assign(c, { name: names[ci] });
  });
  columns.splice(atIndex, 0, { name: newColumnName(names, atIndex), type: 'text', width: DEFAULT_COL_WIDTH });
  var cells = {};
  var keys = Object.keys(sheet.cells);
  for (var i = 0; i < keys.length; i++) {
    var pos = parseRef(keys[i]);
    if (!pos) continue;
    var cell = sheet.cells[keys[i]];
    var newCol = pos.col >= atIndex ? pos.col + 1 : pos.col;
    var rewritten = startsWithEq(cell) ? assign(cell, { raw: shiftFormulaRefsForInsert(cell.raw, 'col', atIndex) }) : cell;
    cells[makeRef(newCol, pos.row)] = rewritten;
  }
  var next = copySheet(sheet);
  next.columns = columns;
  next.cells = cells;
  return next;
}

/** grid.ts deleteRow. */
function deleteRow(sheet, rowIndex) {
  if (sheet.numRows <= 1) return sheet;
  var cells = {};
  var keys = Object.keys(sheet.cells);
  for (var i = 0; i < keys.length; i++) {
    var pos = parseRef(keys[i]);
    if (!pos) continue;
    if (pos.row === rowIndex) continue;
    var cell = sheet.cells[keys[i]];
    var newRow = pos.row > rowIndex ? pos.row - 1 : pos.row;
    var rewritten = startsWithEq(cell) ? assign(cell, { raw: rewriteFormulaRefs(cell.raw, 'row', rowIndex) }) : cell;
    cells[makeRef(pos.col, newRow)] = rewritten;
  }
  var rowHeights = {};
  var hkeys = Object.keys(sheet.rowHeights || {});
  for (var j = 0; j < hkeys.length; j++) {
    var idx = Number(hkeys[j]);
    if (idx === rowIndex) continue;
    var newIdx = idx > rowIndex ? idx - 1 : idx;
    rowHeights[String(newIdx)] = sheet.rowHeights[hkeys[j]];
  }
  var next = copySheet(sheet);
  next.cells = cells;
  next.rowHeights = rowHeights;
  next.numRows = sheet.numRows - 1;
  return next;
}

/** grid.ts deleteColumn. */
function deleteColumn(sheet, colIndex) {
  if (sheet.columns.length <= 1) return sheet;
  var columns = [];
  for (var c = 0; c < sheet.columns.length; c++) if (c !== colIndex) columns.push(sheet.columns[c]);
  var cells = {};
  var keys = Object.keys(sheet.cells);
  for (var i = 0; i < keys.length; i++) {
    var pos = parseRef(keys[i]);
    if (!pos) continue;
    if (pos.col === colIndex) continue;
    var cell = sheet.cells[keys[i]];
    var newCol = pos.col > colIndex ? pos.col - 1 : pos.col;
    var rewritten = startsWithEq(cell) ? assign(cell, { raw: rewriteFormulaRefs(cell.raw, 'col', colIndex) }) : cell;
    cells[makeRef(newCol, pos.row)] = rewritten;
  }
  var next = copySheet(sheet);
  next.columns = columns;
  next.cells = cells;
  return next;
}

/* --------------------------------------------------- selection helpers */

/** grid.ts getSelectionRefs: all refs of the rectangle (row-major). */
function getSelectionRefs(anchor, end) {
  var a = parseRef(anchor);
  var b = parseRef(end);
  if (!a || !b) return [anchor];
  var minCol = Math.min(a.col, b.col);
  var maxCol = Math.max(a.col, b.col);
  var minRow = Math.min(a.row, b.row);
  var maxRow = Math.max(a.row, b.row);
  var refs = [];
  for (var r = minRow; r <= maxRow; r++) {
    for (var c = minCol; c <= maxCol; c++) refs.push(makeRef(c, r));
  }
  return refs;
}

/** grid.ts setRangeFormat. */
function setRangeFormat(sheet, refs, format) {
  var next = sheet;
  for (var i = 0; i < refs.length; i++) next = setCellFormat(next, refs[i], format);
  return next;
}

/* --------------------------------------------------------------- autofill */

/** grid.ts autofill(sheet, source, target) — rects are {minCol,maxCol,minRow,maxRow}. */
function autofill(sheet, source, target) {
  var cells = cloneCells(sheet.cells);
  var srcCols = source.maxCol - source.minCol + 1;
  var srcRows = source.maxRow - source.minRow + 1;
  var direction = target.maxRow > source.maxRow ? 'down' : 'right';
  var patternLen = direction === 'down' ? srcRows : srcCols;

  var numericStep = null;
  var numericBase = null;
  if ((direction === 'down' && srcCols === 1) || (direction === 'right' && srcRows === 1)) {
    var vals = [];
    for (var i = 0; i < patternLen; i++) {
      var ref = direction === 'down' ? makeRef(source.minCol, source.minRow + i) : makeRef(source.minCol + i, source.minRow);
      var raw = cells[ref] && cells[ref].raw !== undefined && cells[ref].raw !== null ? cells[ref].raw : '';
      var n = jsNumber(raw); // grid.ts: Number(raw)
      if (esTrim(raw) === '' || n !== n || raw.charAt(0) === '=') {
        vals.length = 0;
        break;
      }
      vals.push(n);
    }
    if (vals.length === patternLen && patternLen >= 1) {
      numericBase = vals[0];
      numericStep = patternLen >= 2 ? vals[1] - vals[0] : 1;
    }
  }

  for (var r = target.minRow; r <= target.maxRow; r++) {
    for (var c = target.minCol; c <= target.maxCol; c++) {
      var inSource = r >= source.minRow && r <= source.maxRow && c >= source.minCol && c <= source.maxCol;
      if (inSource) continue;

      var distance = direction === 'down' ? r - source.minRow : c - source.minCol;
      var patternPos = distance % patternLen;
      var srcC = direction === 'down' ? source.minCol : source.minCol + patternPos;
      var srcR = direction === 'down' ? source.minRow + patternPos : source.minRow;
      var srcCell = cells[makeRef(srcC, srcR)];
      var targetRef = makeRef(c, r);

      if (numericStep !== null && numericBase !== null) {
        var newVal = numericBase + numericStep * distance;
        cells[targetRef] = { raw: String(newVal), format: srcCell && srcCell.format ? assign(srcCell.format) : undefined };
        continue;
      }

      if (!srcCell || srcCell.raw === '') {
        delete cells[targetRef];
        continue;
      }

      var newRaw = srcCell.raw.charAt(0) === '='
        ? shiftFormulaByDelta(srcCell.raw, direction === 'right' ? c - srcC : 0, direction === 'down' ? r - srcR : 0)
        : srcCell.raw;
      cells[targetRef] = { raw: newRaw, format: srcCell.format ? assign(srcCell.format) : undefined };
    }
  }
  var next = copySheet(sheet);
  next.cells = cells;
  return next;
}

/* ------------------------------------------------------------------ paste */

/** grid.ts pasteRange: plain values from startRef; grows rows/columns. */
function pasteRange(sheet, startRef, values) {
  var start = parseRef(startRef);
  if (!start || values.length === 0) return sheet;

  var pasteRows = values.length;
  var pasteCols = 0;
  for (var i = 0; i < values.length; i++) pasteCols = Math.max(pasteCols, values[i].length);

  var next = copySheet(sheet);
  var neededRows = start.row + pasteRows;
  if (neededRows > next.numRows) next.numRows = neededRows;

  var neededCols = start.col + pasteCols;
  if (neededCols > next.columns.length) {
    var newCols = next.columns.slice();
    while (newCols.length < neededCols) {
      newCols.push({ name: newColumnName(columnNames(newCols), newCols.length), type: 'text', width: DEFAULT_COL_WIDTH });
    }
    next.columns = newCols;
  }

  var cells = {};
  var keys = Object.keys(next.cells);
  for (var k = 0; k < keys.length; k++) {
    var v = next.cells[keys[k]];
    var cc = assign(v);
    cc.format = v.format ? assign(v.format) : undefined;
    cells[keys[k]] = cc;
  }
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    for (var c = 0; c < row.length; c++) {
      var ref = makeRef(start.col + c, start.row + r);
      var existing = cells[ref] || { raw: '' };
      cells[ref] = assign(existing, { raw: row[c] });
    }
  }
  next.cells = cells;
  return next;
}

/** grid.ts pasteRangeFull: { raw, format } cells from startRef; grows rows/columns. */
function pasteRangeFull(sheet, startRef, rich) {
  var start = parseRef(startRef);
  if (!start || rich.length === 0) return sheet;
  var pasteRows = rich.length;
  var pasteCols = 0;
  for (var i = 0; i < rich.length; i++) pasteCols = Math.max(pasteCols, rich[i].length);
  var next = copySheet(sheet);
  var neededRows = start.row + pasteRows;
  if (neededRows > next.numRows) next.numRows = neededRows;
  var neededCols = start.col + pasteCols;
  if (neededCols > next.columns.length) {
    var newCols = next.columns.slice();
    while (newCols.length < neededCols) newCols.push({ name: newColumnName(columnNames(newCols), newCols.length), type: 'text', width: DEFAULT_COL_WIDTH });
    next.columns = newCols;
  }
  var cloned = {};
  var keys = Object.keys(next.cells);
  for (var k = 0; k < keys.length; k++) {
    var v = next.cells[keys[k]];
    var cc = assign(v);
    cc.format = v.format ? assign(v.format) : undefined;
    cloned[keys[k]] = cc;
  }
  for (var r = 0; r < rich.length; r++) {
    var row = rich[r];
    for (var c = 0; c < row.length; c++) {
      var ref = makeRef(start.col + c, start.row + r);
      var src = row[c];
      var fmt = src.format ? assign(src.format) : undefined;
      if (src.raw === '' && !fmt) delete cloned[ref];
      else cloned[ref] = { raw: src.raw, format: fmt };
    }
  }
  next.cells = cloned;
  return next;
}

/* -------------------------------------------- FindReplace.tsx (find + replace) */

/** FindReplace.tsx replaceOccurrences. */
function replaceOccurrences(text, search, replacement, matchCase) {
  if (!search) return text;
  if (matchCase) return text.split(search).join(replacement);
  var escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escaped, 'gi'), replacement);
}

/** FindReplace.tsx `matches`: refs whose raw contains the query, row-major. */
function findMatches(sheet, query, matchCase) {
  if (!query) return [];
  var q = matchCase ? query : query.toLowerCase();
  var refs = [];
  var keys = Object.keys(sheet.cells);
  for (var i = 0; i < keys.length; i++) {
    var cell = sheet.cells[keys[i]];
    var raw = cell && typeof cell.raw === 'string' ? cell.raw : '';
    if ((matchCase ? raw : raw.toLowerCase()).indexOf(q) >= 0) refs.push(keys[i]);
  }
  var decorated = [];
  for (var j = 0; j < refs.length; j++) decorated.push({ ref: refs[j], i: j, pos: parseRef(refs[j]) });
  decorated.sort(function (a, b) {
    var pa = a.pos;
    var pb = b.pos;
    if (!pa || !pb) return a.i - b.i;
    return pa.row - pb.row || pa.col - pb.col || a.i - b.i;
  });
  var out = [];
  for (var k = 0; k < decorated.length; k++) out.push(decorated[k].ref);
  return out;
}

module.exports = {
  DEFAULT_COL_WIDTH: DEFAULT_COL_WIDTH,
  MIN_COL_WIDTH: MIN_COL_WIDTH,
  DEFAULT_ROW_HEIGHT: DEFAULT_ROW_HEIGHT,
  MIN_ROW_HEIGHT: MIN_ROW_HEIGHT,
  assign: assign,
  colLetter: colLetter,
  letterToIndex: letterToIndex,
  makeRef: makeRef,
  parseRef: parseRef,
  esTrim: esTrim,
  jsNumber: jsNumber,
  formatValue: formatValue,
  formatNumberEnUs: formatNumberEnUs,
  formatCurrencyEnUs: formatCurrencyEnUs,
  displayCell: displayCell,
  cloneCells: cloneCells,
  setCellRaw: setCellRaw,
  setCellFormat: setCellFormat,
  setCellRawInPlace: setCellRawInPlace,
  setCellFormatInPlace: setCellFormatInPlace,
  getCellFormat: getCellFormat,
  addRow: addRow,
  addColumn: addColumn,
  renameColumn: renameColumn,
  setColumnType: setColumnType,
  setColumnWidth: setColumnWidth,
  setRowHeight: setRowHeight,
  setFreezePanes: setFreezePanes,
  shiftFormulaByDelta: shiftFormulaByDelta,
  insertRow: insertRow,
  insertColumn: insertColumn,
  deleteRow: deleteRow,
  deleteColumn: deleteColumn,
  getSelectionRefs: getSelectionRefs,
  setRangeFormat: setRangeFormat,
  autofill: autofill,
  pasteRange: pasteRange,
  pasteRangeFull: pasteRangeFull,
  replaceOccurrences: replaceOccurrences,
  findMatches: findMatches,
};
