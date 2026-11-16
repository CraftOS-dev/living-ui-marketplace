// The intake screens in a real browser: empty database first, then the demo Inbox. Screenshots of every
// page and dialog light and dark at 1440 and 390; word counts at rest; pointer cursors; no sideways
// scroll on a phone; no console errors; then the flows by mouse and keyboard: one drop adds a deal,
// A advances, P then a chip passes, the drafted email is approved and sent, bulk pass, the deck opens
// at the quote, the global drop, Focus mode's triage card, the Intake settings.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { section, ok, summary, APP, PEOPLE, bridge, newApi } from './lib.mjs';
import { seed } from './seed.mjs';
import { chromium, open, signIn, settle, shot, wordCount, noPointer, overflowX, BASE, OUT } from './ui.mjs';

const ONLY = process.env.ONLY ?? '';
const combos = [
  ['light', 1440],
  ['dark', 1440],
  ['light', 390],
  ['dark', 390],
];
const words = {};
const browser = await chromium.launch({ headless: true });

/** Warm every pooled runtime of the scratch server (a cold one loads the hooks for seconds). */
async function warm(api) {
  await api.op('auth.me', {}, { as: 'owner' });
  const items = (await api.op('intake.list', { segment: 'all' }, { as: 'owner' })).items;
  const ops = [['intake.list', {}], ['next.count', {}], ['chat.list', {}], ['notifications.list', {}], ['intake.settings', {}], ['auth.me', {}], ['scouts.list', {}], ['theses.list', {}], ['next.list', {}], ['settings.get', {}], ['intake.list', { segment: 'waiting' }]];
  for (const it of items.slice(0, 4)) ops.push(['intake.get', { item: it.id }]);
  for (let round = 0; round < 6; round++) {
    const calls = [];
    for (let i = 0; i < 32; i++) {
      const [name, params] = ops[(i + round) % ops.length];
      calls.push(api.call(name, params, { as: 'owner' }));
    }
    await Promise.all(calls);
  }
}

async function view(page, h, ms = 900) {
  await page.goto(BASE + h);
  await page.waitForFunction(() => document.querySelector('#vo-main h1') !== null && document.querySelectorAll('#vo-main .vo-skel').length === 0, null, { timeout: 30000 }).catch(() => undefined);
  await settle(page, ms);
}

async function check(page, errors, name, phone) {
  const pointer = await noPointer(page);
  ok(pointer.length === 0, name + ': pointer cursor on everything clickable', pointer);
  if (phone) {
    const ox = await overflowX(page);
    ok(ox <= 1, name + ': no sideways scroll on a phone (' + ox + 'px)');
  }
  ok(errors.length === 0, name + ': no console errors', errors.slice(0, 3));
  errors.length = 0;
}

/* ------------------------------------------------------------- empty */
section('empty database');
{
  const { api } = await seed({ empty: true });
  await warm(api);
  for (const [scheme, width] of combos) {
    const phone = width < 768;
    const tag = `${scheme}_${width}`;
    const { page, errors, ctx } = await open(browser, { scheme, width, height: phone ? 844 : 900, mobile: phone });
    await signIn(page);
    await view(page, '#/inbox');
    await page.waitForSelector('text=No new deals', { timeout: 20000 }).catch(() => undefined);
    const empty = await page.getByText('No new deals').count();
    ok(empty === 1, tag + ': the empty Inbox says "No new deals" with one button');
    await shot(page, `inbox_empty_${tag}`);
    if (!phone && scheme === 'light') words.inbox_empty = (await wordCount(page)).n;
    await check(page, errors, 'empty inbox ' + tag, phone);
    await view(page, '#/settings/intake');
    await shot(page, `settings_intake_empty_${tag}`);
    await check(page, errors, 'empty settings ' + tag, phone);
    await ctx.close();
  }
}

/* -------------------------------------------------------------- seeded */
section('demo Inbox: screens');
const { api } = await seed();
await warm(api);
const list = (await api.op('intake.list', { segment: 'all' }, { as: 'owner' })).items;
const num = (n) => list.find((x) => x.name.includes(n)).number;
const SHOTS = [
  ['inbox', `#/inbox?item=${num('Acme')}`],
  ['inbox_reading', `#/inbox?item=${num('Lumen')}`],
  ['inbox_waiting_agent', `#/inbox?item=${num('Orbital')}`],
  ['inbox_overdue', `#/inbox?item=${num('Harbor')}`],
  ['inbox_waiting', `#/inbox?seg=waiting&item=${num('Nimbus')}`],
  ['inbox_held', `#/inbox?seg=held&item=${num('Quill')}`],
  ['settings_intake', '#/settings/intake'],
];
for (const [scheme, width] of combos) {
  const phone = width < 768;
  const tag = `${scheme}_${width}`;
  const { page, errors, ctx } = await open(browser, { scheme, width, height: phone ? 844 : 1000, mobile: phone });
  await signIn(page);
  for (const [name, h] of SHOTS) {
    if (ONLY !== '' && !ONLY.split(',').includes(name)) continue;
    await view(page, h);
    if (name.startsWith('inbox')) await page.waitForSelector('#vo-main article h2', { timeout: 30000 }).catch(() => undefined);
    await settle(page, 300);
    await shot(page, `${name}_${tag}`);
    if (!phone && scheme === 'light') words[name] = (await wordCount(page)).n;
    await check(page, errors, name + ' ' + tag, phone);
  }
  if (phone) {
    await view(page, '#/inbox');
    await shot(page, `inbox_list_${tag}`);
    await check(page, errors, 'phone list ' + tag, phone);
  }
  // The Add deal dialog.
  await view(page, '#/inbox');
  await page.getByRole('button', { name: 'Add deal' }).first().click();
  await settle(page, 400);
  await shot(page, `add_deal_${tag}`, false);
  await page.getByRole('dialog', { name: 'Add deal' }).getByRole('button', { name: 'More' }).click();
  await settle(page, 600);
  await shot(page, `add_deal_more_${tag}`, false);
  await page.keyboard.press('Escape');
  // Pass chips open on Acme.
  await view(page, `#/inbox?item=${num('Acme')}`);
  await page.getByRole('button', { name: /^Pass/ }).first().click();
  await settle(page, 400);
  await shot(page, `pass_chips_${tag}`, false);
  // The deck at the quote.
  await page.keyboard.press('Escape');
  await page.locator('button:has-text("p.7")').first().click();
  await page.waitForFunction(() => { const c = document.querySelector('[role="dialog"] canvas'); return c !== null && c.width > 0; }, null, { timeout: 20000 }).catch(() => undefined);
  await settle(page, 1200);
  await shot(page, `deck_quote_${tag}`, false);
  await page.keyboard.press('Escape');
  // Focus mode's triage card.
  await view(page, '#/focus', 1500);
  if (scheme === 'light' && !phone) ok((await page.locator('#vo-main >> text=Facts').count()) > 0 && (await page.getByRole('button', { name: /^Advance/ }).count()) > 0, 'Focus shows the triage card (facts) with Advance');
  await shot(page, `focus_triage_${tag}`, false);
  await check(page, errors, 'dialogs and focus ' + tag, phone);
  await ctx.close();
}

/* --------------------------------------------------------------- flows */
section('flows by mouse and keyboard');
{
  const { page, errors, ctx } = await open(browser, { width: 1440, height: 1000 });
  await signIn(page, PEOPLE.partner);
  await view(page, '#/inbox');
  const before = await page.locator('[role="option"]').count();
  // One drop adds a deal: the dialog closes at once and the row is on top with its StepTrack.
  await page.getByRole('button', { name: 'Add deal' }).first().click();
  await settle(page, 300);
  const t0 = Date.now();
  await page.locator('[role="dialog"] input[type=file]').setInputFiles(join(APP, 'tools', 'dev', 'fixtures', 'decks', 'acme_robotics_seed.pdf'));
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 2000 }).catch(() => undefined);
  ok((await page.locator('[role="dialog"]').count()) === 0 && Date.now() - t0 < 1500, 'the dialog closed at once after the drop');
  await page.waitForFunction((n) => document.querySelectorAll('[role="option"]').length > n, before, { timeout: 15000 });
  const first = await page.locator('[role="option"]').first().innerText();
  ok(/acme robotics seed/i.test(first), 'the new deal is at the top of New', first);
  await page.waitForFunction(() => /item=IN-/.test(location.hash), null, { timeout: 30000 }).catch(() => undefined);
  await page.waitForSelector('article ol[aria-label="Progress"]', { timeout: 20000 }).catch(() => undefined);
  ok((await page.locator('article ol[aria-label="Progress"]').count()) > 0, 'the Inbox opens on it: its card shows the StepTrack (Received)');
  await shot(page, 'flow_dropped');

  // A advances Acme.
  await view(page, `#/inbox?item=${num('Acme')}`);
  await page.keyboard.press('a');
  await page.waitForSelector('article button:has-text("D-0001")', { timeout: 15000 });
  ok(true, 'A advanced Acme: the card shows D-0001');
  await shot(page, 'flow_advanced');
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('[role="option"]')).some((e) => /Acme Robotics\s/.test(e.textContent ?? '') && /Mobile picking/.test(e.textContent ?? '')), null, { timeout: 8000 }).catch(() => undefined);

  // P then a chip passes Harbor; the email is drafted by your AI agent later: Waiting for your AI agent.
  await view(page, `#/inbox?item=${num('Harbor')}`);
  await page.keyboard.press('p');
  await settle(page, 300);
  await page.keyboard.press('2');
  await page.waitForSelector('article >> text=Waiting for your AI agent', { timeout: 15000 });
  ok(true, 'P then 2 passed Harbor (Market); the card waits for your AI agent\'s email');
  await shot(page, 'flow_passed');
  await page.getByRole('button', { name: 'Write it myself' }).click();
  await page.waitForSelector('article >> text=Approve and send', { timeout: 15000 });
  ok((await page.locator('article').innerText()).includes('Hi Ana'), 'Write it myself: the template opens at once');

  // Approve and send the drafted Nimbus email.
  await view(page, `#/inbox?seg=waiting&item=${num('Nimbus')}`);
  await page.getByRole('button', { name: 'Approve and send' }).click();
  await page.waitForSelector('article >> text=Sent', { timeout: 15000 });
  const sent = (await bridge.sent()).sent;
  ok(sent.some((m) => /lee@nimbusfleet.com/.test(m.to)), 'approved and sent once from the firm\'s Gmail', sent.map((m) => m.to));
  await shot(page, 'flow_sent');

  // Bulk: select two and pass.
  await view(page, '#/inbox');
  const rows = page.locator('[role="option"]');
  await rows.nth(1).hover();
  await rows.nth(1).getByRole('checkbox').click();
  await rows.nth(2).getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Pass', exact: true }).first().click();
  await settle(page, 300);
  await shot(page, 'flow_bulk', false);
  const n0 = await rows.count();
  await page.locator('[role="radiogroup"][aria-label="Reason"] button').first().click();
  await page.waitForFunction((n) => document.querySelectorAll('[role="option"]').length < n, n0, { timeout: 15000 });
  ok(true, 'bulk Pass took two deals out of New');
  await page.waitForSelector('text=Undo', { timeout: 20000 }).catch(() => undefined);
  ok((await page.getByText('Undo').count()) > 0, 'the toast offers Undo');
  await shot(page, 'flow_bulk_undo', false);

  // The global drop: a PDF dropped on another page becomes a new deal.
  await view(page, '#/settings/firm');
  const dropped = await page.evaluateHandle(async () => {
    const res = await fetch('/'); // any bytes would do; the file name decides the handler
    const dt = new DataTransfer();
    dt.items.add(new File([await res.blob()], 'Orion Labs deck.pdf', { type: 'application/pdf' }));
    return dt;
  });
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: dropped });
  await page.dispatchEvent('body', 'dragover', { dataTransfer: dropped });
  await page.dispatchEvent('body', 'drop', { dataTransfer: dropped });
  await page.waitForFunction(() => location.hash.startsWith('#/inbox'), null, { timeout: 15000 }).catch(() => undefined);
  await settle(page, 2000);
  ok((await page.evaluate(() => location.hash)).startsWith('#/inbox') && (await page.locator('[role="option"]').first().innerText()).includes('Orion Labs deck'), 'a PDF dropped on any page is a new deal in the Inbox', await page.evaluate(() => location.hash));

  await check(page, errors, 'flows', false);
  await ctx.close();
}

section('hover differs from its container and its children, light and dark');
for (const scheme of ['light', 'dark']) {
  const { page, errors, ctx } = await open(browser, { width: 1440, height: 900, scheme });
  await signIn(page);
  await view(page, '#/inbox');
  const row = page.locator('[role="option"][aria-selected="false"]').first();
  const panelBg = await page.evaluate(() => getComputedStyle(document.querySelector('[role="listbox"]').closest('section')).backgroundColor);
  await page.mouse.move(5, 5);
  const restBg = await row.evaluate((e) => getComputedStyle(e).backgroundColor);
  await row.hover();
  await page.waitForTimeout(350);
  const hoverBg = await row.evaluate((e) => getComputedStyle(e).backgroundColor);
  const childBgs = await row.evaluate((e) => Array.from(e.querySelectorAll('*')).map((c) => getComputedStyle(c).backgroundColor).filter((b) => b !== 'rgba(0, 0, 0, 0)'));
  ok(hoverBg !== panelBg && hoverBg !== restBg && !childBgs.includes(hoverBg), scheme + ': row hover (' + hoverBg + ') differs from the panel (' + panelBg + ') and its children');
  const btn = page.getByRole('button', { name: /^Pass/ }).first();
  const b0 = await btn.evaluate((e) => getComputedStyle(e).backgroundColor);
  await btn.hover();
  await page.waitForTimeout(350);
  const b1 = await btn.evaluate((e) => getComputedStyle(e).backgroundColor);
  ok(b0 !== b1, scheme + ': a button changes on hover (' + b0 + ' -> ' + b1 + ')');
  await check(page, errors, 'hover ' + scheme, false);
  await ctx.close();
}

section('a scout sees only their own deals');
{
  const { page, errors, ctx } = await open(browser, { width: 1440, height: 900 });
  await signIn(page, PEOPLE.scout);
  await view(page, '#/inbox');
  const rows = await page.locator('[role="option"]').count();
  ok(rows === 1, 'one row: the scout\'s own deal', rows);
  ok((await page.getByRole('button', { name: /^Advance/ }).count()) === 0, 'no verdict buttons for a scout');
  await shot(page, 'inbox_scout_light_1440');
  await check(page, errors, 'scout', false);
  await ctx.close();
}

writeFileSync(join(OUT, 'words.json'), JSON.stringify(words, null, 2));
console.log('\nwords at rest (light 1440, data excluded):', JSON.stringify(words));
for (const [k, n] of Object.entries(words)) ok(n <= 45, k + ': ' + n + ' interface words at rest (about 40 at most)');
await browser.close();
summary('t04 ui');
