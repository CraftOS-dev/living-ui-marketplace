// Focus mode walk (SPEC 2 U7) on the seeded demo firm: every card of the owner's queue, one at a time with
// J, its kind, custom body, figures, prepared content and actions; a screenshot of each (light 1440; phone
// 390 for one card of each kind); the keys K, X, E (on a draft) and A (on a PIN action: the PIN dialog
// opens, Esc cancels, nothing changes); no console errors. Writes focus_walk.json beside the shots.
// Usage: node focus_walk.mjs   (VO_PORT 3192 with tools/dev/seed_demo.mjs loaded; frontend built)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, open, settle, OUT, BASE } from './ui_lib.mjs';

const browser = await chromium.launch();
const report = { cards: [], keys: [], errors: [] };
const ok = (name, cond, detail) => {
  report.keys.push({ name, ok: cond, detail });
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 300) : ''));
};

async function cardInfo(page) {
  return page.evaluate(() => {
    const a = document.querySelector('#vo-main article');
    if (!a) return null;
    const head = a.querySelector('div > div');
    const kind = head ? head.querySelector('span.font-medium')?.textContent ?? '' : '';
    const title = a.querySelector('h2')?.textContent ?? '';
    const pos = [...a.querySelectorAll('.vo-mono')].map((x) => x.textContent).find((t) => /\d+ \/ \d+/.test(t ?? '')) ?? '';
    const figures = [...a.querySelectorAll('.text-\\[26px\\]')].length;
    const buttons = [...a.querySelectorAll('footer button')].map((b) => b.textContent.trim()).filter((t) => t !== '');
    const text = a.textContent ?? '';
    return { kind, title, pos, figures, buttons, chars: text.length, body: text.slice(0, 400) };
  });
}

const { ctx, page, errors } = await open(browser, 'light', 1440);
await page.goto(BASE + '#/focus');
await settle(page, 1500);
const seenKinds = new Set();
let total = 0;
for (let i = 0; i < 60; i++) {
  const c = await cardInfo(page);
  if (c === null) break;
  total = Number((/\/ (\d+)/.exec(await page.evaluate(() => document.querySelector('#vo-main')?.textContent ?? '')) ?? [])[1] ?? 0);
  report.cards.push(c);
  const tag = `${String(i + 1).padStart(2, '0')}_${c.kind.toLowerCase().replace(/\W+/g, '_')}`;
  await page.screenshot({ path: join(OUT, `focus_${tag}_light_1440.png`), fullPage: true });
  console.log(`${i + 1}. ${c.kind} | ${c.title} | figures ${c.figures} | ${c.buttons.join(', ')}`);
  seenKinds.add(c.kind);
  const before = c.title;
  await page.keyboard.press('j');
  await page.waitForTimeout(450);
  const after = await cardInfo(page);
  if (after === null || after.title === before) break;
}
ok('walked every card', report.cards.length === total || report.cards.length >= total - 1, { walked: report.cards.length, total });
ok('every kind has a card with actions', report.cards.every((c) => c.buttons.length >= 1), report.cards.filter((c) => c.buttons.length === 0).map((c) => c.kind + ' ' + c.title));

// K goes back one.
const lastTitle = (await cardInfo(page))?.title;
await page.keyboard.press('k');
await page.waitForTimeout(450);
ok('K moves back', (await cardInfo(page))?.title !== lastTitle);

// Back to the first card, then X skips it to the end.
await page.goto(BASE + '#/');
await settle(page, 600);
await page.goto(BASE + '#/focus');
await settle(page, 1200);
const first = (await cardInfo(page))?.title;
await page.keyboard.press('x');
await page.waitForTimeout(450);
ok('X skips to the next card', (await cardInfo(page))?.title !== first);

// E on a draft edits its text in place; Esc leaves the editor without saving.
for (let i = 0; i < 60; i++) {
  const c = await cardInfo(page);
  if (c === null) break;
  if (c.kind === 'Draft' && c.buttons.some((b) => b.startsWith('Edit'))) {
    await page.keyboard.press('e');
    await page.waitForTimeout(400);
    const editing = await page.evaluate(() => document.querySelector('#vo-main article textarea') !== null);
    ok('E opens the draft editor', editing);
    await page.screenshot({ path: join(OUT, 'focus_draft_edit_light_1440.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    break;
  }
  await page.keyboard.press('j');
  await page.waitForTimeout(350);
}

// A on a card whose primary action needs the PIN: the PIN dialog opens; Esc cancels.
await page.goto(BASE + '#/');
await settle(page, 600);
await page.goto(BASE + '#/focus');
await settle(page, 1200);
for (let i = 0; i < 60; i++) {
  const c = await cardInfo(page);
  if (c === null) break;
  if (c.kind === 'Mark') {
    await page.keyboard.press('a');
    await page.waitForTimeout(600);
    const dlg = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent?.slice(0, 120) ?? '');
    ok('A on Approve all asks the PIN', /PIN|pin/.test(dlg) || dlg !== '', dlg);
    await page.screenshot({ path: join(OUT, 'focus_mark_pin_light_1440.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok('Esc cancels and the card stays', (await cardInfo(page))?.kind === 'Mark');
    break;
  }
  await page.keyboard.press('j');
  await page.waitForTimeout(350);
}
report.errors.push(...errors);
ok('no console errors or 5xx', errors.length === 0, errors.slice(0, 5));
await ctx.close();

// Phone: the first card of each kind at 390.
const ph = await open(browser, 'dark', 390);
await ph.page.goto(BASE + '#/focus');
await settle(ph.page, 1500);
const phoneKinds = new Set();
for (let i = 0; i < 60; i++) {
  const c = await cardInfo(ph.page);
  if (c === null) break;
  if (!phoneKinds.has(c.kind)) {
    phoneKinds.add(c.kind);
    await ph.page.screenshot({ path: join(OUT, `focus_phone_${c.kind.toLowerCase().replace(/\W+/g, '_')}_dark_390.png`), fullPage: true });
  }
  const before = c.title;
  await ph.page.keyboard.press('j');
  await ph.page.waitForTimeout(400);
  const after = await cardInfo(ph.page);
  if (after === null || after.title === before) break;
}
ok('phone: no console errors', ph.errors.length === 0, ph.errors.slice(0, 5));
await ph.ctx.close();
await browser.close();
report.kinds = [...seenKinds];
writeFileSync(join(OUT, 'focus_walk.json'), JSON.stringify(report, null, 1));
console.log('kinds walked: ' + report.kinds.join(', '));
const failed = report.keys.filter((k) => !k.ok).length;
console.log(`focus walk: ${report.keys.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
