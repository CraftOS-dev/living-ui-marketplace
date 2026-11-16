// Screenshot pass of every payroll-out page: owner, payroll admin, manager and
// employee; light and dark; 1440 and 390 wide. Prints console errors.
//   node tests/shots.mjs [label]      (env: PORT=3192, OUT=<dir>, EMPTY=1 for an empty database)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP, newApi } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.PORT ?? 3192);
const BASE = `http://127.0.0.1:${PORT}/`;
const label = process.argv[2] ?? (process.env.EMPTY ? 'empty' : 'seeded');
const OUT = process.env.OUT ?? join(APP, '..', 'shots', label);
mkdirSync(OUT, { recursive: true });
const api = newApi();

async function ids() {
  if (process.env.EMPTY) return {};
  const ov = await api.op('payout.overview', { status: 'all' }, { as: 'owner' });
  const locked = ov.runs.find((r) => r.status === 'locked' && r.methods.bank) ?? ov.runs[0];
  const paid = ov.runs.find((r) => r.status === 'paid' && r.country === 'US') ?? ov.runs[0];
  const cash = ov.runs.find((r) => r.methods.cash) ?? paid;
  const fl = await api.op('filings.list', { show: 'all', limit: 5 }, { as: 'owner' });
  const packs = await api.op('packs.list', {}, { as: 'owner' });
  const draft = packs.packs.find((p) => p.status === 'tested' || p.status === 'draft') ?? packs.packs[0];
  const fed = packs.packs.find((p) => p.code === 'us-federal');
  const us = (await api.op('entities.list', {}, { as: 'owner' })).entities.find((e) => e.country === 'US');
  const w2 = await api.op('yearend.document', { entity: us.id, doc: 'w2', year: 2026 }, { as: 'owner' });
  const issued = await api.op('yearend.issued', { entity: us.id, doc: 'w2', year: 2026 }, { as: 'owner' });
  return { locked: locked.id, paid: paid.id, cash: cash.id, filing: fl.filings[0]?.id, draft: draft.id, fed: fed.id, us: us.id, employment: w2.rows[0]?.employment, issued: issued.documents[0]?.id };
}

const x = await ids();
const PAGES = {
  owner: process.env.EMPTY
    ? ['payroll/pay-out', 'payroll/pay-out/settings', 'payroll/pay-out/settings?tab=gl', 'payroll/pay-out/settings?tab=filings', 'payroll/filings', 'payroll/year-end', 'payroll/reports', 'payroll/reports?tab=cost', 'payroll/reports?tab=ytd', 'payroll/packs']
    : [
        'payroll/pay-out', 'payroll/pay-out?status=all', `payroll/pay-out/${x.locked}`, `payroll/pay-out/${x.paid}`, `payroll/pay-out/${x.cash}`,
        'payroll/pay-out/settings', 'payroll/pay-out/settings?tab=gl', 'payroll/pay-out/settings?tab=filings',
        'payroll/filings', 'payroll/filings?show=all', `payroll/filings?show=all&filing=${x.filing}`,
        `payroll/year-end?entity=${x.us}&year=2026`,
        'payroll/reports', 'payroll/reports?tab=cost', 'payroll/reports?tab=remittance', 'payroll/reports?tab=ytd', 'payroll/reports?tab=headcount',
        'payroll/packs', `payroll/packs/${x.fed}`, `payroll/packs/${x.fed}?tab=steps`, `payroll/packs/${x.fed}?tab=tables`, `payroll/packs/${x.draft}`,
        `print/payroll/year-end/w2?entity=${x.us}&year=2026&employment=${x.employment}`, `print/payroll/filing/${x.filing}`, `print/payroll/cash/${x.cash}?method=cash`,
      ],
  employee: process.env.EMPTY ? ['payroll/year-end'] : ['payroll/year-end', 'payroll/pay-out'],
  manager: ['payroll/year-end', 'payroll/filings'],
};
const WHO = { owner: 'owner@northwind.test', employee: process.env.EMPTY ? 'emp@northwind.test' : 'sam@northwind.test', manager: 'eng.lead@northwind.test' };
const only = process.env.WHO ? process.env.WHO.split(',') : Object.keys(PAGES);
const widths = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');

const browser = await chromium.launch({ headless: true });
let bad = 0;
let n = 0;
for (const who of only) {
  if (process.env.EMPTY && who === 'manager') continue;
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
      await page.fill('input[type=email]', WHO[who]);
      await page.fill('input[type=password]', 'demo-pass-1');
      await page.getByRole('button', { name: 'Sign in' }).last().click();
      await page.waitForSelector('#hr-main', { timeout: 20000 });
      await page.waitForTimeout(2000);
      let k = 0;
      for (const p of PAGES[who]) {
        k += 1;
        errors.length = 0;
        await page.goto(BASE + '#/' + p);
        await page.waitForTimeout(400);
        // the machine is shared with other builders' servers: wait until no panel is still loading
        await page.waitForFunction(() => document.querySelectorAll('[role=status] .animate-spin').length === 0, null, { timeout: 30000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        const name = `${who}_${String(k).padStart(2, '0')}_${p.replace(/[/?=&]/g, '_').replace(/_[a-z0-9]{15}/g, '_id').slice(0, 70)}_${scheme}_${w}.png`;
        await page.screenshot({ path: join(OUT, name), fullPage: w > 500 });
        n += 1;
        const own = errors.filter((e) => !/favicon|401|Failed to load resource: the server responded with a status of 40[134]/.test(e));
        if (own.length > 0) {
          bad += own.length;
          console.log(`${name}: ${own.join(' | ').slice(0, 400)}`);
        }
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log(bad === 0 ? `ok: ${n} screenshots in ${OUT}, no console errors` : `${bad} console errors (${n} screenshots)`);
process.exit(bad === 0 ? 0 : 1);
