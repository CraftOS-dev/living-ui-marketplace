// UI pass for network's pages (playwright-core, headless Chromium): empty database first, then a seeded
// firm. Screenshots of every page and sheet in light and dark at 1440 and 390, interface word counts at
// rest, console errors and 5xx, the pointer cursor, a hover sweep, phone sideways scroll and 40px targets,
// and the flows by click: Who knows -> path -> Ask for intro (StepTrack in place), the Brief sheet from
// Today, the Focus card of a meeting without a note, consent in Settings.
// Build the frontend first (npm run build --prefix app/frontend). VO_PORT 3184.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentDo, DEMO, firm, fresh, newApi, PORT } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'shots');
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}/`;
const report = { pages: {}, errors: [], checks: [] };
const check = (name, ok, detail) => {
  report.checks.push({ name, ok, detail });
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : ''));
};

async function open(browser, scheme, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(BASE + '#/');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', DEMO.owner);
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('#vo-main', { timeout: 20000 });
  return { ctx, page, errors };
}

async function settle(page, ms = 800) {
  await page.waitForTimeout(400);
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelector('#vo-main .vo-skel, [role=dialog] .vo-skel') === null, null, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

const words = () => {
  const main = document.querySelector('#vo-main') ?? document.body;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const out = [];
  for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
    const el = t.parentElement;
    if (el === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('.vo-mono, [data-data], [role=row], [role=img], li, td, .vo-num') !== null) continue;
    for (const w of t.textContent.trim().split(/\s+/)) if (/[A-Za-z]/.test(w)) out.push(w);
  }
  return out;
};

const cursorCheck = () => {
  const sel = 'button:not(:disabled), a[href], [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=option]';
  const bad = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).cursor !== 'pointer') bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`);
  }
  return bad.slice(0, 10);
};

const phoneCheck = () => {
  const bad = [];
  const main = document.getElementById('vo-main');
  if (document.documentElement.scrollWidth > innerWidth + 1 || (main !== null && main.scrollWidth > main.clientWidth + 1)) bad.push(`sideways scroll ${Math.max(document.documentElement.scrollWidth, main?.scrollWidth ?? 0)}`);
  return bad;
};

/** Hover each visible button and link: its background (or colour) must change and differ from what is under it. */
async function hoverSweep(page, label) {
  const n = await page.evaluate(() => {
    let i = 0;
    for (const el of document.querySelectorAll('#vo-main button:not(:disabled), #vo-main a[href]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.top < 60 || r.bottom > innerHeight) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit === null || !(hit === el || el.contains(hit))) continue;
      el.setAttribute('data-hov', String(i++));
      if (i >= 40) break;
    }
    return i;
  });
  const same = [];
  for (let i = 0; i < n; i++) {
    const loc = page.locator(`[data-hov="${i}"]`);
    const sig = (el) => {
      const link = el.classList.contains('vo-link') ? el : el.querySelector('.vo-link');
      return [getComputedStyle(el).backgroundColor, getComputedStyle(el).color, getComputedStyle(el).borderColor, getComputedStyle(el).filter, getComputedStyle(el).textDecorationLine, link !== null ? getComputedStyle(link).textDecorationColor : ''].join('|');
    };
    const before = await loc.evaluate((el) => {
      const link = el.classList.contains('vo-link') ? el : el.querySelector('.vo-link');
      return [getComputedStyle(el).backgroundColor, getComputedStyle(el).color, getComputedStyle(el).borderColor, getComputedStyle(el).filter, getComputedStyle(el).textDecorationLine, link !== null ? getComputedStyle(link).textDecorationColor : ''].join('|');
    });
    void sig;
    await loc.hover({ force: true }).catch(() => undefined);
    await page.waitForTimeout(220);
    const after = await loc.evaluate((el) => {
      let parent = 'rgb(255, 255, 255)';
      for (let e = el.parentElement; e !== null; e = e.parentElement) {
        const b = getComputedStyle(e).backgroundColor;
        if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') {
          parent = b;
          break;
        }
      }
      const own = getComputedStyle(el).backgroundColor;
      const link = el.classList.contains('vo-link') ? el : el.querySelector('.vo-link');
      return { key: [own, getComputedStyle(el).color, getComputedStyle(el).borderColor, getComputedStyle(el).filter, getComputedStyle(el).textDecorationLine, link !== null ? getComputedStyle(link).textDecorationColor : ''].join('|'), own, parent, label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24), sel: el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page' };
    });
    if (after.key === before && !after.sel) same.push(after.label);
    else if (after.own !== 'rgba(0, 0, 0, 0)' && after.own === after.parent && !after.sel) same.push(after.label + ' (= container)');
  }
  check(`${label}: hover changes every control (${n} swept)`, same.length === 0, same);
  await page.mouse.move(0, 0);
}

async function visit(page, scheme, width, name, hash, opts = {}) {
  await page.goto(BASE + hash);
  await settle(page, opts.wait ?? 900);
  if (opts.before) await opts.before(page);
  const file = `${name}_${scheme}_${width}`;
  await page.screenshot({ path: join(OUT, file + '.png'), fullPage: true });
  if (scheme === 'light' && width === 1440) {
    const w = await page.evaluate(words);
    report.pages[name] = { words: w.length, sample: w.join(' ').slice(0, 400) };
    check(`${name}: ${w.length} interface words at rest (about 40 at most)`, w.length <= 48, w.join(' '));
    const cur = await page.evaluate(cursorCheck);
    check(`${name}: pointer cursor on everything clickable`, cur.length === 0, cur);
    const primaries = await page.locator('header[data-vo-chrome] button.bg-\\[var\\(--vo-ink\\)\\]').count();
    check(`${name}: at most one black primary in the header`, primaries <= 1, primaries);
  }
  if (width < 768) {
    const bad = await page.evaluate(phoneCheck);
    check(`${name} ${scheme} 390: no sideways scroll`, bad.length === 0, bad);
  }
}

/* ------------------------------------------------------------------ empty */

await fresh();
const api = newApi();
const { O, P, A } = await firm(api);
const browser = await chromium.launch({ headless: true });
for (const [scheme, width] of [
  ['light', 1440],
  ['dark', 390],
]) {
  const { ctx, page, errors } = await open(browser, scheme, width);
  await visit(page, scheme, width, 'empty_network', '#/network');
  await visit(page, scheme, width, 'empty_capture', '#/settings/capture');
  await visit(page, scheme, width, 'empty_today', '#/zz-today');
  check(`empty ${scheme} ${width}: no console errors or 5xx`, errors.length === 0, errors);
  await ctx.close();
}

/* ----------------------------------------------------------------- seeded */

await api.op('capture.consent', { consent: true, exclude_domains: '["family.example"]' }, O);
await api.op('capture.consent', { consent: true }, P);
const acme = (await api.op('companies.upsert', { name: 'Acme Robotics', domain: 'acmerobotics.ai', sector: 'Robotics' }, O)).company;
await api.op('deals.create', { company: acme.id }, P);
const orbit = (await api.op('companies.upsert', { name: 'Orbital Freight', domain: 'orbitalfreight.com' }, O)).company;
const od = await api.op('deals.create', { company: orbit.id }, O);
const fund = (await api.op('entities.list', { kind: 'fund' }, O)).entities[0];
const firmDay = (await api.op('auth.me', {}, O)).today;
await api.op('holdings.create-from-deal', { deal: (od.deal || od).id, override: true, fund: fund.id, instrument: 'safe_cap', amount: '400000', currency: 'USD', day: firmDay, cap: '12000000' }, O);
await api.op('capture.sync', {}, O);
await api.op('interactions.log', { kind: 'call', people: '["sara@foundry-capital.vc"]', subject: 'Fund news' }, P);
for (let i = 0; i < 6; i++) await api.op('interactions.log', { kind: 'email', direction: 'out', people: JSON.stringify([`founder${i}@startup${i}.example`]), subject: 'Hello' }, i % 2 === 0 ? O : P);
await api.op('network.recompute', {}, O);
// The brief of the soon meeting, written by your AI agent.
await agentDo(api, 'brief', async (job) => {
  await api.op('briefs.save', { brief: job.ref_id, sections: JSON.stringify({ who: [{ name: 'Maya Chen', email: 'maya@acmerobotics.ai', text: 'CEO and co-founder; ran warehouse automation at a 3PL for six years.' }, { name: 'Tomas Varga', email: 'tomas@acmerobotics.ai', text: 'CTO; robotics PhD, built the picking arm.' }], history: 'Seed deck received on 11 November; an intro call with Olivia the same week; no earlier pass.', deal: 'Sourced. Raising USD 3M on a post-money SAFE.', questions: ['Unit economics per arm at 50 sites?', 'Who are the first three paying customers?', 'How long is a pilot to contract?'], news: [{ title: 'Acme Robotics opens a Rotterdam pilot', url: 'https://example.com/acme-pilot', day: '2026-11-02', source: 'Example News' }] }) }, A);
  return { brief: job.ref_id };
});
const maya = (await api.op('network.people', { q: 'maya@acmerobotics.ai' }, O)).people[0];
const leo = (await api.op('network.people', { q: 'leo@orbitalfreight.com' }, O)).people[0];
// One intro already sent and one being drafted.
await api.op('intros.request', { target: leo.id, via: 'partner@venture.test', connector: 'sara@foundry-capital.vc' }, P);
await agentDo(api, 'intro_draft', async (job) => {
  const d = await api.op('intros.draft', { intro: job.ref_id, subject: 'Intro to Leo Okafor?', body: 'Hi Sara, would you introduce Paul to Leo?\n\nPaul Partner at Northwind Ventures backs logistics software.' }, A);
  return { outbound: d.draft.id };
});
const notes = await api.op('next.list', { kinds: 'note' }, O);
const noteKey = notes.items[0]?.key ?? '';
const today = await api.op('calendar.list', { days: 2 }, O);
const soon = today.events.find((e) => e.title === 'Acme Robotics first meeting');

for (const [scheme, width] of [
  ['light', 1440],
  ['dark', 1440],
  ['light', 390],
  ['dark', 390],
]) {
  const { ctx, page, errors } = await open(browser, scheme, width);
  await visit(page, scheme, width, 'network', '#/network');
  await visit(page, scheme, width, 'network_companies', '#/network?tab=companies');
  await visit(page, scheme, width, 'network_paths', '#/network?company=' + orbit.id);
  await visit(page, scheme, width, 'company', '#/companies/' + acme.id);
  await visit(page, scheme, width, 'company_network', '#/companies/' + orbit.id + '?tab=network');
  await visit(page, scheme, width, 'person', '#/people/' + maya.id);
  await visit(page, scheme, width, 'person_network', '#/people/' + leo.id + '?tab=network');
  await visit(page, scheme, width, 'capture', '#/settings/capture');
  await visit(page, scheme, width, 'today', '#/zz-today');
  if (soon) await visit(page, scheme, width, 'brief_sheet', '#/zz-today?event=' + soon.id, { wait: 1200 });
  await visit(page, scheme, width, 'brief_waiting', '#/zz-today', {
    before: async (pg) => {
      const b = pg.getByRole('button', { name: /Brief/ }).first();
      if ((await b.count()) === 0) return;
      await b.click();
      await pg.waitForSelector('[role=dialog][aria-label=Brief]', { timeout: 8000 });
      await pg.waitForTimeout(1200);
    },
  });
  if (noteKey !== '') await visit(page, scheme, width, 'focus_note', '#/focus?at=' + encodeURIComponent(noteKey), { wait: 1200 });
  if (scheme === 'light' && width === 1440) {
    // The portfolio tab of a held company is there on first render (network.record carries invested and holdings).
    await page.goto(BASE + '#/network');
    await settle(page, 300);
    await page.goto(BASE + '#/companies/' + orbit.id);
    await page.waitForSelector('[role=tablist][aria-label=Company] [role=tab]', { timeout: 15000 });
    const tabs = await page.locator('[role=tablist][aria-label=Company] [role=tab]').allTextContents();
    check('a held company shows its Portfolio tab on first render', tabs.some((t) => t.indexOf('Portfolio') >= 0), tabs);
    const rec = await api.op('network.record', { company: orbit.id }, O);
    check('network.record says invested with one holding', rec.invested === true && rec.holdings === 1, rec);
    for (const h of ['#/network', '#/companies/' + acme.id, '#/settings/capture']) {
      await page.goto(BASE + h);
      await settle(page, 900);
      await hoverSweep(page, h);
    }
  }
  check(`seeded ${scheme} ${width}: no console errors or 5xx`, errors.length === 0, errors);
  await ctx.close();
}

/* ------------------------------------------------------------------ flows */

{
  const { ctx, page, errors } = await open(browser, 'light', 1440);
  // Who knows: type, pick, the paths draw, Ask for intro asks in place.
  await page.goto(BASE + '#/network');
  await settle(page);
  await page.fill('input[aria-label="Who knows"]', 'Acme');
  await page.waitForSelector('[role=listbox] [role=option]', { timeout: 6000 });
  await page.locator('[role=listbox] [role=option]').first().locator('button').click();
  await settle(page, 1200);
  const radios = await page.locator('[role=radiogroup][aria-label=Paths] [role=radio]').count();
  check('Who knows: picking Acme draws its paths', radios >= 1, radios);
  await page.screenshot({ path: join(OUT, 'flow_paths_light_1440.png'), fullPage: true });
  const ask = page.locator('header[data-vo-chrome]').getByRole('button', { name: /Ask for intro|Reach out/ });
  const label = (await ask.textContent())?.trim();
  await ask.click();
  await page.waitForSelector('ol[aria-label=Progress]', { timeout: 8000 }).catch(() => undefined);
  const asked = await page.locator('ol[aria-label=Progress]').count();
  check('Ask for intro: the intro shows its StepTrack in place (' + label + ')', asked >= 1, asked);
  await page.screenshot({ path: join(OUT, 'flow_asked_light_1440.png'), fullPage: true });
  const disabled = await ask.isDisabled();
  check('asking twice is not offered while the intro is open', disabled === true);
  // Consent off and on in Settings.
  await page.goto(BASE + '#/settings/capture');
  await settle(page);
  const sw = page.getByRole('switch', { name: 'Capture my email and meetings' });
  await page.waitForTimeout(800);
  const before = await sw.getAttribute('aria-checked');
  await sw.click();
  await page.waitForFunction((b) => document.querySelector('[role=switch][aria-label="Capture my email and meetings"]')?.getAttribute('aria-checked') !== b, before, { timeout: 8000 }).catch(() => undefined);
  const after = await sw.getAttribute('aria-checked');
  check('the consent switch saves through capture.consent', before !== after, [before, after]);
  const st = await api.op('capture.status', {}, O);
  check('the owner is now ' + (st.me.consent ? 'on' : 'off'), String(st.me.consent) === after);
  await sw.click();
  await page.waitForTimeout(600);
  // The Focus note card: Skip clears it.
  if (noteKey !== '') {
    await page.goto(BASE + '#/focus?at=' + encodeURIComponent(noteKey));
    await settle(page, 1200);
    await page.getByRole('button', { name: 'No note' }).first().click();
    await page.waitForTimeout(1200);
    const left = await api.op('next.list', { kinds: 'note' }, O);
    check('No note in Focus clears the note item', !left.items.some((i) => i.key === noteKey));
  }
  check('flows: no console errors or 5xx', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok);
console.log(`\nui_shots: ${report.checks.length - failed.length} passed, ${failed.length} failed`);
process.exitCode = failed.length > 0 ? 1 : 0;
