// Cold page loads, before and after a frontend change: for every run, variant and page the server is restarted,
// then a fresh browser opens straight onto the page with a saved session, and the time is taken until the page
// shows its content (no skeleton left, no API call open, steady for 250 ms), counting API requests and the reads
// inside them (an app.batch request carries several).
//   APP=<seeded scratch app> PORT=3183 BRIDGE=3283 VARIANTS=before,after RUNS=3 node cold_load.mjs
// A variant is a built frontend kept aside in pb/pb_public_<variant>; it is copied into pb/pb_public first.
// ROUTES (comma list, '' = Home) default: Home, Focus, the first deal's page, Portfolio.
// WARM=1: per run and variant, one cold load of the first route, then moves inside the app to each other route
// (a server that has been up, chunks prefetched; first visits, so no remembered view helps).
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { APP, BASE, PORT, chromium, op } from './lib.mjs';

const EMAIL = process.env.EMAIL ?? 'owner@venture.test';
const PASSWORD = process.env.PASSWORD ?? 'demo-pass-1';
const BRIDGE = process.env.BRIDGE ?? '3283';
const RUNS = Number(process.env.RUNS ?? 3);
const VARIANTS = (process.env.VARIANTS ?? 'before,after').split(',');
if (Number(BRIDGE) >= 3100 && Number(BRIDGE) <= 3179) throw new Error('refusing a live port');

const sh = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
function restart() {
  sh(`bash "${APP}/tools/dev/stop.sh" ${PORT}`);
  sh(`bash "${APP}/tools/dev/serve.sh" "${APP}" ${PORT} ${BRIDGE}`);
}
function use(variant) {
  const from = `${APP}/pb/pb_public_${variant}`;
  if (!existsSync(from)) throw new Error('no build kept at ' + from);
  rmSync(`${APP}/pb/pb_public`, { recursive: true, force: true });
  cpSync(from, `${APP}/pb/pb_public`, { recursive: true });
}

const token = (await op('auth.login', { email: EMAIL, password: PASSWORD })).token;
let routes = process.env.ROUTES !== undefined ? process.env.ROUTES.split(',') : null;
if (routes === null) {
  const deals = await op('deals.list', {}, { as: token }).catch(() => ({ deals: [] }));
  const first = (deals.deals ?? deals.items ?? [])[0];
  routes = ['', 'focus', ...(first !== undefined ? ['deals/' + first.id] : []), 'portfolio'];
}
console.log('routes:', routes.map((r) => '/' + r).join(' '), '| variants:', VARIANTS.join(' '), '| runs:', RUNS);

const browser = await chromium.launch({ headless: true });
async function measure(route, moves = []) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((tok) => {
    try {
      localStorage.setItem('vo.session', tok);
    } catch {
      /* private */
    }
    const vo = { pending: 0, reqs: 0, slowest: 0, ready: 0, since: 0, t0: 0 };
    window.__vo = vo;
    const f = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const api = url.includes('/api/ops/');
      const t = performance.now();
      if (api) {
        vo.pending++;
        vo.reqs++;
      }
      try {
        const r = await f(input, init);
        if (api) await r.clone().arrayBuffer().catch(() => undefined);
        return r;
      } finally {
        if (api) {
          vo.pending--;
          vo.slowest = Math.max(vo.slowest, performance.now() - t);
        }
      }
    };
    const tick = () => {
      const main = document.querySelector('#vo-main');
      const calm = main !== null && (main.textContent ?? '').trim() !== '' && document.querySelectorAll('.vo-skel').length === 0 && vo.pending === 0 && vo.reqs > 0;
      if (!calm) vo.since = 0;
      else if (vo.since === 0) vo.since = performance.now();
      if (vo.since > 0 && performance.now() - vo.since >= 250) {
        vo.ready = vo.since - vo.t0;
        return;
      }
      requestAnimationFrame(tick);
    };
    vo.watch = () => {
      Object.assign(vo, { reqs: 0, slowest: 0, ready: 0, since: 0, t0: performance.now() });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, token);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  let reads = 0;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/ops/')) return;
    if (u.pathname === '/api/ops/app/batch') reads += JSON.parse(u.searchParams.get('calls') ?? '[]').length;
    else reads++;
  });
  const fall = [];
  page.on('requestfinished', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/') && !u.pathname.endsWith('.js')) return;
    const t = r.timing();
    const what = u.pathname === '/api/ops/app/batch' ? 'batch[' + JSON.parse(u.searchParams.get('calls') ?? '[]').map((c) => c.op).join(' ') + ']' : u.pathname.replace('/api/ops/', '').replace(/^\/assets\//, '');
    fall.push({ start: Math.round(t.startTime - t0), wait: Math.round(t.responseEnd), what });
  });
  const t0 = Date.now();
  await page.goto(BASE + '#/' + route);
  const ok = await page.waitForFunction(() => window.__vo.ready > 0, null, { timeout: 90000, polling: 100 }).then(
    () => true,
    () => false,
  );
  const vo = await page.evaluate(() => window.__vo);
  if (process.env.WATERFALL === '1') for (const f of fall.sort((a, b) => a.start - b.start)) console.log(`    ${String(f.start).padStart(6)} +${String(f.wait).padStart(5)}  ${f.what}`);
  const sorted = fall.sort((a, b) => a.start - b.start);
  const main = sorted.find((f) => /^index-.*\.js$/.test(f.what));
  const firstRead = sorted.find((f) => !/\.js$/.test(f.what) && !['setup/status', 'auth/refresh', '/api/realtime'].includes(f.what));
  const boot = main !== undefined && firstRead !== undefined ? firstRead.start - (main.start + main.wait) : -1;
  const out = { ready: ok ? Math.round(vo.ready) : -1, boot, reqs: vo.reqs, reads, slowest: Math.round(vo.slowest), errors: errors.length, warm: [] };
  if (moves.length > 0) await page.waitForTimeout(4000);
  for (const to of moves) {
    reads = 0;
    await page.evaluate((h) => {
      window.__vo.watch();
      location.hash = '#/' + h;
    }, to);
    const done = await page.waitForFunction(() => window.__vo.ready > 0, null, { timeout: 60000, polling: 100 }).then(
      () => true,
      () => false,
    );
    const w = await page.evaluate(() => window.__vo);
    out.warm.push({ route: to, ready: done ? Math.round(w.ready) : -1, reqs: w.reqs, reads });
    await page.waitForTimeout(1500);
  }
  await ctx.close();
  return out;
}

const rows = [];
if (process.env.WARM === '1') {
  for (let run = 1; run <= RUNS; run++) {
    for (const v of VARIANTS) {
      use(v);
      restart();
      const m = await measure(routes[0], routes.slice(1));
      console.log(`run ${run} ${v.padEnd(6)} cold /${routes[0]} ${m.ready} ms`);
      for (const w of m.warm) {
        rows.push({ run, v, ...w });
        console.log(`run ${run} ${v.padEnd(6)} move to /${w.route.padEnd(24)} content ${String(w.ready).padStart(6)} ms  requests ${String(w.reqs).padStart(3)}  reads ${String(w.reads).padStart(3)}`);
      }
    }
  }
  routes = routes.slice(1);
} else for (let run = 1; run <= RUNS; run++) {
  for (const v of VARIANTS) {
    use(v);
    for (const route of routes) {
      restart();
      const m = await measure(route);
      rows.push({ run, v, route, ...m });
      console.log(`run ${run} ${v.padEnd(6)} /${route.padEnd(28)} content ${String(m.ready).padStart(6)} ms  boot ${String(m.boot).padStart(5)} ms  requests ${String(m.reqs).padStart(3)}  reads ${String(m.reads).padStart(3)}  slowest ${String(m.slowest).padStart(6)} ms${m.errors ? '  console errors ' + m.errors : ''}`);
    }
  }
}
await browser.close();

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? -1 : s[Math.floor((s.length - 1) / 2)];
};
console.log('\nmedians (content ms, requests, reads):');
for (const route of routes) {
  const line = VARIANTS.map((v) => {
    const r = rows.filter((x) => x.v === v && x.route === route && x.ready >= 0);
    return `${v} ${median(r.map((x) => x.ready))} ms (boot ${median(r.map((x) => x.boot ?? -1))}), ${median(r.map((x) => x.reqs))} req, ${median(r.map((x) => x.reads))} reads`;
  });
  console.log(`  /${route.padEnd(28)} ${line.join('  |  ')}`);
}
process.exit(rows.some((r) => r.ready < 0) ? 1 : 0);
