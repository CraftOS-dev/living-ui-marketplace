// After shot for T2: attendance today for an entity whose shifts are over (no clock): "Shift over".
import { createRequire } from 'node:module';
import { DEMO, newApi } from './lib.mjs';
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:' + (process.env.HR_PORT ?? 3183) + '/';
const OUT = 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/time/shots/ui/';
const KEY = process.argv[2];
const name = process.argv[3] ?? 'Northwind India Pvt Ltd';
const api = newApi();
const ent = (await api.op('entities.list', {}, { as: 'owner' })).entities.find((e) => e.name === name);
const browser = await chromium.launch({ headless: true });
for (const w of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.addInitScript(([k, id]) => window.localStorage.setItem(k, JSON.stringify({ hidePay: false, rail: false, entity: id })), [KEY, ent.id]);
  const page = await ctx.newPage();
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', 'owner@northwind.test');
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main', { timeout: 20000 });
  for (let i = 0; i < 2; i++) {
    await page.goto(BASE + '#/time');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    await page.waitForFunction(() => document.querySelectorAll('#hr-main .animate-spin').length === 0, null, { timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: OUT + 'ui_after_T2_shift_over_' + w + '.png' });
  await ctx.close();
}
await browser.close();
console.log('ok');
