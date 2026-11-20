// t04: the keyless sources. Part 1 (offline): the pure parsers and filters on saved SEC, Hacker News and
// GitHub answers. Part 2 (live, needs the network; skipped with a note when offline): a radar over
// Form D, Show HN and GitHub pulls real items with a declared User-Agent, the between-run prefetch
// stores items undelivered (run 0) until the next run delivers them, and nothing is pulled twice.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { APP, FIXTURES, fresh, newApi, firm, section, ok, eq, summary } from './lib.mjs';

const require = createRequire(import.meta.url);
const P = require(join(APP, 'pb', 'pb_hooks', 'lib_markets_pull.js'));
const fx = (n) => readFileSync(join(FIXTURES, n), n.endsWith('.xml') && n.startsWith('edgar') ? 'latin1' : 'utf8');

section('EDGAR feed and daily index');
const feed = P.edgarFeed(fx('edgar_feed.xml'), false);
ok(feed.length > 10 && feed.every((e) => e.form === 'D'), 'feed: only form D without amendments (' + feed.length + ')');
const feedA = P.edgarFeed(fx('edgar_feed.xml'), true);
ok(feedA.length > feed.length && feedA.every((e) => e.form === 'D' || e.form === 'D/A'), 'feed with amendments adds D/A, never DEF 14A');
ok(feed.every((e) => /^\d{10}-\d{2}-\d{6}$/.test(e.accession) && /^\d+$/.test(e.cik) && e.link.indexOf('https://www.sec.gov/Archives/edgar/data/') === 0), 'accession, CIK and link from structured fields');
eq(P.edgarDocUrl('0002038636', '0002038636-26-000009'), 'https://www.sec.gov/Archives/edgar/data/2038636/000203863626000009/primary_doc.xml', 'primary document URL');
eq(P.edgarIndexUrl('2026-11-10'), 'https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/form.20261110.idx', 'daily index URL');
const idx = P.edgarIndex(fx('form_idx_head.txt'), false, '2026-11-10');
ok(idx.length >= 30 && idx.every((e) => e.form === 'D' && e.updated === '2026-11-10T00:00:00Z'), 'index: D entries of the day (' + idx.length + ')');
eq(P.daysBetween('2026-11-06', '2026-11-11', 7), ['2026-11-11', '2026-11-10', '2026-11-09'], 'business days after Friday to Wednesday, newest first');

section('Form D documents');
const tech = P.formD(fx('fd_19.xml'));
ok(tech.entity === 'Quintessent Inc.' && tech.industry === 'Other Technology' && tech.state === 'CA' && tech.amendment === false, 'issuer, industry, state');
ok(tech.offering_minor === 4088804400 && tech.people.length > 0 && tech.people[0].roles.length > 0, 'amounts in cents and officers with roles');
eq(P.formDPasses(tech, {}, 2026), { ok: true, reason: null }, 'a tech Form D passes the default filters');
eq(P.formDPasses(tech, { incorporated_within_years: 5 }, 2026), { ok: false, reason: 'too_old' }, 'over five years old is out when the radar wants five');
eq(P.formDPasses(tech, { industries: ['Biotechnology'] }, 2026).reason, 'industry', 'industry filter');
eq(P.formDPasses(tech, { states: ['NY'] }, 2026).reason, 'state', 'state filter');
eq(P.formDPasses(tech, { max_raise_minor: 100000000 }, 2026).reason, 'too_large', 'amount filter');
const fund = P.formD(fx('fd_45.xml'));
eq(P.formDPasses(fund, { industries: P.INDUSTRIES }, 2026).reason, 'pooled_fund', 'a pooled investment fund never passes');
const amended = P.formD(fx('fd_30.xml'));
eq(P.formDPasses(amended, {}, 2026).reason, 'amendment', 'amendments are out unless asked');
eq(P.formDPasses(amended, { amendments: true }, 2026), { ok: true, reason: null }, 'amendments in when asked');
const facts = P.formDFacts(amended);
eq(facts, { raise_minor: { value: 221550400, grade: 'public' }, currency: { value: 'USD', grade: 'public' }, hq_country: { value: 'US', grade: 'public' }, founded_year: { value: 2024, grade: 'public' } }, 'facts in the thesis vocabulary, graded public');
const item = P.formDItem(feed[0], tech);
ok(item.kind === 'raise_filed' && item.payload.entity === tech.entity && item.payload.accession === feed[0].accession, 'the item keeps the parsed document for other radars');
eq(P.formD('<html>not found</html>'), null, 'an error page is not a Form D');

section('Hacker News and GitHub');
const hn = { by: 'bolau', descendants: 69, id: 50457230, score: 152, time: 1794424336, title: 'Show HN: Something', type: 'story', url: 'https://termsheetplease.com/' };
eq(P.hnPasses(hn, { min_points: 10 }), { ok: true, reason: null }, 'enough points');
eq(P.hnPasses(Object.assign({}, hn, { score: 3 }), {}).reason, 'few_points', 'too few points');
eq(P.hnPasses(Object.assign({}, hn, { dead: true }), {}).reason, 'removed', 'dead stories out');
const hi = P.hnItem(hn);
ok(hi.domain === 'termsheetplease.com' && hi.source_url === 'https://news.ycombinator.com/item?id=50457230' && hi.name === '', 'Show HN item: domain from its link, discussion link, no name guessed from the title');
eq(P.hnItem(Object.assign({}, hn, { url: 'https://github.com/acme/tool' })).domain, '', 'a shared host never names a company');
eq(P.githubQuery('payments api', { min_stars: 50, created_within_days: 30 }, '2026-11-12'), 'payments api created:>=2026-10-13 stars:>=50', 'GitHub query: the radar query plus window and stars');
const gi = P.githubItem({ id: 7, full_name: 'acme/rails', html_url: 'https://github.com/acme/rails', description: 'Rails', stargazers_count: 120, homepage: 'https://acmerails.dev', owner: { login: 'acme', type: 'Organization' } });
ok(gi.domain === 'acmerails.dev' && gi.name === 'acme' && gi.payload.stars === 120, 'GitHub item: org name and homepage domain');
eq(P.githubItem({ id: 8, full_name: 'jo/x', owner: { login: 'jo', type: 'User' } }).name, '', 'a personal account is no company name');

section('live pull (network)');
let online = true;
try {
  const r = await fetch('https://hacker-news.firebaseio.com/v0/maxitem.json', { signal: AbortSignal.timeout(8000) });
  online = r.ok;
} catch {
  online = false;
}
if (!online) console.log('  note: offline, live part skipped');
else {
  fresh();
  const api = newApi();
  await firm(api);
  await api.op('settings.update', { modules: '{"markets":{"edgar_limit":8,"hn_limit":8,"github_limit":5}}' }, { as: 'owner' });
  const t = await api.op('theses.save', { name: 'Developer tools', criteria: '[]' }, { as: 'owner' });
  const r = await api.op('radars.save', { thesis: t.thesis.id, sources: '["edgar_form_d","hacker_news","github"]', query: 'developer tools', filters: '{"github":{"min_stars":5,"created_within_days":60},"hacker_news":{"min_points":1},"edgar_form_d":{"incorporated_within_years":0}}' }, { as: 'owner' });
  const pre = await api.op('zzstub.prefetch', {}, { as: 'owner' });
  ok(pre.pending > 0, 'prefetch stored items undelivered (' + pre.pending + ')');
  const hidden = await api.op('signals.list', { radar: r.radar.id, status: 'all' }, { as: 'owner' });
  eq(hidden.total, 0, 'undelivered items are not listed');
  const run = await api.op('radars.run', { radar: r.radar.id }, { as: 'owner' });
  const c = run.counts;
  ok(c.edgar_form_d.error === '' && c.hacker_news.error === '' && c.github.error === '', 'no source error (' + JSON.stringify(c) + ')');
  ok(c.edgar_form_d.pulled >= pre.pending - c.hacker_news.pulled, 'the run delivered the prefetched Form Ds');
  ok(c.hacker_news.pulled > 0 && c.github.pulled > 0, 'Show HN and GitHub pulled');
  const all = await api.op('signals.list', { radar: r.radar.id, status: 'all', limit: 200 }, { as: 'owner' });
  ok(all.total === c.edgar_form_d.pulled + c.hacker_news.pulled + c.github.pulled, 'every pulled item is stored once (' + all.total + ')');
  ok(all.signals.every((s) => s.run === 1 && /^https:\/\//.test(s.source_url)), 'all delivered as run 1 with a source link');
  const fd = all.signals.filter((s) => s.source === 'edgar_form_d');
  ok(fd.length === 0 || fd.every((s) => s.payload.accession && s.payload.entity !== undefined), 'Form D signals keep their filing');
  const soon = await api.call('radars.run', { radar: r.radar.id }, { as: 'agent' });
  ok(soon.status === 409 && soon.body.code === 'too_soon', 'a run right after a run is refused (sources are not hammered)');
  await api.op('zzstub.due', { radar: r.radar.id }, { as: 'owner' });
  await api.op('zzstub.cron-radars', {}, { as: 'owner' });
  const again = await api.op('radars.get', { radar: r.radar.id }, { as: 'owner' });
  ok(again.radar.runs === 2 && again.radar.last_counts.hacker_news.pulled <= 8, 'the scheduled second run pulls only new stories (' + again.radar.last_counts.hacker_news.pulled + ')');
  const all2 = await api.op('signals.list', { radar: r.radar.id, status: 'all', limit: 200 }, { as: 'owner' });
  const ext = all2.signals.map((s) => s.source + ':' + s.ext_id);
  eq(ext.length, new Set(ext).size, 'nothing stored twice');
}

const res = summary('t04_sources');
process.exit(res.failed > 0 ? 1 : 0);
