// Fix 3: news ops and map positions through the operations. Run on a seeded scratch copy (tools/dev/seed_demo.mjs <copy> 3191 3291 --fresh):
// VO_APP=<copy> node fix3_news.mjs
// Fix 3 news and map-position checks through the operations (scratch app, port 3191, seeded).
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.VO_APP ?? join(HERE, '..', '..', '..');
const { client } = await import(pathToFileURL(join(APP, 'tools', 'dev', 'api.mjs')).href);
const api = client({ port: 3191, app: APP });
let pass = 0;
let fail = 0;
const ok = (c, what, extra) => {
  if (c) pass++;
  else fail++;
  console.log((c ? 'ok   ' : 'FAIL ') + what + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 300)));
};
const call = (op, p, as) => api.call(op, p, { as });

// Contract shape.
const home = await call('news.list', { scope: 'home', limit: 6 }, 'owner');
ok(home.status === 200 && Array.isArray(home.body.items) && home.body.items.length === 6 && typeof home.body.total === 'number', 'news.list home answers 6 items and a total', home.body);
const row = home.body.items[0];
ok(row && ['id', 'title', 'url', 'source', 'published_at', 'about', 'summary'].every((k) => k in row) && ['kind', 'id', 'name'].every((k) => k in row.about), 'row has the contract fields', row);
ok(home.body.items.slice(0, 6).every((r) => r.about.kind === 'company' || r.summary !== ''), 'home puts the firm\'s companies and summarized items first');
const def = await call('news.list', {}, 'owner');
ok(def.status === 200 && def.body.items.length === 12, 'default scope home, limit 12');
ok((await call('news.list', { scope: 'deal' }, 'owner')).status === 400, 'unknown scope refused');
ok((await call('news.list', { scope: 'company' }, 'owner')).status === 400, 'scope company without ref refused');
ok((await call('news.list', { limit: 61 }, 'owner')).status === 400, 'limit above 60 refused (fix 4: pages of up to 60)');
const co = await call('news.list', { scope: 'company', ref: 'lumoraenergy.com' }, 'owner');
ok(co.status === 200 && co.body.items.length >= 1 && co.body.items.every((r) => r.about.name === 'Lumora Energy'), 'company scope by domain: only Lumora Energy', co.body);
const sum = (await call('theses.summary', {}, 'owner')).body.theses;
const cl = sum.find((t) => t.name === 'Climate software');
const th = await call('news.list', { scope: 'thesis', ref: cl.id, limit: 50 }, 'owner');
const names = new Set(th.body.items.map((r) => r.about.name));
ok(th.status === 200 && names.has('Climate') && names.has('Lumora Energy') && !names.has('Brightline Payments'), 'thesis scope: its sectors and map companies, not others', [...names]);
const th2 = await call('news.list', { scope: 'thesis', ref: 'Climate software', limit: 5 }, 'owner');
ok(th2.status === 200 && th2.body.items.length === 5, 'thesis by name');
ok((await call('news.list', { scope: 'home' }, 'agent')).status === 200, 'your AI agent reads the news');

// Writes and who may run them.
ok((await call('news.add', { title: 'x', url: 'https://a.example/x', about_kind: 'sector', about: 'fintech' }, 'agent')).status === 403, 'news.add refused for your AI agent');
ok((await call('news.hide', { id: row.id }, 'agent')).status === 403, 'news.hide refused for your AI agent');
ok((await call('news.summarize', { items: JSON.stringify([{ id: row.id, summary: 'One.' }]) }, 'owner')).status === 403, 'news.summarize refused for people');
ok((await call('news.summarize', { items: JSON.stringify([{ id: row.id, summary: 'x'.repeat(241) }]) }, 'agent')).status === 400, 'a summary over 240 characters refused');
ok((await call('news.summarize', { items: JSON.stringify([{ id: 'nope', summary: 'One.' }]) }, 'agent')).status === 404, 'an unknown item refused');
const s1 = await call('news.summarize', { items: JSON.stringify([{ id: row.id, summary: row.summary || 'Worth a look for the firm.' }]) }, 'agent');
ok(s1.status === 200 && s1.body.summarized === 1, 'your AI agent summarizes an item', s1.body);
const add = await call('news.add', { title: 'Fernhill Bio opens a pilot plant in North Carolina', url: 'https://bioprocessnotes.example/2026/11/fernhill-pilot-plant', source: 'BioProcess Notes', published_at: new Date(Date.now() - 3600000).toISOString(), about_kind: 'company', about: 'fernhillbio.com' }, 'owner');
ok(add.status === 200 && add.body.item.about.name === 'Fernhill Bio', 'a person adds an article', add.body);
const dup = await call('news.add', { title: 'Same', url: 'https://bioprocessnotes.example/2026/11/fernhill-pilot-plant', about_kind: 'company', about: 'fernhillbio.com' }, 'owner');
ok(dup.status === 200 && dup.body.duplicate === true, 'the same url is answered, not added twice');
ok((await call('news.add', { title: 'Old', url: 'https://a.example/old', published_at: '2020-01-01', about_kind: 'sector', about: 'fintech' }, 'owner')).status === 400, 'older than 60 days refused');
ok((await call('news.add', { title: 'No about', url: 'https://a.example/n' }, 'owner')).status === 400, 'about is required');
const hid = await call('news.hide', { id: add.body.item.id }, 'owner');
ok(hid.status === 200 && hid.body.hidden === true, 'a person hides an item');
const after = await call('news.list', { scope: 'company', ref: 'fernhillbio.com' }, 'owner');
ok(!after.body.items.some((r) => r.id === add.body.item.id), 'a hidden item leaves every list');
ok((await call('news.hide', { id: add.body.item.id, hidden: false }, 'owner')).body.hidden === false, 'and comes back with --hidden false');
const r1 = await call('news.refresh', {}, 'owner');
ok(r1.status === 200 || r1.status === 409, 'news.refresh answers (or too_soon)', r1.body);
const r2 = await call('news.refresh', {}, 'owner');
ok(r2.status === 409 && r2.body.code === 'too_soon', 'a second refresh within 2 minutes is refused', r2.body);

// A scout (own items only) sees no company news.
const roles = await call('members.list', {}, 'owner');
ok(roles.status === 200, 'members.list');

// Map positions through maps.place.
const ind = sum.find((t) => t.name === 'Industrial automation');
const mapId = (await call('maps.list', { thesis: ind.id }, 'owner')).body.maps[0].id;
const get = async () => (await call('maps.get', { map: mapId }, 'owner')).body.map;
let m = await get();
const seg = m.segments[0].key;
const col = () => m.entries.filter((e) => e.segment === seg).sort((a, b) => a.position - b.position);
const last = col()[col().length - 1];
const p1 = await call('maps.place', { map: mapId, company: last.company.id, segment: seg, position: 0 }, 'owner');
m = await get();
ok(p1.status === 200 && col()[0].company.id === last.company.id && col().every((e, i) => e.position === i), 'position 0 puts it first and numbers the segment 0..n', col().map((e) => e.position));
const p2 = await call('maps.place', { map: mapId, company: last.company.id, segment: seg, position: 99 }, 'owner');
m = await get();
ok(p2.status === 200 && col()[col().length - 1].company.id === last.company.id, 'a position past the end puts it last');
ok((await call('maps.place', { map: mapId, company: last.company.id, segment: seg, position: -1 }, 'owner')).status === 400, 'a negative position refused');
const other = m.segments[1].key;
const p3 = await call('maps.place', { map: mapId, company: last.company.id, segment: other }, 'owner');
m = await get();
const oc = m.entries.filter((e) => e.segment === other).sort((a, b) => a.position - b.position);
ok(p3.status === 200 && oc[oc.length - 1].company.id === last.company.id, 'moved without a position: last of the new segment');
const undo = await call('activity.undo', { entry: p3.body._activity }, 'owner');
m = await get();
ok(undo.status === 200 && m.entries.find((e) => e.company.id === last.company.id).segment === seg, 'Undo puts it back', undo.body);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
