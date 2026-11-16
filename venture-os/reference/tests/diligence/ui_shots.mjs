// Screenshots of every diligence screen (light and dark, 1440 and 390) on seeded data, with the UX checks of SPEC 2
// and 13: interface words at rest, no console errors or 5xx, the type scale, a pointer cursor on everything clickable,
// a hover sweep (hover differs from the surface and is never equal to it), and a phone pass (40px targets, nothing
// hover-only, no sideways scroll). Env: SKIP_SEED=1 reuses the database; ONLY=name,name limits the screens.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, PARTNER, DEMO } from './lib.mjs';
import { seedUi } from './ui_seed.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? join(HERE, '..', 'shots');
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = (process.env.ONLY ?? '').split(',').filter((x) => x !== '');
const want = (n) => ONLY.length === 0 || ONLY.includes(n);

let ids;
if (process.env.SKIP_SEED === '1') ids = JSON.parse(process.env.IDS ?? '{}');
else {
  const r = await seedUi();
  ids = { acme: r.acme.number, acme_id: r.acme.id, lumen: r.lumen.number, zeta: r.zeta.number, grid: r.grid.id };
}
console.log('seeded', JSON.stringify(ids));

async function open(browser, { width, height, scheme, mobile }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  return { ctx, page, errors };
}

async function signIn(page, email) {
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 20000 });
}

async function settle(page, ms = 900) {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll('#vo-main .vo-skel, [role=dialog] .vo-skel').length === 0, null, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

const shot = (page, name) => page.screenshot({ path: join(OUT, name + '.png'), fullPage: true });

const wordCount = () => {
  const main = document.querySelector('#vo-main') ?? document.body;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const words = [];
  for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
    const el = t.parentElement;
    if (el === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('.vo-mono, [data-data], li, td, th[scope=row], h1, h2') !== null) continue;
    for (const w of t.textContent.trim().split(/\s+/)) if (/[A-Za-z]/.test(w)) words.push(w);
  }
  return words;
};

const cursorCheck = () => {
  const sel = 'button:not(:disabled), a[href], [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=menuitem], select:not(:disabled)';
  const bad = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).cursor !== 'pointer') bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`);
  }
  return bad.slice(0, 10);
};

const typeCheck = () => {
  const ok = new Set(['10.5px', '12px', '13px', '14px', '15px', '26px']);
  const bad = new Map();
  const walker = document.createTreeWalker(document.querySelector('#vo-main') ?? document.body, NodeFilter.SHOW_TEXT);
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

const hoverTargets = () => {
  const sel = 'button:not(:disabled), a[href], li.group';
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('#vo-main') === null && el.closest('[role=dialog]') === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit === null || !(hit === el || el.contains(hit))) continue;
    el.setAttribute('data-hov', String(i));
    out.push(i++);
    if (out.length >= 50) break;
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
  const row = el.parentElement?.closest('li, tr, .group');
  const svg = el.querySelector('svg');
  const sel = el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
  return { own, parent, sel, color: getComputedStyle(el).color, border: getComputedStyle(el).borderColor, filter: getComputedStyle(el).filter, deco: getComputedStyle(el).textDecorationLine + getComputedStyle(el).boxShadow, row: row ? getComputedStyle(row).backgroundColor : '', icon: svg !== null ? getComputedStyle(svg).color : '', label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) };
};

const phoneCheck = () => {
  const bad = [];
  const main = document.getElementById('vo-main');
  if (document.documentElement.scrollWidth > innerWidth + 1 || (main !== null && main.scrollWidth > main.clientWidth + 1)) bad.push(`sideways scroll ${Math.max(document.documentElement.scrollWidth, main?.scrollWidth ?? 0)}`);
  const sel = 'button:not(:disabled), a[href], [role=tab], [role=radio], input, select, textarea';
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('#vo-main') === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('.vo-strip, .vo-scroll') !== null && (r.right > innerWidth || r.left < 0)) continue;
    const st = getComputedStyle(el);
    let hiddenUp = false;
    for (let e = el; e !== null; e = e.parentElement) if (Number(getComputedStyle(e).opacity) === 0) hiddenUp = true;
    if (hiddenUp) bad.push(`hover-only control "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`);
    let w = r.width;
    let h = r.height;
    if (el.classList.contains('hit')) {
      const after = getComputedStyle(el, '::after');
      w = Math.max(w, parseFloat(after.width) || 0);
      h = Math.max(h, parseFloat(after.height) || 0);
    }
    if (el.tagName === 'INPUT' && st.opacity === '0') continue;
    if (w < 39.5 || h < 39.5) bad.push(`small target ${Math.round(w)}x${Math.round(h)} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`);
  }
  return [...new Set(bad)].slice(0, 12);
};

const PAGES = [
  ['dd_tab', () => `#/deals/${ids.acme}?tab=diligence`, PARTNER],
  ['dd_running', () => `#/deals/${ids.lumen}?tab=diligence`, 'piers@venture.test'],
  ['dd_empty', () => `#/deals/${ids.zeta}?tab=diligence`, PARTNER],
  ['compare', () => `#/compare/${ids.grid}`, PARTNER],
  ['focus_answers', () => `#/focus?at=${encodeURIComponent('diligence:verify:' + ids.acme_id)}`, PARTNER],
  ['settings_edit', () => '#/settings/diligence', DEMO.owner],
  ['settings_view', () => '#/settings/diligence', PARTNER],
];

const browser = await chromium.launch({ headless: true });
let findings = 0;
const report = (what, list) => {
  if (list.length === 0) return;
  findings += list.length;
  console.log('  ' + what + ': ' + list.join('; '));
};
for (const [scheme, width] of [
  ['light', 1440],
  ['dark', 1440],
  ['light', 390],
  ['dark', 390],
]) {
  const phone = width < 768;
  const tag = `${scheme}_${width}`;
  const sessions = {};
  for (const [name, h, who] of PAGES) {
    if (!want(name)) continue;
    if (sessions[who] === undefined) {
      sessions[who] = await open(browser, { width, height: phone ? 844 : 900, scheme, mobile: phone });
      await signIn(sessions[who].page, who);
    }
    const { page, errors } = sessions[who];
    await page.goto(BASE + h());
    if (name === 'focus_answers') await page.reload();
    await settle(page, 1200);
    await shot(page, `${name}_${tag}`);
    const more = await page.evaluate(() => {
      const m = document.getElementById('vo-main');
      const sc = m === null ? null : [m, ...m.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 40 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY));
      if (!sc) return false;
      sc.scrollTop = sc.scrollHeight;
      return true;
    });
    if (more) {
      await page.waitForTimeout(400);
      await shot(page, `${name}_${tag}_end`);
      await page.evaluate(() => document.querySelectorAll('#vo-main, #vo-main *').forEach((e) => (e.scrollTop = 0)));
    }
    console.log(`${name}_${tag}`);
    if (scheme === 'light' && !phone) {
      const w = await page.evaluate(wordCount);
      console.log(`  words at rest ${w.length}: ${w.join(' ')}`);
      report('type', await page.evaluate(typeCheck));
    }
    if (!phone) {
      report('cursor', await page.evaluate(cursorCheck));
      const hov = await page.evaluate(hoverTargets);
      const flat = [];
      for (const i of hov) {
        const before = await page.evaluate(bgUnder, i);
        if (before === null) continue;
        await page.hover(`[data-hov="${i}"]`, { timeout: 1500 }).catch(() => undefined);
        await page.waitForTimeout(220);
        const after = await page.evaluate(bgUnder, i);
        if (after === null) continue;
        const changed = before.sel || after.own !== before.own || after.color !== before.color || after.border !== before.border || after.filter !== before.filter || after.deco !== before.deco || after.row !== before.row || after.icon !== before.icon;
        const same = after.own !== 'rgba(0, 0, 0, 0)' && after.own !== before.own && after.own === after.parent;
        if (!changed) flat.push(`no hover "${before.label}"`);
        if (same) flat.push(`hover equals surface "${before.label}"`);
      }
      await page.mouse.move(1, 1);
      report('hover ' + scheme, flat);
    } else report('phone', await page.evaluate(phoneCheck));
    // Dialogs and sheets of the tab.
    if (name === 'dd_tab' && want('reader')) {
      const chip = page.locator('#vo-main button', { hasText: /^p\.\d+$/ }).first();
      await chip.click();
      await page.waitForSelector('[role=dialog] canvas', { timeout: 15000 }).catch(() => undefined);
      await settle(page, 1500);
      await page.screenshot({ path: join(OUT, `reader_${tag}.png` ) });
      if (!phone) report('reader cursor', await page.evaluate(cursorCheck));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    if (name === 'dd_tab' && want('hand') && !phone) {
      await page.locator('#vo-main section[aria-label] > button[aria-expanded]').first().click();
      await page.waitForTimeout(300);
      await shot(page, `dd_tab_open_${tag}`);
      const row = page.locator('li.group', { has: page.locator('button[aria-label="Answer by hand"]') }).first();
      await row.hover();
      await row.locator('button[aria-label="Answer by hand"]').click();
      await page.waitForTimeout(300);
      await row.screenshot({ path: join(OUT, `hand_${tag}.png`) });
      await page.keyboard.press('Escape');
    }
    if (errors.length > 0) {
      report('console ' + name, errors.splice(0));
    }
  }
  for (const s of Object.values(sessions)) await s.ctx.close();
}
await browser.close();
console.log(findings === 0 ? 'ui ok' : findings + ' findings');
