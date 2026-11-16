// Lazy pages (SPEC U13) on a built app: the kernel's lazy chunks load on demand and are all prefetched after
// the first paint, a move to a lazy page keeps the old page on screen (no blank frame), returning is instant
// (remembered views), and no page logs a console error. EMAIL / PASSWORD sign in (default the modules' demo owner).
import { BASE, chromium, open, settle, signIn } from './lib.mjs';

const EMAIL = process.env.EMAIL ?? 'owner@venture.test';
const PASSWORD = process.env.PASSWORD ?? 'demo-pass-1';
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) fails++;
};

const browser = await chromium.launch({ headless: true });
const { page, ctx, errors } = await open(browser, { width: 1440, height: 900 });
const chunks = new Set();
page.on('response', (r) => {
  const u = new URL(r.url());
  if (/\/assets\/.+\.js$/.test(u.pathname)) chunks.add(u.pathname.split('/').pop());
});
await signIn(page, EMAIL, PASSWORD);
await settle(page, 600);
const first = chunks.size;
// Prefetch: the idle callback fetches every registered chunk shortly after the first paint.
await page.waitForTimeout(4500);
const names = [...chunks];
const has = (re) => names.some((n) => re.test(n));
check('prefetch fetched the kernel page chunks', has(/^AgentPage-/) && has(/^KernelPages-/) && has(/^Firm-/) && has(/^Security-/), `(${first} at first paint, ${chunks.size} after idle)`);

// A fresh tab straight onto a lazy route renders it (Suspense resolves, no blank page).
{
  const { page: p2, ctx: c2, errors: e2 } = await open(browser, { width: 1440, height: 900 });
  await signIn(p2, EMAIL, PASSWORD);
  await p2.goto(BASE + '#/settings/security');
  await settle(p2, 900);
  const h = await p2.evaluate(() => document.querySelector('#vo-main h1, #vo-main h2')?.textContent ?? '');
  check('deep link to a lazy settings section renders', h.length > 0, `"${h}"`);
  await p2.goto(BASE + '#/agent');
  await settle(p2, 900);
  const a = await p2.evaluate(() => (document.querySelector('#vo-main')?.textContent ?? '').length);
  check('deep link to the agent page renders', a > 40, `(${a} chars)`);
  check('no console errors on deep links', e2.length === 0, e2.slice(0, 3).join(' | '));
  await c2.close();
}

// A move never shows an empty main: sample #vo-main's text every frame while moving to a lazy page.
for (const to of ['settings/members', 'agent', 'settings/data', '']) {
  await page.evaluate(() => {
    window.__blank = 0;
    window.__frames = 0;
    const tick = () => {
      window.__frames++;
      const m = document.querySelector('#vo-main');
      if (m === null || (m.textContent ?? '').trim() === '') window.__blank++;
      if (window.__frames < 40) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.evaluate((h) => {
    location.hash = '#/' + h;
  }, to);
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({ blank: window.__blank, frames: window.__frames }));
  check(`move to /${to} never blanks the page`, r.blank === 0, `(${r.blank}/${r.frames} blank frames)`);
}

// A move to a page whose chunk is still on the wire keeps the old page on screen until it arrives.
{
  const { page: p3, ctx: c3 } = await open(browser, { width: 1440, height: 900 });
  await p3.route(/\/assets\/AgentPage-[^/]+\.js$/, async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.continue();
  });
  await signIn(p3, EMAIL, PASSWORD);
  await p3.waitForSelector('#vo-main h1', { timeout: 20000 });
  const r = await p3.evaluate(
    () =>
      new Promise((res) => {
        const was = document.querySelector('#vo-main h1')?.textContent ?? '';
        let blank = 0;
        let kept = 0;
        const t0 = performance.now();
        location.hash = '#/agent';
        const tick = () => {
          const h = document.querySelector('#vo-main h1')?.textContent ?? '';
          if (h === '') blank++;
          else if (h === was) kept++;
          if (h !== '' && h !== was) res({ was, now: h, blank, kept, ms: Math.round(performance.now() - t0) });
          else if (performance.now() - t0 > 15000) res({ was, now: h, blank, kept, ms: -1 });
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  check('a move waiting on a chunk keeps the old page, then shows the new one', r.blank === 0 && r.kept > 0 && r.ms > 0, JSON.stringify(r));
  await c3.close();
}

// Returning is instant: the remembered view paints on the first frame back.
await page.evaluate(() => {
  location.hash = '#/settings/members';
});
await page.waitForSelector('#vo-main [role="row"]', { timeout: 20000 });
await page.evaluate(() => {
  location.hash = '#/settings/firm';
});
await page.waitForFunction(() => (document.querySelector('#vo-main h2')?.textContent ?? '') === 'Firm', null, { timeout: 20000 });
const t = await page.evaluate(
  () =>
    new Promise((res) => {
      const t0 = performance.now();
      location.hash = '#/settings/members';
      const look = () => {
        const rows = document.querySelectorAll('#vo-main [role="row"], #vo-main tr, #vo-main li').length;
        if (rows > 0) res(Math.round(performance.now() - t0));
        else if (performance.now() - t0 > 3000) res(-1);
        else requestAnimationFrame(look);
      };
      look();
    }),
);
check('returning to a page shows its rows within 120 ms', t >= 0 && t <= 120, `(${t} ms)`);

// Every page (kernel and module) loads without a console error.
for (const p of ['', 'focus', 'agent', 'committee', 'network', 'funds', 'portfolio', 'settings/firm', 'settings/funds', 'settings/members', 'settings/agent', 'settings/data', 'settings/security', 'settings/committee', 'source?file=nope']) {
  const before = errors.length;
  await page.goto(BASE + '#/' + p);
  await settle(page, 700);
  const mine = errors.slice(before).filter((e) => !/status of 404/.test(e) || p.startsWith('source') === false);
  check(`/${p} no console errors`, mine.length === 0, mine.slice(0, 2).join(' | '));
}
await ctx.close();
await browser.close();
console.log(fails === 0 ? 'lazy check: all passed' : `lazy check: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
