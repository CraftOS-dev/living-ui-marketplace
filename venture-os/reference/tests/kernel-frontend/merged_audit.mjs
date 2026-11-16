// Theme and UX audits over the MERGED app (the kernel plus every module page in APP), on whatever data the
// database holds (a module's seed). Findings are grouped by the module that owns the page or component, so
// kernel-frontend fixes its own and reports the rest. EMAIL / PASSWORD sign in (default the modules' demo owner).
// MODE=theme|ux|all (default all).  APP=<app copy> PORT=<port> OUT=<dir> node merged_audit.mjs
import { BASE, OUT, chromium, open, settle, signIn, theme } from './lib.mjs';
import { bgUnder, cursorCheck, hoverTargets, phoneCheck, textCheck, tokenCheck, typeCheck } from './checks.mjs';

const EMAIL = process.env.EMAIL ?? 'owner@venture.test';
const PASSWORD = process.env.PASSWORD ?? 'demo-pass-1';
const MODE = process.env.MODE ?? 'all';
const PACKS = ['craftbot', 'normal', 'ocean', 'forest', 'pastel', 'glass', 'classic', 'velvet', 'ink', 'acid', 'blueprint', 'modern', 'brutalist', 'drafting', 'clay', 'atelier'];
const BASEPAGES = ['', 'focus', 'agent', 'committee', 'network', 'funds', 'funds/raise', 'portfolio', 'settings/firm', 'settings/funds', 'settings/fund_terms', 'settings/members', 'settings/diligence', 'settings/committee', 'settings/portfolio', 'settings/capture', 'settings/agent', 'settings/data', 'settings/security'];
// One record page of each kind, found from the landing pages' links.
const FOLLOW = [
  ['committee', /^#\/committee\/[^/?]+$/],
  ['network', /^#\/(companies|people)\/[^/?]+/],
  ['funds', /^#\/funds\/(?!raise)[^/?]+$/],
  ['portfolio', /^#\/portfolio\/(?!updates)[^/?]+$/],
];

function owner(path) {
  const p = path.replace(/^#?\/?/, '');
  if (p === '' || p.startsWith('focus') || p.startsWith('agent') || p.startsWith('source')) return 'kernel-frontend';
  if (p.startsWith('settings/')) {
    const s = p.slice(9);
    if (['firm', 'funds', 'members', 'agent', 'data', 'security'].includes(s)) return 'kernel-frontend';
    return { fund_terms: 'funds', diligence: 'diligence', committee: 'committee', portfolio: 'portfolio', capture: 'network' }[s] ?? s;
  }
  if (p.startsWith('companies') || p.startsWith('people')) return 'network';
  if (p.startsWith('compare')) return 'diligence';
  return p.split('/')[0];
}

const findings = [];
const note = (page, kind, list) => {
  for (const x of list) findings.push({ module: owner(page), page: '/' + page, kind, x });
};

const browser = await chromium.launch({ headless: true });
const { page, ctx, errors: pageErrors } = await open(browser, { width: 1440, height: 900 });
await signIn(page, EMAIL, PASSWORD);
const pages = process.env.PAGES !== undefined ? process.env.PAGES.split(',') : [...BASEPAGES];
if (process.env.PAGES !== undefined) FOLLOW.length = 0;
for (const [from, re] of FOLLOW) {
  await page.goto(BASE + '#/' + from);
  await settle(page, 900);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('#vo-main a[href^="#/"]')].map((a) => a.getAttribute('href')));
  const hit = hrefs.find((h) => re.test(h ?? ''));
  if (hit) pages.push(hit.replace(/^#\//, ''));
}
// Pages the Next items point at (a grid, a record), one per route shape, only where a route exists.
{
  const known = /^#\/(compare|committee|companies|people|funds|portfolio|next)\//;
  const hrefs = await page.evaluate(async () => {
    const r = await fetch('/api/ops/next/list?limit=100', { headers: { Authorization: localStorage.getItem('vo.session') ?? '' } });
    const j = await r.json();
    return (j.items ?? []).map((i) => i.href).filter((h) => typeof h === 'string');
  });
  const shapes = new Set();
  for (const h of hrefs) {
    if (!known.test(h)) continue;
    const shape = h.replace(/\/[^/?]+(\?.*)?$/, '');
    if (shapes.has(shape)) continue;
    shapes.add(shape);
    pages.push(h.replace(/^#\//, ''));
  }
}
console.log('pages:', pages.join(' '));

if (MODE === 'all' || MODE === 'theme') {
  for (const p of pages) {
    const before = pageErrors.length;
    await page.goto(BASE + '#/' + p);
    await settle(page, 900);
    note(p, 'console', pageErrors.slice(before));
    for (const pack of PACKS) {
      for (const mode of ['light', 'dark']) {
        await theme(page, pack, mode);
        await page.waitForTimeout(260);
        if (p === pages[0]) note(p, `tokens ${pack}/${mode}`, await page.evaluate(tokenCheck));
        note(p, `contrast ${pack}/${mode}`, await page.evaluate(textCheck));
      }
    }
    await theme(page, 'craftbot', 'light');
  }
}
await ctx.close();

if (MODE === 'all' || MODE === 'ux') {
  for (const scheme of ['light', 'dark']) {
    const { ctx: c2, page: pg } = await open(browser, { width: 1440, height: 900, scheme });
    await signIn(pg, EMAIL, PASSWORD);
    for (const p of pages) {
      await pg.goto(BASE + '#/' + p);
      await settle(pg, 800);
      if (scheme === 'light') note(p, 'type', await pg.evaluate(typeCheck));
      note(p, `cursor ${scheme}`, await pg.evaluate(cursorCheck));
      const ids = await pg.evaluate(hoverTargets);
      const flat = [];
      for (const i of ids) {
        const before = await pg.evaluate(bgUnder, i);
        if (before === null) continue;
        await pg.hover(`[data-hov="${i}"]`, { timeout: 1500 }).catch(() => undefined);
        await pg.waitForTimeout(210);
        const after = await pg.evaluate(bgUnder, i);
        if (after === null) continue;
        const changed = before.sel || after.own !== before.own || after.color !== before.color || after.border !== before.border || after.filter !== before.filter || after.deco !== before.deco || after.row !== before.row || after.icon !== before.icon;
        if (!changed) flat.push(`no hover "${before.label}"`);
        if (after.own !== 'rgba(0, 0, 0, 0)' && after.own !== before.own && after.own === after.parent) flat.push(`hover equals surface "${before.label}"`);
      }
      await pg.mouse.move(1, 1);
      note(p, `hover ${scheme}`, flat);
    }
    await c2.close();
  }
  const { ctx: c3, page: ph } = await open(browser, { width: 390, height: 844, mobile: true });
  await signIn(ph, EMAIL, PASSWORD);
  for (const p of pages) {
    await ph.goto(BASE + '#/' + p);
    await settle(ph, 800);
    note(p, 'phone', await ph.evaluate(phoneCheck));
  }
  await c3.close();
}
await browser.close();

const by = {};
for (const f of findings) (by[f.module] ??= []).push(f);
for (const [m, list] of Object.entries(by)) {
  console.log(`\n== ${m}: ${list.length}`);
  const seen = new Set();
  for (const f of list) {
    const line = `${f.page} ${f.kind}: ${f.x}`;
    const key = `${f.page} ${f.kind.replace(/ \S+\/(light|dark)$/, '')} ${f.x}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log('  ' + line);
  }
}
const mine = (by['kernel-frontend'] ?? []).length;
console.log(`\n${findings.length} findings (${mine} kernel-frontend) over ${pages.length} pages`);
process.exit(mine === 0 ? 0 : 1);
