// Screenshots of the pages the UI QA flagged, taken once each page has its data (no spinner,
// no skeleton), light at 1440 and 390, plus dark at 390 for the phone headers. Also clicks the
// phone "More" button on a page with several header actions, and turns Hide pay on for the profile.
// Usage: OUT=<dir> node qa_shots.mjs
import { BASE, OUT, chromium, open, signIn } from './lib.mjs';

const SHOTS = [
  ['home', [1440]],
  ['people', [1440, 390]],
  ['people/E0005', [1440, 390]],
  ['people/E0005?tab=job', [1440]],
  ['people/E0021', [1440]],
  ['people/new', [1440, 390]],
  ['people/org', [1440]],
  ['inbox', [1440, 390]],
  ['settings/org', [1440]],
  ['settings/entities', [1440]],
  ['time/attendance', [390]],
  ['payroll', [390]],
  ['payroll/components', [390]],
  ['hiring', [1440]],
];

async function ready(page) {
  await page.waitForFunction(() => {
    const m = document.getElementById('hr-main');
    return m !== null && m.innerText.trim().length > 30 && m.querySelector('.animate-spin, .hr-skel') === null;
  }, null, { timeout: 40000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

const browser = await chromium.launch({ headless: true });
for (const width of [1440, 390]) {
  const { ctx, page, errors } = await open(browser, { width, height: width === 390 ? 844 : 900, mobile: width === 390 });
  await signIn(page, 'owner@northwind.test', 'demo-pass-1');
  for (const [p, widths] of SHOTS) {
    if (!widths.includes(width)) continue;
    await page.evaluate((h) => (location.hash = h), '#/' + p);
    await ready(page);
    await page.screenshot({ path: `${OUT}/${p.replace(/[/?=]/g, '_')}_${width}.png` });
  }
  if (width === 390) {
    // The phone header's More menu on a page with several actions.
    await page.evaluate(() => (location.hash = '#/people/E0005'));
    await ready(page);
    const more = page.locator('#hr-main header').getByRole('button', { name: 'More', exact: true });
    if ((await more.count()) > 0) {
      await more.first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/people_E0005_more_390.png` });
    }
    // The drawer sidebar on a phone.
    await page.keyboard.press('Escape');
    await page.locator('#hr-main header').getByRole('button', { name: 'Menu' }).first().click().catch(() => undefined);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/drawer_390.png` });
  } else {
    // Hide pay on the profile: the figures are masked, not hidden text.
    await page.evaluate(() => (location.hash = '#/people/E0005'));
    await ready(page);
    await page.getByRole('button', { name: /Hide pay/ }).first().click().catch(() => undefined);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/people_E0005_hidepay_1440.png` });
    await page.getByRole('button', { name: /Show pay|Hide pay/ }).first().click().catch(() => undefined);
  }
  console.log(`${width}: ${errors.length === 0 ? 'no console errors' : errors.join(' | ')}`);
  await ctx.close();
}
await browser.close();
