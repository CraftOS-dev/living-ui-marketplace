// Hiring's accepted offer opens the kernel Hire page filled in, and the hire links the
// application back (from_application). Needs the demo seed plus hiring's seed (an offer
// waiting for approval) on the scratch server: reseed.sh hiring.
// Steps: HR approves the offer, the recruiter sends it and records "accepted"; the owner
// opens the offer, clicks Hire, checks every prefilled field, hires; the application is
// then hired with the new employment.
import { pathToFileURL } from 'node:url';
import { BASE, OUT, PORT, chromium, open, settle, signIn } from './lib.mjs';

const APP = process.env.HR_APP ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/kernel-frontend/app';
const { client } = await import(pathToFileURL(APP + '/tools/dev/api.mjs').href);
const api = client({ port: PORT, app: APP });
const HR = { as: 'hr@northwind.test' };
const REC = { as: 'rita@northwind.test' };
const fails = [];
const check = (ok, what, seen) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ' ' + JSON.stringify(seen)}`);
  if (!ok) fails.push(what);
};

// The seed's offer (pending approval) to accepted, through the operations.
const pending = (await api.op('offers.list', {}, REC)).offers.find((o) => o.status === 'pending');
if (pending === undefined) throw new Error('no offer waiting for approval: run reseed.sh hiring');
const ap = (await api.op('approvals.list', {}, HR)).approvals.find((a) => a.kind === 'offer');
await api.op('approvals.decide', { approval: ap.id, decision: 'approved' }, HR);
await api.op('offers.send', { offer: pending.id }, REC);
const acc = await api.op('offers.respond', { offer: pending.id, answer: 'accepted' }, REC);
const draft = acc.hire;
check(draft !== null && draft.from_application !== '', 'the accepted offer carries a hire draft', draft);

const browser = await chromium.launch({ headless: true });
const { ctx, page, errors } = await open(browser, { width: 1440, height: 900 });
await signIn(page, 'owner@northwind.test', 'demo-pass-1');
await page.evaluate((h) => (location.hash = h), '#/hiring/offers/' + pending.id);
// The offer's one next step: "Hire <name>" in its header.
const hireBtn = page.locator('#hr-main').getByRole('button', { name: /^Hire / }).first();
await hireBtn.waitFor({ timeout: 20000 });
await settle(page, 600);
await hireBtn.click();
await page.waitForFunction(() => location.hash.startsWith('#/people/new'), null, { timeout: 10000 });
await page.waitForSelector('#hr-main input[aria-label="Legal name"]', { timeout: 20000 });
await settle(page, 900);
await page.screenshot({ path: `${OUT}/hire_prefilled.png`, fullPage: true });

const hash = await page.evaluate(() => location.hash);
const q = new URLSearchParams(hash.slice(hash.indexOf('?') + 1));
check(q.get('from_application') === draft.from_application, 'the link carries from_application', hash);
const value = (label) => page.locator(`#hr-main input[aria-label="${label}"]`).first().inputValue();
check((await value('Legal name')) === draft.legal_name, 'legal name filled', await value('Legal name'));
check((await value('Personal email')) === draft.personal_email, 'personal email filled', await value('Personal email'));
check((await value('Title')) === draft.title, 'title filled', await value('Title'));
const seen = await page.evaluate(() => document.getElementById('hr-main')?.innerText ?? '');
check(seen.toLowerCase().includes('from an accepted offer'), 'the header says the form comes from the offer', seen.slice(0, 200));
const amount = await page.locator('#hr-main input[inputmode="decimal"]').first().inputValue();
check(amount.replace(/[^\d]/g, '') === String(draft.pay_amount).replace(/[^\d]/g, ''), 'pay amount filled', { amount, want: draft.pay_amount });
const startShown = await page.locator('#hr-main').getByText(new Date(draft.start_day + 'T00:00:00').getFullYear().toString()).count();
check(startShown > 0, 'start day shown', draft.start_day);

await page.locator('#hr-main').getByRole('button', { name: 'Hire', exact: true }).last().click();
await page.waitForFunction(() => /^#\/people\/E\d+/.test(location.hash), null, { timeout: 20000 }).catch(() => undefined);
const after = await page.evaluate(() => location.hash);
check(/^#\/people\/E\d+/.test(after), 'hired: the new profile opens', after);
await page.screenshot({ path: `${OUT}/hire_done.png` });

const appl = (await api.op('applications.get', { application: draft.from_application }, REC)).application;
check(appl.status === 'hired' && typeof appl.hired_employment === 'string' && appl.hired_employment !== '', 'the application is hired with the new employment', { status: appl.status, hired_employment: appl.hired_employment });
const prof = await api.op('people.get', { employee: after.replace(/^#\/people\//, '').split('?')[0] }, { as: 'owner' });
const emp = (prof.employments ?? []).find((x) => x.id === appl.hired_employment);
check(emp !== undefined, 'that employment belongs to the new person', { hired_employment: appl.hired_employment, employments: (prof.employments ?? []).map((x) => x.id) });
check(errors.length === 0, 'no console errors', errors);

await ctx.close();
await browser.close();
console.log(fails.length === 0 ? 'ok: an accepted offer fills the Hire page and the hire links back to the application' : `${fails.length} failures`);
process.exit(fails.length === 0 ? 0 : 1);
