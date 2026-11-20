// Read batching (lib/api.ts) on a seeded merged app: every page shows the same thing with the batched build as
// with the unbatched one (each caller gets its own answer or error), reads issued together travel as app.batch
// requests of reads only (no duplicates, at most 12), a failing read in a batch fails alone, and a realtime change
// refreshes its views in one batch.
//   APP=<seeded scratch app with pb/pb_public_before and pb/pb_public_after> PORT=3183 node batch_check.mjs
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { APP, BASE, chromium, op } from './lib.mjs';

const EMAIL = process.env.EMAIL ?? 'owner@venture.test';
const PASSWORD = process.env.PASSWORD ?? 'demo-pass-1';
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) fails++;
};
const methods = Object.fromEntries(JSON.parse(readFileSync(APP + '/operations.json', 'utf8')).operations.map((o) => [o.name, o.executor.method]));
function use(variant) {
  rmSync(`${APP}/pb/pb_public`, { recursive: true, force: true });
  cpSync(`${APP}/pb/pb_public_${variant}`, `${APP}/pb/pb_public`, { recursive: true });
}

const token = (await op('auth.login', { email: EMAIL, password: PASSWORD })).token;
const deals = await op('deals.list', {}, { as: token }).catch(() => ({ deals: [] }));
const deal = (deals.deals ?? [])[0];
const PAGES = ['', 'focus', 'committee', 'network', 'funds', 'portfolio', 'settings/members', 'settings/data', ...(deal ? ['deals/' + deal.id] : []), 'deals/nope0000000000'];

const browser = await chromium.launch({ headless: true });
async function session() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, timezoneId: 'UTC' });
  await ctx.addInitScript((tok) => {
    try {
      localStorage.setItem('vo.session', tok);
    } catch {
      /* private */
    }
  }, token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const batches = [];
  const singles = [];
  page.on('requestfinished', async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/ops/')) return;
    if (u.pathname === '/api/ops/app/batch') {
      const calls = JSON.parse(u.searchParams.get('calls') ?? '[]');
      let results = [];
      try {
        results = (await (await r.response())?.json())?.results ?? [];
      } catch {
        /* gone */
      }
      batches.push({ at: Date.now(), calls, results });
    } else singles.push({ at: Date.now(), method: r.method(), path: u.pathname });
  });
  return { ctx, page, errors, batches, singles };
}
async function ready(page) {
  await page.waitForSelector('#vo-main', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.vo-skel').length === 0 && (document.querySelector('#vo-main')?.textContent ?? '').trim() !== '', null, { timeout: 30000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
const norm = (t) => t.replace(/\d+/g, '#').replace(/[ \t]+/g, ' ').trim();

// 1. The same screens, before and after.
const seen = {};
for (const v of ['before', 'after']) {
  use(v);
  const s = await session();
  seen[v] = {};
  for (const p of PAGES) {
    await s.page.goto(BASE + '#/' + p);
    await ready(s.page);
    seen[v][p] = norm(await s.page.evaluate(() => document.querySelector('#vo-main')?.innerText ?? ''));
  }
  if (v === 'before') check('the unbatched build sends no app.batch', s.batches.length === 0, `(${s.batches.length})`);
  else {
    const all = s.batches.flatMap((b) => b.calls);
    const sizes = s.batches.map((b) => b.calls.length);
    check('the batched build sends reads together', s.batches.length > 0 && Math.max(...sizes) >= 2, `(${s.batches.length} batches, sizes ${sizes.join(' ')}; ${s.singles.length} single requests)`);
    check('a batch holds only reads (GET ops)', all.every((c) => methods[c.op] === 'GET'), all.filter((c) => methods[c.op] !== 'GET').map((c) => c.op).join(', '));
    check('a batch holds at most 12 calls and no duplicates', s.batches.every((b) => b.calls.length <= 12 && new Set(b.calls.map((c) => c.op + JSON.stringify(c.params))).size === b.calls.length));
    check('params travel as strings, as in a query', all.every((c) => Object.values(c.params ?? {}).every((x) => typeof x === 'string')));
  }
  check(`${v}: no page errors`, s.errors.length === 0, s.errors.slice(0, 2).join(' | '));
  await s.ctx.close();
}
for (const p of PAGES) {
  const a = seen.before[p];
  const b = seen.after[p];
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  check(`/${p} shows the same with batching`, a === b && a.length > 0, a === b ? `(${a.length} chars)` : `differs at ${at}: before "${a.slice(Math.max(0, at - 30), at + 50)}" after "${b.slice(Math.max(0, at - 30), at + 50)}"`);
}

// 2. A failing read fails alone: a fresh load straight onto a missing deal sends deals.get in the first batch.
{
  const s = await session();
  await s.page.goto(BASE + '#/deals/nope0000000000');
  await ready(s.page);
  const mixed = s.batches.find((b) => b.results.some((r) => r.status === 404) && b.results.some((r) => r.status === 200));
  check('a failing read fails alone (404 beside 200s in one batch)', mixed !== undefined, mixed ? mixed.results.map((r) => r.op + ' ' + r.status).join(', ') : JSON.stringify(s.batches.map((b) => b.calls.map((c) => c.op))));
  const text = norm(await s.page.evaluate(() => document.querySelector('#vo-main')?.innerText ?? ''));
  check('the missing deal page reads as without batching', text === seen.before['deals/nope0000000000'], `"${text.slice(0, 60)}"`);
  const nav = await s.page.evaluate(() => document.querySelectorAll('nav a').length);
  check('the rest of the screen loaded (sidebar places)', nav > 3, `(${nav} links)`);
  await s.ctx.close();
}

// 3. A realtime change refreshes its views in one batch.
{
  const s = await session();
  await s.page.goto(BASE + '#/focus');
  await ready(s.page);
  const n0 = s.batches.length;
  const m0 = s.singles.length;
  const today = (await op('app.today', {}, { as: token })).today;
  await op('tasks.save', { title: 'Batch check ' + Date.now(), due_day: today }, { as: token });
  await s.page.waitForTimeout(2500);
  const after = s.batches.slice(n0);
  const reads = after.reduce((n, b) => n + b.calls.length, 0) + s.singles.slice(m0).filter((x) => x.method === 'GET').length;
  const reqs = after.length + s.singles.slice(m0).filter((x) => x.method === 'GET').length;
  check('a realtime change refreshes its views batched', reads >= 2 && reqs < reads, `(${reads} reads in ${reqs} requests: ${after.map((b) => b.calls.map((c) => c.op).join('+')).join(' | ')})`);
  await s.ctx.close();
}
use('after');
await browser.close();
console.log(fails === 0 ? 'batch check: all passed' : `batch check: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
