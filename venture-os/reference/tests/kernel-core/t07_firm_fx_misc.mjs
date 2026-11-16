// Entities and LPA validation, exchange rates (end and avg through the
// engines, inverse, cross, unknown), module settings, search, the day,
// comments, saved views, notifications, the full export, cron catch-up and
// kernel events. No network: rates are set by hand.
import { BRIDGE, DEMO, PORT, eq, fresh, member, newApi, ok, refuses, restart, section, setupFirm, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const O = { as: 'owner' };
const A = { as: 'agent' };
await member(api, 'partner@venture.test', 'partner', 'Paul Partner');
await member(api, 'finance@venture.test', 'finance', 'Fran Finance');
const PA = { as: 'partner@venture.test' };
const FI = { as: 'finance@venture.test' };

section('entities and LPA');
const st0 = await api.op('zz.stats', {}, O);
ok(st0.entity_events >= 2, 'modules heard entity.created at setup (management company and fund)', st0);
await refuses(api, 'entities.save', { kind: 'fund', name: 'Bad', lpa: '{"carry":20}' }, O, 400, 'unknown_key', 'an unknown LPA key is refused naming the allowed ones');
await refuses(api, 'entities.save', { kind: 'fund', name: 'Bad', lpa: '{"waterfall":"global"}' }, O, 400, 'invalid_param', 'waterfall is european or american');
await refuses(api, 'entities.save', { kind: 'fund', name: 'Bad', lpa: '{"step_downs":[{"from_year":6,"fee_ppm":15000},{"from_year":5,"fee_ppm":10000}]}' }, O, 400, 'invalid_param', 'step-downs in increasing years');
await refuses(api, 'entities.save', { kind: 'fund', name: 'Bad', lpa: '{"recycling_cap_ppm":200000}' }, O, 400, 'invalid_param', 'recycling needs its window');
const f2 = await api.op('entities.save', { kind: 'fund', name: 'Fund II', short_name: 'II', currency: 'EUR', vintage: 2027, size: '120000000', lpa: '{"mgmt_fee_ppm":25000,"step_downs":[{"from_year":6,"fee_ppm":15000,"basis":"invested"}],"waterfall":"american","hurdle_ppm":80000}' }, FI);
eq([f2.entity.lpa.mgmt_fee_ppm, f2.entity.lpa.waterfall, f2.entity.lpa.confirmed, f2.entity.lpa.carry_ppm, f2.entity.lpa.pref_compounding], [25000, 'american', true, 200000, 'compound'], 'finance saves a fund; LPA merged with defaults (pref_compounding compound) and confirmed');
await refuses(api, 'entities.save', { entity: 'Fund II', lpa: '{"pref_compounding":"daily"}' }, FI, 400, 'invalid_param', 'pref_compounding is compound or simple');
eq((await api.op('entities.save', { entity: 'Fund II', lpa: '{"pref_compounding":"simple"}' }, FI)).entity.lpa.pref_compounding, 'simple', 'pref_compounding simple saved');
const f2b = await api.op('entities.save', { entity: 'II', lpa: '{"carry_ppm":250000}', settings: '{"committee":{"vote_scale":[1,2,4,5]}}' }, O);
eq([f2b.entity.lpa.carry_ppm, f2b.entity.lpa.mgmt_fee_ppm, f2b.entity.settings.committee.vote_scale], [250000, 25000, [1, 2, 4, 5]], 'a partial LPA change keeps the rest; module settings per fund');
await refuses(api, 'entities.save', { entity: 'Fund II', name: 'x' }, PA, 403, 'not_permitted', 'a partner cannot change funds');
await refuses(api, 'entities.save', { entity: 'Fund II', name: 'x' }, A, 403, 'agent_not_permitted', 'nor your AI agent');
await refuses(api, 'entities.save', { kind: 'management', name: 'Second Mgmt' }, O, 409, 'duplicate', 'one management company');
const spv = await api.op('entities.save', { kind: 'spv', name: 'Acme SPV', parent: 'Fund II', deal: 'D-0001' }, O);
eq([spv.entity.kind, spv.entity.lpa.mgmt_fee_ppm, spv.entity.parent], ['spv', 0, f2.entity.id], 'an SPV with its own defaults under a fund');
const ar = await api.op('entities.archive', { entity: 'Acme SPV' }, O);
eq(ar.entity.archived, true, 'archived');
eq((await api.op('entities.list', { kind: 'spv' }, O)).total, 0, 'archived entities are left out by default');
eq((await api.op('entities.list', { kind: 'spv', include_archived: true }, O)).total, 1, 'and listed on request');

section('exchange rates');
await refuses(api, 'fx.set', { base: 'USD', quote: 'EUR', rate: '0.92' }, A, 403, 'agent_not_permitted', 'your AI agent never sets a rate');
await refuses(api, 'fx.set', { base: 'USD', quote: 'EUR', rate: '-1' }, FI, 400, 'invalid_param', 'a rate is a positive decimal');
for (const [d, r] of [['2026-10-01', '0.90'], ['2026-10-02', '0.92'], ['2026-10-03', '0.94'], ['2026-10-30', '0.96']]) await api.op('fx.set', { base: 'USD', quote: 'EUR', rate: r, day: d }, FI);
await api.op('fx.set', { base: 'USD', quote: 'JPY', rate: '150', day: '2026-10-30' }, FI);
const end = await api.op('fx.convert', { amount: '1000', from: 'USD', to: 'EUR', day: '2026-10-31' }, A);
eq([end.minor, end.rate_e8, end.mode, end.day], [96000, 96000000, 'end', '2026-10-30'], 'end mode: the latest rate within 7 days (USD 1,000 = EUR 960.00)');
const avg = await api.op('fx.convert', { amount: '1000', from: 'USD', to: 'EUR', day: '2026-10-03', mode: 'avg', from_day: '2026-10-01' }, A);
eq([avg.minor, avg.rate_e8, avg.mode, avg.from_day], [92000, 92000000, 'avg', '2026-10-01'], 'avg mode: the mean of the period (0.90, 0.92, 0.94 = 0.92)');
const inv = await api.op('fx.convert', { amount: '960', from: 'EUR', to: 'USD', day: '2026-10-30' }, A);
eq(inv.minor, 100000, 'the inverse rate (EUR 960 = USD 1,000)');
const cross = await api.op('fx.convert', { amount: '96', from: 'EUR', to: 'JPY', day: '2026-10-30' }, A);
eq(cross.minor, 15000, 'a cross through the base currency (EUR 96 = JPY 15,000)');
const none = await api.op('fx.convert', { amount: '10', from: 'EUR', to: 'XTS', day: '2026-10-30' }, A);
eq([none.minor, none.reason], [null, 'no_rate'], 'no rate (XTS, the ISO test code): minor null with a reason, never zero');
const fl = await api.op('fx.list', { base: 'USD' }, A);
eq(fl.rates.find((r) => r.quote === 'JPY').rate, '150', 'fx.list shows rates as decimal text too');

section('module settings');
const s1 = await api.op('settings.get', {}, PA);
eq(s1.modules.zz_test, { sla_days: 5, label: 'Things', enabled: true }, 'module defaults come from events_*.js settingsKeys');
eq(s1.mail.deals_label, 'Venture OS/Deals', 'mail labels');
await refuses(api, 'settings.update', { modules: '{"zz_test":{"sla_days":"7"}}' }, O, 400, 'invalid_param', 'a setting keeps its type');
await refuses(api, 'settings.update', { modules: '{"zz_test":{"nope":1}}' }, O, 400, 'invalid_param', 'unknown setting refused');
await refuses(api, 'settings.update', { modules: '{"nope":{}}' }, O, 400, 'invalid_param', 'unknown module key refused');
const s2 = await api.op('settings.update', { modules: '{"zz_test":{"sla_days":7}}', mail: '{"deals_label":"Deals inbox"}', zone: 'Europe/London' }, O);
eq([s2.modules.zz_test.sla_days, s2.modules.zz_test.label, s2.mail.deals_label, s2.zone], [7, 'Things', 'Deals inbox', 'Europe/London'], 'changed settings merge with the defaults');
const undo = await api.op('activity.list', { op: 'settings.update', limit: 1 }, O);
ok(undo.entries[0].undoable, 'a settings change is undoable');

section('search, today, comments, views');
await api.op('zz.make', { name: 'Acme Robotics' }, O);
const sr = await api.op('search.query', { q: 'acme' }, PA);
ok(sr.results.some((r) => r.kind === 'thing' && r.module === 'zz_test'), 'modules add their results', sr);
const sf = await api.op('search.query', { q: 'Fund' }, PA);
ok(sf.results.some((r) => r.kind === 'fund' && r.title === 'Fund II'), 'the kernel finds funds');
const td = await api.op('app.today', {}, PA);
ok(td.blocks.some((b) => b.module === 'zz_test' && b.things === 1) && td.next.top.length > 0, 'app.today with module blocks and the top of Next', td);
const thing = (await api.op('search.query', { q: 'acme' }, PA)).results[0];
const c1 = await api.op('comments.add', { ref_collection: 'zz_things', ref_id: thing.id, body: 'Look at the churn, @Paul', mentions: '["partner@venture.test"]' }, O);
eq(c1.comment.who, 'Olivia Owner', 'commented');
const pn = await api.op('notifications.list', { unread: true }, PA);
ok(pn.notifications.some((n) => n.kind === 'mention'), 'the mentioned partner is told');
await api.op('notifications.read-all', {}, PA);
eq((await api.op('notifications.list', { unread: true }, PA)).unread, 0, 'read all');
const ac = await api.op('comments.add', { ref_collection: 'zz_things', ref_id: thing.id, body: 'Churn 3% monthly per the update.' }, A);
eq(ac.comment.who, 'Your AI agent', 'your AI agent comments as itself');
await refuses(api, 'comments.delete', { comment: c1.comment.id }, PA, 403, 'not_permitted', 'only the author or the owner deletes a comment');
await refuses(api, 'comments.add', { ref_collection: '_superusers', ref_id: 'x', body: 'hi' }, O, 400, 'invalid_param', 'comments only on app collections');
eq((await api.op('comments.list', { ref_collection: 'zz_things', ref_id: thing.id }, PA)).total, 2, 'two comments');
const v1 = await api.op('views.save', { page: 'deals.table', name: 'My seed deals', config: '{"filters":[{"key":"stage","op":"eq","value":"seed"}]}' }, PA);
await api.op('views.save', { page: 'deals.table', name: 'Team view', shared: true, config: '{}' }, O);
const vl = await api.op('views.list', { page: 'deals.table' }, PA);
eq(vl.views.map((v) => [v.name, v.mine]).sort(), [['My seed deals', true], ['Team view', false]], 'own and shared views');
await refuses(api, 'views.delete', { view: vl.views.find((v) => !v.mine).id }, PA, 404, 'not_found', "a shared view is its owner's to delete");
eq((await api.op('views.delete', { view: v1.view.id }, PA)).deleted, true, 'deleted my view');

section('export');
await refuses(api, 'exports.all', {}, PA, 403, 'not_permitted', 'a partner cannot export');
await refuses(api, 'exports.all', {}, O, 400, 'missing_param', 'export needs the PIN');
const cookie = await (async () => {
  const r = await fetch('http://127.0.0.1:' + PORT + '/', { redirect: 'manual' });
  await r.text();
  return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(';')[0]).filter((c) => c.startsWith('a2app_s_')).join('; ');
})();
const login = await api.op('auth.login', { email: DEMO.owner, password: DEMO.password });
const res = await fetch('http://127.0.0.1:' + PORT + '/api/ops/exports/all', { method: 'POST', headers: { 'content-type': 'application/json', authorization: login.token, cookie: cookie }, body: JSON.stringify({ pin: DEMO.pin }) });
const buf = Buffer.from(await res.arrayBuffer());
ok(res.status === 200 && /zip/.test(res.headers.get('content-type') || '') && buf.slice(0, 2).toString() === 'PK', 'a ZIP comes back', [res.status, res.headers.get('content-type'), buf.length]);
const text = buf.toString('latin1');
ok(text.indexOf('manifest.json') >= 0 && text.indexOf('collections/entities.json') >= 0 && text.indexOf('Fund II') >= 0, 'with the manifest and a JSON file per collection');
ok(text.indexOf('collections/pin_vault.json') < 0 && text.indexOf('"password"') < 0 && text.indexOf('tokenKey') < 0, 'secrets left out');
const ea = await api.op('audit.list', { op: 'exports.all' }, O);
eq(ea.total, 1, 'the export is audited');

section('cron catch-up and boot');
eq((await api.op('zz.stats', {}, O)).cron_ran !== '', true, 'a daily catch-up job ran at boot (its last time had passed)');
restart();
api.forget(DEMO.owner);
const after = await api.op('zz.stats', {}, O);
ok(after.cron_ran === '', 'after a restart with its run recorded, it does not run again', after);
const status = await api.op('app.status', { detail: true }, O);
ok(status.events.today.indexOf('lib_zz_test.today') >= 0 && status.events.imports.indexOf('zz_things') >= 0, 'app.status lists module registrations', status.events);

const s = summary('t07_firm_fx_misc');
process.exitCode = s.failed > 0 ? 1 : 0;
