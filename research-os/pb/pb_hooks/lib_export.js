/// <reference path="../pb_data/types.d.ts" />
/**
 * Exports, so nothing is locked in: papers as BibTeX, RIS or CSL-JSON (for
 * any citation tool), notes as Markdown with front matter, boards as JSON
 * Canvas (Obsidian and other canvas tools open them).
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

/** The papers an export covers: --works, --collection, --project, or all. */
function scope(ctx, p) {
  const util = u();
  const app = ctx.app;
  const hidden = core().hiddenSql(ctx, 'w');
  const ids = util.ids(p, 'works', 50000);
  if (ids.length > 0) return ids;
  if (util.str(p, 'collection', '') !== '') return util.rows(app, 'SELECT w.id AS id FROM collection_items ci JOIN works w ON w.id = ci.work WHERE ci.collection = {:c} AND w.trashed = FALSE' + hidden + ' ORDER BY w.created', { id: '' }, { c: util.str(p, 'collection', '') }).map((r) => r.id);
  if (util.str(p, 'project', '') !== '') {
    const pr = core().project(app, util.str(p, 'project', ''));
    core().guardProject(ctx, pr);
    return util.rows(app, 'SELECT w.id AS id FROM project_works pw JOIN works w ON w.id = pw.work WHERE pw.project = {:p} AND w.trashed = FALSE' + hidden + ' ORDER BY pw.sort, pw.created', { id: '' }, { p: pr.id }).map((r) => r.id);
  }
  return util.rows(app, 'SELECT w.id AS id FROM works w WHERE w.trashed = FALSE' + hidden + ' ORDER BY w.created', { id: '' }).map((r) => r.id);
}

/** export.works: papers in a citation format, as text. */
function works(ctx, p) {
  const util = u();
  const app = ctx.app;
  const C = require(`${__hooks}/lib_cite.js`);
  const format = util.oneOf(p, 'format', ['bibtex', 'ris', 'csljson'], 'bibtex');
  const ids = scope(ctx, p);
  const recs = ids.length > 0 ? app.findRecordsByIds('works', ids) : [];
  const order = {};
  ids.forEach((id, i) => (order[id] = i));
  recs.sort((a, b) => order[a.id] - order[b.id]);
  const data = recs.filter((w) => !w.getBool('trashed')).map(C.dataOf);
  let body = '';
  if (format === 'bibtex') body = data.map(C.bibtexOf).join('\n');
  else if (format === 'ris') body = data.map(C.risOf).join('\r\n');
  else body = JSON.stringify(data.map(C.cslOf), null, 2);
  const ext = { bibtex: 'bib', ris: 'ris', csljson: 'json' }[format];
  return { format: format, count: data.length, filename: 'library.' + ext, mime: format === 'csljson' ? 'application/json' : 'text/plain', content: body };
}

/* -------------------------------------------------------------- notes */

function yamlStr(s) {
  return '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

function slug(s) {
  return (
    String(s || 'note')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .toLowerCase() || 'note'
  );
}

/** A table cell in a Markdown (GFM) table: a bar is escaped, a line break becomes <br>. */
function cell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

/** A note as Markdown. Its pictures are named in `attachments` (path next to the note, picture id) when given. */
function noteMarkdown(app, n, attachments, dir) {
  const util = u();
  const w = n.getString('work') !== '' ? util.byId(app, 'works', n.getString('work')) : null;
  const pr = n.getString('project') !== '' ? util.byId(app, 'projects', n.getString('project')) : null;
  const fm = ['---', 'title: ' + yamlStr(n.getString('title') || (w !== null ? w.getString('title') : 'Note')), 'kind: ' + n.getString('kind')];
  if (w !== null) {
    fm.push('paper: ' + yamlStr(w.getString('title')));
    if (w.getString('citekey') !== '') fm.push('citekey: ' + w.getString('citekey'));
    if (w.getString('doi') !== '') fm.push('doi: ' + w.getString('doi'));
  }
  if (pr !== null) fm.push('project: ' + yamlStr(pr.getString('name')));
  fm.push('created: ' + n.getString('created').slice(0, 10), 'updated: ' + n.getString('updated').slice(0, 10), '---', '');
  const lines = [];
  let num = 0;
  for (const b of util.jsonOf(n, 'blocks') || []) {
    if (b.type !== 'numbered') num = 0;
    if (b.type === 'paragraph') lines.push(b.text, '');
    else if (b.type === 'heading') lines.push('#'.repeat(b.level || 1) + ' ' + b.text, '');
    else if (b.type === 'bullet') lines.push('- ' + b.text);
    else if (b.type === 'numbered') lines.push(++num + '. ' + b.text);
    else if (b.type === 'todo') lines.push('- [' + (b.checked ? 'x' : ' ') + '] ' + b.text);
    else if (b.type === 'divider') lines.push('---', '');
    else if (b.type === 'quote') {
      const a = util.byId(app, 'anchors', b.anchor);
      if (a !== null) {
        const aw = util.byId(app, 'works', a.getString('work'));
        lines.push('> ' + a.getString('quote').replace(/\n/g, ' ') + ' (p. ' + a.getInt('page_no') + (aw !== null && aw.getString('citekey') !== '' ? ', [@' + aw.getString('citekey') + ']' : '') + ')', '');
        if (b.text) lines.push(b.text, '');
      }
    } else if (b.type === 'node') {
      const nd = util.byId(app, 'nodes', b.node);
      if (nd !== null) lines.push('**' + nd.getString('kind').charAt(0).toUpperCase() + nd.getString('kind').slice(1) + ':** ' + nd.getString('title'), '');
    } else if (b.type === 'cite') {
      const cw = util.byId(app, 'works', b.work);
      if (cw !== null) lines.push((b.text ? b.text + ' ' : '') + '[@' + (cw.getString('citekey') || cw.id) + (b.locator ? ', ' + b.locator : '') + ']', '');
    } else if (b.type === 'image') {
      const f = util.byId(app, 'note_files', b.file);
      if (f !== null) {
        const name = 'attachments/' + f.id + '-' + slug(f.getString('name').replace(/\.[^.]*$/, '')) + '.' + (f.getString('name').split('.').pop() || 'png').toLowerCase();
        if (attachments) attachments.push({ path: (dir ? dir + '/' : '') + name, file: f.id });
        lines.push('![' + String(b.caption || '').replace(/[\[\]]/g, '') + '](' + name + ')', '');
      }
    } else if (b.type === 'table' && Array.isArray(b.rows) && b.rows.length > 0) {
      const head = b.header !== false ? b.rows[0] : b.rows[0].map(() => '');
      const body = b.header !== false ? b.rows.slice(1) : b.rows;
      const rule = (j) => (Array.isArray(b.align) && b.align[j] === 'center' ? ' :---: ' : Array.isArray(b.align) && b.align[j] === 'right' ? ' ---: ' : ' --- ');
      lines.push('| ' + head.map(cell).join(' | ') + ' |', '|' + head.map((_, j) => rule(j)).join('|') + '|');
      for (const r of body) lines.push('| ' + r.map(cell).join(' | ') + ' |');
      lines.push('');
    }
  }
  return fm.join('\n') + lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/** A board as JSON Canvas 1.0. */
function boardCanvas(app, b) {
  const util = u();
  const items = app.findRecordsByFilter('board_items', 'board = {:b}', 'z', 0, 0, { b: b.id });
  const colors = { plain: undefined, red: '1', amber: '2', accent: '2', green: '4', teal: '5', blue: '5', violet: '6' };
  const nodes = [];
  const nodeOfItem = {};
  for (const it of items) {
    const kind = it.getString('ref_kind');
    let textValue = it.getString('text');
    if (kind === 'node') {
      const n = util.byId(app, 'nodes', it.getString('node'));
      if (n === null) continue;
      textValue = '**' + n.getString('kind') + '**\n\n' + n.getString('title');
      nodeOfItem[n.id] = it.id;
    } else if (kind === 'anchor') {
      const a = util.byId(app, 'anchors', it.getString('anchor'));
      if (a === null) continue;
      const w = util.byId(app, 'works', a.getString('work'));
      textValue = '> ' + a.getString('quote') + '\n\n' + (w !== null ? core().workLabel(w) : '') + ', p. ' + a.getInt('page_no');
    } else if (kind === 'work') {
      const w = util.byId(app, 'works', it.getString('work'));
      if (w === null) continue;
      textValue = '**' + w.getString('title') + '**\n\n' + core().workLabel(w);
    } else if (kind === 'note') {
      const n = util.byId(app, 'notes', it.getString('note'));
      if (n === null) continue;
      textValue = '**' + (n.getString('title') || 'Note') + '**\n\n' + n.getString('text').slice(0, 600);
    }
    const node = { id: it.id, type: kind === 'section' ? 'group' : 'text', x: Math.round(it.getFloat('x')), y: Math.round(it.getFloat('y')), width: Math.round(it.getFloat('w')), height: Math.round(it.getFloat('h')) };
    if (kind === 'section') node.label = textValue;
    else node.text = textValue;
    const c = colors[it.getString('color') || 'plain'];
    if (c) node.color = c;
    nodes.push(node);
  }
  const edges = [];
  for (const r of app.findRecordsByFilter('relations', "project = {:p} && status != 'researcher_rejected'", '', 0, 0, { p: b.getString('project') })) {
    const a = nodeOfItem[r.getString('from_node')];
    const c = nodeOfItem[r.getString('to_node')];
    if (a && c) edges.push({ id: r.id, fromNode: a, toNode: c, label: r.getString('kind'), toEnd: 'arrow' });
  }
  return { nodes: nodes, edges: edges };
}

/** export.notes: notes (Markdown) and boards (JSON Canvas) as files, for a project or everything. */
function notes(ctx, p) {
  const util = u();
  const app = ctx.app;
  let filter = '';
  const bind = {};
  let boardFilter = '';
  if (util.str(p, 'project', '') !== '') {
    const pr = core().project(app, util.str(p, 'project', ''));
    core().guardProject(ctx, pr);
    filter = 'project = {:p}';
    boardFilter = 'project = {:p}';
    bind.p = pr.id;
  } else if (ctx.isAgent) {
    filter = "(project = '' || project.confidentiality = 'normal')";
    boardFilter = "project.confidentiality = 'normal'";
  }
  const files = [];
  const used = {};
  const unique = (base) => {
    let name = base;
    let i = 2;
    while (used[name]) name = base.replace(/(\.[a-z]+)$/, '-' + i++ + '$1');
    used[name] = true;
    return name;
  };
  const attachments = [];
  for (const n of app.findRecordsByFilter('notes', filter, 'created', 0, 0, bind)) {
    const w = n.getString('work') !== '' ? util.byId(app, 'works', n.getString('work')) : null;
    const base = n.getString('kind') === 'literature' && w !== null ? 'papers/' + (w.getString('citekey') || slug(w.getString('title'))) : 'notes/' + slug(n.getString('title') || n.id);
    files.push({ path: unique(base + '.md'), content: noteMarkdown(app, n, attachments, base.split('/')[0]) });
  }
  for (const b of app.findRecordsByFilter('boards', boardFilter, 'created', 0, 0, bind)) {
    files.push({ path: unique('boards/' + slug(b.getString('name')) + '.canvas'), content: JSON.stringify(boardCanvas(app, b), null, 2) });
  }
  // Pictures go next to the notes (the page fetches each with notes.image and adds it to the zip).
  return { files: files, attachments: attachments, count: files.length };
}

module.exports = { scope: scope, works: works, notes: notes, noteMarkdown: noteMarkdown, boardCanvas: boardCanvas };
