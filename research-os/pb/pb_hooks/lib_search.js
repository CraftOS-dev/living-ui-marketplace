/// <reference path="../pb_data/types.d.ts" />
/**
 * Full-text search over the library: three FTS5 tables kept in step by the
 * operations that write papers, pages and notes.
 *
 *   works_fts  title, authors, abstract, venue, keywords (one row per paper)
 *   pages_fts  the stored text of every PDF page
 *   notes_fts  note titles and text
 *
 * A query is what a person or your AI agent typed: each word is matched as a
 * prefix (quoted, so punctuation is never read as FTS syntax) and every word
 * must appear. Search is retrieval someone asked for; nothing else in the
 * app looks at text this way.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/** Words of a query as an FTS5 expression ('' when there is nothing to search). */
function expr(q) {
  const words = String(q || '')
    .replace(/["*^():{}[\]]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w !== '')
    .slice(0, 12);
  return words.map((w) => '"' + w + '"*').join(' ');
}

function authorsText(w) {
  const a = u().jsonOf(w, 'authors');
  if (!Array.isArray(a)) return '';
  return a.map((x) => [x.given, x.family, x.literal].filter(Boolean).join(' ')).join('; ');
}

function indexWork(app, w) {
  const util = u();
  util.exec(app, 'DELETE FROM works_fts WHERE work_id = {:id}', { id: w.id });
  if (w.getBool('trashed')) return;
  const kw = util.jsonOf(w, 'keywords');
  util.exec(app, 'INSERT INTO works_fts (work_id, title, authors, abstract, venue, keywords) VALUES ({:id}, {:t}, {:a}, {:ab}, {:v}, {:k})', {
    id: w.id,
    t: w.getString('title') + (w.getString('subtitle') !== '' ? ' ' + w.getString('subtitle') : ''),
    a: authorsText(w),
    ab: w.getString('abstract'),
    v: w.getString('container'),
    k: Array.isArray(kw) ? kw.join(' ') : '',
  });
}

function dropWork(app, workId) {
  const util = u();
  util.exec(app, 'DELETE FROM works_fts WHERE work_id = {:id}', { id: workId });
  util.exec(app, 'DELETE FROM pages_fts WHERE work_id = {:id}', { id: workId });
}

function indexPage(app, page, workId) {
  const util = u();
  util.exec(app, 'DELETE FROM pages_fts WHERE page_id = {:id}', { id: page.id });
  const body = page.getString('text');
  if (body === '') return;
  util.exec(app, 'INSERT INTO pages_fts (page_id, file_id, work_id, page_no, body) VALUES ({:id}, {:f}, {:w}, {:n}, {:b})', { id: page.id, f: page.getString('file'), w: workId, n: page.getInt('page_no'), b: body });
}

function dropFile(app, fileId) {
  u().exec(app, 'DELETE FROM pages_fts WHERE file_id = {:id}', { id: fileId });
}

/** Re-point a file's page rows at another paper (after a merge). */
function moveFile(app, fileId, workId) {
  u().exec(app, 'UPDATE pages_fts SET work_id = {:w} WHERE file_id = {:f}', { w: workId, f: fileId });
}

function indexNote(app, note) {
  const util = u();
  util.exec(app, 'DELETE FROM notes_fts WHERE note_id = {:id}', { id: note.id });
  util.exec(app, 'INSERT INTO notes_fts (note_id, title, body) VALUES ({:id}, {:t}, {:b})', { id: note.id, t: note.getString('title'), b: note.getString('text') });
}

function dropNote(app, noteId) {
  u().exec(app, 'DELETE FROM notes_fts WHERE note_id = {:id}', { id: noteId });
}

/** Paper ids matching a query, best first. */
function workIds(app, q, limit) {
  const e = expr(q);
  if (e === '') return [];
  return u()
    .rows(app, 'SELECT work_id AS id FROM works_fts WHERE works_fts MATCH {:q} ORDER BY bm25(works_fts, 0, 8, 4, 2, 2, 2) LIMIT {:n}', { id: '' }, { q: e, n: limit || 500 })
    .map((r) => r.id);
}

/** Paper ids whose PDF text matches, best page first (pages are read in rank order and grouped here). */
function fullTextWorkIds(app, q, limit) {
  const e = expr(q);
  if (e === '') return [];
  const rows = u().rows(app, 'SELECT work_id AS id FROM pages_fts WHERE pages_fts MATCH {:q} ORDER BY rank LIMIT 5000', { id: '' }, { q: e });
  const out = [];
  const seen = {};
  for (const r of rows) {
    if (seen[r.id]) continue;
    seen[r.id] = true;
    out.push(r.id);
    if (out.length >= (limit || 500)) break;
  }
  return out;
}

/** Matching pages with a short snippet, best first (inside one paper or file when given). */
function pageHits(app, q, opts) {
  const o = opts || {};
  const e = expr(q);
  if (e === '') return [];
  let where = 'pages_fts MATCH {:q}';
  const bind = { q: e, n: o.limit || 50 };
  if (o.file) {
    where += ' AND file_id = {:f}';
    bind.f = o.file;
  }
  if (o.work) {
    where += ' AND work_id = {:w}';
    bind.w = o.work;
  }
  return u().plain(
    u().rows(
      app,
      "SELECT page_id, file_id, work_id, CAST(page_no AS INTEGER) AS page_no, snippet(pages_fts, 4, '[[', ']]', ' ... ', 18) AS snippet FROM pages_fts WHERE " + where + ' ORDER BY ' + (o.byPage ? 'CAST(page_no AS INTEGER)' : 'bm25(pages_fts)') + ' LIMIT {:n}',
      { page_id: '', file_id: '', work_id: '', page_no: 0, snippet: '' },
      bind,
    ),
  );
}

function noteIds(app, q, limit) {
  const e = expr(q);
  if (e === '') return [];
  return u()
    .rows(app, 'SELECT note_id AS id FROM notes_fts WHERE notes_fts MATCH {:q} ORDER BY bm25(notes_fts, 0, 4, 1) LIMIT {:n}', { id: '' }, { q: e, n: limit || 200 })
    .map((r) => r.id);
}

module.exports = {
  expr: expr,
  indexWork: indexWork,
  dropWork: dropWork,
  indexPage: indexPage,
  dropFile: dropFile,
  moveFile: moveFile,
  indexNote: indexNote,
  dropNote: dropNote,
  workIds: workIds,
  fullTextWorkIds: fullTextWorkIds,
  pageHits: pageHits,
  noteIds: noteIds,
};
