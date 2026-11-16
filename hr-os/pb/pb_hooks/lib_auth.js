/// <reference path="../pb_data/types.d.ts" />
/**
 * Who is calling, and what they may do.
 *
 * - People sign in with email and password (the `members` auth collection
 *   hashes passwords and signs tokens; the page sends the token as the
 *   Authorization header, so PocketBase loads it as e.auth).
 * - Your AI agent presents the app's agent token (X-A2App-Token, compared
 *   with APP/.agent-token). It is a principal of its own: ctx.isAgent,
 *   ctx.member null. It reads everything except sealed values (and pay
 *   figures when the owner switched that off) and never holds a PIN.
 * - A role gives a level per module (none < view < edit < full): people,
 *   time, leave, expenses, payroll, hiring, performance, reports, admin.
 *   A role with team_scope (managers) also sees and acts on its direct and
 *   indirect reports without module rights.
 * - The approval PIN (six digits) guards the serious steps: ops with
 *   `effect: 'confirm'` check it before the handler runs. PINs are hashed
 *   with bcrypt by PocketBase's password hashing, in the hidden auth
 *   collection pin_vault. Wrong PINs lock the PIN for a while.
 * - The owner gets a recovery code at setup (shown once, stored hashed):
 *   it resets the owner's password or PIN when no one else can.
 */

const MODULES = ['people', 'time', 'leave', 'expenses', 'payroll', 'hiring', 'performance', 'reports', 'admin'];
const LEVELS = ['none', 'view', 'edit', 'full'];
const MODULE_LABEL = { people: 'People', time: 'Time', leave: 'Leave', expenses: 'Expenses', payroll: 'Payroll', hiring: 'Hiring', performance: 'Performance', reports: 'Reports', admin: 'Administration' };
const INVITE_DAYS = 7;
const SEEN_EVERY_MS = 5 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function rank(level) {
  const i = LEVELS.indexOf(level);
  return i < 0 ? 0 : i;
}

function limits(app) {
  const s = L('lib_settings').row(app);
  const r = u().jsonOf(s, 'rate_limits', {}) || {};
  return { loginFails: r.login_fails || 10, lockMinutes: r.lock_minutes || 15, pinFails: r.pin_fails || 5, pinLockMinutes: r.pin_lock_minutes || 15 };
}

/* ------------------------------------------------------------ identity */

function header(e, name) {
  try {
    return String(e.request.header.get(name) || '');
  } catch {
    return '';
  }
}

/** True when the caller presents the app's agent token (constant-time compare). */
function isAgent(e) {
  const presented = header(e, 'X-A2App-Token').trim();
  if (presented === '') return false;
  let tok = '';
  try {
    tok = toString($os.readFile($filepath.join(__hooks, '..', '..', '.agent-token'))).trim();
  } catch {
    return false;
  }
  return tok !== '' && $security.equal(presented, tok);
}

function memberOf(e) {
  let rec = null;
  try {
    rec = e.auth || null;
  } catch {
    rec = null;
  }
  if (rec === null) return null;
  try {
    if (rec.collection().name !== 'members') return null;
  } catch {
    return null;
  }
  return rec;
}

function levelsOfRole(role) {
  const out = {};
  const raw = role ? u().jsonOf(role, 'levels', {}) || {} : {};
  for (const m of MODULES) out[m] = LEVELS.indexOf(raw[m]) >= 0 ? raw[m] : 'none';
  return out;
}

function blank(app, e, op) {
  return {
    e: e,
    app: app,
    op: op || '',
    spec: null,
    actor: null,
    isAgent: false,
    member: null,
    memberId: '',
    name: '',
    email: '',
    role: null,
    roleCode: '',
    levels: {},
    owner: false,
    teamScope: false,
    entities: [],
    employeeId: '',
    audited: false,
    auditInfo: null,
  };
}

function fillMember(ctx, app, m) {
  const role = u().byId(app, 'roles', m.getString('role'));
  ctx.actor = 'person';
  ctx.member = m;
  ctx.memberId = m.id;
  ctx.name = m.getString('name');
  ctx.email = m.getString('email');
  ctx.role = role;
  ctx.roleCode = role ? role.getString('code') : '';
  ctx.levels = levelsOfRole(role);
  ctx.owner = ctx.roleCode === 'owner';
  ctx.teamScope = role ? role.getBool('team_scope') : false;
  const ents = u().jsonOf(m, 'entities', []) || [];
  ctx.entities = ctx.owner ? [] : ents.filter((x) => typeof x === 'string' && x !== '');
  ctx.employeeId = m.getString('employee');
}

/** The context every handler receives (identity and the declared permission checked). */
function context(e, spec) {
  const util = u();
  const app = e.app;
  const ctx = blank(app, e, spec.name);
  ctx.spec = spec;
  if (isAgent(e)) {
    ctx.actor = 'agent';
    ctx.isAgent = true;
    ctx.name = 'your AI agent';
    for (const m of MODULES) ctx.levels[m] = 'full';
  } else {
    const m = memberOf(e);
    if (m !== null) {
      const status = m.getString('status');
      if (status !== 'active') throw util.fail(401, 'This account is ' + (status === 'disabled' ? 'disabled' : 'not active yet') + '.', 'account_inactive');
      fillMember(ctx, app, m);
      touchSeen(app, m);
    }
  }
  if (spec.perm === 'public') {
    if (ctx.isAgent && spec.agent === 'deny') throw agentDenied(spec);
    return ctx;
  }
  if (ctx.actor === null) throw util.fail(401, 'Sign in first.', 'session_required');
  checkPerm(ctx, spec);
  return ctx;
}

/** A context for a member outside a request (background work done for them). */
function contextFor(app, member) {
  const ctx = blank(app, null, '');
  fillMember(ctx, app, member);
  return ctx;
}

/** A context for the app itself (cron, boot). */
function systemCtx(app) {
  const ctx = blank(app, null, '');
  ctx.actor = 'system';
  ctx.name = 'HR OS';
  for (const m of MODULES) ctx.levels[m] = 'full';
  return ctx;
}

/** The same caller with another app handle (the transaction handle inside runInTransaction). */
function withApp(ctx, app) {
  return Object.assign({}, ctx, { app: app });
}

function touchSeen(app, m) {
  const last = Date.parse(m.getString('last_seen'));
  if (!Number.isNaN(last) && Date.now() - last < SEEN_EVERY_MS) return;
  try {
    u().exec(app, 'UPDATE members SET last_seen = {:t} WHERE id = {:id}', { t: u().nowIso(), id: m.id });
  } catch {
    /* never block a request on this */
  }
}

/* --------------------------------------------------------- permissions */

function level(ctx, module) {
  return ctx.levels[module] || 'none';
}

/** Does ctx hold at least `lvl` on `module`? */
function can(ctx, module, lvl) {
  return rank(level(ctx, module)) >= rank(lvl || 'view');
}

/** Throw unless ctx holds `lvl` on `module`. */
function need(ctx, module, lvl, what) {
  if (can(ctx, module, lvl)) return;
  throw u().fail(
    403,
    (ctx.isAgent ? 'Your AI agent' : 'Your role') + ' cannot ' + (what || lvl + ' ' + MODULE_LABEL[module].toLowerCase()) + ' (needs ' + lvl + ' access to ' + MODULE_LABEL[module] + ').',
    'not_permitted',
    { module: module, level: lvl },
  );
}

/** The words every people-only refusal uses (never ask a person for their PIN or password). */
function handOff(opName) {
  return 'A person does this in HR OS; never ask them for their PIN or password. Hand it to the right person with inbox.route --op ' + (opName || '<op>') + ' --request "<what was asked, with the record, dates and amounts>" (it lands in their Inbox), or tell the person where to do it in the app.';
}

function agentDenied(spec) {
  return u().fail(403, 'Your AI agent cannot run ' + spec.name + '. ' + handOff(spec.name), 'agent_not_permitted', { op: spec.name, route_with: 'inbox.route' });
}

/** The catalog's declared permission, checked before the handler runs. */
function checkPerm(ctx, spec) {
  const util = u();
  const perm = spec.perm || 'self';
  if (ctx.isAgent && spec.agent === 'deny') throw agentDenied(spec);
  if (perm === 'public') return;
  if (ctx.actor === null) throw util.fail(401, 'Sign in first.', 'session_required');
  if (perm === 'signed' || perm === 'self') return;
  if (perm.indexOf('|') >= 0) {
    let last = null;
    for (const alt of perm.split('|')) {
      try {
        checkPerm(ctx, Object.assign({}, spec, { perm: alt }));
        return;
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }
  const p = perm === 'admin' ? 'admin:full' : perm;
  const parts = p.split(':');
  const module = parts[0];
  const lvl = parts[1] || 'view';
  if (MODULES.indexOf(module) < 0) throw new Error('bad perm ' + perm + ' on ' + spec.name);
  if (ctx.isAgent) return; // reads and allow/propose writes; deny was refused above
  need(ctx, module, lvl, spec.what);
}

/** Entity ids the caller may see (empty = all). */
function scope(ctx) {
  if (ctx.isAgent || ctx.owner || ctx.actor === 'system') return [];
  return ctx.entities || [];
}

function inScope(ctx, entityId) {
  const s = scope(ctx);
  return s.length === 0 || s.indexOf(entityId) >= 0;
}

/** The caller's own employee id ('' when none is linked). */
function selfEmployee(ctx) {
  return ctx.isAgent ? '' : ctx.employeeId || '';
}

/** Is the caller a (direct or indirect) manager of this employment on `day`? */
function isManagerOf(ctx, employmentId, day) {
  if (ctx.isAgent || !ctx.teamScope || ctx.employeeId === '') return false;
  const people = L('lib_people');
  const d = day || u().today(ctx.app);
  let mgr = people.managerOf(ctx.app, employmentId, d);
  const seen = {};
  while (mgr !== null && !seen[mgr.id]) {
    if (mgr.id === ctx.employeeId) return true;
    seen[mgr.id] = true;
    const emp = people.primaryEmployment(ctx.app, mgr.id, d);
    mgr = emp ? people.managerOf(ctx.app, emp, d) : null;
  }
  return false;
}

/* ---------------------------------------------------------------- me */

function hasPin(app, memberId) {
  return u().findOne(app, 'pin_vault', 'member = {:m}', { m: memberId }) !== null;
}

function me(ctx) {
  const util = u();
  const app = ctx.app;
  const s = L('lib_settings').row(app);
  const company = {
    name: s.getString('company_name'),
    reporting_currency: s.getString('reporting_currency'),
    setup_done: s.getBool('setup_done'),
    date_style: s.getString('date_style'),
    agent_sees_pay: s.getBool('agent_sees_pay'),
    managers_see_pay: s.getBool('managers_see_pay'),
    logo: s.getString('logo'),
    logo_dark: s.getString('logo_dark'),
  };
  const ents = util.rows(app, 'SELECT id, name, code, country, region, currency, timezone, week_start FROM entities WHERE active = TRUE ORDER BY created', { id: '', name: '', code: '', country: '', region: '', currency: '', timezone: '', week_start: 0 });
  const sc = scope(ctx);
  const countries = L('lib_countries');
  const entities = ents
    .filter((x) => sc.length === 0 || sc.indexOf(x.id) >= 0)
    .map((x) => {
      const c = countries.info(x.country) || {};
      return { id: x.id, name: x.name, code: x.code, country: x.country, region: x.region, currency: x.currency, timezone: x.timezone, week_start: x.week_start, date_format: c.date_format || 'YYYY-MM-DD', name_order: c.name_order || 'given_first' };
    });
  const home = homeEntity(ctx, app, entities);
  company.date_format = dateFormat(company.date_style, home);
  company.week_start = home ? home.week_start : 1;
  company.home_entity = home ? home.id : '';
  if (ctx.isAgent) return { actor: 'agent', company: company, levels: ctx.levels, entities: entities, today: util.today(app) };
  const m = ctx.member;
  let employee = null;
  if (ctx.employeeId !== '') {
    const emp = util.byId(app, 'employees', ctx.employeeId);
    if (emp !== null) {
      const people = L('lib_people');
      employee = { id: emp.id, number: emp.getString('number'), name: people.displayName(emp), employments: util.rows(app, 'SELECT id, entity, number, status FROM employments WHERE employee = {:e} ORDER BY start_day', { id: '', entity: '', number: '', status: '' }, { e: emp.id }).map((x) => ({ id: x.id, entity: x.entity, number: x.number, status: x.status })) };
    }
  }
  const manages = ctx.teamScope && ctx.employeeId !== '' ? L('lib_people').reportsOf(app, ctx.employeeId, util.today(app), true).length : 0;
  return {
    actor: 'person',
    member: { id: m.id, name: m.getString('name'), email: m.getString('email'), title: m.getString('title'), prefs: util.jsonOf(m, 'prefs', {}) || {} },
    role: ctx.role ? { id: ctx.role.id, code: ctx.roleCode, name: ctx.role.getString('name'), team_scope: ctx.teamScope } : null,
    levels: ctx.levels,
    owner: ctx.owner,
    admin: can(ctx, 'admin', 'edit'),
    entities_scope: scope(ctx),
    entities: entities,
    employee: employee,
    manages: manages,
    has_pin: hasPin(app, m.id),
    company: company,
    unread: util.count(app, 'SELECT COUNT(*) AS n FROM notifications WHERE member = {:m} AND read = FALSE', { m: m.id }),
    today: util.today(app),
  };
}

const DATE_STYLES = { iso: 'YYYY-MM-DD', dmy: 'DD/MM/YYYY', mdy: 'MM/DD/YYYY', ymd: 'YYYY/MM/DD' };

/** The entity whose conventions a person sees: their primary employment's, else the first. */
function homeEntity(ctx, app, entities) {
  if (entities.length === 0) return null;
  if (ctx.employeeId) {
    const r = u().one(app, 'SELECT entity FROM employments WHERE employee = {:e} ORDER BY [[primary]] DESC, start_day DESC LIMIT 1', { entity: '' }, { e: ctx.employeeId });
    if (r !== null) {
      const hit = entities.filter((x) => x.id === r.entity)[0];
      if (hit) return hit;
    }
  }
  return entities[0];
}

/** Date format tokens (YYYY MM DD) from the company date style: 'entity' follows the country. */
function dateFormat(style, entity) {
  if (DATE_STYLES[style]) return DATE_STYLES[style];
  return entity ? entity.date_format : 'YYYY-MM-DD';
}

/* ------------------------------------------------------------ sign in */

function normEmail(v) {
  return String(v || '')
    .trim()
    .toLowerCase();
}

function checkEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) throw u().fail(400, 'Enter a valid email address.', 'invalid_email');
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw u().fail(400, 'Use a password of at least 8 characters.', 'weak_password');
  if (pw.length > 200) throw u().fail(400, 'That password is too long.', 'weak_password');
}

function memberByEmail(app, email) {
  return u().findOne(app, 'members', 'email = {:e}', { e: normEmail(email) });
}

function auditAs(app, member, entry) {
  L('lib_audit').write({ app: app, actor: 'person', memberId: member ? member.id : '', isAgent: false }, entry);
}

function login(ctx, p) {
  const util = u();
  const app = ctx.app;
  const email = normEmail(util.req(p, 'email'));
  const password = util.str(p, 'password', '');
  const m = memberByEmail(app, email);
  const wrong = () => util.fail(401, 'That email and password do not match. New to the team? Use your invite code.', 'wrong_password');
  if (m === null || m.getString('status') === 'invited') throw wrong();
  const until = Date.parse(m.getString('locked_until'));
  if (!Number.isNaN(until) && until > Date.now()) {
    const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    throw util.fail(423, 'Too many wrong passwords. Try again in ' + mins + (mins === 1 ? ' minute.' : ' minutes.'), 'locked', { minutes: mins });
  }
  if (!m.validatePassword(password)) {
    const lim = limits(app);
    const fails = m.getInt('fails') + 1;
    if (fails >= lim.loginFails) {
      m.set('fails', 0);
      m.set('locked_until', new Date(Date.now() + lim.lockMinutes * 60000).toISOString());
    } else m.set('fails', fails);
    app.save(m);
    auditAs(app, m, { op: 'auth.login', collection: 'members', record: m.id, summary: 'Wrong password for ' + email });
    throw wrong();
  }
  if (m.getString('status') === 'disabled') throw util.fail(403, 'This account is disabled. Ask an administrator.', 'account_disabled');
  m.set('fails', 0);
  m.set('locked_until', '');
  m.set('last_seen', util.nowIso());
  app.save(m);
  auditAs(app, m, { op: 'auth.login', collection: 'members', record: m.id, summary: m.getString('name') + ' signed in' });
  ctx.audited = true;
  return { token: m.newAuthToken(), me: me(contextFor(app, m)) };
}

function logout(ctx) {
  if (ctx.member !== null) ctx.auditInfo = { collection: 'members', record: ctx.memberId, summary: ctx.name + ' signed out' };
  return { ok: true };
}

function getMe(ctx) {
  return me(ctx);
}

function refresh(ctx) {
  if (ctx.member === null) throw u().fail(400, 'Only a signed-in person has a session to refresh.', 'invalid');
  ctx.audited = true;
  return { token: ctx.member.newAuthToken(), me: me(ctx) };
}

function newCode(n) {
  const raw = $security.randomStringWithAlphabet(n || 10, CODE_ALPHABET);
  const parts = [];
  for (let i = 0; i < raw.length; i += 5) parts.push(raw.slice(i, i + 5));
  return parts.join('-');
}

function normCode(code) {
  return String(code || '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

function setInvite(m) {
  const code = newCode(10);
  m.set('invite_hash', u().sha(normCode(code)));
  m.set('invite_expires', new Date(Date.now() + INVITE_DAYS * 86400000).toISOString());
  return code;
}

function acceptInvite(ctx, p) {
  const util = u();
  const app = ctx.app;
  const email = normEmail(util.req(p, 'email'));
  const code = normCode(util.req(p, 'code'));
  const password = util.str(p, 'password', '');
  checkPassword(password);
  const m = memberByEmail(app, email);
  const bad = () => util.fail(400, 'That email and invite code do not match, or the code has expired. Ask your administrator for a new one.', 'bad_invite');
  if (m === null || m.getString('status') === 'disabled') throw bad();
  const hash = m.getString('invite_hash');
  const exp = Date.parse(m.getString('invite_expires'));
  if (hash === '' || Number.isNaN(exp) || exp < Date.now() || !$security.equal(util.sha(code), hash)) {
    const lim = limits(app);
    const fails = m.getInt('fails') + 1;
    m.set('fails', fails >= lim.loginFails ? 0 : fails);
    if (fails >= lim.loginFails) {
      m.set('invite_hash', '');
      m.set('invite_expires', '');
    }
    app.save(m);
    throw bad();
  }
  const name = util.text(p, 'name', 120, '');
  if (name !== '') m.set('name', util.squash(name));
  m.setPassword(password);
  m.set('status', 'active');
  m.set('invite_hash', '');
  m.set('invite_expires', '');
  m.set('fails', 0);
  m.set('locked_until', '');
  m.set('last_seen', util.nowIso());
  app.save(m);
  auditAs(app, m, { op: 'auth.accept-invite', collection: 'members', record: m.id, summary: m.getString('name') + ' joined' });
  ctx.audited = true;
  return { token: m.newAuthToken(), me: me(contextFor(app, m)) };
}

function changePassword(ctx, p) {
  const util = u();
  if (ctx.member === null) throw util.fail(400, 'Only a signed-in person has a password.', 'invalid');
  const m = ctx.app.findRecordById('members', ctx.memberId);
  if (!m.validatePassword(util.str(p, 'current', ''))) throw util.fail(400, 'Your current password is not right.', 'wrong_password');
  const next = util.str(p, 'password', '');
  checkPassword(next);
  m.setPassword(next);
  m.refreshTokenKey();
  ctx.app.save(m);
  ctx.auditInfo = { collection: 'members', record: m.id, summary: 'Changed their password' };
  return { token: m.newAuthToken() };
}

function updateProfile(ctx, p) {
  const util = u();
  if (ctx.member === null) throw util.fail(400, 'Only a signed-in person has a profile.', 'invalid');
  const m = ctx.app.findRecordById('members', ctx.memberId);
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'Your name cannot be empty.', 'invalid_param');
    m.set('name', n);
  }
  if (util.has(p, 'title')) m.set('title', util.text(p, 'title', 120, ''));
  if (util.has(p, 'prefs')) {
    const prefs = util.obj(p, 'prefs');
    const cur = util.jsonOf(m, 'prefs', {}) || {};
    for (const k of Object.keys(prefs)) cur[k] = prefs[k];
    if (JSON.stringify(cur).length > 3500) throw util.fail(400, 'Too many preferences.', 'invalid_param');
    m.set('prefs', cur);
  }
  ctx.app.save(m);
  ctx.auditInfo = { collection: 'members', record: m.id, summary: 'Updated their profile' };
  return me(contextFor(ctx.app, m));
}

/* ---------------------------------------------------------------- PIN */

function pinSecret(memberId, pin) {
  return 'hr-pin:' + memberId + ':' + pin;
}

function checkPinFormat(pin) {
  const s = String(pin === undefined || pin === null ? '' : pin);
  if (!/^\d{6}$/.test(s)) throw u().fail(400, 'An approval PIN is six digits.', 'invalid_pin');
  if (s.split('').every((c) => c === s.charAt(0))) throw u().fail(400, 'Choose a PIN that is not one digit six times.', 'weak_pin');
  return s;
}

/** Store a (new) PIN for a member record, hashed in the vault. */
function storePin(app, m, pin) {
  const util = u();
  const s = checkPinFormat(pin);
  let v = util.findOne(app, 'pin_vault', 'member = {:m}', { m: m.id });
  if (v === null) {
    v = util.newRecord(app, 'pin_vault');
    v.set('member', m.id);
    v.set('email', m.id.toLowerCase() + '@pin-vault.invalid');
  }
  v.setPassword(pinSecret(m.id, s));
  app.save(v);
  m.set('pin_set_at', util.nowIso());
  m.set('pin_fails', 0);
  m.set('pin_locked_until', '');
  app.save(m);
}

/** Check the caller's approval PIN; throws on a missing, locked or wrong PIN. */
function verifyPin(ctx, pin) {
  const util = u();
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent has no approval PIN. ' + handOff(ctx.op), 'agent_not_permitted', { op: ctx.op || '', route_with: 'inbox.route' });
  if (ctx.member === null) throw util.fail(401, 'Sign in first.', 'session_required');
  const app = ctx.app;
  const m = app.findRecordById('members', ctx.memberId);
  const v = util.findOne(app, 'pin_vault', 'member = {:m}', { m: m.id });
  if (v === null) throw util.fail(409, 'Set your approval PIN first (Settings, Security).', 'pin_not_set');
  const until = Date.parse(m.getString('pin_locked_until'));
  if (!Number.isNaN(until) && until > Date.now()) {
    const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    throw util.fail(423, 'Too many wrong PINs. Try again in ' + mins + (mins === 1 ? ' minute.' : ' minutes.'), 'pin_locked', { minutes: mins });
  }
  const s = String(pin === undefined || pin === null ? '' : pin).trim();
  if (s === '') throw util.fail(400, 'This needs your approval PIN.', 'pin_required');
  if (!/^\d{6}$/.test(s) || !v.validatePassword(pinSecret(m.id, s))) {
    const lim = limits(app);
    const fails = m.getInt('pin_fails') + 1;
    let left = lim.pinFails - fails;
    if (fails >= lim.pinFails) {
      m.set('pin_fails', 0);
      m.set('pin_locked_until', new Date(Date.now() + lim.pinLockMinutes * 60000).toISOString());
      left = 0;
    } else m.set('pin_fails', fails);
    app.save(m);
    auditAs(app, m, { op: ctx.op || 'pin.verify', collection: 'members', record: m.id, summary: 'Wrong approval PIN' });
    throw util.fail(403, left > 0 ? 'That PIN is not right. ' + left + (left === 1 ? ' try left.' : ' tries left.') : 'That PIN is not right. PIN locked for ' + lim.pinLockMinutes + ' minutes.', 'wrong_pin', { left: left });
  }
  if (m.getInt('pin_fails') > 0) {
    m.set('pin_fails', 0);
    app.save(m);
  }
  return true;
}

/**
 * pin.verify: check the caller's PIN before a step that needs it. A wrong,
 * missing or locked PIN answers 200 { ok: false, code, attempts_left |
 * minutes } (the tries still count toward the lock), so a screen asks again
 * without an error in the browser console. Confirm ops keep answering 403.
 */
function pinVerify(ctx, p) {
  try {
    verifyPin(ctx, u().str(p, 'pin', ''));
  } catch (err) {
    const code = err && err.code;
    const extra = (err && err.extra) || {};
    if (code === 'wrong_pin') return { ok: false, code: code, attempts_left: extra.left, message: err.message };
    if (code === 'pin_locked') return { ok: false, code: code, minutes: extra.minutes, message: err.message };
    if (code === 'pin_not_set' || code === 'pin_required') return { ok: false, code: code, message: err.message };
    throw err;
  }
  ctx.audited = true;
  return { ok: true };
}

function pinStatus(ctx) {
  const util = u();
  if (ctx.member === null) throw util.fail(400, 'Only a signed-in person has an approval PIN.', 'invalid');
  const m = ctx.member;
  const until = Date.parse(m.getString('pin_locked_until'));
  return { has_pin: hasPin(ctx.app, m.id), set_at: m.getString('pin_set_at'), locked: !Number.isNaN(until) && until > Date.now(), locked_until: m.getString('pin_locked_until'), owner_recovery: ctx.owner ? m.getString('recovery_set_at') !== '' : false };
}

/** First PIN: proves identity with the sign-in password. */
function pinSet(ctx, p) {
  const util = u();
  if (ctx.member === null) throw util.fail(400, 'Only a signed-in person has an approval PIN.', 'invalid');
  const m = ctx.app.findRecordById('members', ctx.memberId);
  if (hasPin(ctx.app, m.id)) throw util.fail(409, 'You already have an approval PIN. Change it with your current PIN.', 'pin_exists');
  if (!m.validatePassword(util.str(p, 'password', ''))) throw util.fail(400, 'Your password is not right.', 'wrong_password');
  storePin(ctx.app, m, util.req(p, 'new_pin'));
  ctx.auditInfo = { collection: 'members', record: m.id, summary: 'Set their approval PIN' };
  return pinStatus(contextFor(ctx.app, m));
}

function pinChange(ctx, p) {
  const util = u();
  verifyPin(ctx, util.str(p, 'current_pin', ''));
  const m = ctx.app.findRecordById('members', ctx.memberId);
  storePin(ctx.app, m, util.req(p, 'new_pin'));
  ctx.auditInfo = { collection: 'members', record: m.id, summary: 'Changed their approval PIN' };
  return pinStatus(contextFor(ctx.app, m));
}

/** An administrator clears someone's PIN (they set a new one with their password). */
function pinReset(ctx, p) {
  const util = u();
  const m = memberRef(ctx.app, util.req(p, 'member'));
  guardOwner(ctx, m);
  if (m.id === ctx.memberId) throw util.fail(409, 'Change your own PIN with pin.change, or use your recovery code.', 'invalid');
  ctx.app.runInTransaction((tx) => {
    const v = util.findOne(tx, 'pin_vault', 'member = {:m}', { m: m.id });
    if (v !== null) tx.delete(v);
    const fresh = tx.findRecordById('members', m.id);
    fresh.set('pin_set_at', '');
    fresh.set('pin_fails', 0);
    fresh.set('pin_locked_until', '');
    tx.save(fresh);
    L('lib_audit').write(withApp(ctx, tx), { op: 'pin.reset', collection: 'members', record: m.id, summary: 'Cleared the approval PIN of ' + m.getString('name') });
  });
  L('lib_notify').notify(ctx.app, [m.id], { kind: 'security', title: 'Your approval PIN was cleared', body: 'An administrator cleared your approval PIN. Set a new one in Settings, Security.', link: '#/settings/security' });
  return memberOut(ctx.app, ctx.app.findRecordById('members', m.id));
}

/** A new owner recovery code (shown once). */
function issueRecovery(app, m) {
  const code = newCode(20);
  m.set('recovery_hash', u().sha(normCode(code)));
  m.set('recovery_set_at', u().nowIso());
  app.save(m);
  return code;
}

function checkRecovery(app, m, code) {
  const util = u();
  const hash = m.getString('recovery_hash');
  const ok = hash !== '' && $security.equal(util.sha(normCode(code)), hash);
  if (!ok) {
    const lim = limits(app);
    const fails = m.getInt('fails') + 1;
    if (fails >= lim.loginFails) {
      m.set('fails', 0);
      m.set('locked_until', new Date(Date.now() + lim.lockMinutes * 60000).toISOString());
    } else m.set('fails', fails);
    app.save(m);
    auditAs(app, m, { op: 'auth.recover', collection: 'members', record: m.id, summary: 'Wrong recovery code' });
    throw util.fail(400, 'That recovery code is not right.', 'bad_recovery_code');
  }
}

/** The signed-in owner resets a forgotten PIN with the recovery code (a new code is issued). */
function pinRecover(ctx, p) {
  const util = u();
  if (!ctx.owner) throw util.fail(403, 'Only an owner has a recovery code. Ask an administrator to clear your PIN.', 'not_permitted');
  const m = ctx.app.findRecordById('members', ctx.memberId);
  checkRecovery(ctx.app, m, util.req(p, 'recovery_code'));
  storePin(ctx.app, m, util.req(p, 'new_pin'));
  const code = issueRecovery(ctx.app, ctx.app.findRecordById('members', m.id));
  ctx.auditInfo = { collection: 'members', record: m.id, summary: 'Reset their approval PIN with the recovery code' };
  return { pin: pinStatus(contextFor(ctx.app, ctx.app.findRecordById('members', m.id))), recovery_code: code };
}

/** An owner who lost the password signs in with the recovery code (and may set a new PIN). */
function recover(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = memberByEmail(app, util.req(p, 'email'));
  if (m === null || m.getString('status') !== 'active') throw util.fail(400, 'That recovery code is not right.', 'bad_recovery_code');
  const until = Date.parse(m.getString('locked_until'));
  if (!Number.isNaN(until) && until > Date.now()) throw util.fail(423, 'Too many wrong tries. Wait a few minutes.', 'locked');
  checkRecovery(app, m, util.req(p, 'recovery_code'));
  const pw = util.str(p, 'password', '');
  checkPassword(pw);
  m.setPassword(pw);
  m.refreshTokenKey();
  m.set('fails', 0);
  m.set('locked_until', '');
  app.save(m);
  if (util.str(p, 'new_pin', '') !== '') storePin(app, app.findRecordById('members', m.id), util.str(p, 'new_pin', ''));
  const fresh = app.findRecordById('members', m.id);
  const code = issueRecovery(app, fresh);
  auditAs(app, fresh, { op: 'auth.recover', collection: 'members', record: m.id, summary: 'Signed in with the recovery code and set a new password' });
  ctx.audited = true;
  return { token: fresh.newAuthToken(), recovery_code: code, me: me(contextFor(app, fresh)) };
}

/** The signed-in owner replaces the recovery code (needs the PIN). */
function recoveryNew(ctx) {
  const util = u();
  if (!ctx.owner) throw util.fail(403, 'Only an owner has a recovery code.', 'not_permitted');
  const code = issueRecovery(ctx.app, ctx.app.findRecordById('members', ctx.memberId));
  ctx.auditInfo = { collection: 'members', record: ctx.memberId, summary: 'Made a new recovery code' };
  return { recovery_code: code };
}

/* ------------------------------------------------------------ members */

function memberRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  const byId = util.byId(app, 'members', r);
  if (byId !== null) return byId;
  const byEmail = memberByEmail(app, r);
  if (byEmail !== null) return byEmail;
  throw util.fail(404, 'No member ' + r + '. Run members.list.', 'not_found');
}

function memberOut(app, m) {
  const util = u();
  const role = util.byId(app, 'roles', m.getString('role'));
  const emp = util.byId(app, 'employees', m.getString('employee'));
  const t = Date.parse(m.getString('locked_until'));
  return {
    id: m.id,
    name: m.getString('name'),
    email: m.getString('email'),
    title: m.getString('title'),
    status: m.getString('status'),
    role: role ? { id: role.id, code: role.getString('code'), name: role.getString('name') } : null,
    employee: emp ? { id: emp.id, number: emp.getString('number'), name: L('lib_people').displayName(emp) } : null,
    entities: util.jsonOf(m, 'entities', []) || [],
    has_pin: hasPin(app, m.id),
    last_seen: m.getString('last_seen'),
    invite_expires: m.getString('invite_expires'),
    locked: !Number.isNaN(t) && t > Date.now(),
    created: m.getString('created'),
  };
}

function listMembers(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 100, 1000);
  const where = ['1 = 1'];
  const bind = {};
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(name LIKE {:q} ESCAPE '\\' OR email LIKE {:q} ESCAPE '\\')");
    bind.q = util.like(q);
  }
  const status = util.str(p, 'status', '');
  if (status !== '') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const role = util.str(p, 'role', '');
  if (role !== '') {
    where.push('role = {:r}');
    bind.r = roleRef(app, role).id;
  }
  const w = where.join(' AND ');
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM members WHERE ' + w, bind);
  const ids = util.rows(app, "SELECT id FROM members WHERE " + w + " ORDER BY status = 'disabled', name COLLATE NOCASE LIMIT " + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const counts = {};
  for (const r of util.rows(app, 'SELECT status, COUNT(*) AS n FROM members GROUP BY status', { status: '', n: 0 })) counts[r.status] = r.n;
  return { members: ids.map((r) => memberOut(app, app.findRecordById('members', r.id))), total: total, counts: counts };
}

function getMember(ctx, p) {
  return memberOut(ctx.app, memberRef(ctx.app, u().req(p, 'member')));
}

function roleRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  const rec = util.byId(app, 'roles', r) || util.findOne(app, 'roles', 'code = {:c}', { c: r });
  if (rec !== null) return rec;
  return util.byIdOrName(app, 'roles', r, 'name', 'roles.list');
}

function roleByCode(app, code) {
  return u().findOne(app, 'roles', 'code = {:c}', { c: code });
}

function roleParam(ctx, ref) {
  const role = roleRef(ctx.app, ref);
  if (role.getString('code') === 'owner' && !ctx.owner) throw u().fail(403, 'Only an owner can give someone the Owner role.', 'not_permitted');
  if (role.getString('code') !== 'owner' && !ctx.owner && !can(ctx, 'admin', 'full')) {
    const lv = levelsOfRole(role);
    if (rank(lv.admin) >= rank('full')) throw u().fail(403, 'Only someone with full administration rights can give that role.', 'not_permitted');
  }
  return role;
}

function entitiesParam(ctx, p) {
  const util = u();
  const raw = util.list(p, 'entities');
  if (raw === undefined) return undefined;
  const out = [];
  for (const ref of raw) {
    const ent = util.byIdOrName(ctx.app, 'entities', String(ref), 'name', 'entities.list');
    if (out.indexOf(ent.id) < 0) out.push(ent.id);
  }
  return out;
}

function guardOwner(ctx, m) {
  const role = u().byId(ctx.app, 'roles', m.getString('role'));
  if (role && role.getString('code') === 'owner' && !ctx.owner) throw u().fail(403, 'Only an owner can change an owner.', 'not_permitted');
}

function ownersLeft(app, exceptId) {
  const owner = roleByCode(app, 'owner');
  return u().count(app, "SELECT COUNT(*) AS n FROM members WHERE role = {:r} AND status = 'active' AND id != {:x}", { r: owner.id, x: exceptId });
}

/** Link a member and an employee both ways (refuses an employee already linked to someone else). */
function linkEmployee(tx, m, empRef) {
  const util = u();
  const prev = m.getString('employee');
  if (prev !== '') {
    const old = util.byId(tx, 'employees', prev);
    if (old !== null) {
      old.set('member', '');
      tx.save(old);
    }
  }
  if (empRef === '') {
    m.set('employee', '');
    return null;
  }
  const emp = L('lib_people').employeeRef(tx, empRef);
  const taken = util.findOne(tx, 'members', 'employee = {:e} && id != {:m}', { e: emp.id, m: m.id || '' });
  if (taken !== null) throw util.fail(409, L('lib_people').displayName(emp) + ' is already linked to ' + taken.getString('email') + '.', 'duplicate');
  m.set('employee', emp.id);
  return emp;
}

function invite(ctx, p) {
  const util = u();
  const app = ctx.app;
  const email = normEmail(util.req(p, 'email', 'sam@example.com'));
  checkEmail(email);
  if (memberByEmail(app, email) !== null) throw util.fail(409, email + ' is already a member.', 'duplicate');
  const name = util.squash(util.text(p, 'name', 120, ''));
  if (name === '') throw util.fail(400, 'name is required', 'missing_param', { param: 'name' });
  const role = roleParam(ctx, util.req(p, 'role', 'employee'));
  const ents = entitiesParam(ctx, p);
  const m = util.newRecord(app, 'members');
  m.set('email', email);
  m.set('name', name);
  m.set('title', util.text(p, 'title', 120, ''));
  m.set('role', role.id);
  m.set('status', 'invited');
  m.set('entities', ents || []);
  m.setPassword(util.token(40));
  const code = setInvite(m);
  const empRef = util.str(p, 'employee', '');
  let emp = null;
  app.runInTransaction((tx) => {
    tx.save(m);
    if (empRef !== '') {
      emp = linkEmployee(tx, m, empRef);
      tx.save(m);
      const e2 = tx.findRecordById('employees', emp.id);
      e2.set('member', m.id);
      tx.save(e2);
    }
    L('lib_audit').write(withApp(ctx, tx), { op: 'members.invite', collection: 'members', record: m.id, summary: 'Invited ' + name + ' (' + email + ') as ' + role.getString('name') });
  });
  ctx.audited = true;
  if (emp !== null) L('lib_events').emit(ctx, 'member.linked', { member: m.id, employee: emp.id });
  return { member: memberOut(app, app.findRecordById('members', m.id)), code: code, expires: m.getString('invite_expires') };
}

function updateMember(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = memberRef(app, util.req(p, 'member'));
  guardOwner(ctx, m);
  const changes = [];
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 120, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
    m.set('name', n);
    changes.push('name');
  }
  if (util.has(p, 'title')) {
    m.set('title', util.text(p, 'title', 120, ''));
    changes.push('title');
  }
  if (util.has(p, 'email')) {
    const email = normEmail(util.str(p, 'email', ''));
    checkEmail(email);
    const other = memberByEmail(app, email);
    if (other !== null && other.id !== m.id) throw util.fail(409, email + ' is already a member.', 'duplicate');
    m.set('email', email);
    changes.push('email');
  }
  if (util.has(p, 'role')) {
    const role = roleParam(ctx, util.str(p, 'role', ''));
    const owner = roleByCode(app, 'owner');
    if (m.getString('role') === owner.id && role.id !== owner.id && ownersLeft(app, m.id) === 0) throw util.fail(409, 'Keep at least one active owner: give someone else the Owner role first.', 'last_owner');
    if (m.id === ctx.memberId && role.id !== m.getString('role')) throw util.fail(409, 'You cannot change your own role.', 'invalid');
    m.set('role', role.id);
    changes.push('role');
  }
  const ents = entitiesParam(ctx, p);
  if (ents !== undefined) {
    m.set('entities', ents);
    changes.push('entities');
  }
  let linked = null;
  app.runInTransaction((tx) => {
    if (util.has(p, 'employee')) {
      linked = linkEmployee(tx, m, util.str(p, 'employee', ''));
      if (linked !== null) {
        const e2 = tx.findRecordById('employees', linked.id);
        e2.set('member', m.id);
        tx.save(e2);
      }
      changes.push('employee');
    }
    tx.save(m);
    L('lib_audit').write(withApp(ctx, tx), { op: 'members.update', collection: 'members', record: m.id, summary: 'Changed ' + (changes.length > 0 ? changes.join(', ') : 'nothing') + ' of ' + m.getString('name') });
  });
  ctx.audited = true;
  if (linked !== null) L('lib_events').emit(ctx, 'member.linked', { member: m.id, employee: linked.id });
  return memberOut(app, app.findRecordById('members', m.id));
}

function setActive(ctx, p, active) {
  const util = u();
  const app = ctx.app;
  const m = memberRef(app, util.req(p, 'member'));
  guardOwner(ctx, m);
  if (m.id === ctx.memberId && !active) throw util.fail(409, 'You cannot disable yourself.', 'invalid');
  if (!active) {
    const owner = roleByCode(app, 'owner');
    if (m.getString('role') === owner.id && ownersLeft(app, m.id) === 0) throw util.fail(409, 'Keep at least one active owner.', 'last_owner');
    m.set('status', 'disabled');
    m.refreshTokenKey();
  } else {
    m.set('status', m.getString('invite_hash') !== '' ? 'invited' : 'active');
  }
  app.save(m);
  ctx.auditInfo = { collection: 'members', record: m.id, summary: (active ? 'Enabled ' : 'Disabled ') + m.getString('name') };
  return memberOut(app, m);
}

function disable(ctx, p) {
  return setActive(ctx, p, false);
}

function enable(ctx, p) {
  return setActive(ctx, p, true);
}

/** A new sign-in code: an invite that expired, or a forgotten password. */
function resetMember(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = memberRef(app, util.req(p, 'member'));
  guardOwner(ctx, m);
  if (m.getString('status') === 'disabled') throw util.fail(409, 'Enable the member first.', 'invalid');
  const code = setInvite(m);
  m.set('fails', 0);
  m.set('locked_until', '');
  if (m.getString('status') === 'active') m.refreshTokenKey();
  app.save(m);
  ctx.auditInfo = { collection: 'members', record: m.id, summary: 'New sign-in code for ' + m.getString('name') };
  return { member: memberOut(app, m), code: code, expires: m.getString('invite_expires') };
}

function signoutEverywhere(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'member', '');
  let m;
  if (ref === '' || (ctx.member !== null && ref === ctx.memberId)) {
    if (ctx.member === null) throw util.fail(400, 'member is required', 'missing_param');
    m = app.findRecordById('members', ctx.memberId);
  } else {
    need(ctx, 'admin', 'edit', 'sign others out');
    m = memberRef(app, ref);
    guardOwner(ctx, m);
  }
  m.refreshTokenKey();
  app.save(m);
  ctx.auditInfo = { collection: 'members', record: m.id, summary: 'Signed ' + m.getString('name') + ' out everywhere' };
  return { ok: true, token: m.id === ctx.memberId ? m.newAuthToken() : '' };
}

function deleteMember(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = memberRef(app, util.req(p, 'member'));
  guardOwner(ctx, m);
  if (m.getString('status') !== 'invited' || m.getString('last_seen') !== '') {
    throw util.fail(409, m.getString('name') + ' has used the app; disable the account instead so their history keeps its name.', 'has_history');
  }
  app.runInTransaction((tx) => {
    const emp = util.findOne(tx, 'employees', 'member = {:m}', { m: m.id });
    if (emp !== null) {
      emp.set('member', '');
      tx.save(emp);
    }
    tx.delete(tx.findRecordById('members', m.id));
    L('lib_audit').write(withApp(ctx, tx), { op: 'members.delete', collection: 'members', record: m.id, summary: 'Removed the invite for ' + m.getString('name') });
  });
  ctx.audited = true;
  return { deleted: true };
}

/* -------------------------------------------------------------- roles */

function roleOut(app, r) {
  return {
    id: r.id,
    code: r.getString('code'),
    name: r.getString('name'),
    levels: levelsOfRole(r),
    team_scope: r.getBool('team_scope'),
    description: r.getString('description'),
    system: r.getBool('system'),
    members: u().count(app, "SELECT COUNT(*) AS n FROM members WHERE role = {:r} AND status != 'disabled'", { r: r.id }),
  };
}

function listRoles(ctx) {
  const app = ctx.app;
  return {
    roles: app.findRecordsByFilter('roles', '', 'sort,name', 0, 0).map((r) => roleOut(app, r)),
    modules: MODULES.map((m) => ({ key: m, label: MODULE_LABEL[m] })),
    levels: LEVELS,
  };
}

function readLevels(p) {
  const util = u();
  const raw = util.obj(p, 'levels');
  if (raw === undefined) return undefined;
  for (const k of Object.keys(raw)) if (MODULES.indexOf(k) < 0) throw util.fail(400, 'Unknown module "' + k + '" in levels. Modules: ' + MODULES.join(', '), 'invalid_param');
  const out = {};
  for (const m of MODULES) {
    const v = raw[m] === undefined ? 'none' : String(raw[m]);
    if (LEVELS.indexOf(v) < 0) throw util.fail(400, 'levels.' + m + ' must be one of: ' + LEVELS.join(', '), 'invalid_param');
    out[m] = v;
  }
  return out;
}

function saveRole(ctx, p, rec) {
  const util = u();
  const app = ctx.app;
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 80, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
    const dup = util.rows(app, 'SELECT id FROM roles WHERE LOWER(name) = LOWER({:n}) AND id != {:x}', { id: '' }, { n: n, x: rec.id || '' });
    if (dup.length > 0) throw util.fail(409, 'There is already a role called ' + n + '.', 'duplicate');
    rec.set('name', n);
  }
  const lv = readLevels(p);
  if (lv !== undefined) {
    if (rank(lv.admin) >= rank('full') && !ctx.owner) throw util.fail(403, 'Only an owner can give a role full administration rights.', 'not_permitted');
    rec.set('levels', lv);
  }
  if (util.has(p, 'team_scope')) rec.set('team_scope', util.bool(p, 'team_scope', false));
  if (util.has(p, 'description')) rec.set('description', util.text(p, 'description', 400, ''));
  app.save(rec);
  return rec;
}

function addRole(ctx, p) {
  const util = u();
  const name = util.req(p, 'name', 'Supervisor');
  const rec = util.newRecord(ctx.app, 'roles');
  let code = util.str(p, 'code', '') || util.slug(name).replace(/-/g, '_');
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(code)) throw util.fail(400, 'code must be lower case letters, digits and _ (e.g. site_lead).', 'invalid_param', { param: 'code' });
  if (roleByCode(ctx.app, code) !== null) throw util.fail(409, 'There is already a role with the code ' + code + '.', 'duplicate');
  rec.set('code', code);
  rec.set('system', false);
  rec.set('levels', readLevels({ levels: '{}' }));
  rec.set('sort', 100);
  saveRole(ctx, p, rec);
  ctx.auditInfo = { collection: 'roles', record: rec.id, summary: 'Added the role ' + rec.getString('name'), after: { levels: levelsOfRole(rec), team_scope: rec.getBool('team_scope') } };
  return roleOut(ctx.app, rec);
}

function updateRole(ctx, p) {
  const util = u();
  const rec = roleRef(ctx.app, util.req(p, 'role'));
  if (rec.getString('code') === 'owner') throw util.fail(409, 'The Owner role cannot be changed.', 'invalid');
  const before = { name: rec.getString('name'), levels: levelsOfRole(rec), team_scope: rec.getBool('team_scope') };
  saveRole(ctx, p, rec);
  ctx.auditInfo = { collection: 'roles', record: rec.id, summary: 'Changed the role ' + rec.getString('name'), before: before, after: { name: rec.getString('name'), levels: levelsOfRole(rec), team_scope: rec.getBool('team_scope') } };
  return roleOut(ctx.app, rec);
}

function deleteRole(ctx, p) {
  const util = u();
  const rec = roleRef(ctx.app, util.req(p, 'role'));
  if (rec.getBool('system')) throw util.fail(409, 'Built-in roles cannot be deleted.', 'invalid');
  const n = util.count(ctx.app, 'SELECT COUNT(*) AS n FROM members WHERE role = {:r}', { r: rec.id });
  if (n > 0) throw util.fail(409, n + (n === 1 ? ' member has' : ' members have') + ' this role. Give them another role first.', 'in_use');
  ctx.app.delete(rec);
  ctx.auditInfo = { collection: 'roles', record: rec.id, summary: 'Deleted the role ' + rec.getString('name') };
  return { deleted: true };
}

module.exports = {
  MODULES: MODULES,
  LEVELS: LEVELS,
  MODULE_LABEL: MODULE_LABEL,
  rank: rank,
  isAgent: isAgent,
  context: context,
  contextFor: contextFor,
  systemCtx: systemCtx,
  withApp: withApp,
  checkPerm: checkPerm,
  handOff: handOff,
  level: level,
  can: can,
  need: need,
  scope: scope,
  inScope: inScope,
  selfEmployee: selfEmployee,
  isManagerOf: isManagerOf,
  levelsOfRole: levelsOfRole,
  me: me,
  dateFormat: dateFormat,
  DATE_STYLES: DATE_STYLES,
  getMe: getMe,
  login: login,
  logout: logout,
  refresh: refresh,
  acceptInvite: acceptInvite,
  changePassword: changePassword,
  updateProfile: updateProfile,
  recover: recover,
  normEmail: normEmail,
  checkEmail: checkEmail,
  checkPassword: checkPassword,
  memberByEmail: memberByEmail,
  hasPin: hasPin,
  storePin: storePin,
  verifyPin: verifyPin,
  checkPinFormat: checkPinFormat,
  pinStatus: pinStatus,
  pinVerify: pinVerify,
  pinSet: pinSet,
  pinChange: pinChange,
  pinReset: pinReset,
  pinRecover: pinRecover,
  recoveryNew: recoveryNew,
  issueRecovery: issueRecovery,
  memberRef: memberRef,
  memberOut: memberOut,
  listMembers: listMembers,
  getMember: getMember,
  invite: invite,
  updateMember: updateMember,
  disable: disable,
  enable: enable,
  resetMember: resetMember,
  signoutEverywhere: signoutEverywhere,
  deleteMember: deleteMember,
  roleRef: roleRef,
  roleByCode: roleByCode,
  roleOut: roleOut,
  listRoles: listRoles,
  addRole: addRole,
  updateRole: updateRole,
  deleteRole: deleteRole,
};
