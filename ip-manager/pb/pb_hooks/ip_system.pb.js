/// <reference path="../pb_data/types.d.ts" />
/**
 * IP Manager record hooks and scheduled jobs.
 *
 * GOJA RULE: every callback runs in an isolated VM; require() libraries
 * inside each callback, never reference file-scope helpers.
 */

/* ------------------------------------------------------------------ */
/* Users: first account is admin; later sign-ups get the default role. */
/* ------------------------------------------------------------------ */

onRecordCreateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  let byAdmin = false;
  try {
    byAdmin = e.hasSuperuserAuth() || u.roleOf(e.auth) === 'admin';
  } catch {
    byAdmin = false;
  }
  const existing = u.findMany(e.app, 'users', '', '', 1).length;
  if (!byAdmin || !e.record.getString('role')) {
    const def = String(u.setting(e.app, 'default_signup_role', 'contributor') || 'contributor');
    e.record.set('role', existing === 0 ? 'admin' : def);
  }
  e.record.set('emailVisibility', true);
  if (!e.record.getString('name')) {
    const email = e.record.getString('email');
    const local = email.split('@')[0] || 'User';
    const pretty = local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
    e.record.set('name', pretty || 'User');
  }
  e.next();
}, 'users');

// The organization always keeps at least one administrator.
onRecordUpdateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const before = e.record.original().getString('role');
  const after = e.record.getString('role');
  if (before === 'admin' && after !== 'admin') {
    const admins = u.findMany(e.app, 'users', 'role = "admin"', '', 2).length;
    if (admins < 2) throw new BadRequestError('This is the only administrator. Make someone else an administrator first.');
  }
  e.next();
}, 'users');

onRecordDeleteRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (e.record.getString('role') === 'admin') {
    const admins = u.findMany(e.app, 'users', 'role = "admin"', '', 2).length;
    if (admins < 2) throw new BadRequestError('This is the only administrator and cannot be removed.');
  }
  e.next();
}, 'users');

/* ------------------------------------------------------------------ */
/* Submitters manage inventors and files on their own draft disclosure. */
/* ------------------------------------------------------------------ */

onRecordCreateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.hasSuperuserAuth() && !u.canEdit(e.auth)) {
    const d = u.byId(e.app, 'disclosures', e.record.getString('disclosure'));
    const own = d !== null && d.getString('submitted_by') === u.actorId(e) && d.getString('stage') === 'draft';
    const other = ['matter', 'agreement', 'work', 'family'].some((f) => e.record.getString(f) !== '');
    if (!own || other) throw new ForbiddenError('You can add inventors only to your own invention while it is a draft.');
  }
  e.next();
}, 'involvements');

onRecordUpdateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.hasSuperuserAuth() && !u.canEdit(e.auth)) {
    const d = u.byId(e.app, 'disclosures', e.record.getString('disclosure'));
    const own = d !== null && d.getString('submitted_by') === u.actorId(e) && d.getString('stage') === 'draft';
    const other = ['matter', 'agreement', 'work', 'family'].some((f) => e.record.getString(f) !== '');
    if (!own || other) throw new ForbiddenError('You can change inventors only on your own invention while it is a draft.');
  }
  e.next();
}, 'involvements');

// inventor_users is derived (who may read the invention as a named inventor);
// nobody sets it through the API.
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) e.record.set('inventor_users', []);
  e.next();
}, 'disclosures');

onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) e.record.set('inventor_users', e.record.original().getStringSlice('inventor_users'));
  e.next();
}, 'disclosures');

onRecordAfterCreateSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  u.refreshInventorUsers(e.app, e.record.getString('disclosure'));
  e.next();
}, 'involvements');

onRecordUpdate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const before = e.record.original().getString('disclosure');
  e.next();
  u.refreshInventorUsers(e.app, e.record.getString('disclosure'));
  if (before !== e.record.getString('disclosure')) u.refreshInventorUsers(e.app, before);
}, 'involvements');

onRecordAfterDeleteSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  u.refreshInventorUsers(e.app, e.record.getString('disclosure'));
  e.next();
}, 'involvements');

onRecordUpdate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const changed = e.record.original().getString('user') !== e.record.getString('user');
  e.next();
  if (changed) {
    const seen = {};
    for (const inv of u.findMany(e.app, 'involvements', 'party = {:p} && disclosure != ""', '', 0, { p: e.record.id })) {
      const d = inv.getString('disclosure');
      if (seen[d]) continue;
      seen[d] = true;
      u.refreshInventorUsers(e.app, d);
    }
  }
}, 'parties');

onRecordCreateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.hasSuperuserAuth() && u.roleOf(e.auth) === 'inventor') {
    const d = u.byId(e.app, 'disclosures', e.record.getString('disclosure'));
    if (d === null || d.getString('submitted_by') !== u.actorId(e)) throw new ForbiddenError('You can attach files only to your own inventions.');
    ['matter', 'agreement', 'work', 'family', 'property', 'dispute'].forEach((f) => e.record.set(f, ''));
  }
  e.next();
}, 'documents');

/* ------------------------------------------------------------------ */
/* Matters: derived fields before every save (API or hook).            */
/* ------------------------------------------------------------------ */

onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const m = e.record;
  if (!m.getString('status')) m.set('status', 'to_file');
  m.set('status_group', engine.statusGroup(m.getString('status')));
  if (!m.getString('route')) m.set('route', 'national');
  if (!m.getString('relation')) m.set('relation', 'none');
  m.set('jurisdiction', m.getString('jurisdiction').toUpperCase());
  if (!m.getString('ref')) m.set('ref', u.matterRef(e.app, m.getString('ip_type'), m.getString('jurisdiction'), m.getString('family'), ''));
  if (!m.getString('sync_source')) {
    const offices = require(`${__hooks}/lib_offices.js`);
    const src = offices.sourceFor(m.getString('ip_type'), m.getString('jurisdiction'));
    m.set('sync_source', src || 'none');
    m.set('sync_state', 'not_connected');
  }
  if (!m.getBool('expiry_override')) {
    try {
      const exp = engine.computeExpiry(e.app, m);
      m.set('expiry_date', u.toPb(exp.date));
    } catch {
      /* computed again after save */
    }
  }
  e.next();
}, 'matters');

onRecordUpdate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const m = e.record;
  m.set('status_group', engine.statusGroup(m.getString('status')));
  m.set('jurisdiction', m.getString('jurisdiction').toUpperCase());
  if (!m.getString('ref')) m.set('ref', u.matterRef(e.app, m.getString('ip_type'), m.getString('jurisdiction'), m.getString('family'), m.id));
  if (!m.getBool('expiry_override')) {
    try {
      const exp = engine.computeExpiry(e.app, m);
      m.set('expiry_date', u.toPb(exp.date));
    } catch {
      /* keep */
    }
  }
  // A corrected filing, publication or registration date also corrects the
  // event that recorded it, so deadlines measured from the event can be
  // recalculated. Skipped when an event on the new date already exists
  // (recording a new event is what changed the field).
  const moves = [];
  for (const code of Object.keys(engine.EVENT_CODES)) {
    const field = engine.EVENT_CODES[code].field;
    if (!field) continue;
    const before = u.d10(m.original().getString(field));
    const after = u.d10(m.getString(field));
    if (before !== '' && after !== '' && before !== after) moves.push({ code: code, before: before, after: after });
  }
  e.next();
  for (const mv of moves) {
    const evs = u.findMany(e.app, 'events', 'matter = {:m} && code = {:c}', '', 0, { m: m.id, c: mv.code });
    const atNew = evs.filter((x) => u.d10(x.getString('date')) === mv.after);
    const atOld = evs.filter((x) => u.d10(x.getString('date')) === mv.before);
    if (atNew.length || atOld.length !== 1) continue;
    atOld[0].set('date', u.toPb(mv.after));
    e.app.save(atOld[0]);
  }
}, 'matters');

onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.record.getString('ref')) e.record.set('ref', u.simpleRef(e.app, 'agreements', 'agreement'));
  e.next();
}, 'agreements');

onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.record.getString('ref')) e.record.set('ref', u.simpleRef(e.app, 'disclosures', 'invention'));
  e.next();
}, 'disclosures');

/* ------------------------------------------------------------------ */
/* Deadlines: denormalize, validate manual changes, keep summaries.    */
/* ------------------------------------------------------------------ */

onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const d = e.record;
  const mid = d.getString('matter');
  if (mid) {
    const m = u.byId(e.app, 'matters', mid);
    if (m !== null) {
      if (!d.getString('ref')) d.set('ref', m.getString('ref'));
      if (!d.getString('jurisdiction')) d.set('jurisdiction', m.getString('jurisdiction'));
      if (!d.getString('ip_type')) d.set('ip_type', m.getString('ip_type'));
      if (!d.getString('family')) d.set('family', m.getString('family'));
      if (!d.getString('assignee')) d.set('assignee', m.getString('responsible') || m.getString('docketer'));
    }
  }
  const aid = d.getString('agreement');
  if (aid && !d.getString('ref')) {
    const a = u.byId(e.app, 'agreements', aid);
    if (a !== null) d.set('ref', a.getString('ref'));
  }
  if (!d.getString('status')) d.set('status', 'open');
  if (!d.getString('source')) d.set('source', 'manual');
  if (!d.getString('category')) d.set('category', 'other');
  if (u.d10(d.getString('target_date')) === '' && u.d10(d.getString('due_date')) !== '') {
    const buffer = Number(u.setting(e.app, 'target_buffer_days', 14)) || 0;
    const kind = d.getString('kind');
    const statutory = kind === 'hard' || kind === 'extendable' || kind === 'designated';
    d.set('target_date', u.toPb(statutory ? u.addDays(u.d10(d.getString('due_date')), -buffer) : u.d10(d.getString('due_date'))));
  }
  if (!d.getString('key')) d.set('key', 'manual:' + u.randomToken(12));
  e.next();
}, 'deadlines');

onRecordUpdateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const d = e.record;
  const before = d.original();
  const wasOpen = before.getString('status') === 'open';
  const nowStatus = d.getString('status');
  if (wasOpen && nowStatus !== 'open') {
    const needs = { not_needed: true, cancelled: true, transferred: true, missed: true };
    if (needs[nowStatus] && String(d.getString('close_reason')).trim() === '') {
      throw new BadRequestError('Give a reason to close this deadline as "' + nowStatus.replace('_', ' ') + '".');
    }
    d.set('closed_at', u.toPb(u.today()));
    d.set('closed_by', u.actorId(e));
  }
  if (!wasOpen && nowStatus === 'open') {
    d.set('closed_at', '');
    d.set('closed_by', '');
    d.set('close_reason', '');
  }
  const oldDue = u.d10(before.getString('due_date'));
  const newDue = u.d10(d.getString('due_date'));
  if (oldDue !== newDue && newDue !== '') {
    // A person moved the date: lock it so no recalculation overrides them.
    d.set('locked', true);
    const calc = u.j(d, 'calculation', {});
    const steps = Array.isArray(calc.steps) ? calc.steps.slice() : [];
    steps.push('Changed by ' + u.userLabel(e.app, u.actorId(e)) + ' on ' + u.human(u.today()) + ' from ' + u.human(oldDue) + ' to ' + u.human(newDue) + '. Locked against recalculation.');
    calc.steps = steps;
    d.set('calculation', calc);
    const buffer = Number(u.setting(e.app, 'target_buffer_days', 14)) || 0;
    if (u.d10(before.getString('target_date')) === u.d10(d.getString('target_date'))) {
      const kind = d.getString('kind');
      const statutory = kind === 'hard' || kind === 'extendable' || kind === 'designated';
      d.set('target_date', u.toPb(statutory ? u.addDays(newDue, -buffer) : newDue));
    }
  }
  e.next();
}, 'deadlines');

onRecordAfterCreateSuccess((e) => {
  const engine = require(`${__hooks}/lib_engine.js`);
  const mid = e.record.getString('matter');
  try {
    if (mid) engine.refreshMatterSummary(e.app, mid);
    const cat = e.record.getString('category');
    if ((cat === 'renewal' || cat === 'maintenance') && e.record.getString('source') === 'manual' && mid) engine.ensureRenewal(e.app, e.record);
  } catch (err) {
    console.error('deadline create follow-up failed:', err);
  }
  e.next();
}, 'deadlines');

onRecordAfterUpdateSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const d = e.record;
  try {
    const mid = d.getString('matter');
    if (mid) engine.refreshMatterSummary(e.app, mid);
    const r = u.findOne(e.app, 'renewals', 'deadline = {:d}', { d: d.id });
    if (r !== null && (u.d10(r.getString('due_date')) !== u.d10(d.getString('due_date')) || u.d10(r.getString('grace_end')) !== u.d10(d.getString('grace_end')))) {
      engine.refreshRenewalCost(e.app, r);
    }
  } catch (err) {
    console.error('deadline update follow-up failed:', err);
  }
  e.next();
}, 'deadlines');

onRecordAfterDeleteSuccess((e) => {
  const engine = require(`${__hooks}/lib_engine.js`);
  const mid = e.record.getString('matter');
  try {
    if (mid) engine.refreshMatterSummary(e.app, mid);
  } catch {
    /* matter gone */
  }
  e.next();
}, 'deadlines');

/* ------------------------------------------------------------------ */
/* Goods and services: renewal costs follow the class count.           */
/* ------------------------------------------------------------------ */

onRecordAfterCreateSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  try {
    for (const r of u.findMany(e.app, 'renewals', 'matter = {:m} && instruction_status = "not_instructed"', '', 0, { m: e.record.getString('matter') })) {
      engine.refreshRenewalCost(e.app, r);
    }
  } catch (err) {
    console.error('renewal cost refresh failed:', err);
  }
  e.next();
}, 'goods_services');

onRecordAfterUpdateSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  try {
    for (const r of u.findMany(e.app, 'renewals', 'matter = {:m} && instruction_status = "not_instructed"', '', 0, { m: e.record.getString('matter') })) {
      engine.refreshRenewalCost(e.app, r);
    }
  } catch (err) {
    console.error('renewal cost refresh failed:', err);
  }
  e.next();
}, 'goods_services');

/* ------------------------------------------------------------------ */
/* Agreements and works: obligations follow the record.                */
/* ------------------------------------------------------------------ */

onRecordAfterCreateSuccess((e) => {
  const engine = require(`${__hooks}/lib_engine.js`);
  try {
    engine.syncAgreement(e.app, e.record, '');
  } catch (err) {
    console.error('agreement obligations failed:', err);
  }
  e.next();
}, 'agreements');

onRecordAfterUpdateSuccess((e) => {
  const engine = require(`${__hooks}/lib_engine.js`);
  try {
    engine.syncAgreement(e.app, e.record, '');
  } catch (err) {
    console.error('agreement obligations failed:', err);
  }
  e.next();
}, 'agreements');

onRecordAfterCreateSuccess((e) => {
  const engine = require(`${__hooks}/lib_engine.js`);
  try {
    engine.syncWork(e.app, e.record, '');
  } catch (err) {
    console.error('work obligations failed:', err);
  }
  e.next();
}, 'works');

onRecordAfterUpdateSuccess((e) => {
  const engine = require(`${__hooks}/lib_engine.js`);
  try {
    engine.syncWork(e.app, e.record, '');
  } catch (err) {
    console.error('work obligations failed:', err);
  }
  e.next();
}, 'works');

/* ------------------------------------------------------------------ */
/* Inbox: tell reviewers when someone (or CraftBot) proposes something. */
/* ------------------------------------------------------------------ */

onRecordAfterCreateSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  try {
    if (e.record.getString('source') !== 'office_sync') {
      for (const m of u.usersWithRoles(e.app, ['admin', 'manager', 'counsel'])) {
        u.notify(e.app, m.id, 'inbox', 'New in the Inbox: ' + e.record.getString('title'), e.record.getString('summary'), '#/inbox/' + e.record.id, {});
      }
    }
  } catch (err) {
    console.error('inbox notification failed:', err);
  }
  e.next();
}, 'inbox_items');

/* ------------------------------------------------------------------ */
/* Audit of API changes (who changed what, with before and after).     */
/* ------------------------------------------------------------------ */

onRecordCreateRequest((e) => {
  e.next();
  const u = require(`${__hooks}/lib_util.js`);
  try {
    const c = e.record.collection().name;
    const label = e.record.getString('ref') || e.record.getString('title') || e.record.getString('name') || e.record.getString('product_name') || e.record.getString('their_mark') || e.record.id;
    u.audit(e.app, u.actorId(e), 'create', c, e.record.id, label, {}, '');
  } catch (err) {
    console.error('audit create failed:', err);
  }
}, 'matters', 'families', 'properties', 'works', 'agreements', 'grants', 'goods_services', 'deadlines', 'documents', 'parties', 'involvements', 'clearances', 'approvals', 'disputes', 'watch_hits', 'disclosures', 'rules', 'fee_schedule', 'fx_rates', 'office_calendars', 'dimension_values', 'scoring_criteria', 'royalty_reports', 'events', 'inbox_items');

onRecordUpdateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  let changes = {};
  try {
    const before = u.plain(e.record.original());
    const after = u.plain(e.record);
    const skip = { updated: true, created: true, calculation: true, official_data: true, reminders_sent: true, password: true, tokenKey: true, token: true, api_key: true, client_secret: true };
    for (const k of Object.keys(after)) {
      if (skip[k]) continue;
      const a = JSON.stringify(before[k] === undefined ? null : before[k]);
      const b = JSON.stringify(after[k] === undefined ? null : after[k]);
      if (a !== b) changes[k] = { from: before[k], to: after[k] };
    }
  } catch {
    changes = {};
  }
  e.next();
  try {
    if (Object.keys(changes).length === 0) return;
    const c = e.record.collection().name;
    const label = e.record.getString('ref') || e.record.getString('title') || e.record.getString('name') || e.record.getString('email') || e.record.getString('product_name') || e.record.id;
    const reason = c === 'deadlines' ? e.record.getString('close_reason') : c === 'grants' ? e.record.getString('override_reason') : '';
    u.audit(e.app, u.actorId(e), 'update', c, e.record.id, label, changes, reason);
  } catch (err) {
    console.error('audit update failed:', err);
  }
}, 'matters', 'families', 'properties', 'works', 'agreements', 'grants', 'goods_services', 'deadlines', 'renewals', 'documents', 'parties', 'involvements', 'clearances', 'approvals', 'disputes', 'watch_hits', 'disclosures', 'rules', 'settings', 'users', 'fee_schedule', 'fx_rates', 'office_calendars', 'dimension_values', 'scoring_criteria', 'royalty_reports', 'events');

onRecordDeleteRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const c = e.record.collection().name;
  const label = e.record.getString('ref') || e.record.getString('title') || e.record.getString('name') || e.record.getString('product_name') || e.record.id;
  const snapshot = u.plain(e.record);
  e.next();
  try {
    u.audit(e.app, u.actorId(e), 'delete', c, e.record.id, label, { deleted: snapshot }, '');
  } catch (err) {
    console.error('audit delete failed:', err);
  }
}, 'matters', 'families', 'properties', 'works', 'agreements', 'grants', 'goods_services', 'deadlines', 'documents', 'parties', 'involvements', 'clearances', 'approvals', 'disputes', 'watch_hits', 'disclosures', 'rules', 'users', 'fee_schedule', 'fx_rates', 'office_calendars', 'dimension_values', 'scoring_criteria', 'royalty_reports', 'events');

/* ------------------------------------------------------------------ */
/* Scheduled jobs                                                      */
/* ------------------------------------------------------------------ */

// Hourly housekeeping: reminders, escalations, digest, lapse sweep, calendars.
cronAdd('ipm_hourly', '5 * * * *', () => {
  const u = require(`${__hooks}/lib_util.js`);
  const digest = require(`${__hooks}/lib_digest.js`);
  const cal = require(`${__hooks}/lib_calendar.js`);
  try {
    digest.runReminders($app);
  } catch (err) {
    console.error('reminders failed:', err);
  }
  try {
    const hour = new Date().getHours();
    const s = u.settings($app);
    if (s !== null && s.getBool('digest_enabled') && hour >= (s.getInt('digest_hour') || 8)) digest.runDigest($app, false);
  } catch (err) {
    console.error('digest failed:', err);
  }
  try {
    digest.runLapseSweep($app);
  } catch (err) {
    console.error('lapse sweep failed:', err);
  }
  try {
    const y = new Date().getFullYear();
    for (const o of ['US', 'EP', 'EM', 'JP', 'WO']) {
      cal.ensureCalendar($app, o, y);
      cal.ensureCalendar($app, o, y + 1);
    }
  } catch (err) {
    console.error('calendar upkeep failed:', err);
  }
});

// Daily office sync at the configured hour (runs hourly, acts once a day).
cronAdd('ipm_office_sync', '20 * * * *', () => {
  const u = require(`${__hooks}/lib_util.js`);
  const offices = require(`${__hooks}/lib_offices.js`);
  try {
    const s = u.settings($app);
    if (s === null || !s.getBool('sync_enabled')) return;
    const hour = new Date().getHours();
    if (hour !== (s.getInt('sync_hour') || 2)) return;
    const today = u.today();
    const done = u.findMany($app, 'sync_runs', 'trigger = "scheduled" && created >= {:t}', '', 1, { t: today + ' 00:00:00.000Z' });
    if (done.length) return;
    offices.syncAll($app, 'scheduled');
  } catch (err) {
    console.error('office sync failed:', err);
  }
});

// ECB reference rates, published around 16:00 CET on working days.
// Hourly check, one successful ECB fetch a day; renewal costs follow the new rates.
cronAdd('ipm_fx', '30 * * * *', () => {
  const u = require(`${__hooks}/lib_util.js`);
  const fx = require(`${__hooks}/lib_fx.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  try {
    const s = u.settings($app);
    if (s === null || !s.getBool('fx_auto')) return;
    if (u.d10(s.getString('fx_updated')) === u.today()) return;
    fx.refreshEcb($app);
    engine.refreshAllRenewalCosts($app);
  } catch (err) {
    console.error('ECB rates refresh failed:', err);
  }
});

// A new home currency re-prices every open renewal (compared before the save).
onRecordUpdate((e) => {
  const engine = require(`${__hooks}/lib_engine.js`);
  const changed = e.record.original().getString('home_currency') !== e.record.getString('home_currency');
  e.next();
  if (changed) {
    try {
      engine.refreshAllRenewalCosts(e.app);
    } catch (err) {
      console.error('renewal re-pricing failed:', err);
    }
  }
}, 'settings');

// Monthly: official Japanese holiday list and the JPO keep-alive call.
cronAdd('ipm_monthly', '40 3 1 * *', () => {
  const cal = require(`${__hooks}/lib_calendar.js`);
  const offices = require(`${__hooks}/lib_offices.js`);
  try {
    cal.refreshJapanOfficial($app);
  } catch (err) {
    console.error('Japan holiday refresh failed:', err);
  }
  try {
    offices.jpoHeartbeat($app);
  } catch (err) {
    console.error('JPO keep-alive failed:', err);
  }
});

// Fee or manual exchange-rate edits re-price open renewals at once. ECB
// refreshes save many rates and re-price once at the end instead.
onRecordAfterCreateSuccess((e) => {
  require(`${__hooks}/lib_engine.js`).repriceAfterEdit(e.app, e.record);
  e.next();
}, 'fee_schedule', 'fx_rates');

onRecordAfterUpdateSuccess((e) => {
  require(`${__hooks}/lib_engine.js`).repriceAfterEdit(e.app, e.record);
  e.next();
}, 'fee_schedule', 'fx_rates');

onRecordAfterDeleteSuccess((e) => {
  require(`${__hooks}/lib_engine.js`).repriceAfterEdit(e.app, e.record);
  e.next();
}, 'fee_schedule', 'fx_rates');
