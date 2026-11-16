// Screenshot pass of every hiring page for owner, recruiter, manager and
// employee, light and dark, 1440 and 390 wide; fails on any console error
// or 5xx. Run after the app is built (vite to pb/pb_public) and served.
//   node shots.mjs empty|seed   (seed reads fixtures/seed_ids.json)
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, PORT } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const state = process.argv[2] ?? 'seed';
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = join(FIXTURES, '..', '..', 'shots', state);
mkdirSync(OUT, { recursive: true });
const ids = state === 'seed' && existsSync(join(FIXTURES, 'seed_ids.json')) ? JSON.parse(readFileSync(join(FIXTURES, 'seed_ids.json'), 'utf8')) : {};
const only = (process.env.ONLY ?? '').split(',').filter((x) => x !== '');

const P = (s) => s.replace(/\{(\w+)\}/g, (_, k) => ids[k] ?? 'none');
const FULL = state === 'seed'
  ? ['hiring', 'hiring/openings', 'hiring/openings/{opening}', 'hiring/openings/{opening}?tab=candidates', 'hiring/openings/{opening}?tab=post', 'hiring/openings/{opening}?tab=stages', 'hiring/openings/{opening_us}?tab=post', 'hiring/candidates', 'hiring/candidates?view=retention', 'hiring/candidates/{candidate}', 'hiring/interviews?mine=', 'hiring/interviews/{interview_done}', 'hiring/offers', 'hiring/offers/{offer}', 'hiring/requisitions', 'hiring/requisitions?open={requisition}', 'hiring/plans', 'hiring/referrals', 'hiring/settings', 'print/hiring/offer/{offer}', 'inbox']
  : ['hiring', 'hiring/openings', 'hiring/candidates', 'hiring/interviews', 'hiring/offers', 'hiring/requisitions', 'hiring/plans', 'hiring/referrals', 'hiring/settings'];
const ROLES = [
  { label: 'owner', email: 'owner@northwind.test', pages: FULL },
  { label: 'recruiter', email: 'rita@northwind.test', pages: state === 'seed' ? ['hiring', 'hiring/openings/{opening}', 'hiring/interviews/{interview}', 'hiring/candidates/{candidate}'] : ['hiring', 'hiring/candidates'] },
  { label: 'manager', email: 'eng.lead@northwind.test', pages: state === 'seed' ? ['hiring', 'hiring/openings/{opening}', 'hiring/candidates/{candidate}', 'hiring/interviews', 'hiring/interviews/{interview}', 'hiring/requisitions'] : ['hiring', 'hiring/interviews', 'hiring/requisitions'] },
  { label: 'employee', email: 'sam@northwind.test', pages: state === 'seed' ? ['hiring/interviews', 'hiring/interviews/{interview}', 'hiring/candidates/{candidate}', 'hiring/referrals'] : ['hiring/interviews', 'hiring/referrals'] },
].filter((r) => only.length === 0 || only.includes(r.label));
const widths = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');

const browser = await chromium.launch({ headless: true });
let bad = 0;
let shots = 0;
for (const role of ROLES) {
  for (const scheme of schemes) {
    for (const w of widths) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
      await page.goto(BASE + '#/home');
      await page.waitForSelector('input[type=email]', { timeout: 20000 });
      await page.fill('input[type=email]', role.email);
      await page.fill('input[type=password]', 'demo-pass-1');
      await page.getByRole('button', { name: 'Sign in' }).last().click();
      await page.waitForSelector('#hr-main', { timeout: 20000 });
      for (const p0 of role.pages) {
        const p = P(p0);
        errors.length = 0;
        await page.goto(BASE + '#/' + p);
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
        await page.waitForFunction(() => document.querySelectorAll('#hr-main .animate-spin, article .animate-spin').length === 0, null, { timeout: 20000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        const name = `${role.label}_${p0.replace(/[{}]/g, '').replace(/[/?=&]/g, '_')}_${scheme}_${w}.png`;
        await page.screenshot({ path: join(OUT, name), fullPage: process.env.FULLPAGE === '1' });
        shots++;
        const own = errors.filter((e) => !/favicon|429/.test(e));
        if (own.length > 0) {
          bad += own.length;
          console.log(`${name}: ${own.join(' | ').slice(0, 600)}`);
        }
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (wide) {
          bad++;
          console.log(`${name}: page scrolls sideways`);
        }
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log(bad === 0 ? `ok: ${shots} screenshots, no console errors, no sideways scroll` : `${bad} problems in ${shots} screenshots`);
process.exit(bad === 0 ? 0 : 1);
