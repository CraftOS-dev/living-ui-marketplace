// The kiosk tablet, signed out: start a kiosk through the op (as HR), keep the
// token in the tablet's storage, then the tiles, the PIN pad and the done screen
// in light and dark at 1280 and 390. Exits 1 on console errors.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { newApi } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.HR_PORT ?? 3183);
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/time/shots';
mkdirSync(OUT, { recursive: true });
const api = newApi();
const loc = (await api.op('locations.list', {}, { as: 'hr@northwind.test' })).locations.find((l) => l.name === 'Singapore HQ');
const ks = await api.op('kiosk.start', { location: loc.id, name: 'Shots tablet' }, { as: 'hr@northwind.test' });
await api.op('kiosk.pin-set', { employee: 'E0007', pin: '4826' }, { as: 'hr@northwind.test' });

const browser = await chromium.launch({ headless: true });
let bad = 0;
for (const scheme of ['light', 'dark']) {
  for (const w of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 860 }, colorScheme: scheme, isMobile: w < 500, hasTouch: w < 500 });
    await ctx.addInitScript(([code, tok]) => window.localStorage.setItem('hr.kiosk.' + code, tok), [ks.code, ks.token]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '#/time/kiosk/' + ks.code);
    await page.waitForSelector('text=Rajesh Kumar', { timeout: 60000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/kiosk_tiles_${scheme}_${w}.png` });
    await page.getByText('Rajesh Kumar').first().click();
    for (const d of '48') await page.getByRole('button', { name: d, exact: true }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/kiosk_pin_${scheme}_${w}.png` });
    for (const d of '26') await page.getByRole('button', { name: d, exact: true }).click();
    await page.locator('main button.w-full, main button:has-text("Clock")').last().click();
    await page.waitForSelector('text=Next person', { timeout: 30000 }).catch(() => errors.push('no done screen'));
    await page.screenshot({ path: `${OUT}/kiosk_done_${scheme}_${w}.png` });
    if (errors.length > 0) {
      bad += errors.length;
      console.log(scheme, w, errors.join(' | '));
    }
    await ctx.close();
  }
}
// A tablet that was never started.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
await page.goto(BASE + '#/time/kiosk/' + ks.code);
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/kiosk_not_started_light_1280.png` });
await browser.close();
console.log(bad === 0 ? 'ok kiosk: no console errors' : bad + ' errors');
process.exit(bad === 0 ? 0 : 1);
