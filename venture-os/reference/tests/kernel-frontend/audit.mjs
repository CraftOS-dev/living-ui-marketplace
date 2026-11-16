// Contrast audit over every CraftBot theme pack in light and dark (the host ThemeBridge message), the
// Expenses / HR OS approach: 1. the --vo-* token pairs the screens use (text 4.5:1 on every surface,
// hover apart from page, panel and raised, lines visible); 2. every visible text node on a few pages
// against the surface really under it (4.5:1; 3:1 for 18px+ or bold 14px+).
import { BASE, chromium, open, settle, signIn, theme } from './lib.mjs';
import { textCheck, tokenCheck } from './checks.mjs';

const PACKS = ['craftbot', 'normal', 'ocean', 'forest', 'pastel', 'glass', 'classic', 'velvet', 'ink', 'acid', 'blueprint', 'modern', 'brutalist', 'drafting', 'clay', 'atelier'];
const PAGES = (process.env.PAGES ?? 'focus,gallery,settings/members,settings/agent').split(',');



const browser = await chromium.launch({ headless: true });
const { page } = await open(browser, { width: 1440, height: 900 });
await signIn(page);
let fails = 0;
for (const p of PAGES) {
  await page.goto(BASE + '#/' + p);
  await settle(page, 900);
  for (const pack of PACKS) {
    for (const mode of ['light', 'dark']) {
      await theme(page, pack, mode);
      await page.waitForTimeout(320);
      const t = p === PAGES[0] ? await page.evaluate(tokenCheck) : [];
      const x = await page.evaluate(textCheck);
      if (t.length + x.length > 0) {
        fails += t.length + x.length;
        console.log(`${p} ${pack}/${mode}: ${[...t, ...x].join('; ')}`);
      }
    }
  }
}
await browser.close();
console.log(fails === 0 ? `audit ok: ${PACKS.length} packs x 2 modes x ${PAGES.length} pages, every pairing passes` : `${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
