// One primary (black) button per screen on every hiring page: counts the
// visible buttons and links in #hr-main with the ink fill (the QA audit's
// rule), for owner, recruiter, manager and employee, 1440 and 390.
//   node primaries.mjs empty|seed   (seed reads fixtures/seed_ids.json)
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, PORT } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const state = process.argv[2] ?? 'seed';
const BASE = `http://127.0.0.1:${PORT}/`;
const ids = state === 'seed' && existsSync(join(FIXTURES, 'seed_ids.json')) ? JSON.parse(readFileSync(join(FIXTURES, 'seed_ids.json'), 'utf8')) : {};
const P = (s) => s.replace(/\{(\w+)\}/g, (_, k) => ids[k] ?? 'none');
const SEED = ['hiring', 'hiring/openings', 'hiring/openings/{opening}', 'hiring/openings/{opening}?tab=candidates', 'hiring/openings/{opening}?tab=post', 'hiring/openings/{opening}?tab=stages', 'hiring/candidates', 'hiring/candidates?view=retention', 'hiring/candidates/{candidate}', 'hiring/interviews', 'hiring/interviews/{interview}', 'hiring/interviews/{interview_done}', 'hiring/offers', 'hiring/offers/{offer}', 'hiring/requisitions', 'hiring/requisitions?open={requisition}', 'hiring/plans', 'hiring/referrals', 'hiring/settings'];
const EMPTY = ['hiring', 'hiring/openings', 'hiring/candidates', 'hiring/interviews', 'hiring/offers', 'hiring/requisitions', 'hiring/plans', 'hiring/referrals', 'hiring/settings'];
const pages = state === 'seed' ? SEED : EMPTY;
const ROLES = [
  { label: 'owner', email: 'owner@northwind.test' },
  { label: 'recruiter', email: 'rita@northwind.test' },
  { label: 'manager', email: 'eng.lead@northwind.test' },
  { label: 'employee', email: 'sam@northwind.test' },
];
const browser = await chromium.launch({ headless: true });
let bad = 0;
let seen = 0;
for (const role of ROLES) {
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, isMobile: w < 500, hasTouch: w < 500 });
    const page = await ctx.newPage();
    await page.goto(BASE + '#/home');
    await page.waitForSelector('input[type=email]', { timeout: 30000 });
    await page.fill('input[type=email]', role.email);
    await page.fill('input[type=password]', 'demo-pass-1');
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await page.waitForSelector('#hr-main', { timeout: 30000 });
    for (const p0 of pages) {
      await page.goto(BASE + '#/' + P(p0));
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
      await page.waitForFunction(() => document.querySelectorAll('#hr-main .animate-spin, article .animate-spin').length === 0, null, { timeout: 20000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      const prim = await page.evaluate(() =>
        [...document.querySelectorAll('#hr-main button, #hr-main a')]
          .filter((b) => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && String(b.className).includes('bg-[var(--hr-ink)]');
          })
          .map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 40)),
      );
      seen++;
      if (prim.length > 1) {
        bad++;
        console.log(`${role.label} ${w} ${p0}: ${prim.length} primaries: ${prim.join(' | ')}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(bad === 0 ? `ok: ${seen} screens, at most one primary each` : `${bad} of ${seen} screens with more than one primary`);
process.exit(bad === 0 ? 0 : 1);
