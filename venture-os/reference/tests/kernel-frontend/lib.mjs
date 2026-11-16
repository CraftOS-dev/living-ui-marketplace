// Shared helpers for the kernel-frontend passes (playwright-core, headless Chromium) and API calls.
// PORT (default 3183), APP (the scratch app dir), OUT (screenshots dir).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
export const { chromium } = require('playwright-core');

export const PORT = Number(process.env.PORT ?? 3183);
if (PORT >= 3100 && PORT <= 3179) throw new Error('refusing a live port');
export const BASE = `http://127.0.0.1:${PORT}/`;
export const APP = process.env.APP ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/790747a9-d304-46c5-bb28-509598fb5d81/scratchpad/venture_os/kernel-frontend/app';
export const OUT = process.env.OUT ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/790747a9-d304-46c5-bb28-509598fb5d81/scratchpad/venture_os/kernel-frontend/shots';
mkdirSync(OUT, { recursive: true });

export const OWNER = { email: 'owner@harbor.vc', password: 'harbor-pass-1', pin: '246810', name: 'Sara Lin' };

/* ------------------------------------------------------------------ API */

let cookie = '';
async function ensureCookie() {
  if (cookie !== '') return;
  const r = await fetch(BASE, { redirect: 'manual' });
  cookie = (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie') ?? '']).map((c) => c.split(';')[0]).join('; ');
}

export function agentToken() {
  return readFileSync(join(APP, '.agent-token'), 'utf8').trim();
}

let methods = null;
function methodOf(name) {
  if (methods === null) methods = Object.fromEntries(JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8')).operations.map((o) => [o.name, o.executor.method]));
  return methods[name] ?? 'POST';
}

/** Call an op. as: a member token, 'agent', or nothing. Throws on a non-2xx with the body. */
export async function op(name, params = {}, { as = '', method } = {}) {
  await ensureCookie();
  const [g, v] = name.split('.');
  const get = (method ?? methodOf(name)) === 'GET';
  const url = new URL(`${BASE}api/ops/${g}/${v}`);
  const headers = { Cookie: cookie };
  if (as === 'agent') headers['X-A2App-Token'] = agentToken();
  else if (as !== '') headers['Authorization'] = as;
  let body;
  if (get) for (const [k, x] of Object.entries(params)) url.searchParams.set(k, typeof x === 'object' ? JSON.stringify(x) : String(x));
  else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(Object.fromEntries(Object.entries(params).map(([k, x]) => [k, typeof x === 'object' && x !== null ? JSON.stringify(x) : x])));
  }
  const res = await fetch(url, { method: get ? 'GET' : 'POST', headers, body });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const e = new Error(`${name} ${res.status}: ${json.message ?? text}`);
    e.status = res.status;
    e.body = json;
    throw e;
  }
  return json;
}

export async function ownerToken() {
  const r = await op('auth.login', { email: OWNER.email, password: OWNER.password });
  return r.token;
}

/* -------------------------------------------------------------- browser */

/** A page with console errors and 5xx responses collected. */
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
  await page.waitForTimeout(160);
}

export async function signIn(page, email = OWNER.email, password = OWNER.password) {
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]', { timeout: 15000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 15000 });
}

export async function settle(page, ms = 700) {
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

export async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name + '.png'), fullPage: true });
}

/** Visible interface words on the page (rough U2 count): text nodes outside data marks. */
export async function wordCount(page) {
  return page.evaluate(() => {
    const main = document.querySelector('#vo-main') ?? document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let n = 0;
    for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
      const el = t.parentElement;
      if (el === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('.vo-mono, [data-data]') !== null) continue;
      n += t.textContent.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
    }
    return n;
  });
}
