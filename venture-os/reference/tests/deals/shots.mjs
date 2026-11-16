// Screenshots of every deals page, sheet and dialog (light and dark, 1440 and 390) with console errors,
// interface word counts and a hover check. Run seed_demo.mjs first (or seed_demo.mjs --empty, then
// shots.mjs --empty for the empty states). Output: SCR/deals/shots/<name>_<scheme>_<width>.png
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORT, DEMO, newApi } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.OUT ?? join(process.cwd(), '..', 'shots');
mkdirSync(OUT, { recursive: true });
const EMPTY = process.argv.includes('--empty');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const api = newApi();
const report = [];

async function words(page) {
  return page.evaluate(() => {
    const main = document.querySelector('#vo-main') ?? document.body;
    const roots = [main, ...document.querySelectorAll('[role="dialog"]')];
    let n = 0;
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
        const el = t.parentElement;
        if (el === null) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.closest('.vo-mono, [data-data]') !== null) continue;
        n += t.textContent.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
      }
    }
    return n;
  });
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
  await page.waitForFunction(() => document.querySelector('.vo-skel') === null, null, { timeout: 12000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

const scenes = [];
const scene = (name, fn, o = {}) => scenes.push({ name, fn, ...o });

const acme = EMPTY ? null : (await api.op('deals.list', { q: 'Acme' }, { as: 'owner' })).deals[0];
const note = acme ? (await api.op('notes.list', { deal: acme.id }, { as: 'owner' })).notes.find((n) => n.template.key === 'first_call') : null;

if (EMPTY) {
  scene('empty_deals', async (p) => p.goto(BASE + '#/deals'));
  scene('empty_settings_pipelines', async (p) => p.goto(BASE + '#/settings/pipelines'));
  scene('empty_deal_overview', async (p) => {
    const d = (await api.op('deals.create', { company: 'blank-co.io', name: 'Blank Co' }, { as: 'owner' }).catch(() => null))?.deal ?? (await api.op('deals.list', { q: 'Blank' }, { as: 'owner' })).deals[0];
    await p.goto(BASE + '#/deals/' + d.number);
  });
  scene('empty_deal_notes', async (p) => p.goto(BASE + '#/deals/D-0001?tab=notes'));
  scene('empty_deal_files', async (p) => p.goto(BASE + '#/deals/D-0001?tab=files'));
} else {
  scene('deals_board', async (p) => p.goto(BASE + '#/deals'));
  scene('deals_table', async (p) => p.goto(BASE + '#/deals?view=table'), { phone: false });
  scene('deals_spv', async (p) => p.goto(BASE + '#/deals?pipeline=spv'), { phone: false });
  scene('deals_peek', async (p) => {
    await p.goto(BASE + '#/deals');
    await settle(p);
    await p.getByText('Acme Robotics', { exact: true }).first().click();
  }, { phone: false });
  scene('deals_phone_moveto', async (p) => {
    await p.goto(BASE + '#/deals');
    await settle(p);
    await p.getByRole('button', { name: 'Move to' }).first().click();
  }, { desktop: false });
  scene('deal_overview', async (p) => p.goto(BASE + '#/deals/' + acme.number));
  scene('deal_notes', async (p) => p.goto(BASE + '#/deals/' + acme.number + '?tab=notes'));
  scene('note_review', async (p) => p.goto(BASE + '#/deals/' + acme.number + '?tab=notes&note=' + note.id));
  scene('note_new', async (p) => {
    await p.goto(BASE + '#/deals/' + acme.number + '?tab=notes');
    await settle(p);
    await p.getByRole('button', { name: 'New note' }).first().click();
  });
  scene('deal_files', async (p) => p.goto(BASE + '#/deals/' + acme.number + '?tab=files'));
  scene('deal_brief', async (p) => {
    await p.goto(BASE + '#/deals/' + acme.number);
    await settle(p);
    await p.getByRole('button', { name: /Acme Robotics partner meeting/ }).click();
  }, { phone: false });
  for (const [label, name] of [['Pass', 'dlg_pass'], ['Team', 'dlg_team'], ['Merge', 'dlg_merge'], ['Restrict', 'dlg_restrict'], ['Assign', 'dlg_assign']])
    scene(name, async (p) => {
      await p.goto(BASE + '#/deals/' + acme.number);
      await settle(p);
      const more = p.locator('header[data-vo-chrome] button[aria-label="More"]');
      if (await more.isVisible().catch(() => false)) await more.click();
      await p.getByRole('button', { name: 'More actions' }).first().click();
      await p.getByRole('menuitem', { name: label }).click();
    }, { phone: label === 'Pass' });
  scene('deal_menu', async (p) => {
    await p.goto(BASE + '#/deals/' + acme.number);
    await settle(p);
    await p.getByRole('button', { name: 'More actions' }).first().click();
  }, { phone: false });
  scene('deal_diligence_stage', async (p) => {
    const d = (await api.op('deals.list', { q: 'Northwind', pipeline: 'deal_flow' }, { as: 'owner' })).deals[0];
    await p.goto(BASE + '#/deals/' + d.number);
  }, { phone: false });
  scene('deal_term_sheet', async (p) => {
    const d = (await api.op('deals.list', { q: 'Harbor Freight', pipeline: 'deal_flow' }, { as: 'owner' })).deals[0];
    await p.goto(BASE + '#/deals/' + d.number);
  }, { phone: false });
  scene('settings_pipelines', async (p) => p.goto(BASE + '#/settings/pipelines'));
  scene('settings_template', async (p) => {
    await p.goto(BASE + '#/settings/pipelines');
    await settle(p);
    await p.getByRole('button', { name: /^First call/ }).click();
  }, { phone: false });
  scene('focus_stall', async (p) => {
    await p.goto(BASE + '#/focus?at=' + encodeURIComponent('deals:stall:' + acme.id + ':first_meeting'));
  }, { as: 'pat@venture.test' });
}

const browser = await chromium.launch({ headless: true });
for (const scheme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    const phone = width < 768;
    const byUser = new Map();
    for (const s of scenes) {
      if (ONLY !== null && !ONLY.includes(s.name)) continue;
      if (phone && s.phone === false) continue;
      if (!phone && s.desktop === false) continue;
      const who = s.as ?? DEMO.owner;
      if (!byUser.has(who)) {
        const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
        const page = await ctx.newPage();
        const errors = [];
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
        page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
        await signIn(page, who);
        byUser.set(who, { ctx, page, errors });
      }
      const { page, errors } = byUser.get(who);
      errors.length = 0;
      try {
        await s.fn(page);
        await settle(page, 1200);
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        await page.mouse.move(2, 2);
        const file = `${s.name}_${scheme}_${width}.png`;
        await page.screenshot({ path: join(OUT, file), fullPage: !phone });
        const w = await words(page);
        const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        report.push({ shot: file, words: w, errors: errors.slice(), hscroll });
        console.log(`${file}  words ${w}${hscroll ? '  SIDEWAYS SCROLL' : ''}${errors.length ? '  ERRORS ' + JSON.stringify(errors.slice(0, 3)) : ''}`);
      } catch (err) {
        report.push({ shot: s.name, failed: String(err.message || err) });
        console.log(`${s.name} ${scheme} ${width} FAILED ${String(err.message || err).split('\n')[0]}`);
      }
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    for (const v of byUser.values()) await v.ctx.close();
  }
}
await browser.close();
writeFileSync(join(OUT, EMPTY ? 'report_empty.json' : 'report.json'), JSON.stringify(report, null, 1));
