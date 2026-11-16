/// <reference path="../pb_data/types.d.ts" />
/**
 * Market research (fix 4): the market pulse of each thesis sector, one page
 * per sector, and market briefs your AI agent writes on request.
 *
 * Funding rounds come from two structured sources only:
 *   filing  an SEC Form D signal a thesis radar pulled (its amount is the
 *           offering, else the amount sold)
 *   news    a Funding news item that reports a round (round_company, and
 *           round_amount_usd when the article states it), set by a person,
 *           the seed or your AI agent in its digest; never read from words
 * A signal counts under its company's sector; when the company has no sector
 * it counts under every sector of its thesis.
 *
 * market_brief: research.ask stores a report (requested) and asks your AI
 * agent (trigger market_brief { report_id }); it writes the seven sections
 * with numbered citations (research.save, which marks the ask done);
 * agent.cannot marks the report failed. People read, export and delete
 * reports.
 */

const WEEKS = 8;
const MONTHS = 6;
const SECTIONS = [
  ['overview', 'Market overview'],
  ['size', 'Market size'],
  ['trends', 'Trends'],
  ['players', 'Key players'],
  ['funding', 'Recent funding'],
  ['risks', 'Risks'],
  ['implications', 'What it means for the firm'],
];
const SECTION_MAX = 4000;
const CITATIONS_MAX = 40;
const FOUND = ['new', 'candidate', 'added'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function N() {
  return L('lib_markets_news');
}

function iso(s) {
  return String(s || '').replace(' ', 'T');
}

/** The start (ISO) of each of the last n weeks, oldest first; the last one ends now. */
function weekStarts(n) {
  const now = Date.now();
  const out = [];
  for (let i = n; i >= 1; i--) out.push(new Date(now - i * 7 * 86400000).toISOString());
  return out;
}

/** Which week (0 = oldest) an ISO time falls in, or -1. */
function weekOf(starts, at) {
  if (at === '' || at < starts[0]) return -1;
  for (let i = starts.length - 1; i >= 0; i--) if (at >= starts[i]) return i;
  return -1;
}

/** The last n months as 'YYYY-MM', oldest first (this month last). */
function monthKeys(n) {
  const d = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

/** The thesis sectors with their thesis: [{ key, label, thesis, thesis_name, keys (all sectors of that thesis) }]. */
function sectorList(app) {
  const util = u();
  const list = N().sectorsOf(app);
  const keysOf = {};
  for (const t of app.findRecordsByFilter('theses', "status = 'active'", 'sort,name', 0, 0)) {
    const ks = [];
    for (const c of util.jsonOf(t, 'criteria', []) || []) if (c.key === 'sector' && Array.isArray(c.values)) for (const v of c.values) ks.push(String(v || '').trim().toLowerCase());
    keysOf[t.id] = ks;
  }
  return list.map((s) => Object.assign({}, s, { keys: keysOf[s.thesis] || [s.key] }));
}

/** The theses that list each sector: { key: [thesisId] }. */
function thesesBySector(app) {
  const util = u();
  const out = {};
  for (const t of app.findRecordsByFilter('theses', "status = 'active'", 'sort,name', 0, 0))
    for (const c of util.jsonOf(t, 'criteria', []) || [])
      if (c.key === 'sector' && Array.isArray(c.values))
        for (const v of c.values) {
          const k = String(v || '').trim().toLowerCase();
          if (out[k] === undefined) out[k] = [];
          if (out[k].indexOf(t.id) < 0) out[k].push(t.id);
        }
  return out;
}

/**
 * Signals of the theses that list a sector, attributed to it (company sector,
 * else every sector of the thesis): [{ id, at, source, status, name, company,
 * amount_usd, url, kind }].
 */
function sectorSignals(app, key, theses, since, statuses) {
  const util = u();
  if (theses.length === 0) return [];
  const bind = { since: since.replace('T', ' ') };
  const marks = theses.map((t, i) => {
    bind['t' + i] = t;
    return '{:t' + i + '}';
  });
  const st = statuses.map((s) => "'" + s + "'").join(', ');
  const rows = util.rows(
    app,
    "SELECT s.id AS id, s.created AS at, s.source AS source, s.status AS status, s.name AS name, s.domain AS domain, s.company AS company, COALESCE(c.sector, '') AS csector, COALESCE(c.name, '') AS cname, s.facts AS facts, s.source_url AS url, s.kind AS kind FROM signals s LEFT JOIN companies c ON c.id = s.company WHERE s.thesis IN (" +
      marks.join(', ') +
      ') AND s.created >= {:since} AND s.status IN (' +
      st +
      ') ORDER BY s.created DESC LIMIT 2000',
    { id: '', at: '', source: '', status: '', name: '', domain: '', company: '', csector: '', cname: '', facts: '', url: '', kind: '' },
    bind,
  );
  const out = [];
  for (const r of rows) {
    const cs = String(r.csector || '').trim().toLowerCase();
    if (cs !== '' && cs !== key) continue;
    let amount = null;
    try {
      const f = JSON.parse(r.facts || '{}') || {};
      if (f.raise_minor && f.raise_minor.value !== undefined && f.raise_minor.value !== null) amount = Math.round(Number(f.raise_minor.value) / 100);
    } catch {
      amount = null;
    }
    out.push({ id: r.id, at: iso(r.at), source: r.source, status: r.status, name: r.cname || r.name || r.domain, company: r.company, amount_usd: amount !== null && Number.isFinite(amount) ? amount : null, url: r.url, kind: r.kind });
  }
  return out;
}

/** Funding items that report a round in a sector since a time: [{ id, at, company, amount_usd, stage, source, url, title }]. */
function sectorRounds(app, key, since) {
  const util = u();
  return util
    .rows(app, "SELECT id, published_at AS at, round_company AS company, round_amount_usd AS amount, round_stage AS stage, source, url, title FROM news WHERE hidden = FALSE AND category = 'funding' AND round_company != '' AND sector = {:k} AND published_at >= {:s} ORDER BY published_at DESC LIMIT 2000", { id: '', at: '', company: '', amount: 0, stage: '', source: '', url: '', title: '' }, { k: key, s: since })
    .map((r) => ({ id: r.id, at: r.at, company: r.company, amount_usd: r.amount > 0 ? r.amount : null, stage: r.stage, source: r.source, url: r.url, title: r.title }));
}

/** The newest active insight that affects a sector: { id, title, impact, created_at } or null. */
function latestInsight(ctx, key) {
  const util = u();
  const rows = util.rows(ctx.app, "SELECT id FROM news_insights WHERE status = 'active' AND refs LIKE {:t} ORDER BY created DESC LIMIT 5", { id: '' }, { t: '% sector:' + key + ' %' });
  for (const r of rows) {
    const x = L('lib_markets_insights').insightOut(ctx.app, ctx.app.findRecordById('news_insights', r.id));
    if (!x.affects.some((a) => a.kind === 'company' && !N().companyVisible(ctx, a.id, {}))) return { id: x.id, title: x.title, impact: x.impact, created_at: x.created_at };
  }
  return null;
}

/**
 * markets.pulse: one card per thesis sector: news per week and funding
 * rounds found per week (8 weeks), new companies found in those weeks, the
 * latest insight.
 */
function opPulse(ctx) {
  const util = u();
  const app = ctx.app;
  const starts = weekStarts(WEEKS);
  const by = thesesBySector(app);
  const sectors = sectorList(app).map((s) => {
    const news = new Array(WEEKS).fill(0);
    for (const r of util.rows(app, 'SELECT published_at AS at FROM news WHERE hidden = FALSE AND sector = {:k} AND published_at >= {:s}', { at: '' }, { k: s.key, s: starts[0] })) {
      const w = weekOf(starts, r.at);
      if (w >= 0) news[w]++;
    }
    const rounds = new Array(WEEKS).fill(0);
    let usd = 0;
    for (const r of sectorRounds(app, s.key, starts[0])) {
      const w = weekOf(starts, r.at);
      if (w < 0) continue;
      rounds[w]++;
      usd += r.amount_usd || 0;
    }
    const sigs = sectorSignals(app, s.key, by[s.key] || [], starts[0], FOUND.concat(['known', 'dismissed']));
    let found = 0;
    for (const g of sigs) {
      const w = weekOf(starts, g.at);
      if (w < 0) continue;
      if (g.source === 'edgar_form_d') {
        rounds[w]++;
        usd += g.amount_usd || 0;
      }
      if (FOUND.indexOf(g.status) >= 0) found++;
    }
    return {
      key: s.key,
      label: s.label,
      thesis: { id: s.thesis, name: s.thesis_name },
      news_weeks: news,
      rounds_weeks: rounds,
      news_total: news.reduce((a, b) => a + b, 0),
      rounds_total: rounds.reduce((a, b) => a + b, 0),
      usd_total: usd,
      new_companies: found,
      latest_insight: latestInsight(ctx, s.key),
    };
  });
  return { sectors: sectors, weeks: starts.map((w) => w.slice(0, 10)) };
}

/** A company's relation to the firm for the key companies list. */
function relationRows(app, key) {
  const util = u();
  const out = [];
  const seen = {};
  const add = (r, relation) => {
    if (seen[r.id] === true) return;
    seen[r.id] = true;
    out.push({ id: r.id, name: r.name, relation: relation, detail: r.detail || '' });
  };
  for (const r of util.rows(app, "SELECT DISTINCT c.id AS id, c.name AS name, '' AS detail FROM holdings h JOIN companies c ON c.id = h.company WHERE h.deleted_at = '' AND h.status = 'active' AND c.deleted_at = '' AND c.merged_into = '' AND LOWER(c.sector) = {:k} ORDER BY c.name", { id: '', name: '', detail: '' }, { k: key })) add(r, 'portfolio');
  for (const r of util.rows(app, "SELECT c.id AS id, c.name AS name, d.stage AS detail FROM deals d JOIN pipelines p ON p.id = d.pipeline JOIN companies c ON c.id = d.company WHERE p.kind = 'deal_flow' AND d.deleted_at = '' AND d.status IN ('open', 'hold') AND c.deleted_at = '' AND c.merged_into = '' AND LOWER(c.sector) = {:k} ORDER BY d.updated DESC LIMIT 40", { id: '', name: '', detail: '' }, { k: key })) add(r, 'pipeline');
  for (const r of util.rows(app, "SELECT DISTINCT c.id AS id, c.name AS name, '' AS detail FROM map_entries e JOIN maps m ON m.id = e.map JOIN companies c ON c.id = e.company WHERE m.status = 'active' AND e.status = 'active' AND e.role = 'tracked' AND c.deleted_at = '' AND LOWER(c.sector) = {:k} ORDER BY c.name", { id: '', name: '', detail: '' }, { k: key })) add(r, 'tracked');
  return out;
}

/**
 * markets.sector: one sector's research page: funding by month (rounds and
 * dollars), the recent rounds, its market map, key companies, competitors
 * of the portfolio there. News and insights come from news.list --scope
 * sector and news.insights --ref <key>.
 */
function opSector(ctx, p) {
  const util = u();
  const app = ctx.app;
  const key = N().sectorKey(util.req(p, 'sector', 'fintech'));
  const s = sectorList(app).filter((x) => x.key === key)[0];
  if (s === undefined) throw util.fail(404, 'No active thesis lists the sector "' + key + '". Sectors: ' + sectorList(app).map((x) => x.key).join(', ') + '.', 'not_found', { ref: key });
  const months = monthKeys(MONTHS);
  const since = months[0] + '-01T00:00:00.000Z';
  const bucket = {};
  for (const m of months) bucket[m] = { month: m, rounds: 0, usd: 0, with_amount: 0 };
  const rounds = [];
  for (const r of sectorRounds(app, key, since)) {
    const b = bucket[r.at.slice(0, 7)];
    if (b !== undefined) {
      b.rounds++;
      if (r.amount_usd !== null) {
        b.usd += r.amount_usd;
        b.with_amount++;
      }
    }
    rounds.push({ id: r.id, kind: 'news', company: { id: '', name: r.company }, amount_usd: r.amount_usd, stage: r.stage, at: r.at, source: r.source, url: r.url, title: r.title });
  }
  const by = thesesBySector(app);
  for (const g of sectorSignals(app, key, by[key] || [], since, FOUND.concat(['known', 'dismissed']))) {
    if (g.source !== 'edgar_form_d') continue;
    const b = bucket[g.at.slice(0, 7)];
    if (b !== undefined) {
      b.rounds++;
      if (g.amount_usd !== null) {
        b.usd += g.amount_usd;
        b.with_amount++;
      }
    }
    rounds.push({ id: g.id, kind: 'filing', company: { id: g.company, name: g.name }, amount_usd: g.amount_usd, stage: '', at: g.at, source: 'SEC Form D filing', url: g.url, title: '' });
  }
  rounds.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const maps = [];
  for (const t of by[key] || []) for (const m of app.findRecordsByFilter('maps', "thesis = {:t} && status = 'active'", 'created', 0, 0, { t: t })) maps.push({ id: m.id, name: m.getString('name'), thesis: t });
  const thesisIds = by[key] || [];
  const competitors = [];
  if (thesisIds.length > 0) {
    const bind = { k: key };
    const marks = thesisIds.map((t, i) => {
      bind['t' + i] = t;
      return '{:t' + i + '}';
    });
    for (const r of util.rows(app, "SELECT DISTINCT c.id AS id, c.name AS name, c.website AS website, c.domain AS domain, e.segment AS segment, m.segments AS segments, m.name AS map FROM map_entries e JOIN maps m ON m.id = e.map JOIN companies c ON c.id = e.company WHERE m.status = 'active' AND e.status = 'active' AND e.role = 'competitor' AND m.thesis IN (" + marks.join(', ') + ") AND (LOWER(c.sector) = {:k} OR c.sector = '') ORDER BY c.name", { id: '', name: '', website: '', domain: '', segment: '', segments: '', map: '' }, bind)) {
      let seg = r.segment;
      try {
        const x = (JSON.parse(r.segments || '[]') || []).filter((z) => z.key === r.segment)[0];
        if (x) seg = x.label;
      } catch {
        /* the key is shown */
      }
      competitors.push({ id: r.id, name: r.name, website: r.website || (r.domain ? 'https://' + r.domain : ''), segment: seg, map: r.map });
    }
  }
  const counts = { rounds: 0, usd: 0 };
  for (const m of months) {
    counts.rounds += bucket[m].rounds;
    counts.usd += bucket[m].usd;
  }
  return {
    key: key,
    label: s.label,
    thesis: { id: s.thesis, name: s.thesis_name },
    months: months.map((m) => bucket[m]),
    totals: counts,
    rounds: rounds.slice(0, 20),
    rounds_total: rounds.length,
    maps: maps,
    companies: relationRows(app, key),
    competitors: competitors,
    latest_insight: latestInsight(ctx, key),
  };
}

/* ------------------------------------------------------------ research */

function reportRef(app, id) {
  const r = u().byId(app, 'research_reports', String(id || ''));
  if (r === null) throw u().fail(404, 'No market brief ' + id + '. Run research.list.', 'not_found', { ref: id });
  return r;
}

/** The status a person reads: requested (a screen follows the ask live), ready, or failed (your AI agent could not, or nobody picked the ask up in 24 hours). */
function statusOf(app, r) {
  const s = r.getString('status');
  if (s !== 'requested') return s;
  const t = L('lib_agent').track(r, 'market_brief', ['Asked', 'Ready']);
  return t !== null && t.failed ? 'failed' : s;
}

function reportOut(app, r, full) {
  const util = u();
  const R = L('lib_records');
  const sector = r.getString('sector');
  const cites = util.jsonOf(r, 'citations', []) || [];
  const out = {
    id: r.id,
    title: r.getString('title'),
    topic: r.getString('topic'),
    sector: sector,
    sector_label: sector !== '' ? N().sectorLabel(sector) : '',
    status: statusOf(app, r),
    agent: L('lib_agent').view(r, ['market_brief']),
    summary: r.getString('summary'),
    requested_by: R.mini(app, 'members', r.getString('requested_by')),
    created_at: iso(r.getString('created')),
    ready_at: r.getString('ready_at'),
    citations_count: cites.length,
    error: r.getString('error'),
  };
  if (full) {
    const by = {};
    for (const x of util.jsonOf(r, 'sections', []) || []) by[x.key] = x.body;
    out.sections = SECTIONS.map((s) => ({ key: s[0], title: s[1], body: by[s[0]] || '' })).filter((s) => s.body !== '');
    out.citations = cites;
  }
  return out;
}

/** research.list: the market briefs, newest first. */
function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const limit = util.int(p, 'limit', 30, 1, 100);
  const rows = app.findRecordsByFilter('research_reports', '1=1', '-created', limit, 0);
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM research_reports', {});
  return { reports: rows.map((r) => reportOut(app, r, false)), total: total };
}

/** research.get: one market brief with its sections and citations. */
function opGet(ctx, p) {
  const app = ctx.app;
  return { report: reportOut(app, reportRef(app, u().req(p, 'report')), true) };
}

/** research.ask: a person asks your AI agent for a market brief on a topic or a thesis sector. */
function opAsk(ctx, p) {
  const util = u();
  const app = ctx.app;
  let topic = util.squash(util.text(p, 'topic', 200, ''));
  const sectorRaw = util.str(p, 'sector', '');
  let sector = '';
  let sec = null;
  if (sectorRaw !== '') {
    sector = N().sectorKey(sectorRaw);
    sec = sectorList(app).filter((x) => x.key === sector)[0] || null;
    if (sec === null) throw util.fail(404, 'No active thesis lists the sector "' + sectorRaw + '". Sectors: ' + sectorList(app).map((x) => x.key).join(', ') + '.', 'not_found', { param: 'sector' });
  }
  if (topic === '' && sec === null) throw util.fail(400, 'Give a topic (e.g. "Embedded payments for vertical software") or a sector.', 'missing_param', { param: 'topic' });
  if (topic === '') topic = sec.label + ' market';
  const title = topic.charAt(0).toUpperCase() + topic.slice(1);
  const rec = util.newRecord(app, 'research_reports');
  rec.set('title', util.clip(title, 200));
  rec.set('topic', topic);
  rec.set('sector', sector);
  rec.set('status', 'requested');
  rec.set('requested_by', ctx.memberId || '');
  L('lib_records').stampWritten(ctx, rec);
  app.save(rec);
  // The report is kept whatever happens to the ask (a demo firm, a cooldown asked again in a minute): its page says so.
  const r = L('lib_agent').requestFor(ctx, 'market_brief', rec, {}, { soft: true });
  L('lib_audit').note(ctx, { collection: 'research_reports', record: rec.id, summary: 'Asked your AI agent for a market brief: ' + title });
  return { report: reportOut(app, app.findRecordById('research_reports', rec.id), false), request: r.request, message: r.refused ? r.message : '' };
}

/** The [n] citation marks in a text. */
function marksIn(text) {
  const out = [];
  const re = /\[(\d{1,2})\]/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.push(Number(m[1]));
  return out;
}

/** research.save: your AI agent writes the brief: the seven sections with [n] marks and the numbered citations. */
function opSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent) throw util.fail(403, 'Your AI agent writes market briefs; people ask for them with research.ask.', 'agent_only');
  const r = reportRef(app, util.req(p, 'report'));
  const rawC = util.list(p, 'citations');
  if (rawC === undefined || rawC.length === 0) throw util.fail(400, 'citations is a JSON list [{"n":1,"title":"...","url":"<link to the source>","source":"Publisher"}]: every fact needs its source.', 'missing_param', { param: 'citations' });
  if (rawC.length > CITATIONS_MAX) throw util.fail(400, 'At most ' + CITATIONS_MAX + ' citations.', 'invalid_param', { param: 'citations' });
  const cites = [];
  const ns = {};
  rawC.forEach((c, i) => {
    const where = 'Citation ' + (i + 1);
    if (c === null || typeof c !== 'object' || Array.isArray(c)) throw util.fail(400, where + ' is {"n","title","url","source"}.', 'invalid_param', { param: 'citations' });
    util.keysOnly(c, ['n', 'title', 'url', 'source'], where);
    const n = Number(c.n);
    if (!Number.isInteger(n) || n < 1 || n > 99 || ns[n] === true) throw util.fail(400, where + ': n is a unique number from 1.', 'invalid_param', { param: 'citations' });
    const url = String(c.url || '').trim();
    if (!/^https?:\/\//i.test(url) || url.length > 1000) throw util.fail(400, where + ': url is the link to the source.', 'invalid_param', { param: 'citations' });
    const title = util.squash(String(c.title || ''));
    if (title === '' || title.length > 300) throw util.fail(400, where + ': title is the source\'s title (1 to 300 characters).', 'invalid_param', { param: 'citations' });
    ns[n] = true;
    cites.push({ n: n, title: title, url: url, source: util.clip(util.squash(String(c.source || '')), 120) });
  });
  cites.sort((a, b) => a.n - b.n);
  const rawS = util.list(p, 'sections');
  if (rawS === undefined) throw util.fail(400, 'sections is a JSON list [{"key":"overview","body":"..."}] with the keys ' + SECTIONS.map((s) => s[0]).join(', ') + '.', 'missing_param', { param: 'sections' });
  const by = {};
  rawS.forEach((x, i) => {
    const where = 'Section ' + (i + 1);
    if (x === null || typeof x !== 'object' || Array.isArray(x)) throw util.fail(400, where + ' is {"key","body"}.', 'invalid_param', { param: 'sections' });
    util.keysOnly(x, ['key', 'body'], where);
    const key = String(x.key || '');
    if (!SECTIONS.some((s) => s[0] === key)) throw util.fail(400, where + ': key is one of ' + SECTIONS.map((s) => s[0]).join(', ') + '.', 'invalid_param', { param: 'sections' });
    const body = String(x.body || '').trim();
    if (body === '' || body.length > SECTION_MAX) throw util.fail(400, where + ' (' + key + '): body is 1 to ' + SECTION_MAX + ' characters.', 'invalid_param', { param: 'sections' });
    for (const n of marksIn(body)) if (ns[n] !== true) throw util.fail(400, where + ' (' + key + ') cites [' + n + '], which is not in citations.', 'invalid_param', { param: 'sections' });
    by[key] = body;
  });
  for (const s of SECTIONS) if (by[s[0]] === undefined) throw util.fail(400, 'The section ' + s[0] + ' (' + s[1] + ') is missing; write "Not enough public information" when there is none.', 'missing_param', { param: 'sections' });
  if (marksIn(by.size).length === 0) throw util.fail(400, 'The size section needs at least one [n] source for its figures.', 'invalid_param', { param: 'sections' });
  const title = util.squash(util.text(p, 'title', 200, ''));
  if (title !== '') r.set('title', title);
  const summary = util.squash(util.text(p, 'summary', 600, ''));
  r.set('summary', summary);
  r.set('sections', SECTIONS.map((s) => ({ key: s[0], body: by[s[0]] })));
  r.set('citations', cites);
  r.set('status', 'ready');
  r.set('ready_at', util.nowIso());
  r.set('error', '');
  app.save(r);
  L('lib_agent').landed(app, 'market_brief', r);
  L('lib_audit').note(ctx, { collection: 'research_reports', record: r.id, summary: 'Wrote the market brief ' + r.getString('title') });
  return { report: reportOut(app, r, false) };
}

/** research.delete: a person removes a market brief (Undo brings it back). */
function opDelete(ctx, p) {
  const app = ctx.app;
  const r = reportRef(app, u().req(p, 'report'));
  const title = r.getString('title');
  app.delete(r);
  L('lib_audit').note(ctx, { collection: 'research_reports', record: '', summary: 'Removed the market brief ' + title });
  return { removed: true };
}

/** agent.cannot on a market brief: the report is marked failed with its reason. */
function onCannot(ctx, rec, reason) {
  const r = u().byId(ctx.app, 'research_reports', rec.id);
  if (r === null || r.getString('status') === 'ready') return;
  r.set('status', 'failed');
  r.set('error', u().clip(String(reason || ''), 400));
  ctx.app.save(r);
}

/** agent.ask --trigger market_brief --record <report>: a brief asked again (it failed, or nobody picked it up). */
function askCheck(ctx, r) {
  L('lib_auth').need(ctx, 'markets', 'view', 'ask for a market brief');
  if (r.getString('status') === 'ready') throw u().fail(409, 'This market brief is written; ask for a new one with research.ask.', 'conflict');
  return {};
}

/** After a person's agent.ask on a failed brief: it is requested again. */
function onAsked(ctx, rec) {
  const r = ctx.app.findRecordById('research_reports', rec.id);
  if (r.getString('status') === 'failed') {
    r.set('status', 'requested');
    r.set('error', '');
    ctx.app.save(r);
  }
}

module.exports = {
  SECTIONS: SECTIONS,
  weekStarts: weekStarts,
  weekOf: weekOf,
  monthKeys: monthKeys,
  marksIn: marksIn,
  opPulse: opPulse,
  opSector: opSector,
  opList: opList,
  opGet: opGet,
  opAsk: opAsk,
  opSave: opSave,
  opDelete: opDelete,
  onCannot: onCannot,
  askCheck: askCheck,
  onAsked: onAsked,
};
