// Reference screenshots of Piano Coach (the look HR OS copies), light and dark.
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
const { chromium } = require('playwright-core');

const OUT = 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/kernel-frontend/piano_shots';
const BASE = 'http://127.0.0.1:3199/';
const pages = ['today', 'library', 'learn', 'settings', 'coach', 'train', 'reference'];

const browser = await chromium.launch({ headless: true });
for (const scheme of ['light', 'dark']) {
  for (const w of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(BASE + '#/today');
    await page.waitForTimeout(1500);
    // Dismiss the first-run onboarding if present.
    if ((await page.locator('[role="dialog"]').count()) > 0) {
      await page.getByText('Screen keys').first().click({ timeout: 2000 }).catch(() => undefined);
      await page.getByRole('button', { name: 'Start' }).click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    }
    for (const p of pages) {
      await page.goto(BASE + '#/' + p);
      await page.waitForTimeout(1300);
      // The first-run dialog stays until the server records it; hide it for the reference shots.
      await page.addStyleTag({ content: '.pc-scrim{display:none!important}' });
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${OUT}/${p}_${scheme}_${w}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
console.log('done');
