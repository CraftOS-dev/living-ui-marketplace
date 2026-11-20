// UX audit (HR OS's, adapted): the type scale (10.5 mono labels, 12, 13, 14, 15, 26), a pointer cursor
// on everything clickable, a hover sweep in light and dark (the hover differs from the surface under it
// and is never equal to it), and a phone pass at 390 (40px targets, nothing hover-only, no sideways
// scroll, a long word does not widen the page).
import { BASE, OUT, chromium, open, settle, signIn } from './lib.mjs';
import { bgUnder, cursorCheck, hoverTargets, phoneCheck, typeCheck } from './checks.mjs';

const PAGES = ['', 'focus', 'agent', 'gallery', 'settings/firm', 'settings/funds', 'settings/members', 'settings/agent', 'settings/data', 'settings/security'];






const browser = await chromium.launch({ headless: true });
let fails = 0;
for (const scheme of ['light', 'dark']) {
  const { ctx, page } = await open(browser, { width: 1440, height: 900, scheme });
  await signIn(page);
  for (const p of PAGES) {
    await page.goto(BASE + '#/' + p);
    await settle(page, 800);
    if (scheme === 'light') {
      const ty = await page.evaluate(typeCheck);
      if (ty.length > 0) {
        fails += ty.length;
        console.log(`type /${p}: ${ty.slice(0, 8).join('; ')}`);
      }
    }
    const c = await page.evaluate(cursorCheck);
    if (c.length > 0) {
      fails += c.length;
      console.log(`cursor /${p} ${scheme}: ${c.join('; ')}`);
    }
    const ids = await page.evaluate(hoverTargets);
    const flat = [];
    for (const i of ids) {
      const before = await page.evaluate(bgUnder, i);
      if (before === null) continue;
      await page.hover(`[data-hov="${i}"]`, { timeout: 1500 }).catch(() => undefined);
      await page.waitForTimeout(210);
      const after = await page.evaluate(bgUnder, i);
      if (after === null) continue;
      const changed = before.sel || after.own !== before.own || after.color !== before.color || after.border !== before.border || after.filter !== before.filter || after.deco !== before.deco || after.row !== before.row || after.icon !== before.icon;
      const sameAsSurface = after.own !== 'rgba(0, 0, 0, 0)' && after.own !== before.own && after.own === after.parent;
      if (!changed) flat.push(`no hover "${before.label}"`);
      if (sameAsSurface) flat.push(`hover equals surface "${before.label}"`);
    }
    await page.mouse.move(1, 1);
    if (flat.length > 0) {
      fails += flat.length;
      console.log(`hover /${p} ${scheme}: ${flat.slice(0, 8).join('; ')}`);
    }
  }
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, { width: 390, height: 844, mobile: true });
  await signIn(page);
  for (const p of PAGES) {
    await page.goto(BASE + '#/' + p);
    await settle(page, 800);
    const b = await page.evaluate(phoneCheck);
    if (b.length > 0) {
      fails += b.length;
      console.log(`phone /${p}: ${b.join('; ')}`);
    }
  }
  await page.goto(BASE + '#/agent');
  await settle(page, 600);
  await page.fill('textarea[aria-label="Tell your AI agent"]', 'company_accelerator_program_application_filling_data_folder_with_a_very_long_name');
  await page.waitForTimeout(200);
  const wide = await page.evaluate(() => document.getElementById('vo-main')?.scrollWidth ?? 0);
  if (wide > 391) {
    fails++;
    console.log(`phone long word widens the page to ${wide}`);
  }
  await page.screenshot({ path: `${OUT}/ux_phone_longword.png` });
  await ctx.close();
}
await browser.close();
console.log(fails === 0 ? `ux ok: type scale, cursor, hover (light, dark) and phone checks pass on ${PAGES.length} pages` : `${fails} findings`);
process.exit(fails === 0 ? 0 : 1);
