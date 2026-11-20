// Receipt photos for the demo seed and screenshots: small printed receipts rendered from HTML
// (headless Chromium), so screens show what a real receipt looks like. Cached in tests/fixtures/.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(DIR, { recursive: true });

function html(shop, lines, total, day) {
  const rows = lines.map(([n, a]) => `<tr><td>${n}</td><td style="text-align:right">${a}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#cfcac0;display:flex;align-items:center;justify-content:center;width:420px;height:560px">
  <div style="width:300px;background:#fbfaf6;padding:22px 20px;font:13px/1.45 'Courier New',monospace;color:#222;transform:rotate(-2deg);box-shadow:0 2px 6px rgba(0,0,0,.25)">
  <div style="text-align:center;font-weight:bold;font-size:15px">${shop}</div>
  <div style="text-align:center;font-size:11px;margin-bottom:10px">${day} 12:41  TABLE 7</div>
  <table style="width:100%;border-collapse:collapse">${rows}</table>
  <div style="border-top:1px dashed #555;margin:8px 0"></div>
  <table style="width:100%"><tr><td><b>TOTAL</b></td><td style="text-align:right"><b>${total}</b></td></tr></table>
  <div style="text-align:center;font-size:11px;margin-top:12px">THANK YOU</div></div></body></html>`;
}

const SPECS = {
  lunch: ['DIN TAI FUNG', [['Xiao long bao x2', '16.60'], ['Fried rice', '8.90'], ['Tea', '2.30']], 'SGD 27.80', '2026-11-03'],
  hotel: ['HOTEL GRACERY', [['Room 3 nights', '90,000'], ['City tax', '6,000']], 'JPY 96,000', '2026-10-22'],
  taxi: ['COMFORTDELGRO', [['Fare', '11.20'], ['Booking fee', '1.20']], 'SGD 12.40', '2026-11-03'],
  dinner: ['JUMBO SEAFOOD', [['Chilli crab', '68.00'], ['Mantou x6', '7.20'], ['Beer x2', '9.00']], 'SGD 84.20', '2026-11-01'],
};

/** PNG bytes of a named receipt (rendered once, then read from disk). */
export async function receipt(name = 'lunch') {
  const file = join(DIR, name + '.png');
  if (existsSync(file)) return readFileSync(file);
  const require = createRequire('C:/Users/zfoong/Desktop/agent/code/git/CraftBot/app/ui_layer/browser/frontend/package.json');
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 560 } });
  const s = SPECS[name] ?? SPECS.lunch;
  await page.setContent(html(...s));
  const buf = await page.screenshot({ type: 'png' });
  await browser.close();
  writeFileSync(file, buf);
  return buf;
}
