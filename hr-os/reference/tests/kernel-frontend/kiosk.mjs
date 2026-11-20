// Module publicRoutes open before sign-in: the time kiosk (#/time/kiosk/<code>) renders
// alone (no shell, no sign-in form) for a signed-out tablet, before HR starts it and
// after (the tablet token in its storage), light and dark, 1440 and 390, no console errors.
// Needs the demo seed on the scratch server (port 3182).
import { pathToFileURL } from 'node:url';
import { BASE, OUT, PORT, chromium, open } from './lib.mjs';

const APP = process.env.HR_APP ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/kernel-frontend/app';
const { client } = await import(pathToFileURL(APP + '/tools/dev/api.mjs').href);
const api = client({ port: PORT, app: APP });

const locs = await api.op('locations.list', {}, { as: 'owner' });
const loc = (locs.locations ?? [])[0];
if (loc === undefined) throw new Error('no location in the seed');
// HR starts a tablet for the location (a kiosk code is made when it has none).
const started = await api.op('kiosk.start', { location: loc.kiosk_code !== '' ? loc.kiosk_code : loc.id, name: 'Front desk' }, { as: 'owner' });
const code = String(started.code).toUpperCase();

const browser = await chromium.launch({ headless: true });
const fails = [];
for (const state of ['new', 'started']) {
  for (const scheme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      const { ctx, page, errors } = await open(browser, { width, height: width === 390 ? 844 : 900, scheme, mobile: width === 390 });
      if (state === 'started') await ctx.addInitScript(([k, v]) => window.localStorage.setItem(k, v), ['hr.kiosk.' + code, started.token]);
      await page.goto(BASE + '#/time/kiosk/' + code);
      await page.waitForSelector('#hr-main', { timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => undefined);
      await page.waitForTimeout(900);
      const seen = await page.evaluate(() => ({
        shell: document.querySelector('nav[aria-label="Main"]') !== null || document.querySelector('[data-hr-shell-chrome]') !== null,
        signIn: document.querySelector('input[type=password]') !== null,
        text: (document.getElementById('hr-main')?.innerText ?? '').trim().slice(0, 80).replace(/\s+/g, ' '),
        title: document.title,
        wide: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      const name = `kiosk_${state}_${scheme}_${width}`;
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
      const bad = [];
      if (seen.shell) bad.push('the shell is drawn');
      if (seen.signIn) bad.push('the sign-in form is drawn');
      if (seen.text === '') bad.push('empty page');
      if (seen.wide) bad.push('sideways scroll');
      if (errors.length > 0) bad.push('console: ' + errors.join(' | '));
      console.log(`${bad.length === 0 ? 'ok  ' : 'FAIL'} ${name}: "${seen.text}" (${seen.title})${bad.length > 0 ? ' ' + bad.join('; ') : ''}`);
      if (bad.length > 0) fails.push(name);
      await ctx.close();
    }
  }
}
await browser.close();
console.log(fails.length === 0 ? 'ok: the kiosk opens signed out, before and after HR starts it, 2 schemes x 2 widths, no console errors' : `${fails.length} failures`);
process.exit(fails.length === 0 ? 0 : 1);
