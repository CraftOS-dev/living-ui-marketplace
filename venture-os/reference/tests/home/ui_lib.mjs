// Browser helpers for the home builder's UI tests (playwright-core, headless Chromium).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO, PORT } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
export const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = process.env.VO_SHOTS ?? join(HERE, '..', 'shots');
mkdirSync(OUT, { recursive: true });
export const BASE = `http://127.0.0.1:${PORT}/`;

/** A signed-in page in a scheme and width (New York time, the firm's zone). */
export async function open(browser, scheme, width, who = DEMO.owner) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768, timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]', { timeout: 30000 });
  await page.fill('input[type=email]', who);
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 30000 });
  await page.mouse.move(1, 1);
  return { ctx, page, errors };
}

export async function settle(page, ms = 900) {
  await page.waitForTimeout(400);
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelector('#vo-main .vo-skel, [role=dialog] .vo-skel') === null, null, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

/** Interface words at rest in the main area (data excluded: mono figures, rows, list items, charts). */
export const words = () => {
  const main = document.querySelector('#vo-main') ?? document.body;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const out = [];
  for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
    const el = t.parentElement;
    if (el === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('.vo-mono, [data-data], [role=row], [role=img], li, td, .vo-num, svg') !== null) continue;
    for (const w of t.textContent.trim().split(/\s+/)) if (/[A-Za-z]/.test(w)) out.push(w);
  }
  return out;
};

export const cursorCheck = () => {
  const sel = 'button:not(:disabled), a[href], [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=option]';
  const bad = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).cursor !== 'pointer') bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`);
  }
  return bad.slice(0, 10);
};

/** Sideways scroll on a phone, and tap targets under 40 px in the main area. */
export const phoneCheck = () => {
  const bad = [];
  const main = document.getElementById('vo-main');
  if (main !== null && main.scrollWidth > main.clientWidth + 1) bad.push('sideways scroll ' + main.scrollWidth + ' > ' + main.clientWidth);
  if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push('page sideways scroll');
  for (const el of document.querySelectorAll('#vo-main button:not(:disabled), #vo-main a[href]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 39.5 && r.width < 39.5) bad.push('small target ' + (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return bad.slice(0, 12);
};

/** Text directly under a panel label or the page title that is not data (U1). */
export const underTitles = () => {
  const bad = [];
  for (const h of document.querySelectorAll('#vo-main header .vo-label')) {
    const next = h.closest('header')?.nextElementSibling;
    if (next && next.tagName === 'P') bad.push('p under ' + h.textContent);
  }
  return bad;
};
