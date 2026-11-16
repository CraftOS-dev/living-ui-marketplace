// Empty database: the setup wizard, screenshot each step, then create the company (owner, PIN 246810).
import { BASE, OUT, chromium, open, settle } from './lib.mjs';
const browser = await chromium.launch({ headless: true });
// The first two steps on a phone, light and dark (nothing is created).
for (const scheme of ['light', 'dark']) {
  const v = await open(browser, { width: 390, height: 844, scheme, mobile: true });
  await v.page.goto(BASE);
  await v.page.waitForSelector('text=Your company', { timeout: 20000 });
  await settle(v.page, 400);
  await v.page.screenshot({ path: `${OUT}/setup_1_${scheme}_390.png` });
  await v.page.fill('input[aria-label="Company name"]', 'Northwind Trading');
  await v.page.getByRole('button', { name: 'Continue' }).click();
  await v.page.waitForSelector('text=Where it employs people');
  await settle(v.page, 300);
  await v.page.screenshot({ path: `${OUT}/setup_2_${scheme}_390.png`, fullPage: true });
  if (v.errors.length > 0) console.log('phone errors', v.errors.join(' | '));
  await v.ctx.close();
}
const { page, errors } = await open(browser, { width: 1440, height: 900, scheme: 'dark' });
await page.goto(BASE);
await page.waitForSelector('text=Your company', { timeout: 20000 });
await settle(page);
await page.screenshot({ path: `${OUT}/setup_1_dark_1440.png` });
await page.fill('input[aria-label="Company name"]', 'Northwind Trading');
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForSelector('text=Where it employs people');
await page.getByRole('option', { name: /Singapore/ }).click();
await settle(page, 300);
await page.screenshot({ path: `${OUT}/setup_2_dark_1440.png` });
await page.getByRole('button', { name: 'Continue' }).click();
await page.fill('input[aria-label="Given name"]', 'Mei Lin');
await page.fill('input[aria-label="Family name"]', 'Tan');
await page.fill('input[type=email]', 'owner@northwind.test');
await page.fill('input[type=password]', 'owner-pass-1');
const pins = page.locator('input[inputmode=numeric]');
await pins.nth(0).fill('246810');
await pins.nth(1).fill('246810');
await page.screenshot({ path: `${OUT}/setup_3_dark_1440.png` });
await page.getByRole('button', { name: 'Create the company' }).click();
await page.waitForSelector('text=Your recovery code', { timeout: 20000 });
await page.screenshot({ path: `${OUT}/setup_4_dark_1440.png` });
await page.getByRole('checkbox', { name: 'I saved the code' }).click();
await page.getByRole('button', { name: 'Open HR OS' }).click();
await page.waitForSelector('nav[aria-label="Main"]', { timeout: 20000 });
await settle(page, 1200);
await page.screenshot({ path: `${OUT}/after_setup_dark_1440.png` });
console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
