// The portfolio's screens driven in a real browser (playwright-core, headless Chromium) as a partner on
// seeded data: Fix one and Verify all in Focus, Request updates in one dialog, Add update, Mark invested
// in three steps, Add meeting, Add ask, alert thresholds in Settings. Each result is checked through ops.
import { createRequire } from 'node:module';
import { PORT, DEMO, PEOPLE, newApi, section, ok, eq, summary, STUBBED } from './lib.mjs';
import { seed } from './seed_ui.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${PORT}/`;

const s = await seed();
const api = newApi();
const list = await api.op('holdings.list', { status: 'all' }, { as: 'owner' });
const co = (d) => list.rows.find((r) => r.company.domain === d)?.company.id ?? '';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const seen = async (loc, ms = 12000) => {
  try {
    await loc.first().waitFor({ state: 'visible', timeout: ms });
    return true;
  } catch {
    return false;
  }
};
const until = async (fn, ms = 12000) => {
  const end = Date.now() + ms;
  let v = null;
  while (Date.now() < end) {
    v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  return v;
};
const settle = async (ms = 600) => {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll('#vo-main .vo-skel').length === 0, null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
};
await page.goto(BASE + '#/');
await page.waitForSelector('input[type=email]', { timeout: 20000 });
await page.fill('input[type=email]', PEOPLE.partner);
await page.fill('input[type=password]', DEMO.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('#vo-main', { timeout: 20000 });
await page.waitForTimeout(1200);

section('Focus: Fix one, then Verify all with A');
await page.goto(BASE + '#/focus?at=' + encodeURIComponent('portfolio:verify:' + s.update));
await settle();
ok(await page.getByText('Acme Robotics · Oct · 5 values').isVisible(), 'the verify card for Acme opens');
const rows = page.locator('[aria-label="Staged values"] li');
eq(await rows.count(), 5, 'five staged values with their sources');
const hcRow = rows.filter({ hasText: 'Headcount' });
await hcRow.getByRole('button', { name: 'Fix one' }).click();
await hcRow.getByRole('textbox').fill('17');
await hcRow.getByRole('textbox').press('Enter');
await settle(900);
const hc = await until(async () => {
  const v = (await api.op('updates.get', { update: s.update }, { as: 'owner' })).update.values.find((x) => x.key === 'headcount');
  return v.status === 'verified' ? v : null;
});
ok(hc !== null && hc.value === 17, 'Fix one: headcount corrected to 17 and verified', hc);
await page.keyboard.press('a');
await settle(1200);
const after = await until(async () => {
  const x = (await api.op('updates.get', { update: s.update }, { as: 'owner' })).update;
  return x.status === 'verified' ? x : null;
});
ok(after !== null && after.values.every((v) => v.status === 'verified'), 'A ran Verify all: the update is verified');

section('Request updates: one dialog');
await page.goto(BASE + '#/portfolio');
await settle();
await page.getByRole('button', { name: 'Request updates' }).click();
await settle(500);
const dialog = page.getByRole('dialog');
ok(await dialog.getByRole('checkbox', { name: 'Orbital Freight' }).isChecked(), 'companies without requests are picked');
await dialog.getByRole('button', { name: 'Turn on' }).click();
await settle(900);
ok(await seen(dialog.getByText('Requested')), 'the result shows in place: Requested');
ok(await until(async () => (await api.op('requests.list', {}, { as: 'owner' })).companies.find((c) => c.company.domain === 'orbitalfreight.com').request?.enabled === true), 'Orbital Freight requests are on');
await dialog.getByRole('button', { name: 'Done' }).click();

section('Add update: pasted text becomes an update');
await page.goto(BASE + '#/portfolio/' + co('lumenhealth.io'));
await settle();
await page.getByRole('button', { name: 'Add update' }).first().click();
await page.getByRole('textbox', { name: 'Update text' }).fill('October: revenue USD 30,000, net burn USD 205,000, cash USD 1.1M.');
await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
await settle(900);
ok(await until(async () => page.url().includes('update=')), 'the new update opens');
const lu = await until(async () => {
  const x = await api.op('updates.list', { company: 'lumenhealth.io' }, { as: 'owner' });
  return x.updates.length === 1 ? x : null;
});
ok(lu !== null && lu.updates[0].source === 'manual', 'one update for Lumen Health');
ok(await seen(page.getByText('Waiting for your AI agent')), 'it says honestly that it waits for your AI agent');

section('Investment: Terms, Preview, Done');
await page.goto(BASE + (STUBBED ? '#/zz/deal/' + s.deal.number : '#/deals/' + s.deal.number + '?tab=investment'));
await settle();
await page.getByRole('button', { name: 'Preview' }).click();
await settle(700);
ok(await seen(page.getByText(/^5(\.00)?%$/)), 'Preview: 5% ownership from the engine');
await page.locator('#vo-main').getByRole('button', { name: 'Confirm', exact: true }).click();
await settle(1200);
ok(await seen(page.getByRole('button', { name: 'Open in Portfolio' })), 'Done: the holding is shown');
const gh = await until(async () => {
  const r = await api.call('holdings.get', { holding: 'gammaworks.com' }, { as: 'owner' });
  return r.status === 200 ? r.body : null;
});
eq(gh.holding.ownership_ppm, 50000, 'the holding owns 5%');

section('Board: Add meeting; Asks: Add ask');
await page.goto(BASE + '#/portfolio/' + co('orbitalfreight.com') + '?tab=board');
await settle();
await page.getByRole('button', { name: 'Add meeting' }).click();
await page.getByRole('textbox', { name: 'Title' }).fill('Q1 board');
await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
await settle(900);
ok(await until(async () => (await api.op('board.list', { company: 'orbitalfreight.com' }, { as: 'owner' })).meetings.some((m) => m.title === 'Q1 board')), 'the meeting is saved');
await page.goto(BASE + '#/portfolio/' + co('orbitalfreight.com') + '?tab=asks');
await settle();
await page.getByRole('button', { name: 'Add ask' }).click();
await page.getByRole('textbox', { name: 'Ask' }).fill('Warehouse automation advisors');
await page.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
await settle(900);
ok(await seen(page.getByText('Warehouse automation advisors'), 2000), 'the ask shows on the board at once');
ok(await until(async () => (await api.op('asks.list', { company: 'orbitalfreight.com' }, { as: 'owner' })).asks.some((a) => a.title === 'Warehouse automation advisors')), 'the ask is saved');

section('Settings: alert thresholds');
await page.goto(BASE + '#/settings/portfolio');
await settle();
await page.getByRole('spinbutton', { name: 'Runway months' }).fill('9');
await page.getByRole('button', { name: 'Save' }).first().click();
await settle(900);
ok(await until(async () => (await api.op('alerts.list', {}, { as: 'owner' })).rules.runway_months === 9), 'runway threshold saved as 9');

await browser.close();
ok(errors.length === 0, 'no console errors', errors);
summary('t04 ui flows');
