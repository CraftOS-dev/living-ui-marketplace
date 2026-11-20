// The job post is never lost (UI QA H1), in a real browser on the demo seed:
// the post saves itself a moment after typing stops, leaving the tab keeps
// what was typed, and Publish saves everything on screen before it
// publishes. Needs the built frontend in pb/pb_public.
//   HR_APP=<scratch app dir> HR_PORT=3187 node t05_post_ui.mjs
import { createRequire } from 'node:module';
import { DEMO, PORT, eq, fresh, member, newApi, ok, section, summary } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${PORT}/`;

fresh({ seed: true });
const api = newApi();
await member(api, 'rita@northwind.test', 'Rita Okafor', 'recruiter');
const REC = { as: 'rita@northwind.test' };
const a = (await api.op('openings.add', { entity: 'Northwind Pte Ltd', title: 'Autosave check' }, REC)).opening;
const b = (await api.op('openings.add', { entity: 'Northwind Pte Ltd', title: 'Publish check' }, REC)).opening;
const get = async (id) => (await api.op('openings.get', { opening: id }, REC)).opening;

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]', { timeout: 30000 });
  await page.fill('input[type=email]', 'rita@northwind.test');
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main', { timeout: 30000 });
  const post = page.locator('textarea[aria-label="Job post"]');
  const saved = page.locator('span[role=status]', { hasText: 'Saved' });

  section('the post saves itself');
  await page.goto(BASE + `#/hiring/openings/${a.id}?tab=post`);
  await post.waitFor({ timeout: 30000 });
  const text1 = '## About the role\n\nBuild payroll services.\n\n- Go or TypeScript';
  await post.fill(text1);
  await saved.waitFor({ timeout: 20000 }).catch(() => undefined);
  eq((await get(a.id)).description, text1, 'typed post is saved without pressing Save');
  await page.reload();
  await post.waitFor({ timeout: 30000 });
  eq(await post.inputValue(), text1, 'and is there after a reload');

  section('leaving the tab keeps the post');
  const text2 = text1 + '\n- Postgres';
  await post.fill(text2);
  await page.getByRole('tab', { name: /Pipeline/ }).click();
  let left = '';
  for (let i = 0; i < 40 && left !== text2; i++) {
    await page.waitForTimeout(250);
    left = (await get(a.id)).description;
  }
  eq(left, text2, 'switching tabs right after typing saves what was typed');

  section('Publish publishes what is on screen');
  await page.goto(BASE + `#/hiring/openings/${b.id}?tab=post`);
  await post.waitFor({ timeout: 30000 });
  const text3 = 'Typed and published at once.';
  await post.fill(text3);
  await page.locator('input[aria-label="Place on the post"]').fill('Singapore');
  await page.getByRole('button', { name: 'Publish' }).first().click();
  let got = await get(b.id);
  for (let i = 0; i < 60 && got.status !== 'open'; i++) {
    await page.waitForTimeout(250);
    got = await get(b.id);
  }
  eq([got.status, got.description, got.location_text], ['open', text3, 'Singapore'], 'the post and the details on screen were saved, then the opening was published');
  ok(await page.getByText('This opening is a draft').waitFor({ state: 'hidden', timeout: 15000 }).then(() => true, () => false), 'the draft notice is gone');

  section('adding a candidate from the post shows the pipeline (QA N19)');
  await page.goto(BASE + `#/hiring/openings/${b.id}?tab=post`);
  await post.waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Add candidate' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Add candidate' });
  await dlg.locator('input[aria-label="Name"]').fill('Nora Lim');
  await dlg.getByRole('button', { name: 'Add candidate' }).click();
  await page.waitForFunction(() => !location.hash.includes('tab='), null, { timeout: 20000 }).catch(() => undefined);
  ok(!page.url().includes('tab='), 'the opening switched to its pipeline', page.url());
  ok(await page.getByText('Nora Lim').first().waitFor({ timeout: 20000 }).then(() => true, () => false), 'the new candidate is on the board');
  ok(errors.length === 0, 'no page errors or 5xx', errors);
  await ctx.close();
} finally {
  await browser.close();
}
const s = summary('t05_post_ui');
process.exitCode = s.failed > 0 ? 1 : 0;
