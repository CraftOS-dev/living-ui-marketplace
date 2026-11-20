// Home on the seeded demo firm (tools/dev/seed_demo.mjs, already loaded on VO_PORT): every block carries
// the story (Next top 5 in rank order with the count, today's meetings, 12 weeks of inbound, this quarter's
// funnel with engine conversions, Fund I's figures from the funds engine, the three shortest runways from
// the portfolio engine with Lumora Energy first), the fund switch, roles and scope, app.today in words, the
// digest lines, Next items of every kind, and the timing of home.summary (warm, server side).
import { newApi, ok, section, summary, DEMO } from './lib.mjs';

const api = newApi();
const O = { as: 'owner' };
const s = await api.op('home.summary', {}, O);

section('Next');
const cnt = await api.op('next.count', {}, O);
ok(s.next.total === cnt.total && s.next.items.length === Math.min(5, cnt.total), `Next: top ${s.next.items.length} of ${s.next.total}, the same count as next.count`);
ok(s.next.items.every((it, i, a) => i === 0 || a[i - 1].rank <= it.rank), 'top items in rank order', s.next.items.map((i) => i.rank));
ok(s.next.items.every((it) => it.actions.length >= 1 && it.actions.length <= 3), 'each top item carries 1 to 3 actions');
const KINDS = ['verdict', 'draft', 'proposal', 'vote', 'decision', 'verify', 'alert', 'condition', 'payment', 'mark', 'candidate', 'note', 'task', 'stall'];
const all = await api.op('next.list', { limit: 200 }, O);
const kinds = new Set(all.items.map((i) => i.kind));
for (const k of KINDS) ok(kinds.has(k), `seeded Next has a ${k} item`);
ok((all.errors ?? []).length === 0, 'no module failed its Next items', all.errors);

section('Today');
ok(s.meetings.length >= 4, `${s.meetings.length} meetings today`, s.meetings.map((m) => m.time + ' ' + (m.company || m.title)));
ok(s.meetings.some((m) => m.company === 'Kestrel Robotics') && s.meetings.some((m) => m.company === 'Orchard AI'), 'board meeting and partner meeting matched to their companies');
const cal = await api.op('calendar.list', {}, O);
ok(cal.events.filter((e) => e.status !== 'cancelled').length === s.meetings.length, "the Today panel (calendar.list) shows the same meetings as home.summary");
ok(cal.events.some((e) => e.brief && e.brief.state === 'ready'), "your AI agent's brief is ready for one meeting");

section('Deal flow');
ok(s.inbound.weeks.length >= 12 && s.inbound.weeks.length <= 14 && s.inbound.total >= 45, `inbound ${s.inbound.total} over ${s.inbound.weeks.length} weeks`, s.inbound.weeks.map((w) => w.count));
ok(s.inbound.weeks.slice(-6).reduce((a, w) => a + w.count, 0) > s.inbound.weeks.slice(-12, -6).reduce((a, w) => a + w.count, 0), 'inbound grows: the last six weeks bring more than the six before');
const f = await api.op('deals.funnel', {}, O);
ok(JSON.stringify(f.stages.map((x) => [x.key, x.label, x.count, x.now, x.conversion_ppm])) === JSON.stringify(s.funnel.stages.map((x) => [x.key, x.label, x.count, x.now, x.conversion_ppm])) && f.cohort === s.funnel.cohort, "the funnel is deals' cohort answer exactly (deals.funnel)");
ok(s.funnel.stages[0].key === 'inbound' && s.funnel.stages[0].count === s.funnel.cohort && s.funnel.stages.every((x, i) => i === 0 || x.count <= s.funnel.stages[i - 1].count), 'first bar Inbound, bars only shrink', s.funnel.stages.map((x) => x.count));
ok(s.funnel.stages.every((x, i) => i === 0 ? x.conversion_ppm === null : x.conversion_ppm === (s.funnel.stages[i - 1].count > 0 ? Math.round((x.count * 1000000) / s.funnel.stages[i - 1].count) : null)), 'each percentage is its bar over the bar before');
ok(s.inbound.weeks.reduce((a, w) => a + w.quarter, 0) === s.inbound.quarter.count && s.inbound.quarter.count === s.funnel.cohort && s.inbound.quarter.key === s.funnel.quarter.key, `the weekly chart agrees with the funnel: this quarter's weeks add up to Inbound (${s.funnel.cohort})`, { weeks: s.inbound.quarter, cohort: s.funnel.cohort });
ok(s.funnel.stages.some((x) => x.conversion_ppm !== null && x.conversion_ppm > 0 && x.conversion_ppm <= 1000000), 'conversions between 0 and 100%');
ok(s.funnel.open >= 25, `${s.funnel.open} open deals`);

section('Funds and portfolio');
ok(s.fund.label === 'Fund I', 'default fund: the one with the most capital called (Fund I)', s.fund.label);
const m1 = await api.op('metrics.fund', { fund: s.fund.id }, O);
ok(m1.metrics.tvpi_e8 === s.fund.tvpi_e8 && m1.metrics.dpi_e8 === s.fund.dpi_e8 && m1.metrics.net_irr_ppm === s.fund.net_irr_ppm, "TVPI, DPI and net IRR are the funds engine's (metrics.fund)", { home: [s.fund.tvpi_e8, s.fund.dpi_e8, s.fund.net_irr_ppm], funds: [m1.metrics.tvpi_e8, m1.metrics.dpi_e8, m1.metrics.net_irr_ppm] });
ok(s.fund.tvpi_e8 > 1e8 && s.fund.dpi_e8 > 0 && s.fund.net_irr_ppm > 0, `Fund I: TVPI ${(s.fund.tvpi_e8 / 1e8).toFixed(2)}x, DPI ${(s.fund.dpi_e8 / 1e8).toFixed(2)}x, net IRR ${(s.fund.net_irr_ppm / 1e4).toFixed(1)}%`);
ok(s.fund.curve.length >= 12 && s.fund.curve[0].value_minor <= 0 && s.fund.curve.at(-1).value_minor > 0, 'J-curve: net value starts below zero and ends above it', s.fund.curve.map((q) => Math.round((q.value_minor ?? 0) / 1e8)));
const f2 = await api.op('home.summary', { fund: 'Fund II' }, O);
ok(f2.fund.label === 'Fund II' && f2.fund.tvpi_e8 < 1e8, `the fund switch: Fund II, early in its J-curve (TVPI ${(f2.fund.tvpi_e8 / 1e8).toFixed(2)}x)`);
ok(f2.runways.companies === 4, 'runways follow the fund scope (Fund II: 4 companies)', f2.runways.companies);
ok(s.runways.rows.length === 3 && s.runways.rows[0].company.name === 'Lumora Energy' && s.runways.rows[0].months < 6, `shortest runways: ${s.runways.rows.map((r) => r.company.name + ' ' + r.months).join(', ')}`);
for (const r of s.runways.rows) {
  const rw = await api.op('kpis.list', { company: r.company.id, keys: '["cash"]' }, O);
  ok(rw.runway && rw.runway.months === r.months, `${r.company.name}: the portfolio engine's runway (${r.months} months)`, rw.runway);
}
ok(s.runways.rows.every((r, i, a) => i === 0 || a[i - 1].months <= r.months), 'runways shortest first');
const alerts = await api.op('alerts.list', { status: 'open' }, O);
ok(alerts.alerts.some((a) => (a.company?.name ?? a.company_name ?? '') === 'Lumora Energy'), 'Lumora Energy carries an open runway alert');

section('roles and scope');
const fin = await api.op('home.summary', {}, { as: 'finance@venture.test' });
ok(fin.hidden.includes('funnel') && fin.hidden.includes('inbound') && fin.fund !== null, 'finance: fund figures, no deal flow (hidden, not empty)', fin.hidden);
const plat = await api.op('home.summary', {}, { as: 'platform@venture.test' });
ok(plat.hidden.includes('fund') && plat.runways !== null && plat.runways.rows.length === 3, 'platform: runways, no fund figures', plat.hidden);
const ag = await api.op('home.summary', {}, { as: 'agent' });
ok(ag.hidden.length === 0 && ag.first_name === '' && ag.fund.label === 'Fund I', 'your AI agent: every block, no greeting');

section('app.today for your AI agent');
const td = await api.op('app.today', {}, { as: 'agent' });
const hb = td.blocks.find((b) => b.key === 'home');
ok(hb && /x$/.test(hb.fund.tvpi) && /%$/.test(hb.fund.net_irr) && hb.runway_shortest[0].company === 'Lumora Energy', 'home block in words: TVPI, net IRR, the shortest runway', hb && { fund: hb.fund, runway: hb.runway_shortest });
ok(hb.funnel.stages.length === 9 && hb.funnel.stages[0].stage === 'Inbound' && hb.inbound.weeks.length === 12 && hb.inbound.this_quarter === s.funnel.cohort, 'funnel and inbound in the block');

section('digest');
await api.op('auth.update-profile', { prefs: { digest: true, digest_link: 'http://127.0.0.1:3192/' } }, O);
const d = await api.op('home.digest', {}, O);
ok(d.on && d.lines.filter((l) => l.kind === 'meeting').length >= 4, 'digest: one line per meeting', d.lines.filter((l) => l.kind === 'meeting').map((l) => l.text));
for (const k of ['stall', 'vote', 'decision', 'alert']) ok(d.lines.some((l) => l.kind === k), `digest: a ${k} line`);
ok(d.lines.every((l) => l.link === '' || l.link.startsWith('http://127.0.0.1:3192/#/')), 'each line links back into the app', d.lines.map((l) => l.link).slice(0, 4));
ok(!/[\u2013\u2014]/.test(d.body), 'no dashes in the digest');

section('timing (server side, warm)');
const times = [];
for (let i = 0; i < 8; i++) times.push((await api.op('home.summary', {}, O)).ms);
times.sort((a, b) => a - b);
ok(times[3] < 200, `home.summary median ${times[3]} ms (runs: ${times.join(', ')})`);

const res = summary('t02_seeded');
void DEMO;
process.exit(res.failed > 0 ? 1 : 0);
