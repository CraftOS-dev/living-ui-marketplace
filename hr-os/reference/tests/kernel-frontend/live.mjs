// Live refresh: a change made elsewhere (your AI agent through the CLI, as here) shows on an open page with no reload.
import { pathToFileURL } from 'node:url';
import { BASE, chromium, open, settle, signIn } from './lib.mjs';

// HR_APP: the scratch app copy (default ../app next to this folder).
const app = process.env.HR_APP ?? new URL('../app', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const { client } = await import(pathToFileURL(app + '/tools/dev/api.mjs').href);
const api = client({ port: Number(process.env.PORT ?? 3182), app });
const browser = await chromium.launch({ headless: true });
const { page, errors } = await open(browser, {});
await signIn(page, 'owner@northwind.test', 'demo-pass-1');
await page.goto(BASE + '#/settings/org');
await settle(page, 900);
const name = 'Live Desk ' + Date.now().toString(36);
const t0 = Date.now();
// Your AI agent proposes org changes by default; the owner adds it directly here.
await api.op('departments.add', { name }, { as: 'owner' });
await page.waitForSelector(`text=${name}`, { timeout: 6000 });
console.log(`ok: a department added through the API showed on the open page in ${Date.now() - t0} ms`);
// The agent asks: a proposal appears in the Inbox badge without a reload.
const before = await page.locator('nav[aria-label="Main"] a[href="#/inbox"]').innerText();
await api.op('departments.add', { name: name + ' B', why: 'Asked in chat' }, { as: 'agent' });
await page.waitForFunction((b) => document.querySelector('nav[aria-label="Main"] a[href="#/inbox"]')?.innerText !== b, before, { timeout: 6000 });
console.log('ok: your AI agent\'s proposal raised the Inbox count live');
console.log('console errors:', errors.length === 0 ? 'none' : errors.join(' | '));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
