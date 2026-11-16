/**
 * The PDF text layer (Research OS engine/pdftext.mjs, kept whole in its
 * reading): pdf.js (the library the reader draws pages with, from the
 * frontend's node_modules) reads each page's text and positioned items.
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
 * Used by engine/textlayer.mjs (readPdf); also runnable on its own:
 *   node engine/pdftext.mjs <input.pdf> <output.json> [timeout seconds]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PDFJS_DIR = join(here, '..', 'frontend', 'node_modules', 'pdfjs-dist');

function r2(n) {
  return Math.round(n * 100) / 100;
}

/** Read a PDF buffer: { engine, numPages, pages: [{ page_no, width, height, rotate, text, items }], outline, info }. */
export async function readPdf(buf) {
  const version = JSON.parse(readFileSync(join(PDFJS_DIR, 'package.json'), 'utf8')).version;
  const pdfjs = await import(pathToFileURL(join(PDFJS_DIR, 'legacy', 'build', 'pdf.mjs')).href);
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    standardFontDataUrl: join(PDFJS_DIR, 'standard_fonts') + '/',
    cMapUrl: join(PDFJS_DIR, 'cmaps') + '/',
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
    info = { title: String(i.Title || '').slice(0, 1000), author: String(i.Author || '').slice(0, 1000), subject: String(i.Subject || '').slice(0, 1000), creator: String(i.Creator || '').slice(0, 300), producer: String(i.Producer || '').slice(0, 300) };
  } catch {
    info = {};
  }
  const numPages = doc.numPages;
  try {
    await task.destroy();
  } catch {
    /* the process ends anyway */
  }
  return { engine: 'pdfjs-' + version, numPages, pages, outline, info };
}

/** The error code of a pdf.js failure. */
export function pdfErrorCode(err) {
  return err && err.name === 'PasswordException' ? 'password' : err && err.name === 'InvalidPDFException' ? 'invalid_pdf' : 'error';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { writeFileSync } = await import('node:fs');
  const [input, output] = process.argv.slice(2);
  try {
    const r = await readPdf(readFileSync(input));
    writeFileSync(output, JSON.stringify(Object.assign({ ok: true }, r)));
  } catch (err) {
    writeFileSync(output, JSON.stringify({ ok: false, error: String((err && err.message) || err).slice(0, 1500), code: pdfErrorCode(err) }));
  }
}
