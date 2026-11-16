// The diligence screens driven like a partner would (headless Chromium on seeded data): confirm and reject on a row,
// confirm in the reader while reading the quote, Confirm all, answer by hand, log a reference with one signal click,
// Suggest names (StepTrack), apply a checklist from the empty state, Focus card per-answer confirm and its primary,
// the grid's Ask your AI agent. Each result is checked through the ops. No console errors.
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, PARTNER, DEMO, newApi, section, ok, summary } from './lib.mjs';
import { seedUi } from './ui_seed.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'shots');
const BASE = `http://127.0.0.1:${PORT}/`;

const ids = await seedUi();
const api = newApi();
const P = { as: PARTNER };
const dd = () => api.op('dd.get', { deal: ids.acme.number }, P);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
await page.goto(BASE + '#/');
await page.waitForSelector('input[type=email]', { timeout: 20000 });
await page.fill('input[type=email]', PARTNER);
await page.fill('input[type=password]', DEMO.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForSelector('#vo-main', { timeout: 20000 });
const loaded = () => page.waitForFunction(() => document.querySelectorAll('#vo-main .vo-skel').length === 0 && document.querySelector('#vo-main li') !== null, null, { timeout: 25000 });
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await page.waitForTimeout(400);
  }
};
const row = (text) => page.locator('#vo-main li.group', { hasText: text }).first();

section('confirm and reject on a row');
await page.goto(BASE + `#/deals/${ids.acme.number}?tab=diligence`);
await loaded();
let r = row('Is there a technical founder?');
await r.hover();
await r.getByRole('button', { name: 'Confirm' }).click();
ok(await until(async () => (await dd()).questions.find((q) => q.key === 'team_technical').state === 'confirmed'), 'one click confirms an answer');
r = row('Month on month growth');
await r.hover();
await r.getByRole('button', { name: 'Reject' }).click();
ok(await until(async () => (await dd()).questions.find((q) => q.key === 'traction_growth').state === 'open'), 'one click rejects an answer; the question opens');

section('confirm in the reader, beside the quote');
r = row('Current ARR');
await r.getByRole('button', { name: 'p.2' }).click();
await page.waitForSelector('[role=dialog] canvas', { timeout: 20000 });
await page.waitForTimeout(1200);
ok((await page.locator('[role=dialog] [data-mark]').count()) > 0, 'the quote is highlighted on the page');
await page.screenshot({ path: join(OUT, 'flow_reader_confirm.png') });
await page.locator('[role=dialog]').getByRole('button', { name: 'Confirm' }).click();
ok(await until(async () => (await dd()).questions.find((q) => q.key === 'traction_arr').state === 'confirmed'), 'confirmed from the reader');
ok(await until(async () => (await page.locator('[role=dialog]').count()) === 0), 'the reader closes after the decision');

section('answer by hand');
const team = page.locator('#vo-main section[aria-label] > button[aria-expanded]', { hasText: 'Team' });
ok((await page.locator('#vo-main section[aria-label] > button[aria-expanded=true]').count()) === 0, 'areas are folded at rest');
await team.click();
ok((await team.getAttribute('aria-expanded')) === 'true', 'a click unfolds the area');
r = row("Founders' prior startups");
await r.hover();
await r.getByRole('button', { name: 'Answer by hand' }).click();
await r.locator('input').fill('Kiva Systems (acquired by Amazon)');
await r.locator('input').press('Enter');
ok(await until(async () => (await dd()).questions.find((q) => q.key === 'team_prior').answer?.value === 'Kiva Systems (acquired by Amazon)'), 'typed answer saved and confirmed');
ok(await until(async () => (await row("Founders' prior startups").innerText()).includes('Kiva Systems')), 'the row shows it at once');

section('Confirm all');
const before = (await dd()).counts.proposed;
await page.getByRole('button', { name: /Confirm all/ }).click();
ok(await until(async () => (await dd()).counts.proposed === 0), `Confirm all cleared ${before} answers`);

section('references');
await page.fill('#vo-main input[aria-label=Name]', 'Hana Ops');
await page.locator('#vo-main [role=radiogroup][aria-label=Kind]').getByRole('radio', { name: 'Expert' }).click();
await page.locator('#vo-main [role=group][aria-label=Signal]').first().getByRole('button', { name: 'Positive' }).click();
ok(await until(async () => (await api.op('refs.list', { deal: ids.acme.number }, P)).references.some((x) => x.name === 'Hana Ops' && x.kind === 'expert' && x.signal === 'positive')), 'name, kind chip, signal dot: logged');
const sugg = page.locator('#vo-main li.group', { hasText: 'Bea Colleague' });
await sugg.getByRole('button', { name: 'Negative' }).click();
ok(await until(async () => (await api.op('refs.list', { deal: ids.acme.number }, P)).references.find((x) => x.name === 'Bea Colleague')?.status === 'logged'), 'a suggested name logged with one signal click');
await page.getByRole('button', { name: 'Suggest names' }).click();
ok(await until(async () => (await page.locator('#vo-main ol[aria-label=Progress]').count()) > 0), 'Suggest names shows the StepTrack');
await page.screenshot({ path: join(OUT, 'flow_tab_after.png'), fullPage: true });

section('the empty state applies a checklist');
await page.goto(BASE + `#/deals/${ids.zeta.number}?tab=diligence`);
await page.getByRole('button', { name: /^Apply / }).click({ timeout: 25000 });
ok(await until(async () => (await api.op('dd.get', { deal: ids.zeta.number }, P)).questions.length === 51), 'Apply Seed adds the checklist');
ok(await until(async () => (await page.locator('#vo-main').getByRole('button', { name: 'Ask your AI agent' }).count()) === 1 && (await page.locator('#vo-main li.group').count()) === 0), 'nothing answered yet: one empty state with Ask your AI agent, not the questions');
await page.locator('#vo-main').getByRole('button', { name: 'Answer by hand' }).click();
ok(await until(async () => (await page.locator('#vo-main section[aria-label] > button[aria-expanded]').count()) >= 6), 'Answer by hand shows the areas, folded');

section('Focus card');
// A fresh proposal for the card: your AI agent answers one question again.
await api.op('dd.ask', { deal: ids.acme.number }, P);
const g = await dd();
const qGrowth = g.questions.find((q) => q.key === 'market_growth');
const qSam = g.questions.find((q) => q.key === 'market_sam');
await api.op('dd.answer', { answers: JSON.stringify([{ question: qGrowth.id, value: '18', unit: '%', num_kind: 'external', grade: 'public', sources: ['https://www.example.org/report'] }, { question: qSam.id, value: '800000000', unit: 'USD', num_kind: 'external', grade: 'public', sources: ['https://www.example.org/report'] }]) }, { as: 'agent' });
ok(claimed !== null, 'asked your AI agent');
await page.goto(BASE + '#/focus?at=' + encodeURIComponent('diligence:verify:' + ids.acme.id));
await page.reload();
await page.waitForSelector('#vo-main article', { timeout: 25000 });
await page.waitForTimeout(800);
const card = page.locator('#vo-main article');
await card.locator('li', { hasText: 'Serviceable market' }).getByRole('button', { name: 'Confirm' }).click();
ok(await until(async () => (await dd()).questions.find((q) => q.key === 'market_sam').state === 'confirmed'), 'a per-answer Confirm in the card');
ok((await card.getByRole('button', { name: /Confirm all/ }).count()) === 1, 'one Confirm all on the card (the frame primary)');
await card.getByRole('button', { name: /Confirm all/ }).click();
ok(await until(async () => (await dd()).questions.find((q) => q.key === 'market_growth').state === 'confirmed'), "the card's primary confirms the answers left");

section('grid');
await page.goto(BASE + `#/compare/${ids.grid.id}`);
await page.waitForSelector('#vo-main table', { timeout: 25000 });
await page.waitForTimeout(800);
ok((await page.locator('#vo-main tbody tr').count()) === 3, 'three companies as rows');
await page.screenshot({ path: join(OUT, 'flow_grid.png') });

ok(errors.length === 0, 'no console errors or 5xx', errors);
await browser.close();
summary('ui flows');
