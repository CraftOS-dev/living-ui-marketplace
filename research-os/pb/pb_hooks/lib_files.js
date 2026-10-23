/// <reference path="../pb_data/types.d.ts" />
/**
 * PDFs: uploads (people), attaching a local file (your AI agent), open-access
 * downloads, streaming to the reader, thumbnails, the reading position, and
 * the text worker that turns each PDF into the app's own text layer.
 *
 * The text layer: engine/pdftext.mjs runs pdf.js in Node (the library the
 * reader draws with) and writes each page's text and positioned items; the
 * worker stores them as `pages` and indexes them for search. A page without
 * text (a scan) waits for your AI agent to read it (pages.set-ocr).
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

const ENGINE_TIMEOUT_S = 600;

function fileOut(app, f) {
  return {
    id: f.id,
    work: f.getString('work'),
    name: f.getString('name'),
    bytes: f.getInt('bytes'),
    pages: f.getInt('pages'),
    version: f.getInt('version'),
    current: f.getBool('current'),
    text_state: f.getString('text_state'),
    text_error: f.getString('text_error'),
    pages_with_text: f.getInt('pages_with_text'),
    ocr_pages: f.getInt('ocr_pages'),
    has_thumb: f.getString('thumb') !== '',
    source: f.getString('source'),
    added_by: f.getString('added_by'),
    pos_page: f.getInt('pos_page'),
    pos_frac: f.getFloat('pos_frac'),
    max_page: f.getInt('max_page'),
    engine: f.getString('engine'),
    file_path: u().filePath(app, f, 'file'),
    created: f.getString('created'),
  };
}

/** Store one PDF on a paper (new current version). Returns the file record. */
function storeOn(tx, ctx, w, upload, name, source) {
  const util = u();
  const prev = tx.findRecordsByFilter('files', 'work = {:w}', '-version', 0, 0, { w: w.id });
  for (const pf of prev) {
    if (pf.getBool('current')) {
      pf.set('current', false);
      tx.save(pf);
    }
  }
  const f = util.newRecord(tx, 'files');
  f.set('work', w.id);
  f.set('file', upload);
  f.set('name', String(name || 'paper.pdf').slice(0, 400));
  f.set('bytes', Number(upload.size || 0));
  f.set('version', (prev.length > 0 ? prev[0].getInt('version') : 0) + 1);
  f.set('current', true);
  f.set('text_state', 'waiting');
  f.set('source', source);
  f.set('added_by', ctx.actor);
  f.set('outline', []);
  f.set('meta', {});
  tx.save(f);
  return f;
}

function baseName(name) {
  return String(name || 'paper.pdf')
    .replace(/^.*[\\/]/, '')
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .trim()
    .slice(0, 300);
}

function isPdfName(name) {
  return /\.pdf$/i.test(String(name || ''));
}

/**
 * files.upload: one or more PDFs. With --work they become that paper's PDF;
 * otherwise each becomes a new paper waiting to be identified (its text is
 * read first, then your AI agent is asked to identify it).
 */
function upload(ctx, p) {
  const util = u();
  const app = ctx.app;
  const uploads = ctx.e ? util.uploadedAll(ctx.e, 'file') : [];
  const items = uploads.map((f) => ({ file: f, name: f.originalName }));
  const path = util.str(p, 'path', '');
  if (path !== '') {
    const lf = util.localFile(ctx, path, 'path');
    items.push({ file: lf.file, name: $filepath.base(lf.path) });
  }
  if (items.length === 0) throw util.fail(400, 'Upload a PDF, or give --path "<absolute path of a PDF>".', 'missing_param');
  if (items.length > 200) throw util.fail(400, 'At most 200 files at once.', 'too_many');
  for (const it of items) if (!isPdfName(it.name)) throw util.fail(400, '"' + it.name + '" is not a PDF. Only PDF files are read.', 'not_pdf');
  const workRef = util.str(p, 'work', '');
  let target = null;
  if (workRef !== '') {
    target = core().work(app, workRef);
    core().guardWork(ctx, target);
    if (items.length > 1) throw util.fail(400, 'One PDF per paper: give one file with --work.', 'too_many');
  }
  const places = require(`${__hooks}/lib_works.js`);
  const collection = util.str(p, 'collection', '');
  const proj = util.str(p, 'project', '');
  let cid = '';
  let pid = '';
  if (collection !== '') cid = core().need(app, 'collections', collection, 'collection').id;
  if (proj !== '') {
    const pr = core().project(app, proj);
    core().guardProject(ctx, pr);
    pid = pr.id;
  }
  const source = ctx.isAgent ? 'agent_path' : 'upload';
  const out = [];
  const batch = util.token(12);
  ctx.batch = batch;
  app.runInTransaction((tx) => {
    const created = [];
    for (const it of items) {
      let w = target;
      if (w === null) {
        w = places.newWork(tx, ctx, { title: baseName(it.name) || 'Untitled PDF', resolution: 'pending', source: 'pdf' });
        tx.save(w);
        created.push(w.id);
      } else w = tx.findRecordById('works', w.id);
      const f = storeOn(tx, ctx, w, it.file, it.name, source);
      out.push({ work: w.id, file: f.id, name: it.name });
    }
    places.place(tx, ctx, out.map((o) => o.work), cid, pid);
    act().write(tx, ctx, {
      label: target !== null ? 'Added a PDF to "' + target.getString('title').slice(0, 80) + '"' : 'Added ' + (items.length === 1 ? '"' + items[0].name + '"' : items.length + ' PDFs'),
      target: 'files',
      record: out.length === 1 ? out[0].file : '',
      batch: batch,
      project: pid,
      undo: created.length > 0 ? { fn: 'lib_works.undoAdd', args: { ids: created } } : undefined,
    });
  });
  wake(app);
  return { added: out.map((o) => ({ work: require(`${__hooks}/lib_works.js`).rowOut(app.findRecordById('works', o.work)), file: fileOut(app, app.findRecordById('files', o.file)) })), batch: batch };
}

/* ---------------------------------------------------------- open access */

function looksPdf(bytesText) {
  return String(bytesText).slice(0, 5) === '%PDF-';
}

/**
 * files.fetch-oa: download a paper's open-access PDF (arXiv, or the open
 * copy the registry lists) and make it the paper's PDF.
 */
function fetchOa(ctx, p) {
  const util = u();
  const app = ctx.app;
  const w = core().work(app, util.req(p, 'work'));
  core().guardWork(ctx, w);
  let url = w.getString('oa_pdf_url');
  if (url === '' && w.getString('arxiv_id') !== '') url = 'https://arxiv.org/pdf/' + w.getString('arxiv_id');
  if (url === '') throw util.fail(409, 'No open-access PDF is listed for this paper. Ask your AI agent to find the full text, or add the PDF yourself.', 'no_open_access');
  let res;
  try {
    res = $http.send({ url: url, method: 'GET', headers: { 'User-Agent': 'ResearchOS/1.0', Accept: 'application/pdf' }, timeout: 90 });
  } catch (err) {
    console.error('[ro] oa download failed', url, String(err));
    throw util.fail(502, 'The open-access copy did not download (' + url + '). Try again later.', 'unreachable');
  }
  if (res.statusCode !== 200) throw util.fail(502, 'The open-access copy answered ' + res.statusCode + '. Ask your AI agent to find the full text instead.', 'unreachable');
  if (!looksPdf(toString(res.body).slice(0, 5))) throw util.fail(409, 'The open-access link is a web page, not a PDF. Ask your AI agent to find the full text.', 'not_pdf');
  const dir = $filepath.join(app.dataDir(), 'ro_tmp');
  $os.mkdirAll(dir, 0o755);
  const tmp = $filepath.join(dir, w.id + '_' + util.token(6) + '.pdf');
  $os.writeFile(tmp, res.body, 0o644);
  let f = null;
  try {
    const file = $filesystem.fileFromPath(tmp);
    const name = (w.getString('citekey') || w.id) + '.pdf';
    app.runInTransaction((tx) => {
      f = storeOn(tx, ctx, tx.findRecordById('works', w.id), file, name, 'oa_download');
      act().write(tx, ctx, { label: 'Downloaded the open-access PDF of "' + w.getString('title').slice(0, 80) + '"', target: 'files', record: f.id });
    });
  } finally {
    try {
      $os.remove(tmp);
    } catch {
      /* removed with the temp folder later */
    }
  }
  const done = app.findRecordById('works', w.id);
  if (done.getString('oa_fetch') !== 'done') {
    done.set('oa_fetch', 'done');
    app.save(done);
  }
  wake(app);
  return { file: fileOut(app, app.findRecordById('files', f.id)) };
}

/**
 * Open-access PDFs the settings ask for (oa_fetch = due): downloaded by the
 * resolver job, a few at a time, as the app itself. A paper that got a PDF
 * meanwhile is simply done; a failed download is left for the person or
 * your AI agent (the Paper pane still offers the open-access link).
 */
function oaDue(app, budgetMs) {
  const until = Date.now() + (budgetMs || 30000);
  const ctx = require(`${__hooks}/lib_auth.js`).system(app);
  let n = 0;
  while (Date.now() < until) {
    const list = app.findRecordsByFilter('works', "oa_fetch = 'due' && trashed = false", 'updated', 3, 0);
    if (list.length === 0) break;
    for (const w of list) {
      let state = 'done';
      if (core().currentFile(app, w.id) === null) {
        try {
          fetchOa(ctx, { work: w.id });
        } catch (err) {
          state = 'failed';
          console.log('[ro] open-access download skipped for ' + w.id + ': ' + String((err && err.message) || err).slice(0, 200));
        }
      }
      const fresh = app.findRecordById('works', w.id);
      fresh.set('oa_fetch', state);
      app.save(fresh);
      n++;
    }
  }
  return n;
}

/* ------------------------------------------------------------ streaming */

function streamField(ctx, f, field, mime, name, cache) {
  return streamName(ctx, f, f.getString(field), mime, name || f.getString(field), cache, true);
}

/** Stream one stored file of a record: shown in the page (inline) or downloaded, never sniffed as another type. */
function streamName(ctx, rec, stored, mime, name, cache, inline) {
  const key = rec.baseFilesPath() + '/' + stored;
  const fsys = ctx.app.newFilesystem();
  try {
    const reader = fsys.getReader(key);
    try {
      const safe = String(name || stored).replace(/["\\\r\n]/g, '_');
      ctx.e.response.header().set('Content-Disposition', (inline ? 'inline' : 'attachment') + '; filename="' + safe + '"');
      ctx.e.response.header().set('Cache-Control', cache);
      ctx.e.response.header().set('X-Content-Type-Options', 'nosniff');
      ctx.e.stream(200, mime, reader);
    } finally {
      reader.close();
    }
  } finally {
    fsys.close();
  }
  return { __streamed: true };
}

/** files.content: the PDF itself (the reader loads it). */
function content(ctx, p) {
  const util = u();
  const f = core().need(ctx.app, 'files', util.req(p, 'file'), 'file');
  core().guardWork(ctx, core().need(ctx.app, 'works', f.getString('work'), 'paper'));
  if (ctx.isAgent) return { file: fileOut(ctx.app, f) };
  return streamField(ctx, f, 'file', 'application/pdf', f.getString('name'), 'private, max-age=86400, immutable');
}

/** files.thumb: the first page as a small picture. */
function thumb(ctx, p) {
  const util = u();
  const f = core().need(ctx.app, 'files', util.req(p, 'file'), 'file');
  if (f.getString('thumb') === '') throw util.fail(404, 'No picture yet.', 'not_found');
  core().guardWork(ctx, core().need(ctx.app, 'works', f.getString('work'), 'paper'));
  // Your AI agent reads files from disk: it gets where the picture is, not its bytes.
  if (ctx.isAgent) return { file: fileOut(ctx.app, f), thumb_path: util.filePath(ctx.app, f, 'thumb') };
  const n = f.getString('thumb');
  const mime = /\.webp$/i.test(n) ? 'image/webp' : /\.jpe?g$/i.test(n) ? 'image/jpeg' : 'image/png';
  return streamField(ctx, f, 'thumb', mime, 'thumb', 'private, max-age=86400');
}

/** files.set-thumb: the reader uploads the first page it drew (a derived picture). */
function setThumb(ctx, p) {
  const util = u();
  const f = core().need(ctx.app, 'files', util.req(p, 'file'), 'file');
  const ups = ctx.e ? util.uploadedAll(ctx.e, 'thumb') : [];
  if (ups.length === 0) throw util.fail(400, 'Upload the picture in "thumb".', 'missing_param');
  f.set('thumb', ups[0]);
  ctx.app.save(f);
  return { ok: true };
}

/** files.position: where the person is reading (page and how far down it). */
function position(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = core().need(app, 'files', util.req(p, 'file'), 'file');
  const pageNo = util.int(p, 'page', 1, 1, 100000);
  const frac = util.num(p, 'frac', 0, 0, 1);
  f.set('pos_page', pageNo);
  f.set('pos_frac', frac);
  if (pageNo > f.getInt('max_page')) f.set('max_page', pageNo);
  app.save(f);
  const w = app.findRecordById('works', f.getString('work'));
  w.set('opened_at', util.nowIso());
  const total = f.getInt('pages');
  if (w.getString('read_state') === 'unread') w.set('read_state', 'reading');
  if (total > 0 && pageNo >= total && w.getString('read_state') !== 'read') {
    w.set('read_state', 'read');
    w.set('read_at', util.nowIso());
  }
  app.save(w);
  for (const pw of app.findRecordsByFilter('project_works', "work = {:w} && status = 'to_read'", '', 0, 0, { w: w.id })) {
    pw.set('status', 'reading');
    app.save(pw);
  }
  return { read_state: w.getString('read_state'), max_page: f.getInt('max_page') };
}

/** files.get: one file (and its outline). */
function get(ctx, p) {
  const util = u();
  const f = core().need(ctx.app, 'files', util.req(p, 'file'), 'file');
  core().guardWork(ctx, core().need(ctx.app, 'works', f.getString('work'), 'paper'));
  return Object.assign(fileOut(ctx.app, f), { outline: util.jsonOf(f, 'outline') || [], meta: util.jsonOf(f, 'meta') || {} });
}

/** files.delete: remove a PDF and the highlights and passages on it. */
function remove(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = core().need(app, 'files', util.req(p, 'file'), 'file');
  core().guardWork(ctx, core().need(app, 'works', f.getString('work'), 'paper'));
  const takes = util.one(app, 'SELECT (SELECT COUNT(*) FROM annotations WHERE file = {:f}) AS annotations, (SELECT COUNT(*) FROM anchors WHERE file = {:f}) AS passages', { annotations: 0, passages: 0 }, { f: f.id });
  if (util.bool(p, 'preview', false)) return { preview: true, takes: takes };
  app.runInTransaction((tx) => {
    const wasCurrent = f.getBool('current');
    require(`${__hooks}/lib_search.js`).dropFile(tx, f.id);
    tx.delete(tx.findRecordById('files', f.id));
    if (wasCurrent) {
      const rest = tx.findRecordsByFilter('files', 'work = {:w}', '-version', 1, 0, { w: f.getString('work') });
      if (rest.length > 0) {
        rest[0].set('current', true);
        tx.save(rest[0]);
      }
    }
    act().write(tx, ctx, { label: 'Removed the PDF ' + f.getString('name'), target: 'files', record: f.id, data: { detail: takes } });
  });
  return { deleted: true, took: takes };
}

function removePreview(ctx, p) {
  const util = u();
  const f = core().need(ctx.app, 'files', util.req(p, 'file'), 'file');
  const takes = util.one(ctx.app, 'SELECT (SELECT COUNT(*) FROM annotations WHERE file = {:f}) AS annotations, (SELECT COUNT(*) FROM anchors WHERE file = {:f}) AS passages', { annotations: 0, passages: 0 }, { f: f.id });
  return { kind: 'delete_file', title: 'Remove the PDF ' + f.getString('name'), summary: 'Removes ' + takes.annotations + ' highlights and ' + takes.passages + ' passages on it.', preview: { file: fileOut(ctx.app, f), takes: util.plain([takes])[0] }, target: { collection: 'files', id: f.id } };
}

/* ------------------------------------------------------------ the worker */

/**
 * Wake the text worker. When no worker loop is alive (the first minute after
 * a restart, before the minute job starts), read now, up to a few seconds,
 * so a dropped PDF never waits for the clock.
 */
function wake(app) {
  app.store().set('ro_text_wake', true);
  const alive = Number(app.store().get('ro_text_alive') || 0);
  if (Date.now() - alive > 3000) {
    try {
      drain(app, 8000);
    } catch (err) {
      console.error('[ro] inline text read failed:', err);
    }
  }
}

function lineSpans(textValue) {
  const out = [];
  let start = 0;
  for (let i = 0; i <= textValue.length; i++) {
    if (i === textValue.length || textValue.charAt(i) === '\n') {
      out.push([start, i]);
      start = i + 1;
    }
  }
  return out;
}

/** Run the text engine on one file and store its pages. */
function extract(app, f) {
  const util = u();
  const pdfPath = util.filePath(app, f, 'file');
  const dir = $filepath.join(app.dataDir(), 'ro_text');
  $os.mkdirAll(dir, 0o755);
  const outPath = $filepath.join(dir, f.id + '.json');
  try {
    $os.remove(outPath);
  } catch {
    /* none yet */
  }
  const script = $filepath.join(__hooks, '..', '..', 'engine', 'pdftext.mjs');
  let result = null;
  try {
    const cmd = $os.cmd('node', script, pdfPath, outPath, String(ENGINE_TIMEOUT_S));
    cmd.run();
    result = JSON.parse(toString($os.readFile(outPath)));
  } catch (err) {
    console.error('[ro] text engine failed', f.id, String(err));
    result = { ok: false, error: 'The text engine did not run: ' + String(err).slice(0, 300), code: 'engine' };
  }
  try {
    $os.remove(outPath);
  } catch {
    /* already gone */
  }
  if (!result || result.ok !== true) {
    const fr = app.findRecordById('files', f.id);
    fr.set('text_state', 'failed');
    fr.set('text_error', result && result.code === 'password' ? 'This PDF is password protected.' : result && result.code === 'invalid_pdf' ? 'This file is not a readable PDF.' : String((result && result.error) || 'Unknown error').slice(0, 2000));
    app.save(fr);
    return 'failed';
  }
  const search = require(`${__hooks}/lib_search.js`);
  let withText = 0;
  app.runInTransaction((tx) => {
    const fr = tx.findRecordById('files', f.id);
    const workId = fr.getString('work');
    const hasAnchors = util.count(tx, 'SELECT COUNT(*) AS n FROM anchors WHERE file = {:f}', { f: fr.id }) > 0;
    if (!hasAnchors) {
      for (const old of tx.findRecordsByFilter('pages', 'file = {:f}', '', 0, 0, { f: fr.id })) tx.delete(tx.findRecordById('pages', old.id));
      search.dropFile(tx, fr.id);
    }
    for (const pg of result.pages) {
      if (hasAnchors && util.findOne(tx, 'pages', 'file = {:f} && page_no = {:n}', { f: fr.id, n: pg.page_no }) !== null) continue;
      const rec = util.newRecord(tx, 'pages');
      rec.set('file', fr.id);
      rec.set('page_no', pg.page_no);
      rec.set('width', pg.width);
      rec.set('height', pg.height);
      rec.set('rotate', pg.rotate);
      rec.set('text', pg.text);
      rec.set('items', pg.items);
      rec.set('lines', lineSpans(pg.text));
      const chars = pg.text.replace(/\s/g, '').length;
      rec.set('origin', chars > 0 ? 'pdf_text' : 'none');
      rec.set('chars', chars);
      tx.save(rec);
      if (chars >= 30) withText++;
      search.indexPage(tx, rec, workId);
    }
    fr.set('sha256', String(result.sha256 || ''));
    fr.set('pages', result.numPages);
    fr.set('pages_with_text', withText);
    fr.set('engine', result.engine);
    fr.set('outline', result.outline || []);
    fr.set('meta', result.info || {});
    fr.set('text_state', withText === 0 && result.numPages > 0 ? 'needs_ocr' : 'ready');
    fr.set('text_error', '');
    tx.save(fr);
    // A waiting paper takes the PDF's own title (metadata) until it is identified.
    const w = tx.findRecordById('works', workId);
    const infoTitle = String((result.info && result.info.title) || '').trim();
    if (w.getString('resolution') === 'pending' && infoTitle.length >= 8 && infoTitle.length <= 400) {
      w.set('title', infoTitle);
      tx.save(w);
      search.indexWork(tx, w);
    }
  });
  if (sameFileElsewhere(app, app.findRecordById('files', f.id))) return 'duplicate';
  afterText(app, app.findRecordById('files', f.id));
  return 'ready';
}

/**
 * The same PDF (byte for byte) dropped in again as a new paper: the new
 * waiting paper goes and the existing paper keeps its file. Only a paper that
 * is still waiting to be identified, with nothing made on it, is removed.
 */
function sameFileElsewhere(app, f) {
  const util = u();
  const sha = f.getString('sha256');
  if (sha === '') return false;
  const w = app.findRecordById('works', f.getString('work'));
  if (w.getString('resolution') !== 'pending') return false;
  const other = util.one(app, 'SELECT f.work AS work FROM files f JOIN works w ON w.id = f.work WHERE f.sha256 = {:s} AND f.work != {:me} AND w.trashed = FALSE LIMIT 1', { work: '' }, { s: sha, me: w.id });
  if (other === null) return false;
  if (util.count(app, 'SELECT (SELECT COUNT(*) FROM annotations WHERE work = {:w}) + (SELECT COUNT(*) FROM notes WHERE work = {:w}) + (SELECT COUNT(*) FROM nodes WHERE work = {:w}) AS n', { w: w.id }) > 0) return false;
  const kept = app.findRecordById('works', other.work);
  app.runInTransaction((tx) => {
    // Its places (collections, projects) carry over to the paper already in the library.
    const places = require(`${__hooks}/lib_works.js`);
    const cols = tx.findRecordsByFilter('collection_items', 'work = {:w}', '', 0, 0, { w: w.id }).map((r) => r.getString('collection'));
    const projs = tx.findRecordsByFilter('project_works', 'work = {:w}', '', 0, 0, { w: w.id }).map((r) => r.getString('project'));
    for (const c of cols) places.place(tx, { actor: 'system', isAgent: false }, [kept.id], c, '');
    for (const pr of projs) places.place(tx, { actor: 'system', isAgent: false }, [kept.id], '', pr);
    require(`${__hooks}/lib_search.js`).dropWork(tx, w.id);
    tx.delete(tx.findRecordById('works', w.id));
    act().write(tx, require(`${__hooks}/lib_auth.js`).system(tx), { label: '"' + f.getString('name') + '" is already in your library as "' + kept.getString('title').slice(0, 80) + '"', target: 'works', record: kept.id });
  });
  return true;
}

/** After a file's text is stored: ask your AI agent to identify the paper, or to read scanned pages. */
function afterText(app, f) {
  const c = core();
  const pol = c.policy(app);
  const w = app.findRecordById('works', f.getString('work'));
  if (c.workHidden(app, w.id)) return;
  if (pol.auto_identify && w.getString('resolution') === 'pending' && w.getString('identify') === 'none') {
    w.set('identify', 'waiting');
    app.save(w);
    require(`${__hooks}/lib_agent.js`).ask(app, 'papers_waiting', {});
  }
  if (pol.auto_ocr && f.getString('text_state') === 'needs_ocr') require(`${__hooks}/lib_agent.js`).ask(app, 'ocr_requested', {});
}

/** The worker: extract waiting files one at a time until the budget runs out. */
function drain(app, budgetMs) {
  const until = Date.now() + (budgetMs || 50000);
  let n = 0;
  while (Date.now() < until) {
    const next = app.findRecordsByFilter('files', "text_state = 'waiting'", 'created', 1, 0);
    if (next.length === 0) break;
    const f = next[0];
    f.set('text_state', 'extracting');
    app.save(f);
    require(`${__hooks}/lib_bus.js`).flush(app);
    try {
      extract(app, f);
    } catch (err) {
      console.error('[ro] extract failed', f.id, err);
      const fr = app.findRecordById('files', f.id);
      fr.set('text_state', 'failed');
      fr.set('text_error', 'Reading the PDF failed: ' + String(err).slice(0, 500));
      app.save(fr);
    }
    n++;
    require(`${__hooks}/lib_bus.js`).flush(app);
  }
  return n;
}

/** files.retry-text: read a file's text again (after a failure). */
function retryText(ctx, p) {
  const util = u();
  const f = core().need(ctx.app, 'files', util.req(p, 'file'), 'file');
  if (f.getString('text_state') === 'extracting') throw util.fail(409, 'This file is being read right now.', 'busy');
  f.set('text_state', 'waiting');
  f.set('text_error', '');
  ctx.app.save(f);
  wake(ctx.app);
  return { file: fileOut(ctx.app, f) };
}

/** files.engine-test: check the text engine on this machine (Node and pdf.js). */
function engineTest(ctx) {
  let node = '';
  let error = '';
  try {
    node = toString($os.cmd('node', '--version').output()).trim();
  } catch (err) {
    error = 'Node was not found: ' + String(err).slice(0, 200);
  }
  let pdfjs = '';
  try {
    pdfjs = JSON.parse(toString($os.readFile($filepath.join(__hooks, '..', '..', 'frontend', 'node_modules', 'pdfjs-dist', 'package.json')))).version;
  } catch {
    error = error || 'pdf.js is not installed (frontend/node_modules).';
  }
  const waiting = u().count(ctx.app, "SELECT COUNT(*) AS n FROM files WHERE text_state IN ('waiting', 'extracting')");
  return { ok: error === '', node: node, pdfjs: pdfjs, error: error, waiting: waiting };
}

module.exports = {
  oaDue: oaDue,
  fileOut: fileOut,
  storeOn: storeOn,
  upload: upload,
  fetchOa: fetchOa,
  content: content,
  streamName: streamName,
  thumb: thumb,
  setThumb: setThumb,
  position: position,
  get: get,
  remove: remove,
  removePreview: removePreview,
  wake: wake,
  lineSpans: lineSpans,
  extract: extract,
  drain: drain,
  retryText: retryText,
  engineTest: engineTest,
};
