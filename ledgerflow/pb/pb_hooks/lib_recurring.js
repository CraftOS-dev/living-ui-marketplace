/// <reference path="../pb_data/types.d.ts" />
/**
 * Recurring entries, invoices and bills.
 *
 * A schedule holds a template and a next date. On or after that date the
 * daily run creates the item: posted or approved when `auto` is on,
 * otherwise as a proposed entry or a draft for the person to confirm.
 * Templates:
 *   transaction  { narration, contact, kind: expense|income|transfer|journal,
 *                  from, to, category, amount, tax_code }        (quick form)
 *                | { narration, contact, postings: [{ account, amount, memo }] }
 *   invoice/bill the document fields: { contact, lines, terms_days,
 *                  currency, inclusive, notes, terms, reference }
 * Amounts in templates are decimals as written ("49.00").
 */

const FREQ = ['weekly', 'monthly', 'quarterly', 'yearly'];

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function serialize(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    name: rec.getString('name'),
    kind: rec.getString('kind') || 'transaction',
    template: u.json(rec, 'template', {}) || {},
    frequency: rec.getString('frequency') || 'monthly',
    interval: rec.getInt('interval') || 1,
    next_date: rec.getString('next_date'),
    end_date: rec.getString('end_date'),
    auto: rec.getBool('auto'),
    active: rec.getBool('active'),
    last_run: rec.getString('last_run'),
    count: rec.getInt('count'),
    added_by: rec.getString('added_by') || 'user',
    created: rec.getString('created'),
  };
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'recurring', id);
  if (!rec) throw fail(404, 'No schedule ' + id + '; see recurring.list');
  return rec;
}

function advance(date, freq, interval) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const n = Math.max(1, interval || 1);
  if (freq === 'weekly') return dates.addDays(date, 7 * n);
  if (freq === 'quarterly') return dates.addMonths(date, 3 * n);
  if (freq === 'yearly') return dates.addMonths(date, 12 * n);
  return dates.addMonths(date, n);
}

/** Postings for a transaction template (amounts in each account's currency). */
function txnPostings(app, t) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  if (Array.isArray(t.postings) && t.postings.length > 0) {
    return t.postings.map((p, i) => {
      const acc = ledger.account(app, p.account);
      const ccy = acc.getString('currency') || ledger.home(app);
      return { account: acc, amount: money.amount(p.amount, ccy, 'postings[' + i + '].amount'), currency: ccy, memo: p.memo || '' };
    });
  }
  const kind = t.kind || 'expense';
  const pay = ledger.account(app, kind === 'income' ? t.to : t.from);
  const ccy = pay.getString('currency') || ledger.home(app);
  const amount = money.amount(t.amount, ccy, 'amount');
  const f = { from: t.from, to: t.to, category: t.category, amount: amount, tax_code: t.tax_code, inclusive: t.inclusive, memo: t.memo };
  if (kind === 'transfer') {
    const to = ledger.account(app, t.to);
    const toCcy = to.getString('currency') || ledger.home(app);
    if (t.amount_to !== undefined) f.amount_to = money.amount(t.amount_to, toCcy, 'amount_to');
  }
  return ledger.expand(app, kind === 'journal' ? 'expense' : kind, f);
}

/** Check a template can be used now (accounts exist, amounts parse). */
function validate(app, kind, t) {
  if (!t || typeof t !== 'object') throw fail(400, 'template is required');
  if (kind === 'transaction') {
    const rows = txnPostings(app, t);
    require(`${__hooks}/lib_ledger.js`).prepare(app, require(`${__hooks}/lib_dates.js`).today(), rows);
    return;
  }
  if (!t.contact) throw fail(400, 'The template needs a contact');
  if (!Array.isArray(t.lines) || t.lines.length === 0) throw fail(400, 'The template needs lines');
}

function save(app, rec, spec, who) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const r = rec || new Record(app.findCollectionByNameOrId('recurring'));
  const kind = rec ? r.getString('kind') : spec.kind || 'transaction';
  if (['transaction', 'invoice', 'bill'].indexOf(kind) < 0) throw fail(400, 'kind must be transaction, invoice or bill');
  if (!rec) {
    r.set('kind', kind);
    r.set('active', true);
    r.set('count', 0);
    r.set('added_by', who.actor === 'agent' ? 'agent' : 'user');
  }
  if (spec.name !== undefined) r.set('name', String(spec.name || '').slice(0, 120));
  if (spec.template !== undefined) {
    validate(app, kind, spec.template);
    r.set('template', spec.template);
  }
  if (spec.frequency !== undefined) {
    if (FREQ.indexOf(spec.frequency) < 0) throw fail(400, 'frequency must be one of: ' + FREQ.join(', '));
    r.set('frequency', spec.frequency);
  }
  if (spec.interval !== undefined) r.set('interval', Math.max(1, Math.min(52, parseInt(spec.interval, 10) || 1)));
  if (spec.next_date !== undefined) r.set('next_date', dates.parse(spec.next_date, 'next_date'));
  if (spec.end_date !== undefined) r.set('end_date', spec.end_date ? dates.parse(spec.end_date, 'end_date') : '');
  if (spec.auto !== undefined) r.set('auto', !!spec.auto);
  if (spec.active !== undefined) r.set('active', !!spec.active);
  if (!r.getString('frequency')) r.set('frequency', 'monthly');
  if (!r.getInt('interval')) r.set('interval', 1);
  if (!r.getString('next_date')) throw fail(400, 'next_date is required');
  if (!r.getString('name')) r.set('name', (r.getString('kind') === 'transaction' ? (spec.template && spec.template.narration) || 'Recurring entry' : 'Recurring ' + kind).slice(0, 120));
  app.save(r);
  return r;
}

/** Create one occurrence dated `date`. Returns { type, id }. */
function createOne(app, rec, date, who) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const docs = require(`${__hooks}/lib_docs.js`);
  const u = require(`${__hooks}/lib_util.js`);
  const t = u.json(rec, 'template', {}) || {};
  const kind = rec.getString('kind');
  const auto = rec.getBool('auto');
  if (kind === 'transaction') {
    let contactId = '';
    if (t.contact) {
      const c = ledger.contact(app, t.contact, 'other');
      contactId = c ? c.id : '';
    }
    const r = ledger.create(
      app,
      {
        date: date,
        narration: t.narration || rec.getString('name'),
        contact: contactId,
        kind: t.kind === 'journal' ? 'journal' : t.kind || 'expense',
        status: auto ? 'posted' : 'proposed',
        postings: txnPostings(app, t),
        recurring: rec.id,
        method: 'recurring',
        added_by: 'recurring',
        reason: 'From the schedule "' + rec.getString('name') + '"',
      },
      who,
    );
    return { type: 'transaction', id: r.txn.id };
  }
  const spec = Object.assign({}, t, { kind: kind, issue_date: date, added_by: 'recurring' });
  delete spec.due_date;
  const res = docs.save(app, null, spec, who);
  res.doc.set('recurring', rec.id);
  app.save(res.doc);
  if (auto) docs.approve(app, res.doc, who);
  return { type: 'document', id: res.doc.id };
}

/** Create everything due up to `today` (at most 24 catch-up occurrences per schedule). */
function runDue(app, today, who, only) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const day = today || dates.today();
  const filter = only ? 'id = {:id}' : "active = true && next_date != '' && next_date <= {:d}";
  const rows = app.findRecordsByFilter('recurring', filter, 'next_date', 0, 0, { d: day, id: only || '' });
  const made = [];
  const errors = [];
  for (const rec of rows) {
    for (let i = 0; i < 24; i++) {
      const next = rec.getString('next_date');
      if (!next || next > day) break;
      const end = rec.getString('end_date');
      if (end && next > end) {
        rec.set('active', false);
        break;
      }
      try {
        const m = createOne(app, rec, next, who);
        made.push(Object.assign({ schedule: rec.id, name: rec.getString('name'), date: next }, m));
        rec.set('last_run', next);
        rec.set('count', rec.getInt('count') + 1);
      } catch (err) {
        errors.push({ schedule: rec.id, name: rec.getString('name'), date: next, error: String((err && err.message) || err) });
        break;
      }
      rec.set('next_date', advance(next, rec.getString('frequency'), rec.getInt('interval')));
    }
    app.save(rec);
  }
  return { made: made, errors: errors };
}

/** A template from an existing entry or document. */
function templateFrom(app, type, id) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const money = require(`${__hooks}/lib_money.js`);
  if (type === 'transaction') {
    const t = ledger.mustTxn(app, id);
    const ps = ledger.postingsOf(app, t.id);
    return {
      kind: 'transaction',
      date: t.getString('date'),
      template: {
        narration: t.getString('narration'),
        contact: t.getString('contact'),
        kind: t.getString('kind') === 'income' ? 'income' : t.getString('kind') === 'transfer' ? 'transfer' : 'journal',
        postings: ps.map((p) => ({ account: p.getString('account'), amount: money.toDecimal(p.getInt('amount'), p.getString('currency')), memo: p.getString('memo') })),
      },
    };
  }
  const docs = require(`${__hooks}/lib_docs.js`);
  const d = docs.mustGet(app, id);
  const lines = app.findRecordsByFilter('doc_lines', 'document = {:d}', 'sort', 0, 0, { d: d.id });
  const dates = require(`${__hooks}/lib_dates.js`);
  return {
    kind: d.getString('kind') === 'bill' ? 'bill' : 'invoice',
    date: d.getString('issue_date'),
    template: {
      contact: d.getString('contact'),
      currency: d.getString('currency'),
      inclusive: d.getBool('inclusive'),
      terms_days: d.getString('due_date') ? dates.daysBetween(d.getString('issue_date'), d.getString('due_date')) : undefined,
      notes: d.getString('notes'),
      terms: d.getString('terms'),
      lines: lines.map((l) => ({ description: l.getString('description'), quantity: l.getString('quantity'), unit_price: money.toDecimal(l.getInt('unit_price'), d.getString('currency')), account: l.getString('account'), tax_code: l.getString('tax_code') })),
    },
  };
}

module.exports = { FREQ: FREQ, serialize: serialize, mustGet: mustGet, advance: advance, validate: validate, save: save, createOne: createOne, runDue: runDue, templateFrom: templateFrom };
