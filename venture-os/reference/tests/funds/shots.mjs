// Screenshots of every funds page and dialog, light and dark, 1440 and 390, on the seed (seed_ui.mjs).
// Fails on console errors or 5xx; prints the interface word count of each page at rest (U2: about 40).
//   node shots.mjs            (ONLY=funds,event to limit; FLOW=1 also runs the call flow on the seed)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO, PORT, newApi } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'shots');
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = (process.env.ONLY ?? '').split(',').filter((x) => x !== '');
const SCHEMES = (process.env.SCHEMES ?? 'light,dark').split(',');
const WIDTHS = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);

const api = newApi();
const FIN = { as: 'finance@venture.test' };
const funds = (await api.op('funds.list', {}, FIN)).funds;
const f1 = funds.find((f) => f.name === 'Fund I');
const ev = (await api.op('calls.list', { fund: f1.id, status: 'all' }, FIN)).events;
const issued = ev.find((e) => e.kind === 'call' && e.status === 'issued');
const ready = ev.find((e) => e.status === 'previewed');
const dist = ev.find((e) => e.kind === 'distribution');
const lp = (await api.op('lps.list', { fund: f1.id }, FIN)).lps[0];
const q = (await api.op('quarters.list', { fund: f1.id }, FIN)).quarters.find((x) => x.status === 'sent' || x.status === 'final');

const PAGES = [
  ['funds', `#/funds/${f1.id}`],
  ['funds_lps', `#/funds/${f1.id}?tab=lps`],
  ['funds_capital', `#/funds/${f1.id}?tab=capital`],
  ['funds_marks', `#/funds/${f1.id}?tab=marks`],
  ['funds_reserves', `#/funds/${f1.id}?tab=reserves`],
  ['funds_reports', `#/funds/${f1.id}?tab=reports`],
  ['funds_reports_q', `#/funds/${f1.id}?tab=reports&quarter=${q.id}`],
  ['event_issued', `#/funds/${f1.id}/events/${issued.id}`],
  ['event_ready', `#/funds/${f1.id}/events/${ready.id}`],
  ['event_dist', `#/funds/${f1.id}/events/${dist.id}`],
  ['lp', `#/funds/lps/${lp.id}`],
  ['raise', '#/funds/raise'],
  ['settings_terms', '#/settings/fund_terms'],
  ['focus_marks', '#/focus?at=' + encodeURIComponent('funds:marks:' + (await api.op('quarters.list', { fund: f1.id }, FIN)).quarters.find((x) => x.status === 'open').id)],
];

async function open(browser, scheme, width) {
  const phone = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]', { timeout: 15000 });
  await page.fill('input[type=email]', 'finance@venture.test');
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 15000 });
  return { ctx, page, errors };
}

async function settle(page, ms = 900) {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll('.vo-skel').length === 0, null, { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

export async function wordCount(page) {
  return page.evaluate(() => {
    const main = document.querySelector('#vo-main') ?? document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let n = 0;
    const words = [];
    for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
      const el = t.parentElement;
      if (el === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('.vo-mono, [data-data], table, [role=table], [role=grid], [role=row]') !== null) continue;
      const w = t.textContent.trim().split(/\s+/).filter((x) => /[A-Za-z]/.test(x));
      n += w.length;
      words.push(...w);
    }
    return { n, words: words.join(' ') };
  });
}

const browser = await chromium.launch({ headless: true });
let fails = 0;
for (const scheme of SCHEMES) {
  for (const width of WIDTHS) {
    const tag = `${scheme}_${width}`;
    const { ctx, page, errors } = await open(browser, scheme, width);
    for (const [name, h] of PAGES) {
      if (ONLY.length > 0 && !ONLY.includes(name)) continue;
      await page.goto(BASE + h);
      await settle(page);
      await page.screenshot({ path: join(OUT, `${name}_${tag}.png`), fullPage: true });
      if (scheme === 'light' && width === 1440) {
        const wc = await wordCount(page);
        console.log(name.padEnd(18), String(wc.n).padStart(3), '|', wc.words.slice(0, 260));
      }
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (wide) {
        fails++;
        console.log(tag, name, 'sideways scroll');
      }
    }
    // Dialogs: the call flow (Amount and Preview), an LP sheet.
    if (ONLY.length === 0 || ONLY.includes('flow')) {
      await page.goto(BASE + `#/funds/${f1.id}?new=call`);
      await settle(page);
      await page.screenshot({ path: join(OUT, `flow_amount_${tag}.png`) });
      await page.goto(BASE + `#/funds/${f1.id}/events/${ready.id}`);
      await settle(page);
      const cont = page.getByRole('button', { name: /Issue call|Continue/ }).first();
      if (await cont.isVisible().catch(() => false)) {
        await cont.click();
        await settle(page, 700);
        await page.screenshot({ path: join(OUT, `flow_preview_${tag}.png`) });
        const nx = page.getByRole('button', { name: 'Next' });
        if (await nx.isVisible().catch(() => false)) {
          await nx.click();
          await settle(page, 500);
          await page.screenshot({ path: join(OUT, `flow_issue_${tag}.png`) });
        }
        await page.keyboard.press('Escape');
      }
      await page.goto(BASE + `#/funds/${f1.id}?tab=lps`);
      await settle(page);
      await page.goto(BASE + `#/funds/${f1.id}?tab=marks`);
      await settle(page);
      const row = page.locator('[role=row]').nth(1);
      if (await row.isVisible().catch(() => false)) {
        await row.click();
        await settle(page, 500);
        await page.screenshot({ path: join(OUT, `mark_sheet_${tag}.png`) });
        await page.keyboard.press('Escape');
      }
    }
    if (errors.length > 0) {
      fails += errors.length;
      console.log(tag, 'errors', errors.slice(0, 8));
    }
    await ctx.close();
  }
}
await browser.close();
console.log(fails === 0 ? 'shots: no console errors' : `shots: ${fails} problems`);
process.exitCode = fails > 0 ? 1 : 0;
