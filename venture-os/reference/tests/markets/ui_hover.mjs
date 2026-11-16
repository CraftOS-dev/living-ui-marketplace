// Hover sweep on the markets pages (light and dark, 1440, seeded): every clickable element in the page
// body must change when hovered (background, colour, border, filter or shadow), and its hover background
// must differ from the surface under it. Prints the ones that do not.
import { createRequire } from 'node:module';
import { PORT, DEMO, newApi } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${PORT}/`;
const api = newApi();
const s = await api.op('theses.summary', {}, { as: 'partner@venture.test' });
const id = s.theses.find((t) => t.name === 'Fintech infra').id;
const browser = await chromium.launch({ headless: true });
let bad = 0;
let seen = 0;
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]');
  await page.fill('input[type=email]', 'partner@venture.test');
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main');
  for (const path of ['', '/map', '/grid']) {
    await page.goto(BASE + '#/markets/' + id + path);
    await page.waitForTimeout(1500);
    const n = await page.evaluate(() => {
      let i = 0;
      for (const el of document.querySelectorAll('#vo-main button:not(:disabled), #vo-main a[href], #vo-main [role=row][tabindex], #vo-main [draggable=true]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.top < 60 || r.bottom > innerHeight) continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit === null || !(hit === el || el.contains(hit))) continue;
        el.setAttribute('data-hov', String(i++));
        if (i >= 60) break;
      }
      return i;
    });
    const look = (k) =>
      page.evaluate((k) => {
        const el = document.querySelector(`[data-hov="${k}"]`);
        if (el === null) return null;
        const st = getComputedStyle(el);
        let under = 'rgba(0, 0, 0, 0)';
        for (let e = el.parentElement; e !== null; e = e.parentElement) {
          const b = getComputedStyle(e).backgroundColor;
          if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') {
            under = b;
            break;
          }
        }
        const svg = el.querySelector('svg');
        const inner = el.firstElementChild !== null ? getComputedStyle(el.firstElementChild).backgroundColor + getComputedStyle(el.firstElementChild).boxShadow : '';
        return { key: st.backgroundColor + '|' + st.color + '|' + st.borderColor + '|' + st.filter + '|' + st.boxShadow + '|' + st.textDecorationLine + '|' + (svg ? getComputedStyle(svg).color : '') + '|' + inner, bg: st.backgroundColor, under, label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40) };
      }, k);
    for (let k = 0; k < n; k++) {
      const before = await look(k);
      if (before === null) continue;
      await page.locator(`[data-hov="${k}"]`).hover({ force: true }).catch(() => undefined);
      await page.waitForTimeout(220);
      const after = await look(k);
      seen++;
      if (after === null) continue;
      const same = after.key === before.key;
      const flat = after.bg !== 'rgba(0, 0, 0, 0)' && after.bg === after.under;
      if (same || flat) {
        bad++;
        console.log(scheme, path || '/radar', same ? 'no hover change' : 'hover equals surface', JSON.stringify(after.label));
      }
    }
    await page.mouse.move(2, 2);
  }
  await ctx.close();
}
await browser.close();
console.log(`hover sweep: ${seen} elements, ${bad} without a distinct hover`);
