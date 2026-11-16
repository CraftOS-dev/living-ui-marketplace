// Page timing as UI QA measures it, plus where the time goes:
//   node timing.mjs <email> <pages,comma> [runs]        (password demo-pass-1, HR_PORT 3190)
// For each page: first meaningful paint (the page's [data-ready] marker, or its first panel without
// a skeleton), ready (no skeleton or loading status in the page and no /api/ request in flight for
// two polls), and the requests of the load with their start and duration (ms from navigation).
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.HR_PORT ?? 3190);
const BASE = `http://127.0.0.1:${PORT}/`;
const [email = 'owner@northwind.test', pagesArg = 'home', runsArg = '2'] = process.argv.slice(2);
const runs = Number(runsArg);
const width = Number(process.env.WIDTH ?? 1440);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, isMobile: width < 500, hasTouch: width < 500 });
await ctx.addInitScript(() => {
  window.__inflight = 0;
  window.__reqs = [];
  const f = window.fetch;
  window.fetch = async (...a) => {
    const u = String((a[0] && a[0].url) || a[0]);
    const mine = u.includes('/api/') && !u.includes('realtime');
    const rec = { u: u.replace(/^.*\/api\/ops\//, '').replace(/\?.*$/, ''), s: performance.now(), e: 0 };
    if (mine) {
      window.__inflight++;
      window.__reqs.push(rec);
    }
    try {
      return await f(...a);
    } finally {
      if (mine) {
        window.__inflight--;
        rec.e = performance.now();
      }
    }
  };
});
const page = await ctx.newPage();
await page.goto(BASE + '#/home');
await page.waitForSelector('input[type=email]', { timeout: 30000 });
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', 'demo-pass-1');
await page.getByRole('button', { name: 'Sign in' }).last().click();
await page.waitForSelector('#hr-main', { timeout: 30000 });
await page.waitForTimeout(2500);

for (const p of pagesArg.split(',')) {
  for (let k = 0; k < runs; k++) {
    await page.goto(BASE + '#/settings/security');
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.__reqs = [];
      window.__t0 = performance.now();
    });
    await page.evaluate((u) => {
      location.hash = u;
    }, '#/' + p);
    const t0 = Date.now();
    let first = -1;
    let quiet = 0;
    for (let i = 0; i < 300 && quiet < 2; i++) {
      const s = await page.evaluate(() => ({
        ready: document.querySelector('#hr-main [data-ready]') !== null,
        busy: document.querySelectorAll('#hr-main .hr-skel, #hr-main [role=status]').length + window.__inflight,
      }));
      if (first < 0 && s.ready) first = Date.now() - t0;
      quiet = s.busy === 0 ? quiet + 1 : 0;
      await page.waitForTimeout(50);
    }
    const ready = Date.now() - t0 - 100;
    const reqs = await page.evaluate(() => window.__reqs.map((r) => ({ u: r.u, s: Math.round(r.s - window.__t0), d: Math.round((r.e || performance.now()) - r.s) })));
    console.log(`${p} run ${k + 1}: first ${first} ms, ready ${ready} ms, ${reqs.length} requests`);
    if (process.env.REQS !== '0') for (const r of reqs.sort((a, b) => a.s - b.s)) console.log(`   ${String(r.s).padStart(6)} +${String(r.d).padStart(5)}  ${r.u}`);
  }
}
await browser.close();
