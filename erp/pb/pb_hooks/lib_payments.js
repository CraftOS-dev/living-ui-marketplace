/// <reference path="../pb_data/types.d.ts" />
/**
 * Payments in (from customers) and out (to suppliers), and allocations.
 *
 * - A payment is in the currency of its bank account. Posting it moves the
 *   money: bank against receivable (in) or payable against bank (out), for
 *   the party, so an unallocated payment is the party's credit.
 * - Allocations settle invoices and bills of the same party and currency,
 *   from a payment or from a credit note / supplier credit. When the two
 *   documents carry different exchange rates, the difference in base
 *   currency is realized on the exchange gains and losses account.
 * - Voiding a payment removes its allocations and reverses its entry.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function money() {
  return require(`${__hooks}/lib_money.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}
function ledger() {
  return require(`${__hooks}/lib_ledger.js`);
}

function payLabel(pay) {
  return (pay.getString('direction') === 'in' ? 'Payment received ' : 'Payment ') + (pay.getString('number') !== '' ? pay.getString('number') : '(draft)');
}

function loadPayment(ctx, ref, need) {
  const pay = core().resolvePayment(ctx.app, ref);
  auth().needPay(ctx, pay.getString('direction'), need);
  return pay;
}

/* ============================================================ allocation */

function docLabel(d) {
  return require(`${__hooks}/lib_docs.js`).docLabel(d);
}

/**
 * Settle `amount` (document currency) of `target` from a payment or a
 * credit, in the caller's transaction. Writes the allocation, updates both
 * balances and posts the exchange difference.
 */
function allocate(tx, ctx, from, target, amount, date) {
  const util = u();
  const m = money();
  const base = core().currency(tx);
  const isPay = from.collection().name === 'payments';
  const tType = target.getString('type');
  if (target.getString('state') !== 'posted') throw util.fail(409, docLabel(target) + ' is not posted.', 'invalid_state');
  if (isPay) {
    const dir = from.getString('direction');
    if ((dir === 'in' && tType !== 'invoice') || (dir === 'out' && tType !== 'bill')) throw util.fail(400, 'A ' + (dir === 'in' ? 'payment received' : 'payment') + ' settles ' + (dir === 'in' ? 'invoices' : 'bills') + ', not a ' + tType.replace(/_/g, ' ') + '.', 'invalid');
    if (from.getString('state') !== 'posted') throw util.fail(409, payLabel(from) + ' is not posted yet.', 'invalid_state');
  } else {
    const ft = from.getString('type');
    if (!((ft === 'credit_note' && tType === 'invoice') || (ft === 'supplier_credit' && tType === 'bill'))) throw util.fail(400, 'A ' + ft.replace(/_/g, ' ') + ' cannot settle a ' + tType.replace(/_/g, ' ') + '.', 'invalid');
    if (from.getString('state') !== 'posted') throw util.fail(409, docLabel(from) + ' is not posted.', 'invalid_state');
  }
  if (from.getString('party') !== target.getString('party')) throw util.fail(400, 'They belong to different customers or suppliers.', 'party_mismatch');
  const cur = target.getString('currency') || base;
  const fromCur = (isPay ? from.getString('currency') : from.getString('currency')) || base;
  if (cur !== fromCur) throw util.fail(400, docLabel(target) + ' is in ' + cur + ' and this ' + (isPay ? 'payment' : 'credit') + ' is in ' + fromCur + '. They must be in the same currency.', 'currency_mismatch');
  if (!(amount > 0)) throw util.fail(400, 'The amount to apply must be more than 0.', 'invalid_amount');
  const t = tx.findRecordById('documents', target.id);
  if (amount > t.getInt('balance')) throw util.fail(409, 'Only ' + m.fmt(t.getInt('balance'), cur) + ' is open on ' + docLabel(t) + '.', 'over_allocated');
  const f = tx.findRecordById(isPay ? 'payments' : 'documents', from.id);
  const avail = isPay ? f.getInt('unallocated') : f.getInt('balance');
  if (amount > avail) throw util.fail(409, 'Only ' + m.fmt(avail, cur) + ' is left on ' + (isPay ? payLabel(f) : docLabel(f)) + '.', 'over_allocated');
  // The exchange difference, realized now.
  const tBase = m.convert(amount, cur, base, t.getInt('fx_e8') || m.E8);
  const fBase = m.convert(amount, cur, base, f.getInt('fx_e8') || m.E8);
  const sales = tType === 'invoice';
  const control = core().systemAccount(tx, sales ? 'ar' : 'ap').id;
  const fxAcc = core().systemAccount(tx, 'fx').id;
  const d = tBase - fBase;
  let j = null;
  const when = ledger().firstOpenDate(tx, ctx, date);
  if (d !== 0) {
    const party = t.getString('party');
    const memo = 'Exchange difference: ' + docLabel(t) + ' and ' + (isPay ? payLabel(f) : docLabel(f));
    // Receivable: booked tBase, settled fBase; a positive d is a loss. Payable: a positive d is a gain.
    const lines = sales
      ? d > 0
        ? [{ account: fxAcc, debit: d, credit: 0, memo: memo }, { account: control, debit: 0, credit: d, party: party, doc: t.id, currency: cur, amount_cur: 0, memo: memo }]
        : [{ account: control, debit: -d, credit: 0, party: party, doc: t.id, currency: cur, amount_cur: 0, memo: memo }, { account: fxAcc, debit: 0, credit: -d, memo: memo }]
      : d > 0
        ? [{ account: control, debit: d, credit: 0, party: party, doc: t.id, currency: cur, amount_cur: 0, memo: memo }, { account: fxAcc, debit: 0, credit: d, memo: memo }]
        : [{ account: fxAcc, debit: -d, credit: 0, memo: memo }, { account: control, debit: 0, credit: -d, party: party, doc: t.id, currency: cur, amount_cur: 0, memo: memo }];
    j = ledger().post(tx, ctx, { kind: 'allocation_fx', date: when, memo: memo, source: { entity: 'documents', id: t.id, label: docLabel(t) }, lines: lines }, { allowControl: true });
  }
  const a = util.newRecord(tx, 'allocations');
  if (isPay) a.set('payment', f.id);
  else a.set('credit', f.id);
  a.set('document', t.id);
  a.set('party', t.getString('party'));
  a.set('amount', amount);
  a.set('currency', cur);
  a.set('fx_diff', sales ? -d : d);
  a.set('journal', j !== null ? j.id : '');
  a.set('date', when);
  a.set('state', 'active');
  a.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  a.set('member', ctx.memberId || '');
  tx.save(a);
  t.set('paid', t.getInt('paid') + amount);
  t.set('balance', t.getInt('balance') - amount);
  tx.save(t);
  if (isPay) {
    f.set('allocated', f.getInt('allocated') + amount);
    f.set('unallocated', f.getInt('unallocated') - amount);
  } else {
    f.set('paid', f.getInt('paid') + amount);
    f.set('balance', f.getInt('balance') - amount);
  }
  tx.save(f);
  return a;
}

/** Take an allocation back (its exchange entry is reversed). */
function deallocate(tx, ctx, allocationId) {
  const util = u();
  const a = tx.findRecordById('allocations', allocationId);
  if (a.getString('state') !== 'active') throw util.fail(409, 'That allocation was already removed.', 'invalid_state');
  if (a.getString('journal') !== '') ledger().reverse(tx, ctx, a.getString('journal'), { memo: 'Allocation removed' });
  const amount = a.getInt('amount');
  const t = tx.findRecordById('documents', a.getString('document'));
  t.set('paid', t.getInt('paid') - amount);
  t.set('balance', t.getInt('balance') + amount);
  tx.save(t);
  if (a.getString('payment') !== '') {
    const pay = tx.findRecordById('payments', a.getString('payment'));
    pay.set('allocated', pay.getInt('allocated') - amount);
    pay.set('unallocated', pay.getInt('unallocated') + amount);
    tx.save(pay);
  } else {
    const c = tx.findRecordById('documents', a.getString('credit'));
    c.set('paid', c.getInt('paid') - amount);
    c.set('balance', c.getInt('balance') + amount);
    tx.save(c);
  }
  a.set('state', 'void');
  tx.save(a);
  return a;
}

/** Open invoices or bills of a party in a currency, oldest due first. */
function openDocs(app, partyId, type, cur) {
  return app.findRecordsByFilter('documents', "party = {:p} && type = {:t} && state = 'posted' && balance > 0 && currency = {:c}", 'due_date,date,number', 0, 0, { p: partyId, t: type, c: cur });
}

/**
 * Read [{doc, amount}] against open documents; `auto` fills the oldest
 * first. Returns [{doc (record), amount}]. A listed document without an
 * amount takes what is open on it, up to what is left of `available` (the
 * payment), so "this payment, against INV-00012" settles it in part when
 * the payment is smaller.
 */
function planAllocations(app, partyId, type, cur, list, auto, available) {
  const util = u();
  const m = money();
  const plan = [];
  if (list !== undefined && list.length > 0) {
    list.forEach((x, i) => util.keysOnly(x, ['doc', 'amount'], 'Allocation ' + (i + 1)));
    let left = available > 0 ? available : Number.MAX_SAFE_INTEGER;
    list.forEach((x, i) => {
      if (!x || !x.doc) throw util.fail(400, 'allocations must be like [{"doc":"INV-00012","amount":"150.00"}]', 'invalid_param');
      const d = core().resolveDoc(app, String(x.doc), type);
      let amount;
      if (x.amount === undefined || x.amount === null || x.amount === '') {
        if (left <= 0) throw util.fail(400, 'Allocation ' + (i + 1) + ' (' + docLabel(d) + '): nothing of the payment is left for it.', 'over_allocated', { allocation: i + 1 });
        amount = Math.min(d.getInt('balance'), left);
      } else {
        amount = m.toMinor(String(x.amount), cur, false);
        if (amount === null) throw util.fail(400, 'allocations: amount must be like 150.00 in ' + cur, 'invalid_amount');
      }
      left -= amount;
      plan.push({ doc: d, amount: amount });
    });
    return plan;
  }
  if (!auto) return plan;
  let left = available;
  for (const d of openDocs(app, partyId, type, cur)) {
    if (left <= 0) break;
    const take = Math.min(left, d.getInt('balance'));
    plan.push({ doc: d, amount: take });
    left -= take;
  }
  return plan;
}

/**
 * Check planned allocations before anything is saved or proposed: each
 * document is the party's, posted, open, in the payment's currency, and
 * takes no more than is open; together they take no more than the payment.
 */
function checkPlan(app, partyId, cur, rows, available) {
  const util = u();
  const m = money();
  let total = 0;
  rows.forEach((row, i) => {
    const d = row.doc;
    const where = 'Allocation ' + (i + 1) + ' (' + docLabel(d) + '): ';
    if (d.getString('party') !== partyId) throw util.fail(400, where + 'it belongs to another customer or supplier.', 'party_mismatch', { allocation: i + 1 });
    if (d.getString('state') !== 'posted' || d.getInt('balance') <= 0) throw util.fail(409, where + 'nothing is open on it.', 'not_open', { allocation: i + 1 });
    if ((d.getString('currency') || cur) !== cur) throw util.fail(400, where + 'it is in ' + d.getString('currency') + ' and the payment is in ' + cur + '.', 'currency_mismatch', { allocation: i + 1 });
    if (!(row.amount > 0)) throw util.fail(400, where + 'the amount must be more than 0.', 'invalid_amount', { allocation: i + 1 });
    if (row.amount > d.getInt('balance')) throw util.fail(409, where + 'only ' + m.fmt(d.getInt('balance'), cur) + ' is open on it.', 'over_allocated', { allocation: i + 1 });
    total += row.amount;
  });
  if (available !== undefined && total > available) throw util.fail(400, 'The allocations add up to ' + m.fmt(total, cur) + ', more than the payment of ' + m.fmt(available, cur) + '.', 'over_allocated');
  return total;
}

/** A credit note or supplier credit made from an invoice or bill settles it at once. */
function autoApplyCredit(tx, ctx, credit) {
  const util = u();
  const src = util.byId(tx, 'documents', credit.getString('source'));
  if (src === null || src.getString('state') !== 'posted') return;
  const fresh = tx.findRecordById('documents', credit.id);
  const take = Math.min(fresh.getInt('balance'), src.getInt('balance'));
  if (take <= 0 || src.getString('currency') !== fresh.getString('currency')) return;
  allocate(tx, ctx, fresh, src, take, fresh.getString('date'));
}

/* ============================================================== payments */

function bankOf(app, ref) {
  const util = u();
  const b = core().resolve(app, 'banks', ref);
  if (b.getBool('archived')) throw util.fail(409, b.getString('name') + ' is archived.', 'archived');
  return b;
}

function readPayment(ctx, app, tx, pay, p, isNew) {
  const util = u();
  const base = core().currency(app);
  if (util.has(p, 'party')) {
    const party = core().resolve(app, 'parties', util.str(p, 'party', ''));
    pay.set('party', party.id);
  }
  if (isNew && pay.getString('party') === '') throw util.fail(400, 'party is required', 'missing_param');
  if (util.has(p, 'bank') || isNew) {
    const defaults = core().defaults(app);
    const ref = util.str(p, 'bank', '') || (typeof defaults.bank === 'string' ? defaults.bank : '');
    let b = null;
    if (ref !== '') b = bankOf(app, ref);
    else {
      const first = app.findRecordsByFilter('banks', "archived = false && kind = 'bank'", 'sort,name', 1, 0);
      if (first.length === 0) throw util.fail(400, 'bank is required: add a bank account under Banking first.', 'missing_param');
      b = first[0];
    }
    pay.set('bank', b.id);
    pay.set('currency', b.getString('currency') || base);
  }
  if (util.has(p, 'date') || isNew) pay.set('date', util.day(p, 'date', util.today()));
  const cur = pay.getString('currency') || base;
  if (util.has(p, 'amount')) pay.set('amount', util.money(p, 'amount', cur, { required: true, positive: true }));
  if (isNew && !(pay.getInt('amount') > 0)) throw util.fail(400, 'amount is required, e.g. --amount 1250.00', 'missing_param');
  if (cur === base) pay.set('fx_e8', money().E8);
  else if (util.has(p, 'fx_rate') || isNew || util.has(p, 'bank')) {
    const given = util.rate(p, 'fx_rate');
    if (given !== null) pay.set('fx_e8', given);
    else {
      const c = util.findOne(app, 'currencies', 'code = {:c}', { c: cur });
      if (c === null || c.getInt('rate_e8') <= 0) throw util.fail(400, 'There is no exchange rate for ' + cur + '. Give fx_rate.', 'fx_missing');
      pay.set('fx_e8', c.getInt('rate_e8'));
    }
  }
  pay.set('amount_base', money().convert(pay.getInt('amount'), cur, base, pay.getInt('fx_e8') || money().E8));
  if (util.has(p, 'method')) pay.set('method', util.oneOf(p, 'method', ['bank_transfer', 'cash', 'card', 'cheque', 'online', 'other'], 'bank_transfer'));
  else if (isNew) pay.set('method', 'bank_transfer');
  if (util.has(p, 'reference')) pay.set('reference', util.text(p, 'reference', 120, ''));
  if (util.has(p, 'memo')) pay.set('memo', util.text(p, 'memo', 500, ''));
  if (util.has(p, 'agent_note')) pay.set('agent_note', util.text(p, 'agent_note', 2000, ''));
}

function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const dir = util.oneOf(p, 'direction', ['in', 'out'], '');
  if (dir === '') throw util.fail(400, 'direction is required: in (from a customer) or out (to a supplier)', 'missing_param');
  auth().needPay(ctx, dir, 'edit');
  const plan = util.list(p, 'allocations');
  let id = '';
  app.runInTransaction((tx) => {
    const pay = util.newRecord(tx, 'payments');
    pay.set('direction', dir);
    pay.set('state', 'draft');
    pay.set('allocated', 0);
    pay.set('prepared_by', ctx.memberId);
    pay.set('prepared_actor', ctx.isAgent ? 'agent' : 'person');
    readPayment(ctx, app, tx, pay, p, true);
    pay.set('unallocated', pay.getInt('amount'));
    tx.save(pay);
    // Planned allocations are kept with the draft and applied when it posts.
    if (plan !== undefined && plan.length > 0) {
      const rows = planAllocations(tx, pay.getString('party'), dir === 'in' ? 'invoice' : 'bill', pay.getString('currency'), plan, false, pay.getInt('amount'));
      checkPlan(tx, pay.getString('party'), pay.getString('currency'), rows, pay.getInt('amount'));
      const keep = rows.map((r) => ({ doc: r.doc.id, amount: r.amount }));
      pay.set('planned', keep);
      tx.save(pay);
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'create', entity: 'payments', ref: pay.id, label: payLabel(pay), summary: 'Created ' + payLabel(pay) + ' for ' + money().fmt(pay.getInt('amount'), pay.getString('currency')) });
    id = pay.id;
  });
  return get(ctx, { payment: id });
}

function update(ctx, p) {
  const util = u();
  const pay = loadPayment(ctx, util.req(p, 'payment'), 'edit');
  if (pay.getString('state') !== 'draft') throw util.fail(409, payLabel(pay) + ' is ' + pay.getString('state') + '. Void it and record it again.', 'not_editable');
  ctx.app.runInTransaction((tx) => {
    const r = tx.findRecordById('payments', pay.id);
    readPayment(ctx, ctx.app, tx, r, p, false);
    r.set('unallocated', r.getInt('amount'));
    tx.save(r);
  });
  return get(ctx, { payment: pay.id });
}

/** The allocations planned on a draft (applied when it posts). */
function plannedOf(app, pay) {
  const data = u().jsonOf(pay, 'planned');
  return Array.isArray(data) && data.length > 0 ? data : null;
}

function previewPost(ctx, p) {
  const util = u();
  const pay = loadPayment(ctx, util.req(p, 'payment'), 'view');
  if (pay.getString('state') !== 'draft') throw util.fail(409, payLabel(pay) + ' is already ' + pay.getString('state') + '.', 'not_draft');
  const party = util.byId(ctx.app, 'parties', pay.getString('party'));
  const bank = util.byId(ctx.app, 'banks', pay.getString('bank'));
  const lines = postingLines(ctx.app, pay);
  return {
    kind: 'payment',
    auto: '',
    amount: pay.getInt('amount_base'),
    title: (pay.getString('direction') === 'in' ? 'Record ' : 'Pay ') + money().fmt(pay.getInt('amount'), pay.getString('currency')) + (pay.getString('direction') === 'in' ? ' from ' : ' to ') + (party ? party.getString('name') : ''),
    summary: (pay.getString('direction') === 'in' ? 'Money in to ' : 'Money out of ') + (bank ? bank.getString('name') : 'the bank') + ' on ' + pay.getString('date') + (pay.getString('reference') !== '' ? ', reference ' + pay.getString('reference') : '') + '.',
    lines: ledger().describeLines(ctx.app, lines),
    currency: core().currency(ctx.app),
    target: { entity: 'payments', id: pay.id, label: payLabel(pay) },
  };
}

function postingLines(app, pay) {
  const bank = app.findRecordById('banks', pay.getString('bank'));
  const dir = pay.getString('direction');
  const control = core().systemAccount(app, dir === 'in' ? 'ar' : 'ap').id;
  const b = pay.getInt('amount_base');
  const cur = pay.getString('currency');
  const party = pay.getString('party');
  const memo = (pay.getString('reference') !== '' ? pay.getString('reference') + ' ' : '') + pay.getString('memo');
  return dir === 'in'
    ? [
        { account: bank.getString('account'), debit: b, credit: 0, memo: memo, currency: cur, amount_cur: pay.getInt('amount') },
        { account: control, debit: 0, credit: b, party: party, currency: cur, amount_cur: -pay.getInt('amount'), memo: memo },
      ]
    : [
        { account: control, debit: b, credit: 0, party: party, currency: cur, amount_cur: pay.getInt('amount'), memo: memo },
        { account: bank.getString('account'), debit: 0, credit: b, memo: memo, currency: cur, amount_cur: -pay.getInt('amount') },
      ];
}

function post(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pay = loadPayment(ctx, util.req(p, 'payment'), 'full');
  if (pay.getString('state') !== 'draft') throw util.fail(409, payLabel(pay) + ' is already ' + pay.getString('state') + '.', 'not_draft');
  const auto = util.bool(p, 'auto_allocate', true);
  app.runInTransaction((tx) => {
    const series = pay.getString('direction') === 'in' ? 'payment_in' : 'payment_out';
    const number = core().nextNumber(tx, series);
    const r = tx.findRecordById('payments', pay.id);
    if (r.getString('state') !== 'draft') throw util.fail(409, payLabel(r) + ' was posted a moment ago.', 'not_draft');
    r.set('number', number);
    const j = ledger().post(tx, ctx, { kind: r.getString('direction') === 'in' ? 'payment_in' : 'payment_out', date: r.getString('date'), memo: payLabel(r) + ' ' + partyName(tx, r), source: { entity: 'payments', id: r.id, label: payLabel(r) }, lines: postingLines(tx, r) }, { allowControl: true });
    r.set('state', 'posted');
    r.set('journal', j !== null ? j.id : '');
    r.set('posted_by', ctx.memberId);
    r.set('posted_at', util.nowIso());
    r.set('allocated', 0);
    r.set('unallocated', r.getInt('amount'));
    tx.save(r);
    const planned = plannedOf(tx, r);
    const type = r.getString('direction') === 'in' ? 'invoice' : 'bill';
    const rows = planned !== null ? planned.map((x) => ({ doc: tx.findRecordById('documents', x.doc), amount: x.amount })) : planAllocations(tx, r.getString('party'), type, r.getString('currency'), undefined, auto, r.getInt('amount'));
    for (const row of rows) {
      const fresh = tx.findRecordById('payments', r.id);
      const take = Math.min(row.amount, fresh.getInt('unallocated'), tx.findRecordById('documents', row.doc.id).getInt('balance'));
      if (take > 0) allocate(tx, ctx, fresh, row.doc, take, r.getString('date'));
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, {
      kind: 'post',
      entity: 'payments',
      ref: r.id,
      label: payLabel(r),
      summary: 'Posted ' + payLabel(r) + ' for ' + money().fmt(r.getInt('amount'), r.getString('currency')) + (ctx.approving ? ' (proposed by your AI agent)' : ''),
    });
  });
  return get(ctx, { payment: pay.id });
}

/** One step: create and post (screens' "Record payment"). */
function record(ctx, p) {
  const util = u();
  const dir = util.oneOf(p, 'direction', ['in', 'out'], '');
  if (dir === '') throw util.fail(400, 'direction is required: in or out', 'missing_param');
  auth().needPay(ctx, dir, 'full');
  const created = create(ctx, p);
  try {
    return post(ctx, { payment: created.id, auto_allocate: util.has(p, 'allocations') ? false : util.bool(p, 'auto_allocate', true) });
  } catch (err) {
    // Keep nothing half-done: the draft goes when posting fails.
    try {
      ctx.app.runInTransaction((tx) => {
        const r = util.byId(tx, 'payments', created.id);
        if (r !== null && r.getString('state') === 'draft') tx.delete(r);
      });
    } catch {
      /* the draft stays; it can be deleted */
    }
    throw err;
  }
}

function previewRecord(ctx, p) {
  const util = u();
  const app = ctx.app;
  const dir = util.oneOf(p, 'direction', ['in', 'out'], 'in');
  auth().needPay(ctx, dir, 'view');
  const base = core().currency(app);
  const party = core().resolve(app, 'parties', util.req(p, 'party'));
  const bankRef = util.str(p, 'bank', '');
  const bank = bankRef !== '' ? bankOf(app, bankRef) : app.findRecordsByFilter('banks', "archived = false && kind = 'bank'", 'sort,name', 1, 0)[0];
  if (!bank) throw util.fail(400, 'bank is required', 'missing_param');
  const cur = bank.getString('currency') || base;
  const amount = util.money(p, 'amount', cur, { required: true, positive: true });
  // The same rate recording would use: the one given, else the currency's rate.
  let fx = money().E8;
  if (cur !== base) {
    const given = util.rate(p, 'fx_rate');
    if (given !== null) fx = given;
    else {
      const c = util.findOne(app, 'currencies', 'code = {:c}', { c: cur });
      if (c === null || c.getInt('rate_e8') <= 0) throw util.fail(400, 'There is no exchange rate for ' + cur + '. Give fx_rate.', 'fx_missing');
      fx = c.getInt('rate_e8');
    }
  }
  const fake = { getString: (k) => ({ bank: bank.id, direction: dir, currency: cur, party: party.id, reference: util.str(p, 'reference', ''), memo: util.str(p, 'memo', '') })[k] || '', getInt: (k) => (k === 'amount' ? amount : k === 'amount_base' ? money().convert(amount, cur, base, fx) : 0) };
  // What it settles is checked now, so a wrong invoice fails here and not when a person approves.
  const type = dir === 'in' ? 'invoice' : 'bill';
  const plan = util.list(p, 'allocations');
  let settles = '';
  if (plan !== undefined && plan.length > 0) {
    const rows = planAllocations(app, party.id, type, cur, plan, false, amount);
    checkPlan(app, party.id, cur, rows, amount);
    settles = ' Settles ' + rows.map((r) => docLabel(r.doc) + ' (' + money().fmt(r.amount, cur) + ')').join(', ') + '.';
  } else if (util.bool(p, 'auto_allocate', true)) {
    const open = planAllocations(app, party.id, type, cur, undefined, true, amount);
    settles = open.length > 0 ? ' Settles the oldest open first: ' + open.map((r) => docLabel(r.doc) + ' (' + money().fmt(r.amount, cur) + ')').join(', ') + '.' : ' Nothing open to settle; it stays as credit.';
  }
  return {
    kind: 'payment',
    auto: '',
    amount: fake.getInt('amount_base'),
    title: (dir === 'in' ? 'Record ' : 'Pay ') + money().fmt(amount, cur) + (dir === 'in' ? ' from ' : ' to ') + party.getString('name'),
    summary: (dir === 'in' ? 'Money in to ' : 'Money out of ') + bank.getString('name') + ' on ' + util.day(p, 'date', util.today()) + '.' + settles,
    lines: ledger().describeLines(app, postingLines(app, fake)),
    currency: base,
    target: { entity: 'parties', id: party.id, label: party.getString('name') },
  };
}

function partyName(app, rec) {
  const p = u().byId(app, 'parties', rec.getString('party'));
  return p === null ? '' : p.getString('name');
}

function previewVoid(ctx, p) {
  const util = u();
  const pay = loadPayment(ctx, util.req(p, 'payment'), 'view');
  if (pay.getString('state') !== 'posted') throw util.fail(409, payLabel(pay) + ' is ' + pay.getString('state') + '.', 'invalid_state');
  const lines = ledger().linesOf(ctx.app, pay.getString('journal')).map((l) => Object.assign({}, l, { debit: l.credit, credit: l.debit }));
  return {
    kind: 'void',
    auto: '',
    amount: pay.getInt('amount_base'),
    title: 'Void ' + payLabel(pay),
    summary: 'Reverses ' + payLabel(pay) + ' (' + partyName(ctx.app, pay) + ') and removes its allocations.',
    lines: ledger().describeLines(ctx.app, lines),
    currency: core().currency(ctx.app),
    target: { entity: 'payments', id: pay.id, label: payLabel(pay) },
  };
}

function voidPayment(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pay = loadPayment(ctx, util.req(p, 'payment'), 'full');
  if (pay.getString('state') !== 'posted') throw util.fail(409, payLabel(pay) + ' is ' + pay.getString('state') + (pay.getString('state') === 'draft' ? '; delete the draft instead.' : '.'), 'invalid_state');
  const reason = util.text(p, 'reason', 500, '');
  app.runInTransaction((tx) => {
    for (const a of tx.findRecordsByFilter('allocations', "payment = {:p} && state = 'active'", '', 0, 0, { p: pay.id })) deallocate(tx, ctx, a.id);
    const r = tx.findRecordById('payments', pay.id);
    const date = util.day(p, 'date', '') || ledger().firstOpenDate(tx, ctx, r.getString('date'));
    const rev = ledger().reverse(tx, ctx, r.getString('journal'), { date: date, memo: 'Void ' + payLabel(r) + (reason !== '' ? ': ' + reason : '') });
    r.set('state', 'void');
    r.set('void_journal', rev !== null ? rev.id : '');
    r.set('voided_by', ctx.memberId);
    r.set('voided_at', util.nowIso());
    r.set('void_reason', reason);
    tx.save(r);
    // A matched statement line becomes unmatched again.
    for (const bl of tx.findRecordsByFilter('bank_lines', 'payment = {:p}', '', 0, 0, { p: r.id })) {
      bl.set('status', 'unmatched');
      bl.set('payment', '');
      tx.save(bl);
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'void', entity: 'payments', ref: r.id, label: payLabel(r), summary: 'Voided ' + payLabel(r) + (reason !== '' ? ': ' + reason : '') });
  });
  return get(ctx, { payment: pay.id });
}

function remove(ctx, p) {
  const util = u();
  const pay = loadPayment(ctx, util.req(p, 'payment'), 'edit');
  if (pay.getString('state') !== 'draft') throw util.fail(409, 'Only drafts are deleted; void a posted payment instead.', 'not_deletable');
  if (util.bool(p, 'preview', false)) return { preview: true, label: payLabel(pay) };
  ctx.app.runInTransaction((tx) => {
    tx.delete(tx.findRecordById('payments', pay.id));
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'delete', entity: 'payments', ref: pay.id, label: payLabel(pay), summary: 'Deleted the draft ' + payLabel(pay) });
  });
  return { deleted: true };
}

/** Apply a posted payment (or credit) to documents. */
function applyTo(ctx, p) {
  const util = u();
  const app = ctx.app;
  const payRef = util.str(p, 'payment', '');
  const creditRef = util.str(p, 'credit', '');
  if ((payRef === '') === (creditRef === '')) throw util.fail(400, 'Give payment or credit (one of them).', 'missing_param');
  let from;
  let type;
  if (payRef !== '') {
    from = loadPayment(ctx, payRef, 'full');
    type = from.getString('direction') === 'in' ? 'invoice' : 'bill';
  } else {
    from = require(`${__hooks}/lib_docs.js`).loadDoc(ctx, creditRef, 'full');
    const ft = from.getString('type');
    if (ft !== 'credit_note' && ft !== 'supplier_credit') throw util.fail(400, 'credit must be a credit note or supplier credit.', 'invalid_param');
    type = ft === 'credit_note' ? 'invoice' : 'bill';
  }
  const list = util.list(p, 'allocations');
  const isPay = payRef !== '';
  const available = isPay ? from.getInt('unallocated') : from.getInt('balance');
  const cur = from.getString('currency') || core().currency(app);
  const plan = planAllocations(app, from.getString('party'), type, cur, list, list === undefined || list.length === 0, available);
  if (plan.length === 0) throw util.fail(409, 'Nothing to apply: there are no open ' + type + 's for this party in ' + cur + '.', 'nothing_open');
  app.runInTransaction((tx) => {
    for (const row of plan) {
      const fresh = tx.findRecordById(isPay ? 'payments' : 'documents', from.id);
      allocate(tx, ctx, fresh, row.doc, row.amount, util.today());
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, {
      kind: 'allocate',
      entity: isPay ? 'payments' : 'documents',
      ref: from.id,
      label: isPay ? payLabel(from) : docLabel(from),
      summary: 'Applied to ' + plan.map((r) => docLabel(r.doc)).join(', '),
    });
  });
  return isPay ? get(ctx, { payment: from.id }) : require(`${__hooks}/lib_docs.js`).get(ctx, { doc: from.id });
}

function unallocate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = core().resolve(app, 'allocations', util.req(p, 'allocation'));
  const target = app.findRecordById('documents', a.getString('document'));
  require(`${__hooks}/lib_auth.js`).needDoc(ctx, target.getString('type'), 'full');
  app.runInTransaction((tx) => {
    deallocate(tx, ctx, a.id);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'unallocate', entity: 'documents', ref: target.id, label: docLabel(target), summary: 'Removed an allocation of ' + money().fmt(a.getInt('amount'), a.getString('currency')) + ' from ' + docLabel(target) });
  });
  return { ok: true };
}

/* ================================================================ output */

function allocationsOf(app, doc) {
  const util = u();
  const rows = app.findRecordsByFilter('allocations', "(document = {:d} || credit = {:d}) && state = 'active'", 'created', 0, 0, { d: doc.id });
  return rows.map((a) => {
    const pay = a.getString('payment') !== '' ? util.byId(app, 'payments', a.getString('payment')) : null;
    const credit = a.getString('credit') !== '' ? util.byId(app, 'documents', a.getString('credit')) : null;
    const target = util.byId(app, 'documents', a.getString('document'));
    return {
      id: a.id,
      kind: pay !== null ? 'payment' : 'credit',
      payment: pay !== null ? { id: pay.id, number: pay.getString('number'), date: pay.getString('date'), method: pay.getString('method'), reference: pay.getString('reference') } : null,
      credit: credit !== null ? { id: credit.id, number: credit.getString('number'), type: credit.getString('type'), date: credit.getString('date') } : null,
      document: target !== null ? { id: target.id, number: target.getString('number'), type: target.getString('type'), date: target.getString('date') } : null,
      amount: a.getInt('amount'),
      currency: a.getString('currency'),
      fx_diff: a.getInt('fx_diff'),
      date: a.getString('date'),
      actor: a.getString('actor'),
    };
  });
}

function payOut(app, pay, full) {
  const util = u();
  const m = money();
  const party = util.byId(app, 'parties', pay.getString('party'));
  const bank = util.byId(app, 'banks', pay.getString('bank'));
  const name = (id) => (id === '' ? '' : require(`${__hooks}/lib_audit.js`).memberName(app, id, {}));
  const out = {
    id: pay.id,
    direction: pay.getString('direction'),
    number: pay.getString('number'),
    label: payLabel(pay),
    state: pay.getString('state'),
    party: party !== null ? { id: party.id, name: party.getString('name'), code: party.getString('code') } : null,
    bank: bank !== null ? { id: bank.id, name: bank.getString('name'), kind: bank.getString('kind') } : null,
    date: pay.getString('date'),
    currency: pay.getString('currency'),
    fx_rate: m.e8Text(pay.getInt('fx_e8') || m.E8),
    amount: pay.getInt('amount'),
    amount_base: pay.getInt('amount_base'),
    amount_text: m.minorText(pay.getInt('amount'), pay.getString('currency')),
    allocated: pay.getInt('allocated'),
    unallocated: pay.getInt('unallocated'),
    method: pay.getString('method'),
    reference: pay.getString('reference'),
    memo: pay.getString('memo'),
    agent_note: pay.getString('agent_note'),
    prepared_actor: pay.getString('prepared_actor'),
    prepared_by: pay.getString('prepared_actor') === 'agent' ? 'Your AI agent' : name(pay.getString('prepared_by')),
    posted_by: name(pay.getString('posted_by')),
    posted_at: pay.getString('posted_at'),
    voided_by: name(pay.getString('voided_by')),
    voided_at: pay.getString('voided_at'),
    void_reason: pay.getString('void_reason'),
    created: pay.getString('created'),
  };
  if (full) {
    out.allocations = app.findRecordsByFilter('allocations', "payment = {:p} && state = 'active'", 'created', 0, 0, { p: pay.id }).map((a) => {
      const d = util.byId(app, 'documents', a.getString('document'));
      return { id: a.id, document: d !== null ? { id: d.id, number: d.getString('number'), type: d.getString('type'), date: d.getString('date'), total: d.getInt('total'), balance: d.getInt('balance') } : null, amount: a.getInt('amount'), fx_diff: a.getInt('fx_diff'), date: a.getString('date') };
    });
    const planned = pay.getString('state') === 'draft' ? plannedOf(app, pay) : null;
    out.planned = planned;
    out.open_docs = pay.getString('state') !== 'void' && party !== null ? openDocs(app, party.id, pay.getString('direction') === 'in' ? 'invoice' : 'bill', pay.getString('currency')).map((d) => ({ id: d.id, number: d.getString('number'), date: d.getString('date'), due_date: d.getString('due_date'), total: d.getInt('total'), balance: d.getInt('balance') })) : [];
    const j = pay.getString('journal') !== '' ? util.byId(app, 'journals', pay.getString('journal')) : null;
    out.journal = j !== null ? { id: j.id, number: j.getString('number') } : null;
    const bl = util.findOne(app, 'bank_lines', 'payment = {:p}', { p: pay.id });
    out.bank_line = bl !== null ? { id: bl.id, date: bl.getString('date'), description: bl.getString('description') } : null;
    out.proposals = app.findRecordsByFilter('proposals', "target_entity = 'payments' && target_id = {:p} && status = 'waiting'", '-created', 10, 0, { p: pay.id }).map((r) => ({ id: r.id, title: r.getString('title') }));
  }
  return out;
}

function get(ctx, p) {
  const util = u();
  const pay = loadPayment(ctx, util.req(p, 'payment'), 'view');
  const out = payOut(ctx.app, pay, true);
  const lvl = auth().best(ctx, ['banking', pay.getString('direction') === 'in' ? 'sales' : 'purchasing']);
  out.can = {
    edit: auth().rank(lvl) >= 2 && pay.getString('state') === 'draft',
    post: auth().rank(lvl) >= 3 && pay.getString('state') === 'draft',
    void: auth().rank(lvl) >= 3 && pay.getString('state') === 'posted',
    apply: auth().rank(lvl) >= 3 && pay.getString('state') === 'posted' && pay.getInt('unallocated') > 0,
  };
  return out;
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const dir = util.oneOf(p, 'direction', ['in', 'out'], '');
  if (dir === '') throw util.fail(400, 'direction is required: in or out', 'missing_param');
  auth().needPay(ctx, dir, 'view');
  const pg = util.page(p, 50, 500);
  const where = ['p.direction = {:dir}'];
  const bind = { dir: dir };
  const st = util.str(p, 'status', '');
  if (st !== '') {
    if (st === 'unallocated') where.push("p.state = 'posted' AND p.unallocated > 0");
    else if (['draft', 'posted', 'void'].indexOf(st) >= 0) {
      where.push('p.state = {:st}');
      bind.st = st;
    } else throw util.fail(400, 'status must be draft, posted, void or unallocated', 'invalid_param');
  }
  const partyRef = util.str(p, 'party', '');
  if (partyRef !== '') {
    where.push('p.party = {:party}');
    bind.party = core().resolve(app, 'parties', partyRef).id;
  }
  const bankRef = util.str(p, 'bank', '');
  if (bankRef !== '') {
    where.push('p.bank = {:bank}');
    bind.bank = core().resolve(app, 'banks', bankRef).id;
  }
  const from = util.day(p, 'from', '');
  if (from !== '') {
    where.push('p.date >= {:from}');
    bind.from = from;
  }
  const to = util.day(p, 'to', '');
  if (to !== '') {
    where.push('p.date <= {:to}');
    bind.to = to;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(p.number LIKE {:q} ESCAPE '\\' OR p.reference LIKE {:q} ESCAPE '\\' OR pa.name LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const fromSql = ' FROM payments p LEFT JOIN parties pa ON pa.id = p.party LEFT JOIN banks b ON b.id = p.bank WHERE ' + where.join(' AND ');
  const tot = util.one(app, 'SELECT COUNT(p.id) AS n, IFNULL(SUM(CASE WHEN p.state = \'posted\' THEN p.amount_base ELSE 0 END), 0) AS total' + fromSql, { n: 0, total: 0 }, bind);
  const rows = util.rows(
    app,
    'SELECT p.id AS id, p.number AS number, p.state AS state, p.date AS date, p.currency AS currency, p.amount AS amount, p.amount_base AS amount_base, p.unallocated AS unallocated, p.method AS method, p.reference AS reference, p.prepared_actor AS prepared_actor, IFNULL(pa.id, \'\') AS party_id, IFNULL(pa.name, \'\') AS party_name, IFNULL(b.name, \'\') AS bank_name' +
      fromSql +
      ' ORDER BY p.date DESC, p.created DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset,
    { id: '', number: '', state: '', date: '', currency: '', amount: 0, amount_base: 0, unallocated: 0, method: '', reference: '', prepared_actor: '', party_id: '', party_name: '', bank_name: '' },
    bind,
  );
  const counts = {};
  for (const r of util.rows(app, 'SELECT state, COUNT(id) AS n FROM payments WHERE direction = {:d} GROUP BY state', { state: '', n: 0 }, { d: dir })) counts[r.state] = r.n;
  counts.unallocated = util.one(app, "SELECT COUNT(id) AS n FROM payments WHERE direction = {:d} AND state = 'posted' AND unallocated > 0", { n: 0 }, { d: dir }).n;
  return {
    payments: rows.map((r) => ({ id: r.id, number: r.number, state: r.state, date: r.date, currency: r.currency, amount: r.amount, amount_base: r.amount_base, unallocated: r.unallocated, method: r.method, reference: r.reference, prepared_actor: r.prepared_actor, party: { id: r.party_id, name: r.party_name }, bank: r.bank_name })),
    total: tot.n,
    total_base: tot.total,
    counts: counts,
    currency: core().currency(app),
  };
}

module.exports = {
  allocate: allocate,
  deallocate: deallocate,
  openDocs: openDocs,
  autoApplyCredit: autoApplyCredit,
  allocationsOf: allocationsOf,
  postingLines: postingLines,
  payOut: payOut,
  payLabel: payLabel,
  create: create,
  update: update,
  previewPost: previewPost,
  post: post,
  record: record,
  previewRecord: previewRecord,
  previewVoid: previewVoid,
  voidPayment: voidPayment,
  remove: remove,
  applyTo: applyTo,
  unallocate: unallocate,
  get: get,
  list: list,
};
