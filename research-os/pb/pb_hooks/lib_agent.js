/// <reference path="../pb_data/types.d.ts" />
/**
 * Working with your AI agent.
 *
 * - Asking it for work: agent.request (a person asks from a screen) and
 *   ask() (the app asks, e.g. papers waiting to be identified). Both fire a
 *   declared trigger (triggers.json) through the platform queue. A fire the
 *   cooldown refused is remembered and retried by the minute job, so no ask
 *   is lost. Hooks never read the queue itself (the platform owns it);
 *   screens follow a request's row there.
 * - Questions (asks): a person asks; your AI agent answers with passages.
 * - Proposals: an operation your AI agent may not run on a person's own
 *   work is stored with a preview; a person approves (it then runs as that
 *   person), returns it with a reason, or rejects it. Approving refuses when
 *   the target changed since the proposal (stale).
 * - Field marks: which fields your AI agent filled, and how sure it is.
 * - Needs you: everything waiting for a person, counted and listed.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function act() {
  return require(`${__hooks}/lib_activity.js`);
}

/* --------------------------------------------------------------- asking */

const REASK = 'ro_reask_';

/** Fire a trigger from the app; a refused fire is retried by the minute job. Returns the request id or ''. */
function ask(app, trigger, params) {
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, trigger, params || {}, 'hook');
  if (fired && fired.ok === true) {
    app.store().remove(REASK + trigger);
    return fired.id;
  }
  if (fired && (fired.code === 'cooldown' || fired.code === 'rate_limited' || fired.code === 'fire_failed')) app.store().set(REASK + trigger, JSON.stringify(params || {}));
  else if (fired) console.error('[ro] could not ask your AI agent (' + trigger + '): ' + fired.code + ' ' + fired.message);
  return '';
}

/** The minute job: retry refused asks, and re-ask about work still waiting. */
function reask(app) {
  const util = u();
  for (const t of ['papers_waiting', 'ocr_requested', 'feed_review', 'task_assigned']) {
    const pending = app.store().get(REASK + t);
    if (pending !== null && pending !== undefined && pending !== '') ask(app, t, JSON.parse(pending));
  }
  // Papers still waiting to be identified, or scanned pages still unread: ask again every 30 minutes.
  const last = Number(app.store().get('ro_waiting_asked_at') || 0);
  if (Date.now() - last > 30 * 60 * 1000) {
    app.store().set('ro_waiting_asked_at', Date.now());
    const pol = core().policy(app);
    if (pol.auto_identify && util.count(app, "SELECT COUNT(*) AS n FROM works WHERE trashed = FALSE AND resolution = 'pending' AND identify = 'waiting'") > 0) ask(app, 'papers_waiting', {});
    if (pol.auto_ocr && util.count(app, "SELECT COUNT(*) AS n FROM files WHERE current = TRUE AND text_state = 'needs_ocr'") > 0) ask(app, 'ocr_requested', {});
  }
}

/**
 * What a person may ask your AI agent to do from a screen, and the params
 * each one carries (checked here before the trigger fires).
 */
const KINDS = {
  papers_waiting: {},
  ocr_requested: {},
  claims_requested: { project: true, works: true },
  access_requested: { work: true },
  search_requested: { search: true },
  feed_review: {},
  draft_requested: { manuscript: true, brief: true },
  support_check_requested: { manuscript: true },
  responses_requested: { review: true },
  screening_requested: { review: true, stage: true },
  experiment_requested: { experiment: true, ask: true },
  references_requested: { work: true },
};

/** agent.request: a person asks your AI agent for one piece of work. */
function request(ctx, p) {
  const util = u();
  const app = ctx.app;
  const kind = util.oneOf(p, 'kind', Object.keys(KINDS), '');
  if (kind === '') throw util.fail(400, 'kind is one of ' + Object.keys(KINDS).join(', '), 'missing_param');
  const need = KINDS[kind];
  const params = {};
  let projectId = '';
  if (need.project) {
    const pr = core().project(app, util.req(p, 'project'));
    core().guardProject(ctx, pr);
    params.project_id = pr.id;
    projectId = pr.id;
  }
  if (need.works) {
    const ws = util.ids(p, 'works', 200);
    for (const id of ws) core().guardWork(ctx, core().need(app, 'works', id, 'paper'));
    params.work_ids = ws.join(',');
  }
  if (need.work) {
    const w = core().work(app, util.req(p, 'work'));
    core().guardWork(ctx, w);
    params.work_id = w.id;
  }
  if (need.search) params.search_id = core().need(app, 'searches', util.req(p, 'search'), 'search').id;
  if (need.manuscript) {
    const m = core().need(app, 'manuscripts', util.req(p, 'manuscript'), 'manuscript');
    core().guardProjectId(ctx, m.getString('project'));
    params.manuscript_id = m.id;
    projectId = m.getString('project');
  }
  if (need.brief) params.brief = util.text(p, 'brief', 2000, '');
  if (need.review) {
    const col = kind === 'responses_requested' ? 'reviews_received' : 'reviews';
    const r = core().need(app, col, util.req(p, 'review'), 'review');
    if (col === 'reviews') {
      core().guardProjectId(ctx, r.getString('project'));
      projectId = r.getString('project');
    } else {
      const m = app.findRecordById('manuscripts', r.getString('manuscript'));
      core().guardProjectId(ctx, m.getString('project'));
      projectId = m.getString('project');
    }
    params.review_id = r.id;
  }
  if (need.stage) params.stage = util.oneOf(p, 'stage', ['title_abstract', 'full_text'], 'title_abstract');
  if (need.experiment) {
    const x = core().need(app, 'experiments', util.req(p, 'experiment'), 'experiment');
    core().guardProjectId(ctx, x.getString('project'));
    params.experiment_id = x.id;
    projectId = x.getString('project');
  }
  if (need.ask) {
    params.ask = util.oneOf(p, 'ask', ['plan', 'analyze'], '');
    if (params.ask === '') throw util.fail(400, 'ask is plan or analyze.', 'missing_param', { param: 'ask' });
  }
  if (projectId !== '') {
    const pr = app.findRecordById('projects', projectId);
    if (pr.getString('confidentiality') === 'confidential') throw util.fail(403, 'This project is confidential: your AI agent is not asked to work on it.', 'confidential_project');
  }
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, kind, params, 'hook');
  if (!fired || fired.ok !== true) {
    const code = fired && fired.code ? fired.code : 'not_sent';
    throw util.fail(409, code === 'cooldown' ? 'Your AI agent was asked for this a moment ago. Try again shortly.' : 'Your AI agent could not be asked right now' + (fired && fired.message ? ': ' + fired.message : '.'), code);
  }
  act().write(app, ctx, { label: 'Asked your AI agent: ' + LABELS[kind], target: 'agent', record: fired.id, project: projectId, data: { detail: { kind: kind, params: params } } });
  return { request: fired.id, kind: kind };
}

const LABELS = {
  papers_waiting: 'identify waiting papers',
  ocr_requested: 'read scanned pages',
  claims_requested: 'map the claims of papers',
  access_requested: 'find the full text',
  search_requested: 'run a deep search',
  feed_review: 'review new papers from saved searches',
  draft_requested: 'draft text',
  support_check_requested: 'check that citations support their sentences',
  responses_requested: 'split reviews into comments',
  screening_requested: 'screen records as the second reviewer',
  experiment_requested: 'plan or analyze an experiment',
  references_requested: 'resolve a reference list',
};

/* ------------------------------------------------------------ questions */

function askOut(app, a) {
  const util = u();
  const blocks = util.jsonOf(a, 'answer') || [];
  const t = require(`${__hooks}/lib_text.js`);
  return {
    id: a.id,
    scope: a.getString('scope'),
    work: a.getString('work'),
    collection: a.getString('collection'),
    project: a.getString('project'),
    question: a.getString('question'),
    status: a.getString('status'),
    answer: blocks.map((b) => {
      if (b.type === 'quote') {
        const an = util.byId(app, 'anchors', b.anchor);
        return Object.assign({}, b, { ref: an !== null ? t.anchorOut(app, an) : null });
      }
      return b;
    }),
    answer_text: a.getString('answer_text'),
    failure: a.getString('failure'),
    request: a.getString('request'),
    created: a.getString('created'),
    updated: a.getString('updated'),
  };
}

/** asks.create: a person's question to your AI agent (about a paper, a collection, a project or the library). */
function askCreate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const scope = util.oneOf(p, 'scope', ['work', 'collection', 'project', 'library'], 'library');
  const q = util.text(p, 'question', 8000, '');
  if (q === '') throw util.fail(400, 'question is required', 'missing_param');
  const a = util.newRecord(app, 'asks');
  a.set('scope', scope);
  a.set('question', q);
  a.set('status', 'waiting');
  a.set('answer', []);
  if (scope === 'work') {
    const w = core().work(app, util.req(p, 'work'));
    a.set('work', w.id);
  }
  if (scope === 'collection') a.set('collection', core().need(app, 'collections', util.req(p, 'collection'), 'collection').id);
  if (scope === 'project') {
    const pr = core().project(app, util.req(p, 'project'));
    if (pr.getString('confidentiality') === 'confidential') throw util.fail(403, 'This project is confidential: your AI agent is not asked about it.', 'confidential_project');
    a.set('project', pr.id);
  }
  if (scope === 'work' && core().workHidden(app, a.getString('work'))) throw util.fail(403, 'This paper belongs to a confidential project: your AI agent is not asked about it.', 'confidential_project');
  app.save(a);
  const fired = require(`${__hooks}/_triggers_lib.js`).fire(app, 'question_asked', { ask_id: a.id }, 'hook');
  if (fired && fired.ok === true) {
    a.set('request', fired.id);
    app.save(a);
  }
  return { ask: askOut(app, a), asked: !!(fired && fired.ok) };
}

function askList(ctx, p) {
  const util = u();
  const where = [];
  const bind = {};
  const status = util.oneOf(p, 'status', ['waiting', 'working', 'answered', 'failed'], '');
  if (status !== '') {
    where.push('status = {:s}');
    bind.s = status;
  }
  if (util.str(p, 'work', '') !== '') {
    where.push('work = {:w}');
    bind.w = core().work(ctx.app, util.str(p, 'work', '')).id;
  }
  if (util.str(p, 'project', '') !== '') {
    where.push('project = {:p}');
    bind.p = core().project(ctx.app, util.str(p, 'project', '')).id;
  }
  const recs = ctx.app.findRecordsByFilter('asks', where.join(' && '), '-created', util.int(p, 'limit', 50, 1, 200), 0, bind);
  return { asks: recs.map((a) => askOut(ctx.app, a)) };
}

function askGet(ctx, p) {
  const a = core().need(ctx.app, 'asks', u().req(p, 'ask'), 'question');
  return { ask: askOut(ctx.app, a) };
}

function askWorking(ctx, p) {
  const a = core().need(ctx.app, 'asks', u().req(p, 'ask'), 'question');
  a.set('status', 'working');
  ctx.app.save(a);
  return { ask: askOut(ctx.app, a) };
}

/**
 * asks.answer: your AI agent's answer as blocks: paragraphs and quotes.
 * A quote is a passage given as { "type": "quote", "passage": {work, page,
 * lines} } (made into an anchor now) or { "type": "quote", "anchor": id }.
 */
function askAnswer(ctx, p) {
  const util = u();
  const app = ctx.app;
  const a = core().need(app, 'asks', util.req(p, 'ask'), 'question');
  const raw = util.list(p, 'answer') || [];
  const short = util.text(p, 'text', 100000, '');
  if (raw.length === 0 && short === '') throw util.fail(400, 'Give --answer as a JSON list of blocks ({"type":"paragraph","text":...} and {"type":"quote","passage":{"work":...,"page":3,"lines":"4-6"}}), or --text.', 'missing_param');
  const t = require(`${__hooks}/lib_text.js`);
  const blocks = [];
  app.runInTransaction((tx) => {
    raw.slice(0, 400).forEach((b, i) => {
      util.keysOnly(b, ['type', 'text', 'passage', 'anchor', 'node', 'work'], 'Answer block ' + (i + 1));
      if (b.type === 'paragraph' || b.type === 'heading' || b.type === 'bullet') blocks.push({ type: b.type, text: String(b.text || '').slice(0, 20000) });
      else if (b.type === 'quote') {
        let anchorId = '';
        if (typeof b.anchor === 'string' && b.anchor !== '') anchorId = core().need(tx, 'anchors', b.anchor, 'passage').id;
        else if (b.passage) {
          const r = t.resolveSpec(ctx, b.passage);
          anchorId = t.createAnchor(tx, ctx, r).id;
        } else throw util.fail(400, 'Answer block ' + (i + 1) + ': a quote needs passage or anchor.', 'invalid_param');
        blocks.push({ type: 'quote', anchor: anchorId, text: typeof b.text === 'string' ? b.text.slice(0, 4000) : '' });
      } else if (b.type === 'node') blocks.push({ type: 'node', node: core().need(tx, 'nodes', String(b.node || ''), 'node').id });
      else if (b.type === 'cite') {
        const w = core().need(tx, 'works', String(b.work || ''), 'paper');
        if (!core().citable(w)) throw util.fail(409, 'Answer block ' + (i + 1) + ': that paper cannot be cited until its identifier resolves.', 'source_unresolved');
        blocks.push({ type: 'cite', work: w.id });
      } else throw util.fail(400, 'Answer block ' + (i + 1) + ': type is paragraph, heading, bullet, quote, node or cite.', 'invalid_param');
    });
    const r = tx.findRecordById('asks', a.id);
    r.set('answer', blocks);
    r.set('answer_text', short !== '' ? short : blocks.filter((b) => b.text).map((b) => b.text).join('\n\n').slice(0, 100000));
    r.set('status', 'answered');
    tx.save(r);
  });
  return { ask: askOut(app, app.findRecordById('asks', a.id)) };
}

function askFail(ctx, p) {
  const a = core().need(ctx.app, 'asks', u().req(p, 'ask'), 'question');
  a.set('status', 'failed');
  a.set('failure', u().text(p, 'reason', 4000, ''));
  ctx.app.save(a);
  return { ask: askOut(ctx.app, a) };
}

function askDelete(ctx, p) {
  const a = core().need(ctx.app, 'asks', u().req(p, 'ask'), 'question');
  ctx.app.delete(a);
  return { deleted: true };
}

/* ------------------------------------------------------------ proposals */

function proposalOut(app, r) {
  const util = u();
  return {
    id: r.id,
    op: r.getString('op'),
    kind: r.getString('kind'),
    title: r.getString('title'),
    summary: r.getString('summary'),
    preview: util.jsonOf(r, 'preview'),
    why: r.getString('why'),
    target_collection: r.getString('target_collection'),
    target_id: r.getString('target_id'),
    project: r.getString('project'),
    status: r.getString('status'),
    decision_note: r.getString('decision_note'),
    decided_at: r.getString('decided_at'),
    result: util.jsonOf(r, 'result'),
    created: r.getString('created'),
  };
}

/** Your AI agent's call to a 'propose' operation: store it with its preview for a person. */
function proposeOrRun(ctx, spec, params) {
  const util = u();
  const app = ctx.app;
  const why = String(params.why || '');
  delete params.why;
  const parts = spec.preview.split('.');
  const pv = require(`${__hooks}/${parts[0]}.js`)[parts[1]](ctx, params);
  const tgt = pv.target || null;
  // A retry of the same proposal returns the one already waiting.
  const same = app.findRecordsByFilter('proposals', "status = 'waiting' && op = {:op}", '-created', 50, 0, { op: spec.name }).find((x) => JSON.stringify(util.jsonOf(x, 'params')) === JSON.stringify(params));
  if (same) return { proposal: proposalOut(app, same), already_waiting: true, message: 'This proposal is already waiting for a person.' };
  const r = util.newRecord(app, 'proposals');
  r.set('op', spec.name);
  r.set('params', params);
  r.set('kind', pv.kind || spec.name);
  r.set('title', String(pv.title || spec.desc).slice(0, 400));
  r.set('summary', String(pv.summary || '').slice(0, 4000));
  r.set('preview', pv.preview || {});
  r.set('why', why.slice(0, 8000));
  if (tgt) {
    r.set('target_collection', tgt.collection);
    r.set('target_id', tgt.id);
    const t = util.byId(app, tgt.collection, tgt.id);
    if (t !== null) r.set('target_updated', t.getString('updated'));
  }
  if (pv.project) r.set('project', pv.project);
  r.set('status', 'waiting');
  app.save(r);
  act().write(app, ctx, { label: 'Proposed: ' + r.getString('title'), target: 'proposals', record: r.id, project: pv.project || '' });
  return { proposal: proposalOut(app, r), message: 'Stored as a proposal; a person approves it in the app.' };
}

function proposals(ctx, p) {
  const util = u();
  const status = util.oneOf(p, 'status', ['waiting', 'approved', 'rejected', 'returned', 'withdrawn', 'stale', 'all'], 'waiting');
  const recs = ctx.app.findRecordsByFilter('proposals', status === 'all' ? '' : 'status = {:s}', '-created', util.int(p, 'limit', 100, 1, 500), 0, { s: status });
  return { proposals: recs.map((r) => proposalOut(ctx.app, r)) };
}

/** proposals.approve: run the proposal as the person approving (refused when its target changed). */
function approve(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = core().need(app, 'proposals', util.req(p, 'proposal'), 'proposal');
  if (r.getString('status') !== 'waiting') throw util.fail(409, 'This proposal was already ' + r.getString('status') + '.', 'invalid_state');
  if (r.getString('target_collection') !== '') {
    const t = util.byId(app, r.getString('target_collection'), r.getString('target_id'));
    if (t === null || t.getString('updated') !== r.getString('target_updated')) {
      r.set('status', 'stale');
      r.set('decided_at', util.nowIso());
      app.save(r);
      throw util.fail(409, 'What this proposal changes was edited after it was made. Ask your AI agent to look again.', 'stale_proposal');
    }
  }
  const result = require(`${__hooks}/lib_ops.js`).runAs(ctx, r.getString('op'), util.jsonOf(r, 'params') || {});
  r.set('status', 'approved');
  r.set('decided_at', util.nowIso());
  r.set('result', JSON.parse(JSON.stringify(result || {})));
  app.save(r);
  act().write(app, ctx, { label: 'Approved: ' + r.getString('title'), target: 'proposals', record: r.id, project: r.getString('project') });
  return { proposal: proposalOut(app, r), result: result };
}

function decide(ctx, p, status) {
  const util = u();
  const app = ctx.app;
  const r = core().need(app, 'proposals', util.req(p, 'proposal'), 'proposal');
  if (r.getString('status') !== 'waiting') throw util.fail(409, 'This proposal was already ' + r.getString('status') + '.', 'invalid_state');
  r.set('status', status);
  r.set('decision_note', util.text(p, 'note', 4000, ''));
  r.set('decided_at', util.nowIso());
  app.save(r);
  if (status === 'returned') ask(app, 'proposal_returned', { proposal_id: r.id });
  act().write(app, ctx, { label: (status === 'returned' ? 'Returned: ' : status === 'withdrawn' ? 'Withdrew: ' : 'Rejected: ') + r.getString('title'), target: 'proposals', record: r.id, project: r.getString('project') });
  return { proposal: proposalOut(app, r) };
}

function reject(ctx, p) {
  return decide(ctx, p, 'rejected');
}

function returnBack(ctx, p) {
  if (u().text(p, 'note', 4000, '') === '') throw u().fail(400, 'Say what to change in --note.', 'missing_param');
  return decide(ctx, p, 'returned');
}

function withdraw(ctx, p) {
  return decide(ctx, p, 'withdrawn');
}

/* ---------------------------------------------------------------- marks */

const MARKABLE = { works: true, nodes: true };

function markSet(ctx, p) {
  const util = u();
  const target = util.oneOf(p, 'target', Object.keys(MARKABLE), '');
  if (target === '') throw util.fail(400, 'target is one of ' + Object.keys(MARKABLE).join(', '), 'missing_param');
  const rec = core().need(ctx.app, target, util.req(p, 'record'), 'record');
  const field = util.req(p, 'field');
  if (rec.collection().fields.getByName(field) === null) throw util.fail(400, '"' + field + '" is not a field of ' + target + '.', 'invalid_param');
  const m = util.findOne(ctx.app, 'field_marks', 'target = {:t} && record = {:r} && field = {:f}', { t: target, r: rec.id, f: field }) || util.newRecord(ctx.app, 'field_marks');
  m.set('target', target);
  m.set('record', rec.id);
  m.set('field', field);
  m.set('confidence', util.oneOf(p, 'confidence', ['high', 'check'], 'check'));
  m.set('reason', util.text(p, 'reason', 2000, ''));
  m.set('actor', ctx.actor);
  ctx.app.save(m);
  return { ok: true };
}

function markClear(ctx, p) {
  const util = u();
  const m = util.findOne(ctx.app, 'field_marks', 'target = {:t} && record = {:r} && field = {:f}', { t: util.req(p, 'target'), r: util.req(p, 'record'), f: util.req(p, 'field') });
  if (m !== null) ctx.app.delete(m);
  return { ok: true };
}

/* ------------------------------------------------------------- needs you */

/** agent.needs-you: everything waiting for a person, counted, with the first items of each kind. */
function needsYou(ctx, p) {
  const util = u();
  const app = ctx.app;
  const lim = util.int(p, 'limit', 6, 0, 100);
  const G = require(`${__hooks}/lib_graph.js`);
  const counts = util.one(
    app,
    "SELECT (SELECT COUNT(*) FROM nodes WHERE status = 'agent_proposed') AS nodes, (SELECT COUNT(*) FROM relations WHERE status = 'agent_proposed') AS relations, (SELECT COUNT(*) FROM proposals WHERE status = 'waiting') AS proposals, (SELECT COUNT(*) FROM works WHERE trashed = FALSE AND identity = 'agent_proposed') AS identities, (SELECT COUNT(*) FROM works WHERE trashed = FALSE AND (resolution IN ('pending', 'not_found') OR identify = 'failed')) AS unidentified, (SELECT COUNT(*) FROM works WHERE trashed = FALSE AND integrity = 'retracted') AS retracted, (SELECT COUNT(*) FROM files WHERE current = TRUE AND text_state = 'failed') AS failed_text, (SELECT COUNT(*) FROM files WHERE current = TRUE AND text_state = 'needs_ocr') AS needs_ocr, (SELECT COUNT(*) FROM notes WHERE status = 'agent_proposed') AS notes, (SELECT COUNT(*) FROM asks WHERE status = 'answered' AND updated >= {:since}) AS answers, (SELECT COUNT(*) FROM candidates WHERE triage IN ('new', 'relevant')) AS candidates, (SELECT COUNT(*) FROM decisions d WHERE d.seat = 'agent' AND d.created >= {:since}) AS decisions, (SELECT COUNT(*) FROM ms_changes WHERE status = 'proposed') AS ms_changes, (SELECT COUNT(*) FROM response_items WHERE actor = 'agent' AND confirmed = FALSE) AS responses",
    { nodes: 0, relations: 0, proposals: 0, identities: 0, unidentified: 0, retracted: 0, failed_text: 0, needs_ocr: 0, notes: 0, answers: 0, candidates: 0, decisions: 0, ms_changes: 0, responses: 0 },
    { since: new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ') },
  );
  const c = util.plain([counts])[0];
  const out = { counts: c, total: c.nodes + c.relations + c.proposals + c.identities + c.unidentified + c.retracted + c.failed_text + c.notes + c.ms_changes + c.responses };
  if (lim > 0) {
    out.nodes = app.findRecordsByFilter('nodes', "status = 'agent_proposed'", '-created', lim, 0).map((n) => Object.assign(G.nodeOut(app, n, true), { project_name: (util.byId(app, 'projects', n.getString('project')) || { getString: () => '' }).getString('name') }));
    out.relations = app.findRecordsByFilter('relations', "status = 'agent_proposed'", '-created', lim, 0).map((r) => {
      const o = G.relOut(r);
      const f = util.byId(app, 'nodes', o.from);
      const t = util.byId(app, 'nodes', o.to);
      o.from_title = f !== null ? f.getString('title') : '';
      o.to_title = t !== null ? t.getString('title') : '';
      o.from_kind = f !== null ? f.getString('kind') : '';
      o.to_kind = t !== null ? t.getString('kind') : '';
      return o;
    });
    out.proposals = app.findRecordsByFilter('proposals', "status = 'waiting'", '-created', lim, 0).map((r) => proposalOut(app, r));
    const W = require(`${__hooks}/lib_works.js`);
    out.identities = W.rowsFor(app, util.rows(app, "SELECT id FROM works WHERE trashed = FALSE AND identity = 'agent_proposed' ORDER BY updated DESC LIMIT " + lim, { id: '' }).map((r) => r.id));
    out.unidentified = W.rowsFor(app, util.rows(app, "SELECT id FROM works WHERE trashed = FALSE AND (resolution IN ('pending', 'not_found') OR identify = 'failed') ORDER BY created DESC LIMIT " + lim, { id: '' }).map((r) => r.id));
    out.retracted = W.rowsFor(app, util.rows(app, "SELECT id FROM works WHERE trashed = FALSE AND integrity = 'retracted' ORDER BY updated DESC LIMIT " + lim, { id: '' }).map((r) => r.id));
  }
  return out;
}

/** agent.scorecard: per kind of work, how much of what your AI agent proposed people kept, edited or rejected. */
function scorecard(ctx) {
  const util = u();
  const rows = (sql) => util.plain(util.rows(ctx.app, sql, { kind: '', status: '', n: 0 }));
  return {
    nodes: rows("SELECT kind, status, COUNT(*) AS n FROM nodes WHERE actor = 'agent' GROUP BY kind, status"),
    relations: rows("SELECT kind, status, COUNT(*) AS n FROM relations WHERE actor = 'agent' GROUP BY kind, status"),
    proposals: rows("SELECT kind, status, COUNT(*) AS n FROM proposals GROUP BY kind, status"),
    identities: rows("SELECT 'identity' AS kind, identity AS status, COUNT(*) AS n FROM works WHERE added_by = 'agent' OR identity = 'agent_proposed' GROUP BY identity"),
  };
}

module.exports = {
  ask: ask,
  reask: reask,
  KINDS: KINDS,
  request: request,
  askOut: askOut,
  askCreate: askCreate,
  askList: askList,
  askGet: askGet,
  askWorking: askWorking,
  askAnswer: askAnswer,
  askFail: askFail,
  askDelete: askDelete,
  proposalOut: proposalOut,
  proposeOrRun: proposeOrRun,
  proposals: proposals,
  approve: approve,
  reject: reject,
  returnBack: returnBack,
  withdraw: withdraw,
  markSet: markSet,
  markClear: markClear,
  needsYou: needsYou,
  scorecard: scorecard,
};
