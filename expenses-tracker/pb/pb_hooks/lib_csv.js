/// <reference path="../pb_data/types.d.ts" />
/**
 * CSV import: bank and card statement exports into expenses.
 *
 * Everything is derived from the DATA, never from header words: a column is
 * a date column because its values parse as dates, an amount column because
 * they parse as numbers. The caller (the user on the Import page, or
 * the AI agent with --date_column etc.) can override every choice. The same
 * plan() feeds the preview and the import, so what was previewed is exactly
 * what gets written.
 *
 * Duplicates are counted as a multiset: a statement with two identical
 * coffees adds both the first time and neither when re-imported.
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

const EXPENSES_ARE = ['negative', 'positive', 'all'];

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
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
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

/** No require() here: it runs for every cell, and each require costs about a millisecond. */
function validDay(y, m, d) {
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
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

// Short lowercase words written beside an amount: currency names and debit/credit marks.
const AMOUNT_WORDS = ['kr', 'zł', 'zl', 'kč', 'ft', 'fr', 'rs', 'lei', 'lv', 'лв', 'din', 'cr', 'dr'];
// Runs of anything that is not part of a written number or a currency sign.
const WORDS = /[^\s\d.,()+\-−'’$£€¥₹₩₽₺₪฿₫₱₦₴₸₡¢]+/g;

/**
 * Whether a cell is written as an amount: a number with at most a currency
 * sign, a currency code or a CR/DR mark beside it ("GBP 12.50", "12,50 zł",
 * "10.00 CR"). "Bus route 88" is text, not 88.
 */
function amountLike(v) {
  const words = v.match(WORDS) || [];
  if (words.length > 2) return false;
  return words.every((w) => w.length <= 3 && (w === w.toUpperCase() || AMOUNT_WORDS.indexOf(w.toLowerCase()) >= 0));
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
  if (!amountLike(v)) return null;
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

/* ------------------------------------------------------------------ plan */

/**
 * Read the file, work out the mapping (detected, then overridden by any
 * given option) and plan every row. opts: has_header, date_column,
 * amount_column, note_column, category_column, date_format, decimal,
 * expenses_are, currency, rate ('' = look it up), create_categories,
 * skip_duplicates.
 */
function plan(app, path, opts) {
  const u = require(`${__hooks}/lib_util.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const ex = require(`${__hooks}/lib_expenses.js`);
  const fx = require(`${__hooks}/lib_fx.js`);

  const text = readText(path);
  const delimiter = detectDelimiter(text);
  const all = parseRows(text, delimiter);
  if (all.length === 0) throw u.fail(400, 'The file has no rows.');
  const width = all.reduce((w, r) => Math.max(w, r.length), 0);

  // Header: judge column kinds from rows 2..n, then see whether row 1 fits.
  let hasHeader = opts.has_header;
  if (hasHeader === undefined) {
    hasHeader = false;
    const body = all.slice(1);
    for (let c = 0; c < width && !hasHeader; c++) {
      const first = all[0][c] === undefined ? '' : all[0][c];
      if (first === '') continue;
      const info = analyzeColumn(columnValues(body, c));
      if (info.kind === 'date' && parseDate(first, info.formats[0]) === null) hasHeader = true;
      if (info.kind === 'amount' && parseAmount(first, info.decimal) === null) hasHeader = true;
    }
    if (!hasHeader && all.length > 1 && all[0].every((v) => !/[0-9]/.test(v))) hasHeader = true;
  }
  const header = [];
  for (let c = 0; c < width; c++) {
    const h = hasHeader ? all[0][c] || '' : '';
    header.push(h !== '' ? h : 'Column ' + (c + 1));
  }
  const rows = hasHeader ? all.slice(1) : all;

  const columns = [];
  for (let c = 0; c < width; c++) {
    const vals = columnValues(rows, c);
    const distinct = {};
    for (const v of vals) distinct[v] = true;
    columns.push({
      index: c,
      name: header[c],
      samples: vals.slice(0, 3),
      filled: rows.length === 0 ? 0 : vals.length / rows.length,
      distinct: Object.keys(distinct).length,
      info: analyzeColumn(vals),
    });
  }

  // Detected mapping (data-shaped choices); explicit options win.
  const dateCols = columns.filter((c) => c.info.kind === 'date');
  const autoDate = dateCols.length > 0 ? dateCols[0].index : null;
  const amountCols = columns
    .filter((c) => c.info.kind === 'amount' && !c.info.reference && c.index !== autoDate)
    .map((c) => ({ c: c, score: (c.info.fractional ? 2 : 0) + (c.info.mixedSigns ? 2 : 0) + (c.filled >= 0.9 ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.c.index - b.c.index);
  const autoAmount = amountCols.length > 0 ? amountCols[0].c.index : null;
  const textCols = columns.filter((c) => c.info.kind === 'text').sort((a, b) => b.distinct - a.distinct || a.index - b.index);
  const autoNote = textCols.length > 0 ? textCols[0].index : null;

  const dateCol = opts.date_column !== undefined ? resolveColumn(opts.date_column, header) : autoDate;
  const amountCol = opts.amount_column !== undefined ? resolveColumn(opts.amount_column, header) : autoAmount;
  const noteCol = opts.note_column !== undefined ? resolveColumn(opts.note_column, header) : autoNote;
  const categoryCol = opts.category_column !== undefined ? resolveColumn(opts.category_column, header) : null;

  // Date format: those that read the column; the most plausible reading
  // wins (settles DD/MM against MM/DD). Still tied = ambiguous, reported.
  let dateFormats = [];
  let dateFormat = null;
  let ambiguous = false;
  if (dateCol !== null) {
    dateFormats = dateFormatsFor(columnValues(rows, dateCol));
    if (opts.date_format) {
      if (DATE_FORMATS.indexOf(opts.date_format) < 0) throw u.fail(400, 'date_format must be one of: ' + DATE_FORMATS.join(', '));
      dateFormat = opts.date_format;
    } else if (dateFormats.length > 0) {
      const today = u.today();
      const scores = {};
      let best = dateFormats[0];
      for (const f of dateFormats) {
        scores[f] = plausibility(
          rows.map((r) => parseDate(r[dateCol] || '', f)),
          today,
        );
        if (better(scores[f], scores[best])) best = f;
      }
      dateFormat = best;
      ambiguous = dateFormats.filter((f) => f !== best && !better(scores[best], scores[f])).length > 0;
    }
  }

  const amountInfo = amountCol !== null && columns[amountCol] ? columns[amountCol].info : { kind: 'text' };
  const decimal = opts.decimal || amountInfo.decimal || '.';

  // Which amounts are expenses: with both signs present, money out is negative.
  let expensesAre = opts.expenses_are;
  if (expensesAre === undefined || expensesAre === '') expensesAre = amountInfo.mixedSigns ? 'negative' : 'all';
  if (EXPENSES_ARE.indexOf(expensesAre) < 0) throw u.fail(400, 'expenses_are must be one of: ' + EXPENSES_ARE.join(', '));

  const home = ex.homeCurrency(app);
  const currency = (opts.currency || home).toUpperCase();
  if (!money.isCurrency(currency)) throw u.fail(400, 'currency must be a 3-letter ISO code such as USD');
  const exp = money.exponent(currency);
  const homeExp = money.exponent(home);
  const createCategories = opts.create_categories !== false;
  const skipDuplicates = opts.skip_duplicates !== false;
  let explicitRate = null;
  if (opts.rate !== undefined && String(opts.rate) !== '') {
    explicitRate = Number(opts.rate);
    if (!(explicitRate > 0)) throw u.fail(400, 'rate must be a positive number: ' + home + ' per 1 ' + currency);
  }

  const catByName = {};
  for (const c of ex.categoryList(app)) catByName[u.squash(c.getString('name')).toLowerCase()] = c;
  // New names are matched like existing ones: "Housing" and "housing" are one category (first spelling wins).
  const newByKey = {};

  const planned = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const item = { line: i + 1 + (hasHeader ? 1 : 0), date: null, amount: null, amount_minor: 0, note: '', category: null, status: 'new', problem: '' };
    planned.push(item);
    if (dateCol === null || amountCol === null) {
      item.status = 'invalid';
      item.problem = dateCol === null ? 'choose the date column' : 'choose the amount column';
      continue;
    }
    const a = parseAmount(r[amountCol] || '', decimal);
    if (a === 'empty') {
      item.status = 'empty';
      item.problem = 'no amount';
      continue;
    }
    if (a === null) {
      item.status = 'invalid';
      item.problem = 'amount "' + (r[amountCol] || '') + '" is not a number';
      continue;
    }
    const d = dateFormat !== null ? parseDate(r[dateCol] || '', dateFormat) : null;
    if (d === null) {
      item.status = 'invalid';
      item.problem = 'date "' + (r[dateCol] || '') + '" does not read as ' + (dateFormat || 'a date');
      continue;
    }
    item.date = d;
    const minorOrig = money.toMinor(a.text, exp);
    if (minorOrig === null || minorOrig === 0) {
      item.status = 'empty';
      item.problem = 'zero amount';
      continue;
    }
    item.note = noteCol !== null ? u.squash(r[noteCol] || '').slice(0, 200) : '';
    if ((expensesAre === 'negative' && !a.neg) || (expensesAre === 'positive' && a.neg)) {
      item.status = 'not_expense';
      item.problem = 'money in';
      item.amount = money.toMajor(minorOrig, exp);
      continue;
    }
    if (categoryCol !== null) {
      const name = u.squash(r[categoryCol] || '').slice(0, 40);
      if (name !== '') {
        const key = name.toLowerCase();
        const found = catByName[key];
        if (found) item.category = found.getString('name');
        else if (createCategories) {
          if (newByKey[key] === undefined) newByKey[key] = name;
          item.category = newByKey[key];
          item.new_category = true;
        }
      }
    }
    if (currency === home) {
      item.amount_minor = minorOrig;
    } else {
      const conv = fx.convert(app, minorOrig, currency, home, d, explicitRate);
      item.amount_minor = conv.minor;
      item.original_amount = minorOrig;
      item.original_currency = currency;
      item.fx_rate = conv.rate;
    }
    item.amount = money.toMajor(item.amount_minor, homeExp);
  }

  // Multiset duplicate check against what is already stored.
  if (skipDuplicates) {
    const keys = planned.filter((p) => p.status === 'new').map((p) => ex.dedupeKey(p.date, p.amount_minor, p.note));
    const have = ex.existingKeyCounts(app, keys);
    for (const p of planned) {
      if (p.status !== 'new') continue;
      const k = ex.dedupeKey(p.date, p.amount_minor, p.note);
      if (have[k] > 0) {
        have[k] -= 1;
        p.status = 'duplicate';
        p.problem = 'already added';
      }
    }
  }

  const counts = { rows: planned.length, new: 0, duplicate: 0, not_expense: 0, empty: 0, invalid: 0 };
  const newCategories = {};
  let total = 0;
  for (const p of planned) {
    counts[p.status] += 1;
    if (p.status === 'new') {
      total += p.amount_minor;
      if (p.new_category) newCategories[p.category] = true;
    }
  }

  return {
    delimiter: delimiter === '\t' ? 'tab' : delimiter,
    has_header: hasHeader,
    header: header,
    columns: columns.map((c) => ({ index: c.index, name: c.name, kind: c.info.kind, samples: c.samples })),
    mapping: {
      date_column: dateCol,
      amount_column: amountCol,
      note_column: noteCol,
      category_column: categoryCol,
      date_format: dateFormat,
      decimal: decimal,
      expenses_are: expensesAre,
      currency: currency,
      // The rate the caller gave (null = the day's rate is looked up), kept so the import converts as previewed.
      rate: currency === home ? null : explicitRate,
      create_categories: createCategories,
      skip_duplicates: skipDuplicates,
    },
    date_formats: dateFormats,
    date_format_ambiguous: ambiguous,
    counts: counts,
    total: money.toMajor(total, homeExp),
    total_minor: total,
    home_currency: home,
    new_categories: Object.keys(newCategories),
    planned: planned,
  };
}

/** Options from op params (strings from the CLI, real types from the UI). */
function optsFromParams(p) {
  const u = require(`${__hooks}/lib_util.js`);
  const o = {};
  if (u.str(p, 'has_header', '') !== '') o.has_header = u.bool(p, 'has_header', true);
  for (const k of ['date_column', 'amount_column', 'note_column', 'category_column']) {
    if (u.has(p, k)) o[k] = u.str(p, k, '');
  }
  const df = u.str(p, 'date_format', '');
  if (df !== '') o.date_format = df;
  const dec = u.str(p, 'decimal', '');
  if (dec !== '') {
    if (dec !== '.' && dec !== ',') throw u.fail(400, 'decimal must be "." or ","');
    o.decimal = dec;
  }
  const ea = u.str(p, 'expenses_are', '');
  if (ea !== '') o.expenses_are = ea;
  const cur = u.str(p, 'currency', '');
  if (cur !== '') o.currency = cur.toUpperCase();
  // "" or "auto" clears a rate given earlier: the day's rate is looked up again.
  if (u.has(p, 'rate')) {
    const rate = u.str(p, 'rate', '');
    o.rate = rate.toLowerCase() === 'auto' ? '' : rate;
  }
  if (u.str(p, 'create_categories', '') !== '') o.create_categories = u.bool(p, 'create_categories', true);
  if (u.str(p, 'skip_duplicates', '') !== '') o.skip_duplicates = u.bool(p, 'skip_duplicates', true);
  return o;
}

module.exports = {
  DATE_FORMATS: DATE_FORMATS,
  EXPENSES_ARE: EXPENSES_ARE,
  readText: readText,
  parseRows: parseRows,
  parseDate: parseDate,
  parseAmount: parseAmount,
  detectDecimal: detectDecimal,
  plan: plan,
  optsFromParams: optsFromParams,
};
