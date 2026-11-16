// Smoke test of the kernel frontend against the REAL kernel backend (an APP copy served on PORT, empty
// database first): setup through the four steps, then every kernel page in light and dark at 1440 and 390,
// the agent panel with a question, Ctrl K, a fund saved with LPA terms, an invite with the PIN, a CSV
// import of companies, and Focus showing the kernel's own items. Fails on console errors or 5xx.
// APP=<app copy> PORT=3183 OUT=<dir> node real_smoke.mjs   (run setup.mjs first)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, OUT, OWNER, chromium, open, settle, shot, signIn } from './lib.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ' (' + detail + ')' : ''}`);
};
const PAGES = [
  ['home', '#/'],
  ['focus', '#/focus'],
  ['agent', '#/agent'],
  ['firm', '#/settings/firm'],
  ['funds', '#/settings/funds'],
  ['members', '#/settings/members'],
  ['ai', '#/settings/agent'],
  ['data', '#/settings/data'],
  ['security', '#/settings/security'],
];
const browser = await chromium.launch({ headless: true });
for (const [scheme, width] of [
  ['light', 1440],
  ['dark', 390],
]) {
  const { page, errors, ctx } = await open(browser, { scheme, width, height: width < 768 ? 844 : 900, mobile: width < 768 });
  await signIn(page);
  for (const [name, h] of PAGES) {
    await page.goto(BASE + h);
    await settle(page, 900);
    await shot(page, `real_${name}_${scheme}_${width}`);
  }
  if (width === 1440) {
    // Settings tabs read the real shapes.
    await page.goto(BASE + '#/settings/agent');
    await settle(page, 600);
    check('autonomy switches render from settings.get', (await page.locator('[role=switch]').count()) >= 5);
    await page.getByRole('tab', { name: 'Inventory' }).click();
    await settle(page, 600);
    check('the AI use inventory renders from ai.inventory', (await page.locator('[role=row]').count()) > 1);
    await shot(page, `real_ai_inventory_${scheme}_${width}`);
    // A fund with LPA terms.
    await page.goto(BASE + '#/settings/funds');
    await settle(page, 600);
    await page.getByRole('button', { name: 'New fund' }).click();
    await page.fill('input[aria-label=Name]', 'Fund II');
    await page.locator('[role=dialog]').getByRole('button', { name: 'More' }).click();
    await page.fill('input[aria-label=Size]', '120m');
    await page.fill('input[aria-label=Carry]', '25');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(1200);
    check('a new fund saves through entities.save with LPA terms', (await page.locator('text=Fund II').count()) > 0);
    await shot(page, `real_funds_saved_${scheme}_${width}`);
    // Invite with the PIN.
    await page.goto(BASE + '#/settings/members');
    await settle(page, 600);
    await page.getByRole('button', { name: 'Invite' }).click();
    await page.fill('input[aria-label=Email]', 'dev@harbor.vc');
    await page.fill('input[aria-label=Name]', 'Dev Rao');
    await page.getByRole('radio', { name: /Principal/ }).click();
    await page.locator('[role=dialog]').getByRole('button', { name: 'Invite' }).click();
    await page.waitForSelector('input[aria-label="Approval PIN"]');
    await page.locator('input[aria-label="Approval PIN"]').last().fill(OWNER.pin);
    await page.waitForSelector('[role=dialog] code', { timeout: 8000 }).catch(() => undefined);
    const code = ((await page.locator('[role=dialog] code').textContent().catch(() => '')) ?? '').trim();
    check('invite through members.invite shows the code', /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code), code);
    await page.keyboard.press('Escape');
    // Import companies.
    const csv = join(OUT, 'real_companies.csv');
    writeFileSync(csv, 'Company,Website\nAcme Robotics,acme.ai\nNorthwind Health,northwind.io\n');
    await page.goto(BASE + '#/settings/data');
    await settle(page, 600);
    await page.getByRole('button', { name: 'Import' }).first().click();
    await page.waitForTimeout(900);
    const targets = await page.locator('[role=dialog] [role=radio]').allTextContents();
    const company = targets.find((t) => /compan/i.test(t));
    if (company !== undefined) {
      await page.getByRole('radio', { name: company }).click();
      await page.locator('[role=dialog] input[type=file]').setInputFiles(csv);
      await page.waitForSelector('[role=dialog] >> text=Problems', { timeout: 8000 }).catch(() => undefined);
      await shot(page, `real_import_check_${scheme}_${width}`);
      const btn = page.locator('[role=dialog]').getByRole('button', { name: /^Import \d/ });
      if ((await btn.count()) > 0 && (await btn.isEnabled())) {
        await btn.click();
        await page.waitForSelector('[role=dialog] >> text=Skipped', { timeout: 10000 }).catch(() => undefined);
      }
      check('a CSV of companies imports through imports.preview and imports.run', (await page.locator('[role=dialog] >> text=Skipped').count()) > 0, targets.join(', '));
      await shot(page, `real_import_done_${scheme}_${width}`);
      await page.keyboard.press('Escape');
    } else check('no import targets yet: the dialog shows its empty state', (await page.locator('[role=dialog] >> text=Nothing to import yet').count()) > 0, 'modules register targets');
    // The agent panel and a question.
    await page.goto(BASE + '#/');
    await settle(page, 400);
    await page.getByRole('button', { name: /Your AI agent/ }).first().click();
    const field = page.locator('textarea[aria-label="Tell your AI agent"]');
    await field.fill('What is in the pipeline?');
    await field.press('Enter');
    await page.waitForSelector('text=Waiting for your AI agent', { timeout: 6000 }).then(() => check('chat.ask queues a job and the panel follows it', true)).catch(() => check('chat.ask queues a job and the panel follows it', false));
    await shot(page, `real_agent_panel_${scheme}_${width}`);
    await page.keyboard.press('Escape');
    // Search.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('acme');
    await settle(page, 800);
    await shot(page, `real_search_${scheme}_${width}`);
    await page.keyboard.press('Escape');
    // Focus with the kernel's items (an invite, a queued job: whatever needsYou answers).
    await page.goto(BASE + '#/focus');
    await settle(page, 900);
    await shot(page, `real_focus_after_${scheme}_${width}`);
  }
  check(`no console errors or 5xx (${scheme} ${width})`, errors.length === 0, errors.slice(0, 4).join(' | '));
  await ctx.close();
}
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(fails === 0 ? `real backend smoke ok (${results.length} checks)` : `${fails} of ${results.length} checks failed`);
process.exit(fails === 0 ? 0 : 1);
