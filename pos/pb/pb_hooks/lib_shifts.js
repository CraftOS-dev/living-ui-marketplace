/// <reference path="../pb_data/types.d.ts" />
/**
 * Shifts: a register is opened with a counted float, sells, takes cash in
 * and out with a reason, and is closed by counting the drawer. The close is
 * blind for the person counting (the screen asks for the count before it
 * shows what was expected), and writes the Z report: a frozen summary of
 * the shift that never changes afterwards. Shift numbers are gapless per
 * register.
 *
 * Expected cash = opening float + cash taken - cash refunded + paid in -
 * paid out - dropped to the safe. Training sales never touch the drawer.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function core() {
  return require(`${__hooks}/lib_core.js`);
}

/** A denomination count { "5000": 2, "100": 7 } (minor units -> how many) and its total. */
function readCounts(p, name) {
  const util = u();
  const raw = util.obj(p, name);
  if (raw === undefined) return null;
  const counts = {};
  let total = 0;
  for (const k of Object.keys(raw)) {
    const value = Number(k);
    const n = Number(raw[k]);
    if (!Number.isInteger(value) || value <= 0 || value > 100000000) throw util.fail(400, name + ' keys are coin and note values in minor units, e.g. {"5000": 2, "100": 7}');
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw util.fail(400, name + ' counts are whole numbers');
    if (n > 0) counts[String(value)] = n;
    total += value * n;
  }
  return { counts: counts, total: total };
}

/** An amount from either a plain amount param or a denomination count. */
function amountOrCounts(p, amountName, countsName, exp) {
  const util = u();
  const c = readCounts(p, countsName);
  if (c !== null) return c;
  const amount = util.money(p, amountName, exp, {});
  if (amount === null) return null;
  return { counts: {}, total: amount };
}

function openShift(app, registerId) {
  return u().findOne(app, 'shifts', 'register = {:r} && status = "open"', { r: registerId });
}

function open(app, reg, p, ctx) {
  const util = u();
  const s = core().shop(app);
  if (reg.getBool('archived')) throw util.fail(409, 'Register ' + reg.getString('code') + ' is archived', 'register_archived');
  const float = amountOrCounts(p, 'float', 'counts', s.exp) || { counts: {}, total: 0 };
  let shift = null;
  app.runInTransaction((tx) => {
    if (openShift(tx, reg.id) !== null) throw util.fail(409, reg.getString('name') + ' is already open.', 'shift_open');
    const r = tx.findRecordById('registers', reg.id);
    const number = r.getInt('z_seq') + 1;
    r.set('z_seq', number);
    tx.save(r);
    shift = new Record(tx.findCollectionByNameOrId('shifts'));
    shift.set('register', reg.id);
    shift.set('number', number);
    shift.set('status', 'open');
    shift.set('opened_by', ctx.staff.id);
    shift.set('opening_float', float.total);
    shift.set('opening_counts', float.counts);
    shift.set('closed_by', '');
    shift.set('closed_at', '');
    shift.set('counted_cash', 0);
    shift.set('closing_counts', {});
    shift.set('expected_cash', 0);
    shift.set('variance', 0);
    shift.set('note', '');
    shift.set('summary', null);
    tx.save(shift);
    core().audit(tx, {
      kind: 'shift_open',
      actor: 'staff',
      staff: ctx.staff.id,
      register: reg.id,
      ref: reg.getString('code') + ' #' + number,
      summary: 'Opened ' + reg.getString('name') + ' with ' + util.moneyText(float.total, s.exp, s.currency),
    });
  });
  return report(app, shift);
}

function cashMove(app, reg, p, ctx) {
  const util = u();
  const s = core().shop(app);
  const kind = util.oneOf(p, 'kind', ['pay_in', 'pay_out', 'drop'], '');
  if (kind === '') throw util.fail(400, 'kind is required: pay_in, pay_out or drop');
  const amount = util.money(p, 'amount', s.exp, { required: true });
  if (amount <= 0) throw util.fail(400, 'amount must be more than 0');
  const reason = util.squash(util.req(p, 'reason', '"Float top-up"'));
  let rec = null;
  app.runInTransaction((tx) => {
    const shift = openShift(tx, reg.id);
    if (shift === null) throw util.fail(409, 'Open the register first.', 'shift_closed');
    rec = new Record(tx.findCollectionByNameOrId('cash_moves'));
    rec.set('shift', shift.id);
    rec.set('register', reg.id);
    rec.set('kind', kind);
    rec.set('amount', amount);
    rec.set('reason', reason.slice(0, 200));
    rec.set('staff', ctx.staff.id);
    rec.set('approver', ctx.approval ? ctx.approval.getString('approver') : '');
    tx.save(rec);
    if (ctx.approval) require(`${__hooks}/lib_auth.js`).consume(tx, ctx.approval);
    const label = kind === 'pay_in' ? 'Paid in' : kind === 'pay_out' ? 'Paid out' : 'Dropped to the safe';
    core().audit(tx, {
      kind: 'cash_move',
      actor: 'staff',
      staff: ctx.staff.id,
      approver: ctx.approval ? ctx.approval.getString('approver') : '',
      register: reg.id,
      ref: reg.getString('code'),
      summary: label + ' ' + util.moneyText(amount, s.exp, s.currency) + ': ' + reason,
    });
  });
  return { id: rec.id, kind: kind, amount: amount, reason: reason };
}

/* ------------------------------------------------------------- summary */

/** Everything about a shift, computed from the ledger (the X report; frozen as the Z at close). */
function summarize(app, shift) {
  const util = u();
  const s = core().shop(app);
  const id = shift.id;
  const bind = { sh: id };
  const reg = util.byId(app, 'registers', shift.getString('register'));
  const staffNames = {};
  for (const st of app.findRecordsByFilter('staff', '', '', 0, 0)) staffNames[st.id] = st.getString('name');

  const tot = util.rows(
    app,
    "SELECT COUNT(CASE WHEN kind != 'refund' THEN 1 END) AS orders, COUNT(CASE WHEN kind = 'refund' THEN 1 END) AS refunds, IFNULL(SUM(total), 0) AS total, IFNULL(SUM(tax_total), 0) AS tax, IFNULL(SUM(service_charge), 0) AS service, IFNULL(SUM(rounding), 0) AS rounding FROM sales WHERE shift = {:sh} AND training = false",
    { orders: 0, refunds: 0, total: 0, tax: 0, service: 0, rounding: 0 },
    bind,
  )[0];
  const ln = util.rows(
    app,
    'SELECT IFNULL(SUM(CASE WHEN l.qty > 0 THEN l.qty END), 0) AS items, IFNULL(SUM(CASE WHEN l.qty > 0 THEN l.gross END), 0) AS gross, IFNULL(SUM(CASE WHEN l.qty > 0 THEN l.line_discount + l.order_discount END), 0) AS discounts, IFNULL(SUM(CASE WHEN l.qty < 0 THEN -l.net END), 0) AS returns, IFNULL(SUM(CASE WHEN l.qty < 0 THEN -l.qty END), 0) AS returned_items, IFNULL(SUM(l.net), 0) AS net, IFNULL(SUM(l.tax), 0) AS line_tax FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.shift = {:sh} AND s.training = false',
    { items: 0, gross: 0, discounts: 0, returns: 0, returned_items: 0, net: 0, line_tax: 0 },
    bind,
  )[0];
  // Net sales before tax (the price includes the tax when prices are tax-inclusive).
  const netEx = util.rows(
    app,
    "SELECT IFNULL(SUM(CASE WHEN s.price_mode = 'inclusive' THEN l.net - l.tax ELSE l.net END), 0) AS v FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.shift = {:sh} AND s.training = false",
    { v: 0 },
    bind,
  )[0].v;

  const taxes = {};
  for (const sale of app.findRecordsByFilter('sales', 'shift = {:sh} && training = false', '', 0, 0, bind)) {
    for (const t of util.jsonOf(sale, 'taxes', [])) {
      const key = String(t.rate_bp);
      if (taxes[key] === undefined) taxes[key] = { name: t.name, rate_bp: t.rate_bp, mark: t.mark || '', base: 0, tax: 0, gross: 0 };
      else if (t.name && taxes[key].name.split(' + ').indexOf(t.name) < 0) taxes[key].name += ' + ' + t.name;
      taxes[key].base += t.base;
      taxes[key].tax += t.tax;
      taxes[key].gross += t.gross;
    }
  }
  const tenders = util.rows(
    app,
    'SELECT name, kind, COUNT(id) AS n, IFNULL(SUM(amount), 0) AS amount FROM payments WHERE shift = {:sh} AND training = false GROUP BY name, kind ORDER BY amount DESC',
    { name: '', kind: '', n: 0, amount: 0 },
    bind,
  );
  const cashFlow = util.rows(
    app,
    "SELECT IFNULL(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS taken, IFNULL(SUM(CASE WHEN amount < 0 THEN -amount END), 0) AS refunded FROM payments WHERE shift = {:sh} AND training = false AND kind = 'cash'",
    { taken: 0, refunded: 0 },
    bind,
  )[0];
  const moves = app.findRecordsByFilter('cash_moves', 'shift = {:sh}', 'created', 0, 0, bind).map((m) => ({
    id: m.id,
    kind: m.getString('kind'),
    amount: m.getInt('amount'),
    reason: m.getString('reason'),
    staff: staffNames[m.getString('staff')] || '',
    approver: staffNames[m.getString('approver')] || '',
    created: m.getString('created'),
  }));
  const sumKind = (k) => moves.filter((m) => m.kind === k).reduce((sum, m) => sum + m.amount, 0);
  const payIn = sumKind('pay_in');
  const payOut = sumKind('pay_out');
  const drops = sumKind('drop');
  const float = shift.getInt('opening_float');
  const expected = float + cashFlow.taken - cashFlow.refunded + payIn - payOut - drops;
  const categories = util.rows(
    app,
    "SELECT CASE WHEN l.category = '' THEN 'No category' ELSE l.category END AS name, IFNULL(SUM(l.qty), 0) AS qty, IFNULL(SUM(l.net), 0) AS net FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.shift = {:sh} AND s.training = false GROUP BY 1 ORDER BY net DESC",
    { name: '', qty: 0, net: 0 },
    bind,
  );
  const people = util.rows(
    app,
    "SELECT s.staff AS staff, COUNT(CASE WHEN s.kind != 'refund' THEN 1 END) AS orders, IFNULL(SUM(s.total + s.rounding), 0) AS total FROM sales s WHERE s.shift = {:sh} AND s.training = false GROUP BY s.staff ORDER BY total DESC",
    { staff: '', orders: 0, total: 0 },
    bind,
  ).map((r) => ({ name: staffNames[r.staff] || '', orders: r.orders, total: r.total }));
  const overrides = util.scalarSql(
    app,
    "SELECT COUNT(a.id) AS v FROM audit a JOIN sales s ON s.number = a.ref WHERE a.kind = 'override' AND s.shift = {:sh}",
    bind,
  );
  const closedAt = shift.getString('closed_at');
  const voids = util.scalarSql(
    app,
    "SELECT COUNT(id) AS v FROM carts WHERE status = 'void' AND register = {:r} AND updated >= {:from}" + (closedAt !== '' ? ' AND updated <= {:to}' : ''),
    { r: shift.getString('register'), from: shift.getString('created'), to: closedAt.replace('T', ' ') },
  );
  const parked = util.scalarSql(app, "SELECT COUNT(id) AS v FROM carts WHERE status IN ('parked', 'resumed')");
  const training = util.scalarSql(app, 'SELECT COUNT(id) AS v FROM sales WHERE shift = {:sh} AND training = true', bind);
  const closed = shift.getString('status') === 'closed';
  return {
    shift: {
      id: shift.id,
      number: shift.getInt('number'),
      status: shift.getString('status'),
      register: reg ? { id: reg.id, name: reg.getString('name'), code: reg.getString('code') } : null,
      opened_at: shift.getString('created'),
      opened_by: staffNames[shift.getString('opened_by')] || '',
      closed_at: closedAt,
      closed_by: staffNames[shift.getString('closed_by')] || '',
      note: shift.getString('note'),
    },
    currency: s.currency,
    currency_decimals: s.exp,
    sales: {
      orders: tot.orders,
      refunds: tot.refunds,
      items: ln.items,
      returned_items: ln.returned_items,
      gross: ln.gross,
      discounts: ln.discounts,
      returns: ln.returns,
      net: netEx,
      service_charge: tot.service,
      tax: tot.tax,
      rounding: tot.rounding,
      total: tot.total + tot.rounding,
    },
    taxes: Object.keys(taxes)
      .map((k) => taxes[k])
      .sort((a, b) => b.rate_bp - a.rate_bp),
    tenders: tenders.map((t) => ({ name: t.name, kind: t.kind, count: t.n, amount: t.amount })),
    cash: {
      opening_float: float,
      cash_taken: cashFlow.taken,
      cash_refunded: cashFlow.refunded,
      pay_in: payIn,
      pay_out: payOut,
      drops: drops,
      expected: closed ? shift.getInt('expected_cash') : expected,
      counted: closed ? shift.getInt('counted_cash') : null,
      variance: closed ? shift.getInt('variance') : null,
      opening_counts: util.jsonOf(shift, 'opening_counts', {}),
      closing_counts: closed ? util.jsonOf(shift, 'closing_counts', {}) : {},
    },
    moves: moves,
    categories: categories,
    staff: people,
    overrides: overrides,
    voided_tickets: voids,
    open_tickets: parked,
    training_sales: training,
  };
}

/** The X report of an open shift (live), or the Z report of a closed one (as frozen at close). */
function report(app, shift) {
  if (shift.getString('status') === 'closed') {
    const z = u().jsonOf(shift, 'summary', null);
    if (z !== null) return Object.assign(z, { kind: 'z' });
  }
  return Object.assign(summarize(app, shift), { kind: 'x' });
}

function close(app, reg, p, ctx) {
  const util = u();
  const s = core().shop(app);
  const counted = amountOrCounts(p, 'counted', 'counts', s.exp);
  if (counted === null) throw util.fail(400, 'counted is required: the cash in the drawer (or counts by note and coin)');
  const note = util.str(p, 'note', '').slice(0, 300);
  let closedId = '';
  app.runInTransaction((tx) => {
    const shift = openShift(tx, reg.id);
    if (shift === null) throw util.fail(409, reg.getString('name') + ' is not open.', 'shift_closed');
    const live = summarize(tx, shift);
    const variance = counted.total - live.cash.expected;
    shift.set('status', 'closed');
    shift.set('closed_by', ctx.staff.id);
    shift.set('closed_at', util.nowIso());
    shift.set('counted_cash', counted.total);
    shift.set('closing_counts', counted.counts);
    shift.set('expected_cash', live.cash.expected);
    shift.set('variance', variance);
    shift.set('note', note);
    tx.save(shift);
    const z = summarize(tx, shift);
    shift.set('summary', z);
    tx.save(shift);
    closedId = shift.id;
    core().audit(tx, {
      kind: 'shift_close',
      actor: 'staff',
      staff: ctx.staff.id,
      register: reg.id,
      ref: reg.getString('code') + ' #' + shift.getInt('number'),
      summary:
        'Closed ' +
        reg.getString('name') +
        ': counted ' +
        util.moneyText(counted.total, s.exp, s.currency) +
        ', expected ' +
        util.moneyText(live.cash.expected, s.exp, s.currency) +
        (variance === 0 ? ', balanced' : ', ' + (variance > 0 ? 'over ' : 'short ') + util.moneyText(Math.abs(variance), s.exp, s.currency)),
    });
  });
  const shift = app.findRecordById('shifts', closedId);
  // Your AI agent writes the day's brief (when the app's triggers are approved).
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, 'day_closed', { shift_id: shift.id }, 'hook');
  if (!fired || !fired.ok) console.log('[pos] day_closed not sent: ' + (fired ? fired.message : 'no answer'));
  return report(app, shift);
}

function list(app, p) {
  const util = u();
  const s = core().shop(app);
  const filter = [];
  const bind = {};
  const reg = util.str(p, 'register', '');
  if (reg !== '') {
    filter.push('register = {:r}');
    bind.r = core().register(app, reg).id;
  }
  const status = util.oneOf(p, 'status', ['all', 'open', 'closed'], 'all');
  if (status !== 'all') {
    filter.push('status = {:st}');
    bind.st = status;
  }
  const recs = app.findRecordsByFilter('shifts', filter.join(' && '), '-created', util.int(p, 'limit', 30, 1, 200), util.int(p, 'offset', 0, 0, 100000), bind);
  const regs = {};
  for (const r of app.findRecordsByFilter('registers', '', '', 0, 0)) regs[r.id] = r;
  const staffNames = {};
  for (const st of app.findRecordsByFilter('staff', '', '', 0, 0)) staffNames[st.id] = st.getString('name');
  return {
    shifts: recs.map((sh) => {
      const r = regs[sh.getString('register')];
      const closed = sh.getString('status') === 'closed';
      const totals = util.rows(app, "SELECT COUNT(CASE WHEN kind != 'refund' THEN 1 END) AS n, IFNULL(SUM(total + rounding), 0) AS t FROM sales WHERE shift = {:s} AND training = false", { n: 0, t: 0 }, { s: sh.id })[0];
      return {
        id: sh.id,
        number: sh.getInt('number'),
        status: sh.getString('status'),
        register: r ? { id: r.id, name: r.getString('name'), code: r.getString('code') } : null,
        opened_at: sh.getString('created'),
        opened_by: staffNames[sh.getString('opened_by')] || '',
        closed_at: sh.getString('closed_at'),
        closed_by: staffNames[sh.getString('closed_by')] || '',
        orders: totals.n,
        total: totals.t,
        total_text: util.moneyText(totals.t, s.exp, s.currency),
        expected_cash: closed ? sh.getInt('expected_cash') : null,
        counted_cash: closed ? sh.getInt('counted_cash') : null,
        variance: closed ? sh.getInt('variance') : null,
      };
    }),
  };
}

/** The open shift of a register with its live numbers, or null. */
function current(app, reg) {
  const sh = openShift(app, reg.id);
  return { register: { id: reg.id, name: reg.getString('name'), code: reg.getString('code') }, shift: sh === null ? null : report(app, sh) };
}

module.exports = { readCounts: readCounts, openShift: openShift, open: open, cashMove: cashMove, summarize: summarize, report: report, close: close, list: list, current: current };
