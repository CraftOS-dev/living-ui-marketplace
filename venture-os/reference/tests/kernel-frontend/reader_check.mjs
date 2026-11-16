// The one citation reader on the merged app with a module's reader registered (scratch: diligence's, through
// its `reader` export): an anchor-only link #/source?anchor=<id> resolves the file, page and quote and opens
// the reader at the marked passage; #/source?file=&page= opens the page; light and dark at 1440 and 390.
// Needs a database with a deal room PDF (committee's or diligence's seed). EMAIL / PASSWORD as merged_audit.mjs.
import { BASE, chromium, op, open, settle, shot, signIn } from './lib.mjs';

const EMAIL = process.env.EMAIL ?? 'owner@venture.test';
const PASSWORD = process.env.PASSWORD ?? 'demo-pass-1';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ' (' + detail + ')' : ''}`);
};

const tok = (await op('auth.login', { email: EMAIL, password: PASSWORD })).token;
const deals = (await op('deals.list', { limit: 50 }, { as: tok })).deals ?? [];
let pdf;
for (const d of deals) {
  const files = (await op('files.list', { deal: d.id, limit: 50 }, { as: tok })).files ?? [];
  pdf = files.find((f) => /\.pdf$/i.test(f.name ?? ''));
  if (pdf !== undefined) break;
}
if (pdf === undefined) {
  console.log('no PDF in the database; seed a module first');
  process.exit(1);
}
const text = await op('files.text', { file: pdf.id, from: 1, to: 1 }, { as: tok });
const page1 = (text.pages ?? [])[0];
const line = (page1?.lines ?? []).map((l) => (Array.isArray(l) ? String(l[3] ?? '') : String(l))).find((l) => l.trim().length > 12) ?? '';
const anchor = (await op('anchors.create', { file: pdf.id, page: 1, quote: line.trim() }, { as: tok })).anchor;
check('an anchor on the first page of a room PDF', anchor?.id !== undefined, `${pdf.name}: "${line.trim().slice(0, 40)}"`);

const browser = await chromium.launch({ headless: true });
for (const [scheme, width] of [
  ['light', 1440],
  ['dark', 390],
]) {
  const { page, errors, ctx } = await open(browser, { scheme, width, height: width < 768 ? 844 : 900, mobile: width < 768 });
  await signIn(page, EMAIL, PASSWORD);
  await page.goto(BASE + '#/source?anchor=' + encodeURIComponent(anchor.id));
  await page.waitForSelector('[role=dialog][aria-label=Source]', { timeout: 10000 }).catch(() => undefined);
  await settle(page, 1500);
  check(`#/source?anchor= opens the reader (${scheme} ${width})`, (await page.locator('[role=dialog][aria-label=Source]').count()) === 1);
  check(`the passage is marked (${scheme} ${width})`, (await page.locator('[data-mark], mark').count()) > 0);
  await shot(page, `reader_anchor_${scheme}_${width}`);
  await page.keyboard.press('Escape');
  await page.goto(BASE + '#/source?file=' + encodeURIComponent(pdf.id) + '&page=1');
  await page.waitForSelector('[role=dialog][aria-label=Source]', { timeout: 10000 }).catch(() => undefined);
  await settle(page, 1000);
  check(`#/source?file=&page= opens the page (${scheme} ${width})`, (await page.locator('[role=dialog][aria-label=Source]').count()) === 1);
  check(`no console errors or 5xx (${scheme} ${width})`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
const fails = results.filter((r) => !r).length;
console.log(fails === 0 ? `reader ok (${results.length} checks)` : `${fails} of ${results.length} checks failed`);
process.exit(fails === 0 ? 0 : 1);
