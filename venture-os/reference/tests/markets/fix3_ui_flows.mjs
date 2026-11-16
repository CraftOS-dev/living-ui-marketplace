// Fix 3: the Markets page flows in a browser (playwright-core). Seeded scratch copy on 3191: VO_APP=<copy> node fix3_ui_flows.mjs
// Fix 3 markets flows on the scratch app (port 3191): drag a tile within and between segments (position kept after a
// reload), Add to Inbox from "New companies found" with Undo, hide a news item with Undo, Compare 2 companies.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.VO_APP ?? join(HERE, '..', '..', '..');
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const { client } = await import(pathToFileURL(join(APP, 'tools', 'dev', 'api.mjs')).href);
const PORT = 3191;
const api = client({ port: PORT, app: APP });
let pass = 0;
let fail = 0;
const ok = (c, what) => {
  if (c) pass++;
  else fail++;
  console.log((c ? 'ok   ' : 'FAIL ') + what);
};
const sum = (await api.call('theses.summary', {}, { as: 'owner' })).body;
const ind = sum.theses.find((t) => t.name === 'Industrial automation');
const mapId = (await api.call('maps.list', { thesis: ind.id }, { as: 'owner' })).body.maps[0].id;
const order = async () => {
  const m = (await api.call('maps.get', { map: mapId }, { as: 'owner' })).body.map;
  const out = {};
  for (const s of m.segments) out[s.label] = m.entries.filter((e) => e.segment === s.key).sort((a, b) => a.position - b.position).map((e) => e.company.name);
  return out;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
await page.goto(`http://127.0.0.1:${PORT}/#/`);
await page.waitForSelector('input[type=email]');
await page.fill('input[type=email]', 'owner@venture.test');
await page.fill('input[type=password]', 'demo-pass-1');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('#vo-main');

async function drag(fromName, toName, below) {
  const from = page.locator('[data-map-tile]', { hasText: fromName }).first();
  const to = page.locator('[data-map-tile]', { hasText: toName }).first();
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 50, a.y + a.height / 2 + 8, { steps: 4 });
  const y = below ? b.y + b.height - 4 : b.y + 4;
  await page.mouse.move(b.x + 40, y, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(1500);
}

// 1. Sort inside a segment: Quill Robotics to the top of Warehouse robots.
await page.goto(`http://127.0.0.1:${PORT}/#/markets/${ind.id}/map`);
await page.waitForSelector('[data-map-tile]');
await page.waitForTimeout(800);
const before = await order();
await drag('Quill Robotics', before['Warehouse robots'][0], false);
let after = await order();
ok(after['Warehouse robots'][0] === 'Quill Robotics', 'sorted inside a segment: ' + after['Warehouse robots'].join(', '));
// 2. Move to another segment at a place: Gantry Vision under Pinecrest Logistics in Freight and fleets.
await drag('Gantry Vision', after['Freight and fleets'][0], true);
after = await order();
ok(after['Freight and fleets'][1] === 'Gantry Vision', 'moved to another segment at index 1: ' + after['Freight and fleets'].join(', '));
ok(!after['Operations software'].includes('Gantry Vision'), 'left its old segment');
// 3. After a reload the board shows the stored order.
await page.reload();
await page.waitForSelector('[data-map-tile]');
await page.waitForTimeout(800);
const shown = await page.$$eval('[data-map-tile]', (els) => els.map((e) => e.textContent));
ok(shown.findIndex((t) => t.startsWith('Quill Robotics')) < shown.findIndex((t) => t.startsWith('Kestrel Robotics')), 'reload keeps Quill above Kestrel');

// 4. Add to Inbox from the overview, then Undo.
await page.goto(`http://127.0.0.1:${PORT}/#/markets`);
await page.waitForSelector('ul[aria-label="New companies found"] li');
const firstName = (await page.locator('ul[aria-label="New companies found"] li').first().locator('.font-semibold').first().textContent()).trim();
await page.locator('ul[aria-label="New companies found"] li').first().getByRole('button', { name: 'Add to Inbox' }).click();
await page.waitForTimeout(1500);
const intake = (await api.call('intake.list', { q: firstName, limit: 5 }, { as: 'owner' })).body;
ok(JSON.stringify(intake).includes(firstName), `${firstName} is in the Inbox`);
const undo = page.getByRole('button', { name: 'Undo' });
ok((await undo.count()) > 0, 'Undo offered');
if ((await undo.count()) > 0) await undo.first().click();
await page.waitForTimeout(1500);
const back = (await api.call('signals.list', { status: 'candidate', limit: 50 }, { as: 'owner' })).body.signals.some((s) => s.display === firstName);
ok(back, `${firstName} back among the new companies after Undo`);

// 5. Hide a news item, then Undo.
const n0 = (await api.call('news.list', { limit: 1 }, { as: 'owner' })).body.items[0];
const row = page.locator('ul[aria-label="News"] li').first();
await row.hover();
await row.getByRole('button', { name: 'Hide from the news' }).click();
await page.waitForTimeout(1200);
const n1 = (await api.call('news.list', { limit: 1 }, { as: 'owner' })).body.items[0];
ok(n1.id !== n0.id, 'hidden item left the news');
const undo2 = page.getByRole('button', { name: 'Undo' });
if ((await undo2.count()) > 0) await undo2.first().click();
await page.waitForTimeout(1200);
const n2 = (await api.call('news.list', { limit: 1 }, { as: 'owner' })).body.items[0];
ok(n2.id === n0.id, 'Undo brings it back');

// 6. Compare 2 companies from the map opens the grid.
await page.goto(`http://127.0.0.1:${PORT}/#/markets/${ind.id}/map`);
await page.waitForSelector('[data-map-tile]');
await page.getByRole('button', { name: 'Compare companies' }).click();
await page.locator('[data-map-tile]').nth(0).click();
await page.locator('[data-map-tile]').nth(1).click();
await page.getByRole('button', { name: /Compare 2 companies/ }).click();
await page.waitForTimeout(2500);
ok(/#\/(compare|markets\/[^/]+\/grid)/.test(page.url()), 'Compare opens a grid: ' + page.url());

ok(errors.length === 0, 'no page errors or 5xx ' + errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
