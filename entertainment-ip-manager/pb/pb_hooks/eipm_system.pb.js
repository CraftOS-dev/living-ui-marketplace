/// <reference path="../pb_data/types.d.ts" />
/**
 * Entertainment IP Manager record hooks and scheduled jobs.
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
  if (!e.record.getString('ui_language')) e.record.set('ui_language', String(u.setting(e.app, 'default_language', 'en') || 'en'));
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
/* Portal visibility: portal_users is derived, never typed.            */
/* ------------------------------------------------------------------ */

onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) e.record.set('portal_users', []);
  e.next();
}, 'agreements', 'grants', 'committees', 'products', 'approvals', 'seal_orders', 'royalty_reports', 'consent_requests', 'distributions', 'documents');

onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) e.record.set('portal_users', e.record.original().getStringSlice('portal_users'));
  e.next();
}, 'agreements', 'grants', 'committees', 'products', 'approvals', 'seal_orders', 'royalty_reports', 'consent_requests', 'distributions', 'documents');

// Only an admin decides which accounts log in for a company.
onRecordUpdateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.hasSuperuserAuth() && !u.isAdmin(e.auth)) e.record.set('portal_users', e.record.original().getStringSlice('portal_users'));
  e.next();
}, 'parties');

onRecordCreateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.hasSuperuserAuth() && !u.isAdmin(e.auth)) e.record.set('portal_users', []);
  e.next();
}, 'parties');

onRecordAfterUpdateSuccess((e) => {
  try {
    require(`${__hooks}/lib_portal.js`).partyChanged(e.app, e.record.id);
  } catch (err) {
    console.error('portal refresh after party change failed:', err);
  }
  e.next();
}, 'parties');

onRecordAfterCreateSuccess((e) => {
  const portal = require(`${__hooks}/lib_portal.js`);
  const coll = e.record.collection().name;
  try {
    portal.refresh(e.app, coll, e.record);
    portal.cascade(e.app, coll, e.record);
  } catch (err) {
    console.error('portal refresh failed for ' + coll + ':', err);
  }
  e.next();
}, 'agreements', 'grants', 'committees', 'products', 'approvals', 'seal_orders', 'royalty_reports', 'consent_requests', 'distributions', 'documents');

onRecordAfterUpdateSuccess((e) => {
  const portal = require(`${__hooks}/lib_portal.js`);
  const coll = e.record.collection().name;
  try {
    const changed = portal.refresh(e.app, coll, e.record);
    if (!changed) portal.cascade(e.app, coll, e.record);
  } catch (err) {
    console.error('portal refresh failed for ' + coll + ':', err);
  }
  e.next();
}, 'agreements', 'grants', 'committees', 'products', 'approvals', 'seal_orders', 'royalty_reports', 'consent_requests', 'distributions', 'documents');

// Committee members decide who can see the committee.
onRecordAfterCreateSuccess((e) => {
  const portal = require(`${__hooks}/lib_portal.js`);
  try {
    portal.refreshById(e.app, 'committees', e.record.getString('committee'));
  } catch (err) {
    console.error('committee portal refresh failed:', err);
  }
  e.next();
}, 'committee_members');
onRecordAfterUpdateSuccess((e) => {
  const portal = require(`${__hooks}/lib_portal.js`);
  try {
    portal.refreshById(e.app, 'committees', e.record.getString('committee'));
  } catch (err) {
    console.error('committee portal refresh failed:', err);
  }
  e.next();
}, 'committee_members');
onRecordAfterDeleteSuccess((e) => {
  const portal = require(`${__hooks}/lib_portal.js`);
  try {
    portal.refreshById(e.app, 'committees', e.record.getString('committee'));
  } catch {
    /* committee gone */
  }
  e.next();
}, 'committee_members');

/* ------------------------------------------------------------------ */
/* References and defaults.                                            */
/* ------------------------------------------------------------------ */

onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.record.getString('ref')) e.record.set('ref', u.simpleRef(e.app, 'agreements', 'agreement'));
  e.next();
}, 'agreements');

onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.record.getString('ref')) e.record.set('ref', u.simpleRef(e.app, 'products', 'product'));
  if (!e.record.getString('stage')) e.record.set('stage', 'proposal');
  if (!e.record.getString('currency')) e.record.set('currency', String(u.setting(e.app, 'home_currency', 'JPY') || 'JPY'));
  e.next();
}, 'products');

onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.record.getString('ref')) e.record.set('ref', u.simpleRef(e.app, 'enforcement_cases', 'case'));
  if (u.d10(e.record.getString('opened_date')) === '') e.record.set('opened_date', u.toPb(u.today()));
  if (!e.record.getString('status')) e.record.set('status', 'new');
  e.next();
}, 'enforcement_cases');

onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  if (!e.record.getString('permission_no')) e.record.set('permission_no', u.simpleRef(e.app, 'fan_registrations', 'permit', 'permission_no'));
  e.next();
}, 'fan_registrations');

// ISRC and ISWC are stored in their canonical form; a bad code is refused.
onRecordCreate((e) => {
  const music = require(`${__hooks}/lib_music.js`);
  const raw = e.record.getString('isrc');
  if (raw) {
    if (!music.validIsrc(raw)) throw new BadRequestError('ISRC "' + raw + '" is not valid. It has 12 characters: country, registrant, year, number (for example JP-A01-26-00001).');
    e.record.set('isrc', music.normIsrc(raw));
  }
  e.next();
}, 'recordings');
onRecordUpdate((e) => {
  const music = require(`${__hooks}/lib_music.js`);
  const raw = e.record.getString('isrc');
  if (raw) {
    if (!music.validIsrc(raw)) throw new BadRequestError('ISRC "' + raw + '" is not valid. It has 12 characters: country, registrant, year, number (for example JP-A01-26-00001).');
    e.record.set('isrc', music.normIsrc(raw));
  }
  e.next();
}, 'recordings');
onRecordCreate((e) => {
  const music = require(`${__hooks}/lib_music.js`);
  const raw = e.record.getString('iswc');
  if (raw && !music.validIswc(raw)) throw new BadRequestError('ISWC "' + raw + '" fails its check digit. The format is T-123.456.789-C.');
  if (raw) e.record.set('iswc', music.formatIswc(raw));
  e.next();
}, 'songs');
onRecordUpdate((e) => {
  const music = require(`${__hooks}/lib_music.js`);
  const raw = e.record.getString('iswc');
  if (raw && !music.validIswc(raw)) throw new BadRequestError('ISWC "' + raw + '" fails its check digit. The format is T-123.456.789-C.');
  if (raw) e.record.set('iswc', music.formatIswc(raw));
  e.next();
}, 'songs');

// Approvals created directly (CraftBot, API) still get a reviewer chain and a reply date.
onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const lic = require(`${__hooks}/lib_licensing.js`);
  const a = e.record;
  if (!a.getString('status')) a.set('status', 'submitted');
  if (!a.getInt('round')) a.set('round', 1);
  if (u.d10(a.getString('submitted_at')) === '') a.set('submitted_at', u.toPb(u.today()));
  const product = u.byId(e.app, 'products', a.getString('product'));
  const agreement = a.getString('agreement') ? u.byId(e.app, 'agreements', a.getString('agreement')) : product && product.getString('agreement') ? u.byId(e.app, 'agreements', product.getString('agreement')) : null;
  if (agreement && !a.getString('agreement')) a.set('agreement', agreement.id);
  const reviewers = u.j(a, 'reviewers', []);
  if ((!Array.isArray(reviewers) || !reviewers.length) && product) {
    a.set('reviewers', lic.buildReviewers(e.app, product, agreement, a.getString('stage'), u.ids(a, 'assigned_reviewers')));
  }
  if (u.d10(a.getString('due_date')) === '') {
    const cal = require(`${__hooks}/lib_calendar.js`);
    const tpl = lic.stageTemplate(e.app, agreement).filter((s) => s && s.key === a.getString('stage'))[0] || {};
    const days = agreement && agreement.getInt('approval_sla_days') > 0 ? agreement.getInt('approval_sla_days') : Number(tpl.sla_days) || Number(u.setting(e.app, 'approval_sla_days', 5)) || 5;
    a.set('due_date', u.toPb(cal.addBusinessDays(e.app, String(u.setting(e.app, 'work_calendar', 'JP') || 'JP'), u.today(), days).date));
  }
  if (!a.getString('timeout_outcome')) a.set('timeout_outcome', agreement ? agreement.getString('approval_timeout') || 'none' : 'none');
  if (!a.getString('copyright_check')) a.set('copyright_check', 'unchecked');
  e.next();
}, 'approvals');

// Sell-off: entering sell-off sets the end date from the licence when it is empty.
onRecordUpdate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const p = e.record;
  if (p.getString('stage') === 'sell_off' && u.d10(p.getString('sell_off_end')) === '' && p.getString('agreement')) {
    const a = u.byId(e.app, 'agreements', p.getString('agreement'));
    if (a && a.getInt('sell_off_days') > 0) {
      const base = u.d10(a.getString('term_end')) && u.d10(a.getString('term_end')) < u.today() ? u.d10(a.getString('term_end')) : u.today();
      p.set('sell_off_end', u.toPb(u.addDays(base, a.getInt('sell_off_days'))));
    }
  }
  e.next();
}, 'products');

/* ------------------------------------------------------------------ */
/* Outbound grants: conflicts need a reason (checked on the server).   */
/* ------------------------------------------------------------------ */

onRecordCreateRequest((e) => {
  const msg = require(`${__hooks}/lib_rights.js`).guardGrant(e.app, e.record);
  if (msg) throw new BadRequestError(require(`${__hooks}/lib_util.js`).langOfAuth(e.app, e.auth) === 'ja' ? msg.ja : msg.en, { error_ja: msg.ja });
  e.next();
}, 'grants');
onRecordUpdateRequest((e) => {
  const msg = require(`${__hooks}/lib_rights.js`).guardGrant(e.app, e.record);
  if (msg) throw new BadRequestError(require(`${__hooks}/lib_util.js`).langOfAuth(e.app, e.auth) === 'ja' ? msg.ja : msg.en, { error_ja: msg.ja });
  e.next();
}, 'grants');

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
      m.set('expiry_date', u.toPb(engine.computeExpiry(e.app, m).date));
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
      m.set('expiry_date', u.toPb(engine.computeExpiry(e.app, m).date));
    } catch {
      /* keep */
    }
  }
  // A corrected filing, publication or registration date also corrects the
  // event that recorded it, so deadlines measured from it can be recalculated.
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

/* ------------------------------------------------------------------ */
/* Deadlines: denormalize, validate manual changes, keep summaries.    */
/* ------------------------------------------------------------------ */

onRecordCreate((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const d = e.record;
  const mid = d.getString('matter');
  if (mid) {
    const m = u.byId(e.app, 'matters', mid);
    if (m !== null) {
      if (!d.getString('ref')) d.set('ref', m.getString('ref'));
      if (!d.getString('jurisdiction')) d.set('jurisdiction', m.getString('jurisdiction'));
      if (!d.getString('subject_type')) d.set('subject_type', m.getString('ip_type'));
      if (!d.getString('family')) d.set('family', m.getString('family'));
      if (!d.getString('assignee')) d.set('assignee', m.getString('responsible') || m.getString('docketer'));
    }
  }
  if (!d.getString('subject_label') || !d.getString('subject_type')) {
    for (const type of Object.keys(engine.SUBJECTS)) {
      const id = d.getString(engine.SUBJECTS[type].field);
      if (!id) continue;
      const s = engine.subjectOf(e.app, type, id);
      if (s === null) continue;
      if (!d.getString('subject_label')) d.set('subject_label', s.label);
      if (!d.getString('subject_type')) d.set('subject_type', s.subject_type);
      if (!d.getString('ref')) {
        try {
          d.set('ref', s.record.getString('ref') || '');
        } catch {
          /* no ref field */
        }
      }
      break;
    }
  }
  if (!d.getString('title_ja')) d.set('title_ja', d.getString('title'));
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
    const who = u.userLabel(e.app, u.actorId(e));
    steps.push(
      u.bi(
        'Changed by ' + who + ' on ' + u.human(u.today()) + ' from ' + u.human(oldDue) + ' to ' + u.human(newDue) + '. Locked against recalculation.',
        u.humanJa(u.today()) + 'に' + who + 'が' + u.humanJa(oldDue) + 'から' + u.humanJa(newDue) + 'へ変更。再計算の対象外にしました。',
      ),
    );
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
    if (e.record.getString('category') === 'renewal' && e.record.getString('source') === 'manual' && mid) engine.ensureRenewal(e.app, e.record);
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
/* Obligations follow the records they come from.                      */
/* ------------------------------------------------------------------ */


onRecordAfterCreateSuccess((e) => {
  const obl = require(`${__hooks}/lib_obligations.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const coll = e.record.collection().name;
  const type = {
    agreements: 'agreement', committees: 'committee', products: 'product', approvals: 'approval', permissions: 'permission',
    society_contracts: 'society_contract', society_registrations: 'registration', characters: 'character', talents: 'talent',
    enforcement_cases: 'case', platform_enrollments: 'enrollment', fan_registrations: 'fan_registration', titles: 'work',
  }[coll];
  try {
    obl.sync(e.app, type, e.record, '');
    if (coll === 'agreements') engine.syncAuthorGrant(e.app, e.record, '');
    if (coll === 'talents') engine.syncTalent(e.app, e.record, '');
    if (coll === 'titles') engine.syncWork(e.app, e.record, '');
  } catch (err) {
    console.error('obligations failed for ' + coll + ':', err);
  }
  e.next();
}, 'agreements', 'committees', 'products', 'approvals', 'permissions', 'society_contracts', 'society_registrations', 'characters', 'talents', 'enforcement_cases', 'platform_enrollments', 'fan_registrations', 'titles');

onRecordAfterUpdateSuccess((e) => {
  const obl = require(`${__hooks}/lib_obligations.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const coll = e.record.collection().name;
  const type = {
    agreements: 'agreement', committees: 'committee', products: 'product', approvals: 'approval', permissions: 'permission',
    society_contracts: 'society_contract', society_registrations: 'registration', characters: 'character', talents: 'talent',
    enforcement_cases: 'case', platform_enrollments: 'enrollment', fan_registrations: 'fan_registration', titles: 'work',
  }[coll];
  try {
    obl.sync(e.app, type, e.record, '');
    if (coll === 'agreements') engine.syncAuthorGrant(e.app, e.record, '');
    if (coll === 'talents') engine.syncTalent(e.app, e.record, '');
    if (coll === 'titles') engine.syncWork(e.app, e.record, '');
  } catch (err) {
    console.error('obligations failed for ' + coll + ':', err);
  }
  e.next();
}, 'agreements', 'committees', 'products', 'approvals', 'permissions', 'society_contracts', 'society_registrations', 'characters', 'talents', 'enforcement_cases', 'platform_enrollments', 'fan_registrations', 'titles');

// Children re-sync their parent: assets -> character, consent/distribution -> committee,
// seals -> product, evidence -> case, clearances -> title.
onRecordAfterCreateSuccess((e) => {
  const obl = require(`${__hooks}/lib_obligations.js`);
  const coll = e.record.collection().name;
  const link = { character_assets: ['character', 'character'], consent_requests: ['committee', 'committee'], distributions: ['committee', 'committee'], seal_orders: ['product', 'product'], evidence: ['case', 'case_ref'], clearances: ['work', 'work'] }[coll];
  try {
    if (link) obl.syncById(e.app, link[0], e.record.getString(link[1]), '');
  } catch (err) {
    console.error('parent obligations failed for ' + coll + ':', err);
  }
  e.next();
}, 'character_assets', 'consent_requests', 'distributions', 'seal_orders', 'evidence', 'clearances');

onRecordAfterUpdateSuccess((e) => {
  const obl = require(`${__hooks}/lib_obligations.js`);
  const coll = e.record.collection().name;
  const link = { character_assets: ['character', 'character'], consent_requests: ['committee', 'committee'], distributions: ['committee', 'committee'], seal_orders: ['product', 'product'], evidence: ['case', 'case_ref'], clearances: ['work', 'work'] }[coll];
  try {
    if (link) obl.syncById(e.app, link[0], e.record.getString(link[1]), '');
  } catch (err) {
    console.error('parent obligations failed for ' + coll + ':', err);
  }
  e.next();
}, 'character_assets', 'consent_requests', 'distributions', 'seal_orders', 'evidence', 'clearances');

onRecordAfterDeleteSuccess((e) => {
  const obl = require(`${__hooks}/lib_obligations.js`);
  const coll = e.record.collection().name;
  const link = { character_assets: ['character', 'character'], consent_requests: ['committee', 'committee'], distributions: ['committee', 'committee'], seal_orders: ['product', 'product'], evidence: ['case', 'case_ref'], clearances: ['work', 'work'] }[coll];
  try {
    if (link) obl.syncById(e.app, link[0], e.record.getString(link[1]), '');
  } catch {
    /* parent gone */
  }
  e.next();
}, 'character_assets', 'consent_requests', 'distributions', 'seal_orders', 'evidence', 'clearances');

onRecordAfterCreateSuccess((e) => {
  try {
    require(`${__hooks}/lib_engine.js`).syncRecordation(e.app, e.record, '');
  } catch (err) {
    console.error('recordation obligations failed:', err);
  }
  e.next();
}, 'customs_recordations');

onRecordAfterUpdateSuccess((e) => {
  try {
    require(`${__hooks}/lib_engine.js`).syncRecordation(e.app, e.record, '');
  } catch (err) {
    console.error('recordation obligations failed:', err);
  }
  e.next();
}, 'customs_recordations');

// Royalty lines keep their statement's totals.
onRecordAfterCreateSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  try {
    const r = u.byId(e.app, 'royalty_reports', e.record.getString('report'));
    if (r) require(`${__hooks}/lib_licensing.js`).recalcReport(e.app, r);
  } catch (err) {
    console.error('royalty recalculation failed:', err);
  }
  e.next();
}, 'royalty_lines');
onRecordAfterUpdateSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  try {
    const r = u.byId(e.app, 'royalty_reports', e.record.getString('report'));
    if (r) require(`${__hooks}/lib_licensing.js`).recalcReport(e.app, r);
  } catch (err) {
    console.error('royalty recalculation failed:', err);
  }
  e.next();
}, 'royalty_lines');
onRecordAfterDeleteSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  try {
    const r = u.byId(e.app, 'royalty_reports', e.record.getString('report'));
    if (r) require(`${__hooks}/lib_licensing.js`).recalcReport(e.app, r);
  } catch {
    /* report gone */
  }
  e.next();
}, 'royalty_lines');

// Use evidence: a received royalty statement or an approved final sample counts as use of the marks behind the product.
onRecordAfterUpdateSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const a = e.record;
  try {
    if (a.getString('status') !== 'approved' || (a.getString('stage') !== 'final_sample' && a.getString('stage') !== 'mass_production_check')) {
      e.next();
      return;
    }
    const p = u.byId(e.app, 'products', a.getString('product'));
    if (p === null) {
      e.next();
      return;
    }
    const filters = [];
    const params = {};
    u.ids(p, 'characters').forEach((c, i) => {
      filters.push('character = {:c' + i + '}');
      params['c' + i] = c;
    });
    if (p.getString('franchise')) {
      filters.push('franchise = {:f}');
      params.f = p.getString('franchise');
    }
    if (filters.length) {
      for (const m of u.findMany(e.app, 'matters', 'ip_type = "trademark" && status_group = "live" && (' + filters.join(' || ') + ')', '', 0, params)) {
        if (u.d10(m.getString('last_use_evidence')) < u.today()) {
          m.set('last_use_evidence', u.toPb(u.today()));
          e.app.save(m);
        }
      }
    }
  } catch (err) {
    console.error('use evidence update failed:', err);
  }
  e.next();
}, 'approvals');

/* ------------------------------------------------------------------ */
/* Inbox: tell reviewers when someone (or CraftBot) proposes something. */
/* ------------------------------------------------------------------ */

onRecordAfterCreateSuccess((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  try {
    if (e.record.getString('source') !== 'office_sync') {
      const kind = e.record.getString('kind');
      const roles = ['admin', 'manager', 'rights'];
      if (kind === 'royalty_statement') roles.push('licensing');
      if (kind === 'permission') roles.push('talent_manager');
      for (const m of u.usersWithRoles(e.app, roles)) {
        u.notify(e.app, m.id, 'inbox', u.bi('New in the Inbox: ' + e.record.getString('title'), 'インボックスに新着：' + e.record.getString('title')), e.record.getString('summary'), '#/inbox/' + e.record.id, {});
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
    const label = e.record.getString('ref') || e.record.getString('title') || e.record.getString('name') || e.record.getString('stage_name') || e.record.getString('label') || e.record.getString('their_mark') || e.record.id;
    u.audit(e.app, u.actorId(e), 'create', c, e.record.id, label, {}, '');
  } catch (err) {
    console.error('audit create failed:', err);
  }
}, 'matters', 'families', 'franchises', 'titles', 'characters', 'character_assets', 'talents', 'castings', 'committees', 'committee_members', 'agreements', 'grants', 'goods_services', 'deadlines', 'documents', 'parties', 'involvements', 'clearances', 'products', 'approvals', 'seal_orders', 'royalty_reports', 'royalty_lines', 'songs', 'recordings', 'releases', 'society_contracts', 'society_registrations', 'content_id_assets', 'content_id_claims', 'permissions', 'guidelines', 'fan_registrations', 'enforcement_cases', 'evidence', 'platform_enrollments', 'customs_recordations', 'watch_hits', 'rules', 'fee_schedule', 'fx_rates', 'office_calendars', 'dimension_values', 'events', 'inbox_items');

onRecordUpdateRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  let changes = {};
  try {
    const before = u.plain(e.record.original());
    const after = u.plain(e.record);
    const skip = { updated: true, created: true, calculation: true, official_data: true, reminders_sent: true, password: true, tokenKey: true, token: true, api_key: true, client_secret: true, portal_users: true };
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
    const label = e.record.getString('ref') || e.record.getString('title') || e.record.getString('name') || e.record.getString('stage_name') || e.record.getString('email') || e.record.id;
    const reason = c === 'deadlines' ? e.record.getString('close_reason') : c === 'grants' ? e.record.getString('override_reason') : '';
    u.audit(e.app, u.actorId(e), 'update', c, e.record.id, label, changes, reason);
  } catch (err) {
    console.error('audit update failed:', err);
  }
}, 'matters', 'families', 'franchises', 'titles', 'characters', 'character_assets', 'talents', 'castings', 'committees', 'committee_members', 'agreements', 'grants', 'goods_services', 'deadlines', 'renewals', 'documents', 'parties', 'involvements', 'clearances', 'products', 'approvals', 'seal_orders', 'royalty_reports', 'royalty_lines', 'songs', 'recordings', 'releases', 'society_contracts', 'society_registrations', 'content_id_assets', 'content_id_claims', 'permissions', 'guidelines', 'fan_registrations', 'enforcement_cases', 'evidence', 'platform_enrollments', 'customs_recordations', 'watch_hits', 'rules', 'settings', 'users', 'fee_schedule', 'fx_rates', 'office_calendars', 'dimension_values', 'events');

onRecordDeleteRequest((e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const c = e.record.collection().name;
  const label = e.record.getString('ref') || e.record.getString('title') || e.record.getString('name') || e.record.getString('stage_name') || e.record.id;
  const snapshot = u.plain(e.record);
  e.next();
  try {
    u.audit(e.app, u.actorId(e), 'delete', c, e.record.id, label, { deleted: snapshot }, '');
  } catch (err) {
    console.error('audit delete failed:', err);
  }
}, 'matters', 'families', 'franchises', 'titles', 'characters', 'character_assets', 'talents', 'castings', 'committees', 'committee_members', 'agreements', 'grants', 'goods_services', 'deadlines', 'documents', 'parties', 'involvements', 'clearances', 'products', 'approvals', 'seal_orders', 'royalty_reports', 'royalty_lines', 'songs', 'recordings', 'releases', 'society_contracts', 'society_registrations', 'content_id_assets', 'content_id_claims', 'permissions', 'guidelines', 'fan_registrations', 'enforcement_cases', 'evidence', 'platform_enrollments', 'customs_recordations', 'watch_hits', 'rules', 'users', 'fee_schedule', 'fx_rates', 'office_calendars', 'dimension_values', 'events');

/* ------------------------------------------------------------------ */
/* Scheduled jobs                                                      */
/* ------------------------------------------------------------------ */

// Hourly housekeeping: reminders, escalations, digest, lapse sweep, calendars.
cronAdd('eipm_hourly', '5 * * * *', () => {
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
    for (const o of ['US', 'EM', 'JP', 'WO']) {
      cal.ensureCalendar($app, o, y);
      cal.ensureCalendar($app, o, y + 1);
    }
  } catch (err) {
    console.error('calendar upkeep failed:', err);
  }
});

// Daily: time-based obligations (occasions, fiscal years, rolling report periods) and approval timeouts.
cronAdd('eipm_daily', '45 3 * * *', () => {
  try {
    require(`${__hooks}/lib_obligations.js`).sweepAll($app);
  } catch (err) {
    console.error('obligation sweep failed:', err);
  }
  try {
    require(`${__hooks}/lib_licensing.js`).applyTimeouts($app);
  } catch (err) {
    console.error('approval timeouts failed:', err);
  }
});

// Daily office sync at the configured hour (runs hourly, acts once a day).
cronAdd('eipm_office_sync', '20 * * * *', () => {
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

// ECB reference rates: hourly check, one successful fetch a day; renewal costs follow.
cronAdd('eipm_fx', '30 * * * *', () => {
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
cronAdd('eipm_monthly', '40 3 1 * *', () => {
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

// Fee or manual exchange-rate edits re-price open renewals at once.
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
