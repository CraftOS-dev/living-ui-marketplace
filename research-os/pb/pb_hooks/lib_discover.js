/// <reference path="../pb_data/types.d.ts" />
/**
 * Discover: searching the registries (Crossref, arXiv, OpenAlex, PubMed),
 * saved searches with alerts, and candidates to triage.
 *
 * Every run records the queries it executed, the counts per source and why
 * it stopped, so a person can see exactly what was searched. Results become
 * candidates (one per search and identifier); nothing enters the library
 * until someone adds it, and a candidate always carries an identifier, so
 * what is added resolves against a registry.
 */

const SOURCES = ['crossref', 'arxiv', 'openalex', 'pubmed'];

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

function keyOf(m) {
  if (m.doi) return 'doi:' + m.doi;
  if (m.arxiv_id) return 'arxiv:' + m.arxiv_id;
  if (m.openalex_id) return 'openalex:' + m.openalex_id;
  if (m.pmid) return 'pmid:' + m.pmid;
  return '';
}

function inLibrary(app, c) {
  const util = u();
  for (const [col, v] of [['doi', c.getString('doi')], ['arxiv_id', c.getString('arxiv_id')], ['pmid', c.getString('pmid')], ['openalex_id', c.getString('openalex_id')]]) {
    if (v !== '') {
      const hit = util.findOne(app, 'works', col + ' = {:v} && trashed = false', { v: v });
      if (hit !== null) return hit.id;
    }
  }
  return '';
}

function candidateOut(app, c) {
  const util = u();
  const s = util.byId(app, 'searches', c.getString('search'));
  return {
    id: c.id,
    search: c.getString('search'),
    search_name: s !== null ? s.getString('name') || s.getString('query') : '',
    source: c.getString('source'),
    doi: c.getString('doi'),
    arxiv_id: c.getString('arxiv_id'),
    openalex_id: c.getString('openalex_id'),
    pmid: c.getString('pmid'),
    identifier: c.getString('doi') || (c.getString('arxiv_id') !== '' ? 'arxiv:' + c.getString('arxiv_id') : c.getString('pmid') !== '' ? 'pmid:' + c.getString('pmid') : c.getString('openalex_id')),
    title: c.getString('title'),
    authors_short: core().authorsShort(util.jsonOf(c, 'authors') || []),
    year: c.getInt('year'),
    venue: c.getString('venue'),
    abstract: c.getString('abstract'),
    cited_by: c.getInt('cited_by'),
    oa_url: c.getString('oa_url'),
    type: c.getString('type'),
    relevance: c.getString('relevance'),
    reason: c.getString('reason'),
    triage: c.getString('triage'),
    work: c.getString('work'),
    rank: c.getInt('rank'),
    actor: c.getString('actor'),
    created: c.getString('created'),
  };
}

function searchOut(app, s) {
  const util = u();
  const last = app.findRecordsByFilter('search_runs', 'search = {:s}', '-created', 1, 0, { s: s.id });
  return {
    id: s.id,
    name: s.getString('name'),
    query: s.getString('query'),
    sources: util.jsonOf(s, 'sources') || SOURCES.slice(0, 3),
    filters: util.jsonOf(s, 'filters') || {},
    alert: s.getString('alert'),
    project: s.getString('project'),
    saved: s.getBool('saved'),
    last_run_at: s.getString('last_run_at'),
    new_count: s.getInt('new_count'),
    candidates: util.count(app, "SELECT COUNT(*) AS n FROM candidates WHERE search = {:s} AND triage IN ('new', 'relevant')", { s: s.id }),
    last_run: last.length > 0 ? runOut(last[0]) : null,
    actor: s.getString('actor'),
    created: s.getString('created'),
  };
}

function runOut(r) {
  return { id: r.id, search: r.getString('search'), queries: u().jsonOf(r, 'queries') || [], evaluated: r.getInt('evaluated'), found: r.getInt('found'), new: r.getInt('new'), stop_reason: r.getString('stop_reason'), actor: r.getString('actor'), error: r.getString('error'), created: r.getString('created'), finished_at: r.getString('finished_at') };
}

/** Read search settings from params (sources, filters). */
function settingsFrom(p, current) {
  const util = u();
  let sources = current ? current.sources : ['crossref', 'arxiv', 'openalex'];
  if (util.has(p, 'sources')) {
    const raw = util.scalar(p.sources);
    const list = typeof raw === 'string' && raw.trim().charAt(0) !== '[' ? raw.split(',').map((x) => x.trim()) : util.list(p, 'sources') || [];
    sources = list.filter((x) => x !== '');
    for (const s of sources) if (SOURCES.indexOf(s) < 0) throw util.fail(400, 'sources are ' + SOURCES.join(', '), 'invalid_param');
    if (sources.length === 0) throw util.fail(400, 'Choose at least one source.', 'invalid_param');
  }
  const f = Object.assign({}, current ? current.filters : {});
  if (util.has(p, 'from_year')) f.from_year = util.int(p, 'from_year', 0, 0, 3000) || undefined;
  if (util.has(p, 'to_year')) f.to_year = util.int(p, 'to_year', 0, 0, 3000) || undefined;
  if (util.has(p, 'type')) f.type = util.oneOf(p, 'type', ['article', 'preprint', 'book', 'conference'], '') || undefined;
  if (util.has(p, 'oa')) f.oa = util.bool(p, 'oa', false) || undefined;
  if (util.has(p, 'rows')) f.rows = util.int(p, 'rows', 20, 5, 100);
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return { sources: sources, filters: f };
}

/** Run a search's query against its sources and file candidates. Returns the run. */
function execute(app, ctx, s) {
  const util = u();
  const reg = require(`${__hooks}/lib_registry.js`);
  const sources = util.jsonOf(s, 'sources') || ['crossref', 'arxiv', 'openalex'];
  const f = util.jsonOf(s, 'filters') || {};
  const q = s.getString('query');
  const run = util.newRecord(app, 'search_runs');
  run.set('search', s.id);
  run.set('queries', []);
  run.set('stop_reason', 'running');
  run.set('actor', ctx.actor);
  app.save(run);
  const queries = [];
  const found = {};
  let evaluated = 0;
  let reachable = 0;
  const opts = { rows: f.rows || 20, from_year: f.from_year, to_year: f.to_year, type: f.type, oa: f.oa };
  for (const src of sources) {
    const entry = { source: src, query: q, count: 0, total: 0, error: '' };
    try {
      let res;
      if (src === 'crossref') res = reg.crossrefSearch(app, q, opts);
      else if (src === 'arxiv') res = reg.arxivSearch(app, q, opts);
      else if (src === 'openalex') res = reg.openalexSearch(app, q, opts);
      else res = reg.pubmedSearch(app, q, opts);
      reachable++;
      entry.count = res.items.length;
      entry.total = res.total;
      evaluated += res.items.length;
      res.items.forEach((m, i) => {
        if (opts.oa === true && src !== 'arxiv' && m.oa_url === '' && m.oa_pdf_url === '') return;
        const k = keyOf(m);
        if (k === '' || m.title === '') return;
        const prev = found[k];
        if (prev) {
          if (m.cited_by > prev.m.cited_by) prev.m.cited_by = m.cited_by;
          if (prev.m.abstract === '' && m.abstract !== '') prev.m.abstract = m.abstract;
          if (prev.m.oa_url === '' && m.oa_url !== '') prev.m.oa_url = m.oa_url;
          prev.rank = Math.min(prev.rank, i);
          return;
        }
        found[k] = { m: m, src: src, rank: i };
      });
    } catch (err) {
      entry.error = String((err && err.message) || err).slice(0, 300);
    }
    queries.push(entry);
  }
  let added = 0;
  app.runInTransaction((tx) => {
    for (const k of Object.keys(found)) {
      const { m, src, rank } = found[k];
      let c = util.findOne(tx, 'candidates', 'search = {:s} && key = {:k}', { s: s.id, k: k });
      const fresh = c === null;
      if (fresh) {
        c = util.newRecord(tx, 'candidates');
        c.set('search', s.id);
        c.set('key', k);
        c.set('triage', 'new');
        c.set('actor', 'system');
        added++;
      }
      c.set('run', run.id);
      c.set('source', src);
      c.set('doi', m.doi || '');
      c.set('arxiv_id', m.arxiv_id || '');
      c.set('openalex_id', m.openalex_id || '');
      c.set('pmid', m.pmid || '');
      c.set('title', m.title.slice(0, 2000));
      c.set('authors', (m.authors || []).slice(0, 50));
      c.set('year', m.year || 0);
      c.set('venue', String(m.container || '').slice(0, 1000));
      if (m.abstract !== '' || fresh) c.set('abstract', String(m.abstract || '').slice(0, 40000));
      c.set('cited_by', m.cited_by || 0);
      c.set('oa_url', String(m.oa_pdf_url || m.oa_url || '').slice(0, 2000));
      c.set('type', m.type || '');
      c.set('rank', rank);
      tx.save(c);
      const w = inLibrary(tx, c);
      if (w !== '' && c.getString('work') === '') {
        c.set('work', w);
        if (c.getString('triage') === 'new') c.set('triage', 'added');
        tx.save(c);
      }
    }
    const r = tx.findRecordById('search_runs', run.id);
    r.set('queries', queries);
    r.set('evaluated', evaluated);
    r.set('found', Object.keys(found).length);
    r.set('new', added);
    r.set('stop_reason', reachable === 0 ? 'unreachable' : 'complete');
    r.set('finished_at', util.nowIso());
    tx.save(r);
    const sr = tx.findRecordById('searches', s.id);
    sr.set('last_run_at', util.nowIso());
    sr.set('new_count', util.count(tx, "SELECT COUNT(*) AS n FROM candidates WHERE search = {:s} AND triage = 'new'", { s: s.id }));
    tx.save(sr);
  });
  return app.findRecordById('search_runs', run.id);
}

/** search.run: run a query now (a new search, or a saved one again). */
function run(ctx, p) {
  const util = u();
  const app = ctx.app;
  let s;
  const id = util.str(p, 'search', '');
  if (id !== '') {
    s = core().need(app, 'searches', id, 'search');
    if (s.getString('project') !== '') core().guardProjectId(ctx, s.getString('project'));
    const st = settingsFrom(p, { sources: util.jsonOf(s, 'sources') || SOURCES.slice(0, 3), filters: util.jsonOf(s, 'filters') || {} });
    if (util.has(p, 'query')) s.set('query', util.text(p, 'query', 2000, s.getString('query')));
    s.set('sources', st.sources);
    s.set('filters', st.filters);
    app.save(s);
  } else {
    const q = util.text(p, 'query', 2000, '');
    if (q === '') throw util.fail(400, 'query is required', 'missing_param');
    const st = settingsFrom(p, null);
    s = util.newRecord(app, 'searches');
    s.set('query', q);
    s.set('name', util.text(p, 'name', 300, ''));
    s.set('sources', st.sources);
    s.set('filters', st.filters);
    s.set('alert', 'off');
    s.set('saved', util.bool(p, 'save', false));
    s.set('actor', ctx.actor);
    if (util.str(p, 'project', '') !== '') {
      const pr = core().project(app, util.str(p, 'project', ''));
      core().guardProject(ctx, pr);
      s.set('project', pr.id);
    }
    app.save(s);
  }
  const r = execute(app, ctx, s);
  return { search: searchOut(app, app.findRecordById('searches', s.id)), run: runOut(r) };
}

function searches(ctx, p) {
  const util = u();
  const saved = util.bool(p, 'saved', true);
  const recs = ctx.app.findRecordsByFilter('searches', saved ? 'saved = true' : '', '-updated', util.int(p, 'limit', 100, 1, 500), 0);
  return { searches: recs.filter((s) => !(ctx.isAgent && s.getString('project') !== '' && ctx.app.findRecordById('projects', s.getString('project')).getString('confidentiality') === 'confidential')).map((s) => searchOut(ctx.app, s)) };
}

function getSearch(ctx, p) {
  const util = u();
  const s = core().need(ctx.app, 'searches', util.req(p, 'search'), 'search');
  const runs = ctx.app.findRecordsByFilter('search_runs', 'search = {:s}', '-created', 20, 0, { s: s.id }).map(runOut);
  return { search: searchOut(ctx.app, s), runs: runs };
}

/** search.update: name, alert (off, daily, weekly) and keeping it saved. */
function update(ctx, p) {
  const util = u();
  const s = core().need(ctx.app, 'searches', util.req(p, 'search'), 'search');
  if (util.has(p, 'name')) s.set('name', util.text(p, 'name', 300, ''));
  if (util.has(p, 'alert')) {
    s.set('alert', util.oneOf(p, 'alert', ['off', 'daily', 'weekly'], 'off'));
    if (s.getString('alert') !== 'off') s.set('saved', true);
  }
  if (util.has(p, 'saved')) s.set('saved', util.bool(p, 'saved', true));
  if (util.has(p, 'query')) s.set('query', util.text(p, 'query', 2000, s.getString('query')));
  const st = settingsFrom(p, { sources: util.jsonOf(s, 'sources') || SOURCES.slice(0, 3), filters: util.jsonOf(s, 'filters') || {} });
  s.set('sources', st.sources);
  s.set('filters', st.filters);
  ctx.app.save(s);
  return { search: searchOut(ctx.app, s) };
}

function remove(ctx, p) {
  const s = core().need(ctx.app, 'searches', u().req(p, 'search'), 'search');
  ctx.app.delete(s);
  return { deleted: true };
}

/** candidates.list: candidates of a search (or every search), by triage. */
function candidates(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const sql = [];
  const bind = {};
  if (util.str(p, 'search', '') !== '') {
    where.push('search = {:s}');
    sql.push('search = {:s}');
    bind.s = util.str(p, 'search', '');
  }
  const triage = util.str(p, 'triage', '');
  if (triage !== '') {
    const list = triage.split(',').map((x) => x.trim());
    for (const t of list) if (['new', 'relevant', 'not_relevant', 'added', 'dismissed'].indexOf(t) < 0) throw util.fail(400, 'triage is new, relevant, not_relevant, added or dismissed', 'invalid_param');
    where.push('(' + list.map((t, i) => 'triage = {:t' + i + '}').join(' || ') + ')');
    sql.push('triage IN (' + list.map((t, i) => '{:t' + i + '}').join(', ') + ')');
    list.forEach((t, i) => (bind['t' + i] = t));
  }
  const sort = util.oneOf(p, 'sort', ['rank', 'cited_by', 'year', 'newest'], 'rank');
  const order = { rank: 'rank,-cited_by', cited_by: '-cited_by', year: '-year', newest: '-created' }[sort];
  const pg = util.page(p, 100, 500);
  const recs = app.findRecordsByFilter('candidates', where.join(' && '), order, pg.limit, pg.offset, bind);
  return { candidates: recs.map((c) => candidateOut(app, c)), total: util.count(app, 'SELECT COUNT(*) AS n FROM candidates WHERE ' + (sql.length > 0 ? sql.join(' AND ') : '1=1'), bind) };
}

/** candidates.triage: mark candidates relevant, not relevant, dismissed or new again. */
function triage(ctx, p) {
  const util = u();
  const ids = util.ids(p, 'candidates', 2000);
  const to = util.oneOf(p, 'triage', ['new', 'relevant', 'not_relevant', 'dismissed'], '');
  if (to === '' || ids.length === 0) throw util.fail(400, 'Give --candidates and --triage.', 'missing_param');
  ctx.app.runInTransaction((tx) => {
    for (const id of ids) {
      const c = core().need(tx, 'candidates', id, 'candidate');
      if (c.getString('triage') === 'added') continue;
      c.set('triage', to);
      tx.save(c);
    }
  });
  return { updated: ids.length };
}

/** candidates.add: add candidates to the library by their identifiers (people only). */
function add(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ids = util.ids(p, 'candidates', 500);
  if (ids.length === 0) throw util.fail(400, 'Give --candidates.', 'missing_param');
  const recs = ids.map((id) => core().need(app, 'candidates', id, 'candidate'));
  const idents = recs.map((c) => (c.getString('doi') !== '' ? c.getString('doi') : c.getString('arxiv_id') !== '' ? 'arxiv:' + c.getString('arxiv_id') : c.getString('pmid') !== '' ? 'pmid:' + c.getString('pmid') : c.getString('openalex_id')));
  const res = require(`${__hooks}/lib_works.js`).add(ctx, { ids: idents.join('\n'), collection: util.str(p, 'collection', ''), project: util.str(p, 'project', ''), source: 'search' });
  app.runInTransaction((tx) => {
    for (const c of recs) {
      const r = tx.findRecordById('candidates', c.id);
      r.set('triage', 'added');
      const w = inLibrary(tx, r);
      if (w !== '') r.set('work', w);
      tx.save(r);
    }
  });
  return { added: res.added.length, existing: res.existing.length, works: res.added.concat(res.existing) };
}

/**
 * candidates.file: your AI agent files what it found with its own searching,
 * each with an identifier and its reason. They join the search's candidates;
 * a person decides what to add.
 */
function file(ctx, p) {
  const util = u();
  const app = ctx.app;
  const s = core().need(app, 'searches', util.req(p, 'search'), 'search');
  if (s.getString('project') !== '') core().guardProjectId(ctx, s.getString('project'));
  const items = util.list(p, 'items') || [];
  if (items.length === 0) throw util.fail(400, 'items is a JSON list of {identifier, title, relevance, reason}.', 'missing_param');
  if (items.length > 200) throw util.fail(400, 'At most 200 at once.', 'too_many');
  const ident = require(`${__hooks}/lib_ident.js`);
  const filed = [];
  const errors = [];
  app.runInTransaction((tx) => {
    items.forEach((it, i) => {
      try {
        util.keysOnly(it, ['identifier', 'title', 'year', 'venue', 'relevance', 'reason'], 'Item ' + (i + 1));
        const id = ident.parse(String(it.identifier || ''));
        if (id === null || ['doi', 'arxiv', 'pmid', 'openalex'].indexOf(id.kind) < 0) throw util.fail(400, 'Item ' + (i + 1) + ': identifier must be a DOI, arXiv ID, PubMed ID or OpenAlex ID.', 'not_an_identifier');
        const k = (id.kind === 'arxiv' ? 'arxiv:' : id.kind === 'pmid' ? 'pmid:' : id.kind === 'openalex' ? 'openalex:' : 'doi:') + id.value;
        let c = util.findOne(tx, 'candidates', 'search = {:s} && key = {:k}', { s: s.id, k: k });
        if (c === null) {
          c = util.newRecord(tx, 'candidates');
          c.set('search', s.id);
          c.set('key', k);
          c.set('source', 'agent');
          c.set('triage', 'new');
          c.set('title', String(it.title || id.display).slice(0, 2000));
          c.set('authors', []);
          c.set('year', Number(it.year) || 0);
          c.set('venue', String(it.venue || '').slice(0, 1000));
          c.set({ doi: 'doi', arxiv: 'arxiv_id', pmid: 'pmid', openalex: 'openalex_id' }[id.kind], id.value);
          c.set('actor', 'agent');
          c.set('rank', 999);
        }
        c.set('relevance', util.oneOf({ r: it.relevance }, 'r', ['high', 'medium', 'low'], 'medium'));
        c.set('reason', String(it.reason || '').slice(0, 4000));
        tx.save(c);
        const w = inLibrary(tx, c);
        if (w !== '') {
          c.set('work', w);
          tx.save(c);
        }
        filed.push(c.id);
      } catch (err) {
        errors.push({ index: i + 1, message: String((err && err.message) || err) });
      }
    });
  });
  return { filed: filed.length, errors: errors };
}

/** candidates.assess: your AI agent's relevance and reason on candidates the app found. */
function assess(ctx, p) {
  const util = u();
  const items = util.list(p, 'items') || [];
  let n = 0;
  ctx.app.runInTransaction((tx) => {
    items.slice(0, 500).forEach((it, i) => {
      util.keysOnly(it, ['candidate', 'relevance', 'reason'], 'Item ' + (i + 1));
      const c = core().need(tx, 'candidates', String(it.candidate || ''), 'candidate');
      c.set('relevance', util.oneOf({ r: it.relevance }, 'r', ['high', 'medium', 'low'], 'medium'));
      c.set('reason', String(it.reason || '').slice(0, 4000));
      tx.save(c);
      n++;
    });
  });
  return { assessed: n };
}

/** The daily job: run saved searches whose alert is due, then ask your AI agent to review what is new. */
function feeds(app) {
  const util = u();
  const now = Date.now();
  const ctx = require(`${__hooks}/lib_auth.js`).system(app);
  let fresh = 0;
  for (const s of app.findRecordsByFilter('searches', "alert != 'off'", 'last_run_at', 50, 0)) {
    const last = util.ms(s.getString('last_run_at'));
    const every = s.getString('alert') === 'daily' ? 86400000 : 7 * 86400000;
    if (!Number.isNaN(last) && now - last < every - 600000) continue;
    try {
      const r = execute(app, ctx, s);
      fresh += r.getInt('new');
    } catch (err) {
      console.error('[ro] feed failed', s.id, err);
    }
  }
  if (fresh > 0) require(`${__hooks}/lib_agent.js`).ask(app, 'feed_review', {});
  return fresh;
}

/** The hourly job: forget unsaved searches older than a week (their candidates go with them unless added). */
function prune(app) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ');
  for (const s of app.findRecordsByFilter('searches', "saved = false && alert = 'off' && created < {:c}", '', 200, 0, { c: cutoff })) {
    try {
      app.delete(app.findRecordById('searches', s.id));
    } catch (err) {
      console.error('[ro] prune search failed', s.id, err);
    }
  }
}

module.exports = { SOURCES: SOURCES, candidateOut: candidateOut, searchOut: searchOut, runOut: runOut, execute: execute, run: run, searches: searches, getSearch: getSearch, update: update, remove: remove, candidates: candidates, triage: triage, add: add, file: file, assess: assess, feeds: feeds, prune: prune };
