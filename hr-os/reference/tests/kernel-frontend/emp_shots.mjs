// Employee and JP views for the round 2 QA items: the employee Home and a claim on a phone (panel
// header actions), and a Japanese employee's Home and profile (JP date style, Tokyo days).
import { BASE, OUT, chromium, open, signIn } from './lib.mjs';
const browser = await chromium.launch({ headless: true });
async function shoot(email, pages, width) {
  const { ctx, page, errors } = await open(browser, { width, height: width < 768 ? 844 : 900, mobile: width < 768 });
  await signIn(page, email, 'demo-pass-1');
  for (const p of pages) {
    await page.evaluate((h) => (location.hash = h), '#/' + p);
    await page.waitForTimeout(450);
    await page.waitForFunction(() => { const m = document.getElementById('hr-main'); return m !== null && m.innerText.trim().length > 30 && m.querySelector('.animate-spin, .hr-skel') === null; }, null, { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${email.split('@')[0]}_${p.replace(/[/?=]/g, '_')}_${width}.png`, fullPage: width < 768 });
  }
  console.log(email, width, errors.length === 0 ? 'no console errors' : errors.slice(0, 2).join(' | '));
  await ctx.close();
}
await shoot('sam@northwind.test', ['home', 'expenses/mine', 'me'], 390);
await shoot('haruto@northwind.test', ['home', 'me', 'leave/me'], 1440);
await browser.close();
