// The org chart once it has drawn (fit and centred on open).
import { BASE, OUT, chromium, open, signIn } from './lib.mjs';
const browser = await chromium.launch({ headless: true });
const { page } = await open(browser, { width: 1440, height: 900 });
await signIn(page, 'owner@northwind.test', 'demo-pass-1');
await page.evaluate(() => (location.hash = '#/people/org'));
await page.waitForSelector('[data-org-node]', { timeout: 90000 });
await page.waitForTimeout(800);
const zoom = await page.evaluate(() => [...document.querySelectorAll('#hr-main .hr-mono')].map((e) => e.textContent).find((x) => /%$/.test(x ?? '')));
const clipped = await page.evaluate(() => {
  const box = document.querySelector('[data-org-node]')?.closest('.overflow-hidden, [class*="cursor-grab"]') ?? document.getElementById('hr-main');
  const r = box.getBoundingClientRect();
  return [...document.querySelectorAll('[data-org-node]')].filter((n) => { const b = n.getBoundingClientRect(); return b.left < r.left - 1 || b.right > r.right + 1 || b.bottom > r.bottom + 1; }).length;
});
await page.screenshot({ path: `${OUT}/people_org_1440.png` });
console.log(`org chart opens at ${zoom}, ${clipped} cards outside the view`);
await browser.close();
