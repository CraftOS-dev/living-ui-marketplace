// The funds flows through the screens (headless Chromium) on the seed (seed_ui.mjs):
//   1. a capital call in three screens and one PIN (Amount, Preview, Issue), then its page with the paid bar
//   2. Record received on a line: the bar fills
//   3. Approve all marks from Focus with the PIN
//   4. a hover sweep of rows and buttons (hover differs from its container), pointer cursors
//   node flow_ui.mjs
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO, PORT, eq, newApi, ok, section, summary } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'shots');
const BASE = `http://127.0.0.1:${PORT}/`;
const api = newApi();
const FIN = { as: 'finance@venture.test' };
const fund = (await api.op('funds.list', {}, FIN)).funds.find((f) => f.name === 'Fund I');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
const settle = async (ms = 600) => {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll('.vo-skel').length === 0, null, { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
};
await page.goto(BASE + '#/');
await page.fill('input[type=email]', 'finance@venture.test');
await page.fill('input[type=password]', DEMO.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('#vo-main');

section('a capital call: three screens and one PIN');
const before = (await api.op('calls.list', { fund: fund.id, status: 'all' }, FIN)).total;
await page.goto(BASE + `#/funds/${fund.id}`);
await settle();
let clicks = 0;
await page.getByRole('button', { name: 'New call' }).click();
clicks++;
const sheet = page.getByRole('dialog');
await sheet.getByRole('radio', { name: 'Investment' }).click();
clicks++;
await sheet.getByRole('textbox', { name: 'Amount' }).fill('750,000');
await sheet.getByRole('button', { name: 'Holding', exact: true }).click();
clicks++;
await page.getByRole('option', { name: /Acme Robotics/ }).first().click().catch(async () => page.getByText('Acme Robotics').last().click());
clicks++;
await sheet.getByRole('switch', { name: 'Add fees' }).click().catch(async () => sheet.getByLabel('Add fees').click());
clicks++;
await page.screenshot({ path: join(OUT, 'uiflow_1_amount.png') });
await sheet.getByRole('button', { name: 'Preview' }).click();
clicks++;
await settle(800);
await page.screenshot({ path: join(OUT, 'uiflow_2_preview.png') });
const total = (await sheet.getByText(/^USD [0-9,]+[.][0-9]{2}$/).last().textContent()) ?? '';
ok(total.startsWith('USD ') && /[0-9],[0-9]{3}[.][0-9]{2}$/.test(total), 'the preview shows the exact total (' + total + ')');
await sheet.getByRole('button', { name: 'Next' }).click();
clicks++;
await settle(400);
await page.screenshot({ path: join(OUT, 'uiflow_3_issue.png') });
await sheet.getByRole('button', { name: 'Issue call' }).click();
clicks++;
await page.getByRole('textbox', { name: 'Approval PIN' }).fill(DEMO.pin);
await page.waitForURL(/events\//, { timeout: 15000 });
await settle(900);
await page.screenshot({ path: join(OUT, 'uiflow_4_event.png'), fullPage: true });
const after = (await api.op('calls.list', { fund: fund.id, status: 'all' }, FIN)).events.filter((x) => x.kind === 'call').reduce((a, b) => (b.number > a.number ? b : a));
eq(after.status, 'issued', 'the call is issued');
ok((await api.op('calls.list', { fund: fund.id, status: 'all' }, FIN)).total === before + 1, 'one new call');
ok(clicks <= 9, 'clicks from New call to issued: ' + clicks + ' plus the amount and the PIN');
ok(await page.getByText('Paid').first().isVisible(), 'the event page shows the paid bar');

section('Record received fills the bar');
const row = page.locator('[role=row]').filter({ hasText: 'Alpine Endowment' }).first();
await row.hover();
await row.getByRole('button', { name: 'Record received' }).click();
await settle(900);
const ev = (await api.op('calls.get', { event: after.id }, FIN)).event;
ok(ev.paid_minor > 0, 'a payment is recorded (' + ev.paid_minor + ')');
await page.screenshot({ path: join(OUT, 'uiflow_5_paid.png'), fullPage: true });

section('Approve all marks from Focus with the PIN');
const nx = await api.op('next.list', { kinds: 'mark' }, { as: 'partner@venture.test' });
const key = nx.items[0]?.key;
ok(key !== undefined, 'the partner has the marks card');
await page.close();
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p2 = await ctx2.newPage();
p2.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
p2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await p2.goto(BASE + '#/');
await p2.waitForSelector('input[type=email]');
await p2.fill('input[type=email]', 'partner@venture.test');
await p2.fill('input[type=password]', DEMO.password);
await p2.getByRole('button', { name: 'Sign in' }).click();
await p2.waitForSelector('#vo-main');
await p2.goto(BASE + '#/focus?at=' + encodeURIComponent(key));
await p2.waitForTimeout(1500);
await p2.getByRole('button', { name: /Approve all/ }).first().click();
await p2.getByRole('textbox', { name: 'Approval PIN' }).fill(DEMO.pin);
const t1 = Date.now();
await p2.getByRole('textbox', { name: 'Approval PIN' }).waitFor({ state: 'detached', timeout: 20000 }).catch(() => undefined);
console.log('  the PIN dialog closed after ' + (Date.now() - t1) + ' ms');
await p2.waitForTimeout(800);
await p2.screenshot({ path: join(OUT, 'uiflow_6_focus_after.png') });
const m = await api.op('marks.list', { fund: fund.id }, FIN);
eq(m.totals.drafts, 0, 'every draft mark is approved');

section('hover and pointer');
await p2.goto(BASE + `#/funds/${fund.id}?tab=capital`);
await p2.waitForTimeout(1500);
const rows = p2.locator('[role=row]');
const n = await rows.count();
let same = 0;
let notPointer = 0;
for (let i = 1; i < Math.min(n, 5); i++) {
  const r = rows.nth(i);
  const bg0 = await r.evaluate((el) => getComputedStyle(el).backgroundColor);
  await r.hover();
  await p2.waitForTimeout(220);
  const bg1 = await r.evaluate((el) => getComputedStyle(el).backgroundColor);
  if (bg0 === bg1) same++;
  const cur = await r.evaluate((el) => getComputedStyle(el).cursor);
  if (cur !== 'pointer') notPointer++;
}
eq(same, 0, 'every capital row changes on hover');
eq(notPointer, 0, 'every clickable row has the pointer cursor');
const btns = p2.locator('main button:visible, #vo-main button:visible');
let noPtr = 0;
for (let i = 0; i < Math.min(await btns.count(), 20); i++) if ((await btns.nth(i).evaluate((el) => getComputedStyle(el).cursor)) !== 'pointer') noPtr++;
eq(noPtr, 0, 'buttons have the pointer cursor');

ok(errors.length === 0, 'no console errors', errors);
await browser.close();
const s = summary('flow_ui');
process.exitCode = s.failed > 0 ? 1 : 0;
