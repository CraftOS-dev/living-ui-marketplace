/// <reference path="../pb_data/types.d.ts" />
/**
 * Outbound: every message the app sends (SPEC 12). Pass emails, intro
 * asks, founder requests, capital notices, LP packs, the digest, replies.
 * Your AI agent and people draft; only a person approves, and approving
 * sends at once (or within a minute when the pace limit or a transaction
 * holds it). Nothing leaves without a person.
 *
 *   draft(ctx, { kind, module, to, subject, body, attachments, ref_collection, ref_id, deal, approver }) -> view
 *   approve(ctx, id) -> view (people only; status sent, failed or approved when queued)
 *   cancel(ctx, id) -> view
 *
 * Sending: callAction('send_gmail', ...) through lib_mail.send with
 * confirmIrreversible; every attachment path is checked first (Gmail's
 * action skips missing paths silently); one send key per message and a
 * claim (approved -> sending) inside a transaction, so a retry or a second
 * approve never sends twice; at most 20 sends a minute; the result is
 * recorded from the bridge's answer (the HTTP 200 with error shape is a
 * failure), never from intent. A sent message emits outbound.sent, a
 * failed one outbound.failed ({ outbound, kind, module, ref_collection, ref_id, deal }).
 *
 * Attachments: a `files` record id (kernel-records lib_files.pathOf) or
 * { collection, id, field } naming a file field of any record.
 *
 * The AI-use disclosure: ai_chars counts the characters your AI agent
 * wrote, typed_chars those a person typed; a person's edit replaces the
 * changed middle of the text (common start and end kept).
 */

const KINDS = ['pass', 'intro', 'request', 'notice', 'lp_pack', 'digest', 'reply'];
const PER_MINUTE = 20;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function recipients(raw) {
  const util = u();
  let list = raw;
  if (typeof list === 'string') {
    const t = list.trim();
    list = t.charAt(0) === '[' ? JSON.parse(t) : t.split(/[,;]/);
  }
  if (!Array.isArray(list)) throw util.fail(400, 'to is a JSON list of email addresses.', 'invalid_param', { param: 'to' });
  const out = [];
  for (const x of list) {
    const e = String(x || '')
      .trim()
      .toLowerCase();
    if (e === '') continue;
    if (!EMAIL.test(e) || e.length > 160) throw util.fail(400, '"' + util.clip(e, 80) + '" is not an email address.', 'invalid_param', { param: 'to' });
    if (out.indexOf(e) < 0) out.push(e);
  }
  if (out.length === 0) throw util.fail(400, 'to needs at least one email address.', 'missing_param', { param: 'to' });
  if (out.length > 50) throw util.fail(400, 'At most 50 recipients in one message.', 'invalid_param', { param: 'to' });
  return out;
}

function attachmentsOf(raw) {
  const util = u();
  if (raw === undefined || raw === null || raw === '') return [];
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      throw util.fail(400, 'attachments is a JSON list of file ids or {"collection","id","field"}.', 'invalid_param', { param: 'attachments' });
    }
  }
  if (!Array.isArray(list)) throw util.fail(400, 'attachments is a JSON list.', 'invalid_param', { param: 'attachments' });
  if (list.length > 10) throw util.fail(400, 'At most 10 attachments.', 'invalid_param', { param: 'attachments' });
  return list.map((a, i) => {
    if (typeof a === 'string' && a !== '') return a;
    if (a && typeof a === 'object' && typeof a.collection === 'string' && typeof a.id === 'string' && typeof a.field === 'string') return { collection: a.collection, id: a.id, field: a.field };
    throw util.fail(400, 'attachments[' + i + '] is a file id or {"collection","id","field"}.', 'invalid_param', { param: 'attachments' });
  });
}

/** The local path of one attachment, or '' when it cannot be found. */
function pathOf(app, a) {
  const util = u();
  try {
    if (typeof a === 'string') return String(L('lib_files').pathOf(app, a) || '');
    const rec = util.byId(app, a.collection, a.id);
    if (rec === null) return '';
    const name = rec.getString(a.field);
    if (name === '') return '';
    const data = app.dataDir();
    const base = $filepath.isAbs(data) ? data : $filepath.join($os.getwd(), data);
    return $filepath.join(base, 'storage', rec.baseFilesPath(), name);
  } catch {
    return '';
  }
}

/** Resolve every attachment: { paths, missing: [labels] }. */
function resolve(app, list) {
  const paths = [];
  const missing = [];
  for (const a of list) {
    const p = pathOf(app, a);
    const label = typeof a === 'string' ? a : a.collection + ':' + a.id + ':' + a.field;
    if (p === '' || L('lib_mail').missingFiles([p]).length > 0) missing.push(label);
    else paths.push(p);
  }
  return { paths: paths, missing: missing };
}

function view(app, r) {
  const util = u();
  const ai = r.getInt('ai_chars');
  const typed = r.getInt('typed_chars');
  return {
    id: r.id,
    kind: r.getString('kind'),
    module: r.getString('module'),
    to: util.jsonOf(r, 'to', []) || [],
    subject: r.getString('subject'),
    body: r.getString('body'),
    attachments: util.jsonOf(r, 'attachments', []) || [],
    status: r.getString('status'),
    ref_collection: r.getString('ref_collection'),
    ref_id: r.getString('ref_id'),
    deal: r.getString('deal'),
    approver: r.getString('approver'),
    approved_by: r.getString('approved_by'),
    approved_at: r.getString('approved_at'),
    sent_at: r.getString('sent_at'),
    send_key: r.getString('send_key'),
    error: r.getString('error'),
    ai_chars: ai,
    typed_chars: typed,
    ai_share_ppm: ai + typed > 0 ? Math.round((ai * 1000000) / (ai + typed)) : 0,
    actor: r.getString('actor'),
    member: r.getString('member'),
    attempts: r.getInt('attempts'),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

function canSee(ctx, r) {
  const auth = L('lib_auth');
  // A role that sees only its own items: messages it wrote, or about a record it owns.
  if (ctx.ownOnly && r.getString('member') !== ctx.memberId && (r.getString('ref_id') === '' || !auth.recordVisible(ctx, r.getString('ref_collection'), r.getString('ref_id')))) return false;
  if (!auth.can(ctx, r.getString('module'), 'view') && r.getString('member') !== ctx.memberId) return false;
  if (r.getString('deal') !== '' && !auth.dealVisible(ctx, r.getString('deal'))) return false;
  return true;
}

function ref(ctx, id) {
  const util = u();
  const r = util.byId(ctx.app, 'outbound', String(id || ''));
  if (r === null || !canSee(ctx, r)) throw util.fail(404, 'No message ' + id + ' you can see. Run outbound.list.', 'not_found');
  return r;
}

/** Draft a message (your AI agent or a person). */
function draft(ctx, o) {
  const util = u();
  const auth = L('lib_auth');
  const kind = String(o.kind || '');
  if (KINDS.indexOf(kind) < 0) throw util.fail(400, 'kind must be one of: ' + KINDS.join(', '), 'invalid_param', { param: 'kind' });
  const module = String(o.module || '');
  if (auth.MODULES.indexOf(module) < 0) throw util.fail(400, 'module must be one of: ' + auth.MODULES.join(', '), 'invalid_param', { param: 'module' });
  auth.need(ctx, module, 'edit', 'draft messages for ' + (auth.MODULE_LABEL[module] || module));
  const subject = util.squash(String(o.subject || ''));
  if (subject === '' || subject.length > 300) throw util.fail(400, 'subject is required (at most 300 characters).', 'missing_param', { param: 'subject' });
  const body = String(o.body || '');
  if (body.trim() === '' || body.length > 100000) throw util.fail(400, 'body is required (at most 100,000 characters).', 'missing_param', { param: 'body' });
  const deal = o.deal ? auth.dealId(ctx.app, String(o.deal)) : '';
  if ((o.deal && deal === '') || (deal !== '' && !auth.dealVisible(ctx, deal))) throw util.fail(404, 'No deal ' + o.deal + ' you can see.', 'not_found', { param: 'deal' });
  if (o.ref_collection && o.ref_id && !auth.recordVisible(ctx, String(o.ref_collection), String(o.ref_id))) throw util.fail(404, 'No ' + o.ref_collection + ' record ' + o.ref_id + ' you can see.', 'not_found');
  let approver = '';
  if (o.approver) {
    const m = auth.memberRef(ctx.app, String(o.approver));
    approver = m.id;
  }
  const r = util.newRecord(ctx.app, 'outbound');
  r.set('kind', kind);
  r.set('module', module);
  r.set('to', recipients(o.to));
  r.set('subject', subject);
  r.set('body', body);
  r.set('attachments', attachmentsOf(o.attachments));
  r.set('status', 'draft');
  r.set('ref_collection', util.clip(o.ref_collection || '', 60));
  r.set('ref_id', util.clip(o.ref_id || '', 30));
  r.set('deal', util.clip(deal, 30));
  r.set('approver', approver);
  r.set('send_key', 'snd_' + $security.randomStringWithAlphabet(24, 'abcdefghijklmnopqrstuvwxyz0123456789'));
  r.set('ai_chars', ctx.isAgent ? body.length : 0);
  r.set('typed_chars', ctx.isAgent ? 0 : body.length);
  r.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  r.set('member', ctx.memberId || '');
  r.set('attempts', 0);
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'outbound', record: r.id, summary: (ctx.isAgent ? 'Your AI agent drafted' : 'Drafted') + ' a ' + kind.replace('_', ' ') + ' message: ' + util.clip(subject, 120) });
  return view(ctx.app, r);
}

/** A person's edit of the body: the changed middle counts as typed; the AI share shrinks by what was replaced. */
function editCounts(oldBody, newBody, ai, typed) {
  let pre = 0;
  while (pre < oldBody.length && pre < newBody.length && oldBody.charAt(pre) === newBody.charAt(pre)) pre++;
  let suf = 0;
  while (suf < oldBody.length - pre && suf < newBody.length - pre && oldBody.charAt(oldBody.length - 1 - suf) === newBody.charAt(newBody.length - 1 - suf)) suf++;
  const removed = oldBody.length - pre - suf;
  const inserted = newBody.length - pre - suf;
  const total = ai + typed;
  const aiRemoved = total > 0 ? Math.round((removed * ai) / total) : 0;
  return { ai: Math.max(0, ai - aiRemoved), typed: Math.max(0, typed - (removed - aiRemoved)) + inserted };
}

function update(ctx, p) {
  const util = u();
  const r = ref(ctx, typeof p === 'string' ? p : util.req(p, 'outbound'));
  const st = r.getString('status');
  if (st !== 'draft' && st !== 'failed') throw util.fail(409, 'This message is ' + st + '; only a draft can change.', 'conflict');
  if (ctx.isAgent && (r.getString('actor') !== 'agent' || r.getInt('typed_chars') > 0)) throw util.fail(403, 'Your AI agent changes only its own drafts no person edited.', 'not_permitted');
  if (!ctx.isAgent) L('lib_auth').need(ctx, r.getString('module'), 'edit', 'edit this message');
  if (util.has(p, 'to')) r.set('to', recipients(p.to));
  if (util.has(p, 'subject')) {
    const s = util.squash(util.str(p, 'subject', ''));
    if (s === '' || s.length > 300) throw util.fail(400, 'subject cannot be empty (at most 300 characters).', 'invalid_param', { param: 'subject' });
    r.set('subject', s);
  }
  if (util.has(p, 'body')) {
    const b = typeof p.body === 'string' ? p.body : String(p.body);
    if (b.trim() === '' || b.length > 100000) throw util.fail(400, 'body cannot be empty (at most 100,000 characters).', 'invalid_param', { param: 'body' });
    if (ctx.isAgent) {
      r.set('ai_chars', b.length);
    } else {
      const c = editCounts(r.getString('body'), b, r.getInt('ai_chars'), r.getInt('typed_chars'));
      r.set('ai_chars', c.ai);
      r.set('typed_chars', c.typed);
    }
    r.set('body', b);
  }
  if (util.has(p, 'attachments')) r.set('attachments', attachmentsOf(p.attachments));
  if (st === 'failed') {
    r.set('status', 'draft');
    r.set('error', '');
  }
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'outbound', record: r.id, summary: 'Edited the message: ' + util.clip(r.getString('subject'), 120) });
  return view(ctx.app, r);
}

function sentLastMinute(app) {
  return u().count(app, 'SELECT COUNT(*) AS n FROM outbound WHERE sent_at > {:t}', { t: new Date(Date.now() - 60000).toISOString() });
}

/**
 * Send one approved message now (outside any transaction). The claim
 * (approved -> sending) is a transaction of its own: a second caller finds
 * it claimed and sends nothing. Answers the view.
 */
function sendNow(app, id) {
  const util = u();
  if (app.isTransactional()) return view(app, app.findRecordById('outbound', id));
  if (sentLastMinute(app) >= PER_MINUTE) return view(app, app.findRecordById('outbound', id));
  let claimed = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('outbound', id);
    if (r.getString('status') !== 'approved') return;
    r.set('status', 'sending');
    r.set('attempts', r.getInt('attempts') + 1);
    tx.save(r);
    claimed = true;
  });
  const r = app.findRecordById('outbound', id);
  if (!claimed) return view(app, r);
  const files = resolve(app, util.jsonOf(r, 'attachments', []) || []);
  let res;
  if (files.missing.length > 0) res = { ok: false, reason: 'attachment_missing', error: 'Attachment not found: ' + files.missing.join(', ') };
  else res = L('lib_mail').send(app, { to: util.jsonOf(r, 'to', []) || [], subject: r.getString('subject'), body: r.getString('body'), attachments: files.paths });
  r.set('status', res.ok ? 'sent' : 'failed');
  r.set('sent_at', res.ok ? util.nowIso() : '');
  r.set('error', res.ok ? '' : util.clip(res.error || 'Not sent.', 2000));
  r.set('result', { ok: res.ok === true, reason: res.reason || '', status: res.status || 0, send_key: r.getString('send_key'), attachments: files.paths.length });
  app.save(r);
  const payload = { outbound: r.id, kind: r.getString('kind'), module: r.getString('module'), ref_collection: r.getString('ref_collection'), ref_id: r.getString('ref_id'), deal: r.getString('deal') };
  L('lib_events').emit(L('lib_auth').systemCtx(app), res.ok ? 'outbound.sent' : 'outbound.failed', payload);
  return view(app, r);
}

/** Approve (people only) and send at once when possible. */
function approve(ctx, p) {
  const util = u();
  const auth = L('lib_auth');
  const app = ctx.app;
  const r = ref(ctx, typeof p === 'string' ? p : util.req(p, 'outbound'));
  const st = r.getString('status');
  if (st === 'sent' || st === 'sending') throw util.fail(409, 'This message was already ' + (st === 'sent' ? 'sent' : 'being sent') + '; it is never sent twice.', 'already_sent');
  if (st !== 'draft' && st !== 'failed') throw util.fail(409, 'This message is ' + st + '.', 'conflict');
  auth.need(ctx, r.getString('module'), 'edit', 'approve this message');
  if (r.getString('approver') !== '' && r.getString('approver') !== ctx.memberId && !ctx.owner) throw util.fail(403, 'This message waits for another person to approve it.', 'not_permitted');
  const files = resolve(app, util.jsonOf(r, 'attachments', []) || []);
  if (files.missing.length > 0) throw util.fail(409, 'Not sent: an attachment is missing (' + files.missing.join(', ') + '). Fix the attachments first.', 'attachment_missing', { missing: files.missing });
  r.set('status', 'approved');
  r.set('approved_by', ctx.memberId);
  r.set('approved_at', util.nowIso());
  r.set('error', '');
  app.save(r);
  L('lib_audit').write(ctx, { op: 'outbound.approve', collection: 'outbound', record: r.id, summary: 'Approved the ' + r.getString('kind').replace('_', ' ') + ' message to ' + (util.jsonOf(r, 'to', []) || []).join(', ') + ': ' + util.clip(r.getString('subject'), 120) });
  return sendNow(app, r.id);
}

function cancel(ctx, p) {
  const util = u();
  const r = ref(ctx, typeof p === 'string' ? p : util.req(p, 'outbound'));
  const st = r.getString('status');
  // A message stuck in `sending` (the app stopped during the bridge call) can be closed by a person after five minutes; it is never resent.
  const stuck = st === 'sending' && Date.now() - Date.parse(r.getString('updated').replace(' ', 'T')) > 5 * 60000;
  if (st !== 'draft' && st !== 'approved' && st !== 'failed' && !(stuck && !ctx.isAgent)) throw util.fail(409, 'This message is ' + st + '; it cannot be cancelled.', 'conflict');
  if (ctx.isAgent && (r.getString('actor') !== 'agent' || st !== 'draft')) throw util.fail(403, 'Your AI agent cancels only its own drafts.', 'not_permitted');
  if (!ctx.isAgent && r.getString('member') !== ctx.memberId) L('lib_auth').need(ctx, r.getString('module'), 'edit', 'cancel this message');
  r.set('status', 'cancelled');
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'outbound', record: r.id, summary: 'Cancelled the message: ' + util.clip(r.getString('subject'), 120) });
  return view(ctx.app, r);
}

function list(ctx, p) {
  const util = u();
  const where = [];
  const bind = {};
  const add = (sql, k, v) => {
    where.push(sql);
    bind[k] = v;
  };
  const status = util.oneOf(p, 'status', ['draft', 'approved', 'sending', 'sent', 'failed', 'cancelled', 'open', 'all'], 'open');
  if (status === 'open') where.push("(status = 'draft' || status = 'approved' || status = 'sending' || status = 'failed')");
  else if (status !== 'all') add('status = {:s}', 's', status);
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind !== '') add('kind = {:k}', 'k', kind);
  const module = util.str(p, 'module', '');
  if (module !== '') add('module = {:m}', 'm', module);
  const rc = util.str(p, 'ref_collection', '');
  if (rc !== '') add('ref_collection = {:rc}', 'rc', rc);
  const ri = util.str(p, 'ref_id', '');
  if (ri !== '') add('ref_id = {:ri}', 'ri', ri);
  const deal = util.str(p, 'deal', '');
  if (deal !== '') add('deal = {:d}', 'd', L('lib_auth').dealId(ctx.app, deal) || deal);
  const pg = util.page(p, 50, 300);
  const all = util.findMany(ctx.app, 'outbound', where.length > 0 ? where.join(' && ') : '1=1', '-created', pg.offset + pg.limit + 500, bind);
  const rows = all.filter((r) => canSee(ctx, r));
  return { messages: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => view(ctx.app, r)), total: rows.length, hidden: all.length - rows.length };
}

function get(ctx, p) {
  const util = u();
  const r = ref(ctx, typeof p === 'string' ? p : util.req(p, 'outbound'));
  const files = resolve(ctx.app, util.jsonOf(r, 'attachments', []) || []);
  return { message: view(ctx.app, r), attachments_missing: files.missing };
}

/** The minute job: send approved messages that waited (pace or a transaction), oldest first. */
function sendQueued(app) {
  const util = u();
  let n = 0;
  for (const r of util.findMany(app, 'outbound', "status = 'approved'", 'approved_at', PER_MINUTE)) {
    if (sentLastMinute(app) >= PER_MINUTE) break;
    sendNow(app, r.id);
    n++;
  }
  return n;
}

/** Next items: drafts this person may approve (kind draft, rank 30). */
function nextItems(ctx) {
  const util = u();
  const auth = L('lib_auth');
  if (ctx.isAgent || !ctx.memberId) return [];
  const out = [];
  for (const r of util.findMany(ctx.app, 'outbound', "status = 'draft' || status = 'failed'", 'created', 300)) {
    if (!auth.can(ctx, r.getString('module'), 'edit') || !canSee(ctx, r)) continue;
    if (r.getString('approver') !== '' && r.getString('approver') !== ctx.memberId && !ctx.owner) continue;
    if (r.getString('deal') !== '' && !auth.dealVisible(ctx, r.getString('deal'))) continue;
    const to = util.jsonOf(r, 'to', []) || [];
    const failed = r.getString('status') === 'failed';
    out.push({
      key: 'kernel:outbound:' + r.id,
      kind: 'draft',
      card: 'draft',
      title: r.getString('subject'),
      figures: [{ label: 'To', value: (to[0] || '') + (to.length > 1 ? ' +' + (to.length - 1) : '') }],
      chips: (failed ? [{ label: 'Not sent', tone: 'bad' }] : []).concat(r.getString('actor') === 'agent' ? [{ label: 'Your AI agent', tone: 'agent' }] : []),
      agent: r.getString('actor') === 'agent',
      rank: 30,
      at: r.getString('created'),
      href: '#/next/draft/' + r.id,
      data: { outbound: r.id, kind: r.getString('kind'), to: to, subject: r.getString('subject'), body: r.getString('body'), error: r.getString('error'), edit: { op: 'outbound.update', params: { outbound: r.id }, fields: { subject: r.getString('subject'), body: r.getString('body') } } },
      actions: [
        { label: failed ? 'Send again' : 'Approve and send', op: 'outbound.approve', params: { outbound: r.id }, primary: true },
        { label: 'Cancel', op: 'outbound.cancel', params: { outbound: r.id } },
      ],
    });
  }
  return out;
}

/* ---------------------------------------------------------------- op wrappers */

function draftOp(ctx, p) {
  const util = u();
  // Your AI agent's intro ask belongs to an intro (its path, who asked), so it is drafted on one (SPEC qa-cli RULING CLI-04).
  if (ctx.isAgent && util.str(p, 'kind', '') === 'intro' && util.str(p, 'ref_collection', '') !== 'intros') throw util.fail(400, 'An intro ask is drafted on its intro: propose it with intros.request --target <person> --via <member> [--connector <person>] (a person accepts; the app then asks you for the draft: trigger intro_draft), then intros.draft --intro <id>. outbound.draft takes kind intro only for an existing intro (--ref_collection intros --ref_id <intro>).', 'use_intros', { op: 'intros.request' });
  // Likewise a pass email belongs to a pass (its reason, the anti-portfolio, the revisit; RULING CLI-03).
  if (ctx.isAgent && util.str(p, 'kind', '') === 'pass' && util.str(p, 'ref_collection', '') !== 'passes') throw util.fail(400, 'A pass email is drafted on its pass: when a person asked you to pass a deal, propose it with passes.request --deal <D-0007> --reason <chip> --criterion "<their words>" [--to \'["founder@x.com"]\']; accepting passes the deal and asks you for the email (trigger pass_draft): then passes.draft --pass <id>. For a deal already passed: passes.draft --deal <D-0007>.', 'use_passes', { op: 'passes.request' });
  return draft(ctx, { kind: util.str(p, 'kind', ''), module: util.str(p, 'module', ''), to: p.to, subject: util.str(p, 'subject', ''), body: typeof p.body === 'string' ? p.body : '', attachments: p.attachments, ref_collection: util.str(p, 'ref_collection', ''), ref_id: util.str(p, 'ref_id', ''), deal: util.str(p, 'deal', ''), approver: util.str(p, 'approver', '') });
}

module.exports = { KINDS: KINDS, PER_MINUTE: PER_MINUTE, view: view, draft: draft, draftOp: draftOp, update: update, approve: approve, cancel: cancel, sendNow: sendNow, sendQueued: sendQueued, list: list, get: get, nextItems: nextItems, resolve: resolve, editCounts: editCounts };
