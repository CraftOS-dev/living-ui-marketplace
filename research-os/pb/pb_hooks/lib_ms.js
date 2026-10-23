/// <reference path="../pb_data/types.d.ts" />
/**
 * The writing desk: manuscripts written as blocks and typeset with LaTeX.
 * A block is a heading, paragraph, list item, quote, equation, abstract
 * paragraph, figure, table or LaTeX code. Text blocks (and the captions of
 * figures and tables) hold a list of segments:
 *
 *   { t: 'text', v: '...', b?: true, i?: true }
 *   { t: 'cite', works: [id, ...], locator?: 'p. 4' }
 *   { t: 'claim', node: id }
 *   { t: 'math', v: 'E = mc^2' }               inline math, in LaTeX
 *   { t: 'ref', block: id, bare?: true }       "Figure 2" ("2" when bare)
 *
 * Figures, tables and LaTeX blocks keep the rest in `data`: figure {file (a
 * picture or PDF in the project repository), width (% of the text width)},
 * table {rows, header, align}, latex {code}.
 *
 * A citation can only point at a citable paper (its identifier resolved, or
 * a person entered it), so a manuscript cannot hold a made-up reference.
 * Your AI agent never edits a manuscript: its drafts arrive as tracked
 * changes (ms_changes) a person keeps or undoes. Each block counts the
 * characters typed, pasted and kept from your AI agent, which is what the
 * disclosure statement reports.
 *
 * The PDF: latexSource() writes main.tex from the blocks (the venue's
 * document class and front matter, or the person's own preamble) with
 * references.bib, the figures, and the venue's style files from a folder of
 * the repository. ms.build runs engine/latex.mjs on them in the background;
 * settle() takes in what it made: the PDF, and each error placed on the
 * block its line came from.
 */

const BLOCK_TYPES = ['h1', 'h2', 'h3', 'paragraph', 'quote', 'bullet', 'numbered', 'equation', 'abstract', 'figure', 'table', 'latex'];
const TEMPLATES = ['generic', 'elsevier', 'nature', 'science', 'acl', 'iclr', 'neurips', 'ieee'];
const DATA_TYPES = ['figure', 'table', 'latex'];
// What a cross-reference can point at.
const REFERABLE = ['h1', 'h2', 'h3', 'equation', 'figure', 'table'];
// What LaTeX (XeTeX) can place as a figure.
const FIGURE_EXT = ['png', 'jpg', 'jpeg', 'pdf'];
const ALIGN = ['left', 'center', 'right'];
const TABLE_ROWS = 500;
const TABLE_COLS = 30;
const KEEP_BUILDS = 5;
const LABEL = { section: 'sec', equation: 'eq', figure: 'fig', table: 'tab' };

/**
 * Venues: the document class and its options, how the front matter is
 * written (article, elsarticle or ieee), the references style and the word
 * a figure is called by. ACL, ICLR and NeurIPS publish their style files
 * rather than ship them in TeX distributions: the person adds them to a
 * repository folder (style_folder) and the folder's .cls, .sty and .bst
 * files are used.
 */
const VENUES = {
  generic: { label: 'Any venue', cls: 'article', opts: '11pt', front: 'article' },
  elsevier: { label: 'Elsevier', cls: 'elsarticle', opts: 'preprint,12pt', front: 'elsarticle', fig: 'Fig.' },
  nature: { label: 'Nature Portfolio', cls: 'article', opts: '11pt', front: 'article' },
  science: { label: 'Science', cls: 'article', opts: '11pt', front: 'article' },
  acl: { label: 'ACL', cls: 'article', opts: '11pt', front: 'article', style: true },
  iclr: { label: 'ICLR', cls: 'article', opts: '', front: 'article', style: true },
  neurips: { label: 'NeurIPS', cls: 'article', opts: '', front: 'article', style: true },
  ieee: { label: 'IEEE', cls: 'IEEEtran', opts: 'conference', front: 'ieee', cite: 'cite', fig: 'Fig.' },
};

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function cite() {
  return require(`${__hooks}/lib_cite.js`);
}
function repo() {
  return require(`${__hooks}/lib_repo.js`);
}

function msOf(ctx, id) {
  const m = core().need(ctx.app, 'manuscripts', id, 'manuscript');
  core().guardProjectId(ctx, m.getString('project'));
  return m;
}

const extOf = (name) => {
  const n = String(name || '');
  const dot = n.lastIndexOf('.');
  return dot < 0 ? '' : n.slice(dot + 1).toLowerCase();
};

/**
 * Check a segment list; returns { content, text, cited } or throws. With
 * msId, a cross-reference must name a heading, equation, figure or table of
 * that manuscript (a kept change or a restored snapshot is not checked
 * again: what it points at may have gone since, which the checks report).
 */
function cleanContent(app, raw, msId) {
  const util = u();
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      throw util.fail(400, 'content must be a JSON list of segments', 'invalid_param');
    }
  }
  if (!Array.isArray(list)) throw util.fail(400, 'content must be a list', 'invalid_param');
  const out = [];
  let textValue = '';
  const cited = [];
  list.slice(0, 5000).forEach((s, i) => {
    util.keysOnly(s, ['t', 'v', 'b', 'i', 'works', 'locator', 'node', 'block', 'bare'], 'Segment ' + (i + 1));
    if (s.t === 'text') {
      const v = String(s.v || '');
      if (v === '') return;
      const seg = { t: 'text', v: v.slice(0, 200000) };
      if (s.b === true) seg.b = true;
      if (s.i === true) seg.i = true;
      out.push(seg);
      textValue += v;
    } else if (s.t === 'cite') {
      const ids = Array.isArray(s.works) ? s.works.map(String) : [];
      if (ids.length === 0) throw util.fail(400, 'Segment ' + (i + 1) + ': a citation names one or more papers.', 'invalid_param');
      for (const id of ids) {
        const w = core().need(app, 'works', id, 'paper');
        if (!core().citable(w) || w.getBool('trashed')) throw util.fail(409, '"' + w.getString('title').slice(0, 80) + '" cannot be cited: ' + (w.getBool('trashed') ? 'it is in the trash.' : 'its identifier has not resolved.'), 'source_unresolved', { work: w.id });
        if (cited.indexOf(id) < 0) cited.push(id);
      }
      out.push({ t: 'cite', works: ids, locator: String(s.locator || '').slice(0, 60) });
      textValue += '[cite]';
    } else if (s.t === 'claim') {
      const n = core().need(app, 'nodes', String(s.node || ''), 'claim');
      out.push({ t: 'claim', node: n.id });
    } else if (s.t === 'math') {
      const v = String(s.v || '').trim();
      if (v === '') return;
      out.push({ t: 'math', v: v.slice(0, 4000) });
      textValue += '$' + v + '$';
    } else if (s.t === 'ref') {
      const id = String(s.block || '');
      if (msId !== undefined) {
        const target = id === '' ? null : util.byId(app, 'ms_blocks', id);
        if (target === null || target.getString('manuscript') !== msId) throw util.fail(400, 'Segment ' + (i + 1) + ': a cross-reference names a block of this manuscript.', 'invalid_param');
        if (REFERABLE.indexOf(target.getString('type')) < 0) throw util.fail(400, 'Segment ' + (i + 1) + ': a cross-reference points at a heading, an equation, a figure or a table.', 'invalid_param');
      }
      const seg = { t: 'ref', block: id };
      if (s.bare === true) seg.bare = true;
      out.push(seg);
      textValue += '[ref]';
    } else throw util.fail(400, 'Segment ' + (i + 1) + ': t is text, cite, claim, math or ref.', 'invalid_param');
  });
  return { content: out, text: textValue, cited: cited };
}

/** The `text` of stored segments (search and the word count read it). */
function textOf(content) {
  return (content || []).map((x) => (x.t === 'text' ? x.v : x.t === 'cite' ? '[cite]' : x.t === 'math' ? '$' + x.v + '$' : x.t === 'ref' ? '[ref]' : '')).join('');
}

/** What a figure, table or LaTeX block keeps beyond its text; null for the other kinds. */
function cleanData(app, type, raw, projectId) {
  const util = u();
  if (DATA_TYPES.indexOf(type) < 0) return null;
  let d = raw;
  if (typeof d === 'string') {
    if (d.trim() === '') d = {};
    else {
      try {
        d = JSON.parse(d);
      } catch {
        throw util.fail(400, 'data must be a JSON object', 'invalid_param', { param: 'data' });
      }
    }
  }
  if (d === undefined || d === null) d = {};
  if (typeof d !== 'object' || Array.isArray(d)) throw util.fail(400, 'data must be a JSON object', 'invalid_param', { param: 'data' });
  if (type === 'figure') {
    util.keysOnly(d, ['file', 'width'], 'data');
    const file = String(d.file || '');
    if (file !== '') {
      const it = util.byId(app, 'repo_items', file);
      if (it === null || it.getString('project') !== projectId || it.getString('kind') !== 'file') throw util.fail(400, "data.file names a file in this project's repository (the picture or PDF the figure shows).", 'invalid_param', { param: 'data' });
    }
    const w = Number(d.width);
    return { file: file, width: Number.isFinite(w) && d.width !== null && d.width !== '' ? Math.min(100, Math.max(10, Math.round(w))) : 80 };
  }
  if (type === 'table') {
    util.keysOnly(d, ['rows', 'header', 'align'], 'data');
    const rows = d.rows === undefined ? [['', ''], ['', '']] : d.rows;
    if (!Array.isArray(rows) || rows.length === 0) throw util.fail(400, 'data.rows is a list of rows, each a list of cell texts, e.g. [["Sample","Yield"],["A","72"]].', 'invalid_param', { param: 'data' });
    if (rows.length > TABLE_ROWS) throw util.fail(400, 'A table holds at most ' + TABLE_ROWS + ' rows.', 'too_many');
    let cols = 1;
    for (const r of rows) {
      if (!Array.isArray(r)) throw util.fail(400, 'Each row of data.rows is a list of cell texts.', 'invalid_param', { param: 'data' });
      cols = Math.max(cols, r.length);
    }
    if (cols > TABLE_COLS) throw util.fail(400, 'A table holds at most ' + TABLE_COLS + ' columns.', 'too_many');
    if (d.align !== undefined && d.align !== null && !Array.isArray(d.align)) throw util.fail(400, 'data.align is a list with one of left, center or right per column.', 'invalid_param', { param: 'data' });
    // Every row gets every column, so the table stays a rectangle.
    return {
      rows: rows.map((r) => Array.from({ length: cols }, (_, j) => (r[j] === undefined || r[j] === null ? '' : String(r[j]).replace(/\r\n?/g, '\n').slice(0, 4000)))),
      header: d.header !== false,
      align: Array.from({ length: cols }, (_, j) => util.choice(Array.isArray(d.align) ? d.align[j] : undefined, ALIGN, 'left', 'data.align of column ' + (j + 1), 'data')),
    };
  }
  util.keysOnly(d, ['code'], 'data');
  const code = String(d.code === undefined || d.code === null ? '' : d.code).replace(/\r\n?/g, '\n');
  if (code.length > 100000) throw util.fail(400, 'A LaTeX block holds at most 100,000 characters.', 'too_long');
  return { code: code };
}

function textLen(content) {
  return (content || []).filter((s) => s.t === 'text').reduce((a, s) => a + s.v.length, 0);
}

/** Characters of a block as written: its text, a table's cells, a LaTeX block's code. */
function charsOf(type, content, data) {
  let n = textLen(content);
  if (type === 'table' && data && Array.isArray(data.rows)) for (const r of data.rows) for (const c of r) n += String(c).length;
  if (type === 'latex' && data) n += String(data.code || '').length;
  return n;
}

function words(s) {
  return String(s || '')
    .replace(/\[cite\]/g, ' ')
    .split(/\s+/)
    .filter((x) => x !== '').length;
}

function blockOut(b) {
  return { id: b.id, sort: b.getFloat('sort'), type: b.getString('type'), content: u().jsonOf(b, 'content') || [], data: u().jsonOf(b, 'data'), origin: b.getString('origin'), typed: b.getInt('typed_chars'), pasted: b.getInt('pasted_chars'), agent: b.getInt('agent_chars'), updated: b.getString('updated') };
}

function changeOut(c) {
  return { id: c.id, block: c.getString('block'), after_block: c.getString('after_block'), kind: c.getString('kind'), before: u().jsonOf(c, 'before'), after: u().jsonOf(c, 'after'), status: c.getString('status'), actor: c.getString('actor'), why: c.getString('why'), created: c.getString('created') };
}

function msOut(app, m) {
  const util = u();
  const pr = util.byId(app, 'projects', m.getString('project'));
  return { id: m.id, project: m.getString('project'), project_name: pr !== null ? pr.getString('name') : '', title: m.getString('title'), style: m.getString('style'), template: m.getString('template'), status: m.getString('status'), words: m.getInt('words'), authors: util.jsonOf(m, 'authors') || [], preamble: m.getString('preamble'), style_folder: m.getString('style_folder'), ready_at: m.getString('ready_at'), updated: m.getString('updated'), created: m.getString('created') };
}

function list(ctx, p) {
  const util = u();
  const where = [];
  const bind = {};
  if (util.str(p, 'project', '') !== '') {
    const pr = core().project(ctx.app, util.str(p, 'project', ''));
    core().guardProject(ctx, pr);
    where.push('project = {:p}');
    bind.p = pr.id;
  } else if (ctx.isAgent) where.push("project.confidentiality = 'normal'");
  return { manuscripts: ctx.app.findRecordsByFilter('manuscripts', where.join(' && '), '-updated', 200, 0, bind).map((m) => msOut(ctx.app, m)) };
}

function create(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pr = core().project(app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const m = util.newRecord(app, 'manuscripts');
  m.set('project', pr.id);
  m.set('title', util.squash(util.text(p, 'title', 400, '')) || 'Untitled manuscript');
  m.set('style', util.oneOf(p, 'style', cite().STYLES, core().settings(app).getString('citation_style') || 'apa'));
  m.set('template', util.oneOf(p, 'template', TEMPLATES, 'generic'));
  m.set('status', 'draft');
  m.set('sort', util.count(app, 'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM manuscripts WHERE project = {:p}', { p: pr.id }));
  app.save(m);
  // A first section to write in.
  const outline = util.str(p, 'outline', 'empty');
  const heads = outline === 'imrad' ? ['Introduction', 'Methods', 'Results', 'Discussion'] : outline === 'review' ? ['Introduction', 'Background', 'Themes', 'Gaps and directions', 'Conclusion'] : [];
  let sort = 1;
  for (const h of heads) {
    const b = util.newRecord(app, 'ms_blocks');
    b.set('manuscript', m.id);
    b.set('sort', sort++);
    b.set('type', 'h1');
    b.set('content', [{ t: 'text', v: h }]);
    b.set('text', h);
    // The outline counts as written by whoever started the manuscript (the disclosure measures it).
    b.set('origin', ctx.isAgent ? 'agent_generated' : 'typed');
    b.set(ctx.isAgent ? 'agent_chars' : 'typed_chars', h.length);
    app.save(b);
    const para = util.newRecord(app, 'ms_blocks');
    para.set('manuscript', m.id);
    para.set('sort', sort++);
    para.set('type', 'paragraph');
    para.set('content', []);
    para.set('text', '');
    para.set('origin', 'typed');
    app.save(para);
  }
  if (heads.length === 0) {
    const para = util.newRecord(app, 'ms_blocks');
    para.set('manuscript', m.id);
    para.set('sort', 1);
    para.set('type', 'paragraph');
    para.set('content', []);
    para.set('text', '');
    para.set('origin', 'typed');
    app.save(para);
  }
  require(`${__hooks}/lib_activity.js`).write(app, ctx, { label: 'Started the manuscript ' + m.getString('title'), target: 'manuscripts', record: m.id, project: pr.id });
  return { manuscript: msOut(app, m) };
}

/** Authors as a list of { name, affiliation, email } (at most 50; a name is needed). */
function cleanAuthors(util, raw) {
  if (raw.length > 50) throw util.fail(400, 'At most 50 authors.', 'too_many');
  const out = [];
  raw.forEach((a, i) => {
    util.keysOnly(a, ['name', 'affiliation', 'email'], 'Author ' + (i + 1));
    const name = util.squash(String(a.name || '')).slice(0, 200);
    if (name === '') return;
    out.push({ name: name, affiliation: util.squash(String(a.affiliation || '')).slice(0, 400), email: util.squash(String(a.email || '')).slice(0, 200) });
  });
  return out;
}

/** What ms.update would set: [[field, value]], checked (a proposal is checked when it is made, and again when approved). */
function changesOf(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const sets = [];
  if (util.has(p, 'title')) sets.push(['title', util.squash(util.text(p, 'title', 400, '')) || m.getString('title')]);
  if (util.has(p, 'style')) sets.push(['style', util.oneOf(p, 'style', cite().STYLES, 'apa')]);
  if (util.has(p, 'template')) sets.push(['template', util.oneOf(p, 'template', TEMPLATES, 'generic')]);
  if (util.has(p, 'authors')) sets.push(['authors', cleanAuthors(util, util.list(p, 'authors') || [])]);
  // An empty preamble is the venue's own again.
  if (util.has(p, 'preamble')) sets.push(['preamble', util.text(p, 'preamble', 20000, '').replace(/\r\n?/g, '\n')]);
  if (util.has(p, 'style_folder')) {
    const id = util.str(p, 'style_folder', '');
    if (id !== '') {
      const f = util.byId(app, 'repo_items', id);
      if (f === null || f.getString('project') !== m.getString('project') || f.getString('kind') !== 'folder') throw util.fail(400, "style_folder names a folder in this project's repository (the one with the venue's .cls, .sty or .bst files).", 'invalid_param', { param: 'style_folder' });
    }
    sets.push(['style_folder', id]);
  }
  return { m: m, sets: sets };
}

function update(ctx, p) {
  const c = changesOf(ctx, p);
  for (const [k, v] of c.sets) c.m.set(k, v);
  ctx.app.save(c.m);
  return { manuscript: msOut(ctx.app, c.m) };
}

/** ms.update from your AI agent: the proposal a person approves, saying what would change. */
function updatePreview(ctx, p) {
  const util = u();
  const c = changesOf(ctx, p);
  if (c.sets.length === 0) throw util.fail(400, 'Say what to change: --title, --style, --template, --authors, --preamble or --style_folder.', 'missing_param');
  const venue = (v) => (VENUES[v] || VENUES.generic).label;
  const words = {
    title: (v) => 'title "' + v + '"',
    style: (v) => 'citation style ' + v,
    template: (v) => 'venue ' + venue(v),
    authors: (v) => (v.length === 0 ? 'no authors' : 'authors ' + v.map((a) => a.name).join(', ')),
    preamble: (v) => (v.trim() === '' ? "the venue's own preamble" : 'its own preamble (' + v.split('\n').length + ' lines)'),
    style_folder: (v) => (v === '' ? 'no style folder' : 'the style folder ' + repo().pathOf(ctx.app, ctx.app.findRecordById('repo_items', v))),
  };
  const preview = {};
  for (const [k, v] of c.sets) preview[k] = k === 'authors' ? v.map((a) => a.name + (a.affiliation !== '' ? ' (' + a.affiliation + ')' : '')).join('; ') : k === 'preamble' ? v.slice(0, 300) : k === 'template' ? venue(v) : k === 'style_folder' ? words.style_folder(v).replace('the style folder ', '') : v;
  return {
    kind: 'manuscript_settings',
    title: 'Change the settings of ' + c.m.getString('title'),
    summary: 'Sets ' + c.sets.map(([k, v]) => words[k](v)).join('; ') + '.',
    preview: preview,
    project: c.m.getString('project'),
    target: { collection: 'manuscripts', id: c.m.id },
  };
}

function remove(ctx, p) {
  const m = msOf(ctx, u().req(p, 'manuscript'));
  ctx.app.delete(m);
  require(`${__hooks}/lib_activity.js`).write(ctx.app, ctx, { label: 'Deleted the manuscript ' + m.getString('title'), target: 'manuscripts', record: m.id, project: m.getString('project') });
  return { deleted: true };
}

/** Recount a manuscript's words. */
function recount(app, msId) {
  let n = 0;
  for (const b of app.findRecordsByFilter('ms_blocks', 'manuscript = {:m}', '', 0, 0, { m: msId })) n += words(b.getString('text'));
  const m = app.findRecordById('manuscripts', msId);
  m.set('words', n);
  if (m.getString('status') === 'ready') {
    m.set('status', 'draft');
    m.set('ready_at', '');
  }
  app.save(m);
}

function sortAfter(app, msId, afterId) {
  const util = u();
  if (afterId === '' || afterId === 'start') {
    const first = util.one(app, 'SELECT COALESCE(MIN(sort), 1) AS s FROM ms_blocks WHERE manuscript = {:m}', { s: -0 }, { m: msId });
    return (first !== null ? first.s : 1) - 1;
  }
  const a = core().need(app, 'ms_blocks', afterId, 'block');
  const next = util.one(app, 'SELECT COALESCE(MIN(sort), {:x} + 2) AS s FROM ms_blocks WHERE manuscript = {:m} AND sort > {:x}', { s: -0 }, { m: msId, x: a.getFloat('sort') });
  return next !== null ? (a.getFloat('sort') + next.s) / 2 : a.getFloat('sort') + 1;
}

/** ms.save-block: write one block (new when no --block), counting typed and pasted characters (people). */
function saveBlock(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const cc = cleanContent(app, util.has(p, 'content') ? p.content : [], m.id);
  const type = util.oneOf(p, 'type', BLOCK_TYPES, 'paragraph');
  const typed = util.int(p, 'typed', 0, 0, 10000000);
  const pasted = util.int(p, 'pasted', 0, 0, 10000000);
  let b;
  const id = util.str(p, 'block', '');
  let data;
  if (id !== '') {
    b = core().need(app, 'ms_blocks', id, 'block');
    if (b.getString('manuscript') !== m.id) throw util.fail(400, 'That block belongs to another manuscript.', 'invalid_param');
    if (b.getString('origin') === 'agent_generated' || b.getString('origin') === 'agent_edited') b.set('origin', 'mixed');
    // Saving the text of a figure or table (its caption) keeps its picture or cells.
    data = util.has(p, 'data') ? cleanData(app, type, p.data, m.getString('project')) : b.getString('type') === type ? util.jsonOf(b, 'data') : cleanData(app, type, {}, m.getString('project'));
  } else {
    b = util.newRecord(app, 'ms_blocks');
    b.set('manuscript', m.id);
    b.set('sort', sortAfter(app, m.id, util.str(p, 'after', '')));
    b.set('origin', pasted > typed ? 'pasted' : 'typed');
    data = cleanData(app, type, util.has(p, 'data') ? p.data : {}, m.getString('project'));
  }
  b.set('type', type);
  b.set('content', cc.content);
  b.set('data', data);
  b.set('text', cc.text);
  b.set('typed_chars', b.getInt('typed_chars') + typed);
  b.set('pasted_chars', b.getInt('pasted_chars') + pasted);
  app.save(b);
  recount(app, m.id);
  return { block: blockOut(b) };
}

function deleteBlock(ctx, p) {
  const util = u();
  const b = core().need(ctx.app, 'ms_blocks', util.req(p, 'block'), 'block');
  msOf(ctx, b.getString('manuscript'));
  ctx.app.delete(b);
  recount(ctx.app, b.getString('manuscript'));
  return { deleted: true };
}

function moveBlock(ctx, p) {
  const util = u();
  const b = core().need(ctx.app, 'ms_blocks', util.req(p, 'block'), 'block');
  msOf(ctx, b.getString('manuscript'));
  b.set('sort', sortAfter(ctx.app, b.getString('manuscript'), util.str(p, 'after', 'start')));
  ctx.app.save(b);
  return { block: blockOut(b) };
}

/* ------------------------------------------------------------ rendering */

/** Cited papers in order of first citation, with each citation's in-text form. */
function citations(app, m, blocks) {
  const order = [];
  for (const b of blocks) for (const s of b.content) if (s.t === 'cite') for (const id of s.works) if (order.indexOf(id) < 0) order.push(id);
  const style = m.getString('style');
  const bib = cite().bibliography(app, order, style);
  const rendered = {};
  for (const b of blocks) {
    rendered[b.id] = b.content.map((s) => {
      if (s.t !== 'cite') return null;
      const items = s.works.map((id) => ({ d: bib.data.find((d) => d.id === id), n: bib.info[id] ? bib.info[id].n : 0, suffix: bib.info[id] ? bib.info[id].suffix : '', locator: s.locator })).filter((x) => x.d);
      return items.length > 0 ? cite().inText(items, style) : { text: '[missing source]', html: '[missing source]', md: '[missing source]' };
    });
  }
  return { order: order, bibliography: bib.entries, rendered: rendered };
}

function roman(n) {
  const R = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, l] of R) while (n >= v) {
    s += l;
    n -= v;
  }
  return s;
}

function equationOf(b) {
  return b.content.filter((s) => s.t === 'text').map((s) => s.v).join('').trim();
}

/**
 * The numbers LaTeX gives headings, equations, figures and tables, in the
 * venue's form (IEEE numbers sections I, II, subsections II-A and tables
 * I, II), with the words a cross-reference reads as and the caption's own
 * label (Elsevier refers to "Fig. 1" under a "Figure 1" caption; IEEE sets
 * "Fig. 1" and "TABLE I"): { id: { kind, n, label, caption } }.
 */
function numbering(blocks, template) {
  const venue = VENUES[template] || VENUES.generic;
  const ieee = venue.front === 'ieee';
  const out = {};
  const sec = [0, 0, 0];
  let eq = 0;
  let fig = 0;
  let tab = 0;
  for (const b of blocks) {
    let kind = '';
    let n = '';
    if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
      const level = Number(b.type.charAt(1)) - 1;
      sec[level]++;
      for (let k = level + 1; k < 3; k++) sec[k] = 0;
      kind = 'section';
      n = ieee ? [roman(sec[0]), level >= 1 ? '-' + String.fromCharCode(64 + Math.max(1, sec[1])) : '', level >= 2 ? String(sec[2]) : ''].join('') : sec.slice(0, level + 1).join('.');
    } else if (b.type === 'equation') {
      if (equationOf(b) === '') continue;
      kind = 'equation';
      n = String(++eq);
    } else if (b.type === 'figure') {
      kind = 'figure';
      n = String(++fig);
    } else if (b.type === 'table') {
      kind = 'table';
      n = ieee ? roman(++tab) : String(++tab);
    } else continue;
    const label = kind === 'section' ? 'Section ' + n : kind === 'equation' ? 'Eq. (' + n + ')' : kind === 'figure' ? (venue.fig || 'Figure') + ' ' + n : 'Table ' + n;
    const caption = kind === 'figure' ? (ieee ? 'Fig. ' : 'Figure ') + n : kind === 'table' ? (ieee ? 'TABLE ' : 'Table ') + n : label;
    out[b.id] = { kind: kind, n: n, label: label, caption: caption };
  }
  return out;
}

/** A cross-reference as text: its label, or the number alone when bare. */
function refText(numbers, s) {
  const t = numbers[s.block];
  if (t === undefined) return '??';
  return s.bare ? (t.kind === 'equation' ? '(' + t.n + ')' : t.n) : t.label;
}

/** The repository files the figures show (null where the file is gone). */
function figuresOf(app, m, blocks) {
  const util = u();
  const R = repo();
  const out = {};
  for (const b of blocks) {
    const id = b.type === 'figure' && b.data ? String(b.data.file || '') : '';
    if (id === '' || out[id] !== undefined) continue;
    const r = util.byId(app, 'repo_items', id);
    if (r === null || r.getString('project') !== m.getString('project') || r.getString('kind') !== 'file') {
      out[id] = null;
      continue;
    }
    const ext = extOf(r.getString('name'));
    out[id] = { id: r.id, name: r.getString('name'), path: R.pathOf(app, r), ext: ext, version: Math.max(1, r.getInt('version')), bytes: r.getInt('bytes'), supported: FIGURE_EXT.indexOf(ext) >= 0, empty: r.getString('file') === '', disk: R.diskPath(app, r.id, r.getString('file')) };
  }
  return out;
}

function figuresOut(figs) {
  const out = {};
  for (const k of Object.keys(figs)) {
    const f = figs[k];
    out[k] = f === null ? null : { id: f.id, name: f.name, path: f.path, ext: f.ext, version: f.version, bytes: f.bytes, supported: f.supported, empty: f.empty };
  }
  return out;
}

/**
 * The style folder: every file in it (kept at its place under the folder),
 * and at its top level the document class (.cls), the packages (.sty) and
 * the references style (.bst) the venue's files bring.
 */
function styleOf(app, m) {
  const util = u();
  const R = repo();
  const none = { folder: null, missing: false, files: [], cls: '', sty: [], bst: '' };
  const id = m.getString('style_folder');
  if (id === '') return none;
  const folder = util.byId(app, 'repo_items', id);
  if (folder === null || folder.getString('kind') !== 'folder' || folder.getString('project') !== m.getString('project')) return Object.assign(none, { missing: true });
  const t = R.tree(app, m.getString('project'));
  const base = t.by[folder.id] ? t.by[folder.id].path : folder.getString('name');
  const files = t.rows
    .filter((r) => r.kind === 'file' && r.path.indexOf(base + '/') === 0)
    .map((r) => ({ id: r.id, rel: r.path.slice(base.length + 1), name: r.name, version: Math.max(1, r.version), empty: r.file === '', disk: R.diskPath(app, r.id, r.file) }))
    // The build's own files keep their names.
    .filter((f) => f.rel !== 'main.tex' && f.rel !== 'references.bib' && f.rel.indexOf('figures/') !== 0)
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .slice(0, 300);
  const top = files.filter((f) => f.rel.indexOf('/') < 0);
  // A name LaTeX can load (\usepackage{acl}).
  const loadable = (f, ext) => extOf(f.name) === ext && /^[A-Za-z0-9_.-]+$/.test(f.name);
  const stem = (f) => f.name.slice(0, f.name.length - extOf(f.name).length - 1);
  const cls = top.find((f) => loadable(f, 'cls'));
  const bst = top.find((f) => loadable(f, 'bst'));
  return { folder: { id: folder.id, path: base }, missing: false, files: files, cls: cls ? stem(cls) : '', sty: top.filter((f) => loadable(f, 'sty')).map(stem), bst: bst ? stem(bst) : '' };
}

function styleOut(st) {
  return { folder: st.folder, missing: st.missing, cls: st.cls, sty: st.sty, bst: st.bst, files: st.files.map((f) => f.rel) };
}

/** Everything a view, an export or the LaTeX source is made from. */
function gather(app, m) {
  const blocks = app.findRecordsByFilter('ms_blocks', 'manuscript = {:m}', 'sort', 0, 0, { m: m.id }).map(blockOut);
  const c = citations(app, m, blocks);
  const sh = shares(blocks);
  return { blocks: blocks, c: c, sources: require(`${__hooks}/lib_works.js`).rowsFor(app, c.order), numbers: numbering(blocks, m.getString('template')), figures: figuresOf(app, m, blocks), style: styleOf(app, m), shares: sh, disclosure: disclosure(m, sh) };
}

/** What stands between a manuscript and "ready". */
function checks(app, m, blocks, order, x) {
  const util = u();
  const problems = [];
  for (const id of order) {
    const w = util.byId(app, 'works', id);
    if (w === null) {
      problems.push({ code: 'source_missing', work: id, title: 'A cited paper was deleted', blocking: true });
      continue;
    }
    if (w.getBool('trashed')) problems.push({ code: 'source_trashed', work: id, title: '"' + w.getString('title').slice(0, 80) + '" is in the trash', blocking: true });
    if (!core().citable(w)) problems.push({ code: 'source_unresolved', work: id, title: '"' + w.getString('title').slice(0, 80) + '" has no resolved identifier', blocking: true });
    if (w.getString('identity') === 'agent_proposed') problems.push({ code: 'identity_unconfirmed', work: id, title: 'Your AI agent identified "' + w.getString('title').slice(0, 80) + '"; confirm it is the right paper', blocking: true });
    if (w.getString('integrity') === 'retracted') problems.push({ code: 'cites_retracted', work: id, title: '"' + w.getString('title').slice(0, 80) + '" was retracted', blocking: true, acknowledgeable: true });
    if (w.getString('integrity') === 'concern') problems.push({ code: 'cites_concern', work: id, title: '"' + w.getString('title').slice(0, 80) + '" has an expression of concern', blocking: false });
  }
  const pending = util.count(app, "SELECT COUNT(*) AS n FROM ms_changes WHERE manuscript = {:m} AND status = 'proposed'", { m: m.id });
  if (pending > 0) problems.push({ code: 'changes_pending', title: pending + (pending === 1 ? ' change' : ' changes') + ' from your AI agent wait for Keep or Undo', blocking: true });
  const claims = [];
  for (const b of blocks) for (const s of b.content) if (s.t === 'claim' && claims.indexOf(s.node) < 0) claims.push(s.node);
  for (const id of claims) {
    const n = util.byId(app, 'nodes', id);
    if (n !== null && n.getString('status') === 'agent_proposed') problems.push({ code: 'claim_unconfirmed', node: id, title: 'The claim "' + n.getString('title').slice(0, 80) + '" is still a proposal', blocking: false });
  }
  const marks = util.count(app, "SELECT COUNT(*) AS n FROM field_marks WHERE target = 'ms_blocks' AND confidence = 'check' AND record IN (SELECT id FROM ms_blocks WHERE manuscript = {:m})", { m: m.id });
  if (marks > 0) problems.push({ code: 'support_flags', title: marks + (marks === 1 ? ' citation was' : ' citations were') + ' flagged as not clearly supporting the sentence', blocking: false });
  for (const b of blocks) {
    if (b.content.some((s) => s.t === 'ref' && x.numbers[s.block] === undefined)) problems.push({ code: 'ref_missing', block: b.id, title: 'A cross-reference points at something no longer in the manuscript', blocking: true });
    if (b.type !== 'figure') continue;
    const label = x.numbers[b.id] ? x.numbers[b.id].label : 'A figure';
    const id = b.data ? String(b.data.file || '') : '';
    const f = id === '' ? undefined : x.figures[id];
    if (id === '') problems.push({ code: 'figure_empty', block: b.id, title: label + ' has no picture', blocking: true });
    else if (f === null || f === undefined) problems.push({ code: 'figure_missing', block: b.id, title: 'The picture of ' + label + ' was deleted from the repository', blocking: true });
    else if (!f.supported) problems.push({ code: 'figure_format', block: b.id, title: label + ' is a .' + (f.ext || 'unknown') + ' file; the PDF takes PNG, JPG or PDF pictures', blocking: true });
    else if (f.empty) problems.push({ code: 'figure_empty', block: b.id, title: 'The picture of ' + label + ' is an empty file', blocking: true });
  }
  const venue = VENUES[m.getString('template')] || VENUES.generic;
  if (x.style.missing) problems.push({ code: 'style_missing', title: "The style folder was deleted; the PDF uses the venue's standard layout", blocking: false });
  else if (venue.style && x.style.folder === null) problems.push({ code: 'style_needed', title: venue.label + "'s style files are not added yet, so the PDF uses a plain layout. Download them from the venue into the repository and choose their folder in LaTeX settings", blocking: false });
  return problems;
}

/** Share of the text typed, pasted, and kept from your AI agent, per section. */
function shares(blocks) {
  const sections = [];
  let cur = { title: 'Front matter', typed: 0, pasted: 0, agent: 0 };
  for (const b of blocks) {
    if (b.type === 'h1') {
      if (cur.typed + cur.pasted + cur.agent > 0) sections.push(cur);
      cur = { title: b.content.filter((s) => s.t === 'text').map((s) => s.v).join('') || 'Section', typed: 0, pasted: 0, agent: 0 };
    }
    cur.typed += b.typed;
    cur.pasted += b.pasted;
    cur.agent += b.agent;
  }
  if (cur.typed + cur.pasted + cur.agent > 0) sections.push(cur);
  const total = sections.reduce((a, s) => ({ typed: a.typed + s.typed, pasted: a.pasted + s.pasted, agent: a.agent + s.agent }), { typed: 0, pasted: 0, agent: 0 });
  return { sections: sections, total: total };
}

const PLACE = {
  generic: 'a statement after the main text',
  elsevier: 'a section titled "Declaration of generative AI and AI-assisted technologies in the writing process", placed before the references',
  nature: 'the Methods section',
  science: 'the cover letter and the acknowledgments',
  acl: 'the Acknowledgments section',
  iclr: 'a statement on LLM use in the paper',
  neurips: 'the paper checklist and a statement in the paper',
  ieee: 'the acknowledgments section',
};

/** The disclosure statement, from what was measured. The tool name is left for the person to fill. */
function disclosure(m, sh) {
  const t = sh.total;
  const all = t.typed + t.pasted + t.agent;
  const pct = (x) => (all === 0 ? 0 : Math.round((100 * x) / all));
  const agentPct = pct(t.agent);
  const parts = sh.sections.filter((s) => s.agent > 0).map((s) => s.title + ' (' + Math.round((100 * s.agent) / Math.max(1, s.typed + s.pasted + s.agent)) + '%)');
  const text =
    t.agent === 0
      ? 'No text in this manuscript was drafted by an AI tool. [Add any other use of AI tools, such as searching or summarizing, if your venue asks for it.]'
      : 'During the preparation of this work the author(s) used [name of the AI tool] to draft text, which the author(s) then reviewed and edited. About ' +
        agentPct +
        '% of the final text came from drafts the author(s) accepted' +
        (parts.length > 0 ? ', in: ' + parts.join(', ') : '') +
        '. All sources were checked against their original publications; the author(s) take full responsibility for the content.';
  return { template: m.getString('template'), place: PLACE[m.getString('template')] || PLACE.generic, text: text, measured: { typed: pct(t.typed), pasted: pct(t.pasted), agent: agentPct, characters: all } };
}

/** ms.get: a manuscript with blocks, rendered citations, bibliography, changes, checks, disclosure and numbering. */
function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const x = gather(app, m);
  const changes = app.findRecordsByFilter('ms_changes', "manuscript = {:m} && status = 'proposed'", 'created', 0, 0, { m: m.id }).map(changeOut);
  const nodes = {};
  for (const b of x.blocks)
    for (const s of b.content)
      if (s.t === 'claim' && !nodes[s.node]) {
        const n = util.byId(app, 'nodes', s.node);
        if (n !== null) nodes[s.node] = { id: n.id, title: n.getString('title'), kind: n.getString('kind'), status: n.getString('status') };
      }
  const marks = util.plain(util.rows(app, "SELECT record, field, confidence, reason FROM field_marks WHERE target = 'ms_blocks' AND record IN (SELECT id FROM ms_blocks WHERE manuscript = {:m})", { record: '', field: '', confidence: '', reason: '' }, { m: m.id }));
  return { manuscript: msOut(app, m), blocks: x.blocks, rendered: x.c.rendered, bibliography: x.c.bibliography, sources: x.sources, claims: nodes, changes: changes, checks: checks(app, m, x.blocks, x.c.order, x), shares: x.shares, disclosure: x.disclosure, marks: marks, numbers: x.numbers, figures: figuresOut(x.figures), style: styleOut(x.style) };
}

/** ms.text: the manuscript as plain text with citation keys, for your AI agent to read. */
function text(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const blocks = app.findRecordsByFilter('ms_blocks', 'manuscript = {:m}', 'sort', 0, 0, { m: m.id }).map(blockOut);
  const numbers = numbering(blocks, m.getString('template'));
  const lines = blocks.map((b) => {
    const body = b.content.map((s) => (s.t === 'text' ? s.v : s.t === 'cite' ? '[cite:' + s.works.join(',') + (s.locator ? ' ' + s.locator : '') + ']' : s.t === 'math' ? '$' + s.v + '$' : s.t === 'ref' ? '[ref:' + s.block + (s.bare ? ' bare' : '') + ']' : '[claim:' + s.node + ']')).join('');
    const line = { block: b.id, type: b.type, text: body };
    if (numbers[b.id] !== undefined) line.number = numbers[b.id].label;
    if (b.data !== null) line.data = b.data;
    return line;
  });
  return { manuscript: msOut(app, m), blocks: lines };
}

/* -------------------------------------------------------------- changes */

/**
 * ms.propose: your AI agent's draft as a tracked change: insert a block
 * (after a block, or at the start), replace a block's content, or delete a
 * block. Citations in it must be citable papers; a figure shows a file of
 * the project's repository.
 */
function propose(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const kind = util.oneOf(p, 'kind', ['insert', 'replace', 'delete'], '');
  if (kind === '') throw util.fail(400, 'kind is insert, replace or delete', 'missing_param');
  const c = util.newRecord(app, 'ms_changes');
  c.set('manuscript', m.id);
  c.set('kind', kind);
  c.set('status', 'proposed');
  c.set('actor', ctx.actor);
  c.set('why', util.text(p, 'why', 4000, ''));
  if (kind === 'insert') {
    const after = util.str(p, 'after', 'start');
    if (after !== 'start') {
      const a = core().need(app, 'ms_blocks', after, 'block');
      if (a.getString('manuscript') !== m.id) throw util.fail(400, 'after names a block of another manuscript.', 'invalid_param');
      c.set('after_block', a.id);
    }
    const type = util.oneOf(p, 'type', BLOCK_TYPES, 'paragraph');
    const cc = cleanContent(app, util.has(p, 'content') ? p.content : [], m.id);
    if (cc.content.length === 0 && DATA_TYPES.indexOf(type) < 0) throw util.fail(400, 'content is empty.', 'missing_param');
    c.set('after', { type: type, content: cc.content, data: cleanData(app, type, util.has(p, 'data') ? p.data : {}, m.getString('project')) });
    c.set('before', null);
  } else {
    const b = core().need(app, 'ms_blocks', util.req(p, 'block'), 'block');
    if (b.getString('manuscript') !== m.id) throw util.fail(400, 'That block belongs to another manuscript.', 'invalid_param');
    c.set('block', b.id);
    c.set('base_updated', b.getString('updated'));
    c.set('before', { type: b.getString('type'), content: util.jsonOf(b, 'content') || [], data: util.jsonOf(b, 'data') });
    if (kind === 'replace') {
      const type = util.oneOf(p, 'type', BLOCK_TYPES, b.getString('type'));
      const cc = cleanContent(app, util.has(p, 'content') ? p.content : [], m.id);
      const data = util.has(p, 'data') ? cleanData(app, type, p.data, m.getString('project')) : type === b.getString('type') ? util.jsonOf(b, 'data') : cleanData(app, type, {}, m.getString('project'));
      c.set('after', { type: type, content: cc.content, data: data });
    } else c.set('after', null);
  }
  app.save(c);
  require(`${__hooks}/lib_activity.js`).write(app, ctx, { label: 'Proposed a change to ' + m.getString('title'), target: 'ms_changes', record: c.id, project: m.getString('project') });
  return { change: changeOut(c) };
}

/** ms.keep: apply changes your AI agent proposed (refused when the block changed since). */
function keep(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = util.ids(p, 'changes', 500);
  if (ids.length === 0) throw util.fail(400, 'Give --changes.', 'missing_param');
  const kept = [];
  const stale = [];
  app.runInTransaction((tx) => {
    for (const id of ids) {
      const c = core().need(tx, 'ms_changes', id, 'change');
      if (c.getString('status') !== 'proposed') continue;
      msOf({ app: tx, isAgent: false }, c.getString('manuscript'));
      const after = util.jsonOf(c, 'after');
      const kind = c.getString('kind');
      if (kind === 'insert') {
        const cc = cleanContent(tx, after.content);
        const b = util.newRecord(tx, 'ms_blocks');
        b.set('manuscript', c.getString('manuscript'));
        b.set('sort', sortAfter(tx, c.getString('manuscript'), c.getString('after_block') || 'start'));
        b.set('type', after.type);
        b.set('content', cc.content);
        b.set('data', after.data === undefined ? null : after.data);
        b.set('text', cc.text);
        b.set('origin', 'agent_generated');
        b.set('agent_chars', charsOf(after.type, cc.content, after.data));
        tx.save(b);
        c.set('block', b.id);
      } else {
        const b = util.byId(tx, 'ms_blocks', c.getString('block'));
        if (b === null || b.getString('updated') !== c.getString('base_updated')) {
          c.set('status', 'stale');
          tx.save(c);
          stale.push(id);
          continue;
        }
        if (kind === 'delete') tx.delete(b);
        else {
          const cc = cleanContent(tx, after.content);
          b.set('type', after.type);
          b.set('content', cc.content);
          b.set('data', after.data === undefined ? null : after.data);
          b.set('text', cc.text);
          b.set('origin', b.getString('origin') === 'agent_generated' ? 'agent_generated' : 'agent_edited');
          b.set('agent_chars', charsOf(after.type, cc.content, after.data));
          b.set('typed_chars', 0);
          b.set('pasted_chars', 0);
          tx.save(b);
        }
      }
      c.set('status', 'kept');
      tx.save(c);
      kept.push(id);
    }
  });
  const any = ids.length > 0 ? util.byId(app, 'ms_changes', ids[0]) : null;
  if (any !== null) recount(app, any.getString('manuscript'));
  return { kept: kept.length, stale: stale };
}

/** ms.undo: discard proposed changes. */
function discard(ctx, p) {
  const util = u();
  const ids = util.ids(p, 'changes', 500);
  ctx.app.runInTransaction((tx) => {
    for (const id of ids) {
      const c = core().need(tx, 'ms_changes', id, 'change');
      if (c.getString('status') !== 'proposed') continue;
      c.set('status', 'undone');
      tx.save(c);
    }
  });
  return { undone: ids.length };
}

/* ------------------------------------------------------------ snapshots */

function snapshot(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const blocks = app.findRecordsByFilter('ms_blocks', 'manuscript = {:m}', 'sort', 0, 0, { m: m.id }).map(blockOut);
  const s = util.newRecord(app, 'ms_snapshots');
  s.set('manuscript', m.id);
  s.set('label', util.text(p, 'label', 300, '') || 'Snapshot ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
  s.set('content', blocks);
  s.set('actor', ctx.actor);
  s.set('words', m.getInt('words'));
  app.save(s);
  return { snapshot: { id: s.id, label: s.getString('label'), words: s.getInt('words'), created: s.getString('created') } };
}

function snapshots(ctx, p) {
  const m = msOf(ctx, u().req(p, 'manuscript'));
  return { snapshots: ctx.app.findRecordsByFilter('ms_snapshots', 'manuscript = {:m}', '-created', 100, 0, { m: m.id }).map((s) => ({ id: s.id, label: s.getString('label'), words: s.getInt('words'), actor: s.getString('actor'), created: s.getString('created') })) };
}

/** ms.restore: go back to a snapshot (the current version is snapshotted first). */
function restore(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = core().need(app, 'ms_snapshots', util.req(p, 'snapshot'), 'snapshot');
  const m = msOf(ctx, s.getString('manuscript'));
  snapshot(ctx, { manuscript: m.id, label: 'Before restoring ' + s.getString('label') });
  app.runInTransaction((tx) => {
    for (const b of tx.findRecordsByFilter('ms_blocks', 'manuscript = {:m}', '', 0, 0, { m: m.id })) tx.delete(b);
    for (const b of util.jsonOf(s, 'content') || []) {
      const r = util.newRecord(tx, 'ms_blocks');
      // The block keeps its id, so cross-references to it still find it.
      if (typeof b.id === 'string' && b.id !== '') r.set('id', b.id);
      r.set('manuscript', m.id);
      r.set('sort', b.sort);
      r.set('type', b.type);
      r.set('content', b.content);
      r.set('data', b.data === undefined ? null : b.data);
      r.set('text', textOf(b.content));
      r.set('origin', b.origin || 'typed');
      r.set('typed_chars', b.typed || 0);
      r.set('pasted_chars', b.pasted || 0);
      r.set('agent_chars', b.agent || 0);
      tx.save(r);
    }
  });
  recount(app, m.id);
  return { restored: true };
}

/** ms.set-status: mark ready (blocked by unresolved, unconfirmed or retracted sources unless acknowledged) or back to draft. */
function setStatus(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const to = util.oneOf(p, 'status', ['draft', 'ready'], '');
  if (to === 'draft') {
    m.set('status', 'draft');
    m.set('ready_at', '');
    app.save(m);
    return { manuscript: msOut(app, m) };
  }
  const g = get(ctx, { manuscript: m.id });
  const ack = util.bool(p, 'acknowledge_retracted', false);
  const blocking = g.checks.filter((c) => c.blocking && !(c.acknowledgeable && ack));
  if (blocking.length > 0) throw util.fail(409, 'Not ready: ' + blocking.map((c) => c.title).join('; ') + '.', blocking[0].code, { checks: blocking });
  m.set('status', 'ready');
  m.set('ready_at', util.nowIso());
  app.save(m);
  require(`${__hooks}/lib_activity.js`).write(app, ctx, { label: 'Marked ' + m.getString('title') + ' ready', target: 'manuscripts', record: m.id, project: m.getString('project') });
  return { manuscript: msOut(app, m) };
}

/* ---------------------------------------------------------------- LaTeX */

/**
 * The venue's preamble: the document class, the venue's own packages from
 * the style folder, then fonts (XeTeX's fontspec when the engine is XeTeX,
 * which Tectonic is; T1 and Latin Modern under pdfLaTeX, so the exported
 * source builds elsewhere too), maths, pictures, booktabs tables, natbib
 * (IEEE: cite) and hyperref. natbib's and hyperref's options are passed
 * first, so a venue style that loads them itself gets the same ones.
 */
function defaultPreamble(m, venue, st) {
  const C = cite();
  const numeric = C.NUMERIC[m.getString('style')] === true;
  const L = [];
  let opts = venue.opts;
  if (venue.front === 'elsarticle' && !numeric) opts = opts + (opts !== '' ? ',' : '') + 'authoryear';
  L.push('\\documentclass' + (opts !== '' ? '[' + opts + ']' : '') + '{' + (st.cls !== '' ? st.cls : venue.cls) + '}');
  const nat = m.getString('style') === 'nature' ? 'super,sort&compress' : numeric ? 'numbers,sort&compress' : '';
  if (venue.cite !== 'cite' && venue.front !== 'elsarticle' && nat !== '') L.push('\\PassOptionsToPackage{' + nat + '}{natbib}');
  L.push('\\PassOptionsToPackage{hidelinks}{hyperref}');
  for (const s of st.sty) L.push('\\usepackage{' + s + '}');
  L.push('\\usepackage{iftex}', '\\ifPDFTeX', '  \\usepackage[utf8]{inputenc}', '  \\usepackage[T1]{fontenc}', '  \\usepackage{lmodern}', '\\else', '  \\usepackage{fontspec}', '\\fi');
  L.push('\\usepackage{amsmath,amssymb}', '\\usepackage{graphicx}', '\\usepackage{booktabs}');
  L.push(venue.cite === 'cite' ? '\\usepackage{cite}' : '\\usepackage{natbib}');
  L.push('\\usepackage{hyperref}');
  return L.join('\n');
}

function bstOf(m, venue, st) {
  if (st.bst !== '') return st.bst;
  const numeric = cite().NUMERIC[m.getString('style')] === true;
  if (venue.front === 'ieee') return 'IEEEtran';
  if (venue.front === 'elsarticle') return numeric ? 'elsarticle-num' : 'elsarticle-harv';
  return numeric ? 'unsrtnat' : 'plainnat';
}

/** Inline segments as LaTeX. */
function texInline(content, cx) {
  const C = cite();
  let out = '';
  for (const s of content) {
    if (s.t === 'text') {
      let v = C.tex(s.v);
      if (s.b) v = '\\textbf{' + v + '}';
      if (s.i) v = '\\emph{' + v + '}';
      out += v;
    } else if (s.t === 'cite') {
      // A citation binds to the word before it; a superscript one sits right on it.
      out = out.replace(/[  ]+$/, '') + (cx.sup ? '' : '~') + '\\' + cx.cmd + (s.locator ? '[' + C.tex(s.locator) + ']' : '') + '{' + s.works.map((id) => cx.keyOf[id] || id).join(',') + '}';
    } else if (s.t === 'math') out += '$' + s.v + '$';
    else if (s.t === 'ref') {
      const t = cx.numbers[s.block];
      if (t === undefined) out += '\\textbf{??}';
      else {
        const lbl = LABEL[t.kind] + ':' + s.block;
        const word = t.kind === 'section' ? 'Section' : t.kind === 'figure' ? cx.fig : t.kind === 'table' ? 'Table' : 'Eq.';
        const ref = (t.kind === 'equation' ? '\\eqref{' : '\\ref{') + lbl + '}';
        out += s.bare ? ref : word + '~' + ref;
      }
    }
  }
  return out;
}

function cellTex(c, align) {
  const C = cite();
  if (c.indexOf('\n') < 0) return C.tex(c);
  return '\\shortstack[' + (align === 'center' ? 'c' : align === 'right' ? 'r' : 'l') + ']{' + c.split('\n').map((x) => C.tex(x)).join('\\\\') + '}';
}

function authorsTex(authors, front) {
  const C = cite();
  if (front === 'ieee')
    return authors
      .map((a) => {
        const lines = [a.affiliation !== '' ? C.tex(a.affiliation) : '', a.email !== '' ? '\\texttt{' + C.tex(a.email) + '}' : ''].filter((x) => x !== '');
        return '\\IEEEauthorblockN{' + C.tex(a.name) + '}' + (lines.length > 0 ? '\\IEEEauthorblockA{' + lines.join('\\\\') + '}' : '');
      })
      .join('\n\\and\n');
  return authors.map((a) => [C.tex(a.name), a.affiliation !== '' ? C.tex(a.affiliation) : '', a.email !== '' ? '\\texttt{' + C.tex(a.email) + '}' : ''].filter((x) => x !== '').join(' \\\\ ')).join('\n\\and\n');
}

function elsAuthors(authors) {
  const C = cite();
  const affs = [];
  for (const a of authors) if (a.affiliation !== '' && affs.indexOf(a.affiliation) < 0) affs.push(a.affiliation);
  const L = [];
  for (const a of authors) {
    L.push('\\author' + (a.affiliation !== '' ? '[' + (affs.indexOf(a.affiliation) + 1) + ']' : '') + '{' + C.tex(a.name) + '}');
    if (a.email !== '') L.push('\\ead{' + C.tex(a.email) + '}');
  }
  affs.forEach((f, i) => L.push('\\affiliation[' + (i + 1) + ']{organization={' + C.tex(f) + '}}'));
  return L;
}

/**
 * main.tex and what it needs: { files [{path, content}], assets [{path,
 * item, name, version, disk}] (figures as figures/fig<n>.<ext>, the style
 * folder's files at their place under it), lines (which lines of main.tex
 * each block wrote, and the preamble's and the title's), stamp (changes
 * when anything the PDF is made from changes), preamble_default }.
 */
function latexSource(app, m, gathered) {
  const util = u();
  const C = cite();
  const x = gathered || gather(app, m);
  const tpl = m.getString('template');
  const venue = VENUES[tpl] || VENUES.generic;
  const numeric = C.NUMERIC[m.getString('style')] === true;
  const keyOf = {};
  for (const w of x.sources) keyOf[w.id] = w.citekey || w.id;
  const cx = { cmd: venue.cite === 'cite' || numeric ? 'cite' : 'citep', sup: venue.cite !== 'cite' && m.getString('style') === 'nature', keyOf: keyOf, numbers: x.numbers, fig: venue.fig || 'Figure' };
  const L = [];
  const lines = [];
  const assets = [];
  const push = (...xs) => {
    for (const s of xs) for (const line of String(s).split('\n')) L.push(line);
  };
  const span = (key, fn) => {
    const f = L.length + 1;
    fn();
    if (L.length >= f) lines.push(Object.assign({ f: f, t: L.length }, key));
  };
  const preambleDefault = defaultPreamble(m, venue, x.style);
  const own = m.getString('preamble').trim() !== '';
  span({ w: 'preamble' }, () => push(own ? m.getString('preamble').replace(/\s+$/, '') : preambleDefault));
  push('');
  const title = C.tex(m.getString('title'));
  const authors = util.jsonOf(m, 'authors') || [];
  const abstract = x.blocks.filter((b) => b.type === 'abstract' && b.content.length > 0);
  const writeAbstract = () => {
    if (abstract.length === 0) return;
    push('\\begin{abstract}');
    abstract.forEach((b, i) => {
      if (i > 0) push('');
      span({ b: b.id }, () => push(texInline(b.content, cx)));
    });
    push('\\end{abstract}', '');
  };
  if (venue.front === 'elsarticle') {
    push('\\begin{document}', '');
    span({ w: 'front' }, () => push('\\begin{frontmatter}', '\\title{' + title + '}', ...elsAuthors(authors)));
    writeAbstract();
    push('\\end{frontmatter}', '');
  } else {
    span({ w: 'front' }, () => push('\\title{' + title + '}', '\\author{' + authorsTex(authors, venue.front) + '}', '\\date{}'));
    push('', '\\begin{document}', '\\maketitle', '');
    writeAbstract();
  }
  let list = '';
  const close = () => {
    if (list !== '') {
      push('\\end{' + list + '}', '');
      list = '';
    }
  };
  for (const b of x.blocks) {
    if (b.type === 'abstract') continue;
    if (b.type === 'bullet' || b.type === 'numbered') {
      const env = b.type === 'bullet' ? 'itemize' : 'enumerate';
      if (list !== env) {
        close();
        push('\\begin{' + env + '}');
        list = env;
      }
      span({ b: b.id }, () => push('  \\item ' + texInline(b.content, cx)));
      continue;
    }
    close();
    span({ b: b.id }, () => {
      const body = () => texInline(b.content, cx);
      if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') push('\\' + (b.type === 'h1' ? '' : b.type === 'h2' ? 'sub' : 'subsub') + 'section{' + body() + '}\\label{sec:' + b.id + '}');
      else if (b.type === 'quote') {
        if (b.content.length > 0) push('\\begin{quote}', body(), '\\end{quote}');
      } else if (b.type === 'equation') {
        const src = equationOf(b);
        if (src !== '') push('\\begin{equation}\\label{eq:' + b.id + '}', src, '\\end{equation}');
      } else if (b.type === 'figure') {
        const id = b.data ? String(b.data.file || '') : '';
        const f = id === '' ? null : x.figures[id];
        push('\\begin{figure}[htbp]', '\\centering');
        if (f !== null && f !== undefined && f.supported && !f.empty) {
          const path = 'figures/fig' + x.numbers[b.id].n + '.' + f.ext;
          assets.push({ path: path, item: f.id, name: f.name, version: f.version, disk: f.disk });
          push('\\includegraphics[width=' + ((b.data.width || 80) / 100).toFixed(2) + '\\linewidth]{' + path + '}');
        } else push('\\fbox{\\parbox{0.6\\linewidth}{\\centering\\vspace{2em}Picture missing\\vspace{2em}}}');
        push('\\caption{' + body() + '}\\label{fig:' + b.id + '}', '\\end{figure}');
      } else if (b.type === 'table') {
        const d = b.data || { rows: [['']], header: true, align: ['left'] };
        push('\\begin{table}[htbp]', '\\centering', '\\caption{' + body() + '}\\label{tab:' + b.id + '}', '\\begin{tabular}{' + d.align.map((a) => (a === 'center' ? 'c' : a === 'right' ? 'r' : 'l')).join('') + '}', '\\toprule');
        d.rows.forEach((r, i) => {
          push(r.map((c, j) => cellTex(c, d.align[j])).join(' & ') + ' \\\\');
          if (i === 0 && d.header && d.rows.length > 1) push('\\midrule');
        });
        push('\\bottomrule', '\\end{tabular}', '\\end{table}');
      } else if (b.type === 'latex') {
        const code = b.data ? String(b.data.code || '') : '';
        if (code.trim() !== '') push(code.replace(/\s+$/, ''));
      } else {
        const t = body();
        if (t.trim() !== '') push(t);
      }
    });
    if (L[L.length - 1] !== '') push('');
  }
  close();
  if (x.shares.total.agent > 0 || tpl !== 'generic') push('\\section*{Declaration of AI use}', C.tex(x.disclosure.text), '');
  if (x.sources.length > 0) push('\\bibliographystyle{' + bstOf(m, venue, x.style) + '}', '\\bibliography{references}', '');
  push('\\end{document}', '');
  for (const f of x.style.files) if (!f.empty) assets.push({ path: f.rel, item: f.id, name: f.name, version: f.version, disk: f.disk });
  const main = L.join('\n');
  const bib = x.sources.map((w) => C.bibtexOf(C.dataOf(app.findRecordById('works', w.id)))).join('\n');
  const stamp = util.sha(main + '\n' + bib + '\n' + assets.map((a) => a.path + '=' + a.item + ':' + a.version).join('\n'));
  return { files: [{ path: 'main.tex', content: main }, { path: 'references.bib', content: bib }], assets: assets, lines: lines, stamp: stamp, preamble_default: preambleDefault, own_preamble: own, style: x.style };
}

/** ms.latex: the LaTeX the PDF is built from, and the venue's preamble (the starting point for one's own). */
function latex(ctx, p) {
  const util = u();
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const src = latexSource(ctx.app, m);
  return { main_tex: src.files[0].content, references_bib: src.files[1].content, preamble_default: src.preamble_default, own_preamble: src.own_preamble, style: styleOut(src.style), assets: src.assets.map((a) => (ctx.isAgent ? { path: a.path, item: a.item, name: a.name, disk_path: a.disk } : { path: a.path, item: a.item, name: a.name })), lines: src.lines, stamp: src.stamp };
}

/* --------------------------------------------------------------- builds */

function jobsDir(app) {
  return $filepath.join(app.dataDir(), 'ro_latex');
}

function buildOut(ctx, r, withLog) {
  const util = u();
  const o = { id: r.id, manuscript: r.getString('manuscript'), status: r.getString('status'), phase: r.getString('phase'), pages: r.getInt('pages'), seconds: r.getFloat('seconds'), errors: util.jsonOf(r, 'errors') || [], stamp: r.getString('stamp'), has_pdf: r.getString('pdf') !== '', actor: r.getString('actor'), created: r.getString('created'), finished_at: r.getString('finished_at') };
  if (withLog) o.log = r.getString('log');
  if (ctx.isAgent && o.has_pdf) o.pdf_path = util.filePath(ctx.app, r, 'pdf');
  return o;
}

/** Take in a running build's result once the engine has written it (or give up on a build that stopped). */
function settle(app, rec) {
  const util = u();
  if (rec.getString('status') !== 'running') return;
  const dir = rec.getString('dir');
  let st = null;
  if (dir !== '') {
    try {
      st = JSON.parse(toString($os.readFile($filepath.join(dir, 'status.json'))));
    } catch {
      st = null;
    }
  }
  const now = Date.now();
  const started = Date.parse(rec.getString('created').replace(' ', 'T'));
  let result = null;
  if (st === null) {
    if (now - started > 90000) result = { ok: false, errors: [{ message: 'The build did not start.' }], warnings: [] };
  } else if (st.phase === 'done' || st.phase === 'failed') result = st;
  else if (now - Number(st.beat || 0) > 90000) result = { ok: false, errors: [{ message: 'The build stopped before it finished (the computer may have slept or restarted). Build again.' }], warnings: [] };
  if (result === null) {
    if (st !== null && st.phase !== rec.getString('phase')) {
      const r = app.findRecordById('ms_builds', rec.id);
      if (r.getString('status') === 'running') {
        r.set('phase', String(st.phase).slice(0, 40));
        app.save(r);
      }
    }
    return;
  }
  const lines = util.jsonOf(rec, 'lines') || [];
  const place = (e, level) => {
    const o = { level: level, message: String(e.message || '').slice(0, 600) };
    if (e.file !== undefined) {
      o.file = String(e.file);
      o.line = Number(e.line) || 0;
      if (o.file === 'main.tex')
        for (const s of lines)
          if (o.line >= s.f && o.line <= s.t) {
            if (s.b !== undefined) o.block = s.b;
            else o.where = s.w;
            break;
          }
    }
    return o;
  };
  const pdfPath = dir === '' ? '' : $filepath.join(dir, 'main.pdf');
  let hasPdf = false;
  try {
    hasPdf = pdfPath !== '' && $os.stat(pdfPath).size() > 0;
  } catch {
    hasPdf = false;
  }
  const ok = result.ok === true && hasPdf;
  let done = false;
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('ms_builds', rec.id);
    if (r.getString('status') !== 'running') return;
    r.set('status', ok ? 'done' : 'failed');
    r.set('phase', ok ? 'done' : 'failed');
    r.set('pages', ok ? Number(result.pages) || 0 : 0);
    r.set('seconds', Number(result.seconds) || 0);
    r.set('log', String(result.log || '').slice(-190000));
    r.set('errors', (result.errors || []).slice(0, 200).map((e) => place(e, 'error')).concat((result.warnings || []).slice(0, 100).map((e) => place(e, 'warning'))));
    if (ok) r.set('pdf', $filesystem.fileFromPath(pdfPath));
    r.set('finished_at', util.nowIso());
    tx.save(r);
    done = true;
  });
  if (done && dir !== '') {
    try {
      $os.removeAll(dir);
    } catch {
      /* the hourly sweep takes it */
    }
  }
}

/** Keep the latest few finished builds of a manuscript. */
function prune(app, msId) {
  const old = app.findRecordsByFilter('ms_builds', "manuscript = {:m} && status != 'running'", '-created', 0, KEEP_BUILDS, { m: msId });
  for (const r of old) {
    const again = u().byId(app, 'ms_builds', r.id);
    if (again !== null) app.delete(again);
  }
}

/** ms.build: typeset the manuscript as a PDF in the background (one build at a time per manuscript). */
function build(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const running = app.findRecordsByFilter('ms_builds', "manuscript = {:m} && status = 'running'", '-created', 1, 0, { m: m.id })[0];
  if (running !== undefined) {
    settle(app, running);
    const again = app.findRecordById('ms_builds', running.id);
    if (again.getString('status') === 'running') return { build: buildOut(ctx, again), already: true };
  }
  const src = latexSource(app, m);
  const b = util.newRecord(app, 'ms_builds');
  b.set('manuscript', m.id);
  b.set('status', 'running');
  b.set('phase', 'starting');
  b.set('actor', ctx.actor);
  b.set('lines', src.lines);
  b.set('stamp', src.stamp);
  b.set('errors', []);
  app.save(b);
  const dir = $filepath.join(jobsDir(app), b.id);
  try {
    $os.mkdirAll($filepath.join(dir, 'figures'), 0o755);
    for (const f of src.files) $os.writeFile($filepath.join(dir, f.path), f.content, 0o644);
    for (const a of src.assets) {
      const dest = $filepath.join(dir, a.path);
      $os.mkdirAll($filepath.dir(dest), 0o755);
      $os.writeFile(dest, $os.readFile(a.disk), 0o644);
    }
    b.set('dir', dir);
    app.save(b);
    $os.cmd('node', $filepath.join(__hooks, '..', '..', 'engine', 'latex.mjs'), 'start', dir).run();
  } catch (err) {
    console.error('[ro] the PDF build did not start:', err);
    b.set('status', 'failed');
    b.set('phase', 'failed');
    b.set('errors', [{ level: 'error', message: 'The build did not start: ' + String(err).slice(0, 300) }]);
    b.set('finished_at', util.nowIso());
    app.save(b);
  }
  prune(app, m.id);
  return { build: buildOut(ctx, b) };
}

/** ms.build-status: a build (or the manuscript's latest), and whether the manuscript changed since. */
function buildStatus(ctx, p) {
  const util = u();
  const app = ctx.app;
  let rec = null;
  let m;
  if (util.str(p, 'build', '') !== '') {
    rec = core().need(app, 'ms_builds', util.str(p, 'build', ''), 'build');
    m = msOf(ctx, rec.getString('manuscript'));
  } else {
    m = msOf(ctx, util.req(p, 'manuscript'));
    rec = app.findRecordsByFilter('ms_builds', 'manuscript = {:m}', '-created', 1, 0, { m: m.id })[0] || null;
  }
  if (rec !== null) {
    settle(app, rec);
    rec = app.findRecordById('ms_builds', rec.id);
  }
  const out = rec === null ? null : buildOut(ctx, rec, util.bool(p, 'log', false));
  // The PDF to show: this build's, or while it runs (or after it failed) the last one made.
  const shown = out !== null && out.has_pdf ? rec : app.findRecordsByFilter('ms_builds', "manuscript = {:m} && pdf != ''", '-created', 1, 0, { m: m.id })[0] || null;
  const pdfBuild = shown === null ? null : out !== null && shown.id === out.id ? out : buildOut(ctx, shown);
  // While it runs nobody asks whether it is current; working it out means writing the source.
  if (out !== null && out.status === 'running') return { build: out, pdf_build: pdfBuild };
  const stamp = latexSource(app, m).stamp;
  return { build: out, pdf_build: pdfBuild, current: out !== null && out.stamp === stamp, stamp: stamp };
}

/** ms.pdf: a build's PDF (inline for the viewer; --download true to save it). */
function pdf(ctx, p) {
  const util = u();
  const r = core().need(ctx.app, 'ms_builds', util.req(p, 'build'), 'build');
  const m = msOf(ctx, r.getString('manuscript'));
  if (r.getString('pdf') === '') throw util.fail(404, 'This build has no PDF.', 'not_found');
  if (ctx.isAgent) return { build: buildOut(ctx, r), disk_path: util.filePath(ctx.app, r, 'pdf') };
  const name = (m.getString('title').replace(/[^\w\- ]+/g, '').trim() || 'manuscript') + '.pdf';
  return require(`${__hooks}/lib_files.js`).streamName(ctx, r, r.getString('pdf'), 'application/pdf', name, 'private, max-age=31536000, immutable', !util.bool(p, 'download', false));
}

/** Every minute: take in builds nobody is watching. */
function settleAll(app) {
  for (const r of app.findRecordsByFilter('ms_builds', "status = 'running'", '', 200, 0)) {
    try {
      settle(app, r);
    } catch (err) {
      console.error('[ro] settling a PDF build failed:', err);
    }
  }
}

/** Every hour: build folders no running build owns (a manuscript deleted mid-build). */
function sweep(app) {
  const root = jobsDir(app);
  let entries = [];
  try {
    entries = $os.readDir(root);
  } catch {
    return;
  }
  const running = {};
  for (const r of app.findRecordsByFilter('ms_builds', "status = 'running'", '', 0, 0)) running[r.id] = true;
  for (const e of entries) {
    if (running[e.name()] === true) continue;
    try {
      $os.removeAll($filepath.join(root, e.name()));
    } catch {
      /* next hour */
    }
  }
}

/* --------------------------------------------------------------- export */

/** ms.export: LaTeX (main.tex, references.bib and the figures and style files to add), Markdown, plain text, or the model a Word file is built from. */
function exportMs(ctx, p) {
  const util = u();
  const app = ctx.app;
  const format = util.oneOf(p, 'format', ['latex', 'markdown', 'docx', 'text'], 'latex');
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const x = gather(app, m);
  const C = cite();
  const keyOf = {};
  for (const w of x.sources) keyOf[w.id] = w.citekey || w.id;
  const assetOut = (a) => (ctx.isAgent ? { path: a.path, item: a.item, name: a.name, version: a.version, disk_path: a.disk } : { path: a.path, item: a.item, name: a.name, version: a.version });
  if (format === 'latex') {
    const src = latexSource(app, m, x);
    return { format: 'latex', files: src.files, assets: src.assets.map(assetOut) };
  }
  const title = m.getString('title');
  const authors = util.jsonOf(m, 'authors') || [];
  const figure = (b) => {
    const id = b.data ? String(b.data.file || '') : '';
    const f = id === '' ? null : x.figures[id];
    return f === null || f === undefined || f.empty ? null : f;
  };
  if (format === 'markdown' || format === 'text') {
    const md = format === 'markdown';
    const assets = [];
    const inline = (b) => {
      const r = x.c.rendered[b.id] || [];
      return b.content
        .map((s, i) => {
          if (s.t === 'text') return md && s.b ? '**' + s.v + '**' : md && s.i ? '*' + s.v + '*' : s.v;
          if (s.t === 'cite') return md ? ' [' + s.works.map((id) => '@' + keyOf[id]).join('; ') + (s.locator ? ', ' + s.locator : '') + ']' : ' ' + (r[i] ? r[i].text : '');
          if (s.t === 'math') return md ? '$' + s.v + '$' : s.v;
          if (s.t === 'ref') return refText(x.numbers, s);
          return '';
        })
        .join('');
    };
    const L = [md ? '# ' + title : title, ''];
    if (authors.length > 0) L.push(authors.map((a) => a.name + (a.affiliation !== '' ? ' (' + a.affiliation + ')' : '')).join(', '), '');
    const abstract = x.blocks.filter((b) => b.type === 'abstract' && b.content.length > 0);
    abstract.forEach((b, i) => L.push((i === 0 ? (md ? '**Abstract.** ' : 'Abstract. ') : '') + inline(b), ''));
    let num = 0;
    for (const b of x.blocks) {
      if (b.type === 'abstract') continue;
      const body = inline(b);
      const n = x.numbers[b.id];
      if (b.type !== 'numbered') num = 0;
      if (b.type === 'h1') L.push((md ? '## ' : '') + body, '');
      else if (b.type === 'h2') L.push((md ? '### ' : '') + body, '');
      else if (b.type === 'h3') L.push((md ? '#### ' : '') + body, '');
      else if (b.type === 'bullet') L.push('- ' + body);
      else if (b.type === 'numbered') L.push(++num + '. ' + body);
      else if (b.type === 'quote') L.push('> ' + body, '');
      else if (b.type === 'equation') {
        const src = equationOf(b);
        if (src !== '') L.push(md ? '$$' + src + (n ? ' \\tag{' + n.n + '}' : '') + '$$' : src + (n ? '    (' + n.n + ')' : ''), '');
      } else if (b.type === 'figure') {
        const f = figure(b);
        const cap = (n ? n.caption : 'Figure') + (body !== '' ? ': ' + body : '');
        if (md && f !== null) {
          const path = 'figures/fig' + n.n + '.' + f.ext;
          assets.push({ path: path, item: f.id, name: f.name, version: f.version, disk: f.disk });
          L.push('![' + cap.replace(/[[\]]/g, '') + '](' + path + ')', '', '*' + cap + '*', '');
        } else L.push('[' + cap + ']', '');
      } else if (b.type === 'table') {
        const d = b.data || { rows: [['']], header: true, align: ['left'] };
        const cap = (n ? n.caption : 'Table') + (body !== '' ? ': ' + body : '');
        L.push(md ? '*' + cap + '*' : cap, '');
        if (md) {
          const cell = (c) => String(c).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
          const head = d.header ? d.rows[0] : d.rows[0].map(() => '');
          L.push('| ' + head.map(cell).join(' | ') + ' |', '| ' + d.align.map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : '---')).join(' | ') + ' |');
          for (const r of d.header ? d.rows.slice(1) : d.rows) L.push('| ' + r.map(cell).join(' | ') + ' |');
        } else for (const r of d.rows) L.push(r.map((c) => String(c).replace(/\n/g, ' ')).join('\t'));
        L.push('');
      } else if (b.type === 'latex') {
        const code = b.data ? String(b.data.code || '') : '';
        if (code.trim() !== '') L.push(md ? '```latex\n' + code.replace(/\s+$/, '') + '\n```' : code.replace(/\s+$/, ''), '');
      } else if (body.trim() !== '') L.push(body, '');
    }
    L.push('', md ? '## References' : 'References', '');
    for (const e of x.c.bibliography) L.push(md ? e.md : e.text, '');
    if (x.shares.total.agent > 0) L.push(md ? '## Declaration of AI use' : 'Declaration of AI use', '', x.disclosure.text, '');
    const bib = x.sources.map((w) => C.bibtexOf(C.dataOf(app.findRecordById('works', w.id)))).join('\n');
    return md ? { format: 'markdown', files: [{ path: 'manuscript.md', content: L.join('\n') }, { path: 'references.bib', content: bib }], assets: assets.map(assetOut) } : { format: 'text', files: [{ path: 'manuscript.txt', content: L.join('\n') }] };
  }
  // Word: the screen builds the .docx from this model (paragraph styles and runs, pictures and tables).
  const style = m.getString('style');
  const runsOf = (b) => {
    const r = x.c.rendered[b.id] || [];
    return b.content
      .map((s, i) => (s.t === 'text' ? { text: s.v, bold: s.b === true, italic: s.i === true } : s.t === 'cite' ? { text: (C.NUMERIC[style] && style === 'nature' ? '' : ' ') + (r[i] ? r[i].text.replace(/^\^/, '') : ''), superscript: style === 'nature' } : s.t === 'math' ? { text: s.v, italic: true } : s.t === 'ref' ? { text: refText(x.numbers, s) } : null))
      .filter((y) => y !== null && y.text !== '');
  };
  const paras = [{ style: 'Title', runs: [{ text: title }] }];
  if (authors.length > 0) paras.push({ style: 'Authors', runs: [{ text: authors.map((a) => a.name + (a.affiliation !== '' ? ' (' + a.affiliation + ')' : '')).join(', ') }] });
  const abstract = x.blocks.filter((b) => b.type === 'abstract' && b.content.length > 0);
  if (abstract.length > 0) {
    paras.push({ style: 'Heading1', runs: [{ text: 'Abstract' }] });
    for (const b of abstract) paras.push({ style: 'Normal', runs: runsOf(b) });
  }
  for (const b of x.blocks) {
    if (b.type === 'abstract') continue;
    const n = x.numbers[b.id];
    if (b.type === 'figure') {
      const f = figure(b);
      if (f !== null && (f.ext === 'png' || f.ext === 'jpg' || f.ext === 'jpeg')) paras.push({ style: 'Figure', runs: [], image: { item: f.id, version: f.version, name: f.name, ext: f.ext, width: b.data.width || 80 } });
      else if (f !== null) paras.push({ style: 'Figure', runs: [{ text: '[' + f.name + ']' }] });
      paras.push({ style: 'Caption', runs: [{ text: (n ? n.caption : 'Figure') + '. ', bold: true }].concat(runsOf(b)) });
      continue;
    }
    if (b.type === 'table') {
      paras.push({ style: 'Caption', runs: [{ text: (n ? n.caption : 'Table') + '. ', bold: true }].concat(runsOf(b)) });
      paras.push({ style: 'Normal', runs: [], table: b.data || { rows: [['']], header: true, align: ['left'] } });
      continue;
    }
    if (b.type === 'equation') {
      const src = equationOf(b);
      // Centred on a tab stop, its number at the right margin.
      if (src !== '') paras.push({ style: 'Equation', runs: [{ text: '\t' + src + (n ? '\t(' + n.n + ')' : '') }] });
      continue;
    }
    if (b.type === 'latex') {
      const code = b.data ? String(b.data.code || '').replace(/\s+$/, '') : '';
      if (code !== '') paras.push({ style: 'Code', runs: [{ text: code }] });
      continue;
    }
    const runs = runsOf(b);
    const st = { h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', quote: 'Quote', bullet: 'ListBullet', numbered: 'ListNumber', paragraph: 'Normal' }[b.type] || 'Normal';
    if (runs.length > 0) paras.push({ style: st, runs: runs });
  }
  paras.push({ style: 'Heading1', runs: [{ text: 'References' }] });
  for (const e of x.c.bibliography) paras.push({ style: 'Bibliography', runs: mdRuns(e.md) });
  if (x.shares.total.agent > 0) {
    paras.push({ style: 'Heading1', runs: [{ text: 'Declaration of AI use' }] });
    paras.push({ style: 'Normal', runs: [{ text: x.disclosure.text }] });
  }
  return { format: 'docx', title: title, paragraphs: paras };
}

/** "*Journal*, **12**" style Markdown emphasis to runs. */
function mdRuns(md) {
  const runs = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let mm;
  while ((mm = re.exec(md)) !== null) {
    if (mm.index > last) runs.push({ text: md.slice(last, mm.index) });
    const t = mm[0];
    if (t.indexOf('**') === 0) runs.push({ text: t.slice(2, -2), bold: true });
    else runs.push({ text: t.slice(1, -1), italic: true });
    last = mm.index + t.length;
  }
  if (last < md.length) runs.push({ text: md.slice(last) });
  return runs;
}

module.exports = {
  BLOCK_TYPES: BLOCK_TYPES,
  TEMPLATES: TEMPLATES,
  cleanContent: cleanContent,
  list: list,
  create: create,
  update: update,
  remove: remove,
  saveBlock: saveBlock,
  deleteBlock: deleteBlock,
  moveBlock: moveBlock,
  get: get,
  text: text,
  propose: propose,
  keep: keep,
  discard: discard,
  snapshot: snapshot,
  snapshots: snapshots,
  restore: restore,
  setStatus: setStatus,
  updatePreview: updatePreview,
  latex: latex,
  build: build,
  buildStatus: buildStatus,
  pdf: pdf,
  settleAll: settleAll,
  sweep: sweep,
  exportMs: exportMs,
};
