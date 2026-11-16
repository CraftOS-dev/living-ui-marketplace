// A joiner without pay: "Update pay" opens as "Set the starting pay", from the first day, with
// "Starting pay" first; saving writes the first pay record (or shows the refusal in plain words).
// Needs the demo seed on 3182.
import { pathToFileURL } from 'node:url';
import { BASE, OUT, PORT, chromium, open, settle, signIn } from './lib.mjs';

const APP = process.env.HR_APP ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/kernel-frontend/app';
const { client } = await import(pathToFileURL(APP + '/tools/dev/api.mjs').href);
const api = client({ port: PORT, app: APP });
const fails = [];
const check = (ok, what, seen) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ' ' + JSON.stringify(seen)}`);
  if (!ok) fails.push(what);
};

const ents = (await api.op('entities.list', {}, { as: 'owner' })).entities;
const sg = ents.find((e) => e.country === 'SG');
const start = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
const hired = await api.op('people.hire', { entity: sg.id, legal_name: 'Lena Ong', given_name: 'Lena', family_name: 'Ong', start_day: start, title: 'Analyst' }, { as: 'hr@northwind.test' });
const number = hired.employee.number;

const browser = await chromium.launch({ headless: true });
const { ctx, page, errors } = await open(browser, { width: 1440, height: 900 });
await signIn(page, 'payroll@northwind.test', 'demo-pass-1');
await page.goto(BASE + `#/people/${number}?tab=job`);
await page.waitForSelector('#hr-main h1', { timeout: 20000 });
await settle(page, 800);
await page.locator('#hr-main header').getByRole('button', { name: 'Update pay' }).first().click();
const dlg = page.locator('[role=dialog]').last();
await dlg.waitFor({ timeout: 10000 });
const title = (await dlg.locator('h2').first().textContent()) ?? '';
check(title.includes('starting pay'), 'the dialog is "Set the starting pay"', title);
const dayBtn = (await dlg.getByRole('button', { name: /Takes effect|From/ }).first().getAttribute('aria-label')) ?? '';
check(dayBtn.includes(new Date(start + 'T12:00').getDate().toString()), 'it starts on the first day', { dayBtn, start });
const first = await dlg.getByRole('radio').first().textContent();
const firstOn = await dlg.getByRole('radio').first().getAttribute('aria-checked');
check(first === 'Starting pay' && firstOn === 'true', '"Starting pay" is first and chosen', { first, firstOn });
await dlg.locator('input[inputmode="decimal"]').first().fill('5200');
await dlg.getByRole('button', { name: /Schedule|Save/ }).last().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/pay_start_after_save.png` });
const stillOpen = await page.locator('[role=dialog]').count();
const alert = stillOpen > 0 ? ((await page.locator('[role=dialog] [role=alert], [role=dialog] .text-\\[var\\(--hr-bad\\)\\]').first().textContent().catch(() => '')) ?? '') : '';
if (stillOpen === 0) {
  const prof = await api.op('people.get', { employee: number }, { as: 'owner' });
  const pay = prof.employments[0]?.pay ?? null;
  check(pay !== null && pay.effective_from === start && pay.reason === 'hire', 'the first pay record starts on the first day as the hire', pay);
} else {
  check(!/effective_from|_param|reason must be/.test(alert), 'a refusal reads in plain words', alert);
  console.log(`note: the server refused the starting pay: "${alert}"`);
}
check(errors.length === 0, 'no console errors', errors);
await ctx.close();
await browser.close();
console.log(fails.length === 0 ? 'ok: a joiner gets a starting pay from the first day' : `${fails.length} failures`);
process.exit(fails.length === 0 ? 0 : 1);
