/// <reference path="../pb_data/types.d.ts" />
/**
 * Money, kept light: what went out and came in this month against a
 * budget, savings pots that fill up (a money goal can measure itself from
 * one), and the bills that come every month with a "paid" tick. Amounts are
 * whole minor units of the person's currency (lib_core.amount reads "12.50").
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}
let rec_ = null;
function rec() {
  return rec_ || (rec_ = require(`${__hooks}/lib_rec.js`));
}

const SPEND = ['food', 'groceries', 'transport', 'home', 'bills', 'fun', 'health', 'shopping', 'gifts', 'other'];
const INCOME = ['salary', 'extra'];
const BILL_CATS = ['home', 'bills', 'transport', 'health', 'fun', 'shopping', 'other'];

function entryOut(r) {
  return { id: r.id, date: r.getString('date'), amount: r.getInt('amount'), kind: r.getString('kind'), category: r.getString('category'), note: r.getString('note'), actor: r.getString('actor') };
}

function readEntry(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'kind')) r.set('kind', util.oneOf(p, 'kind', ['spend', 'income'], creating ? 'spend' : r.getString('kind')));
  const a = C.amount(ctx.app, p, 'amount', creating);
  if (a !== undefined) {
    if (a <= 0) throw util.fail(400, 'amount must be more than zero.', 'invalid_param', { param: 'amount' });
    r.set('amount', a);
  }
  const kind = r.getString('kind');
  if (creating || util.has(p, 'category')) r.set('category', util.oneOf(p, 'category', kind === 'income' ? INCOME : SPEND, kind === 'income' ? 'salary' : creating ? 'other' : r.getString('category')));
  if (creating || util.has(p, 'date')) r.set('date', util.day(p, 'date', C.today(ctx.app)));
  if (util.has(p, 'note')) r.set('note', C.name(p, 'note', 200, ''));
}

const entries = rec().crud({
  collection: 'money_entries',
  param: 'entry',
  one: 'entry',
  listKey: 'entries',
  noun: (r) => (r.getString('kind') === 'income' ? 'income of ' : 'a spend of ') + core().money($app, r.getInt('amount')) + (r.getString('note') !== '' ? ' (' + r.getString('note') + ')' : ''),
  fields: ['date', 'amount', 'kind', 'category', 'note'],
  read: readEntry,
  out: (app, r) => entryOut(r),
  sort: '-date,-created',
  where: (ctx, p) => {
    const util = u();
    const C = core();
    const to = util.day(p, 'to', C.today(ctx.app));
    const from = util.day(p, 'from', C.monthStart(to));
    const cat = util.str(p, 'category', '');
    return { filter: 'date >= {:f} && date <= {:t}' + (cat !== '' ? ' && category = {:c}' : ''), bind: { f: from, t: to, c: cat }, limit: util.int(p, 'limit', 200, 1, 2000) };
  },
});

/** money.month: the month at a glance. */
function month(ctx, p) {
  const util = u();
  const C = core();
  const today = C.today(ctx.app);
  const m = util.str(p, 'month', today.slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(m)) throw util.fail(400, 'month is YYYY-MM', 'invalid_param', { param: 'month' });
  const start = m + '-01';
  const end = C.monthEnd(start);
  const list = ctx.app.findRecordsByFilter('money_entries', 'date >= {:f} && date <= {:t}', '-date,-created', 0, 0, { f: start, t: end }).map(entryOut);
  const spent = list.filter((e) => e.kind === 'spend').reduce((a, e) => a + e.amount, 0);
  const income = list.filter((e) => e.kind === 'income').reduce((a, e) => a + e.amount, 0);
  const byCat = {};
  list.filter((e) => e.kind === 'spend').forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + e.amount));
  const days = C.between(start, end) + 1;
  const daily = [];
  for (let i = 0; i < days; i++) {
    const d = C.addDays(start, i);
    daily.push({ date: d, spent: list.filter((e) => e.kind === 'spend' && e.date === d).reduce((a, e) => a + e.amount, 0) });
  }
  const budget = C.prefs(ctx.app).month_budget;
  const isNow = today >= start && today <= end;
  const daysLeft = isNow ? C.between(today, end) + 1 : 0;
  // Last month at the same point, to compare.
  const prevStart = C.addMonths(start, -1);
  const prevUpto = isNow ? C.addMonths(today, -1) : C.monthEnd(prevStart);
  const prev = util.one(ctx.app, "SELECT IFNULL(SUM(amount), 0) AS n FROM money_entries WHERE kind = 'spend' AND date >= {:f} AND date <= {:t}", { n: 0 }, { f: prevStart, t: prevUpto });
  return {
    month: m,
    currency: C.prefs(ctx.app).currency,
    digits: C.digits(ctx.app),
    spent: spent,
    income: income,
    budget: budget,
    left: budget > 0 ? budget - spent : null,
    per_day_left: budget > 0 && daysLeft > 0 ? Math.floor(Math.max(0, budget - spent) / daysLeft) : null,
    days_left: daysLeft,
    last_month_same_point: prev === null ? 0 : prev.n,
    spent_text: C.money(ctx.app, spent),
    income_text: C.money(ctx.app, income),
    budget_text: budget > 0 ? C.money(ctx.app, budget) : null,
    left_text: budget > 0 ? C.money(ctx.app, budget - spent) : null,
    per_day_left_text: budget > 0 && daysLeft > 0 ? C.money(ctx.app, Math.floor(Math.max(0, budget - spent) / daysLeft)) : null,
    by_category: Object.keys(byCat)
      .map((k) => ({ category: k, amount: byCat[k], amount_text: C.money(ctx.app, byCat[k]) }))
      .sort((a, b) => b.amount - a.amount),
    daily: daily,
    entries: list.slice(0, 60),
    bills: billsFor(ctx.app, m, today),
    pots: ctx.app.findRecordsByFilter('money_pots', '', 'rank,created', 0, 0).map(potOut),
  };
}

/* ---------------------------------------------------------------- pots */

function potOut(r) {
  const target = r.getInt('target');
  const saved = r.getInt('saved');
  return { id: r.id, name: r.getString('name'), target: target, saved: saved, progress: target > 0 ? Math.min(1, saved / target) : 0, look: r.getInt('look'), done_at: r.getString('done_at'), actor: r.getString('actor') };
}

function afterPot(app, refs) {
  require(`${__hooks}/lib_goals.js`).recomputeMeasure(app, 'pot');
  void refs;
}

function readPot(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'name')) r.set('name', C.name(p, 'name', 80));
  const t = C.amount(ctx.app, p, 'target', false);
  if (t !== undefined) r.set('target', t);
  const s = C.amount(ctx.app, p, 'saved', false);
  if (s !== undefined) r.set('saved', s);
  if (util.has(p, 'look')) r.set('look', util.int(p, 'look', 0, 0, 7));
  else if (creating) r.set('look', Math.floor(Math.random() * 8));
  if (creating) r.set('rank', C.nextRank(ctx.app, 'money_pots'));
}

const pots = rec().crud({
  collection: 'money_pots',
  param: 'pot',
  one: 'pot',
  listKey: 'pots',
  noun: (r) => 'the "' + r.getString('name') + '" pot',
  fields: ['name', 'target', 'saved', 'look', 'rank', 'done_at'],
  read: readPot,
  out: (app, r) => potOut(r),
  sort: 'rank,created',
  after: afterPot,
  afterName: 'lib_money.afterPot',
});

/** pots.add: put money in a pot (or take some out with a minus amount... use take: true). */
function potAdd(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'pot');
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'money_pots', id, 'pot');
    const before = rec().snapshot(r, ['saved', 'done_at']);
    const a = C.amount(t, p, 'amount', true);
    const take = util.bool(p, 'take', false);
    const saved = Math.max(0, r.getInt('saved') + (take ? -a : a));
    r.set('saved', saved);
    r.set('done_at', r.getInt('target') > 0 && saved >= r.getInt('target') ? r.getString('done_at') || util.nowIso() : '');
    t.save(r);
    afterPot(t);
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: (take ? 'Took ' : 'Put ') + C.money(t, a) + (take ? ' from' : ' in') + ' the "' + r.getString('name') + '" pot', target: 'money_pots', record: r.id, undo: { fn: 'lib_rec.undoUpdate', args: { collection: 'money_pots', id: r.id, fields: before, after: 'lib_money.afterPot' } } });
  });
  return { pot: potOut(ctx.app.findRecordById('money_pots', id)) };
}

/* --------------------------------------------------------------- bills */

function billOut(r, m, today) {
  const C = core();
  const dueDay = r.getInt('due_day');
  const last = Number(C.monthEnd(m + '-01').slice(8, 10));
  const due = m + '-' + C.pad(Math.min(dueDay, last));
  const paid = r.getString('paid_month') >= m;
  return { id: r.id, name: r.getString('name'), amount: r.getInt('amount'), due_day: dueDay, category: r.getString('category'), active: r.getBool('active'), due_date: due, paid: paid, in_days: C.between(today, due), late: !paid && due < today, actor: r.getString('actor') };
}

function billsFor(app, m, today) {
  return app
    .findRecordsByFilter('bills', 'active = true', 'due_day,rank', 0, 0)
    .map((r) => billOut(r, m, today))
    .sort((a, b) => (a.paid === b.paid ? a.due_day - b.due_day : a.paid ? 1 : -1));
}

function readBill(ctx, p, r, creating) {
  const util = u();
  const C = core();
  if (creating || util.has(p, 'name')) r.set('name', C.name(p, 'name', 80));
  const a = C.amount(ctx.app, p, 'amount', false);
  if (a !== undefined) r.set('amount', a);
  if (creating || util.has(p, 'due_day')) r.set('due_day', util.int(p, 'due_day', 1, 1, 31));
  if (creating || util.has(p, 'category')) r.set('category', util.oneOf(p, 'category', BILL_CATS, creating ? 'bills' : r.getString('category')));
  if (creating) r.set('active', true);
  if (util.has(p, 'active')) r.set('active', util.bool(p, 'active', true));
  if (creating) r.set('rank', C.nextRank(ctx.app, 'bills'));
}

const bills = rec().crud({
  collection: 'bills',
  param: 'bill',
  one: 'bill',
  noun: (r) => 'the bill "' + r.getString('name') + '"',
  fields: ['name', 'amount', 'due_day', 'category', 'paid_month', 'active', 'rank'],
  read: readBill,
  out: (app, r) => {
    const t = core().today(app);
    return billOut(r, t.slice(0, 7), t);
  },
  sort: 'due_day,rank',
});

/** bills.pay: this month's bill is paid (and, unless record is false, noted as a spend). */
function billPay(ctx, p) {
  const util = u();
  const C = core();
  const id = util.req(p, 'bill');
  const paid = util.bool(p, 'paid', true);
  rec().tx(ctx.app, (t) => {
    const r = C.need(t, 'bills', id, 'bill');
    const today = C.today(t);
    const m = today.slice(0, 7);
    const before = rec().snapshot(r, ['paid_month']);
    r.set('paid_month', paid ? m : C.addMonths(m + '-01', -1).slice(0, 7));
    t.save(r);
    let entry = '';
    if (paid && util.bool(p, 'record', true) && r.getInt('amount') > 0) {
      const e = util.newRecord(t, 'money_entries');
      e.set('date', today);
      e.set('amount', r.getInt('amount'));
      e.set('kind', 'spend');
      e.set('category', SPEND.indexOf(r.getString('category')) >= 0 ? r.getString('category') : 'bills');
      e.set('note', r.getString('name'));
      e.set('actor', ctx.actor);
      t.save(e);
      entry = e.id;
    }
    require(`${__hooks}/lib_activity.js`).write(t, ctx, { label: (paid ? 'Paid ' : 'Unmarked ') + r.getString('name'), target: 'bills', record: r.id, undo: { fn: 'lib_money.undoPay', args: { bill: r.id, fields: before, entry: entry } } });
  });
  const today = C.today(ctx.app);
  return { bill: billOut(ctx.app.findRecordById('bills', id), today.slice(0, 7), today) };
}

function undoPay(ctx, args) {
  const util = u();
  const r = util.byId(ctx.app, 'bills', args.bill);
  if (r !== null) {
    r.set('paid_month', args.fields.paid_month);
    ctx.app.save(r);
  }
  if (args.entry) {
    const e = util.byId(ctx.app, 'money_entries', args.entry);
    if (e !== null) ctx.app.delete(e);
  }
}

module.exports = {
  SPEND: SPEND,
  INCOME: INCOME,
  month: month,
  entryList: entries.list,
  entryAdd: entries.create,
  entryUpdate: entries.update,
  entryRemove: entries.remove,
  potOut: potOut,
  afterPot: afterPot,
  potList: pots.list,
  potCreate: pots.create,
  potUpdate: pots.update,
  potRemove: pots.remove,
  potAdd: potAdd,
  billsFor: billsFor,
  billList: bills.list,
  billCreate: bills.create,
  billUpdate: bills.update,
  billRemove: bills.remove,
  billPay: billPay,
  undoPay: undoPay,
};
