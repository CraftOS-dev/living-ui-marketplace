/// <reference path="../pb_data/types.d.ts" />
/**
 * The people who use the register. The owner adds staff with a role and a
 * PIN; a PIN is never shown or returned anywhere, and the AI agent never
 * sees or sets one. If someone forgets theirs, the owner (or the AI agent,
 * when the owner asks it) clears it, and that person picks a new one the
 * next time they sign in.
 *
 * There is always at least one active owner.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function auth() {
  return require(`${__hooks}/lib_auth.js`);
}

function core() {
  return require(`${__hooks}/lib_core.js`);
}

function list(app, includeInactive) {
  const recs = app.findRecordsByFilter('staff', includeInactive ? '' : 'active = true', 'name', 0, 0);
  const order = { owner: 0, manager: 1, cashier: 2 };
  const out = recs.map((r) => auth().serializeStaff(r));
  out.sort((a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : order[a.role] !== order[b.role] ? order[a.role] - order[b.role] : a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  return { staff: out, roles: auth().ROLES, permissions: auth().ROLE_PERMS };
}

function activeOwners(app, exceptId) {
  return u().scalarSql(app, "SELECT COUNT(id) AS v FROM staff WHERE role = 'owner' AND active = true AND id != {:x}", { x: exceptId || '' });
}

function checkName(app, name, exceptId) {
  const util = u();
  const n = util.squash(name);
  if (n === '' || n.length > 40) throw util.fail(400, 'A name of 1 to 40 characters is needed');
  const clash = util.idsNocase(app, 'staff', 'name', n, 2).filter((id) => id !== exceptId);
  if (clash.length > 0) throw util.fail(400, 'There is already someone called "' + n + '". Add an initial to tell them apart.');
  return n;
}

function add(app, p, ctx) {
  const util = u();
  const name = checkName(app, util.req(p, 'name', '"Ben"'), '');
  const role = util.oneOf(p, 'role', auth().ROLES, 'cashier');
  const pin = util.req(p, 'pin', '4321');
  auth().checkPinFormat(pin);
  if (auth().pinTaken(app, pin, '')) throw util.fail(400, 'Someone already uses that PIN. Pick another one.', 'pin_taken');
  const color = util.int(p, 'color', (app.findRecordsByFilter('staff', '', '', 0, 0).length % 8) + 1, 1, 8);
  let rec = null;
  app.runInTransaction((tx) => {
    rec = new Record(tx.findCollectionByNameOrId('staff'));
    rec.set('name', name);
    rec.set('role', role);
    rec.set('color', color);
    rec.set('active', true);
    rec.set('training', false);
    rec.set('pin_set', false);
    rec.set('failed', 0);
    rec.set('locked_until', '');
    tx.save(rec);
    auth().setPin(tx, rec, pin);
    core().audit(tx, { kind: 'staff_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: name, summary: 'Added ' + name + ' as ' + role });
  });
  return { staff: auth().serializeStaff(rec) };
}

function update(app, rec, p, ctx) {
  const util = u();
  const changes = [];
  if (util.has(p, 'name')) {
    rec.set('name', checkName(app, util.str(p, 'name', ''), rec.id));
    changes.push('name');
  }
  if (util.has(p, 'role')) {
    const role = util.oneOf(p, 'role', auth().ROLES, rec.getString('role'));
    if (rec.getString('role') === 'owner' && role !== 'owner' && activeOwners(app, rec.id) === 0) {
      throw util.fail(409, rec.getString('name') + ' is the only owner. Make someone else an owner first.', 'last_owner');
    }
    rec.set('role', role);
    changes.push('role ' + role);
  }
  if (util.has(p, 'color')) rec.set('color', util.int(p, 'color', 1, 1, 8));
  if (util.has(p, 'active')) {
    const on = util.bool(p, 'active', true);
    if (!on && rec.getString('role') === 'owner' && activeOwners(app, rec.id) === 0) {
      throw util.fail(409, rec.getString('name') + ' is the only owner and cannot be turned off.', 'last_owner');
    }
    rec.set('active', on);
    changes.push(on ? 'active' : 'inactive');
  }
  if (util.has(p, 'training')) {
    rec.set('training', util.bool(p, 'training', false));
    changes.push(rec.getBool('training') ? 'training mode on' : 'training mode off');
  }
  app.runInTransaction((tx) => {
    tx.save(rec);
    if (!rec.getBool('active')) {
      for (const s of tx.findRecordsByFilter('sessions', 'staff = {:s} && ended = false', '', 0, 0, { s: rec.id })) {
        s.set('ended', true);
        tx.save(s);
      }
    }
    if (changes.length > 0) core().audit(tx, { kind: 'staff_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: rec.getString('name') + ': ' + changes.join(', ') });
  });
  return { staff: auth().serializeStaff(rec) };
}

/** The owner sets someone's PIN (or their own). */
function setPin(app, rec, pin, ctx) {
  const util = u();
  auth().checkPinFormat(pin);
  if (auth().pinTaken(app, pin, rec.id)) throw util.fail(400, 'Someone already uses that PIN. Pick another one.', 'pin_taken');
  app.runInTransaction((tx) => {
    auth().setPin(tx, rec, pin);
    core().audit(tx, { kind: 'staff_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: 'New PIN for ' + rec.getString('name') });
  });
  return { staff: auth().serializeStaff(rec) };
}

/** Clear a forgotten PIN: the person picks a new one at their next sign-in. */
function resetPin(app, rec, ctx) {
  app.runInTransaction((tx) => {
    for (const row of tx.findRecordsByFilter('staff_pins', 'staff = {:s}', '', 0, 0, { s: rec.id })) tx.delete(tx.findRecordById('staff_pins', row.id));
    for (const s of tx.findRecordsByFilter('sessions', 'staff = {:s} && ended = false', '', 0, 0, { s: rec.id })) {
      s.set('ended', true);
      tx.save(s);
    }
    rec.set('pin_set', false);
    rec.set('failed', 0);
    rec.set('locked_until', '');
    tx.save(rec);
    core().audit(tx, { kind: 'staff_change', actor: ctx.actor, staff: ctx.staff ? ctx.staff.id : '', ref: rec.getString('name'), summary: 'Cleared the PIN of ' + rec.getString('name') + ' (they set a new one at their next sign-in)' });
  });
  return { staff: auth().serializeStaff(rec) };
}

/** Someone without a PIN (new, or cleared) picks one and is signed in. */
function firstPin(app, rec, pin, registerId) {
  const util = u();
  if (!rec.getBool('active')) throw util.fail(403, rec.getString('name') + ' is not active', 'staff_inactive');
  if (rec.getBool('pin_set')) throw util.fail(409, rec.getString('name') + ' already has a PIN. Sign in with it.', 'pin_set');
  auth().checkPinFormat(pin);
  if (auth().pinTaken(app, pin, rec.id)) throw util.fail(400, 'Someone already uses that PIN. Pick another one.', 'pin_taken');
  app.runInTransaction((tx) => {
    auth().setPin(tx, rec, pin);
    core().audit(tx, { kind: 'staff_change', actor: 'staff', staff: rec.id, ref: rec.getString('name'), summary: rec.getString('name') + ' set a new PIN' });
  });
  return auth().login(app, rec, pin, registerId);
}

/** A signed-in person changes their own PIN (their current PIN confirms it is them). */
function changeOwnPin(app, rec, current, next) {
  const util = u();
  auth().verifyPin(app, rec, current);
  auth().checkPinFormat(next);
  if (auth().pinTaken(app, next, rec.id)) throw util.fail(400, 'Someone already uses that PIN. Pick another one.', 'pin_taken');
  app.runInTransaction((tx) => {
    auth().setPin(tx, rec, next);
    core().audit(tx, { kind: 'staff_change', actor: 'staff', staff: rec.id, ref: rec.getString('name'), summary: rec.getString('name') + ' changed their PIN' });
  });
  return { ok: true };
}

module.exports = { list: list, add: add, update: update, setPin: setPin, resetPin: resetPin, firstPin: firstPin, changeOwnPin: changeOwnPin };
