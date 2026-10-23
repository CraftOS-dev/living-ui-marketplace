/// <reference path="../pb_data/types.d.ts" />
/**
 * The claims map of a project: questions, claims and evidence (nodes) and
 * the typed links between them (relations).
 *
 *   Grammar (fixed):  evidence or claim  supports  claim
 *                     evidence or claim  opposes   claim
 *                     evidence or claim  informs   question
 *
 * Evidence always rests on at least one passage (anchor) of one paper.
 * Everything your AI agent makes here is agent_proposed; only a person
 * confirms, rejects or supersedes. Your AI agent's daily number of new
 * proposals is capped in Settings.
 */

const KINDS = ['question', 'claim', 'evidence'];
const REL_KINDS = ['supports', 'opposes', 'informs'];
const BASIS = ['data_result', 'literature_finding', 'interpretation', 'hypothesis'];

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function act() {
  return require(`${__hooks}/lib_activity.js`);
}
function text() {
  return require(`${__hooks}/lib_text.js`);
}

function grammarOk(fromKind, toKind, kind) {
  if (kind === 'supports' || kind === 'opposes') return (fromKind === 'evidence' || fromKind === 'claim') && toKind === 'claim';
  if (kind === 'informs') return (fromKind === 'evidence' || fromKind === 'claim') && toKind === 'question';
  return false;
}

function grammarText() {
  return 'Links: evidence or claim supports a claim; evidence or claim opposes a claim; evidence or claim informs a question.';
}

/* -------------------------------------------------------------- outputs */

function anchorsOf(app, nodeId) {
  const t = text();
  return u()
    .rows(app, 'SELECT anchor AS id FROM node_anchors WHERE node = {:n} ORDER BY sort, created', { id: '' }, { n: nodeId })
    .map((r) => u().byId(app, 'anchors', r.id))
    .filter((a) => a !== null)
    .map((a) => t.anchorOut(app, a));
}

function nodeOut(app, n, full) {
  const c = core();
  const w = n.getString('work') !== '' ? u().byId(app, 'works', n.getString('work')) : null;
  const o = {
    id: n.id,
    project: n.getString('project'),
    kind: n.getString('kind'),
    title: n.getString('title'),
    body: n.getString('body'),
    status: n.getString('status'),
    claim_basis: n.getString('claim_basis'),
    confidence: n.getString('confidence'),
    actor: n.getString('actor'),
    why: n.getString('why'),
    work: n.getString('work'),
    work_label: w !== null ? c.workLabel(w) : '',
    x: n.getFloat('x'),
    y: n.getFloat('y'),
    placed: n.getBool('placed'),
    decided_at: n.getString('decided_at'),
    created: n.getString('created'),
    updated: n.getString('updated'),
  };
  if (full) o.anchors = anchorsOf(app, n.id);
  return o;
}

function relOut(r) {
  return { id: r.id, project: r.getString('project'), from: r.getString('from_node'), to: r.getString('to_node'), kind: r.getString('kind'), status: r.getString('status'), reason: r.getString('reason'), actor: r.getString('actor'), created: r.getString('created') };
}

/* ----------------------------------------------------------------- caps */

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().replace('T', ' ');
}

function checkCap(ctx, adding) {
  if (!ctx.isAgent) return;
  const util = u();
  const cap = core().policy(ctx.app).node_cap;
  const today = util.count(ctx.app, "SELECT (SELECT COUNT(*) FROM nodes WHERE actor = 'agent' AND created >= {:d}) + (SELECT COUNT(*) FROM relations WHERE actor = 'agent' AND created >= {:d}) AS n", { d: startOfToday() });
  if (today + adding > cap) throw util.fail(429, 'Your AI agent has made ' + today + ' proposals today; the daily limit in Settings is ' + cap + '. Ask the person to review what is waiting first.', 'agent_cap_reached', { today: today, cap: cap });
}

/* ---------------------------------------------------------------- nodes */

/** Anchors for a new node: existing anchor ids, and/or passage specs resolved now. */
function anchorsFrom(ctx, p) {
  const util = u();
  const out = { ids: [], specs: [] };
  out.ids = util.ids(p, 'anchors', 50);
  for (const id of out.ids) {
    const a = core().need(ctx.app, 'anchors', id, 'passage');
    core().guardWork(ctx, core().need(ctx.app, 'works', a.getString('work'), 'paper'));
  }
  let passages = [];
  if (util.has(p, 'passage')) {
    const one = util.obj(p, 'passage');
    passages = [one];
  }
  if (util.has(p, 'passages')) passages = passages.concat(util.list(p, 'passages') || []);
  if (passages.length > 20) throw util.fail(400, 'At most 20 passages per node.', 'too_many');
  out.specs = passages.map((s, i) => {
    try {
      return text().resolveSpec(ctx, s);
    } catch (err) {
      if (err && err.status) err.message = 'Passage ' + (i + 1) + ': ' + err.message;
      throw err;
    }
  });
  return out;
}

/** nodes.create: a question, claim or evidence (with its passages and an optional link). */
function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = core().project(app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind === '') throw util.fail(400, 'kind is question, claim or evidence', 'missing_param', { param: 'kind' });
  const title = util.squash(util.text(p, 'title', 2000, ''));
  if (title === '') throw util.fail(400, 'title is required: the question, the claim in one sentence, or what the evidence shows.', 'missing_param', { param: 'title' });
  const basis = util.oneOf(p, 'claim_basis', BASIS, '');
  const conf = util.oneOf(p, 'confidence', ['low', 'medium', 'high'], '');
  const anchors = anchorsFrom(ctx, p);
  if (kind === 'evidence' && anchors.ids.length + anchors.specs.length === 0) throw util.fail(400, 'Evidence rests on a passage: give --passage (page and lines or offsets) or --anchors.', 'evidence_needs_anchor');
  const relTo = util.str(p, 'link_to', '');
  const relKind = util.oneOf(p, 'link_kind', REL_KINDS, '');
  let target = null;
  if (relTo !== '') {
    target = core().need(app, 'nodes', relTo, 'node');
    if (target.getString('project') !== pr.id) throw util.fail(400, 'link_to must be a node of the same project.', 'invalid_param');
    if (relKind === '') throw util.fail(400, 'link_kind is required with link_to (supports, opposes or informs).', 'missing_param');
    if (!grammarOk(kind, target.getString('kind'), relKind)) throw util.fail(400, 'A ' + kind + ' cannot ' + relKind.replace(/s$/, '') + ' a ' + target.getString('kind') + '. ' + grammarText(), 'relation_grammar');
  }
  // Your AI agent never proposes the same node twice.
  const twin = util.one(app, 'SELECT id FROM nodes WHERE project = {:p} AND kind = {:k} AND LOWER(title) = LOWER({:t}) AND status != \'researcher_rejected\' LIMIT 1', { id: '' }, { p: pr.id, k: kind, t: title });
  if (twin !== null && ctx.isAgent) throw util.fail(409, 'This project already has that ' + kind + ' (' + twin.id + '); link to it instead of making it again.', 'duplicate_node', { node: twin.id });
  checkCap(ctx, 1 + (target !== null ? 1 : 0));
  let n = null;
  let rel = null;
  app.runInTransaction((tx) => {
    const madeAnchors = anchors.specs.map((s) => text().createAnchor(tx, ctx, s));
    const allIds = anchors.ids.concat(madeAnchors.map((a) => a.id));
    let workId = '';
    for (const id of allIds) {
      const a = tx.findRecordById('anchors', id);
      if (workId === '') workId = a.getString('work');
      else if (kind === 'evidence' && a.getString('work') !== workId) throw util.fail(400, 'One evidence item comes from one paper; make one per paper.', 'evidence_one_paper');
    }
    n = util.newRecord(tx, 'nodes');
    n.set('project', pr.id);
    n.set('kind', kind);
    n.set('title', title);
    n.set('body', util.text(p, 'body', 20000, ''));
    n.set('status', core().judgedStatus(ctx));
    n.set('claim_basis', kind === 'claim' ? basis : '');
    n.set('confidence', kind === 'claim' ? conf : '');
    n.set('actor', ctx.actor);
    n.set('why', ctx.isAgent ? util.text(p, 'why', 4000, '') : '');
    n.set('work', workId);
    n.set('sort', util.count(tx, 'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM nodes WHERE project = {:p}', { p: pr.id }));
    tx.save(n);
    allIds.forEach((id, i) => {
      const na = util.newRecord(tx, 'node_anchors');
      na.set('node', n.id);
      na.set('anchor', id);
      na.set('sort', i);
      tx.save(na);
    });
    if (target !== null) {
      rel = util.newRecord(tx, 'relations');
      rel.set('project', pr.id);
      rel.set('from_node', n.id);
      rel.set('to_node', target.id);
      rel.set('kind', relKind);
      rel.set('status', core().judgedStatus(ctx));
      rel.set('reason', util.text(p, 'reason', 4000, ''));
      rel.set('actor', ctx.actor);
      tx.save(rel);
    }
    act().write(tx, ctx, { label: (ctx.isAgent ? 'Proposed the ' : 'Added the ') + kind + ' "' + title.slice(0, 100) + '"', target: 'nodes', record: n.id, project: pr.id });
  });
  return { node: nodeOut(app, app.findRecordById('nodes', n.id), true), relation: rel !== null ? relOut(rel) : null };
}

/** nodes.create-many: several nodes in one call (your AI agent's claim maps). */
function createMany(ctx, p) {
  const util = u();
  const items = util.list(p, 'nodes') || [];
  if (items.length === 0) throw util.fail(400, 'nodes is a JSON list of {kind, title, body, claim_basis, passage | passages | anchors, link_to, link_kind, reason, why}.', 'missing_param');
  if (items.length > 60) throw util.fail(400, 'At most 60 nodes per call.', 'too_many');
  checkCap(ctx, items.length);
  const made = [];
  const errors = [];
  const refs = {};
  items.forEach((it, i) => {
    try {
      util.keysOnly(it, ['ref', 'kind', 'title', 'body', 'claim_basis', 'confidence', 'passage', 'passages', 'anchors', 'link_to', 'link_kind', 'reason', 'why'], 'Node ' + (i + 1));
      const q = Object.assign({ project: p.project }, it);
      delete q.ref;
      // A node may link to one made earlier in this list by its "ref".
      if (typeof q.link_to === 'string' && refs[q.link_to]) q.link_to = refs[q.link_to];
      const r = create(ctx, q);
      if (typeof it.ref === 'string' && it.ref !== '') refs[it.ref] = r.node.id;
      made.push({ index: i + 1, node: r.node.id, title: r.node.title, kind: r.node.kind, relation: r.relation ? r.relation.id : null });
    } catch (err) {
      errors.push({ index: i + 1, code: (err && err.code) || 'error', message: String((err && err.message) || err) });
    }
  });
  return { made: made, errors: errors };
}

function mayEdit(ctx, n) {
  if (!ctx.isAgent) return;
  if (n.getString('actor') !== 'agent' || n.getString('status') !== 'agent_proposed') {
    throw u().fail(403, 'Your AI agent changes only its own proposals that a person has not decided yet.', 'agent_not_permitted');
  }
}

/** nodes.update: wording, basis, confidence, position on the map. */
function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = core().need(app, 'nodes', util.req(p, 'node'), 'node');
  core().guardProjectId(ctx, n.getString('project'));
  const onlyPlace = Object.keys(p).every((k) => ['node', 'x', 'y', 'placed'].indexOf(k) >= 0);
  if (!onlyPlace) mayEdit(ctx, n);
  if (util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 2000, ''));
    if (t === '') throw util.fail(400, 'A node needs a title.', 'invalid_param');
    n.set('title', t);
  }
  if (util.has(p, 'body')) n.set('body', util.text(p, 'body', 20000, ''));
  if (util.has(p, 'claim_basis')) n.set('claim_basis', util.oneOf(p, 'claim_basis', BASIS, ''));
  if (util.has(p, 'confidence')) n.set('confidence', util.oneOf(p, 'confidence', ['low', 'medium', 'high'], ''));
  if (util.has(p, 'x')) n.set('x', util.num(p, 'x', 0, -1e7, 1e7));
  if (util.has(p, 'y')) n.set('y', util.num(p, 'y', 0, -1e7, 1e7));
  if (util.has(p, 'placed')) n.set('placed', util.bool(p, 'placed', true));
  else if (util.has(p, 'x') || util.has(p, 'y')) n.set('placed', true);
  app.save(n);
  return { node: nodeOut(app, n, true) };
}

/** nodes.move: positions for many nodes at once (dragging on the map). */
function move(ctx, p) {
  const util = u();
  const items = util.list(p, 'positions') || [];
  ctx.app.runInTransaction((tx) => {
    items.slice(0, 2000).forEach((it, i) => {
      util.keysOnly(it, ['node', 'x', 'y'], 'Position ' + (i + 1));
      const n = core().need(tx, 'nodes', String(it.node), 'node');
      core().guardProjectId(ctx, n.getString('project'));
      n.set('x', Number(it.x) || 0);
      n.set('y', Number(it.y) || 0);
      n.set('placed', true);
      tx.save(n);
    });
  });
  return { moved: items.length };
}

/** graph.tidy: hand every node of a project (or the given ones) back to the automatic layout. */
function tidy(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const only = util.ids(p, 'nodes', 2000);
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    for (const r of tx.findRecordsByFilter('nodes', 'project = {:p} && placed = true', '', 0, 0, { p: pr.id })) {
      if (only.length > 0 && only.indexOf(r.id) < 0) continue;
      r.set('placed', false);
      tx.save(r);
      n++;
    }
  });
  return { tidied: n };
}

/** nodes.decide: confirm, reject or supersede nodes (people only). With --links true their proposed links follow. */
function decide(ctx, p) {
  const util = u();
  const app = ctx.app;
  const list = util.ids(p, 'nodes', 1000);
  if (list.length === 0) throw util.fail(400, 'Give --nodes.', 'missing_param');
  const to = util.oneOf(p, 'status', ['researcher_confirmed', 'researcher_rejected', 'superseded', 'agent_proposed'], '');
  if (to === '') throw util.fail(400, 'status is researcher_confirmed, researcher_rejected, superseded (or agent_proposed to undo a decision).', 'missing_param');
  const links = util.bool(p, 'links', true);
  const now = util.nowIso();
  let n = 0;
  app.runInTransaction((tx) => {
    for (const id of list) {
      const node = core().need(tx, 'nodes', id, 'node');
      if (to === 'agent_proposed' && node.getString('actor') !== 'agent') continue;
      node.set('status', to);
      node.set('decided_at', to === 'agent_proposed' ? '' : now);
      tx.save(node);
      n++;
      if (links && to !== 'superseded') {
        for (const r of tx.findRecordsByFilter('relations', "from_node = {:n} && status = 'agent_proposed'", '', 0, 0, { n: id })) {
          r.set('status', to === 'agent_proposed' ? 'agent_proposed' : to);
          r.set('decided_at', now);
          tx.save(r);
        }
      }
    }
    const verb = to === 'researcher_confirmed' ? 'Confirmed' : to === 'researcher_rejected' ? 'Rejected' : to === 'superseded' ? 'Marked as superseded' : 'Reopened';
    act().write(tx, ctx, { label: verb + ' ' + (n === 1 ? 'a node' : n + ' nodes'), target: 'nodes', record: list.length === 1 ? list[0] : '', undo: { fn: 'lib_graph.undoDecide', args: { nodes: list } } });
  });
  return { decided: n };
}

function undoDecide(ctx, args) {
  ctx.app.runInTransaction((tx) => {
    for (const id of args.nodes || []) {
      const n = u().byId(tx, 'nodes', id);
      if (n === null || n.getString('actor') !== 'agent') continue;
      n.set('status', 'agent_proposed');
      n.set('decided_at', '');
      tx.save(n);
    }
  });
}

/** nodes.delete: remove a node and its links (its passages stay when highlights use them). */
function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = core().need(app, 'nodes', util.req(p, 'node'), 'node');
  core().guardProjectId(ctx, n.getString('project'));
  mayEdit(ctx, n);
  const links = util.count(app, 'SELECT COUNT(*) AS n FROM relations WHERE from_node = {:n} OR to_node = {:n}', { n: n.id });
  if (util.bool(p, 'preview', false)) return { preview: true, links: links };
  app.runInTransaction((tx) => {
    const anchorIds = tx.findRecordsByFilter('node_anchors', 'node = {:n}', '', 0, 0, { n: n.id }).map((r) => r.getString('anchor'));
    tx.delete(tx.findRecordById('nodes', n.id));
    for (const aid of anchorIds) {
      const used = util.count(tx, 'SELECT (SELECT COUNT(*) FROM annotations WHERE anchor = {:a}) + (SELECT COUNT(*) FROM node_anchors WHERE anchor = {:a}) + (SELECT COUNT(*) FROM board_items WHERE anchor = {:a}) AS n', { a: aid });
      if (used === 0) {
        const a = util.byId(tx, 'anchors', aid);
        if (a !== null) tx.delete(a);
      }
    }
    act().write(tx, ctx, { label: 'Removed the ' + n.getString('kind') + ' "' + n.getString('title').slice(0, 100) + '"', target: 'nodes', record: n.id, project: n.getString('project') });
  });
  return { deleted: true, links: links };
}

/** nodes.add-passage: another passage for a node. */
function addPassage(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = core().need(app, 'nodes', util.req(p, 'node'), 'node');
  core().guardProjectId(ctx, n.getString('project'));
  mayEdit(ctx, n);
  const anchors = anchorsFrom(ctx, p);
  app.runInTransaction((tx) => {
    const made = anchors.specs.map((s) => text().createAnchor(tx, ctx, s));
    const ids = anchors.ids.concat(made.map((a) => a.id));
    let sort = util.count(tx, 'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM node_anchors WHERE node = {:n}', { n: n.id });
    for (const id of ids) {
      const a = tx.findRecordById('anchors', id);
      if (n.getString('kind') === 'evidence' && n.getString('work') !== '' && a.getString('work') !== n.getString('work')) throw util.fail(400, 'One evidence item comes from one paper.', 'evidence_one_paper');
      if (util.findOne(tx, 'node_anchors', 'node = {:n} && anchor = {:a}', { n: n.id, a: id }) !== null) continue;
      const na = util.newRecord(tx, 'node_anchors');
      na.set('node', n.id);
      na.set('anchor', id);
      na.set('sort', sort++);
      tx.save(na);
      if (n.getString('work') === '') {
        const nr = tx.findRecordById('nodes', n.id);
        nr.set('work', a.getString('work'));
        tx.save(nr);
      }
    }
  });
  return { node: nodeOut(app, app.findRecordById('nodes', n.id), true) };
}

function removePassage(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = core().need(app, 'nodes', util.req(p, 'node'), 'node');
  core().guardProjectId(ctx, n.getString('project'));
  mayEdit(ctx, n);
  const anchor = util.req(p, 'anchor');
  const count = util.count(app, 'SELECT COUNT(*) AS n FROM node_anchors WHERE node = {:n}', { n: n.id });
  if (n.getString('kind') === 'evidence' && count <= 1) throw util.fail(409, 'Evidence keeps at least one passage; delete the evidence instead.', 'evidence_needs_anchor');
  const na = util.findOne(app, 'node_anchors', 'node = {:n} && anchor = {:a}', { n: n.id, a: anchor });
  if (na !== null) app.delete(na);
  return { node: nodeOut(app, app.findRecordById('nodes', n.id), true) };
}

/** nodes.list: a project's nodes, filtered by kind, status, paper or who. */
function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const proj = util.str(p, 'project', '');
  if (proj !== '') {
    const pr = core().project(app, proj);
    core().guardProject(ctx, pr);
    where.push('project = {:p}');
    bind.p = pr.id;
  } else if (ctx.isAgent) where.push("project.confidentiality = 'normal'");
  const kind = util.oneOf(p, 'kind', KINDS, '');
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  const status = util.oneOf(p, 'status', core().JUDGED, '');
  if (status !== '') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const work = util.str(p, 'work', '');
  if (work !== '') {
    where.push('work = {:w}');
    bind.w = core().work(app, work).id;
  }
  const actor = util.oneOf(p, 'actor', ['person', 'agent'], '');
  if (actor !== '') {
    where.push('actor = {:a}');
    bind.a = actor;
  }
  const pg = util.page(p, 200, 2000);
  const recs = app.findRecordsByFilter('nodes', where.length > 0 ? where.join(' && ') : '', 'sort,created', pg.limit, pg.offset, bind);
  return { nodes: recs.map((n) => nodeOut(app, n, util.bool(p, 'passages', true))) };
}

/** nodes.get: one node with its passages, its links grouped by kind, and where it appears. */
function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = core().need(app, 'nodes', util.req(p, 'node'), 'node');
  core().guardProjectId(ctx, n.getString('project'));
  const rels = app.findRecordsByFilter('relations', 'from_node = {:n} || to_node = {:n}', 'created', 0, 0, { n: n.id });
  const others = {};
  for (const r of rels) for (const id of [r.getString('from_node'), r.getString('to_node')]) if (id !== n.id) others[id] = true;
  const peers = Object.keys(others).length > 0 ? app.findRecordsByIds('nodes', Object.keys(others)) : [];
  const peerOut = {};
  for (const x of peers) peerOut[x.id] = nodeOut(app, x, false);
  const linked = rels.map((r) => {
    const o = relOut(r);
    o.direction = r.getString('from_node') === n.id ? 'out' : 'in';
    o.node = peerOut[o.direction === 'out' ? o.to : o.from] || null;
    return o;
  });
  const boards = util.plain(util.rows(app, 'SELECT DISTINCT b.id, b.name FROM board_items bi JOIN boards b ON b.id = bi.board WHERE bi.node = {:n}', { id: '', name: '' }, { n: n.id }));
  return { node: nodeOut(app, n, true), links: linked, boards: boards };
}

/** graph.map: everything the claims map draws for a project, with each claim's balance. */
function map(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = core().project(app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const showRejected = util.bool(p, 'rejected', false);
  const nodes = app.findRecordsByFilter('nodes', 'project = {:p}' + (showRejected ? '' : " && status != 'researcher_rejected'"), 'sort,created', 0, 0, { p: pr.id });
  const rels = app.findRecordsByFilter('relations', 'project = {:p}' + (showRejected ? '' : " && status != 'researcher_rejected'"), 'created', 0, 0, { p: pr.id });
  const quotes = {};
  for (const r of util.rows(app, 'SELECT na.node AS node, a.quote AS quote, a.page_no AS page, a.id AS anchor FROM node_anchors na JOIN anchors a ON a.id = na.anchor JOIN nodes n ON n.id = na.node WHERE n.project = {:p} ORDER BY na.sort', { node: '', quote: '', page: 0, anchor: '' }, { p: pr.id })) {
    if (!quotes[r.node]) quotes[r.node] = { quote: r.quote.slice(0, 400), page: r.page, anchor: r.anchor, count: 0 };
    quotes[r.node].count++;
  }
  const balance = {};
  for (const r of rels) {
    const to = r.getString('to_node');
    const b = (balance[to] = balance[to] || { supports: 0, opposes: 0, informs: 0, proposed: 0 });
    if (r.getString('status') === 'agent_proposed') b.proposed++;
    else if (r.getString('status') === 'researcher_confirmed') b[r.getString('kind')]++;
  }
  return {
    project: { id: pr.id, name: pr.getString('name'), question: pr.getString('question') },
    nodes: nodes.map((n) => Object.assign(nodeOut(app, n, false), { passage: quotes[n.id] || null, balance: balance[n.id] || { supports: 0, opposes: 0, informs: 0, proposed: 0 } })),
    relations: rels.map(relOut),
  };
}

/* ------------------------------------------------------------ relations */

/** relations.create: link two nodes (the grammar is checked). */
function relCreate(ctx, p) {
  const util = u();
  const app = ctx.app;
  const from = core().need(app, 'nodes', util.req(p, 'from'), 'node');
  const to = core().need(app, 'nodes', util.req(p, 'to'), 'node');
  core().guardProjectId(ctx, from.getString('project'));
  if (from.getString('project') !== to.getString('project')) throw util.fail(400, 'Both nodes must be in the same project.', 'invalid_param');
  if (from.id === to.id) throw util.fail(400, 'A node cannot link to itself.', 'invalid_param');
  const kind = util.oneOf(p, 'kind', REL_KINDS, '');
  if (kind === '') throw util.fail(400, 'kind is supports, opposes or informs', 'missing_param');
  if (!grammarOk(from.getString('kind'), to.getString('kind'), kind)) throw util.fail(400, 'A ' + from.getString('kind') + ' cannot ' + kind.replace(/s$/, '') + ' a ' + to.getString('kind') + '. ' + grammarText(), 'relation_grammar');
  const existing = util.findOne(app, 'relations', 'from_node = {:f} && to_node = {:t} && kind = {:k}', { f: from.id, t: to.id, k: kind });
  if (existing !== null) return { relation: relOut(existing), existed: true };
  checkCap(ctx, 1);
  const r = util.newRecord(app, 'relations');
  r.set('project', from.getString('project'));
  r.set('from_node', from.id);
  r.set('to_node', to.id);
  r.set('kind', kind);
  r.set('status', core().judgedStatus(ctx));
  r.set('reason', util.text(p, 'reason', 4000, ''));
  r.set('actor', ctx.actor);
  app.save(r);
  act().write(app, ctx, { label: (ctx.isAgent ? 'Proposed: ' : '') + '"' + from.getString('title').slice(0, 60) + '" ' + kind + ' "' + to.getString('title').slice(0, 60) + '"', target: 'relations', record: r.id, project: from.getString('project') });
  return { relation: relOut(r) };
}

function relDecide(ctx, p) {
  const util = u();
  const list = util.ids(p, 'relations', 1000);
  const to = util.oneOf(p, 'status', ['researcher_confirmed', 'researcher_rejected'], '');
  if (to === '' || list.length === 0) throw util.fail(400, 'Give --relations and --status researcher_confirmed or researcher_rejected.', 'missing_param');
  ctx.app.runInTransaction((tx) => {
    for (const id of list) {
      const r = core().need(tx, 'relations', id, 'link');
      r.set('status', to);
      r.set('decided_at', util.nowIso());
      tx.save(r);
    }
    act().write(tx, ctx, { label: (to === 'researcher_confirmed' ? 'Confirmed ' : 'Rejected ') + (list.length === 1 ? 'a link' : list.length + ' links'), target: 'relations', record: list.length === 1 ? list[0] : '' });
  });
  return { decided: list.length };
}

function relUpdate(ctx, p) {
  const util = u();
  const r = core().need(ctx.app, 'relations', util.req(p, 'relation'), 'link');
  core().guardProjectId(ctx, r.getString('project'));
  if (ctx.isAgent && (r.getString('actor') !== 'agent' || r.getString('status') !== 'agent_proposed')) throw util.fail(403, 'Your AI agent changes only its own undecided links.', 'agent_not_permitted');
  if (util.has(p, 'kind')) {
    const kind = util.oneOf(p, 'kind', REL_KINDS, r.getString('kind'));
    const from = ctx.app.findRecordById('nodes', r.getString('from_node'));
    const to = ctx.app.findRecordById('nodes', r.getString('to_node'));
    if (!grammarOk(from.getString('kind'), to.getString('kind'), kind)) throw util.fail(400, grammarText(), 'relation_grammar');
    r.set('kind', kind);
  }
  if (util.has(p, 'reason')) r.set('reason', util.text(p, 'reason', 4000, ''));
  ctx.app.save(r);
  return { relation: relOut(r) };
}

function relDelete(ctx, p) {
  const util = u();
  const r = core().need(ctx.app, 'relations', util.req(p, 'relation'), 'link');
  core().guardProjectId(ctx, r.getString('project'));
  if (ctx.isAgent && (r.getString('actor') !== 'agent' || r.getString('status') !== 'agent_proposed')) throw util.fail(403, 'Your AI agent removes only its own undecided links.', 'agent_not_permitted');
  ctx.app.delete(r);
  return { deleted: true };
}

module.exports = {
  KINDS: KINDS,
  REL_KINDS: REL_KINDS,
  grammarOk: grammarOk,
  nodeOut: nodeOut,
  relOut: relOut,
  create: create,
  createMany: createMany,
  update: update,
  move: move,
  tidy: tidy,
  decide: decide,
  undoDecide: undoDecide,
  remove: remove,
  addPassage: addPassage,
  removePassage: removePassage,
  list: list,
  get: get,
  map: map,
  relCreate: relCreate,
  relDecide: relDecide,
  relUpdate: relUpdate,
  relDelete: relDelete,
};
