/// <reference path="../pb_data/types.d.ts" />
/**
 * Edit stacks, their journal and the AI agent's proposals.
 *
 * Every operation is a pure change to a list of edits (add, update, move,
 * toggle, remove, a recipe, a reset, an undo); persist() then diffs the list
 * against what is stored and writes the edits and one journal batch in one
 * transaction. A dry run renders the changed list without saving it.
 *
 * Who decides: the person's edits apply at once. The AI agent's edits apply
 * at once only when the policy says so (settings.policy.agent_edits =
 * apply); by default they wait as a proposal (state proposed) the person
 * accepts or rejects, and the agent may then only add edits or change its
 * own proposed ones. Undo, redo and revert work on the journal: a revert is
 * a new batch, so it can be reverted in turn.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function K() {
  return require(`${__hooks}/lib_kinds.js`);
}
function G() {
  return require(`${__hooks}/lib_geom.js`);
}
function I() {
  return require(`${__hooks}/lib_images.js`);
}
function R() {
  return require(`${__hooks}/lib_render.js`);
}

function toPlain(rec) {
  const u = U();
  return {
    id: rec.id,
    kind: rec.getString('kind'),
    params: u.getJson(rec, 'params') || {},
    enabled: rec.getBool('enabled'),
    author: rec.getString('author') || 'you',
    state: rec.getString('state') || 'active',
    proposal: rec.getString('proposal'),
    note: rec.getString('note'),
    rec: rec,
  };
}

/** Every edit of an image (active and proposed), in order. */
function load(app, imageId) {
  return app.findRecordsByFilter('edits', 'image = {:i}', 'seq', 0, 0, { i: imageId }).map(toPlain);
}

function snap(e, seq) {
  return { id: e.id, kind: e.kind, params: e.params, enabled: e.enabled !== false, author: e.author, state: e.state, proposal: e.proposal || '', note: e.note || '', seq: seq };
}

/** What renders: the active edits, plus one proposal's edits when previewing it. */
function visible(list, proposalId) {
  return list.filter((e) => e.state === 'active' || (proposalId && e.proposal === proposalId));
}

function policy(app) {
  const s = app.findRecordsByFilter('settings', 'id != ""', '', 1, 0)[0];
  const p = (s && U().getJson(s, 'policy')) || {};
  return { agent_edits: p.agent_edits === 'apply' ? 'apply' : 'propose', agent_batches: p.agent_batches === 'run' ? 'run' : 'propose', house_rules: p.house_rules || '' };
}

/** Sizes through the visible stack of a proposal context. */
function dimsAt(img, list, index) {
  const ch = G().chain(list, img.getInt('width'), img.getInt('height'));
  return ch[Math.max(0, Math.min(index, ch.length - 1))];
}

function serializeEdit(e, dimsIn, dimsOut, app) {
  const k = K().KINDS[e.kind] || { label: e.kind, icon: 'Square' };
  const rec = e.rec;
  return {
    id: e.id,
    kind: e.kind,
    label: k.label,
    icon: k.icon,
    params: e.params,
    enabled: e.enabled !== false,
    author: e.author,
    state: e.state,
    proposal: e.proposal || '',
    note: e.note || '',
    summary: K().summary(e.kind, e.params, dimsOut),
    in: dimsIn,
    out: dimsOut,
    mask_url: rec && rec.getString('mask') !== '' ? U().fileUrl(rec, 'mask') : '',
    mask_info: rec ? U().getJson(rec, 'mask_info') : null,
    created: rec ? rec.getString('created') : '',
    updated: rec ? rec.getString('updated') : '',
  };
}

/** The stack as the answers show it: every edit with its size in and out. */
function describe(app, img, list) {
  const out = [];
  const act = [];
  const props = {};
  for (const e of list) {
    if (e.state === 'active') act.push(e);
    else (props[e.proposal] = props[e.proposal] || []).push(e);
  }
  const chainA = G().chain(act, img.getInt('width'), img.getInt('height'));
  let ai = 0;
  for (const e of list) {
    if (e.state === 'active') {
      out.push(serializeEdit(e, chainA[ai], chainA[ai + 1], app));
      ai++;
    } else {
      const vis = visible(list, e.proposal);
      const idx = vis.indexOf(e);
      const ch = G().chain(vis, img.getInt('width'), img.getInt('height'));
      out.push(serializeEdit(e, ch[idx], ch[idx + 1], app));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- persist */

function nextOrd(app) {
  const r = U().rows(app, 'SELECT COALESCE(MAX([[ord]]), 0) AS n FROM {{changes}}', { n: 0 });
  return (r[0] ? r[0].n : 0) + 1;
}

function same(a, b) {
  return U().canonical(a) === U().canonical(b);
}

/**
 * Save after (a list) over before. Active changes are journaled as one
 * batch; proposed edits are saved without a journal (they change nothing
 * visible). Returns the batch id ('' when nothing visible changed).
 */
function persist(app, who, img, before, after, opts) {
  const o = opts || {};
  const u = U();
  const batch = o.batch || u.newId();
  let journaled = 0;
  app.runInTransaction((tx) => {
    let ord = nextOrd(tx);
    const coll = tx.findCollectionByNameOrId('edits');
    const changes = tx.findCollectionByNameOrId('changes');
    const byIdBefore = {};
    before.forEach((e, i) => (byIdBefore[e.id] = { e: e, seq: i + 1 }));
    const byIdAfter = {};
    after.forEach((e, i) => (byIdAfter[e.id] = { e: e, seq: i + 1 }));
    const journal = (action, editId, b, a) => {
      const visibleChange = (b && b.state === 'active') || (a && a.state === 'active');
      if (!visibleChange || o.noJournal) return;
      const r = new Record(changes);
      r.set('image', img.id);
      r.set('batch', batch);
      r.set('actor', o.actor || who);
      r.set('action', action);
      r.set('edit', editId);
      r.set('before', b);
      r.set('after', a);
      r.set('ord', ord++);
      r.set('note', String(o.note || '').slice(0, 2000));
      if (o.reverts) r.set('reverts', o.reverts);
      tx.save(r);
      journaled++;
    };
    // Removed.
    for (const e of before) {
      if (byIdAfter[e.id]) continue;
      const rec = u.byId(tx, 'edits', e.id);
      if (rec !== null) tx.delete(rec);
      journal('remove', e.id, snap(e, byIdBefore[e.id].seq), null);
    }
    // Added or changed.
    after.forEach((e, i) => {
      const seq = i + 1;
      const was = byIdBefore[e.id];
      if (!was) {
        const rec = new Record(coll);
        rec.set('id', e.id);
        rec.set('image', img.id);
        rec.set('seq', seq);
        rec.set('kind', e.kind);
        rec.set('params', e.params);
        rec.set('enabled', e.enabled !== false);
        rec.set('author', e.author || who);
        rec.set('state', e.state || 'active');
        if (e.proposal) rec.set('proposal', e.proposal);
        rec.set('note', String(e.note || '').slice(0, 2000));
        tx.save(rec);
        e.rec = rec;
        journal(o.accept ? 'accept' : 'add', e.id, null, snap(e, seq));
        return;
      }
      const b = was.e;
      const rec = tx.findRecordById('edits', e.id);
      let dirty = false;
      if (!same(b.params, e.params) || b.note !== e.note || (b.enabled !== false) !== (e.enabled !== false) || b.state !== e.state || (b.proposal || '') !== (e.proposal || '')) {
        rec.set('params', e.params);
        rec.set('enabled', e.enabled !== false);
        rec.set('note', String(e.note || '').slice(0, 2000));
        rec.set('state', e.state);
        rec.set('proposal', e.proposal || '');
        dirty = true;
        const action = b.state !== e.state ? 'accept' : !same(b.params, e.params) || b.note !== e.note ? 'update' : 'toggle';
        journal(action, e.id, snap(b, was.seq), snap(e, seq));
      }
      if (rec.getInt('seq') !== seq) {
        rec.set('seq', seq);
        dirty = true;
        if (was.seq !== seq && !(b.state !== 'active' && e.state !== 'active')) {
          // Only a real move is journaled (not the shift of everything after an insert).
          const relBefore = before.filter((x) => byIdAfter[x.id]).indexOf(b);
          const relAfter = after.filter((x) => byIdBefore[x.id]).indexOf(e);
          if (relBefore !== relAfter) journal('move', e.id, snap(b, was.seq), snap(e, seq));
        }
      }
      if (dirty) tx.save(rec);
      e.rec = rec;
    });
    if (o.afterJournal) o.afterJournal(tx, batch);
  });
  return journaled > 0 ? batch : '';
}

/* ------------------------------------------------------------- proposals */

function serializeProposal(app, p) {
  const u = U();
  const img = u.byId(app, 'images', p.getString('image'));
  return {
    id: p.id,
    kind: p.getString('kind'),
    image: img === null ? null : { id: img.id, name: img.getString('name') },
    title: p.getString('title'),
    reason: p.getString('reason'),
    status: p.getString('status'),
    preview_url: u.fileUrl(p, 'preview'),
    preview_path: u.filePath(app, p, 'preview'),
    summary: u.getJson(p, 'summary') || {},
    batch: p.getString('batch'),
    author: p.getString('author') || 'agent',
    decided_at: p.getString('decided_at'),
    response: p.getString('response'),
    created: p.getString('created'),
    updated: p.getString('updated'),
  };
}

/** The agent's open proposal for an image (created on first use). */
function openProposal(app, img, title, reason) {
  const rows = app.findRecordsByFilter('proposals', "image = {:i} && status = 'pending' && kind = 'edits'", '-created', 1, 0, { i: img.id });
  let p = rows[0] || null;
  if (p === null) {
    p = new Record(app.findCollectionByNameOrId('proposals'));
    p.set('image', img.id);
    p.set('kind', 'edits');
    p.set('status', 'pending');
    p.set('author', 'agent');
    p.set('title', String(title || 'Edits to ' + img.getString('name')).slice(0, 300));
    p.set('reason', String(reason || '').slice(0, 4000));
    app.save(p);
  } else if (title || reason) {
    if (title) p.set('title', String(title).slice(0, 300));
    if (reason) p.set('reason', String(reason).slice(0, 4000));
    app.save(p);
  }
  return p;
}

/** Render a proposal's preview (the image with its edits applied) onto the record. */
function refreshProposal(app, img, p) {
  const list = load(app, img.id);
  const edits = list.filter((e) => e.proposal === p.id);
  const vis = visible(list, p.id);
  const ch = G().chain(vis, img.getInt('width'), img.getInt('height'));
  const summary = { edits: edits.map((e) => ({ kind: e.kind, summary: K().summary(e.kind, e.params, null) })), out: ch[ch.length - 1] };
  try {
    const r = R().render(app, img, vis, { max: 1600 });
    p.set('preview', $filesystem.fileFromPath(r.path));
  } catch (err) {
    summary.error = String((err && err.message) || err);
  }
  p.set('summary', summary);
  app.save(p);
  return p;
}

/* -------------------------------------------------------------- the ops */

function mustEdit(app, ref) {
  const u = U();
  const id = String(ref || '').trim();
  if (id === '') throw u.fail(400, 'edit is required (an id from images.get)');
  const rec = u.byId(app, 'edits', id);
  if (rec === null) throw u.fail(404, 'No edit ' + id + '; see images.get --image <id> for its edits');
  return rec;
}

/** The params a call gives: --params as JSON (or an object from the UI). */
function paramsOf(p) {
  const u = U();
  const v = u.json(p, 'params', '{"rect":{"x":0,"y":0,"w":800,"h":600}}');
  if (v === undefined) return {};
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw u.fail(400, 'params must be a JSON object, e.g. \'{"mode":"longest","longest":2048}\'');
  return v;
}

/**
 * Finish a change: save it (or render it, for a dry run), refresh what
 * renders, and answer with the image, the stack, the preview and the batch.
 */
function finish(app, e, img, before, after, opts) {
  const u = U();
  const o = opts || {};
  const who = u.actor(e);
  const dry = u.bool(o.p || {}, 'dry_run', false);
  const propId = o.proposal ? o.proposal.id : '';
  // Geometry check of every visible edit after the change (a crop can stop fitting when an edit above it changes).
  const vis = visible(after, propId);
  const ch = G().chain(vis, img.getInt('width'), img.getInt('height'));
  const warnings = [];
  vis.forEach((x, i) => {
    if (x.kind === 'crop' && x.params.rect) {
      const base = G().cropBase(x.params, ch[i][0], ch[i][1]);
      const r = x.params.rect;
      if (r.x + r.w > base[0] || r.y + r.h > base[1]) warnings.push(K().KINDS.crop.label + ' (' + x.id + ') reaches outside the image above it (' + base[0] + ' x ' + base[1] + '); it is clipped');
    }
  });
  if (dry) {
    const r = R().render(app, img, vis, { max: u.int(o.p || {}, 'max', 1600, 256, 4000) });
    return {
      ok: true,
      dry_run: true,
      applied: false,
      image: { id: img.id, name: img.getString('name'), width: img.getInt('width'), height: img.getInt('height') },
      out: ch[ch.length - 1],
      stack: describe(app, img, after),
      preview: { url: r.url, path: r.path, width: r.preview_width, height: r.preview_height },
      warnings: warnings,
      summary: o.summary || '',
    };
  }
  const batch = persist(app, who, img, before, after, { note: o.summary, actor: who });
  if (o.proposal) refreshProposal(app, img, u.byId(app, 'proposals', o.proposal.id));
  const fresh = I().refresh(app, u.byId(app, 'images', img.id));
  const list = load(app, img.id);
  const image = I().serialize(app, fresh);
  const out = {
    ok: true,
    applied: !o.proposal,
    proposed: !!o.proposal,
    batch: batch,
    image: image,
    stack: describe(app, fresh, list),
    preview: { url: image.preview_url, path: image.preview_path },
    warnings: warnings,
    summary: o.summary || '',
  };
  if (o.edit) {
    const found = out.stack.find((x) => x.id === o.edit);
    if (found) out.edit = found;
  }
  if (o.proposal) {
    const p = u.byId(app, 'proposals', o.proposal.id);
    out.proposal = serializeProposal(app, p);
    out.preview = { url: out.proposal.preview_url, path: out.proposal.preview_path };
    out.message = 'Proposed to the person (your policy keeps the AI agent\'s edits as proposals). It shows in their workspace with your preview; they accept or reject it.';
  }
  if (fresh.getString('status') !== 'ready' && fresh.getString('error') !== '') out.engine = fresh.getString('error');
  return out;
}

/** Who may change which edits, and whether an agent change becomes a proposal. */
function context(app, e, p, img, touches) {
  const u = U();
  const who = u.actor(e);
  if (who !== 'agent' || policy(app).agent_edits === 'apply') return { who: who, proposal: null };
  for (const ed of touches || []) {
    if (ed.state === 'active') throw u.fail(403, 'Your policy keeps the AI agent\'s edits as proposals, so you cannot change or remove the person\'s edits (' + ed.kind + ' ' + ed.id + '). Add a new edit (it becomes a proposal), or explain the change in your answer.', { code: 'agent_propose_only' });
  }
  const prop = openProposal(app, img, u.str(p, 'title', ''), u.str(p, 'reason', ''));
  return { who: who, proposal: prop };
}

/** A logo layer names a logo from assets.list. */
function checkLogo(app, kind, params) {
  if (kind !== 'layer' || !params || params.type !== 'logo') return params;
  if (U().byId(app, 'assets', String(params.asset)) === null) throw U().fail(404, 'No logo ' + params.asset + ' (assets.list gives the ids; assets.add adds one)');
  return params;
}

function insertAt(list, edit, at, propId) {
  const vis = visible(list, propId);
  const idx = at === null || at === undefined || at >= vis.length ? list.length : list.indexOf(vis[Math.max(0, at)]);
  const out = list.slice();
  out.splice(idx < 0 ? out.length : idx, 0, edit);
  return out;
}

function add(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const kind = u.oneOf(p, 'kind', Object.keys(K().KINDS), '');
  if (kind === '') throw u.fail(400, 'kind is required: one of ' + Object.keys(K().KINDS).join(', '));
  const before = load(app, img.id);
  const ctx = context(app, e, p, img, []);
  const propId = ctx.proposal ? ctx.proposal.id : '';
  const vis = visible(before, propId);
  const at = u.has(p, 'at') ? u.int(p, 'at', vis.length, 0, vis.length) : vis.length;
  const d = dimsAt(img, vis, at);
  const params = checkLogo(app, kind, K().params(kind, paramsOf(p), d[0], d[1]));
  if (kind === 'remove_bg' && img.getInt('frames') > 1) throw u.fail(422, 'Remove background works on still images; this one is an animation.');
  const edit = { id: u.newId(), kind: kind, params: params, enabled: true, author: ctx.who, state: ctx.proposal ? 'proposed' : 'active', proposal: propId, note: u.str(p, 'note', '') };
  const after = insertAt(before, edit, at, propId);
  return finish(app, e, img, before, after, { p: p, proposal: ctx.proposal, edit: edit.id, summary: (ctx.proposal ? 'Proposed: ' : 'Added ') + K().KINDS[kind].label.toLowerCase() + ': ' + K().summary(kind, params, null) });
}

function update(app, e, p) {
  const u = U();
  const rec = mustEdit(app, u.req(p, 'edit', '<edit id>'));
  const img = I().mustImage(app, rec.getString('image'));
  const before = load(app, img.id);
  const target = before.find((x) => x.id === rec.id);
  const ctx = context(app, e, p, img, [target]);
  if (ctx.proposal && target.proposal && target.proposal !== ctx.proposal.id) throw u.fail(409, 'That edit belongs to another proposal');
  const propId = target.state === 'proposed' ? target.proposal : ctx.proposal ? ctx.proposal.id : '';
  const vis = visible(before, propId);
  const idx = vis.indexOf(target);
  const d = dimsAt(img, vis, idx);
  const next = Object.assign({}, target);
  if (u.has(p, 'params')) {
    const given = paramsOf(p);
    const merged = u.bool(p, 'replace', false) ? given : Object.assign({}, target.params, given);
    for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
    next.params = checkLogo(app, target.kind, K().params(target.kind, merged, d[0], d[1]));
  }
  if (u.has(p, 'enabled')) next.enabled = u.bool(p, 'enabled', true);
  if (u.has(p, 'note')) next.note = u.str(p, 'note', '');
  const after = before.map((x) => (x.id === target.id ? next : x));
  return finish(app, e, img, before, after, { p: p, proposal: target.state === 'proposed' ? u.byId(app, 'proposals', target.proposal) : null, edit: target.id, summary: 'Changed ' + K().KINDS[target.kind].label.toLowerCase() + ': ' + K().summary(target.kind, next.params, null) });
}

function move(app, e, p) {
  const u = U();
  const rec = mustEdit(app, u.req(p, 'edit', '<edit id>'));
  const img = I().mustImage(app, rec.getString('image'));
  const before = load(app, img.id);
  const target = before.find((x) => x.id === rec.id);
  const ctx = context(app, e, p, img, [target]);
  const propId = target.state === 'proposed' ? target.proposal : ctx.proposal ? ctx.proposal.id : '';
  const vis = visible(before, propId);
  const to = u.int(p, 'to', 0, 0, vis.length - 1);
  const rest = before.filter((x) => x.id !== target.id);
  const visRest = visible(rest, propId);
  const anchor = visRest[to];
  const idx = anchor ? rest.indexOf(anchor) : rest.length;
  const after = rest.slice(0, idx).concat([target], rest.slice(idx));
  return finish(app, e, img, before, after, { p: p, proposal: target.state === 'proposed' ? u.byId(app, 'proposals', target.proposal) : null, edit: target.id, summary: 'Moved ' + K().KINDS[target.kind].label.toLowerCase() + ' to position ' + (to + 1) });
}

function remove(app, e, p) {
  const u = U();
  const ids = [];
  const one = u.str(p, 'edit', '');
  if (one !== '') ids.push(one);
  for (const x of u.list(p, 'edits') || []) ids.push(String(x));
  if (ids.length === 0) throw u.fail(400, 'edit (or edits) is required');
  const first = mustEdit(app, ids[0]);
  const img = I().mustImage(app, first.getString('image'));
  const before = load(app, img.id);
  const targets = ids.map((id) => {
    const t = before.find((x) => x.id === id);
    if (!t) throw u.fail(400, 'Edit ' + id + ' is not on the same image');
    return t;
  });
  context(app, e, p, img, targets);
  const after = before.filter((x) => ids.indexOf(x.id) < 0);
  const prop = targets[0].state === 'proposed' ? u.byId(app, 'proposals', targets[0].proposal) : null;
  const out = finish(app, e, img, before, after, { p: p, proposal: prop, summary: 'Removed ' + targets.map((t) => K().KINDS[t.kind].label.toLowerCase()).join(', ') });
  if (prop && !u.bool(p, 'dry_run', false) && load(app, img.id).filter((x) => x.proposal === prop.id).length === 0) {
    prop.set('status', 'superseded');
    prop.set('decided_at', u.now());
    app.save(prop);
  }
  return out;
}

/** Several edits at once (a recipe or a preset), appended or replacing the stack. */
function apply(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  let edits = u.list(p, 'edits', '[{"kind":"resize","params":{"mode":"longest","longest":2048}}]');
  let label = 'recipe';
  const presetId = u.str(p, 'preset', '');
  if (presetId !== '') {
    const pr = require(`${__hooks}/lib_presets.js`).mustPreset(app, presetId);
    if (pr.getString('kind') === 'size') {
      const d = U().getJson(pr, 'data') || {};
      edits = [{ kind: 'resize', params: { mode: 'cover', width: d.width, height: d.height, smart: true } }];
    } else if (pr.getString('kind') === 'recipe') {
      edits = (U().getJson(pr, 'data') || {}).edits || [];
    } else {
      throw u.fail(400, 'Preset "' + pr.getString('name') + '" holds export settings; give it to export.create instead');
    }
    label = pr.getString('name');
  }
  if (!edits || edits.length === 0) throw u.fail(400, 'edits (a JSON list of {kind, params}) or preset is required');
  const before = load(app, img.id);
  const replace = u.bool(p, 'replace', false);
  const ctx = context(app, e, p, img, replace ? before.filter((x) => x.state === 'active') : []);
  const propId = ctx.proposal ? ctx.proposal.id : '';
  let after = replace ? before.filter((x) => x.state !== 'active' && x.proposal !== propId) : before.slice();
  edits.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') throw u.fail(400, 'edits[' + i + '] must be {"kind":..,"params":{..}}');
    const kind = String(raw.kind || '');
    if (!K().KINDS[kind]) throw u.fail(400, 'edits[' + i + '].kind must be one of: ' + Object.keys(K().KINDS).join(', '));
    const vis = visible(after, propId);
    const d = dimsAt(img, vis, vis.length);
    let params;
    try {
      params = checkLogo(app, kind, K().params(kind, raw.params || {}, d[0], d[1]));
    } catch (err) {
      throw u.fail(err.status || 400, 'edits[' + i + '] (' + kind + '): ' + err.message);
    }
    after = after.concat([{ id: u.newId(), kind: kind, params: params, enabled: raw.enabled !== false, author: ctx.who, state: ctx.proposal ? 'proposed' : 'active', proposal: propId, note: String(raw.note || '') }]);
  });
  return finish(app, e, img, before, after, { p: p, proposal: ctx.proposal, summary: (ctx.proposal ? 'Proposed ' : 'Applied ') + label + ' (' + edits.length + ' edit' + (edits.length === 1 ? '' : 's') + ')' });
}

/** Back to the original: every active edit removed (one batch, undoable). */
function reset(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  const before = load(app, img.id);
  const active = before.filter((x) => x.state === 'active');
  if (active.length === 0) throw u.fail(400, 'This image has no edits; it is already the original');
  context(app, e, p, img, active);
  const after = before.filter((x) => x.state !== 'active');
  return finish(app, e, img, before, after, { p: p, summary: 'Back to the original (' + active.length + ' edit' + (active.length === 1 ? '' : 's') + ' removed)' });
}

/** Copy an image's edits onto other images, scaling coordinates to each one's size. */
function copy(app, e, p) {
  const u = U();
  const src = I().mustImage(app, u.req(p, 'from', '<image id>'));
  const targets = (u.list(p, 'to', '["<image id>"]') || []).map((id) => I().mustImage(app, String(id)));
  if (targets.length === 0) throw u.fail(400, 'to is required (a JSON list of image ids)');
  const kinds = u.list(p, 'kinds') || null;
  const srcAll = visible(load(app, src.id), '');
  const srcList = srcAll.filter((x) => !kinds || kinds.indexOf(x.kind) >= 0);
  if (srcList.length === 0) throw u.fail(400, 'The source image has no edits to copy');
  const srcChain = G().chain(srcAll, src.getInt('width'), src.getInt('height'));
  const replace = u.bool(p, 'replace', false);
  const results = [];
  for (const img of targets) {
    if (img.id === src.id) continue;
    const before = load(app, img.id);
    const ctx = context(app, e, p, img, replace ? before.filter((x) => x.state === 'active') : []);
    const propId = ctx.proposal ? ctx.proposal.id : '';
    let after = replace ? before.filter((x) => x.state !== 'active' && x.proposal !== propId) : before.slice();
    const skipped = [];
    for (const s of srcList) {
      const si = srcAll.indexOf(s);
      const vis = visible(after, propId);
      const d = dimsAt(img, vis, vis.length);
      // Layers pinned to the photo scale with the two originals; the rest with the size at their place in the stack.
      const photoLayer = s.kind === 'layer' && s.params.anchor !== 'frame';
      const kx = photoLayer ? img.getInt('width') / src.getInt('width') : d[0] / srcChain[si][0];
      const ky = photoLayer ? img.getInt('height') / src.getInt('height') : d[1] / srcChain[si][1];
      let params = K().scaleParams(s.kind, s.params, kx, ky);
      if (s.kind === 'crop' && params.rect) {
        const base = G().cropBase(params, d[0], d[1]);
        const r = params.rect;
        r.x = Math.max(0, Math.min(r.x, base[0] - 1));
        r.y = Math.max(0, Math.min(r.y, base[1] - 1));
        r.w = Math.max(1, Math.min(r.w, base[0] - r.x));
        r.h = Math.max(1, Math.min(r.h, base[1] - r.y));
      }
      if (s.kind === 'remove_bg' && img.getInt('frames') > 1) {
        skipped.push(s.kind);
        continue;
      }
      try {
        params = K().params(s.kind, params, d[0], d[1]);
      } catch (err) {
        skipped.push(s.kind + ' (' + err.message + ')');
        continue;
      }
      after = after.concat([{ id: u.newId(), kind: s.kind, params: params, enabled: s.enabled !== false, author: ctx.who, state: ctx.proposal ? 'proposed' : 'active', proposal: propId, note: s.note }]);
    }
    const res = finish(app, e, img, before, after, { p: p, proposal: ctx.proposal, summary: 'Copied ' + (after.length - (replace ? 0 : before.length)) + ' edits from ' + src.getString('name') });
    results.push({ image: res.image, batch: res.batch, proposed: res.proposed, skipped: skipped });
  }
  return { ok: true, results: results };
}

/* ---------------------------------------------------------------- history */

function rowJson(r) {
  const u = U();
  return {
    id: r.id,
    action: r.getString('action'),
    edit: r.getString('edit'),
    before: u.getJson(r, 'before'),
    after: u.getJson(r, 'after'),
    created: r.getString('created'),
  };
}

/** Follow a batch's reverts back to the edit it started from (hops: 0 edit, odd undo, even redo). */
function chainOf(app, first) {
  let base = first;
  let hops = 0;
  while (base.getString('reverts') !== '' && hops < 200) {
    const prev = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 1, 0, { b: base.getString('reverts') });
    if (prev.length === 0) break;
    base = prev[0];
    hops++;
  }
  return { base: base, hops: hops };
}

function kindOf(app, first) {
  const h = chainOf(app, first).hops;
  return h === 0 ? 'edit' : h % 2 === 1 ? 'undo' : 'redo';
}

/** Batches newest first (of one image or all). */
function history(app, p) {
  const u = U();
  const where = [];
  const bind = {};
  const imageId = u.str(p, 'image', '');
  if (imageId !== '') {
    where.push('[[image]] = {:i}');
    bind.i = imageId;
  }
  const actor = u.oneOf(p, 'actor', ['you', 'agent', 'system'], '');
  if (actor !== '') {
    where.push('[[actor]] = {:a}');
    bind.a = actor;
  }
  const limit = u.int(p, 'limit', 30, 1, 200);
  const page = u.int(p, 'page', 1, 1, 100000);
  const rows = u.rows(app, 'SELECT [[batch]] AS batch, MAX([[ord]]) AS last FROM {{changes}} ' + (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') + 'GROUP BY [[batch]] ORDER BY last DESC LIMIT ' + (limit + 1) + ' OFFSET ' + (page - 1) * limit, { batch: '', last: 0 }, bind);
  const names = {};
  const batches = [];
  for (const b of rows.slice(0, limit)) {
    const rs = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 0, 0, { b: b.batch });
    if (rs.length === 0) continue;
    const f = rs[0];
    const iid = f.getString('image');
    if (names[iid] === undefined) {
      const im = u.byId(app, 'images', iid);
      names[iid] = im === null ? '' : im.getString('name');
    }
    batches.push({
      batch: b.batch,
      image: { id: iid, name: names[iid] },
      actor: f.getString('actor'),
      note: f.getString('note'),
      kind: kindOf(app, f),
      reverted_by: f.getString('reverted_by'),
      reverts: f.getString('reverts'),
      count: rs.length,
      created: rs[rs.length - 1].getString('created'),
      changes: rs.map(rowJson),
    });
  }
  return { batches: batches, more: rows.length > limit };
}

/** Apply the inverse of a batch's rows to a list of edits. */
function inverse(list, rows) {
  let out = list.slice();
  const ordered = rows.slice().sort((a, b) => b.getInt('ord') - a.getInt('ord'));
  const u = U();
  const place = (e, seq) => {
    out = out.filter((x) => x.id !== e.id);
    out.splice(Math.max(0, Math.min(out.length, seq - 1)), 0, e);
  };
  for (const r of ordered) {
    const action = r.getString('action');
    const b = u.getJson(r, 'before');
    const id = r.getString('edit');
    if (action === 'add' || action === 'accept') {
      // Undoing an accepted proposal removes its edits (it does not become a proposal again).
      out = out.filter((x) => x.id !== id);
    } else if (action === 'remove') {
      if (!out.find((x) => x.id === id) && b) place(Object.assign({}, b, { state: 'active', proposal: '' }), b.seq);
    } else if (action === 'update' || action === 'toggle') {
      out = out.map((x) => (x.id === id && b ? Object.assign({}, x, { params: b.params, enabled: b.enabled, note: b.note }) : x));
    } else if (action === 'move') {
      const cur = out.find((x) => x.id === id);
      if (cur && b) place(cur, b.seq);
    }
  }
  return out;
}

function revertNote(app, rows) {
  const c = chainOf(app, rows[0]);
  const base = c.base.getString('note');
  return (c.hops % 2 === 0 ? 'Undo: ' : 'Redo: ') + (base || rows.length + ' change' + (rows.length === 1 ? '' : 's'));
}

/** Revert one batch as a new batch. */
function revertBatch(app, e, batchId, p) {
  const u = U();
  const rows = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 0, 0, { b: batchId });
  if (rows.length === 0) throw u.fail(404, 'No changes in batch ' + batchId + '; see history.list');
  if (rows[0].getString('reverted_by') !== '') throw u.fail(409, 'Batch ' + batchId + ' was already reverted by ' + rows[0].getString('reverted_by') + '. Revert that batch to redo it.');
  const img = I().mustImage(app, rows[0].getString('image'));
  const before = load(app, img.id);
  const after = inverse(before, rows);
  const who = u.actor(e);
  if (who === 'agent' && policy(app).agent_edits !== 'apply' && rows[0].getString('actor') !== 'agent') {
    throw u.fail(403, 'Your policy keeps the AI agent\'s changes as proposals; reverting the person\'s changes is theirs to do.', { code: 'agent_propose_only' });
  }
  const note = revertNote(app, rows);
  if (u.bool(p || {}, 'dry_run', false)) return finish(app, e, img, before, after, { p: p, summary: note });
  const batch = persist(app, who, img, before, after, {
    note: note,
    reverts: batchId,
    afterJournal: (tx, b) => {
      for (const r of tx.findRecordsByFilter('changes', 'batch = {:b}', '', 0, 0, { b: batchId })) {
        r.set('reverted_by', b);
        tx.save(r);
      }
    },
  });
  if (batch === '') {
    // Nothing visible changed (the edits were already gone): still mark it reverted.
    for (const r of rows) {
      r.set('reverted_by', 'none');
      app.save(r);
    }
  }
  const fresh = I().refresh(app, u.byId(app, 'images', img.id));
  return { ok: true, batch: batch, reverted: batchId, note: note, image: I().serialize(app, fresh), stack: describe(app, fresh, load(app, img.id)) };
}

function batchesOf(app, imageId) {
  const u = U();
  return u.rows(app, 'SELECT [[batch]] AS batch, MAX([[ord]]) AS last FROM {{changes}} WHERE [[image]] = {:i} GROUP BY [[batch]] ORDER BY last DESC LIMIT 400', { batch: '', last: 0 }, { i: imageId });
}

/** Undo: revert the newest edit (or redo) not reverted yet. */
function undo(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  for (const b of batchesOf(app, img.id)) {
    const first = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 1, 0, { b: b.batch })[0];
    if (!first || first.getString('reverted_by') !== '') continue;
    if (kindOf(app, first) === 'undo') continue;
    return revertBatch(app, e, b.batch, p);
  }
  throw u.fail(409, 'Nothing to undo on this image');
}

/** Redo: revert the newest undo, unless a new edit came after it. */
function redo(app, e, p) {
  const u = U();
  const img = I().mustImage(app, u.req(p, 'image', '<image id>'));
  for (const b of batchesOf(app, img.id)) {
    const first = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 1, 0, { b: b.batch })[0];
    if (!first) continue;
    const kind = kindOf(app, first);
    if (kind === 'edit') break;
    if (kind === 'redo') continue;
    if (first.getString('reverted_by') !== '') continue;
    return revertBatch(app, e, b.batch, p);
  }
  throw u.fail(409, 'Nothing to redo on this image');
}

/** What undo and redo would do now (for the toolbar). */
function undoState(app, imageId) {
  let canUndo = false;
  let canRedo = false;
  let redoBlocked = false;
  for (const b of batchesOf(app, imageId)) {
    const first = app.findRecordsByFilter('changes', 'batch = {:b}', 'ord', 1, 0, { b: b.batch })[0];
    if (!first) continue;
    const kind = kindOf(app, first);
    const open = first.getString('reverted_by') === '';
    if (!canUndo && open && kind !== 'undo') canUndo = true;
    if (!redoBlocked && !canRedo) {
      if (kind === 'edit') redoBlocked = true;
      else if (kind === 'undo' && open) canRedo = true;
    }
    if (canUndo && (canRedo || redoBlocked)) break;
  }
  return { can_undo: canUndo, can_redo: canRedo };
}

/* ------------------------------------------------------- deciding proposals */

function decide(app, e, p, accept) {
  const u = U();
  if (u.actor(e) === 'agent') throw u.fail(403, 'Proposals are the person\'s to accept or reject.', { code: 'person_only' });
  const prop = u.byId(app, 'proposals', u.req(p, 'proposal', '<proposal id>'));
  if (prop === null) throw u.fail(404, 'No proposal with that id');
  if (prop.getString('status') !== 'pending') throw u.fail(409, 'This proposal is already ' + prop.getString('status'));
  if (prop.getString('kind') === 'batch') {
    prop.set('response', u.str(p, 'reason', '').slice(0, 2000));
    return require(`${__hooks}/lib_batch.js`).decide(app, e, prop, accept);
  }
  const img = I().mustImage(app, prop.getString('image'));
  const before = load(app, img.id);
  const mine = before.filter((x) => x.proposal === prop.id);
  let batch = '';
  if (accept) {
    const after = before.map((x) => (x.proposal === prop.id ? Object.assign({}, x, { state: 'active', proposal: '' }) : x));
    batch = persist(app, 'you', img, before, after, { note: 'Accepted your AI agent\'s proposal: ' + prop.getString('title'), accept: true });
  } else {
    persist(app, 'you', img, before, before.filter((x) => x.proposal !== prop.id), { noJournal: true });
  }
  prop.set('status', accept ? 'accepted' : 'rejected');
  prop.set('decided_at', u.now());
  prop.set('response', u.str(p, 'reason', '').slice(0, 2000));
  prop.set('batch', batch);
  app.save(prop);
  const fresh = I().refresh(app, u.byId(app, 'images', img.id));
  return { ok: true, proposal: serializeProposal(app, prop), edits: mine.length, batch: batch, image: I().serialize(app, fresh) };
}

module.exports = {
  load: load,
  visible: visible,
  describe: describe,
  serializeEdit: serializeEdit,
  serializeProposal: serializeProposal,
  refreshProposal: refreshProposal,
  policy: policy,
  persist: persist,
  add: add,
  update: update,
  move: move,
  remove: remove,
  apply: apply,
  reset: reset,
  copy: copy,
  history: history,
  revertBatch: revertBatch,
  undo: undo,
  redo: redo,
  undoState: undoState,
  decide: decide,
};
