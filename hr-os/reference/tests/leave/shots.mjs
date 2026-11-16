// Screenshot pass of the leave pages: owner, HR, manager, employee; light and dark; 1440 and 390.
//   node tests/shots.mjs [label] ; env WIDTHS=1440,390 SCHEMES=light,dark ROLES=hr,manager,employee OUT=<dir>
// Prints console errors and 5xx answers per page; exits 1 when there are any.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');

const PORT = Number(process.env.HR_PORT ?? 3184);
const BASE = `http://127.0.0.1:${PORT}/`;
const LABEL = process.argv[2] ?? 'seed';
const OUT = process.env.OUT ?? `C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/leave/shots/${LABEL}`;
mkdirSync(OUT, { recursive: true });
const PW = 'demo-pass-1';

const ROLES = {
  owner: { email: 'owner@northwind.test', pages: ['leave', 'leave/settings', 'leave/settings?tab=policies', 'leave/settings?tab=locks', 'leave/settings?tab=bulk', 'leave/settings?tab=run'] },
  hr: { email: 'hr@northwind.test', pages: ['home', 'leave', 'leave/calendar', 'leave/requests', 'leave/balances', 'leave/register', 'leave/register?tab=register', 'leave/me', 'people/E0005', 'people/E0005?tab=leave', 'inbox', 'request:new'] },
  manager: { email: 'eng.lead@northwind.test', pages: ['leave', 'leave/calendar', 'leave/requests', 'inbox', 'people/E0005?tab=leave'] },
  employee: { email: 'sam@northwind.test', pages: ['home', 'leave', 'leave/calendar', 'request:new', 'request:type'] },
  jp: { email: 'haruto@northwind.test', pages: ['leave'] },
  empty_owner: { email: 'owner@northwind.test', pages: ['leave', 'leave/calendar', 'leave/requests', 'leave/balances', 'leave/register', 'leave/settings', 'leave/settings?tab=policies', 'leave/settings?tab=run'] },
  empty_employee: { email: 'emp@empty.test', pages: ['leave', 'leave/calendar'] },
};
const roles = (process.env.ROLES ?? 'owner,hr,manager,employee,jp').split(',');
const only = process.env.PAGES ? process.env.PAGES.split(',') : null;
const widths = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');

async function signIn(page, email) {
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PW);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main', { timeout: 20000 });
}
async function settle(page, ms = 900) {
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll('#hr-main [role=status], [role=dialog] [role=status]').length === 0, null, { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

const browser = await chromium.launch({ headless: true });
let bad = 0;
for (const role of roles) {
  const r = ROLES[role];
  for (const scheme of schemes) {
    for (const w of widths) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('response', (res) => res.status() >= 500 && errors.push(`${res.status()} ${res.url()}`));
      await signIn(page, r.email);
      for (const p of r.pages.filter((x) => only === null || only.includes(x))) {
        errors.length = 0;
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.keyboard.press('Escape').catch(() => undefined);
        if (p.startsWith('request:')) {
          await page.goto(BASE + '#/leave/calendar');
          await settle(page, 200);
          await page.goto(BASE + '#/leave');
          await settle(page, 700);
          const btn = page.getByRole('button', { name: /Request time off/ }).first();
          if ((await btn.count()) > 0) {
            await btn.click();
            await settle(page, 600);
            if (p === 'request:new') {
              // The sheet opens on the calendar with the usual type: one tap on a day, then Send.
              const days = page.locator('[role=dialog] [role=grid] button:not([disabled])');
              const n = await days.count();
              if (n > 20) await days.nth(15).click();
              await settle(page, 1200);
            } else if (p === 'request:type') {
              const chip = page.locator('[role=dialog] button[aria-expanded]').first();
              if ((await chip.count()) > 0) await chip.click();
              await settle(page, 400);
            }
          }
        } else {
          await page.goto(BASE + '#/' + p);
          await settle(page, 1100);
        }
        const name = `${role}_${p.replace(/[/?=&:]/g, '_')}_${scheme}_${w}.png`;
        await page.screenshot({ path: `${OUT}/${name}`, fullPage: false });
        const own = errors.filter((e) => !/favicon/.test(e));
        if (own.length > 0) {
          bad += own.length;
          console.log(`${name}: ${own.join(' | ')}`);
        }
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log(bad === 0 ? 'ok: no console errors' : `${bad} errors`);
process.exit(bad === 0 ? 0 : 1);
