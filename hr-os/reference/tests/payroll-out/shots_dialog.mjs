// The Singapore run with a held person: the pay-out page and the "Write the
// bank file" dialog (reconciliation), 1440 and 390, light and dark. Run after t02.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP, newApi } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${process.env.PORT ?? 3192}/`;
const OUT = join(APP, '..', 'shots', process.argv[2] ?? 'after');
mkdirSync(OUT, { recursive: true });
const api = newApi();
const ov = await api.op('payout.overview', { status: 'all' }, { as: 'owner' });
const sg = ov.runs.find((r) => r.country === 'SG');
const browser = await chromium.launch({ headless: true });
let bad = 0;
for (const scheme of ['light', 'dark']) {
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: scheme, isMobile: w < 500, hasTouch: w < 500 });
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
    await page.goto(BASE + '#/payroll/pay-out/' + sg.id);
    await page.getByText('Net pay of the run').first().waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('[role=status] .animate-spin').length === 0, null, { timeout: 60000 }).catch(() => undefined);
    await page.waitForFunction(() => document.querySelectorAll('[role=status] .animate-spin').length === 0, null, { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `dialog_sg_run_${scheme}_${w}.png`), fullPage: w > 500 });
    await page.getByRole('button', { name: /Write (bank file|it again)/ }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `dialog_sg_export_${scheme}_${w}.png`) });
    if (errors.length) {
      bad += errors.length;
      console.log(scheme, w, errors.join(' | ').slice(0, 300));
    }
    await ctx.close();
  }
}
await browser.close();
console.log(bad === 0 ? 'ok: dialog shots, no console errors' : bad + ' console errors');
process.exit(bad ? 1 : 0);
