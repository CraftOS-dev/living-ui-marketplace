// Kernel components on every page, module pages included: off-scale text sizes and touch
// targets under 40px (by the element's own box, as the module audits measure, or a .hit area),
// each finding with the element's classes so it can be traced to its component.
// Usage: node kernel_parts.mjs [pages...]   (demo seed on 3182)
import { BASE, chromium, open, settle, signIn } from './lib.mjs';

const PAGES = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['inbox', 'people', 'people/E0005', 'settings/org', 'settings/members', 'time', 'time/timesheets', 'leave', 'leave/balances', 'expenses', 'expenses/mine', 'payroll', 'payroll/components', 'hiring', 'lifecycle', 'performance', 'home', 'me', 'reports'];

const probe = () => {
  const ok = new Set(['10.5px', '12px', '13px', '14px', '15px', '26px']);
  const type = new Map();
  const walker = document.createTreeWalker(document.getElementById('hr-main') ?? document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if ((n.textContent ?? '').trim() === '') continue;
    const el = n.parentElement;
    if (el === null || el.getBoundingClientRect().width === 0) continue;
    const fs = getComputedStyle(el).fontSize;
    if (!ok.has(fs)) {
      const key = fs + ' ' + (el.className || el.parentElement?.className || '').toString().slice(0, 90);
      if (!type.has(key)) type.set(key, (n.textContent ?? '').trim().slice(0, 20));
    }
  }
  const small = new Map();
  const sel = 'button:not(:disabled), a[href], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=menuitem]';
  for (const el of document.querySelectorAll(`#hr-main ${sel}`)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const st = getComputedStyle(el);
    if (st.display === 'inline') continue;
    let w = r.width;
    let h = r.height;
    if (el.classList.contains('hit')) {
      const a = getComputedStyle(el, '::after');
      w = Math.max(w, parseFloat(a.width) || 0);
      h = Math.max(h, parseFloat(a.height) || 0);
    }
    if (w < 39.5 || h < 39.5) {
      const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
      const key = `${role} ${Math.round(r.width)}x${Math.round(r.height)} ${(el.className || '').toString().slice(0, 70)}`;
      if (!small.has(key)) small.set(key, (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20));
    }
  }
  return { type: [...type.entries()].map(([k, v]) => `${k} "${v}"`), small: [...small.entries()].map(([k, v]) => `${k} "${v}"`) };
};

const browser = await chromium.launch({ headless: true });
let total = 0;
for (const mobile of [false, true]) {
  const { ctx, page } = await open(browser, mobile ? { width: 390, height: 844, mobile: true } : { width: 1440, height: 900 });
  await signIn(page, 'owner@northwind.test', 'demo-pass-1');
  for (const p of PAGES) {
    await page.goto(BASE + '#/' + p);
    await settle(page, 1200);
    const r = await page.evaluate(probe);
    const list = mobile ? r.small : r.type;
    if (list.length > 0) {
      total += list.length;
      console.log(`${mobile ? 'touch' : 'type'} ${p}:\n  ${list.slice(0, 12).join('\n  ')}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(total === 0 ? 'ok: kernel parts on the type scale and 40px on touch on every page' : `${total} findings`);
