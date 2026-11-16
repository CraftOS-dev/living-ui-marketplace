// Probe one page: log op requests, their status and time, console messages.
//   node tests/probe.mjs <email> <hash path> [waitMs]
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const [email = 'hr@northwind.test', path = 'leave/calendar', wait = '6000'] = process.argv.slice(2);
const BASE = 'http://127.0.0.1:' + (process.env.HR_PORT ?? 3184) + '/';
const browser = await chromium.launch({ headless: true });
const W = Number(process.env.W ?? 1440);
const ctx = await browser.newContext({ viewport: { width: W, height: W < 500 ? 844 : 900 }, isMobile: W < 500, hasTouch: W < 500, colorScheme: process.env.SCHEME ?? 'light' });
const page = await ctx.newPage();
const t0 = Date.now();
page.on('console', (m) => console.log('console.' + m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('request', (r) => r.url().includes('/api/ops/') && console.log(((Date.now() - t0) / 1000).toFixed(2), '->', r.method(), r.url().replace(BASE, '').slice(0, 160)));
page.on('response', (r) => r.url().includes('/api/ops/') && console.log(((Date.now() - t0) / 1000).toFixed(2), '<-', r.status(), r.url().replace(BASE, '').slice(0, 100)));
await page.goto(BASE + '#/home');
await page.waitForSelector('input[type=email]');
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', 'demo-pass-1');
await page.getByRole('button', { name: 'Sign in' }).last().click();
await page.waitForSelector('#hr-main');
for (const step of (process.env.BEFORE ?? '').split(',').filter((x) => x !== '')) {
  console.log('--- step', step);
  await page.goto(BASE + '#/' + step);
  await page.waitForTimeout(2500);
}
console.log('--- signed in, going to', path);
await page.goto(BASE + '#/' + path);
await page.waitForTimeout(Number(wait));
const spin = await page.locator('#hr-main [role=status]').count();
console.log('spinners left:', spin);
await page.screenshot({ path: 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/leave/shots/probe.png' });
await browser.close();
