// Fix 3: screenshots of every Markets screen, light and dark, 1440 and 390: VO_APP=<copy> OUT=<dir> node fix3_ui_shots.mjs [names]
// Fix 3 markets screenshots: every changed screen, light and dark, 1440 and 390, on the scratch app (port 3191).
// node shots.mjs [only,names] ; env AS=<email>, OUT=<dir>, EMPTY=1 (no theses)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.VO_APP ?? join(HERE, '..', '..', '..');
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const { client } = await import(pathToFileURL(join(APP, 'tools', 'dev', 'api.mjs')).href);
const PORT = 3191;
const OUT = process.env.OUT ?? join(APP, 'logs', 'shots_fix3');
mkdirSync(OUT, { recursive: true });
const USER = process.env.AS ?? 'owner@venture.test';
const ONLY = (process.argv[2] ?? '').split(',').filter((x) => x !== '');
const want = (n) => ONLY.length === 0 || ONLY.includes(n);
const api = client({ port: PORT, app: APP });
const sum = await api.call('theses.summary', {}, { as: 'owner' });
const theses = sum.body?.theses ?? [];
const fin = theses.find((t) => t.name === 'Fintech infrastructure')?.id ?? theses[0]?.id ?? '';
const ind = theses.find((t) => t.name === 'Industrial automation')?.id ?? fin;

async function open(browser, scheme, width) {
  const phone = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`http://127.0.0.1:${PORT}/#/`);
  await page.waitForSelector('input[type=email]', { timeout: 30000 });
  await page.fill('input[type=email]', USER);
  await page.fill('input[type=password]', 'demo-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 30000 });
  return { ctx, page, errors };
}

async function settle(page, ms = 900) {
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

const audit = () => {
  const probe = document.createElement('span');
  probe.style.background = 'var(--vo-ink)';
  document.body.appendChild(probe);
  const ink = getComputedStyle(probe).backgroundColor;
  probe.remove();
  let primaries = 0;
  for (const b of document.querySelectorAll('#vo-main button')) {
    const r = b.getBoundingClientRect();
    if (r.width > 0 && getComputedStyle(b).backgroundColor === ink) primaries++;
  }
  const dashes = /[\u2013\u2014]/.test(document.body.innerText);
  const unknown = (document.body.innerText.match(/\bUnknown\b/g) ?? []).length;
  return { primaries, sideways: document.documentElement.scrollWidth > window.innerWidth + 1, dashes, unknown };
};

const SHOTS = [
  { name: 'overview', hash: '#/markets' },
  { name: 'thesis_new', hash: `#/markets/${fin}` },
  { name: 'thesis_map', hash: `#/markets/${ind}/map` },
  {
    name: 'thesis_map_tile',
    hash: `#/markets/${ind}/map`,
    act: async (page) => {
      await page.locator('[data-map-tile]').first().click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'thesis_map_select',
    hash: `#/markets/${ind}/map`,
    act: async (page) => {
      await page.getByRole('button', { name: 'Compare companies' }).click();
      await page.locator('[data-map-tile]').nth(0).click();
      await page.locator('[data-map-tile]').nth(1).click();
      await page.waitForTimeout(400);
    },
  },
  { name: 'thesis_compare', hash: `#/markets/${fin}/grid` },
  { name: 'thesis_news', hash: `#/markets/${fin}/news` },
];

const browser = await chromium.launch();
const report = [];
for (const scheme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    const { ctx, page, errors } = await open(browser, scheme, width);
    for (const s of SHOTS) {
      if (!want(s.name)) continue;
      errors.length = 0;
      await page.goto(`http://127.0.0.1:${PORT}/${s.hash}`);
      await page.reload();
      await page.waitForSelector('#vo-main', { timeout: 30000 });
      await settle(page);
      try {
        if (s.act) await s.act(page);
      } catch (err) {
        errors.push('act: ' + String(err).slice(0, 200));
      }
      await settle(page, 400);
      const a = await page.evaluate(audit);
      const file = join(OUT, `${s.name}_${scheme}_${width}.png`);
      await page.screenshot({ path: file, fullPage: true });
      // The page scrolls inside the shell: one more shot per screen further down when there is more.
      const more = await page.evaluate(() => {
        const els = [...document.querySelectorAll('*')].filter((el) => {
          const st = getComputedStyle(el);
          return (st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 300;
        });
        const el = els.sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? document.scrollingElement;
        if (el === null || el.scrollHeight <= el.clientHeight + 40) return false;
        el.scrollTop = el.clientHeight - 80;
        return true;
      });
      if (more) {
        await page.waitForTimeout(300);
        await page.screenshot({ path: file.replace('.png', '_more.png') });
      }
      report.push({ shot: `${s.name}_${scheme}_${width}`, ...a, errors: errors.slice(0, 4) });
    }
    await ctx.close();
  }
}
await browser.close();
for (const r of report) console.log(JSON.stringify(r));
