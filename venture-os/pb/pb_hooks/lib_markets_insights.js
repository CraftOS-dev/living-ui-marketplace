/// <reference path="../pb_data/types.d.ts" />
/**
 * Your AI agent's take on the news (fix 4): 3 to 6 insights a day, each a
 * title, a short analysis, its impact on the firm (positive, negative,
 * watch), the companies, funds, theses or sectors it affects, a suggested
 * next step and the news items it rests on (cited, never invented).
 *
 * Trigger news_insights asks for it when a person asks (news.insights-ask),
 * and daily (cron 08:15, after the digest) while the news_digest switch is
 * on. Your AI agent saves each insight with
 * news.insight-save; people dismiss one with news.insight-dismiss (Undo
 * through the activity). An insight that affects a pipeline company is shown
 * only to readers who may see that company's deal.
 */

const IMPACTS = ['positive', 'negative', 'watch'];
const AFFECT_KINDS = ['company', 'fund', 'thesis', 'sector'];
const PER_JOB = 6;
const WINDOW_DAYS = 7;

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

/** The token a ref filter looks for in `refs` (" kind:id "). */
function token(kind, id) {
  return kind + ':' + id;
}

/** ISO of a PocketBase autodate ("2026-11-12 08:15:00.000Z" -> "2026-11-12T08:15:00.000Z"). */
function iso(s) {
  return String(s || '').replace(' ', 'T');
}

/** What one affect names, resolved: { kind, id, name } (a sector keeps its key as id). */
function resolveAffect(app, a, where) {
  const util = u();
  if (a === null || typeof a !== 'object' || Array.isArray(a)) throw util.fail(400, where + ' is {"kind":"company|fund|thesis|sector","ref":"..."}.', 'invalid_param', { param: 'affects' });
  util.keysOnly(a, ['kind', 'ref'], where);
  const kind = String(a.kind || '');
  const ref = String(a.ref || '').trim();
  if (AFFECT_KINDS.indexOf(kind) < 0) throw util.fail(400, where + ': kind is one of ' + AFFECT_KINDS.join(', ') + '.', 'invalid_param', { param: 'affects' });
  if (ref === '') throw util.fail(400, where + ': ref names the ' + kind + '.', 'invalid_param', { param: 'affects' });
  if (kind === 'company') {
    const c = L('lib_records').resolve(app, 'companies', ref);
    return { kind: kind, id: c.id, name: c.getString('name') };
  }
  if (kind === 'thesis') {
    const t = L('lib_theses').thesisRef(app, ref);
    return { kind: kind, id: t.id, name: t.getString('name') };
  }
  if (kind === 'fund') {
    let e = util.byId(app, 'entities', ref);
    if (e === null) e = util.findOne(app, 'entities', "kind != 'management' && name = {:n}", { n: ref });
    if (e === null || e.getString('kind') === 'management') throw util.fail(404, where + ': no fund "' + ref + '". Run entities.list.', 'not_found', { ref: ref });
    return { kind: kind, id: e.id, name: e.getString('name') };
  }
  const key = N().sectorKey(ref);
  const s = N()
    .sectorsOf(app)
    .filter((x) => x.key === key)[0];
  if (s === undefined) throw util.fail(404, where + ': "' + ref + '" is not a sector of an active thesis. Sectors: ' + N().sectorsOf(app).map((x) => x.key).join(', ') + '.', 'not_found', { ref: ref });
  return { kind: kind, id: key, name: s.label };
}

function newsMini(app, id) {
  const r = u().byId(app, 'news', id);
  if (r === null) return null;
  return { id: r.id, title: r.getString('title'), url: r.getString('url'), source: r.getString('source'), published_at: r.getString('published_at') };
}

function insightOut(app, r) {
  const util = u();
  const ids = util.jsonOf(r, 'news_ids', []) || [];
  return {
    id: r.id,
    title: r.getString('title'),
    analysis: r.getString('analysis'),
    impact: r.getString('impact'),
    affects: util.jsonOf(r, 'affects', []) || [],
    news_ids: ids,
    news: ids.map((id) => newsMini(app, id)).filter((x) => x !== null),
    next_step: r.getString('next_step'),
    created_at: iso(r.getString('created')),
    status: r.getString('status'),
  };
}

/** May ctx read this insight? (every company it affects must be visible to them). */
function visible(ctx, r, cache) {
  if (ctx.ownOnly) return false;
  for (const a of u().jsonOf(r, 'affects', []) || []) if (a.kind === 'company' && !N().companyVisible(ctx, a.id, cache)) return false;
  return true;
}

/** The ref filter of news.insights: the " kind:id " tokens it may match. */
function refTokens(app, ref) {
  const util = u();
  const r = String(ref || '').trim();
  if (r === '') return [];
  const out = [];
  if (util.byId(app, 'news', r) !== null) out.push(token('news', r));
  if (util.byId(app, 'theses', r) !== null) out.push(token('thesis', r));
  if (util.byId(app, 'entities', r) !== null) out.push(token('fund', r));
  else {
    const f = util.findOne(app, 'entities', "kind != 'management' && name = {:n}", { n: r });
    if (f !== null) out.push(token('fund', f.id));
  }
  const key = N().sectorKey(r);
  if (N()
    .sectorsOf(app)
    .some((x) => x.key === key))
    out.push(token('sector', key));
  if (out.length === 0) {
    try {
      out.push(token('company', L('lib_records').resolve(app, 'companies', r).id));
    } catch {
      /* not a company */
    }
  }
  if (out.length === 0) {
    try {
      out.push(token('thesis', L('lib_theses').thesisRef(app, r).id));
    } catch {
      /* not a thesis */
    }
  }
  if (out.length === 0) throw util.fail(404, 'No company, thesis, fund, sector or news item "' + r + '".', 'not_found', { ref: r });
  return out;
}

/** news.insights: your AI agent's take on the news, newest first (dismissed ones left out). */
function opInsights(ctx, p) {
  const util = u();
  const app = ctx.app;
  const limit = util.int(p, 'limit', 6, 1, 30);
  const toks = refTokens(app, util.str(p, 'ref', ''));
  const bind = {};
  let where = "status = 'active'";
  if (toks.length > 0)
    where +=
      ' AND (' +
      toks
        .map((t, i) => {
          bind['t' + i] = '% ' + t + ' %';
          return 'refs LIKE {:t' + i + '}';
        })
        .join(' OR ') +
      ')';
  const ids = util.rows(app, 'SELECT id FROM news_insights WHERE ' + where + ' ORDER BY created DESC, id LIMIT 300', { id: '' }, bind);
  const cache = {};
  const shown = [];
  for (const x of ids) {
    const r = app.findRecordById('news_insights', x.id);
    if (visible(ctx, r, cache)) shown.push(r);
  }
  return { insights: shown.slice(0, limit).map((r) => insightOut(app, r)), total: shown.length, agent: L('lib_agent').view(L('lib_settings').row(app), ['news_insights']) };
}

/** news.insight-save: your AI agent writes one insight, citing the items it rests on. */
function opSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent) throw util.fail(403, 'Your AI agent writes these insights; people dismiss them.', 'agent_only');
  const title = util.squash(util.text(p, 'title', 200, ''));
  if (title === '' || title.length > 120) throw util.fail(400, 'title is the insight in one line (1 to 120 characters).', 'invalid_param', { param: 'title' });
  const analysis = util.squash(util.text(p, 'analysis', 1500, ''));
  if (analysis.length < 20 || analysis.length > 900) throw util.fail(400, 'analysis is two to four sentences (20 to 900 characters) on what happened and what it means for the firm.', 'invalid_param', { param: 'analysis' });
  const impact = util.oneOf(p, 'impact', IMPACTS, '');
  if (impact === '') throw util.fail(400, 'impact is positive, negative or watch.', 'missing_param', { param: 'impact' });
  const rawNews = util.list(p, 'news_ids');
  if (rawNews === undefined || rawNews.length === 0) throw util.fail(400, 'news_ids is a JSON list of the news items the insight rests on (at least one; news.list gives ids). Never write an insight without them.', 'missing_param', { param: 'news_ids' });
  if (rawNews.length > 12) throw util.fail(400, 'At most 12 news items per insight.', 'invalid_param', { param: 'news_ids' });
  const newsIds = [];
  for (const id of rawNews) {
    const r = util.byId(app, 'news', String(id || ''));
    if (r === null || r.getBool('hidden')) throw util.fail(404, 'No news item ' + id + ' (or it was hidden). Cite items from news.list.', 'not_found', { ref: id });
    if (newsIds.indexOf(r.id) < 0) newsIds.push(r.id);
  }
  const rawAffects = util.list(p, 'affects') || [];
  if (rawAffects.length > 8) throw util.fail(400, 'At most 8 affects per insight.', 'invalid_param', { param: 'affects' });
  const affects = [];
  rawAffects.forEach((a, i) => {
    const x = resolveAffect(app, a, 'affects ' + (i + 1));
    if (!affects.some((y) => y.kind === x.kind && y.id === x.id)) affects.push(x);
  });
  const next = util.squash(util.text(p, 'next_step', 400, ''));
  if (next.length > 300) throw util.fail(400, 'next_step is one short sentence (at most 300 characters).', 'invalid_param', { param: 'next_step' });
  // 3 to 6 insights for one ask (trigger news_insights): counted since the firm last asked.
  const asked = ctx.isAgent ? L('lib_agent').state(L('lib_settings').row(app), 'news_insights') : null;
  if (asked !== null && Date.now() - Date.parse(asked.at) < 86400000 && util.count(app, "SELECT COUNT(*) AS n FROM news_insights WHERE status = 'active' AND created >= {:s}", { s: String(asked.at).replace('T', ' ') }) >= PER_JOB) throw util.fail(409, 'You already wrote ' + PER_JOB + ' insights for this ask; 3 to 6 is the rule.', 'too_many');
  const refs = affects.map((a) => token(a.kind, a.id)).concat(newsIds.map((id) => token('news', id)));
  const rec = util.newRecord(app, 'news_insights');
  rec.set('title', title);
  rec.set('analysis', analysis);
  rec.set('impact', impact);
  rec.set('affects', affects);
  rec.set('news_ids', newsIds);
  rec.set('next_step', next);
  rec.set('refs', ' ' + refs.join(' ') + ' ');
  rec.set('status', 'active');
  L('lib_records').stampWritten(ctx, rec);
  app.save(rec);
  if (ctx.isAgent) L('lib_agent').landed(app, 'news_insights', L('lib_settings').row(app));
  L('lib_audit').note(ctx, { collection: 'news_insights', record: rec.id, summary: 'Wrote the insight ' + title });
  return { insight: insightOut(app, rec) };
}

/** news.insight-dismiss: a person takes an insight away (Undo brings it back). */
function opDismiss(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = util.byId(app, 'news_insights', util.req(p, 'id'));
  if (r === null) throw util.fail(404, 'No insight ' + util.str(p, 'id', '') + '. Run news.insights.', 'not_found');
  r.set('status', 'dismissed');
  r.set('dismissed_by', ctx.memberId || '');
  r.set('dismissed_at', util.nowIso());
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'news_insights', record: r.id, summary: 'Dismissed the insight ' + r.getString('title') });
  return { id: r.id, status: 'dismissed' };
}

/** Items of the last 7 days (at least 3 make a take worth asking for). */
function recentCount(app) {
  return u().count(app, 'SELECT COUNT(*) AS n FROM news WHERE hidden = FALSE AND published_at >= {:s}', { s: new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString() });
}

/** agent.ask --trigger news_insights: enough news to write about. */
function askCheck(ctx) {
  L('lib_auth').need(ctx, 'markets', 'view', 'ask your AI agent for its take on the news');
  if (recentCount(ctx.app) < 3) throw u().fail(409, 'There is too little news from the last 7 days to write about (3 items or more). Check the news first.', 'too_little');
  return {};
}

/** news.insights-ask: a person asks your AI agent to read the news and write its take now (trigger news_insights). */
function opAsk(ctx, p) {
  const util = u();
  askCheck(ctx);
  const r = L('lib_agent').requestFor(ctx, 'news_insights', L('lib_settings').row(ctx.app), {}, { again: util.str(p || {}, 'again', '') });
  L('lib_audit').note(ctx, { collection: 'news_insights', record: '', summary: 'Asked your AI agent for its take on the news' });
  return { request: r.request, agent: L('lib_agent').view(L('lib_settings').row(ctx.app), ['news_insights']) };
}

/** Daily, while the firm's news_digest switch is on: ask your AI agent for its take on the week's news (trigger news_insights). */
function cronInsights(app) {
  if (recentCount(app) < 3) return;
  L('lib_agent').ask(app, 'news_insights', L('lib_settings').row(app), {}, { policy: true });
}

module.exports = {
  IMPACTS: IMPACTS,
  token: token,
  insightOut: insightOut,
  opInsights: opInsights,
  opSave: opSave,
  opDismiss: opDismiss,
  opAsk: opAsk,
  cronInsights: cronInsights,
  askCheck: askCheck,
};
