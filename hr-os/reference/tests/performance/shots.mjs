// Screenshot pass of every performance page for one person: light and dark, 1440 and 390 wide.
//   node shots.mjs <label> <email> [ids.json]      (PORT, OUT, WIDTHS, SCHEMES env)
// ids.json is the last line printed by seed_perf.mjs (cycle, goal, session, reviews); without it the
// pass covers the pages without ids (an empty database). Prints console errors and 5xx answers per page.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');

const PORT = Number(process.env.PORT ?? 3189);
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.OUT ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/performance/shots';
mkdirSync(OUT, { recursive: true });
const [label = 'owner', email = 'owner@northwind.test', idsFile = ''] = process.argv.slice(2);
const ids = idsFile !== '' ? JSON.parse(readFileSync(idsFile, 'utf8').trim().split('\n').pop()) : null;

const common = ['performance', 'performance/goals', 'performance/goals?mode=tree', 'performance/cycles', 'performance/feedback', 'performance/feedback?view=requests', 'performance/skills', 'performance/skills?tab=library', 'performance/training', 'performance/training?tab=required'];
const byRole = {
  owner: ['performance/cycles/new', 'performance/settings', 'performance/settings?tab=values', 'performance/settings?tab=rules', 'performance/training?tab=programs', 'performance/calibration'],
  manager: ['performance/calibration', 'performance/goals?view=team'],
  employee: ['performance/training?tab=mine', 'performance/feedback?view=received'],
};
const withIds = ids === null ? [] : [`performance/goals/${ids.goal}`, `performance/cycles/${ids.cycle}`, `performance/training/${ids.session}`];
const reviewPages = ids === null ? [] : label === 'owner' ? [`performance/reviews/${ids.sam_self}`, `performance/calibration?cycle=${ids.cycle}`] : label === 'manager' ? [`performance/reviews/${ids.sam_manager}`, `performance/reviews/${ids.sam_self}`] : [`performance/reviews/${ids.sam_self}`];
const profile = label === 'employee' ? ['people/E0005?tab=m.performance'] : ['people/E0005?tab=m.performance'];
const pages = (process.env.PAGES ?? '').split(',').filter((x) => x !== '');
const list = pages.length > 0 ? pages : [...common, ...(byRole[label] ?? []), ...withIds, ...reviewPages, ...(ids !== null ? profile : [])];
const widths = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');

const browser = await chromium.launch({ headless: true });
let bad = 0;
let shots = 0;
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
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', 'demo-pass-1');
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await page.waitForSelector('#hr-main', { timeout: 20000 });
    for (const p of list) {
      errors.length = 0;
      await page.goto(BASE + '#/' + p);
      await page.waitForTimeout(400);
      await page.waitForFunction(() => document.querySelector('#hr-main [role=status]') === null, null, { timeout: 45000 }).catch(() => errors.push('still loading after 45 s'));
      await page.waitForTimeout(500);
      const missing = await page.evaluate(() => (document.body.innerText.match(/\bperf\.[a-z0-9_.]+/g) || []).slice(0, 5));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      const name = `${label}_${p.replace(/[/?=&.]/g, '_')}_${scheme}_${w}.png`;
      await page.screenshot({ path: `${OUT}/${name}`, fullPage: process.env.FULL === '1' });
      shots++;
      const own = errors.filter((e) => !/favicon/.test(e));
      if (missing.length > 0) own.push('missing copy keys: ' + missing.join(', '));
      if (overflow) own.push('page scrolls sideways');
      if (process.env.TAPS === '1' && w < 500) {
        // The QA sweep's rule: a control under 40 px tall (or 32 wide) counts unless it carries .hit (16 px more).
        const small = await page.evaluate(() => {
          const out = [];
          const sel = 'button:not(:disabled), a[href], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=option], input:not([type=hidden]), select, textarea';
          for (const el of document.querySelectorAll(`#hr-main ${sel.split(', ').join(', #hr-main ')}`)) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const st = getComputedStyle(el);
            const extra = el.classList.contains('hit') || el.classList.contains('hit-y') ? 16 : 0;
            const inline = el.tagName === 'A' && st.display === 'inline';
            if (!inline && el.type !== 'checkbox' && el.type !== 'radio' && (r.height + extra < 40 || r.width + extra < 32)) out.push(`${Math.round(r.width)}x${Math.round(r.height)} ${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 28)}"`);
          }
          return out;
        });
        if (small.length > 0) console.log(`TAPS ${name}: ${small.length}\n  ${[...new Set(small)].slice(0, 40).join('\n  ')}`);
      }
      if (own.length > 0) {
        bad += own.length;
        console.log(`${name}: ${own.join(' | ')}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(bad === 0 ? `ok: ${label} ${list.length} pages, ${shots} screenshots, no console errors` : `${bad} problems in ${shots} screenshots`);
process.exit(bad === 0 ? 0 : 1);
