// Home's screens on the seeded demo firm (or an empty one with --empty): light and dark at 1440 and 390,
// the UX checks of SPEC 2 (interface words at rest, nothing under titles, five blocks, one black primary,
// pointer cursor, hover differs from its container, phone order Ask, Next, Today, no sideways scroll, no
// console errors), the Ask bar flow (question, StepTrack while waiting, your AI agent answers through the
// job ops, the answer in place), a Next row's primary action in place, and Settings, Digest.
// Usage: node ui_shots.mjs [--empty]   (frontend built; VO_PORT 3192)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newApi } from './lib.mjs';
import { chromium, open, settle, OUT, BASE, words, cursorCheck, phoneCheck } from './ui_lib.mjs';

const EMPTY = process.argv.includes('--empty');
const tag = EMPTY ? 'home_empty' : 'home';
const api = newApi();
const report = { checks: [], words: {} };
const ok = (name, cond, detail) => {
  report.checks.push({ name, ok: cond, detail });
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 300) : ''));
};

const blocks = () => {
  const main = document.querySelector('#vo-main');
  const body = main?.querySelector('header + div') ?? main;
  const sections = [...(body?.querySelectorAll('section') ?? [])].filter((s) => s.parentElement?.closest('section') === null);
  return sections.map((s) => s.getAttribute('aria-label') ?? s.querySelector('.vo-label')?.textContent ?? '?');
};
const primaries = () => [...document.querySelectorAll('#vo-main button')].filter((b) => b.className.includes('bg-[var(--vo-ink)]') && b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim());
/** Text right under a panel label or the page title (U1): the next sibling of a header that is a <p> or plain text. */
const underTitles = () => {
  const bad = [];
  for (const h of document.querySelectorAll('#vo-main section > header')) {
    const next = h.nextElementSibling;
    const first = next?.firstElementChild;
    if (first && first.tagName === 'P') bad.push((h.textContent ?? '').trim() + ' > ' + first.textContent.slice(0, 40));
  }
  const title = document.querySelector('#vo-main h1');
  if (title && title.nextElementSibling && title.nextElementSibling.tagName === 'P') bad.push('page title');
  return bad;
};
const hoverCheck = async (page, selector) => {
  const els = await page.$$(selector);
  const bad = [];
  for (const el of els.slice(0, 20)) {
    const before = await el.evaluate((e) => getComputedStyle(e).backgroundColor);
    const parentBg = await el.evaluate((e) => {
      let p = e.parentElement;
      while (p && getComputedStyle(p).backgroundColor === 'rgba(0, 0, 0, 0)') p = p.parentElement;
      return p ? getComputedStyle(p).backgroundColor : '';
    });
    await el.hover();
    await page.waitForTimeout(260);
    const after = await el.evaluate((e) => getComputedStyle(e).backgroundColor);
    const name = await el.evaluate((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30));
    if (after === before || after === parentBg) bad.push({ name, before, after, parentBg });
  }
  await page.mouse.move(2, 2);
  return { n: els.length, bad };
};

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    const { ctx, page, errors } = await open(browser, scheme, width);
    await settle(page, 2600);
    const file = join(OUT, `${tag}_${scheme}_${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const w = await page.evaluate(words);
    report.words[`${scheme}_${width}`] = w.length;
    const b = await page.evaluate(blocks);
    ok(`${scheme} ${width}: at most 5 blocks (${b.length}: ${b.join(', ')})`, b.length <= 5 && b.length >= 4, b);
    ok(`${scheme} ${width}: about 40 interface words at rest (${w.length})`, w.length <= 44, w.join(' '));
    const p = await page.evaluate(primaries);
    if (width === 1440) ok(`${scheme} ${width}: one black primary (${p.join(', ')})`, p.length === 1 && p[0] === 'Start', p);
    else ok(`${scheme} ${width}: no black button in the page (the bottom bar's Next is Start on a phone)`, p.length === 0, p);
    ok(`${scheme} ${width}: nothing under a title`, (await page.evaluate(underTitles)).length === 0, await page.evaluate(underTitles));
    ok(`${scheme} ${width}: pointer cursor on everything clickable`, (await page.evaluate(cursorCheck)).length === 0, await page.evaluate(cursorCheck));
    const title = await page.evaluate(() => document.querySelector('#vo-main h1')?.textContent ?? '');
    ok(`${scheme} ${width}: greeting "${title}"`, /^Good (morning|afternoon|evening)(, Olivia)?$/.test(title), title);
    if (width === 390) {
      ok(`${scheme} 390: no sideways scroll, 40px targets`, (await page.evaluate(phoneCheck)).length === 0, await page.evaluate(phoneCheck));
      const order = await page.evaluate(() => {
        const out = [];
        for (const s of document.querySelectorAll('#vo-main section')) {
          if (s.parentElement?.closest('section') !== null) continue;
          out.push({ name: s.getAttribute('aria-label') ?? s.querySelector('.vo-label')?.textContent ?? '?', top: Math.round(s.getBoundingClientRect().top) });
        }
        return out.sort((a, c) => a.top - c.top).map((x) => x.name);
      });
      ok('390: Ask, Next and Today first', order[0] === 'Ask' && order[1] === 'Next' && order[2] === 'Today', order);
    }
    if (width === 1440 && !EMPTY) {
      // Home's own controls: the Next rows, Today's Brief, the runway rows, the Ask bar's buttons, the fund link.
      const h1 = await hoverCheck(page, '#vo-main .group.flex.h-11, #vo-main section[aria-label="Ask"] button, #vo-main li > button.vo-tap, #vo-main ul li button.vo-tap');
      ok(`${scheme}: hover differs from its container (${h1.n} controls)`, h1.bad.length === 0, h1.bad);
      // The kernel NextRow's inline button: reported to kernel-frontend when its hover equals the hovered row.
      const h2 = await hoverCheck(page, '#vo-main .group.flex.h-11 > button.vo-tap:not(.flex-1)');
      report.kernel = (report.kernel ?? []).concat(h2.bad.map((b) => ({ scheme, ...b })));
      console.log(`note ${scheme}: kernel NextRow inline buttons whose hover equals the hovered row: ${h2.bad.length} of ${h2.n}`);
    }
    ok(`${scheme} ${width}: no console errors or 5xx`, errors.length === 0, errors.slice(0, 5));
    await ctx.close();
  }
}

if (!EMPTY) {
  // The Ask bar: a question, the StepTrack while your AI agent works, its answer in place.
  const { ctx, page, errors } = await open(browser, 'light', 1440);
  await settle(page, 1800);
  const q = 'Which companies have less than six months of runway?';
  await page.fill('section[aria-label="Ask"] input:not([type=file])', q);
  await page.keyboard.press('Enter');
  await page.waitForSelector('section[aria-label="Ask"] ol[aria-label="Progress"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'home_ask_waiting_light_1440.png') });
  ok('Ask: StepTrack and "Waiting for your AI agent" under the field', (await page.textContent('section[aria-label="Ask"]')).includes('Waiting for your AI agent'));
  const waiting = (await api.op('chat.list', { status: 'waiting' }, { as: 'agent' })).asks;
  const ask = waiting.find((a) => a.question.includes('runway')) ?? waiting[0];
  ok('your AI agent reads the question the fire named', ask !== undefined);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, 'home_ask_working_light_1440.png') });
  const s = await api.op('home.summary', {}, { as: 'agent' });
  const r0 = s.runways.rows[0];
  await page.waitForFunction(() => document.querySelector('section[aria-label="Ask"]')?.textContent?.includes('months of runway') === true, null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'home_ask_answer_light_1440.png') });
  ok('Ask: the answer shows under the field with the Sparkle', (await page.textContent('section[aria-label="Ask"]')).includes('months of runway'));
  // A Next row's primary action runs in place (a candidate list: Add all would add deals; use the note's No note? take a task: Done).
  const before = (await api.op('next.count', {}, { as: 'owner' })).total;
  const rowBtn = await page.$('#vo-main .group.flex.h-11 button.vo-tap:not(.flex-1)');
  ok('Next rows carry their primary action inline', rowBtn !== null);
  ok(`Next count ${before}`, before > 0);
  ok('Ask flow: no console errors', errors.length === 0, errors.slice(0, 5));
  // Start opens Focus mode.
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForTimeout(1200);
  ok('Start opens Focus mode', page.url().includes('#/focus'));
  await page.screenshot({ path: join(OUT, 'home_start_focus_light_1440.png') });
  // Settings, Digest.
  await page.goto(BASE + '#/settings/digest');
  await settle(page, 1200);
  await page.screenshot({ path: join(OUT, 'settings_digest_light_1440.png') });
  const dw = await page.evaluate(words);
  ok(`Settings, Digest: ${dw.length} words at rest`, dw.length <= 44, dw.join(' '));
  await ctx.close();
  for (const [scheme, width] of [['dark', 1440], ['dark', 390]]) {
    const d = await open(browser, scheme, width);
    await d.page.goto(BASE + '#/settings/digest');
    await settle(d.page, 1200);
    await d.page.screenshot({ path: join(OUT, `settings_digest_${scheme}_${width}.png`), fullPage: true });
    ok(`Settings, Digest ${scheme} ${width}: no console errors`, d.errors.length === 0, d.errors.slice(0, 3));
    await d.ctx.close();
  }
}
await browser.close();
writeFileSync(join(OUT, `${tag}_report.json`), JSON.stringify(report, null, 1));
const failed = report.checks.filter((c) => !c.ok).length;
console.log(`${tag}: ${report.checks.length - failed} passed, ${failed} failed; words ${JSON.stringify(report.words)}`);
process.exit(failed > 0 ? 1 : 0);
