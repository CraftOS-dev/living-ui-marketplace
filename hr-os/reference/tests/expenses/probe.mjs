// Probe one page: requests, console and the main text (debugging aid).
//   node probe.mjs <email> <hash path> [width]
import { createRequire } from 'node:module';
import { PORT } from './lib.mjs';
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const [email = 'owner@northwind.test', path = 'expenses', width = '1440'] = process.argv.slice(2);
const BASE = `http://127.0.0.1:${PORT}/`;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('requestfinished', async (r) => {
  if (!r.url().includes('/api/ops/')) return;
  const res = await r.response();
  console.log('req', res?.status(), r.method(), r.url().replace(BASE, '').slice(0, 160));
});
page.on('requestfailed', (r) => console.log('failed', r.url().slice(0, 160), r.failure()?.errorText));
await page.goto(BASE + '#/home');
await page.waitForSelector('input[type=email]');
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', 'demo-pass-1');
await page.getByRole('button', { name: 'Sign in' }).last().click();
await page.waitForSelector('#hr-main');
await page.goto(BASE + '#/' + path);
await page.waitForTimeout(4000);
console.log('TEXT', (await page.locator('#hr-main').innerText()).slice(0, 800).replace(/\n+/g, ' | '));
await browser.close();
