// Screenshot pass of every expenses page for each role, light and dark, 1440 and 390 wide, with
// console errors and 5xx answers collected (fails on any). Run on a seeded scratch server:
//   node t05_screens.mjs <set> [label email ...]      set: seed | empty
// Env: WIDTHS (1440,390), SCHEMES (light,dark), OUT (shots folder).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${PORT}/`;
const set = process.argv[2] ?? 'seed';
const OUT = process.env.OUT ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', set);
mkdirSync(OUT, { recursive: true });
const widths = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');

const SEED = {
  owner: ['owner@northwind.test', ['expenses', 'expenses/mine', 'expenses/claims', 'expenses/claims?status=submitted', 'expenses/claims/EXP-0001', 'expenses/claims/EXP-0005', 'expenses/advances', 'expenses/advances/ADV-0001', 'expenses/travel', 'expenses/travel/TRV-0001', 'expenses/settings', 'inbox']],
  finance: ['fin@northwind.test', ['expenses', 'expenses/claims?status=approved', 'inbox', 'expenses/claims/EXP-0008']],
  manager: ['eng.lead@northwind.test', ['expenses', 'expenses/claims', 'expenses/claims/EXP-0004', 'inbox']],
  employee: ['sam@northwind.test', ['expenses', 'expenses/claims/EXP-0007', 'expenses/claims/EXP-0006', 'expenses/advances/ADV-0001', 'expenses/travel/TRV-0001', 'expenses/travel/new', 'people/E0005']],
};
const EMPTY = {
  owner: ['owner@northwind.test', ['expenses', 'expenses/claims', 'expenses/advances', 'expenses/travel', 'expenses/settings']],
  manager: ['boss@empty.test', ['expenses', 'expenses/claims', 'inbox']],
  employee: ['eve@empty.test', ['expenses', 'expenses/travel/new']],
};
const roles = set === 'empty' ? EMPTY : SEED;
const pick = process.argv.slice(3);

async function signIn(page, email) {
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'demo-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main', { timeout: 20000 });
}

async function settle(page, ms) {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelector('#hr-main .animate-spin, #hr-main .hr-skel') === null, null, { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

const browser = await chromium.launch({ headless: true });
let bad = 0;
let shots = 0;
for (const [label, [email, pages]] of Object.entries(roles)) {
  if (pick.length > 0 && !pick.includes(label)) continue;
  for (const scheme of schemes) {
    for (const w of widths) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
      await signIn(page, email);
      for (const p of pages) {
        errors.length = 0;
        await page.goto(BASE + '#/' + p);
        await settle(page, 1100);
        if (p.startsWith('people/')) {
          const tab = page.getByRole('tab', { name: 'Expenses' });
          if ((await tab.count()) > 0) {
            await tab.first().click();
            await settle(page, 700);
          }
        }
        const name = `${label}_${p.replace(/[/?=&]/g, '_')}_${scheme}_${w}.png`;
        await page.screenshot({ path: `${OUT}/${name}`, fullPage: w > 500 });
        shots++;
        const own = errors.filter((e) => !/favicon/.test(e));
        if (own.length > 0) {
          bad += own.length;
          console.log(`${name}: ${own.join(' | ')}`);
        }
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (wide) {
          bad++;
          console.log(`${name}: the page scrolls sideways`);
        }
      }
      if (label === 'employee' && set === 'seed' && w > 500 && scheme === 'light') {
        await page.goto(BASE + '#/expenses');
        await settle(page, 900);
        await page.getByRole('button', { name: 'Add expense' }).first().click();
        await settle(page, 500);
        await page.screenshot({ path: `${OUT}/${label}_add_expense_dialog_${scheme}_${w}.png` });
        shots++;
        await page.keyboard.press('Escape');
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log(bad === 0 ? `ok: ${shots} screenshots, no console errors, no sideways scroll` : `${bad} problems in ${shots} screenshots`);
process.exit(bad === 0 ? 0 : 1);
