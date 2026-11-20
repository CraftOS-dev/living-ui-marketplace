// Phone page headers on every route at 360, 390 and 430 px (owner, demo seed): the title is
// shown whole (no ellipsis, at most two lines), the header and the page never scroll sideways,
// and the shell's tools (search, Hide pay, notifications) sit inside the screen. Screenshots of
// each header go to OUT/phonehead/<route>_<width>.png. Panel header buttons must stay inside their header.
// Usage: node phonehead.mjs [routes...]
import { mkdirSync } from 'node:fs';
import { BASE, OUT, chromium, open, signIn } from './lib.mjs';

const STATIC = 'expenses expenses/advances expenses/claims expenses/mine expenses/settings expenses/travel expenses/travel/new hiring hiring/candidates hiring/interviews hiring/offers hiring/openings hiring/plans hiring/referrals hiring/requisitions hiring/settings home inbox inbox?view=proposals inbox?view=requests inbox?view=jobs leave leave/balances leave/calendar leave/me leave/register leave/requests leave/settings lifecycle lifecycle/assets lifecycle/checklists lifecycle/grievances lifecycle/handbook lifecycle/letters lifecycle/separations lifecycle/tasks lifecycle/templates lifecycle/welcome me me/ask me/directory me/documents me/profile me/requests payroll payroll/backpay payroll/components payroll/declarations payroll/filings payroll/items payroll/loans payroll/packs payroll/pay-out payroll/pay-out/settings payroll/reports payroll/runs payroll/schedules payroll/settings payroll/year-end people people/new people/org people/E0005 people/E0005?tab=job people/E0005?tab=personal people/E0021 performance performance/calibration performance/cycles performance/feedback performance/goals performance/settings performance/skills performance/training reports reports/absence reports/comp-bands reports/cost reports/diversity reports/headcount reports/hiring reports/leave-liability reports/movement reports/span reports/tenure reports/training settings/company settings/entities settings/locations settings/org settings/calendars settings/schedules settings/approvals settings/members settings/roles settings/agent settings/data settings/audit settings/security settings/notifications time time/attendance time/clock time/requests time/schedule time/settings time/timesheets'.split(' ');
const ROUTES = process.argv.slice(2).length > 0 ? process.argv.slice(2) : STATIC;
const DIR = `${OUT}/phonehead`;
mkdirSync(DIR, { recursive: true });

const check = () => {
  const bad = [];
  const h = document.querySelector('#hr-main header');
  const h1 = h?.querySelector('h1');
  if (h === null || h === undefined) return ['no page header'];
  if (h1 === null || h1 === undefined || h1.getBoundingClientRect().width === 0) bad.push('no title');
  else {
    const text = (h1.textContent ?? '').trim();
    if (text === '') bad.push('empty title');
    const cs = getComputedStyle(h1);
    const lines = Math.round(h1.getBoundingClientRect().height / parseFloat(cs.lineHeight));
    if (h1.scrollWidth > h1.clientWidth + 1 || h1.scrollHeight > h1.clientHeight + 1) bad.push(`title cut "${text.slice(0, 30)}" (${lines} lines)`);
  }
  if (h.scrollWidth > h.clientWidth + 1) bad.push(`header scrolls sideways (${h.scrollWidth} in ${h.clientWidth})`);
  for (const el of h.querySelectorAll('button, a[href]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > innerWidth + 0.5 || r.left < -0.5) bad.push(`"${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20)}" off screen`);
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`page scrolls sideways (${document.documentElement.scrollWidth})`);
  // Panel headers: their buttons stay inside the header (they wrap under the label, never across the border).
  for (const ph of document.querySelectorAll('#hr-main section.hr-panel > header')) {
    const hr = ph.getBoundingClientRect();
    for (const el of ph.querySelectorAll('button, a[href]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.bottom > hr.bottom + 0.5 || r.top < hr.top - 0.5 || r.right > hr.right + 0.5) {
        bad.push(`panel "${(ph.textContent ?? '').trim().slice(0, 18)}": "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 16)}" crosses the header`);
        break;
      }
    }
  }
  return bad;
};

const browser = await chromium.launch({ headless: true });
let fails = 0;
let views = 0;
for (const width of [360, 390, 430]) {
  const { ctx, page, errors } = await open(browser, { width, height: 800, mobile: true });
  await signIn(page, 'owner@northwind.test', 'demo-pass-1');
  for (const r of ROUTES) {
    await page.evaluate((h) => (location.hash = h), '#/' + r);
    // The old page's header must not satisfy the wait: the route remounts first.
    await page.waitForTimeout(450);
    await page.waitForFunction(() => {
      const m = document.getElementById('hr-main');
      return m !== null && m.querySelector('header h1') !== null && (m.querySelector('header h1')?.textContent ?? '').trim() !== '';
    }, null, { timeout: 15000 }).catch(() => undefined);
    await page.waitForTimeout(350);
    const bad = await page.evaluate(check);
    views++;
    const head = page.locator('#hr-main header').first();
    if ((await head.count()) > 0) await head.screenshot({ path: `${DIR}/${r.replace(/[/?=]/g, '_')}_${width}.png` }).catch(() => undefined);
    if (bad.length > 0) {
      fails++;
      console.log(`${width} ${r}: ${bad.join('; ')}`);
    }
  }
  if (errors.length > 0) console.log(`${width} console: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}
await browser.close();
console.log(fails === 0 ? `ok: phone headers whole on ${ROUTES.length} routes x 3 widths (${views} views): full titles, tools on screen, no sideways scroll` : `${fails} of ${views} views fail`);
process.exit(fails === 0 ? 0 : 1);
