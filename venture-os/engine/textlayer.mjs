/**
 * The text step of every stored file (hook-spawned by lib_files, one process
 * per file, never waited on by a request):
 *
 *   node engine/textlayer.mjs <kind> <input file> <output.json> [timeout seconds]
 *
 * kind: pdf (pdf.js text layer, engine/pdftext.mjs), office (PPTX slides and
 * DOCX text read from the Office Open XML package), plain (UTF-8 text),
 * image (one page with no text: it waits for OCR), none (only the hash).
 *
 * Writes <output>.tmp and renames it to <output> when complete, so the app
 * never reads half a file:
 *   { ok: true, engine, kind, sha256, bytes, numPages, pages: [{ page_no, width, height, rotate, text, items, origin }], outline, info }
 *   { ok: false, error, code, sha256?, bytes? }
 */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { pdfErrorCode, readPdf } from './pdftext.mjs';

const [kind, input, output, timeoutArg] = process.argv.slice(2);
const timeoutS = Number(timeoutArg) > 0 ? Number(timeoutArg) : 600;
const PLAIN_PAGE = 200000;

function write(obj) {
  writeFileSync(output + '.tmp', JSON.stringify(obj));
  renameSync(output + '.tmp', output);
}

/* ------------------------------------------------------------ zip (OOXML) */

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw Object.assign(new Error('This file is not an Office document (no zip directory).'), { code: 'invalid_office' });
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    entries.set(buf.toString('utf8', off + 46, off + 46 + nameLen), { method, csize, local });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => entries.has(name),
    text(name) {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return data.toString('utf8');
      if (e.method === 8) return inflateRawSync(data).toString('utf8');
      throw Object.assign(new Error('Unsupported compression in ' + name + '.'), { code: 'invalid_office' });
    },
  };
}

function decode(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

/**
 * The text of an OOXML part: the character data of `textTag` elements, a new
 * line at the end of each `paraTag` element and at each break tag.
 */
function xmlText(xml, textTag, paraTag, breakTags, tabTag) {
  const re = /<(\/?)([A-Za-z0-9:_.-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let out = '';
  let inText = 0;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[5] !== undefined) {
      if (inText > 0) out += decode(m[5]);
      continue;
    }
    const closing = m[1] === '/';
    const name = m[2];
    const selfClosing = m[4] === '/';
    if (name === textTag) {
      if (closing) inText = Math.max(0, inText - 1);
      else if (!selfClosing) inText++;
    } else if (name === paraTag && (closing || selfClosing)) out += '\n';
    else if (breakTags.indexOf(name) >= 0 && !closing) out += '\n';
    else if (name === tabTag && !closing) out += '\t';
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function attr(tagText, name) {
  const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tagText);
  return m ? m[1] : '';
}

/** PPTX: one page per slide, in presentation order (ppt/presentation.xml with its relationships). */
function readPptx(zip) {
  const pres = zip.text('ppt/presentation.xml');
  const rels = zip.text('ppt/_rels/presentation.xml.rels');
  if (pres === null || rels === null) throw Object.assign(new Error('This presentation has no slide list.'), { code: 'invalid_office' });
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) target[attr(m[0], 'Id')] = attr(m[0], 'Target');
  const pages = [];
  for (const m of pres.matchAll(/<p:sldId\b[^>]*>/g)) {
    const t = target[attr(m[0], 'r:id')];
    if (!t) continue;
    const path = 'ppt/' + t.replace(/^\/?ppt\//, '').replace(/^\.\//, '');
    const xml = zip.text(path);
    if (xml === null) continue;
    pages.push({ page_no: pages.length + 1, width: 0, height: 0, rotate: 0, text: xmlText(xml, 'a:t', 'a:p', ['a:br'], ''), items: [], origin: 'office' });
  }
  return pages;
}

/** DOCX: the document body as pages of at most PLAIN_PAGE characters. */
function readDocx(zip) {
  const xml = zip.text('word/document.xml');
  if (xml === null) throw Object.assign(new Error('This document has no body.'), { code: 'invalid_office' });
  return splitPages(xmlText(xml, 'w:t', 'w:p', ['w:br', 'w:cr'], 'w:tab'), 'office');
}

function splitPages(text, origin) {
  const pages = [];
  let rest = text;
  while (rest.length > 0 || pages.length === 0) {
    let cut = rest.length;
    if (cut > PLAIN_PAGE) {
      cut = rest.lastIndexOf('\n', PLAIN_PAGE);
      if (cut <= 0) cut = PLAIN_PAGE;
      else cut += 1;
    }
    pages.push({ page_no: pages.length + 1, width: 0, height: 0, rotate: 0, text: rest.slice(0, cut), items: [], origin });
    rest = rest.slice(cut);
    if (rest.length === 0) break;
  }
  return pages;
}

/* ------------------------------------------------------------------- run */

async function main() {
  if (!kind || !input || !output) {
    console.error('usage: node textlayer.mjs <pdf|office|plain|image|none> <input> <output.json> [timeout seconds]');
    process.exit(2);
  }
  const timer = setTimeout(() => {
    write({ ok: false, error: 'Reading this file took longer than ' + timeoutS + ' seconds.', code: 'timeout' });
    process.exit(0);
  }, timeoutS * 1000);
  timer.unref();
  const buf = readFileSync(input);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const base = { ok: true, kind, sha256, bytes: buf.length, outline: [], info: {} };
  try {
    if (kind === 'pdf') {
      const r = await readPdf(buf);
      for (const p of r.pages) p.origin = p.text.replace(/\s/g, '').length > 0 ? 'pdf_text' : 'none';
      write(Object.assign(base, r));
    } else if (kind === 'office') {
      const zip = unzip(buf);
      const pages = zip.has('ppt/presentation.xml') ? readPptx(zip) : zip.has('word/document.xml') ? readDocx(zip) : [];
      write(Object.assign(base, { engine: 'ooxml', numPages: pages.length, pages }));
    } else if (kind === 'plain') {
      const text = buf.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      const pages = splitPages(text, 'plain');
      write(Object.assign(base, { engine: 'plain', numPages: pages.length, pages }));
    } else if (kind === 'image') {
      write(Object.assign(base, { engine: 'image', numPages: 1, pages: [{ page_no: 1, width: 0, height: 0, rotate: 0, text: '', items: [], origin: 'none' }] }));
    } else write(Object.assign(base, { engine: 'none', numPages: 0, pages: [] }));
  } catch (err) {
    write({ ok: false, error: String((err && err.message) || err).slice(0, 1500), code: kind === 'pdf' ? pdfErrorCode(err) : (err && err.code) || 'error', sha256, bytes: buf.length });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
  try {
    write({ ok: false, error: String((err && err.message) || err).slice(0, 1500), code: 'error' });
  } catch {
    /* nowhere to write */
  }
  process.exit(0);
});
