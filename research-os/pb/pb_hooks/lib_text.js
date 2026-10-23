/// <reference path="../pb_data/types.d.ts" />
/**
 * The text layer and anchors.
 *
 * A page's text is its items' strings in order with "\n" after line ends
 * (engine/pdftext.mjs). An anchor names [start, end) in that text on one
 * page of one file version; its quote is that slice and its rectangles are
 * derived from the items' positions, so neither can disagree with the page.
 *
 * Your AI agent reads pages as numbered lines (pages.text) and anchors by
 * line numbers or by offsets; screens anchor by the offsets of a selection.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
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

function pageOf(app, fileId, pageNo) {
  const util = u();
  const pg = util.findOne(app, 'pages', 'file = {:f} && page_no = {:n}', { f: fileId, n: pageNo });
  if (pg === null) throw util.fail(404, 'Page ' + pageNo + ' has no stored text' + (util.count(app, 'SELECT COUNT(*) AS n FROM pages WHERE file = {:f}', { f: fileId }) === 0 ? ' yet (the PDF is still being read).' : '.'), 'no_page', { page: pageNo });
  return pg;
}

/** Item start offsets in the page text (the same walk the reader does). */
function itemOffsets(items) {
  const starts = [];
  let pos = 0;
  for (const it of items) {
    starts.push(pos);
    pos += String(it[0]).length + (it[6] ? 1 : 0);
  }
  return starts;
}

/**
 * Rectangles for [start, end) on a page: [left, top, width, height, angle]
 * in page units (points at scale 1, origin top left). Pieces on one line are
 * joined.
 */
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

/** The text inside an area box (items whose middle lies in it), with its offset range. */
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

/* ------------------------------------------------------------ the agent */

/** The file a call names: --file, or --work (its current PDF). */
function fileFrom(ctx, p) {
  const util = u();
  const c = core();
  const fileRef = util.str(p, 'file', '');
  let f;
  if (fileRef !== '') f = c.need(ctx.app, 'files', fileRef, 'file');
  else {
    const w = c.work(ctx.app, util.req(p, 'work'));
    f = c.currentFile(ctx.app, w.id);
    if (f === null) throw util.fail(404, 'This paper has no PDF yet. files.fetch-oa downloads an open copy when there is one.', 'no_file', { work: w.id });
  }
  c.guardWork(ctx, c.need(ctx.app, 'works', f.getString('work'), 'paper'));
  return f;
}

/**
 * pages.text: pages as numbered lines (for reading and anchoring by line).
 * Each line: [n, start, end, text]. Lines are numbered from 1 on each page.
 */
function text(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = fileFrom(ctx, p);
  if (f.getString('text_state') === 'waiting' || f.getString('text_state') === 'extracting') throw util.fail(409, 'The PDF is still being read; try again in a moment.', 'text_not_ready');
  const total = f.getInt('pages');
  const from = util.int(p, 'from', 1, 1, 100000);
  const to = Math.min(util.int(p, 'to', Math.min(total, from + 9), 1, 100000), from + 49, total);
  const pages = app.findRecordsByFilter('pages', 'file = {:f} && page_no >= {:a} && page_no <= {:b}', 'page_no', 0, 0, { f: f.id, a: from, b: to });
  const out = pages.map((pg) => {
    const t = pg.getString('text');
    const spans = util.jsonOf(pg, 'lines') || [];
    return {
      page: pg.getInt('page_no'),
      origin: pg.getString('origin'),
      lines: spans.map((sp, i) => [i + 1, sp[0], sp[1], t.slice(sp[0], sp[1])]).filter((l) => l[3].trim() !== ''),
    };
  });
  return {
    file: f.id,
    work: f.getString('work'),
    pages_total: total,
    from: from,
    to: to,
    next_from: to < total ? to + 1 : null,
    needs_ocr: pages.filter((pg) => pg.getString('origin') === 'none').map((pg) => pg.getInt('page_no')),
    pages: out,
    how_to_anchor: 'Anchor a passage with --page <n> --lines "<a>-<b>" (whole lines), optionally --from_char/--to_char inside the first and last line, or with --start/--end offsets.',
  };
}

/** pages.get: pages with positioned items for the reader. */
function get(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = fileFrom(ctx, p);
  const from = util.int(p, 'from', 1, 1, 100000);
  const to = Math.min(util.int(p, 'to', from, 1, 100000), from + 19);
  const pages = app.findRecordsByFilter('pages', 'file = {:f} && page_no >= {:a} && page_no <= {:b}', 'page_no', 0, 0, { f: f.id, a: from, b: to });
  return {
    file: f.id,
    pages: pages.map((pg) => ({ page: pg.getInt('page_no'), width: pg.getFloat('width'), height: pg.getFloat('height'), rotate: pg.getInt('rotate'), origin: pg.getString('origin'), items: util.jsonOf(pg, 'items') || [] })),
  };
}

/** pages.find: where words appear in one paper (hits by page with a snippet). */
function find(ctx, p) {
  const util = u();
  const f = fileFrom(ctx, p);
  const q = util.req(p, 'q', '"attention"');
  return { hits: require(`${__hooks}/lib_search.js`).pageHits(ctx.app, q, { file: f.id, limit: 200, byPage: true }) };
}

/* -------------------------------------------------------------- anchors */

/**
 * Resolve an anchor spec into { file, page, start, end, quote, rects, kind, area }.
 * spec: file|work, page, and one of: start+end | lines ("12-14") [+ from_char, to_char] | area ([x,y,w,h]).
 */
function resolveSpec(ctx, spec) {
  const util = u();
  const app = ctx.app;
  util.keysOnly(spec, ['file', 'work', 'page', 'start', 'end', 'lines', 'from_char', 'to_char', 'area'], 'Passage');
  const f = fileFrom(ctx, spec);
  const pageNo = util.int(spec, 'page', 0, 1, 100000);
  if (pageNo === 0) throw util.fail(400, 'Passage: page is required (1-based).', 'missing_param', { param: 'page' });
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
    if (!Array.isArray(box) || box.length !== 4 || box.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw util.fail(400, 'Passage: area is [x, y, width, height] in page units.', 'invalid_param', { param: 'area' });
    const W = pg.getFloat('width');
    const H = pg.getFloat('height');
    const b = [Math.max(0, box[0]), Math.max(0, box[1]), Math.max(1, Math.min(box[2], W)), Math.max(1, Math.min(box[3], H))];
    const at = areaText(items, b);
    return { file: f, page: pageNo, start: at.start, end: at.end, quote: at.quote.slice(0, 40000), rects: [[b[0], b[1], b[2], b[3], 0]], kind: 'area', area: b };
  }
  let start;
  let end;
  if (spec.lines !== undefined && spec.lines !== null && spec.lines !== '') {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(String(spec.lines).trim());
    if (m === null) throw util.fail(400, 'Passage: lines is "a-b" or "a" (line numbers from pages.text).', 'invalid_param', { param: 'lines' });
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    const spans = util.jsonOf(pg, 'lines') || [];
    if (a < 1 || b < a || b > spans.length) throw util.fail(400, 'Passage: page ' + pageNo + ' has lines 1 to ' + spans.length + '.', 'anchor_out_of_range', { lines: spans.length });
    start = spans[a - 1][0];
    end = spans[b - 1][1];
    const fc = util.int(spec, 'from_char', 0, 0, 100000);
    const tc = util.int(spec, 'to_char', 0, 0, 100000);
    if (fc > 0) start = Math.min(spans[a - 1][0] + fc, spans[a - 1][1]);
    if (tc > 0) end = Math.min(spans[b - 1][0] + tc, spans[b - 1][1]);
  } else {
    start = util.int(spec, 'start', -1, 0, 10000000);
    end = util.int(spec, 'end', -1, 0, 10000000);
    if (start < 0 || end < 0) throw util.fail(400, 'Passage: give lines ("12-14") or start and end offsets.', 'missing_param');
  }
  if (end <= start || end > t.length) throw util.fail(400, 'Passage: offsets must lie inside page ' + pageNo + "'s text (0 to " + t.length + ') with end after start.', 'anchor_out_of_range', { length: t.length });
  // Trim surrounding whitespace so a passage starts and ends on text.
  while (start < end && /\s/.test(t.charAt(start))) start++;
  while (end > start && /\s/.test(t.charAt(end - 1))) end--;
  if (end <= start) throw util.fail(400, 'Passage: that range holds no text.', 'anchor_out_of_range');
  return { file: f, page: pageNo, start: start, end: end, quote: t.slice(start, end).replace(/\s*\n\s*/g, ' ').slice(0, 40000), rects: rectsFor(items, start, end), kind: 'text', area: null };
}

/** Create the anchor for a resolved spec (inside a transaction). */
function createAnchor(tx, ctx, r) {
  const util = u();
  const a = util.newRecord(tx, 'anchors');
  a.set('file', r.file.id);
  a.set('work', r.file.getString('work'));
  a.set('page_no', r.page);
  a.set('start', r.start);
  a.set('end', r.end);
  a.set('quote', r.quote);
  a.set('rects', r.rects);
  a.set('kind', r.kind);
  a.set('area', r.area);
  a.set('actor', ctx.actor);
  tx.save(a);
  return a;
}

function anchorOut(app, a) {
  const c = core();
  const w = u().byId(app, 'works', a.getString('work'));
  return {
    id: a.id,
    file: a.getString('file'),
    work: a.getString('work'),
    work_label: w !== null ? c.workLabel(w) : '',
    work_title: w !== null ? w.getString('title') : '',
    page: a.getInt('page_no'),
    start: a.getInt('start'),
    end: a.getInt('end'),
    quote: a.getString('quote'),
    rects: u().jsonOf(a, 'rects') || [],
    kind: a.getString('kind'),
    area: u().jsonOf(a, 'area'),
    actor: a.getString('actor'),
  };
}

/** anchors.create: a passage on a page (also made by highlights and evidence). */
function create(ctx, p) {
  const spec = {};
  for (const k of ['file', 'work', 'page', 'start', 'end', 'lines', 'from_char', 'to_char', 'area']) if (p[k] !== undefined) spec[k] = p[k];
  const r = resolveSpec(ctx, spec);
  let a = null;
  ctx.app.runInTransaction((tx) => {
    a = createAnchor(tx, ctx, r);
  });
  return { anchor: anchorOut(ctx.app, a) };
}

function getAnchor(ctx, p) {
  const a = core().need(ctx.app, 'anchors', u().req(p, 'anchor'), 'passage');
  core().guardWork(ctx, core().need(ctx.app, 'works', a.getString('work'), 'paper'));
  return { anchor: anchorOut(ctx.app, a) };
}

/* ------------------------------------------------------------------ OCR */

/**
 * pages.set-ocr: your AI agent's reading of a scanned page, as words with
 * their boxes (read_pdf layout mode: x0, top, x1, bottom in points). The
 * words become the page's text layer, so the page can be selected and
 * anchored like any other. A page that already has passages keeps its text.
 */
function setOcr(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = fileFrom(ctx, p);
  const pageNo = util.int(p, 'page', 0, 1, 100000);
  if (pageNo === 0) throw util.fail(400, 'page is required', 'missing_param', { param: 'page' });
  const pg = pageOf(app, f.id, pageNo);
  if (util.count(app, 'SELECT COUNT(*) AS n FROM anchors WHERE file = {:f} AND page_no = {:n}', { f: f.id, n: pageNo }) > 0) throw util.fail(409, 'Page ' + pageNo + ' already has passages on its text; it keeps that text.', 'page_has_anchors');
  const words = util.list(p, 'words') || [];
  if (words.length === 0) throw util.fail(400, 'words is a JSON list of {"text","x0","top","x1","bottom"} from read_pdf layout mode.', 'missing_param', { param: 'words' });
  if (words.length > 20000) throw util.fail(400, 'At most 20000 words per page.', 'too_many');
  const clean = words.map((wd, i) => {
    util.keysOnly(wd, ['text', 'x0', 'top', 'x1', 'bottom'], 'Word ' + (i + 1));
    const t = String(wd.text || '').replace(/\s+/g, ' ').trim();
    const nums = ['x0', 'top', 'x1', 'bottom'].map((k) => Number(wd[k]));
    if (t === '' || nums.some((n) => !Number.isFinite(n))) throw util.fail(400, 'Word ' + (i + 1) + ' needs text and numeric x0, top, x1, bottom.', 'invalid_param');
    return { t: t, x0: nums[0], top: nums[1], x1: Math.max(nums[2], nums[0] + 0.5), bottom: Math.max(nums[3], nums[1] + 0.5) };
  });
  // Lines: words whose vertical middles are within half a word height, read left to right.
  clean.sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const lines = [];
  for (const wd of clean) {
    const mid = (wd.top + wd.bottom) / 2;
    const line = lines.find((l) => Math.abs(l.mid - mid) < (wd.bottom - wd.top) * 0.5);
    if (line) line.words.push(wd);
    else lines.push({ mid: mid, words: [wd] });
  }
  lines.sort((a, b) => a.mid - b.mid);
  const items = [];
  let t = '';
  for (const l of lines) {
    l.words.sort((a, b) => a.x0 - b.x0);
    l.words.forEach((wd, j) => {
      const last = j === l.words.length - 1;
      const s = wd.t + (last ? '' : ' ');
      items.push([s, Math.round(wd.x0 * 100) / 100, Math.round(wd.top * 100) / 100, Math.round((wd.bottom - wd.top) * 100) / 100, Math.round((wd.x1 - wd.x0) * 100) / 100, 0, last ? 1 : 0]);
      t += s + (last ? '\n' : '');
    });
  }
  app.runInTransaction((tx) => {
    const r = tx.findRecordById('pages', pg.id);
    r.set('text', t);
    r.set('items', items);
    r.set('lines', require(`${__hooks}/lib_files.js`).lineSpans(t));
    r.set('origin', 'agent_ocr');
    r.set('chars', t.replace(/\s/g, '').length);
    tx.save(r);
    require(`${__hooks}/lib_search.js`).indexPage(tx, r, f.getString('work'));
    const fr = tx.findRecordById('files', f.id);
    fr.set('ocr_pages', util.count(tx, "SELECT COUNT(*) AS n FROM pages WHERE file = {:f} AND origin = 'agent_ocr'", { f: f.id }));
    const still = util.count(tx, "SELECT COUNT(*) AS n FROM pages WHERE file = {:f} AND origin = 'none'", { f: f.id });
    fr.set('pages_with_text', util.count(tx, 'SELECT COUNT(*) AS n FROM pages WHERE file = {:f} AND chars >= 30', { f: f.id }));
    if (fr.getString('text_state') === 'needs_ocr' && still === 0) fr.set('text_state', 'ready');
    if (fr.getString('text_state') === 'needs_ocr' && fr.getInt('pages_with_text') > 0) fr.set('text_state', 'ready');
    tx.save(fr);
    require(`${__hooks}/lib_activity.js`).write(tx, ctx, { label: 'Read scanned page ' + pageNo + ' of ' + fr.getString('name'), target: 'pages', record: r.id });
  });
  return { page: pageNo, lines: lines.length, words: clean.length, chars: t.length };
}

/** pages.ocr-list: files and pages waiting for your AI agent to read them. */
function ocrList(ctx) {
  const util = u();
  const rows = util.plain(
    util.rows(
      ctx.app,
      "SELECT f.id AS file, f.work AS work, f.name AS name, f.pages AS pages, (SELECT GROUP_CONCAT(page_no) FROM pages pg WHERE pg.file = f.id AND pg.origin = 'none') AS missing FROM files f WHERE f.current = TRUE AND EXISTS (SELECT 1 FROM pages pg WHERE pg.file = f.id AND pg.origin = 'none') ORDER BY f.created LIMIT 100",
      { file: '', work: '', name: '', pages: 0, missing: '' },
    ),
  );
  const c = core();
  return {
    files: rows
      .filter((r) => !(ctx.isAgent && c.workHidden(ctx.app, r.work)))
      .map((r) => {
        const f = ctx.app.findRecordById('files', r.file);
        return Object.assign(r, { missing: String(r.missing || '').split(',').filter((x) => x !== '').map(Number), file_path: util.filePath(ctx.app, f, 'file') });
      }),
  };
}

module.exports = {
  rectsFor: rectsFor,
  itemOffsets: itemOffsets,
  resolveSpec: resolveSpec,
  createAnchor: createAnchor,
  anchorOut: anchorOut,
  fileFrom: fileFrom,
  text: text,
  get: get,
  find: find,
  create: create,
  getAnchor: getAnchor,
  setOcr: setOcr,
  ocrList: ocrList,
};
