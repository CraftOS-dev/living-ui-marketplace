// Empty database: the four setup steps (Firm, Fund, You, PIN) in light and dark at 1440 and 390,
// then setup completes once, the recovery code shows once, and the shell opens.
import { BASE, OWNER, chromium, open, settle, shot } from './lib.mjs';

const combos = [
  ['light', 1440],
  ['dark', 1440],
  ['dark', 390],
  ['light', 390],
];
const browser = await chromium.launch({ headless: true });
let fails = 0;
for (let c = 0; c < combos.length; c++) {
  const [scheme, width] = combos[c];
  const last = c === combos.length - 1;
  const { page, errors, ctx } = await open(browser, { scheme, width, height: width < 768 ? 844 : 900, mobile: width < 768 });
  await page.goto(BASE);
  await page.waitForSelector('text=Your firm', { timeout: 15000 });
  await settle(page, 400);
  const tag = `${scheme}_${width}`;
  await shot(page, `setup_1_firm_${tag}`);
  await page.fill('input[aria-label="Firm name"]', 'Harbor Ventures');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('text=First fund');
  await page.fill('input[aria-label="Fund size"]', '50m');
  await settle(page, 200);
  await shot(page, `setup_2_fund_${tag}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('h1:has-text("You")');
  await page.fill('input[aria-label="Your name"]', OWNER.name);
  await page.fill('input[aria-label="Email"]', OWNER.email);
  await page.fill('input[aria-label="Password"]', OWNER.password);
  await shot(page, `setup_3_you_${tag}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('text=Approval PIN');
  await page.locator('input[aria-label="PIN"]').fill(OWNER.pin);
  await page.locator('input[aria-label="PIN again"]').fill(OWNER.pin);
  await settle(page, 200);
  await shot(page, `setup_4_pin_${tag}`);
  if (last) {
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.waitForSelector('text=Recovery code', { timeout: 15000 });
    const code = await page.locator('code').textContent();
    if (!/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test((code ?? '').trim())) {
      fails++;
      console.log('recovery code shape wrong:', code);
    }
    await shot(page, `setup_5_code_${tag}`);
    await page.getByRole('button', { name: 'Open Venture OS' }).click();
    await page.waitForSelector('#vo-main', { timeout: 15000 });
    await settle(page);
    await shot(page, `setup_6_open_${tag}`);
  }
  if (errors.length > 0) {
    fails += errors.length;
    console.log(tag, errors);
  }
  await ctx.close();
}
await browser.close();
console.log(fails === 0 ? 'setup ok' : `${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
