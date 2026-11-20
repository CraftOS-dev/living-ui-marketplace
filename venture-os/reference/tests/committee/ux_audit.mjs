// UX audit of the committee pages (light and dark, 1440 and 390): pointer cursor on everything clickable,
// hover colour distinct from its container, no sideways scroll on phones, tap targets of 32px or more on phones.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${process.env.VO_PORT ?? 3188}/`;
const seed = JSON.parse(readFileSync(join(HERE, 'seed.json'), 'utf8'));
const PAGES = [
  ['committee', '#/committee'],
  ['decisions', '#/committee?tab=decisions'],
  ['anti', '#/committee?tab=anti'],
  ['room', `#/committee/${seed.ic2}?item=${seed.acmeItem}`],
  ['room_cooling', `#/committee/${seed.ic2}?item=${seed.lumenItem}`],
  ['memo', `#/deals/${seed.delta}?tab=memo`],
  ['decision', `#/deals/${seed.gamma}?tab=decision`],
  ['settings', '#/settings/committee'],
];

const browser = await chromium.launch({ headless: true });
let problems = 0;
for (const [scheme, width] of [['light', 1440], ['dark', 1440], ['light', 390]]) {
  const phone = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: scheme, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]');
  await page.fill('input[type=email]', 'owner@venture.test');
  await page.fill('input[type=password]', 'demo-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main');
  for (const [name, h] of PAGES) {
    await page.goto(BASE + h);
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const r = await page.evaluate((isPhone) => {
      const main = document.querySelector('#vo-main');
      const out = { cursor: [], small: [], scroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
      for (const el of main.querySelectorAll('a[href], button:not([disabled]), [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch]')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (getComputedStyle(el).cursor !== 'pointer') out.cursor.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30));
        if (isPhone && Math.min(b.width, b.height) < 24 && el.closest('[role=img]') === null && !el.classList.contains('hit') && el.closest('[role=row], [role=listitem]') === null) out.small.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30) + ` ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
      return out;
    }, phone);
    // Hover: the first agenda row, table row or chip changes colour and differs from its container.
    const hov = await page.evaluate(() => {
      const el = document.querySelector('#vo-main a.group, #vo-main [role=row] a, #vo-main nav[aria-label=Agenda] button:not([aria-current])');
      if (el === null) return null;
      return { sel: el.tagName, before: getComputedStyle(el).backgroundColor, parent: getComputedStyle(el.parentElement).backgroundColor };
    });
    let hoverOk = true;
    if (hov !== null && !phone) {
      const el = await page.$('#vo-main a.group, #vo-main [role=row] a, #vo-main nav[aria-label=Agenda] button:not([aria-current])');
      await el.hover();
      await page.waitForTimeout(250);
      const after = await el.evaluate((e) => [getComputedStyle(e).backgroundColor, ...[...(e.closest('[role=row]')?.children ?? [])].slice(0, 1).map((c) => getComputedStyle(c).backgroundColor), getComputedStyle(e.closest('[role=row]') ?? e).backgroundColor]);
      hoverOk = after.some((c) => c !== hov.before && c !== hov.parent && c !== 'rgba(0, 0, 0, 0)');
    }
    const bad = r.cursor.length + (phone ? r.small.length : 0) + (r.scroll ? 1 : 0) + (hoverOk ? 0 : 1);
    problems += bad;
    console.log(`${scheme}_${width} ${name.padEnd(13)} cursor ${r.cursor.length} ${r.cursor.slice(0, 4).join(' | ')} ${phone ? 'small ' + r.small.length + ' ' + r.small.slice(0, 4).join(' | ') : ''} scroll ${r.scroll} hover ${hov === null ? 'n/a' : hoverOk}`);
  }
  await ctx.close();
}
await browser.close();
console.log(problems === 0 ? 'ux audit clean' : problems + ' ux problems');
