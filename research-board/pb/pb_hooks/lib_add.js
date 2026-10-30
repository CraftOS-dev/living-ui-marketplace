/// <reference path="../pb_data/types.d.ts" />
/**
 * Adding and copying cards: kind detection, link previews, default titles,
 * sizes and a free spot on the board.
 */

/** A file the AI agent names by its absolute path on this computer. */
function fileFromPath(path) {
  const u = require(`${__hooks}/lib_util.js`);
  try {
    const info = $os.stat(path);
    if (info.isDir()) throw u.fail(400, 'path is a folder, not a file: ' + path);
  } catch (err) {
    if (err && err.status) throw err;
    throw u.fail(400, 'No file at path "' + path + '". Give the absolute path of the file.');
  }
  return $filesystem.fileFromPath(path);
}

/** "Quarterly report.pdf" -> "Quarterly report"; ".../the-shape-of-things.jpg" -> "the shape of things". */
function titleFromName(name) {
  let base = String(name || '').split('?')[0].split('#')[0];
  base = base.slice(base.lastIndexOf('/') + 1);
  try {
    base = decodeURIComponent(base);
  } catch {
    /* keep as is */
  }
  const dot = base.lastIndexOf('.');
  if (dot > 0) base = base.slice(0, dot);
  return base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/**
 * Add one card. `uploads` are files from a multipart request; the AI agent
 * may give `path` (a file on disk) instead.
 */
function addCard(app, p, by, uploads) {
  const u = require(`${__hooks}/lib_util.js`);
  const lib = require(`${__hooks}/lib_cards.js`);
  const boards = require(`${__hooks}/lib_boards.js`);
  const settings = require(`${__hooks}/lib_settings.js`);
  const board = boards.mustGet(app, u.req(p, 'board'));

  let file = null;
  if (uploads && uploads.length > 0) file = uploads[0];
  const path = u.str(p, 'path', '');
  if (file === null && path !== '') file = fileFromPath(path);
  const fileName = file !== null ? String(file.originalName || file.name || '') : '';

  const url = u.str(p, 'url', '');
  const asked = u.oneOf(p, 'kind', lib.KINDS, '');
  const kind = asked !== '' ? asked : file !== null ? lib.kindForFile(fileName) : url !== '' ? lib.kindForUrl(url) : 'note';
  if (file !== null && ['image', 'video', 'doc'].indexOf(kind) < 0) throw u.fail(400, 'Only image, video and doc cards hold a file');

  const rec = new Record(app.findCollectionByNameOrId('cards'));
  rec.set('board', board.id);
  rec.set('kind', kind);
  rec.set('added_by', by);
  rec.set('color', 'plain');
  lib.applyFields(rec, p, true);

  const meta = {};
  if (file !== null) {
    rec.set('file', file);
    meta.filename = fileName;
    meta.size = Number(file.size || 0);
    meta.ext = lib.extOf(fileName);
  } else if (url !== '' && (kind === 'image' || kind === 'video' || kind === 'doc')) {
    meta.ext = lib.extOf(url);
  }

  // Previews: YouTube always has its still; pages are read when allowed.
  const wantPreview = u.bool(p, 'preview', true);
  if ((kind === 'link' || kind === 'youtube') && url !== '') {
    meta.site = lib.hostOf(url);
    const allowed = wantPreview && settings.row(app).getBool('link_previews');
    if (kind === 'youtube') {
      const id = lib.youtubeId(url);
      if (id !== '') {
        meta.video_id = id;
        rec.set('thumb', require(`${__hooks}/lib_unfurl.js`).youtubeStill(id));
      }
    }
    if (allowed) {
      const pv = require(`${__hooks}/lib_unfurl.js`).preview(url);
      if (rec.getString('title') === '' && pv.title !== '') rec.set('title', pv.title);
      if (pv.description !== '') meta.description = pv.description;
      if (pv.site !== '') meta.site = pv.site;
      if (pv.author !== '') meta.author = pv.author;
      if (pv.image !== '' && rec.getString('thumb') === '') rec.set('thumb', pv.image);
    }
    if (u.has(p, 'thumb')) {
      const t = u.str(p, 'thumb', '');
      if (t !== '' && !lib.isWebUrl(t)) throw u.fail(400, 'thumb must be an image url starting with https://');
      rec.set('thumb', t);
    }
  }
  rec.set('meta', meta);

  if (rec.getString('title') === '') {
    if (kind === 'section') rec.set('title', 'Section');
    else if (fileName !== '') rec.set('title', titleFromName(fileName));
    else if (kind === 'youtube') rec.set('title', 'YouTube video');
    else if (kind === 'link') rec.set('title', meta.site || url);
    else if (url !== '' && (kind === 'image' || kind === 'video' || kind === 'doc')) rec.set('title', titleFromName(url) || lib.hostOf(url));
  }
  lib.checkComplete(rec, file !== null);

  const size = lib.sizeOf(kind, rec.getString('thumb') !== '');
  if (!u.has(p, 'w')) rec.set('w', size.w);
  if (!u.has(p, 'h')) rec.set('h', size.h);
  if (!u.has(p, 'x') || !u.has(p, 'y')) {
    const near = u.has(p, 'near_x') && u.has(p, 'near_y') ? { x: u.num(p, 'near_x', 0, -1000000, 1000000), y: u.num(p, 'near_y', 0, -1000000, 1000000) } : null;
    const spot = kind === 'section' && near !== null ? near : lib.freeSpot(app, board.id, rec.getFloat('w'), rec.getFloat('h'), near);
    rec.set('x', Math.round(spot.x));
    rec.set('y', Math.round(spot.y));
  }
  // Sections sit under everything; other cards on top of what is there.
  rec.set('z', kind === 'section' ? -1 : lib.topZ(app, board.id) + 1);
  app.save(rec);
  return rec;
}

/** A copy of a card (with its own copy of the file) on a board, shifted by dx, dy. */
function copyCard(app, rec, boardId, dx, dy, z) {
  const lib = require(`${__hooks}/lib_cards.js`);
  const copy = new Record(app.findCollectionByNameOrId('cards'));
  for (const f of ['kind', 'title', 'body', 'url', 'source', 'thumb', 'color', 'w', 'h', 'starred', 'added_by', 'digest', 'digest_at']) copy.set(f, rec.get(f));
  copy.set('meta', lib.jsonField(rec, 'meta', {}));
  copy.set('tags', lib.jsonField(rec, 'tags', []));
  copy.set('digest_state', rec.getString('digest') !== '' ? 'done' : '');
  copy.set('board', boardId);
  copy.set('x', rec.getFloat('x') + dx);
  copy.set('y', rec.getFloat('y') + dy);
  copy.set('z', rec.getString('kind') === 'section' ? -1 : z);
  const path = lib.filePath(app, rec);
  if (path !== '') {
    try {
      copy.set('file', $filesystem.fileFromPath(path));
    } catch (err) {
      console.error('[research-board] could not copy the file of card', rec.id, err);
    }
  }
  app.save(copy);
  return copy;
}

/**
 * Copy cards (and the links among them) to a board. Returns old id -> new
 * record. Links to cards that are not copied are left behind.
 */
function copyCards(app, recs, boardId, dx, dy) {
  const lib = require(`${__hooks}/lib_cards.js`);
  const map = {};
  let z = lib.topZ(app, boardId);
  for (const r of recs) {
    z += 1;
    map[r.id] = copyCard(app, r, boardId, dx, dy, z);
  }
  const ids = Object.keys(map);
  if (ids.length > 1) {
    const linkCol = app.findCollectionByNameOrId('links');
    const seen = {};
    for (const id of ids) {
      for (const l of app.findRecordsByFilter('links', 'source = {:id}', '', 0, 0, { id: id })) {
        const t = map[l.getString('target')];
        if (t === undefined || seen[l.id]) continue;
        seen[l.id] = true;
        const n = new Record(linkCol);
        n.set('board', boardId);
        n.set('source', map[id].id);
        n.set('target', t.id);
        for (const f of ['kind', 'label', 'status', 'added_by', 'reason']) n.set(f, l.get(f));
        app.save(n);
      }
    }
  }
  return map;
}

module.exports = {
  fileFromPath: fileFromPath,
  titleFromName: titleFromName,
  addCard: addCard,
  copyCard: copyCard,
  copyCards: copyCards,
};
