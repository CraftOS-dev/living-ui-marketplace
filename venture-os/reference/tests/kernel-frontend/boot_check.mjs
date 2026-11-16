// Boot paths (lib/auth.ts boot): with a token, auth.refresh goes first and alone, and a live session opens the frame
// as soon as it answers (setup.status is not asked: a session means a set-up firm); no session shows sign in; a dead
// session is cleared quietly and setup.status decides; a firm not set up shows setup; an unreachable app shows Try again.
// EMAIL / PASSWORD sign in (default the stand-in owner).
import { BASE, OWNER, chromium, op } from './lib.mjs';

const EMAIL = process.env.EMAIL ?? OWNER.email;
const PASSWORD = process.env.PASSWORD ?? OWNER.password;
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) fails++;
};
const token = (await op('auth.login', { email: EMAIL, password: PASSWORD })).token;
const browser = await chromium.launch({ headless: true });

async function start(tok, routes = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (tok !== null)
    await ctx.addInitScript((t) => {
      if (sessionStorage.getItem('vo.boot.seeded') === null) {
        localStorage.setItem('vo.session', t);
        sessionStorage.setItem('vo.boot.seeded', '1');
      }
    }, tok);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/ops/')) sent.push({ at: Date.now(), path: u.pathname.replace('/api/ops/', '') });
  });
  for (const [pattern, fn] of Object.entries(routes)) await page.route(pattern, fn);
  const t0 = Date.now();
  await page.goto(BASE + '#/');
  return { ctx, page, errors, sent, t0 };
}
const shows = (page, sel, ms = 20000) => page.waitForSelector(sel, { timeout: ms }).then(() => true, () => false);

// 1. A live session: the frame never waits for setup.status (a slow one is not even asked).
{
  let statusDone = 0;
  const s = await start(token, {
    '**/api/ops/setup/status*': async (r) => {
      await new Promise((res) => setTimeout(res, 2500));
      statusDone = Date.now();
      await r.continue();
    },
  });
  const ok = await shows(s.page, '#vo-main');
  const frameAt = Date.now();
  check('a live session opens the frame', ok);
  check('the frame opens without waiting for setup.status', ok && (statusDone === 0 || frameAt < statusDone), `(frame ${frameAt - s.t0} ms${statusDone ? ', status ' + (statusDone - s.t0) + ' ms' : ', status not asked'})`);
  const first = s.sent[0]?.path ?? '';
  check('auth.refresh is the first call; setup.status is not asked', first === 'auth/refresh' && !s.sent.some((x) => x.path === 'setup/status'), s.sent.slice(0, 4).map((x) => x.path).join(' '));
  await s.page.waitForTimeout(3000);
  check('the frame stays', (await s.page.locator('#vo-main').count()) === 1);
  const stored = await s.page.evaluate(() => localStorage.getItem('vo.session'));
  check('the renewed token is kept', typeof stored === 'string' && stored.length > 10);
  check('no page errors (live session)', s.errors.length === 0, s.errors.slice(0, 2).join(' | '));
  await s.ctx.close();
}

// 2. No session: sign in, no refresh sent.
{
  const s = await start(null);
  check('no session shows sign in', await shows(s.page, 'input[type=email]'));
  check('no auth.refresh without a token; setup.status asked', !s.sent.some((x) => x.path === 'auth/refresh') && s.sent.some((x) => x.path === 'setup/status'));
  await s.ctx.close();
}

// 3. A dead session: sign in without a notice, the token cleared.
{
  const s = await start('not-a-real-token');
  check('a dead session shows sign in', await shows(s.page, 'input[type=email]'));
  const stored = await s.page.evaluate(() => localStorage.getItem('vo.session'));
  check('the dead token is cleared', stored === null, String(stored));
  const notice = await s.page.locator('text=Your session ended').count();
  check('no "session ended" notice on a cold start', notice === 0);
  check('no page errors (dead session)', s.errors.length === 0, s.errors.slice(0, 2).join(' | '));
  await s.ctx.close();
}

// 4. A firm not set up (setup.status says so, the session is refused): setup, the token cleared.
{
  const s = await start('stale-token', {
    '**/api/ops/setup/status*': (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ setup_done: false, firm_name: '' }) }),
  });
  const ok = await s.page.waitForFunction(() => /set up|Firm/i.test(document.body.innerText) && document.querySelector('#vo-main') === null && document.querySelector('input[type=password]') === null, null, { timeout: 20000 }).then(
    () => true,
    () => false,
  );
  check('a firm not set up shows setup', ok, (await s.page.evaluate(() => document.body.innerText.slice(0, 80))).replace(/\s+/g, ' '));
  check('the token is cleared for setup', (await s.page.evaluate(() => localStorage.getItem('vo.session'))) === null);
  await s.ctx.close();
}

// 5. The app unreachable: Try again.
{
  const s = await start(token, {
    '**/api/ops/setup/status*': (r) => r.abort('connectionrefused'),
    '**/api/ops/auth/refresh*': (r) => r.abort('connectionrefused'),
  });
  check('an unreachable app shows Try again', await shows(s.page, 'text=Cannot reach the app'));
  await s.ctx.close();
}

await browser.close();
console.log(fails === 0 ? 'boot check: all passed' : `boot check: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
