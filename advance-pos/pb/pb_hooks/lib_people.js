/// <reference path="../pb_data/types.d.ts" />
/**
 * Registers, staff and the time clock.
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

const COLORS = ['neutral', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'graphite'];

/* -------------------------------------------------------------- registers */

function registerJson(app, r) {
  const open = u().findOne(app, 'shifts', "register = {:r} && status = 'open'", { r: r.id });
  return {
    id: r.id,
    name: r.getString('name'),
    active: r.getBool('active'),
    current_order: r.getString('current_order'),
    shift: open === null ? null : { id: open.id, number: open.getInt('number'), opened_at: open.getString('opened_at') },
  };
}

function registersList(app) {
  return { registers: app.findRecordsByFilter('registers', '', 'name', 0, 0).map((r) => registerJson(app, r)) };
}

function registersSave(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_settings', p, { what: 'Changing registers' });
  const id = util.str(p, 'id', '');
  let out = null;
  app.runInTransaction((tx) => {
    const r = id === '' ? new Record(tx.findCollectionByNameOrId('registers')) : util.byId(tx, 'registers', id);
    if (r === null) throw util.fail(404, 'No register ' + id);
    if (id === '' || util.has(p, 'name')) {
      const name = util.squash(util.req(p, 'name', '"Front counter"'));
      if (name.length > 60) throw util.fail(400, 'name can be at most 60 characters');
      const dup = util.findOne(tx, 'registers', 'name = {:n} && id != {:i}', { n: name, i: r.id || '' });
      if (dup !== null) throw util.fail(400, 'There is already a register named ' + name);
      r.set('name', name);
    }
    const active = util.bool(p, 'active', id === '' ? true : r.getBool('active'));
    if (!active && r.id && util.findOne(tx, 'shifts', "register = {:r} && status = 'open'", { r: r.id }) !== null) {
      throw util.fail(400, 'Close the drawer of ' + r.getString('name') + ' before turning it off');
    }
    if (!active && r.id && tx.countRecords('registers', $dbx.exp('active = TRUE AND id != {:i}', { i: r.id })) === 0) {
      throw util.fail(400, 'At least one register must stay on');
    }
    r.set('active', active);
    tx.save(r);
    audit().log(tx, 'settings', c, { approver: approver, detail: (id === '' ? 'Register added: ' : 'Register changed: ') + r.getString('name') + (active ? '' : ' (off)') });
    out = r;
  });
  return { register: registerJson(app, out) };
}

/** Which ticket a register shows, so the customer display can follow it. */
function registersFocus(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const reg = c.register !== null ? c.register : auth().register(app, util.req(p, 'register', 'Register 1'));
  if (reg === null) throw util.fail(400, 'register is required');
  const order = util.str(p, 'order', '');
  if (order !== '' && util.byId(app, 'orders', order) === null) throw util.fail(404, 'No order ' + order);
  const r = app.findRecordById('registers', reg.id);
  const msg = util.obj(p, 'message', '{"kind": "thanks", "change": 500}');
  if (r.getString('current_order') !== order || msg !== undefined) {
    r.set('current_order', order);
    r.set('display_message', msg === undefined ? null : msg);
    app.save(r);
  }
  return { register: registerJson(app, r) };
}

/* ------------------------------------------------------------------ staff */

function clockEntry(app, staffId) {
  return u().findOne(app, 'timeclock', "staff = {:s} && clock_out = ''", { s: staffId });
}

function staffJson(app, r, full) {
  const entry = clockEntry(app, r.id);
  const out = {
    id: r.id,
    name: r.getString('name'),
    role: r.getString('role'),
    color: r.getString('color') || 'neutral',
    active: r.getBool('active'),
    clocked_in: entry === null ? null : entry.getString('clock_in'),
  };
  if (full) {
    out.email = r.getString('email');
    out.phone = r.getString('phone');
    out.last_signed_in = r.getString('last_signed_in');
    out.has_pin = r.getString('pin_hash') !== '';
  }
  return out;
}

function staffList(app, e, p) {
  const c = auth().context(app, e, p);
  const full = c.can('manage_staff');
  const rows = app.findRecordsByFilter('staff', '', 'name', 0, 0);
  return { staff: rows.map((r) => staffJson(app, r, full)) };
}

function activeOwners(db, exceptId) {
  return db.findRecordsByFilter('staff', "role = 'owner' && active = true && id != {:i}", '', 0, 0, { i: exceptId || '' }).length;
}

function staffSave(app, e, p) {
  const util = u();
  const A = auth();
  const c = A.context(app, e, p);
  const id = util.str(p, 'id', '');
  const self = c.staff !== null && c.staff.id === id;
  // Anyone may change their own PIN; everything else needs manage_staff.
  const onlyPin = self && Object.keys(p).every((k) => ['id', 'pin', 'till', 'current_pin'].indexOf(k) >= 0);
  let approver = null;
  if (onlyPin) {
    const cur = util.req(p, 'current_pin', '1234');
    if (A.hashPin(cur, c.staff.getString('pin_salt')) !== c.staff.getString('pin_hash')) throw util.fail(403, 'Your current PIN is not right');
  } else approver = A.need(app, c, 'manage_staff', p, { what: 'Changing staff' });
  const actorRole = approver !== null ? approver.getString('role') : c.role;
  let out = null;
  const changes = [];
  app.runInTransaction((tx) => {
    const r = id === '' ? new Record(tx.findCollectionByNameOrId('staff')) : util.byId(tx, 'staff', id);
    if (r === null) throw util.fail(404, 'No staff member ' + id);
    const wasOwner = r.getString('role') === 'owner';
    if (id === '' || util.has(p, 'name')) {
      const name = util.squash(util.req(p, 'name', '"Alex Kim"'));
      if (name.length > 80) throw util.fail(400, 'name can be at most 80 characters');
      if (util.findOne(tx, 'staff', 'name = {:n} && id != {:i}', { n: name, i: r.id || '' }) !== null) throw util.fail(400, 'There is already a staff member named ' + name);
      if (name !== r.getString('name')) changes.push('name');
      r.set('name', name);
    }
    const role = util.oneOf(p, 'role', ['owner', 'manager', 'cashier'], id === '' ? 'cashier' : r.getString('role'));
    if ((role === 'owner' || wasOwner) && actorRole !== 'owner' && !onlyPin) throw util.fail(403, 'Only an owner can add, change or remove an owner', { code: 'forbidden' });
    if (role !== r.getString('role')) changes.push('role ' + role);
    r.set('role', role);
    const active = util.bool(p, 'active', id === '' ? true : r.getBool('active'));
    if (active !== r.getBool('active') || id === '') changes.push(active ? 'active' : 'inactive');
    r.set('active', active);
    if (wasOwner && (role !== 'owner' || !active) && activeOwners(tx, r.id) === 0) throw util.fail(400, 'The store needs at least one active owner');
    if (util.has(p, 'color')) r.set('color', util.oneOf(p, 'color', COLORS, 'neutral'));
    else if (id === '') r.set('color', COLORS[1 + Math.floor(Math.random() * (COLORS.length - 1))]);
    for (const k of ['email', 'phone']) if (util.has(p, k)) r.set(k, util.str(p, k, '').slice(0, k === 'email' ? 200 : 60));
    const pin = util.str(p, 'pin', '');
    if (pin !== '') {
      A.setPin(tx, r, pin);
      changes.push('PIN');
    } else if (id === '') throw util.fail(400, 'pin is required for a new staff member (4 to 8 digits)');
    tx.save(r);
    if (!active) {
      const open = util.findOne(tx, 'timeclock', "staff = {:s} && clock_out = ''", { s: r.id });
      if (open !== null) {
        open.set('clock_out', new Date().toISOString());
        tx.save(open);
      }
    }
    audit().log(tx, 'staff', c, { approver: approver, detail: (id === '' ? 'Staff added: ' : 'Staff changed: ') + r.getString('name') + (changes.length ? ' (' + changes.join(', ') + ')' : '') });
    out = r;
  });
  return { staff: staffJson(app, out, true) };
}

/* ------------------------------------------------------------- time clock */

function entryJson(r, names) {
  const util = u();
  const a = util.dateOf(r, 'clock_in');
  const b = util.dateOf(r, 'clock_out');
  const end = b === null ? new Date() : b;
  return {
    id: r.id,
    staff: { id: r.getString('staff'), name: names[r.getString('staff')] || '' },
    clock_in: r.getString('clock_in'),
    clock_out: r.getString('clock_out'),
    open: b === null,
    minutes: a === null ? 0 : Math.max(0, Math.round((end - a) / 60000)),
    note: r.getString('note'),
    edited_by: r.getString('edited_by') === '' ? null : names[r.getString('edited_by')] || '',
  };
}

/**
 * Clock in or out: the signed-in staff member, or whoever's PIN is given
 * (the lock screen clocks people in without signing them in).
 */
function clock(app, e, p) {
  const util = u();
  const A = auth();
  let who = null;
  let c = null;
  const pin = util.str(p, 'pin', '');
  if (pin !== '') {
    A.throttle(app);
    who = /^\d{4,8}$/.test(pin) ? A.staffByPin(app, pin) : null;
    if (who === null) {
      require(`${__hooks}/lib_audit.js`).log(app, 'pin_failed', null, { detail: 'Wrong PIN at the time clock' });
      throw util.fail(401, 'That PIN is not right', { code: 'wrong_pin' });
    }
    c = { actor: 'staff', staffId: who.id, registerId: '' };
  } else {
    c = A.context(app, e, p);
    if (c.staff === null) throw util.fail(400, 'Clocking in is for staff; give pin');
    who = c.staff;
  }
  const action = util.oneOf(p, 'action', ['in', 'out', 'toggle'], 'toggle');
  let entry = null;
  let did = '';
  app.runInTransaction((tx) => {
    const open = util.findOne(tx, 'timeclock', "staff = {:s} && clock_out = ''", { s: who.id });
    if (open !== null && action !== 'in') {
      open.set('clock_out', new Date().toISOString());
      tx.save(open);
      entry = open;
      did = 'out';
    } else if (open === null && action !== 'out') {
      const r = new Record(tx.findCollectionByNameOrId('timeclock'));
      r.set('staff', who.id);
      r.set('clock_in', new Date().toISOString());
      tx.save(r);
      entry = r;
      did = 'in';
    } else throw util.fail(400, who.getString('name') + ' is already clocked ' + (open === null ? 'out' : 'in'));
    audit().log(tx, 'clock', c, { detail: who.getString('name') + ' clocked ' + did });
  });
  const names = {};
  names[who.id] = who.getString('name');
  return { action: did, staff: { id: who.id, name: who.getString('name') }, entry: entryJson(entry, names) };
}

function timeclockList(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const staffId = util.str(p, 'staff', '');
  const mineOnly = !(c.can('manage_staff') || c.can('view_reports'));
  if (mineOnly && (c.staff === null || (staffId !== '' && staffId !== c.staff.id))) throw util.fail(403, 'You can see only your own time entries', { code: 'forbidden' });
  const r = util.range(p, 7);
  const filters = ['clock_in >= {:a}', 'clock_in < {:b}'];
  const bind = { a: util.dbDate(r.start), b: util.dbDate(r.end) };
  const who = mineOnly ? c.staff.id : staffId;
  if (who !== '') {
    filters.push('staff = {:s}');
    bind.s = who;
  }
  const names = audit().staffNames(app);
  const rows = app.findRecordsByFilter('timeclock', filters.join(' && '), '-clock_in', 2000, 0, bind);
  const entries = rows.map((x) => entryJson(x, names));
  const totals = {};
  for (const en of entries) {
    const k = en.staff.id;
    if (!totals[k]) totals[k] = { staff: en.staff, minutes: 0, entries: 0 };
    totals[k].minutes += en.minutes;
    totals[k].entries += 1;
  }
  return { from: r.from, to: r.to, entries: entries, totals: Object.keys(totals).map((k) => totals[k]) };
}

/** Add or correct a time entry (managers). */
function timeclockSave(app, e, p) {
  const util = u();
  const c = auth().context(app, e, p);
  const approver = auth().need(app, c, 'manage_staff', p, { what: 'Editing time entries' });
  const id = util.str(p, 'id', '');
  let out = null;
  app.runInTransaction((tx) => {
    const r = id === '' ? new Record(tx.findCollectionByNameOrId('timeclock')) : util.byId(tx, 'timeclock', id);
    if (r === null) throw util.fail(404, 'No time entry ' + id);
    if (id === '') {
      const s = util.byId(tx, 'staff', util.req(p, 'staff', '<staff id>'));
      if (s === null) throw util.fail(404, 'No staff member with that id');
      r.set('staff', s.id);
    }
    const inAt = util.str(p, 'clock_in', r.getString('clock_in'));
    const outAt = util.str(p, 'clock_out', r.getString('clock_out'));
    const a = new Date(String(inAt).replace(' ', 'T'));
    if (inAt === '' || isNaN(a.getTime())) throw util.fail(400, 'clock_in must be a date and time like 2026-10-10T09:00:00');
    let b = null;
    if (outAt !== '') {
      b = new Date(String(outAt).replace(' ', 'T'));
      if (isNaN(b.getTime())) throw util.fail(400, 'clock_out must be a date and time');
      if (b <= a) throw util.fail(400, 'clock_out must be after clock_in');
      if (b - a > 24 * 3600000) throw util.fail(400, 'An entry can be at most 24 hours');
    }
    if (a > new Date(Date.now() + 60000)) throw util.fail(400, 'clock_in cannot be in the future');
    r.set('clock_in', a.toISOString());
    r.set('clock_out', b === null ? '' : b.toISOString());
    if (util.has(p, 'note')) r.set('note', util.str(p, 'note', '').slice(0, 400));
    if (c.staffId) r.set('edited_by', c.staffId);
    tx.save(r);
    audit().log(tx, 'clock', c, { approver: approver, detail: 'Time entry ' + (id === '' ? 'added' : 'corrected') });
    out = r;
  });
  return { entry: entryJson(out, audit().staffNames(app)) };
}

module.exports = { COLORS: COLORS, registerJson: registerJson, registersList: registersList, registersSave: registersSave, registersFocus: registersFocus, staffJson: staffJson, staffList: staffList, staffSave: staffSave, clock: clock, timeclockList: timeclockList, timeclockSave: timeclockSave };

/**
 * What the customer-facing screen of a register shows: the store, the sale
 * on that register (lines and totals) and a message after payment. Needs no
 * sign-in: it is a second screen facing the customer.
 */
function display(app, p) {
  const util = u();
  const s = auth().settingsRow(app);
  const money = require(`${__hooks}/lib_money.js`).of(s);
  const reg = auth().register(app, util.req(p, 'register', '<register id>'));
  const out = {
    store: s.getString('business_name'),
    logo: s.getString('logo') === '' ? '' : util.fileUrl(s, 'logo'),
    currency: money.currency,
    currency_digits: money.digits,
    register: reg.getString('name'),
    message: util.getJson(reg, 'display_message'),
    order: null,
  };
  const o = reg.getString('current_order') === '' ? null : util.byId(app, 'orders', reg.getString('current_order'));
  if (o !== null && o.getString('status') !== 'void') {
    const lines = app.findRecordsByFilter('order_lines', 'order = {:o}', 'position,created', 0, 0, { o: o.id });
    const cust = o.getString('customer') === '' ? null : util.byId(app, 'customers', o.getString('customer'));
    out.order = {
      id: o.id,
      status: o.getString('status'),
      number: o.getString('number'),
      customer: cust === null ? null : { name: cust.getString('name'), points: cust.getInt('points') },
      lines: lines.map((l) => ({
        name: l.getString('name') + (l.getString('variant_title') ? ' (' + l.getString('variant_title') + ')' : ''),
        qty: l.getFloat('qty'),
        options: (util.getJson(l, 'modifiers') || []).map((m) => m.name),
        total: l.getInt('total'),
        discount: l.getInt('discount'),
      })),
      subtotal: o.getInt('subtotal'),
      discount_total: o.getInt('discount_total'),
      tax_total: o.getInt('tax_total'),
      total: o.getInt('total'),
      tip: o.getInt('tip'),
      due: o.getInt('total') + o.getInt('tip') + o.getInt('rounding'),
      paid_total: o.getInt('paid_total'),
      balance: o.getInt('balance'),
      change: o.getInt('change_total'),
      updated: o.getString('updated'),
    };
  }
  return out;
}

module.exports.display = display;
