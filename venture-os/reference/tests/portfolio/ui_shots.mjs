// Screenshots of every portfolio page and dialog (light and dark, 1440 and 390) on seeded data, with
// console errors, interface word counts at rest (data rows and mono figures excluded), and a hover sweep.
// Run after `node seed_ui.mjs` (or set SEED=1). OUT defaults to ../shots.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, DEMO, newApi } from './lib.mjs';
import { seed } from './seed_ui.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? join(HERE, '..', 'shots');
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/`;

let ids;
if (process.env.EMPTY === '1') await seed({ empty: true });
else if (process.env.SEED === '1') {
  const r = await seed();
  ids = { deal: r.deal.number, update: r.update, kitepay: r.kitepay };
}
const api = newApi();
const list = await api.op('holdings.list', { status: 'all' }, { as: 'owner' });
if (process.env.EMPTY === '1') list.rows = [];
const co = (d) => list.rows.find((r) => r.company.domain === d)?.company.id ?? '';
const acme = co('acmerobotics.ai');
const north = co('northwind-analytics.com');
const next = await api.op('next.list', {}, { as: 'owner' });
const verifyKey = next.items.find((i) => i.kind === 'verify')?.key ?? '';
const alertKey = next.items.find((i) => i.kind === 'alert')?.key ?? '';
const investKey = next.items.find((i) => i.key.startsWith('portfolio:invest:'))?.key ?? '';
const upd = (await api.op('updates.list', { company: acme }, { as: 'owner' })).updates[0]?.id ?? '';
const deals = await api.op('deals.list', { status: 'all' }, { as: 'owner' });
const gamma = deals.deals.find((d) => d.status === 'open')?.number ?? 'D-0007';
const invested = deals.deals.find((d) => d.status === 'invested')?.number ?? 'D-0001';
const unfiled = (await api.op('updates.list', { status: 'unassigned' }, { as: 'owner' })).updates[0]?.id ?? '';

const SCREENS = [
  { name: 'portfolio', path: '#/portfolio' },
  { name: 'company_overview', path: `#/portfolio/${acme}` },
  { name: 'company_overview_north', path: `#/portfolio/${north}` },
  { name: 'company_updates', path: `#/portfolio/${acme}?tab=updates` },
  { name: 'update_view', path: `#/portfolio/${acme}?tab=updates&update=${upd}` },
  { name: 'company_holdings', path: `#/portfolio/${north}?tab=holdings` },
  { name: 'company_asks', path: `#/portfolio/${north}?tab=asks` },
  { name: 'company_board', path: `#/portfolio/${north}?tab=board` },
  { name: 'request_dialog', path: '#/portfolio', click: 'Request updates' },
  { name: 'add_update', path: `#/portfolio/${acme}`, click: 'Add update' },
  { name: 'investment_terms', path: `#/zz/deal/${gamma}` },
  { name: 'investment_done', path: `#/zz/deal/${invested}` },
  { name: 'company_tab', path: `#/zz/company/${north}` },
  { name: 'focus_kpis', path: `#/focus?at=${encodeURIComponent(verifyKey)}` },
  { name: 'focus_alert', path: `#/focus?at=${encodeURIComponent(alertKey)}` },
  { name: 'focus_invest', path: `#/focus?at=${encodeURIComponent(investKey)}` },
  { name: 'settings', path: '#/settings/portfolio' },
  { name: 'unfiled_update', path: `#/portfolio/updates/${unfiled}` },
];
if (process.env.EMPTY === '1') SCREENS.splice(0, SCREENS.length, { name: 'empty_portfolio', path: '#/portfolio' }, { name: 'empty_settings', path: '#/settings/portfolio' });

async function signIn(page) {
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', DEMO.owner);
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 20000 });
  await page.waitForTimeout(1500);
}

async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll('#vo-main .vo-skel').length === 0, null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

/** Interface words at rest: visible text in the main area, leaving out data (table bodies, mono figures, chart text, card values). */
async function words(page) {
  return page.evaluate(() => {
    const main = document.querySelector('[role=dialog]') ?? document.querySelector('#vo-main') ?? document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let n = 0;
    const seen = [];
    for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
      const el = t.parentElement;
      if (el === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('.vo-mono, svg, [role=row]:not(:first-child), [role=rowgroup] [role=row], li, mark, p, textarea, h1') !== null) continue;
      const w = t.textContent.trim().split(/\s+/).filter((x) => /[A-Za-z]/.test(x));
      n += w.length;
      if (w.length > 0) seen.push(w.join(' '));
    }
    return { n, seen: seen.slice(0, 80) };
  });
}

const browser = await chromium.launch({ headless: true });
const report = {};
const errorsAll = [];
for (const scheme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    const phone = width < 768;
    const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('response', (r) => {
      if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
    });
    await signIn(page);
    for (const s of SCREENS) {
      if (s.path.startsWith('#/focus')) {
        await page.goto(BASE + '#/portfolio');
        await settle(page, 200);
      }
      await page.goto(BASE + s.path);
      await settle(page);
      if (s.click) {
        const btn = page.getByRole('button', { name: s.click }).first();
        if (phone && !(await btn.isVisible().catch(() => false))) await page.getByRole('button', { name: 'More' }).first().click().catch(() => undefined);
        await btn.click().catch((e) => errors.push('click ' + s.click + ': ' + e.message));
        await settle(page, 700);
      }
      const name = `${s.name}_${scheme}_${width}`;
      await page.screenshot({ path: join(OUT, name + '.png'), fullPage: !s.click });
      if (scheme === 'light' && !phone) report[s.name] = await words(page);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (sideways) errors.push(name + ': sideways scroll');
    }
    for (const e of errors) errorsAll.push(`${scheme} ${width}: ${e}`);
    await ctx.close();
  }
}

// Hover sweep (light and dark, 1440): every row and button of the Portfolio page and the update view.
const hover = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await signIn(page);
  for (const path of ['#/portfolio', `#/portfolio/${acme}?tab=updates&update=${upd}`, `#/portfolio/${north}?tab=board`]) {
    await page.goto(BASE + path);
    await settle(page);
    const els = await page.$$('#vo-main button, #vo-main [role=row], #vo-main a');
    for (const el of els.slice(0, 60)) {
      const box = await el.boundingBox();
      if (box === null || box.width === 0) continue;
      const before = await el.evaluate((n) => ({ bg: getComputedStyle(n).backgroundColor, cursor: getComputedStyle(n).cursor, parent: getComputedStyle(n.parentElement ?? n).backgroundColor }));
      await el.hover().catch(() => undefined);
      await page.waitForTimeout(220);
      const after = await el.evaluate((n) => ({ bg: getComputedStyle(n).backgroundColor, cursor: getComputedStyle(n).cursor }));
      const label = (await el.evaluate((n) => (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 40))) || '?';
      if (after.cursor !== 'pointer' && (await el.evaluate((n) => n.tagName === 'BUTTON' || n.getAttribute('role') === 'row'))) {
        const clickable = await el.evaluate((n) => n.tagName === 'BUTTON' || n.closest('[role=row]')?.getAttribute('tabindex') !== null);
        if (clickable && !(await el.evaluate((n) => n.disabled === true))) hover.push(`${scheme} ${path} no pointer: ${label}`);
      }
      if (after.bg !== 'rgba(0, 0, 0, 0)' && after.bg === before.parent && before.bg !== after.bg) hover.push(`${scheme} ${path} hover equals container: ${label}`);
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ words: report, errors: errorsAll, hover }, null, 1));
console.log('words at rest (light 1440):');
for (const [k, v] of Object.entries(report)) console.log('  ' + k + ': ' + v.n);
console.log('errors: ' + errorsAll.length);
for (const e of errorsAll.slice(0, 40)) console.log('  ' + e);
console.log('hover problems: ' + hover.length);
for (const h of hover.slice(0, 30)) console.log('  ' + h);
