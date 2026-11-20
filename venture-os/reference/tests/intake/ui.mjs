// Browser helpers for the intake UI checks (playwright-core, headless Chromium).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, DEMO } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
export const { chromium } = require('playwright-core');
export const BASE = `http://127.0.0.1:${PORT}/`;
export const OUT = process.env.OUT ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'shots');
mkdirSync(OUT, { recursive: true });

export async function open(browser, { width = 1440, height = 900, scheme = 'light', mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return { ctx, page, errors };
}

export async function signIn(page, email = DEMO.owner, password = DEMO.password) {
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 20000 });
}

export async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

export async function shot(page, name, full = true) {
  await page.screenshot({ path: join(OUT, name + '.png'), fullPage: full });
}

/** Interface words visible in the main area (data in mono or data marks left out), as kernel-frontend counts them. */
export async function wordCount(page, root = '#vo-main') {
  return page.evaluate((sel) => {
    const main = document.querySelector(sel) ?? document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let n = 0;
    const words = [];
    for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
      const el = t.parentElement;
      if (el === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('.vo-mono, [data-data]') !== null) continue;
      const w = t.textContent.trim().split(/\s+/).filter((x) => /[A-Za-z]/.test(x));
      n += w.length;
      words.push(...w);
    }
    return { n, words };
  }, root);
}

/** Elements that look clickable but have no pointer cursor. */
export async function noPointer(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button:not([disabled]), a[href], [role="button"], [role="option"], [role="radio"], [role="checkbox"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).cursor !== 'pointer') out.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40));
    }
    return out;
  });
}

/** Elements wider than the window (sideways scroll on a phone). */
export async function overflowX(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
