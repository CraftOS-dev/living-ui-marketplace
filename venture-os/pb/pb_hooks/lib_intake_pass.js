/// <reference path="../pb_data/types.d.ts" />
/**
 * Passing (SPEC 7.6): a reason chip (one click), an optional criterion and
 * revisit milestone or day; your AI agent drafts the pass email (trigger
 * pass_draft { pass_id }: what we liked, what we are not convinced of, what would
 * change our view) into an outbound draft the person who passed approves
 * and sends from Next. A person may write it at once from the firm's
 * template instead (passes.write). On the revisit day Next asks Re-open or
 * Keep passed.
 *
 * The email's state follows its outbound message: waiting (your AI agent
 * drafting), draft, approved, sent, failed, cancelled; none when there is
 * nobody to write to or the person chose no email.
 */

const REASONS = [
  { value: 'team', label: 'Team', phrase: 'the team for this stage' },
  { value: 'market', label: 'Market', phrase: 'the market' },
  { value: 'product', label: 'Product', phrase: 'the product' },
  { value: 'traction', label: 'Traction', phrase: 'traction so far' },
  { value: 'valuation', label: 'Valuation', phrase: 'the valuation' },
  { value: 'thesis_fit', label: 'Fit with thesis', phrase: 'fit with our current thesis' },
  { value: 'timing', label: 'Timing', phrase: 'timing for our fund' },
  { value: 'other', label: 'Other', phrase: 'our current priorities' },
];
const REASON_KEYS = REASONS.map((r) => r.value);
const OPEN_MAIL = ['draft', 'approved', 'sending', 'failed'];

const TEMPLATE = 'Hi {first_name},\n\nThank you for sending us {company}. We enjoyed learning about what you are building.\n\nAfter a careful look we decided not to invest at this stage. The main reason is {reason}{criterion}.\n\nWhat would change our view: {milestone}.\n\nWe would be glad to hear from you as things progress.\n\nBest,\n{sender}\n{firm}';

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function I() {
  return L('lib_intake');
}

function reasonLabel(key) {
  for (const r of REASONS) if (r.value === key) return r.label;
  return key;
}

/** The reason chips the firm uses (settings intake.pass_reasons), in order. */
function reasonOptions(app) {
  const s = L('lib_settings').module(app, 'intake');
  const keys = Array.isArray(s.pass_reasons) ? s.pass_reasons.filter((k) => REASON_KEYS.indexOf(k) >= 0) : REASON_KEYS;
  return (keys.length > 0 ? keys : REASON_KEYS).map((k) => ({ value: k, label: reasonLabel(k) }));
}

/**
 * The email's state from the stored state and its outbound message. An
 * email still waiting for your AI agent shows failed (a person writes it)
 * when it could not draft it, nobody picked the ask up in 24 hours, or the
 * firm is a demo (it never asks).
 */
function mailState(app, p) {
  const st = p.getString('email_state');
  const oid = p.getString('outbound');
  if (oid === '') {
    if (st !== 'waiting') return st;
    const A = L('lib_agent');
    const e = A.state(p, 'pass_draft');
    if (e === null) return L('lib_mail').demo(app) ? 'failed' : st;
    return e.error || (!e.done_at && !A.pending(p, 'pass_draft')) ? 'failed' : st;
  }
  const o = u().byId(app, 'outbound', oid);
  if (o === null) return st;
  const os = o.getString('status');
  return os === 'sending' ? 'approved' : os;
}

function passOut(ctx, p) {
  const app = ctx.app;
  const R = L('lib_records');
  let outbound = null;
  if (p.getString('outbound') !== '') {
    const o = u().byId(app, 'outbound', p.getString('outbound'));
    if (o !== null) outbound = L('lib_outbound').view(app, o);
  }
  return {
    id: p.id,
    item: p.getString('item'),
    deal: p.getString('deal') !== '' ? R.mini(app, 'deals', p.getString('deal')) : null,
    company: R.mini(app, 'companies', p.getString('company')),
    reason: p.getString('reason'),
    reason_label: reasonLabel(p.getString('reason')),
    criterion: p.getString('criterion'),
    revisit_milestone: p.getString('revisit_milestone'),
    revisit_day: p.getString('revisit_day'),
    revisit_state: p.getString('revisit_state'),
    note: p.getString('note'),
    email_state: mailState(app, p),
    to: u().jsonOf(p, 'to', []) || [],
    outbound: outbound,
    agent: L('lib_agent').view(p, ['pass_draft']),
    decided_at: p.getString('decided_at'),
    member: R.mini(app, 'members', p.getString('member')),
    actor: p.getString('actor'),
  };
}

/** Who gets the pass email: the founders' emails, else the person who sent the deal. */
function recipientsOf(app, rec) {
  const util = u();
  const out = [];
  for (const x of util.jsonOf(rec, 'people', []) || []) {
    if (!x || x.role !== 'founder') continue;
    const pr = util.byId(app, 'people', x.person);
    if (pr !== null && pr.getString('email') !== '' && out.indexOf(pr.getString('email')) < 0) out.push(pr.getString('email'));
  }
  if (out.length === 0 && rec.getString('source_person') !== '') {
    const pr = util.byId(app, 'people', rec.getString('source_person'));
    if (pr !== null && pr.getString('email') !== '') out.push(pr.getString('email'));
  }
  return out.slice(0, 5);
}

function toParam(p) {
  const util = u();
  const raw = util.list(p, 'to');
  if (raw === undefined) return null;
  const out = [];
  for (const x of raw) {
    const e = String(x || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e)) throw util.fail(400, '"' + util.clip(e, 80) + '" is not an email address.', 'invalid_param', { param: 'to' });
    if (out.indexOf(e) < 0) out.push(e);
  }
  return out;
}

/** The facts and fit at the time of the pass (anti-portfolio keeps them). */
function snapshotOf(ctx, rec) {
  const map = I().factsOf(ctx.app, [rec.id])[rec.id] || {};
  const facts = {};
  for (const k of Object.keys(map)) facts[k] = { value: map[k].value, currency: map[k].currency, grade: map[k].grade };
  const fit = I()
    .fitOf(ctx.app, map)
    .map((f) => ({ thesis: f.thesis, state: f.state, counts: f.counts }));
  return { facts: facts, fit: fit, one_liner: rec.getString('one_liner'), name: rec.getString('name'), number: rec.getString('number'), licence: rec.getString('licence') };
}

/** intake.pass: one reason chip (and optional criterion, revisit); your AI agent drafts the email. Bulk with --items. */
function opPass(ctx, p) {
  const util = u();
  const app = ctx.app;
  I().guardDecide(ctx);
  const reason = util.req(p, 'reason');
  if (REASON_KEYS.indexOf(reason) < 0) throw util.fail(400, 'reason must be one of: ' + REASON_KEYS.join(', ') + '.', 'invalid_param', { param: 'reason', allowed: REASON_KEYS });
  const refs = util.list(p, 'items');
  const one = util.str(p, 'item', '');
  const ids = refs !== undefined && refs.length > 0 ? refs.map(String) : one !== '' ? [one] : [];
  if (ids.length === 0) throw util.fail(400, 'item is required (or items, a JSON list).', 'missing_param', { param: 'item' });
  if (ids.length > 100) throw util.fail(400, 'At most 100 items at once.', 'too_many');
  const criterion = util.squash(util.text(p, 'criterion', 300, ''));
  const milestone = util.squash(util.text(p, 'revisit_milestone', 300, ''));
  const revisit = util.day(p, 'revisit_day', '');
  if (revisit !== '' && revisit <= util.today(app)) throw util.fail(400, 'revisit_day must be after today.', 'invalid_param', { param: 'revisit_day' });
  const email = util.bool(p, 'email', true);
  const to = toParam(p);
  if (to !== null && ids.length > 1) throw util.fail(400, 'to is for one item; a bulk pass writes to each item\'s founders.', 'invalid_param', { param: 'to' });
  const note = util.text(p, 'note', 2000, '');
  const recs = ids.map((r) => I().visible(ctx, r));
  const out = [];
  for (const rec of recs) {
    const st = rec.getString('status');
    if (st !== 'new' && st !== 'held') throw util.fail(409, rec.getString('number') + ' is already ' + st + '; it cannot be passed.', 'not_open', { item: rec.id, status: st });
  }
  for (const rec of recs) {
    const recipients = to !== null ? to : recipientsOf(app, rec);
    const pr = util.newRecord(app, 'passes');
    pr.set('item', rec.id);
    pr.set('company', rec.getString('company'));
    pr.set('reason', reason);
    pr.set('criterion', criterion);
    pr.set('revisit_milestone', milestone);
    pr.set('revisit_day', revisit);
    pr.set('revisit_state', revisit !== '' ? 'open' : 'none');
    pr.set('note', note);
    pr.set('email_state', email && recipients.length > 0 ? 'waiting' : 'none');
    pr.set('to', recipients);
    pr.set('snapshot', snapshotOf(ctx, rec));
    pr.set('decided_at', util.nowIso());
    pr.set('actor', 'person');
    pr.set('member', ctx.memberId);
    app.save(pr);
    // Pass with an email asks your AI agent for the draft (the person who passed asked for it).
    if (email && recipients.length > 0 && !ctx.dryRun) L('lib_agent').ask(app, 'pass_draft', pr, {}, { by: ctx.memberId });
    const fresh = app.findRecordById('intake_items', rec.id);
    fresh.set('status', 'passed');
    fresh.set('pass', pr.id);
    fresh.set('revisit_day', revisit);
    fresh.set('hold_until', '');
    fresh.set('decided_by', ctx.memberId);
    fresh.set('decided_at', util.nowIso());
    app.save(fresh);
    if (!ctx.dryRun) L('lib_events').emit(ctx, 'intake.passed', { item: rec.id, pass: pr.id });
    out.push({ rec: fresh, pass: pr });
  }
  L('lib_audit').note(ctx, { collection: 'intake_items', record: out[0].rec.id, summary: 'Passed ' + out.map((x) => x.rec.getString('number')).join(', ') + ' (' + reasonLabel(reason) + ')' });
  if (out.length === 1) return { item: I().detail(ctx, out[0].rec), pass: passOut(ctx, out[0].pass) };
  return { items: out.map((x) => ({ id: x.rec.id, number: x.rec.getString('number'), pass: x.pass.id, email_state: x.pass.getString('email_state') })), passed: out.length };
}

function passRef(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pid = util.str(p, 'pass', '');
  const dealRef = util.str(p, 'deal', '');
  let pr = null;
  if (pid !== '') {
    pr = util.byId(app, 'passes', pid);
    if (pr === null) throw util.fail(404, 'No pass ' + pid + '. passes.list --company <name> lists them.', 'not_found', { param: 'pass' });
  } else if (dealRef !== '') {
    const d = L('lib_deals').ref(app, dealRef);
    L('lib_deals').guard(ctx, d);
    const rows = util.findMany(app, 'passes', 'deal = {:d}', '-decided_at', 1, { d: d.id });
    if (rows.length === 0) throw util.fail(404, d.getString('number') + ' has no pass. A person passes it (passes.create); your AI agent proposes it with passes.request.', 'not_found', { param: 'deal' });
    pr = rows[0];
  } else {
    const rec = I().visible(ctx, util.req(p, 'item'));
    if (rec.getString('pass') === '') throw util.fail(404, rec.getString('number') + ' has no pass.', 'not_found', { param: 'item' });
    pr = util.byId(app, 'passes', rec.getString('pass'));
    if (pr === null) throw util.fail(404, rec.getString('number') + ' has no pass.', 'not_found', { param: 'item' });
  }
  if (pr.getString('deal') !== '') {
    // A deal's pass: the deal must still be passed.
    const d = util.byId(app, 'deals', pr.getString('deal'));
    if (d === null) throw util.fail(404, 'The deal of this pass is gone.', 'not_found');
    L('lib_deals').guard(ctx, d);
    if (d.getString('status') !== 'passed') throw util.fail(409, d.getString('number') + ' is no longer passed (' + d.getString('status') + '); no email to write.', 'not_open');
    const item = pr.getString('item') !== '' ? util.byId(app, 'intake_items', pr.getString('item')) : null;
    return { pass: pr, item: item, deal: d };
  }
  I().visible(ctx, pr.getString('item'));
  const item = app.findRecordById('intake_items', pr.getString('item'));
  if (item.getString('status') !== 'passed' || item.getString('pass') !== pr.id) throw util.fail(409, item.getString('number') + ' is no longer passed (' + item.getString('status') + '); no email to write.', 'not_open');
  return { pass: pr, item: item, deal: null };
}

/** The name and display number of what a pass is about (its deal, else its Inbox item). */
function subjectOf(app, x) {
  if (x.deal) {
    const c = u().byId(app, 'companies', x.deal.getString('company'));
    return { name: (c !== null ? c.getString('name') : '') || x.deal.getString('name'), number: x.deal.getString('number') };
  }
  return { name: x.item.getString('name'), number: x.item.getString('number') };
}

/** The founders' emails of a deal (its founders, else its company's), else its source person's, else its Inbox item's recipients. */
function dealRecipients(app, d) {
  const util = u();
  const out = [];
  for (const r of util.findMany(app, 'deal_people', "deal = {:d} && role = 'founder' && person != ''", 'created', 10, { d: d.id })) {
    const pr = util.byId(app, 'people', r.getString('person'));
    if (pr !== null && pr.getString('email') !== '' && out.indexOf(pr.getString('email')) < 0) out.push(pr.getString('email'));
  }
  if (out.length === 0) {
    for (const e of util.findMany(app, 'employments', 'company = {:c} && founder = true', 'created', 10, { c: d.getString('company') })) {
      const pr = util.byId(app, 'people', e.getString('person'));
      if (pr !== null && pr.getString('email') !== '' && out.indexOf(pr.getString('email')) < 0) out.push(pr.getString('email'));
    }
  }
  if (out.length === 0 && d.getString('source_person') !== '') {
    const pr = util.byId(app, 'people', d.getString('source_person'));
    if (pr !== null && pr.getString('email') !== '') out.push(pr.getString('email'));
  }
  if (out.length === 0 && d.getString('intake_item') !== '') {
    const it = util.byId(app, 'intake_items', d.getString('intake_item'));
    if (it !== null) return recipientsOf(app, it);
  }
  return out.slice(0, 5);
}

/** A reason chip by key or label ("valuation", "Valuation", "Fit with thesis"). */
function reasonKey(text) {
  const t = String(text || '').trim().toLowerCase();
  const hit = REASONS.find((r) => r.value === t || r.label.toLowerCase() === t);
  return hit ? hit.value : '';
}

/**
 * passes.create (people) and passes.request (your AI agent's proposal): pass a deal with one
 * reason chip, an optional criterion and revisit. The deal is passed (lib_deals.setStatus), the
 * pass is kept (anti-portfolio, revisit) and your AI agent is asked to draft the email (pass_draft).
 */
function opCreate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const d = L('lib_deals').ref(app, util.req(p, 'deal'));
  L('lib_deals').guard(ctx, d);
  const st = d.getString('status');
  if (st !== 'open' && st !== 'hold') throw util.fail(409, d.getString('number') + ' is ' + st + '; only an open or held deal can be passed.', 'not_open', { deal: d.getString('number'), status: st });
  const reason = reasonKey(util.req(p, 'reason'));
  if (reason === '') throw util.fail(400, 'reason is one of: ' + REASON_KEYS.join(', ') + '.', 'invalid_param', { param: 'reason', allowed: REASON_KEYS });
  const criterion = util.squash(util.text(p, 'criterion', 300, ''));
  const milestone = util.squash(util.text(p, 'revisit_milestone', 300, ''));
  const revisit = util.day(p, 'revisit_day', '');
  if (revisit !== '' && revisit <= util.today(app)) throw util.fail(400, 'revisit_day must be after today.', 'invalid_param', { param: 'revisit_day' });
  const email = util.bool(p, 'email', true);
  const to = toParam(p);
  const recipients = to !== null ? to : dealRecipients(app, d);
  const note = util.text(p, 'note', 2000, '');
  const c = util.byId(app, 'companies', d.getString('company'));
  const name = (c !== null ? c.getString('name') : '') || d.getString('name');
  L('lib_deals').setStatus(ctx, d.id, 'passed', reasonLabel(reason) + (criterion !== '' ? ': ' + criterion : ''));
  const itemId = d.getString('intake_item') !== '' && util.byId(app, 'intake_items', d.getString('intake_item')) !== null ? d.getString('intake_item') : '';
  const pr = util.newRecord(app, 'passes');
  pr.set('item', itemId);
  pr.set('deal', d.id);
  pr.set('company', d.getString('company'));
  pr.set('reason', reason);
  pr.set('criterion', criterion);
  pr.set('revisit_milestone', milestone);
  pr.set('revisit_day', revisit);
  pr.set('revisit_state', revisit !== '' ? 'open' : 'none');
  pr.set('note', note);
  pr.set('email_state', email ? 'waiting' : 'none');
  pr.set('to', recipients);
  pr.set('snapshot', { name: name, number: d.getString('number'), stage: d.getString('stage'), round: util.jsonOf(d, 'round', {}) || {}, currency: d.getString('currency') });
  pr.set('decided_at', util.nowIso());
  pr.set('actor', 'person');
  pr.set('member', ctx.memberId);
  app.save(pr);
  if (email && !ctx.dryRun) L('lib_agent').ask(app, 'pass_draft', pr, {}, { by: ctx.memberId });
  L('lib_audit').note(ctx, { collection: 'passes', record: pr.id, summary: 'Passed ' + d.getString('number') + ' (' + reasonLabel(reason) + ')' });
  const words = !email ? 'No email.' : recipients.length > 0 ? 'Your AI agent drafts the pass email to ' + recipients.join(', ') + '; it waits in Next for approval.' : 'Your AI agent drafts the pass email; no founder email is on file, so it asks who gets it.';
  return { deal: { id: d.id, number: d.getString('number'), name: name, status: 'passed' }, pass: passOut(ctx, app.findRecordById('passes', pr.id)), email: words };
}

/** The proposal of your AI agent's passes.request: the deal, the reason, who gets the email. */
function previewCreate(ctx, params) {
  const util = u();
  const app = ctx.app;
  const P = L('lib_proposals');
  const d = L('lib_deals').ref(app, params.deal);
  const c = util.byId(app, 'companies', d.getString('company'));
  const name = (c !== null ? c.getString('name') : '') || d.getString('name');
  const reason = reasonKey(params.reason);
  const to = params.to ? toParam({ to: params.to }) || [] : dealRecipients(app, d);
  const fields = [P.line('Status', d.getString('status'), 'passed', 'text', 'status'), P.line('Reason', '', reasonLabel(reason) + (params.criterion ? ': ' + params.criterion : ''), 'text', 'reason')];
  if (params.revisit_milestone || params.revisit_day) fields.push(P.line('Revisit', '', [params.revisit_milestone || '', params.revisit_day || ''].filter((x) => x).join(', '), 'text', 'revisit'));
  fields.push(P.line('Pass email to', '', to.length > 0 ? to.join(', ') : 'nobody on file yet', 'text', 'to'));
  const notes = ['Accepting passes the deal as you; your AI agent then drafts the pass email for you to approve.'];
  if (params.note) notes.unshift(String(params.note));
  return { label: 'Pass: ' + name, ref: d.getString('number'), target: 'deals:' + d.id, fields: fields.filter((x) => x !== null), notes: notes, risk: 'high' };
}

/** A passed deal reopened (deal.reopened): its pass closes like an Inbox item's, an unsent email is cancelled. */
function onDealReopened(ctx, pl) {
  const util = u();
  const d = util.byId(ctx.app, 'deals', String((pl && pl.deal) || ''));
  if (d === null || pl.from !== 'passed') return null;
  const rows = util.findMany(ctx.app, 'passes', 'deal = {:d}', '-decided_at', 1, { d: d.id });
  if (rows.length === 0) return null;
  onReopen(ctx, null, rows[0]);
  return rows[0].id;
}

/** passes.draft: the pass email as an outbound draft (kind pass) the person who passed approves. */
function opDraft(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (ctx.ownOnly) throw util.fail(403, 'Scouts do not write pass emails.', 'not_permitted');
  const x = passRef(ctx, p);
  const pr = x.pass;
  const subject = util.squash(util.text(p, 'subject', 300, ''));
  const body = typeof p.body === 'string' ? p.body : util.str(p, 'body', '');
  if (subject === '') throw util.fail(400, 'subject is required.', 'missing_param', { param: 'subject' });
  if (String(body).trim() === '') throw util.fail(400, 'body is required.', 'missing_param', { param: 'body' });
  const to = toParam(p) || util.jsonOf(pr, 'to', []) || [];
  if (to.length === 0) throw util.fail(400, 'Nobody to write to: no founder email is on file. Find the founder (deals.get, companies.get: people) and give --to \'["founder@company.com"]\', or say so with agent.cannot --trigger pass_draft --record <pass id> so the person who passed adds it.', 'missing_param', { param: 'to' });
  const O = L('lib_outbound');
  let view = null;
  if (pr.getString('outbound') !== '') {
    const o = util.byId(app, 'outbound', pr.getString('outbound'));
    if (o !== null) {
      const st = o.getString('status');
      if (st === 'sent' || st === 'approved' || st === 'sending') throw util.fail(409, 'This pass email was already ' + (st === 'sent' ? 'sent' : 'approved') + '.', 'already_sent');
      if (st === 'draft' || st === 'failed') {
        if (ctx.isAgent && (o.getString('actor') !== 'agent' || o.getInt('typed_chars') > 0)) throw util.fail(409, 'A person is writing this email; leave it to them.', 'person_draft');
        view = O.update(ctx, { outbound: o.id, subject: subject, body: body, to: to });
      }
    }
  }
  if (view === null) view = O.draft(ctx, { kind: 'pass', module: 'intake', to: to, subject: subject, body: body, ref_collection: 'passes', ref_id: pr.id, deal: pr.getString('deal'), approver: pr.getString('member') });
  const fresh = app.findRecordById('passes', pr.id);
  fresh.set('outbound', view.id);
  fresh.set('email_state', 'draft');
  fresh.set('to', to);
  app.save(fresh);
  if (ctx.isAgent) L('lib_agent').landed(app, 'pass_draft', fresh);
  L('lib_audit').note(ctx, { collection: 'passes', record: pr.id, summary: (ctx.isAgent ? 'Your AI agent drafted' : 'Drafted') + ' the pass email for ' + subjectOf(app, x).number });
  return { pass: passOut(ctx, fresh), outbound: view };
}

function firstName(app, rec) {
  const util = u();
  for (const x of rec.dealPeople ? [] : util.jsonOf(rec, 'people', []) || []) {
    if (!x || x.role !== 'founder') continue;
    const pr = util.byId(app, 'people', x.person);
    if (pr !== null && pr.getString('name') !== '') return pr.getString('name').split(' ')[0];
  }
  if (rec.getString('source_person') !== '') {
    const pr = util.byId(app, 'people', rec.getString('source_person'));
    if (pr !== null && pr.getString('name') !== '') return pr.getString('name').split(' ')[0];
  }
  return 'there';
}

/** The firm's template filled in (fixed placeholders only). */
function fromTemplate(ctx, rec0, pr, deal) {
  const util = u();
  // A deal that never came through the Inbox: its company name and source person stand in for the item.
  const rec = rec0 !== null && rec0 !== undefined ? rec0 : { dealPeople: true, getString: (k) => (k === 'name' ? subjectOf(ctx.app, { deal: deal }).name : k === 'source_person' ? deal.getString('source_person') : '') };
  const s = L('lib_settings').module(ctx.app, 'intake');
  const tpl = typeof s.pass_template === 'string' && s.pass_template.trim() !== '' ? s.pass_template : TEMPLATE;
  const r = REASONS.find((x) => x.value === pr.getString('reason')) || REASONS[REASONS.length - 1];
  const firm = L('lib_settings').row(ctx.app).getString('firm_name');
  const vals = {
    first_name: firstName(ctx.app, rec),
    company: rec.getString('name'),
    reason: r.phrase,
    criterion: pr.getString('criterion') !== '' ? ' (' + pr.getString('criterion') + ')' : '',
    milestone: pr.getString('revisit_milestone') !== '' ? pr.getString('revisit_milestone') : 'progress toward your next round',
    sender: ctx.name || '',
    firm: firm,
  };
  let body = tpl;
  for (const k of Object.keys(vals)) body = body.split('{' + k + '}').join(vals[k]);
  const subject = rec.getString('email_subject') !== '' ? util.clip('Re: ' + rec.getString('email_subject').replace(/^re:\s*/i, ''), 300) : rec.getString('name') + ' and ' + firm;
  return { subject: subject, body: body };
}

/** passes.write: a person writes the pass email now, from the firm's template. */
function opWrite(ctx, p) {
  const util = u();
  const app = ctx.app;
  I().guardDecide(ctx);
  const x = passRef(ctx, p);
  const pr = x.pass;
  const O = L('lib_outbound');
  if (pr.getString('outbound') !== '') {
    const o = util.byId(app, 'outbound', pr.getString('outbound'));
    if (o !== null && OPEN_MAIL.indexOf(o.getString('status')) >= 0) return { pass: passOut(ctx, pr), outbound: O.view(app, o) };
    if (o !== null && o.getString('status') === 'sent') throw util.fail(409, 'This pass email was already sent.', 'already_sent');
  }
  const to = toParam(p) || util.jsonOf(pr, 'to', []) || [];
  if (to.length === 0) throw util.fail(400, 'Who gets it? Give --to \'["founder@company.com"]\'.', 'missing_param', { param: 'to' });
  const t = fromTemplate(ctx, x.item, pr, x.deal);
  const view = O.draft(ctx, { kind: 'pass', module: 'intake', to: to, subject: t.subject, body: t.body, ref_collection: 'passes', ref_id: pr.id, deal: pr.getString('deal'), approver: ctx.memberId });
  const fresh = app.findRecordById('passes', pr.id);
  fresh.set('outbound', view.id);
  fresh.set('email_state', 'draft');
  fresh.set('to', to);
  app.save(fresh);
  // The person wrote it: the ask for a draft is answered (a late draft from your AI agent is refused).
  L('lib_agent').landed(app, 'pass_draft', fresh);
  L('lib_audit').note(ctx, { collection: 'passes', record: pr.id, summary: 'Wrote the pass email for ' + subjectOf(app, x).number });
  return { pass: passOut(ctx, fresh), outbound: view };
}

/** intake.keep: at the revisit, keep the deal passed. */
function opKeep(ctx, p) {
  const util = u();
  I().guardDecide(ctx);
  const rec = I().visible(ctx, util.req(p, 'item'));
  if (rec.getString('status') !== 'passed') throw util.fail(409, rec.getString('number') + ' is ' + rec.getString('status') + ', not passed.', 'not_open');
  const pr = rec.getString('pass') !== '' ? util.byId(ctx.app, 'passes', rec.getString('pass')) : null;
  if (pr !== null) {
    pr.set('revisit_state', 'kept');
    ctx.app.save(pr);
  }
  rec.set('revisit_day', '');
  ctx.app.save(rec);
  L('lib_audit').note(ctx, { collection: 'intake_items', record: rec.id, summary: 'Kept ' + rec.getString('number') + ' passed' });
  return { item: I().detail(ctx, rec) };
}

/** Reopening a passed item: the revisit closes and an unsent pass email is cancelled. */
function onReopen(ctx, rec, passRec) {
  const util = u();
  const app = ctx.app;
  const pr = passRec || util.byId(app, 'passes', rec.getString('pass'));
  if (pr === null) return;
  pr.set('revisit_state', pr.getString('revisit_state') === 'none' ? 'none' : 'reopened');
  if (pr.getString('outbound') !== '') {
    const o = util.byId(app, 'outbound', pr.getString('outbound'));
    if (o !== null && (o.getString('status') === 'draft' || o.getString('status') === 'failed' || o.getString('status') === 'approved')) {
      L('lib_outbound').cancel(ctx, { outbound: o.id });
      pr.set('email_state', 'cancelled');
    }
  } else if (pr.getString('email_state') === 'waiting' || pr.getString('email_state') === 'failed') pr.set('email_state', 'cancelled');
  app.save(pr);
}

/** agent.cannot on a pass email: without a draft the email waits for a person (Next asks them to write it). */
function onCannot(ctx, rec) {
  const util = u();
  const pr = util.byId(ctx.app, 'passes', rec.id);
  if (pr === null) return null;
  if (pr.getString('outbound') === '' && pr.getString('email_state') === 'waiting') {
    pr.set('email_state', 'failed');
    ctx.app.save(pr);
  }
  return pr.id;
}

/** outbound.sent / outbound.failed of a pass email. */
function onOutbound(ctx, pl) {
  const util = u();
  if (!pl || pl.module !== 'intake' || pl.ref_collection !== 'passes') return null;
  const pr = util.byId(ctx.app, 'passes', String(pl.ref_id || ''));
  if (pr === null) return null;
  const o = util.byId(ctx.app, 'outbound', String(pl.outbound || ''));
  pr.set('email_state', o !== null && o.getString('status') === 'sent' ? 'sent' : 'failed');
  if (pr.getString('outbound') === '') pr.set('outbound', String(pl.outbound || ''));
  ctx.app.save(pr);
  return pr.id;
}

/** Next: pass emails your AI agent could not draft wait for the person who passed. */
function nextItems(ctx) {
  const util = u();
  const app = ctx.app;
  const rows = util.rows(app, "SELECT p.id AS id, p.item AS item, p.member AS member, p.reason AS reason, p.decided_at AS decided_at, i.number AS number, i.name AS name FROM passes p JOIN intake_items i ON i.id = p.item WHERE p.deal = '' AND i.status = 'passed' AND i.pass = p.id AND p.email_state = 'failed' AND p.outbound = '' UNION ALL SELECT p.id AS id, p.item AS item, p.member AS member, p.reason AS reason, p.decided_at AS decided_at, d.number AS number, COALESCE(c.name, d.name) AS name FROM passes p JOIN deals d ON d.id = p.deal LEFT JOIN companies c ON c.id = d.company WHERE d.status = 'passed' AND p.email_state = 'failed' AND p.outbound = ''", { id: '', item: '', member: '', reason: '', decided_at: '', number: '', name: '' });
  const out = [];
  for (const r of rows) {
    if (r.member !== ctx.memberId && !ctx.owner) continue;
    out.push({
      key: 'intake:passmail:' + r.id,
      kind: 'draft',
      title: 'Pass email: ' + r.name,
      figures: [{ label: 'Reason', value: reasonLabel(r.reason) }],
      chips: [{ label: 'Not drafted', tone: 'warn' }],
      agent: false,
      rank: 30,
      at: r.decided_at,
      href: r.number.indexOf('D-') === 0 ? '#/deals/' + r.number : '#/inbox?item=' + r.number,
      data: { item: r.item, pass: r.id, number: r.number },
      actions: [{ label: 'Write', op: 'passes.write', params: { pass: r.id }, primary: true }],
    });
  }
  return out;
}

/** passes.list: passes with their reasons (anti-portfolio, reporting), counts by reason. */
function opList(ctx, p) {
  const util = u();
  if (ctx.ownOnly) throw util.fail(403, 'Scouts see the status of their own deals only.', 'not_permitted');
  const where = ['1 = 1'];
  const bind = {};
  const one = util.str(p, 'pass', '');
  if (one !== '') {
    where.push('p.id = {:id}');
    bind.id = one;
  }
  const reason = util.oneOf(p, 'reason', REASON_KEYS, '');
  if (reason !== '') {
    where.push('p.reason = {:r}');
    bind.r = reason;
  }
  const from = util.day(p, 'from_day', '');
  if (from !== '') {
    where.push('p.decided_at >= {:f}');
    bind.f = util.atOf(ctx.app, from, '00:00');
  }
  const to = util.day(p, 'to_day', '');
  if (to !== '') {
    where.push('p.decided_at < {:t}');
    bind.t = util.atOf(ctx.app, util.dayAdd(to, 1), '00:00');
  }
  const company = util.str(p, 'company', '');
  if (company !== '') {
    where.push('p.company = {:c}');
    bind.c = L('lib_records').resolve(ctx.app, 'companies', company).id;
  }
  const pg = util.page(p, 50, 300);
  const ids = util.rows(ctx.app, 'SELECT p.id FROM passes p WHERE ' + where.join(' AND ') + ' ORDER BY p.decided_at DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const byReason = {};
  for (const r of util.rows(ctx.app, 'SELECT p.reason AS reason, COUNT(*) AS n FROM passes p WHERE ' + where.join(' AND ') + ' GROUP BY p.reason', { reason: '', n: 0 }, bind)) byReason[r.reason] = r.n;
  const passes = ids.map((r) => {
    const pr = ctx.app.findRecordById('passes', r.id);
    const it = pr.getString('item') !== '' ? util.byId(ctx.app, 'intake_items', pr.getString('item')) : null;
    const d = pr.getString('deal') !== '' ? util.byId(ctx.app, 'deals', pr.getString('deal')) : null;
    const snap = util.jsonOf(pr, 'snapshot', {}) || {};
    return Object.assign(passOut(ctx, pr), { number: d !== null ? d.getString('number') : it !== null ? it.getString('number') : '', name: it !== null ? it.getString('name') : snap.name || '' });
  });
  return { passes: passes, by_reason: byReason, reasons: REASONS.map((r) => ({ value: r.value, label: r.label })) };
}

/** The deal a pass closed (its NDA decks are not read for the email), or ''. */
function dealOf(app, rec) {
  return rec.getString('deal');
}

/** agent.ask --trigger pass_draft --record <pass>: a pass whose email is not written or sent yet. */
function askCheck(ctx, rec) {
  const util = u();
  I().guardDecide(ctx);
  const st = mailState(ctx.app, rec);
  if (['draft', 'approved', 'sent'].indexOf(st) >= 0) throw util.fail(409, 'This pass email is already ' + (st === 'draft' ? 'drafted' : st) + '.', 'already_drafted');
  if (st === 'none' || st === 'cancelled') throw util.fail(409, 'This pass has no email to write.', 'no_email');
  return {};
}

module.exports = { opCreate: opCreate, previewCreate: previewCreate, onDealReopened: onDealReopened, reasonKey: reasonKey, dealRecipients: dealRecipients, REASONS: REASONS, REASON_KEYS: REASON_KEYS, TEMPLATE: TEMPLATE, reasonLabel: reasonLabel, reasonOptions: reasonOptions, mailState: mailState, passOut: passOut, recipientsOf: recipientsOf, opPass: opPass, opDraft: opDraft, opWrite: opWrite, opKeep: opKeep, onReopen: onReopen, onCannot: onCannot, dealOf: dealOf, askCheck: askCheck, onOutbound: onOutbound, nextItems: nextItems, opList: opList, fromTemplate: fromTemplate };
