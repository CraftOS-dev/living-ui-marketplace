/// <reference path="../pb_data/types.d.ts" />
/**
 * The one settings row (firm name, base currency, zone, date style, your
 * AI agent's autonomy, the fund data switch, the policy switches that let
 * the app fire a trigger on its own (agent_policy, lib_agent.js: all off by
 * default), mail labels, retention, the modules' own settings,
 * display id sequences, sign-in limits) and the first-run setup.
 *
 * Module settings: each module declares defaults in its events_*.js
 * (`settingsKeys: { intake: { reply_sla_days: 5 } }`); settings.modules
 * keeps only what a person changed. module(app, key) answers the merged
 * object; settings.update --modules '{"intake":{"reply_sla_days":7}}'
 * changes known keys only, with the default's type.
 */

/** Proposal kinds the owner may promote from "ask" to "auto" (REPORT Table 38). Every other kind always asks. */
const PROMOTABLE = {
  note_fields: 'Field changes from notes (non-financial)',
  merges: 'Duplicate merges',
  asks: 'Founder asks found in updates',
  map_entries: 'Market map entries',
  stage_moves: 'Stage moves (only to Screen)',
};
const DATE_STYLES = ['iso', 'dmy', 'mdy', 'ymd'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/** The settings record (created by the kernel migration). */
function row(app) {
  return app.findRecordsByFilter('settings', '1=1', 'created', 1, 0)[0];
}

function autonomyOf(s) {
  const raw = L('lib_util').jsonOf(s, 'autonomy', {}) || {};
  const out = {};
  for (const k of Object.keys(PROMOTABLE)) out[k] = raw[k] === 'auto' ? 'auto' : 'ask';
  return out;
}

/** May your AI agent run a `propose` op of this kind directly? Only promotable kinds the owner set to auto. */
function autoAllowed(app, kind) {
  if (PROMOTABLE[kind] === undefined) return false;
  return autonomyOf(row(app))[kind] === 'auto';
}

/** Module settings: the defaults of every events_*.js settingsKeys, overlaid with what was changed. */
function modulesOf(s) {
  const u = L('lib_util');
  const defaults = L('lib_events').settingsDefaults();
  const stored = u.jsonOf(s, 'modules', {}) || {};
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = Object.assign({}, defaults[k], stored[k] || {});
  return out;
}

/** One module's merged settings object ({} when the key is unknown). */
function moduleOf(app, key) {
  return modulesOf(row(app))[key] || {};
}

function view(app, s) {
  const u = L('lib_util');
  return {
    firm_name: s.getString('firm_name'),
    logo_url: L('lib_logos').firmUrl(s),
    base_currency: s.getString('base_currency'),
    zone: s.getString('zone') || 'UTC',
    date_style: s.getString('date_style') || 'iso',
    week_start: s.getInt('week_start'),
    autonomy: autonomyOf(s),
    promotable: Object.keys(PROMOTABLE).map((k) => ({ kind: k, label: PROMOTABLE[k] })),
    agent_sees_fund_data: s.getBool('agent_sees_fund_data'),
    agent_policy: L('lib_agent').policyOf(u.jsonOf(s, 'agent_policy', {})),
    agent_triggers: L('lib_agent').triggersOut(app),
    agent_switches: Object.entries(L('lib_agent').switches()).map(([k, v]) => ({ key: k, label: v.label, tip: v.tip, triggers: v.triggers })),
    mail: Object.assign({ deals_label: 'Venture OS/Deals', updates_label: 'Venture OS/Updates' }, u.jsonOf(s, 'mail', {}) || {}),
    retention: Object.assign({ passed_deal_months: 12 }, u.jsonOf(s, 'retention', {}) || {}),
    modules: modulesOf(s),
    rate_limits: u.jsonOf(s, 'rate_limits', {}) || {},
    setup_done: s.getBool('setup_done'),
    zones: u.zoneNames(),
  };
}

function get(ctx) {
  return view(ctx.app, row(ctx.app));
}

function typeOf(v) {
  if (Array.isArray(v)) return 'list';
  if (v === null) return 'null';
  return typeof v;
}

function update(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const s = row(app);
  const before = view(app, s);
  if (u.has(p, 'firm_name')) {
    const n = u.squash(u.text(p, 'firm_name', 160, ''));
    if (n === '') throw u.fail(400, 'firm_name cannot be empty', 'invalid_param', { param: 'firm_name' });
    s.set('firm_name', n);
  }
  if (u.has(p, 'base_currency')) {
    const c = u.str(p, 'base_currency', '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw u.fail(400, 'base_currency is a three-letter code such as USD.', 'invalid_param', { param: 'base_currency' });
    s.set('base_currency', c);
  }
  if (u.has(p, 'zone')) {
    const z = u.str(p, 'zone', '');
    if (!u.isZone(z)) throw u.fail(400, 'zone must be one of: ' + u.zoneNames().join(', '), 'invalid_param', { param: 'zone' });
    s.set('zone', z);
  }
  if (u.has(p, 'date_style')) s.set('date_style', u.oneOf(p, 'date_style', DATE_STYLES, 'iso'));
  if (u.has(p, 'week_start')) s.set('week_start', u.int(p, 'week_start', 1, 0, 6));
  if (u.has(p, 'agent_sees_fund_data')) s.set('agent_sees_fund_data', u.bool(p, 'agent_sees_fund_data', true));
  if (u.has(p, 'agent_policy')) {
    // Each switch lets the app fire its triggers on its own (lib_agent.switches); everything else fires only when a person asks.
    const raw = u.obj(p, 'agent_policy') || {};
    const A = L('lib_agent');
    const known = A.switches();
    const cur = A.policyOf(u.jsonOf(s, 'agent_policy', {}));
    for (const k of Object.keys(raw)) {
      if (known[k] === undefined) throw u.fail(400, 'agent_policy takes: ' + Object.keys(known).join(', '), 'invalid_param', { param: 'agent_policy' });
      if (typeof raw[k] !== 'boolean') throw u.fail(400, 'agent_policy.' + k + ' is true or false.', 'invalid_param', { param: 'agent_policy' });
      cur[k] = raw[k];
    }
    s.set('agent_policy', cur);
  }
  if (u.has(p, 'mail')) {
    const m = u.obj(p, 'mail');
    const cur = Object.assign({ deals_label: 'Venture OS/Deals', updates_label: 'Venture OS/Updates' }, u.jsonOf(s, 'mail', {}) || {});
    for (const k of Object.keys(m)) {
      if (k === 'demo') {
        // A demo firm never touches the owner's Gmail (lib_mail.demo).
        if (typeof m[k] !== 'boolean') throw u.fail(400, 'mail.demo is true or false.', 'invalid_param', { param: 'mail' });
        cur.demo = m[k];
        continue;
      }
      if (['deals_label', 'updates_label'].indexOf(k) < 0) throw u.fail(400, 'mail takes: deals_label, updates_label, demo', 'invalid_param', { param: 'mail' });
      const v = u.squash(String(m[k] || ''));
      if (v === '' || v.length > 100) throw u.fail(400, 'mail.' + k + ' is a Gmail label name (1 to 100 characters).', 'invalid_param', { param: 'mail' });
      cur[k] = v;
    }
    s.set('mail', cur);
  }
  if (u.has(p, 'retention')) {
    const r = u.obj(p, 'retention');
    const cur = Object.assign({ passed_deal_months: 12 }, u.jsonOf(s, 'retention', {}) || {});
    for (const k of Object.keys(r)) {
      if (k !== 'passed_deal_months') throw u.fail(400, 'retention takes: passed_deal_months', 'invalid_param', { param: 'retention' });
      const n = Number(r[k]);
      if (!Number.isInteger(n) || n < 1 || n > 240) throw u.fail(400, 'retention.passed_deal_months is a whole number from 1 to 240.', 'invalid_param', { param: 'retention' });
      cur[k] = n;
    }
    s.set('retention', cur);
  }
  if (u.has(p, 'modules')) {
    const raw = u.obj(p, 'modules');
    const defaults = L('lib_events').settingsDefaults();
    const cur = u.jsonOf(s, 'modules', {}) || {};
    for (const key of Object.keys(raw)) {
      if (defaults[key] === undefined) throw u.fail(400, 'Unknown module settings "' + key + '". Keys: ' + Object.keys(defaults).join(', '), 'invalid_param', { param: 'modules' });
      const change = raw[key];
      if (change === null || typeof change !== 'object' || Array.isArray(change)) throw u.fail(400, 'modules.' + key + ' must be an object', 'invalid_param', { param: 'modules' });
      const next = Object.assign({}, cur[key] || {});
      for (const f of Object.keys(change)) {
        if (defaults[key][f] === undefined) throw u.fail(400, 'Unknown setting modules.' + key + '.' + f + '. It takes: ' + Object.keys(defaults[key]).join(', '), 'invalid_param', { param: 'modules' });
        if (typeOf(change[f]) !== typeOf(defaults[key][f])) throw u.fail(400, 'modules.' + key + '.' + f + ' must be a ' + typeOf(defaults[key][f]), 'invalid_param', { param: 'modules' });
        next[f] = change[f];
      }
      cur[key] = next;
    }
    s.set('modules', cur);
  }
  if (u.has(p, 'rate_limits')) {
    const r = u.obj(p, 'rate_limits');
    const cur = u.jsonOf(s, 'rate_limits', {}) || {};
    const ranges = { login_fails: [3, 50], lock_minutes: [1, 1440], pin_fails: [3, 20], pin_lock_minutes: [1, 1440] };
    for (const k of Object.keys(r)) {
      if (ranges[k] === undefined) throw u.fail(400, 'rate_limits takes: ' + Object.keys(ranges).join(', '), 'invalid_param', { param: 'rate_limits' });
      const n = Number(r[k]);
      if (!Number.isInteger(n) || n < ranges[k][0] || n > ranges[k][1]) throw u.fail(400, 'rate_limits.' + k + ' must be a whole number from ' + ranges[k][0] + ' to ' + ranges[k][1], 'invalid_param', { param: 'rate_limits' });
      cur[k] = n;
    }
    s.set('rate_limits', cur);
  }
  app.save(s);
  u.zoneReset();
  const after = view(app, s);
  L('lib_audit').note(ctx, { collection: 'settings', record: s.id, summary: 'Changed firm settings', before: before, after: after });
  return after;
}

/** settings.autonomy: promote a kind to auto or back to ask (REPORT Table 38 kinds only). */
function autonomy(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const s = row(app);
  const before = autonomyOf(s);
  const raw = u.obj(p, 'autonomy') || {};
  const cur = Object.assign({}, before);
  for (const k of Object.keys(raw)) {
    if (PROMOTABLE[k] === undefined) throw u.fail(400, 'Only these kinds can be promoted: ' + Object.keys(PROMOTABLE).join(', ') + '. Everything else always waits for a person.', 'invalid_param', { param: 'autonomy' });
    if (raw[k] !== 'ask' && raw[k] !== 'auto') throw u.fail(400, 'autonomy.' + k + ' must be ask or auto', 'invalid_param', { param: 'autonomy' });
    cur[k] = raw[k];
  }
  s.set('autonomy', cur);
  app.save(s);
  L('lib_audit').note(ctx, { collection: 'settings', record: s.id, summary: "Changed your AI agent's autonomy", before: before, after: cur });
  return { autonomy: cur };
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
    { key: 'firm', label: 'Firm', done: s.getBool('setup_done'), link: '#/settings/firm' },
    { key: 'fund', label: 'Fund', done: n("SELECT COUNT(*) AS n FROM entities WHERE kind = 'fund' AND archived = FALSE") > 0, link: '#/settings/funds' },
    { key: 'pin', label: 'PIN', done: ownerRow !== null && L('lib_auth').hasPin(app, ownerRow.id), link: '#/settings/security' },
    { key: 'team', label: 'Team', done: n('SELECT COUNT(*) AS n FROM members') > 1, link: '#/settings/members' },
  ];
  return { steps: steps, done: steps.filter((x) => x.done).length, total: steps.length };
}

function setupStatus(ctx) {
  const u = L('lib_util');
  const app = ctx.app;
  const s = row(app);
  const members = u.count(app, 'SELECT COUNT(*) AS n FROM members');
  return { setup_done: s.getBool('setup_done'), needs_setup: members === 0, firm_name: s.getString('firm_name'), zones: u.zoneNames(), base_currency: s.getString('base_currency') };
}

/**
 * First run (setup.complete): the firm (name, base currency, zone), the
 * management company, the first fund (name, size, vintage, currency) and
 * the owner (password and approval PIN). Answers the owner's session and
 * the recovery code, shown once. Refused once anyone has an account.
 */
function setupComplete(ctx, p) {
  const u = L('lib_util');
  const auth = L('lib_auth');
  const ents = L('lib_entities');
  const app = ctx.app;
  if (u.count(app, 'SELECT COUNT(*) AS n FROM members') > 0) throw u.fail(409, 'Venture OS is already set up. Sign in instead.', 'already_set_up');
  const firm = u.squash(u.text(p, 'firm_name', 160, ''));
  if (firm === '') throw u.fail(400, 'firm_name is required', 'missing_param', { param: 'firm_name' });
  const base = u.req(p, 'base_currency', 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) throw u.fail(400, 'base_currency is a three-letter code such as USD.', 'invalid_param', { param: 'base_currency' });
  const zone = u.str(p, 'zone', '') || 'UTC';
  if (!u.isZone(zone)) throw u.fail(400, 'zone must be one of: ' + u.zoneNames().join(', '), 'invalid_param', { param: 'zone' });
  const fundName = u.squash(u.text(p, 'fund_name', 160, ''));
  if (fundName === '') throw u.fail(400, 'fund_name is required (your first fund, e.g. "Fund I")', 'missing_param', { param: 'fund_name' });
  const fundCurrency = (u.str(p, 'fund_currency', '') || base).toUpperCase();
  if (!/^[A-Z]{3}$/.test(fundCurrency)) throw u.fail(400, 'fund_currency is a three-letter code such as USD.', 'invalid_param', { param: 'fund_currency' });
  const sizeMinor = u.money(p, 'fund_size', fundCurrency, { positive: true });
  const thisYear = Number(u.today(zone).slice(0, 4));
  const vintage = u.int(p, 'fund_vintage', thisYear, 1980, thisYear + 2);
  const email = auth.normEmail(u.req(p, 'email'));
  auth.checkEmail(email);
  const password = u.str(p, 'password', '');
  auth.checkPassword(password);
  const pin = auth.checkPinFormat(u.req(p, 'pin'));
  const ownerName = u.squash(u.text(p, 'owner_name', 120, ''));
  if (ownerName === '') throw u.fail(400, 'owner_name is required', 'missing_param', { param: 'owner_name' });
  let member = null;
  let fund = null;
  let management = null;
  let code = '';
  app.runInTransaction((tx) => {
    const s = row(tx);
    s.set('firm_name', firm);
    s.set('base_currency', base);
    s.set('zone', zone);
    s.set('setup_done', true);
    tx.save(s);
    u.zoneReset();
    const owner = auth.roleByCode(tx, 'owner');
    member = u.newRecord(tx, 'members');
    member.set('email', email);
    member.set('name', ownerName);
    member.set('role', owner.id);
    member.set('status', 'active');
    member.set('funds', []);
    member.set('zone', zone);
    member.set('last_seen', u.nowIso());
    member.setPassword(password);
    tx.save(member);
    auth.storePin(tx, member, pin);
    code = auth.issueRecovery(tx, tx.findRecordById('members', member.id));
    const octx = auth.withApp(auth.contextFor(tx, tx.findRecordById('members', member.id)), tx);
    management = ents.create(octx, { kind: 'management', name: firm, currency: base, status: 'active' });
    fund = ents.create(octx, { kind: 'fund', name: fundName, currency: fundCurrency, vintage: vintage, size_minor: sizeMinor || 0, status: 'investing', parent: management.id });
    L('lib_audit').write(octx, { op: 'setup.complete', collection: 'settings', record: s.id, summary: 'Set up ' + firm + ' with ' + fundName });
  });
  ctx.audited = true;
  u.zoneReset();
  const m = app.findRecordById('members', member.id);
  const octx = auth.contextFor(app, m);
  L('lib_events').emit(octx, 'entity.created', { entity: management.id, kind: 'management' });
  L('lib_events').emit(octx, 'entity.created', { entity: fund.id, kind: 'fund' });
  L('lib_events').emit(octx, 'setup.completed', { firm: firm, fund: fund.id, member: m.id });
  return { token: m.newAuthToken(), recovery_code: code, fund: fund, management: management, me: auth.me(octx) };
}

module.exports = { PROMOTABLE: PROMOTABLE, row: row, view: view, get: get, update: update, autonomy: autonomy, autonomyOf: autonomyOf, autoAllowed: autoAllowed, module: moduleOf, moduleOf: moduleOf, modulesOf: modulesOf, progress: progress, setupStatus: setupStatus, setupComplete: setupComplete };
