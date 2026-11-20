// Which /api/ops answers fail while a page loads (status and body), for one person.
//   node net_probe.mjs <email> [page]      (password demo-pass-1, HR_PORT 3190)
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.HR_PORT ?? 3190);
const BASE = `http://127.0.0.1:${PORT}/`;
const [email = 'owner@northwind.test', page = 'home'] = process.argv.slice(2);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const seen = [];
p.on('response', async (r) => {
  const u = r.url();
  if (!u.includes('/api/ops/')) return;
  let body = '';
  if (r.status() >= 400) body = (await r.text().catch(() => '')).slice(0, 200);
  seen.push(`${r.status()} ${u.replace(BASE, '').split('?')[0]} ${body}`);
});
await p.goto(BASE + '#/home');
await p.waitForSelector('input[type=email]', { timeout: 30000 });
await p.fill('input[type=email]', email);
await p.fill('input[type=password]', 'demo-pass-1');
await p.getByRole('button', { name: 'Sign in' }).last().click();
await p.waitForSelector('#hr-main', { timeout: 30000 });
await p.goto(BASE + '#/' + page);
await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
await p.waitForTimeout(Number(process.env.WAIT ?? 8000));
console.log(seen.join('\n'));
await browser.close();
