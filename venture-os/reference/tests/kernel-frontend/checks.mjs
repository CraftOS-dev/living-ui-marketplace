// In-page checks shared by audit.mjs, ux_audit.mjs and merged_audit.mjs (each runs in the page via page.evaluate).

export const tokenCheck = () => {
  const rgb = (v) => {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = v;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const tok = (n) => {
    const p = document.createElement('span');
    p.style.color = `var(--vo-${n})`;
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
  const out = [];
  const need = (fg, bg, min) => {
    const r = cr(tok(fg), tok(bg));
    if (r < min) out.push(`${fg} on ${bg} ${r.toFixed(2)} < ${min}`);
  };
  for (const s of ['page', 'side', 'panel', 'raised', 'sunk', 'hover', 'active', 'active-hover']) for (const f of ['ink', 'ink-2', 'muted', 'a', 'b', 'bad', 'warn', 'good']) need(f, s, 4.5);
  for (const s of ['page', 'side', 'panel', 'raised', 'sunk']) need('faint', s, 4.5);
  need('on-ink', 'ink', 4.5);
  need('agent-ink', 'agent', 4.5);
  need('page', 'bad', 4.5);
  const apart = (a, b, min) => {
    const r = cr(tok(a), tok(b));
    if (r < min) out.push(`${a} vs ${b} ${r.toFixed(3)} < ${min}`);
  };
  apart('hover', 'panel', 1.04);
  apart('hover', 'page', 1.04);
  apart('hover', 'raised', 1.04);
  apart('hover', 'side', 1.04);
  apart('active', 'hover', 1.03);
  apart('active-hover', 'active', 1.03);
  apart('active-hover', 'panel', 1.04);
  apart('active-hover', 'page', 1.04);
  apart('active-hover', 'side', 1.04);
  apart('line', 'panel', 1.25);
  apart('line-2', 'panel', 1.5);
  return out;
};

export const textCheck = () => {
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
    if (el.closest('svg') !== null) continue;
    seen.add(el);
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || r.bottom < 0 || r.top > innerHeight) continue;
    let op = 1;
    for (let e = el; e !== null; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if (op < 0.5) continue;
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

export const cursorCheck = () => {
  const sel = 'button:not(:disabled), a[href], [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=menuitem], [role=option], [role=treeitem], select:not(:disabled), [draggable=true]';
  const bad = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // A disabled control keeps the arrow (no action under it).
    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') continue;
    if (getComputedStyle(el).cursor !== 'pointer') bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" cursor ${getComputedStyle(el).cursor}`);
  }
  return bad.slice(0, 10);
};

export const hoverTargets = () => {
  const sel = 'button:not(:disabled), a[href], [role=row][tabindex], [draggable=true]';
  const out = [];
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit === null || !(hit === el || el.contains(hit))) continue;
    el.setAttribute('data-hov', String(i));
    out.push(i++);
    if (out.length >= 60) break;
  }
  return out;
};

export const bgUnder = (i) => {
  const el = document.querySelector(`[data-hov="${i}"]`);
  if (el === null) return null;
  const own = getComputedStyle(el).backgroundColor;
  let parent = 'rgb(255, 255, 255)';
  for (let e = el.parentElement; e !== null; e = e.parentElement) {
    const b = getComputedStyle(e).backgroundColor;
    if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') {
      parent = b;
      break;
    }
  }
  const row = el.closest('li, [role=row], .group');
  // A selected tab, segment or toggle may keep its look under the pointer; a selected ROW (aria-current) must still answer the hover.
  const sel = el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true';
  const svg = el.querySelector('svg');
  return { own, parent, sel, color: getComputedStyle(el).color, border: getComputedStyle(el).borderColor, filter: getComputedStyle(el).filter, deco: getComputedStyle(el).textDecorationColor + getComputedStyle(el).boxShadow, row: row !== null ? getComputedStyle(row).backgroundColor : '', icon: svg !== null ? getComputedStyle(svg).color : '', label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) };
};

export const phoneCheck = () => {
  const bad = [];
  const main = document.getElementById('vo-main');
  if (document.documentElement.scrollWidth > innerWidth + 1 || (main !== null && main.scrollWidth > main.clientWidth + 1)) bad.push(`sideways scroll ${Math.max(document.documentElement.scrollWidth, main?.scrollWidth ?? 0)}`);
  const sel = 'button:not(:disabled), a[href], [role=tab], [role=radio], [role=switch], [role=checkbox], [role=treeitem], input, select, textarea';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('.vo-strip, .vo-scroll') !== null && (r.right > innerWidth || r.left < 0)) continue;
    const st = getComputedStyle(el);
    if (Number(st.opacity) === 0 && el.tagName !== 'INPUT') bad.push(`hidden control "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`);
    let w = r.width;
    let h = r.height;
    if (el.classList.contains('hit')) {
      const after = getComputedStyle(el, '::after');
      w = Math.max(w, parseFloat(after.width) || 0);
      h = Math.max(h, parseFloat(after.height) || 0);
    }
    if (el.tagName === 'INPUT' && st.opacity === '0') continue;
    if (w < 39.5 || h < 39.5) bad.push(`small target ${Math.round(w)}x${Math.round(h)} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}"`);
  }
  return [...new Set(bad)].slice(0, 10);
};

export const typeCheck = () => {
  const ok = new Set(['10.5px', '12px', '13px', '14px', '15px', '26px']);
  const bad = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if ((n.textContent ?? '').trim() === '') continue;
    const el = n.parentElement;
    if (el === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fs = getComputedStyle(el).fontSize;
    if (!ok.has(fs) && !bad.has(fs)) bad.set(fs, (n.textContent ?? '').trim().slice(0, 24));
  }
  return [...bad.entries()].map(([fs, txt]) => `${fs} "${txt}"`);
};
