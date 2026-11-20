// Settings > Funds LPA form on the merged app: Compounding (Compound | Simple) saves as pref_compounding, and
// every LPA key the form does not show comes back unchanged. EMAIL / PASSWORD sign in (default the modules' demo owner).
import { BASE, chromium, op, open, settle, signIn } from './lib.mjs';

const EMAIL = process.env.EMAIL ?? 'owner@venture.test';
const PASSWORD = process.env.PASSWORD ?? 'demo-pass-1';
let fails = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) fails++;
};

const tok = (await op('auth.login', { email: EMAIL, password: PASSWORD })).token;
const list = async () => (await op('entities.list', {}, { as: tok })).entities.filter((e) => e.kind !== 'management' && !e.archived);
const fund = (await list())[0];
if (fund === undefined) throw new Error('no fund to edit');
const before = { ...fund.lpa };
const want = before.pref_compounding === 'simple' ? 'Compound' : 'Simple';

const browser = await chromium.launch({ headless: true });
const { page, ctx, errors } = await open(browser, { width: 1440, height: 900 });
await signIn(page, EMAIL, PASSWORD);
await page.goto(BASE + '#/settings/funds');
await page.getByRole('row', { name: new RegExp(fund.name) }).first().click({ timeout: 20000 });
const group = page.getByRole('radiogroup', { name: 'Compounding' });
await group.waitFor({ timeout: 10000 });
check('Compounding shows in the open terms', await group.isVisible());
await group.getByRole('radio', { name: want }).click();
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForFunction(() => document.querySelector('[role="dialog"]') === null, null, { timeout: 15000 }).catch(() => undefined);
await settle(page, 600);
const after = (await list()).find((e) => e.id === fund.id).lpa;
check('pref_compounding saved', after.pref_compounding === want.toLowerCase(), `${before.pref_compounding} -> ${after.pref_compounding}`);
const changed = Object.keys(before).filter((k) => k !== 'pref_compounding' && k !== 'confirmed' && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
check('every other LPA key round-trips', changed.length === 0, changed.join(', '));
check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await ctx.close();
await browser.close();
console.log(fails === 0 ? 'lpa check: all passed' : `lpa check: ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
