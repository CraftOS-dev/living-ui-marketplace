/// <reference path="../pb_data/types.d.ts" />
/**
 * Systematic review screening: a protocol (question, criteria, exclusion
 * reasons), records imported from the reading list, a collection, a file or
 * a PubMed search, title-and-abstract screening, full-text screening,
 * conflicts, and the PRISMA 2020 counts.
 *
 * Seats: the person decides; with dual screening a second seat is your AI
 * agent (a blinded second screener whose decision is hidden until the person
 * decides). Every decision of your AI agent carries a basis (a span of
 * words of the abstract), a rationale and a confidence. Duplicates are
 * records with the same DOI or PubMed ID in the review, or marked by a
 * person.
 */

const DEFAULT_REASONS = [
  { key: 'population', label: 'Wrong population' },
  { key: 'intervention', label: 'Wrong intervention or exposure' },
  { key: 'comparator', label: 'Wrong comparator' },
  { key: 'outcome', label: 'Wrong outcome' },
  { key: 'design', label: 'Wrong study design' },
  { key: 'language', label: 'Language' },
  { key: 'no_full_text', label: 'Full text not available' },
  { key: 'other', label: 'Other' },
];

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

function reviewOf(ctx, id) {
  const r = core().need(ctx.app, 'reviews', id, 'review');
  core().guardProjectId(ctx, r.getString('project'));
  return r;
}

function reviewOut(app, r) {
  return { id: r.id, project: r.getString('project'), title: r.getString('title'), question: r.getString('question'), criteria: u().jsonOf(r, 'criteria') || { include: [], exclude: [] }, reasons: u().jsonOf(r, 'reasons') || DEFAULT_REASONS, dual: r.getBool('dual'), blind: r.getBool('blind'), agent_seat: r.getBool('agent_seat'), stage: r.getString('stage'), counts: prisma(app, r), updated: r.getString('updated') };
}

function list(ctx, p) {
  const pr = core().project(ctx.app, u().req(p, 'project'));
  core().guardProject(ctx, pr);
  return { reviews: ctx.app.findRecordsByFilter('reviews', 'project = {:p}', 'sort,created', 0, 0, { p: pr.id }).map((r) => reviewOut(ctx.app, r)) };
}

function cleanCriteria(util, raw) {
  const c = raw || {};
  util.keysOnly(c, ['include', 'exclude'], 'criteria');
  const clean = (l) => (Array.isArray(l) ? l : []).map((x) => util.squash(String(x)).slice(0, 500)).filter((x) => x !== '').slice(0, 50);
  return { include: clean(c.include), exclude: clean(c.exclude) };
}

function cleanReasons(util, raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  list.slice(0, 40).forEach((x, i) => {
    util.keysOnly(x, ['key', 'label'], 'Reason ' + (i + 1));
    const key = String(x.key || '').trim();
    if (!/^[a-z0-9_]{1,40}$/.test(key)) throw util.fail(400, 'Reason ' + (i + 1) + ': key is lower-case letters, digits and _.', 'invalid_param');
    out.push({ key: key, label: util.squash(String(x.label || key)).slice(0, 120) });
  });
  return out.length > 0 ? out : DEFAULT_REASONS;
}

function create(ctx, p) {
  const util = u();
  const pr = core().project(ctx.app, util.req(p, 'project'));
  core().guardProject(ctx, pr);
  const r = util.newRecord(ctx.app, 'reviews');
  r.set('project', pr.id);
  r.set('title', util.squash(util.text(p, 'title', 400, '')) || 'Systematic review');
  r.set('question', util.text(p, 'question', 4000, pr.getString('question')));
  r.set('criteria', cleanCriteria(util, util.has(p, 'criteria') ? util.obj(p, 'criteria') : {}));
  r.set('reasons', util.has(p, 'reasons') ? cleanReasons(util, util.list(p, 'reasons')) : DEFAULT_REASONS);
  r.set('dual', util.bool(p, 'dual', true));
  r.set('blind', util.bool(p, 'blind', true));
  r.set('agent_seat', util.bool(p, 'agent_seat', true));
  r.set('stage', 'setup');
  ctx.app.save(r);
  require(`${__hooks}/lib_activity.js`).write(ctx.app, ctx, { label: 'Started the review ' + r.getString('title'), target: 'reviews', record: r.id, project: pr.id });
  return { review: reviewOut(ctx.app, r) };
}

function update(ctx, p) {
  const util = u();
  const r = reviewOf(ctx, util.req(p, 'review'));
  if (util.has(p, 'title')) r.set('title', util.squash(util.text(p, 'title', 400, '')) || r.getString('title'));
  if (util.has(p, 'question')) r.set('question', util.text(p, 'question', 4000, ''));
  if (util.has(p, 'criteria')) r.set('criteria', cleanCriteria(util, util.obj(p, 'criteria')));
  if (util.has(p, 'reasons')) r.set('reasons', cleanReasons(util, util.list(p, 'reasons')));
  for (const k of ['dual', 'blind', 'agent_seat']) if (util.has(p, k)) r.set(k, util.bool(p, k, true));
  if (util.has(p, 'stage')) r.set('stage', util.oneOf(p, 'stage', ['setup', 'title_abstract', 'full_text', 'done'], 'setup'));
  ctx.app.save(r);
  return { review: reviewOut(ctx.app, r) };
}

function remove(ctx, p) {
  const r = reviewOf(ctx, u().req(p, 'review'));
  ctx.app.delete(r);
  return { deleted: true };
}

/* -------------------------------------------------------------- records */

function addRecords(tx, ctx, r, log, list) {
  const util = u();
  let added = 0;
  let dups = 0;
  let sort = util.count(tx, 'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM review_records WHERE review = {:r}', { r: r.id });
  for (const m of list) {
    const rec = util.newRecord(tx, 'review_records');
    rec.set('review', r.id);
    rec.set('import_log', log.id);
    rec.set('title', String(m.title || '(no title)').slice(0, 2000));
    rec.set('authors', (m.authors || []).slice(0, 50));
    rec.set('year', m.year || 0);
    rec.set('venue', String(m.venue || '').slice(0, 1000));
    rec.set('abstract', String(m.abstract || '').slice(0, 40000));
    rec.set('doi', String(m.doi || '').toLowerCase());
    rec.set('pmid', String(m.pmid || ''));
    rec.set('source_db', log.getString('source_db'));
    rec.set('work', m.work || '');
    rec.set('ta', 'pending');
    rec.set('ft', 'none');
    rec.set('sort', sort++);
    let dup = null;
    if (rec.getString('doi') !== '') dup = util.findOne(tx, 'review_records', "review = {:r} && doi = {:d} && dup_of = ''", { r: r.id, d: rec.getString('doi') });
    if (dup === null && rec.getString('pmid') !== '') dup = util.findOne(tx, 'review_records', "review = {:r} && pmid = {:p} && dup_of = ''", { r: r.id, p: rec.getString('pmid') });
    if (dup !== null) {
      rec.set('dup_of', dup.id);
      dups++;
    }
    tx.save(rec);
    added++;
  }
  log.set('count', list.length);
  log.set('added', added - dups);
  tx.save(log);
  if (r.getString('stage') === 'setup') {
    r.set('stage', 'title_abstract');
    tx.save(r);
  }
  return { added: added, duplicates: dups };
}

/**
 * screen.import: records into a review, from --works, --collection or the
 * project's reading list (--from reading_list), a file (--import id from
 * import.preview), or a PubMed search (--pubmed "query").
 */
function importRecords(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = reviewOf(ctx, util.req(p, 'review'));
  let list = [];
  let source = util.text(p, 'source_db', 80, '');
  let query = util.text(p, 'query', 8000, '');
  const W = require(`${__hooks}/lib_works.js`);
  const fromWorks = (ids) =>
    ids.map((id) => {
      const w = app.findRecordById('works', id);
      return { title: w.getString('title'), authors: util.jsonOf(w, 'authors') || [], year: w.getInt('year'), venue: w.getString('container'), abstract: w.getString('abstract'), doi: w.getString('doi'), pmid: w.getString('pmid'), work: w.id };
    });
  if (util.str(p, 'pubmed', '') !== '') {
    const q = util.str(p, 'pubmed', '');
    const res = require(`${__hooks}/lib_registry.js`).pubmedSearch(app, q, { rows: util.int(p, 'max', 200, 1, 500) });
    list = res.items.map((m) => ({ title: m.title, authors: m.authors, year: m.year, venue: m.container, abstract: m.abstract, doi: m.doi, pmid: m.pmid, work: '' }));
    source = 'PubMed';
    query = q + ' (' + res.total + ' results, ' + list.length + ' retrieved)';
  } else if (util.str(p, 'import', '') !== '') {
    const b = core().need(app, 'import_batches', util.str(p, 'import', ''), 'import');
    if (b.getString('status') !== 'previewed') throw util.fail(409, 'Preview the file again: that import was already used.', 'invalid_state');
    const items = util.jsonOf(b, 'entries') || [];
    list = items.map((it) => ({ title: it.fields.title || '', authors: it.fields.authors || [], year: it.fields.year || 0, venue: it.fields.container || '', abstract: it.fields.abstract || '', doi: it.ids.doi || '', pmid: it.ids.pmid || '', work: '' }));
    source = source || b.getString('filename');
    b.set('status', 'imported');
    b.set('entries', []);
    app.save(b);
  } else {
    const ids = util.str(p, 'from', '') === 'reading_list' ? util.rows(app, "SELECT pw.work AS id FROM project_works pw JOIN works w ON w.id = pw.work WHERE pw.project = {:p} AND w.trashed = FALSE", { id: '' }, { p: r.getString('project') }).map((x) => x.id) : require(`${__hooks}/lib_export.js`).scope(ctx, p);
    list = fromWorks(ids);
    source = source || 'Library';
  }
  void W;
  if (list.length === 0) throw util.fail(400, 'Nothing to import.', 'empty');
  let res = null;
  app.runInTransaction((tx) => {
    const log = util.newRecord(tx, 'import_logs');
    log.set('review', r.id);
    log.set('source_db', source || 'Other');
    log.set('query', query);
    log.set('searched_on', util.day(p, 'searched_on', util.today()));
    log.set('actor', ctx.actor);
    tx.save(log);
    res = addRecords(tx, ctx, tx.findRecordById('reviews', r.id), log, list);
  });
  return Object.assign({ review: reviewOut(app, app.findRecordById('reviews', r.id)) }, res);
}

function recordOut(app, rec, seat, blindFor) {
  const util = u();
  const decs = app.findRecordsByFilter('decisions', 'record = {:r}', 'created', 0, 0, { r: rec.id }).map((d) => ({ id: d.id, stage: d.getString('stage'), seat: d.getString('seat'), value: d.getString('value'), reason: d.getString('reason'), basis_quote: d.getString('basis_quote'), basis_start: d.getInt('basis_start'), basis_end: d.getInt('basis_end'), rationale: d.getString('rationale'), confidence: d.getString('confidence'), actor: d.getString('actor'), created: d.getString('created') }));
  const visible = blindFor ? decs.filter((d) => !(d.stage === blindFor && d.seat === 'agent' && !decs.some((x) => x.stage === blindFor && x.seat === 'person'))) : decs;
  const words = rec.getString('abstract') === '' ? 0 : rec.getString('abstract').split(/\s+/).filter((x) => x !== '').length;
  return {
    id: rec.id,
    title: rec.getString('title'),
    authors_short: core().authorsShort(util.jsonOf(rec, 'authors') || []),
    year: rec.getInt('year'),
    venue: rec.getString('venue'),
    abstract: rec.getString('abstract'),
    abstract_words: words,
    doi: rec.getString('doi'),
    pmid: rec.getString('pmid'),
    source_db: rec.getString('source_db'),
    work: rec.getString('work'),
    dup_of: rec.getString('dup_of'),
    ta: rec.getString('ta'),
    ft: rec.getString('ft'),
    ta_reason: rec.getString('ta_reason'),
    ft_reason: rec.getString('ft_reason'),
    decisions: visible,
    hidden_decisions: decs.length - visible.length,
    seat: seat || '',
  };
}

/** screen.records: records of a review by stage and state. */
function records(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = reviewOf(ctx, util.req(p, 'review'));
  const where = ['review = {:r}'];
  const bind = { r: r.id };
  if (!util.bool(p, 'duplicates', false)) where.push("dup_of = ''");
  else where.push("dup_of != ''");
  const ta = util.oneOf(p, 'ta', ['pending', 'include', 'exclude', 'maybe', 'conflict'], '');
  if (ta !== '') {
    where.push('ta = {:ta}');
    bind.ta = ta;
  }
  const ft = util.oneOf(p, 'ft', ['none', 'pending', 'include', 'exclude', 'conflict'], '');
  if (ft !== '') {
    where.push('ft = {:ft}');
    bind.ft = ft;
  }
  const pg = util.page(p, 100, 1000);
  const recs = app.findRecordsByFilter('review_records', where.join(' && '), 'sort', pg.limit, pg.offset, bind);
  const blind = r.getBool('blind') ? (util.str(p, 'stage', '') || 'title_abstract') : '';
  return { records: recs.map((x) => recordOut(app, x, '', ctx.isAgent ? '' : blind)) };
}

/** screen.next: the next record for a seat at a stage (what that seat has not decided yet). */
function next(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = reviewOf(ctx, util.req(p, 'review'));
  const stage = util.oneOf(p, 'stage', ['title_abstract', 'full_text'], 'title_abstract');
  const seat = ctx.isAgent ? 'agent' : 'person';
  const col = stage === 'title_abstract' ? 'ta' : 'ft';
  const queue = util.oneOf(p, 'queue', ['undecided', 'conflicts'], 'undecided');
  let sql;
  if (queue === 'conflicts') sql = 'SELECT id FROM review_records WHERE review = {:r} AND dup_of = \'\' AND ' + col + " = 'conflict' ORDER BY sort LIMIT 1";
  else sql = 'SELECT id FROM review_records rr WHERE rr.review = {:r} AND rr.dup_of = \'\' AND ' + (stage === 'full_text' ? "rr.ft IN ('pending', 'conflict')" : "rr.ta IN ('pending', 'maybe', 'conflict', 'include', 'exclude')") + ' AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.record = rr.id AND d.stage = {:s} AND d.seat = {:seat}) ORDER BY rr.sort LIMIT 1';
  const row = util.one(app, sql, { id: '' }, { r: r.id, s: stage, seat: seat });
  const left = util.count(app, 'SELECT COUNT(*) AS n FROM review_records rr WHERE rr.review = {:r} AND rr.dup_of = \'\' AND ' + (stage === 'full_text' ? "rr.ft != 'none'" : '1=1') + ' AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.record = rr.id AND d.stage = {:s} AND d.seat = {:seat})', { r: r.id, s: stage, seat: seat });
  if (row === null) return { record: null, left: 0, stage: stage, seat: seat };
  const rec = app.findRecordById('review_records', row.id);
  return { record: recordOut(app, rec, seat, ctx.isAgent ? '' : r.getBool('blind') ? stage : ''), left: left, stage: stage, seat: seat };
}

/** Recompute a record's state at a stage from its decisions. */
function settle(tx, r, rec, stage) {
  const util = u();
  const decs = tx.findRecordsByFilter('decisions', 'record = {:r} && stage = {:s}', '', 0, 0, { r: rec.id, s: stage });
  const by = {};
  for (const d of decs) by[d.getString('seat')] = d;
  const col = stage === 'title_abstract' ? 'ta' : 'ft';
  let state = 'pending';
  let reason = '';
  if (by.final) {
    state = by.final.getString('value') === 'maybe' ? 'include' : by.final.getString('value');
    reason = by.final.getString('reason');
  } else if (by.person) {
    const pv = by.person.getString('value');
    const second = r.getBool('dual') ? by.agent || null : null;
    if (!r.getBool('dual')) {
      state = pv === 'maybe' && stage === 'title_abstract' ? 'maybe' : pv;
      reason = by.person.getString('reason');
    } else if (second === null) state = 'pending';
    else {
      const sv = second.getString('value');
      const inc = (v) => v === 'include' || v === 'maybe';
      if (inc(pv) && inc(sv)) state = pv === 'include' && sv === 'include' ? 'include' : 'maybe';
      else if (pv === 'exclude' && sv === 'exclude') {
        state = 'exclude';
        reason = by.person.getString('reason');
      } else state = 'conflict';
    }
  }
  if (stage === 'title_abstract' && state === 'maybe' && !r.getBool('dual')) state = 'maybe';
  rec.set(col, state);
  rec.set(col + '_reason', reason);
  // Included (or maybe) at title and abstract moves on to full text.
  if (stage === 'title_abstract') rec.set('ft', state === 'include' || state === 'maybe' ? (rec.getString('ft') === 'none' ? 'pending' : rec.getString('ft')) : 'none');
  tx.save(rec);
  void util;
}

/**
 * screen.decide: a decision on a record. People decide as the person seat
 * (or --seat final to resolve a conflict); your AI agent decides as the
 * agent seat with --basis_words "a-b" (words of the abstract), --rationale
 * and --confidence.
 */
function decide(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = core().need(app, 'review_records', util.req(p, 'record'), 'record');
  const r = reviewOf(ctx, rec.getString('review'));
  const stage = util.oneOf(p, 'stage', ['title_abstract', 'full_text'], 'title_abstract');
  const value = util.oneOf(p, 'value', ['include', 'exclude', 'maybe'], '');
  if (value === '') throw util.fail(400, 'value is include, exclude or maybe', 'missing_param');
  if (stage === 'full_text' && value === 'maybe') throw util.fail(400, 'At full text the decision is include or exclude.', 'invalid_param');
  let seat = 'person';
  if (ctx.isAgent) {
    if (!r.getBool('agent_seat')) throw util.fail(403, 'This review does not have your AI agent as a screener.', 'agent_not_permitted');
    seat = 'agent';
  } else if (util.str(p, 'seat', '') === 'final') seat = 'final';
  const reasons = (util.jsonOf(r, 'reasons') || DEFAULT_REASONS).map((x) => x.key);
  const reason = util.str(p, 'reason', '');
  if (reason !== '' && reasons.indexOf(reason) < 0) throw util.fail(400, 'reason is one of: ' + reasons.join(', '), 'invalid_param');
  if (value === 'exclude' && stage === 'full_text' && reason === '') throw util.fail(400, 'A full-text exclusion needs its reason (PRISMA reports them).', 'missing_param', { param: 'reason' });
  let bStart = 0;
  let bEnd = 0;
  let bQuote = '';
  if (seat === 'agent') {
    const abs = rec.getString('abstract');
    const span = util.str(p, 'basis_words', '');
    const rationale = util.text(p, 'rationale', 8000, '');
    const confidence = util.oneOf(p, 'confidence', ['low', 'medium', 'high', 'very_high'], '');
    if ((abs !== '' && span === '') || rationale === '' || confidence === '') throw util.fail(400, 'Your AI agent decides with --basis_words "a-b" (word numbers of the abstract' + (abs === '' ? '; this record has no abstract, so it can be left out' : '') + '), --rationale and --confidence.', 'decision_needs_basis');
    if (span !== '' && abs === '') throw util.fail(400, 'This record has no abstract, so it has no words to point at: leave --basis_words out and say what you decided from in --rationale.', 'anchor_out_of_range');
    if (span !== '') {
      const m = /^(\d+)(?:-(\d+))?$/.exec(span);
      const ws = [];
      const re = /\S+/g;
      let mm;
      while ((mm = re.exec(abs)) !== null) ws.push([mm.index, mm.index + mm[0].length]);
      const a = m ? Number(m[1]) : 0;
      const b = m && m[2] ? Number(m[2]) : a;
      if (m === null || a < 1 || b < a || b > ws.length) throw util.fail(400, 'basis_words must be "a-b" within 1 to ' + ws.length + '.', 'anchor_out_of_range');
      bStart = ws[a - 1][0];
      bEnd = ws[b - 1][1];
      bQuote = abs.slice(bStart, bEnd);
    }
  }
  let d = null;
  app.runInTransaction((tx) => {
    d = util.findOne(tx, 'decisions', 'record = {:r} && stage = {:s} && seat = {:seat}', { r: rec.id, s: stage, seat: seat }) || util.newRecord(tx, 'decisions');
    d.set('review', r.id);
    d.set('record', rec.id);
    d.set('stage', stage);
    d.set('seat', seat);
    d.set('value', value);
    d.set('reason', reason);
    d.set('basis_start', bStart);
    d.set('basis_end', bEnd);
    d.set('basis_quote', bQuote);
    d.set('rationale', util.text(p, 'rationale', 8000, ''));
    d.set('confidence', util.oneOf(p, 'confidence', ['low', 'medium', 'high', 'very_high'], ''));
    d.set('actor', ctx.actor);
    tx.save(d);
    settle(tx, tx.findRecordById('reviews', r.id), tx.findRecordById('review_records', rec.id), stage);
  });
  const fresh = app.findRecordById('review_records', rec.id);
  return { record: recordOut(app, fresh, seat, ''), state: stage === 'title_abstract' ? fresh.getString('ta') : fresh.getString('ft') };
}

/** screen.undo-decision: take back this seat's decision on a record. */
function undoDecision(ctx, p) {
  const util = u();
  const app = ctx.app;
  const rec = core().need(app, 'review_records', util.req(p, 'record'), 'record');
  const r = reviewOf(ctx, rec.getString('review'));
  const stage = util.oneOf(p, 'stage', ['title_abstract', 'full_text'], 'title_abstract');
  const seat = ctx.isAgent ? 'agent' : util.str(p, 'seat', '') === 'final' ? 'final' : 'person';
  app.runInTransaction((tx) => {
    const d = util.findOne(tx, 'decisions', 'record = {:r} && stage = {:s} && seat = {:seat}', { r: rec.id, s: stage, seat: seat });
    if (d !== null) tx.delete(tx.findRecordById('decisions', d.id));
    settle(tx, tx.findRecordById('reviews', r.id), tx.findRecordById('review_records', rec.id), stage);
  });
  return { ok: true };
}

/** screen.mark-duplicate: a person marks a record as a duplicate of another (or clears it). */
function markDuplicate(ctx, p) {
  const util = u();
  const rec = core().need(ctx.app, 'review_records', util.req(p, 'record'), 'record');
  reviewOf(ctx, rec.getString('review'));
  const of = util.str(p, 'of', '');
  if (of !== '') {
    const o = core().need(ctx.app, 'review_records', of, 'record');
    if (o.getString('review') !== rec.getString('review') || o.id === rec.id) throw util.fail(400, 'Pick another record of the same review.', 'invalid_param');
  }
  rec.set('dup_of', of);
  ctx.app.save(rec);
  return { ok: true };
}

/* --------------------------------------------------------------- PRISMA */

function prisma(app, r) {
  const util = u();
  const q = (sql) => util.count(app, sql, { r: r.id });
  const bySource = util.plain(util.rows(app, 'SELECT source_db, COALESCE(SUM(count), 0) AS n FROM import_logs WHERE review = {:r} GROUP BY source_db', { source_db: '', n: 0 }, { r: r.id }));
  const reasons = util.plain(util.rows(app, "SELECT ft_reason AS reason, COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ft = 'exclude' GROUP BY ft_reason", { reason: '', n: 0 }, { r: r.id }));
  return {
    identified: q('SELECT COUNT(*) AS n FROM review_records WHERE review = {:r}'),
    by_source: bySource,
    duplicates: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of != ''"),
    screened: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = ''"),
    ta_pending: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ta = 'pending'"),
    ta_conflict: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ta = 'conflict'"),
    ta_excluded: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ta = 'exclude'"),
    sought: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ft != 'none'"),
    ft_pending: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ft = 'pending'"),
    ft_conflict: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ft = 'conflict'"),
    assessed: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ft IN ('include', 'exclude')"),
    ft_excluded: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ft = 'exclude'"),
    ft_reasons: reasons,
    included: q("SELECT COUNT(*) AS n FROM review_records WHERE review = {:r} AND dup_of = '' AND ft = 'include'"),
  };
}

/** Cohen's kappa between the person and the agent seat at a stage. */
function kappa(app, r, stage) {
  const util = u();
  const pairs = util.rows(app, "SELECT p.value AS a, g.value AS b FROM decisions p JOIN decisions g ON g.record = p.record AND g.stage = p.stage AND g.seat = 'agent' WHERE p.review = {:r} AND p.stage = {:s} AND p.seat = 'person'", { a: '', b: '' }, { r: r.id, s: stage });
  const n = pairs.length;
  if (n === 0) return { n: 0, kappa: null, agreement: null };
  const cats = ['include', 'exclude', 'maybe'];
  const bin = (v) => (v === 'maybe' ? 'include' : v);
  let agree = 0;
  const ca = {};
  const cb = {};
  for (const p of pairs) {
    const a = bin(p.a);
    const b = bin(p.b);
    if (a === b) agree++;
    ca[a] = (ca[a] || 0) + 1;
    cb[b] = (cb[b] || 0) + 1;
  }
  const po = agree / n;
  let pe = 0;
  for (const c of cats) pe += ((ca[c] || 0) / n) * ((cb[c] || 0) / n);
  const k = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { n: n, kappa: Math.round(k * 1000) / 1000, agreement: Math.round(po * 1000) / 1000 };
}

/** screen.summary: PRISMA counts and agreement for a review. */
function summary(ctx, p) {
  const r = reviewOf(ctx, u().req(p, 'review'));
  return { review: reviewOut(ctx.app, r), prisma: prisma(ctx.app, r), agreement: { title_abstract: kappa(ctx.app, r, 'title_abstract'), full_text: kappa(ctx.app, r, 'full_text') } };
}

/** screen.export: every record with its decisions as CSV. */
function exportCsv(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = reviewOf(ctx, util.req(p, 'review'));
  const esc = (s) => {
    let v = String(s === undefined || s === null ? '' : s);
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const lines = [['Title', 'Authors', 'Year', 'DOI', 'PMID', 'Source', 'Duplicate of', 'Title/abstract', 'TA reason', 'Full text', 'FT reason', 'Person TA', 'Agent TA', 'Agent TA confidence', 'Person FT', 'Agent FT'].map(esc).join(',')];
  for (const rec of app.findRecordsByFilter('review_records', 'review = {:r}', 'sort', 0, 0, { r: r.id })) {
    const d = {};
    for (const x of app.findRecordsByFilter('decisions', 'record = {:r}', '', 0, 0, { r: rec.id })) d[x.getString('stage') + ':' + x.getString('seat')] = x;
    const v = (k) => (d[k] ? d[k].getString('value') : '');
    lines.push([rec.getString('title'), core().authorsShort(util.jsonOf(rec, 'authors') || []), rec.getInt('year') || '', rec.getString('doi'), rec.getString('pmid'), rec.getString('source_db'), rec.getString('dup_of'), rec.getString('ta'), rec.getString('ta_reason'), rec.getString('ft'), rec.getString('ft_reason'), v('title_abstract:person'), v('title_abstract:agent'), d['title_abstract:agent'] ? d['title_abstract:agent'].getString('confidence') : '', v('full_text:person'), v('full_text:agent')].map(esc).join(','));
  }
  return { filename: (r.getString('title') || 'review').replace(/[^A-Za-z0-9 _-]/g, '') + '.csv', content: '﻿' + lines.join('\r\n') + '\r\n' };
}

module.exports = { DEFAULT_REASONS: DEFAULT_REASONS, list: list, create: create, update: update, remove: remove, importRecords: importRecords, records: records, next: next, decide: decide, undoDecision: undoDecision, markDuplicate: markDuplicate, summary: summary, exportCsv: exportCsv, prisma: prisma, kappa: kappa };
