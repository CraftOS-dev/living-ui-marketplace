/// <reference path="../pb_data/types.d.ts" />
/**
 * Market maps (SPEC 7.12, REPORT Table 30 rows 5 and 6): a landscape of
 * companies, segments as columns, each company a tile coloured by its
 * relation to the firm:
 *
 *   portfolio   an invested deal, or a holding the reader may see (lib_portfolio.holdingsFor: fund scope)
 *   pipeline    an open or held deal
 *   passed      a passed or lost deal
 *   tracked | competitor   the entry's own role (set by a person or proposed)
 *
 * The first three are computed from the firm's records on every read (deals
 * the reader may not see are left out and counted in `hidden`); only
 * tracked and competitor are stored. Every add, move and removal is kept in
 * the entry's dated `moves`, so maps.get --as_of shows the map as it was on
 * any day (last quarter's map beside today's).
 *
 * People place tiles directly (maps.place: add, drag to another segment,
 * remove). Your AI agent proposes them (maps.propose, kind map_entries,
 * each with its source): a kernel proposal a person accepts from Next, one
 * by one, or all of a map at once (maps.accept). The owner may promote
 * map_entries to automatic. Trigger map_refresh { map_id } asks your AI agent (Refresh, or weekly per
 * map for new tiles and moves.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

const ROLES = ['tracked', 'competitor'];
const RELATIONS = ['portfolio', 'pipeline', 'passed', 'tracked', 'competitor'];
const MAX_SEGMENTS = 12;
const MAX_ENTRIES = 400;

/* -------------------------------------------------------------- lookups */

/** A map by id or name, or by its thesis (id, name or a unique part of it: "fintech"): that thesis's active map. */
function mapRef(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') throw util.fail(400, 'map is required (its id or name, or its thesis).', 'missing_param', { param: 'map' });
  const m = util.byId(app, 'maps', r);
  if (m !== null) return m;
  const named = util.rows(app, 'SELECT id FROM maps WHERE LOWER(name) = LOWER({:n}) LIMIT 2', { id: '' }, { n: r });
  if (named.length === 1) return app.findRecordById('maps', named[0].id);
  let thesis = null;
  try {
    thesis = L('lib_theses').thesisRef(app, r);
  } catch (err) {
    if (err && err.status === 409) throw err;
  }
  if (thesis !== null) {
    const ms = util.findMany(app, 'maps', "thesis = {:t} && status = 'active'", 'sort,created', 2, { t: thesis.id });
    if (ms.length >= 1) return ms[0];
    throw util.fail(404, 'The thesis ' + thesis.getString('name') + ' has no map yet. maps.save --thesis ' + thesis.id + ' --name "..." --segments \'[...]\' proposes one.', 'no_map', { thesis: thesis.id, matches: [] });
  }
  const part = util.rows(app, "SELECT id, name FROM maps WHERE name LIKE {:q} ESCAPE '\\' LIMIT 5", { id: '', name: '' }, { q: util.like(r) });
  if (part.length === 1 && r.length >= 3) return app.findRecordById('maps', part[0].id);
  if (part.length > 1) throw L('lib_refs').ambiguous('maps', r, part, 'Pass the full name or the id.', { param: 'map' });
  throw L('lib_refs').notFound('map', r, L('lib_refs').matches(app, 'maps', 'name', r), 'maps.list', { param: 'map' });
}

function segmentsOf(m) {
  return u().jsonOf(m, 'segments', []) || [];
}

/** A segment's key from its key or label (any case); 400 naming the segments. */
function segKey(segs, ref) {
  const util = u();
  const r = String(ref || '').trim().toLowerCase();
  if (r === '') throw util.fail(400, 'segment is required: one of ' + segs.map((s) => s.label).join(', ') + '.', 'missing_param', { param: 'segment', allowed: segs.map((s) => s.key) });
  const hit = segs.filter((s) => s.key === r || s.label.toLowerCase() === r)[0];
  if (!hit) throw util.fail(400, 'No segment "' + ref + '" on this map. Segments: ' + segs.map((s) => s.label + ' (' + s.key + ')').join(', ') + '.', 'invalid_param', { param: 'segment', allowed: segs.map((s) => s.key) });
  return hit.key;
}

/** Segments from a list of labels or {key, label}; keys kept, new keys from the label. */
function cleanSegments(raw, current) {
  const util = u();
  let list = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      throw util.fail(400, 'segments is a JSON list of labels, e.g. ["Payments","Lending"].', 'invalid_param', { param: 'segments' });
    }
  }
  if (!Array.isArray(list) || list.length === 0) throw util.fail(400, 'segments is a JSON list of 1 to ' + MAX_SEGMENTS + ' labels.', 'invalid_param', { param: 'segments' });
  if (list.length > MAX_SEGMENTS) throw util.fail(400, 'At most ' + MAX_SEGMENTS + ' segments.', 'too_many');
  const cur = current || [];
  const out = [];
  for (const x of list) {
    const label = util.squash(typeof x === 'string' ? x : x && x.label);
    if (label === '' || label.length > 40) throw util.fail(400, 'A segment label is 1 to 40 characters.', 'invalid_param', { param: 'segments' });
    let key = typeof x === 'object' && x !== null && typeof x.key === 'string' && x.key !== '' ? x.key : '';
    if (key === '') {
      const same = cur.filter((s) => s.label.toLowerCase() === label.toLowerCase())[0];
      key = same ? same.key : util.slug(label).replace(/-/g, '_').slice(0, 40) || 'segment';
    }
    if (!/^[a-z0-9_]{1,40}$/.test(key)) throw util.fail(400, 'Segment key "' + key + '" is lower case letters, digits and _.', 'invalid_param', { param: 'segments' });
    let k = key;
    for (let i = 2; out.some((s) => s.key === k); i++) k = key + '_' + i;
    if (out.some((s) => s.label.toLowerCase() === label.toLowerCase())) throw util.fail(400, 'Two segments are called ' + label + '.', 'invalid_param', { param: 'segments' });
    out.push({ key: k, label: label });
  }
  return out;
}

/* ------------------------------------------------------------ relations */

/** { companyId: { relation, deal } } from the deals ctx may see and the holdings; plus hidden. */
function relationsFor(ctx, companyIds) {
  const util = u();
  const app = ctx.app;
  const out = {};
  let hidden = 0;
  if (companyIds.length === 0) return { by: out, hidden: 0 };
  const bind = {};
  const marks = companyIds.map((id, i) => {
    bind['c' + i] = id;
    return '{:c' + i + '}';
  });
  const vis = L('lib_deals').visibleSql(ctx, 'd');
  const base = "FROM deals d WHERE d.deleted_at = '' AND d.company IN (" + marks.join(',') + ')';
  const total = util.count(app, 'SELECT COUNT(*) AS n ' + base, bind);
  const rows = util.rows(app, 'SELECT d.company AS company, d.status AS status, d.number AS number, d.stage AS stage ' + base + ' AND ' + vis.sql + ' ORDER BY d.updated DESC', { company: '', status: '', number: '', stage: '' }, Object.assign({}, bind, vis.bind));
  hidden = total - rows.length;
  const rank = { portfolio: 3, pipeline: 2, passed: 1 };
  for (const r of rows) {
    const rel = r.status === 'invested' ? 'portfolio' : r.status === 'open' || r.status === 'hold' ? 'pipeline' : r.status === 'passed' || r.status === 'lost' ? 'passed' : '';
    if (rel === '') continue;
    const cur = out[r.company];
    if (!cur || rank[rel] > rank[cur.relation]) out[r.company] = { relation: rel, deal: { number: r.number, stage: r.stage, status: r.status } };
  }
  const PF = L('lib_portfolio');
  for (const id of companyIds) {
    if (out[id] && out[id].relation === 'portfolio') continue;
    const h = PF.holdingsFor(ctx, { company: id }) || [];
    if (h.length > 0) out[id] = { relation: 'portfolio', deal: out[id] ? out[id].deal : null };
  }
  return { by: out, hidden: hidden };
}

/* ----------------------------------------------------------------- views */

/** Where an entry stood on `day`: { active, segment } from its moves. */
function stateOn(moves, day) {
  let seg = '';
  let active = false;
  for (const mv of moves) {
    if (mv.day > day) break;
    seg = mv.to;
    active = mv.to !== '';
  }
  return { active: active, segment: seg };
}

function entryOut(app, e, rel, segment) {
  const util = u();
  const c = L('lib_records').mini(app, 'companies', e.getString('company'));
  return {
    id: e.id,
    company: c,
    segment: segment || e.getString('segment'),
    relation: rel ? rel.relation : e.getString('role'),
    role: e.getString('role'),
    deal: rel ? rel.deal : null,
    note: e.getString('note'),
    source_url: e.getString('source_url'),
    licence: e.getString('licence'),
    added_day: e.getString('added_day'),
    actor: e.getString('actor'),
    position: e.getInt('position'),
    moves: (util.jsonOf(e, 'moves', []) || []).slice(-10),
  };
}

/** Pending map_entries proposals of this map that ctx may act on. */
function pendingFor(ctx, mapId) {
  const util = u();
  const app = ctx.app;
  const Pr = L('lib_proposals');
  const out = [];
  for (const r of util.findMany(app, 'proposals', "status = 'pending' && kind = 'map_entries'", 'created', 300)) {
    const items = util.jsonOf(r, 'items', []) || [];
    const it = items[0];
    if (!it || it.op !== 'maps.propose' || !it.params) continue;
    const m = mapOfParams(app, it.params);
    if (m === null || m.id !== mapId || !Pr.canSee(ctx, r)) continue;
    let company = null;
    try {
      const c = L('lib_records').resolve(app, 'companies', it.params.company);
      company = { id: c.id, name: c.getString('name'), domain: c.getString('domain') };
    } catch {
      company = { id: '', name: String(it.params.name || it.params.company || ''), domain: '' };
    }
    const ev = util.jsonOf(r, 'evidence', null);
    out.push({
      id: r.id,
      label: r.getString('title'),
      company: company,
      segment: it.params.segment ? String(it.params.segment) : '',
      remove: it.params.remove === true || it.params.remove === 'true',
      role: it.params.role || '',
      why: r.getString('why'),
      source_url: it.params.source_url || (ev && ev.url) || '',
      confidence: util.jsonOf(r, 'confidence', null),
      created: r.getString('created'),
    });
  }
  return out;
}

/** The map's refresh ask as a StepTrack (null when never asked). */
function refreshState(m) {
  return L('lib_agent').track(m, 'map_refresh', ['Asked', 'Proposed']);
}

/** The map view; as_of (a day) shows the entries as they stood that day. */
function mapOut(ctx, m, asOf) {
  const util = u();
  const app = ctx.app;
  const day = asOf || '';
  const all = app.findRecordsByFilter('map_entries', day === '' ? "map = {:m} && status = 'active'" : 'map = {:m}', 'position,created', 0, 0, { m: m.id });
  const shown = [];
  for (const e of all) {
    if (day === '') shown.push({ e: e, seg: e.getString('segment') });
    else {
      const s = stateOn(util.jsonOf(e, 'moves', []) || [], day);
      if (s.active) shown.push({ e: e, seg: s.segment });
    }
  }
  const rel = relationsFor(ctx, shown.map((x) => x.e.getString('company')));
  const entries = shown.map((x) => entryOut(app, x.e, rel.by[x.e.getString('company')], x.seg));
  const counts = {};
  for (const r of RELATIONS) counts[r] = 0;
  for (const e of entries) counts[e.relation] = (counts[e.relation] || 0) + 1;
  const history = [];
  for (const e of all) {
    const c = L('lib_records').mini(app, 'companies', e.getString('company'));
    for (const mv of util.jsonOf(e, 'moves', []) || []) history.push({ day: mv.day, at: mv.at, company: c, from: mv.from, to: mv.to, by: mv.by });
  }
  history.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const t = m.getString('thesis') !== '' ? util.byId(app, 'theses', m.getString('thesis')) : null;
  return {
    id: m.id,
    name: m.getString('name'),
    thesis: t ? { id: t.id, name: t.getString('name') } : null,
    segments: segmentsOf(m),
    status: m.getString('status'),
    as_of: day,
    entries: entries,
    counts: counts,
    hidden: rel.hidden,
    proposals: pendingFor(ctx, m.id),
    history: history.slice(0, 30),
    first_day: all.reduce((d, e) => (e.getString('added_day') !== '' && (d === '' || e.getString('added_day') < d) ? e.getString('added_day') : d), ''),
    refresh: refreshState(m),
    last_refresh_at: (L('lib_agent').state(m, 'map_refresh') || {}).done_at || m.getString('last_refresh_at'),
    updated: m.getString('updated'),
  };
}

/* ------------------------------------------------------------------ ops */

function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = [];
  const bind = {};
  const status = util.oneOf(p, 'status', ['active', 'archived', 'all'], 'active');
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  if (util.str(p, 'thesis', '') !== '') {
    where.push('thesis = {:t}');
    bind.t = L('lib_theses').thesisRef(app, util.str(p, 'thesis', '')).id;
  }
  const rows = app.findRecordsByFilter('maps', where.length > 0 ? where.join(' && ') : '1=1', 'sort,name', 0, 0, bind);
  const maps = rows.map((m) => {
    const v = mapOut(ctx, m, '');
    return { id: v.id, name: v.name, thesis: v.thesis, segments: v.segments, status: v.status, entries: v.entries.length, counts: v.counts, hidden: v.hidden, pending: v.proposals.length, refresh: v.refresh, last_refresh_at: v.last_refresh_at, updated: v.updated };
  });
  return { maps: maps, total: maps.length };
}

function opGet(ctx, p) {
  const util = u();
  const asOf = util.str(p, 'as_of', '');
  if (asOf !== '' && !util.isDay(asOf)) throw util.fail(400, 'as_of is a day YYYY-MM-DD.', 'invalid_param', { param: 'as_of' });
  return { map: mapOut(ctx, mapRef(ctx.app, util.req(p, 'map')), asOf) };
}

/** maps.save: add a map (no --map) or change its name, thesis, segments or status. */
function opSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const ref = util.str(p, 'map', '');
  const m0 = ref !== '' ? mapRef(app, ref) : null;
  if (m0 === null && util.str(p, 'name', '') === '') throw util.fail(400, 'A new map needs --name.', 'missing_param', { param: 'name' });
  const rec = m0 !== null ? m0 : util.newRecord(app, 'maps');
  const before = m0 !== null ? { name: m0.getString('name'), segments: segmentsOf(m0), status: m0.getString('status') } : null;
  if (util.has(p, 'name')) {
    const name = util.squash(util.text(p, 'name', 160, ''));
    if (name === '') throw util.fail(400, 'name cannot be empty.', 'invalid_param', { param: 'name' });
    const dup = util.rows(app, 'SELECT id FROM maps WHERE LOWER(name) = LOWER({:n}) AND id != {:x}', { id: '' }, { n: name, x: rec.id || '' });
    if (dup.length > 0) throw util.fail(409, 'There is already a map called ' + name + '.', 'duplicate', { id: dup[0].id });
    rec.set('name', name);
  }
  if (util.has(p, 'thesis')) rec.set('thesis', util.str(p, 'thesis', '') === '' ? '' : L('lib_theses').thesisRef(app, util.str(p, 'thesis', '')).id);
  if (util.has(p, 'segments')) {
    const segs = cleanSegments(util.has(p, 'segments') ? p.segments : [], m0 !== null ? segmentsOf(m0) : []);
    if (m0 !== null) {
      const keys = segs.map((s) => s.key);
      const stranded = app.findRecordsByFilter('map_entries', "map = {:m} && status = 'active'", '', 0, 0, { m: m0.id }).filter((e) => keys.indexOf(e.getString('segment')) < 0);
      if (stranded.length > 0) throw util.fail(409, 'Move or remove the ' + stranded.length + ' companies of the segments you dropped first.', 'conflict', { entries: stranded.map((e) => e.id) });
    }
    rec.set('segments', segs);
  } else if (m0 === null) rec.set('segments', [{ key: 'segment', label: 'Segment' }]);
  const status = util.oneOf(p, 'status', ['active', 'archived'], '');
  if (status !== '') rec.set('status', status);
  else if (m0 === null) rec.set('status', 'active');
  if (util.has(p, 'sort')) rec.set('sort', util.int(p, 'sort', 0, 0, 10000));
  const prov = util.jsonOf(rec, 'prov', {}) || {};
  for (const k of ['name', 'thesis', 'segments', 'status']) if (util.has(p, k)) prov[k] = L('lib_records').provEntry(ctx, util.str(p, 'source_ref', ''));
  rec.set('prov', prov);
  L('lib_records').stampWritten(ctx, rec);
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'maps', record: rec.id, summary: (m0 === null ? 'Added the map ' : 'Changed the map ') + rec.getString('name'), before: before, after: { name: rec.getString('name'), segments: segmentsOf(rec), status: rec.getString('status') } });
  return { map: mapOut(ctx, rec, '') };
}

function previewSave(ctx, params) {
  let m = null;
  try {
    m = params.map ? mapRef(ctx.app, params.map) : null;
  } catch {
    m = null;
  }
  const fields = [];
  for (const k of ['name', 'thesis', 'segments', 'status']) {
    if (params[k] === undefined) continue;
    const before = m === null ? '' : k === 'segments' ? JSON.stringify(segmentsOf(m)) : m.getString(k);
    fields.push({ name: k, before: before, after: typeof params[k] === 'string' ? params[k] : JSON.stringify(params[k]) });
  }
  return { label: m === null ? 'Add the map ' + (params.name || '') : 'Change the map ' + m.getString('name'), target: m === null ? '' : 'maps:' + m.id, fields: fields, notes: [], risk: 'low' };
}

/** The company a placement names: an existing one (id, domain or exact name), or a new one from --name / --website. */
function companyFor(ctx, p) {
  const util = u();
  const R = L('lib_records');
  const ref = util.str(p, 'company', '');
  const name = util.squash(util.text(p, 'name', 200, ''));
  const website = util.text(p, 'website', 500, '');
  if (ref !== '') {
    try {
      return R.resolve(ctx.app, 'companies', ref);
    } catch (err) {
      if (util.statusOf(err) !== 404 || name === '') throw err;
    }
  }
  if (name === '') throw util.fail(400, 'Give --company (id, domain or exact name), or --name (and --website) for a company not in the records yet.', 'missing_param', { param: 'company' });
  const c = R.upsertCompany(ctx, { name: name, website: website || undefined, origin: 'markets', source_ref: util.str(p, 'source_url', '') });
  return ctx.app.findRecordById('companies', c.id);
}

/**
 * Put an active entry at `index` of its segment (0 = top; past the end =
 * last) and number the segment's tiles 0, 1, 2... in that order. Without an
 * index the entry goes last. Only tiles whose number changes are saved.
 */
function placeAt(app, e, index) {
  const others = app.findRecordsByFilter('map_entries', "map = {:m} && segment = {:s} && status = 'active' && id != {:id}", 'position,created', 0, 0, { m: e.getString('map'), s: e.getString('segment'), id: e.id });
  const at = index === null || index === undefined ? others.length : Math.max(0, Math.min(others.length, index));
  const order = others.slice(0, at).concat([e]).concat(others.slice(at));
  order.forEach((x, i) => {
    if (x.id === e.id) {
      if (e.getInt('position') !== i) {
        e.set('position', i);
        app.save(e);
      }
      return;
    }
    if (x.getInt('position') !== i) {
      x.set('position', i);
      app.save(x);
    }
  });
}

/**
 * maps.place (people) and maps.propose (your AI agent: a proposal of kind
 * map_entries; accepted, it runs here as the person): add a company to a
 * segment, move it to another, or remove it (--remove true). Every change
 * is a dated move in the entry's history.
 */
/**
 * The map a placement goes on: --map, or --thesis (its active map; a thesis without a map gets one,
 * named after it, with the given segment as its first: qa-cli RULING CLI-07, one proposal for both).
 */
function placeMap(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (util.str(p, 'map', '') !== '') return mapRef(app, util.str(p, 'map', ''));
  if (util.str(p, 'thesis', '') === '') throw util.fail(400, 'Give --map (id or name) or --thesis (its map, made when it has none).', 'missing_param', { param: 'map' });
  const t = L('lib_theses').thesisRef(app, util.str(p, 'thesis', ''));
  const ms = util.findMany(app, 'maps', "thesis = {:t} && status = 'active'", 'sort,created', 1, { t: t.id });
  if (ms.length > 0) return ms[0];
  const label = util.squash(util.text(p, 'segment', 60, '')) || 'Companies';
  const rec = util.newRecord(app, 'maps');
  rec.set('name', t.getString('name'));
  rec.set('thesis', t.id);
  rec.set('segments', cleanSegments([label], []));
  rec.set('status', 'active');
  rec.set('prov', { name: L('lib_records').provEntry(ctx, util.str(p, 'source_url', '')) });
  L('lib_records').stampWritten(ctx, rec);
  app.save(rec);
  L('lib_audit').note(ctx, { collection: 'maps', record: rec.id, summary: 'Added the map ' + t.getString('name') + ' for its thesis' });
  return rec;
}

/** The map a stored placement names (--map, or its thesis's active map), never made here; null when none. */
function mapOfParams(app, params) {
  try {
    if (params.map) return mapRef(app, params.map);
    if (!params.thesis) return null;
    const t = L('lib_theses').thesisRef(app, params.thesis);
    const ms = u().findMany(app, 'maps', "thesis = {:t} && status = 'active'", 'sort,created', 1, { t: t.id });
    return ms.length > 0 ? ms[0] : null;
  } catch {
    return null;
  }
}

function opPlace(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = placeMap(ctx, p);
  if (m.getString('status') !== 'active') throw util.fail(409, 'The map ' + m.getString('name') + ' is archived.', 'conflict');
  const remove = util.bool(p, 'remove', false);
  const index = util.has(p, 'position') ? util.int(p, 'position', 0, 0, MAX_ENTRIES) : null;
  const sourceUrl = util.text(p, 'source_url', 1000, '');
  if (ctx.isAgent && !remove && !/^https?:\/\//i.test(sourceUrl)) throw util.fail(400, 'source_url is required: the link that shows where this company belongs.', 'missing_param', { param: 'source_url' });
  const segs = segmentsOf(m);
  const seg = remove ? '' : segKey(segs, util.str(p, 'segment', ''));
  const c = companyFor(ctx, p);
  const role = util.oneOf(p, 'role', ROLES, '');
  const day = util.today(app);
  const at = util.nowIso();
  const by = ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system';
  let e = util.findOne(app, 'map_entries', 'map = {:m} && company = {:c}', { m: m.id, c: c.id });
  let summary = '';
  // A tile keeps its place unless it changes segment, comes (back) onto the map or is given a position.
  let reorder = index !== null;
  if (remove) {
    if (e === null || e.getString('status') !== 'active') throw util.fail(404, c.getString('name') + ' is not on the map ' + m.getString('name') + '.', 'not_found');
    const moves = util.jsonOf(e, 'moves', []) || [];
    moves.push({ day: day, at: at, from: e.getString('segment'), to: '', by: by, member: ctx.memberId || '' });
    e.set('moves', moves);
    e.set('status', 'removed');
    e.set('removed_day', day);
    summary = 'Removed ' + c.getString('name') + ' from the map ' + m.getString('name');
  } else {
    const label = segs.filter((s) => s.key === seg)[0].label;
    if (e === null) {
      if (util.count(app, "SELECT COUNT(*) AS n FROM map_entries WHERE map = {:m} AND status = 'active'", { m: m.id }) >= MAX_ENTRIES) throw util.fail(409, 'The map ' + m.getString('name') + ' holds ' + MAX_ENTRIES + ' companies, its limit. Remove some or start another map.', 'too_many');
      e = util.newRecord(app, 'map_entries');
      e.set('map', m.id);
      e.set('company', c.id);
      e.set('segment', seg);
      e.set('role', role || 'tracked');
      e.set('status', 'active');
      e.set('added_day', day);
      e.set('licence', 'public');
      e.set('moves', [{ day: day, at: at, from: '', to: seg, by: by, member: ctx.memberId || '' }]);
      summary = 'Added ' + c.getString('name') + ' to ' + label + ' on the map ' + m.getString('name');
      reorder = true;
    } else {
      const moves = util.jsonOf(e, 'moves', []) || [];
      if (e.getString('status') !== 'active') {
        moves.push({ day: day, at: at, from: '', to: seg, by: by, member: ctx.memberId || '' });
        e.set('status', 'active');
        e.set('removed_day', '');
        if (e.getString('added_day') === '') e.set('added_day', day);
        summary = 'Put ' + c.getString('name') + ' back on the map ' + m.getString('name') + ' (' + label + ')';
        reorder = true;
      } else if (e.getString('segment') !== seg) {
        moves.push({ day: day, at: at, from: e.getString('segment'), to: seg, by: by, member: ctx.memberId || '' });
        summary = 'Moved ' + c.getString('name') + ' to ' + label + ' on the map ' + m.getString('name');
        reorder = true;
      } else if (index !== null) summary = 'Reordered ' + c.getString('name') + ' in ' + label + ' on the map ' + m.getString('name');
      else summary = 'Updated ' + c.getString('name') + ' on the map ' + m.getString('name');
      e.set('moves', moves);
      e.set('segment', seg);
      if (role !== '') e.set('role', role);
    }
  }
  if (util.has(p, 'note')) e.set('note', util.clip(util.squash(util.str(p, 'note', '')), 240));
  if (sourceUrl !== '') e.set('source_url', sourceUrl);
  if (util.has(p, 'licence')) e.set('licence', util.oneOf(p, 'licence', ['public', 'internal_only'], 'public'));
  if (util.has(p, 'source_ref')) e.set('source_ref', util.text(p, 'source_ref', 300, ''));
  const prov = util.jsonOf(e, 'prov', {}) || {};
  prov.segment = L('lib_records').provEntry(ctx, sourceUrl || util.str(p, 'source_ref', ''));
  e.set('prov', prov);
  L('lib_records').stampWritten(ctx, e);
  app.save(e);
  if (!remove && reorder) placeAt(app, e, index);
  L('lib_audit').note(ctx, { collection: 'map_entries', record: e.id, summary: summary });
  const rel = relationsFor(ctx, [c.id]);
  return { entry: entryOut(app, app.findRecordById('map_entries', e.id), rel.by[c.id], ''), summary: summary };
}

/** The before and after of a proposed placement (a moved tile makes an older proposal stale). */
function previewPlace(ctx, params) {
  const util = u();
  const app = ctx.app;
  const m = mapOfParams(app, params);
  let c = null;
  try {
    c = L('lib_records').resolve(app, 'companies', params.company);
  } catch {
    c = null;
  }
  const name = c !== null ? c.getString('name') : String(params.name || params.company || 'a company');
  const segs = m !== null ? segmentsOf(m) : [];
  const labelOf = (k) => {
    const s = segs.filter((x) => x.key === k || x.label.toLowerCase() === String(k || '').toLowerCase())[0];
    return s ? s.label : String(k || '');
  };
  const e = m !== null && c !== null ? util.findOne(app, 'map_entries', "map = {:m} && company = {:c} && status = 'active'", { m: m.id, c: c.id }) : null;
  const remove = params.remove === true || params.remove === 'true';
  const mapName = m !== null ? m.getString('name') : params.map ? String(params.map) : 'a new map for the thesis ' + String(params.thesis || '');
  const before = e !== null ? labelOf(e.getString('segment')) : '';
  const after = remove ? '' : labelOf(params.segment);
  const label = remove ? 'Remove ' + name + ' from ' + mapName : e === null ? 'Add ' + name + ' to ' + after + ' (' + mapName + ')' : 'Move ' + name + ' from ' + before + ' to ' + after + ' (' + mapName + ')';
  return { label: label, target: e !== null ? 'map_entries:' + e.id : m !== null ? 'maps:' + m.id : '', fields: [{ name: 'segment', before: before, after: after }], notes: params.source_url ? [String(params.source_url)] : [], risk: 'low' };
}

/** maps.accept: accept your AI agent's pending proposals for a map (all, or the chosen ones), each as its own undoable change. */
function opAccept(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = mapRef(app, util.req(p, 'map'));
  const chosen = util.list(p, 'proposals');
  const pend = pendingFor(ctx, m.id).filter((x) => chosen === undefined || chosen.length === 0 || chosen.indexOf(x.id) >= 0);
  if (pend.length === 0) throw util.fail(404, 'No proposals waiting for the map ' + m.getString('name') + '.', 'not_found');
  let applied = 0;
  let failed = 0;
  const errors = [];
  for (const x of pend) {
    try {
      const r = L('lib_proposals').accept(ctx, { proposal: x.id });
      applied += r.applied;
      failed += r.failed;
    } catch (err) {
      failed++;
      errors.push({ proposal: x.id, error: String((err && err.message) || err) });
    }
  }
  L('lib_audit').note(ctx, { collection: 'maps', record: m.id, summary: 'Accepted ' + applied + ' map changes for ' + m.getString('name') + (failed > 0 ? ' (' + failed + ' not applied)' : '') });
  return { applied: applied, failed: failed, errors: errors, map: mapOut(ctx, app.findRecordById('maps', m.id), '') };
}

/* -------------------------------------------------------- asks and cron */

/** Weekly (Monday 07:00), while the firm's map_refresh switch is on: ask your AI agent to refresh every active map (trigger map_refresh). */
function cronMaps(app) {
  if (L('lib_mail').demo(app) || !L('lib_agent').policyOn(app, 'map_refresh')) return;
  for (const m of app.findRecordsByFilter('maps', "status = 'active'", 'sort,name', 0, 0)) L('lib_agent').ask(app, 'map_refresh', m, {}, { policy: true });
}

/** agent.ask --trigger map_refresh --record <map>: an active map. */
function refreshCheck(ctx, m) {
  L('lib_auth').need(ctx, 'markets', 'view', 'ask your AI agent to refresh a map');
  if (m.getString('status') !== 'active') throw u().fail(409, 'This map is ' + m.getString('status') + '.', 'conflict');
  return {};
}

module.exports = {
  refreshCheck: refreshCheck,
  ROLES: ROLES,
  RELATIONS: RELATIONS,
  mapRef: mapRef,
  segKey: segKey,
  cleanSegments: cleanSegments,
  relationsFor: relationsFor,
  stateOn: stateOn,
  mapOut: mapOut,
  placeAt: placeAt,
  pendingFor: pendingFor,
  opList: opList,
  opGet: opGet,
  opSave: opSave,
  previewSave: previewSave,
  opPlace: opPlace,
  previewPlace: previewPlace,
  opAccept: opAccept,
  cronMaps: cronMaps,
};
