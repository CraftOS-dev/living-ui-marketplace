// UX audit on the demo seed: pointer cursor on everything clickable, a hover sweep (the hover fill differs
// from the surface under it, light and dark), and a phone pass at 390 (touch targets, nothing hover-only,
// no sideways scroll, long words wrap).
import { BASE, OUT, chromium, open, settle, signIn } from './lib.mjs';

const PAGES = ['people', 'people/E0021?tab=job', 'people/E0021?tab=personal', 'inbox', 'inbox?view=jobs', 'settings/org', 'settings/members', 'settings/roles', 'settings/calendars', 'settings/schedules', 'people/org', 'people/new'];

const cursorCheck = () => {
  const sel = 'button:not(:disabled), a[href], [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=menuitem], [role=option], select:not(:disabled)';
  const bad = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('[aria-disabled=true]') !== null) continue;
    if (getComputedStyle(el).cursor !== 'pointer') bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" cursor ${getComputedStyle(el).cursor}`);
  }
  return bad.slice(0, 10);
};

const hoverTargets = () => {
  const sel = 'button:not(:disabled), a[href], [role=row][tabindex]';
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) continue;
    // Only what the pointer can reach (not clipped by a canvas, not under another layer).
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit === null || !(hit === el || el.contains(hit))) continue;
    el.setAttribute('data-hov', String(i));
    out.push(i++);
    if (out.length >= 60) break;
  }
  return out;
};

const bgUnder = (i) => {
  const el = document.querySelector(`[data-hov="${i}"]`);
  if (el === null) return null;
  const own = getComputedStyle(el).backgroundColor;
  let parent = 'rgb(255, 255, 255)';
  for (let e = el.parentElement; e !== null; e = e.parentElement) {
    const b = getComputedStyle(e).backgroundColor;
    if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') {
      parent = b;
      break;
    }
  }
  const row = el.closest('li, [data-org-node]');
  const sel = el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true';
  return { own, parent, sel, color: getComputedStyle(el).color, border: getComputedStyle(el).borderColor, filter: getComputedStyle(el).filter, deco: getComputedStyle(el).textDecorationLine + getComputedStyle(el).boxShadow, row: row !== null ? getComputedStyle(row).backgroundColor + getComputedStyle(row).borderColor : '', label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) };
};

const phoneCheck = () => {
  const bad = [];
  if (document.documentElement.scrollWidth > innerWidth + 1 || document.getElementById('hr-main')?.scrollWidth > innerWidth + 1) bad.push(`sideways scroll ${document.documentElement.scrollWidth}`);
  const sel = 'button:not(:disabled), a[href], [role=tab], [role=radio], [role=switch], [role=checkbox], input, select, textarea';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const st = getComputedStyle(el);
    if (Number(st.opacity) === 0 && el.tagName !== 'INPUT') bad.push(`hidden control "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`);
    // A touch target is 40 x 40 or more: the box itself, or a .hit element's ::after touch area.
    let w = r.width;
    let h = r.height;
    if (el.classList.contains('hit')) {
      const after = getComputedStyle(el, '::after');
      w = Math.max(w, parseFloat(after.width) || 0);
      h = Math.max(h, parseFloat(after.height) || 0);
    }
    // The PIN boxes' input covers its six 44px boxes; an input inside a bigger control is measured by the control.
    if (el.tagName === 'INPUT' && st.opacity === '0') continue;
    if (w < 39.5 || h < 39.5) bad.push(`small target ${Math.round(w)}x${Math.round(h)} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`);
  }
  return [...new Set(bad)].slice(0, 10);
};

/* The type scale: 10.5px mono labels, 12, 13, 14, 15, 26px text, nothing else. */
const typeCheck = () => {
  const ok = new Set(['10.5px', '12px', '13px', '14px', '15px', '26px']);
  const bad = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if ((n.textContent ?? '').trim() === '') continue;
    const el = n.parentElement;
    if (el === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fs = getComputedStyle(el).fontSize;
    if (!ok.has(fs) && !bad.has(fs)) bad.set(fs, (n.textContent ?? '').trim().slice(0, 24));
  }
  return [...bad.entries()].map(([fs, txt]) => `${fs} "${txt}"`);
};

const browser = await chromium.launch({ headless: true });
let fails = 0;
for (const scheme of ['light', 'dark']) {
  const { ctx, page } = await open(browser, { width: 1440, height: 900, scheme });
  await signIn(page, 'owner@northwind.test', 'demo-pass-1');
  for (const p of PAGES) {
    await page.goto(BASE + '#/' + p);
    await settle(page, 800);
    if (scheme === 'light') {
      const ty = await page.evaluate(typeCheck);
      if (ty.length > 0) {
        fails += ty.length;
        console.log(`type ${p}: ${ty.slice(0, 8).join('; ')}`);
      }
    }
    const c = await page.evaluate(cursorCheck);
    if (c.length > 0) {
      fails += c.length;
      console.log(`cursor ${p} ${scheme}: ${c.join('; ')}`);
    }
    const ids = await page.evaluate(hoverTargets);
    const flat = [];
    for (const i of ids) {
      const before = await page.evaluate(bgUnder, i);
      if (before === null) continue;
      await page.hover(`[data-hov="${i}"]`, { timeout: 1500 }).catch(() => undefined);
      await page.waitForTimeout(170);
      const after = await page.evaluate(bgUnder, i);
      if (after === null) continue;
      const changed = before.sel || after.own !== before.own || after.color !== before.color || after.border !== before.border || after.filter !== before.filter || after.deco !== before.deco || after.row !== before.row;
      const sameAsSurface = after.own !== 'rgba(0, 0, 0, 0)' && after.own !== before.own && after.own === after.parent;
      if (!changed && !/^#/.test(before.label)) flat.push(`no hover "${before.label}"`);
      if (sameAsSurface) flat.push(`hover equals surface "${before.label}"`);
    }
    await page.mouse.move(1, 1);
    if (flat.length > 0) {
      fails += flat.length;
      console.log(`hover ${p} ${scheme}: ${flat.slice(0, 8).join('; ')}`);
    }
  }
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, { width: 390, height: 844, mobile: true });
  await signIn(page, 'owner@northwind.test', 'demo-pass-1');
  for (const p of PAGES) {
    await page.goto(BASE + '#/' + p);
    await settle(page, 800);
    const b = await page.evaluate(phoneCheck);
    if (b.length > 0) {
      fails += b.length;
      console.log(`phone ${p}: ${b.join('; ')}`);
    }
  }
  // A long unbroken word in free text must not widen anything.
  await page.goto(BASE + '#/inbox?view=jobs');
  await settle(page, 600);
  await page.fill('textarea[aria-label="Ask your AI agent"]', 'company_accelerator_program_application_filling_data_folder_with_a_very_long_name');
  await page.waitForTimeout(200);
  const wide = await page.evaluate(() => document.getElementById('hr-main')?.scrollWidth ?? 0);
  if (wide > 391) {
    fails++;
    console.log(`phone long word widens the page to ${wide}`);
  }
  await page.screenshot({ path: `${OUT}/phone_longword.png` });
  await ctx.close();
}
await browser.close();
console.log(fails === 0 ? `ok: type scale, cursor, hover (light, dark) and phone checks (40px targets) pass on ${PAGES.length} pages` : `${fails} findings`);
process.exit(fails === 0 ? 0 : 1);
