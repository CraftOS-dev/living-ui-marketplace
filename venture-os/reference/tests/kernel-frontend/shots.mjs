// Screenshots of every kernel-frontend screen, light and dark, 1440 and 390, on the seeded stand-in
// (no actions run: Focus cards are only looked at). Fails on console errors or 5xx.
// Also prints the interface word count of each page at rest (U2 budget about 40).
import { BASE, chromium, open, settle, shot, signIn, wordCount } from './lib.mjs';

const ONLY = process.env.ONLY ?? '';
const combos = [
  ['light', 1440],
  ['dark', 1440],
  ['light', 390],
  ['dark', 390],
];
const PAGES = [
  ['home', '#/'],
  ['focus', '#/focus'],
  ['agent_page', '#/agent'],
  ['settings_firm', '#/settings/firm'],
  ['settings_funds', '#/settings/funds'],
  ['settings_members', '#/settings/members'],
  ['settings_agent', '#/settings/agent'],
  ['settings_data', '#/settings/data'],
  ['settings_security', '#/settings/security'],
  ['gallery', '#/gallery'],
  ['deals_dense', '#/deals'],
];

const browser = await chromium.launch({ headless: true });
let fails = 0;
const words = {};
for (const [scheme, width] of combos) {
  const phone = width < 768;
  const tag = `${scheme}_${width}`;
  // Signed out: sign-in, invite, recovery.
  {
    const { page, errors, ctx } = await open(browser, { scheme, width, height: phone ? 844 : 900, mobile: phone });
    for (const [name, h] of [
      ['signin', '#/'],
      ['invite', '#/invite?email=dev%40harbor.vc'],
      ['recover', '#/recover'],
    ]) {
      if (ONLY !== '' && !ONLY.split(',').includes(name)) continue;
      await page.goto(BASE + h);
      await page.waitForSelector('input[type=email]');
      await settle(page, 300);
      await shot(page, `${name}_${tag}`);
    }
    if (errors.length > 0) {
      fails += errors.length;
      console.log(tag, 'signed out', errors);
    }
    await ctx.close();
  }
  const { page, errors, ctx } = await open(browser, { scheme, width, height: phone ? 844 : 900, mobile: phone });
  await signIn(page);
  for (const [name, h] of PAGES) {
    if (ONLY !== '' && !ONLY.split(',').includes(name)) continue;
    await page.goto(BASE + h);
    await settle(page, 900);
    await shot(page, `${name}_${tag}`);
    if (scheme === 'light' && !phone) words[name] = await wordCount(page);
  }
  const want = (n) => ONLY === '' || ONLY.split(',').includes(n);
  // Focus: the triage card, the draft, the vote chips.
  if (want('focus_cards')) {
    const card = async (key, name) => {
      await page.goto(BASE + '#/');
      await page.goto(BASE + '#/focus?at=' + encodeURIComponent(key));
      await page.reload();
      await page.waitForSelector('#vo-main article', { timeout: 15000 });
      await settle(page, 500);
      await shot(page, `focus_${name}_${tag}`);
    };
    await card('committee:v1', 'vote');
    await page.keyboard.press('a');
    await page.waitForTimeout(250);
    await shot(page, `focus_vote_choose_${tag}`);
    await page.keyboard.press('Escape');
    await card('intake:a1', 'triage');
    await card('intake:a2', 'reading');
    await card('kernel:outbound:ob1fleetwise000', 'draft');
    await page.keyboard.press('e');
    await page.waitForTimeout(250);
    await shot(page, `focus_draft_edit_${tag}`);
    await page.keyboard.press('Escape');
    await card('kernel:proposal:pr1acmeheadct00', 'proposal');
    await card('portfolio:k1', 'verify');
    await card('funds:p1', 'payment');
  }
  // The agent panel, the search palette, notifications, the drop overlay.
  if (want('overlays')) {
    await page.goto(BASE + '#/');
    await settle(page, 500);
    if (phone) {
      await page.getByRole('button', { name: 'More' }).last().click();
      await page.waitForTimeout(250);
      await shot(page, `drawer_${tag}`);
      await page.getByRole('button', { name: /Your AI agent/ }).last().click();
    } else await page.getByRole('button', { name: /Your AI agent/ }).first().click();
    await settle(page, 600);
    await shot(page, `agent_panel_${tag}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(150);
    await page.keyboard.type('acme');
    await settle(page, 600);
    await shot(page, `search_${tag}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.waitForTimeout(400);
    await shot(page, `notifications_${tag}`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' }));
      document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
      document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(300);
    await shot(page, `drop_${tag}`);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(400);
    await shot(page, `drop_choose_${tag}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Cancel' }).click().catch(() => undefined);
  }
  if (want('dialogs') && !phone) {
    await page.goto(BASE + '#/settings/members');
    await settle(page, 600);
    await page.getByRole('button', { name: 'Invite' }).click();
    await page.waitForTimeout(300);
    await shot(page, `invite_dialog_${tag}`);
    await page.keyboard.press('Escape');
    await page.goto(BASE + '#/settings/funds');
    await settle(page, 600);
    await page.getByText('Fund II').first().click();
    await page.waitForTimeout(400);
    await shot(page, `fund_sheet_${tag}`);
    await page.keyboard.press('Escape');
    await page.goto(BASE + '#/settings/data');
    await settle(page, 600);
    await page.getByRole('button', { name: 'Import' }).first().click();
    await page.waitForTimeout(500);
    await shot(page, `import_dialog_${tag}`);
    await page.keyboard.press('Escape');
  }
  if (errors.length > 0) {
    fails += errors.length;
    console.log(tag, errors);
  }
  await ctx.close();
}
await browser.close();
console.log('words at rest (light 1440):', JSON.stringify(words));
console.log(fails === 0 ? 'shots ok' : `${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
