// Money lint on the demo seed: no page prints a raw minor-unit amount ("780000" for
// SGD 7,800.00), and with Hide pay on no amount is left in the page text at all.
// The known amounts come from the API (every person's pay, the modules' money facts).
// Prints findings per page and owner (kernel or module); exits 1 when a kernel page fails.
// Usage: node money_lint.mjs [pages...]
import { pathToFileURL } from 'node:url';
import { BASE, PORT, chromium, open, settle, signIn } from './lib.mjs';

const APP = process.env.HR_APP ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/kernel-frontend/app';
const { client } = await import(pathToFileURL(APP + '/tools/dev/api.mjs').href);
const api = client({ port: PORT, app: APP });
const OWNER = { as: 'owner' };

const EXP = { JPY: 0, KRW: 0, VND: 0, KWD: 3, BHD: 3, OMR: 3 };
const known = new Map(); // raw minor text -> formatted major texts
const add = (minor, currency) => {
  if (!Number.isInteger(minor) || Math.abs(minor) < 1000 || currency === '') return;
  const e = EXP[currency] ?? 2;
  const major = minor / 10 ** e;
  const shown = new Intl.NumberFormat('en-US', { minimumFractionDigits: currency === 'IDR' ? 0 : e, maximumFractionDigits: currency === 'IDR' ? 0 : e }).format(major);
  known.set(String(minor), shown);
};
const dir = await api.op('people.directory', { status: 'all', limit: 500 }, OWNER);
const people = dir.people.map((p) => p.number);
const withMoney = [];
for (const n of people) {
  const p = await api.op('people.get', { employee: n }, OWNER);
  let has = false;
  for (const m of p.facts ?? []) for (const f of m.facts ?? []) if (f.kind === 'money') (add(Number(f.value), String(f.currency ?? '')), (has = true));
  if (has) withMoney.push(n);
  for (const em of p.employments ?? []) if (em.pay !== null && em.pay !== undefined) add(Number(em.pay.amount_minor), String(em.currency ?? em.pay.currency ?? ''));
}
console.log(`${known.size} known amounts from ${people.length} people (${withMoney.length} with money facts on their profile)`);

const KERNEL = (p) => /^(people|inbox|settings|print\/people)/.test(p);
const PAGES = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [...(withMoney.length > 0 ? withMoney : people).slice(0, 8).flatMap((n) => [`people/${n}`, `people/${n}?tab=job`]), 'people', 'inbox', 'settings/org', 'home', 'me', 'payroll', 'expenses', 'expenses/mine', 'reports', 'time', 'leave', 'performance', 'hiring', 'lifecycle'];

const browser = await chromium.launch({ headless: true });
const { ctx, page } = await open(browser, { width: 1440, height: 900 });
await signIn(page, 'owner@northwind.test', 'demo-pass-1');
let kernelFails = 0;
let moduleFails = 0;
const setHide = async (on) => {
  await page.evaluate((v) => {
    const raw = window.localStorage.getItem('hr.ui');
    const ui = raw !== null ? JSON.parse(raw) : {};
    ui.hidePay = v;
    window.localStorage.setItem('hr.ui', JSON.stringify(ui));
  }, on);
};
const textOf = async () => page.evaluate(() => document.getElementById('hr-main')?.innerText ?? '');
for (const hide of [false, true]) {
  await setHide(hide);
  for (const p of PAGES) {
    await page.goto(BASE + '#/' + p);
    await page.reload();
    await page.waitForSelector('#hr-main', { timeout: 20000 });
    await settle(page, 900);
    const text = await textOf();
    const found = [];
    if (!hide) {
      // A raw minor amount: the exact digits of a known amount standing alone (no grouping, no decimals).
      for (const m of text.matchAll(/(?<![\d.,])-?\d{4,}(?![\d.,])/g)) if (known.has(m[0].replace('-', ''))) found.push(`raw ${m[0]}`);
    } else {
      for (const [raw, shown] of known) if (text.includes(shown) || new RegExp(`(?<![\\d.,])${raw}(?![\\d.,])`).test(text)) found.push(`visible behind Hide pay: ${shown}`);
    }
    if (found.length > 0) {
      const who = KERNEL(p) ? 'kernel' : 'module';
      if (who === 'kernel') kernelFails++;
      else moduleFails++;
      console.log(`${hide ? 'hide pay' : 'raw'} ${who} ${p}: ${[...new Set(found)].slice(0, 6).join('; ')}`);
    }
  }
}
await setHide(false);
await ctx.close();
await browser.close();
console.log(kernelFails === 0 ? `ok: no raw minor amounts and nothing behind Hide pay on kernel pages (${PAGES.filter(KERNEL).length} pages)${moduleFails > 0 ? `; ${moduleFails} module page findings above` : '; module pages clean too'}` : `${kernelFails} kernel page findings`);
process.exit(kernelFails === 0 ? 0 : 1);
