/// <reference path="../pb_data/types.d.ts" />
/**
 * Notes: literature notes (one per paper), project notes and free notes,
 * written as typed blocks. Embeds point at records (a passage, a claim, a
 * paper), never copy them, so a quote in a note always matches its page.
 *
 *   Block types: paragraph, heading (level 1-3), bullet, numbered, todo
 *   (checked), quote (anchor), node (node), cite (work, locator), divider,
 *   image (file: a note_files picture of the same note, caption, width as a
 *   percent of the column, align left/center/right), table (rows: a list of
 *   rows of cell texts, header: the first row is the header, align: each
 *   column's left/center/right).
 *
 * Pictures are uploaded first (notes.add-image: pasted, dropped or chosen;
 * your AI agent gives --paths) and the block then names them. A picture no
 * block uses any more goes when the note is next saved, ten minutes after it
 * was added (so one being placed is never lost).
 *
 * A note your AI agent writes is agent_proposed until a person keeps or
 * edits it.
 */

const BLOCKS = ['paragraph', 'heading', 'bullet', 'numbered', 'todo', 'quote', 'node', 'cite', 'divider', 'image', 'table'];
const PICTURES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' };
const ALIGN = ['left', 'center', 'right'];
const TABLE_ROWS = 500;
const TABLE_COLS = 30;
const extOf = (name) => (String(name).indexOf('.') < 0 ? '' : String(name).split('.').pop().toLowerCase());

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

/** Check a block list and return it clean, with the plain text for search (`noteId`: the note its pictures belong to). */
function cleanBlocks(app, raw, ctx, noteId) {
  const util = u();
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      throw util.fail(400, 'blocks must be a JSON list of blocks', 'invalid_param', { param: 'blocks' });
    }
  }
  if (!Array.isArray(list)) throw util.fail(400, 'blocks must be a list', 'invalid_param');
  if (list.length > 5000) throw util.fail(400, 'At most 5000 blocks in a note.', 'too_many');
  const out = [];
  const textParts = [];
  list.forEach((b, i) => {
    util.keysOnly(b, ['id', 'type', 'text', 'level', 'checked', 'anchor', 'node', 'work', 'locator', 'file', 'caption', 'width', 'align', 'rows', 'header'], 'Block ' + (i + 1));
    const type = String(b.type || '');
    if (BLOCKS.indexOf(type) < 0) throw util.fail(400, 'Block ' + (i + 1) + ': type is one of ' + BLOCKS.join(', '), 'invalid_param');
    const blk = { id: typeof b.id === 'string' && /^[a-z0-9]{4,20}$/.test(b.id) ? b.id : util.token(10).toLowerCase(), type: type };
    if (['paragraph', 'heading', 'bullet', 'numbered', 'todo'].indexOf(type) >= 0) {
      blk.text = String(b.text || '').slice(0, 40000);
      textParts.push(blk.text);
    }
    if (type === 'heading') blk.level = Math.min(3, Math.max(1, Number(b.level) || 1));
    if (type === 'todo') blk.checked = b.checked === true;
    if (type === 'quote') {
      const a = core().need(app, 'anchors', String(b.anchor || ''), 'passage');
      if (ctx) core().guardWork(ctx, core().need(app, 'works', a.getString('work'), 'paper'));
      blk.anchor = a.id;
      if (typeof b.text === 'string' && b.text !== '') blk.text = b.text.slice(0, 4000);
      textParts.push(a.getString('quote'));
    }
    if (type === 'node') {
      const n = core().need(app, 'nodes', String(b.node || ''), 'node');
      blk.node = n.id;
      textParts.push(n.getString('title'));
    }
    if (type === 'cite') {
      const w = core().need(app, 'works', String(b.work || ''), 'paper');
      if (!core().citable(w)) throw util.fail(409, 'Block ' + (i + 1) + ': "' + w.getString('title').slice(0, 80) + '" cannot be cited until its identifier resolves.', 'source_unresolved', { work: w.id });
      blk.work = w.id;
      blk.locator = String(b.locator || '').slice(0, 60);
      if (typeof b.text === 'string') blk.text = b.text.slice(0, 4000);
      textParts.push(w.getString('title'));
    }
    if (type === 'image') {
      const f = util.byId(app, 'note_files', String(b.file || ''));
      if (f === null || noteId === undefined || f.getString('note') !== noteId) throw util.fail(400, 'Block ' + (i + 1) + ': file is a picture of this note (add it with notes.add-image first).', 'invalid_param', { param: 'blocks' });
      blk.file = f.id;
      blk.caption = util.squash(String(b.caption || '')).slice(0, 1000);
      blk.width = Math.min(100, Math.max(10, Math.round(Number(b.width) || 100)));
      blk.align = util.choice(b.align, ALIGN, 'center', 'Block ' + (i + 1) + ' align', 'blocks');
      if (blk.caption !== '') textParts.push(blk.caption);
    }
    if (type === 'table') {
      const where = 'Block ' + (i + 1) + ': ';
      if (!Array.isArray(b.rows) || b.rows.length === 0) throw util.fail(400, where + 'rows is a list of rows, each a list of cell texts, e.g. [["Sample","Yield"],["A","72"]].', 'invalid_param', { param: 'blocks' });
      if (b.rows.length > TABLE_ROWS) throw util.fail(400, where + 'a table holds at most ' + TABLE_ROWS + ' rows.', 'too_many');
      let cols = 1;
      for (const r of b.rows) {
        if (!Array.isArray(r)) throw util.fail(400, where + 'each row is a list of cell texts.', 'invalid_param', { param: 'blocks' });
        cols = Math.max(cols, r.length);
      }
      if (cols > TABLE_COLS) throw util.fail(400, where + 'a table holds at most ' + TABLE_COLS + ' columns.', 'too_many');
      // Every row gets every column, so the table stays a rectangle.
      blk.rows = b.rows.map((r) => Array.from({ length: cols }, (_, j) => (r[j] === undefined || r[j] === null ? '' : String(r[j]).replace(/\r\n?/g, '\n').slice(0, 4000))));
      blk.header = b.header !== false;
      if (b.align !== undefined && b.align !== null && !Array.isArray(b.align)) throw util.fail(400, where + 'align is a list with one of left, center or right per column.', 'invalid_param', { param: 'blocks' });
      blk.align = Array.from({ length: cols }, (_, j) => util.choice(Array.isArray(b.align) ? b.align[j] : undefined, ALIGN, 'left', where + 'align of column ' + (j + 1), 'blocks'));
      textParts.push(blk.rows.map((r) => r.join(' | ')).join('\n'));
    }
    out.push(blk);
  });
  return { blocks: out, text: textParts.join('\n').slice(0, 400000) };
}

/** A note with its embeds resolved (quotes, node titles, paper labels). */
function noteOut(app, n, full) {
  const util = u();
  const c = core();
  const w = n.getString('work') !== '' ? util.byId(app, 'works', n.getString('work')) : null;
  const pr = n.getString('project') !== '' ? util.byId(app, 'projects', n.getString('project')) : null;
  const o = {
    id: n.id,
    title: n.getString('title'),
    kind: n.getString('kind'),
    work: n.getString('work'),
    work_label: w !== null ? c.workLabel(w) : '',
    work_title: w !== null ? w.getString('title') : '',
    project: n.getString('project'),
    project_name: pr !== null ? pr.getString('name') : '',
    pinned: n.getBool('pinned'),
    actor: n.getString('actor'),
    status: n.getString('status'),
    snippet: n.getString('text').slice(0, 240),
    created: n.getString('created'),
    updated: n.getString('updated'),
  };
  if (full) {
    const t = require(`${__hooks}/lib_text.js`);
    const G = require(`${__hooks}/lib_graph.js`);
    const W = require(`${__hooks}/lib_works.js`);
    o.blocks = (util.jsonOf(n, 'blocks') || []).map((b) => {
      const x = Object.assign({}, b);
      if (b.type === 'quote') {
        const a = util.byId(app, 'anchors', b.anchor);
        x.ref = a !== null ? t.anchorOut(app, a) : null;
      }
      if (b.type === 'node') {
        const nd = util.byId(app, 'nodes', b.node);
        x.ref = nd !== null ? G.nodeOut(app, nd, false) : null;
      }
      if (b.type === 'cite') {
        const wk = util.byId(app, 'works', b.work);
        x.ref = wk !== null ? W.rowOut(wk) : null;
      }
      if (b.type === 'image') {
        const f = util.byId(app, 'note_files', b.file);
        x.ref = f !== null ? pictureOut(f) : null;
      }
      return x;
    });
  }
  return o;
}

function pictureOut(f) {
  return { id: f.id, name: f.getString('name'), bytes: f.getInt('bytes') };
}

/** Pictures of a note that no block uses, added more than ten minutes ago, go. */
function prune(app, noteId, blocks) {
  const util = u();
  const used = {};
  for (const b of blocks) if (b.type === 'image') used[b.file] = true;
  const before = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ');
  for (const f of app.findRecordsByFilter('note_files', 'note = {:n} && created < {:c}', '', 0, 0, { n: noteId, c: before })) {
    if (used[f.id]) continue;
    // Re-read by id: deleting a record that came from a filter query can fail in this engine.
    const r = util.byId(app, 'note_files', f.id);
    if (r !== null) app.delete(r);
  }
}

function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const kind = util.oneOf(p, 'kind', ['literature', 'project', 'free'], 'free');
  let workId = '';
  let projectId = '';
  if (util.str(p, 'work', '') !== '') {
    const w = core().work(app, util.str(p, 'work', ''));
    core().guardWork(ctx, w);
    workId = w.id;
  }
  if (util.str(p, 'project', '') !== '') {
    const pr = core().project(app, util.str(p, 'project', ''));
    core().guardProject(ctx, pr);
    projectId = pr.id;
  }
  if (kind === 'literature' && workId === '') throw util.fail(400, 'A literature note belongs to a paper: give --work.', 'missing_param');
  if (kind === 'project' && projectId === '') throw util.fail(400, 'A project note belongs to a project: give --project.', 'missing_param');
  const cb = cleanBlocks(app, util.has(p, 'blocks') ? p.blocks : [], ctx);
  const n = util.newRecord(app, 'notes');
  n.set('title', util.text(p, 'title', 400, ''));
  n.set('kind', kind);
  n.set('work', workId);
  n.set('project', projectId);
  n.set('blocks', cb.blocks);
  n.set('text', cb.text);
  n.set('actor', ctx.actor);
  n.set('status', core().judgedStatus(ctx));
  app.save(n);
  require(`${__hooks}/lib_search.js`).indexNote(app, n);
  require(`${__hooks}/lib_activity.js`).write(app, ctx, { label: (ctx.isAgent ? 'Wrote a note' : 'Started a note') + (n.getString('title') !== '' ? ': ' + n.getString('title').slice(0, 80) : ''), target: 'notes', record: n.id, project: projectId });
  return { note: noteOut(app, n, true) };
}

/** notes.for-work: a paper's literature note (made when it has none). */
function forWork(ctx, p) {
  const util = u();
  const app = ctx.app;
  const w = core().work(app, util.req(p, 'work'));
  core().guardWork(ctx, w);
  const hit = app.findRecordsByFilter('notes', "work = {:w} && kind = 'literature'", 'created', 1, 0, { w: w.id });
  if (hit.length > 0) return { note: noteOut(app, hit[0], true) };
  return create(ctx, { kind: 'literature', work: w.id, title: w.getString('title').slice(0, 400) });
}

function mayEdit(ctx, n) {
  if (ctx.isAgent && !(n.getString('actor') === 'agent' && n.getString('status') === 'agent_proposed')) {
    throw u().fail(403, "Your AI agent edits only its own notes a person has not kept yet; add a new note instead, or append with notes.append.", 'agent_not_permitted');
  }
}

function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = core().need(app, 'notes', util.req(p, 'note'), 'note');
  core().guardProjectId(ctx, n.getString('project'));
  mayEdit(ctx, n);
  if (util.has(p, 'title')) n.set('title', util.text(p, 'title', 400, ''));
  if (util.has(p, 'blocks')) {
    const cb = cleanBlocks(app, p.blocks, ctx, n.id);
    n.set('blocks', cb.blocks);
    n.set('text', cb.text);
  }
  if (util.has(p, 'pinned')) n.set('pinned', util.bool(p, 'pinned', false));
  if (!ctx.isAgent) n.set('status', 'researcher_confirmed');
  app.save(n);
  require(`${__hooks}/lib_search.js`).indexNote(app, n);
  if (util.has(p, 'blocks')) prune(app, n.id, util.jsonOf(n, 'blocks') || []);
  return { note: noteOut(app, n, true) };
}

/** notes.append: add blocks at the end (drag a highlight into a note; your AI agent adds to any note this way). */
function append(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = core().need(app, 'notes', util.req(p, 'note'), 'note');
  core().guardProjectId(ctx, n.getString('project'));
  const add = cleanBlocks(app, util.has(p, 'blocks') ? p.blocks : [], ctx, n.id);
  if (add.blocks.length === 0) throw util.fail(400, 'Give --blocks to append.', 'missing_param');
  const at = util.int(p, 'at', -1, -1, 100000);
  const cur = util.jsonOf(n, 'blocks') || [];
  const next = at < 0 || at >= cur.length ? cur.concat(add.blocks) : cur.slice(0, at).concat(add.blocks, cur.slice(at));
  const cb = cleanBlocks(app, next, ctx, n.id);
  n.set('blocks', cb.blocks);
  n.set('text', cb.text);
  app.save(n);
  require(`${__hooks}/lib_search.js`).indexNote(app, n);
  return { note: noteOut(app, n, true) };
}

function noteFor(ctx, id) {
  const n = core().need(ctx.app, 'notes', id, 'note');
  core().guardProjectId(ctx, n.getString('project'));
  if (n.getString('work') !== '') core().guardWork(ctx, core().need(ctx.app, 'works', n.getString('work'), 'paper'));
  return n;
}

/**
 * notes.add-image: pictures for a note (pasted, dropped or chosen; your AI
 * agent gives --paths). The editor then puts an image block where the
 * cursor is; --append puts the blocks at the end (or at --at) right away.
 */
function addImage(ctx, p) {
  const util = u();
  const app = ctx.app;
  const n = noteFor(ctx, util.req(p, 'note'));
  const files = ctx.e ? util.uploadedAll(ctx.e, 'files') : [];
  for (const path of util.has(p, 'paths') ? util.list(p, 'paths') || [] : []) files.push(util.localFile(ctx, String(path), 'paths').file);
  if (files.length === 0) throw util.fail(400, 'Choose a picture' + (ctx.isAgent ? ' (--paths, a JSON list of absolute paths).' : '.'), 'missing_param', { param: 'files' });
  if (files.length > 20) throw util.fail(400, 'At most 20 pictures at a time.', 'too_many');
  for (const f of files) if (PICTURES[extOf(f.originalName)] === undefined) throw util.fail(400, '"' + f.originalName + '" is not a picture (PNG, JPEG, GIF, WebP, AVIF or BMP).', 'not_image');
  const made = [];
  app.runInTransaction((tx) => {
    for (const f of files) {
      const r = util.newRecord(tx, 'note_files');
      r.set('note', n.id);
      r.set('file', f);
      r.set('name', String(f.originalName).slice(0, 255));
      r.set('bytes', Number(f.size || 0));
      r.set('actor', ctx.actor);
      tx.save(r);
      made.push(pictureOut(r));
    }
  });
  if (!util.bool(p, 'append', false)) return { images: made };
  const caption = util.text(p, 'caption', 1000, '');
  const at = util.has(p, 'at') ? { at: util.int(p, 'at', -1, -1, 100000) } : {};
  const res = append(ctx, Object.assign({ note: n.id, blocks: made.map((m) => ({ type: 'image', file: m.id, caption: caption })) }, at));
  return { images: made, note: res.note };
}

/** notes.image: a note's picture (your AI agent gets where it is on this machine). */
function image(ctx, p) {
  const util = u();
  const f = core().need(ctx.app, 'note_files', util.req(p, 'file'), 'picture');
  noteFor(ctx, f.getString('note'));
  if (ctx.isAgent) return { image: pictureOut(f), disk_path: util.filePath(ctx.app, f, 'file') };
  const ext = extOf(f.getString('name'));
  return require(`${__hooks}/lib_files.js`).streamName(ctx, f, f.getString('file'), PICTURES[ext] || 'application/octet-stream', f.getString('name') || 'picture.' + ext, 'private, max-age=31536000, immutable', !util.bool(p, 'download', false));
}

/** notes.keep: a person keeps notes your AI agent wrote. */
function keep(ctx, p) {
  const util = u();
  const ids = util.ids(p, 'notes', 500);
  for (const id of ids) {
    const n = core().need(ctx.app, 'notes', id, 'note');
    n.set('status', 'researcher_confirmed');
    ctx.app.save(n);
  }
  return { kept: ids.length };
}

function remove(ctx, p) {
  const util = u();
  const n = core().need(ctx.app, 'notes', util.req(p, 'note'), 'note');
  core().guardProjectId(ctx, n.getString('project'));
  mayEdit(ctx, n);
  require(`${__hooks}/lib_search.js`).dropNote(ctx.app, n.id);
  ctx.app.delete(n);
  require(`${__hooks}/lib_activity.js`).write(ctx.app, ctx, { label: 'Deleted a note' + (n.getString('title') !== '' ? ': ' + n.getString('title').slice(0, 80) : ''), target: 'notes', record: n.id, project: n.getString('project') });
  return { deleted: true };
}

function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const kind = util.oneOf(p, 'kind', ['literature', 'project', 'free'], '');
  if (kind !== '') {
    where.push('kind = {:k}');
    bind.k = kind;
  }
  if (util.str(p, 'work', '') !== '') {
    where.push('work = {:w}');
    bind.w = core().work(app, util.str(p, 'work', '')).id;
  }
  if (util.str(p, 'project', '') !== '') {
    const pr = core().project(app, util.str(p, 'project', ''));
    core().guardProject(ctx, pr);
    where.push('project = {:p}');
    bind.p = pr.id;
  } else if (ctx.isAgent) where.push("(project = '' || project.confidentiality = 'normal')");
  if (util.bool(p, 'pinned', false)) where.push('pinned = true');
  const q = util.str(p, 'q', '');
  if (q !== '') {
    const ids = require(`${__hooks}/lib_search.js`).noteIds(app, q, 500);
    if (ids.length === 0) return { notes: [] };
    where.push('(' + ids.map((id, i) => 'id = {:n' + i + '}').join(' || ') + ')');
    ids.forEach((id, i) => (bind['n' + i] = id));
  }
  const pg = util.page(p, 100, 500);
  const recs = app.findRecordsByFilter('notes', where.join(' && '), '-pinned,-updated', pg.limit, pg.offset, bind);
  return { notes: recs.filter((n) => !(ctx.isAgent && n.getString('work') !== '' && core().workHidden(app, n.getString('work')))).map((n) => noteOut(app, n, false)) };
}

function get(ctx, p) {
  const util = u();
  const n = core().need(ctx.app, 'notes', util.req(p, 'note'), 'note');
  core().guardProjectId(ctx, n.getString('project'));
  if (n.getString('work') !== '') core().guardWork(ctx, core().need(ctx.app, 'works', n.getString('work'), 'paper'));
  return { note: noteOut(ctx.app, n, true) };
}

module.exports = { BLOCKS: BLOCKS, cleanBlocks: cleanBlocks, noteOut: noteOut, create: create, forWork: forWork, update: update, append: append, addImage: addImage, image: image, keep: keep, remove: remove, list: list, get: get };
