// Founder update to verified KPIs: requests by Gmail (mock bridge), the Gmail sweep, your AI agent's
// update_extract through ops (staging with sources), Next verify items, verify all / fix one /
// reject, series and runway, alerts once per breach, asks as proposals, board briefs, KPI import.
import { newApi, fresh, setupFirm, section, ok, eq, refuses, summary, PEOPLE, upload, fixture, dealFor, until, bridge } from './lib.mjs';

await fresh();
// The cron sweep runs every 5 minutes: keep Gmail search offline until the test sweeps on purpose.
await bridge.mode('search_gmail', 'offline');
const api = newApi();
await setupFirm(api);
// Fix 7: updates that arrive by email and board meeting briefs ask your AI agent only while their Automatic work is on.
const autoOn = await api.op('settings.update', { agent_policy: '{"email_updates":true,"board_briefs":true}' }, { as: 'owner' });
ok(autoOn.agent_policy.email_updates === true && autoOn.agent_policy.board_briefs === true, 'the switches for email updates and board briefs are on');

async function invest(domain, name, founder, extra = {}) {
  const d = await dealFor(api, domain, name, [founder], { round_type: 'seed', check: '500000', instrument: 'safe_cap', post_money: '10000000' });
  return api.op('holdings.create-from-deal', Object.assign({ deal: d.number }, extra), { as: PEOPLE.partner });
}

section('requests: one dialog turns them on; the first request goes out at once');
await invest('northwind-analytics.com', 'Northwind Analytics', { email: 'ana@northwind-analytics.com', name: 'Ana Silva' });
await invest('quietco.com', 'Quiet Co', { email: 'quinn@quietco.com', name: 'Quinn Q' });
const rl0 = await api.op('requests.list', {}, { as: PEOPLE.partner });
ok(rl0.companies.length === 2 && rl0.companies.every((c) => c.request === null && c.recipients.length === 1), 'two companies, requests off, founders found from the deal', rl0.companies);
await refuses(api, 'requests.schedule', { companies: '["quietco.com"]' }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot turn requests on');
const sch = await api.op('requests.schedule', { companies: JSON.stringify(['northwind-analytics.com', 'quietco.com']), cadence: 'monthly', metrics: '["revenue","net_burn","cash"]' }, { as: PEOPLE.partner });
eq(sch.sent, 2, 'two requests sent now');
ok(sch.requests.every((r) => r.enabled && r.state === 'requested' && r.period_end !== ''), 'both requested for the period that just ended', sch.requests);
const sent = await bridge.sent();
const msgs = Array.isArray(sent) ? sent : sent.sent || sent.messages || [];
ok(msgs.length === 2 && msgs.every((m) => String(m.subject || (m.params || {}).subject || '').indexOf('{') < 0), 'the mock bridge got two filled-in emails', msgs);
ok(msgs.some((m) => JSON.stringify(m).indexOf('ana@northwind-analytics.com') >= 0), 'one to the Northwind founder');
const out = await api.op('outbound.list', { kind: 'request', status: 'all' }, { as: PEOPLE.partner });
ok(out.messages.length === 2 && out.messages.every((m) => m.status === 'sent' && m.approved_by !== ''), 'outbound records both as sent, approved by the partner', out.messages.map((m) => [m.status, m.approved_by]));

section('the Gmail sweep files founder updates (label), one without a known company');
const off = await api.op('updates.sweep', {}, { as: PEOPLE.partner });
ok(off.ok === false && off.filed === 0, 'Gmail unreachable: nothing filed, no error', off);
await bridge.mode('search_gmail', 'ok');
const sw = await api.op('updates.sweep', {}, { as: PEOPLE.partner });
const ul = await api.op('updates.list', {}, { as: PEOPLE.partner });
ok(sw.ok === true && ul.updates.length === 2, 'two updates filed', { sw, n: ul.updates.length });
const nw = ul.updates.find((x) => x.company && x.company.domain === 'northwind-analytics.com');
const un = ul.updates.find((x) => x.company === null);
ok(nw && nw.files === 1 && nw.step.at === 0, 'Northwind: filed with its PDF, step Received', nw);
ok(un && un.from_email === 'leo@kitepay.eu', 'KitePay (not invested yet): filed without a company', un);
eq((await api.op('updates.sweep', {}, { as: PEOPLE.partner })).filed, 0, 'a second sweep files nothing again');
const rl1 = await api.op('requests.list', {}, { as: PEOPLE.partner });
eq(rl1.companies.find((c) => c.company.domain === 'northwind-analytics.com').request.state, 'received', 'Northwind request: received');
let nx = await api.op('next.list', {}, { as: PEOPLE.partner });
const assignItem = nx.items.find((i) => i.key === 'portfolio:assign:' + un.id);
ok(assignItem && assignItem.actions[0].choose && assignItem.actions[0].choose.options.length === 2, 'Next asks which company, with a chip per portfolio company', assignItem);

section('your AI agent files the unknown update (a proposal) once the firm invests');
await invest('kitepay.eu', 'KitePay', { email: 'leo@kitepay.eu', name: 'Leo Brandt' });
await api.op('holdings.update', { holding: 'kitepay.eu', report_currency: 'EUR' }, { as: PEOPLE.partner });
const asg = await api.call('updates.assign', { update: un.id, company: 'kitepay.eu', why: 'Sent from kitepay.eu' }, { as: 'agent' });
ok(asg.status === 200 && asg.body.proposal, 'updates.assign from your AI agent is a proposal', asg.body);
await api.op('proposals.accept', { proposal: asg.body.proposal }, { as: PEOPLE.partner });
const kp = (await api.op('updates.get', { update: un.id }, { as: PEOPLE.partner })).update;
ok(kp.company && kp.company.domain === 'kitepay.eu', 'filed to KitePay');

section('reading: your AI agent is asked once per update (update_extract with its id)');
// The second ask came a moment after the first: the platform's 10 s cooldown defers it to the minute job.
const askedOf = async (id) => ((await api.op('updates.get', { update: id }, { as: 'agent' })).update.agent.update_extract || {}).pending === true;
const both = await until(async () => ((await askedOf(un.id)) && (await askedOf(nw.id)) ? true : null), 100000);
const gk = (await api.op('updates.get', { update: un.id }, { as: 'agent' })).update;
const gn = (await api.op('updates.get', { update: nw.id }, { as: 'agent' })).update;
ok(both === true, 'both updates were asked (Northwind by the switch, KitePay when a person filed it)', [gk.agent, gn.agent]);
ok(gk.report_currency === 'EUR' && gn.asked.metrics.indexOf('cash') >= 0, 'your AI agent reads the reporting currency and the metrics asked for', [gk.report_currency, gn.asked]);

section('staging with sources (never verified by your AI agent)');
await refuses(api, 'kpis.stage', { update: un.id, values: JSON.stringify([{ key: 'mrr', period_end: '2026-10-31', value: '96000' }]) }, { as: 'agent' }, 400, 'missing_source', 'a value without its source is refused');
await refuses(api, 'kpis.stage', { update: un.id, values: JSON.stringify([{ key: 'mrr', period_end: '2026-10-15', value: '96000', quote: 'MRR: EUR 96,000' }]) }, { as: 'agent' }, 400, 'invalid_param', 'a period end that is not a month end');
await refuses(api, 'kpis.stage', { update: un.id, values: JSON.stringify([{ key: 'runway', period_end: '2026-10-31', value: '8', quote: 'x' }]) }, { as: 'agent' }, 400, 'computed', 'runway is computed, not staged');
const st = await api.op('kpis.stage', { update: un.id, values: JSON.stringify([
  { key: 'mrr', period_end: '2026-10-31', value: '96000', quote: 'MRR: EUR 96,000' },
  { key: 'mrr', period_end: '2026-09-30', value: '88500', quote: 'September: EUR 88,500' },
  { key: 'net_burn', period_end: '2026-10-31', value: '140000', quote: 'Net burn: EUR 140,000' },
  { key: 'cash', period_end: '2026-10-31', value: '1100000', quote: 'Cash at 31 October: EUR 1,100,000' },
  { key: 'customers', period_end: '2026-10-31', value: 412, quote: 'Customers: 412' },
  { key: 'revenue', period_end: '2027-01-31', value: '120000', forecast: true, quote: 'seed extension conversations in January', flags: ['period_unclear'] },
]) }, { as: 'agent' });
eq(st.staged.length, 6, 'six values staged');
ok(st.staged.every((v) => v.status === 'staged' && v.currency !== 'USD' || v.unit !== 'money'), 'money in EUR (the reporting currency)', st.staged.map((v) => [v.key, v.currency]));
ok(st.staged.filter((v) => v.anchor !== '').length === 6, 'every quote found in the email text is anchored', st.staged.map((v) => [v.key, v.anchor]));
ok(!(await api.op('updates.get', { update: un.id }, { as: PEOPLE.partner })).update.agent.update_extract.pending, 'staging landed the ask');
await refuses(api, 'kpis.verify', { update: un.id }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent never verifies');

section('Next: one verify card per update, Verify all in one click');
nx = await api.op('next.list', {}, { as: PEOPLE.partner });
const vi = nx.items.find((i) => i.key === 'portfolio:verify:' + un.id);
ok(vi && vi.kind === 'verify' && vi.card === 'kpis' && vi.rank === 40 && vi.steps.at === 2, 'a verify item (card kpis, rank 40, step Staged)', vi);
ok(vi.title.indexOf('KitePay') === 0 && vi.title.indexOf('6 values') > 0, 'title "KitePay · Oct · 6 values": ' + (vi && vi.title));
ok(vi.data.values.length === 6 && vi.data.values.every((v) => v.snippet !== undefined), 'the card carries each value with its source snippet', vi.data.values.map((v) => v.snippet));
ok(vi.actions[0].label === 'Verify all' && vi.actions[0].op === 'kpis.verify', 'primary action: Verify all');
ok(!(await api.op('next.list', {}, { as: PEOPLE.analyst })).items.some((i) => i.kind === 'verify'), 'an analyst (portfolio view) gets no verify items');
const fixOne = st.staged.find((v) => v.key === 'customers');
const fx = await api.op('kpis.verify', { id: fixOne.id, value: '414' }, { as: PEOPLE.platform });
ok(fx.verified === 1 && fx.values[0].value === 414 && fx.values[0].note.indexOf('Corrected') === 0, 'Fix one: the platform lead corrects 412 to 414 as it is verified', fx.values[0]);
const rej = st.staged.find((v) => v.forecast);
await api.op('kpis.reject', { id: rej.id, note: 'Not a forecast of revenue' }, { as: PEOPLE.partner });
const va = await api.op('kpis.verify', { update: un.id }, { as: PEOPLE.partner });
eq(va.verified, 4, 'Verify all: the four left');
const kpu = (await api.op('updates.get', { update: un.id }, { as: PEOPLE.partner })).update;
ok(kpu.status === 'verified' && kpu.step.at === 3, 'the update is Verified (step 3)');
ok(!(await api.op('next.list', {}, { as: PEOPLE.partner })).items.some((i) => i.key === 'portfolio:verify:' + un.id), 'the verify item left Next');

section('series, currency modes, runway');
const kl = await api.op('kpis.list', { company: 'kitepay.eu' }, { as: PEOPLE.analyst });
const mrr = kl.metrics.find((m) => m.key === 'mrr');
ok(mrr.points.length === 2 && mrr.points.every((x) => x.status === 'verified'), 'MRR series: Sep and Oct verified');
eq(mrr.growth.growth_ppm, 84746, 'MRR growth Sep to Oct: 8.47%');
ok(kl.runway.state === 'unknown' && kl.runway.reason === 'missing_month', 'runway unknown: Aug and Sep burn missing (never 0)', kl.runway);
await api.op('kpis.save', { company: 'kitepay.eu', key: 'net_burn', period_end: '2026-08-31', value: '300000' }, { as: PEOPLE.partner });
const s2 = await api.op('kpis.save', { company: 'kitepay.eu', key: 'net_burn', period_end: '2026-09-30', value: '320000' }, { as: PEOPLE.partner });
ok(s2.alerts_fired.length === 1 && s2.alerts_fired[0].rule === 'runway_low', 'runway 4.3 months fires runway_low at once', s2.alerts_fired);
const rw = (await api.op('kpis.list', { company: 'kitepay.eu' }, { as: PEOPLE.analyst })).runway;
ok(rw.state === 'known' && rw.months === 4.3 && rw.currency === 'EUR', 'runway 1,100,000 / 253,333 = 4.3 months (EUR)', rw);
for (const dd of ['2026-10-31', '2026-10-01', '2026-10-15', '2026-09-01', '2026-09-30']) {
  const fr = await api.call('fx.set', { base: 'EUR', quote: 'USD', day: dd, rate: '1.1' }, { as: 'owner' });
  ok(fr.status === 200, 'fx.set EUR/USD ' + dd, fr.body);
}
const klu = await api.op('kpis.list', { company: 'kitepay.eu', currency: 'USD', keys: '["cash","mrr"]' }, { as: PEOPLE.analyst });
const cashUsd = klu.metrics.find((m) => m.key === 'cash').points[0];
ok(cashUsd.currency === 'USD' && cashUsd.native_currency === 'EUR' && (cashUsd.value === 121000000 || cashUsd.reason), 'cash in USD at the period-end rate', cashUsd);

section('alerts: once per breach, acknowledged by a person, resolved when it ends');
nx = await api.op('next.list', {}, { as: PEOPLE.partner });
const ai = nx.items.find((i) => i.kind === 'alert');
ok(ai && ai.card === 'alert' && ai.rank === 50 && ai.figures[0].value === '4.3 mo', 'an alert item: Runway 4.3 mo against 6', ai);
eq((await api.op('alerts.run', {}, { as: 'agent' })).fired.length, 0, 'checking again fires nothing new');
await refuses(api, 'alerts.ack', { alert: ai.data.alert.id }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot acknowledge');
await api.op('alerts.ack', { alert: ai.data.alert.id }, { as: PEOPLE.partner });
eq((await api.op('alerts.run', { company: 'kitepay.eu' }, { as: PEOPLE.partner })).fired.length, 0, 'acknowledged: the same breach does not fire again');
ok(!(await api.op('next.list', {}, { as: PEOPLE.partner })).items.some((i) => i.kind === 'alert'), 'the alert left Next');
await api.op('kpis.save', { company: 'kitepay.eu', key: 'cash', period_end: '2026-10-31', value: '3000000' }, { as: PEOPLE.partner });
const al = await api.op('alerts.list', { status: 'all', company: 'kitepay.eu' }, { as: PEOPLE.partner });
ok(al.alerts[0].status === 'resolved', 'more cash: the alert resolves itself', al.alerts);
await refuses(api, 'alerts.rules-save', { cash_months: 8 }, { as: PEOPLE.partner }, 400, 'invalid_param', 'cash months must stay below runway months');
const rules = await api.op('alerts.rules-save', { missed_update_days: 7 }, { as: PEOPLE.partner });
eq(rules.rules.missed_update_days, 7, 'missed update after 7 days (for this test)');
const mf = await api.op('alerts.run', {}, { as: PEOPLE.partner });
ok(mf.fired.some((a) => a.rule === 'missed_update' && a.company.domain === 'quietco.com'), 'Quiet Co (asked, nothing came) fires missed_update; Northwind does not', mf.fired);

section('Northwind: quarterly values from the PDF, burn up quarter on quarter');
const nwText = await api.op('files.text', { file: (await api.op('updates.get', { update: nw.id }, { as: 'owner' })).update.file_list[0].id }, { as: 'agent' });
ok(JSON.stringify(nwText).indexOf('410') >= 0, 'the agent reads the PDF text layer');
const an = await api.op('anchors.create', { file: (await api.op('updates.get', { update: nw.id }, { as: 'owner' })).update.file_list[0].id, page: 1, lines: '1' }, { as: 'agent' });
const st2 = await api.op('kpis.stage', { update: nw.id, values: JSON.stringify([
  { key: 'revenue', period_end: '2026-09-30', months: 3, value: '410000', quote: 'revenue USD 410,000 for the quarter' },
  { key: 'revenue', period_end: '2026-06-30', months: 3, value: '352000', quote: 'Q2: USD 352,000' },
  { key: 'net_burn', period_end: '2026-09-30', months: 3, value: '540000', anchor: an.anchor ? an.anchor.id : an.id },
  { key: 'net_burn', period_end: '2026-06-30', months: 3, value: '400000', quote: 'net burn USD 180,000 a month' },
  { key: 'cash', period_end: '2026-09-30', value: '2900000', quote: 'cash USD 2.9M at 30 September' },
  { key: 'arr', period_end: '2026-09-30', value: '1700000', quote: 'revenue USD 410,000 for the quarter', flags: [{ code: 'run_rate', note: 'Quarter revenue times four' }] },
]) }, { as: 'agent' });
eq(st2.staged.length, 6, 'six staged (one from a PDF page anchor)');
ok(st2.staged.find((v) => v.key === 'arr').flags[0].code === 'run_rate', 'a definitional flag kept on the value');
const asked = await api.call('asks.save', { company: 'northwind-analytics.com', update: nw.id, kind: 'intro', title: 'Retail data leaders', quote: 'retail data leaders', why: 'Asked in the Q3 update' }, { as: 'agent' });
ok(asked.status === 200 && asked.body.proposal, 'an ask from your AI agent is a proposal', asked.body);
const vf = await api.op('kpis.verify', { update: nw.id }, { as: PEOPLE.partner });
ok(vf.alerts_fired.some((a) => a.rule === 'burn_up'), 'verifying fires burn_up: 540k vs 400k is +35%', vf.alerts_fired);
const nl = await api.op('kpis.list', { company: 'northwind-analytics.com' }, { as: PEOPLE.partner });
ok(nl.runway.state === 'known' && nl.runway.months === 16.1, 'runway from a quarterly burn: 2.9M / 180k = 16.1 months', nl.runway);
const plist = await api.op('holdings.list', {}, { as: PEOPLE.partner });
const prow = plist.rows.find((r) => r.company.domain === 'northwind-analytics.com');
ok(prow.kpi.key === 'arr' && prow.reporting === 'verified' && prow.runway.months === 16.1, 'the Portfolio row: ARR, verified reporting dot, runway', prow);
const krow = plist.rows.find((r) => r.company.domain === 'kitepay.eu');
ok(krow.kpi.key === 'mrr' && krow.kpi.spark.length === 2 && krow.kpi.growth_ppm === 84746, 'KitePay row: MRR sparkline and growth', krow.kpi);
eq(plist.rows.find((r) => r.company.domain === 'quietco.com').reporting, 'requested', 'Quiet Co: requested');

section('asks: accepted, owned, worked from Next');
await api.op('proposals.accept', { proposal: asked.body.proposal }, { as: PEOPLE.platform });
const asks = await api.op('asks.list', { company: 'northwind-analytics.com' }, { as: PEOPLE.platform });
ok(asks.asks.length === 1 && asks.asks[0].status === 'open' && asks.asks[0].update === nw.id, 'the ask is tracked, linked to its update');
await api.op('asks.update', { ask: asks.asks[0].id, owner: 'me', status: 'in_progress' }, { as: PEOPLE.platform });
nx = await api.op('next.list', {}, { as: PEOPLE.platform });
const ti = nx.items.find((i) => i.key === 'portfolio:ask:' + asks.asks[0].id);
ok(ti && ti.kind === 'task' && ti.actions[0].label === 'Done', 'the platform lead has it in Next with Done', ti);
await api.op(ti.actions[0].op, ti.actions[0].params, { as: PEOPLE.platform });
eq((await api.op('asks.list', { status: 'done' }, { as: PEOPLE.platform })).asks.length, 1, 'done from the Next action');

section('board meetings: a brief from your AI agent 48 hours before');
const tomorrow = new Date(Date.now() + 26 * 3600000).toISOString().slice(0, 10);
const bm = await api.op('board.save', { company: 'northwind-analytics.com', day: tomorrow, time: '15:00', title: 'Q4 board' }, { as: PEOPLE.partner });
ok(bm.meeting.brief_state === 'queued' && bm.meeting.agent.board_brief && bm.meeting.agent.board_brief.pending, 'a meeting tomorrow: the switch asks for the brief at once (board_brief with the meeting)', bm.meeting);
await api.op('board.brief-save', { meeting: bm.meeting.id, brief: JSON.stringify({ sections: [{ title: 'KPIs', points: [{ text: 'Q3 revenue USD 410K, up 16% on Q2', source: { kpi: vf.values[0].id } }] }, { title: 'Open asks', points: ['None open'] }] }) }, { as: 'agent' });
const bl = await api.op('board.list', { company: 'northwind-analytics.com' }, { as: PEOPLE.partner });
ok(bl.meetings[0].brief_state === 'ready' && bl.meetings[0].brief.sections.length === 2, 'the brief is ready', bl.meetings[0]);
ok(bl.meetings[0].agent.board_brief && !bl.meetings[0].agent.board_brief.pending, 'saving the brief landed the ask', bl.meetings[0].agent);

section('a dropped update file, dismissing, KPI CSV import');
const dropped = await upload(api, 'updates.add', { company: 'quietco.com' }, [{ name: 'Quiet Co October.pdf', bytes: fixture('updates/northwind_analytics_q3_2026.pdf') }], PEOPLE.partner);
ok(dropped.status === 200 && dropped.body.update.files === 1 && dropped.body.update.step.at === 0, 'a dropped file becomes an update (Received)', dropped.body);
const qa = await until(async () => {
  const a = (await api.op('updates.get', { update: dropped.body.update.id }, { as: PEOPLE.partner })).update.agent.update_extract;
  return a && a.pending ? a : null;
}, 100000);
ok(qa && qa.pending, 'the person who dropped it asked your AI agent to read it (now, or after the cooldown)', qa);
await api.op('updates.dismiss', { update: dropped.body.update.id, note: 'Wrong company' }, { as: PEOPLE.partner });
const da = (await api.op('updates.get', { update: dropped.body.update.id }, { as: PEOPLE.partner })).update.agent.update_extract;
ok(da && !da.pending, 'dismissing answers the ask', da);
const csv = 'Company,Month,KPI,Value,Currency\nquietco.com,2026-10-31,revenue,52000,USD\nquietco.com,2026-10-31,Headcount,9,\nquietco.com,2026-10,cash,410000,USD\n';
const imp = await api.op('imports.run', { target: 'kpi_values', csv: csv }, { as: PEOPLE.partner });
ok(imp.counts.created === 3, 'three KPI values imported (labels and month text accepted)', imp);
const ql = await api.op('kpis.list', { company: 'quietco.com', keys: '["headcount","cash"]' }, { as: PEOPLE.partner });
ok(ql.metrics.every((m) => m.points.length === 1 && m.points[0].status === 'verified'), 'imported by a person: verified');

section('search and the company timeline');
const sq = await api.op('search.query', { q: 'Northw' }, { as: PEOPLE.partner });
const hits = sq.results || sq.items || sq.hits || [];
ok(JSON.stringify(sq).indexOf('#/portfolio/') >= 0, 'Ctrl K finds the portfolio company', sq);
const tl = await api.op('records.timeline', { company: 'northwind-analytics.com' }, { as: PEOPLE.partner });
const kinds = (tl.items || []).filter((i) => i.module === 'portfolio').map((i) => i.kind);
ok(kinds.indexOf('invested') >= 0 && kinds.indexOf('update') >= 0 && kinds.indexOf('alert') >= 0 && kinds.indexOf('board') >= 0, 'the timeline carries investments, updates, alerts and board meetings', kinds);
ok(hits !== undefined, 'search answered');

summary('t03 monitoring');
