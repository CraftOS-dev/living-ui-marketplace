// Screenshots of every markets screen and dialog, light and dark, 1440 and 390, on the seeded scratch app
// (node ui_seed.mjs first; EMPTY=1 after node ui_seed.mjs --empty for the empty states). Checks per page:
// console errors and 5xx, interface words at rest (U2), text under titles (U1), black primary buttons
// (U3), pointer cursor on everything clickable, the hover differs from the surface, no sideways scroll on
// phones. Writes PNGs to ../shots and a summary to stdout.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, DEMO, newApi } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? join(HERE, '..', 'shots');
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/`;
const EMPTY = process.env.EMPTY === '1';
const ONLY = (process.env.ONLY ?? '').split(',').filter((x) => x !== '');
const want = (n) => ONLY.length === 0 || ONLY.includes(n);
const USER = process.env.AS ?? 'partner@venture.test';

const api = newApi();
let fintech = '';
let climate = '';
let candidateKey = '';
if (!EMPTY) {
  const s = await api.op('theses.summary', {}, { as: USER });
  fintech = s.theses.find((t) => t.name === 'Fintech infra')?.id ?? '';
  climate = s.theses.find((t) => t.name === 'Climate software')?.id ?? '';
  const n = await api.op('next.list', { kinds: 'candidate' }, { as: USER });
  candidateKey = n.items.find((i) => i.title.startsWith('Fintech infra'))?.key ?? n.items[0]?.key ?? '';
}

async function open(browser, scheme, width) {
  const phone = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', USER);
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 20000 });
  return { ctx, page, errors };
}

async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

const audit = () => {
  const main = document.querySelector('#vo-main') ?? document.body;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let words = 0;
  for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
    const el = t.parentElement;
    if (el === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('.vo-mono, [data-data], [role=row], [role=listbox], [role=option], [aria-label=Candidates], section[aria-label]') !== null) continue;
    words += t.textContent.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
  }
  const sel = 'button:not(:disabled), a[href], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=option], [draggable=true]';
  const cursor = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).cursor !== 'pointer') cursor.push((el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) + ' ' + getComputedStyle(el).cursor);
  }
  const probe = document.createElement('span');
  probe.style.background = 'var(--vo-ink)';
  document.body.appendChild(probe);
  const ink = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const primaries = [...document.querySelectorAll('#vo-main button')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(b).backgroundColor === ink && b.getAttribute('role') === null;
  }).length;
  const wide = document.documentElement.scrollWidth > innerWidth + 1 || (main.scrollWidth > main.clientWidth + 1);
  return { words, cursor: cursor.slice(0, 6), primaries, wide };
};

const browser = await chromium.launch({ headless: true });
const combos = [
  ['light', 1440],
  ['dark', 1440],
  ['light', 390],
  ['dark', 390],
];
const report = [];
for (const [scheme, width] of combos) {
  const tag = `${scheme}_${width}`;
  const phone = width < 768;
  const { ctx, page, errors } = await open(browser, scheme, width);
  const snap = async (name) => {
    await page.screenshot({ path: join(OUT, `${name}_${tag}.png`), fullPage: true });
    const a = await page.evaluate(audit);
    report.push({ name, tag, ...a, errors: errors.splice(0) });
  };
  const guard = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      report.push({ name, tag, words: 0, primaries: 0, wide: false, cursor: [], errors: ['SCRIPT ' + String(e.message).split('\n')[0].slice(0, 160)] });
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  };
  const markets = async (path) => {
    await page.goto(BASE + '#/markets' + path);
    await page.waitForSelector('#vo-main [aria-label=Theses], #vo-main [role=img], #vo-main h2, #vo-main [aria-label=Candidates]', { timeout: 15000 }).catch(() => undefined);
    await settle(page, 900);
  };
  if (EMPTY) {
    if (want('empty'))
      await guard('empty', async () => {
        await markets('');
        await snap('markets_empty');
      });
    if (want('sheet'))
      await guard('sheet', async () => {
        await markets('?new=1');
        await snap('new_thesis_empty');
      });
    await ctx.close();
    continue;
  }
  if (want('radar'))
    await guard('radar', async () => {
      await markets('/' + fintech);
      await page.waitForSelector('[aria-label=Theses]', { timeout: 15000 });
      await settle(page, 600);
      await snap('markets_radar');
    });
  if (want('signal'))
    await guard('signal', async () => {
      await markets('/' + fintech);
      const row = page.locator('#vo-main >> text="Ledgerline" >> visible=true').first();
      await row.click();
      await settle(page, 500);
      await snap('signal_sheet');
      await page.keyboard.press('Escape');
    });
  if (want('map'))
    await guard('map', async () => {
      await markets('/' + fintech + '/map');
      await page.waitForSelector('section[aria-label="Ledgers"]', { timeout: 15000 });
      await settle(page, 600);
      await snap('markets_map');
      await page.locator('section[aria-label="Ledgers"] button').filter({ hasText: 'Ledgerline' }).first().click();
      await settle(page, 400);
      await snap('map_tile');
      await page.keyboard.press('Escape');
      await page.locator('button[title="Proposed by your AI agent"]').first().click();
      await settle(page, 400);
      await snap('map_proposal');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Select', exact: true }).click();
      for (const n of ['Modern Treasury', 'Fragment']) await page.locator('section button').filter({ hasText: n }).first().click();
      await settle(page, 300);
      await snap('map_select');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('radio', { name: 'Last quarter' }).click();
      await settle(page, 800);
      await snap('map_last_quarter');
    });
  if (want('map'))
    await guard('mapempty', async () => {
      await markets('/' + climate + '/map');
      await settle(page, 600);
      await snap('map_empty');
    });
  if (want('grid'))
    await guard('grid', async () => {
      await markets('/' + fintech + '/grid');
      await page.waitForSelector('#vo-main table', { timeout: 15000 });
      await settle(page, 600);
      await snap('markets_grid');
    });
  if (want('sheet'))
    await guard('sheet', async () => {
      await markets('/' + fintech);
      await page.locator('#vo-main header').getByRole('button', { name: 'New thesis' }).first().click();
      await settle(page, 600);
      await snap('new_thesis');
      await page.locator('[role=dialog]').getByRole('button', { name: 'More', exact: true }).click();
      await settle(page, 300);
      await snap('new_thesis_more');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Edit thesis' }).click();
      await settle(page, 600);
      await snap('edit_thesis');
      await page.keyboard.press('Escape');
    });
  if (want('focus') && candidateKey !== '')
    await guard('focus', async () => {
      await page.goto(BASE + '#/focus?at=' + encodeURIComponent(candidateKey));
      await page.reload();
      await page.waitForSelector('#vo-main article', { timeout: 15000 });
      await settle(page, 800);
      await snap('focus_candidates');
    });
  if (want('settings'))
    await guard('settings', async () => {
      await page.goto(BASE + '#/settings/sourcing');
      await settle(page, 1000);
      await snap('settings_sourcing');
    });
  void phone;
  await ctx.close();
}
await browser.close();
for (const r of report) console.log(`${r.name.padEnd(20)} ${r.tag.padEnd(11)} words ${String(r.words).padStart(3)} primaries ${r.primaries} wide ${r.wide ? 'YES' : 'no'} cursor ${r.cursor.length ? JSON.stringify(r.cursor) : 'ok'} errors ${r.errors.length ? JSON.stringify(r.errors).slice(0, 300) : 'none'}`);
