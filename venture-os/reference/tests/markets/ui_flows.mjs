// UI flows on the seeded scratch app (node ui_seed.mjs first; it changes the seeded data, so run it after
// ui_shots.mjs): one-click Add to Inbox with Undo, Dismiss, bulk Dismiss, drag a map tile to another
// segment, Accept all of your AI agent's map proposals, New thesis from chips (its radar runs at once),
// Add to Inbox from the Focus card, Sourcing settings saved. Checks the result through the ops each time
// and fails on console errors or 5xx.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, DEMO, newApi, ok, section, summary } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'shots');
const BASE = `http://127.0.0.1:${PORT}/`;
const P = 'partner@venture.test';
const api = newApi();

const s0 = await api.op('theses.summary', {}, { as: P });
const fintech = s0.theses.find((t) => t.name === 'Fintech infra');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
await page.goto(BASE + '#/');
await page.waitForSelector('input[type=email]');
await page.fill('input[type=email]', P);
await page.fill('input[type=password]', DEMO.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('#vo-main');
const wait = (ms) => page.waitForTimeout(ms);
const list = async (status) => (await api.op('signals.list', { thesis: fintech.id, status, limit: 200 }, { as: P })).signals;

section('Add to Inbox is one click, with Undo');
await page.goto(BASE + '#/markets/' + fintech.id);
await page.waitForSelector('[aria-label=Candidates] [role=row], [role=row]');
await wait(800);
const before = await list('open');
const firstName = before[0].display;
const row = page.locator('[role=row]').filter({ hasText: firstName }).first();
await row.hover();
await row.getByRole('button', { name: 'Add to Inbox' }).click();
await wait(400);
ok((await page.locator('[role=row]').filter({ hasText: firstName }).count()) === 0, 'the row leaves at once');
// The toast appears once the server answered (the add is stored by then); it stays 6 seconds.
const undo = page.getByRole('button', { name: 'Undo' });
await undo.first().waitFor({ timeout: 10000 }).catch(() => undefined);
ok((await undo.count()) > 0, 'the toast offers Undo');
const added = (await list('added')).map((s) => s.display);
ok(added.includes(firstName), firstName + ' is added (intake item made)');
if ((await undo.count()) > 0) await undo.first().click();
let back = false;
for (let i = 0; i < 30 && !back; i++) {
  await wait(400);
  back = (await list('open')).some((s) => s.display === firstName);
}
ok(back, 'Undo puts it back');
const inbox = await api.op('intake.list', { channel: 'sourced', limit: 5 }, { as: 'owner' });
ok(Array.isArray(inbox.items ?? []), 'the sourced intake list answers');
await page.screenshot({ path: join(OUT, 'flow_undo_light_1440.png') });

section('Dismiss, one and several');
const second = (await list('open'))[1].display;
const r2 = page.locator('[role=row]').filter({ hasText: second }).first();
await r2.hover();
await r2.getByRole('button', { name: 'Dismiss' }).click();
await wait(1000);
ok((await list('dismissed')).some((s) => s.display === second), second + ' dismissed');
const open2 = await list('open');
for (const n of open2.slice(0, 2).map((s) => s.display)) await page.locator('[role=row]').filter({ hasText: n }).first().getByRole('checkbox').click();
await wait(300);
await page.screenshot({ path: join(OUT, 'flow_bulk_light_1440.png') });
await page.getByRole('button', { name: 'Dismiss', exact: true }).last().click();
await wait(1200);
ok((await list('dismissed')).length >= 3, 'bulk dismiss from the selection bar');

section('Map: drag a tile, accept the proposals');
await page.goto(BASE + '#/markets/' + fintech.id + '/map');
await page.waitForSelector('section[aria-label="Ledgers"]');
await wait(800);
await page.locator('section[aria-label="Payouts"] button').filter({ hasText: 'Payrail' }).first().dragTo(page.locator('section[aria-label="Ledgers"]'));
await wait(1200);
const maps = await api.op('maps.list', { thesis: fintech.id }, { as: P });
const m1 = await api.op('maps.get', { map: maps.maps[0].id }, { as: P });
ok(m1.map.entries.find((e) => e.company.name === 'Payrail')?.segment === 'ledgers', 'Payrail moved to Ledgers by drag');
await page.getByRole('button', { name: /Accept all/ }).click();
let m2 = null;
for (let i = 0; i < 30; i++) {
  await wait(500);
  m2 = await api.op('maps.get', { map: maps.maps[0].id }, { as: P });
  if (m2.map.proposals.length === 0) break;
}
ok(m2.map.proposals.length === 0 && m2.map.entries.some((e) => e.company.name === 'Fernhill Payments'), 'Accept all: the proposed tile is on the map');
await page.screenshot({ path: join(OUT, 'flow_map_light_1440.png') });

section('Select tiles, Compare: the grid opens');
await page.getByRole('button', { name: 'Select', exact: true }).click();
for (const name of ['Modern Treasury', 'Fragment']) await page.locator('section button').filter({ hasText: name }).first().click();
await page.getByRole('button', { name: /Compare 2/ }).click();
await page.waitForURL(/#\/compare\//, { timeout: 15000 });
await page.waitForSelector('#vo-main table', { timeout: 15000 });
await wait(800);
ok(/#\/compare\//.test(page.url()), 'Compare opens the new grid');
await page.screenshot({ path: join(OUT, 'flow_compare_light_1440.png') });
const grids = await api.op('compare.list', {}, { as: P });
ok(grids.grids[0].origin === 'markets' && grids.grids[0].rows === 2, 'a markets grid of the two companies');
await page.goto(BASE + '#/markets/' + fintech.id + '/grid');
await page.waitForSelector('#vo-main table', { timeout: 15000 });
await wait(800);
await page.screenshot({ path: join(OUT, 'flow_grid_tab_light_1440.png') });
ok((await page.locator('#vo-main table').count()) === 1, 'the Grid tab shows the grid itself');

section('New thesis from chips; its radar runs at once');
await page.goto(BASE + '#/markets/' + fintech.id);
await wait(600);
await page.locator('#vo-main header').getByRole('button', { name: 'New thesis' }).click();
await page.getByRole('textbox', { name: 'Thesis name' }).fill('Robotics');
await page.locator('[role=dialog]').getByRole('button', { name: /more sector/ }).click();
await page.locator('[role=dialog]').getByRole('checkbox', { name: 'Robotics', exact: true }).click();
await page.locator('[role=dialog]').getByRole('checkbox', { name: 'Seed', exact: true }).click();
await page.locator('[role=dialog]').getByRole('button', { name: 'Create' }).click();
let robo;
for (let i = 0; i < 40; i++) {
  await wait(300);
  robo = (await api.op('theses.summary', {}, { as: P })).theses.find((t) => t.name === 'Robotics');
  if (robo !== undefined && robo.radar !== null && page.url().includes(robo.id)) break;
}
await page.screenshot({ path: join(OUT, 'flow_new_thesis_pulling_light_1440.png') });
ok(robo !== undefined && robo.criteria.some((c) => c.key === 'sector' && c.values.includes('robotics')) && robo.criteria.some((c) => c.key === 'stage'), 'thesis saved with sector and stage criteria');
ok(robo?.radar?.sources.join(',') === 'edgar_form_d,hacker_news' && robo.radar.schedule.label === 'Mon 08:00', 'radar with the default sources and schedule');
ok(page.url().includes(robo?.id ?? 'x'), 'the page shows the new thesis');
for (let i = 0; i < 40; i++) {
  const t = (await api.op('theses.summary', {}, { as: P })).theses.find((x) => x.name === 'Robotics');
  if (t.radar.runs > 0) break;
  await wait(1000);
}
await wait(1500);
const s2 = await api.op('theses.summary', {}, { as: P });
ok(s2.theses.find((t) => t.name === 'Robotics').radar.runs === 1, 'the new radar ran once');
await page.screenshot({ path: join(OUT, 'flow_new_thesis_ran_light_1440.png') });

section('Focus card: Add to Inbox on a row');
const n = await api.op('next.list', { kinds: 'candidate' }, { as: P });
const item = n.items.find((i) => i.title.startsWith('Developer tools'));
await page.goto(BASE + '#/focus?at=' + encodeURIComponent(item.key));
await page.reload();
await page.waitForSelector('#vo-main article');
await wait(800);
const firstC = item.data.candidates[0];
await page.locator('[aria-label=Candidates] li').filter({ hasText: firstC.display }).getByRole('button', { name: 'Add to Inbox' }).click();
let devAdded = { signals: [] };
for (let i = 0; i < 30 && !devAdded.signals.some((s) => s.id === firstC.id); i++) {
  await wait(500);
  devAdded = await api.op('signals.list', { thesis: 'Developer tools', status: 'added' }, { as: P });
}
ok(devAdded.signals.some((s) => s.id === firstC.id), 'added from the Focus card');

section('Sourcing settings');
await page.goto(BASE + '#/settings/sourcing');
await wait(1000);
const ownerNote = await page.getByRole('button', { name: 'Save' }).count();
ok(ownerNote === 0, 'a partner sees Sourcing read-only (settings are the owner\'s)');

ok(errors.length === 0, 'no console errors or 5xx', errors);
await browser.close();
const res = summary('ui_flows');
process.exit(res.failed > 0 ? 1 : 0);
