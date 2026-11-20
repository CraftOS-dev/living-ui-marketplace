// Phone audit of the time pages at 390 with a touch pointer: tap targets under
// 40 px tall or 32 px wide (QA's rule; .hit adds 16), off-scale font sizes,
// and failed requests (4xx/5xx) per page.
//   node phone_audit.mjs [email ...]
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.HR_PORT ?? 3183);
const BASE = `http://127.0.0.1:${PORT}/`;
const people = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['owner@northwind.test', 'sam@northwind.test', 'eng.lead@northwind.test'];
const pages = (process.env.PAGES ?? 'time,time/clock,time/schedule,time/attendance,time/timesheets,time/requests,time/settings,time/settings?tab=shifts,time/settings?tab=kiosk').split(',');
const SCALE = ['10.5px', '12px', '13px', '14px', '15px', '26px'];
const browser = await chromium.launch({ headless: true });
let total = 0;
for (const email of people) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const failed = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) failed.push(r.status() + ' ' + r.url().replace(BASE, '').split('?')[0]);
  });
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'demo-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main', { timeout: 20000 });
  for (const p of pages) {
    failed.length = 0;
    await page.goto(BASE + '#/' + p);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
    await page.waitForFunction(() => document.querySelectorAll('#hr-main .animate-spin').length === 0, null, { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    const out = await page.evaluate((scale) => {
      const res = { small: [], fonts: {} };
      const main = document.querySelector('#hr-main') ?? document.body;
      const sel = 'button:not(:disabled), a[href], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=option], input:not([type=hidden]), select, textarea';
      for (const el of main.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const st = getComputedStyle(el);
        const extra = el.classList.contains('hit') || el.classList.contains('hit-y') ? 16 : 0;
        const inline = el.tagName === 'A' && st.display === 'inline';
        if (!inline && el.type !== 'checkbox' && el.type !== 'radio' && (r.height + extra < 40 || r.width + extra < 32)) {
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.getAttribute('placeholder') ?? '').trim().slice(0, 28);
          res.small.push(Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + el.tagName.toLowerCase() + ' "' + name + '" ' + (el.getAttribute('class') ?? '').slice(0, 70));
        }
      }
      for (const el of main.querySelectorAll('*')) {
        if (el.childNodes.length === 0) continue;
        let txt = false;
        for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim() !== '') txt = true;
        if (!txt) continue;
        const fs = getComputedStyle(el).fontSize;
        if (!scale.includes(fs)) res.fonts[fs] = (res.fonts[fs] ?? 0) + 1;
      }
      return res;
    }, SCALE);
    const n = out.small.length;
    total += n;
    console.log(`${email.split('@')[0]} ${p}: ${n} small targets; off-scale fonts ${JSON.stringify(out.fonts)}; failed ${JSON.stringify([...new Set(failed)])}`);
    for (const s of out.small.slice(0, 40)) console.log('   ' + s);
  }
  await ctx.close();
}
await browser.close();
console.log('small targets in all: ' + total);
