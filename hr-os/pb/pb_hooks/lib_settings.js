/// <reference path="../pb_data/types.d.ts" />
/**
 * The one settings row (company name, reporting currency, date style, your
 * AI agent's autonomy per proposal kind, the Automatic work switches (what
 * may ask your AI agent without a click; all off by default), pay
 * visibility switches, email,
 * payslip publication hour, sign-in limits) and the first-run setup.
 */

const KINDS = ['people', 'time', 'leave', 'expenses', 'payroll', 'hiring', 'performance', 'packs'];
const DATE_STYLES = ['entity', 'iso', 'dmy', 'mdy', 'ymd'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** The settings record (created by the kernel migration). */
function row(app) {
  return app.findRecordsByFilter('settings', '1=1', 'created', 1, 0)[0];
}

/** The logo files as versions for image URLs ('' when none): the stored name changes with every upload. */
function logos(s) {
  return { logo: s.getString('logo'), logo_dark: s.getString('logo_dark') };
}

function view(app, s) {
  const u = L('lib_util');
  return {
    company_name: s.getString('company_name'),
    reporting_currency: s.getString('reporting_currency'),
    date_style: s.getString('date_style'),
    autonomy: autonomyOf(s),
    automatic: L('lib_agent').automaticOf(s),
    agent_sees_pay: s.getBool('agent_sees_pay'),
    managers_see_pay: s.getBool('managers_see_pay'),
    email_notifications: s.getBool('email_notifications'),
    payslip_publish_hour: s.getInt('payslip_publish_hour'),
    rate_limits: u.jsonOf(s, 'rate_limits', {}) || {},
    setup_done: s.getBool('setup_done'),
    logo: s.getString('logo'),
    logo_dark: s.getString('logo_dark'),
  };
}

function autonomyOf(s) {
  const raw = L('lib_util').jsonOf(s, 'autonomy', {}) || {};
  const out = {};
  for (const k of KINDS) out[k] = raw[k] === 'auto' ? 'auto' : 'ask';
  return out;
}

/** May your AI agent run a `propose` op of this kind directly? */
function autoAllowed(app, kind) {
  return autonomyOf(row(app))[kind] === 'auto';
}

function get(ctx) {
  return view(ctx.app, row(ctx.app));
}

function update(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const s = row(app);
  const before = view(app, s);
  if (u.has(p, 'company_name')) {
    const n = u.squash(u.text(p, 'company_name', 160, ''));
    if (n === '') throw u.fail(400, 'company_name cannot be empty', 'invalid_param');
    s.set('company_name', n);
  }
  if (u.has(p, 'reporting_currency')) {
    const c = u.str(p, 'reporting_currency', '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw u.fail(400, 'reporting_currency is a three-letter code such as USD.', 'invalid_param');
    s.set('reporting_currency', c);
  }
  if (u.has(p, 'date_style')) s.set('date_style', u.oneOf(p, 'date_style', DATE_STYLES, 'entity'));
  for (const k of ['agent_sees_pay', 'managers_see_pay', 'email_notifications']) if (u.has(p, k)) s.set(k, u.bool(p, k, false));
  if (u.has(p, 'payslip_publish_hour')) s.set('payslip_publish_hour', u.int(p, 'payslip_publish_hour', 9, 0, 23));
  if (u.has(p, 'rate_limits')) {
    const r = u.obj(p, 'rate_limits');
    const cur = u.jsonOf(s, 'rate_limits', {}) || {};
    const ranges = { login_fails: [3, 50], lock_minutes: [1, 1440], pin_fails: [3, 20], pin_lock_minutes: [1, 1440] };
    for (const k of Object.keys(r)) {
      if (ranges[k] === undefined) throw u.fail(400, 'rate_limits takes: ' + Object.keys(ranges).join(', '), 'invalid_param');
      const n = Number(r[k]);
      if (!Number.isInteger(n) || n < ranges[k][0] || n > ranges[k][1]) throw u.fail(400, 'rate_limits.' + k + ' must be a whole number from ' + ranges[k][0] + ' to ' + ranges[k][1], 'invalid_param');
      cur[k] = n;
    }
    s.set('rate_limits', cur);
  }
  app.save(s);
  const after = view(app, s);
  L('lib_audit').note(ctx, { collection: 'settings', record: s.id, summary: 'Changed company settings', before: before, after: after });
  return after;
}

function autonomy(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const s = row(app);
  const before = autonomyOf(s);
  const raw = u.obj(p, 'autonomy') || {};
  const cur = Object.assign({}, before);
  for (const k of Object.keys(raw)) {
    if (KINDS.indexOf(k) < 0) throw u.fail(400, 'Unknown kind "' + k + '". Kinds: ' + KINDS.join(', '), 'invalid_param');
    if (raw[k] !== 'ask' && raw[k] !== 'auto') throw u.fail(400, 'autonomy.' + k + ' must be ask or auto', 'invalid_param');
    cur[k] = raw[k];
  }
  s.set('autonomy', cur);
  app.save(s);
  L('lib_audit').note(ctx, { collection: 'settings', record: s.id, summary: "Changed your AI agent's autonomy", before: before, after: cur });
  return { autonomy: cur };
}

/** settings.automatic: switch Automatic work sources on or off ({"weekly_timesheet_check": true}). */
function automatic(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const s = row(app);
  const known = L('lib_agent').AUTOMATIC;
  const before = L('lib_agent').automaticOf(s);
  const raw = u.obj(p, 'automatic') || {};
  const cur = Object.assign({}, before);
  for (const k of Object.keys(raw)) {
    if (known[k] === undefined) throw u.fail(400, 'Unknown switch "' + k + '". Switches: ' + Object.keys(known).join(', '), 'invalid_param', { param: 'automatic' });
    if (typeof raw[k] !== 'boolean') throw u.fail(400, 'automatic.' + k + ' is true or false', 'invalid_param', { param: 'automatic' });
    cur[k] = raw[k];
  }
  s.set('automatic', cur);
  app.save(s);
  const changed = Object.keys(cur).filter((k) => cur[k] !== before[k]);
  L('lib_audit').note(ctx, { collection: 'settings', record: s.id, summary: changed.length === 0 ? 'Automatic work unchanged' : 'Automatic work: ' + changed.map((k) => known[k].label + (cur[k] ? ' on' : ' off')).join(', '), before: before, after: cur });
  return { automatic: cur };
}

/* -------------------------------------------------------------- setup */

/** Kernel setup steps, computed from the data. */
function progress(app) {
  const u = L('lib_util');
  const s = row(app);
  const n = (sql) => u.count(app, sql);
  const owner = L('lib_auth').roleByCode(app, 'owner');
  const ownerRow = owner ? u.one(app, "SELECT id FROM members WHERE role = {:r} AND status = 'active' ORDER BY created LIMIT 1", { id: '' }, { r: owner.id }) : null;
  const steps = [
    { key: 'company', label: 'Company and first entity', done: s.getBool('setup_done') && n('SELECT COUNT(*) AS n FROM entities') > 0, link: '#/settings/company' },
    { key: 'pin', label: 'Approval PIN', done: ownerRow !== null && L('lib_auth').hasPin(app, ownerRow.id), link: '#/settings/security' },
    { key: 'departments', label: 'Departments', done: n('SELECT COUNT(*) AS n FROM departments WHERE archived = FALSE') > 0, link: '#/settings/org' },
    { key: 'people', label: 'People', done: n('SELECT COUNT(*) AS n FROM employees WHERE archived = FALSE') > 0, link: '#/people' },
    { key: 'team', label: 'Invite your team', done: n('SELECT COUNT(*) AS n FROM members') > 1, link: '#/settings/members' },
  ];
  // Payroll: the first pay day in HR OS (what was paid earlier this tax year comes in as opening balances).
  const pay = L('lib_payroll');
  const waiting = u.findMany(app, 'entities', 'active = true', 'created', 0).filter((e) => {
    const rec = pay.settingsRec(app, e.id);
    return pay.startsUnknown(app, e, rec !== null ? pay.settingsView(app, rec, e) : { go_live_day: '', no_earlier_pay: false });
  });
  steps.push({ key: 'payroll_start', label: 'When HR OS starts paying', done: waiting.length === 0, link: waiting.length > 0 ? '#/payroll/openings?entity=' + waiting[0].id : '#/payroll/settings' });
  const done = steps.filter((x) => x.done).length;
  return { steps: steps, done: done, total: steps.length };
}

function setupStatus(ctx) {
  const u = L('lib_util');
  const app = ctx.app;
  const s = row(app);
  const members = u.count(app, 'SELECT COUNT(*) AS n FROM members');
  return Object.assign({ setup_done: s.getBool('setup_done'), needs_setup: members === 0, company_name: s.getString('company_name'), countries: L('lib_countries').list().length }, logos(s));
}

const LOGO_TYPES = /\.(png|jpe?g|svg|webp)$/i;
const LOGO_MAX = 1048576;

/**
 * The company logo, public (the sign-in screen shows it). --dark: the
 * dark-mode one; either falls back to the other when only one is set. Always an image file:
 * the app shows it in an <img>, and SVG goes out with a sandboxing CSP.
 */
function logo(ctx, p) {
  const u = L('lib_util');
  const s = row(ctx.app);
  // The one asked for, else the other: a company with one logo shows it in both themes.
  const field = (u.bool(p, 'dark', false) ? ['logo_dark', 'logo'] : ['logo', 'logo_dark']).find((f) => s.getString(f) !== '');
  if (field === undefined) throw u.fail(404, 'No logo yet.', 'not_found');
  return L('lib_files').serve(ctx, s, field, field === 'logo_dark' ? 'logo-dark' : 'logo', false);
}

/** Upload the logo (or, --dark true, the dark-mode one): PNG, JPEG, SVG or WebP, up to 1 MB. */
function logoSet(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const dark = u.bool(p, 'dark', false);
  const f = L('lib_files').fileParam(ctx, p, 'logo', 'path');
  if (f === null) throw u.fail(400, 'Upload the logo (PNG, JPEG, SVG or WebP, up to 1 MB) in the logo field.', 'missing_param', { param: 'logo' });
  if (!LOGO_TYPES.test(String(f.originalName || f.name || ''))) throw u.fail(400, 'The logo must be a PNG, JPEG, SVG or WebP image.', 'invalid_param', { param: 'logo' });
  if (Number(f.size || 0) > LOGO_MAX) throw u.fail(400, 'The logo can be up to 1 MB.', 'invalid_param', { param: 'logo' });
  const s = row(app);
  const field = dark ? 'logo_dark' : 'logo';
  s.set(field, f);
  app.save(s);
  L('lib_audit').note(ctx, { collection: 'settings', record: s.id, summary: dark ? 'New dark-mode logo' : 'New company logo' });
  return logos(app.findRecordById('settings', s.id));
}

/** Remove the logo (--dark true: the dark-mode one). */
function logoRemove(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const dark = u.bool(p, 'dark', false);
  const s = row(app);
  const field = dark ? 'logo_dark' : 'logo';
  if (s.getString(field) === '') return logos(s);
  s.set(field, '');
  app.save(s);
  L('lib_audit').note(ctx, { collection: 'settings', record: s.id, summary: dark ? 'Removed the dark-mode logo' : 'Removed the company logo' });
  return logos(s);
}

/**
 * First run: the company, the first entity and the owner (password and
 * approval PIN). Answers the owner's session and the recovery code, shown
 * once. Refused once anyone has an account.
 */
function setupComplete(ctx, p) {
  const u = L('lib_util');
  const auth = L('lib_auth');
  const app = ctx.app;
  if (u.count(app, 'SELECT COUNT(*) AS n FROM members') > 0) throw u.fail(409, 'HR OS is already set up. Sign in instead.', 'already_set_up');
  const company = u.squash(u.text(p, 'company_name', 160, ''));
  if (company === '') throw u.fail(400, 'company_name is required', 'missing_param', { param: 'company_name' });
  const email = auth.normEmail(u.req(p, 'email'));
  auth.checkEmail(email);
  const password = u.str(p, 'password', '');
  auth.checkPassword(password);
  const pin = auth.checkPinFormat(u.req(p, 'pin'));
  const ownerName = u.squash(u.text(p, 'owner_name', 120, ''));
  if (ownerName === '') throw u.fail(400, 'owner_name is required', 'missing_param', { param: 'owner_name' });
  const country = L('lib_countries').get(u.req(p, 'country', 'SG'));
  let member = null;
  let entity = null;
  let code = '';
  app.runInTransaction((tx) => {
    const s = row(tx);
    s.set('company_name', company);
    s.set('reporting_currency', (u.str(p, 'reporting_currency', '') || u.str(p, 'currency', '') || country.currency).toUpperCase());
    s.set('setup_done', true);
    tx.save(s);
    const owner = auth.roleByCode(tx, 'owner');
    member = u.newRecord(tx, 'members');
    member.set('email', email);
    member.set('name', ownerName);
    member.set('role', owner.id);
    member.set('status', 'active');
    member.set('entities', []);
    member.set('last_seen', u.nowIso());
    member.setPassword(password);
    tx.save(member);
    auth.storePin(tx, member, pin);
    code = auth.issueRecovery(tx, tx.findRecordById('members', member.id));
    const octx = auth.withApp(auth.contextFor(tx, tx.findRecordById('members', member.id)), tx);
    entity = L('lib_org').createEntity(octx, {
      name: u.str(p, 'entity_name', '') || company,
      legal_name: u.str(p, 'legal_name', ''),
      country: country.code,
      region: u.str(p, 'region', ''),
      currency: u.str(p, 'currency', ''),
      timezone: u.str(p, 'timezone', ''),
    });
    L('lib_audit').write(octx, { op: 'setup.complete', collection: 'settings', record: s.id, summary: 'Set up ' + company + ' with ' + entity.name + ' (' + country.code + ')' });
  });
  ctx.audited = true;
  const m = app.findRecordById('members', member.id);
  const octx = auth.contextFor(app, m);
  L('lib_events').emit(octx, 'entity.created', { entity: entity.id, country: entity.country, region: entity.region });
  return { token: m.newAuthToken(), recovery_code: code, entity: entity, me: auth.me(octx) };
}

module.exports = { KINDS: KINDS, row: row, view: view, get: get, update: update, autonomy: autonomy, automatic: automatic, autonomyOf: autonomyOf, autoAllowed: autoAllowed, progress: progress, setupStatus: setupStatus, setupComplete: setupComplete, logos: logos, logo: logo, logoSet: logoSet, logoRemove: logoRemove };
