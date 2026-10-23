/// <reference path="../pb_data/types.d.ts" />
/**
 * Papers (works): adding by identifier, resolving against the registries,
 * identifying PDFs, listing and filtering, editing, trash, merge and the
 * duplicates view.
 *
 * A paper is citable when its identifier resolved (`resolution = resolved`)
 * or a person entered it by hand (`manual`, people only). A PDF dropped in
 * without an identifier is `pending` until someone identifies it; your AI
 * agent's identification is marked `identity = agent_proposed` until a
 * person confirms it.
 */

const FIELDS = ['type', 'title', 'subtitle', 'authors', 'editors', 'year', 'issued', 'container', 'container_short', 'volume', 'issue', 'pages', 'article_number', 'publisher', 'place', 'edition', 'isbn', 'issn', 'abstract', 'url', 'language', 'keywords'];
const TYPES = ['article', 'preprint', 'conference', 'book', 'chapter', 'thesis', 'report', 'dataset', 'software', 'webpage', 'other'];
const RESOLVE_INLINE = 5;

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function act() {
  return require(`${__hooks}/lib_activity.js`);
}
function search() {
  return require(`${__hooks}/lib_search.js`);
}

/* ------------------------------------------------------------ outputs */

function idsOf(w) {
  return { doi: w.getString('doi'), arxiv_id: w.getString('arxiv_id'), pmid: w.getString('pmid'), pmcid: w.getString('pmcid'), isbn: w.getString('isbn'), openalex_id: w.getString('openalex_id') };
}

/** The full record of one paper (detail pages and your AI agent). */
function detail(app, w) {
  const util = u();
  const c = core();
  const file = c.currentFile(app, w.id);
  const tags = util.plain(util.rows(app, 'SELECT t.id, t.name, t.color_slot FROM work_tags wt JOIN tags t ON t.id = wt.tag WHERE wt.work = {:w} ORDER BY t.name', { id: '', name: '', color_slot: 0 }, { w: w.id }));
  const cols = util.plain(util.rows(app, 'SELECT c.id, c.name FROM collection_items ci JOIN collections c ON c.id = ci.collection WHERE ci.work = {:w} ORDER BY c.name', { id: '', name: '' }, { w: w.id }));
  const projects = util.plain(util.rows(app, 'SELECT p.id, p.name, p.color, p.confidentiality, pw.status, pw.role FROM project_works pw JOIN projects p ON p.id = pw.project WHERE pw.work = {:w} ORDER BY p.name', { id: '', name: '', color: '', confidentiality: '', status: '', role: '' }, { w: w.id }));
  const files = app.findRecordsByFilter('files', 'work = {:w}', '-version', 0, 0, { w: w.id }).map((f) => require(`${__hooks}/lib_files.js`).fileOut(app, f));
  const counts = util.one(
    app,
    'SELECT (SELECT COUNT(*) FROM annotations WHERE work = {:w}) AS annotations, (SELECT COUNT(*) FROM notes WHERE work = {:w}) AS notes, (SELECT COUNT(*) FROM nodes WHERE work = {:w}) AS nodes, (SELECT COUNT(*) FROM work_refs WHERE work = {:w}) AS refs',
    { annotations: 0, notes: 0, nodes: 0, refs: 0 },
    { w: w.id },
  );
  const marks = util.plain(util.rows(app, "SELECT field, confidence, reason, actor FROM field_marks WHERE target = 'works' AND record = {:w}", { field: '', confidence: '', reason: '', actor: '' }, { w: w.id }));
  const out = rowOut(w);
  return Object.assign(out, {
    subtitle: w.getString('subtitle'),
    authors: c.authorsOf(w),
    editors: util.jsonOf(w, 'editors') || [],
    issued: w.getString('issued'),
    container_short: w.getString('container_short'),
    volume: w.getString('volume'),
    issue: w.getString('issue'),
    pages: w.getString('pages'),
    article_number: w.getString('article_number'),
    publisher: w.getString('publisher'),
    place: w.getString('place'),
    edition: w.getString('edition'),
    isbn: w.getString('isbn'),
    issn: w.getString('issn'),
    abstract: w.getString('abstract'),
    url: w.getString('url'),
    language: w.getString('language'),
    keywords: util.jsonOf(w, 'keywords') || [],
    identifiers: idsOf(w),
    resolved_via: w.getString('resolved_via'),
    resolve_error: w.getString('resolve_error'),
    identify_note: w.getString('identify_note'),
    integrity_detail: util.jsonOf(w, 'integrity_detail'),
    integrity_at: w.getString('integrity_at'),
    oa_url: w.getString('oa_url'),
    oa_pdf_url: w.getString('oa_pdf_url'),
    oa_fetch: w.getString('oa_fetch'),
    oa_status: w.getString('oa_status'),
    refs_count: w.getInt('refs_count'),
    rating: w.getInt('rating'),
    edited: util.jsonOf(w, 'edited') || [],
    extra: util.jsonOf(w, 'extra') || {},
    tags: tags,
    collections: cols,
    projects: projects,
    files: files,
    file: file !== null ? require(`${__hooks}/lib_files.js`).fileOut(app, file) : null,
    counts: counts,
    marks: marks,
    read_at: w.getString('read_at'),
    opened_at: w.getString('opened_at'),
    trashed_at: w.getString('trashed_at'),
  });
}

/** A paper as one list row. */
function rowOut(w) {
  const c = core();
  const authors = c.authorsOf(w);
  return {
    id: w.id,
    title: w.getString('title'),
    authors_short: c.authorsShort(authors),
    authors_n: authors.length,
    year: w.getInt('year'),
    container: w.getString('container'),
    type: w.getString('type'),
    citekey: w.getString('citekey'),
    doi: w.getString('doi'),
    arxiv_id: w.getString('arxiv_id'),
    pmid: w.getString('pmid'),
    resolution: w.getString('resolution'),
    identity: w.getString('identity'),
    identify: w.getString('identify'),
    integrity: w.getString('integrity'),
    read_state: w.getString('read_state'),
    starred: w.getBool('starred'),
    cited_by: w.getInt('cited_by'),
    added_by: w.getString('added_by'),
    source: w.getString('source'),
    trashed: w.getBool('trashed'),
    citable: c.citable(w),
    label: c.workLabel(w),
    created: w.getString('created'),
    updated: w.getString('updated'),
  };
}

/* ------------------------------------------------------------- citekeys */

function asciiFold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '');
}

/** authorYEARword, unique (a, b, c... appended when taken). */
function makeCitekey(app, w) {
  const c = core();
  const authors = c.authorsOf(w);
  let head = asciiFold(authors.length > 0 ? c.familyOf(authors[0]) : '').toLowerCase();
  if (head === '') head = 'anon';
  const year = w.getInt('year') > 0 ? String(w.getInt('year')) : 'nd';
  const word = String(w.getString('title'))
    .split(/\s+/)
    .map(asciiFold)
    .find((x) => x.length > 3);
  const base = head + year + (word ? word.toLowerCase() : '');
  let key = base;
  for (let i = 0; i < 26 * 27; i++) {
    const taken = u().count(app, 'SELECT COUNT(*) AS n FROM works WHERE LOWER(citekey) = LOWER({:k}) AND id != {:id}', { k: key, id: w.id });
    if (taken === 0) return key;
    const n = i + 1;
    key = base + (n <= 26 ? String.fromCharCode(96 + n) : String.fromCharCode(96 + Math.floor((n - 1) / 26)) + String.fromCharCode(97 + ((n - 1) % 26)));
  }
  return base + w.id.slice(0, 4);
}

/* ------------------------------------------------------------- resolving */

function idColumn(kind) {
  return { doi: 'doi', arxiv: 'arxiv_id', pmid: 'pmid', pmcid: 'pmcid', isbn: 'isbn', openalex: 'openalex_id' }[kind] || '';
}

/** The paper that already has this identifier (null when none). */
function byIdentifier(app, ident) {
  const col = idColumn(ident.kind);
  if (col === '') return null;
  return u().findOne(app, 'works', col + ' = {:v}', { v: ident.value });
}

/** Apply registry metadata to a paper, keeping every field a person edited. */
function applyMeta(app, w, meta, via) {
  const util = u();
  const edited = util.jsonOf(w, 'edited') || [];
  const keep = (f) => edited.indexOf(f) >= 0;
  const setIf = (field, value) => {
    if (keep(field)) return;
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value === '' && w.getString(field) !== '') return;
    w.set(field, value);
  };
  setIf('type', TYPES.indexOf(meta.type) >= 0 ? meta.type : 'other');
  if (meta.title !== '') setIf('title', meta.title.slice(0, 2000));
  setIf('subtitle', meta.subtitle.slice(0, 1000));
  if (meta.authors.length > 0) setIf('authors', meta.authors);
  if (meta.editors.length > 0) setIf('editors', meta.editors);
  if (meta.year > 0) setIf('year', meta.year);
  setIf('issued', meta.issued);
  setIf('container', meta.container.slice(0, 1000));
  setIf('container_short', meta.container_short.slice(0, 300));
  setIf('volume', meta.volume.slice(0, 60));
  setIf('issue', meta.issue.slice(0, 60));
  setIf('pages', meta.pages.slice(0, 80));
  setIf('article_number', meta.article_number.slice(0, 60));
  setIf('publisher', meta.publisher.slice(0, 500));
  setIf('place', meta.place.slice(0, 300));
  setIf('edition', meta.edition.slice(0, 60));
  setIf('issn', meta.issn.slice(0, 60));
  setIf('abstract', meta.abstract.slice(0, 40000));
  setIf('url', meta.url.slice(0, 2000));
  setIf('language', meta.language.slice(0, 30));
  if (meta.keywords.length > 0) setIf('keywords', meta.keywords);
  if (meta.cited_by > 0) w.set('cited_by', meta.cited_by);
  if (meta.refs_count > 0) w.set('refs_count', meta.refs_count);
  if (meta.oa_url !== '') w.set('oa_url', meta.oa_url.slice(0, 2000));
  if (meta.oa_pdf_url !== '') w.set('oa_pdf_url', meta.oa_pdf_url.slice(0, 2000));
  if (meta.oa_status !== '') w.set('oa_status', meta.oa_status.slice(0, 30));
  // Identifiers a registry adds are set only when no other paper has them.
  const addId = (field, value) => {
    if (value === '' || w.getString(field) !== '') return;
    const other = util.findOne(app, 'works', field + ' = {:v} && id != {:id}', { v: value, id: w.id });
    if (other === null) w.set(field, value);
    else {
      const extra = util.jsonOf(w, 'extra') || {};
      extra['same_' + field] = other.id;
      w.set('extra', extra);
    }
  };
  addId('doi', meta.doi);
  addId('pmid', meta.pmid);
  addId('pmcid', meta.pmcid);
  if (meta.openalex_id !== '' && w.getString('openalex_id') === '') w.set('openalex_id', meta.openalex_id);
  if (meta.isbn !== '' && w.getString('isbn') === '') w.set('isbn', meta.isbn);
  if (meta.related_doi) {
    const extra = util.jsonOf(w, 'extra') || {};
    extra.journal_doi = meta.related_doi;
    if (meta.journal_ref) extra.journal_ref = meta.journal_ref;
    w.set('extra', extra);
  }
  if (meta.integrity) {
    w.set('integrity', meta.integrity.state);
    w.set('integrity_detail', meta.integrity);
    w.set('integrity_at', util.nowIso());
  }
  w.set('registry', { source: meta.source, at: util.nowIso() });
  w.set('resolution', 'resolved');
  w.set('resolved_via', via);
  w.set('resolve_error', '');
  w.set('retry_at', '');
}

/** Store a paper's reference list (from Crossref, or OpenAlex ids) when it has none yet. */
function storeRefs(app, w, meta) {
  const util = u();
  if (util.count(app, 'SELECT COUNT(*) AS n FROM work_refs WHERE work = {:w}', { w: w.id }) > 0) return;
  const list = meta.references && meta.references.length > 0 ? meta.references : [];
  let pos = 0;
  for (const r of list) {
    const rec = util.newRecord(app, 'work_refs');
    rec.set('work', w.id);
    rec.set('position', pos++);
    rec.set('raw', String(r.raw || '').slice(0, 4000));
    rec.set('doi', String(r.doi || '').slice(0, 300));
    rec.set('title', String(r.title || '').slice(0, 2000));
    rec.set('year', r.year || 0);
    rec.set('authors', String(r.authors || '').slice(0, 1000));
    rec.set('venue', String(r.venue || '').slice(0, 1000));
    rec.set('source', 'crossref');
    if (r.doi) {
      const hit = util.findOne(app, 'works', 'doi = {:d}', { d: r.doi });
      if (hit !== null) rec.set('resolved_work', hit.id);
    }
    app.save(rec);
  }
}

/**
 * Resolve one paper against the registry its identifier belongs to, then
 * enrich from OpenAlex (open access, citations) once. Saves the paper.
 * Returns 'resolved' | 'not_found' | 'unreachable' | 'skipped'.
 */
function resolveOne(app, w) {
  const util = u();
  const reg = require(`${__hooks}/lib_registry.js`);
  let meta = null;
  let via = '';
  try {
    if (w.getString('doi') !== '') {
      meta = reg.crossrefWork(app, w.getString('doi'));
      via = 'crossref';
      if (meta === null) {
        meta = reg.openalexWork(app, 'doi:' + w.getString('doi'));
        via = 'openalex';
      }
    } else if (w.getString('arxiv_id') !== '') {
      const list = reg.arxivWorks(app, [w.getString('arxiv_id')]);
      meta = list.length > 0 ? list[0] : null;
      via = 'arxiv';
    } else if (w.getString('pmid') !== '') {
      const list = reg.pubmedWorks(app, [w.getString('pmid')]);
      meta = list.length > 0 ? list[0] : null;
      via = 'pubmed';
    } else if (w.getString('pmcid') !== '') {
      meta = reg.openalexWork(app, 'pmcid:' + w.getString('pmcid'));
      via = 'openalex';
    } else if (w.getString('openalex_id') !== '') {
      meta = reg.openalexWork(app, w.getString('openalex_id'));
      via = 'openalex';
    } else if (w.getString('isbn') !== '') {
      meta = reg.openlibraryIsbn(app, w.getString('isbn'));
      via = 'openlibrary';
    } else {
      return 'skipped';
    }
  } catch (err) {
    if (err && err.code === 'unreachable') {
      const attempts = w.getInt('resolve_attempts') + 1;
      w.set('resolve_attempts', attempts);
      w.set('resolution', 'unreachable');
      w.set('resolve_error', String(err.message).slice(0, 1000));
      w.set('retry_at', new Date(Date.now() + Math.min(6 * 3600, 60 * Math.pow(2, attempts)) * 1000).toISOString());
      app.save(w);
      return 'unreachable';
    }
    throw err;
  }
  if (meta === null) {
    w.set('resolution', 'not_found');
    w.set('resolve_error', 'The registry has no record for this identifier.');
    app.save(w);
    return 'not_found';
  }
  applyMeta(app, w, meta, via);
  // One OpenAlex call adds open access, citation counts and the OpenAlex id when the first registry was not OpenAlex.
  if (via !== 'openalex' && w.getString('openalex_id') === '' && (w.getString('doi') !== '' || w.getString('pmid') !== '')) {
    try {
      const extra = reg.openalexWork(app, w.getString('doi') !== '' ? 'doi:' + w.getString('doi') : 'pmid:' + w.getString('pmid'));
      if (extra !== null) {
        if (w.getString('abstract') === '' && extra.abstract !== '') w.set('abstract', extra.abstract.slice(0, 40000));
        if (extra.openalex_id !== '') w.set('openalex_id', extra.openalex_id);
        if (extra.cited_by > w.getInt('cited_by')) w.set('cited_by', extra.cited_by);
        if (w.getString('oa_url') === '' && extra.oa_url !== '') w.set('oa_url', extra.oa_url.slice(0, 2000));
        if (w.getString('oa_pdf_url') === '' && extra.oa_pdf_url !== '') w.set('oa_pdf_url', extra.oa_pdf_url.slice(0, 2000));
        if (extra.oa_status !== '') w.set('oa_status', extra.oa_status);
        if (extra.integrity && extra.integrity.state === 'retracted' && w.getString('integrity') !== 'retracted') {
          w.set('integrity', 'retracted');
          w.set('integrity_detail', extra.integrity);
        }
      }
    } catch {
      /* enrichment is optional; the next refresh tries again */
    }
  }
  if (w.getString('integrity') === 'unchecked' && via === 'crossref') w.set('integrity', 'clear');
  if (w.getString('citekey') === '' || (util.jsonOf(w, 'edited') || []).indexOf('citekey') < 0) w.set('citekey', makeCitekey(app, w));
  // Settings: download the open-access PDF of a paper added without one (the resolver job fetches it).
  if (w.getString('oa_fetch') === '' && (w.getString('oa_pdf_url') !== '' || w.getString('arxiv_id') !== '') && core().policy(app).auto_oa && core().currentFile(app, w.id) === null) {
    w.set('oa_fetch', 'due');
    app.store().set('ro_resolve_wake', true);
  }
  app.save(w);
  storeRefs(app, w, meta);
  search().indexWork(app, w);
  linkRefsTo(app, w);
  return 'resolved';
}

/** Point other papers' reference lists at this paper when they cite its DOI. */
function linkRefsTo(app, w) {
  if (w.getString('doi') === '') return;
  u().exec(app, "UPDATE work_refs SET resolved_work = {:w} WHERE doi = {:d} AND (resolved_work = '' OR resolved_work IS NULL)", { w: w.id, d: w.getString('doi') });
}

/* --------------------------------------------------------------- adding */

function newWork(app, ctx, fields) {
  const util = u();
  const w = util.newRecord(app, 'works');
  w.set('type', 'other');
  w.set('authors', []);
  w.set('keywords', []);
  w.set('edited', []);
  w.set('extra', {});
  w.set('resolution', 'pending');
  w.set('identity', ctx.isAgent ? 'agent_proposed' : 'researcher_confirmed');
  w.set('identify', 'none');
  w.set('integrity', 'unchecked');
  w.set('read_state', 'unread');
  w.set('added_by', ctx.actor);
  w.set('source', 'identifier');
  for (const k of Object.keys(fields)) w.set(k, fields[k]);
  return w;
}

/** Put papers into a collection and/or project (ids already checked). */
function place(app, ctx, workIds, collectionId, projectId) {
  const util = u();
  for (const id of workIds) {
    if (collectionId !== '' && util.findOne(app, 'collection_items', 'collection = {:c} && work = {:w}', { c: collectionId, w: id }) === null) {
      const ci = util.newRecord(app, 'collection_items');
      ci.set('collection', collectionId);
      ci.set('work', id);
      app.save(ci);
    }
    if (projectId !== '' && util.findOne(app, 'project_works', 'project = {:p} && work = {:w}', { p: projectId, w: id }) === null) {
      const pw = util.newRecord(app, 'project_works');
      pw.set('project', projectId);
      pw.set('work', id);
      pw.set('role', 'core');
      pw.set('status', 'to_read');
      pw.set('added_by', ctx.actor);
      app.save(pw);
    }
  }
}

function targets(ctx, p) {
  const util = u();
  const collection = util.str(p, 'collection', '');
  const proj = util.str(p, 'project', '');
  let cid = '';
  let pid = '';
  if (collection !== '') cid = core().need(ctx.app, 'collections', collection, 'collection').id;
  if (proj !== '') {
    const pr = core().project(ctx.app, proj);
    core().guardProject(ctx, pr);
    pid = pr.id;
  }
  return { collection: cid, project: pid };
}

/**
 * works.add: papers by identifier (one or many, any mix). Each one fills in
 * from its registry: the first few right away, the rest in the background.
 */
function add(ctx, p) {
  const util = u();
  const app = ctx.app;
  const parsed = require(`${__hooks}/lib_ident.js`).parseMany(util.text(p, 'ids', 20000, ''));
  if (parsed.ok.length === 0) {
    throw util.fail(400, parsed.bad.length > 0 ? 'Not an identifier: ' + parsed.bad.slice(0, 5).join(', ') + '. Give ' + require(`${__hooks}/lib_ident.js`).FORMATS + '.' : 'Give one or more identifiers in --ids: ' + require(`${__hooks}/lib_ident.js`).FORMATS + '.', parsed.bad.length > 0 ? 'not_an_identifier' : 'missing_param', { bad: parsed.bad });
  }
  if (parsed.ok.length > 500) throw util.fail(400, 'At most 500 identifiers at once.', 'too_many');
  const where = targets(ctx, p);
  const added = [];
  const existing = [];
  const batch = util.token(12);
  ctx.batch = batch;
  app.runInTransaction((tx) => {
    for (const ident of parsed.ok) {
      const hit = byIdentifier(tx, ident);
      if (hit !== null && !(ident.kind === 'isbn' && hit.getString('type') === 'chapter')) {
        existing.push({ id: hit.id, title: hit.getString('title'), trashed: hit.getBool('trashed'), identifier: ident.display });
        continue;
      }
      const w = newWork(tx, ctx, { title: ident.display, resolution: 'resolving', source: util.oneOf(p, 'source', ['identifier', 'search', 'feed', 'citation_map', 'references'], 'identifier') });
      w.set(idColumn(ident.kind), ident.value);
      tx.save(w);
      added.push(w.id);
    }
    place(tx, ctx, added.concat(existing.filter((e) => !e.trashed).map((e) => e.id)), where.collection, where.project);
    if (added.length > 0) {
      act().write(tx, ctx, {
        label: 'Added ' + (added.length === 1 ? parsed.ok[0].display : added.length + ' papers by identifier'),
        target: 'works',
        record: added.length === 1 ? added[0] : '',
        batch: batch,
        project: where.project,
        undo: { fn: 'lib_works.undoAdd', args: { ids: added } },
        data: { detail: { count: added.length } },
      });
    }
  });
  // Resolve the first few now (the caller sees their titles), the rest in the background.
  const results = [];
  for (let i = 0; i < added.length; i++) {
    const w = app.findRecordById('works', added[i]);
    if (i < RESOLVE_INLINE) {
      try {
        resolveOne(app, w);
      } catch (err) {
        console.error('[ro] resolve failed', w.id, err);
      }
    }
    results.push(rowOut(app.findRecordById('works', added[i])));
  }
  if (added.length > RESOLVE_INLINE) wakeResolver(app);
  return { added: results, existing: existing, not_identifiers: parsed.bad, batch: batch };
}

function undoAdd(ctx, args) {
  const app = ctx.app;
  app.runInTransaction((tx) => {
    for (const id of args.ids || []) {
      const w = u().byId(tx, 'works', id);
      if (w === null) continue;
      search().dropWork(tx, id);
      tx.delete(tx.findRecordById('works', id));
    }
  });
}

/** works.manual: a paper entered by hand (people only), citable as entered. */
function manual(ctx, p) {
  const util = u();
  const app = ctx.app;
  const title = util.text(p, 'title', 2000, '');
  if (title === '') throw util.fail(400, 'title is required', 'missing_param', { param: 'title' });
  const where = targets(ctx, p);
  let w = null;
  app.runInTransaction((tx) => {
    w = newWork(tx, ctx, { title: title, resolution: 'manual', resolved_via: 'manual', source: 'manual', identity: 'researcher_confirmed' });
    setFields(tx, w, p, false);
    w.set('citekey', makeCitekey(tx, w));
    tx.save(w);
    place(tx, ctx, [w.id], where.collection, where.project);
    search().indexWork(tx, w);
    act().write(tx, ctx, { label: 'Entered ' + title.slice(0, 120), target: 'works', record: w.id, project: where.project });
  });
  return { work: detail(app, app.findRecordById('works', w.id)) };
}

/* ---------------------------------------------------------- the worker */

function wakeResolver(app) {
  app.store().set('ro_resolve_wake', true);
}

/** Resolve waiting papers and retry unreachable ones whose time came (the cron worker calls this). */
function resolveDue(app, budgetMs) {
  const util = u();
  const until = Date.now() + (budgetMs || 50000);
  let n = 0;
  while (Date.now() < until) {
    const now = util.nowIso();
    const list = app.findRecordsByFilter('works', "trashed = false && (resolution = 'resolving' || (resolution = 'unreachable' && retry_at != '' && retry_at <= {:now}))", 'updated', 5, 0, { now: now });
    if (list.length === 0) break;
    for (const w of list) {
      try {
        resolveOne(app, w);
      } catch (err) {
        console.error('[ro] resolve failed', w.id, err);
        w.set('resolution', 'unreachable');
        w.set('retry_at', new Date(Date.now() + 3600 * 1000).toISOString());
        app.save(w);
      }
      n++;
      require(`${__hooks}/lib_bus.js`).flush(app);
    }
  }
  return n;
}

/* ------------------------------------------------------------ identify */

/**
 * works.identify: give a waiting paper (a PDF without metadata) its
 * identifier. The registry fills the metadata. When another paper already
 * has that identifier, the PDF moves to it and the waiting paper goes.
 * Your AI agent's identification is marked for a person to confirm.
 */
function identify(ctx, p) {
  const util = u();
  const app = ctx.app;
  const w = core().work(app, util.req(p, 'work'));
  core().guardWork(ctx, w);
  const ident = require(`${__hooks}/lib_ident.js`).parse(util.req(p, 'identifier', '10.1038/nature14539'));
  if (ident === null) throw util.fail(400, 'Not an identifier. Give ' + require(`${__hooks}/lib_ident.js`).FORMATS + '.', 'not_an_identifier');
  const other = byIdentifier(app, ident);
  if (other !== null && other.id !== w.id) {
    if (w.getString('resolution') === 'resolved' || w.getString('resolution') === 'manual') {
      throw util.fail(409, 'Another paper already has ' + ident.display + ' ("' + other.getString('title').slice(0, 80) + '"). Merge the two instead.', 'already_exists', { work: other.id });
    }
    const moved = mergeInto(app, ctx, other, [w], {});
    return { merged_into: rowOut(app.findRecordById('works', other.id)), moved: moved };
  }
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('works', w.id);
    for (const f of ['doi', 'arxiv_id', 'pmid', 'pmcid', 'isbn', 'openalex_id']) if (!(r.getString('resolution') === 'resolved' && r.getString(f) !== '')) r.set(f, '');
    r.set(idColumn(ident.kind), ident.value);
    r.set('resolution', 'resolving');
    r.set('identify', 'none');
    r.set('identify_note', '');
    r.set('identity', ctx.isAgent ? 'agent_proposed' : 'researcher_confirmed');
    tx.save(r);
    act().write(tx, ctx, { label: 'Identified "' + r.getString('title').slice(0, 80) + '" as ' + ident.display, target: 'works', record: r.id });
  });
  const fresh = app.findRecordById('works', w.id);
  let outcome = 'resolving';
  try {
    outcome = resolveOne(app, fresh);
  } catch (err) {
    console.error('[ro] resolve failed', w.id, err);
  }
  return { work: rowOut(app.findRecordById('works', w.id)), outcome: outcome };
}

/** works.identify-start: your AI agent says it is reading this paper to identify it. */
function identifyStart(ctx, p) {
  const util = u();
  const w = core().work(ctx.app, util.req(p, 'work'));
  core().guardWork(ctx, w);
  w.set('identify', 'working');
  ctx.app.save(w);
  return { work: rowOut(w) };
}

/** works.identify-fail: the paper could not be identified (your AI agent says why). */
function identifyFail(ctx, p) {
  const util = u();
  const w = core().work(ctx.app, util.req(p, 'work'));
  core().guardWork(ctx, w);
  w.set('identify', 'failed');
  w.set('identify_note', util.text(p, 'reason', 2000, ''));
  ctx.app.save(w);
  return { work: rowOut(w) };
}

/** works.confirm-identity: a person confirms your AI agent's identification. */
function confirmIdentity(ctx, p) {
  const util = u();
  const list = util.ids(p, 'works', 500);
  if (list.length === 0) throw util.fail(400, 'Give --works with one or more paper ids.', 'missing_param');
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    for (const id of list) {
      const w = core().need(tx, 'works', id, 'paper');
      if (w.getString('identity') === 'researcher_confirmed') continue;
      w.set('identity', 'researcher_confirmed');
      tx.save(w);
      n++;
    }
    if (n > 0) act().write(tx, ctx, { label: 'Confirmed the identification of ' + (n === 1 ? 'a paper' : n + ' papers'), target: 'works', record: list.length === 1 ? list[0] : '' });
  });
  return { confirmed: n };
}

/* --------------------------------------------------------------- update */

function personList(raw, name) {
  const util = u();
  let v = raw;
  if (typeof v === 'string') {
    if (v.trim() === '') return [];
    try {
      v = JSON.parse(v);
    } catch {
      throw util.fail(400, name + ' must be a JSON list like [{"family":"Curie","given":"Marie"}]', 'invalid_param', { param: name });
    }
  }
  if (!Array.isArray(v)) throw util.fail(400, name + ' must be a list', 'invalid_param', { param: name });
  return v.slice(0, 2000).map((a, i) => {
    util.keysOnly(a, ['family', 'given', 'literal', 'orcid'], name + ' item ' + (i + 1));
    const out = {};
    for (const k of ['family', 'given', 'literal', 'orcid']) if (typeof a[k] === 'string' && a[k].trim() !== '') out[k] = a[k].trim().slice(0, 300);
    if (!out.family && !out.literal) throw util.fail(400, name + ' item ' + (i + 1) + ' needs family or literal', 'invalid_param', { param: name });
    return out;
  });
}

/** Copy the editable fields present in p onto w. Returns the fields that changed. */
function setFields(app, w, p, track) {
  const util = u();
  const changed = [];
  const set = (f, v) => {
    const before = JSON.stringify(w.get(f));
    w.set(f, v);
    if (JSON.stringify(w.get(f)) !== before) changed.push(f);
  };
  if (util.has(p, 'type')) set('type', util.oneOf(p, 'type', TYPES, 'other'));
  if (util.has(p, 'title')) {
    const t = util.text(p, 'title', 2000, '');
    if (t === '') throw util.fail(400, 'A paper needs a title.', 'invalid_param', { param: 'title' });
    set('title', t);
  }
  for (const f of ['subtitle', 'container', 'container_short', 'volume', 'issue', 'pages', 'article_number', 'publisher', 'place', 'edition', 'issn', 'url', 'language']) {
    if (util.has(p, f)) set(f, util.text(p, f, f === 'container' || f === 'subtitle' ? 1000 : f === 'url' ? 2000 : 500, ''));
  }
  if (util.has(p, 'abstract')) set('abstract', util.text(p, 'abstract', 40000, ''));
  if (util.has(p, 'year')) set('year', util.int(p, 'year', 0, 0, 3000));
  if (util.has(p, 'issued')) {
    const v = util.str(p, 'issued', '');
    if (v !== '' && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)) throw util.fail(400, 'issued is YYYY, YYYY-MM or YYYY-MM-DD', 'invalid_param', { param: 'issued' });
    set('issued', v);
    if (v !== '' && !util.has(p, 'year')) set('year', Number(v.slice(0, 4)));
  }
  if (util.has(p, 'authors')) set('authors', personList(p.authors, 'authors'));
  if (util.has(p, 'editors')) set('editors', personList(p.editors, 'editors'));
  if (util.has(p, 'keywords')) {
    const k = util.list(p, 'keywords') || [];
    set('keywords', k.map((x) => String(x).trim().slice(0, 100)).filter((x) => x !== '').slice(0, 50));
  }
  if (util.has(p, 'isbn')) {
    const raw = util.str(p, 'isbn', '');
    const v = raw === '' ? '' : require(`${__hooks}/lib_ident.js`).cleanIsbn(raw);
    if (v === null) throw util.fail(400, 'isbn must be a valid ISBN-10 or ISBN-13', 'invalid_param', { param: 'isbn' });
    set('isbn', v);
  }
  if (util.has(p, 'citekey')) {
    const k = util.str(p, 'citekey', '');
    if (k !== '' && !/^[A-Za-z0-9_:.-]{1,120}$/.test(k)) throw util.fail(400, 'citekey takes letters, digits and _ : . - (no spaces)', 'invalid_param', { param: 'citekey' });
    if (k !== '' && util.count(app, 'SELECT COUNT(*) AS n FROM works WHERE LOWER(citekey) = LOWER({:k}) AND id != {:id}', { k: k, id: w.id }) > 0) throw util.fail(409, 'Another paper already uses the citekey ' + k + '.', 'already_exists');
    set('citekey', k === '' ? makeCitekey(app, w) : k);
  }
  if (track) {
    const edited = util.jsonOf(w, 'edited') || [];
    for (const f of changed) if (edited.indexOf(f) < 0) edited.push(f);
    w.set('edited', edited);
  }
  return changed;
}

/** works.update: edit a paper's metadata. A person's edits are kept when the registry is asked again. */
function update(ctx, p) {
  const util = u();
  const app = ctx.app;
  const w = core().work(app, util.req(p, 'work'));
  core().guardWork(ctx, w);
  let changed = [];
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('works', w.id);
    if (ctx.isAgent) {
      const edited = util.jsonOf(r, 'edited') || [];
      for (const f of FIELDS.concat(['citekey'])) {
        if (util.has(p, f) && edited.indexOf(f) >= 0) throw util.fail(409, 'A person edited ' + f + ' on this paper; your AI agent leaves it as they set it.', 'person_edited', { field: f });
      }
    }
    const before = {};
    for (const f of FIELDS.concat(['citekey'])) before[f] = r.get(f);
    changed = setFields(tx, r, p, !ctx.isAgent);
    if (changed.length === 0) return;
    tx.save(r);
    search().indexWork(tx, r);
    if (ctx.isAgent) {
      for (const f of changed) {
        const m = util.findOne(tx, 'field_marks', 'target = "works" && record = {:r} && field = {:f}', { r: r.id, f: f }) || util.newRecord(tx, 'field_marks');
        m.set('target', 'works');
        m.set('record', r.id);
        m.set('field', f);
        m.set('confidence', 'check');
        m.set('reason', util.text(p, 'why', 2000, 'Changed by your AI agent'));
        m.set('actor', 'agent');
        tx.save(m);
      }
    }
    const undoFields = {};
    for (const f of changed) undoFields[f] = before[f];
    act().write(tx, ctx, { label: 'Edited ' + changed.join(', ') + ' of "' + r.getString('title').slice(0, 80) + '"', target: 'works', record: r.id, undo: { fn: 'lib_works.undoUpdate', args: { work: r.id, fields: undoFields } } });
  });
  return { work: detail(app, app.findRecordById('works', w.id)), changed: changed };
}

function undoUpdate(ctx, args) {
  const w = u().byId(ctx.app, 'works', args.work);
  if (w === null) return;
  for (const f of Object.keys(args.fields || {})) w.set(f, args.fields[f]);
  ctx.app.save(w);
  search().indexWork(ctx.app, w);
}

/** works.refresh: ask the registry again (person edits stay). */
function refresh(ctx, p) {
  const util = u();
  const w = core().work(ctx.app, util.req(p, 'work'));
  core().guardWork(ctx, w);
  if (w.getString('resolution') === 'manual' || w.getString('resolution') === 'pending') throw util.fail(409, 'This paper has no identifier to look up. Identify it first.', 'no_identifier');
  w.set('resolution', 'resolving');
  ctx.app.save(w);
  let outcome = 'resolving';
  try {
    outcome = resolveOne(ctx.app, ctx.app.findRecordById('works', w.id));
  } catch (err) {
    console.error('[ro] refresh failed', w.id, err);
  }
  return { work: detail(ctx.app, ctx.app.findRecordById('works', w.id)), outcome: outcome };
}

/* ------------------------------------------------------- read, star, trash */

function setState(ctx, p) {
  const util = u();
  const app = ctx.app;
  const list = util.ids(p, 'works', 1000);
  if (list.length === 0) throw util.fail(400, 'Give --works with one or more paper ids.', 'missing_param');
  const read = util.oneOf(p, 'read_state', ['unread', 'reading', 'read'], '');
  const starred = util.bool(p, 'starred', null);
  const rating = util.int(p, 'rating', -1, 0, 5);
  let n = 0;
  app.runInTransaction((tx) => {
    for (const id of list) {
      const w = core().need(tx, 'works', id, 'paper');
      core().guardWork(ctx, w);
      if (read !== '') {
        w.set('read_state', read);
        if (read === 'read') w.set('read_at', util.nowIso());
      }
      if (starred !== null) w.set('starred', starred);
      if (rating >= 0) w.set('rating', rating);
      tx.save(w);
      n++;
    }
  });
  return { updated: n };
}

/** works.trash: move papers to the trash (they can be restored). */
function trash(ctx, p) {
  const util = u();
  const list = util.ids(p, 'works', 1000);
  if (list.length === 0) throw util.fail(400, 'Give --works with one or more paper ids.', 'missing_param');
  const batch = util.token(12);
  ctx.app.runInTransaction((tx) => {
    for (const id of list) {
      const w = core().need(tx, 'works', id, 'paper');
      core().guardWork(ctx, w);
      w.set('trashed', true);
      w.set('trashed_at', util.nowIso());
      tx.save(w);
      search().dropWork(tx, w.id);
    }
    act().write(tx, ctx, { label: 'Moved ' + (list.length === 1 ? 'a paper' : list.length + ' papers') + ' to the trash', target: 'works', record: list.length === 1 ? list[0] : '', batch: batch, undo: { fn: 'lib_works.undoTrash', args: { ids: list } } });
  });
  return { trashed: list.length, batch: batch };
}

function trashPreview(ctx, p) {
  const util = u();
  const list = util.ids(p, 'works', 1000);
  const rows = list.map((id) => core().need(ctx.app, 'works', id, 'paper')).map((w) => ({ id: w.id, title: w.getString('title') }));
  return { kind: 'trash_works', title: 'Move ' + (rows.length === 1 ? '"' + rows[0].title.slice(0, 80) + '"' : rows.length + ' papers') + ' to the trash', summary: 'They can be restored from the trash.', preview: { works: rows }, target: rows.length === 1 ? { collection: 'works', id: rows[0].id } : null };
}

function undoTrash(ctx, args) {
  restoreIds(ctx.app, args.ids || []);
}

function restoreIds(app, list) {
  app.runInTransaction((tx) => {
    for (const id of list) {
      const w = u().byId(tx, 'works', id);
      if (w === null) continue;
      w.set('trashed', false);
      w.set('trashed_at', '');
      tx.save(w);
      search().indexWork(tx, w);
      for (const pg of tx.findRecordsByFilter('pages', 'file.work = {:w}', '', 0, 0, { w: id })) search().indexPage(tx, pg, id);
    }
  });
}

/** works.restore: bring papers back from the trash. */
function restore(ctx, p) {
  const list = u().ids(p, 'works', 1000);
  restoreIds(ctx.app, list);
  act().write(ctx.app, ctx, { label: 'Restored ' + (list.length === 1 ? 'a paper' : list.length + ' papers') + ' from the trash', target: 'works', record: list.length === 1 ? list[0] : '' });
  return { restored: list.length };
}

/** What deleting papers for good takes with it. */
function dependants(app, list) {
  const util = u();
  const inList = list.map((x) => "'" + String(x).replace(/'/g, '') + "'").join(',');
  return util.one(
    app,
    'SELECT (SELECT COUNT(*) FROM files WHERE work IN (' + inList + ')) AS files, (SELECT COUNT(*) FROM annotations WHERE work IN (' + inList + ')) AS annotations, (SELECT COUNT(*) FROM notes WHERE work IN (' + inList + ')) AS notes, (SELECT COUNT(*) FROM nodes WHERE work IN (' + inList + ')) AS evidence',
    { files: 0, annotations: 0, notes: 0, evidence: 0 },
  );
}

/** works.purge: delete papers for good (people only), with what goes with them. */
function purge(ctx, p) {
  const util = u();
  const app = ctx.app;
  let list = util.ids(p, 'works', 5000);
  if (util.bool(p, 'all_trash', false)) list = util.rows(app, 'SELECT id FROM works WHERE trashed = true', { id: '' }).map((r) => r.id);
  if (list.length === 0) throw util.fail(400, 'Give --works, or --all_trash true to empty the trash.', 'missing_param');
  const dep = dependants(app, list);
  if (util.bool(p, 'preview', false)) return { preview: true, works: list.length, takes: dep };
  app.runInTransaction((tx) => {
    for (const id of list) {
      const w = util.byId(tx, 'works', id);
      if (w === null) continue;
      // Evidence drawn from this paper goes with it (its passages do).
      for (const n of tx.findRecordsByFilter('nodes', "work = {:w} && kind = 'evidence'", '', 0, 0, { w: id })) tx.delete(tx.findRecordById('nodes', n.id));
      for (const n of tx.findRecordsByFilter('notes', 'work = {:w}', '', 0, 0, { w: id })) {
        search().dropNote(tx, n.id);
        tx.delete(tx.findRecordById('notes', n.id));
      }
      search().dropWork(tx, id);
      tx.delete(tx.findRecordById('works', id));
    }
    act().write(tx, ctx, { label: 'Deleted ' + (list.length === 1 ? 'a paper' : list.length + ' papers') + ' for good', target: 'works', data: { detail: dep } });
  });
  return { deleted: list.length, took: dep };
}

/* ---------------------------------------------------------------- merge */

/**
 * Move everything of `others` onto `master` and delete the others: files,
 * passages and highlights, notes, evidence, project and collection places,
 * tags, table rows. `fields` picks metadata from another paper per field.
 */
function mergeInto(app, ctx, master, others, fields) {
  const util = u();
  let moved = 0;
  app.runInTransaction((tx) => {
    const m = tx.findRecordById('works', master.id);
    let version = util.count(tx, 'SELECT COALESCE(MAX(version), 0) AS n FROM files WHERE work = {:w}', { w: m.id });
    const hasCurrent = core().currentFile(tx, m.id) !== null;
    for (const o0 of others) {
      const o = tx.findRecordById('works', o0.id);
      for (const f of tx.findRecordsByFilter('files', 'work = {:w}', 'version', 0, 0, { w: o.id })) {
        version++;
        f.set('work', m.id);
        f.set('version', version);
        if (hasCurrent) f.set('current', false);
        tx.save(f);
        search().moveFile(tx, f.id, m.id);
        moved++;
      }
      for (const table of ['anchors', 'annotations', 'notes', 'nodes', 'board_items']) {
        util.exec(tx, 'UPDATE ' + table + ' SET work = {:m} WHERE work = {:o}', { m: m.id, o: o.id });
      }
      for (const pw of tx.findRecordsByFilter('project_works', 'work = {:o}', '', 0, 0, { o: o.id })) {
        if (util.findOne(tx, 'project_works', 'project = {:p} && work = {:m}', { p: pw.getString('project'), m: m.id }) === null) {
          pw.set('work', m.id);
          tx.save(pw);
        }
      }
      for (const ci of tx.findRecordsByFilter('collection_items', 'work = {:o}', '', 0, 0, { o: o.id })) {
        if (util.findOne(tx, 'collection_items', 'collection = {:c} && work = {:m}', { c: ci.getString('collection'), m: m.id }) === null) {
          ci.set('work', m.id);
          tx.save(ci);
        }
      }
      for (const wt of tx.findRecordsByFilter('work_tags', 'work = {:o}', '', 0, 0, { o: o.id })) {
        if (util.findOne(tx, 'work_tags', 'tag = {:t} && work = {:m}', { t: wt.getString('tag'), m: m.id }) === null) {
          wt.set('work', m.id);
          tx.save(wt);
        }
      }
      util.exec(tx, 'UPDATE work_refs SET resolved_work = {:m} WHERE resolved_work = {:o}', { m: m.id, o: o.id });
      util.exec(tx, 'UPDATE candidates SET work = {:m} WHERE work = {:o}', { m: m.id, o: o.id });
      util.exec(tx, 'UPDATE review_records SET work = {:m} WHERE work = {:o}', { m: m.id, o: o.id });
      // Fields chosen from this paper.
      for (const f of Object.keys(fields || {})) if (fields[f] === o.id && FIELDS.indexOf(f) >= 0) m.set(f, o.get(f));
      // Identifiers the master lacks.
      const take = {};
      for (const f of ['doi', 'arxiv_id', 'pmid', 'pmcid', 'isbn', 'openalex_id']) if (m.getString(f) === '' && o.getString(f) !== '') take[f] = o.getString(f);
      search().dropWork(tx, o.id);
      tx.delete(o);
      for (const f of Object.keys(take)) m.set(f, take[f]);
      if (m.getString('read_state') === 'unread' && o.getString('read_state') !== 'unread') m.set('read_state', o.getString('read_state'));
    }
    tx.save(m);
    search().indexWork(tx, m);
    for (const pg of tx.findRecordsByFilter('pages', 'file.work = {:w}', '', 0, 0, { w: m.id })) search().indexPage(tx, pg, m.id);
    act().write(tx, ctx, { label: 'Merged ' + others.length + (others.length === 1 ? ' paper' : ' papers') + ' into "' + m.getString('title').slice(0, 80) + '"', target: 'works', record: m.id });
  });
  return moved;
}

/** works.merge: merge duplicates into one paper. */
function merge(ctx, p) {
  const util = u();
  const app = ctx.app;
  const master = core().work(app, util.req(p, 'master'));
  const others = util.ids(p, 'works', 50).filter((x) => x !== master.id).map((id) => core().need(app, 'works', id, 'paper'));
  if (others.length === 0) throw util.fail(400, 'Give --works with the papers to merge into the master.', 'missing_param');
  for (const w of [master].concat(others)) core().guardWork(ctx, w);
  const fields = util.obj(p, 'fields') || {};
  for (const f of Object.keys(fields)) {
    if (FIELDS.indexOf(f) < 0) throw util.fail(400, 'fields: "' + f + '" is not a metadata field. It takes: ' + FIELDS.join(', '), 'unknown_key');
    if (others.map((o) => o.id).indexOf(fields[f]) < 0 && fields[f] !== master.id) throw util.fail(400, 'fields.' + f + ' must name the master or one of the merged papers.', 'invalid_param');
  }
  const moved = mergeInto(app, ctx, master, others, fields);
  return { work: detail(app, app.findRecordById('works', master.id)), merged: others.length, files_moved: moved };
}

function mergePreview(ctx, p) {
  const util = u();
  const app = ctx.app;
  const master = core().work(app, util.req(p, 'master'));
  const others = util.ids(p, 'works', 50).filter((x) => x !== master.id).map((id) => core().need(app, 'works', id, 'paper'));
  return {
    kind: 'merge_works',
    title: 'Merge ' + others.length + (others.length === 1 ? ' paper' : ' papers') + ' into "' + master.getString('title').slice(0, 80) + '"',
    summary: 'Files, highlights, notes, evidence, collections, projects and tags move to the kept paper; the others are deleted.',
    preview: { master: rowOut(master), others: others.map(rowOut), takes: dependants(app, others.map((o) => o.id)) },
    target: { collection: 'works', id: master.id },
  };
}

/** works.duplicates: papers that share an identifier (OpenAlex, ISBN) or are a preprint and its published version. */
function duplicates(ctx) {
  const util = u();
  const app = ctx.app;
  const hidden = core().hiddenSql(ctx, 'w');
  const groups = [];
  const add = (kind, label, ids) => {
    const recs = ids.map((id) => util.byId(app, 'works', id)).filter((w) => w !== null);
    if (recs.length > 1) groups.push({ kind: kind, label: label, works: recs.map(rowOut) });
  };
  for (const r of util.rows(app, "SELECT openalex_id AS k, GROUP_CONCAT(id) AS ids FROM works w WHERE trashed = false AND openalex_id != ''" + hidden + ' GROUP BY openalex_id HAVING COUNT(*) > 1 LIMIT 200', { k: '', ids: '' })) add('same_openalex', 'Same OpenAlex record ' + r.k, r.ids.split(','));
  for (const r of util.rows(app, "SELECT isbn AS k, GROUP_CONCAT(id) AS ids FROM works w WHERE trashed = false AND isbn != '' AND type = 'book'" + hidden + ' GROUP BY isbn HAVING COUNT(*) > 1 LIMIT 200', { k: '', ids: '' })) add('same_isbn', 'Same ISBN ' + r.k, r.ids.split(','));
  for (const r of util.rows(app, "SELECT w.id AS a, o.id AS b FROM works w JOIN works o ON o.doi = json_extract(w.extra, '$.journal_doi') WHERE w.trashed = false AND o.trashed = false AND json_extract(w.extra, '$.journal_doi') IS NOT NULL AND json_extract(w.extra, '$.journal_doi') != ''" + hidden + ' LIMIT 200', { a: '', b: '' })) add('versions', 'Preprint and its published version', [r.b, r.a]);
  for (const r of util.rows(app, "SELECT w.id AS a, json_extract(w.extra, '$.same_doi') AS b FROM works w WHERE w.trashed = false AND json_extract(w.extra, '$.same_doi') IS NOT NULL" + hidden + ' LIMIT 200', { a: '', b: '' })) add('same_doi', 'Same DOI', [r.b, r.a]);
  const proposals = app.findRecordsByFilter('proposals', "status = 'waiting' && kind = 'merge_works'", '-created', 100, 0).map((x) => require(`${__hooks}/lib_agent.js`).proposalOut(app, x));
  return { groups: groups, proposals: proposals };
}

/* ------------------------------------------------------------ integrity */

/**
 * The hourly job: re-check retraction and correction notices (Crossref) for
 * papers with a DOI, oldest check first, at most `max` per run. A new
 * retraction is written to the activity trail and shows in Needs you.
 */
function integrityDue(app, max) {
  const util = u();
  const reg = require(`${__hooks}/lib_registry.js`);
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const due = util.rows(app, "SELECT id FROM works WHERE trashed = FALSE AND resolution = 'resolved' AND doi != '' AND (integrity_at = '' OR integrity_at < {:c}) ORDER BY integrity_at LIMIT " + (max || 40), { id: '' }, { c: cutoff });
  let n = 0;
  for (const r of due) {
    const w = app.findRecordById('works', r.id);
    let meta = null;
    try {
      meta = reg.crossrefWork(app, w.getString('doi'));
    } catch (err) {
      if (err && err.code === 'unreachable') break;
      throw err;
    }
    const before = w.getString('integrity');
    if (meta !== null && meta.integrity) {
      w.set('integrity', meta.integrity.state);
      w.set('integrity_detail', meta.integrity);
    }
    w.set('integrity_at', util.nowIso());
    app.save(w);
    if (before !== 'retracted' && w.getString('integrity') === 'retracted') {
      require(`${__hooks}/lib_activity.js`).write(app, require(`${__hooks}/lib_auth.js`).system(app), { label: 'Retraction notice found for "' + w.getString('title').slice(0, 100) + '"', target: 'works', record: w.id });
    }
    n++;
  }
  return n;
}

/* ---------------------------------------------------------------- lists */

const VIEWS = ['all', 'unread', 'reading', 'read', 'recent', 'opened', 'to_identify', 'integrity', 'trash', 'starred', 'no_pdf', 'agent_added'];
const SORTS = ['added', 'title', 'year', 'author', 'opened', 'cited_by', 'updated'];

/**
 * Advanced filter conditions: [{ field, op, value }], combined with match
 * 'all' or 'any'. Every field and op is a fixed choice; values are bound.
 */
const COND_FIELDS = {
  title: { col: 'w.title', kind: 'text' },
  abstract: { col: 'w.abstract', kind: 'text' },
  venue: { col: 'w.container', kind: 'text' },
  author: { col: 'w.authors', kind: 'text' },
  publisher: { col: 'w.publisher', kind: 'text' },
  year: { col: 'w.year', kind: 'number' },
  cited_by: { col: 'w.cited_by', kind: 'number' },
  type: { col: 'w.type', kind: 'enum', values: TYPES },
  read_state: { col: 'w.read_state', kind: 'enum', values: ['unread', 'reading', 'read'] },
  integrity: { col: 'w.integrity', kind: 'enum', values: ['unchecked', 'clear', 'retracted', 'corrected', 'concern'] },
  resolution: { col: 'w.resolution', kind: 'enum', values: ['pending', 'resolving', 'resolved', 'not_found', 'unreachable', 'manual'] },
  added_by: { col: 'w.added_by', kind: 'enum', values: ['person', 'agent', 'system'] },
  tag: { kind: 'exists', sql: 'EXISTS (SELECT 1 FROM work_tags x WHERE x.work = w.id AND x.tag = {:V})' },
  collection: { kind: 'exists', sql: 'EXISTS (SELECT 1 FROM collection_items x WHERE x.work = w.id AND x.collection = {:V})' },
  project: { kind: 'exists', sql: 'EXISTS (SELECT 1 FROM project_works x WHERE x.work = w.id AND x.project = {:V})' },
  highlight_color: { kind: 'exists', sql: 'EXISTS (SELECT 1 FROM annotations x WHERE x.work = w.id AND x.color_slot = CAST({:V} AS INTEGER))' },
  has_pdf: { kind: 'flag', sql: 'EXISTS (SELECT 1 FROM files x WHERE x.work = w.id)' },
  has_notes: { kind: 'flag', sql: 'EXISTS (SELECT 1 FROM notes x WHERE x.work = w.id)' },
  has_highlights: { kind: 'flag', sql: 'EXISTS (SELECT 1 FROM annotations x WHERE x.work = w.id)' },
  has_proposed: { kind: 'flag', sql: "EXISTS (SELECT 1 FROM nodes x WHERE x.work = w.id AND x.status = 'agent_proposed')" },
  starred: { kind: 'flag', sql: 'w.starred = TRUE' },
  added_after: { col: 'w.created', kind: 'date', cmp: '>=' },
  added_before: { col: 'w.created', kind: 'date', cmp: '<' },
};

function condSql(cond, i, bind) {
  const util = u();
  util.keysOnly(cond, ['field', 'op', 'value'], 'Condition ' + (i + 1));
  const def = COND_FIELDS[cond.field];
  if (!def) throw util.fail(400, 'Condition ' + (i + 1) + ': unknown field "' + cond.field + '". Fields: ' + Object.keys(COND_FIELDS).join(', '), 'unknown_key');
  const key = 'c' + i;
  const v = cond.value;
  if (def.kind === 'text') {
    const ops = { contains: 'LIKE', not_contains: 'NOT LIKE' };
    if (!ops[cond.op]) throw util.fail(400, 'Condition ' + (i + 1) + ': op for ' + cond.field + ' is contains or not_contains', 'invalid_param');
    bind[key] = util.like(String(v || ''));
    return def.col + ' ' + ops[cond.op] + " {:" + key + "} ESCAPE '\\'";
  }
  if (def.kind === 'number') {
    const ops = { is: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' };
    if (!ops[cond.op]) throw util.fail(400, 'Condition ' + (i + 1) + ': op for ' + cond.field + ' is is, gte, lte, gt or lt', 'invalid_param');
    const n = Number(v);
    if (!Number.isFinite(n)) throw util.fail(400, 'Condition ' + (i + 1) + ': value must be a number', 'invalid_param');
    bind[key] = n;
    return def.col + ' ' + ops[cond.op] + ' {:' + key + '}';
  }
  if (def.kind === 'enum') {
    if (cond.op !== 'is' && cond.op !== 'is_not') throw util.fail(400, 'Condition ' + (i + 1) + ': op for ' + cond.field + ' is is or is_not', 'invalid_param');
    if (def.values.indexOf(String(v)) < 0) throw util.fail(400, 'Condition ' + (i + 1) + ': ' + cond.field + ' is one of ' + def.values.join(', '), 'invalid_param');
    bind[key] = String(v);
    return def.col + (cond.op === 'is' ? ' = ' : ' != ') + '{:' + key + '}';
  }
  if (def.kind === 'exists') {
    if (cond.op !== 'is' && cond.op !== 'is_not') throw util.fail(400, 'Condition ' + (i + 1) + ': op for ' + cond.field + ' is is or is_not', 'invalid_param');
    bind[key] = String(v || '');
    return (cond.op === 'is_not' ? 'NOT ' : '') + def.sql.replace('{:V}', '{:' + key + '}');
  }
  if (def.kind === 'flag') {
    if (cond.op !== 'is') throw util.fail(400, 'Condition ' + (i + 1) + ': op for ' + cond.field + ' is is', 'invalid_param');
    const yes = v === true || v === 'true';
    return (yes ? '' : 'NOT ') + def.sql;
  }
  if (def.kind === 'date') {
    if (!util.isDay(String(v || ''))) throw util.fail(400, 'Condition ' + (i + 1) + ': value is a date YYYY-MM-DD', 'invalid_param');
    bind[key] = String(v);
    return def.col + ' ' + def.cmp + ' {:' + key + '}';
  }
  throw util.fail(400, 'Condition ' + (i + 1) + ' is not understood', 'invalid_param');
}

/** works.list: the library table (filters, views, search, sort, paging). */
function list(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 100, 500);
  const view = util.oneOf(p, 'view', VIEWS, 'all');
  const where = [view === 'trash' ? 'w.trashed = TRUE' : 'w.trashed = FALSE'];
  const bind = {};
  if (view === 'unread' || view === 'reading' || view === 'read') {
    where.push('w.read_state = {:rs}');
    bind.rs = view;
  }
  if (view === 'to_identify') where.push("(w.resolution IN ('pending', 'not_found') OR w.identify = 'failed' OR w.identity = 'agent_proposed')");
  if (view === 'integrity') where.push("w.integrity IN ('retracted', 'concern', 'corrected')");
  if (view === 'starred') where.push('w.starred = TRUE');
  if (view === 'opened') where.push("w.opened_at != ''");
  if (view === 'no_pdf') where.push('NOT EXISTS (SELECT 1 FROM files x WHERE x.work = w.id)');
  if (view === 'agent_added') where.push("w.added_by = 'agent'");
  if (view === 'recent') {
    where.push('w.created >= {:since}');
    bind.since = new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ');
  }
  const collection = util.str(p, 'collection', '');
  if (collection !== '') {
    if (util.bool(p, 'deep', false)) {
      where.push('w.id IN (SELECT ci.work FROM collection_items ci WHERE ci.collection IN (WITH RECURSIVE sub(id) AS (SELECT {:col} UNION ALL SELECT c.id FROM collections c JOIN sub ON c.parent = sub.id) SELECT id FROM sub))');
    } else where.push('w.id IN (SELECT ci.work FROM collection_items ci WHERE ci.collection = {:col})');
    bind.col = collection;
  }
  const tag = util.str(p, 'tag', '');
  if (tag !== '') {
    where.push('w.id IN (SELECT wt.work FROM work_tags wt WHERE wt.tag = {:tag})');
    bind.tag = tag;
  }
  const proj = util.str(p, 'project', '');
  if (proj !== '') {
    const pr = core().project(app, proj);
    core().guardProject(ctx, pr);
    where.push('w.id IN (SELECT pw.work FROM project_works pw WHERE pw.project = {:proj})');
    bind.proj = pr.id;
  }
  const type = util.oneOf(p, 'type', TYPES, '');
  if (type !== '') {
    where.push('w.type = {:type}');
    bind.type = type;
  }
  const yFrom = util.int(p, 'year_from', 0, 0, 3000);
  if (yFrom > 0) {
    where.push('w.year >= {:yf}');
    bind.yf = yFrom;
  }
  const yTo = util.int(p, 'year_to', 0, 0, 3000);
  if (yTo > 0) {
    where.push('w.year > 0 AND w.year <= {:yt}');
    bind.yt = yTo;
  }
  const hasPdf = util.bool(p, 'has_pdf', null);
  if (hasPdf !== null) where.push((hasPdf ? '' : 'NOT ') + 'EXISTS (SELECT 1 FROM files x WHERE x.work = w.id)');
  const conds = util.list(p, 'filter');
  if (conds !== undefined && conds.length > 0) {
    if (conds.length > 30) throw util.fail(400, 'At most 30 conditions.', 'invalid_param');
    const match = util.oneOf(p, 'match', ['all', 'any'], 'all');
    const parts = conds.map((c, i) => condSql(c, i, bind));
    where.push('(' + parts.join(match === 'all' ? ' AND ' : ' OR ') + ')');
  }
  // Search: the words in the paper's fields, and with full_text also in its PDF.
  const q = util.str(p, 'q', '');
  let ranked = null;
  if (q !== '') {
    const s = search();
    const hits = s.workIds(app, q, 2000);
    const ft = util.bool(p, 'full_text', false) ? s.fullTextWorkIds(app, q, 2000) : [];
    ranked = hits.concat(ft.filter((x) => hits.indexOf(x) < 0));
    if (ranked.length === 0) return { works: [], total: 0, more: false };
    where.push('w.id IN (' + ranked.map((x) => "'" + x.replace(/[^a-z0-9]/g, '') + "'").join(',') + ')');
  }
  const hidden = core().hiddenSql(ctx, 'w');
  const whereSql = where.join(' AND ') + hidden;
  const sort = util.oneOf(p, 'sort', SORTS, view === 'opened' ? 'opened' : 'added');
  const dir = util.oneOf(p, 'dir', ['asc', 'desc'], sort === 'title' || sort === 'author' ? 'asc' : 'desc');
  const order = {
    added: 'w.created',
    updated: 'w.updated',
    title: 'w.title COLLATE NOCASE',
    year: 'w.year',
    author: "COALESCE(json_extract(w.authors, '$[0].family'), json_extract(w.authors, '$[0].literal'), '') COLLATE NOCASE",
    opened: 'w.opened_at',
    cited_by: 'w.cited_by',
  }[sort];
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM works w WHERE ' + whereSql, bind);
  const idRows = util.rows(app, 'SELECT w.id AS id FROM works w WHERE ' + whereSql + (ranked !== null && !util.has(p, 'sort') ? '' : ' ORDER BY ' + order + ' ' + dir + ', w.id') + ' LIMIT ' + (ranked !== null && !util.has(p, 'sort') ? 5000 : pg.limit + ' OFFSET ' + pg.offset), { id: '' }, bind);
  let ids = idRows.map((r) => r.id);
  if (ranked !== null && !util.has(p, 'sort')) {
    ids.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
    ids = ids.slice(pg.offset, pg.offset + pg.limit);
  }
  return { works: rowsFor(app, ids), total: total, more: pg.offset + ids.length < total };
}

/** List rows with their file, counts and tags, in the given order. */
function rowsFor(app, ids) {
  const util = u();
  if (ids.length === 0) return [];
  const inList = ids.map((x) => "'" + x.replace(/[^a-z0-9]/g, '') + "'").join(',');
  const recs = app.findRecordsByIds('works', ids);
  const byId = {};
  for (const r of recs) byId[r.id] = r;
  const files = {};
  for (const f of util.rows(app, 'SELECT id, work, pages, text_state, thumb, pos_page, max_page FROM files WHERE current = TRUE AND work IN (' + inList + ')', { id: '', work: '', pages: 0, text_state: '', thumb: '', pos_page: 0, max_page: 0 })) {
    files[f.work] = { id: f.id, pages: f.pages, text_state: f.text_state, has_thumb: f.thumb !== '', pos_page: f.pos_page, max_page: f.max_page };
  }
  const counts = {};
  for (const c of util.rows(app, 'SELECT w.id AS id, (SELECT COUNT(*) FROM annotations a WHERE a.work = w.id) AS annotations, (SELECT COUNT(*) FROM notes n WHERE n.work = w.id) AS notes, (SELECT COUNT(*) FROM nodes d WHERE d.work = w.id) AS nodes, (SELECT COUNT(*) FROM nodes d WHERE d.work = w.id AND d.status = \'agent_proposed\') AS proposed FROM works w WHERE w.id IN (' + inList + ')', { id: '', annotations: 0, notes: 0, nodes: 0, proposed: 0 })) {
    counts[c.id] = { annotations: c.annotations, notes: c.notes, nodes: c.nodes, proposed: c.proposed };
  }
  const tags = {};
  for (const t of util.rows(app, 'SELECT wt.work AS work, t.id AS id, t.name AS name, t.color_slot AS color_slot FROM work_tags wt JOIN tags t ON t.id = wt.tag WHERE wt.work IN (' + inList + ') ORDER BY t.name', { work: '', id: '', name: '', color_slot: 0 })) {
    (tags[t.work] = tags[t.work] || []).push({ id: t.id, name: t.name, color_slot: t.color_slot });
  }
  const out = [];
  for (const id of ids) {
    const w = byId[id];
    if (!w) continue;
    out.push(Object.assign(rowOut(w), { file: files[id] || null, counts: counts[id] || { annotations: 0, notes: 0, nodes: 0, proposed: 0 }, tags: tags[id] || [] }));
  }
  return out;
}

/** works.get: one paper in full. */
function get(ctx, p) {
  const w = core().work(ctx.app, u().req(p, 'work'));
  core().guardWork(ctx, w);
  return { work: detail(ctx.app, w) };
}

/** works.counts: the library's numbers (Home, the library tree). */
function counts(ctx) {
  const util = u();
  const app = ctx.app;
  const hidden = core().hiddenSql(ctx, 'w');
  const r = util.one(
    app,
    "SELECT COUNT(*) AS total, IFNULL(SUM(CASE WHEN read_state = 'unread' THEN 1 ELSE 0 END), 0) AS unread, IFNULL(SUM(CASE WHEN read_state = 'reading' THEN 1 ELSE 0 END), 0) AS reading, IFNULL(SUM(CASE WHEN read_state = 'read' THEN 1 ELSE 0 END), 0) AS read, IFNULL(SUM(CASE WHEN resolution IN ('pending', 'not_found') OR identify = 'failed' OR identity = 'agent_proposed' THEN 1 ELSE 0 END), 0) AS to_identify, IFNULL(SUM(CASE WHEN integrity IN ('retracted', 'concern', 'corrected') THEN 1 ELSE 0 END), 0) AS integrity, IFNULL(SUM(CASE WHEN starred THEN 1 ELSE 0 END), 0) AS starred, IFNULL(SUM(CASE WHEN created >= {:since} THEN 1 ELSE 0 END), 0) AS recent, IFNULL(SUM(CASE WHEN opened_at != '' THEN 1 ELSE 0 END), 0) AS opened FROM works w WHERE trashed = FALSE" + hidden,
    { total: 0, unread: 0, reading: 0, read: 0, to_identify: 0, integrity: 0, starred: 0, recent: 0, opened: 0 },
    { since: new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ') },
  );
  const trashN = util.count(app, 'SELECT COUNT(*) AS n FROM works w WHERE trashed = TRUE' + hidden);
  const years = util.plain(util.rows(app, 'SELECT year, COUNT(*) AS n FROM works w WHERE trashed = FALSE AND year > 0' + hidden + ' GROUP BY year ORDER BY year', { year: 0, n: 0 }));
  const types = util.plain(util.rows(app, 'SELECT type, COUNT(*) AS n FROM works w WHERE trashed = FALSE' + hidden + ' GROUP BY type ORDER BY n DESC', { type: '', n: 0 }));
  return Object.assign(util.plain([r])[0], { trash: trashN, years: years, types: types });
}

module.exports = {
  FIELDS: FIELDS,
  TYPES: TYPES,
  rowOut: rowOut,
  rowsFor: rowsFor,
  detail: detail,
  makeCitekey: makeCitekey,
  byIdentifier: byIdentifier,
  resolveOne: resolveOne,
  resolveDue: resolveDue,
  wakeResolver: wakeResolver,
  newWork: newWork,
  place: place,
  add: add,
  undoAdd: undoAdd,
  manual: manual,
  identify: identify,
  identifyStart: identifyStart,
  identifyFail: identifyFail,
  confirmIdentity: confirmIdentity,
  update: update,
  undoUpdate: undoUpdate,
  refresh: refresh,
  setState: setState,
  trash: trash,
  trashPreview: trashPreview,
  undoTrash: undoTrash,
  restore: restore,
  purge: purge,
  merge: merge,
  mergeInto: mergeInto,
  mergePreview: mergePreview,
  duplicates: duplicates,
  integrityDue: integrityDue,
  list: list,
  get: get,
  counts: counts,
};
