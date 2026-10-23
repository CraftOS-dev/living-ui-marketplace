/// <reference path="../pb_data/types.d.ts" />
/**
 * CSV reading and writing shared by imports and exports.
 *
 * Columns are judged from their DATA, never from header words: a column is a
 * date column because its values parse as dates, an amount column because
 * they parse as numbers. Callers can override every choice. (Adapted from the
 * Expenses tracker's statement reader.)
 */

// Numeric date layouts: separator and field order. Y4 = 4-digit year, Y2 = 2-digit.
const NUMERIC_FORMATS = {
  'YYYY-MM-DD': { sep: '-', order: ['Y4', 'M', 'D'] },
  'YYYY/MM/DD': { sep: '/', order: ['Y4', 'M', 'D'] },
  'YYYY.MM.DD': { sep: '.', order: ['Y4', 'M', 'D'] },
  'DD/MM/YYYY': { sep: '/', order: ['D', 'M', 'Y4'] },
  'MM/DD/YYYY': { sep: '/', order: ['M', 'D', 'Y4'] },
  'DD-MM-YYYY': { sep: '-', order: ['D', 'M', 'Y4'] },
  'MM-DD-YYYY': { sep: '-', order: ['M', 'D', 'Y4'] },
  'DD.MM.YYYY': { sep: '.', order: ['D', 'M', 'Y4'] },
  'DD/MM/YY': { sep: '/', order: ['D', 'M', 'Y2'] },
  'MM/DD/YY': { sep: '/', order: ['M', 'D', 'Y2'] },
  'DD-MM-YY': { sep: '-', order: ['D', 'M', 'Y2'] },
  'DD.MM.YY': { sep: '.', order: ['D', 'M', 'Y2'] },
};

const DATE_FORMATS = Object.keys(NUMERIC_FORMATS).concat(['D MMM YYYY', 'MMM D YYYY', 'YYYYMMDD']);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/* ------------------------------------------------------------------ text */

function readText(path) {
  const u = require(`${__hooks}/lib_util.js`);
  let text = toString($os.readFile(path));
  if (text.indexOf('\u0000') >= 0) {
    throw u.fail(400, 'This file is UTF-16 text. Save it as "CSV UTF-8" (or plain CSV) and try again.');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** RFC 4180 parse: quoted fields, doubled quotes, CRLF or LF. Blank rows dropped. */
function parseRows(text, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A cell an export guarded against formulas ("'=...") reads back as it was typed.
  return rows.map((r) => r.map((c) => c.trim()).map((c) => (/^'[=+\-@]/.test(c) ? c.slice(1) : c))).filter((r) => r.some((c) => c !== ''));
}

/** The delimiter that splits the first lines into the same, largest field count. */
function detectDelimiter(text) {
  const sample = text.slice(0, 20000);
  let best = ',';
  let bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const rows = parseRows(sample, d).slice(0, 12);
    if (rows.length === 0) continue;
    const first = rows[0].length;
    if (first < 2) continue;
    const same = rows.filter((r) => r.length === first).length;
    const score = same * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ dates */

function validDay(y, m, d) {
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return y + '-' + pad(m) + '-' + pad(d);
}

function year2(yy) {
  return yy < 70 ? 2000 + yy : 1900 + yy;
}

function monthIndex(word) {
  const i = MONTHS.indexOf(String(word).slice(0, 3).toLowerCase());
  return i + 1;
}

/** Parse one cell with one format into 'YYYY-MM-DD', or null. A trailing time is ignored. */
function parseDate(value, fmt) {
  const v = String(value).trim();
  if (v === '') return null;
  if (fmt === 'YYYYMMDD') {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    return m ? validDay(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  }
  if (fmt === 'D MMM YYYY') {
    const m = /^(\d{1,2})[ \-]([A-Za-z]{3,9})\.?[ \-,]+(\d{4}|\d{2})(?:[ T].*)?$/.exec(v);
    if (!m) return null;
    const mon = monthIndex(m[2]);
    if (mon === 0) return null;
    const y = m[3].length === 2 ? year2(Number(m[3])) : Number(m[3]);
    return validDay(y, mon, Number(m[1]));
  }
  if (fmt === 'MMM D YYYY') {
    const m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})(?:[ T].*)?$/.exec(v);
    if (!m) return null;
    const mon = monthIndex(m[1]);
    if (mon === 0) return null;
    return validDay(Number(m[3]), mon, Number(m[2]));
  }
  const spec = NUMERIC_FORMATS[fmt];
  if (!spec) return null;
  const head = v.split(' ')[0].split('T')[0];
  const parts = head.split(spec.sep);
  if (parts.length !== 3) return null;
  let y = 0;
  let mo = 0;
  let d = 0;
  for (let i = 0; i < 3; i++) {
    const raw = parts[i];
    if (!/^\d+$/.test(raw)) return null;
    const token = spec.order[i];
    if (token === 'Y4') {
      if (raw.length !== 4) return null;
      y = Number(raw);
    } else if (token === 'Y2') {
      if (raw.length !== 2) return null;
      y = year2(Number(raw));
    } else {
      if (raw.length > 2) return null;
      if (token === 'M') mo = Number(raw);
      else d = Number(raw);
    }
  }
  return validDay(y, mo, d);
}

/** Date formats that read at least 95% of the values. */
function dateFormatsFor(values) {
  if (values.length === 0) return [];
  const ok = [];
  for (const f of DATE_FORMATS) {
    let n = 0;
    for (const v of values) if (parseDate(v, f) !== null) n++;
    if (n / values.length >= 0.95) ok.push(f);
  }
  return ok;
}

/* ---------------------------------------------------------------- amounts */

/** Keep only the characters a number is written with (drops symbols, codes, spaces). */
function numericChars(v) {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    const ch = v.charAt(i);
    if ((ch >= '0' && ch <= '9') || ch === '.' || ch === ',' || ch === '-' || ch === '(' || ch === ')' || ch === '+') out += ch;
    else if (ch === '−') out += '-';
  }
  return out;
}

function digitsAfter(s, idx) {
  let n = 0;
  for (let i = idx + 1; i < s.length; i++) if (s.charAt(i) >= '0' && s.charAt(i) <= '9') n++;
  return n;
}

/**
 * Which separator is the decimal point in one column: '.' or ','.
 * "1,234.50" and "1.234,50" decide by the last separator; a lone separator
 * followed by 1 or 2 digits is a decimal point; repeated ones are grouping.
 */
function detectDecimal(values) {
  let dot = 0;
  let comma = 0;
  for (const raw of values) {
    const s = numericChars(raw);
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastComma > lastDot) comma++;
      else dot++;
    } else if (lastComma >= 0) {
      if (s.split(',').length > 2) dot++;
      else if (digitsAfter(s, lastComma) <= 2) comma++;
    } else if (lastDot >= 0) {
      if (s.split('.').length > 2) comma++;
      else if (digitsAfter(s, lastDot) <= 2) dot++;
    }
  }
  return comma > dot ? ',' : '.';
}

/**
 * One amount cell -> { neg, text } with text a plain decimal ("1234.50"),
 * 'empty' for a blank cell, or null when it is not a number.
 */
function parseAmount(value, decimal) {
  const v = String(value).trim();
  if (v === '') return 'empty';
  let s = numericChars(v);
  if (!/[0-9]/.test(s)) return null;
  let neg = false;
  if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.charAt(0) === '-') {
    neg = !neg;
    s = s.slice(1);
  } else if (s.charAt(0) === '+') {
    s = s.slice(1);
  }
  if (s.charAt(s.length - 1) === '-') {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (decimal === ',') s = s.split('.').join('').split(',').join('.');
  else s = s.split(',').join('');
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  return { neg: neg, text: s };
}

/* ---------------------------------------------------------------- columns */

function columnValues(rows, c) {
  const out = [];
  for (const r of rows) {
    const v = r[c] === undefined ? '' : r[c];
    if (v !== '') out.push(v);
  }
  return out;
}

/** What a column holds, judged from its values. */
function analyzeColumn(values) {
  if (values.length === 0) return { kind: 'empty' };
  const formats = dateFormatsFor(values);
  // A run of 8-digit numbers counts as dates only when every one is a real day.
  if (formats.length > 0) return { kind: 'date', formats: formats };
  const decimal = detectDecimal(values);
  let n = 0;
  let frac = false;
  let negs = 0;
  let pos = 0;
  let bigInts = 0;
  for (const v of values) {
    const a = parseAmount(v, decimal);
    if (a === null || a === 'empty') continue;
    n++;
    if (a.text.indexOf('.') >= 0) frac = true;
    if (a.neg) negs++;
    else pos++;
    if (a.text.indexOf('.') < 0 && a.text.length >= 6) bigInts++;
  }
  if (n / values.length >= 0.95) {
    return { kind: 'amount', decimal: decimal, fractional: frac, mixedSigns: negs > 0 && pos > 0, reference: bigInts === n };
  }
  return { kind: 'text' };
}

/** Column param: an index ("2") or a header name (exact, case ignored); "" or "none" = no column. */
function resolveColumn(value, header) {
  const u = require(`${__hooks}/lib_util.js`);
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (v === '' || v.toLowerCase() === 'none') return null;
  if (/^\d+$/.test(v)) {
    const i = Number(v);
    if (i >= header.length) throw u.fail(400, 'Column ' + i + ' does not exist; the file has columns 0 to ' + (header.length - 1) + '.');
    return i;
  }
  const want = u.squash(v).toLowerCase();
  for (let i = 0; i < header.length; i++) {
    if (u.squash(header[i]).toLowerCase() === want) return i;
  }
  throw u.fail(400, 'No column named "' + v + '". Columns: ' + header.map((h, i) => i + '=' + h).join(', '));
}

/**
 * How plausible one reading of a date column is, as [out of order, future,
 * span in days]; lower is better, compared in that order. A statement is
 * sorted, lies in the past and covers weeks, not months: "10/01, 10/02,
 * 10/03" reads as three October days (span 2) rather than January to March.
 */
function plausibility(days, today) {
  let up = 0;
  let down = 0;
  let future = 0;
  let min = null;
  let max = null;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d === null) continue;
    if (d > today) future++;
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
    const prev = i > 0 ? days[i - 1] : null;
    if (prev === null) continue;
    if (d < prev) up++;
    if (d > prev) down++;
  }
  const t = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const span = min === null ? 0 : Math.round((t(max) - t(min)) / 86400000);
  return [Math.min(up, down), future, span];
}

function better(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** The text of a stored file (an upload or an import record's file). */
function readStored(app, rec, field) {
  return readText(require(`${__hooks}/lib_util.js`).filePath(app, rec, field));
}

/**
 * Rows to CSV text (RFC 4180 quoting, CRLF line ends). Text that a
 * spreadsheet would run as a formula (a name like "=HYPERLINK(...)" typed
 * into the app) gets a leading apostrophe; numbers such as -125.00 stay
 * numbers. parseRows takes the apostrophe off again, so exports re-import.
 */
function toCsv(rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^[-+]?\d[\d,]*(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.split('"').join('""') + '"' : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Parse a whole text: delimiter detected, header row kept as row 0. */
function table(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  return { delimiter: d, rows: parseRows(text, d) };
}

module.exports = {
  DATE_FORMATS: DATE_FORMATS,
  readText: readText,
  readStored: readStored,
  parseRows: parseRows,
  detectDelimiter: detectDelimiter,
  parseDate: parseDate,
  dateFormatsFor: dateFormatsFor,
  detectDecimal: detectDecimal,
  parseAmount: parseAmount,
  columnValues: columnValues,
  analyzeColumn: analyzeColumn,
  resolveColumn: resolveColumn,
  plausibility: plausibility,
  better: better,
  toCsv: toCsv,
  table: table,
};
