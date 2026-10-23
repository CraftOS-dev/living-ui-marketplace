/**
 * The text engine: reads a PDF with pdf.js (the same library the reader
 * draws pages with, from the frontend's node_modules) and writes, per page,
 * the text and its positioned items as JSON.
 *
 *   node engine/pdftext.mjs <input.pdf> <output.json> [timeout seconds]
 *
 * Positions are in the page's viewport at scale 1 (points, origin top left,
 * the page's own rotation applied), the space the reader scales. One item:
 *
 *   [str, left, top, height, width, angle, eol]
 *
 * The page text is every item's str in order, with "\n" after items that end
 * a line (eol = 1). Offsets into that text are what anchors store; the
 * reader rebuilds the same text from the same items, so a selection on
 * screen and an offset given by your AI agent name the same characters.
 *
 * Exit code 0 with { ok: true, ... } or { ok: false, error } in the output.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..', 'frontend', 'node_modules', 'pdfjs-dist');
const [input, output, timeoutArg] = process.argv.slice(2);
const timeoutS = Number(timeoutArg) > 0 ? Number(timeoutArg) : 600;

function write(obj) {
  writeFileSync(output, JSON.stringify(obj));
}

function r2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  if (!input || !output) {
    console.error('usage: node pdftext.mjs <input.pdf> <output.json>');
    process.exit(2);
  }
  const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
  const pdfjs = await import(pathToFileURL(join(pkg, 'legacy', 'build', 'pdf.mjs')).href);
  // A watchdog: pdf.js yields between pages, so this fires on a document that takes too long.
  const timer = setTimeout(() => {
    write({ ok: false, error: 'Reading this PDF took longer than ' + timeoutS + ' seconds.', code: 'timeout' });
    process.exit(0);
  }, timeoutS * 1000);
  timer.unref();
  const buf = readFileSync(input);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const data = new Uint8Array(buf);
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: join(pkg, 'standard_fonts') + '/',
    cMapUrl: join(pkg, 'cmaps') + '/',
    cMapPacked: true,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
    const items = [];
    let text = '';
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const tx = pdfjs.Util.transform(vp.transform, it.transform);
      const style = tc.styles[it.fontName] || {};
      let angle = Math.atan2(tx[1], tx[0]);
      if (style.vertical) angle += Math.PI / 2;
      const height = Math.hypot(tx[2], tx[3]);
      const ascent = typeof style.ascent === 'number' && style.ascent > 0 ? style.ascent : typeof style.descent === 'number' ? 1 + style.descent : 0.8;
      const fontAscent = height * ascent;
      let left;
      let top;
      if (angle === 0) {
        left = tx[4];
        top = tx[5] - fontAscent;
      } else {
        left = tx[4] + fontAscent * Math.sin(angle);
        top = tx[5] - fontAscent * Math.cos(angle);
      }
      const width = style.vertical ? it.height : it.width;
      const eol = it.hasEOL ? 1 : 0;
      items.push([it.str, r2(left), r2(top), r2(height), r2(width), Math.round(angle * 1000) / 1000, eol]);
      text += it.str + (eol ? '\n' : '');
    }
    pages.push({ page_no: n, width: r2(vp.width), height: r2(vp.height), rotate: page.rotate || 0, text, items });
    page.cleanup();
  }

  // The document outline, flattened with depth, each entry resolved to a page.
  const outline = [];
  try {
    const raw = await doc.getOutline();
    const walk = async (list, depth) => {
      for (const o of list || []) {
        if (outline.length >= 2000) return;
        let pageNo = 0;
        try {
          let dest = o.dest;
          if (typeof dest === 'string') dest = await doc.getDestination(dest);
          if (Array.isArray(dest) && dest[0]) {
            const ref = dest[0];
            pageNo = typeof ref === 'object' ? (await doc.getPageIndex(ref)) + 1 : Number(ref) + 1;
          }
        } catch {
          pageNo = 0;
        }
        outline.push({ title: String(o.title || '').slice(0, 300), page: pageNo, depth });
        if (o.items && o.items.length > 0 && depth < 6) await walk(o.items, depth + 1);
      }
    };
    await walk(raw, 0);
  } catch {
    /* no outline */
  }

  let info = {};
  try {
    const meta = await doc.getMetadata();
    const i = meta && meta.info ? meta.info : {};
    info = { title: String(i.Title || '').slice(0, 1000), author: String(i.Author || '').slice(0, 1000), subject: String(i.Subject || '').slice(0, 1000), keywords: String(i.Keywords || '').slice(0, 1000), creator: String(i.Creator || '').slice(0, 300), producer: String(i.Producer || '').slice(0, 300) };
  } catch {
    info = {};
  }

  write({ ok: true, engine: 'pdfjs-' + version, sha256, numPages: doc.numPages, pages, outline, info });
  try {
    await task.destroy();
  } catch {
    /* the process ends anyway */
  }
}

main().catch((err) => {
  const msg = String((err && err.message) || err);
  const code = err && err.name === 'PasswordException' ? 'password' : err && err.name === 'InvalidPDFException' ? 'invalid_pdf' : 'error';
  try {
    write({ ok: false, error: msg.slice(0, 1500), code });
  } catch {
    /* nowhere to write */
  }
  process.exit(0);
});
