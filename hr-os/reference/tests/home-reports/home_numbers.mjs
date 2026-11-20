// Home panel numbers for one person: no number while the page loads, and once it has settled the numbers
// are 01..N with no gap, in visual reading order (rows top to bottom, left to right), at 360, 390 and 1440.
//   node home_numbers.mjs <email> [<email> ...]      (password demo-pass-1, HR_PORT 3190)
// Exits 1 on any problem.
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.HR_PORT ?? 3190);
const BASE = `http://127.0.0.1:${PORT}/`;
const emails = process.argv.slice(2);
const widths = (process.env.WIDTHS ?? '360,390,1440').split(',').map(Number);
let problems = 0;

/** The panel numbers on the page: their text and the box of the panel they label. */
const READ = () => {
  const out = [];
  for (const el of document.querySelectorAll('#hr-main [data-home-grid] .hr-label, #hr-main [data-home-grid] .hr-label > span')) {
    const txt = (el.textContent ?? '').trim();
    // A panel's "07", or the first tile of a numbered strip ("04.1" stands for its strip, 04).
    const m = el.classList.contains('hr-label') ? /^(\d\d)$/.exec(txt) : /^(\d\d)\.1$/.exec(txt);
    if (m === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const box = (el.closest('section, .hr-panel') ?? el).getBoundingClientRect();
    out.push({ n: Number(m[1]), top: Math.round(box.top + window.scrollY), left: Math.round(box.left) });
  }
  return out;
};

const browser = await chromium.launch({ headless: true });
for (const email of emails) {
  // Sign in once per person (sign-ins are rate limited); each width reuses the session.
  const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p0 = await first.newPage();
  await p0.goto(BASE + '#/home');
  await p0.waitForSelector('input[type=email]', { timeout: 30000 });
  await p0.fill('input[type=email]', email);
  await p0.fill('input[type=password]', 'demo-pass-1');
  await p0.getByRole('button', { name: 'Sign in' }).last().click();
  await p0.waitForSelector('#hr-main', { timeout: 30000 });
  const state = await first.storageState();
  await first.close();
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 800 : 900 }, isMobile: w < 500, hasTouch: w < 500, storageState: state });
    const page = await ctx.newPage();
    await page.goto(BASE + '#/me');
    await page.waitForSelector('#hr-main', { timeout: 30000 });
    // Home from another page (no remembered Home in this tab): watch the numbers while it loads.
    await page.goto(BASE + '#/home');
    const early = [];
    for (let i = 0; i < 40; i++) {
      const st = await page.evaluate((src) => {
        const settled = document.querySelector('#hr-main [data-settled]') !== null;
        // eslint-disable-next-line no-new-func
        const nums = new Function('return (' + src + ')()')();
        return { settled, nums: nums.map((x) => x.n) };
      }, READ.toString());
      if (st.settled) break;
      if (st.nums.length > 0) early.push(st.nums.join(' '));
      await page.waitForTimeout(100);
    }
    await page.waitForSelector('#hr-main [data-settled]', { timeout: 30000 }).catch(() => undefined);
    // Bring every lower panel into view, then read the settled numbers.
    await page.evaluate(() => document.getElementById('hr-main')?.scrollTo(0, 1e6));
    await page.waitForTimeout(800);
    await page.evaluate(() => document.getElementById('hr-main')?.scrollTo(0, 0));
    await page.waitForSelector('#hr-main [data-settled]', { timeout: 30000 }).catch(() => undefined);
    const got = await page.evaluate((src) => new Function('return (' + src + ')()')(), READ.toString());
    const visual = [...got].sort((a, b) => (Math.abs(a.top - b.top) > 8 ? a.top - b.top : a.left - b.left)).map((x) => x.n);
    const want = visual.map((_, i) => i + 1);
    const ok = early.length === 0 && visual.length > 0 && visual.join(' ') === want.join(' ');
    if (!ok) problems++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${email} ${w}: ${visual.map((n) => String(n).padStart(2, '0')).join(' ')}${early.length > 0 ? '  numbers while loading: ' + early.slice(0, 3).join(' | ') : ''}`);
    await ctx.close();
  }
}
await browser.close();
process.exit(problems > 0 ? 1 : 0);
