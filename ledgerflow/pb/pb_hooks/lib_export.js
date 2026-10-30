/// <reference path="../pb_data/types.d.ts" />
/**
 * Export the books as plain text: Beancount, hledger journal, or CSV of
 * every posting. The plain-text formats open in Fava, hledger-web and any
 * text editor, so the books never depend on this app.
 */

const ROOT = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Beancount-safe account names: Type:Name-Words, unique. */
function accountNames(app) {
  const out = {};
  const used = {};
  for (const a of app.findRecordsByFilter('accounts', 'id != ""', 'code', 0, 0)) {
    const words = a
      .getString('name')
      .replace(/[’']/g, '')
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w !== '')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    let leaf = words.join('-') || 'Account';
    if (!/^[A-Z0-9]/.test(leaf)) leaf = 'A' + leaf;
    let name = ROOT[a.getString('type')] + ':' + leaf;
    if (used[name]) name = name + '-' + a.getString('code');
    used[name] = true;
    out[a.id] = { name: name, currency: a.getString('currency'), created: a.getString('created').slice(0, 10) };
  }
  return out;
}

function quote(s) {
  return '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
}

function postingRows(app, from, to) {
  const rows = arrayOf(new DynamicModel({ txn: '', date: '', narration: '', contact: '', reference: '', kind: '', account: '', amount: 0, currency: '', home_amount: 0, memo: '', tax_code: '', recon_state: '', line: 0 }));
  app
    .db()
    .newQuery(
      "SELECT p.txn AS txn, p.date AS date, t.narration AS narration, t.contact AS contact, t.reference AS reference, t.kind AS kind, p.account AS account, p.amount AS amount, p.currency AS currency, p.home_amount AS home_amount, p.memo AS memo, p.tax_code AS tax_code, p.recon_state AS recon_state, p.line AS line FROM postings p JOIN transactions t ON t.id = p.txn WHERE p.status = 'posted' AND p.date >= {:f} AND p.date <= {:t} ORDER BY p.date, t.created, p.txn, p.line",
    )
    .bind({ f: from, t: to })
    .all(rows);
  return rows;
}

function contactNames(app) {
  const out = {};
  for (const c of app.findRecordsByFilter('contacts', 'id != ""', '', 0, 0)) out[c.id] = c.getString('name');
  return out;
}

function grouped(rows) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (!cur || cur.txn !== r.txn) {
      cur = { txn: r.txn, date: r.date, narration: r.narration, contact: r.contact, reference: r.reference, kind: r.kind, postings: [] };
      out.push(cur);
    }
    cur.postings.push(r);
  }
  return out;
}

/** Text for one posting amount: foreign amounts carry their home total price. */
function amountText(money, p, home, style) {
  if (p.currency === home || p.currency === '') return money.toDecimal(p.amount, home) + ' ' + home;
  if (p.amount === 0) return money.toDecimal(p.home_amount, home) + ' ' + home;
  const price = money.toDecimal(Math.abs(p.home_amount), home) + ' ' + home;
  return money.toDecimal(p.amount, p.currency) + ' ' + p.currency + ' @@ ' + price;
}

function build(app, format, from, to) {
  const money = require(`${__hooks}/lib_money.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const setup = require(`${__hooks}/lib_setup.js`);
  const s = setup.row(app);
  const home = ledger.home(app);
  const names = accountNames(app);
  const contacts = contactNames(app);
  const rows = postingRows(app, from, to);
  if (format === 'csv') {
    const esc = (v) => {
      const x = String(v === undefined || v === null ? '' : v);
      return /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
    };
    const accs = {};
    for (const a of app.findRecordsByFilter('accounts', 'id != ""', '', 0, 0)) accs[a.id] = a;
    const lines = ['date,transaction,narration,contact,reference,kind,account_code,account,amount,currency,home_amount,home_currency,tax_code,memo,reconciled'];
    for (const r of rows) {
      const a = accs[r.account];
      lines.push(
        [r.date, r.txn, r.narration, contacts[r.contact] || '', r.reference, r.kind, a ? a.getString('code') : '', a ? a.getString('name') : '', money.toDecimal(r.amount, r.currency || home), r.currency || home, money.toDecimal(r.home_amount, home), home, r.tax_code, r.memo, r.recon_state === 'reconciled' ? 'yes' : '']
          .map(esc)
          .join(','),
      );
    }
    return lines.join('\n') + '\n';
  }
  const out = [];
  const title = s.getString('business_name') || 'Ledgerflow books';
  if (format === 'beancount') {
    out.push('; ' + title + ' exported from Ledgerflow ' + new Date().toISOString().slice(0, 10));
    out.push('option "title" ' + quote(title));
    out.push('option "operating_currency" "' + home + '"');
    out.push('');
    const first = rows.length > 0 ? rows[0].date : from;
    for (const id of Object.keys(names)) out.push((first < names[id].created ? first : names[id].created) + ' open ' + names[id].name);
    out.push('');
    for (const t of grouped(rows)) {
      const payee = contacts[t.contact] || '';
      out.push(t.date + ' * ' + (payee ? quote(payee) + ' ' : '') + quote(t.narration || t.kind) + (t.reference ? '  ; ' + t.reference.replace(/[\r\n]/g, ' ') : ''));
      for (const p of t.postings) out.push('  ' + names[p.account].name + '  ' + amountText(money, p, home) + (p.memo ? '  ; ' + p.memo.replace(/[\r\n]/g, ' ') : ''));
      out.push('');
    }
    return out.join('\n');
  }
  // hledger journal
  out.push('; ' + title + ' exported from Ledgerflow ' + new Date().toISOString().slice(0, 10));
  out.push('commodity 1,000.00 ' + home);
  out.push('');
  for (const id of Object.keys(names)) out.push('account ' + names[id].name);
  out.push('');
  for (const t of grouped(rows)) {
    const payee = contacts[t.contact] || '';
    out.push(t.date + ' * ' + (t.reference ? '(' + t.reference.replace(/[()\r\n]/g, ' ') + ') ' : '') + (payee ? payee.replace(/\|/g, '/') + ' | ' : '') + (t.narration || t.kind).replace(/[\r\n]/g, ' '));
    for (const p of t.postings) out.push('    ' + names[p.account].name + '  ' + amountText(money, p, home) + (p.memo ? '  ; ' + p.memo.replace(/[\r\n]/g, ' ') : ''));
    out.push('');
  }
  return out.join('\n');
}

/** { file_name, mime, content } for a download. */
function exportBooks(app, format, from, to) {
  const f = format === 'hledger' || format === 'csv' ? format : format === 'beancount' ? 'beancount' : null;
  if (!f) throw fail(400, 'format must be beancount, hledger or csv');
  const a = from || '1900-01-01';
  const b = to || '9999-12-31';
  const content = build(app, f, a, b);
  const ext = f === 'beancount' ? 'beancount' : f === 'hledger' ? 'journal' : 'csv';
  const stamp = new Date().toISOString().slice(0, 10);
  return { file_name: 'ledgerflow-' + stamp + '.' + ext, mime: f === 'csv' ? 'text/csv' : 'text/plain', content: content, size: content.length };
}

module.exports = { accountNames: accountNames, exportBooks: exportBooks };
