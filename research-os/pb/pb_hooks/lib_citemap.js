/// <reference path="../pb_data/types.d.ts" />
/**
 * Citation map and reference lists, from OpenAlex (cached in oa_cache for
 * 30 days, because keyless use shares a small daily budget).
 *
 * The map starts from seeds (chosen papers, a collection, a project's
 * reading list): their references and the papers citing them, placed by
 * year and citation count. Papers several seeds cite are foundational;
 * papers citing several seeds are follow-on work. Both lists are counts of
 * links, never judgments.
 */

const CACHE_DAYS = 30;
const MAX_SEEDS = 25;
const CITING_PER_SEED = 20;
const MAX_NODES = 400;

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}
function reg() {
  return require(`${__hooks}/lib_registry.js`);
}

function fresh(rec) {
  const t = u().ms(rec.getString('fetched_at'));
  return !Number.isNaN(t) && Date.now() - t < CACHE_DAYS * 86400000;
}

function cacheOut(rec) {
  return { id: rec.getString('openalex_id'), doi: rec.getString('doi'), title: rec.getString('title'), year: rec.getInt('year'), authors: rec.getString('authors'), venue: rec.getString('venue'), cited_by: rec.getInt('cited_by'), type: rec.getString('type'), oa_url: rec.getString('oa_url') };
}

function store(app, m, withRefs) {
  const util = u();
  if (!m || m.openalex_id === '') return null;
  let rec = util.findOne(app, 'oa_cache', 'openalex_id = {:id}', { id: m.openalex_id });
  if (rec === null) {
    rec = util.newRecord(app, 'oa_cache');
    rec.set('openalex_id', m.openalex_id);
    rec.set('refs', []);
  }
  rec.set('doi', m.doi || '');
  rec.set('title', String(m.title || '').slice(0, 2000));
  rec.set('year', m.year || 0);
  rec.set('authors', core().authorsShort(m.authors || []).slice(0, 1000));
  rec.set('venue', String(m.container || '').slice(0, 1000));
  rec.set('cited_by', m.cited_by || 0);
  rec.set('type', m.type || '');
  rec.set('oa_url', String(m.oa_pdf_url || m.oa_url || '').slice(0, 2000));
  if (withRefs && Array.isArray(m.referenced)) {
    rec.set('refs', m.referenced.slice(0, 2000));
    rec.set('refs_known', true);
  }
  rec.set('fetched_at', util.nowIso());
  app.save(rec);
  return rec;
}

/** The OpenAlex id of a paper (looked up by DOI or PubMed ID once, then kept). */
function openalexIdOf(app, w) {
  if (w.getString('openalex_id') !== '') return w.getString('openalex_id');
  let m = null;
  if (w.getString('doi') !== '') m = reg().openalexWork(app, 'doi:' + w.getString('doi'));
  else if (w.getString('pmid') !== '') m = reg().openalexWork(app, 'pmid:' + w.getString('pmid'));
  if (m === null || m.openalex_id === '') return '';
  w.set('openalex_id', m.openalex_id);
  app.save(w);
  store(app, m, true);
  return m.openalex_id;
}

/** A cached OpenAlex record with its references (fetched when missing or old). */
function withRefs(app, id) {
  const hit = u().findOne(app, 'oa_cache', 'openalex_id = {:id}', { id: id });
  if (hit !== null && hit.getBool('refs_known') && fresh(hit)) return hit;
  const m = reg().openalexWork(app, id);
  return m !== null ? store(app, m, true) : hit;
}

/** Fill the cache for ids missing from it (50 per call). */
function fillCache(app, ids) {
  const util = u();
  const missing = ids.filter((id) => {
    const r = util.findOne(app, 'oa_cache', 'openalex_id = {:id}', { id: id });
    return r === null || !fresh(r);
  });
  if (missing.length === 0) return;
  for (const m of reg().openalexMany(app, missing)) store(app, m, true);
}

/** Library papers by OpenAlex id or DOI, for "in your library" marks. */
function libraryIndex(app) {
  const idx = { oa: {}, doi: {} };
  for (const r of u().rows(app, "SELECT id, openalex_id, doi FROM works WHERE trashed = FALSE AND (openalex_id != '' OR doi != '')", { id: '', openalex_id: '', doi: '' })) {
    if (r.openalex_id !== '') idx.oa[r.openalex_id] = r.id;
    if (r.doi !== '') idx.doi[r.doi] = r.id;
  }
  return idx;
}

/** citations.map: the citation network around seed papers. */
function map(ctx, p) {
  const util = u();
  const app = ctx.app;
  const seedIds = require(`${__hooks}/lib_export.js`).scope(ctx, p).slice(0, MAX_SEEDS);
  if (seedIds.length === 0) {
    if (!util.has(p, 'works') && !util.has(p, 'collection') && !util.has(p, 'project')) throw util.fail(400, 'Give seed papers: --works, --collection or --project.', 'missing_param');
    throw util.fail(409, 'There are no papers there yet to map citations from.', 'no_seeds');
  }
  const includeCiting = util.bool(p, 'citing', true);
  const seeds = [];
  const unreachable = [];
  const noId = [];
  for (const id of seedIds) {
    const w = core().need(app, 'works', id, 'paper');
    core().guardWork(ctx, w);
    let oid = '';
    try {
      oid = openalexIdOf(app, w);
    } catch (err) {
      if (err && err.code === 'unreachable') {
        unreachable.push(w.id);
        continue;
      }
      throw err;
    }
    if (oid === '') noId.push({ id: w.id, title: w.getString('title') });
    else seeds.push({ work: w, oid: oid });
  }
  const nodes = {};
  const edges = [];
  const touch = (oid, role) => {
    const n = (nodes[oid] = nodes[oid] || { id: oid, roles: {}, refs_from_seeds: 0, cites_seeds: 0 });
    n.roles[role] = true;
    return n;
  };
  for (const s of seeds) {
    touch(s.oid, 'seed');
    let rec = null;
    try {
      rec = withRefs(app, s.oid);
    } catch (err) {
      unreachable.push(s.work.id);
    }
    const refs = rec !== null ? util.jsonOf(rec, 'refs') || [] : [];
    for (const r of refs) {
      touch(r, 'reference').refs_from_seeds++;
      edges.push({ from: s.oid, to: r });
    }
    if (includeCiting) {
      try {
        const citing = reg().openalexCiting(app, s.oid, CITING_PER_SEED);
        for (const m of citing.items) {
          store(app, m, false);
          touch(m.openalex_id, 'citing').cites_seeds++;
          edges.push({ from: m.openalex_id, to: s.oid });
        }
      } catch (err) {
        if (!(err && err.code === 'unreachable')) throw err;
      }
    }
  }
  // Keep the most connected references when there are too many to draw.
  let ids = Object.keys(nodes);
  if (ids.length > MAX_NODES) {
    ids.sort((a, b) => {
      const A = nodes[a];
      const B = nodes[b];
      const score = (n) => (n.roles.seed ? 1e6 : 0) + n.refs_from_seeds * 10 + n.cites_seeds * 10;
      return score(B) - score(A);
    });
    ids = ids.slice(0, MAX_NODES);
  }
  const keep = {};
  for (const id of ids) keep[id] = true;
  try {
    fillCache(app, ids);
  } catch (err) {
    if (!(err && err.code === 'unreachable')) throw err;
  }
  const lib = libraryIndex(app);
  const out = [];
  for (const id of ids) {
    const n = nodes[id];
    const c = util.findOne(app, 'oa_cache', 'openalex_id = {:id}', { id: id });
    const data = c !== null ? cacheOut(c) : { id: id, doi: '', title: '', year: 0, authors: '', venue: '', cited_by: 0, type: '', oa_url: '' };
    out.push(Object.assign(data, { roles: Object.keys(n.roles), refs_from_seeds: n.refs_from_seeds, cites_seeds: n.cites_seeds, work: lib.oa[id] || (data.doi !== '' ? lib.doi[data.doi] || '' : '') }));
  }
  const drawn = edges.filter((e) => keep[e.from] && keep[e.to]);
  const topCited = out.filter((n) => n.roles.indexOf('seed') < 0 && n.refs_from_seeds > 0).sort((a, b) => b.refs_from_seeds - a.refs_from_seeds || b.cited_by - a.cited_by).slice(0, 25);
  const topCiting = out.filter((n) => n.roles.indexOf('seed') < 0 && n.cites_seeds > 0).sort((a, b) => b.cites_seeds - a.cites_seeds || b.cited_by - a.cited_by).slice(0, 25);
  return { seeds: seeds.map((s) => ({ work: s.work.id, openalex_id: s.oid, title: s.work.getString('title') })), nodes: out, edges: drawn, top_cited: topCited, top_citing: topCiting, without_openalex: noId, unreachable: unreachable };
}

/** references.list: a paper's reference list (Crossref when it lists one, else OpenAlex), with library marks. */
function refs(ctx, p) {
  const util = u();
  const app = ctx.app;
  const w = core().work(app, util.req(p, 'work'));
  core().guardWork(ctx, w);
  let rows = app.findRecordsByFilter('work_refs', 'work = {:w}', 'position', 0, 0, { w: w.id });
  if (rows.length === 0 && util.bool(p, 'fetch', true)) {
    try {
      const oid = openalexIdOf(app, w);
      if (oid !== '') {
        const rec = withRefs(app, oid);
        const list = rec !== null ? util.jsonOf(rec, 'refs') || [] : [];
        fillCache(app, list.slice(0, 300));
        app.runInTransaction((tx) => {
          list.slice(0, 300).forEach((id, i) => {
            const c = util.findOne(tx, 'oa_cache', 'openalex_id = {:id}', { id: id });
            const r = util.newRecord(tx, 'work_refs');
            r.set('work', w.id);
            r.set('position', i);
            r.set('openalex_id', id);
            r.set('source', 'openalex');
            if (c !== null) {
              r.set('doi', c.getString('doi'));
              r.set('title', c.getString('title'));
              r.set('year', c.getInt('year'));
              r.set('authors', c.getString('authors'));
              r.set('venue', c.getString('venue'));
            }
            tx.save(r);
          });
        });
        rows = app.findRecordsByFilter('work_refs', 'work = {:w}', 'position', 0, 0, { w: w.id });
      }
    } catch (err) {
      if (!(err && err.code === 'unreachable')) throw err;
      return { work: w.id, refs: [], unreachable: true };
    }
  }
  const lib = libraryIndex(app);
  return {
    work: w.id,
    refs: rows.map((r) => {
      const inLib = r.getString('resolved_work') || (r.getString('openalex_id') !== '' ? lib.oa[r.getString('openalex_id')] || '' : '') || (r.getString('doi') !== '' ? lib.doi[r.getString('doi')] || '' : '');
      return { id: r.id, position: r.getInt('position'), raw: r.getString('raw'), doi: r.getString('doi'), openalex_id: r.getString('openalex_id'), title: r.getString('title'), year: r.getInt('year'), authors: r.getString('authors'), venue: r.getString('venue'), source: r.getString('source'), work: inLib, addable: r.getString('doi') !== '' || r.getString('openalex_id') !== '' };
    }),
  };
}

/** citations.citing: papers citing one paper, most cited first. */
function citing(ctx, p) {
  const util = u();
  const app = ctx.app;
  const w = core().work(app, util.req(p, 'work'));
  core().guardWork(ctx, w);
  const oid = openalexIdOf(app, w);
  if (oid === '') return { work: w.id, citing: [], total: 0 };
  const res = reg().openalexCiting(app, oid, util.int(p, 'limit', 25, 1, 100));
  const lib = libraryIndex(app);
  return {
    work: w.id,
    total: res.total,
    citing: res.items.map((m) => {
      store(app, m, false);
      return { openalex_id: m.openalex_id, doi: m.doi, title: m.title, year: m.year, authors: core().authorsShort(m.authors), venue: m.container, cited_by: m.cited_by, work: lib.oa[m.openalex_id] || (m.doi !== '' ? lib.doi[m.doi] || '' : '') };
    }),
  };
}

module.exports = { map: map, refs: refs, citing: citing, openalexIdOf: openalexIdOf };
