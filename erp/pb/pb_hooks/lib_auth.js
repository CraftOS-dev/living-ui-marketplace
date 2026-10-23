/// <reference path="../pb_data/types.d.ts" />
/**
 * Who is calling, and what they may do.
 *
 * - People sign in with email and password (the `members` auth collection
 *   hashes passwords and signs tokens). The page sends the token as the
 *   standard Authorization header, so PocketBase loads it as e.auth.
 * - Your AI agent presents the app's agent token (X-A2App-Token, which the
 *   agent-app CLI sends and pages never see).
 * - A role gives a level per module (none < view < edit < full) and an
 *   administration right. Full means posting, voiding, approving and money.
 * - Your AI agent may read everything and draft anything; operations marked
 *   `agent: 'propose'` become proposals; it never administers members,
 *   roles or lock dates.
 */

const MODULES = ['sales', 'purchasing', 'inventory', 'manufacturing', 'accounting', 'banking', 'people', 'payroll', 'projects', 'reports'];
const LEVELS = ['none', 'view', 'edit', 'full'];
const MODULE_LABEL = {
  sales: 'Sales',
  purchasing: 'Purchasing',
  inventory: 'Inventory',
  manufacturing: 'Manufacturing',
  accounting: 'Accounting',
  banking: 'Banking',
  people: 'People',
  payroll: 'Payroll',
  projects: 'Projects',
  reports: 'Reports',
};
/** Modules that can be switched off in Settings (Reports always shows). */
const SWITCHABLE = ['sales', 'purchasing', 'inventory', 'manufacturing', 'accounting', 'banking', 'people', 'payroll', 'projects'];

const MAX_FAILS = 10;
const LOCK_MINUTES = 15;
const INVITE_DAYS = 7;
const SEEN_EVERY_MS = 5 * 60 * 1000;

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function rank(level) {
  const i = LEVELS.indexOf(level);
  return i < 0 ? 0 : i;
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

/** The signed-in member behind this request, or null. */
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
  const raw = role ? u().jsonOf(role, 'levels') || {} : {};
  for (const m of MODULES) out[m] = LEVELS.indexOf(raw[m]) >= 0 ? raw[m] : 'none';
  return out;
}

/** The context every handler receives. */
function context(e, spec) {
  const util = u();
  const app = e.app;
  const ctx = {
    e: e,
    app: app,
    op: spec.name,
    actor: null,
    isAgent: false,
    member: null,
    memberId: '',
    name: '',
    role: null,
    roleKey: '',
    levels: {},
    admin: false,
    approvalLimit: 0,
    employeeId: '',
    approving: null,
  };
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
  if (spec.perm === 'public') return ctx;
  if (ctx.actor === null) throw util.fail(401, 'Sign in first.', 'session_required');
  checkPerm(ctx, spec, null);
  return ctx;
}

function fillMember(ctx, app, m) {
  const role = u().byId(app, 'roles', m.getString('role'));
  ctx.actor = 'person';
  ctx.member = m;
  ctx.memberId = m.id;
  ctx.name = m.getString('name');
  ctx.role = role;
  ctx.roleKey = role ? role.getString('key') : '';
  ctx.levels = levelsOfRole(role);
  ctx.admin = role ? role.getBool('admin') : false;
  ctx.approvalLimit = role ? role.getInt('approval_limit') : 0;
  ctx.employeeId = m.getString('employee');
}

/** A context for a member outside a request (approving stored work). */
function contextFor(app, member) {
  const ctx = { e: null, app: app, op: '', actor: null, isAgent: false, member: null, memberId: '', name: '', role: null, roleKey: '', levels: {}, admin: false, approvalLimit: 0, employeeId: '', approving: null };
  fillMember(ctx, app, member);
  return ctx;
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

function can(ctx, module, need) {
  return rank(level(ctx, module)) >= rank(need);
}

/** Module enabled in Settings? (Reports always is.) */
function moduleOn(app, module) {
  if (SWITCHABLE.indexOf(module) < 0) return true;
  const s = require(`${__hooks}/lib_core.js`).settings(app);
  const mods = u().jsonOf(s, 'modules') || {};
  return mods[module] !== false;
}

/** Throw unless ctx has `need` on `module` (and the module is on). */
function need(ctx, module, needLevel, what) {
  const util = u();
  if (!moduleOn(ctx.app, module)) throw util.fail(403, MODULE_LABEL[module] + ' is switched off in Settings.', 'module_off', { module: module });
  if (can(ctx, module, needLevel)) return;
  throw util.fail(
    403,
    (ctx.isAgent ? 'Your AI agent' : 'Your role') + ' cannot ' + (what || needLevel + ' ' + MODULE_LABEL[module].toLowerCase()) + ' (needs ' + needLevel + ' access to ' + MODULE_LABEL[module] + ').',
    'not_permitted',
    { module: module, level: needLevel },
  );
}

/** Highest level among modules. */
function best(ctx, modules) {
  let top = 'none';
  for (const m of modules) {
    if (!moduleOn(ctx.app, m)) continue;
    if (rank(level(ctx, m)) > rank(top)) top = level(ctx, m);
  }
  return top;
}

const DOC_MODULES = {
  quote: ['sales'],
  sales_order: ['sales'],
  delivery: ['sales', 'inventory'],
  invoice: ['sales'],
  credit_note: ['sales'],
  purchase_order: ['purchasing'],
  goods_receipt: ['purchasing', 'inventory'],
  bill: ['purchasing'],
  supplier_credit: ['purchasing'],
};

/** Throw unless ctx may act at `needLevel` on documents of `type`. */
function needDoc(ctx, type, needLevel) {
  const mods = DOC_MODULES[type];
  if (mods === undefined) throw u().fail(400, 'Unknown document type ' + type, 'invalid_param');
  if (rank(best(ctx, mods)) >= rank(needLevel)) return;
  if (!mods.some((m) => moduleOn(ctx.app, m))) throw u().fail(403, MODULE_LABEL[mods[0]] + ' is switched off in Settings.', 'module_off');
  throw u().fail(403, (ctx.isAgent ? 'Your AI agent' : 'Your role') + ' cannot ' + needLevel + ' these documents (needs ' + needLevel + ' access to ' + mods.map((m) => MODULE_LABEL[m]).join(' or ') + ').', 'not_permitted', { level: needLevel });
}

function needPay(ctx, direction, needLevel) {
  const mods = ['banking', direction === 'in' ? 'sales' : 'purchasing'];
  if (rank(best(ctx, mods)) >= rank(needLevel)) return;
  throw u().fail(403, (ctx.isAgent ? 'Your AI agent' : 'Your role') + ' cannot ' + needLevel + ' payments (needs ' + needLevel + ' access to Banking or ' + MODULE_LABEL[mods[1]] + ').', 'not_permitted', { level: needLevel });
}

function needAdmin(ctx, what) {
  if (ctx.isAgent) throw u().fail(403, 'Your AI agent cannot ' + (what || 'change administration settings') + '. A person with the administration right does this.', 'agent_not_permitted');
  if (!ctx.admin) throw u().fail(403, 'Only an administrator can ' + (what || 'do this') + '.', 'not_permitted');
}

function isOwner(ctx) {
  return ctx.roleKey === 'owner';
}

/** The catalog's declared permission, checked before the handler runs. */
function checkPerm(ctx, spec, params) {
  const util = u();
  const perm = spec.perm || 'self';
  if (perm === 'public' || perm === 'self') {
    if (ctx.isAgent && spec.agent === 'deny') throw util.fail(403, 'Your AI agent cannot run ' + spec.name + ': a person does this in the app. Tell them what to do (which record, dates or amounts).', 'agent_not_permitted');
    return;
  }
  if (perm === 'admin') {
    needAdmin(ctx, spec.what);
    return;
  }
  // "a:full|b:full": any one of the rights is enough.
  if (perm.indexOf('|') >= 0) {
    const alts = perm.split('|');
    let last = null;
    for (const alt of alts) {
      try {
        checkPerm(ctx, Object.assign({}, spec, { perm: alt }), params);
        return;
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }
  const parts = perm.split(':');
  const scope = parts[0];
  const lvl = parts[1] || 'view';
  if (ctx.isAgent) {
    if (spec.agent === 'deny') throw util.fail(403, 'Your AI agent cannot run ' + spec.name + ': a person does this in the app. Tell them what to do (which record, dates or amounts).', 'agent_not_permitted');
    if (lvl === 'full' && spec.agent !== 'propose' && spec.agent !== 'allow') {
      throw util.fail(403, 'Your AI agent cannot run ' + spec.name + ' itself: a person with full rights does this in the app. Tell them what to do (which record, dates or amounts).', 'agent_not_permitted');
    }
  }
  if (scope === 'doc' || scope === 'pay') return; // resolved by the handler (needs the record's type)
  need(ctx, scope, lvl);
}

/* -------------------------------------------------------------- me */

function me(ctx) {
  const core = require(`${__hooks}/lib_core.js`);
  const s = core.settings(ctx.app);
  const company = {
    name: s.getString('company_name'),
    currency: s.getString('base_currency'),
    country: s.getString('country'),
    setup_done: s.getBool('setup_done'),
    fiscal_start_month: s.getInt('fiscal_start_month'),
    prices_include_tax: s.getBool('prices_include_tax'),
    logo: s.getString('logo') !== '',
  };
  const modules = u().jsonOf(s, 'modules') || {};
  const mods = {};
  for (const m of SWITCHABLE) mods[m] = modules[m] !== false;
  mods.reports = true;
  if (ctx.isAgent) return { actor: 'agent', company: company, modules: mods, levels: ctx.levels, today: u().today() };
  const m = ctx.member;
  let employee = null;
  if (ctx.employeeId !== '') {
    const emp = u().byId(ctx.app, 'employees', ctx.employeeId);
    if (emp !== null) employee = { id: emp.id, name: emp.getString('name'), number: emp.getString('number'), job_title: emp.getString('job_title'), department: emp.getString('department') };
  }
  const reports = u().one(ctx.app, 'SELECT COUNT(id) AS n FROM employees WHERE manager = {:e} AND status != \'left\'', { n: 0 }, { e: ctx.employeeId === '' ? '-' : ctx.employeeId });
  return {
    actor: 'person',
    member: {
      id: m.id,
      name: m.getString('name'),
      email: m.getString('email'),
      title: m.getString('title'),
      prefs: u().jsonOf(m, 'prefs') || {},
    },
    role: ctx.role ? { id: ctx.role.id, name: ctx.role.getString('name'), key: ctx.roleKey } : null,
    levels: ctx.levels,
    admin: ctx.admin,
    owner: isOwner(ctx),
    approval_limit: ctx.approvalLimit,
    employee: employee,
    manages: reports ? reports.n : 0,
    company: company,
    modules: mods,
    today: u().today(),
  };
}

/* ------------------------------------------------------------ sign in */

function normEmail(v) {
  return String(v || '').trim().toLowerCase();
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

function login(ctx, p) {
  const util = u();
  const app = ctx.app;
  const email = normEmail(util.req(p, 'email'));
  const password = util.str(p, 'password', '');
  const m = memberByEmail(app, email);
  // One answer whether the email is unknown, invited but not set up, or the password is wrong:
  // sign-in never tells a stranger which addresses have accounts.
  const wrong = () => util.fail(401, 'That email and password do not match. New to the team? Use "I have an invite code".', 'wrong_password');
  if (m === null) throw wrong();
  const status = m.getString('status');
  if (status === 'invited') throw wrong();
  const until = Date.parse(m.getString('locked_until'));
  if (!Number.isNaN(until) && until > Date.now()) {
    const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    throw util.fail(423, 'Too many wrong passwords. Try again in ' + mins + (mins === 1 ? ' minute.' : ' minutes.'), 'locked');
  }
  if (!m.validatePassword(password)) {
    const fails = m.getInt('failed_logins') + 1;
    if (fails >= MAX_FAILS) {
      m.set('failed_logins', 0);
      m.set('locked_until', new Date(Date.now() + LOCK_MINUTES * 60000).toISOString());
    } else m.set('failed_logins', fails);
    app.save(m);
    require(`${__hooks}/lib_audit.js`).write(app, { actor: 'person', member: m.id }, { kind: 'login_failed', entity: 'members', ref: m.id, label: email, summary: 'Wrong password for ' + email });
    throw wrong();
  }
  // Only someone who knows the password learns the account is switched off.
  if (status === 'disabled') throw util.fail(403, 'This account is disabled. Ask an administrator.', 'account_disabled');
  m.set('failed_logins', 0);
  m.set('locked_until', '');
  m.set('last_seen', util.nowIso());
  app.save(m);
  require(`${__hooks}/lib_audit.js`).write(app, { actor: 'person', member: m.id }, { kind: 'login', entity: 'members', ref: m.id, label: email, summary: m.getString('name') + ' signed in' });
  const c = contextFor(app, m);
  return { token: m.newAuthToken(), me: me(c) };
}

function logout(ctx) {
  if (ctx.member !== null) require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'logout', entity: 'members', ref: ctx.memberId, label: ctx.name, summary: ctx.name + ' signed out' });
  return { ok: true };
}

function getMe(ctx) {
  return me(ctx);
}

function refresh(ctx) {
  if (ctx.member === null) throw u().fail(400, 'Only a signed-in person has a session to refresh.', 'invalid');
  return { token: ctx.member.newAuthToken(), me: me(ctx) };
}

function acceptInvite(ctx, p) {
  const util = u();
  const app = ctx.app;
  const email = normEmail(util.req(p, 'email'));
  const code = String(util.req(p, 'code')).replace(/[\s-]/g, '').toUpperCase();
  const password = util.str(p, 'password', '');
  checkPassword(password);
  const m = memberByEmail(app, email);
  const bad = () => util.fail(400, 'That email and invite code do not match, or the code has expired. Ask your administrator for a new one.', 'bad_invite');
  if (m === null || m.getString('status') === 'disabled') throw bad();
  const hash = m.getString('invite_hash');
  const exp = Date.parse(m.getString('invite_expires'));
  if (hash === '' || Number.isNaN(exp) || exp < Date.now() || !$security.equal(util.sha(code), hash)) {
    const fails = m.getInt('failed_logins') + 1;
    m.set('failed_logins', fails >= MAX_FAILS ? 0 : fails);
    if (fails >= MAX_FAILS) {
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
  m.set('failed_logins', 0);
  m.set('locked_until', '');
  m.set('last_seen', util.nowIso());
  app.save(m);
  require(`${__hooks}/lib_audit.js`).write(app, { actor: 'person', member: m.id }, { kind: 'member', entity: 'members', ref: m.id, label: email, summary: m.getString('name') + ' joined' });
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
  require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'member', entity: 'members', ref: m.id, label: m.getString('email'), summary: 'Changed their password' });
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
    const cur = util.jsonOf(m, 'prefs') || {};
    for (const k of Object.keys(prefs)) cur[k] = prefs[k];
    const s = JSON.stringify(cur);
    if (s.length > 3500) throw util.fail(400, 'Too many preferences.', 'invalid_param');
    m.set('prefs', cur);
  }
  ctx.app.save(m);
  return me(contextFor(ctx.app, m));
}

/* ------------------------------------------------------------ members */

function memberOut(app, m) {
  const role = u().byId(app, 'roles', m.getString('role'));
  const emp = u().byId(app, 'employees', m.getString('employee'));
  return {
    id: m.id,
    name: m.getString('name'),
    email: m.getString('email'),
    title: m.getString('title'),
    status: m.getString('status'),
    role: role ? { id: role.id, name: role.getString('name'), key: role.getString('key') } : null,
    employee: emp ? { id: emp.id, name: emp.getString('name'), number: emp.getString('number') } : null,
    last_seen: m.getString('last_seen'),
    invite_expires: m.getString('invite_expires'),
    locked: (() => {
      const t = Date.parse(m.getString('locked_until'));
      return !Number.isNaN(t) && t > Date.now();
    })(),
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
    where.push('(name LIKE {:q} ESCAPE \'\\\' OR email LIKE {:q} ESCAPE \'\\\')');
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
    bind.r = require(`${__hooks}/lib_core.js`).resolve(app, 'roles', role).id;
  }
  const total = util.one(app, 'SELECT COUNT(id) AS n FROM members WHERE ' + where.join(' AND '), { n: 0 }, bind).n;
  const ids = util.rows(app, 'SELECT id FROM members WHERE ' + where.join(' AND ') + ' ORDER BY status = \'disabled\', name COLLATE NOCASE LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const counts = {};
  for (const r of util.rows(app, 'SELECT status, COUNT(id) AS n FROM members GROUP BY status', { status: '', n: 0 })) counts[r.status] = r.n;
  return { members: ids.map((r) => memberOut(app, app.findRecordById('members', r.id))), total: total, counts: counts };
}

function getMember(ctx, p) {
  const m = require(`${__hooks}/lib_core.js`).resolve(ctx.app, 'members', u().req(p, 'member'));
  return memberOut(ctx.app, m);
}

/** An invite code: 10 characters without look-alikes, shown as XXXXX-XXXXX. */
function newCode() {
  const raw = $security.randomStringWithAlphabet(10, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  return raw.slice(0, 5) + '-' + raw.slice(5);
}

function setCode(m) {
  const code = newCode();
  m.set('invite_hash', u().sha(code.replace('-', '')));
  m.set('invite_expires', new Date(Date.now() + INVITE_DAYS * 86400000).toISOString());
  return code;
}

function roleParam(ctx, p, name) {
  const role = require(`${__hooks}/lib_core.js`).resolve(ctx.app, 'roles', u().req(p, name, 'Accountant'));
  if (role.getString('key') === 'owner' && !isOwner(ctx)) throw u().fail(403, 'Only an owner can give someone the Owner role.', 'not_permitted');
  return role;
}

function invite(ctx, p) {
  const util = u();
  needAdmin(ctx, 'invite members');
  const app = ctx.app;
  const email = normEmail(util.req(p, 'email', 'sam@example.com'));
  checkEmail(email);
  if (memberByEmail(app, email) !== null) throw util.fail(409, email + ' is already a member.', 'duplicate');
  const name = util.squash(util.text(p, 'name', 120, ''));
  if (name === '') throw util.fail(400, 'name is required', 'missing_param');
  const role = roleParam(ctx, p, 'role');
  const m = util.newRecord(app, 'members');
  m.set('email', email);
  m.set('name', name);
  m.set('title', util.text(p, 'title', 120, ''));
  m.set('role', role.id);
  m.set('status', 'invited');
  m.setPassword(util.token(40));
  const code = setCode(m);
  let emp = null;
  const empRef = util.str(p, 'employee', '');
  if (empRef !== '') emp = require(`${__hooks}/lib_core.js`).resolve(app, 'employees', empRef);
  app.runInTransaction((tx) => {
    if (emp !== null) {
      const taken = util.findOne(tx, 'members', 'employee = {:e}', { e: emp.id });
      if (taken !== null) throw util.fail(409, emp.getString('name') + ' is already linked to ' + taken.getString('email') + '.', 'duplicate');
      m.set('employee', emp.id);
    }
    tx.save(m);
    if (emp !== null) {
      const e2 = tx.findRecordById('employees', emp.id);
      e2.set('member', m.id);
      tx.save(e2);
    }
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'member', entity: 'members', ref: m.id, label: email, summary: 'Invited ' + name + ' as ' + role.getString('name') });
  });
  return { member: memberOut(app, m), code: code, expires: m.getString('invite_expires') };
}

function guardOwner(ctx, m) {
  const role = u().byId(ctx.app, 'roles', m.getString('role'));
  if (role && role.getString('key') === 'owner' && !isOwner(ctx)) throw u().fail(403, 'Only an owner can change an owner.', 'not_permitted');
}

/** Keep one active owner, whatever changes. */
function ownersLeft(app, exceptId) {
  const owner = require(`${__hooks}/lib_core.js`).roleByKey(app, 'owner');
  return u().one(app, "SELECT COUNT(id) AS n FROM members WHERE role = {:r} AND status = 'active' AND id != {:x}", { n: 0 }, { r: owner.id, x: exceptId }).n;
}

function updateMember(ctx, p) {
  const util = u();
  needAdmin(ctx, 'change members');
  const app = ctx.app;
  const core = require(`${__hooks}/lib_core.js`);
  const m = core.resolve(app, 'members', util.req(p, 'member'));
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
    const role = roleParam(ctx, p, 'role');
    const owner = core.roleByKey(app, 'owner');
    if (m.getString('role') === owner.id && role.id !== owner.id && ownersLeft(app, m.id) === 0) throw util.fail(409, 'Keep at least one active owner: give someone else the Owner role first.', 'last_owner');
    m.set('role', role.id);
    changes.push('role');
  }
  app.runInTransaction((tx) => {
    if (util.has(p, 'employee')) {
      const ref = util.str(p, 'employee', '');
      const prev = m.getString('employee');
      if (prev !== '') {
        const old = util.byId(tx, 'employees', prev);
        if (old !== null) {
          old.set('member', '');
          tx.save(old);
        }
      }
      if (ref === '') m.set('employee', '');
      else {
        const emp = core.resolve(tx, 'employees', ref);
        const taken = util.findOne(tx, 'members', 'employee = {:e} && id != {:m}', { e: emp.id, m: m.id });
        if (taken !== null) throw util.fail(409, emp.getString('name') + ' is already linked to ' + taken.getString('email') + '.', 'duplicate');
        m.set('employee', emp.id);
        const e2 = tx.findRecordById('employees', emp.id);
        e2.set('member', m.id);
        tx.save(e2);
      }
      changes.push('employee');
    }
    tx.save(m);
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'member', entity: 'members', ref: m.id, label: m.getString('email'), summary: 'Changed ' + changes.join(', ') + ' of ' + m.getString('name') });
  });
  return memberOut(app, app.findRecordById('members', m.id));
}

function setActive(ctx, p, active) {
  const util = u();
  needAdmin(ctx, active ? 'enable members' : 'disable members');
  const app = ctx.app;
  const m = require(`${__hooks}/lib_core.js`).resolve(app, 'members', util.req(p, 'member'));
  guardOwner(ctx, m);
  if (m.id === ctx.memberId && !active) throw util.fail(409, 'You cannot disable yourself.', 'invalid');
  if (!active) {
    const owner = require(`${__hooks}/lib_core.js`).roleByKey(app, 'owner');
    if (m.getString('role') === owner.id && ownersLeft(app, m.id) === 0) throw util.fail(409, 'Keep at least one active owner.', 'last_owner');
    m.set('status', 'disabled');
    m.refreshTokenKey();
  } else {
    m.set('status', m.getString('invite_hash') !== '' ? 'invited' : 'active');
  }
  app.save(m);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'member', entity: 'members', ref: m.id, label: m.getString('email'), summary: (active ? 'Enabled ' : 'Disabled ') + m.getString('name') });
  return memberOut(app, m);
}

function disable(ctx, p) {
  return setActive(ctx, p, false);
}

function enable(ctx, p) {
  return setActive(ctx, p, true);
}

/** A new code: for an invite that expired, or a forgotten password. */
function resetMember(ctx, p) {
  const util = u();
  needAdmin(ctx, 'reset passwords');
  const app = ctx.app;
  const m = require(`${__hooks}/lib_core.js`).resolve(app, 'members', util.req(p, 'member'));
  guardOwner(ctx, m);
  if (m.getString('status') === 'disabled') throw util.fail(409, 'Enable the member first.', 'invalid');
  const code = setCode(m);
  m.set('failed_logins', 0);
  m.set('locked_until', '');
  if (m.getString('status') === 'active') {
    // Their old password keeps working until they use the code; sign them out everywhere.
    m.refreshTokenKey();
  }
  app.save(m);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'member', entity: 'members', ref: m.id, label: m.getString('email'), summary: 'New sign-in code for ' + m.getString('name') });
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
    needAdmin(ctx, 'sign others out');
    m = require(`${__hooks}/lib_core.js`).resolve(app, 'members', ref);
    guardOwner(ctx, m);
  }
  m.refreshTokenKey();
  app.save(m);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'member', entity: 'members', ref: m.id, label: m.getString('email'), summary: 'Signed ' + m.getString('name') + ' out everywhere' });
  return { ok: true, token: m.id === ctx.memberId ? m.newAuthToken() : '' };
}

function deleteMember(ctx, p) {
  const util = u();
  needAdmin(ctx, 'remove members');
  const app = ctx.app;
  const m = require(`${__hooks}/lib_core.js`).resolve(app, 'members', util.req(p, 'member'));
  guardOwner(ctx, m);
  if (m.getString('status') !== 'invited' || m.getString('last_seen') !== '') {
    throw util.fail(409, m.getString('name') + ' has used the app; disable the account instead so their history keeps its name.', 'has_history');
  }
  if (util.bool(p, 'preview', false)) return { preview: true, name: m.getString('name') };
  app.runInTransaction((tx) => {
    const emp = util.findOne(tx, 'employees', 'member = {:m}', { m: m.id });
    if (emp !== null) {
      emp.set('member', '');
      tx.save(emp);
    }
    tx.delete(tx.findRecordById('members', m.id));
    require(`${__hooks}/lib_audit.js`).write(tx, ctx, { kind: 'member', entity: 'members', ref: m.id, label: m.getString('email'), summary: 'Removed the invite for ' + m.getString('name') });
  });
  return { deleted: true };
}

/* -------------------------------------------------------------- roles */

function roleOut(app, r) {
  const n = u().one(app, 'SELECT COUNT(id) AS n FROM members WHERE role = {:r} AND status != \'disabled\'', { n: 0 }, { r: r.id }).n;
  return {
    id: r.id,
    name: r.getString('name'),
    key: r.getString('key'),
    levels: levelsOfRole(r),
    admin: r.getBool('admin'),
    approval_limit: r.getInt('approval_limit'),
    description: r.getString('description'),
    system: r.getBool('system'),
    members: n,
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
  const out = {};
  for (const m of MODULES) {
    const v = raw[m] === undefined ? 'none' : String(raw[m]);
    if (LEVELS.indexOf(v) < 0) throw util.fail(400, 'levels.' + m + ' must be one of: ' + LEVELS.join(', '), 'invalid_param');
    out[m] = v;
  }
  for (const k of Object.keys(raw)) if (MODULES.indexOf(k) < 0) throw util.fail(400, 'Unknown module "' + k + '" in levels. Modules: ' + MODULES.join(', '), 'invalid_param');
  return out;
}

function saveRole(ctx, p, rec) {
  const util = u();
  const app = ctx.app;
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 60, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty', 'invalid_param');
    if (util.idsNocaseFind(app, 'roles', 'name', n, rec.id || '')) throw util.fail(409, 'There is already a role called ' + n + '.', 'duplicate');
    rec.set('name', n);
  }
  const lv = readLevels(p);
  if (lv !== undefined) rec.set('levels', lv);
  if (util.has(p, 'admin')) rec.set('admin', util.bool(p, 'admin', false));
  if (util.has(p, 'description')) rec.set('description', util.text(p, 'description', 300, ''));
  if (util.has(p, 'approval_limit')) {
    const cur = require(`${__hooks}/lib_core.js`).currency(app);
    rec.set('approval_limit', util.money(p, 'approval_limit', cur) || 0);
  }
  app.save(rec);
  return rec;
}

function addRole(ctx, p) {
  needAdmin(ctx, 'change roles');
  const util = u();
  const rec = util.newRecord(ctx.app, 'roles');
  rec.set('key', '');
  rec.set('system', false);
  rec.set('levels', readLevels({ levels: '{}' }));
  rec.set('sort', 100);
  util.req(p, 'name', 'Supervisor');
  saveRole(ctx, p, rec);
  require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'role', entity: 'roles', ref: rec.id, label: rec.getString('name'), summary: 'Added the role ' + rec.getString('name'), data: { levels: levelsOfRole(rec) } });
  return roleOut(ctx.app, rec);
}

function updateRole(ctx, p) {
  needAdmin(ctx, 'change roles');
  const util = u();
  const rec = require(`${__hooks}/lib_core.js`).resolve(ctx.app, 'roles', util.req(p, 'role'));
  if (rec.getString('key') === 'owner') throw util.fail(409, 'The Owner role cannot be changed.', 'invalid');
  if (rec.getString('key') === 'admin' && !isOwner(ctx)) throw util.fail(403, 'Only an owner can change the Administrator role.', 'not_permitted');
  saveRole(ctx, p, rec);
  require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'role', entity: 'roles', ref: rec.id, label: rec.getString('name'), summary: 'Changed the role ' + rec.getString('name'), data: { levels: levelsOfRole(rec), admin: rec.getBool('admin') } });
  return roleOut(ctx.app, rec);
}

function deleteRole(ctx, p) {
  needAdmin(ctx, 'change roles');
  const util = u();
  const rec = require(`${__hooks}/lib_core.js`).resolve(ctx.app, 'roles', util.req(p, 'role'));
  if (rec.getBool('system')) throw util.fail(409, 'Built-in roles cannot be deleted.', 'invalid');
  const n = util.one(ctx.app, 'SELECT COUNT(id) AS n FROM members WHERE role = {:r}', { n: 0 }, { r: rec.id }).n;
  if (n > 0) throw util.fail(409, n + (n === 1 ? ' member has' : ' members have') + ' this role. Give them another role first.', 'in_use');
  if (util.bool(p, 'preview', false)) return { preview: true };
  ctx.app.delete(rec);
  require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'role', entity: 'roles', ref: rec.id, label: rec.getString('name'), summary: 'Deleted the role ' + rec.getString('name') });
  return { deleted: true };
}

module.exports = {
  MODULES: MODULES,
  LEVELS: LEVELS,
  MODULE_LABEL: MODULE_LABEL,
  SWITCHABLE: SWITCHABLE,
  rank: rank,
  isAgent: isAgent,
  context: context,
  contextFor: contextFor,
  checkPerm: checkPerm,
  level: level,
  can: can,
  need: need,
  needDoc: needDoc,
  needPay: needPay,
  needAdmin: needAdmin,
  best: best,
  moduleOn: moduleOn,
  isOwner: isOwner,
  levelsOfRole: levelsOfRole,
  me: me,
  getMe: getMe,
  login: login,
  logout: logout,
  refresh: refresh,
  acceptInvite: acceptInvite,
  changePassword: changePassword,
  updateProfile: updateProfile,
  checkEmail: checkEmail,
  checkPassword: checkPassword,
  normEmail: normEmail,
  listMembers: listMembers,
  getMember: getMember,
  invite: invite,
  updateMember: updateMember,
  disable: disable,
  enable: enable,
  resetMember: resetMember,
  signoutEverywhere: signoutEverywhere,
  deleteMember: deleteMember,
  memberOut: memberOut,
  listRoles: listRoles,
  addRole: addRole,
  updateRole: updateRole,
  deleteRole: deleteRole,
};
