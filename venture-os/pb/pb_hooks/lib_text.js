/// <reference path="../pb_data/types.d.ts" />
/**
 * Text layers and anchors (kernel-records, SPEC 4.5; Research OS lib_text).
 *
 * A page's text is its items' strings in order with "\n" after line ends
 * (engine/pdftext.mjs). An anchor names [start, end) in that text on one
 * page of one file version; its quote is that slice and its rectangles come
 * from the items' positions, so neither can disagree with the page. A
 * message anchor names [start, end) of a message body kept by another
 * module (message_id, with the record that holds the text).
 *
 * Your AI agent reads pages as numbered lines (files.text) and anchors by
 * line numbers, offsets or an exact quote; screens anchor by the offsets of
 * a selection. pages.set-ocr turns your AI agent's reading of a scanned page
 * into that page's text layer.
 *
 * Exports for other modules (exact signatures):
 *   anchor(ctx, { file, page, start?, end?, lines?, from_char?, to_char?, quote?, area? }) -> anchor view
 *   messageAnchor(ctx, { message_id, ref_collection?, ref_id?, start, end, quote, deal? }) -> anchor view
 *   resolve(ctx, anchorIds, { deal? }) -> [{ id, ok, reason?, ... }]   (deal: a memo's citation scope)
 *   resolveSpec(ctx, spec) -> { file, page, start, end, quote, rects, kind, area }  (checks without saving)
 *   storePages(app, fileId, engineResult, ocrBelowChars) -> { state, ocr_pages } | null
 *   lineSpans(text) -> [[start, end]]     rectsFor(items, start, end) -> [[left, top, width, height, angle]]
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function F() {
  return L('lib_files');
}

/* Helvetica advance widths (1/1000 em) for ASCII 32..126: an estimate of where a character sits inside a text item. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500,
  667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500,
  722, 500, 500, 500, 334, 260, 334, 584,
];

function charW(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return WIDTHS[c - 32];
  if (c >= 0x2e80) return 1000;
  return 556;
}

function widthOf(s, a, b) {
  let w = 0;
  for (let i = a; i < b; i++) w += charW(s.charAt(i));
  return w;
}

function lineSpans(textValue) {
  const out = [];
  let start = 0;
  for (let i = 0; i <= textValue.length; i++) {
    if (i === textValue.length || textValue.charAt(i) === '\n') {
      out.push([start, i]);
      start = i + 1;
    }
  }
  return out;
}

function itemOffsets(items) {
  const starts = [];
  let pos = 0;
  for (const it of items) {
    starts.push(pos);
    pos += String(it[0]).length + (it[6] ? 1 : 0);
  }
  return starts;
}

/** Rectangles for [start, end) on a page: [left, top, width, height, angle] in page units; pieces on one line joined. */
function rectsFor(items, start, end) {
  const starts = itemOffsets(items);
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const s = String(it[0]);
    const a0 = starts[i];
    const a1 = a0 + s.length;
    if (s.length === 0 || a1 <= start || a0 >= end) continue;
    const from = Math.max(0, start - a0);
    const to = Math.min(s.length, end - a0);
    const total = widthOf(s, 0, s.length) || 1;
    const x0 = it[1] + (it[4] * widthOf(s, 0, from)) / total;
    const w = (it[4] * widthOf(s, from, to)) / total;
    const r = [Math.round(x0 * 100) / 100, it[2], Math.round(w * 100) / 100, it[3], it[5] || 0];
    const last = out[out.length - 1];
    if (last && last[4] === r[4] && Math.abs(last[1] - r[1]) < r[3] * 0.5 && r[0] - (last[0] + last[2]) < r[3] * 1.2 && r[0] >= last[0] - 1) {
      const right = Math.max(last[0] + last[2], r[0] + r[2]);
      last[2] = Math.round((right - last[0]) * 100) / 100;
      last[3] = Math.max(last[3], r[3]);
    } else out.push(r);
  }
  return out;
}

function areaText(items, box) {
  const starts = itemOffsets(items);
  const parts = [];
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const cx = it[1] + it[4] / 2;
    const cy = it[2] + it[3] / 2;
    if (cx >= box[0] && cx <= box[0] + box[2] && cy >= box[1] && cy <= box[1] + box[3]) {
      parts.push(String(it[0]) + (it[6] ? '\n' : ' '));
      if (lo < 0) lo = starts[i];
      hi = starts[i] + String(it[0]).length;
    }
  }
  return { quote: parts.join('').replace(/[ \t]+/g, ' ').trim(), start: lo < 0 ? 0 : lo, end: hi < 0 ? 0 : hi };
}

/** Whitespace collapsed to single spaces, with the original offset of each kept character. */
function squashMap(t) {
  let out = '';
  const map = [];
  let space = false;
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
      if (!space && out.length > 0) {
        out += ' ';
        map.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    out += c;
    map.push(i);
  }
  return { text: out, map: map };
}

function squashed(s) {
  return String(s || '')
    .split(/\s+/)
    .filter((x) => x !== '')
    .join(' ');
}

/* ------------------------------------------------------- storing a layer */

/**
 * storePages(app, fileId, result, ocrBelowChars): the engine's answer into
 * pages and the file's file_texts row (inside the caller's transaction,
 * never an op's). null when the file is no longer waiting for it.
 */
function storePages(app, fileId, result, ocrBelowChars) {
  const util = u();
  const below = ocrBelowChars || 20;
  const fr = util.findOne(app, 'file_texts', 'file = {:f}', { f: fileId });
  if (fr === null || fr.getString('state') !== 'extracting') return null;
  if (result && result.sha256) fr.set('sha256', String(result.sha256));
  if (!result || result.ok !== true) {
    fr.set('state', 'failed');
    fr.set('error', result && result.code === 'password' ? 'This PDF is password protected.' : result && result.code === 'invalid_pdf' ? 'This file is not a readable PDF.' : util.clip(String((result && result.error) || 'Unknown error'), 2000));
    app.save(fr);
    return { state: 'failed', ocr_pages: [] };
  }
  for (const old of app.findRecordsByFilter('pages', 'file = {:f}', '', 0, 0, { f: fileId })) app.delete(app.findRecordById('pages', old.id));
  let withText = 0;
  const ocr = [];
  for (const pg of result.pages || []) {
    const t = String(pg.text || '');
    const chars = t.replace(/\s/g, '').length;
    const imageLike = pg.origin === 'pdf_text' || pg.origin === 'none';
    const needs = imageLike && chars < below;
    const rec = util.newRecord(app, 'pages');
    rec.set('file', fileId);
    rec.set('page_no', pg.page_no);
    rec.set('width', Number(pg.width) || 0);
    rec.set('height', Number(pg.height) || 0);
    rec.set('rotate', Number(pg.rotate) || 0);
    rec.set('text', t);
    rec.set('items', pg.items || []);
    rec.set('lines', lineSpans(t));
    rec.set('chars', chars);
    rec.set('needs_ocr', needs);
    rec.set('origin', chars === 0 ? 'none' : pg.origin === 'none' ? 'pdf_text' : pg.origin);
    app.save(rec);
    if (needs) ocr.push(pg.page_no);
    else if (chars > 0) withText++;
  }
  const n = (result.pages || []).length;
  fr.set('pages', n);
  fr.set('pages_with_text', withText);
  fr.set('ocr_pages', 0);
  fr.set('engine', util.clip(String(result.engine || ''), 60));
  fr.set('meta', { outline: result.outline || [], info: result.info || {} });
  fr.set('state', n === 0 ? 'none' : withText === 0 && ocr.length > 0 ? 'needs_ocr' : 'ready');
  fr.set('error', '');
  if (result.sha256) {
    const file = app.findRecordById('files', fileId);
    const twin = util.one(app, "SELECT f.id AS id FROM file_texts x JOIN files f ON f.id = x.file WHERE x.sha256 = {:s} AND f.id != {:me} AND f.deleted_at = '' ORDER BY (f.owner_id = {:o}) DESC, f.created LIMIT 1", { id: '' }, { s: String(result.sha256), me: fileId, o: file.getString('owner_id') });
    fr.set('same_as', twin !== null ? twin.id : '');
  }
  app.save(fr);
  return { state: fr.getString('state'), ocr_pages: ocr };
}

/* --------------------------------------------------------------- pages */

function pageOf(app, fileId, pageNo) {
  const util = u();
  const pg = util.findOne(app, 'pages', 'file = {:f} && page_no = {:n}', { f: fileId, n: pageNo });
  if (pg === null) {
    const n = util.count(app, 'SELECT COUNT(*) AS n FROM pages WHERE file = {:f}', { f: fileId });
    throw util.fail(n === 0 ? 409 : 400, n === 0 ? 'This file has no text layer yet (it is still being read, or it has none).' : 'Page ' + pageNo + ' is not in this file (1 to ' + n + ').', n === 0 ? 'text_not_ready' : 'no_page', { page: pageNo });
  }
  return pg;
}

/** The file once its text step ended (reads first store a finished engine answer; writes never do). */
function ready(app, f, collect) {
  if (collect) F().collectFor(app, [f.id]);
  const t = F().textsOf(app, [f.id])[f.id];
  const st = t ? t.state : 'waiting';
  if (st === 'waiting' || st === 'extracting') {
    // The read moved this file to the front of the text step; say so, and how to read it now.
    const plain = ['txt', 'md', 'csv', 'tsv', 'vtt', 'srt', 'json', 'eml'].indexOf(f.getString('ext')) >= 0;
    throw u().fail(409, 'The app is still reading this file (' + st + '). It is now first in line: ' + (plain ? 'a text file is ready within seconds' : 'a deck starts when one of the two readers frees, usually within two minutes') + '. Try again then, or read it now from files.download --file ' + f.id + ' (the local path) with your own tools.', 'text_not_ready', { text_state: st, file: f.id, retry_after_s: plain ? 5 : 120 });
  }
  return { file: f, text: t };
}

/** files.text: pages as numbered lines [n, start, end, text], for reading and anchoring by line. */
function opText(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = ready(app, F().fileFor(ctx, util.req(p, 'file'), {}), true);
  const f = r.file;
  const total = r.text.pages;
  const from = util.int(p, 'from', 1, 1, 100000);
  const to = Math.min(util.int(p, 'to', Math.min(Math.max(total, 1), from + 9), 1, 100000), from + 49, Math.max(total, 1));
  const pages = app.findRecordsByFilter('pages', 'file = {:f} && page_no >= {:a} && page_no <= {:b}', 'page_no', 0, 0, { f: f.id, a: from, b: to });
  return {
    file: f.id,
    name: f.getString('name'),
    text_state: r.text.state,
    pages_total: total,
    from: from,
    to: to,
    next_from: to < total ? to + 1 : null,
    needs_ocr: util.rows(app, 'SELECT page_no FROM pages WHERE file = {:f} AND needs_ocr = TRUE ORDER BY page_no', { page_no: 0 }, { f: f.id }).map((r) => r.page_no),
    pages: pages.map((pg) => {
      const t = pg.getString('text');
      const spans = util.jsonOf(pg, 'lines') || [];
      return { page: pg.getInt('page_no'), origin: pg.getString('origin'), needs_ocr: pg.getBool('needs_ocr'), lines: spans.map((sp, i) => [i + 1, sp[0], sp[1], t.slice(sp[0], sp[1])]).filter((l) => l[3].trim() !== '') };
    }),
    how_to_anchor: 'anchors.create --file <id> --page <n> with --lines "a-b" (from these line numbers), --start and --end offsets, or --quote "<exact text on the page>".',
  };
}

/** pages.get: pages with positioned items for the reader. */
function opPagesGet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = ready(app, F().fileFor(ctx, util.req(p, 'file'), {}), true).file;
  const from = util.int(p, 'from', 1, 1, 100000);
  const to = Math.min(util.int(p, 'to', from, 1, 100000), from + 19);
  const pages = app.findRecordsByFilter('pages', 'file = {:f} && page_no >= {:a} && page_no <= {:b}', 'page_no', 0, 0, { f: f.id, a: from, b: to });
  const anchors = app.findRecordsByFilter('anchors', 'file = {:f} && page_no >= {:a} && page_no <= {:b}', 'page_no', 0, 0, { f: f.id, a: from, b: to });
  return {
    file: f.id,
    pages: pages.map((pg) => ({ page: pg.getInt('page_no'), width: pg.getFloat('width'), height: pg.getFloat('height'), rotate: pg.getInt('rotate'), origin: pg.getString('origin'), needs_ocr: pg.getBool('needs_ocr'), text: pg.getString('text'), items: util.jsonOf(pg, 'items') || [] })),
    anchors: anchors.map((a) => anchorOut(app, a)),
  };
}

/**
 * pages.set-ocr: your AI agent's reading of a page with little or no text:
 * --words (boxes from an OCR tool: text, x0, top, x1, bottom in points) or
 * --text (plain lines when there are no boxes). A page with anchors keeps its text.
 */
function opSetOcr(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r0 = ready(app, F().fileFor(ctx, util.req(p, 'file'), { write: true }), false);
  const f = r0.file;
  const pageNo = util.int(p, 'page', 0, 1, 100000);
  if (pageNo === 0) throw util.fail(400, 'page is required (1-based).', 'missing_param', { param: 'page' });
  const pg = pageOf(app, f.id, pageNo);
  if (util.count(app, 'SELECT COUNT(*) AS n FROM anchors WHERE file = {:f} AND page_no = {:n}', { f: f.id, n: pageNo }) > 0) throw util.fail(409, 'Page ' + pageNo + ' already has anchors on its text; it keeps that text.', 'page_has_anchors');
  const words = util.list(p, 'words') || [];
  const plain = util.text(p, 'text', 200000, '');
  if (words.length === 0 && plain === '') throw util.fail(400, 'Give --words (JSON list of {"text","x0","top","x1","bottom"}) or --text.', 'missing_param', { param: 'words' });
  if (words.length > 20000) throw util.fail(400, 'At most 20000 words per page.', 'too_many');
  let t = '';
  const items = [];
  let lineCount = 0;
  if (words.length > 0) {
    const clean = words.map((wd, i) => {
      util.keysOnly(wd, ['text', 'x0', 'top', 'x1', 'bottom'], 'Word ' + (i + 1));
      const s = squashed(wd.text);
      const nums = ['x0', 'top', 'x1', 'bottom'].map((k) => Number(wd[k]));
      if (s === '' || nums.some((n) => !Number.isFinite(n))) throw util.fail(400, 'Word ' + (i + 1) + ' needs text and numeric x0, top, x1, bottom.', 'invalid_param', { param: 'words' });
      return { t: s, x0: nums[0], top: nums[1], x1: Math.max(nums[2], nums[0] + 0.5), bottom: Math.max(nums[3], nums[1] + 0.5) };
    });
    clean.sort((a, b) => a.top - b.top || a.x0 - b.x0);
    const lines = [];
    for (const wd of clean) {
      const mid = (wd.top + wd.bottom) / 2;
      const line = lines.filter((l) => Math.abs(l.mid - mid) < (wd.bottom - wd.top) * 0.5)[0];
      if (line) line.words.push(wd);
      else lines.push({ mid: mid, words: [wd] });
    }
    lines.sort((a, b) => a.mid - b.mid);
    for (const l of lines) {
      l.words.sort((a, b) => a.x0 - b.x0);
      l.words.forEach((wd, j) => {
        const last = j === l.words.length - 1;
        const s = wd.t + (last ? '' : ' ');
        items.push([s, Math.round(wd.x0 * 100) / 100, Math.round(wd.top * 100) / 100, Math.round((wd.bottom - wd.top) * 100) / 100, Math.round((wd.x1 - wd.x0) * 100) / 100, 0, last ? 1 : 0]);
        t += s + (last ? '\n' : '');
      });
    }
    lineCount = lines.length;
  } else {
    t = plain.replace(/\r\n?/g, '\n');
    lineCount = lineSpans(t).length;
  }
  const before = r0.text.state;
  let after = before;
  L('lib_records').inRun(ctx, 'pages.set-ocr', (tx) => {
    const r = tx.findRecordById('pages', pg.id);
    r.set('text', t);
    r.set('items', items);
    r.set('lines', lineSpans(t));
    r.set('origin', 'ocr');
    r.set('chars', t.replace(/\s/g, '').length);
    r.set('needs_ocr', false);
    tx.save(r);
    const ft = util.findOne(tx, 'file_texts', 'file = {:f}', { f: f.id });
    ft.set('ocr_pages', util.count(tx, "SELECT COUNT(*) AS n FROM pages WHERE file = {:f} AND origin = 'ocr'", { f: f.id }));
    ft.set('pages_with_text', util.count(tx, 'SELECT COUNT(*) AS n FROM pages WHERE file = {:f} AND chars > 0 AND needs_ocr = FALSE', { f: f.id }));
    if (ft.getString('state') === 'needs_ocr' && ft.getInt('pages_with_text') > 0) ft.set('state', 'ready');
    tx.save(ft);
    after = ft.getString('state');
    return { summary: 'Read page ' + pageNo + ' of ' + f.getString('name'), type: 'files', id: f.id };
  });
  const left = util.count(app, 'SELECT COUNT(*) AS n FROM pages WHERE file = {:f} AND needs_ocr = TRUE', { f: f.id });
  // Your AI agent's reading lands the page_ocr ask of the file (the person sees it done).
  if (ctx.isAgent) L('lib_agent').landed(app, 'page_ocr', app.findRecordById('files', f.id));
  if (before === 'needs_ocr' && after === 'ready') L('lib_records').emit(ctx, 'file.text_ready', { file: f.id, text_state: 'ready', ocr_pages: [], owner_collection: f.getString('owner_collection'), owner_id: f.getString('owner_id'), deal: f.getString('deal') });
  return { file: f.id, page: pageNo, lines: lineCount, chars: t.replace(/\s/g, '').length, pages_needing_ocr: left, text_state: after };
}

/* -------------------------------------------------------------- anchors */

/**
 * resolveSpec(ctx, spec) -> { file, page, start, end, quote, rects, kind, area }.
 * spec: file, page, and one of start+end | lines ("12-14") [+ from_char, to_char] | quote | area ([x, y, w, h]).
 */
function resolveSpec(ctx, spec) {
  const util = u();
  const app = ctx.app;
  util.keysOnly(spec, ['file', 'page', 'start', 'end', 'lines', 'from_char', 'to_char', 'quote', 'area'], 'Anchor');
  const f = ready(app, F().fileFor(ctx, String(spec.file || ''), {}), false).file;
  let pageNo = util.int(spec, 'page', 0, 1, 100000);
  const quote = squashed(spec.quote);
  if (pageNo === 0 && quote !== '') {
    for (const pg of app.findRecordsByFilter('pages', 'file = {:f}', 'page_no', 0, 0, { f: f.id })) {
      if (squashMap(pg.getString('text')).text.indexOf(quote) >= 0) {
        pageNo = pg.getInt('page_no');
        break;
      }
    }
    if (pageNo === 0) throw util.fail(400, 'Anchor: that quote is not on any page of ' + f.getString('name') + ' (it must match the page text exactly, spaces aside).', 'quote_not_found');
  }
  if (pageNo === 0) throw util.fail(400, 'Anchor: page is required (1-based).', 'missing_param', { param: 'page' });
  const pg = pageOf(app, f.id, pageNo);
  const t = pg.getString('text');
  const items = util.jsonOf(pg, 'items') || [];
  if (spec.area !== undefined && spec.area !== null && spec.area !== '') {
    let box = spec.area;
    if (typeof box === 'string') {
      try {
        box = JSON.parse(box);
      } catch {
        box = null;
      }
    }
    if (!Array.isArray(box) || box.length !== 4 || box.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw util.fail(400, 'Anchor: area is [x, y, width, height] in page units.', 'invalid_param', { param: 'area' });
    const W = pg.getFloat('width') || 10000;
    const H = pg.getFloat('height') || 10000;
    const b = [Math.max(0, box[0]), Math.max(0, box[1]), Math.max(1, Math.min(box[2], W)), Math.max(1, Math.min(box[3], H))];
    const at = areaText(items, b);
    return { file: f, page: pageNo, start: at.start, end: at.end, quote: at.quote.slice(0, 40000), rects: [[b[0], b[1], b[2], b[3], 0]], kind: 'area', area: b };
  }
  let start;
  let end;
  if (quote !== '' && spec.start === undefined && spec.lines === undefined) {
    const sm = squashMap(t);
    const at = sm.text.indexOf(quote);
    if (at < 0) throw util.fail(400, 'Anchor: that quote is not on page ' + pageNo + ' (it must match the page text exactly, spaces aside).', 'quote_not_found', { page: pageNo });
    start = sm.map[at];
    end = sm.map[at + quote.length - 1] + 1;
  } else if (spec.lines !== undefined && spec.lines !== null && spec.lines !== '') {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(String(spec.lines).trim());
    if (m === null) throw util.fail(400, 'Anchor: lines is "a-b" or "a" (line numbers from files.text).', 'invalid_param', { param: 'lines' });
    const spans = util.jsonOf(pg, 'lines') || [];
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    if (a < 1 || b < a || b > spans.length) throw util.fail(400, 'Anchor: page ' + pageNo + ' has lines 1 to ' + spans.length + '.', 'anchor_out_of_range', { lines: spans.length });
    start = spans[a - 1][0];
    end = spans[b - 1][1];
    const fc = util.int(spec, 'from_char', 0, 0, 100000);
    const tc = util.int(spec, 'to_char', 0, 0, 100000);
    if (fc > 0) start = Math.min(spans[a - 1][0] + fc, spans[a - 1][1]);
    if (tc > 0) end = Math.min(spans[b - 1][0] + tc, spans[b - 1][1]);
  } else {
    start = util.int(spec, 'start', -1, 0, 10000000);
    end = util.int(spec, 'end', -1, 0, 10000000);
    if (start < 0 || end < 0) throw util.fail(400, 'Anchor: give --lines "a-b", --start and --end, or --quote.', 'missing_param');
  }
  if (end <= start || end > t.length) throw util.fail(400, 'Anchor: offsets must lie inside page ' + pageNo + "'s text (0 to " + t.length + ') with end after start.', 'anchor_out_of_range', { length: t.length });
  while (start < end && /\s/.test(t.charAt(start))) start++;
  while (end > start && /\s/.test(t.charAt(end - 1))) end--;
  if (end <= start) throw util.fail(400, 'Anchor: that range holds no text.', 'anchor_out_of_range');
  return { file: f, page: pageNo, start: start, end: end, quote: squashed(t.slice(start, end)).slice(0, 40000), rects: rectsFor(items, start, end), kind: 'text', area: null };
}

function anchorOut(app, a) {
  const util = u();
  const f = a.getString('file') !== '' ? util.byId(app, 'files', a.getString('file')) : null;
  return {
    id: a.id,
    kind: a.getString('kind'),
    file: a.getString('file'),
    file_name: f !== null ? f.getString('name') : '',
    version: f !== null ? f.getInt('version') : 0,
    page: a.getInt('page_no'),
    start: a.getInt('start'),
    end: a.getInt('end'),
    quote: a.getString('quote'),
    rects: util.jsonOf(a, 'rects') || [],
    area: util.jsonOf(a, 'area'),
    message_id: a.getString('message_id'),
    ref_collection: a.getString('ref_collection'),
    ref_id: a.getString('ref_id'),
    deal: a.getString('deal'),
    actor: a.getString('actor'),
    created: a.getString('created'),
  };
}

/** anchor(ctx, spec) -> anchor view: a passage on a page (reused when the same passage was anchored before). */
function anchor(ctx, spec) {
  const util = u();
  const r = resolveSpec(ctx, spec);
  const same = util.findOne(ctx.app, 'anchors', 'file = {:f} && page_no = {:p} && start = {:s} && end = {:e} && kind = {:k}', { f: r.file.id, p: r.page, s: r.start, e: r.end, k: r.kind });
  if (same !== null) return anchorOut(ctx.app, same);
  let id = '';
  L('lib_records').inRun(ctx, 'anchors.create', (t) => {
    const a = util.newRecord(t, 'anchors');
    a.set('kind', r.kind);
    a.set('file', r.file.id);
    a.set('page_no', r.page);
    a.set('start', r.start);
    a.set('end', r.end);
    a.set('quote', r.quote);
    a.set('rects', r.rects);
    a.set('area', r.area);
    a.set('deal', r.file.getString('deal'));
    a.set('run', ctx.run || '');
    L('lib_records').stampWritten(ctx, a);
    t.save(a);
    id = a.id;
    return { summary: 'Anchored page ' + r.page + ' of ' + r.file.getString('name'), type: 'anchors', id: a.id };
  });
  return anchorOut(ctx.app, ctx.app.findRecordById('anchors', id));
}

/** messageAnchor(ctx, { message_id, ref_collection, ref_id, start, end, quote, deal }) -> anchor view. */
function messageAnchor(ctx, o) {
  const util = u();
  const mid = util.clip(String(o.message_id || '').trim(), 200);
  if (mid === '') throw util.fail(400, 'message_id is required.', 'missing_param', { param: 'message_id' });
  const start = Number(o.start);
  const end = Number(o.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) throw util.fail(400, 'start and end are offsets in the message body with end after start.', 'invalid_param', { param: 'start' });
  const quote = squashed(o.quote);
  if (quote === '') throw util.fail(400, 'quote is required: the exact words of the message.', 'missing_param', { param: 'quote' });
  const deal = o.deal ? L('lib_deals').ref(ctx.app, o.deal) : null;
  if (deal !== null) L('lib_deals').guard(ctx, deal);
  let id = '';
  L('lib_records').inRun(ctx, 'anchors.create', (t) => {
    const a = util.newRecord(t, 'anchors');
    a.set('kind', 'message');
    a.set('page_no', 0);
    a.set('start', start);
    a.set('end', end);
    a.set('quote', quote.slice(0, 40000));
    a.set('rects', []);
    a.set('message_id', mid);
    a.set('ref_collection', util.clip(String(o.ref_collection || ''), 40));
    a.set('ref_id', util.clip(String(o.ref_id || ''), 20));
    a.set('deal', deal !== null ? deal.id : '');
    a.set('run', ctx.run || '');
    L('lib_records').stampWritten(ctx, a);
    t.save(a);
    id = a.id;
    return { summary: 'Anchored a message passage', type: 'anchors', id: a.id };
  });
  return anchorOut(ctx.app, ctx.app.findRecordById('anchors', id));
}

/**
 * resolve(ctx, ids, { deal }) -> one answer per id:
 *   { id, ok: true, kind, file, file_name, page, quote, rects, valid, in_scope, ... }
 *   { id, ok: false, reason: 'missing' | 'not_visible' | <a file refusal code> }
 * valid: the page still holds the quoted text (null for message anchors,
 * whose text another module keeps). in_scope (when deal is given): the
 * anchor may be cited for that deal: its deal's own files, or files of the
 * deal's company that belong to no deal; a message anchor of that deal.
 */
function resolve(ctx, ids, opts) {
  const util = u();
  const app = ctx.app;
  const o = opts || {};
  let dealRec = null;
  if (o.deal) {
    dealRec = L('lib_deals').ref(app, o.deal);
    L('lib_deals').guard(ctx, dealRec);
  }
  return ids.map((id0) => {
    const id = String(id0 || '').trim();
    const a = util.byId(app, 'anchors', id);
    if (a === null) return { id: id, ok: false, reason: 'missing' };
    const out = anchorOut(app, a);
    if (a.getString('kind') === 'message') {
      if (a.getString('deal') !== '' && !L('lib_deals').visible(ctx, a.getString('deal'))) return { id: id, ok: false, reason: 'not_visible' };
      out.ok = true;
      out.valid = null;
      out.in_scope = dealRec === null ? null : a.getString('deal') === dealRec.id ? true : a.getString('deal') === '' ? null : false;
      return out;
    }
    const f = util.byId(app, 'files', a.getString('file'));
    if (f === null) return { id: id, ok: false, reason: 'missing' };
    const r = F().canRead(ctx, f, { deleted: true });
    if (!r.ok) return { id: id, ok: false, reason: r.reason === 'restricted' || r.reason === 'not_permitted' ? 'not_visible' : r.reason };
    const pg = util.findOne(app, 'pages', 'file = {:f} && page_no = {:n}', { f: f.id, n: a.getInt('page_no') });
    out.ok = true;
    out.valid = pg !== null && squashed(pg.getString('text').slice(a.getInt('start'), a.getInt('end'))) === squashed(a.getString('quote'));
    out.deleted = f.getString('deleted_at') !== '';
    if (dealRec !== null) {
      const fd = f.getString('deal');
      out.in_scope = fd === dealRec.id || (fd === '' && f.getString('owner_collection') === 'companies' && f.getString('owner_id') === dealRec.getString('company'));
    } else out.in_scope = null;
    return out;
  });
}

/* ------------------------------------------------------------------ ops */

function opAnchorCreate(ctx, p) {
  const util = u();
  if (util.str(p, 'message_id', '') !== '') {
    return { anchor: messageAnchor(ctx, { message_id: util.str(p, 'message_id', ''), ref_collection: util.str(p, 'ref_collection', ''), ref_id: util.str(p, 'ref_id', ''), start: util.int(p, 'start', -1, 0, 100000000), end: util.int(p, 'end', -1, 0, 100000000), quote: util.str(p, 'quote', ''), deal: util.str(p, 'deal', '') }) };
  }
  const many = util.list(p, 'passages');
  if (many !== undefined) {
    // Several passages in one call: one anchor each, in order (a bad one is refused with its index).
    if (many.length === 0 || many.length > 50) throw util.fail(400, 'passages is a JSON list of 1 to 50 {"file","page","lines"|"quote"}.', 'invalid_param', { param: 'passages' });
    const out = many.map((x, i) => {
      if (x === null || typeof x !== 'object' || Array.isArray(x)) throw util.fail(400, 'passages[' + i + '] must be an object {"file","page","lines"|"quote"}.', 'invalid_param', { param: 'passages', index: i });
      util.keysOnly(x, ['file', 'page', 'start', 'end', 'lines', 'from_char', 'to_char', 'quote', 'area'], 'passages[' + i + ']');
      try {
        const a = anchor(ctx, Object.assign({}, x));
        return { id: a.id, file: a.file, page: a.page, quote: util.clip(a.quote || '', 160) };
      } catch (err) {
        if (err && typeof err.status === 'number' && err.status < 500) throw util.fail(err.status, 'passages[' + i + ']: ' + String(err.message || err), err.code || 'invalid_param', Object.assign({ index: i }, err.extra || {}));
        throw err;
      }
    });
    return { anchors: out, ids: out.map((a) => a.id) };
  }
  const spec = {};
  for (const k of ['file', 'page', 'start', 'end', 'lines', 'from_char', 'to_char', 'quote', 'area']) if (util.has(p, k) && p[k] !== '') spec[k] = p[k];
  if (!spec.file) throw util.fail(400, 'Give --file (with --page and --lines, --start/--end or --quote), --passages for several, or --message_id.', 'missing_param', { param: 'file' });
  return { anchor: anchor(ctx, spec) };
}

function opAnchorResolve(ctx, p) {
  const util = u();
  const ids = util.list(p, 'anchors') || [];
  if (util.str(p, 'anchor', '') !== '') ids.push(util.str(p, 'anchor', ''));
  if (ids.length === 0) throw util.fail(400, 'Give --anchor <id> or --anchors \'["id1","id2"]\'.', 'missing_param', { param: 'anchors' });
  if (ids.length > 500) throw util.fail(400, 'At most 500 anchors at once.', 'too_many');
  const out = resolve(ctx, ids, { deal: util.str(p, 'deal', '') });
  return { anchors: out, ok: out.filter((x) => x.ok).length, not_ok: out.filter((x) => !x.ok).length };
}

module.exports = {
  lineSpans: lineSpans,
  rectsFor: rectsFor,
  itemOffsets: itemOffsets,
  storePages: storePages,
  resolveSpec: resolveSpec,
  anchor: anchor,
  messageAnchor: messageAnchor,
  resolve: resolve,
  anchorOut: anchorOut,
  opText: opText,
  opPagesGet: opPagesGet,
  opSetOcr: opSetOcr,
  opAnchorCreate: opAnchorCreate,
  opAnchorResolve: opAnchorResolve,
};
