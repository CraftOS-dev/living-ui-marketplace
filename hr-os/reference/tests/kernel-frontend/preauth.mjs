// The screens before the app: sign in, recovery, invite (light and dark, 1440 and 390), with console errors.
import { BASE, OUT, chromium, open, settle } from './lib.mjs';

const browser = await chromium.launch({ headless: true });
let bad = 0;
for (const scheme of ['light', 'dark']) {
  for (const w of [1440, 390]) {
    const { ctx, page, errors } = await open(browser, { width: w, height: w < 500 ? 844 : 900, scheme, mobile: w < 500 });
    await page.goto(BASE + '#/home');
    await page.waitForSelector('input[type=email]');
    await settle(page, 500);
    await page.screenshot({ path: `${OUT}/signin_${scheme}_${w}.png` });
    await page.fill('input[type=email]', 'owner@northwind.test');
    await page.fill('input[type=password]', 'wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await page.waitForSelector('text=do not match', { timeout: 8000 });
    await page.screenshot({ path: `${OUT}/signin_wrong_${scheme}_${w}.png` });
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await page.waitForSelector('text=Use your recovery code');
    await page.screenshot({ path: `${OUT}/recover_${scheme}_${w}.png` });
    await page.goto(BASE + '#/invite?email=new%40northwind.test&code=ABCDE-FGHJK');
    await page.waitForSelector('text=Join your team');
    await settle(page, 300);
    await page.screenshot({ path: `${OUT}/invite_${scheme}_${w}.png` });
    // The 401 is the deliberate wrong password.
    const own = errors.filter((e) => !/status of 401/.test(e));
    if (own.length > 0) {
      bad += own.length;
      console.log(scheme, w, own.join(' | '));
    }
    await ctx.close();
  }
}
await browser.close();
console.log(bad === 0 ? 'ok: sign in, recovery, invite x 4 views, no console errors' : `${bad} errors`);
process.exit(bad === 0 ? 0 : 1);
