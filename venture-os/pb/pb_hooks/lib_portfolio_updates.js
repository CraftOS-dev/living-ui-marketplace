/// <reference path="../pb_data/types.d.ts" />
/**
 * Portfolio monitoring work (SPEC 7.10): founder requests, founder
 * updates, asks, board meetings, what your AI agent is asked for them, and
 * this module's Next items.
 *
 * Requests: each company's schedule (monthly or quarterly, metrics, the
 * founders' emails), off until a person turns it on. The request for the
 * period that just ended goes out through the kernel's outbound (kind
 * `request`) as soon as it is due (the person who turned the schedule on
 * released it), with reminders 7 and 14 days later while no update came.
 *
 * Updates: the Gmail sweep (every 5 minutes) files messages carrying the
 * updates label, and messages from a company the firm asked for an
 * update, with their attachments; a file or text dropped on a company page
 * is an update too. Your AI agent reads an update (trigger update_extract
 * { update_id }) when the person who added or filed it asked, or when it
 * arrived by email while the email_updates switch is on; it stages KPI
 * values with their source, proposes asks, and never verifies. The update's StepTrack: Received, Reading,
 * Staged, Verified.
 *
 * Asks are tracked work (kind, owner, status, outcome); board meetings get
 * a brief from your AI agent (trigger board_brief { meeting_id }) when a
 * person asks, or 48 hours before while the board_briefs switch is on.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function P() {
  return L('lib_portfolio');
}
function K() {
  return L('lib_portfolio_kpi');
}

const CADENCES = ['monthly', 'quarterly'];
const ASK_KINDS = ['intro', 'hire', 'customer', 'fundraising', 'advice', 'other'];
const ASK_STATUSES = ['open', 'in_progress', 'done'];
const STEP_LABELS = ['Received', 'Reading', 'Staged', 'Verified'];
const DEFAULT_METRICS = ['revenue', 'net_burn', 'cash', 'headcount'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const DEFAULT_SUBJECT = '{company}: your {period} update';
const DEFAULT_BODY = 'Hi {first_name},\n\nCould you send us your {period} update? Your usual update email, board deck or a short reply with these numbers is perfect:\n\n{metrics}\n\nAnd tell us how we can help this quarter.\n\nThank you,\n{sender}\n{firm}';
const REMINDER_BODY = 'Hi {first_name},\n\nA quick reminder about your {period} update. A reply with your usual update is all we need.\n\nThank you,\n{sender}';

/* ------------------------------------------------------------- helpers */

function templateOf(app) {
  const s = L('lib_settings').module(app, 'portfolio');
  return { subject: String(s.request_subject || DEFAULT_SUBJECT), body: String(s.request_body || DEFAULT_BODY), request_day: Number(s.request_day) || 3, reminder_1_days: Number(s.reminder_1_days) || 7, reminder_2_days: Number(s.reminder_2_days) || 14 };
}

/** Put values into a template: {name} tokens a person wrote once (our own text, never a message's). */
function fill(text, vars) {
  let out = String(text || '');
  for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(String(vars[k] === undefined || vars[k] === null ? '' : vars[k]));
  return out;
}

/** The last period of a cadence that ended before today (quarters follow the company's fiscal year end). */
function lastPeriodEnd(today, cadence, fyEnd) {
  const util = u();
  let d = util.monthEnd(util.addMonths(today.slice(0, 8) + '01', -1));
  if (cadence !== 'quarterly') return d;
  const fe = fyEnd || 12;
  for (let i = 0; i < 3; i++) {
    const m = Number(d.slice(5, 7));
    if ((((m - fe) % 3) + 3) % 3 === 0) return d;
    d = util.monthEnd(util.addMonths(d.slice(0, 8) + '01', -1));
  }
  return d;
}

function periodLabel(pe, cadence, fyEnd) {
  if (!pe) return '';
  if (cadence === 'quarterly') {
    const f = L('lib_eng_kpi').fiscalOf(pe, fyEnd || 12);
    return 'Q' + f.q + ' ' + ((fyEnd || 12) === 12 ? String(f.fy) : 'FY' + f.fy);
  }
  return MONTHS_LONG[Number(pe.slice(5, 7)) - 1] + ' ' + pe.slice(0, 4);
}

/** The founders' emails of a company: founders on its invested deal, else the people at the company. */
function recipientsOf(app, companyId, holding) {
  const util = u();
  const out = [];
  const add = (e) => {
    const x = String(e || '')
      .trim()
      .toLowerCase();
    if (x !== '' && out.indexOf(x) < 0) out.push(x);
  };
  const deal = holding ? holding.getString('deal') : '';
  if (deal !== '') for (const r of util.rows(app, "SELECT p.email AS email FROM deal_people dp JOIN people p ON p.id = dp.person WHERE dp.deal = {:d} AND dp.role = 'founder' AND p.email != '' AND p.deleted_at = ''", { email: '' }, { d: deal })) add(r.email);
  if (out.length === 0) for (const r of util.rows(app, "SELECT email FROM people WHERE company = {:c} AND email != '' AND deleted_at = '' AND merged_into = '' ORDER BY created LIMIT 3", { email: '' }, { c: companyId })) add(r.email);
  return out;
}

function firstNameOf(app, email) {
  const r = u().one(app, 'SELECT name FROM people WHERE email = {:e} LIMIT 1', { name: '' }, { e: email });
  const n = r && r.name ? r.name : '';
  return n !== '' ? n.split(' ')[0] : 'there';
}

/* --------------------------------------------------------------- requests */

function requestView(app, r, h) {
  const util = u();
  const fe = h ? h.getInt('fy_end_month') || 12 : 12;
  const cadence = r.getString('cadence');
  const today = util.today(app);
  const tpl = templateOf(app);
  let state = 'off';
  if (r.getBool('enabled')) {
    if (r.getString('sent_at') === '') state = 'scheduled';
    else if (r.getString('received_at') !== '') state = 'received';
    else state = r.getInt('reminders') > 0 ? 'reminded' : 'requested';
  }
  const nextPe = lastPeriodEnd(today, cadence, fe);
  const nextDay = r.getString('period_end') === nextPe ? util.dayAdd(lastPeriodEnd(util.addMonths(today, cadence === 'quarterly' ? 3 : 1), cadence, fe), tpl.request_day) : util.dayAdd(nextPe, tpl.request_day);
  return {
    id: r.id,
    company: P().companyMini(app, r.getString('company')),
    enabled: r.getBool('enabled'),
    cadence: cadence,
    metrics: util.jsonOf(r, 'metrics', []) || [],
    to: util.jsonOf(r, 'to', []) || [],
    period_end: r.getString('period_end'),
    period_label: periodLabel(r.getString('period_end'), cadence, fe),
    state: state,
    sent_at: r.getString('sent_at'),
    reminders: r.getInt('reminders'),
    received_at: r.getString('received_at'),
    next_day: r.getBool('enabled') ? nextDay : '',
    outbound: r.getString('outbound'),
    error: r.getString('error'),
    enabled_by: L('lib_records').mini(app, 'members', r.getString('enabled_by')),
  };
}

/** Compose and release one request (or reminder) through the kernel outbound: drafted and approved by `ctx`. */
function sendRequest(ctx, r, h, reminder) {
  const util = u();
  const app = ctx.app;
  const to = util.jsonOf(r, 'to', []) || [];
  if (to.length === 0) {
    r.set('error', 'No founder email: add one to send requests.');
    app.save(r);
    return null;
  }
  const tpl = templateOf(app);
  const fe = h.getInt('fy_end_month') || 12;
  const all = K().defs(app).byKey;
  const metrics = (util.jsonOf(r, 'metrics', []) || []).map((k) => (all[k] ? all[k].label : k));
  const firm = L('lib_settings').row(app).getString('firm_name');
  const vars = { first_name: firstNameOf(app, to[0]), company: (P().companyMini(app, r.getString('company')) || {}).name || '', period: periodLabel(r.getString('period_end'), r.getString('cadence'), fe), metrics: metrics.map((m) => '- ' + m).join('\n'), firm: firm, sender: ctx.name || firm };
  const subject = fill(tpl.subject, vars);
  const body = fill(reminder ? REMINDER_BODY : tpl.body, vars);
  const d = L('lib_outbound').draft(ctx, { kind: 'request', module: 'portfolio', to: to, subject: reminder ? 'Re: ' + subject : subject, body: body, ref_collection: 'requests', ref_id: r.id });
  const sent = L('lib_outbound').approve(ctx, d.id);
  r.set('outbound', d.id);
  r.set('error', sent.status === 'failed' ? util.clip(sent.error || 'Not sent.', 600) : '');
  return sent;
}

/** A context that may release this schedule's sends: the person who turned it on, while they may still edit the portfolio. */
function releaser(app, r) {
  const util = u();
  const m = util.byId(app, 'members', r.getString('enabled_by'));
  if (m === null || m.getString('status') !== 'active') return null;
  const ctx = L('lib_auth').contextFor(app, m);
  return L('lib_auth').can(ctx, 'portfolio', 'edit') ? ctx : null;
}

/** Did an update from this company arrive after `day` (firm-local)? */
function updateSince(app, companyId, at) {
  return u().count(app, "SELECT COUNT(*) AS n FROM updates WHERE company = {:c} AND status != 'dismissed' AND received_at >= {:a}", { c: companyId, a: at }) > 0;
}

/**
 * One schedule's step for today: the request of the period that just ended
 * when it is due (unless an update for it already came), then the
 * reminders. `force` sends the current period's request now.
 */
function step(ctx, r, today, force) {
  const util = u();
  const app = ctx.app;
  if (!r.getBool('enabled')) return 'off';
  const h = K().holdingFor(Object.assign({}, ctx, { actor: 'system' }), r.getString('company'));
  const tpl = templateOf(app);
  const pe = lastPeriodEnd(today, r.getString('cadence'), h.getInt('fy_end_month') || 12);
  const peAt = util.atOf(app, util.dayAdd(pe, 1));
  if (r.getString('period_end') !== pe || (force && r.getString('sent_at') === '')) {
    if (!force && today < util.dayAdd(pe, tpl.request_day)) return 'waiting';
    r.set('period_end', pe);
    r.set('reminders', 0);
    r.set('reminded_at', '');
    if (updateSince(app, r.getString('company'), peAt)) {
      r.set('sent_at', '');
      r.set('received_at', util.nowIso());
      app.save(r);
      return 'received';
    }
    r.set('received_at', '');
    const sent = sendRequest(ctx, r, h, false);
    if (sent !== null && sent.status !== 'failed') r.set('sent_at', util.nowIso());
    app.save(r);
    return sent === null ? 'no_email' : sent.status;
  }
  if (r.getString('sent_at') === '' || r.getString('received_at') !== '') return 'idle';
  if (updateSince(app, r.getString('company'), r.getString('sent_at'))) {
    r.set('received_at', util.nowIso());
    app.save(r);
    return 'received';
  }
  const days = util.daysBetween(util.dayOf(app, r.getString('sent_at')), today);
  const n = r.getInt('reminders');
  if ((n === 0 && days >= tpl.reminder_1_days) || (n === 1 && days >= tpl.reminder_2_days)) {
    const sent = sendRequest(ctx, r, h, true);
    if (sent !== null && sent.status !== 'failed') {
      r.set('reminders', n + 1);
      r.set('reminded_at', util.nowIso());
    }
    app.save(r);
    return 'reminded';
  }
  return 'idle';
}

/** Daily: every enabled schedule's step, released by the person who turned it on. */
function requestsDue(app) {
  const util = u();
  const today = util.today(app);
  let n = 0;
  for (const r of util.findMany(app, 'requests', 'enabled = true', 'created', 0)) {
    const ctx = releaser(app, r);
    if (ctx === null) {
      r.set('error', 'The person who turned this on can no longer approve sends; turn it on again.');
      app.save(r);
      continue;
    }
    try {
      const out = step(ctx, r, today, false);
      if (out === 'sent' || out === 'approved' || out === 'reminded') n++;
    } catch (err) {
      console.error('[vo] founder request for ' + r.getString('company') + ' failed:', err);
    }
  }
  return n;
}

/**
 * requests.schedule (people): turn requests on (or off) for companies with
 * one cadence and one metric list; the template is saved firm-wide when
 * given. The request for the period that just ended goes out at once when
 * it is due.
 */
function opSchedule(ctx, p) {
  const util = u();
  const app = ctx.app;
  const refs = util.list(p, 'companies');
  if (!refs || refs.length === 0) throw util.fail(400, 'companies is required: a JSON list of company ids or domains.', 'missing_param', { param: 'companies' });
  const enabled = util.bool(p, 'enabled', true);
  const cadence = util.oneOf(p, 'cadence', CADENCES, 'monthly');
  let metrics = util.list(p, 'metrics');
  if (metrics === undefined || metrics.length === 0) metrics = DEFAULT_METRICS;
  const all = K().defs(app).byKey;
  metrics = metrics.map((k) => K().defOf(app, k).key);
  for (const k of metrics) if (all[k].kind === 'computed') throw util.fail(400, all[k].label + ' is computed by the app; ask for cash and net burn.', 'invalid_param', { param: 'metrics' });
  const to = util.list(p, 'to');
  if (to !== undefined && refs.length !== 1) throw util.fail(400, '--to names one company\'s founders; schedule that company on its own.', 'invalid_param', { param: 'to' });
  const tplChange = {};
  if (util.has(p, 'subject')) tplChange.request_subject = util.text(p, 'subject', 300, '') || DEFAULT_SUBJECT;
  if (util.has(p, 'body')) tplChange.request_body = util.text(p, 'body', 8000, '') || DEFAULT_BODY;
  if (Object.keys(tplChange).length > 0) L('lib_settings').update(ctx, { modules: { portfolio: tplChange } });
  const today = util.today(app);
  const out = [];
  const needs = [];
  let sent = 0;
  for (const ref of refs) {
    const c = P().companyRef(app, String(ref));
    const h = K().holdingFor(ctx, c.id);
    let r = util.findOne(app, 'requests', 'company = {:c}', { c: c.id });
    if (r === null) {
      r = util.newRecord(app, 'requests');
      r.set('company', c.id);
      r.set('reminders', 0);
    }
    r.set('holding', h.id);
    r.set('cadence', cadence);
    r.set('metrics', metrics);
    const emails = to !== undefined ? to.map((x) => String(x).trim().toLowerCase()).filter((x) => x !== '') : (util.jsonOf(r, 'to', []) || []).length > 0 ? util.jsonOf(r, 'to', []) : recipientsOf(app, c.id, h);
    for (const e of emails) if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e)) throw util.fail(400, '"' + util.clip(e, 80) + '" is not an email address.', 'invalid_param', { param: 'to' });
    r.set('to', emails);
    const on = enabled && emails.length > 0;
    if (enabled && emails.length === 0) needs.push({ id: c.id, name: c.getString('name') });
    const was = r.getBool('enabled');
    r.set('enabled', on);
    if (on && !was) {
      r.set('enabled_by', ctx.memberId);
      r.set('enabled_at', util.nowIso());
      r.set('error', '');
    }
    P().stamp(ctx, r);
    app.save(r);
    if (on) {
      const st = step(ctx, r, today, false);
      if (st === 'sent' || st === 'approved') sent++;
    }
    out.push(requestView(app, app.findRecordById('requests', r.id), h));
  }
  L('lib_audit').note(ctx, { collection: 'requests', summary: (enabled ? 'Turned on ' : 'Turned off ') + cadence + ' update requests for ' + out.length + ' compan' + (out.length === 1 ? 'y' : 'ies') + (sent > 0 ? ' (' + sent + ' sent now)' : '') });
  return { requests: out, needs_email: needs, sent: sent };
}

/** requests.send (people): send this period's request to one company now. */
function opSendNow(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = P().companyRef(app, util.req(p, 'company', 'acme.com'));
  const h = K().holdingFor(ctx, c.id);
  const r = util.findOne(app, 'requests', 'company = {:c}', { c: c.id });
  if (r === null || !r.getBool('enabled')) throw util.fail(409, 'Requests are off for ' + c.getString('name') + '; turn them on with requests.schedule.', 'off');
  r.set('sent_at', '');
  r.set('period_end', '');
  const st = step(ctx, r, util.today(app), true);
  L('lib_audit').note(ctx, { collection: 'requests', record: r.id, summary: 'Sent the update request to ' + c.getString('name') });
  return { request: requestView(app, app.findRecordById('requests', r.id), h), result: st };
}

/** requests.list: every active portfolio company with its schedule (or none), the founders' emails and the template. */
function opRequestsList(ctx) {
  const util = u();
  const app = ctx.app;
  const seen = {};
  const companies = [];
  for (const h of util.findMany(app, 'holdings', "deleted_at = '' && status = 'active'", 'created', 0)) {
    if (!P().visible(ctx, h) || seen[h.getString('company')]) continue;
    seen[h.getString('company')] = true;
    const r = util.findOne(app, 'requests', 'company = {:c}', { c: h.getString('company') });
    const c = P().companyMini(app, h.getString('company'));
    companies.push({ company: c, recipients: r !== null && (util.jsonOf(r, 'to', []) || []).length > 0 ? util.jsonOf(r, 'to', []) : recipientsOf(app, h.getString('company'), h), request: r !== null ? requestView(app, r, h) : null });
  }
  companies.sort((a, b) => (String(a.company.name).toLowerCase() < String(b.company.name).toLowerCase() ? -1 : 1));
  const tpl = templateOf(app);
  return { companies: companies, template: { subject: tpl.subject, body: tpl.body }, default_metrics: DEFAULT_METRICS, updates_label: L('lib_mail').labels(app).updates_label, company_mail: L('lib_settings').module(app, 'portfolio').company_mail !== false, gmail: L('lib_mail').bridgeUp() };
}

/** requests.template-save (people): the request email a person writes once, and the Gmail label founder updates are filed from. */
function opTemplateSave(ctx, p) {
  const util = u();
  const change = {};
  if (util.has(p, 'subject')) change.request_subject = util.text(p, 'subject', 300, '') || DEFAULT_SUBJECT;
  if (util.has(p, 'body')) change.request_body = util.text(p, 'body', 8000, '') || DEFAULT_BODY;
  if (util.has(p, 'request_day')) change.request_day = util.int(p, 'request_day', 3, 0, 28);
  if (util.has(p, 'company_mail')) change.company_mail = util.bool(p, 'company_mail', true);
  const upd = { modules: { portfolio: change } };
  if (util.has(p, 'updates_label')) upd.mail = { updates_label: util.req(p, 'updates_label', 'Venture OS/Updates') };
  if (Object.keys(change).length === 0) delete upd.modules;
  if (Object.keys(upd).length === 0) throw util.fail(400, 'Give subject, body, request_day, company_mail or updates_label.', 'missing_param');
  L('lib_settings').update(ctx, upd);
  const tpl = templateOf(ctx.app);
  return { template: { subject: tpl.subject, body: tpl.body, request_day: tpl.request_day }, updates_label: L('lib_mail').labels(ctx.app).updates_label, company_mail: L('lib_settings').module(ctx.app, 'portfolio').company_mail !== false };
}

/* ---------------------------------------------------------------- updates */

/** The update's StepTrack: Received, Reading (a screen moves it on while your AI agent is on it), Staged, Verified. */
function stepOf(app, r) {
  const st = r.getString('status');
  if (st === 'verified') return { labels: STEP_LABELS, at: 3 };
  if (st === 'staged') return { labels: STEP_LABELS, at: 2 };
  return { labels: STEP_LABELS, at: 0 };
}

/** Text around a quote in the update's text (the source snippet shown beside a value). */
function snippetOf(body, quote) {
  if (!quote) return null;
  const i = body.indexOf(quote);
  if (i < 0) return { before: '', quote: quote, after: '' };
  const a = Math.max(0, i - 90);
  const b = Math.min(body.length, i + quote.length + 90);
  return { before: (a > 0 ? '...' : '') + body.slice(a, i), quote: quote, after: body.slice(i + quote.length, b) + (b < body.length ? '...' : '') };
}

function updateView(app, r, detail) {
  const util = u();
  const files = util.jsonOf(r, 'files', []) || [];
  const counts = { staged: 0, verified: 0, rejected: 0 };
  for (const x of util.rows(app, "SELECT status, COUNT(*) AS n FROM kpi_values WHERE \"update\" = {:u} GROUP BY status", { status: '', n: 0 }, { u: r.id })) if (counts[x.status] !== undefined) counts[x.status] = x.n;
  const h = r.getString('holding') !== '' ? util.byId(app, 'holdings', r.getString('holding')) : null;
  const out = {
    id: r.id,
    company: P().companyMini(app, r.getString('company')),
    holding: r.getString('holding'),
    source: r.getString('source'),
    from_email: r.getString('from_email'),
    from_name: r.getString('from_name'),
    subject: r.getString('subject'),
    received_at: r.getString('received_at'),
    period_end: r.getString('period_end'),
    period_label: r.getString('period_end') !== '' ? K().monthLabel(r.getString('period_end')) : '',
    status: r.getString('status'),
    step: r.getString('status') === 'dismissed' ? null : stepOf(app, r),
    agent: L('lib_agent').view(r, ['update_extract']),
    counts: counts,
    files: files.length,
    note: r.getString('note'),
  };
  if (detail) {
    const body = r.getString('body');
    out.body = body;
    const fileRecs = files.map((id) => util.byId(app, 'files', id)).filter((f) => f !== null);
    const texts = L('lib_files').textsOf(app, fileRecs.map((f) => f.id));
    out.file_list = fileRecs.map((f) => L('lib_files').fileOut(app, f, texts[f.id]));
    const defsByKey = K().defs(app).byKey;
    out.values = util.findMany(app, 'kpi_values', "update = {:u} && status != 'superseded'", 'key,period_end', 0, { u: r.id }).map((v) => {
      const view = K().valueView(app, v, defsByKey);
      let anchor = null;
      if (view.anchor !== '') {
        const a = util.byId(app, 'anchors', view.anchor);
        if (a !== null) anchor = { id: a.id, kind: a.getString('kind'), file: a.getString('file'), page: a.getInt('page_no'), quote: a.getString('quote') };
      }
      view.source_anchor = anchor;
      view.snippet = anchor && anchor.kind !== 'message' ? { before: '', quote: anchor.quote || view.quote, after: '', page: anchor.page, file: anchor.file } : snippetOf(body, view.quote);
      return view;
    });
    out.asks = util.findMany(app, 'asks', 'update = {:u}', 'created', 0, { u: r.id }).map((a) => askView(app, a));
    out.fy_end_month = h ? h.getInt('fy_end_month') || 12 : 12;
    out.report_currency = h ? h.getString('report_currency') || h.getString('currency') : '';
    // What the firm asked the company for (its update request), so a reading knows the metrics and the period.
    const req = r.getString('company') !== '' ? util.findOne(app, 'requests', 'company = {:c}', { c: r.getString('company') }) : null;
    out.asked = { metrics: req !== null ? util.jsonOf(req, 'metrics', []) || [] : DEFAULT_METRICS, period_end: req !== null ? req.getString('period_end') : '' };
  }
  return out;
}

/** May ctx see this update: an unassigned one with portfolio view; else through its company's holdings. */
function updateVisible(ctx, r) {
  if (!L('lib_auth').can(ctx, 'portfolio', 'view')) return false;
  if (r.getString('company') === '') return true;
  return P().holdingsOfCompany(ctx, r.getString('company')).rows.length > 0;
}

function updateRef(ctx, id) {
  const util = u();
  const r = util.byId(ctx.app, 'updates', String(id || ''));
  if (r === null || !updateVisible(ctx, r)) throw util.fail(404, 'No update ' + id + ' you can see. Run updates.list.', 'not_found', { param: 'update' });
  return r;
}

/** agent.ask --trigger update_extract --record <update>: an update filed to a company and not staged yet. */
function extractCheck(ctx, upd) {
  const util = u();
  if (!updateVisible(ctx, upd)) throw util.fail(404, 'No update ' + upd.id + ' you can see.', 'not_found');
  L('lib_auth').need(ctx, 'portfolio', 'edit', 'ask your AI agent to read an update');
  if (upd.getString('company') === '') throw util.fail(409, 'File the update to a company first (updates.assign).', 'unassigned');
  if (upd.getString('status') !== 'received') throw util.fail(409, 'This update is ' + upd.getString('status') + '; your AI agent reads updates that are not staged yet.', 'conflict');
  return {};
}

/**
 * Ask your AI agent to read an update a person added or filed (by), or one
 * that arrived by email while the email_updates switch is on (policy).
 * Only an update filed to a company and not staged yet. Answers the request id or ''.
 */
function askRead(app, upd, by) {
  if (upd.getString('company') === '' || upd.getString('status') !== 'received') return '';
  const A = L('lib_agent');
  return by ? A.ask(app, 'update_extract', upd, {}, { by: by }) : A.ask(app, 'update_extract', upd, {}, { policy: true });
}

function markReceived(app, companyId) {
  const util = u();
  const r = util.findOne(app, 'requests', 'company = {:c}', { c: companyId });
  if (r !== null && r.getString('sent_at') !== '' && r.getString('received_at') === '') {
    r.set('received_at', util.nowIso());
    app.save(r);
  }
}

function newUpdate(ctx, o) {
  const util = u();
  const app = ctx.app;
  const r = util.newRecord(app, 'updates');
  r.set('company', o.company || '');
  r.set('holding', o.holding || '');
  r.set('source', o.source);
  r.set('from_email', util.clip(o.from_email || '', 200));
  r.set('from_name', util.clip(o.from_name || '', 200));
  r.set('subject', util.clip(o.subject || '', 400));
  r.set('body', String(o.body || '').slice(0, 100000));
  r.set('message_id', util.clip(o.message_id || '', 200));
  r.set('thread_id', util.clip(o.thread_id || '', 200));
  r.set('received_at', o.received_at || util.nowIso());
  r.set('files', []);
  r.set('status', 'received');
  P().stamp(ctx, r);
  app.save(r);
  return r;
}

/**
 * updates.add: a founder update dropped on a company (files, pasted text,
 * or both); your AI agent reads it once its files have text.
 */
function opAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const c = P().companyRef(app, util.req(p, 'company', 'acme.com'));
  const h = K().holdingFor(ctx, c.id);
  const text = util.text(p, 'text', 100000, '');
  const uploads = ctx.e ? L('lib_files').uploadedAll(ctx.e, 'file') : [];
  const paths = util.list(p, 'paths') || [];
  if (text === '' && uploads.length === 0 && paths.length === 0) throw util.fail(400, 'Drop a file or paste the update text.', 'missing_param', { param: 'file' });
  const r = newUpdate(ctx, { company: c.id, holding: h.id, source: uploads.length + paths.length > 0 ? 'upload' : 'manual', subject: util.text(p, 'subject', 400, '') || (uploads.length > 0 ? uploads[0].originalName : 'Update'), body: text, from_name: ctx.isAgent ? 'your AI agent' : ctx.name });
  const ids = [];
  for (const f of uploads) ids.push(L('lib_files').add(ctx, { owner_collection: 'updates', owner_id: r.id, origin: 'upload', upload: f }).id);
  for (const path of paths) ids.push(L('lib_files').add(ctx, { owner_collection: 'updates', owner_id: r.id, origin: 'agent', path: String(path) }).id);
  if (ids.length > 0) {
    r.set('files', ids);
    app.save(r);
  }
  markReceived(app, c.id);
  // The person who added it asks your AI agent to read it; your AI agent adding one reads it itself.
  const request = ctx.isAgent || ctx.dryRun ? '' : askRead(app, app.findRecordById('updates', r.id), ctx.memberId || '');
  L('lib_audit').note(ctx, { collection: 'updates', record: r.id, summary: 'Added an update for ' + c.getString('name') + (ids.length > 0 ? ' (' + ids.length + ' file' + (ids.length === 1 ? '' : 's') + ')' : '') });
  return { update: updateView(app, app.findRecordById('updates', r.id), false), request: request };
}

/** updates.list: updates of a company, or every update (newest first), with their StepTrack. */
function opUpdatesList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const cref = util.str(p, 'company', '');
  if (cref !== '') {
    where.push('company = {:c}');
    bind.c = P().companyRef(app, cref).id;
  }
  const st = util.oneOf(p, 'status', ['received', 'staged', 'verified', 'dismissed', 'unassigned', 'open', 'all'], 'all');
  if (st === 'unassigned') where.push("company = ''");
  else if (st === 'open') where.push("(status = 'received' || status = 'staged')");
  else if (st !== 'all') {
    where.push('status = {:s}');
    bind.s = st;
  }
  if (st !== 'dismissed' && st !== 'all') where.push("status != 'dismissed'");
  const pg = util.page(p, 50, 300);
  const rows = util.findMany(app, 'updates', where.length > 0 ? where.join(' && ') : '1=1', '-received_at,-created', pg.offset + pg.limit + 500, bind);
  const vis = rows.filter((r) => updateVisible(ctx, r));
  return { updates: vis.slice(pg.offset, pg.offset + pg.limit).map((r) => updateView(app, r, false)), total: vis.length, hidden: rows.length - vis.length };
}

/** updates.get: the update with its text, files, values beside their source snippets, and asks. */
function opUpdatesGet(ctx, p) {
  const r = updateRef(ctx, u().req(p, 'update'));
  return { update: updateView(ctx.app, r, true) };
}

/** updates.assign: file an update that came without a known company to one. */
function opAssign(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = updateRef(ctx, util.req(p, 'update'));
  const c = P().companyRef(app, util.req(p, 'company', 'acme.com'));
  const h = K().holdingFor(ctx, c.id);
  r.set('company', c.id);
  r.set('holding', h.id);
  app.save(r);
  markReceived(app, c.id);
  if (!ctx.dryRun && !ctx.isAgent) askRead(app, r, ctx.memberId || '');
  L('lib_audit').note(ctx, { collection: 'updates', record: r.id, summary: 'Filed an update to ' + c.getString('name') });
  return { update: updateView(app, r, false) };
}

function previewAssign(ctx, params) {
  let name = String(params.company || '');
  try {
    name = P().companyRef(ctx.app, params.company).getString('name');
  } catch {
    /* label only */
  }
  return { label: 'File an update to ' + name, target: 'updates:' + params.update, fields: [{ name: 'company', before: '', after: name }], notes: [], risk: 'low' };
}

/** updates.dismiss (people): not an update (a newsletter, a note); its staged values are rejected. */
function opDismiss(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = updateRef(ctx, util.req(p, 'update'));
  for (const v of util.findMany(app, 'kpi_values', "update = {:u} && status = 'staged'", '', 0, { u: r.id })) {
    v.set('status', 'rejected');
    v.set('note', 'Update dismissed');
    app.save(v);
  }
  r.set('status', 'dismissed');
  r.set('note', util.text(p, 'note', 1000, ''));
  app.save(r);
  // A dismissed update needs no reading: its ask is answered.
  L('lib_agent').landed(app, 'update_extract', app.findRecordById('updates', r.id));
  L('lib_audit').note(ctx, { collection: 'updates', record: r.id, summary: 'Dismissed an update' + (r.getString('subject') !== '' ? ': ' + util.clip(r.getString('subject'), 80) : '') });
  return { update: updateView(app, r, false) };
}

/** "Ana Silva <ana@x.com>" -> { name, email }. */
function parseFrom(raw) {
  const s = String(raw || '').trim();
  const lt = s.lastIndexOf('<');
  const gt = s.lastIndexOf('>');
  if (lt >= 0 && gt > lt) return { name: s.slice(0, lt).trim().replace(/^"|"$/g, ''), email: s.slice(lt + 1, gt).trim().toLowerCase() };
  return { name: '', email: s.toLowerCase() };
}

/**
 * The portfolio company a sender belongs to, or '': by the company's root
 * domain (or one of its domains); a sender at a free-mail domain (gmail.com)
 * by the exact address of a founder on the invested deal or a person of the
 * company.
 */
function companyOfSender(app, email) {
  const util = u();
  const N = L('lib_norm');
  const e = String(email || '').toLowerCase();
  const dom = N.domain(e);
  if (dom !== '' && !N.isFreeMail(dom)) {
    const r = util.one(app, "SELECT c.id AS id FROM companies c JOIN holdings h ON h.company = c.id WHERE h.deleted_at = '' AND c.deleted_at = '' AND (c.domain = {:d} OR c.domains LIKE {:l}) LIMIT 1", { id: '' }, { d: dom, l: '%"' + dom + '"%' });
    return r ? r.id : '';
  }
  if (e === '') return '';
  const f = util.one(app, "SELECT h.company AS id FROM holdings h JOIN deal_people dp ON dp.deal = h.deal JOIN people p ON p.id = dp.person WHERE h.deleted_at = '' AND dp.role = 'founder' AND p.email = {:e} LIMIT 1", { id: '' }, { e: e });
  if (f) return f.id;
  const pc = util.one(app, "SELECT h.company AS id FROM holdings h JOIN people p ON p.company = h.company WHERE h.deleted_at = '' AND p.deleted_at = '' AND p.email = {:e} LIMIT 1", { id: '' }, { e: e });
  return pc ? pc.id : '';
}

/**
 * Who sends portfolio mail: the root domains of every active portfolio
 * company, and the addresses of its founders and people at free-mail
 * domains. `waitingOnly`: only companies the firm asked for an update and
 * has not heard from (when the firm turned company mail off).
 */
function portfolioSenders(app, waitingOnly) {
  const util = u();
  const N = L('lib_norm');
  const out = [];
  const add = (x) => {
    const v = String(x || '').trim().toLowerCase();
    if (v !== '' && out.indexOf(v) < 0) out.push(v);
  };
  const where = waitingOnly ? " AND h.company IN (SELECT company FROM requests WHERE enabled = TRUE AND sent_at != '' AND received_at = '')" : '';
  for (const r of util.rows(app, "SELECT DISTINCT c.id AS id, c.domain AS domain, c.domains AS domains FROM holdings h JOIN companies c ON c.id = h.company WHERE h.deleted_at = '' AND h.status = 'active' AND c.deleted_at = ''" + where, { id: '', domain: '', domains: '' })) {
    let list = [r.domain];
    try {
      const extra = JSON.parse(r.domains || '[]');
      if (Array.isArray(extra)) list = list.concat(extra);
    } catch {
      /* domains is a JSON list */
    }
    for (const d of list) {
      const dd = N.domain(String(d || ''));
      if (dd !== '' && !N.isFreeMail(dd)) add(dd);
    }
  }
  const people = util.rows(app, "SELECT DISTINCT p.email AS email FROM holdings h JOIN deal_people dp ON dp.deal = h.deal JOIN people p ON p.id = dp.person WHERE h.deleted_at = '' AND h.status = 'active' AND dp.role = 'founder' AND p.email != ''" + where, { email: '' }).concat(util.rows(app, "SELECT DISTINCT p.email AS email FROM holdings h JOIN people p ON p.company = h.company WHERE h.deleted_at = '' AND h.status = 'active' AND p.deleted_at = '' AND p.email != ''" + where, { email: '' }));
  for (const r of people) if (N.isFreeMail(N.domain(r.email))) add(r.email);
  return out;
}

/** File one Gmail message as an update with its attachments (system work). */
function fileMessage(app, id, viaLabel) {
  const util = u();
  if (util.findOne(app, 'updates', 'message_id = {:m}', { m: id }) !== null) return null;
  const g = L('lib_mail').get(app, id);
  if (!g.ok) return { error: g.error };
  const m = g.message;
  const from = parseFrom(m.from);
  if (util.findOne(app, 'members', 'email = {:e}', { e: from.email }) !== null) return null;
  // A deck the Inbox already filed (intake's own sweep) is a deal, not a founder update.
  if (!viaLabel && util.count(app, 'SELECT COUNT(*) AS n FROM intake_items WHERE message_id = {:m}', { m: m.id }) > 0) return null;
  const companyId = companyOfSender(app, from.email);
  if (companyId === '' && !viaLabel) return null;
  const sys = L('lib_auth').systemCtx(app);
  let holding = '';
  if (companyId !== '') {
    const hs = util.findMany(app, 'holdings', "company = {:c} && deleted_at = ''", 'created', 1, { c: companyId });
    holding = hs.length > 0 ? hs[0].id : '';
  }
  const r = newUpdate(sys, { company: companyId, holding: holding, source: 'email', from_email: from.email, from_name: from.name, subject: m.subject, body: m.body || m.snippet, message_id: m.id, thread_id: m.thread_id, received_at: m.internal_at || util.nowIso() });
  const ids = [];
  for (const a of m.attachments || []) {
    const got = L('lib_mail').attachment(app, m.id, a.attachment_id, a.filename);
    if (!got.ok) continue;
    try {
      ids.push(L('lib_files').fromPath(sys, { path: got.path, owner_collection: 'updates', owner_id: r.id, origin: 'email', source_ref: m.id, name: a.filename }).id);
    } catch (err) {
      console.error('[vo] could not store attachment ' + a.filename + ':', err);
    }
  }
  if (ids.length > 0) {
    r.set('files', ids);
    app.save(r);
  }
  if (companyId !== '') markReceived(app, companyId);
  askRead(app, app.findRecordById('updates', r.id), '');
  return { update: r.id };
}

/**
 * Every 5 minutes: messages with the updates label (30 days), and messages
 * from every active portfolio company (its domains, its founders'
 * free-mail addresses; 14 days), deduped by message id; with company mail
 * turned off in Settings only from the companies the firm is waiting on for
 * a requested update. Only while CraftBot's bridge is configured.
 */
function sweep(app) {
  const util = u();
  const M = L('lib_mail');
  if (!M.bridgeUp()) return { ok: false, reason: 'offline', filed: 0 };
  let filed = 0;
  const errors = [];
  const label = M.labels(app).updates_label;
  const s1 = M.search(app, 'label:"' + label + '" newer_than:30d', 50);
  if (!s1.ok) return { ok: false, reason: s1.reason, error: s1.error, filed: 0 };
  for (const x of s1.messages) {
    const r = fileMessage(app, x.id, true);
    if (r && r.update) filed++;
    if (r && r.error) errors.push(r.error);
  }
  const companyMail = L('lib_settings').module(app, 'portfolio').company_mail !== false;
  const senders = portfolioSenders(app, !companyMail);
  for (let i = 0; i < senders.length; i += 15) {
    const chunk = senders.slice(i, i + 15);
    const q = (chunk.length === 1 ? 'from:' + chunk[0] : 'from:(' + chunk.join(' OR ') + ')') + ' newer_than:14d';
    const s2 = M.search(app, q, 50);
    if (!s2.ok) break;
    for (const x of s2.messages) {
      const r = fileMessage(app, x.id, false);
      if (r && r.update) filed++;
    }
  }
  return { ok: true, filed: filed, errors: errors };
}

/** updates.sweep (people): file new founder updates from Gmail now. */
function opSweep(ctx) {
  const r = sweep(ctx.app);
  L('lib_audit').note(ctx, { collection: 'updates', summary: 'Checked Gmail for founder updates: ' + (r.filed || 0) + ' filed' });
  if (!r.ok && r.reason === 'offline') return Object.assign(r, { message: 'Connect Gmail in CraftBot: the app reaches Gmail only while it runs inside CraftBot.' });
  return r;
}

/* ------------------------------------------------------------------- asks */

function askView(app, a) {
  return {
    id: a.id,
    company: P().companyMini(app, a.getString('company')),
    holding: a.getString('holding'),
    update: a.getString('update'),
    kind: a.getString('kind'),
    title: a.getString('title'),
    detail: a.getString('detail'),
    owner: L('lib_records').mini(app, 'members', a.getString('owner')),
    status: a.getString('status'),
    outcome: a.getString('outcome'),
    intro: a.getString('intro'),
    due_day: a.getString('due_day'),
    quote: a.getString('quote'),
    anchor: a.getString('anchor'),
    done_at: a.getString('done_at'),
    actor: a.getString('actor'),
    created: a.getString('created'),
    rank: a.getInt('rank'),
  };
}

/** Board order of asks in a status column: the ones a person placed (rank 1, 2, ...) first, then the rest newest first. */
function askOrder(a, b) {
  const ra = a.getInt('rank');
  const rb = b.getInt('rank');
  if ((ra > 0) !== (rb > 0)) return ra > 0 ? -1 : 1;
  if (ra !== rb) return ra - rb;
  const ca = a.getString('created');
  const cb = b.getString('created');
  return ca === cb ? (a.id < b.id ? -1 : 1) : ca < cb ? 1 : -1;
}

function askRef(ctx, id) {
  const util = u();
  const a = util.byId(ctx.app, 'asks', String(id || ''));
  if (a === null || P().holdingsOfCompany(ctx, a.getString('company')).rows.length === 0) throw util.fail(404, 'No ask ' + id + ' you can see. Run asks.list.', 'not_found', { param: 'ask' });
  return a;
}

/** asks.list: asks of a company, mine (--owner me), by status (live: open and in progress, the default), in board order (askOrder). */
function opAsksList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const cref = util.str(p, 'company', '');
  if (cref !== '') {
    where.push('company = {:c}');
    bind.c = P().companyRef(app, cref).id;
  }
  const st = util.oneOf(p, 'status', ['open', 'in_progress', 'done', 'live', 'all'], 'live');
  if (st === 'live') where.push("status != 'done'");
  else if (st !== 'all') {
    where.push('status = {:s}');
    bind.s = st;
  }
  const owner = util.str(p, 'owner', '');
  if (owner !== '') {
    where.push('owner = {:o}');
    bind.o = owner === 'me' ? ctx.memberId || '-' : L('lib_auth').memberRef(app, owner).id;
  }
  const rows = util.findMany(app, 'asks', where.length > 0 ? where.join(' && ') : '1=1', '-created', 1000, bind);
  const vis = rows.filter((a) => P().holdingsOfCompany(ctx, a.getString('company')).rows.length > 0);
  vis.sort(askOrder);
  const counts = { open: 0, in_progress: 0, done: 0 };
  for (const a of vis) counts[a.getString('status')]++;
  return { asks: vis.map((a) => askView(app, a)), counts: counts, hidden: rows.length - vis.length };
}

/** asks.save: a new ask (or a change to one): your AI agent proposes the asks it finds in updates. */
function opAskSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'ask', '');
  let a;
  if (id !== '') a = askRef(ctx, id);
  else {
    const c = P().companyRef(app, util.req(p, 'company', 'acme.com'));
    const h = K().holdingFor(ctx, c.id);
    a = util.newRecord(app, 'asks');
    a.set('company', c.id);
    a.set('holding', h.id);
    a.set('status', 'open');
    a.set('kind', util.oneOf(p, 'kind', ASK_KINDS, 'other'));
    const t = util.squash(util.text(p, 'title', 300, ''));
    if (t === '') throw util.fail(400, 'title is required: the ask in a few words, e.g. "Intro to retail data leaders".', 'missing_param', { param: 'title' });
    a.set('title', t);
  }
  if (id !== '' && util.has(p, 'kind')) a.set('kind', util.oneOf(p, 'kind', ASK_KINDS, a.getString('kind')));
  if (id !== '' && util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 300, ''));
    if (t === '') throw util.fail(400, 'title cannot be empty.', 'invalid_param', { param: 'title' });
    a.set('title', t);
  }
  if (util.has(p, 'detail')) a.set('detail', util.text(p, 'detail', 2000, ''));
  if (util.has(p, 'owner')) {
    const o = util.str(p, 'owner', '');
    a.set('owner', o === '' ? '' : L('lib_auth').memberRef(app, o === 'me' ? ctx.memberId : o).id);
  }
  if (util.has(p, 'due_day')) a.set('due_day', util.day(p, 'due_day', ''));
  if (util.has(p, 'update')) {
    const upd = updateRef(ctx, util.str(p, 'update', ''));
    if (upd.getString('company') !== a.getString('company')) throw util.fail(400, 'That update belongs to another company.', 'invalid_param', { param: 'update' });
    a.set('update', upd.id);
  }
  if (util.has(p, 'quote')) a.set('quote', util.text(p, 'quote', 1000, ''));
  if (util.has(p, 'anchor')) a.set('anchor', util.str(p, 'anchor', ''));
  if (id === '') P().stamp(ctx, a);
  a.set('prov', { by: ctx.isAgent ? 'agent' : 'person', at: util.nowIso(), member: ctx.memberId || '' });
  app.save(a);
  L('lib_audit').note(ctx, { collection: 'asks', record: a.id, summary: (id === '' ? 'Added an ask: ' : 'Changed an ask: ') + a.getString('title') });
  return { ask: askView(app, a) };
}

function previewAsk(ctx, params) {
  let name = String(params.company || '');
  try {
    name = params.ask ? (P().companyMini(ctx.app, ctx.app.findRecordById('asks', params.ask).getString('company')) || {}).name : P().companyRef(ctx.app, params.company).getString('name');
  } catch {
    /* label only */
  }
  const fields = ['kind', 'title', 'detail', 'owner', 'due_day'].filter((k) => params[k] !== undefined && params[k] !== '').map((k) => ({ name: k, before: '', after: String(params[k]) }));
  return { label: (params.ask ? 'Change an ask of ' : 'Track an ask from ') + name, target: params.ask ? 'asks:' + params.ask : '', fields: fields, notes: params.quote ? ['"' + u().clip(String(params.quote), 200) + '"'] : [], risk: 'low' };
}

/** asks.update (people): status, owner, outcome, the intro that answered it. */
function opAskUpdate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = askRef(ctx, util.req(p, 'ask'));
  if (util.has(p, 'status')) {
    const st = util.oneOf(p, 'status', ASK_STATUSES, a.getString('status'));
    if (st !== a.getString('status')) a.set('rank', 0);
    a.set('status', st);
    a.set('done_at', st === 'done' ? (a.getString('done_at') || util.nowIso()) : '');
  }
  if (util.has(p, 'owner')) {
    const o = util.str(p, 'owner', '');
    a.set('owner', o === '' ? '' : L('lib_auth').memberRef(app, o === 'me' ? ctx.memberId : o).id);
  }
  if (util.has(p, 'outcome')) a.set('outcome', util.text(p, 'outcome', 1000, ''));
  if (util.has(p, 'intro')) a.set('intro', util.str(p, 'intro', ''));
  if (util.has(p, 'due_day')) a.set('due_day', util.day(p, 'due_day', ''));
  app.save(a);
  L('lib_audit').note(ctx, { collection: 'asks', record: a.id, summary: 'Ask ' + a.getString('status').replace('_', ' ') + ': ' + a.getString('title') });
  return { ask: askView(app, a) };
}

/**
 * asks.reorder (people): put an ask at a place in a column of its company's
 * asks board, changing its status first when --status differs. --before: the
 * ask it lands in front of (none: the end); or --index: its place, 0 = the
 * top. Every ask of that company and status then carries rank 1..n.
 */
function opAskReorder(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = askRef(ctx, util.req(p, 'ask'));
  const from = a.getString('status');
  const st = util.oneOf(p, 'status', ASK_STATUSES, from);
  if (st !== from) {
    a.set('status', st);
    a.set('done_at', st === 'done' ? util.nowIso() : '');
  }
  const col = util.findMany(app, 'asks', 'company = {:c} && status = {:s} && id != {:me}', '', 0, { c: a.getString('company'), s: st, me: a.id });
  col.sort(askOrder);
  let pos = col.length;
  const before = util.str(p, 'before', '');
  if (before !== '') {
    const i = col.findIndex((x) => x.id === before);
    if (i < 0) throw util.fail(404, 'No ask ' + before + ' in that column. Run asks.list --company.', 'not_found', { param: 'before' });
    pos = i;
  } else if (util.has(p, 'index')) pos = Math.min(col.length, util.int(p, 'index', col.length, 0, 100000));
  const order = col.slice();
  order.splice(pos, 0, a);
  order.forEach((x, i) => {
    if (x.id !== a.id && x.getInt('rank') === i + 1) return;
    x.set('rank', i + 1);
    app.save(x);
  });
  const label = { open: 'Open', in_progress: 'In progress', done: 'Done' }[st];
  L('lib_audit').note(ctx, { collection: 'asks', record: a.id, summary: (st !== from ? 'Ask moved to ' + label + ': ' : 'Ask placed ' + (pos + 1) + ' of ' + order.length + ' in ' + label + ': ') + a.getString('title') });
  return { ask: askView(app, a), status: st, index: pos };
}

/* ---------------------------------------------------------------- board */

function boardView(app, b) {
  const util = u();
  const brief = util.jsonOf(b, 'brief', null);
  const t = L('lib_agent').track(b, 'board_brief', ['Queued', 'Writing', 'Ready']);
  const open = t !== null && t.open;
  return {
    id: b.id,
    company: P().companyMini(app, b.getString('company')),
    holding: b.getString('holding'),
    day: b.getString('day'),
    time: b.getString('time'),
    title: b.getString('title') || 'Board meeting',
    note: b.getString('note'),
    brief: brief,
    brief_at: b.getString('brief_at'),
    brief_state: brief ? 'ready' : open ? 'queued' : t !== null && t.failed ? 'failed' : 'none',
    brief_step: { labels: ['Queued', 'Writing', 'Ready'], at: brief ? 2 : 0 },
    brief_error: !brief && t !== null && t.failed ? t.error : '',
    agent: L('lib_agent').view(b, ['board_brief']),
    deck: b.getString('deck'),
    actor: b.getString('actor'),
  };
}

function boardRef(ctx, id) {
  const util = u();
  const b = util.byId(ctx.app, 'board_meetings', String(id || ''));
  if (b === null || P().holdingsOfCompany(ctx, b.getString('company')).rows.length === 0) throw util.fail(404, 'No board meeting ' + id + ' you can see. Run board.list.', 'not_found', { param: 'meeting' });
  return b;
}

/** board.list: a company's board meetings, or every upcoming one (--upcoming true). */
function opBoardList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const cref = util.str(p, 'company', '');
  if (cref !== '') {
    where.push('company = {:c}');
    bind.c = P().companyRef(app, cref).id;
  }
  if (util.bool(p, 'upcoming', false)) {
    where.push('day >= {:t}');
    bind.t = util.today(app);
  }
  const rows = util.findMany(app, 'board_meetings', where.length > 0 ? where.join(' && ') : '1=1', '-day', 500, bind);
  const vis = rows.filter((b) => P().holdingsOfCompany(ctx, b.getString('company')).rows.length > 0);
  return { meetings: vis.map((b) => boardView(app, b)), hidden: rows.length - vis.length };
}

/** board.save: a board meeting (new or changed): day, time, title, the note after it, the deck. */
function opBoardSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'meeting', '');
  let b;
  if (id !== '') b = boardRef(ctx, id);
  else {
    const c = P().companyRef(app, util.req(p, 'company', 'acme.com'));
    const h = K().holdingFor(ctx, c.id);
    b = util.newRecord(app, 'board_meetings');
    b.set('company', c.id);
    b.set('holding', h.id);
    b.set('day', util.day(p, 'day', '') || '');
    if (b.getString('day') === '') throw util.fail(400, 'day is required, e.g. --day 2026-12-03.', 'missing_param', { param: 'day' });
    P().stamp(ctx, b);
  }
  if (id !== '' && util.has(p, 'day')) b.set('day', util.day(p, 'day', b.getString('day')));
  if (util.has(p, 'time')) {
    const t = util.str(p, 'time', '');
    if (t !== '' && !util.isTime(t)) throw util.fail(400, 'time is HH:MM, e.g. 15:00.', 'invalid_param', { param: 'time' });
    b.set('time', t);
  }
  if (util.has(p, 'title')) b.set('title', util.text(p, 'title', 200, ''));
  if (util.has(p, 'note')) b.set('note', util.text(p, 'note', 20000, ''));
  if (util.has(p, 'deck')) {
    const f = util.str(p, 'deck', '');
    if (f !== '' && util.byId(app, 'files', f) === null) throw util.fail(404, 'No file ' + f + '.', 'not_found', { param: 'deck' });
    b.set('deck', f);
  }
  b.set('prov', { by: ctx.isAgent ? 'agent' : 'person', at: util.nowIso(), member: ctx.memberId || '' });
  app.save(b);
  if (!ctx.dryRun) briefIfDue(app, b);
  L('lib_audit').note(ctx, { collection: 'board_meetings', record: b.id, summary: (id === '' ? 'Added a board meeting of ' : 'Changed a board meeting of ') + (P().companyMini(app, b.getString('company')) || {}).name + ' on ' + b.getString('day') });
  return { meeting: boardView(app, b) };
}

function previewBoard(ctx, params) {
  const fields = ['day', 'time', 'title'].filter((k) => params[k] !== undefined && params[k] !== '').map((k) => ({ name: k, before: '', after: String(params[k]) }));
  return { label: params.meeting ? 'Change a board meeting' : 'Add a board meeting of ' + String(params.company || ''), target: params.meeting ? 'board_meetings:' + params.meeting : '', fields: fields, notes: [], risk: 'low' };
}

/** board.brief-save: the brief for a board meeting ({ sections: [{ title, points: [{ text, source }] }] }). */
function opBriefSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const b = boardRef(ctx, util.req(p, 'meeting'));
  const brief = util.obj(p, 'brief');
  if (!brief || !Array.isArray(brief.sections) || brief.sections.length === 0) throw util.fail(400, 'brief is a JSON object {"sections":[{"title","points":[{"text","source"}]}]}.', 'missing_param', { param: 'brief' });
  const sections = brief.sections.slice(0, 12).map((s, i) => {
    util.keysOnly(s, ['title', 'points'], 'brief.sections[' + i + ']');
    if (!Array.isArray(s.points)) throw util.fail(400, 'brief.sections[' + i + '].points must be a list.', 'invalid_param', { param: 'brief' });
    return {
      title: util.clip(String(s.title || ''), 80),
      points: s.points.slice(0, 20).map((x, j) => {
        if (typeof x === 'string') return { text: util.clip(x, 600), source: null };
        util.keysOnly(x, ['text', 'source'], 'brief.sections[' + i + '].points[' + j + ']');
        return { text: util.clip(String(x.text || ''), 600), source: x.source === undefined ? null : x.source };
      }),
    };
  });
  b.set('brief', { sections: sections, by: ctx.isAgent ? 'agent' : 'person' });
  b.set('brief_at', util.nowIso());
  app.save(b);
  if (ctx.isAgent) L('lib_agent').landed(app, 'board_brief', b);
  L('lib_audit').note(ctx, { collection: 'board_meetings', record: b.id, summary: (ctx.isAgent ? 'Your AI agent wrote' : 'Wrote') + ' the board brief of ' + (P().companyMini(app, b.getString('company')) || {}).name });
  return { meeting: boardView(app, b) };
}

/** Ask your AI agent for a meeting's brief when it starts within 48 hours and has none and was never asked, only while the firm's board_briefs switch is on. */
function briefIfDue(app, b) {
  const util = u();
  if (b.getString('brief_at') !== '' || L('lib_agent').state(b, 'board_brief') !== null) return '';
  const startAt = Date.parse(util.atOf(app, b.getString('day'), b.getString('time') || '09:00'));
  if (!(startAt > Date.now() && startAt - Date.now() <= 48 * 3600000)) return '';
  return L('lib_agent').ask(app, 'board_brief', b, {}, { policy: true });
}

/** agent.ask --trigger board_brief --record <board meeting>: a meeting the person may see. */
function briefCheck(ctx, b) {
  boardRef(ctx, b.id);
  L('lib_auth').need(ctx, 'portfolio', 'view', 'ask for a board brief');
  return {};
}

/** Hourly: ask your AI agent for the brief of every board meeting in the next 48 hours that has none (the board_briefs switch). */
function boardDue(app) {
  const util = u();
  if (L('lib_mail').demo(app) || !L('lib_agent').policyOn(app, 'board_briefs')) return 0;
  const today = util.today(app);
  let n = 0;
  for (const b of util.findMany(app, 'board_meetings', "day >= {:a} && day <= {:b} && brief_at = ''", 'day', 200, { a: util.dayAdd(today, -1), b: util.dayAdd(today, 3) })) if (briefIfDue(app, b) !== '') n++;
  return n;
}

/* ------------------------------------------------------------- Next, timeline */

/** Next items of this module (SPEC 4.3): values to verify, alerts, my asks, updates without a company. */
function needsYou(ctx) {
  const util = u();
  const app = ctx.app;
  const auth = L('lib_auth');
  if (ctx.isAgent || !ctx.memberId || !auth.can(ctx, 'portfolio', 'view')) return [];
  const out = [];
  const edit = auth.can(ctx, 'portfolio', 'edit');
  const vis = {};
  const seeCompany = (cid) => {
    if (vis[cid] === undefined) vis[cid] = P().holdingsOfCompany(ctx, cid).rows.length > 0;
    return vis[cid];
  };
  const defsByKey = K().defs(app).byKey;
  if (edit) {
    // Verify: one item per update with staged values (rank 40).
    for (const r of util.findMany(app, 'updates', "status = 'staged' && company != ''", 'received_at', 100)) {
      if (!seeCompany(r.getString('company'))) continue;
      const vals = util.findMany(app, 'kpi_values', "update = {:u} && status = 'staged'", 'key,period_end', 60, { u: r.id }).map((v) => K().valueView(app, v, defsByKey));
      if (vals.length === 0) continue;
      const c = P().companyMini(app, r.getString('company')) || {};
      const pe = r.getString('period_end');
      const body = r.getString('body');
      const flagged = vals.filter((v) => v.flags.length > 0).length;
      out.push({
        key: 'portfolio:verify:' + r.id,
        kind: 'verify',
        card: 'kpis',
        title: c.name + ' · ' + (pe !== '' ? K().monthLabel(pe).split(' ')[0] : 'Update') + ' · ' + vals.length + ' value' + (vals.length === 1 ? '' : 's'),
        figures: vals.filter((v) => !v.forecast).slice(0, 3).map((v) => ({ label: v.label, value: v.value_text })),
        chips: (flagged > 0 ? [{ label: flagged + ' to check', tone: 'warn' }] : []).concat(vals.some((v) => v.forecast) ? [{ label: 'Forecast kept apart', tone: 'neutral' }] : []),
        steps: { labels: STEP_LABELS, at: 2 },
        agent: vals.some((v) => v.actor === 'agent'),
        rank: 40,
        at: r.getString('received_at'),
        href: '#/portfolio/' + r.getString('company') + '?tab=updates&update=' + r.id,
        data: { update: r.id, company: c, values: vals.map((v) => Object.assign(v, { snippet: snippetOf(body, v.quote) })) },
        actions: [{ label: 'Verify all', op: 'kpis.verify', params: { update: r.id }, primary: true, done: 'Verified' }],
      });
    }
    // Updates that came without a known company (rank 60).
    const companies = util.rows(app, "SELECT DISTINCT c.id AS id, c.name AS name FROM holdings h JOIN companies c ON c.id = h.company WHERE h.deleted_at = '' AND h.status = 'active' ORDER BY c.name LIMIT 20", { id: '', name: '' });
    for (const r of util.findMany(app, 'updates', "company = '' && status = 'received'", 'received_at', 20)) {
      out.push({
        key: 'portfolio:assign:' + r.id,
        kind: 'task',
        title: 'Update from ' + (r.getString('from_name') || r.getString('from_email') || 'an unknown sender'),
        figures: [{ label: 'Subject', value: util.clip(r.getString('subject'), 60) }],
        chips: [{ label: 'Which company?', tone: 'warn' }],
        rank: 60,
        at: r.getString('received_at'),
        href: '#/portfolio/updates/' + r.id,
        data: { update: r.id },
        actions: [
          { label: 'File to', op: 'updates.assign', params: { update: r.id }, primary: true, choose: { param: 'company', options: companies.map((c) => ({ value: c.id, label: c.name })) } },
          { label: 'Dismiss', op: 'updates.dismiss', params: { update: r.id } },
        ],
      });
    }
  }
  // Mark invested: deals the committee decided to invest in, still open, with no holding yet (rank 30).
  if (edit && auth.can(ctx, 'pipeline', 'edit')) {
    for (const d of util.findMany(app, 'deals', "status = 'open' && deleted_at = '' && (stage = 'ic' || stage = 'term_sheet' || stage = 'closed')", 'stage_entered_at', 100)) {
      if (!auth.dealVisible(ctx, d)) continue;
      if (util.findOne(app, 'holdings', "deal = {:d} && deleted_at = ''", { d: d.id }) !== null) continue;
      const dec = L('lib_committee').decisionOf(app, d.id);
      if (!dec || dec.outcome !== 'invest' || Number(dec.conditions_open) > 0) continue;
      const c = P().companyMini(app, d.getString('company')) || {};
      const ccy = d.getString('currency') || P().baseCurrency(app);
      const figs = [];
      if (d.getInt('check_minor') > 0) figs.push({ label: 'Check', value: P().short(d.getInt('check_minor'), ccy) });
      if (P().INSTRUMENT_LABELS[d.getString('instrument')]) figs.push({ label: 'Instrument', value: P().INSTRUMENT_LABELS[d.getString('instrument')] });
      out.push({
        key: 'portfolio:invest:' + d.id,
        kind: 'task',
        title: (c.name || d.getString('name')) + ': Mark invested',
        figures: figs,
        chips: [{ label: 'IC: invest', tone: 'good' }],
        rank: 30,
        at: d.getString('stage_entered_at'),
        href: '#/deals/' + d.getString('number') + '?tab=investment',
        data: { deal: d.id, number: d.getString('number') },
        actions: [{ label: 'Mark invested', op: 'holdings.create-from-deal', params: { deal: d.getString('number') }, primary: true, confirm: true }],
      });
    }
  }
  // Alerts (rank 50).
  for (const a of util.findMany(app, 'alerts', "status = 'open'", 'fired_at', 100)) {
    if (!seeCompany(a.getString('company'))) continue;
    const v = K().alertView(app, a);
    const f = v.figure || {};
    const figs = [];
    if (f.unit === 'months') {
      figs.push({ label: 'Runway', value: Number(f.value).toFixed(1) + ' mo' });
      figs.push({ label: 'Threshold', value: f.threshold + ' mo' });
      if (f.cash_minor !== null && f.cash_minor !== undefined) figs.push({ label: 'Cash', value: P().short(f.cash_minor, f.currency) });
    } else if (f.unit === 'ppm') {
      figs.push({ label: 'Burn change', value: '+' + Math.round(Number(f.value) / 10000) + '%' });
      figs.push({ label: 'Threshold', value: Math.round(Number(f.threshold) / 10000) + '%' });
    } else if (f.unit === 'days') {
      figs.push({ label: 'Days since', value: String(f.value) });
      figs.push({ label: 'Threshold', value: String(f.threshold) });
    }
    out.push({
      key: 'portfolio:alert:' + a.id,
      kind: 'alert',
      card: 'alert',
      title: (v.company ? v.company.name + ': ' : '') + v.title,
      figures: figs,
      chips: [{ label: v.level === 'bad' ? 'Urgent' : 'Watch', tone: v.level === 'bad' ? 'bad' : 'warn' }],
      rank: 50,
      at: a.getString('fired_at'),
      href: '#/portfolio/' + a.getString('company'),
      data: { alert: v },
      actions: edit ? [{ label: 'Acknowledge', op: 'alerts.ack', params: { alert: a.id }, primary: true }] : [],
    });
  }
  // My asks (rank 60).
  for (const a of util.findMany(app, 'asks', "owner = {:m} && status != 'done'", 'created', 50, { m: ctx.memberId })) {
    if (!seeCompany(a.getString('company'))) continue;
    const v = askView(app, a);
    out.push({
      key: 'portfolio:ask:' + a.id,
      kind: 'task',
      title: (v.company ? v.company.name + ': ' : '') + v.title,
      figures: v.due_day !== '' ? [{ label: 'Due', value: v.due_day }] : [],
      chips: [{ label: v.kind.charAt(0).toUpperCase() + v.kind.slice(1), tone: 'neutral' }].concat(v.status === 'in_progress' ? [{ label: 'In progress', tone: 'good' }] : []),
      rank: 60,
      at: a.getString('created'),
      href: '#/portfolio/' + a.getString('company') + '?tab=asks',
      data: { ask: v },
      actions: [{ label: 'Done', op: 'asks.update', params: { ask: a.id, status: 'done' }, primary: true }].concat(v.status === 'open' ? [{ label: 'Start', op: 'asks.update', params: { ask: a.id, status: 'in_progress' } }] : []),
    });
  }
  return out;
}

/** Timeline items of a company from updates, verified periods, alerts and board meetings. */
function timelineItems(ctx, companyId) {
  const util = u();
  const app = ctx.app;
  const items = [];
  for (const r of util.findMany(app, 'updates', "company = {:c} && status != 'dismissed'", '-received_at', 50, { c: companyId })) items.push({ at: r.getString('received_at'), module: 'portfolio', kind: 'update', title: 'Update: ' + (r.getString('subject') || 'founder update'), href: '#/portfolio/' + companyId + '?tab=updates&update=' + r.id, icon: 'Mail', ref: 'updates:' + r.id });
  for (const a of util.findMany(app, 'alerts', 'company = {:c}', '-fired_at', 50, { c: companyId })) items.push({ at: a.getString('fired_at'), module: 'portfolio', kind: 'alert', title: a.getString('title'), href: '#/portfolio/' + companyId, icon: 'TriangleAlert', ref: 'alerts:' + a.id });
  for (const b of util.findMany(app, 'board_meetings', 'company = {:c}', '-day', 50, { c: companyId })) items.push({ at: util.atOf(app, b.getString('day'), b.getString('time') || '09:00'), module: 'portfolio', kind: 'board', title: b.getString('title') || 'Board meeting', href: '#/portfolio/' + companyId + '?tab=board', icon: 'Presentation', ref: 'board_meetings:' + b.id });
  return items;
}

module.exports = {
  CADENCES: CADENCES,
  ASK_KINDS: ASK_KINDS,
  ASK_STATUSES: ASK_STATUSES,
  STEP_LABELS: STEP_LABELS,
  DEFAULT_METRICS: DEFAULT_METRICS,
  DEFAULT_SUBJECT: DEFAULT_SUBJECT,
  DEFAULT_BODY: DEFAULT_BODY,
  templateOf: templateOf,
  fill: fill,
  lastPeriodEnd: lastPeriodEnd,
  periodLabel: periodLabel,
  recipientsOf: recipientsOf,
  requestView: requestView,
  step: step,
  requestsDue: requestsDue,
  opSchedule: opSchedule,
  opSendNow: opSendNow,
  opRequestsList: opRequestsList,
  opTemplateSave: opTemplateSave,
  updateView: updateView,
  snippetOf: snippetOf,
  askRead: askRead,
  extractCheck: extractCheck,
  briefCheck: briefCheck,
  opAdd: opAdd,
  opUpdatesList: opUpdatesList,
  opUpdatesGet: opUpdatesGet,
  opAssign: opAssign,
  previewAssign: previewAssign,
  opDismiss: opDismiss,
  parseFrom: parseFrom,
  fileMessage: fileMessage,
  companyOfSender: companyOfSender,
  portfolioSenders: portfolioSenders,
  sweep: sweep,
  opSweep: opSweep,
  askView: askView,
  opAsksList: opAsksList,
  opAskSave: opAskSave,
  previewAsk: previewAsk,
  opAskUpdate: opAskUpdate,
  opAskReorder: opAskReorder,
  boardView: boardView,
  opBoardList: opBoardList,
  opBoardSave: opBoardSave,
  previewBoard: previewBoard,
  opBriefSave: opBriefSave,
  briefIfDue: briefIfDue,
  boardDue: boardDue,
  needsYou: needsYou,
  timelineItems: timelineItems,
};
