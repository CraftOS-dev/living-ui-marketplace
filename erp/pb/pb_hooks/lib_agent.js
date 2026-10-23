/// <reference path="../pb_data/types.d.ts" />
/**
 * Your AI agent in the app: proposals, the Inbox, questions and field marks.
 *
 * Proposals: when your AI agent runs an operation that posts, voids or moves
 * money, the dispatcher stores a proposal instead (with an exact preview of
 * the journal lines and the agent's reason). A person with the right
 * approves it, which runs the same operation as that person, or rejects it.
 * The company's autonomy settings may let named low-risk kinds post on
 * their own under an amount ceiling; money never does.
 *
 * Inbox: files people drop for your AI agent to read (bills, receipts,
 * statements). One `inbox_waiting` ask drains them all.
 *
 * Questions: "Ask your AI agent" on Home; the answer comes back into the app.
 */

const DIRTY = 'erp_inbox_dirty';
const FIRED_AT = 'erp_inbox_fired_at';
const BOOTED = 'erp_inbox_boot_checked';

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

const KIND_OF = {
  quote: 'post',
  invoice: 'post',
  credit_note: 'post',
  bill: 'post',
  supplier_credit: 'post',
  delivery: 'post',
  goods_receipt: 'post',
  void: 'void',
  payment: 'payment',
  journal: 'journal',
  stock: 'stock',
  stock_change: 'stock',
  build: 'stock',
  payroll: 'payroll',
  claim: 'claim',
};

/* ============================================================ proposals */

/**
 * Records a proposal acts ON (posting this draft, voiding that payment). A
 * proposal keeps the record's version; if the record changes before a person
 * approves, the approval stops (it would post something else than shown).
 * Other targets (a customer, a bank) only give the proposal its context.
 */
const VERSIONED = ['documents', 'journals', 'stock_changes', 'payments', 'builds', 'payroll_runs', 'expense_claims'];

function targetVersion(app, entity, id) {
  if (VERSIONED.indexOf(entity) < 0 || !id) return '';
  const r = u().byId(app, entity, id);
  return r === null ? '' : r.getString('updated');
}

/** Params as stable text (key order does not matter), to tell a retry from a new request. */
function stableText(v) {
  if (Array.isArray(v)) return '[' + v.map(stableText).join(',') + ']';
  if (v !== null && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableText(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** A waiting proposal this request repeats: the same operation on the same record, or with the same params. */
function twinOf(app, spec, clean, target) {
  const key = stableText(clean);
  const waiting = app.findRecordsByFilter('proposals', "status = 'waiting' && op = {:op}", '-created', 200, 0, { op: spec.name });
  for (const r of waiting) {
    if (VERSIONED.indexOf(target.entity || '') >= 0 && target.id && r.getString('target_entity') === target.entity && r.getString('target_id') === target.id) return r;
    if (stableText(u().jsonOf(r, 'params') || {}) === key) return r;
  }
  return null;
}

/** Called by the dispatcher for the agent on an `agent: 'propose'` operation. */
function proposeOrRun(ctx, spec, params) {
  const util = u();
  const ops = require(`${__hooks}/lib_ops.js`);
  const reason = util.text(params, 'why', 2000, '');
  const clean = {};
  for (const k of Object.keys(params)) if (k !== 'why') clean[k] = params[k];
  const preview = spec.preview ? ops.handler({ fn: spec.preview })(ctx, clean) : { kind: 'other', title: spec.name, summary: '', lines: [], amount: 0 };
  // A retry (after a timeout, or the same request twice) gets the waiting proposal back, not a second one.
  const twin = twinOf(ctx.app, spec, clean, preview.target || {});
  if (twin !== null) {
    return {
      proposal: proposalOut(ctx.app, twin),
      status: 'already_waiting',
      message: 'Already waiting for approval: ' + twin.getString('title') + ' (proposal ' + twin.id + '). Nothing new was created. If it is wrong, take it back with proposals.withdraw --proposal ' + twin.id + ' and propose again.',
    };
  }
  // Autonomy: named kinds may post on their own under the ceiling.
  const s = core().settings(ctx.app);
  const agent = util.jsonOf(s, 'agent') || {};
  const auto = agent.auto || {};
  const limit = Number(agent.limit || 0);
  if (preview.auto && auto[preview.auto] === true && (limit === 0 || Math.abs(preview.amount || 0) <= limit)) {
    const out = ops.handler(spec)(ctx, clean);
    if (out && typeof out === 'object') out.auto_posted = true;
    return out;
  }
  const rec = util.newRecord(ctx.app, 'proposals');
  rec.set('op', spec.name);
  rec.set('params', clean);
  rec.set('kind', KIND_OF[preview.kind] || 'other');
  rec.set('title', String(preview.title || spec.name).slice(0, 200));
  rec.set('summary', String(preview.summary || '').slice(0, 1000));
  const tv = targetVersion(ctx.app, (preview.target || {}).entity, (preview.target || {}).id);
  rec.set('preview', { lines: preview.lines || [], currency: preview.currency || core().currency(ctx.app), warning: preview.warning || '', extra: preview.extra || null, target_version: tv });
  rec.set('reason', reason);
  rec.set('sources', []);
  rec.set('status', 'waiting');
  const t = preview.target || {};
  rec.set('target_entity', t.entity || '');
  rec.set('target_id', t.id || '');
  rec.set('target_label', String(t.label || '').slice(0, 80));
  rec.set('amount', Math.round(preview.amount || 0));
  ctx.app.save(rec);
  require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'propose', entity: 'proposals', ref: rec.id, label: rec.getString('title'), summary: 'Proposed: ' + rec.getString('title') });
  if (t.entity && t.id) {
    require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'propose', entity: t.entity, ref: t.id, label: t.label || '', summary: 'Your AI agent proposed: ' + rec.getString('title') });
  }
  return {
    proposal: proposalOut(ctx.app, rec),
    status: 'waiting',
    message: 'Sent for approval: ' + rec.getString('title') + '. A person with the right approves it in the app (Needs you). Nothing was posted yet.',
  };
}

function proposalOut(app, r) {
  const util = u();
  return {
    id: r.id,
    op: r.getString('op'),
    kind: r.getString('kind'),
    title: r.getString('title'),
    summary: r.getString('summary'),
    reason: r.getString('reason'),
    preview: util.jsonOf(r, 'preview') || { lines: [] },
    params: util.jsonOf(r, 'params') || {},
    status: r.getString('status'),
    target: { entity: r.getString('target_entity'), id: r.getString('target_id'), label: r.getString('target_label') },
    amount: r.getInt('amount'),
    decided_by: r.getString('decided_by') !== '' ? require(`${__hooks}/lib_audit.js`).memberName(app, r.getString('decided_by'), {}) : '',
    decided_at: r.getString('decided_at'),
    decision_note: r.getString('decision_note'),
    error: r.getString('error'),
    result: util.jsonOf(r, 'result'),
    created: r.getString('created'),
  };
}

/** Whether ctx could run the proposal's operation (so it may approve it). */
function mayDecide(ctx, rec) {
  if (ctx.isAgent) return false;
  const spec = require(`${__hooks}/lib_catalog.js`).get(rec.getString('op'));
  const auth = require(`${__hooks}/lib_auth.js`);
  const params = u().jsonOf(rec, 'params') || {};
  try {
    auth.checkPerm(ctx, spec, params);
    const perm = spec.perm || 'self';
    if (perm.indexOf('doc:') === 0) {
      const d = u().byId(ctx.app, 'documents', rec.getString('target_id'));
      if (d !== null) auth.needDoc(ctx, d.getString('type'), perm.split(':')[1]);
    } else if (perm.indexOf('pay:') === 0) {
      const dir = rec.getString('target_entity') === 'payments' ? (u().byId(ctx.app, 'payments', rec.getString('target_id')) || { getString: () => 'in' }).getString('direction') : String(params.direction || 'in');
      auth.needPay(ctx, dir, perm.split(':')[1]);
    }
    return true;
  } catch {
    return false;
  }
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const status = util.oneOf(p, 'status', ['waiting', 'approved', 'rejected', 'failed'], 'waiting');
  const pg = util.page(p, 50, 200);
  const recs = app.findRecordsByFilter('proposals', 'status = {:s}', status === 'waiting' ? 'created' : '-updated', 500, 0, { s: status });
  const sees = (r) => ctx.isAgent || ctx.admin || mayDecide(ctx, r);
  const visible = recs.filter(sees);
  // Counts follow the same rule as the list: only what the caller may see.
  const counts = {};
  if (ctx.isAgent || ctx.admin) {
    for (const r of util.rows(app, 'SELECT status, COUNT(id) AS n FROM proposals GROUP BY status', { status: '', n: 0 })) counts[r.status] = r.n;
  } else {
    for (const st of ['waiting', 'approved', 'rejected', 'failed']) {
      counts[st] = st === status ? visible.length : app.findRecordsByFilter('proposals', 'status = {:s}', '-updated', 500, 0, { s: st }).filter(sees).length;
    }
  }
  return {
    proposals: visible.slice(pg.offset, pg.offset + pg.limit).map((r) => Object.assign(proposalOut(app, r), { can_decide: !ctx.isAgent && r.getString('status') === 'waiting' && mayDecide(ctx, r) })),
    total: visible.length,
    counts: counts,
  };
}

function get(ctx, p) {
  const util = u();
  const r = core().resolve(ctx.app, 'proposals', util.req(p, 'proposal'));
  if (!ctx.isAgent && !ctx.admin && !mayDecide(ctx, r)) throw util.fail(403, 'You cannot see this proposal.', 'not_permitted');
  return Object.assign(proposalOut(ctx.app, r), { can_decide: !ctx.isAgent && r.getString('status') === 'waiting' && mayDecide(ctx, r) });
}

function approve(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent cannot approve its own proposals.', 'agent_not_permitted');
  const r = core().resolve(app, 'proposals', util.req(p, 'proposal'));
  if (r.getString('status') !== 'waiting') throw util.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'invalid_state');
  if (!mayDecide(ctx, r)) throw util.fail(403, 'Your role cannot approve this (it needs the rights to do it yourself).', 'not_permitted');
  const note = util.text(p, 'note', 500, '');
  const params = util.jsonOf(r, 'params') || {};
  const failWith = (message) => {
    const fresh = app.findRecordById('proposals', r.id);
    fresh.set('status', 'failed');
    fresh.set('error', String(message).slice(0, 1000));
    fresh.set('decided_by', ctx.memberId);
    fresh.set('decided_at', util.nowIso());
    fresh.set('decision_note', note);
    app.save(fresh);
  };
  // What was shown must still be what runs: the record it acts on is unchanged since it was proposed.
  const shown = util.jsonOf(r, 'preview') || {};
  const entity = r.getString('target_entity');
  if (VERSIONED.indexOf(entity) >= 0 && String(shown.target_version || '') !== '') {
    const now = targetVersion(app, entity, r.getString('target_id'));
    if (now !== String(shown.target_version)) {
      const why = now === '' ? r.getString('target_label') + ' no longer exists' : r.getString('target_label') + ' was changed after this was proposed';
      failWith(why + '. Nothing was posted. Your AI agent can propose it again.');
      throw util.fail(409, why + ', so this proposal no longer shows what would happen. Nothing was posted; ask your AI agent to propose it again.', 'stale_proposal');
    }
  }
  // The limit applies to the larger of what was proposed and what it comes to now (exchange rates move).
  let amount = Math.abs(r.getInt('amount'));
  const spec = require(`${__hooks}/lib_catalog.js`).get(r.getString('op'));
  if (spec.preview) {
    try {
      const fresh = require(`${__hooks}/lib_ops.js`).handler({ fn: spec.preview })(ctx, params);
      amount = Math.max(amount, Math.abs(Math.round((fresh && fresh.amount) || 0)));
    } catch {
      /* the operation itself says what is wrong below */
    }
  }
  if (ctx.approvalLimit > 0 && amount > ctx.approvalLimit) {
    const cur = core().currency(app);
    throw util.fail(403, 'This is over your approval limit of ' + require(`${__hooks}/lib_money.js`).fmt(ctx.approvalLimit, cur) + '.', 'over_limit');
  }
  ctx.approving = r;
  let result;
  try {
    result = require(`${__hooks}/lib_ops.js`).runAs(ctx, r.getString('op'), params);
  } catch (err) {
    // A refusal of this person's rights leaves the proposal for someone who has them.
    if (util.statusOf(err) === 403) throw err;
    failWith((err && err.message) || err);
    throw err;
  }
  const fresh = app.findRecordById('proposals', r.id);
  fresh.set('status', 'approved');
  fresh.set('decided_by', ctx.memberId);
  fresh.set('decided_at', util.nowIso());
  fresh.set('decision_note', note);
  let summary = result;
  try {
    const s = JSON.stringify(result);
    if (s.length > 45000) summary = { id: result && result.id, number: result && result.number };
  } catch {
    summary = null;
  }
  fresh.set('result', summary);
  app.save(fresh);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'approve', entity: 'proposals', ref: r.id, label: r.getString('title'), summary: 'Approved: ' + r.getString('title') });
  return { proposal: proposalOut(app, fresh), result: result };
}

function reject(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent cannot reject proposals; withdraw it instead.', 'agent_not_permitted');
  const r = core().resolve(app, 'proposals', util.req(p, 'proposal'));
  if (r.getString('status') !== 'waiting') throw util.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'invalid_state');
  if (!mayDecide(ctx, r)) throw util.fail(403, 'Your role cannot decide on this.', 'not_permitted');
  r.set('status', 'rejected');
  r.set('decided_by', ctx.memberId);
  r.set('decided_at', util.nowIso());
  r.set('decision_note', util.text(p, 'note', 500, ''));
  app.save(r);
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'reject', entity: 'proposals', ref: r.id, label: r.getString('title'), summary: 'Rejected: ' + r.getString('title') + (r.getString('decision_note') !== '' ? ' (' + r.getString('decision_note') + ')' : '') });
  return proposalOut(app, r);
}

/** A record was deleted: its waiting proposals close (they could only fail now). Runs inside the delete. */
function closeFor(app, entity, id) {
  if (VERSIONED.indexOf(entity) < 0) return;
  const now = u().nowIso();
  for (const r of app.findRecordsByFilter('proposals', "status = 'waiting' && target_entity = {:e} && target_id = {:i}", '', 0, 0, { e: entity, i: id })) {
    r.set('status', 'rejected');
    r.set('decision_note', 'Withdrawn: ' + (r.getString('target_label') || 'its record') + ' was deleted');
    r.set('decided_at', now);
    app.save(r);
  }
}

/** Your AI agent takes a waiting proposal back (it found a mistake). */
function withdraw(ctx, p) {
  const util = u();
  const r = core().resolve(ctx.app, 'proposals', util.req(p, 'proposal'));
  if (r.getString('status') !== 'waiting') throw util.fail(409, 'This proposal is already ' + r.getString('status') + '.', 'invalid_state');
  if (!ctx.isAgent && !ctx.admin) throw util.fail(403, 'Only your AI agent or an administrator withdraws a proposal.', 'not_permitted');
  r.set('status', 'rejected');
  r.set('decision_note', 'Withdrawn' + (util.str(p, 'note', '') !== '' ? ': ' + util.str(p, 'note', '') : ''));
  r.set('decided_at', util.nowIso());
  ctx.app.save(r);
  return proposalOut(ctx.app, r);
}

/* ================================================================= inbox */

function inboxOut(app, r) {
  const util = u();
  const name = r.getString('filename') || r.getString('file');
  return {
    id: r.id,
    filename: name,
    kind: r.getString('kind'),
    status: r.getString('status'),
    summary: r.getString('summary'),
    error: r.getString('error'),
    note: r.getString('note'),
    result: r.getString('result_id') !== '' ? { entity: r.getString('result_entity'), id: r.getString('result_id'), label: r.getString('result_label') } : null,
    file_path: util.filePath(app, r, 'file'),
    is_pdf: /\.pdf$/i.test(r.getString('file')),
    actor: r.getString('actor'),
    added_by: r.getString('actor') === 'agent' ? 'Your AI agent' : require(`${__hooks}/lib_audit.js`).memberName(app, r.getString('added_by'), {}),
    created: r.getString('created'),
    updated: r.getString('updated'),
  };
}

/** Who sees the Inbox: anyone sees their own files; accounting and admins see all. */
function seesAll(ctx) {
  const auth = require(`${__hooks}/lib_auth.js`);
  return ctx.isAgent || ctx.admin || auth.can(ctx, 'accounting', 'view') || auth.can(ctx, 'purchasing', 'edit');
}

function inboxList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const status = util.oneOf(p, 'status', ['waiting', 'reading', 'done', 'failed'], '');
  const filters = [];
  const bind = {};
  if (status !== '') {
    filters.push('status = {:s}');
    bind.s = status;
  }
  if (!seesAll(ctx)) {
    filters.push('added_by = {:m}');
    bind.m = ctx.memberId;
  }
  const pg = util.page(p, 100, 500);
  const recs = app.findRecordsByFilter('inbox', filters.join(' && '), '-created', pg.limit, pg.offset, bind);
  const counts = { waiting: 0, reading: 0, done: 0, failed: 0 };
  for (const r of util.rows(app, 'SELECT status, COUNT(id) AS n FROM inbox' + (seesAll(ctx) ? '' : ' WHERE added_by = {:m}') + ' GROUP BY status', { status: '', n: 0 }, { m: ctx.memberId })) counts[r.status] = r.n;
  return { files: recs.map((r) => inboxOut(app, r)), counts: counts };
}

function inboxAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const kind = util.oneOf(p, 'kind', ['bill', 'receipt', 'statement', 'other'], 'bill');
  const files = ctx.e ? util.uploadedAll(ctx.e, 'file') : [];
  const path = util.str(p, 'path', '');
  if (files.length === 0 && path === '') throw util.fail(400, 'Upload a file, or give --path "<absolute path>".', 'missing_param');
  const note = util.text(p, 'note', 500, '');
  const out = [];
  app.runInTransaction((tx) => {
    const add = (f, name) => {
      const r = util.newRecord(tx, 'inbox');
      r.set('file', f);
      r.set('filename', String(name || '').slice(0, 200));
      r.set('kind', kind);
      r.set('status', ctx.isAgent ? 'reading' : 'waiting');
      r.set('note', note);
      r.set('added_by', ctx.memberId);
      r.set('actor', ctx.isAgent ? 'agent' : 'person');
      tx.save(r);
      out.push(r);
    };
    for (const f of files) add(f, f.originalName);
    if (path !== '') add(util.localFile(ctx, path, 'path'), $filepath.base(path));
  });
  if (!ctx.isAgent) {
    markDirty(app);
    fireIfNeeded(app);
  }
  return { files: out.map((r) => inboxOut(app, app.findRecordById('inbox', r.id))) };
}

function inboxRec(ctx, p) {
  const util = u();
  const r = core().resolve(ctx.app, 'inbox', util.req(p, 'file'));
  if (!seesAll(ctx) && r.getString('added_by') !== ctx.memberId) throw util.fail(403, 'That file is someone else\'s.', 'not_permitted');
  return r;
}

function inboxGet(ctx, p) {
  const util = u();
  const r = inboxRec(ctx, p);
  if (ctx.isAgent) return inboxOut(ctx.app, r);
  return require(`${__hooks}/lib_audit.js`).streamFile(ctx, r, 'file', r.getString('filename') || r.getString('file'), null, util.bool(p, 'download', false));
}

function setInbox(ctx, p, status, fields) {
  const util = u();
  if (!ctx.isAgent && status !== 'waiting') throw util.fail(403, 'Your AI agent updates what it read.', 'not_permitted');
  const r = inboxRec(ctx, p);
  r.set('status', status);
  for (const k of Object.keys(fields)) r.set(k, fields[k]);
  ctx.app.save(r);
  return inboxOut(ctx.app, r);
}

function inboxStart(ctx, p) {
  return setInbox(ctx, p, 'reading', { error: '' });
}

function inboxComplete(ctx, p) {
  const util = u();
  const fields = { summary: util.text(p, 'summary', 1000, ''), error: '' };
  const entity = util.str(p, 'entity', '');
  const ref = util.str(p, 'ref', '');
  if (entity !== '' && ref !== '') {
    let rec = null;
    if (entity === 'documents') rec = core().resolveDoc(ctx.app, ref);
    else if (entity === 'payments') rec = core().resolvePayment(ctx.app, ref);
    else rec = core().resolve(ctx.app, entity, ref);
    fields.result_entity = entity;
    fields.result_id = rec.id;
    fields.result_label = String(rec.getString('number') || rec.getString('name') || '').slice(0, 80);
  }
  const out = setInbox(ctx, p, 'done', fields);
  if (entity !== '' && ref !== '') {
    // The file goes with what it became.
    const inbox = ctx.app.findRecordById('inbox', out.id);
    try {
      require(`${__hooks}/lib_audit.js`).attach(ctx.app, ctx, entity, fields.result_id, $filesystem.fileFromPath(u().filePath(ctx.app, inbox, 'file')), out.filename);
    } catch (err) {
      console.error('[erp] attaching an inbox file failed:', err);
    }
  }
  // Every write says who did it: reading a file shows on what it became (or on the Inbox).
  const hasResult = fields.result_id !== undefined;
  require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, {
    kind: 'read',
    entity: hasResult ? entity : 'inbox',
    ref: hasResult ? fields.result_id : out.id,
    label: out.filename,
    summary: 'Read ' + out.filename + (fields.summary !== '' ? ': ' + fields.summary : ''),
  });
  return out;
}

function inboxFail(ctx, p) {
  const util = u();
  const out = setInbox(ctx, p, 'failed', { error: util.text(p, 'reason', 500, '') || 'Could not be read' });
  require(`${__hooks}/lib_audit.js`).write(ctx.app, ctx, { kind: 'read_failed', entity: 'inbox', ref: out.id, label: out.filename, summary: 'Could not read ' + out.filename + ': ' + out.error });
  return out;
}

function inboxRetry(ctx, p) {
  const out = setInbox(ctx, p, 'waiting', { error: '' });
  markDirty(ctx.app);
  fireIfNeeded(ctx.app);
  return out;
}

function inboxDelete(ctx, p) {
  const util = u();
  const r = inboxRec(ctx, p);
  if (util.bool(p, 'preview', false)) return { preview: true, filename: r.getString('filename') };
  ctx.app.delete(r);
  return { deleted: true };
}

function markDirty(app) {
  app.store().set(DIRTY, true);
}

/** Ask your AI agent about waiting files, at most once per batch of uploads. */
function fireIfNeeded(app) {
  if (app.store().get(BOOTED) !== true) {
    app.store().set(BOOTED, true);
    app.store().set(DIRTY, true);
  }
  if (app.store().get(DIRTY) !== true) return { fired: false };
  const waiting = app.findRecordsByFilter('inbox', "status = 'waiting'", '-updated', 1, 0);
  if (waiting.length === 0) {
    app.store().set(DIRTY, false);
    return { fired: false };
  }
  const newest = Date.parse(waiting[0].getString('updated').replace(' ', 'T'));
  const last = Number(app.store().get(FIRED_AT) || 0);
  if (last > 0 && newest <= last) {
    app.store().set(DIRTY, false);
    return { fired: false };
  }
  const res = require(`${__hooks}/_triggers_lib.js`).fire(app, 'inbox_waiting', {}, 'hook');
  if (res && res.ok) {
    app.store().set(FIRED_AT, Date.now());
    app.store().set(DIRTY, false);
    return { fired: true };
  }
  return { fired: false };
}

/* ============================================================= questions */

function askOut(app, r) {
  return {
    id: r.id,
    question: r.getString('question'),
    status: r.getString('status'),
    answer: r.getString('answer'),
    answered_at: r.getString('answered_at'),
    who: require(`${__hooks}/lib_audit.js`).memberName(app, r.getString('member'), {}),
    created: r.getString('created'),
  };
}

function askCreate(ctx, p) {
  const util = u();
  if (ctx.isAgent) throw util.fail(403, 'Questions come from people in the app.', 'agent_not_permitted');
  const q = util.text(p, 'question', 2000, '');
  if (q.trim() === '') throw util.fail(400, 'question is required', 'missing_param');
  const r = util.newRecord(ctx.app, 'asks');
  r.set('question', q.trim());
  r.set('member', ctx.memberId);
  r.set('status', 'waiting');
  ctx.app.save(r);
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(ctx.app, 'question_asked', { ask_id: r.id }, 'hook');
  return Object.assign(askOut(ctx.app, r), { asked: fired && fired.ok === true, request: fired && fired.ok ? fired.id : '' });
}

function askList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const status = util.str(p, 'status', '');
  if (ctx.isAgent) {
    const recs = app.findRecordsByFilter('asks', status !== '' ? 'status = {:s}' : '', '-created', 50, 0, { s: status });
    return { asks: recs.map((r) => Object.assign(askOut(app, r), { role: roleOfAsker(app, r) })) };
  }
  const recs = app.findRecordsByFilter('asks', 'member = {:m}', '-created', util.int(p, 'limit', 20, 1, 100), 0, { m: ctx.memberId });
  return { asks: recs.map((r) => askOut(app, r)) };
}

/** What the asker may see, so the answer respects their rights. */
function roleOfAsker(app, r) {
  const m = u().byId(app, 'members', r.getString('member'));
  if (m === null) return null;
  const c = require(`${__hooks}/lib_auth.js`).contextFor(app, m);
  return { name: c.name, role: c.role ? c.role.getString('name') : '', levels: c.levels, admin: c.admin, employee: c.employeeId };
}

function askAnswer(ctx, p) {
  const util = u();
  if (!ctx.isAgent) throw util.fail(403, 'Your AI agent answers questions.', 'not_permitted');
  const r = core().resolve(ctx.app, 'asks', util.req(p, 'ask'));
  const answer = util.text(p, 'answer', 20000, '');
  if (answer.trim() === '') throw util.fail(400, 'answer is required', 'missing_param');
  r.set('status', 'answered');
  r.set('answer', answer.trim());
  r.set('answered_at', util.nowIso());
  ctx.app.save(r);
  return askOut(ctx.app, r);
}

function askWorking(ctx, p) {
  const util = u();
  if (!ctx.isAgent) throw util.fail(403, 'Your AI agent updates questions.', 'not_permitted');
  const r = core().resolve(ctx.app, 'asks', util.req(p, 'ask'));
  r.set('status', 'working');
  ctx.app.save(r);
  return askOut(ctx.app, r);
}

function askFail(ctx, p) {
  const util = u();
  if (!ctx.isAgent) throw util.fail(403, 'Your AI agent updates questions.', 'not_permitted');
  const r = core().resolve(ctx.app, 'asks', util.req(p, 'ask'));
  r.set('status', 'failed');
  r.set('answer', util.text(p, 'reason', 2000, '') || 'Could not answer');
  r.set('answered_at', util.nowIso());
  ctx.app.save(r);
  return askOut(ctx.app, r);
}

function askDelete(ctx, p) {
  const util = u();
  const r = core().resolve(ctx.app, 'asks', util.req(p, 'ask'));
  if (r.getString('member') !== ctx.memberId && !ctx.admin) throw util.fail(403, 'You can delete only your own questions.', 'not_permitted');
  ctx.app.delete(r);
  return { deleted: true };
}

/* ================================================================= marks */

function markSet(ctx, p) {
  const util = u();
  if (!ctx.isAgent) throw util.fail(403, 'Field marks show what your AI agent filled in.', 'not_permitted');
  const audit = require(`${__hooks}/lib_audit.js`);
  const entity = util.oneOf(p, 'entity', audit.ENTITIES, '');
  if (entity === '') throw util.fail(400, 'entity is required', 'missing_param');
  let ref = util.req(p, 'ref');
  ref = entity === 'documents' ? core().resolveDoc(ctx.app, ref).id : entity === 'payments' ? core().resolvePayment(ctx.app, ref).id : core().resolve(ctx.app, entity, ref).id;
  const field = util.req(p, 'field');
  let r = util.findOne(ctx.app, 'field_marks', 'entity = {:e} && ref = {:r} && field = {:f}', { e: entity, r: ref, f: field });
  if (r === null) {
    r = util.newRecord(ctx.app, 'field_marks');
    r.set('entity', entity);
    r.set('ref', ref);
    r.set('field', field.slice(0, 60));
  }
  r.set('confidence', util.oneOf(p, 'confidence', ['high', 'check'], 'high'));
  r.set('reason', util.text(p, 'reason', 500, ''));
  ctx.app.save(r);
  return { ok: true };
}

/** A person reviewed what your AI agent filled in: the marks go. */
function markClear(ctx, p) {
  const util = u();
  const audit = require(`${__hooks}/lib_audit.js`);
  const entity = util.oneOf(p, 'entity', audit.ENTITIES, '');
  let ref = util.req(p, 'ref');
  ref = entity === 'documents' ? core().resolveDoc(ctx.app, ref).id : entity === 'payments' ? core().resolvePayment(ctx.app, ref).id : core().resolve(ctx.app, entity, ref).id;
  if (!audit.canSee(ctx, entity, ref)) throw util.fail(403, 'You cannot see that record.', 'not_permitted');
  const field = util.str(p, 'field', '');
  const recs = ctx.app.findRecordsByFilter('field_marks', 'entity = {:e} && ref = {:r}' + (field !== '' ? ' && field = {:f}' : ''), '', 0, 0, { e: entity, r: ref, f: field });
  ctx.app.runInTransaction((tx) => {
    for (const r of recs) tx.delete(tx.findRecordById('field_marks', r.id));
    audit.write(tx, ctx, { kind: 'reviewed', entity: entity, ref: ref, label: '', summary: 'Reviewed what your AI agent filled in' });
  });
  return { cleared: recs.length };
}

/* ============================================================== activity */

/** What your AI agent did (from the audit trail), newest first. */
function activity(ctx, p) {
  const util = u();
  const app = ctx.app;
  const auth = require(`${__hooks}/lib_auth.js`);
  const from = util.day(p, 'from', util.addDays(util.today(), -7));
  const limit = util.int(p, 'limit', 50, 1, 500);
  // A proposal is written twice (on the proposal and on its target's own
  // timeline); this feed lists it once, as the proposal.
  const FEED = "actor = 'agent' && created >= {:f} && (kind != 'propose' || entity = 'proposals')";
  const audit = require(`${__hooks}/lib_audit.js`);
  const sees = (r) => ctx.isAgent || ctx.admin || r.getString('entity') === '' || audit.canSee(ctx, r.getString('entity'), r.getString('ref')) || auth.can(ctx, 'accounting', 'view');
  const recs = app.findRecordsByFilter('audit', FEED, '-created', limit, 0, { f: util.dayStartTs(from) });
  const cache = {};
  const out = recs.filter(sees).map((r) => audit.auditOut(app, r, cache));
  // The figures beside the feed count only what the caller may see, like the feed.
  const all = ctx.isAgent || ctx.admin || auth.can(ctx, 'accounting', 'view');
  const today = all
    ? util.one(app, "SELECT COUNT(id) AS n FROM audit WHERE actor = 'agent' AND created >= {:t} AND NOT (kind = 'propose' AND entity != 'proposals')", { n: 0 }, { t: util.dayStartTs(util.today()) }).n
    : app.findRecordsByFilter('audit', FEED, '-created', 1000, 0, { f: util.dayStartTs(util.today()) }).filter(sees).length;
  const waiting = list(ctx, { status: 'waiting', limit: 1 }).total;
  const inbox = seesAll(ctx)
    ? util.one(app, "SELECT COUNT(id) AS n FROM inbox WHERE status IN ('waiting', 'reading')", { n: 0 }).n
    : util.one(app, "SELECT COUNT(id) AS n FROM inbox WHERE status IN ('waiting', 'reading') AND added_by = {:m}", { n: 0 }, { m: ctx.memberId }).n;
  return { entries: out, today: today, proposals_waiting: waiting, inbox_waiting: inbox };
}

/* ============================================================ agent requests */

/** What a person may ask your AI agent to do from the app, and the right each one needs. */
const REQUESTS = {
  reorder_review: { module: 'purchasing', level: 'edit' },
  collections_requested: { module: 'sales', level: 'edit' },
  doc_send_requested: { doc: true },
  close_review_requested: { module: 'accounting', level: 'full' },
  bank_lines_waiting: { module: 'banking', level: 'edit' },
};

/** Ask your AI agent for one piece of work (rights checked here, then the trigger fires). */
function request(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (ctx.isAgent) throw util.fail(403, 'Requests to your AI agent come from people in the app.', 'agent_not_permitted');
  const kind = util.oneOf(p, 'kind', Object.keys(REQUESTS), '');
  if (kind === '') throw util.fail(400, 'kind is required', 'missing_param');
  const auth = require(`${__hooks}/lib_auth.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const rule = REQUESTS[kind];
  const params = {};
  if (rule.doc) {
    const doc = core.resolveDoc(app, util.req(p, 'doc'));
    auth.needDoc(ctx, doc.getString('type'), 'edit');
    if (doc.getString('state') === 'draft' || doc.getString('state') === 'void') throw util.fail(409, 'Only a confirmed or posted document is sent.', 'invalid_state');
    params.doc_id = doc.id;
  } else auth.need(ctx, rule.module, rule.level);
  if (kind === 'close_review_requested') params.month = util.monthParam(p, 'month', util.today().slice(0, 7));
  if (kind === 'bank_lines_waiting') params.bank_id = core.resolve(app, 'banks', util.req(p, 'bank')).id;
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, kind, params, 'hook');
  if (!fired || fired.ok !== true) {
    const code = fired && fired.code ? fired.code : 'not_sent';
    const msg = code === 'cooldown' ? 'Your AI agent was asked a moment ago. Try again shortly.' : 'Your AI agent could not be asked right now' + (fired && fired.message ? ': ' + fired.message : '.');
    throw util.fail(409, msg, code);
  }
  require(`${__hooks}/lib_audit.js`).write(app, ctx, { kind: 'ask_agent', entity: '', ref: fired.id, label: kind, summary: 'Asked your AI agent: ' + kind.replace(/_/g, ' ') });
  return { request: fired.id, kind: kind };
}

module.exports = {
  closeFor: closeFor,
  request: request,
  proposeOrRun: proposeOrRun,
  proposalOut: proposalOut,
  mayDecide: mayDecide,
  list: list,
  get: get,
  approve: approve,
  reject: reject,
  withdraw: withdraw,
  inboxList: inboxList,
  inboxAdd: inboxAdd,
  inboxGet: inboxGet,
  inboxStart: inboxStart,
  inboxComplete: inboxComplete,
  inboxFail: inboxFail,
  inboxRetry: inboxRetry,
  inboxDelete: inboxDelete,
  markDirty: markDirty,
  fireIfNeeded: fireIfNeeded,
  askCreate: askCreate,
  askList: askList,
  askAnswer: askAnswer,
  askWorking: askWorking,
  askFail: askFail,
  askDelete: askDelete,
  markSet: markSet,
  markClear: markClear,
  activity: activity,
};
