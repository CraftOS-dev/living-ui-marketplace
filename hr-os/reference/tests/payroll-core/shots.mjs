// payroll-core screenshots: every payroll page for owner, payroll admin,
// manager and employees, light and dark, 1440 and 390 wide, with console
// errors collected. Run on the database t03_flows.mjs leaves (seeded), or
// with --empty on a fresh database after setup only.
//   node tests/shots.mjs [--empty]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { newApi, fresh, PORT, DEMO, O } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const EMPTY = process.argv.includes('--empty');
const OUT = 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/payroll-core/shots' + (EMPTY ? '/empty' : '/seeded');
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/`;
const api = newApi();

if (EMPTY) {
  fresh({ seed: false });
  await api.op('setup.complete', { company_name: 'Empty Co', entity_name: 'Empty Pte Ltd', legal_name: 'Empty Pte. Ltd.', country: 'SG', reporting_currency: 'SGD', owner_name: 'Olive Owner', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
}

const pages = [];
if (EMPTY) {
  for (const p of ['/payroll', '/payroll/runs', '/payroll/schedules', '/payroll/components', '/payroll/items', '/payroll/settings', '/payroll/loans', '/payroll/declarations']) pages.push({ who: DEMO.owner, path: p });
} else {
  const runs = (await api.op('payruns.list', { limit: 100 }, O)).payruns;
  const sg = runs.find((r) => r.entity_name === 'Northwind Pte Ltd' && r.kind === 'regular' && r.status === 'paid');
  const jpDec = runs.find((r) => r.entity_name === 'Northwind KK' && r.kind === 'regular' && r.status === 'calculated');
  const slips = (await api.op('payruns.get', { payrun: sg.id }, O)).payslips;
  const sam = slips.find((s) => s.number === 'E0005');
  const dir = (await api.op('people.directory', { status: 'all', limit: 200 }, O)).people;
  const P = {};
  for (const r of dir) P[r.number] = r;
  const held = runs.find((r) => r.entity_name === 'Northwind KK' && r.kind === 'regular' && r.held_count > 0);
  const blocked = runs.find((r) => r.status === 'calculated' && r.blockers > 0) || jpDec;
  for (const p of ['/payroll', '/payroll/run', '/payroll/runs', '/payroll/runs/' + sg.id, ...(held ? ['/payroll/runs/' + held.id] : []), '/payroll/runs/' + blocked.id + '?tab=issues', '/payroll/runs/' + sg.id + '?tab=issues', '/payroll/runs/' + jpDec.id + '?tab=changes', '/payroll/runs/' + jpDec.id + '?tab=components', '/payroll/runs/' + jpDec.id + '?tab=notes', '/payroll/runs/' + sg.id + '?slip=' + sam.id, '/payroll/payslip/' + sam.id, '/print/payroll/payslip/' + sam.id, '/payroll/schedules', '/payroll/components', '/payroll/items', '/payroll/items?tab=recurring', '/payroll/items?tab=import', '/payroll/items?tab=holds', '/payroll/settings', '/payroll/loans', '/payroll/declarations', '/payroll/tax/' + P.E0016.employment, '/payroll/backpay?employment=' + P.E0016.employment + '&from=2026-11-01', '/people/E0005?tab=m.pay'])
    pages.push({ who: 'payroll@northwind.test', path: p });
  pages.push({ who: DEMO.owner, path: '/payroll' });
  pages.push({ who: 'eng.lead@northwind.test', path: '/payroll' });
  pages.push({ who: 'eng.lead@northwind.test', path: '/people/E0005?tab=m.pay' });
  for (const p of ['/payroll', '/payroll?tab=tax', '/payroll?tab=loans', '/payroll/payslip/' + sam.id]) pages.push({ who: 'sam@northwind.test', path: p });
  pages.push({ who: 'haruto@northwind.test', path: '/payroll?tab=loans' });
  pages.push({ who: 'ananya@northwind.test', path: '/payroll?tab=declarations' });
}

const browser = await chromium.launch({ headless: true });
const report = [];
const sessions = {};
for (const scheme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    for (const who of [...new Set(pages.map((p) => p.who))]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: scheme, isMobile: width === 390, hasTouch: width === 390 });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('response', (r) => {
        if (r.status() >= 500) errors.push(r.status() + ' ' + r.url());
      });
      await page.goto(BASE + '#/home');
      if (sessions[who]) await page.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, sessions[who]);
      await page.goto(BASE + '#/home');
      const needs = await page.waitForSelector('input[type=email]', { timeout: 4000 }).then(() => true).catch(() => false);
      if (needs) {
        await page.fill('input[type=email]', who);
        await page.fill('input[type=password]', DEMO.password);
        await page.getByRole('button', { name: 'Sign in' }).last().click();
        await page.waitForSelector('#hr-main', { timeout: 15000 });
        sessions[who] = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
      }
      for (const p of pages.filter((x) => x.who === who)) {
        errors.length = 0;
        await page.goto(BASE + '#' + p.path);
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined);
        await page.waitForFunction(() => document.querySelectorAll('#hr-main [role=status], article [role=status], aside [role=status]').length === 0, null, { timeout: 10000 }).catch(() => undefined);
        if (p.path.indexOf('slip=') >= 0) await page.waitForFunction(() => /NET PAY|Net pay/.test((document.querySelector('aside[role=dialog]') || { innerText: '' }).innerText), null, { timeout: 10000 }).catch(() => undefined);
        await page.waitForTimeout(400);
        const name = [scheme, width, who.split('@')[0], p.path.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)].join('-') + '.png';
        await page.screenshot({ path: OUT + '/' + name, fullPage: width !== 390 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        const missing = await page.evaluate(() => (document.body.innerText.match(/payroll\.[a-z_]+\.[a-z_.]+|payroll\.[a-z_]+/g) || []).slice(0, 5));
        report.push({ name, errors: errors.slice(), overflow, missing });
        if (errors.length || overflow || missing.length) console.log('  !', name, JSON.stringify({ errors: errors.slice(0, 3), overflow, missing }));
      }
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 1));
const bad = report.filter((r) => r.errors.length || r.overflow || r.missing.length);
console.log(report.length + ' screenshots, ' + bad.length + ' with console errors, overflow or missing copy');
process.exitCode = bad.length > 0 ? 1 : 0;
