// Probe one page: requests, failures, console, spinners and the page text after a wait.
//   node probe.mjs <email> <path> [waitMs]
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${process.env.HR_PORT ?? 3183}/`;
const [email = 'owner@northwind.test', path = 'time/clock', wait = '6000'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const counts = {};
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('pageerror', e.message));
const t0 = Date.now();
page.on('request', (r) => {
  if (!r.url().includes('/api/ops/')) return;
  if (process.env.TIMES === '1') console.log('REQ', Date.now() - t0, r.url().replace(BASE, '').slice(0, 70));
  const k = r.url().replace(BASE, '').split('?')[0];
  counts[k] = (counts[k] || 0) + 1;
});
page.on('response', async (r) => {
  if (r.url().includes('/api/ops/clock/') || r.url().includes('/api/ops/shifts/')) {
    let b = '';
    try { b = (await r.text()).slice(0, 160); } catch (e) { b = 'unreadable ' + e.message; }
    console.log('RESP', Date.now() - t0, r.status(), r.url().replace(BASE, '').slice(0, 80), b);
  }
});
page.on('requestfailed', (r) => console.log('FAILED', r.url().replace(BASE, '').slice(0, 100), r.failure()?.errorText));
if (email !== 'anon') {
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'demo-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main');
}
for (const k of Object.keys(counts)) delete counts[k];
await page.goto(BASE + '#/' + path);
await page.waitForTimeout(Number(wait));
const text = await page.evaluate(() => (document.querySelector('#hr-main') ?? document.body).innerText);
console.log('TEXT', text.slice(0, 500).split('\n').join(' | '));
console.log('REQUESTS', JSON.stringify(counts));
await browser.close();
