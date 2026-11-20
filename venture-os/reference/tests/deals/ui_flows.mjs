// The deals screens driven in a browser on the seeded demo (run seed_demo.mjs first): drag a card,
// move through the stage track with its one-line confirm, write and save a note (autosave, the
// StepTrack), accept and dismiss your AI agent's changes in place, add a room file, rename a stage,
// the phone Move to menu; no console errors.
import { createRequire } from 'node:module';
import { PORT, DEMO, newApi, ok, section, summary, sleep } from './lib.mjs';

// Polls once a second (the browser and these checks share the ops rate limit), up to 15 s.
async function until(fn, ms = 15000) {
  const end = Date.now() + Math.max(ms, 15000);
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(1000);
  }
}

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const BASE = `http://127.0.0.1:${PORT}/`;
const api = newApi();
const find = async (q) => (await api.op('deals.list', { q, pipeline: 'deal_flow', status: 'all' }, { as: 'owner' })).deals[0];

const browser = await chromium.launch({ headless: true });
async function open(width, email = DEMO.owner) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main');
  return { ctx, page, errors };
}
const settle = async (page) => {
  await page.waitForFunction(() => document.querySelector('.vo-skel') === null, null, { timeout: 12000 }).catch(() => undefined);
  await page.waitForTimeout(600);
};

const { page, errors } = await open(1440);

section('Board: drag a card to another stage');
{
  const kite = await find('Kite Pay');
  await page.goto(BASE + '#/deals');
  await settle(page);
  const card = page.locator('[draggable=true]', { hasText: 'Kite Pay' });
  const target = page.locator('section[aria-label="Screen"]');
  await card.dragTo(target);
  const moved = await until(async () => (await api.op('deals.get', { deal: kite.id }, { as: 'owner' })).deal.stage === 'screen', 8000);
  ok(moved, 'Kite Pay moved to Screen by drag');
  ok(await until(() => page.locator('section[aria-label="Screen"]').getByText('Kite Pay').isVisible(), 5000), 'the card shows in Screen');
  ok(await until(() => page.getByText('Moved to Screen').isVisible(), 5000), 'the toast says Moved to Screen with Undo');
  await page.getByRole('button', { name: 'Undo' }).click();
  const back = await until(async () => (await api.op('deals.get', { deal: kite.id }, { as: 'owner' })).deal.stage === 'sourced', 8000);
  ok(back, 'Undo moved it back');
}

section('Deal page: the stage track moves after a one-line confirm');
{
  const q = await find('Quill');
  await page.goto(BASE + '#/deals/' + q.number);
  await settle(page);
  await page.getByRole('button', { name: 'Move to First meeting' }).click();
  ok(await until(() => page.getByText('Move to First meeting?').isVisible(), 5000), 'the confirm asks one line');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  ok(await until(async () => (await api.op('deals.get', { deal: q.id }, { as: 'owner' })).deal.stage === 'first_meeting', 8000), 'moved to First meeting');
  await page.getByRole('button', { name: 'Advance' }).click();
  ok(await until(async () => (await api.op('deals.get', { deal: q.id }, { as: 'owner' })).deal.stage === 'diligence', 8000), 'Advance moves to the next stage');
  await settle(page);
  ok(await until(() => page.getByRole('button', { name: 'Schedule IC' }).isVisible(), 5000), 'at Diligence the primary action is Schedule IC');
}

section('Notes: write, autosave, save, StepTrack');
{
  const v = await find('Vela Space');
  await page.goto(BASE + '#/deals/' + v.number + '?tab=notes');
  await settle(page);
  await page.getByRole('button', { name: 'New note' }).first().click();
  await page.getByRole('textbox', { name: 'Team' }).fill('Two founders; the CTO built payments at Stripe.');
  ok(await until(async () => (await api.op('notes.list', { deal: v.id }, { as: 'owner' })).notes.length === 1, 8000), 'autosave created the note on the first words');
  await page.getByRole('textbox', { name: 'Round' }).fill('Raising USD 3.5M seed.');
  const n = await until(async () => {
    const x = (await api.op('notes.list', { deal: v.id }, { as: 'owner' })).notes[0];
    return x && x.body.round === 'Raising USD 3.5M seed.' ? x : false;
  }, 8000);
  ok(n && n.body.team !== undefined && n.status === 'draft', 'autosave keeps every section; still a draft');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  ok(await until(() => page.getByText('Waiting for your AI agent').isVisible()), 'after Save the StepTrack waits for your AI agent');
  ok(await page.getByRole('list', { name: 'Progress' }).first().isVisible(), 'the StepTrack is on screen');
  await page.keyboard.press('Escape');
}

section('The review in place: accept and dismiss change by change');
{
  const acme = await find('Acme Robotics');
  const note = (await api.op('notes.list', { deal: acme.id }, { as: 'owner' })).notes.find((x) => x.template.key === 'first_call');
  await page.goto(BASE + '#/deals/' + acme.number + '?tab=notes&note=' + note.id);
  await settle(page);
  ok(await until(() => page.getByText('USD 12M').isVisible(), 5000), 'a proposed value reads as money (USD 12M)');
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Accept', exact: true }).first().click();
  await page.waitForTimeout(800);
  await sheet.getByRole('button', { name: 'Dismiss', exact: true }).last().click();
  const g = await until(async () => {
    const x = (await api.op('notes.get', { note: note.id }, { as: 'owner' })).note;
    return x.review.pending === 1 ? x : false;
  }, 8000);
  ok(g && g.review.proposals.filter((p) => p.status === 'accepted').length === 1 && g.review.proposals.filter((p) => p.status === 'dismissed').length === 1, 'one accepted, one dismissed, one waiting');
  ok(await until(() => page.getByText('Accepted').first().isVisible(), 5000), 'the row says Accepted in place');
  const d = (await api.op('deals.get', { deal: acme.id }, { as: 'owner' })).deal;
  ok(d.round.pre_money_minor === 1200000000, 'the accepted pre-money is on the deal');
  await page.keyboard.press('Escape');
}

section('Files: drop into the room');
{
  const acme = await find('Acme Robotics');
  await page.goto(BASE + '#/deals/' + acme.number + '?tab=files');
  await settle(page);
  await page.locator('[data-vo-drop] input[type=file]').setInputFiles({ name: 'cap_table.csv', mimeType: 'text/csv', buffer: Buffer.from('holder,shares\nJane,4000000\n') });
  ok(await until(async () => (await api.op('files.list', { deal: acme.id }, { as: 'owner' })).files.some((f) => f.name === 'cap_table.csv'), 8000), 'the file is in the deal room');
  ok(await until(() => page.getByText('cap_table.csv').isVisible(), 5000), 'and on screen');
}

section('Settings, Pipelines: rename a stage in place');
{
  await page.goto(BASE + '#/settings/pipelines');
  await settle(page);
  const box = page.getByRole('textbox', { name: 'Stage name' }).nth(4);
  await box.fill('Partner review');
  await box.press('Enter');
  ok(await until(async () => (await api.op('pipelines.list', {}, { as: 'owner' })).pipelines[0].stages[4].label === 'Partner review', 8000), 'renamed through pipelines.save');
  await page.waitForTimeout(800);
  await box.fill('Partner meeting');
  await box.press('Enter');
  ok(await until(async () => (await api.op('pipelines.list', {}, { as: 'owner' })).pipelines[0].stages[4].label === 'Partner meeting', 8000), 'and back');
}

section('Phone: Move to');
{
  const ph = await open(390, 'pat@venture.test');
  await ph.page.goto(BASE + '#/deals');
  await settle(ph.page);
  const row = ph.page.locator('li', { hasText: 'Kite Pay' });
  await row.getByRole('button', { name: 'Move to' }).click();
  await ph.page.getByRole('menuitem', { name: 'Screen' }).click();
  const kite = await find('Kite Pay');
  ok(await until(async () => (await api.op('deals.get', { deal: kite.id }, { as: 'owner' })).deal.stage === 'screen', 8000), 'a phone moves a deal with the Move to menu');
  ok(ph.errors.length === 0, 'no console errors on the phone', ph.errors);
  await ph.ctx.close();
}

ok(errors.length === 0, 'no console errors', errors);
await browser.close();
summary('ui_flows');
