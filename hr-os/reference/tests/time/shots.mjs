// Screenshot pass of every time page, for one person, light and dark, 1440 and 390 wide.
//   node shots.mjs <label> <email> [pages...]      (password demo-pass-1)
// Prints console errors per page; exits 1 when there are any.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.HR_PORT ?? 3183);
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.OUT ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/time/shots';
mkdirSync(OUT, { recursive: true });

const [label = 'owner', email = 'owner@northwind.test', ...rest] = process.argv.slice(2);
const DEFAULT = ['time', 'time/clock', 'time/schedule', 'time/attendance', 'time/timesheets', 'time/requests', 'time/settings', 'time/settings?tab=shifts', 'time/settings?tab=kiosk', 'inbox'];
const pages = rest.length > 0 ? rest : DEFAULT;
const widths = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');

const browser = await chromium.launch({ headless: true });
let bad = 0;
for (const scheme of schemes) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500, geolocation: { latitude: 1.284, longitude: 103.851 }, permissions: ['geolocation'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('response', (r) => {
      if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
    });
    if (email !== 'anon') {
      await page.goto(BASE + '#/home');
      await page.waitForSelector('input[type=email]', { timeout: 20000 });
      await page.fill('input[type=email]', email);
      await page.fill('input[type=password]', 'demo-pass-1');
      await page.getByRole('button', { name: 'Sign in' }).last().click();
      await page.waitForSelector('#hr-main', { timeout: 20000 });
    }
    // Warm the server's script runtimes (the first call of each pays the load), then capture.
    if (process.env.WARM !== '0') for (const p of pages) {
      await page.goto(BASE + '#/' + p);
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
    }
    for (const p of pages) {
      errors.length = 0;
      await page.goto(BASE + '#/' + p);
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
      await page.waitForFunction(() => document.querySelectorAll('#hr-main .animate-spin, .hr-sheet .animate-spin').length === 0, null, { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      const name = `${label}_${p.replace(/[/?=&]/g, '_')}_${scheme}_${w}.png`;
      await page.screenshot({ path: `${OUT}/${name}`, fullPage: process.env.FULL === '1' });
      const own = errors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 4\d\d/.test(e));
      if (own.length > 0) {
        bad += own.length;
        console.log(`${name}: ${own.join(' | ')}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(bad === 0 ? `ok ${label}: ${pages.length} pages x ${schemes.length * widths.length} views, no console errors` : `${label}: ${bad} errors`);
process.exit(bad === 0 ? 0 : 1);
