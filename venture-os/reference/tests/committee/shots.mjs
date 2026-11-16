// Screenshots of every committee page and dialog, light and dark, 1440 and 390, on the seed of seed_ui.mjs.
// Reports console errors and 5xx, interface words at rest (U2), black primary buttons per page (U3), and
// any text block directly under a heading (U1). OUT: SCR/committee/shots. ONLY=name,name to limit.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.VO_PORT ?? 3188);
if (PORT >= 3100 && PORT <= 3179) throw new Error('refusing a live port');
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.OUT ?? join(HERE, '..', 'shots');
mkdirSync(OUT, { recursive: true });
const seed = JSON.parse(readFileSync(join(HERE, 'seed.json'), 'utf8'));
const ONLY = process.env.ONLY ?? '';
const P1 = 'paula@venture.test';
const OWNER = 'owner@venture.test';
const PASS = 'demo-pass-1';

const combos = (process.env.COMBOS ?? 'light_1440,dark_1440,light_390,dark_390').split(',').map((c) => c.split('_'));

const PAGES = [
  ['committee', '#/committee', P1],
  ['committee_decisions', '#/committee?tab=decisions', P1],
  ['committee_anti', '#/committee?tab=anti', P1],
  ['room_reveal', `#/committee/${seed.ic2}?item=${seed.acmeItem}`, P1],
  ['room_cooling', `#/committee/${seed.ic2}?item=${seed.lumenItem}`, P1],
  ['room_closed', `#/committee/${seed.ic1}`, P1],
  ['memo', `#/deals/${seed.acme}?tab=memo`, P1],
  ['ic', `#/deals/${seed.gamma}?tab=ic`, P1],
  ['memo_drafts', `#/deals/${seed.delta}?tab=ic`, P1],
  ['decision', `#/deals/${seed.gamma}?tab=decision`, P1],
  ['decision_pass', `#/deals/${seed.beta}?tab=decision`, P1],
  ['settings_committee', '#/settings/committee', OWNER],
  ['focus_vote', '#/focus?at=committee:vote:' + seed.lumenItem, P1],
  ['focus_decide', '#/focus?at=committee:decide:' + seed.acmeItem, P1],
  ['focus_drafts', '#/focus?at=committee:draft:', P1],
];

async function signIn(page, email) {
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASS);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 20000 });
}

async function settle(page, ms = 900) {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

/** Interface words at rest (data in mono or links to records left out), black buttons, text under headings. */
async function audit(page) {
  return page.evaluate(() => {
    const main = document.querySelector('#vo-main') ?? document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let words = 0;
    for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
      const el = t.parentElement;
      if (el === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('.vo-mono, [data-data], textarea, input, [role=img]') !== null) continue;
      words += t.textContent.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
    }
    const blacks = [...main.querySelectorAll('button, a')].filter((b) => {
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const bg = cs.backgroundColor;
      const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(bg);
      if (m === null || (m[4] !== undefined && Number(m[4]) < 0.9)) return false;
      const lum = (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
      const dark = document.documentElement.classList.contains('dark') || matchMedia('(prefers-color-scheme: dark)').matches;
      return b.closest('[role=radiogroup], [role=group], [role=tablist]') === null && (dark ? lum > 200 : lum < 50) && r.height >= 28;
    }).map((b) => b.textContent.trim());
    const under = [];
    for (const h of main.querySelectorAll('h1, h2, h3')) {
      const n = h.nextElementSibling;
      if (n !== null && (n.tagName === 'P' || n.tagName === 'SMALL') && n.textContent.trim() !== '' && !n.closest('[data-data]')) under.push(h.textContent.trim().slice(0, 30));
    }
    return { words, blacks, under };
  });
}

const { newApi } = await import('./lib.mjs');
const api = newApi();
// Warm every runtime of the pool first (a cold PocketBase runtime spends seconds loading the hooks).
for (let i = 0; i < 3; i++) await Promise.all([P1, OWNER].flatMap((w) => ['next.count', 'meetings.list', 'notifications.list', 'chat.list', 'auth.me', 'settings.get'].map((n) => api.call(n, {}, { as: w }))));
const draftKey = ((await api.op('next.list', { kinds: 'draft' }, { as: P1 })).items.find((x) => x.key.startsWith('committee:draft:')) ?? { key: '' }).key;
const browser = await chromium.launch({ headless: true });
let fails = 0;
const report = {};
for (const [scheme, w] of combos) {
  const width = Number(w);
  const phone = width < 768;
  const tag = `${scheme}_${width}`;
  const sessions = {};
  for (const [name, h, who] of PAGES) {
    if (ONLY !== '' && !ONLY.split(',').includes(name)) continue;
    if (sessions[who] === undefined) {
      const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
      await signIn(page, who);
      sessions[who] = { ctx, page, errors };
    }
    const { page, errors } = sessions[who];
    const url = name === 'focus_drafts' ? '#/focus?at=' + draftKey : h;
    if (name.startsWith('focus')) {
      await page.goto(BASE + '#/settings/firm');
      await page.waitForTimeout(300);
    }
    await page.goto(BASE + url);
    await settle(page);
    if (name.startsWith('focus')) await page.waitForSelector('#vo-main article footer', { timeout: 10000 }).catch(() => undefined);
    if (name === 'settings_committee') await page.getByText('Memo sections').waitFor({ timeout: 10000 }).catch(() => undefined);
    if (name.startsWith('committee')) await page.waitForSelector('#vo-main [role=tablist]', { timeout: 10000 }).catch(() => undefined);
    await page.waitForFunction(() => document.querySelectorAll('#vo-main .vo-skel').length === 0, null, { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${name}_${tag}.png`), fullPage: true });
    if (h.indexOf('/deals/') >= 0) {
      const sel = await page.evaluate(() => ({ tab: document.querySelector('#vo-main [role=tab][aria-selected=true]')?.textContent?.trim() ?? '', tabs: [...document.querySelectorAll('#vo-main [role=tab]')].map((t) => t.textContent.trim()), hash: location.hash }));
      const okTab = sel.tab === 'IC';
      if (!okTab) fails++;
      console.log(`${tag} ${name}: ${okTab ? 'ok' : 'FAIL'} opens ${sel.tab} (${sel.hash}); tabs ${sel.tabs.join(', ')}`);
    }
    if (!phone) {
      const a = await audit(page);
      report[name + ' ' + scheme] = a;
    }
    if (name === 'room_cooling' && scheme === 'light') {
      const vote = page.getByRole('button', { name: 'Vote', exact: true }).first();
      if (await vote.isVisible().catch(() => false)) {
        await vote.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `vote_dialog_${tag}.png`), fullPage: false });
        await page.keyboard.press('Escape');
      }
    }
    if (name === 'committee' && scheme === 'light' && !phone) {
      const nb = page.getByRole('button', { name: 'Vote' }).first();
      if (await nb.isVisible().catch(() => false)) {
        await nb.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `committee_vote_${tag}.png`), fullPage: false });
        await page.keyboard.press('Escape');
      }
    }
    if (name === 'memo_drafts' && scheme === 'light') {
      const db = page.getByRole('button', { name: 'Draft sections' }).first();
      if (await db.isVisible().catch(() => false)) {
        await db.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `draft_dialog_${tag}.png`), fullPage: false });
        await page.keyboard.press('Escape');
      }
    }
  }
  for (const s of Object.values(sessions)) {
    if (s.errors.length > 0) {
      fails += s.errors.length;
      console.log(tag, 'errors', [...new Set(s.errors)].slice(0, 10));
    }
    await s.ctx.close();
  }
}
await browser.close();
for (const [k, v] of Object.entries(report)) console.log(k.padEnd(32), 'words', String(v.words).padStart(3), 'black', JSON.stringify(v.blacks), v.under.length > 0 ? 'UNDER ' + JSON.stringify(v.under) : '');
console.log(fails === 0 ? 'no console errors' : fails + ' console errors');
process.exit(fails > 0 ? 1 : 0);
