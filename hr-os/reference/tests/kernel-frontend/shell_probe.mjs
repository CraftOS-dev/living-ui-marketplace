// Shell probes on the demo seed: (1) the place you are in shows its children even when
// it was folded, and other places keep their folded state; (2) amounts on screen are
// unambiguous (codes when several currencies show, the symbol only for the reporting
// currency alone). Prints what it saw; exits 1 on a failed check.
import { BASE, OUT, chromium, open, settle, signIn } from './lib.mjs';

const browser = await chromium.launch({ headless: true });
const { ctx, page, errors } = await open(browser, { width: 1440, height: 900 });
await signIn(page, 'owner@northwind.test', 'demo-pass-1');
const fails = [];
const loaded = async () => {
  await page.waitForFunction(() => (document.getElementById('hr-main')?.innerText ?? '').trim().length > 40 && document.querySelector('#hr-main .hr-skel') === null, null, { timeout: 20000 }).catch(() => undefined);
  await settle(page, 900);
};

// (1) Fold Time and People in the stored state, then open a Time page (not a focus page, which folds the sidebar to a rail).
await page.evaluate(() => window.localStorage.setItem('hr.nav.open', JSON.stringify({ time: false, people: false })));
await page.goto(BASE + '#/time/timesheets');
await page.reload();
await page.waitForSelector('nav[aria-label="Main"]');
await loaded();
const nav = await page.evaluate(() => {
  const n = document.querySelector('nav[aria-label="Main"]');
  const links = [...n.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  return { time: links.filter((h) => h.startsWith('#/time/')).length, people: links.filter((h) => h.startsWith('#/people/')).length };
});
console.log('sidebar on /time/timesheets:', JSON.stringify(nav));
if (nav.time === 0) fails.push('the Time place stayed folded on its own page');
if (nav.people !== 0) fails.push('the folded People place opened by itself');
await page.screenshot({ path: `${OUT}/sidebar_active_place.png` });
// Leaving Time folds it back to the stored state; People opens when visited.
await page.evaluate(() => (location.hash = '#/people'));
await loaded();
const nav2 = await page.evaluate(() => {
  const links = [...document.querySelector('nav[aria-label="Main"]').querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  return { time: links.filter((h) => h.startsWith('#/time/')).length, people: links.filter((h) => h.startsWith('#/people/')).length };
});
console.log('sidebar on /people:', JSON.stringify(nav2));
if (nav2.time !== 0) fails.push('Time stayed open after leaving it (it was folded)');
if (nav2.people === 0) fails.push('People stayed folded on its own page');

// (2) Amounts on a few pages.
const reporting = await page.evaluate(async () => {
  const r = await fetch('/api/ops/auth/me', { headers: { Authorization: window.localStorage.getItem('hr.session') ?? '' } });
  const j = await r.json();
  return j.company?.reporting_currency ?? j.me?.company?.reporting_currency ?? '';
});
for (const p of ['inbox', 'people/E0021?tab=job', 'people/E0005?tab=job', 'people/E0001?tab=job', 'people/E0010?tab=job', 'people']) {
  await page.evaluate((h) => (location.hash = h), '#/' + p);
  await loaded();
  const amounts = await page.evaluate(() => [...document.querySelectorAll('#hr-main .hr-num')].map((e) => e.textContent.trim()).filter((s) => /\d/.test(s)).slice(0, 400));
  const money = amounts.filter((s) => /[A-Z]{3}\s|[$¥€£₹]|RM|S\$/.test(s));
  const codes = [...new Set(money.map((s) => /([A-Z]{3})\s/.exec(s)?.[1]).filter(Boolean))];
  const symbols = money.filter((s) => !/[A-Z]{3}\s/.test(s));
  console.log(`${p}: ${money.length} amounts, codes [${codes.join(', ')}], with a symbol ${symbols.length}${symbols.length > 0 ? ' e.g. ' + symbols.slice(0, 2).join(' | ') : ''}; e.g. ${money.slice(0, 3).join(' | ')}`);
  if (symbols.length > 0 && codes.length > 0) fails.push(`${p}: a symbol beside codes`);
  await page.screenshot({ path: `${OUT}/money_${p.replace(/[/?=]/g, '_')}.png` });
}
console.log('reporting currency:', reporting);
console.log(errors.length === 0 ? 'console errors: none' : 'console errors:\n' + errors.join('\n'));
console.log(fails.length === 0 ? 'ok: shell probes pass' : fails.join('\n'));
await ctx.close();
await browser.close();
process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
