/// <reference path="../pb_data/types.d.ts" />
/**
 * Cards: everything placed on a board.
 *
 *   note     a title and a body (a sticky note when the title is empty)
 *   link     a web page: url, with its title, description and preview image
 *   image    an uploaded image or an image url
 *   video    an uploaded video or a video url
 *   youtube  a YouTube video url (title and thumbnail from YouTube)
 *   doc      an uploaded document (PDF, Word, slides, ...) or a document url
 *   quote    a passage (body) and where it comes from (source, url)
 *   section  a frame that groups the cards inside it (title only)
 *
 * Position and size are world coordinates on the board. A card without a
 * position gets a free spot next to the others. Deleting a card trashes it
 * (`trashed` set) so Undo can bring it back; links to a trashed card are
 * hidden, and the hourly purge removes both for good.
 */

const KINDS = ['note', 'link', 'image', 'video', 'youtube', 'doc', 'quote', 'section'];
const COLORS = ['plain', 'amber', 'green', 'blue', 'violet', 'red', 'teal', 'accent'];
const LIVE = "trashed = ''";

/** Default size of a new card, by kind (a link without a preview image is shorter). */
function sizeOf(kind, hasThumb) {
  switch (kind) {
    case 'note':
      return { w: 240, h: 160 };
    case 'link':
      return hasThumb ? { w: 260, h: 250 } : { w: 260, h: 132 };
    case 'image':
      return { w: 260, h: 230 };
    case 'video':
      return { w: 280, h: 236 };
    case 'youtube':
      return { w: 280, h: 244 };
    case 'doc':
      return { w: 250, h: 132 };
    case 'quote':
      return { w: 270, h: 168 };
    case 'section':
      return { w: 560, h: 380 };
    default:
      return { w: 240, h: 160 };
  }
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const DOC_EXT = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'txt', 'md', 'csv', 'epub', 'key', 'pages', 'numbers', 'json', 'tex'];

function extOf(name) {
  const clean = String(name || '').split('?')[0].split('#')[0];
  const i = clean.lastIndexOf('.');
  const slash = clean.lastIndexOf('/');
  return i > slash && i >= 0 ? clean.slice(i + 1).toLowerCase() : '';
}

/** The 11-character id of a YouTube video url, or ''. */
function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

/** What kind of card a url makes when no kind is given. */
function kindForUrl(url) {
  if (youtubeId(url) !== '') return 'youtube';
  const ext = extOf(url);
  if (IMAGE_EXT.indexOf(ext) >= 0) return 'image';
  if (VIDEO_EXT.indexOf(ext) >= 0) return 'video';
  if (DOC_EXT.indexOf(ext) >= 0) return 'doc';
  return 'link';
}

/** What kind of card an uploaded file makes. */
function kindForFile(name) {
  const ext = extOf(name);
  if (IMAGE_EXT.indexOf(ext) >= 0) return 'image';
  if (VIDEO_EXT.indexOf(ext) >= 0) return 'video';
  return 'doc';
}

function isWebUrl(s) {
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(String(s || ''));
}

/** Tags as written, trimmed, without a leading #, unique regardless of case, at most 20. */
function cleanTags(list) {
  const u = require(`${__hooks}/lib_util.js`);
  const out = [];
  const seen = {};
  for (const raw of list || []) {
    const t = u.squash(String(raw === null || raw === undefined ? '' : raw)).replace(/^#+/, '').slice(0, 32);
    if (t === '') continue;
    const key = t.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push(t);
    if (out.length === 20) break;
  }
  return out;
}

function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/** Absolute path of a card's stored file (the AI agent reads it from disk). */
function filePath(app, rec) {
  const name = rec.getString('file');
  if (name === '') return '';
  const p = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), name);
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

/** A json field as a plain value; require-free because it runs per card. */
function jsonField(rec, field, dflt) {
  try {
    const raw = rec.getString(field);
    if (raw === '' || raw === 'null') return dflt;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? dflt : v;
  } catch {
    return dflt;
  }
}

/** A card as the UI and the AI agent see it. Runs per card: keep it require-free. */
function serialize(app, rec, opts) {
  const file = rec.getString('file');
  const fileUrl = file !== '' ? '/api/files/cards/' + rec.id + '/' + file : '';
  const out = {
    id: rec.id,
    board: rec.getString('board'),
    kind: rec.getString('kind'),
    title: rec.getString('title'),
    body: rec.getString('body'),
    url: rec.getString('url'),
    file: file,
    file_url: fileUrl,
    src: fileUrl !== '' ? fileUrl : rec.getString('url'),
    source: rec.getString('source'),
    thumb: rec.getString('thumb'),
    meta: jsonField(rec, 'meta', {}),
    tags: jsonField(rec, 'tags', []),
    color: rec.getString('color') || 'plain',
    x: rec.getFloat('x'),
    y: rec.getFloat('y'),
    w: rec.getFloat('w'),
    h: rec.getFloat('h'),
    z: rec.getFloat('z'),
    starred: rec.getBool('starred'),
    added_by: rec.getString('added_by') || 'app',
    digest: rec.getString('digest'),
    digest_state: rec.getString('digest_state'),
    digest_error: rec.getString('digest_error'),
    digest_at: rec.getString('digest_at'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
  if (opts && opts.paths) out.file_path = filePath(app, rec);
  return out;
}

/** A live (not trashed) card, or a 404 that says how to find one. */
function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'cards', String(id || ''));
  if (rec === null || rec.getString('trashed') !== '') throw u.fail(404, 'No card with id "' + id + '". List cards with cards.list or boards.get.');
  return rec;
}

function liveOnBoard(app, boardId) {
  return app.findRecordsByFilter('cards', 'board = {:b} && ' + LIVE, 'z,created', 0, 0, { b: boardId });
}

function boxOf(rec) {
  return { x: rec.getFloat('x'), y: rec.getFloat('y'), w: rec.getFloat('w'), h: rec.getFloat('h') };
}

function overlaps(a, b, gap) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/**
 * A free spot for a w x h card: `near` itself when it is free, else the
 * free spot (right of or under an existing card) closest to it. Sections
 * are frames, so a card may sit inside one.
 */
function freeSpot(app, boardId, w, h, near) {
  const boxes = liveOnBoard(app, boardId)
    .filter((r) => r.getString('kind') !== 'section')
    .map(boxOf);
  if (boxes.length === 0) return near || { x: 0, y: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
  }
  const anchor = near || { x: x0, y: y0 };
  const free = (p) => {
    const c = { x: p.x, y: p.y, w: w, h: h };
    for (const b of boxes) if (overlaps(c, b, 20)) return false;
    return true;
  };
  if (free(anchor)) return { x: Math.round(anchor.x), y: Math.round(anchor.y) };
  const candidates = [];
  for (const b of boxes) {
    candidates.push({ x: b.x + b.w + 40, y: b.y });
    candidates.push({ x: b.x, y: b.y + b.h + 40 });
  }
  candidates.sort((a, b) => Math.hypot(a.x - anchor.x, (a.y - anchor.y) * 1.4) - Math.hypot(b.x - anchor.x, (b.y - anchor.y) * 1.4));
  for (const c of candidates) if (free(c)) return { x: Math.round(c.x), y: Math.round(c.y) };
  let ymax = -Infinity;
  for (const b of boxes) ymax = Math.max(ymax, b.y + b.h);
  return { x: Math.round(x0), y: Math.round(ymax + 60) };
}

function topZ(app, boardId) {
  const rows = app.findRecordsByFilter('cards', 'board = {:b}', '-z', 1, 0, { b: boardId });
  return rows.length > 0 ? rows[0].getFloat('z') : 0;
}

/**
 * Check and set the editable fields present in p. `isNew` fills defaults.
 * Media (url or file) is checked by the caller, which knows about uploads.
 */
function applyFields(rec, p, isNew) {
  const u = require(`${__hooks}/lib_util.js`);
  if (u.has(p, 'title')) rec.set('title', u.squash(u.str(p, 'title', '')).slice(0, 500));
  if (u.has(p, 'body')) rec.set('body', u.text(p, 'body', '').slice(0, 100000));
  if (u.has(p, 'source')) rec.set('source', u.squash(u.str(p, 'source', '')).slice(0, 500));
  if (u.has(p, 'url')) {
    const url = u.str(p, 'url', '');
    if (url !== '' && !isWebUrl(url)) throw u.fail(400, 'url must start with http:// or https://, e.g. https://example.com/article');
    rec.set('url', url);
  }
  if (u.has(p, 'tags')) rec.set('tags', cleanTags(u.list(p, 'tags', true)));
  else if (isNew) rec.set('tags', []);
  if (u.has(p, 'color')) rec.set('color', u.oneOf(p, 'color', COLORS, 'plain'));
  if (u.has(p, 'starred')) rec.set('starred', u.bool(p, 'starred', false));
  for (const k of ['x', 'y']) if (u.has(p, k)) rec.set(k, Math.round(u.num(p, k, 0, -1000000, 1000000)));
  if (u.has(p, 'w')) rec.set('w', Math.round(u.num(p, 'w', 0, 120, 4000)));
  if (u.has(p, 'h')) rec.set('h', Math.round(u.num(p, 'h', 0, 60, 4000)));
}

/**
 * What each kind needs before it can be saved. `attached` says a file was
 * just attached: a new upload only shows in the record after saving.
 */
function checkComplete(rec, attached) {
  const u = require(`${__hooks}/lib_util.js`);
  const kind = rec.getString('kind');
  const url = rec.getString('url');
  const hasFile = attached === true || rec.getString('file') !== '';
  if (kind === 'link' && url === '') throw u.fail(400, 'A link needs url, e.g. --url https://example.com/article');
  if (kind === 'youtube') {
    if (youtubeId(url) === '') throw u.fail(400, 'A YouTube card needs the url of one video, e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  }
  if ((kind === 'image' || kind === 'video' || kind === 'doc') && url === '' && !hasFile) {
    throw u.fail(400, 'A ' + (kind === 'doc' ? 'document' : kind) + ' needs a file (upload it, or give --path to a file on disk) or a url');
  }
  if (kind === 'quote' && rec.getString('body') === '') throw u.fail(400, 'A quote needs body: the passage itself');
}

module.exports = {
  KINDS: KINDS,
  COLORS: COLORS,
  LIVE: LIVE,
  sizeOf: sizeOf,
  extOf: extOf,
  youtubeId: youtubeId,
  kindForUrl: kindForUrl,
  kindForFile: kindForFile,
  isWebUrl: isWebUrl,
  cleanTags: cleanTags,
  hostOf: hostOf,
  filePath: filePath,
  jsonField: jsonField,
  serialize: serialize,
  mustGet: mustGet,
  liveOnBoard: liveOnBoard,
  freeSpot: freeSpot,
  topZ: topZ,
  applyFields: applyFields,
  checkComplete: checkComplete,
};
