/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — the logic behind agent_ops.pb.js.
 *
 * The person's page does all of its work in the browser
 * (frontend/src/app/services/apiAdapter.ts): pdf.js counts pages and draws the
 * thumbnails, pdf-lib + JSZip build the downloads, and the server only stores
 * `pdfs` (the source file) and `split_jobs` (the history). These functions do
 * the same record work on the server for agents: the same collections, fields,
 * formats, checks and messages. The browser functions they port are named in a
 * comment above each port; keep them in step with the UI.
 *
 * What the server cannot do (no PDF library, no inflate in the JSVM): render
 * pages or build the part files. `splits.get` hands the agent the source path
 * and each part's page range so it can build the same parts itself.
 *
 * Require this module ONCE inside each route handler (handlers run in isolated
 * VMs); never require() inside loops (~1.6 ms per call).
 */

const MAX_SIZE = 104857600; // pdfs.source maxSize, pb_migrations/1700000000_init_pdfs.js
const LIST_LIMIT = 500; // apiAdapter.ts pbList(..., 'perPage=500')
const CREATED_AT = '2024-01-01T00:00:00Z'; // apiAdapter.ts CREATED_AT (fallback date)
const SPLIT_TYPES = ['pages', 'ranges', 'every_n']; // split_jobs.split_type values
const MODE_PARAM = { pages: 'pages', ranges: 'ranges', every_n: 'n' };

/* ----------------------------------------------------------------- plumbing */

/** An error that answers with this status (handle() turns it into JSON). */
function fail(status, message, data) {
  const err = new Error(message);
  err.status = status;
  if (data !== undefined) err.data = data;
  return err;
}

function statusOf(err) {
  if (err && typeof err.status === 'number') return err.status;
  try {
    const s = err && err.value ? err.value.status : undefined;
    if (typeof s === 'number' && s >= 400 && s < 500) return s;
  } catch {
    return 500;
  }
  return 500;
}

/**
 * Run an operation: query + JSON body merged into one params object; the
 * result (or the error) always leaves through e.json — a thrown error would
 * lose its status code.
 */
function handle(e, fn) {
  try {
    const info = e.requestInfo();
    const p = {};
    const query = info.query || {};
    for (const k of Object.keys(query)) p[k] = query[k];
    const body = info.body || {};
    for (const k of Object.keys(body)) p[k] = body[k];
    const out = fn(p, e.app, e);
    return e.json(200, out === undefined ? { ok: true } : out);
  } catch (err) {
    const status = statusOf(err);
    if (status >= 500) console.error('[pdf-splitter] agent operation failed:', err);
    const out = { status: status, message: String((err && err.message) || err) };
    if (err && err.data !== undefined) out.data = err.data;
    return e.json(status, out);
  }
}

/** True when the param was given with a non-blank value. */
function given(p, name) {
  const v = p[name];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function str(p, name) {
  return given(p, name) ? String(p[name]).trim() : '';
}

/* ------------------------------------------------------------------ shapes */

// apiAdapter.ts toIso(): a PocketBase date ("YYYY-MM-DD HH:MM:SS.sssZ") as ISO-8601.
function toIso(v) {
  if (v == null || v === '') return null;
  try {
    const d = new Date(String(v).replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

// Sidebar.tsx formatFileSize()
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// SplitHistory.tsx splitTypeLabel()
function splitTypeLabel(type) {
  switch (type) {
    case 'pages':
      return 'By Pages';
    case 'ranges':
      return 'By Ranges';
    case 'every_n':
      return 'Every N';
    default:
      return type;
  }
}

// SplitHistory.tsx splitConfigSummary()
function splitConfigSummary(type, cfg) {
  switch (type) {
    case 'pages':
      return Array.isArray(cfg.pages) ? `Pages: ${cfg.pages.join(', ')}` : '';
    case 'ranges':
      return Array.isArray(cfg.ranges)
        ? cfg.ranges.map((r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`)).join(', ')
        : '';
    case 'every_n':
      return cfg.n ? `Every ${cfg.n} pages` : '';
    default:
      return '';
  }
}

function pageCountOf(rec) {
  return Number(rec.get('page_count')) || 0;
}

// apiAdapter.ts toPDFDocument() (the V1 file_path is dropped; sources come from pdfs.get).
function toPDFDocument(rec) {
  const size = Number(rec.get('file_size')) || 0;
  return {
    id: rec.id,
    filename: rec.getString('filename'),
    page_count: pageCountOf(rec),
    file_size: size,
    size: formatFileSize(size),
    uploaded_at: toIso(rec.getString('created')) || CREATED_AT,
  };
}

// apiAdapter.ts asObject(job.split_config)
function configOf(rec) {
  try {
    const v = JSON.parse(rec.getString('split_config') || 'null');
    return v !== null && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

// apiAdapter.ts toSplitJob() (the synthetic V1 output_dir is dropped).
function toSplitJob(rec) {
  return {
    id: rec.id,
    document_id: rec.getString('document'),
    split_type: rec.getString('split_type'),
    split_config: configOf(rec),
    file_count: Number(rec.get('file_count')) || 0,
    created_at: toIso(rec.getString('created')) || CREATED_AT,
  };
}

function historyRow(rec) {
  const job = toSplitJob(rec);
  return {
    id: job.id,
    split_type: job.split_type,
    type_label: splitTypeLabel(job.split_type),
    summary: splitConfigSummary(job.split_type, job.split_config),
    file_count: job.file_count,
    created_at: job.created_at,
  };
}

/* ---------------------------------------------------------------- lookups */

/** A PDF by id, or by its exact file name when only one has that name. */
function resolvePdf(app, ref) {
  const key = String(ref == null ? '' : ref).trim();
  if (key === '') throw fail(400, 'pdf is required: an id from pdfs.list, or the exact file name');
  try {
    return app.findRecordById('pdfs', key);
  } catch {
    /* not an id: try the name */
  }
  let rows = [];
  try {
    rows = Array.from(app.findRecordsByFilter('pdfs', 'filename = {:f}', '-created', 50, 0, { f: key }));
  } catch {
    rows = [];
  }
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    throw fail(400, `${rows.length} PDFs are named "${key}"; pass the id instead`, { ids: rows.map((r) => r.id) });
  }
  throw fail(404, 'PDF not found');
}

function resolveSplit(app, ref) {
  const key = String(ref == null ? '' : ref).trim();
  if (key === '') throw fail(400, 'split is required: a split id from pdfs.get');
  try {
    return app.findRecordById('split_jobs', key);
  } catch {
    throw fail(404, 'Split job not found'); // apiAdapter.ts loadSplitContext()
  }
}

/** Absolute local path of a stored source PDF. */
function sourcePath(app, rec) {
  let dir = app.dataDir();
  if (!$filepath.isAbs(dir)) dir = $filepath.join($os.getwd(), dir);
  return $filepath.join(dir, 'storage', rec.baseFilesPath(), rec.getString('source'));
}

function sourceInfo(app, rec) {
  const file = rec.getString('source');
  return { file: file, url: `/api/files/pdfs/${rec.id}/${file}`, path: sourcePath(app, rec) };
}

/* ------------------------------------------------- reading a PDF's facts */
// A regex over a whole large PDF costs seconds in the JSVM (about 3 s per scan
// of 40 MB) while indexOf/lastIndexOf scan it in a fraction of that, so tokens
// are found with those and regexes only run on short slices around them.

function lastMatch(text, re) {
  let last = null;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    last = m;
    if (m[0].length === 0) re.lastIndex++;
  }
  return last;
}

/** True when some occurrence of `token` passes `check(index)`. */
function anyOccurrence(text, token, check) {
  let i = text.indexOf(token);
  while (i >= 0) {
    if (check(i)) return true;
    i = text.indexOf(token, i + token.length);
  }
  return false;
}

/** The match of `re` (anchored at the token) on the LAST occurrence of `token` it matches, or null. */
function lastFollowedBy(text, token, re) {
  let i = text.lastIndexOf(token);
  while (i >= 0) {
    const m = re.exec(text.slice(i, i + 64));
    if (m !== null) return m;
    if (i === 0) break;
    i = text.lastIndexOf(token, i - 1);
  }
  return null;
}

/** The body of the LAST plain-text definition of object `num gen`, or null. */
function objectBody(text, num, gen) {
  const token = num + ' ' + gen + ' obj';
  let i = text.lastIndexOf(token);
  while (i >= 0) {
    const before = i > 0 ? text.charAt(i - 1) : '';
    const after = text.charAt(i + token.length);
    if (!/[0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) break;
    i = i === 0 ? -1 : text.lastIndexOf(token, i - 1);
  }
  let start;
  if (i >= 0) {
    start = i + token.length;
  } else {
    // Unusual spacing ("12  0\nobj"): only then the slow full scan.
    const m = lastMatch(text, new RegExp('(?:^|[^0-9])' + num + '\\s+' + gen + '\\s+obj\\b', 'g'));
    if (m === null) return null;
    start = m.index + m[0].length;
  }
  const end = text.indexOf('endobj', start);
  return end < 0 ? null : text.slice(start, end);
}

/**
 * What the server can read from a PDF without a PDF library: whether it is
 * encrypted, whether it keeps objects in compressed object streams, and the
 * page count (the page tree root's /Count, which is what pdf.js reports as
 * numPages) when the catalog and page tree are plain text. Never guesses:
 * pageCount is null whenever any step is not certain.
 *
 * `text` is the file decoded as UTF-8: invalid bytes become U+FFFD, so only
 * ASCII tokens are searched and no byte offsets are used.
 */
function inspect(text) {
  const out = { encrypted: false, objectStreams: false, pageCount: null };
  out.encrypted = anyOccurrence(text, '/Encrypt', (i) => /^\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(text.slice(i, i + 48)));
  out.objectStreams = anyOccurrence(
    text,
    '/ObjStm',
    (i) => /\/Type\s*$/.test(text.slice(Math.max(0, i - 24), i)) && !/^[A-Za-z0-9]/.test(text.slice(i + 7, i + 8)),
  );
  if (out.objectStreams) return out;
  const root = lastFollowedBy(text, '/Root', /^\/Root\s+(\d+)\s+(\d+)\s+R/);
  if (root === null) return out;
  const catalog = objectBody(text, root[1], root[2]);
  if (catalog === null || !/\/Type\s*\/Catalog\b/.test(catalog)) return out;
  const pagesRef = /\/Pages\s+(\d+)\s+(\d+)\s+R/.exec(catalog);
  if (pagesRef === null) return out;
  const pages = objectBody(text, pagesRef[1], pagesRef[2]);
  if (pages === null || !/\/Type\s*\/Pages\b/.test(pages)) return out;
  const count = /\/Count\s+(\d+)(\s+\d+\s+R)?/.exec(pages);
  if (count === null || count[2] !== undefined) return out; // "/Count 12 0 R" is a reference, not a count

  const n = parseInt(count[1], 10);
  if (n >= 1) out.pageCount = n;
  return out;
}

function inspectKey(rec) {
  return 'pdf-splitter.inspect:' + rec.id + ':' + rec.getString('source');
}

/**
 * The facts of a stored source PDF (read once per stored file, then kept in
 * the app store: a record's source never changes after upload).
 * { path, readable, pdf, encrypted, objectStreams, pageCount }
 */
function sourceFacts(app, rec) {
  const path = sourcePath(app, rec);
  const key = inspectKey(rec);
  const store = app.store();
  if (store.has(key)) {
    const v = store.get(key);
    return {
      path: path,
      readable: true,
      pdf: v.pdf === true,
      encrypted: v.encrypted === true,
      objectStreams: v.objectStreams === true,
      pageCount: v.pageCount == null ? null : Number(v.pageCount),
    };
  }
  let text;
  try {
    text = toString($os.readFile(path));
  } catch {
    return { path: path, readable: false, pdf: false, encrypted: false, objectStreams: false, pageCount: null };
  }
  const facts = text.slice(0, 4) === '%PDF' ? inspect(text) : { encrypted: false, objectStreams: false, pageCount: null };
  const keep = { pdf: text.slice(0, 4) === '%PDF', encrypted: facts.encrypted, objectStreams: facts.objectStreams, pageCount: facts.pageCount };
  text = null;
  store.set(key, keep);
  return { path: path, readable: true, pdf: keep.pdf, encrypted: keep.encrypted, objectStreams: keep.objectStreams, pageCount: keep.pageCount };
}

/* ------------------------------------------- the split controls, ported */

// SplitControls.tsx parsedRanges (useMemo), line for line: "1-5, 8, 11-15" →
// [[1,5],[8,8],[11,15]]; null when blank; 'invalid' when any part is bad.
function parseRanges(rangeInput, pageCount) {
  if (!rangeInput.trim()) return null;
  try {
    const ranges = [];
    const parts = rangeInput.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (trimmed.includes('-')) {
        const [startStr, endStr] = trimmed.split('-').map((s) => s.trim());
        const start = parseInt(startStr === undefined ? '' : startStr, 10);
        const end = parseInt(endStr === undefined ? '' : endStr, 10);
        if (isNaN(start) || isNaN(end) || start < 1 || end < start || end > pageCount) {
          return 'invalid';
        }
        ranges.push([start, end]);
      } else {
        const page = parseInt(trimmed, 10);
        if (isNaN(page) || page < 1 || page > pageCount) {
          return 'invalid';
        }
        ranges.push([page, page]);
      }
    }
    return ranges.length > 0 ? ranges : null;
  } catch {
    return 'invalid';
  }
}

/**
 * The "Selected Pages" selection (ThumbnailGrid.tsx): a page list, "all"
 * (Select all, handleSelectAll) or ranges like "1-3, 8" expanded the way
 * shift+click fills a range (handlePageClick). Pages must exist; duplicates
 * collapse (the selection is a Set); sorted ascending as SplitControls.tsx
 * handleSplit sends them.
 */
function parsePages(raw, pageCount) {
  let list;
  if (typeof raw === 'number') {
    list = [raw];
  } else if (raw !== null && typeof raw === 'object' && typeof raw.length === 'number') {
    list = Array.from(raw);
  } else {
    const s = String(raw == null ? '' : raw).trim();
    if (s === '') {
      list = [];
    } else if (s.toLowerCase() === 'all') {
      list = [];
      for (let i = 1; i <= pageCount; i++) list.push(i); // ThumbnailGrid.tsx handleSelectAll
    } else if (s[0] === '[') {
      try {
        list = JSON.parse(s);
      } catch {
        list = null;
      }
      if (!Array.isArray(list)) throw fail(400, 'pages: give a JSON list of page numbers like [1, 3, 5], ranges like 1-3, 8, or all');
    } else {
      const r = parseRanges(s, pageCount);
      if (r === 'invalid') throw fail(400, `Invalid page selection. Use page numbers and ranges like 1-3, 8 (pages 1-${pageCount})`);
      list = [];
      if (r !== null) for (const pair of r) for (let i = pair[0]; i <= pair[1]; i++) list.push(i); // shift+click range
    }
  }
  const seen = new Set();
  for (const v of list) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? parseInt(v, 10) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > pageCount) {
      throw fail(400, `Page ${v} is not in this PDF (pages 1-${pageCount})`);
    }
    seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * SplitControls.tsx canSplit + handleSplit: validate the chosen mode the way
 * the split controls do (against the document's page_count, as the UI uses
 * activeDoc.page_count) and build the exact split_config the UI stores.
 */
function planSplit(rec, p) {
  const pageCount = pageCountOf(rec);
  const splitType = str(p, 'split_type');
  if (SPLIT_TYPES.indexOf(splitType) < 0) throw fail(400, 'split_type must be one of: pages, ranges, every_n');
  for (const t of SPLIT_TYPES) {
    const other = MODE_PARAM[t];
    if (t !== splitType && given(p, other)) {
      throw fail(400, `${other} does not apply to split_type ${splitType} (pages takes pages, ranges takes ranges, every_n takes n)`);
    }
  }
  let config;
  if (splitType === 'pages') {
    const pages = parsePages(given(p, 'pages') ? p.pages : '', pageCount);
    if (pages.length === 0) throw fail(400, 'Select at least one page: pages is required (e.g. [1, 3] or 1-3, 8 or all)');
    config = { pages: pages };
  } else if (splitType === 'ranges') {
    const parsed = parseRanges(given(p, 'ranges') ? String(p.ranges) : '', pageCount);
    if (parsed === null) throw fail(400, `ranges is required, e.g. 1-5, 8, 11-${pageCount}`);
    if (parsed === 'invalid') throw fail(400, `Invalid range. Use format: 1-5, 8, 11-15 (pages 1-${pageCount})`);
    config = { ranges: parsed };
  } else {
    // The "Split every" input starts at "2" (SplitControls.tsx useState('2')).
    const n = parseInt(given(p, 'n') ? String(p.n) : '2', 10);
    if (isNaN(n) || n < 1 || n > pageCount) throw fail(400, `n must be a whole number from 1 to ${pageCount}`);
    config = { n: n };
  }
  return { split_type: splitType, split_config: config };
}

// apiAdapter.ts buildPageGroups(), verbatim: the page groups (0-indexed) a
// split makes, labelled as their file names will be.
function buildPageGroups(splitType, config, total) {
  const groups = [];

  if (splitType === 'pages') {
    const pages = Array.isArray(config.pages) ? config.pages : [];
    for (const raw of pages) {
      const p = Number(raw);
      if (Number.isInteger(p) && p >= 1 && p <= total) {
        groups.push({ label: `page_${p}`, indices: [p - 1] });
      }
    }
  } else if (splitType === 'ranges') {
    const ranges = Array.isArray(config.ranges) ? config.ranges : [];
    for (const raw of ranges) {
      if (!Array.isArray(raw) || raw.length < 2) continue;
      let start = Number(raw[0]);
      let end = Number(raw[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      start = Math.max(1, start);
      end = Math.min(total, end);
      if (start <= end) {
        const indices = [];
        for (let i = start - 1; i < end; i++) indices.push(i);
        groups.push({ label: `pages_${start}-${end}`, indices: indices });
      }
    }
  } else if (splitType === 'every_n') {
    let n = Number(config.n);
    if (!Number.isFinite(n) || n < 1) n = 1;
    n = Math.floor(n);
    for (let i = 0; i < total; i += n) {
      const endPage = Math.min(i + n, total);
      const indices = [];
      for (let j = i; j < endPage; j++) indices.push(j);
      groups.push({ label: `pages_${i + 1}-${endPage}`, indices: indices });
    }
  }

  return groups;
}

// apiAdapter.ts outputFiles(), verbatim: the part files in plan order (the
// order the Split Complete panel lists them and every download follows), with a
// repeated name made unique by " (2)", " (3)"… so the ZIP keeps every part.
function outputFiles(groups) {
  const used = new Set();
  return groups.map((g) => {
    let name = `${g.label}.pdf`;
    for (let k = 2; used.has(name); k++) name = `${g.label} (${k}).pdf`;
    used.add(name);
    return { name: name, indices: g.indices };
  });
}

/** A file entry with its 1-based first/last page (every group is one run of pages). */
function fileEntry(name, indices) {
  return { filename: name, from: indices[0] + 1, to: indices[indices.length - 1] + 1 };
}

/** The files a split makes, as the "Split Complete" panel lists them and its buttons download them. */
function panelFiles(groups) {
  return outputFiles(groups).map((f) => fileEntry(f.name, f.indices));
}

/** The page count the browser would split with: pdf-lib reads it from the file; else the stored one. */
function splitTotal(rec, facts) {
  return facts.pageCount !== null ? facts.pageCount : pageCountOf(rec);
}

/* --------------------------------------------------------------- operations */

/** pdfs.list — the sidebar: Sidebar.tsx, apiAdapter.ts handlePdfsList(). */
function pdfsList(app) {
  const rows = Array.from(app.findRecordsByFilter('pdfs', "id != ''", '-created', LIST_LIMIT, 0));
  const documents = rows.map(toPDFDocument);
  return { count: documents.length, documents: documents };
}

/** pdfs.get — the open document: MainView.tsx header + SplitHistory.tsx (apiAdapter.ts handlePdfSplits()). */
function pdfsGet(app, p) {
  const rec = resolvePdf(app, p.pdf);
  const jobs = Array.from(
    app.findRecordsByFilter('split_jobs', 'document = {:d}', '-created', LIST_LIMIT, 0, { d: rec.id }),
  );
  const out = toPDFDocument(rec);
  out.source = sourceInfo(app, rec);
  out.history = { count: jobs.length, splits: jobs.map(historyRow) };
  return out;
}

/**
 * pdfs.upload — DropZone.tsx + MainView.tsx handleFileSelect + apiAdapter.ts
 * handleUpload(): the same checks in the same order and the same record
 * (filename = the file's name, source, file_size in bytes, page_count).
 */
function pdfsUpload(app, p) {
  const path = str(p, 'path');
  if (path === '') throw fail(400, 'path is required: the absolute path of a .pdf file on this computer');
  if (!$filepath.isAbs(path)) throw fail(400, `path must be absolute (e.g. C:\\Users\\me\\file.pdf), got "${path}"`);
  const filename = $filepath.base(path);
  if (!filename || !filename.toLowerCase().endsWith('.pdf')) throw fail(400, 'Only PDF files are allowed');
  let info;
  try {
    info = $os.stat(path);
  } catch {
    throw fail(404, `No file at "${path}"`);
  }
  if (info.isDir()) throw fail(400, `"${path}" is a folder, not a file`);
  const size = Number(info.size());
  if (size > MAX_SIZE) throw fail(400, 'File too large (max 100 MB)');

  let text;
  try {
    text = toString($os.readFile(path));
  } catch (err) {
    throw fail(400, `Could not read "${path}": ${String((err && err.message) || err)}`);
  }
  // Magic bytes "%PDF" at byte 0, as handleUpload checks them.
  if (text.slice(0, 4) !== '%PDF') throw fail(400, 'Invalid PDF file');
  const facts = inspect(text);
  text = null;
  // The browser cannot split an encrypted PDF (pdf-lib cannot decrypt it), so handleUpload refuses
  // every one: a user password fails pdf.js, an owner password is caught by its EncryptFilterName.
  // The server cannot tell the two apart, so one message covers both.
  if (facts.encrypted) {
    throw fail(400, 'This PDF is password-protected (encrypted). PDF Splitter cannot split password-protected PDFs: remove the password and upload it again.');
  }

  let pageCount;
  let countSource;
  const asked = given(p, 'page_count') ? Number(p.page_count) : null;
  if (asked !== null && (!Number.isInteger(asked) || asked < 1)) throw fail(400, 'page_count must be a whole number of at least 1');
  if (facts.pageCount !== null) {
    if (asked !== null && asked !== facts.pageCount) {
      throw fail(400, `page_count ${asked} does not match the file, which has ${facts.pageCount} pages`);
    }
    pageCount = facts.pageCount;
    countSource = 'file';
  } else if (asked !== null) {
    pageCount = asked;
    countSource = 'agent';
  } else {
    throw fail(
      400,
      'This PDF keeps its page list compressed, so the app cannot count its pages on the server. Count them with your own PDF tool and pass page_count.',
    );
  }

  const rec = new Record(app.findCollectionByNameOrId('pdfs'));
  rec.set('filename', filename);
  rec.set('source', $filesystem.fileFromPath(path));
  rec.set('file_size', size);
  rec.set('page_count', pageCount);
  try {
    app.save(rec);
  } catch (err) {
    throw fail(400, 'Upload failed: ' + String((err && err.message) || err));
  }
  app.store().set(inspectKey(rec), { pdf: true, encrypted: facts.encrypted, objectStreams: facts.objectStreams, pageCount: facts.pageCount });

  const out = toPDFDocument(rec);
  out.page_count_source = countSource;
  out.message = `Uploaded "${out.filename}" (${out.page_count} pages)`; // MainView.tsx handleFileSelect toast
  return out;
}

/** pdfs.delete — Sidebar.tsx trash button, apiAdapter.ts handlePdfDelete() (split_jobs cascade, the file goes too). */
function pdfsDelete(app, p) {
  const rec = resolvePdf(app, p.pdf);
  const id = rec.id;
  const filename = rec.getString('filename');
  const key = inspectKey(rec);
  const splitsRemoved = Number(app.countRecords('split_jobs', $dbx.hashExp({ document: id }))) || 0;
  app.delete(rec);
  app.store().remove(key);
  return {
    status: 'deleted',
    id: id,
    filename: filename,
    splits_removed: splitsRemoved,
    message: `Deleted "${filename || 'document'}"`, // MainView.tsx handleDeleteDocument toast
  };
}

/** The checks and plan shared by splits.preview and splits.create. */
function prepareSplit(app, p) {
  const rec = resolvePdf(app, p.pdf); // apiAdapter.ts handleSplit: "PDF not found"
  const plan = planSplit(rec, p);
  const facts = sourceFacts(app, rec);
  if (!facts.readable || !facts.pdf) throw fail(500, 'Failed to open PDF');
  if (facts.encrypted) throw fail(400, 'Failed to open PDF: the file is encrypted');
  const groups = buildPageGroups(plan.split_type, plan.split_config, splitTotal(rec, facts));
  if (groups.length === 0) throw fail(400, 'No valid pages to split');
  return { rec: rec, plan: plan, groups: groups };
}

/** splits.preview — what the split controls would make (SplitControls.tsx, apiAdapter.ts handleSplit()), nothing saved. */
function splitsPreview(app, p) {
  const s = prepareSplit(app, p);
  return {
    pdf: s.rec.id,
    split_type: s.plan.split_type,
    split_config: s.plan.split_config,
    file_count: s.groups.length,
    files: panelFiles(s.groups),
  };
}

/** splits.create — the "Split PDF" button: SplitControls.tsx handleSplit, apiAdapter.ts handleSplit(). */
function splitsCreate(app, p) {
  const s = prepareSplit(app, p);
  const job = new Record(app.findCollectionByNameOrId('split_jobs'));
  job.set('document', s.rec.id);
  job.set('split_type', s.plan.split_type);
  job.set('split_config', s.plan.split_config);
  job.set('file_count', s.groups.length);
  try {
    app.save(job);
  } catch (err) {
    throw fail(500, 'Failed to create split job: ' + String((err && err.message) || err));
  }
  const out = toSplitJob(job);
  out.files = panelFiles(s.groups);
  const n = out.file_count;
  // The person's toast reads "Split complete! N files created." (SplitControls.tsx handleSplit), but the
  // app only stores the plan — its browser builds the files on download. Say what an agent can rely on.
  out.message = `Split plan saved: ${n} file${n !== 1 ? 's' : ''} (the app builds them in the person's browser on download; to make them yourself, read splits.get and cut the source PDF with your own PDF tool).`;
  return out;
}

/**
 * splits.get — one Split History row and what its downloads deliver
 * (apiAdapter.ts loadSplitContext(), handleDownloadFile(), handleDownloadZip()):
 * files[i] is what "Part i+1" (or the panel's (i+1)th button) downloads; the ZIP
 * holds every file, in the same order and under the same unique names.
 */
function splitsGet(app, p) {
  const job = resolveSplit(app, p.split);
  const out = historyRow(job);
  out.document_id = job.getString('document');
  out.split_config = configOf(job);
  let doc = null;
  try {
    doc = app.findRecordById('pdfs', out.document_id);
  } catch {
    doc = null;
  }
  if (doc === null) {
    out.download_error = 'Split output not found';
    return out;
  }
  out.document = doc.getString('filename');
  out.source = sourceInfo(app, doc);
  const facts = sourceFacts(app, doc);
  if (!facts.readable) {
    out.download_error = 'Split output not found'; // apiAdapter.ts loadSplitContext()
  } else if (!facts.pdf || facts.encrypted) {
    out.download_error = 'Failed to open PDF' + (facts.encrypted ? ': the file is encrypted' : '');
  }
  const groups = buildPageGroups(out.split_type, out.split_config, splitTotal(doc, facts));
  const files = outputFiles(groups);
  out.files = files.map((f, i) => {
    const entry = fileEntry(f.name, f.indices);
    return { index: i, part: `Part ${i + 1}`, filename: entry.filename, from: entry.from, to: entry.to };
  });
  out.zip = { filename: 'split_output.zip', entries: files.map((f) => f.name) };
  if (files.length === 0) out.zip.error = 'No split files found';
  return out;
}

module.exports = {
  handle: handle,
  fail: fail,
  inspect: inspect,
  parseRanges: parseRanges,
  parsePages: parsePages,
  planSplit: planSplit,
  buildPageGroups: buildPageGroups,
  outputFiles: outputFiles,
  pdfsList: pdfsList,
  pdfsGet: pdfsGet,
  pdfsUpload: pdfsUpload,
  pdfsDelete: pdfsDelete,
  splitsPreview: splitsPreview,
  splitsCreate: splitsCreate,
  splitsGet: splitsGet,
};
