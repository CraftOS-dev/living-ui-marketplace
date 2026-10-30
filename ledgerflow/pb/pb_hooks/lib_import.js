/// <reference path="../pb_data/types.d.ts" />
/**
 * Bank statement import: files in, staged lines out (the inbox).
 *
 * Formats: OFX/QFX (SGML 1.x and XML 2.x), QIF, CSV (with a column mapping
 * detected from the header and remembered per bank account), ISO 20022
 * CAMT.053 and SWIFT MT940.
 *
 * Duplicates are stopped in three layers:
 *   1. the same file (content hash) is not imported twice into an account;
 *   2. each line has a fingerprint: the bank's own id (OFX FITID, CAMT entry
 *      reference, MT940 bank reference) or a hash of date, amount and text
 *      plus its occurrence among identical lines of the file, so two equal
 *      coffees on one day both stay and re-importing an overlapping file
 *      reproduces the same fingerprints;
 *   3. lines that look like entries already in the books (typed by hand)
 *      are offered as matches in the inbox instead of new transactions.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ---------------------------------------------------------------- helpers */

function cleanText(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOISE = [
  /^(pos|eftpos|debit card|card purchase|purchase|visa debit|visa|mastercard|mc|contactless|card|dd|so|bacs|fpo|fpi|tfr|transfer to|transfer from|payment to|payment from|direct debit|standing order|ach|ach debit|ach credit|online payment|bill payment|recurring payment)\s+/i,
  /\s+(\d{2}[\/.-]\d{2}([\/.-]\d{2,4})?)\s*$/,
  /\s+x{2,}\d{2,4}\b/gi,
  /\s+\*+\d{2,4}\b/g,
  /\s+card\s*\d{4}\b/gi,
  /\s+ref[:#]?\s*\S+$/i,
  /\s+\d{6,}\s*$/,
];

/** A readable payee from a bank description ("POS 12/03 STARBUCKS #123 XXXX1234" -> "Starbucks"). */
function payeeOf(desc) {
  let s = cleanText(desc);
  for (let k = 0; k < 3; k++) for (const re of NOISE) s = s.replace(re, ' ').trim();
  s = s.replace(/[#*]\s*\d+\b/g, '').replace(/\s{2,}/g, ' ').trim();
  if (s === '') s = cleanText(desc);
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) {
    s = s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  return s.slice(0, 160);
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Parse a decimal amount with either "." or "," as the decimal mark. */
function amountOf(text, currency) {
  const money = require(`${__hooks}/lib_money.js`);
  let s = String(text || '').trim();
  if (s === '') return null;
  // "1.234,56" or "1 234,56" -> decimal comma.
  if (/,\d{1,3}$/.test(s) && (s.indexOf('.') < 0 || s.lastIndexOf('.') < s.lastIndexOf(','))) s = s.replace(/[.\s]/g, '').replace(',', '.');
  s = s.replace(/[^\d.\-()+]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  return money.parse(s, currency, 'amount');
}

/** Dates in the many shapes banks write them. fmt: 'auto'|'ymd'|'dmy'|'mdy'. */
function dateOf(text, fmt) {
  const s = String(text || '').trim();
  // Year first is never ambiguous, whatever order the other dates use.
  let m = /^(\d{4})[-\/.]?(\d{2})[-\/.]?(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-'](\d{2,4})/.exec(s);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let day = a;
    let mon = b;
    if (fmt === 'mdy' || (fmt !== 'dmy' && a <= 12 && b > 12)) {
      day = b;
      mon = a;
    }
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return '';
    return y + '-' + (mon < 10 ? '0' : '') + mon + '-' + (day < 10 ? '0' : '') + day;
  }
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = /^(\d{1,2})[\s\-]([a-z]{3})[a-z]*[\s\-,]+(\d{2,4})/i.exec(s);
  if (m && months[m[2].toLowerCase()]) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const mon = months[m[2].toLowerCase()];
    const day = Number(m[1]);
    return y + '-' + (mon < 10 ? '0' : '') + mon + '-' + (day < 10 ? '0' : '') + day;
  }
  m = /^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i.exec(s);
  if (m && months[m[1].toLowerCase()]) {
    const mon = months[m[1].toLowerCase()];
    const day = Number(m[2]);
    return m[3] + '-' + (mon < 10 ? '0' : '') + mon + '-' + (day < 10 ? '0' : '') + day;
  }
  return '';
}

/** Which of D/M or M/D a column of dates uses ('ambiguous' when nothing decides). */
function dayOrder(samples) {
  let dmy = false;
  let mdy = false;
  let ymd = 0;
  let other = 0;
  for (const s of samples) {
    if (/^\d{4}[-\/.]?\d{2}[-\/.]?\d{2}/.test(String(s).trim())) {
      ymd++;
      continue;
    }
    other++;
    const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-']/.exec(String(s).trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (ymd > 0 && other === 0) return 'ymd';
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return dmy && mdy ? 'mixed' : 'ambiguous';
}

/* -------------------------------------------------------------------- OFX */

function tag(block, name) {
  const m = new RegExp('<' + name + '>([^<\\r\\n]*)', 'i').exec(block);
  return m ? cleanText(m[1]) : '';
}

function parseOfx(text, currency) {
  const ccy = tag(text, 'CURDEF') || currency;
  const lines = [];
  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const b = m[1];
    const d = tag(b, 'DTPOSTED') || tag(b, 'DTUSER');
    const amt = tag(b, 'TRNAMT');
    if (d === '' || amt === '') continue;
    const name = tag(b, 'NAME') || tag(b, 'PAYEE');
    const memo = tag(b, 'MEMO');
    const desc = name !== '' && memo !== '' && memo !== name ? name + ' · ' + memo : name || memo || tag(b, 'TRNTYPE');
    lines.push({
      date: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8),
      amount: amountOf(amt, ccy),
      description: desc,
      payee: payeeOf(name || memo),
      bank_id: tag(b, 'FITID'),
      raw: b.replace(/\s+/g, ' ').trim().slice(0, 4000),
    });
  }
  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i.exec(text);
  const balances = {};
  if (ledger) {
    const amt = tag(ledger[1], 'BALAMT');
    const d = tag(ledger[1], 'DTASOF');
    if (amt !== '') {
      balances.closing = amountOf(amt, ccy);
      if (d !== '') balances.date = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
    }
  }
  const start = tag(text, 'DTSTART');
  const end = tag(text, 'DTEND');
  return {
    format: 'ofx',
    currency: ccy,
    lines: lines,
    balances: balances,
    period_from: start ? start.slice(0, 4) + '-' + start.slice(4, 6) + '-' + start.slice(6, 8) : '',
    period_to: end ? end.slice(0, 4) + '-' + end.slice(4, 6) + '-' + end.slice(6, 8) : '',
  };
}

/* -------------------------------------------------------------------- QIF */

function parseQif(text, currency, opts) {
  const records = [];
  let cur = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line === '' || line.charAt(0) === '!') continue;
    const code = line.charAt(0);
    const val = line.slice(1).trim();
    if (code === '^') {
      if (cur.D !== undefined) records.push(cur);
      cur = {};
      continue;
    }
    if (code === 'D' || code === 'T' || code === 'U' || code === 'P' || code === 'M' || code === 'N' || code === 'L') {
      if (cur[code] === undefined) cur[code] = val;
    }
  }
  if (cur.D !== undefined) records.push(cur);
  const order = opts && opts.date_order ? opts.date_order : dayOrder(records.map((r) => r.D));
  const fmt = order === 'dmy' || order === 'mdy' ? order : (opts && opts.prefer) || 'mdy';
  return {
    format: 'qif',
    currency: currency,
    date_order: order,
    lines: records
      .filter((r) => r.T !== undefined || r.U !== undefined)
      .map((r) => ({
        date: dateOf(r.D, fmt),
        amount: amountOf(r.T !== undefined ? r.T : r.U, currency),
        description: [r.P, r.M].filter((x) => x).join(' · '),
        payee: payeeOf(r.P || r.M),
        bank_id: '',
        raw: Object.keys(r)
          .map((k) => k + r[k])
          .join(' | '),
      })),
    balances: {},
  };
}

/* -------------------------------------------------------------------- CSV */

function splitCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

function guessDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  let best = ',';
  let n = 0;
  for (const d of [',', ';', '\t', '|']) {
    const k = head.split(d).length;
    if (k > n) {
      n = k;
      best = d;
    }
  }
  return best;
}

const HEADS = {
  date: /^(date|posted|posting date|transaction date|trans date|booking date|value date|txn date|datum)$/i,
  amount: /^(amount|value|amt|transaction amount|betrag|montant|amount \(\w+\))$/i,
  debit: /^(debit|debits|withdrawal|withdrawals|money out|paid out|out|outflow|spent|debit amount)$/i,
  credit: /^(credit|credits|deposit|deposits|money in|paid in|in|inflow|received|credit amount)$/i,
  description: /^(description|details|narrative|memo|transaction description|particulars|text|remarks|reference text)$/i,
  payee: /^(payee|merchant|name|counterparty|beneficiary|description 1)$/i,
  bank_id: /^(id|transaction id|reference|ref|fitid|bank reference|transaction reference)$/i,
  balance: /^(balance|running balance|closing balance)$/i,
};

/** A column mapping guessed from the header row. */
function guessMapping(header, rows) {
  const map = { header: true, date: -1, amount: -1, debit: -1, credit: -1, description: [], payee: -1, bank_id: -1, balance: -1, flip: false, date_order: 'auto' };
  header.forEach((h, i) => {
    const s = String(h).trim();
    if (map.date < 0 && HEADS.date.test(s)) map.date = i;
    else if (map.amount < 0 && HEADS.amount.test(s)) map.amount = i;
    else if (map.debit < 0 && HEADS.debit.test(s)) map.debit = i;
    else if (map.credit < 0 && HEADS.credit.test(s)) map.credit = i;
    else if (map.payee < 0 && HEADS.payee.test(s)) map.payee = i;
    else if (map.bank_id < 0 && HEADS.bank_id.test(s)) map.bank_id = i;
    else if (map.balance < 0 && HEADS.balance.test(s)) map.balance = i;
    else if (HEADS.description.test(s)) map.description.push(i);
  });
  if (map.description.length === 0 && map.payee >= 0) map.description = [map.payee];
  // Headerless file: guess by content.
  if (map.date < 0) {
    // A header row has no dates in it; a data row does.
    map.header = !header.some((h) => dateOf(h, 'auto') !== '');
    const sample = map.header ? rows[0] || header : header;
    sample.forEach((v, i) => {
      if (map.date < 0 && dateOf(v, 'auto') !== '') map.date = i;
      else if (map.amount < 0 && amountOfSafe(v) !== null) map.amount = i;
      else if (map.description.length === 0 && /[a-z]/i.test(v)) map.description = [i];
    });
  }
  const dates = (map.header ? rows : [header].concat(rows)).map((r) => r[map.date]).filter((x) => x !== undefined);
  const order = dayOrder(dates);
  map.date_order = order === 'dmy' || order === 'mdy' ? order : 'auto';
  map.date_order_ambiguous = order === 'ambiguous' || order === 'mixed';
  return map;
}

function amountOfSafe(v) {
  try {
    return /\d/.test(String(v)) && /^[\s\d.,\-()+$€£¥]*$/.test(String(v)) ? amountOf(v, 'USD') : null;
  } catch {
    return null;
  }
}

function parseCsv(text, currency, mapping, prefer) {
  const delim = (mapping && mapping.delimiter) || guessDelimiter(text);
  const all = splitCsv(text.replace(/^﻿/, ''), delim);
  if (all.length === 0) throw fail(400, 'The file has no rows');
  const skip = (mapping && mapping.skip) || 0;
  const rows0 = all.slice(skip);
  const header = rows0[0];
  const map = Object.assign(guessMapping(header, rows0.slice(1)), mapping || {});
  map.delimiter = delim;
  const body = map.header ? rows0.slice(1) : rows0;
  if (map.date < 0 || (map.amount < 0 && map.debit < 0 && map.credit < 0)) {
    return { format: 'csv', currency: currency, mapping: map, header: header, needs_mapping: true, lines: [], balances: {} };
  }
  // Dates that fit both D/M and M/D: the bank's country decides (USD banks
  // write month first); the choice is reported so it can be confirmed.
  const fmt = map.date_order === 'dmy' || map.date_order === 'mdy' ? map.date_order : prefer || 'dmy';
  if (map.date_order !== 'dmy' && map.date_order !== 'mdy' && map.date_order_ambiguous) map.date_order_used = fmt;
  const lines = [];
  let lastBalance = null;
  let lastDate = '';
  for (const r of body) {
    const date = dateOf(r[map.date], fmt);
    if (date === '') continue;
    let amt = null;
    if (map.amount >= 0) amt = amountOf(r[map.amount], currency);
    else {
      const out = map.debit >= 0 ? amountOf(r[map.debit], currency) : null;
      const inn = map.credit >= 0 ? amountOf(r[map.credit], currency) : null;
      if (out === null && inn === null) continue;
      amt = (inn || 0) - Math.abs(out || 0);
    }
    if (amt === null) continue;
    if (map.flip) amt = -amt;
    const descCols = Array.isArray(map.description) ? map.description : [map.description];
    const desc = descCols
      .map((i) => cleanText(r[i]))
      .filter((x) => x !== '')
      .join(' · ');
    const payeeText = map.payee >= 0 ? cleanText(r[map.payee]) : desc;
    if (map.balance >= 0 && r[map.balance] !== undefined && String(r[map.balance]).trim() !== '' && date >= lastDate) {
      try {
        lastBalance = amountOf(r[map.balance], currency);
        lastDate = date;
      } catch {
        /* not a number */
      }
    }
    lines.push({ date: date, amount: amt, description: desc, payee: payeeOf(payeeText), bank_id: map.bank_id >= 0 ? cleanText(r[map.bank_id]) : '', raw: r.join(' | ').slice(0, 4000) });
  }
  const balances = {};
  if (lastBalance !== null) {
    balances.closing = lastBalance;
    balances.date = lastDate;
  }
  return { format: 'csv', currency: currency, mapping: map, header: header, lines: lines, balances: balances };
}

/* ------------------------------------------------------------- CAMT / MT940 */

function xml(block, path) {
  let cur = block;
  for (const name of path) {
    const m = new RegExp('<' + name + '(\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(cur);
    if (!m) return '';
    cur = m[2];
  }
  return cleanText(cur.replace(/<[^>]+>/g, ' '));
}

function parseCamt(text, currency) {
  const stmt = /<Stmt>([\s\S]*?)<\/Stmt>/i.exec(text);
  const body = stmt ? stmt[1] : text;
  const ccyM = /<Acct>[\s\S]*?<Ccy>([A-Z]{3})<\/Ccy>/i.exec(body);
  const ccy = ccyM ? ccyM[1] : currency;
  const balances = {};
  const bre = /<Bal>([\s\S]*?)<\/Bal>/gi;
  let b;
  while ((b = bre.exec(body)) !== null) {
    const code = xml(b[1], ['Tp', 'CdOrPrtry', 'Cd']);
    const amt = /<Amt[^>]*>([^<]+)<\/Amt>/i.exec(b[1]);
    if (!amt) continue;
    let v = amountOf(amt[1], ccy);
    if (xml(b[1], ['CdtDbtInd']) === 'DBIT') v = -v;
    const dm = /<Dt>\s*<(?:Dt|DtTm)>(\d{4}-\d{2}-\d{2})/i.exec(b[1]);
    const d = dm ? dm[1] : '';
    if (code === 'OPBD' || code === 'PRCD') balances.opening = v;
    if (code === 'CLBD') {
      balances.closing = v;
      balances.date = d;
    }
  }
  const lines = [];
  const ere = /<Ntry>([\s\S]*?)<\/Ntry>/gi;
  let e;
  while ((e = ere.exec(body)) !== null) {
    const n = e[1];
    const amt = /<Amt[^>]*>([^<]+)<\/Amt>/i.exec(n);
    if (!amt) continue;
    let v = amountOf(amt[1], ccy);
    const debit = xml(n, ['CdtDbtInd']) === 'DBIT';
    if (debit) v = -v;
    const d = xml(n, ['BookgDt', 'Dt']) || xml(n, ['BookgDt', 'DtTm']).slice(0, 10) || xml(n, ['ValDt', 'Dt']);
    const party = debit ? xml(n, ['RltdPties', 'Cdtr', 'Nm']) || xml(n, ['RltdPties', 'Cdtr', 'Pty', 'Nm']) : xml(n, ['RltdPties', 'Dbtr', 'Nm']) || xml(n, ['RltdPties', 'Dbtr', 'Pty', 'Nm']);
    const info = xml(n, ['RmtInf', 'Ustrd']) || xml(n, ['AddtlNtryInf']);
    lines.push({
      date: d,
      amount: v,
      description: [party, info].filter((x) => x).join(' · '),
      payee: payeeOf(party || info),
      bank_id: xml(n, ['AcctSvcrRef']) || xml(n, ['NtryRef']),
      raw: n.replace(/\s+/g, ' ').trim().slice(0, 4000),
    });
  }
  return { format: 'camt', currency: ccy, lines: lines, balances: balances };
}

function mtAmount(s) {
  return s.replace(',', '.');
}

function parseMt940(text, currency) {
  const balances = {};
  const lines = [];
  let ccy = currency;
  const blocks = text.split(/\r?\n(?=:\d{2}[A-Z]?:)/);
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i].replace(/\r?\n/g, ' ');
    let m = /^:60[FM]:([CD])(\d{6})([A-Z]{3})([\d,]+)/.exec(blk);
    if (m) {
      ccy = m[3];
      balances.opening = (m[1] === 'D' ? -1 : 1) * amountOf(mtAmount(m[4]), ccy);
      continue;
    }
    m = /^:62[FM]:([CD])(\d{6})([A-Z]{3})([\d,]+)/.exec(blk);
    if (m) {
      balances.closing = (m[1] === 'D' ? -1 : 1) * amountOf(mtAmount(m[4]), ccy);
      balances.date = '20' + m[2].slice(0, 2) + '-' + m[2].slice(2, 4) + '-' + m[2].slice(4, 6);
      continue;
    }
    m = /^:61:(\d{6})(\d{4})?(R?[CD])[A-Z]?([\d,]+)N?\w{3}([^\/\s]*)(\/\/(\S+))?(.*)$/.exec(blk);
    if (m) {
      const sign = m[3].indexOf('D') >= 0 !== (m[3].charAt(0) === 'R') ? -1 : 1;
      let desc = (m[8] || '').trim();
      const next = blocks[i + 1] || '';
      if (/^:86:/.test(next)) {
        desc = (desc + ' ' + next.slice(4).replace(/\r?\n/g, ' ')).trim();
        i++;
      }
      lines.push({
        date: '20' + m[1].slice(0, 2) + '-' + m[1].slice(2, 4) + '-' + m[1].slice(4, 6),
        amount: sign * amountOf(mtAmount(m[4]), ccy),
        description: cleanText(desc.replace(/\?\d{2}/g, ' ')),
        payee: payeeOf(desc.replace(/\?\d{2}/g, ' ')),
        bank_id: m[7] || m[5] || '',
        raw: blk.slice(0, 4000),
      });
    }
  }
  return { format: 'mt940', currency: ccy, lines: lines, balances: balances };
}

/* ------------------------------------------------------------------ parse */

function detect(name, text) {
  const n = String(name || '').toLowerCase();
  const head = text.slice(0, 2000);
  if (/<OFX>|OFXHEADER/i.test(head) || /\.(ofx|qfx)$/.test(n)) return 'ofx';
  if (/BkToCstmrStmt|camt\.053/i.test(head) || (/\.xml$/.test(n) && /<Ntry>/i.test(text))) return 'camt';
  if (/^\s*!Type:/im.test(head) || /\.qif$/.test(n)) return 'qif';
  if (/^:20:|^\{1:/m.test(head) || /\.(sta|mt940|940)$/.test(n)) return 'mt940';
  return 'csv';
}

function parse(text, name, currency, opts) {
  const o = opts || {};
  const format = o.format || detect(name, text);
  let out;
  if (format === 'ofx') out = parseOfx(text, currency);
  else if (format === 'qif') out = parseQif(text, currency, Object.assign({ prefer: currency === 'USD' ? 'mdy' : 'dmy' }, o));
  else if (format === 'camt') out = parseCamt(text, currency);
  else if (format === 'mt940') out = parseMt940(text, currency);
  else out = parseCsv(text, currency, o.mapping, o.prefer || (currency === 'USD' ? 'mdy' : 'dmy'));
  out.lines = out.lines.filter((l) => l.date !== '' && l.amount !== null);
  if (out.lines.length > 0) {
    const ds = out.lines.map((l) => l.date).sort();
    if (!out.period_from) out.period_from = ds[0];
    if (!out.period_to) out.period_to = ds[ds.length - 1];
  }
  return out;
}

/** Fingerprints for parsed lines (bank id, else content hash + occurrence). */
function fingerprints(lines) {
  const seen = {};
  for (const l of lines) {
    if (l.bank_id) {
      l.fingerprint = 'id:' + l.bank_id.slice(0, 120);
      continue;
    }
    const base = l.date + '|' + l.amount + '|' + norm(l.description);
    seen[base] = (seen[base] || 0) + 1;
    l.fingerprint = 'h:' + $security.sha256(base).slice(0, 32) + '#' + seen[base];
  }
  return lines;
}

module.exports = { payeeOf: payeeOf, norm: norm, dateOf: dateOf, dayOrder: dayOrder, splitCsv: splitCsv, guessMapping: guessMapping, detect: detect, parse: parse, fingerprints: fingerprints };
