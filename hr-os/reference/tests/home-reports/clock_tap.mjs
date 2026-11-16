// The Home clock card answers a tap at once: time from the tap until the card shows the new state, that
// the server's answer keeps it, and that Undo in the toast puts it back.
//   node clock_tap.mjs [email] [width]      (password demo-pass-1, HR_PORT 3190). Exits 1 on a problem.
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${Number(process.env.HR_PORT ?? 3190)}/`;
const [email = 'sam@northwind.test', width = '390'] = process.argv.slice(2);
const w = Number(width);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: w < 500, hasTouch: w < 500, geolocation: { latitude: 1.284, longitude: 103.851 }, permissions: ['geolocation'] });
const page = await ctx.newPage();
await page.goto(BASE + '#/home');
await page.waitForSelector('input[type=email]', { timeout: 30000 });
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', 'demo-pass-1');
await page.getByRole('button', { name: 'Sign in' }).last().click();
await page.waitForSelector('#hr-main [data-settled]', { timeout: 30000 });
const card = page.locator('#hr-main section', { hasText: /worked today/i }).first();
const button = card.getByRole('button').first();
/** The card's state line ("Clocked in", "Since 09:02") and its button. */
const stateOf = async () => {
  const lines = (await card.innerText()).split('\n').map((l) => l.trim());
  const state = lines.find((l) => /^(clocked in|clocked out|on a break)/i.test(l)) ?? '?';
  const since = lines.find((l) => /^since /i.test(l)) ?? '';
  return `${state}${since !== '' ? ' ' + since : ''} / ${(await button.innerText()).trim()}`;
};
const before = await stateOf();
const t0 = Date.now();
await button.click();
let ms = -1;
let after = before;
for (let i = 0; i < 300; i++) {
  after = await stateOf();
  if (after !== before) {
    ms = Date.now() - t0;
    break;
  }
  await page.waitForTimeout(5);
}
await page.waitForTimeout(3000);
const confirmed = await stateOf();
let undone = '';
const undo = page.getByRole('button', { name: 'Undo' }).first();
if (await undo.isVisible().catch(() => false)) {
  await undo.click();
  await page.waitForTimeout(3000);
  undone = await stateOf();
}
const ok = ms >= 0 && ms < 300 && confirmed.split(' / ')[0].split(' ')[1] === after.split(' / ')[0].split(' ')[1] && (undone === '' || undone.startsWith(before.split(' / ')[0].split(' ')[0]));
console.log(JSON.stringify({ before, shown_after_ms: ms, after, confirmed_3s: confirmed, after_undo: undone, ok }));
await browser.close();
process.exit(ok ? 0 : 1);
