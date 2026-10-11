/// <reference path="../pb_data/types.d.ts" />
/**
 * The cash drawer of each register: a session (shift) opened with a counted
 * float, cash paid in and out with a reason, the drawer opened without a
 * sale (recorded), a live X report, and closing by counting the cash (by
 * notes and coins, or a total) against what should be there. The difference
 * and the Z report are kept; your AI agent can be asked to review it.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function auth() {
  return require(`${__hooks}/lib_auth.js`);
}
function audit() {
  return require(`${__hooks}/lib_audit.js`);
}
function moneyOf(s) {
  return require(`${__hooks}/lib_money.js`).of(s);
}

function regOf(app, c, p) {
  const util = u();
  const ref = util.str(p, 'register', '');
  const reg = ref !== '' ? auth().register(app, ref) : c.register;
  if (reg === null) throw util.fail(400, 'register is required');
  return reg;
}

function openShift(db, regId) {
  return u().findOne(db, 'shifts', "register = {:r} && status = 'open'", { r: regId });
}

function shiftJson(db, sh, withReport) {
  const util = u();
  const names = audit().staffNames(db);
  const reg = util.byId(db, 'registers', sh.getString('register'));
  const money = moneyOf(auth().settingsRow(db));
  const out = {
    id: sh.id,
    number: sh.getInt('number'),
    status: sh.getString('status'),
    register: { id: sh.getString('register'), name: reg === null ? '' : reg.getString('name') },
    opened_by: names[sh.getString('opened_by')] || '',
    opened_at: sh.getString('opened_at'),
    opening_float: sh.getInt('opening_float'),
    closed_by: names[sh.getString('closed_by')] || '',
    closed_at: sh.getString('closed_at'),
    counted: sh.getInt('counted'),
    counts: util.getJson(sh, 'counts'),
    expected: sh.getInt('expected'),
    difference: sh.getInt('difference'),
    difference_text: money.text(sh.getInt('difference')),
    note: sh.getString('note'),
  };
  if (withReport) {
    out.report = sh.getString('status') === 'closed' && util.getJson(sh, 'report') !== null ? util.getJson(sh, 'report') : require(`${__hooks}/lib_reports.js`).shiftReport(db, sh);
    out.moves = db.findRecordsByFilter('cash_moves', 'shift = {:s}', '-created', 200, 0, { s: sh.id }).map((m) => ({
      id: m.id,
      kind: m.getString('kind'),
      amount: m.getInt('amount'),
      reason: m.getString('reason'),
      staff: names[m.getString('staff')] || '',
      approved_by: names[m.getString('approved_by')] || '',
      created: m.getString('created'),
    }));
  }
  return out;
}

/** Counts by note and coin ({"2000": 3, "500": 1}, keys in minor units or major text) to a total. */
function countTotal(money, counts) {
  const util = u();
  let total = 0;
  const clean = {};
  for (const k of Object.keys(counts)) {
    const n = Number(counts[k]);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw util.fail(400, 'counts["' + k + '"] must be a whole number of notes or coins');
    const value = /^\d+$/.test(k) ? Number(k) : money.toMinor(k, 'counts key');
    if (!(value > 0)) throw util.fail(400, 'counts keys are note and coin values');
    if (n > 0) clean[String(value)] = n;
    total += value * n;
  }
  return { total: total, counts: clean };
}

function open(app, e, p) {
  const util = u();
  const A = auth();
  const c = A.context(app, e, p);
  A.staffOnly(c, 'Opening the drawer');
  const approver = A.need(app, c, 'open_shift', p, { what: 'Opening the drawer' });
  const money = moneyOf(c.settings);
  const reg = regOf(app, c, p);
  let float = money.param(p, 'float', { min: 0 });
  const counts = util.obj(p, 'counts', '{"2000": 5, "500": 4}');
  let countsClean = null;
  if (counts !== undefined) {
    const ct = countTotal(money, counts);
    if (float !== null && float !== ct.total) throw util.fail(400, 'float and counts disagree (' + money.plain(ct.total) + ')');
    float = ct.total;
    countsClean = ct.counts;
  }
  let sh = null;
  app.runInTransaction((tx) => {
    if (openShift(tx, reg.id) !== null) throw util.fail(409, 'The drawer of ' + reg.getString('name') + ' is already open', { code: 'already_open' });
    const last = tx.findRecordsByFilter('shifts', 'register = {:r}', '-number', 1, 0, { r: reg.id });
    sh = new Record(tx.findCollectionByNameOrId('shifts'));
    sh.set('register', reg.id);
    sh.set('number', last.length ? last[0].getInt('number') + 1 : 1);
    sh.set('status', 'open');
    sh.set('opened_by', c.staffId);
    sh.set('opened_at', new Date().toISOString());
    sh.set('opening_float', float === null ? 0 : float);
    if (countsClean !== null) sh.set('counts', { open: countsClean });
    sh.set('actor', c.actor);
    tx.save(sh);
    audit().log(tx, 'shift_open', c, { approver: approver, register: reg.id, amount: float || 0, detail: reg.getString('name') + ' opened with ' + money.plain(float || 0) });
  });
  return { shift: shiftJson(app, app.findRecordById('shifts', sh.id), true) };
}

function current(app, e, p) {
  const c = auth().context(app, e, p);
  const reg = regOf(app, c, p);
  const sh = openShift(app, reg.id);
  const last = app.findRecordsByFilter('shifts', "register = {:r} && status = 'closed'", '-closed_at', 1, 0, { r: reg.id });
  return {
    register: { id: reg.id, name: reg.getString('name') },
    shift: sh === null ? null : shiftJson(app, sh, true),
    last_closed: last.length ? { id: last[0].id, counted: last[0].getInt('counted'), closed_at: last[0].getString('closed_at') } : null,
  };
}

/** Pay cash in or out of the open drawer, or open it without a sale. */
function cash(app, e, p) {
  const util = u();
  const A = auth();
  const c = A.context(app, e, p);
  A.staffOnly(c, 'Using the drawer');
  const money = moneyOf(c.settings);
  const kind = util.oneOf(p, 'kind', ['pay_in', 'pay_out', 'no_sale'], '');
  if (kind === '') throw util.fail(400, 'kind is required: pay_in, pay_out or no_sale');
  const approver = A.need(app, c, kind === 'no_sale' ? 'no_sale' : 'cash_moves', p, { what: kind === 'no_sale' ? 'Opening the drawer' : 'Paying cash ' + (kind === 'pay_in' ? 'in' : 'out') });
  const reg = regOf(app, c, p);
  const amount = kind === 'no_sale' ? 0 : money.param(p, 'amount', { required: true, min: 1, example: '20.00' });
  const reason = util.str(p, 'reason', '').slice(0, 200);
  if (kind !== 'no_sale' && reason === '') throw util.fail(400, 'reason is required (what the cash is for)');
  let shId = '';
  app.runInTransaction((tx) => {
    const sh = openShift(tx, reg.id);
    if (sh === null) throw util.fail(409, 'Open the drawer on ' + reg.getString('name') + ' first', { code: 'shift_needed' });
    shId = sh.id;
    if (kind === 'pay_out') {
      const exp = require(`${__hooks}/lib_reports.js`).shiftReport(tx, sh).cash.expected;
      if (amount > exp) throw util.fail(400, 'The drawer should hold only ' + money.text(exp));
    }
    const m = new Record(tx.findCollectionByNameOrId('cash_moves'));
    m.set('shift', sh.id);
    m.set('kind', kind);
    m.set('amount', amount);
    m.set('reason', reason);
    m.set('staff', c.staffId);
    if (approver !== null) m.set('approved_by', approver.id);
    m.set('actor', c.actor);
    tx.save(m);
    audit().log(tx, kind, c, { approver: approver, register: reg.id, amount: amount, detail: kind === 'no_sale' ? 'Drawer opened without a sale' + (reason ? ': ' + reason : '') : (kind === 'pay_in' ? 'Paid in ' : 'Paid out ') + money.plain(amount) + ': ' + reason });
  });
  return { shift: shiftJson(app, app.findRecordById('shifts', shId), true) };
}

/** Close the drawer: count the cash, record the difference, keep the Z report. */
function close(app, e, p) {
  const util = u();
  const A = auth();
  const c = A.context(app, e, p);
  A.staffOnly(c, 'Closing the drawer');
  const approver = A.need(app, c, 'close_shift', p, { what: 'Closing the drawer' });
  const money = moneyOf(c.settings);
  const reg = regOf(app, c, p);
  let counted = money.param(p, 'counted', { min: 0 });
  const counts = util.obj(p, 'counts', '{"2000": 12, "500": 3, "25": 8}');
  let countsClean = null;
  if (counts !== undefined) {
    const ct = countTotal(money, counts);
    if (counted !== null && counted !== ct.total) throw util.fail(400, 'counted and counts disagree (' + money.plain(ct.total) + ')');
    counted = ct.total;
    countsClean = ct.counts;
  }
  if (counted === null) throw util.fail(400, 'counted is required: the cash in the drawer (or counts by note and coin)');
  const note = util.str(p, 'note', '').slice(0, 2000);
  let shId = '';
  let diff = 0;
  app.runInTransaction((tx) => {
    const sh = openShift(tx, reg.id);
    if (sh === null) throw util.fail(409, 'The drawer of ' + reg.getString('name') + ' is not open', { code: 'shift_needed' });
    shId = sh.id;
    const report = require(`${__hooks}/lib_reports.js`).shiftReport(tx, sh);
    const expected = report.cash.expected;
    diff = counted - expected;
    sh.set('status', 'closed');
    sh.set('closed_by', c.staffId);
    sh.set('closed_at', new Date().toISOString());
    sh.set('counted', counted);
    const prev = util.getJson(sh, 'counts') || {};
    if (countsClean !== null) prev.close = countsClean;
    sh.set('counts', prev);
    sh.set('expected', expected);
    sh.set('difference', diff);
    sh.set('note', note);
    report.cash.counted = counted;
    report.cash.difference = diff;
    sh.set('report', report);
    tx.save(sh);
    audit().log(tx, 'shift_close', c, {
      approver: approver,
      register: reg.id,
      amount: diff,
      detail: reg.getString('name') + ' closed: counted ' + money.plain(counted) + ', expected ' + money.plain(expected) + (diff === 0 ? ', even' : diff > 0 ? ', over ' + money.plain(diff) : ', short ' + money.plain(-diff)),
    });
  });
  let review = null;
  if (c.settings.getBool('auto_shift_review')) {
    review = require(`${__hooks}/lib_requests.js`).fireFor(app, c, { kind: 'shift_review', shift: shId, title: 'Review of ' + reg.getString('name') + ' shift', body: note });
  }
  return { shift: shiftJson(app, app.findRecordById('shifts', shId), true), difference: diff, review: review };
}

function list(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  auth().need(app, c, 'view_reports', p, { what: 'Drawer history' });
  const filters = [];
  const bind = {};
  const reg = util.str(p, 'register', '');
  if (reg !== '') {
    filters.push('register = {:r}');
    bind.r = auth().register(app, reg).id;
  }
  if (util.str(p, 'from', '') !== '' || util.str(p, 'to', '') !== '') {
    const r = util.range(p, 30);
    filters.push('opened_at >= {:a} && opened_at < {:b}');
    bind.a = util.dbDate(r.start);
    bind.b = util.dbDate(r.end);
  }
  const limit = util.int(p, 'limit', 50, 1, 500);
  const rows = app.findRecordsByFilter('shifts', filters.join(' && '), '-opened_at', limit + 1, 0, bind);
  return { shifts: rows.slice(0, limit).map((s) => shiftJson(app, s, false)), more: rows.length > limit };
}

function get(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const sh = util.byId(app, 'shifts', util.req(p, 'shift', '<shift id>'));
  if (sh === null) throw util.fail(404, 'No such drawer session');
  if (!(sh.getString('status') === 'open' && sh.getString('register') === c.registerId)) auth().need(app, c, 'view_reports', p, { what: 'Drawer history' });
  return { shift: shiftJson(app, sh, true) };
}

module.exports = { open: open, current: current, cash: cash, close: close, list: list, get: get, openShift: openShift, shiftJson: shiftJson };
