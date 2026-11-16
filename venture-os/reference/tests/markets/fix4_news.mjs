// Fix 4 markets checks on a seeded scratch server: node reference/tests/markets/fix4_news.mjs <app dir> <port>
// The news dashboard reads (news.list filters and paging, news.stats), saving, pictures (news.image,
// news.set-image), your AI agent's take (news.insights, insight-save, insight-dismiss, insights-ask), the
// research pages (markets.pulse, markets.sector) and market briefs (research.ask, save, get, delete).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = process.argv[2] ?? '.';
const PORT = Number(process.argv[3] ?? 3191);
if ((PORT >= 3100 && PORT <= 3179) || PORT >= 3900) throw new Error('refusing port ' + PORT);
const { client } = await import(pathToFileURL(join(APP, 'tools', 'dev', 'api.mjs')).href);
const api = client({ port: PORT, app: APP });
let pass = 0;
let fail = 0;
const ok = (cond, what, extra) => {
  if (cond) pass++;
  else {
    fail++;
    console.log('FAIL ' + what + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : ''));
  }
};
const call = (op, params, as = 'owner') => api.call(op, params, { as });
const J = JSON.stringify;

// news.list: shape, categories, paging, filters
const all = await call('news.list', { scope: 'all', limit: 20 });
ok(all.status === 200 && all.body.items.length === 20, 'news.list all 20', all.body);
const row = all.body.items[0];
for (const k of ['id', 'title', 'url', 'source', 'published_at', 'image_url', 'category', 'category_label', 'about', 'summary', 'snippet', 'topic', 'sector', 'insight_ids', 'saved']) ok(k in row, 'row has ' + k);
ok(typeof all.body.next_cursor === 'string', 'next_cursor given', all.body.next_cursor);
const p2 = await call('news.list', { scope: 'all', limit: 20, cursor: all.body.next_cursor });
ok(p2.status === 200 && p2.body.items.every((n) => !all.body.items.some((m) => m.id === n.id)), 'page 2 has new items');
const bad = await call('news.list', { cursor: 'x1' });
ok(bad.status === 400, 'bad cursor refused');
for (const cat of ['portfolio', 'pipeline', 'competitors', 'funding', 'exits', 'macro', 'policy', 'sectors']) {
  const r = await call('news.list', { scope: 'all', category: cat, limit: 5 });
  ok(r.status === 200 && r.body.items.length > 0 && r.body.items.every((n) => n.category === cat), 'category ' + cat, r.body.items?.map((n) => n.category));
}
const sec = await call('news.list', { scope: 'sector', ref: 'fintech', limit: 10 });
ok(sec.status === 200 && sec.body.items.length > 0 && sec.body.items.every((n) => n.sector === 'fintech'), 'scope sector');
const noref = await call('news.list', { scope: 'sector' });
ok(noref.status === 400 && noref.body.data?.param === 'ref', 'scope sector needs ref');
const q = await call('news.list', { scope: 'all', q: 'Kestrel', limit: 10 });
ok(q.status === 200 && q.body.items.length > 0 && q.body.items.every((n) => /kestrel/i.test(n.title + n.summary + n.topic + n.source)), 'search');
const pics = all.body.items.concat(p2.body.items).filter((n) => n.image_url !== null);
ok(pics.length > 0, 'some items carry pictures');
if (pics.length > 0) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pics[0].image_url}`);
  ok(res.status === 200 && /^image\//.test(res.headers.get('content-type') ?? ''), 'news.image serves without sign-in', res.status);
  ok((res.headers.get('cache-control') ?? '').includes('max-age'), 'news.image is cached');
}
const nopic = all.body.items.concat(p2.body.items).find((n) => n.image_url === null);
if (nopic) ok((await fetch(`http://127.0.0.1:${PORT}/api/ops/news/image?id=${nopic.id}`)).status === 404, 'no picture is 404');

// stats
const st = await call('news.stats', { scope: 'home' });
ok(st.status === 200 && st.body.categories.length === 8 && st.body.topics.length > 0 && st.body.sources.length > 0, 'news.stats', st.body);

// save
const target = all.body.items[1];
ok((await call('news.save', { id: target.id })).status === 200, 'save');
const saved = await call('news.list', { scope: 'all', saved: true });
ok(saved.body.items.length === 1 && saved.body.items[0].id === target.id && saved.body.items[0].saved === true, 'saved view', saved.body.items.map((n) => n.id));
ok((await call('news.list', { scope: 'all', saved: true }, 'partner@venture.test')).body.items.length === 0, 'saves are per person');
ok((await call('news.save', { id: target.id, saved: false })).status === 200, 'unsave');
ok((await call('news.list', { scope: 'all', saved: true })).body.items.length === 0, 'unsaved');
ok((await call('news.save', { id: target.id }, 'agent')).status === 403, 'agent cannot save');

// your AI agent's picture
const dir = mkdtempSync(join(tmpdir(), 'vo-news-'));
const jpg = join(dir, 'lead.jpg');
writeFileSync(jpg, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7), Buffer.from([0xff, 0xd9])]));
const setPic = await call('news.set-image', { id: nopic.id, paths: J([jpg]), source_url: nopic.url }, 'agent');
ok(setPic.status === 200 && setPic.body.item.image_url !== null, 'agent adds a picture', setPic.body);
ok((await call('news.set-image', { id: nopic.id, paths: J([jpg]), source_url: nopic.url })).status === 403, 'people cannot set pictures');
ok((await call('news.set-image', { id: nopic.id, paths: J([jpg]) }, 'agent')).status === 400, 'picture needs its source');

// insights
const ins = await call('news.insights', { limit: 30 });
ok(ins.status === 200 && ins.body.insights.length >= 8 && ins.body.insights.length <= 12, 'seeded insights 8 to 12', ins.body.total);
const one = ins.body.insights[0];
for (const k of ['id', 'title', 'analysis', 'impact', 'affects', 'news_ids', 'news', 'next_step', 'created_at']) ok(k in one, 'insight has ' + k);
ok(one.news.length > 0 && one.news_ids.length > 0, 'insight cites news');
const byFund = await call('news.insights', { ref: 'Larkspur Fund I' });
ok(byFund.status === 200, 'insights by fund name', byFund.body);
const bySector = await call('news.insights', { ref: 'robotics' });
ok(bySector.status === 200 && bySector.body.insights.every((x) => x.affects.some((a) => a.kind === 'sector' && a.id === 'robotics')), 'insights by sector');
const cited = await call('news.list', { scope: 'all', limit: 60 });
ok(cited.body.items.some((n) => n.insight_ids.length > 0), 'news rows list the insights that cite them');
ok((await call('news.insight-save', { title: 'x', analysis: 'A long enough analysis of the market.', impact: 'watch', news_ids: J([row.id]) })).status === 403, 'people cannot write insights');
ok((await call('news.insight-save', { title: 'A point', analysis: 'A long enough analysis of the market.', impact: 'watch', news_ids: J([]) }, 'agent')).status === 400, 'insight needs news');
ok((await call('news.insight-save', { title: 'A point', analysis: 'A long enough analysis of the market.', impact: 'watch', news_ids: J(['nope']) }, 'agent')).status === 404, 'insight cites real news');
const made = await call('news.insight-save', { title: 'Test insight', analysis: 'A long enough analysis of the market, citing one item.', impact: 'positive', affects: J([{ kind: 'sector', ref: 'fintech' }, { kind: 'company', ref: 'kestrelrobotics.com' }]), news_ids: J([row.id]), next_step: 'Read it.' }, 'agent');
ok(made.status === 200 && made.body.insight.affects.length === 2, 'agent writes an insight', made.body);
const dis = await call('news.insight-dismiss', { id: made.body.insight.id });
ok(dis.status === 200, 'dismiss');
ok(!(await call('news.insights', { limit: 30 })).body.insights.some((x) => x.id === made.body.insight.id), 'dismissed is gone');
ok((await call('activity.undo', { entry: dis.body._activity })).status === 200, 'undo dismiss');
ok((await call('news.insights', { limit: 30 })).body.insights.some((x) => x.id === made.body.insight.id), 'undo brings it back');
await call('news.insight-dismiss', { id: made.body.insight.id });
const ask1 = await call('news.insights-ask', {});
const ask2 = await call('news.insights-ask', {});
ok(ask1.status === 200 && ask2.status === 409 && ask2.body.code === 'pending', 'one take at a time: asking again while it waits is refused', [ask1.body, ask2.body]);

// research pages
const pulse = await call('markets.pulse', {});
ok(pulse.status === 200 && pulse.body.sectors.length === 7 && pulse.body.sectors.every((s) => s.news_weeks.length === 8 && s.rounds_weeks.length === 8), 'pulse 7 sectors x 8 weeks');
ok(pulse.body.sectors.every((s) => s.rounds_total > 0 && s.news_total > 0), 'every sector has news and rounds');
const sector = await call('markets.sector', { sector: 'fintech' });
ok(sector.status === 200 && sector.body.months.length === 6 && sector.body.rounds.length > 0 && sector.body.competitors.length > 0 && sector.body.companies.length > 0, 'sector page', sector.body);
ok(sector.body.months.filter((m) => m.rounds > 0).length >= 4, 'funding by month has shape');
ok((await call('markets.sector', { sector: 'nothing' })).status === 404, 'unknown sector 404');

// market briefs
const list = await call('research.list', {});
ok(list.status === 200 && list.body.reports.filter((r) => r.status === 'ready').length >= 2, 'two seeded briefs ready');
const g = await call('research.get', { report: list.body.reports[0].id });
ok(g.status === 200 && g.body.report.sections.length === 7 && g.body.report.citations.length > 0, 'brief has 7 sections and sources');
const asked = await call('research.ask', { topic: 'Grid flexibility software' });
ok(asked.status === 200 && asked.body.report.status === 'requested', 'ask a brief (market_brief with the report)', asked.body);
ok((await call('research.ask', {})).status === 400, 'ask needs a topic or sector');
ok((await call('research.save', { report: asked.body.report.id, sections: '[]', citations: '[]' })).status === 403, 'people cannot write briefs');
const secs = [['overview', 'A [1]'], ['size', 'No figure'], ['trends', 'x'], ['players', 'x'], ['funding', 'x'], ['risks', 'x'], ['implications', 'x']].map(([key, body]) => ({ key, body }));
const cites = J([{ n: 1, title: 'Source', url: 'https://example.com/a', source: 'Example' }]);
ok((await call('research.save', { report: asked.body.report.id, sections: J(secs), citations: cites }, 'agent')).status === 400, 'size needs a source');
secs[1].body = 'USD 1B [2]';
ok((await call('research.save', { report: asked.body.report.id, sections: J(secs), citations: cites }, 'agent')).status === 400, 'marks must exist');
secs[1].body = 'USD 1B [1]';
const saved2 = await call('research.save', { report: asked.body.report.id, sections: J(secs), citations: cites, summary: 'Short.' }, 'agent');
ok(saved2.status === 200 && saved2.body.report.status === 'ready', 'agent writes the brief', saved2.body);
const del = await call('research.delete', { report: asked.body.report.id });
ok(del.status === 200, 'remove a brief');
ok((await call('research.get', { report: asked.body.report.id })).status === 404, 'removed');

console.log(`fix4_news: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
