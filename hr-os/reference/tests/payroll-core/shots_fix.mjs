// payroll-core: the Fix where the issue is (QA2 N4), in the browser. On the
// database t03 leaves: a Singapore person without a birth date in a fresh
// December run; the owner (who may edit people) gets the editor and saves; the
// payroll administrator (who may not) gets "Ask HR to add it". 1440 and 390.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { newApi, PORT, DEMO, O, calcRun } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const OUT = 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/payroll-core/shots/fix';
mkdirSync(OUT, { recursive: true });
const api = newApi();
const dir = (await api.op('people.directory', { status: 'current', limit: 500 }, O)).people;
const who = dir.find((x) => x.entity_name === 'Northwind Pte Ltd' && /Rajesh|Mei Lin|Alex/.test(x.name));
const born = (await api.op('people.get', { employee: who.employee }, O)).employee.birth_date;
await api.op('people.update', { employee: who.employee, birth_date: '' }, O);
const runs = (await api.op('payruns.list', { entity: who.entity, status: 'open', limit: 20 }, O)).payruns;
let run = runs.find((r) => r.kind === 'regular');
if (!run) {
  const home = await api.op('payroll.home', {}, O);
  const s = home.schedules.find((x) => x.entity === who.entity);
  run = (await api.op('payruns.create', { schedule: s.schedule }, O)).payrun;
}
await calcRun(api, run.id);
const BASE = `http://127.0.0.1:${PORT}/`;
const browser = await chromium.launch({ headless: true });
const results = [];
for (const [email, width] of [[DEMO.owner, 1440], ['payroll@northwind.test', 1440], [DEMO.owner, 390], ['payroll@northwind.test', 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '#/home');
  const needs = await page.waitForSelector('input[type=email]', { timeout: 4000 }).then(() => true).catch(() => false);
  if (needs) {
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', DEMO.password);
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await page.waitForSelector('#hr-main', { timeout: 15000 });
  }
  await page.goto(BASE + '#/payroll/runs/' + run.id + '?tab=issues');
  await page.waitForFunction(() => /birth date/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => undefined);
  const name = email.split('@')[0] + '-' + width;
  const owner = email === DEMO.owner;
  const btn = page.getByRole('button', { name: owner ? 'Add it' : 'Ask HR to add it' }).first();
  const has = await btn.count();
  if (has > 0) await btn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/' + name + '.png', fullPage: width !== 390 });
  results.push({ name, button: has > 0, errors, text: owner ? await page.locator('text=Save and recalculate').count() : await page.locator('text=Sent to HR').count() });
  await ctx.close();
}
await browser.close();
await api.op('people.update', { employee: who.employee, birth_date: born }, O);
console.log(JSON.stringify(results));
const bad = results.filter((r) => !r.button || r.errors.length > 0 || r.text === 0);
console.log(results.length + ' fix views, ' + bad.length + ' wrong');
process.exitCode = bad.length > 0 ? 1 : 0;
