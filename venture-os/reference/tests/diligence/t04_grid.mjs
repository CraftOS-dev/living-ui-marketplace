// Comparison grids: made from a selection of deals plus a company without a room; cells are the rooms' answers; filling
// adds column questions to rooms and asks diligence_answers per deal and grid_answers once for the grid; your AI agent
// answers grid cells with sources; Next's grid card; confirm; restricted rows hidden; markets view; delete and undo.
import { fresh, newApi, team, seedDeals, upload, waitText, pdf, DECK, section, ok, eq, refuses, summary, sleep, bridge, PARTNER, PARTNER2, ANALYST, FINANCE } from './lib.mjs';

fresh();
const api = newApi();
await team(api);
const S = await seedDeals(api);
const P = { as: PARTNER };
const A = { as: 'agent' };
const acme = S.deals.acme;
const lumen = S.deals.lumen;
const ans = (o) => JSON.stringify(o);

// Acme has a room with a deck and an answered ARR.
await api.op('dd.template-apply', { deal: acme.number }, P);
const up = await upload(api, { deal: acme.id }, [{ name: 'acme_deck.pdf', bytes: pdf(DECK) }], PARTNER);
const deck = up.body.files ? up.body.files[0].id : up.body.file.id;
await waitText(api, deck, PARTNER);
await sleep(300);
await api.op('dd.ask', { deal: acme.number }, P); // a room file asks nothing by itself
const aArr = (await api.op('anchors.create', { file: deck, page: 2, quote: 'ARR of 1,200,000 USD as of September 2026.' }, A)).anchor.id;
let g = await api.op('dd.get', { deal: acme.number }, P);
const arrQ = g.questions.find((q) => q.key === 'traction_arr');
await api.op('dd.answer', { answers: ans([{ question: arrQ.id, value: '1200000', unit: 'USD', num_kind: 'quoted', grade: 'artifact', anchors: [aArr] }]) }, A);
await api.op('dd.confirm', { answer: (await api.op('dd.get', { deal: acme.number }, P)).questions.find((q) => q.key === 'traction_arr').answer.id }, P);

section('make a grid from a selection of deals and a company');
await refuses(api, 'compare.save', { deals: ans([acme.number]), columns: ans(['no_such_key']) }, P, 400, 'invalid_param', 'an unknown checklist key is named');
await refuses(api, 'compare.save', { deals: ans([acme.number]) }, { as: FINANCE }, 403, undefined, 'finance cannot make grids');
const made = await api.op('compare.save', { deals: ans([acme.number, lumen.number]), companies: ans(['zetafreight.com']), columns: ans(['traction_arr', 'traction_customers', { text: 'Main warehouse partner', type: 'text' }]) }, P);
const grid = made.grid;
ok(grid.name === 'Acme Robotics, Lumen Health, Zeta Freight', 'named after its companies', grid.name);
eq(grid.columns.map((c) => c.key), ['traction_arr', 'traction_customers', 'c_main_warehouse_partner'], 'checklist columns and a custom one');
eq(grid.rows.map((r) => [r.company.name, r.deal ? r.deal.number : null]), [['Acme Robotics', acme.number], ['Lumen Health', lumen.number], ['Zeta Freight', null]], 'rows: two rooms and a company without one');
ok(grid.rows[0].cells[0].value === 'USD 1,200,000.00' && grid.rows[0].cells[0].status === 'confirmed' && grid.rows[0].cells[0].cites[0].page === 2, "a room's cell is its deal's answer with its citation", grid.rows[0].cells[0]);
ok(made.filled.added_questions >= 4 && made.filled.cells === 3, 'filling added the missing questions to the rooms and three public cells', made.filled);
g = await api.op('dd.get', { deal: lumen.number }, { as: PARTNER2 });
ok(g.questions.some((q) => q.key === 'c_main_warehouse_partner' && q.source === 'grid' && q.area_label === 'Other'), 'the custom column is a question in the room');
await sleep(300);
const gf = (await bridge.fires()).fires;
ok(made.filled.requests.length >= 2 && gf.some((f) => f.trigger === 'grid_answers' && made.filled.requests.includes(f.request_id)), 'filling asked grid_answers once for the grid and diligence_answers for the rooms (Acme already waits: not asked twice)', { requests: made.filled.requests, gf });
const got = (await api.op('compare.get', { grid: grid.id }, P)).grid;
ok(got.working && got.step && got.step.labels.join() === 'Queued,Reading,Answering,Ready', 'the grid shows your AI agent working', got.step);
ok(got.missing === 8, '8 empty cells', got.missing);

section('your AI agent answers grid cells from public sources');
const gj = (await api.op('compare.get', { grid: grid.id }, A)).grid;
ok(gj.empty_cells.length === 3 && gj.empty_cells[0].company_name === 'Zeta Freight', 'compare.get gives your AI agent the cells to research', gj.empty_cells);
await refuses(api, 'dd.answer', { answers: ans([{ grid: grid.id, company: acme.company.id || S.companies.acme.id, column: 'traction_arr', value: '1', unit: 'USD', num_kind: 'external', grade: 'public', sources: ['https://example.org/a'] }]) }, A, 400, undefined, 'a company with a room is answered through its deal');
await refuses(api, 'dd.answer', { answers: ans([{ grid: grid.id, company: S.companies.zeta.id, column: 'traction_arr', value: '800000', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported' }]) }, A, 400, 'citation_required', 'a cell without a source is refused');
await refuses(api, 'dd.answer', { answers: ans([{ grid: grid.id, company: S.companies.zeta.id, column: 'traction_arr', value: '800000', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported', anchors: [aArr] }]) }, A, 400, 'citation_scope', "a cell cannot cite another company's room");
const cell = await api.op('dd.answer', { answers: ans([
  { grid: grid.id, company: S.companies.zeta.id, column: 'traction_arr', value: '800000', unit: 'USD', num_kind: 'external', grade: 'public', sources: ['https://news.example.com/zeta-freight-series-a'] },
  { grid: grid.id, company: S.companies.zeta.id, column: 'c_main_warehouse_partner', value: 'Prologis', grade: 'public', sources: ['https://zetafreight.com/partners'] },
]) }, A);
ok(cell.saved === 2, 'two cells proposed');
const after = (await api.op('compare.get', { grid: grid.id }, P)).grid;
const z = after.rows.find((r) => r.company.name === 'Zeta Freight');
ok(z.cells[0].value === 'USD 800,000.00' && z.cells[0].status === 'agent_proposed' && z.cells[0].sources[0].startsWith('https://'), 'the cell shows value, status and source', z.cells[0]);
ok(z.cells[2].value === 'Prologis' && z.cells[1] === null, 'a text cell, and an empty one');

section('Next: the grid card for its maker');
let n = await api.op('next.list', {}, P);
const card = n.items.find((i) => i.key === 'diligence:grid:' + grid.id);
ok(card && card.title === grid.name && card.href === '#/compare/' + grid.id, 'the grid card is in Next', n.items.map((i) => i.key));
eq(card.figures, [{ label: 'To check', value: '2' }, { label: 'High grade', value: '2' }], 'two to check, both public');
ok(card.data.answers[0].text === 'Zeta Freight: Current ARR' && card.data.answers[0].source.startsWith('https://'), 'each cell names its company and question', card.data.answers[0]);
ok(!(await api.op('next.list', {}, { as: PARTNER2 })).items.some((i) => i.key === card.key), 'not in Next of others');
const conf = await api.op(card.actions[0].op, card.actions[0].params, P);
ok(card.actions[0].label === 'Confirm all' && card.actions[0].choose === null && conf.confirmed.length === 2, 'Confirm all (both high grade: no chips)', card.actions);
ok((await api.op('compare.get', { grid: grid.id }, P)).grid.rows[2].cells[0].status === 'confirmed', 'the cell is confirmed');

section('rights: restricted rows are hidden; markets view reads grids');
await api.op('deals.restrict', { deal: lumen.number, restricted: true }, { as: PARTNER2 });
const hid = (await api.op('compare.get', { grid: grid.id }, P)).grid;
ok(hid.rows.length === 2 && hid.hidden === 1, 'a restricted deal row is hidden from a partner off its team', { rows: hid.rows.length, hidden: hid.hidden });
ok((await api.op('compare.get', { grid: grid.id }, { as: PARTNER2 })).grid.rows.length === 3, 'its team still sees the row');
ok((await api.op('compare.list', {}, { as: ANALYST })).grids.length === 1, 'an analyst lists the grid');
await refuses(api, 'compare.fill', { grid: grid.id }, A, 403, 'agent_not_permitted', 'fill is a person asking');
const fl = await api.op('compare.fill', { grid: grid.id }, P);
ok(fl.filled.cells === 1, 'Ask your AI agent again: the one empty public cell', fl.filled);

section('change, delete, undo');
const ch = await api.op('compare.save', { grid: grid.id, columns: ans(['traction_arr', 'fin_burn']), fill: false }, P);
eq(ch.grid.columns.map((c) => c.key), ['traction_arr', 'fin_burn'], 'columns replaced');
const del = await api.op('compare.delete', { grid: grid.id }, P);
ok((await api.op('compare.list', {}, P)).grids.length === 0, 'deleted grids leave the list');
await refuses(api, 'compare.get', { grid: grid.id }, P, 404, 'not_found', 'a deleted grid is gone');
await api.op('activity.undo', { entry: del._activity }, P);
ok((await api.op('compare.list', {}, P)).grids.length === 1, 'Undo brings it back');

section('a grid from markets with default columns');
const mk = await api.op('compare.save', { companies: ans(['kivasystems.com', 'stripe.com']), origin: 'markets', market_ref: 'map1', fill: false }, P);
ok(mk.grid.origin === 'markets' && mk.grid.columns.length === 8 && mk.grid.rows.every((r) => r.deal === null), 'default columns, companies without rooms', mk.grid.columns.map((c) => c.key));
const mk2 = await api.op('compare.save', { companies: ans(['stripe.com']), origin: 'markets', market_ref: 'map2', fill: false }, P);
let li = await api.op('compare.list', { market_ref: 'map1' }, P);
eq(li.grids.map((x) => [x.id, x.market_ref, x.origin]), [[mk.grid.id, 'map1', 'markets']], 'compare.list --market_ref keeps the grids of one map, each item names its market_ref');
li = await api.op('compare.list', { market_ref: ans(['map1', 'map2']) }, P);
eq(li.grids.map((x) => x.id).sort(), [mk.grid.id, mk2.grid.id].sort(), 'a JSON list of refs');
eq((await api.op('compare.list', { market_ref: 'nope' }, P)).grids, [], 'an unknown ref lists nothing');
ok((await api.op('compare.list', { origin: 'deals' }, P)).grids.every((x) => x.origin === 'deals' && x.market_ref === ''), '--origin deals: the grids made from deals');
await api.op('compare.save', { grid: mk2.grid.id, market_ref: 'map1', fill: false }, P);
eq((await api.op('compare.list', { market_ref: 'map1' }, P)).grids.length, 2, 'market_ref can be changed on a grid');
await refuses(api, 'compare.list', { origin: 'elsewhere' }, P, 400, 'invalid_param', 'an unknown origin is named');

const sr = JSON.stringify(await api.op('search.query', { q: 'Kiva' }, P));
ok(sr.indexOf('#/compare/' + mk.grid.id) >= 0, 'Ctrl K finds a grid by name');
ok(JSON.stringify(await api.op('search.query', { q: 'Kiva' }, { as: FINANCE })).indexOf('#/compare/') < 0, 'not for people without grid view');

summary('t04 grid');
