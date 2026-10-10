/// <reference path="../pb_data/types.d.ts" />
/**
 * CSV text in and out: RFC 4180 parsing (quoted fields, doubled quotes,
 * CRLF or LF), delimiter detection, and writing rows back as CSV.
 */

function readText(path) {
  const u = require(`${__hooks}/lib_util.js`);
  let text = toString($os.readFile(path));
  if (text.indexOf('\u0000') >= 0) {
    throw u.fail(400, 'This file is UTF-16 text. Save it as "CSV UTF-8" (or plain CSV) and try again.');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** Parse CSV text. Blank rows are dropped; cells are trimmed. */
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

function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Rows (arrays of values) -> CSV text with CRLF line ends. */
function toCsv(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { readText: readText, parseRows: parseRows, detectDelimiter: detectDelimiter, toCsv: toCsv };
