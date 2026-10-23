/// <reference path="../pb_data/types.d.ts" />
/**
 * Who is acting and what they may do.
 *
 * A person at the register signs in with their PIN (a salted SHA-256 hash
 * is stored) and gets a signed session token ("till") naming them and the
 * register; every operation from the app carries it. The AI agent comes in
 * through the agent-app CLI and acts with the "agent" role. Permissions are
 * per role (owner, manager, cashier, agent) and editable by the owner; a
 * missing permission can be granted for one action by the PIN of someone
 * who has it, recorded as the approver. Wrong PINs are rate limited.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

const PERMS = [
  { key: 'sell', label: 'Ring up sales and take payments' },
  { key: 'discount', label: 'Give discounts (up to the limit)' },
  { key: 'price_override', label: 'Change a price on a sale' },
  { key: 'tax_exempt', label: 'Remove tax from a sale' },
  { key: 'return', label: 'Returns and refunds' },
  { key: 'void', label: 'Void payments taken by mistake' },
  { key: 'no_sale', label: 'Open the drawer without a sale' },
  { key: 'cash_moves', label: 'Pay cash in and out of the drawer' },
  { key: 'open_shift', label: 'Open the drawer' },
  { key: 'close_shift', label: 'Close the drawer' },
  { key: 'view_reports', label: 'See reports, sales history and the audit log' },
  { key: 'manage_catalog', label: 'Edit products, categories and options' },
  { key: 'manage_stock', label: 'Receive, adjust and count stock' },
  { key: 'manage_customers', label: 'Add and edit customers' },
  { key: 'adjust_balances', label: 'Adjust points, store credit and gift cards' },
  { key: 'manage_discounts', label: 'Edit promotions' },
  { key: 'manage_staff', label: 'Edit staff and time entries' },
  { key: 'manage_settings', label: 'Change store settings, taxes and registers' },
];
const KEYS = PERMS.map((x) => x.key);
const ROLES = ['owner', 'manager', 'cashier', 'agent'];

function all(on) {
  const o = {};
  for (const k of KEYS) o[k] = on;
  return o;
}

/** The permissions each role starts with (the owner can change them; the owner role itself always has all). */
function defaults() {
  const manager = all(true);
  manager.manage_settings = false;
  const cashier = all(false);
  for (const k of ['sell', 'discount', 'open_shift', 'close_shift', 'manage_customers']) cashier[k] = true;
  const agent = all(false);
  for (const k of ['sell', 'view_reports', 'manage_catalog', 'manage_stock', 'manage_customers', 'manage_discounts']) agent[k] = true;
  return {
    owner: Object.assign(all(true), { max_discount: 100 }),
    manager: Object.assign(manager, { max_discount: 100 }),
    cashier: Object.assign(cashier, { max_discount: 10 }),
    agent: Object.assign(agent, { max_discount: 0 }),
  };
}

/** The permission matrix in force: the stored one over the defaults; the owner always has everything. */
function matrix(settings) {
  const util = u();
  const stored = util.getJson(settings, 'permissions') || {};
  const base = defaults();
  const out = {};
  for (const role of ROLES) {
    const s = stored[role] && typeof stored[role] === 'object' ? stored[role] : {};
    const row = {};
    for (const k of KEYS) row[k] = role === 'owner' ? true : typeof s[k] === 'boolean' ? s[k] : base[role][k];
    const md = Number(s.max_discount);
    row.max_discount = role === 'owner' ? 100 : isFinite(md) && md >= 0 && md <= 100 ? md : base[role].max_discount;
    out[role] = row;
  }
  return out;
}

function settingsRow(app) {
  const rows = app.findRecordsByFilter('settings', '', '', 1, 0);
  if (rows.length === 0) throw u().fail(500, 'The settings row is missing');
  return rows[0];
}

/* ------------------------------------------------------------------- PINs */

function hashPin(pin, salt) {
  return $security.sha256(salt + ':' + pin);
}

function checkPinFormat(pin) {
  if (!/^\d{4,8}$/.test(String(pin || ''))) throw u().fail(400, 'A PIN is 4 to 8 digits');
}

/** Set a staff record's PIN (the PIN must be unique among active staff). */
function setPin(app, rec, pin) {
  checkPinFormat(pin);
  const other = staffByPin(app, pin, rec.id);
  if (other !== null) throw u().fail(400, 'That PIN is already used by someone else; choose another');
  const salt = $security.randomString(24);
  rec.set('pin_salt', salt);
  rec.set('pin_hash', hashPin(pin, salt));
}

/** The active staff member whose PIN this is, or null. */
function staffByPin(app, pin, exceptId) {
  const rows = app.findRecordsByFilter('staff', 'active = true', '', 0, 0);
  for (const r of rows) {
    if (exceptId && r.id === exceptId) continue;
    const salt = r.getString('pin_salt');
    if (salt !== '' && hashPin(String(pin), salt) === r.getString('pin_hash')) return r;
  }
  return null;
}

/** Refuse when too many wrong PINs were entered in the last minute. */
function throttle(app) {
  const since = u().dbDate(new Date(Date.now() - 60000));
  const n = app.countRecords('events', $dbx.and($dbx.exp('kind = {:k}', { k: 'pin_failed' }), $dbx.exp('created >= {:t}', { t: since })));
  if (n >= 8) throw u().fail(429, 'Too many wrong PINs. Wait a minute and try again.');
}

function pinFailed(app, register, what) {
  require(`${__hooks}/lib_audit.js`).log(app, 'pin_failed', null, { register: register ? register.id : '', detail: what });
}

/* --------------------------------------------------------------- sessions */

const SESSION_SECONDS = 16 * 3600;

function register(app, ref) {
  const util = u();
  const v = String(ref || '').trim();
  if (v === '') return null;
  let r = util.byId(app, 'registers', v);
  if (r === null) r = util.findOne(app, 'registers', 'name = {:n}', { n: v });
  if (r === null) throw util.fail(404, 'No register "' + v + '" (see registers.list)');
  return r;
}

/** Sign in with a PIN at a register: a session token for the app. */
function unlock(app, p) {
  const util = u();
  const s = settingsRow(app);
  if (!s.getBool('setup_done')) throw util.fail(409, 'The store is not set up yet', { code: 'setup_needed' });
  const reg = register(app, util.req(p, 'register', 'Register 1'));
  if (!reg.getBool('active')) throw util.fail(400, reg.getString('name') + ' is turned off; choose another register');
  throttle(app);
  const pin = util.req(p, 'pin', '1234');
  const who = /^\d{4,8}$/.test(pin) ? staffByPin(app, pin) : null;
  if (who === null) {
    pinFailed(app, reg, 'Wrong PIN at ' + reg.getString('name'));
    throw util.fail(401, 'That PIN is not right', { code: 'wrong_pin' });
  }
  who.set('last_signed_in', new Date().toISOString());
  app.save(who);
  require(`${__hooks}/lib_audit.js`).log(app, 'sign_in', { actor: 'staff', staffId: who.id }, { register: reg.id, detail: who.getString('name') + ' signed in at ' + reg.getString('name') });
  const token = $security.createJWT({ s: who.id, r: reg.id, v: 1 }, s.getString('secret'), SESSION_SECONDS);
  return { till: token, expires_in: SESSION_SECONDS, staff: staffJson(who), register: { id: reg.id, name: reg.getString('name') }, permissions: matrix(s)[who.getString('role')] };
}

function staffJson(r) {
  return { id: r.id, name: r.getString('name'), role: r.getString('role'), color: r.getString('color') || 'neutral' };
}

/**
 * The acting context of a request: the AI agent (CLI) or the signed-in
 * staff member and their register. Throws 401 when the app's session is
 * missing or expired, 409 before setup.
 */
function context(app, e, p, opts) {
  const util = u();
  const o = opts || {};
  const s = settingsRow(app);
  const perms = matrix(s);
  if (!o.beforeSetup && !s.getBool('setup_done')) throw util.fail(409, 'The store is not set up yet: run setup.complete (or open the app)', { code: 'setup_needed' });
  if (util.fromAgent(e)) {
    const reg = register(app, util.str(p, 'register', ''));
    return build(s, perms, 'agent', null, reg);
  }
  const token = util.str(p, 'till', '');
  if (token === '') throw util.fail(401, 'Sign in at the register with your PIN', { code: 'signed_out' });
  let claims = null;
  try {
    claims = $security.parseJWT(token, s.getString('secret'));
  } catch {
    throw util.fail(401, 'Your session ended; sign in again with your PIN', { code: 'signed_out' });
  }
  const who = util.byId(app, 'staff', String(claims.s || ''));
  if (who === null || !who.getBool('active')) throw util.fail(401, 'That staff member is no longer active; sign in again', { code: 'signed_out' });
  const reg = util.byId(app, 'registers', String(claims.r || ''));
  return build(s, perms, 'staff', who, reg);
}

function build(s, perms, actor, who, reg) {
  const role = who === null ? 'agent' : who.getString('role');
  const mine = perms[role];
  return {
    actor: actor,
    staff: who,
    staffId: who === null ? '' : who.id,
    staffName: who === null ? 'Your AI agent' : who.getString('name'),
    role: role,
    register: reg,
    registerId: reg === null ? '' : reg.id,
    settings: s,
    perms: mine,
    can: (k) => mine[k] === true,
    maxDiscount: mine.max_discount,
    matrix: perms,
  };
}

function label(key) {
  const p = PERMS.find((x) => x.key === key);
  return p ? p.label.toLowerCase() : key;
}

/**
 * Make sure the actor may do `perm`. When they may not, a PIN of someone
 * who may (param approve_pin) grants it once; the approver is answered so
 * the action records it. The agent has no approval path.
 */
function need(app, c, perm, p, opts) {
  const util = u();
  const o = opts || {};
  const ok = o.check ? o.check(c.perms) : c.can(perm);
  if (ok) return null;
  if (c.actor === 'agent') throw util.fail(403, 'The agent role may not ' + label(perm) + '. The owner can allow it in Team, Permissions.', { code: 'forbidden', permission: perm });
  const pin = util.str(p, 'approve_pin', '');
  if (pin === '') {
    throw util.fail(403, (o.what || 'This') + ' needs a manager: ' + label(perm) + '.', { code: 'approval_needed', permission: perm, label: label(perm) });
  }
  throttle(app);
  const who = /^\d{4,8}$/.test(pin) ? staffByPin(app, pin) : null;
  if (who === null) {
    pinFailed(app, c.register, 'Wrong approval PIN');
    throw util.fail(403, 'That approval PIN is not right', { code: 'approval_needed', permission: perm, label: label(perm), wrong_pin: true });
  }
  const theirs = c.matrix[who.getString('role')];
  const allowed = o.check ? o.check(theirs) : theirs[perm] === true;
  if (!allowed) throw util.fail(403, who.getString('name') + ' may not ' + label(perm) + ' either', { code: 'approval_needed', permission: perm, label: label(perm) });
  return who;
}

/** A discount of `pct` percent: within the actor's limit, or approved by someone whose limit covers it. */
function needDiscount(app, c, pct, p) {
  return need(app, c, 'discount', p, { what: 'A ' + u().fmt(pct) + '% discount', check: (m) => m.discount === true && pct <= m.max_discount + 1e-9 });
}

/** Refuse a staff-only action for the agent (handling cash needs someone at the drawer). */
function staffOnly(c, what) {
  if (c.actor === 'agent') throw u().fail(403, what + ' needs a person at the register; the AI agent cannot do it', { code: 'forbidden' });
}

/** The permissions catalog for the app and the agent. */
function catalog(settings) {
  return { permissions: PERMS, roles: ROLES, matrix: matrix(settings) };
}

/** Save the owner's changes to the matrix: { role: { key: bool, max_discount } }. */
function saveMatrix(app, c, p) {
  const util = u();
  const incoming = util.obj(p, 'permissions', '{"cashier": {"return": true, "max_discount": 15}}');
  if (incoming === undefined) throw util.fail(400, 'permissions is required');
  if (c.role !== 'owner') throw util.fail(403, 'Only an owner can change permissions', { code: 'forbidden' });
  const cur = matrix(c.settings);
  const next = {};
  for (const role of ['manager', 'cashier', 'agent']) {
    const row = Object.assign({}, cur[role]);
    const inc = incoming[role];
    if (inc !== undefined) {
      if (inc === null || typeof inc !== 'object') throw util.fail(400, 'permissions.' + role + ' must be an object');
      for (const k of Object.keys(inc)) {
        if (k === 'max_discount') {
          const n = Number(inc[k]);
          if (!isFinite(n) || n < 0 || n > 100) throw util.fail(400, role + '.max_discount must be 0 to 100');
          row.max_discount = n;
        } else if (KEYS.indexOf(k) >= 0) {
          if (typeof inc[k] !== 'boolean') throw util.fail(400, role + '.' + k + ' must be true or false');
          row[k] = inc[k];
        } else throw util.fail(400, 'Unknown permission "' + k + '"; one of: ' + KEYS.join(', ') + ', max_discount');
      }
    }
    next[role] = row;
  }
  if (incoming.owner !== undefined) throw util.fail(400, 'The owner role always has every permission');
  const changed = [];
  for (const role of Object.keys(next)) for (const k of KEYS.concat(['max_discount'])) if (next[role][k] !== cur[role][k]) changed.push(role + '.' + k + '=' + next[role][k]);
  app.runInTransaction((tx) => {
    const s = settingsRow(tx);
    s.set('permissions', next);
    tx.save(s);
    if (changed.length) require(`${__hooks}/lib_audit.js`).log(tx, 'permissions', c, { detail: 'Permissions changed: ' + changed.join(', ') });
  });
  return catalog(settingsRow(app));
}

module.exports = {
  PERMS: PERMS,
  KEYS: KEYS,
  ROLES: ROLES,
  defaults: defaults,
  matrix: matrix,
  settingsRow: settingsRow,
  hashPin: hashPin,
  checkPinFormat: checkPinFormat,
  setPin: setPin,
  staffByPin: staffByPin,
  throttle: throttle,
  register: register,
  unlock: unlock,
  staffJson: staffJson,
  context: context,
  need: need,
  needDiscount: needDiscount,
  staffOnly: staffOnly,
  catalog: catalog,
  saveMatrix: saveMatrix,
  SESSION_SECONDS: SESSION_SECONDS,
};
