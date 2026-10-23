/// <reference path="../pb_data/types.d.ts" />
/**
 * Staff, PINs, sessions, permissions and manager approvals.
 *
 * Who is calling decides what an operation may do:
 * - Staff at the counter sign in with a 4 to 6 digit PIN and get a session
 *   token the page sends as X-Pos-Session. Their ROLE decides what they may
 *   do; a few actions a cashier may do with a manager's approval (a manager
 *   types their PIN at the same screen and the action carries the approval).
 * - The AI agent (it presents the app's agent token) may read everything
 *   and run the back office (catalog, stock, customers, imports, reports,
 *   receipt emails, draft tickets) but never moves money: sales, refunds,
 *   cash and shifts happen only at the counter, under a person's PIN.
 *
 * PINs are stored salted and hashed; five wrong PINs lock a person for five
 * minutes. A session lasts 16 hours or until the person locks the register.
 */

const ROLES = ['owner', 'manager', 'cashier'];

const ACTIONS = [
  'sell', 'park', 'discount', 'discount_over', 'price_override', 'refund', 'refund_blind', 'void_ticket',
  'cash_move', 'shift', 'reports', 'catalog', 'customers', 'customers_admin', 'stock', 'kitchen', 'reprint',
  'imports', 'settings', 'staff',
];

const ROLE_PERMS = {
  owner: ACTIONS,
  manager: [
    'sell', 'park', 'discount', 'discount_over', 'price_override', 'refund', 'refund_blind', 'void_ticket',
    'cash_move', 'shift', 'reports', 'catalog', 'customers', 'customers_admin', 'stock', 'kitchen', 'reprint', 'imports',
  ],
  cashier: ['sell', 'park', 'discount', 'shift', 'customers', 'kitchen', 'reprint'],
};

/** What a manager's PIN can approve for a cashier, in place. */
const APPROVABLE = ['discount_over', 'price_override', 'refund', 'refund_blind', 'void_ticket', 'cash_move'];

/** What the AI agent may do. Everything else is for people at the counter. */
const AGENT_PERMS = ['reports', 'catalog', 'customers', 'customers_admin', 'stock', 'imports', 'settings_basic', 'staff_reset', 'draft', 'receipts'];

const ACTION_LABEL = {
  sell: 'take payments',
  park: 'save tickets',
  discount: 'give discounts',
  discount_over: 'give a discount over the cashier limit',
  price_override: 'change a price',
  refund: 'refund a sale',
  refund_blind: 'refund without a receipt',
  void_ticket: 'void a ticket',
  cash_move: 'put cash in or take it out',
  shift: 'open and close the register',
  reports: 'see reports',
  catalog: 'change products',
  customers: 'add customers',
  customers_admin: 'remove customers',
  stock: 'change stock',
  kitchen: 'work the kitchen screen',
  reprint: 'reprint receipts',
  imports: 'import products',
  settings: 'change settings',
  staff: 'manage staff',
};

const SESSION_HOURS = 16;
const APPROVAL_MINUTES = 30;
const MAX_FAILS = 5;
const LOCK_MINUTES = 5;

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function can(role, action) {
  const perms = ROLE_PERMS[role] || [];
  return perms.indexOf(action) >= 0;
}

/* ------------------------------------------------------------------ PINs */

function checkPinFormat(pin) {
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) throw u().fail(400, 'A PIN is 4 to 6 digits', 'bad_pin_format');
}

function hashPin(salt, pin) {
  return u().sha(salt + ':' + pin);
}

/** Store a new PIN for a staff member (inside the caller's transaction). */
function setPin(app, staffRec, pin) {
  checkPinFormat(pin);
  const util = u();
  let row = util.findOne(app, 'staff_pins', 'staff = {:s}', { s: staffRec.id });
  if (row === null) {
    row = new Record(app.findCollectionByNameOrId('staff_pins'));
    row.set('staff', staffRec.id);
  }
  const salt = util.token(24);
  row.set('salt', salt);
  row.set('hash', hashPin(salt, pin));
  app.save(row);
  staffRec.set('pin_set', true);
  staffRec.set('failed', 0);
  staffRec.set('locked_until', '');
  app.save(staffRec);
}

/** Two people on one register must not share a PIN: a PIN identifies who rang a sale. */
function pinTaken(app, pin, exceptStaff) {
  const rows = exceptStaff ? app.findRecordsByFilter('staff_pins', 'staff != {:x}', '', 0, 0, { x: exceptStaff }) : app.findRecordsByFilter('staff_pins', '', '', 0, 0);
  for (const row of rows) {
    const st = u().byId(app, 'staff', row.getString('staff'));
    if (st === null || !st.getBool('active')) continue;
    if ($security.equal(hashPin(row.getString('salt'), pin), row.getString('hash'))) return true;
  }
  return false;
}

/**
 * Check a person's PIN, counting failures. Returns nothing on success and
 * throws a 401 (wrong PIN, with tries left) or 423 (locked) otherwise.
 */
function verifyPin(app, staffRec, pin) {
  const util = u();
  const core = require(`${__hooks}/lib_core.js`);
  if (!staffRec.getBool('active')) throw util.fail(403, staffRec.getString('name') + ' is not active', 'staff_inactive');
  if (!staffRec.getBool('pin_set')) throw util.fail(409, staffRec.getString('name') + ' has no PIN yet', 'pin_not_set');
  const until = staffRec.getString('locked_until');
  if (until !== '' && Date.parse(until) > Date.now()) {
    const mins = Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 60000));
    throw util.fail(423, 'Too many wrong PINs. Try again in ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.', 'pin_locked');
  }
  checkPinFormat(pin);
  const row = util.findOne(app, 'staff_pins', 'staff = {:s}', { s: staffRec.id });
  const ok = row !== null && $security.equal(hashPin(row.getString('salt'), pin), row.getString('hash'));
  if (ok) {
    if (staffRec.getInt('failed') !== 0 || staffRec.getString('locked_until') !== '') {
      staffRec.set('failed', 0);
      staffRec.set('locked_until', '');
      app.save(staffRec);
    }
    return;
  }
  const failed = staffRec.getInt('failed') + 1;
  if (failed >= MAX_FAILS) {
    staffRec.set('failed', 0);
    staffRec.set('locked_until', new Date(Date.now() + LOCK_MINUTES * 60000).toISOString());
    app.save(staffRec);
    core.audit(app, { kind: 'pin_locked', actor: 'system', staff: staffRec.id, ref: staffRec.getString('name'), summary: staffRec.getString('name') + ' was locked for ' + LOCK_MINUTES + ' minutes after ' + MAX_FAILS + ' wrong PINs' });
    throw util.fail(423, 'Too many wrong PINs. Try again in ' + LOCK_MINUTES + ' minutes.', 'pin_locked');
  }
  staffRec.set('failed', failed);
  app.save(staffRec);
  core.audit(app, { kind: 'login_failed', actor: 'system', staff: staffRec.id, ref: staffRec.getString('name'), summary: 'Wrong PIN for ' + staffRec.getString('name') });
  const left = MAX_FAILS - failed;
  throw util.fail(401, 'Wrong PIN. ' + left + ' tr' + (left === 1 ? 'y' : 'ies') + ' left.', 'wrong_pin');
}

/* -------------------------------------------------------------- sessions */

function serializeStaff(rec) {
  return {
    id: rec.id,
    name: rec.getString('name'),
    role: rec.getString('role'),
    color: rec.getInt('color') || 1,
    active: rec.getBool('active'),
    training: rec.getBool('training'),
    pin_set: rec.getBool('pin_set'),
    locked: rec.getString('locked_until') !== '' && Date.parse(rec.getString('locked_until')) > Date.now(),
    permissions: (ROLE_PERMS[rec.getString('role')] || []).slice(),
  };
}

function login(app, staffRec, pin, registerId) {
  const util = u();
  verifyPin(app, staffRec, pin);
  const tok = util.token(40);
  const s = new Record(app.findCollectionByNameOrId('sessions'));
  s.set('staff', staffRec.id);
  s.set('register', registerId || '');
  s.set('token_hash', util.sha(tok));
  s.set('expires', new Date(Date.now() + SESSION_HOURS * 3600000).toISOString());
  s.set('ended', false);
  app.save(s);
  return { token: tok, expires: s.getString('expires'), staff: serializeStaff(staffRec) };
}

/** The session this request carries, or null. */
function sessionOf(e, app) {
  const util = u();
  const tok = util.header(e, 'X-Pos-Session').trim();
  if (tok === '') return null;
  const s = util.findOne(app, 'sessions', 'token_hash = {:h} && ended = false', { h: util.sha(tok) });
  if (s === null) return null;
  if (Date.parse(s.getString('expires')) <= Date.now()) return null;
  const st = util.byId(app, 'staff', s.getString('staff'));
  if (st === null || !st.getBool('active')) return null;
  return { session: s, staff: st };
}

function logout(e, app) {
  const cur = sessionOf(e, app);
  if (cur === null) return { ok: true };
  cur.session.set('ended', true);
  app.save(cur.session);
  return { ok: true };
}

/* ------------------------------------------------------------- the gate */

/**
 * May this caller do `action`? Returns the context the operation records:
 * { actor: 'agent' | 'staff', staff, approval } (approval: the record a
 * manager's PIN created, to be marked used in the operation's transaction).
 *
 * agentAction: the AGENT_PERMS entry that lets the agent do it (null: the
 * agent may not).
 */
function gate(e, app, action, p, agentAction) {
  const util = u();
  if (util.isAgent(e)) {
    if (agentAction && AGENT_PERMS.indexOf(agentAction) >= 0) return { actor: 'agent', staff: null, approval: null };
    throw util.fail(
      403,
      'Your AI agent cannot ' + (ACTION_LABEL[action] || action) + ': that is done at the counter by staff with their PIN.',
      'agent_not_permitted',
    );
  }
  const cur = sessionOf(e, app);
  if (cur === null) throw util.fail(401, 'Sign in with your PIN first.', 'session_required');
  const role = cur.staff.getString('role');
  if (can(role, action)) return { actor: 'staff', staff: cur.staff, approval: null };
  if (APPROVABLE.indexOf(action) >= 0) {
    const ap = approvalFor(app, util.str(p || {}, 'approval', ''), action);
    if (ap !== null) return { actor: 'staff', staff: cur.staff, approval: ap };
    throw util.fail(403, 'A manager needs to approve this.', 'approval_required', { action: action });
  }
  throw util.fail(403, 'Your role cannot ' + (ACTION_LABEL[action] || action) + '.', 'not_permitted');
}

/** The signed-in person, or null (reads that show "you"). */
function whoAmI(e, app) {
  const cur = sessionOf(e, app);
  return cur === null ? null : cur.staff;
}

/* ------------------------------------------------------------- approvals */

/**
 * A manager approves an action for whoever is at the counter: their PIN,
 * checked like a sign-in, creates a one-time approval valid 30 minutes.
 */
function approve(e, app, approverRec, pin, action, scope) {
  const util = u();
  const core = require(`${__hooks}/lib_core.js`);
  if (APPROVABLE.indexOf(action) < 0) throw util.fail(400, 'action must be one of: ' + APPROVABLE.join(', '));
  verifyPin(app, approverRec, pin);
  if (!can(approverRec.getString('role'), action)) {
    throw util.fail(403, approverRec.getString('name') + ' cannot approve this: their role cannot ' + ACTION_LABEL[action] + '.', 'approver_not_permitted');
  }
  const cur = sessionOf(e, app);
  const tok = util.token(40);
  const rec = new Record(app.findCollectionByNameOrId('approvals'));
  rec.set('action', action);
  rec.set('approver', approverRec.id);
  rec.set('for_staff', cur !== null ? cur.staff.id : '');
  rec.set('scope', String(scope || '').slice(0, 80));
  rec.set('token_hash', util.sha(tok));
  rec.set('expires', new Date(Date.now() + APPROVAL_MINUTES * 60000).toISOString());
  rec.set('used', false);
  app.save(rec);
  core.audit(app, {
    kind: 'approval',
    actor: 'staff',
    staff: cur !== null ? cur.staff.id : '',
    approver: approverRec.id,
    ref: action,
    summary: approverRec.getString('name') + ' approved: ' + ACTION_LABEL[action],
  });
  return { approval: tok, action: action, approver: { id: approverRec.id, name: approverRec.getString('name') }, expires: rec.getString('expires') };
}

/** A live approval for `action` from its token, or null. */
function approvalFor(app, tok, action) {
  const util = u();
  if (typeof tok !== 'string' || tok === '') return null;
  const rec = util.findOne(app, 'approvals', 'token_hash = {:h}', { h: util.sha(tok) });
  if (rec === null || rec.getBool('used')) return null;
  if (rec.getString('action') !== action) return null;
  if (Date.parse(rec.getString('expires')) <= Date.now()) return null;
  return rec;
}

/** Mark an approval used (in the transaction that does the approved thing). */
function consume(tx, approvalRec) {
  if (approvalRec === null || approvalRec === undefined) return;
  const fresh = tx.findRecordById('approvals', approvalRec.id);
  if (fresh.getBool('used')) throw u().fail(409, 'That approval was already used. Ask for it again.', 'approval_used');
  fresh.set('used', true);
  tx.save(fresh);
}

module.exports = {
  ROLES: ROLES,
  ACTIONS: ACTIONS,
  ROLE_PERMS: ROLE_PERMS,
  APPROVABLE: APPROVABLE,
  AGENT_PERMS: AGENT_PERMS,
  ACTION_LABEL: ACTION_LABEL,
  can: can,
  checkPinFormat: checkPinFormat,
  setPin: setPin,
  pinTaken: pinTaken,
  verifyPin: verifyPin,
  serializeStaff: serializeStaff,
  login: login,
  sessionOf: sessionOf,
  logout: logout,
  gate: gate,
  whoAmI: whoAmI,
  approve: approve,
  approvalFor: approvalFor,
  consume: consume,
};
