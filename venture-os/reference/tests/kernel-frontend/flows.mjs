// End-to-end flows on the seeded stand-in (run setup.mjs and seed.mjs first; this run consumes the Next items):
// Focus keys and actions (choose chips, PIN, wrong PIN, undo, skip, edit), All clear, the agent panel
// following a question answered live by your AI agent, invite with a code, import, export, search,
// the drop overlay, the fund scope tree and the sidebar rail.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, OUT, OWNER, chromium, op, open, ownerToken, settle, shot, signIn } from './lib.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ' (' + detail + ')' : ''}`);
};
const tok = await ownerToken();
const count = async () => (await op('next.count', {}, { as: tok })).total;
const title = async (page) => (await page.locator('#vo-main article h2').first().textContent())?.trim() ?? '';

const browser = await chromium.launch({ headless: true });
const { page, errors, ctx } = await open(browser, { width: 1440, height: 900 });
await signIn(page);

/* ------------------------------------------------------------- Focus */
await page.goto(BASE + '#/focus');
await page.waitForSelector('#vo-main article');
await settle(page, 500);
const n0 = await count();
check('focus opens on the first item (vote)', (await title(page)) === 'Northwind Health, Series A');
await page.keyboard.press('a');
await page.waitForSelector('[role=radiogroup][aria-label=Vote]');
check('A on a choose action opens its chips', true);
await page.keyboard.press('4');
await page.waitForSelector('input[aria-label="Approval PIN"]', { timeout: 5000 });
await page.locator('input[aria-label="Approval PIN"]').fill(OWNER.pin);
await page.waitForFunction(() => document.querySelector('#vo-main article h2')?.textContent?.trim() === 'Acme Robotics', null, { timeout: 8000 });
for (let i = 0; i < 20 && (await count()) !== n0 - 1; i++) await page.waitForTimeout(150);
check('vote with chip 4 and the PIN runs and the next card slides in', (await count()) === n0 - 1, `next ${n0} -> ${await count()}`);
await shot(page, 'flow_focus_after_vote');

await page.keyboard.press('a');
await page.waitForSelector('text=Advanced');
await page.waitForFunction(() => document.querySelector('#vo-main article h2')?.textContent?.trim() !== 'Acme Robotics', null, { timeout: 8000 });
check('A advances the verdict and the toast says Advanced', (await count()) === n0 - 2);
await shot(page, 'flow_focus_undo_toast');
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(800);
check('Undo brings the item back', (await count()) === n0 - 1);

await page.goto(BASE + '#/focus?at=' + encodeURIComponent('intake:a2'));
await page.reload();
await page.waitForSelector('#vo-main article');
await settle(page, 400);
check('?at= opens at an item', (await title(page)) === 'Lumen Grid');
await page.keyboard.press('a');
await page.waitForSelector('[role=radiogroup][aria-label=Pass]');
await page.keyboard.press('2');
await page.waitForSelector('text=Passed');
check('Pass with a reason chip (key 2) runs', (await count()) === n0 - 2);

// Skip is an icon button with a tooltip (key X stays); no "Skip" text button competes with module labels.
check('Skip is an icon button labelled "Skip (X)"', (await page.locator('#vo-main article button[aria-label="Skip (X)"]').count()) === 1 && (await page.locator('#vo-main article button', { hasText: /^Skip$/ }).count()) === 0);
// Skip: the card changes, the skipped item stays in the queue.
const before = await title(page);
await page.keyboard.press('x');
await page.waitForTimeout(300);
const after = await title(page);
check('X skips to another card', before !== after, `${before} -> ${after}`);

// Edit the draft (E), save with Ctrl+Enter.
await page.goto(BASE + '#/focus?at=' + encodeURIComponent('kernel:outbound:ob1fleetwise000'));
await page.reload();
await page.waitForSelector('#vo-main article');
await settle(page, 400);
await page.keyboard.press('e');
const ta = page.locator('textarea[aria-label=Edit]');
await ta.waitFor();
await ta.press('End');
await ta.type('\nPS. Edited in Focus.');
await ta.press('Control+Enter');
await page.waitForTimeout(800);
const ob = await op('outbound.get', { outbound: 'ob1fleetwise000' }, { as: tok });
check('E edits the draft body in place and saves it', ob.message.body.includes('Edited in Focus'));

// The kernel cards' pages, one click deeper.
await page.goto(BASE + '#/next/draft/ob1fleetwise000');
await settle(page, 600);
check('the draft page opens the draft in full', (await page.locator('input[aria-label=Subject]').inputValue()) === 'Fleetwise');
await shot(page, 'flow_draft_page');
await page.goto(BASE + '#/next/proposal/pr1acmeheadct00');
await settle(page, 600);
check('the proposal page shows each change before and after', (await page.locator('text=Denver').count()) > 0 && (await page.locator('text=Austin').count()) > 0);
await shot(page, 'flow_proposal_page');

// Wrong PIN, then the right one (approve a mark).
await page.goto(BASE + '#/focus?at=' + encodeURIComponent('funds:m1'));
await page.reload();
await page.waitForSelector('#vo-main article');
await settle(page, 400);
await page.keyboard.press('a');
await page.waitForSelector('input[aria-label="Approval PIN"]');
await page.locator('input[aria-label="Approval PIN"]').fill('135792');
await page.waitForSelector('text=/Wrong PIN/');
check('a wrong PIN asks again with the tries left', true);
await shot(page, 'flow_wrong_pin');
await page.locator('input[aria-label="Approval PIN"]').fill(OWNER.pin);
let marks = 1;
for (let i = 0; i < 25 && marks !== 0; i++) {
  await page.waitForTimeout(200);
  marks = (await op('next.list', { kinds: ['mark'] }, { as: tok })).total;
}
check('the right PIN approves the mark', marks === 0);

// An action whose op answers an href opens it (network's "Add note").
await page.goto(BASE + '#/focus?at=' + encodeURIComponent('network:n1'));
await page.reload();
await page.waitForSelector('#vo-main article');
await settle(page, 400);
await page.keyboard.press('a');
await page.waitForFunction(() => location.hash.startsWith('#/agent'), null, { timeout: 6000 }).catch(() => undefined);
check('an op answering href is followed after the action', page.url().includes('#/agent'), page.url());

// The multi-select ChipPicker (gallery).
await page.goto(BASE + '#/gallery');
await settle(page, 500);
const grp = page.locator('[role=group][aria-label=Sections]');
await grp.getByRole('checkbox', { name: 'Market' }).click();
await grp.getByRole('checkbox', { name: 'Risks' }).click();
await grp.getByRole('checkbox', { name: 'Team' }).click();
const on = await grp.locator('[aria-checked=true]').allTextContents();
check('ChipPicker multiple toggles chips (Market, Risks on; Team off)', on.join(',') === 'Market,Risks', on.join(','));

// Clear the rest with A until All clear.
await page.goto(BASE + '#/focus');
await page.reload();
for (let i = 0; i < 12; i++) {
  const clear = await page.locator('text=All clear').count();
  if (clear > 0) break;
  await page.waitForSelector('#vo-main article', { timeout: 5000 });
  const t = await title(page);
  await page.keyboard.press('a');
  if ((await page.locator('[role=radiogroup][aria-label]').count()) > 0 && (await page.locator('#vo-main [role=radiogroup]').count()) > 0) await page.keyboard.press('1');
  await page.waitForTimeout(250);
  if ((await page.locator('input[aria-label="Approval PIN"]').count()) > 0) await page.locator('input[aria-label="Approval PIN"]').fill(OWNER.pin);
  await page.waitForFunction((x) => document.querySelector('#vo-main article h2')?.textContent?.trim() !== x || document.body.textContent?.includes('All clear'), t, { timeout: 8000 }).catch(() => undefined);
}
await page.waitForSelector('text=All clear', { timeout: 8000 }).catch(() => undefined);
await page.waitForTimeout(1500);
check('clearing the queue ends on All clear', (await page.locator('text=All clear').count()) > 0 && (await count()) === 0, `left ${await count()}`);
await shot(page, 'flow_all_clear');

/* --------------------------------------------------- the agent panel */
await page.goto(BASE + '#/');
await settle(page, 400);
await page.getByRole('button', { name: /Your AI agent/ }).first().click();
const field = page.locator('textarea[aria-label="Tell your AI agent"]');
await field.waitFor();
await field.fill('Which deals stalled this month?');
await field.press('Enter');
await page.waitForSelector('text=Waiting for your AI agent');
check('a question shows "Waiting for your AI agent" honestly', true);
await shot(page, 'flow_agent_waiting');
const open1 = await op('chat.list', { status: 'waiting', limit: 20 }, { as: 'agent' });
const asked1 = open1.asks.find((a) => a.question === 'Which deals stalled this month?');
await op('chat.answer', { ask: asked1.id, answer: 'Two: Fleetwise (21 days in Diligence) and Orbit OS (15 days in Screen).' }, { as: 'agent' });
await page.waitForSelector('text=Two: Fleetwise', { timeout: 6000 }).then(() => check('the answer appears live in place', true)).catch(() => check('the answer appears live in place', false));
await shot(page, 'flow_agent_answer');
await page.keyboard.press('Escape');

/* ------------------------------------------------------------ invite */
await page.goto(BASE + '#/settings/members');
await settle(page, 500);
await page.getByRole('button', { name: 'Invite' }).click();
await page.fill('input[aria-label=Email]', 'ana@harbor.vc');
await page.fill('input[aria-label=Name]', 'Ana Ruiz');
await page.getByRole('radio', { name: 'Analyst' }).click();
await page.locator('[role=dialog]').getByRole('button', { name: 'Invite' }).click();
await page.waitForSelector('input[aria-label="Approval PIN"]');
await page.locator('input[aria-label="Approval PIN"]').last().fill(OWNER.pin);
await page.waitForSelector('code', { timeout: 6000 });
const code = (await page.locator('[role=dialog] code').textContent())?.trim() ?? '';
check('invite shows a 10-character code once', /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code), code);
await shot(page, 'flow_invite_code');
await page.getByRole('button', { name: 'Done' }).click();

/* ------------------------------------------------------------ import */
const csv = join(OUT, 'people_import.csv');
writeFileSync(csv, 'Full name,E-mail,Organisation\nMaya Chen,maya@acme.ai,Acme Robotics\nTom Okafor,tom@northwind.io,Northwind Health\n,blank@x.io,Nobody\n');
await page.goto(BASE + '#/settings/data');
await settle(page, 500);
await page.getByRole('button', { name: 'Import' }).first().click();
await page.getByRole('radio', { name: 'People' }).click();
await page.locator('[role=dialog] input[type=file]').setInputFiles(csv);
await page.waitForSelector('[role=dialog] >> text=Problems', { timeout: 6000 });
await shot(page, 'flow_import_check');
const mapped = await page.locator('select[aria-label=Name]').inputValue();
check('columns match by header synonyms (Full name -> Name)', mapped === 'Full name', mapped);
await page.locator('[role=dialog]').getByRole('button', { name: /^Import \d/ }).click();
await page.waitForSelector('[role=dialog] >> text=Skipped', { timeout: 8000 });
check('import runs in batches and shows New, Updated, Skipped', true);
await shot(page, 'flow_import_done');
await page.getByRole('button', { name: 'Done' }).click();
await settle(page, 400);
// The list reloads on the imports change; give a busy machine time.
check('the import shows in the list', await page.waitForSelector('text=people_import.csv', { timeout: 8000 }).then(() => true, () => false));

/* ------------------------------------------------------------ export */
const dl = page.waitForEvent('download', { timeout: 8000 });
await page.getByRole('button', { name: 'Export all' }).click();
await page.waitForSelector('input[aria-label="Approval PIN"]');
await page.locator('input[aria-label="Approval PIN"]').fill(OWNER.pin);
const file = await dl.then((d) => d.suggestedFilename()).catch(() => '');
check('Export all asks the PIN and downloads', file !== '', file);

/* ------------------------------------------------------------ search */
await page.keyboard.press('Control+k');
await page.keyboard.type('northwind');
await page.waitForSelector('text=Northwind Health');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('Ctrl K finds and Enter opens', page.url().includes('#/companies/c2'), page.url());

/* -------------------------------------------------------------- drop */
await page.goto(BASE + '#/');
await settle(page, 300);
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['%PDF'], 'deck.pdf', { type: 'application/pdf' }));
  document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
  document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.getByRole('radio', { name: 'New deal' }).click();
await page.waitForTimeout(500);
check('a dropped deck goes to the handler chosen and opens its result', page.url().includes('#/inbox'), page.url());

/* ----------------------------------------------- fund scope and rail */
await page.getByRole('treeitem', { name: /All funds/ }).click();
await page.getByRole('treeitem', { name: 'Fund II' }).click();
const ui = await page.evaluate(() => JSON.parse(localStorage.getItem('vo.ui') ?? '{}'));
check('the fund scope tree picks a fund', typeof ui.fund === 'string' && ui.fund !== '');
await shot(page, 'flow_fund_scope');
await page.goto(BASE + '#/deals');
await settle(page, 400);
const railW = await page.locator('nav[aria-label=Main]').first().evaluate((el) => el.getBoundingClientRect().width);
check('a dense page folds the sidebar to its rail', railW < 80, String(railW));
await shot(page, 'flow_dense_rail');

check('no console errors or 5xx', errors.length === 0, errors.slice(0, 3).join(' | '));
await ctx.close();
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(fails === 0 ? `flows ok (${results.length} checks)` : `${fails} of ${results.length} checks failed`);
process.exit(fails === 0 ? 0 : 1);
