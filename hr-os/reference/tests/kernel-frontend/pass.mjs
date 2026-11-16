// Screenshot pass: every kernel page for one person, light and dark, 1440 and 390 wide.
//   node pass.mjs <label> <email> <password> [pages...]
// Prints the console errors per page; exits 1 when there are any.
import { BASE, OUT, chromium, open, settle, signIn } from './lib.mjs';

const [label = 'owner', email = 'owner@northwind.test', password = 'owner-pass-1', ...rest] = process.argv.slice(2);
const OWNER_PAGES = [
  'inbox',
  'inbox?view=proposals',
  'inbox?view=requests',
  'inbox?view=jobs',
  'people',
  'people/org',
  'people/new',
  'settings/company',
  'settings/entities',
  'settings/locations',
  'settings/org',
  'settings/calendars',
  'settings/schedules',
  'settings/approvals',
  'settings/members',
  'settings/roles',
  'settings/agent',
  'settings/data',
  'settings/audit',
  'settings/security',
  'settings/notifications',
];
const pages = rest.length > 0 ? rest : OWNER_PAGES;
const widths = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const schemes = (process.env.SCHEMES ?? 'light,dark').split(',');

const browser = await chromium.launch({ headless: true });
let bad = 0;
for (const scheme of schemes) {
  for (const w of widths) {
    const { ctx, page, errors } = await open(browser, { width: w, height: w < 500 ? 844 : 900, scheme, mobile: w < 500 });
    await signIn(page, email, password);
    for (const p of pages) {
      errors.length = 0;
      await page.goto(BASE + '#/' + p);
      await settle(page, 900);
      const name = `${label}_${p.replace(/[/?=&]/g, '_')}_${scheme}_${w}.png`;
      await page.screenshot({ path: `${OUT}/${name}`, fullPage: false });
      const own = errors.filter((e) => !/favicon/.test(e));
      if (own.length > 0) {
        bad += own.length;
        console.log(`${name}: ${own.join(' | ')}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(bad === 0 ? `ok: ${pages.length} pages x ${schemes.length * widths.length} views, no console errors` : `${bad} errors`);
process.exit(bad === 0 ? 0 : 1);
