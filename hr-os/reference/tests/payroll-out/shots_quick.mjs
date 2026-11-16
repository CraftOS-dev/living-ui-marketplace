// A quick re-shot of a few routes as the payroll admin, 390 and 1440, light.
//   node tests/shots_quick.mjs <label> <route> [route ...]   (run after t02)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${process.env.PORT ?? 3192}/`;
const [label, ...routes] = process.argv.slice(2);
const OUT = join(APP, '..', 'shots', label ?? 'quick');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
let bad = 0;
for (const w of [390, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: 'light', isMobile: w < 500, hasTouch: w < 500 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', 'payroll@northwind.test');
  await page.fill('input[type=password]', 'demo-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main', { timeout: 20000 });
  for (const r of routes) {
    await page.goto(BASE + '#/' + r);
    await page.waitForTimeout(800);
    await page.waitForFunction(() => document.querySelectorAll('[role=status] .animate-spin').length === 0, null, { timeout: 60000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, r.replace(/[^a-z0-9]+/gi, '_') + '_' + w + '.png') });
  }
  if (errors.length) {
    bad += errors.length;
    console.log(w, errors.join(' | ').slice(0, 300));
  }
  await ctx.close();
}
await browser.close();
console.log(bad === 0 ? 'ok: quick shots, no console errors' : bad + ' console errors');
process.exit(bad ? 1 : 0);
