// Fix 3: board order. deals.reorder (a place in a column, a move to another column, Undo, people only),
// deals.move putting a moved deal at the end of its new column, asks.reorder on a company's asks board,
// and portfolio.company (the company page in one read).
import { newApi, fresh, setupFirm, member, section, ok, eq, refuses, summary } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
const partner = await member(api, 'partner@venture.test', 'partner', 'Pat Partner');
const P = { as: partner };

const mk = async (domain) => (await api.op('deals.create', { company: domain, name: domain.split('.')[0] }, P)).deal;
const a = await mk('alpha.io');
const b = await mk('beta.io');
const c = await mk('gamma.io');
const d = await mk('delta.io');
const col = async (key) => (await api.op('deals.board', {}, P)).stages.find((s) => s.key === key).deals.map((x) => x.title);

section('Sorting inside a column');
eq(await col('sourced'), ['alpha', 'beta', 'gamma', 'delta'], 'unplaced deals: longest in stage first');
let r = await api.op('deals.reorder', { deal: d.number, before: a.id }, P);
eq(r.index, 0, 'delta lands at the top');
eq(await col('sourced'), ['delta', 'alpha', 'beta', 'gamma'], 'the board keeps the new order');
r = await api.op('deals.reorder', { deal: a.id, index: 3 }, P);
eq(await col('sourced'), ['delta', 'beta', 'gamma', 'alpha'], '--index 3 puts alpha last');
r = await api.op('deals.reorder', { deal: b.id }, P);
eq(await col('sourced'), ['delta', 'gamma', 'alpha', 'beta'], 'no --before or --index: the end of the column');

section('Moving to another column');
await api.op('deals.move', { deal: c.id, stage: 'screen' }, P);
await api.op('deals.move', { deal: a.id, stage: 'screen' }, P);
eq(await col('screen'), ['gamma', 'alpha'], 'deals.move puts a moved deal at the end of its new column');
r = await api.op('deals.reorder', { deal: d.id, stage: 'screen', before: a.id }, P);
eq(await col('screen'), ['gamma', 'delta', 'alpha'], 'deals.reorder --stage moves it and places it in front of alpha');
eq(await col('sourced'), ['beta'], 'it left Sourced');
const got = await api.op('deals.get', { deal: d.id }, P);
eq(got.deal.stage, 'screen', 'the stage changed (a stage event like deals.move)');
const undo = await api.call('activity.undo', { entry: r._activity }, P);
eq(undo.status, 200, 'Undo answers 200');
eq(await col('sourced'), ['delta', 'beta'], 'Undo puts delta back in Sourced at its place');
eq(await col('screen'), ['gamma', 'alpha'], 'and Screen as it was');

section('Rules');
await refuses(api, 'deals.reorder', { deal: a.id, index: 0 }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot reorder the board');
await api.op('deals.status', { deal: b.id, status: 'passed', reason: 'Market' }, P);
await refuses(api, 'deals.reorder', { deal: b.id, index: 0 }, P, 409, 'not_open', 'a passed deal is not on the board');
await api.op('deals.status', { deal: d.id, status: 'hold', reason: 'Later' }, P);
r = await api.op('deals.reorder', { deal: d.id, index: 0 }, P);
eq(r.index, 0, 'a held deal can still be placed in its column');
await refuses(api, 'deals.reorder', { deal: d.id, stage: 'screen' }, P, 409, 'not_open', 'but not moved to another stage (reopen it first)');

section('Asks board order');
await api.op('imports.run', { target: 'holdings', csv: 'Company,Fund,Instrument,Amount,Day,Valuation,Currency\nKite Labs,Fund I,priced,1000000,2025-03-01,10000000,USD', file_name: 'h.csv' }, { as: 'owner' });
const save = async (title) => (await api.op('asks.save', { company: 'Kite Labs', kind: 'intro', title }, { as: 'owner' })).ask;
const x1 = await save('First ask');
const x2 = await save('Second ask');
const x3 = await save('Third ask');
const asks = async (st) => (await api.op('asks.list', { company: 'Kite Labs', status: 'all' }, { as: 'owner' })).asks.filter((x) => x.status === st).map((x) => x.title);
eq(await asks('open'), ['Third ask', 'Second ask', 'First ask'], 'unplaced asks: newest first');
await api.op('asks.reorder', { ask: x1.id, index: 0 }, { as: 'owner' });
eq(await asks('open'), ['First ask', 'Third ask', 'Second ask'], 'asks.reorder --index 0 puts it at the top');
await api.op('asks.reorder', { ask: x3.id, status: 'in_progress' }, { as: 'owner' });
eq(await asks('in_progress'), ['Third ask'], 'asks.reorder --status moves it to In progress');
await api.op('asks.reorder', { ask: x2.id, status: 'in_progress', before: x3.id }, { as: 'owner' });
eq(await asks('in_progress'), ['Second ask', 'Third ask'], '--before puts it in front of that ask');
await refuses(api, 'asks.reorder', { ask: x1.id, index: 0 }, { as: 'agent' }, 403, 'agent_not_permitted', 'your AI agent cannot reorder asks');

section('portfolio.company');
const pc = await api.op('portfolio.company', { company: 'Kite Labs' }, { as: 'owner' });
eq(pc.company.name, 'Kite Labs', 'the company');
eq(pc.position.length, 1, 'one fund position');
ok(pc.position[0].invested_minor === 100000000 && pc.position[0].currency === 'USD', 'invested USD 1M', pc.position[0]);
eq([pc.asks.in_progress, pc.asks.open], [2, 1], 'open asks counted');
eq(pc.asks.items.map((x) => x.title), ['Second ask', 'Third ask', 'First ask'], 'in progress first, each column in board order');
ok(Array.isArray(pc.files) && pc.links.files === pc.files.length, 'files and their count');
const pa = await api.op('portfolio.company', { company: 'Kite Labs' }, { as: 'agent' });
eq(pa.company.name, 'Kite Labs', 'your AI agent reads it too');
await refuses(api, 'portfolio.company', { company: 'alpha.io' }, { as: 'owner' }, 404, 'not_found', 'a company the firm does not hold is 404');

const s = summary('t05_board_order');
process.exit(s.failed > 0 ? 1 : 0);
