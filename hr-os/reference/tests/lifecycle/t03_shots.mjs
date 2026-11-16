/**
 * Screenshot pass of every lifecycle page (headless Chromium through
 * playwright-core): an empty database first (owner), then the demo company
 * with lifecycle data, as the owner (HR), a manager, an employee and a new
 * hire, light and dark, 1440 and 390 wide. Fails on any console error or
 * 5xx answer. Shots go to SCR/lifecycle/shots/.
 *
 *   node tests/t03_shots.mjs [--only <name part>]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fresh, ok, section, done, PORT, APP, DEMO } from './lib.mjs';
import { seedLifecycle } from './seed_lifecycle.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SHOTS || join(APP, '..', 'shots');
mkdirSync(OUT, { recursive: true });
const limited = { n: 0 };
const others = new Set();
const LIFECYCLE_GROUPS = ['lifecycle', 'checklist-templates', 'checklists', 'tasks', 'letter-templates', 'letters', 'separations', 'exit-forms', 'assets', 'handbook', 'grievance-types', 'grievances'];
const only = process.argv.indexOf('--only') >= 0 ? process.argv[process.argv.indexOf('--only') + 1] : '';
// Per page: text off the type scale (10.5 mono labels, 12, 13, 14, 15, 26) and phone tap targets under 40 px
// (a .hit control counts 16 px more), written to SCR/lifecycle/shots/audit.json for review.
const audit = {};

async function session(browser, email, { width, scheme }) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
  const page = await ctx.newPage();
  const errors = [];
  // A failing operation of another module (merged or not in this copy) is reported, not counted against lifecycle.
  const theirs = (url) => {
    const m = /\/api\/ops\/([a-z0-9-]+)\//.exec(url || '');
    return m !== null && LIFECYCLE_GROUPS.indexOf(m[1]) < 0;
  };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location() ? m.location().url : '';
    if (theirs(loc)) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 500) {
      if (theirs(r.url())) others.add(r.status() + ' ' + r.url().replace(/\?.*$/, '').replace(/^.*\/api\/ops\//, ''));
      else errors.push(`${r.status()} ${r.url()}`);
    }
    if (r.status() === 429) limited.n++;
  });
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main', { timeout: 20000 });
  return { ctx, page, errors };
}

async function shoot(s, name, hash) {
  if (only !== '' && name.indexOf(only) < 0) return;
  s.errors.length = 0;
  await s.page.goto(BASE + '#' + hash);
  await s.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await s.page.waitForTimeout(Number(process.env.SHOT_WAIT || 2200));
  const missing = await s.page.evaluate(() => document.body.innerText.match(/\blifecycle\.[a-z_]+(\.[a-z_]+)?\b/g) || []);
  await s.page.screenshot({ path: join(OUT, name + '.png'), fullPage: true });
  audit[name] = await s.page.evaluate(() => {
    const ok = new Set([10.5, 12, 13, 14, 15, 26]);
    const out = { offScale: [], targets: [] };
    const main = document.getElementById('hr-main') || document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const el = n.parentElement;
      if (el === null || seen.has(el) || n.textContent.trim() === '' || el.closest('svg') !== null) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
      if (!ok.has(fs)) out.offScale.push(fs + 'px "' + n.textContent.trim().slice(0, 30) + '"');
    }
    if (innerWidth < 500) {
      for (const el of main.querySelectorAll('button:not(:disabled), a[href], [role=tab], [role=radio], [role=switch], [role=checkbox], input:not([type=hidden]), select, textarea')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const st = getComputedStyle(el);
        const extra = el.classList.contains('hit') ? 16 : 0;
        const inline = el.tagName === 'A' && st.display === 'inline';
        if (!inline && el.type !== 'checkbox' && el.type !== 'radio' && (r.height + extra < 40 || r.width + extra < 32)) out.targets.push(Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + el.tagName.toLowerCase() + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30) + '"');
      }
    }
    return out;
  });
  ok(s.errors.length === 0, name + ': no console errors', s.errors.slice(0, 5));
  ok(missing.length === 0, name + ': no missing copy keys', missing.slice(0, 5));
  const text = await s.page.evaluate(() => document.body.innerText);
  ok(!/[\u2013\u2014]/.test(text), name + ': no en or em dashes on screen');
}

const browser = await chromium.launch({ headless: true });

section('empty database');
{
  const api = fresh();
  await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
  const s = await session(browser, DEMO.owner, { width: 1440, scheme: 'light' });
  for (const [n, h] of [['empty_home', '/lifecycle'], ['empty_tasks', '/lifecycle/tasks'], ['empty_checklists', '/lifecycle/checklists'], ['empty_templates', '/lifecycle/templates'], ['empty_letters', '/lifecycle/letters'], ['empty_letter_templates', '/lifecycle/letters?tab=templates'], ['empty_separations', '/lifecycle/separations'], ['empty_assets', '/lifecycle/assets'], ['empty_handbook', '/lifecycle/handbook'], ['empty_grievances', '/lifecycle/grievances'], ['empty_welcome', '/lifecycle/welcome'], ['empty_main_home', '/home']]) await shoot(s, n, h);
  await s.ctx.close();
  const m = await session(browser, DEMO.owner, { width: 390, scheme: 'dark' });
  for (const [n, h] of [['empty_home_390_dark', '/lifecycle'], ['empty_assets_390_dark', '/lifecycle/assets']]) await shoot(m, n, h);
  await m.ctx.close();
}

section('demo company');
const api = fresh({ seed: true });
const ids = await seedLifecycle(api);
const ownerPages = [
  ['home', '/lifecycle'],
  ['main_home', '/home'],
  ['board', `/lifecycle/checklists/${ids.board}`],
  ['tasks_all', '/lifecycle/tasks?view=all'],
  ['checklists', '/lifecycle/checklists?status=all'],
  ['templates', '/lifecycle/templates'],
  ['letters', '/lifecycle/letters'],
  ['letter_draft', `/lifecycle/letters/${ids.draft}`],
  ['letter_issued', `/lifecycle/letters/${ids.issued}`],
  ['letter_templates', '/lifecycle/letters?tab=templates'],
  ['letter_template', `/lifecycle/letter-templates/${ids.appointment}`],
  ['separations', '/lifecycle/separations'],
  ['separation', `/lifecycle/separations/${ids.separation}`],
  ['settlement', `/lifecycle/separations/${ids.separation}/settlement`],
  ['assets', '/lifecycle/assets'],
  ['asset_sheet', `/lifecycle/assets?a=${ids.laptop}`],
  ['handbook', `/lifecycle/handbook/${ids.page}`],
  ['handbook_edit', `/lifecycle/handbook/${ids.page}?edit=1`],
  ['grievances', '/lifecycle/grievances'],
  ['grievance', `/lifecycle/grievances/${ids.grievance}`],
  ['profile_tab', `/people/${ids.sam}?tab=m.lifecycle`],
  ['inbox', '/inbox'],
  ['print_letter', `/print/lifecycle/letter/${ids.issued}`],
  ['print_settlement', `/print/lifecycle/settlement/${ids.separation}`],
];
for (const [suffix, width, scheme] of [['1440_light', 1440, 'light'], ['1440_dark', 1440, 'dark'], ['390_light', 390, 'light']]) {
  const s = await session(browser, 'hr@northwind.test', { width, scheme });
  for (const [n, h] of ownerPages) await shoot(s, `hr_${n}_${suffix}`, h);
  await s.ctx.close();
}
for (const [suffix, width, scheme] of [['1440_light', 1440, 'light'], ['390_dark', 390, 'dark']]) {
  const s = await session(browser, 'eng.lead@northwind.test', { width, scheme });
  for (const [n, h] of [['home', '/lifecycle'], ['main_home', '/home'], ['board', `/lifecycle/checklists/${ids.board}`], ['tasks', '/lifecycle/tasks'], ['separation', `/lifecycle/separations/${ids.separation}`], ['separations', '/lifecycle/separations'], ['handbook', '/lifecycle/handbook'], ['profile_tab', `/people/${ids.sam}?tab=m.lifecycle`]]) await shoot(s, `mgr_${n}_${suffix}`, h);
  await s.ctx.close();
}
for (const [suffix, width, scheme] of [['390_light', 390, 'light'], ['1440_dark', 1440, 'dark']]) {
  const s = await session(browser, 'sam@northwind.test', { width, scheme });
  for (const [n, h] of [['main_home', '/home'], ['separation', `/lifecycle/separations/${ids.separation}`], ['letters', '/lifecycle/letters'], ['letter', `/lifecycle/letters/${ids.issued}`], ['handbook', '/lifecycle/handbook'], ['grievances', '/lifecycle/grievances'], ['grievance', `/lifecycle/grievances/${ids.grievance}`], ['tasks', '/lifecycle/tasks'], ['profile_tab', `/people/${ids.sam}?tab=m.lifecycle`]]) await shoot(s, `emp_${n}_${suffix}`, h);
  await s.ctx.close();
  const l = await session(browser, 'lina@northwind.test', { width, scheme });
  for (const [n, h] of [['main_home', '/home'], ['welcome', '/lifecycle/welcome'], ['board', `/lifecycle/checklists/${ids.board}`], ['letter_list', '/lifecycle/letters']]) await shoot(l, `newhire_${n}_${suffix}`, h);
  await l.ctx.close();
}
await browser.close();
writeFileSync(join(OUT, 'audit.json'), JSON.stringify(audit, null, 1));
console.log('429 answers during the pass: ' + limited.n);
if (others.size > 0) console.log('5xx from other modules (not lifecycle): ' + [...others].join(', '));
done('t03_shots');
