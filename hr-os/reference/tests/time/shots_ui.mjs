// After shots of the UI round (QA's time findings), on the seeded scratch copy:
//   T8 clock out on a day a locked pay run used (employee, 390)
//   T1 the clock right after the tap, then the toast with Undo (employee, 390)
//   T2 attendance today by time of day (owner, 1440)
//   T4 time settings (owner, 1440)
//   T5 a member without an employee record on the time pages (no failed request)
//   adjustments in the day sheet of a changed locked day (HR, 1440)
// Before shots are QA's (qa-ui/shots), copied next to these as ui_before_*.
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { DEMO, newApi, dayAdd } from './lib.mjs';

const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');
const PORT = Number(process.env.HR_PORT ?? 3183);
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/time/shots/ui';
const QA = 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/qa-ui/shots/';
mkdirSync(OUT, { recursive: true });
for (const [from, to] of [
  ['journeys/emp_clockout_b_390.png', 'ui_before_T8_clockout_locked_390.png'],
  ['journeys/emp_clockin_done_390.png', 'ui_before_T1_clockin_390.png'],
  ['seed/owner/owner_time_light_1440.png', 'ui_before_T2_board_1440.png'],
  ['seed/owner/owner_time_settings_light_1440.png', 'ui_before_T4_settings_1440.png'],
  ['empty/employee/employee_time_light_1440.png', 'ui_before_T5_no_record_1440.png'],
]) {
  try {
    copyFileSync(QA + from, OUT + '/' + to);
  } catch {
    console.log('no QA shot ' + from);
  }
}

const api = newApi();
const HR = { as: 'hr@northwind.test' };
const PIN = { as: 'owner', pin: true };
const me = await api.op('attendance.board', {}, HR);
const today = me.today;
// A member without an employee record (T5).
const email = 'norecord@northwind.test';
const inv = await api.call('members.invite', { email, name: 'Noor Record', role: 'employee' }, PIN);
if (inv.status === 200) {
  const joined = await api.op('auth.accept-invite', { email, code: inv.body.code, password: DEMO.password });
  api.setToken(email, joined.token);
}
// T8: payroll locked the month through today; Sam can still clock.
await api.op('zstub.lock-days', { employment: 'E0005', from: dayAdd(today, -4), to: today, payrun: 'run_shots' }, HR);
// A changed locked day for the day sheet: a late clock out three days ago.
await api.call('checkins.add', { employment: 'E0005', day: dayAdd(today, -3), time: '21:30', kind: 'out', note: 'stayed for the release' }, HR);

const browser = await chromium.launch({ headless: true });
async function open(who, w, scheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, colorScheme: scheme, isMobile: w < 500, hasTouch: w < 500, geolocation: { latitude: 1.284, longitude: 103.851 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  const failed = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) failed.push(r.status() + ' ' + r.url().replace(BASE, '').split('?')[0]);
  });
  await page.goto(BASE + '#/home');
  await page.waitForSelector('input[type=email]', { timeout: 20000 });
  await page.fill('input[type=email]', who);
  await page.fill('input[type=password]', DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await page.waitForSelector('#hr-main', { timeout: 20000 });
  return { ctx, page, failed };
}
async function go(page, path) {
  await page.goto(BASE + '#/' + path);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction(() => document.querySelectorAll('#hr-main .animate-spin, .hr-sheet .animate-spin').length === 0, null, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

// T8 + T1: Sam's clock on a locked day, right after the tap and after the answer.
{
  const { ctx, page, failed } = await open('sam@northwind.test', 390);
  await go(page, 'time/clock');
  await go(page, 'time/clock');
  await page.screenshot({ path: OUT + '/ui_after_T8_clock_before_tap_390.png' });
  const big = page.locator('#hr-main button.h-20').first();
  await big.click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT + '/ui_after_T1_right_after_tap_390.png' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + '/ui_after_T1_T8_answered_390.png' });
  const big2 = page.locator('#hr-main button.h-20').first();
  await big2.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + '/ui_after_T8_clocked_out_locked_390.png' });
  console.log('T8/T1 failed requests: ' + JSON.stringify(failed));
  await ctx.close();
}
// T2 and T4 (owner) and the changed locked day (HR).
{
  const { ctx, page, failed } = await open('owner@northwind.test', 1440);
  await go(page, 'time');
  await go(page, 'time');
  await page.screenshot({ path: OUT + '/ui_after_T2_board_1440.png' });
  await go(page, 'time/settings');
  await page.screenshot({ path: OUT + '/ui_after_T4_settings_1440.png' });
  await page.locator('#hr-main button[aria-label^="Singapore"]').first().hover().catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/ui_after_T4_settings_hint_1440.png' });
  await go(page, 'time/attendance');
  await page.locator('#hr-main [role=row]:has-text("Sam Wong") button[data-day="' + dayAdd(today, -3) + '"]').first().click().catch((e) => console.log('no cell', e.message));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + '/ui_after_T8_daysheet_adjusted_1440.png' });
  console.log('owner failed requests: ' + JSON.stringify(failed));
  await ctx.close();
}
// T5: no employee record.
{
  const { ctx, page, failed } = await open(email, 1440);
  for (const p of ['time', 'time/clock', 'time/schedule', 'time/timesheets']) {
    failed.length = 0;
    await go(page, p);
    await page.screenshot({ path: OUT + '/ui_after_T5_' + p.replace('/', '_') + '_1440.png' });
    console.log('T5 ' + p + ' failed requests: ' + JSON.stringify(failed));
  }
  await ctx.close();
}
await browser.close();
await api.op('zstub.unlock-days', { payrun: 'run_shots' }, HR);
console.log('shots in ' + OUT);
