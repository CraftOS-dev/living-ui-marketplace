// Contrast audit over every CraftBot theme pack in light and dark (the host ThemeBridge message):
//  1. the --hr-* token pairs the screens use (text 4.5:1, faint 3:1, layers apart, lines visible);
//  2. every visible text node on a few pages against the surface really under it (4.5:1; 3:1 for 18px+ or bold 14px+).
import { BASE, chromium, open, settle, signIn, theme } from './lib.mjs';

const PACKS = ['craftbot', 'normal', 'ocean', 'forest', 'pastel', 'glass', 'classic', 'velvet', 'ink', 'acid', 'blueprint', 'modern', 'brutalist', 'drafting', 'clay', 'atelier'];
const PAGES = (process.env.PAGES ?? 'people,people/E0021?tab=job,inbox,settings/roles').split(',');

const tokenCheck = () => {
  const rgb = (v) => {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = v;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const tok = (n) => {
    const p = document.createElement('span');
    p.style.color = `var(--hr-${n})`;
    document.body.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return rgb(c);
  };
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const cr = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const surfaces = ['page', 'side', 'panel', 'raised', 'sunk', 'hover', 'active'];
  const out = [];
  const need = (fg, bg, min) => {
    const r = cr(tok(fg), tok(bg));
    if (r < min) out.push(`${fg} on ${bg} ${r.toFixed(2)} < ${min}`);
  };
  for (const s of surfaces) for (const f of ['ink', 'ink-2', 'muted', 'rh', 'lh', 'bad', 'warn', 'good']) need(f, s, 4.5);
  for (const s of ['page', 'side', 'panel', 'raised', 'sunk']) need('faint', s, 4.5);
  need('on-ink', 'ink', 4.5);
  need('agent-ink', 'agent', 4.5);
  need('page', 'bad', 4.5);
  need('page', 'rh', 3);
  // Layers that must show apart (contrast ratio as a proxy for visible difference).
  const apart = (a, b, min) => {
    const r = cr(tok(a), tok(b));
    if (r < min) out.push(`${a} vs ${b} ${r.toFixed(3)} < ${min}`);
  };
  apart('hover', 'panel', 1.04);
  apart('hover', 'page', 1.04);
  apart('hover', 'raised', 1.04);
  apart('active', 'hover', 1.03);
  apart('line', 'panel', 1.25);
  apart('line-2', 'panel', 1.5);
  return out;
};

const textCheck = () => {
  const rgba = (v) => {
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
  };
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const cr = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e !== null; e = e.parentElement) {
      const b = rgba(getComputedStyle(e).backgroundColor);
      if (b !== null && b[3] > 0) {
        stack.push(b);
        if (b[3] >= 0.99) break;
      }
    }
    let c = [255, 255, 255];
    for (const b of stack.reverse()) c = [c[0] + (b[0] - c[0]) * b[3], c[1] + (b[1] - c[1]) * b[3], c[2] + (b[2] - c[2]) * b[3]];
    return c;
  };
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const el = n.parentElement;
    if (el === null || seen.has(el) || n.textContent.trim() === '') continue;
    seen.add(el);
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || r.bottom < 0 || r.top > innerHeight) continue;
    let op = 1;
    for (let e = el; e !== null; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if (op < 0.5) continue; // disabled controls (opacity 45%) are exempt in WCAG
    const fg = rgba(st.color);
    if (fg === null || fg[3] === 0) continue;
    const bg = bgOf(el);
    const f = [bg[0] + (fg[0] - bg[0]) * fg[3], bg[1] + (fg[1] - bg[1]) * fg[3], bg[2] + (fg[2] - bg[2]) * fg[3]];
    const size = parseFloat(st.fontSize);
    const large = size >= 18 || (size >= 14 && Number(st.fontWeight) >= 700);
    const ratio = cr(f, bg);
    if (ratio < (large ? 3 : 4.5) - 0.05) bad.push(`${ratio.toFixed(2)} "${n.textContent.trim().slice(0, 28)}"`);
  }
  return bad.slice(0, 8);
};

const browser = await chromium.launch({ headless: true });
const { page } = await open(browser, { width: 1440, height: 900 });
await signIn(page, 'owner@northwind.test', 'demo-pass-1');
let fails = 0;
for (const p of PAGES) {
  await page.goto(BASE + '#/' + p);
  await settle(page, 900);
  for (const pack of PACKS) {
    for (const mode of ['light', 'dark']) {
      await theme(page, pack, mode);
      // Colours ease over 150ms (transition-colors): measure after they settle.
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
console.log(fails === 0 ? `ok: ${PACKS.length} packs x 2 modes x ${PAGES.length} pages, every pairing passes` : `${fails} failures`);
process.exit(fails === 0 ? 0 : 1);
