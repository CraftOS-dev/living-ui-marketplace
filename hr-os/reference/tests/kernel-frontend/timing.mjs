// Page-ready time on the demo seed: from navigation until the page shows its data
// (no operation request in flight for 400 ms and no skeleton on screen), plus how
// many times each operation was called while the page got ready.
// Usage: node timing.mjs [email] [password] [pages...]
import { BASE, chromium, open, signIn } from './lib.mjs';

const args = process.argv.slice(2);
const email = args[0] ?? 'owner@northwind.test';
const password = args[1] ?? 'demo-pass-1';
const PAGES = args.length > 2 ? args.slice(2) : ['home', 'inbox', 'people', 'people/E0021', 'time', 'leave', 'expenses', 'payroll', 'performance', 'hiring', 'settings/company'];
const QUIET = 400;

const browser = await chromium.launch({ headless: true });
const { ctx, page, errors } = await open(browser, { width: 1440, height: 900 });
await signIn(page, email, password);

const pending = new Set();
let peak = 0;
let lastEnd = 0;
let calls = new Map();
page.on('request', (r) => {
  const m = /\/api\/ops\/([^?]+)/.exec(r.url());
  if (m === null) return;
  pending.add(r);
  peak = Math.max(peak, pending.size);
  const name = m[1].replace('/', '.');
  calls.set(name, (calls.get(name) ?? 0) + 1);
});
const done = (r) => {
  if (pending.delete(r)) lastEnd = Date.now();
};
page.on('requestfinished', done);
page.on('requestfailed', done);
const names = () => [...pending].map((r) => /\/api\/ops\/([^?]+)/.exec(r.url())?.[1]).join(' ');

async function ready(t0) {
  for (;;) {
    await page.waitForTimeout(50);
    const now = Date.now();
    if (now - t0 > 15000) return { ms: now - t0, timeout: true, inflight: names(), busy: await page.evaluate(() => document.querySelector('#hr-main .hr-skel, #hr-main [aria-busy="true"]')?.outerHTML.slice(0, 160) ?? '') };
    if (pending.size > 0 || now - Math.max(lastEnd, t0) < QUIET) continue;
    const busy = await page.evaluate(() => document.getElementById('hr-main') === null || document.querySelector('#hr-main .hr-skel, #hr-main [aria-busy="true"]') !== null);
    if (busy) continue;
    return { ms: Math.max(lastEnd, t0) - t0, timeout: false };
  }
}

const rows = [];
for (const p of PAGES) {
  // Full load (boot, shell and page), then an in-app move to the page from People.
  await page.goto(BASE + '#/' + p);
  // Let the old document's calls finish (queued calls start late), then measure a fresh load.
  await ready(Date.now());
  calls = new Map();
  pending.clear();
  let t0 = Date.now();
  lastEnd = t0;
  peak = 0;
  await page.reload({ waitUntil: 'commit' });
  const full = await ready(t0);
  const fullPeak = peak;
  const fullCalls = calls;
  await page.evaluate(() => (location.hash = '#/settings/security'));
  await ready(Date.now());
  calls = new Map();
  pending.clear();
  t0 = Date.now();
  lastEnd = t0;
  await page.evaluate((h) => (location.hash = h), '#/' + p);
  const nav = await ready(t0);
  if (full.timeout || nav.timeout) console.log('  stuck', p, JSON.stringify({ full: [full.inflight, full.busy], nav: [nav.inflight, nav.busy] }));
  const top = [...fullCalls.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`).join(', ');
  const row = { page: p, full: full.ms + (full.timeout ? ' (timeout)' : ''), nav: nav.ms + (nav.timeout ? ' (timeout)' : ''), ops: [...fullCalls.values()].reduce((a, b) => a + b, 0), peak: fullPeak, home: fullCalls.get('app.home') ?? 0, repeats: top };
  rows.push(row);
  line(row);
}
function line(r) {
  console.log(`${r.page.padEnd(18)} full ${String(r.full).padStart(6)} ms  move ${String(r.nav).padStart(6)} ms  ops ${String(r.ops).padStart(3)}  peak ${String(r.peak).padStart(2)} in flight  app.home x${r.home}  ${r.repeats}`);
}
const avg = (k) => Math.round(rows.reduce((a, r) => a + Number(String(r[k]).split(' ')[0]), 0) / rows.length);
console.log(`average: full ${avg('full')} ms, move ${avg('nav')} ms`);
console.log(errors.length === 0 ? 'console errors: none' : 'console errors:\n' + errors.join('\n'));
await ctx.close();
await browser.close();
