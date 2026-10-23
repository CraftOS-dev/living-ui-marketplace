/// <reference path="../pb_data/types.d.ts" />
/**
 * Fixed assets with straight-line depreciation.
 *
 * Each month from the month an asset goes into service takes an equal share
 * of (cost - salvage) over its life; the last month takes what is left, so
 * the total is exact. Depreciation posts one entry per month for all assets
 * (Dr depreciation, Cr accumulated depreciation), never twice: each asset
 * remembers the last month posted.
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
function ledger() {
  return require(`${__hooks}/lib_ledger.js`);
}

/** Depreciation of month index i (0-based) of an asset's life. */
function share(cost, salvage, life, i) {
  const base = cost - salvage;
  if (i < 0 || i >= life || base <= 0) return 0;
  const per = Math.floor(base / life);
  return i === life - 1 ? base - per * (life - 1) : per;
}

function monthIndex(start, month) {
  const s = start.slice(0, 7);
  return (Number(month.slice(0, 4)) - Number(s.slice(0, 4))) * 12 + (Number(month.slice(5, 7)) - Number(s.slice(5, 7)));
}

function assetOut(app, a, full) {
  const util = u();
  const acc = (id) => {
    const r = util.byId(app, 'accounts', id);
    return r === null ? null : { id: r.id, code: r.getString('code'), name: r.getString('name') };
  };
  const out = {
    id: a.id,
    number: a.getString('number'),
    name: a.getString('name'),
    cost: a.getInt('cost'),
    salvage: a.getInt('salvage'),
    start: a.getString('start'),
    life_months: a.getInt('life_months'),
    status: a.getString('status'),
    depreciated: a.getInt('depreciated'),
    book_value: a.getInt('cost') - a.getInt('depreciated'),
    last_month: a.getString('last_month'),
    disposed_on: a.getString('disposed_on'),
    monthly: share(a.getInt('cost'), a.getInt('salvage'), a.getInt('life_months'), 0),
    asset_account: acc(a.getString('asset_account')),
    accumulated_account: acc(a.getString('accumulated_account')),
    expense_account: acc(a.getString('expense_account')),
    department: a.getString('department'),
    notes: a.getString('notes'),
  };
  if (full) {
    const sched = [];
    let acc2 = 0;
    for (let i = 0; i < a.getInt('life_months') && i < 600; i++) {
      const m = util.addMonths(a.getString('start').slice(0, 7), i);
      const v = share(a.getInt('cost'), a.getInt('salvage'), a.getInt('life_months'), i);
      acc2 += v;
      sched.push({ month: m, amount: v, accumulated: acc2, book_value: a.getInt('cost') - acc2, posted: a.getString('last_month') !== '' && m <= a.getString('last_month') });
    }
    out.schedule = sched;
  }
  return out;
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const st = util.oneOf(p, 'status', ['active', 'disposed'], '');
  const recs = app.findRecordsByFilter('assets', st !== '' ? 'status = {:s}' : '', 'number', 0, 0, { s: st });
  const assets = recs.map((a) => assetOut(app, a, false));
  return { assets: assets, cost: assets.reduce((s, a) => s + (a.status === 'active' ? a.cost : 0), 0), book_value: assets.reduce((s, a) => s + (a.status === 'active' ? a.book_value : 0), 0), currency: core().currency(app) };
}

function get(ctx, p) {
  const a = core().resolve(ctx.app, 'assets', u().req(p, 'asset'));
  return Object.assign(assetOut(ctx.app, a, true), { currency: core().currency(ctx.app) });
}

function readAsset(ctx, app, a, p, isNew) {
  const util = u();
  const c = core();
  const cur = c.currency(app);
  const posted = a.getInt('depreciated') > 0;
  if (util.has(p, 'name')) a.set('name', util.squash(util.text(p, 'name', 160, '')));
  if (isNew && a.getString('name') === '') throw util.fail(400, 'name is required', 'missing_param');
  if (util.has(p, 'cost')) {
    if (posted) throw util.fail(409, 'Depreciation has posted; the cost stays.', 'has_history');
    a.set('cost', util.money(p, 'cost', cur, { required: true, positive: true }));
  }
  if (util.has(p, 'salvage')) {
    if (posted) throw util.fail(409, 'Depreciation has posted; the salvage value stays.', 'has_history');
    a.set('salvage', util.money(p, 'salvage', cur) || 0);
  }
  if (a.getInt('salvage') >= a.getInt('cost') && a.getInt('cost') > 0) throw util.fail(400, 'The salvage value must be less than the cost.', 'invalid_param');
  if (util.has(p, 'start')) {
    if (posted) throw util.fail(409, 'Depreciation has posted; the start stays.', 'has_history');
    a.set('start', util.day(p, 'start', util.today()));
  }
  if (util.has(p, 'life_months')) {
    if (posted) throw util.fail(409, 'Depreciation has posted; the life stays.', 'has_history');
    a.set('life_months', util.int(p, 'life_months', 36, 1, 1200));
  }
  for (const f of [['asset_account', 'fixed_assets'], ['accumulated_account', 'accumulated_depreciation'], ['expense_account', 'depreciation']]) {
    if (util.has(p, f[0])) {
      const acc = c.resolve(app, 'accounts', util.str(p, f[0], ''));
      a.set(f[0], acc.id);
    } else if (isNew) a.set(f[0], c.systemAccount(app, f[1]).id);
  }
  if (util.has(p, 'department')) {
    const d = c.resolveOpt(app, 'departments', util.str(p, 'department', ''));
    a.set('department', d !== null ? d.id : '');
  }
  if (util.has(p, 'notes')) a.set('notes', util.text(p, 'notes', 1000, ''));
}

function add(ctx, p) {
  const util = u();
  const app = ctx.app;
  let id = '';
  app.runInTransaction((tx) => {
    const a = util.newRecord(tx, 'assets');
    a.set('status', 'active');
    a.set('depreciated', 0);
    a.set('last_month', '');
    a.set('salvage', 0);
    readAsset(ctx, tx, a, p, true);
    a.set('number', core().nextNumber(tx, 'asset'));
    tx.save(a);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'create', entity: 'assets', ref: a.id, label: a.getString('number'), summary: 'Registered the asset ' + a.getString('name') });
    id = a.id;
  });
  return get(ctx, { asset: id });
}

function update(ctx, p) {
  const app = ctx.app;
  const a = core().resolve(app, 'assets', u().req(p, 'asset'));
  readAsset(ctx, app, a, p, false);
  app.save(a);
  return get(ctx, { asset: a.id });
}

/** What depreciating through `month` would post: per asset, the months not yet posted. */
function plan(app, month) {
  const util = u();
  const out = [];
  for (const a of app.findRecordsByFilter('assets', "status = 'active'", 'number', 0, 0)) {
    const startM = a.getString('start').slice(0, 7);
    if (startM > month) continue;
    const firstM = a.getString('last_month') === '' ? startM : util.addMonths(a.getString('last_month'), 1);
    for (const m of util.monthsBetween(firstM, month)) {
      const v = share(a.getInt('cost'), a.getInt('salvage'), a.getInt('life_months'), monthIndex(a.getString('start'), m));
      out.push({ asset: a, month: m, amount: v });
    }
  }
  return out;
}

function linesFor(rows, month) {
  const byMonth = {};
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const list = byMonth[r.month] || [];
    list.push({ account: r.asset.getString('expense_account'), debit: r.amount, credit: 0, department: r.asset.getString('department'), memo: r.asset.getString('number') + ' ' + r.asset.getString('name') });
    list.push({ account: r.asset.getString('accumulated_account'), debit: 0, credit: r.amount, memo: r.asset.getString('number') + ' ' + r.asset.getString('name') });
    byMonth[r.month] = list;
  }
  void month;
  return byMonth;
}

function previewDepreciate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const month = util.monthParam(p, 'month', '');
  if (month === '') throw util.fail(400, 'month is required (YYYY-MM)', 'missing_param');
  const rows = plan(app, month);
  const byMonth = linesFor(rows, month);
  const all = [];
  for (const m of Object.keys(byMonth)) for (const l of byMonth[m]) all.push(l);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    kind: 'journal',
    auto: 'journal',
    amount: total,
    title: 'Depreciation through ' + month,
    summary: Object.keys(byMonth).length + ' months for ' + new Set(rows.map((r) => r.asset.id)).size + ' assets, ' + money().fmt(total, core().currency(app)),
    lines: ledger().describeLines(app, ledger().compact(all)),
    currency: core().currency(app),
    target: { entity: 'assets', id: rows.length > 0 ? rows[0].asset.id : '', label: 'Depreciation' },
  };
}

function depreciate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const month = util.monthParam(p, 'month', '');
  if (month === '') throw util.fail(400, 'month is required (YYYY-MM)', 'missing_param');
  if (month > util.today().slice(0, 7)) throw util.fail(409, 'Depreciation runs for months that have started.', 'too_early');
  const rows = plan(app, month);
  if (rows.length === 0) return { posted: 0, journals: [], message: 'Depreciation is already posted through ' + month + '.' };
  const byMonth = linesFor(rows, month);
  const journals = [];
  app.runInTransaction((tx) => {
    for (const m of Object.keys(byMonth).sort()) {
      const date = ledger().firstOpenDate(tx, ctx, util.monthEnd(m));
      const j = ledger().post(tx, ctx, { kind: 'depreciation', date: date, memo: 'Depreciation for ' + m, source: { entity: 'assets', id: '', label: 'Depreciation ' + m }, lines: byMonth[m] });
      if (j !== null) journals.push(j.getString('number'));
    }
    const per = {};
    for (const r of rows) {
      const k = r.asset.id;
      per[k] = per[k] || { amount: 0, last: '' };
      per[k].amount += r.amount;
      if (r.month > per[k].last) per[k].last = r.month;
    }
    for (const id of Object.keys(per)) {
      const a = tx.findRecordById('assets', id);
      a.set('depreciated', a.getInt('depreciated') + per[id].amount);
      a.set('last_month', per[id].last);
      tx.save(a);
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'post', entity: 'assets', ref: '', label: 'Depreciation', summary: 'Posted depreciation through ' + month + ' (' + journals.join(', ') + ')' });
  });
  return { posted: journals.length, journals: journals, total: rows.reduce((s, r) => s + r.amount, 0) };
}

function dispose(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = core();
  const a = c.resolve(app, 'assets', util.req(p, 'asset'));
  if (a.getString('status') !== 'active') throw util.fail(409, 'This asset is already disposed of.', 'invalid_state');
  const date = util.day(p, 'date', util.today());
  const due = util.addMonths(date.slice(0, 7), -1);
  if (a.getString('start').slice(0, 7) <= due && a.getString('last_month') < due && a.getInt('depreciated') < a.getInt('cost') - a.getInt('salvage')) throw util.fail(409, 'Post depreciation through ' + due + ' first, so the gain or loss is right.', 'depreciation_due', { month: due });
  const cur = c.currency(app);
  const proceeds = util.money(p, 'proceeds', cur) || 0;
  let procAcc = '';
  if (proceeds > 0) procAcc = c.resolve(app, 'accounts', util.req(p, 'proceeds_account')).id;
  const cost = a.getInt('cost');
  const dep = a.getInt('depreciated');
  const book = cost - dep;
  const gain = proceeds - book;
  const other = c.systemAccount(app, 'other_income');
  const lines = [
    { account: a.getString('accumulated_account'), debit: dep, credit: 0, memo: 'Dispose ' + a.getString('number') },
    { account: a.getString('asset_account'), debit: 0, credit: cost, memo: 'Dispose ' + a.getString('number') },
  ];
  if (proceeds > 0) lines.push({ account: procAcc, debit: proceeds, credit: 0, memo: 'Sale of ' + a.getString('name') });
  if (gain > 0) lines.push({ account: other.id, debit: 0, credit: gain, memo: 'Gain on disposal' });
  if (gain < 0) lines.push({ account: a.getString('expense_account'), debit: -gain, credit: 0, memo: 'Loss on disposal' });
  app.runInTransaction((tx) => {
    ledger().post(tx, ctx, { kind: 'depreciation', date: date, memo: 'Disposal of ' + a.getString('number') + ' ' + a.getString('name'), source: { entity: 'assets', id: a.id, label: a.getString('number') }, lines: lines });
    const x = tx.findRecordById('assets', a.id);
    x.set('status', 'disposed');
    x.set('disposed_on', date);
    tx.save(x);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'dispose', entity: 'assets', ref: a.id, label: a.getString('number'), summary: 'Disposed of ' + a.getString('name') + (proceeds > 0 ? ' for ' + money().fmt(proceeds, cur) : '') });
  });
  return get(ctx, { asset: a.id });
}

function remove(ctx, p) {
  const util = u();
  const a = core().resolve(ctx.app, 'assets', util.req(p, 'asset'));
  if (a.getInt('depreciated') > 0) throw util.fail(409, 'Depreciation has posted for this asset; dispose of it instead.', 'has_history');
  if (util.bool(p, 'preview', false)) return { preview: true };
  ctx.app.delete(a);
  return { deleted: true };
}

module.exports = { share: share, list: list, get: get, add: add, update: update, previewDepreciate: previewDepreciate, depreciate: depreciate, dispose: dispose, remove: remove };
