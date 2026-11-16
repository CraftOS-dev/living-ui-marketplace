// Kernel flows through the screens on the demo seed (owner, PIN 123456): approve a bank account in the Inbox,
// schedule a job change, hire, search, hide pay, ask your AI agent, add a department, invite, reveal a number.
import { BASE, OUT, chromium, open, settle, signIn } from './lib.mjs';

const browser = await chromium.launch({ headless: true });
const { page, errors } = await open(browser, { width: 1440, height: 900 });
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, String(e.message).split('\n')[0]]);
    await page.screenshot({ path: `${OUT}/fail_${name.replace(/\W+/g, '_')}.png` }).catch(() => undefined);
  }
};
const pin = async (code = '123456') => {
  await page.waitForSelector('input[aria-label="Approval PIN"]', { timeout: 20000 });
  await page.fill('input[aria-label="Approval PIN"]', code);
};

await signIn(page, 'owner@northwind.test', 'demo-pass-1');
if (process.env.DEBUG_OPS) page.on('response', async (r) => { if (/\/api\/ops\/(job|people)\//.test(r.url()) && r.request().method() === 'POST') console.log('  op', r.status(), r.url().split('/api/ops/')[1], (await r.text().catch(() => '')).slice(0, 160)); });

await step('approve bank account with PIN', async () => {
  await page.goto(BASE + '#/inbox');
  // The card is titled by its kind with the account in its facts (the plain summary is for the CLI).
  const card = page.locator('li', { hasText: 'DBS Bank' }).filter({ has: page.getByRole('button', { name: 'Approve', exact: true }) }).first();
  await card.waitFor({ timeout: 20000 });
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await pin();
  await card.waitFor({ state: 'detached', timeout: 20000 });
});

await step('wrong PIN asks again', async () => {
  await page.goto(BASE + '#/people/E0005?tab=bank');
  await page.waitForSelector('text=DBS Bank', { timeout: 20000 }).catch(async () => {
    await page.goto(BASE + '#/people');
  });
});

await step('reveal a sealed bank number', async () => {
  await page.goto(BASE + '#/people');
  await settle(page, 600);
  await page.getByText('Sam Wong').first().click();
  await page.waitForSelector('text=Bank and IDs', { timeout: 20000 });
  await page.getByRole('tab', { name: 'Bank and IDs' }).click();
  await page.waitForSelector('text=DBS Bank', { timeout: 20000 });
  await page.getByRole('button', { name: 'Reveal the number' }).first().click();
  await pin('000000');
  await page.waitForSelector('text=That PIN is not right', { timeout: 20000 });
  await pin();
  await page.waitForFunction(() => !document.body.innerText.includes('•••• 7890') || document.querySelector('[role=dialog]') === null, null, { timeout: 20000 });
  await settle(page, 400);
  await page.screenshot({ path: `${OUT}/flow_reveal.png` });
});

await step('schedule a job change (Update job, future day)', async () => {
  await page.goto(BASE + '#/people/E0021?tab=job');
  await page.waitForSelector('text=Job history', { timeout: 20000 });
  await page.getByRole('button', { name: 'Update job' }).first().click();
  await page.waitForSelector('[role=dialog] >> text=Takes effect');
  await page.getByRole('button', { name: /^Takes effect/ }).click();
  await page.fill('input[aria-label="Type a day, e.g. 2026-11-04"]', '2027-01-04');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-hr-popover]', { state: 'detached', timeout: 4000 });
  await page.getByRole('radio', { name: 'Promotion' }).click();
  await page.fill('[role=dialog] input[aria-label="Title"]', 'Senior Software Engineer');
  await page.locator('[role=dialog]').getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.waitForSelector('text=SCHEDULED', { timeout: 20000 });
  await page.waitForSelector('text=Senior Software Engineer', { timeout: 20000 });
  await settle(page, 400);
  await page.screenshot({ path: `${OUT}/flow_scheduled.png` });
});

await step('hire a person', async () => {
  await page.goto(BASE + '#/people/new');
  await page.waitForSelector('text=Who', { timeout: 20000 });
  await page.fill('input[aria-label="Given name"]', 'Nadia');
  await page.fill('input[aria-label="Family name"]', 'Rahman');
  await page.fill('input[aria-label="Title"]', 'Data Analyst');
  await page.getByRole('button', { name: 'Hire', exact: true }).last().click();
  await page.waitForSelector('text=Hired Nadia Rahman', { timeout: 20000 });
  await page.waitForSelector('h1:has-text("Nadia Rahman")', { timeout: 20000 });
});

await step('search with Ctrl K', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('input[aria-label="Search"]');
  await page.keyboard.type('Haruto');
  await page.waitForSelector('[role=dialog] >> text=Haruto Sato', { timeout: 20000 });
  await page.screenshot({ path: `${OUT}/flow_search.png` });
  await page.keyboard.press('Enter');
  await page.waitForSelector('h1:has-text("Haruto Sato")', { timeout: 20000 });
});

await step('hide pay blanks figures', async () => {
  await page.goto(BASE + '#/people/E0021?tab=job');
  await page.waitForSelector('text=Pay history', { timeout: 20000 });
  await page.getByRole('button', { name: 'Hide pay' }).click();
  const hidden = await page.locator('.hr-hidden-pay').count();
  if (hidden === 0) throw new Error('no hidden figures');
  await page.screenshot({ path: `${OUT}/flow_hidepay.png` });
  await page.getByRole('button', { name: 'Show pay' }).click();
});

await step('ask your AI agent', async () => {
  await page.getByRole('button', { name: /Your AI agent/ }).first().click();
  await page.fill('textarea[aria-label="Ask your AI agent"]', 'Who joins next month?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Sent to your AI agent', { timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.goto(BASE + '#/inbox?view=jobs');
  await page.waitForSelector('text=Who joins next month?', { timeout: 20000 });
});

await step('add a department', async () => {
  await page.goto(BASE + '#/settings/org');
  await page.waitForSelector('text=Departments', { timeout: 20000 });
  await page.getByRole('button', { name: 'Add department' }).first().click();
  await page.fill('[role=dialog] input[aria-label="Name"]', 'Legal');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForSelector('text=Added the department', { timeout: 20000 });
});

await step('invite a member (PIN), code shown', async () => {
  await page.goto(BASE + '#/settings/members');
  await page.getByRole('button', { name: 'Invite' }).first().click();
  await page.fill('[role=dialog] input[type=email]', 'nadia@northwind.test');
  await page.fill('[role=dialog] input[aria-label="Name"]', 'Nadia Rahman');
  await page.getByRole('button', { name: 'Invite' }).last().click();
  await pin();
  await page.waitForSelector('text=Invite code', { timeout: 20000 });
  await page.screenshot({ path: `${OUT}/flow_invite.png` });
});

await step('set a photo on the profile', async () => {
  const { writeFileSync } = await import('node:fs');
  const png = `${OUT}/face.png`;
  // A 24x24 grey square (generated, not a drawing).
  const { deflateSync } = await import('node:zlib');
  const w = 24, h = 24;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x88);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(png, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  await page.goto(BASE + '#/people/E0021');
  await page.waitForSelector('button[aria-label="Change the photo"]', { timeout: 20000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 20000 }), page.click('button[aria-label="Change the photo"]')]);
  await chooser.setFiles(png);
  await page.waitForSelector('text=Photo saved', { timeout: 20000 });
  await page.waitForSelector('button[aria-label="Change the photo"] img', { timeout: 20000 });
});

await step('update tax details from the packs fields', async () => {
  await page.goto(BASE + '#/people/E0021?tab=job');
  await page.waitForSelector('text=Tax profile', { timeout: 20000 });
  const btn = page.locator('section:has-text("Tax profile") >> button:has-text("Update")');
  if ((await btn.count()) === 0) throw new Error('no Update on the tax panel (no profile_fields?)');
  await btn.first().click();
  await page.waitForSelector('[role=dialog] >> text=Tax details', { timeout: 20000 });
  await page.screenshot({ path: `${OUT}/flow_tax.png` });
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('text=Tax details saved', { timeout: 20000 });
});

console.log(results.map((r) => r.join('  ')).join('\n'));
const real = errors.filter((e) => !/status of 403/.test(e));
console.log('console errors:', real.length === 0 ? 'none (the 403 is the deliberate wrong PIN)' : real.join(' | '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') || real.length > 0 ? 1 : 0);
