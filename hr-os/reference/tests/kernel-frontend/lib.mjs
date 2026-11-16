// Shared helpers for the kernel-frontend Playwright passes (headless Chromium, playwright-core).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
export const { chromium } = require('playwright-core');

export const PORT = Number(process.env.PORT ?? 3182);
export const BASE = `http://127.0.0.1:${PORT}/`;
export const OUT = process.env.OUT ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/kernel-frontend/shots';
mkdirSync(OUT, { recursive: true });

/** A page with console errors and failed requests collected. */
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

/** Apply a host theme the way CraftBot does (ThemeBridge postMessage). */
export async function theme(page, themeId, mode) {
  await page.evaluate(([id, m]) => window.postMessage({ type: 'livingui-theme', themeId: id, mode: m }, '*'), [themeId, mode]);
  await page.waitForTimeout(150);
}

export async function signIn(page, email, password) {
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]', { timeout: 15000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main', { timeout: 15000 });
}

export async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}
