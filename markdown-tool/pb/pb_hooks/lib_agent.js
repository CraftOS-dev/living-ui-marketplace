/// <reference path="../pb_data/types.d.ts" />
/**
 * AGENT OPERATIONS — server-side ports of the Markdown Editor's file API.
 *
 * The app has no server logic of its own: every rule about the workspace lives
 * in the browser, in frontend/src/app/services/apiAdapter.ts (a fetch shim that
 * rebuilds V1's /api/files* routes on top of the `nodes` collection), and in the
 * components that call it (FolderPanel.tsx, MainView.tsx). This module ports
 * those rules so an AI agent can do through operations exactly what a person
 * does in the UI — same records, same field formats, same side effects:
 *
 *   - a node is { path, parent, name, is_dir, content, modified } where
 *     parent = parentOf(path), name = nameOf(path), modified = epoch seconds;
 *   - new paths follow the workspace's path rules (frontend/src/app/services/
 *     paths.ts, same messages): no backslash, no leading "/", no empty, "."
 *     or ".." segment, and a rename's name is one segment; a new path under
 *     a file ("x.md/y.md") is refused, as the explorer could not show it;
 *   - missing ancestor folders are created (ensureDirs);
 *   - renaming or moving a folder carries every descendant (never into
 *     itself); deleting a folder deletes every descendant;
 *   - New File appends ".md" unless the name ends in .md or .markdown (any
 *     case); uploads refuse existing paths unless overwriting, and never
 *     replace a folder;
 *   - saving updates an existing .md/.markdown file only;
 *   - the editor session's tabs follow a rename/move and close on a delete,
 *     for the node and everything inside it; tabs are stored as { path }.
 *
 * Differences, all agent-only:
 *   - each multi-record change runs in one transaction, the tab bookkeeping
 *     included (the UI's REST sequence undoes what it can on a failure);
 *   - input checks refuse a write the UI could never produce: a non-markdown
 *     file as the editor's save target;
 *   - transport aids: `encoding: base64` and `append` (same stored result);
 *   - `expected_modified` refuses a write when the file was saved since read.
 *
 * Routes live in agent_ops.pb.js. PocketBase runs every route handler in an
 * isolated VM, so each handler require()s this module itself; nothing here may
 * rely on state shared between requests.
 */

const MAX_PATH = 2000; // nodes.path max
const MAX_NAME = 500; // nodes.name max
const MAX_CONTENT = 10000000; // nodes.content max

/* ================================================================ plumbing */

function fail(status, message, data) {
  const err = new Error(message);
  err.status = status;
  if (data !== undefined) err.data = data;
  return err;
}

/**
 * Run fn(params, app) and answer JSON. Params are the query string merged with
 * the JSON body (the agent CLI sends a body; a GET caller sends a query).
 * Errors are answered with e.json in PocketBase's own error shape
 * { status, message, data } — never thrown out of the handler.
 */
function handle(e, fn) {
  try {
    const info = e.requestInfo();
    const params = {};
    const query = info.query || {};
    for (const k of Object.keys(query)) params[k] = query[k];
    const body = info.body || {};
    for (const k of Object.keys(body)) params[k] = body[k];
    const out = fn(params, e.app);
    return e.json(200, out === undefined ? { ok: true } : out);
  } catch (err) {
    let status = err && typeof err.status === 'number' ? err.status : 500;
    let message = String((err && err.message) || err);
    // A concurrent writer took the same path between our check and the save.
    if (status === 500 && message.indexOf('UNIQUE constraint failed') >= 0) {
      status = 409;
      message = 'Already exists (the workspace changed meanwhile); list the folder and try again';
    }
    if (status >= 500) console.error('[markdown-tool] agent operation failed:', message);
    const out = { status: status, message: message };
    if (err && err.data !== undefined) out.data = err.data;
    return e.json(status, out);
  }
}

function has(p, name) {
  return p[name] !== undefined && p[name] !== null;
}

/** Text param as given (numbers/booleans from CLI coercion become text). */
function text(p, name) {
  if (!has(p, name)) return undefined;
  const v = p[name];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw fail(400, name + ' must be text');
}

/** Required text param, trimmed (the UI trims every name a person types). */
function requiredTrimmed(p, name) {
  const v = text(p, name);
  const t = v === undefined ? '' : v.trim();
  if (t === '') throw fail(400, name + ' is required');
  return t;
}

/** Required path of an EXISTING node: kept exactly as given (trimmed only as a fallback at lookup). */
function requiredPath(p, name) {
  const v = text(p, name);
  if (v === undefined || v.trim() === '') throw fail(400, name + ' is required');
  return v;
}

function bool(p, name, dflt) {
  if (!has(p, name) || p[name] === '') return dflt;
  const v = p[name];
  if (v === true || v === 'true' || v === '1' || v === 1) return true;
  if (v === false || v === 'false' || v === '0' || v === 0) return false;
  throw fail(400, name + ' must be true or false');
}

function num(p, name) {
  if (!has(p, name) || p[name] === '') return undefined;
  const v = typeof p[name] === 'number' ? p[name] : Number(String(p[name]).trim());
  if (!isFinite(v)) throw fail(400, name + ' must be a number, e.g. 1731312345.123 (the modified value files.read returned)');
  return v;
}

function oneOf(p, name, values, dflt) {
  const v = text(p, name);
  if (v === undefined || v.trim() === '') return dflt;
  const t = v.trim();
  if (values.indexOf(t) < 0) throw fail(400, name + ' must be one of: ' + values.join(', '));
  return t;
}

/* =================================================== ports of apiAdapter.ts */

/** apiAdapter.ts nowSeconds(): epoch seconds, fractional (V1 returned st_mtime). */
function nowSeconds() {
  return Date.now() / 1000;
}

/** apiAdapter.ts parentOf(). */
function parentOf(path) {
  return path.indexOf('/') >= 0 ? path.split('/').slice(0, -1).join('/') : '';
}

/** apiAdapter.ts nameOf(). */
function nameOf(path) {
  const parts = path.split('/');
  const last = parts[parts.length - 1];
  return last === undefined ? path : last;
}

/** paths.ts isMarkdownName(): only these files open in the editor. */
function isMarkdownName(name) {
  const lower = String(name).toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

/** paths.ts pathProblem(): why a new path cannot be used, or null. */
function pathProblem(path) {
  if (path.indexOf('\\') >= 0) return 'A name cannot contain "\\"';
  if (path.startsWith('/')) return 'A path cannot start with "/"';
  for (const segment of path.split('/')) {
    if (segment === '') return 'A path cannot have an empty name in it ("//" or a "/" at the end)';
    if (segment === '.' || segment === '..') return '"." and ".." cannot be used as names';
  }
  return null;
}

/** paths.ts nameProblem(): why a new name (one segment) cannot be used, or null. */
function nameProblem(name) {
  if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return 'A name cannot contain "/" or "\\"';
  return pathProblem(name);
}

/** Refuse a new path the workspace does not allow (400, the UI's message). */
function checkNewPath(path) {
  const problem = pathProblem(path);
  if (problem) throw fail(400, problem + ': ' + path);
}

/** apiAdapter.ts toFileItem(): the explorer's FileItem shape. */
function toFileItem(row) {
  return {
    name: row.name,
    path: row.path,
    is_dir: row.is_dir,
    is_markdown: !row.is_dir && isMarkdownName(row.name),
    modified: row.modified,
  };
}

/** apiAdapter.ts handleListFiles() sort: directories first, then case-insensitive name. */
function explorerOrder(a, b) {
  if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  return an < bn ? -1 : an > bn ? 1 : 0;
}

/**
 * Every node WITHOUT its content (the UI's pbListAll('nodes') pulls the text
 * of every file; one light query is enough for paths). Returned as a plain JS
 * array — never sort or reverse the Go slice a query fills.
 */
function lightRows(app) {
  const rows = arrayOf(new DynamicModel({ id: '', path: '', parent: '', name: '', is_dir: false, modified: -0 }));
  app
    .db()
    .newQuery(
      "SELECT id, COALESCE(path, '') AS path, COALESCE(parent, '') AS parent, COALESCE(name, '') AS name, " +
        'COALESCE(is_dir, 0) AS is_dir, COALESCE(modified, 0) AS modified FROM nodes',
    )
    .all(rows);
  return Array.from(rows).map((r) => ({
    id: String(r.id),
    path: String(r.path),
    parent: String(r.parent),
    name: String(r.name),
    is_dir: r.is_dir === true,
    modified: Number(r.modified) || 0,
  }));
}

function indexByPath(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.path, r);
  return m;
}

/** apiAdapter.ts findByPath(), with a trimmed second try for agent input. */
function findRow(byPath, path) {
  if (byPath.has(path)) return byPath.get(path);
  const t = path.trim();
  return t !== path && byPath.has(t) ? byPath.get(t) : null;
}

/** One full record by exact path (or trimmed path), or null. */
function findRecord(app, path) {
  for (const candidate of path.trim() !== path ? [path, path.trim()] : [path]) {
    try {
      return app.findFirstRecordByData('nodes', 'path', candidate);
    } catch (_e) {
      /* not found — try the next candidate */
    }
  }
  return null;
}

/** The node and every descendant: apiAdapter.ts handleRenameItem()/handleDeleteItem() `affected`. */
function subtree(rows, path) {
  const prefix = path + '/';
  return rows.filter((r) => r.path === path || r.path.startsWith(prefix));
}

/**
 * Plan apiAdapter.ts ensureDirs(parentOf(path)) and check the result is a node
 * the explorer can show.
 *
 * ensureDirs creates each missing prefix of the parent's '/'-separated segments
 * as a folder. The explorer lists a node only under `parent = <folder>`, so a
 * node is visible only if every folder of its parent chain exists as a folder.
 * After the path rules (checkNewPath), this refuses the paths the explorer
 * could still NOT show (a file used as a folder, as paths.ts parentProblem()
 * does in the UI) and never alters a valid one.
 *
 * `gone` (a Set of paths) are nodes that the same write moves away.
 * Returns the folders to create, in order.
 */
function planNewPath(rows, path, gone) {
  checkNewPath(path);
  const name = nameOf(path);
  if (path.length > MAX_PATH) throw fail(400, 'The path is longer than ' + MAX_PATH + ' characters');
  if (name.length > MAX_NAME) throw fail(400, 'The name "' + name.slice(0, 40) + '…" is longer than ' + MAX_NAME + ' characters');

  const before = indexByPath(rows);
  const create = [];
  let prefix = '';
  for (const seg of parentOf(path).split('/').filter(Boolean)) {
    prefix = prefix ? prefix + '/' + seg : seg;
    if (!before.has(prefix)) {
      if (seg.length > MAX_NAME) throw fail(400, 'The folder name "' + seg.slice(0, 40) + '…" is longer than ' + MAX_NAME + ' characters');
      create.push(prefix);
    }
  }
  const created = new Set(create);
  for (let dir = parentOf(path); dir !== ''; dir = parentOf(dir)) {
    const row = gone && gone.has(dir) ? null : before.get(dir) || null;
    if (row && !row.is_dir) {
      throw fail(409, '"' + dir + '" is a file, not a folder', { code: 'conflict', path: dir });
    }
    if (!row && !created.has(dir)) {
      throw fail(400, 'The explorer could not show "' + path + '": its folder "' + dir + '" would not exist');
    }
  }
  return create;
}

/** ensureDirs(): create the planned folder nodes (apiAdapter.ts lines 209-216 shape). */
function createDirs(tx, dirs, now) {
  const col = tx.findCollectionByNameOrId('nodes');
  for (const dir of dirs) {
    tx.save(new Record(col, { path: dir, parent: parentOf(dir), name: nameOf(dir), is_dir: true, content: '', modified: now }));
  }
}

/* ================================================== content, transport, guard */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** UTF-8 bytes → string; invalid sequences become U+FFFD, a leading BOM is dropped (as File.text()). */
function utf8Decode(bytes) {
  const parts = [];
  let units = [];
  const flush = () => {
    if (units.length) {
      parts.push(String.fromCharCode.apply(null, units));
      units = [];
    }
  };
  const push = (cp) => {
    if (cp > 0xffff) {
      const c = cp - 0x10000;
      units.push(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    } else {
      units.push(cp);
    }
    if (units.length >= 8192) flush();
  };
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      push(b);
      i += 1;
      continue;
    }
    let need = 0;
    let cp = 0;
    let min = 0;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      cp = b & 0x1f;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      cp = b & 0x0f;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      cp = b & 0x07;
      min = 0x10000;
    }
    let ok = need > 0 && i + need < bytes.length;
    for (let k = 1; ok && k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) ok = false;
      else cp = (cp << 6) | (c & 0x3f);
    }
    if (ok && (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))) ok = false;
    if (ok) {
      push(cp);
      i += need + 1;
    } else {
      push(0xfffd);
      i += 1;
    }
  }
  flush();
  const out = parts.join('');
  return out.charCodeAt(0) === 0xfeff ? out.slice(1) : out;
}

/** Base64 (standard or URL-safe, padding optional, whitespace ignored) → UTF-8 text. */
function base64Text(value) {
  const s = String(value).replace(/\s+/g, '').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+\/_-]*$/.test(s) || s.length % 4 === 1) {
    throw fail(400, 'content is not valid base64 (encoding was base64)');
  }
  const bytes = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    const v = B64.indexOf(ch === '-' ? '+' : ch === '_' ? '/' : ch);
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  return utf8Decode(bytes);
}

/**
 * The `content` param, decoded. It must be present ("" is a real, empty text);
 * a JSON null is what the CLI makes of the word "null", so it is refused with
 * the base64 hint rather than written as an empty file.
 */
function contentParam(p) {
  if (p.content === null) {
    throw fail(400, 'content arrived as null (the CLI turns the word null into JSON null); send it with --encoding base64');
  }
  const raw = text(p, 'content');
  if (raw === undefined) throw fail(400, 'content is required; pass --content "" for an empty file');
  const encoding = oneOf(p, 'encoding', ['text', 'base64'], 'text');
  const out = encoding === 'base64' ? base64Text(raw) : raw;
  if (out.length > MAX_CONTENT) throw fail(400, 'The text is longer than ' + MAX_CONTENT + ' characters');
  return out;
}

/* ================================================================ session */

/** apiAdapter.ts resolveSessionRecord(): the first `sessions` row (never created here). */
function sessionRecord(app) {
  const rows = app.findAllRecords('sessions');
  return rows && rows.length ? rows[0] : null;
}

function sessionTabs(rec) {
  let tabs = [];
  try {
    const raw = rec.getString('open_tabs');
    tabs = raw ? JSON.parse(raw) : [];
  } catch (_e) {
    tabs = [];
  }
  return Array.isArray(tabs) ? tabs : [];
}

function tabPath(t) {
  return t && typeof t === 'object' && typeof t.path === 'string' ? t.path : null;
}

/** Is `path` open in a tab, per the stored session? */
function openInEditor(app, path) {
  let rec = null;
  try {
    rec = sessionRecord(app);
  } catch (_e) {
    return false;
  }
  if (!rec) return false;
  return sessionTabs(rec).some((t) => tabPath(t) === path);
}

/** `path` itself, or a node inside it. */
function within(path, p) {
  return p === path || (typeof p === 'string' && p.startsWith(path + '/'));
}

/**
 * Apply the UI's tab bookkeeping to the stored session, inside the operation's
 * transaction (`tx`): if the session cannot be saved, the whole operation is
 * undone and fails. Tabs are stored as { path }, as MainView stores them.
 * Returns how many tabs changed.
 */
function retab(tx, fn) {
  const rec = sessionRecord(tx);
  if (!rec) return 0;
  const result = fn(sessionTabs(rec), rec.getString('active_tab'));
  if (!result || !result.changed) return 0;
  rec.set(
    'open_tabs',
    result.tabs.filter((t) => tabPath(t) !== null).map((t) => ({ path: tabPath(t) })),
  );
  rec.set('active_tab', result.active);
  tx.save(rec);
  return result.changed;
}

/** MainView.tsx handleFileRenamed(): the tabs of oldPath and of everything inside it follow. */
function renameTabs(oldPath, newPath) {
  const moved = (p) => (within(oldPath, p) ? newPath + p.slice(oldPath.length) : p);
  return (tabs, active) => {
    let changed = 0;
    const next = tabs.map((t) => {
      const p = tabPath(t);
      if (!within(oldPath, p)) return t;
      changed++;
      return { path: moved(p) };
    });
    const nextActive = moved(active);
    if (nextActive !== active && changed === 0) changed = 1;
    return { tabs: next, active: nextActive, changed: changed };
  };
}

/**
 * MainView.tsx handleFileDeleted(): close the tabs of `path` and of everything
 * inside it; when the active tab closes, the tab beside it becomes active.
 */
function closeTabs(path) {
  return (tabs, active) => {
    const next = tabs.filter((t) => !within(path, tabPath(t)));
    let nextActive = active;
    if (within(path, active)) {
      const idx = tabs.findIndex((t) => tabPath(t) === active);
      const closedBefore = tabs.slice(0, Math.max(idx, 0)).filter((t) => within(path, tabPath(t))).length;
      const neighbour = next[Math.min(idx - closedBefore, next.length - 1)];
      nextActive = tabPath(neighbour) || '';
    }
    const changed = tabs.length - next.length + (nextActive !== active ? 1 : 0);
    return { tabs: next, active: nextActive, changed: changed };
  };
}

/* ============================================================== operations */

/**
 * files.list — the explorer tree. Port of apiAdapter.ts handleListFiles()
 * (one level, `parent = folder`, folders first, A–Z) applied to every folder
 * as a person expands it (FolderPanel.tsx toggleDir()). Only nodes reachable
 * from `folder` through existing folders are listed, as in the explorer.
 */
function list(app, p) {
  const asked = text(p, 'folder');
  const recursive = bool(p, 'recursive', true);
  const rows = lightRows(app);
  const byPath = indexByPath(rows);
  let folder = '';
  if (asked !== undefined && asked.trim() !== '') {
    const row = findRow(byPath, asked);
    if (!row) throw fail(404, 'Folder not found');
    if (!row.is_dir) throw fail(400, 'Path is not a folder');
    folder = row.path;
  }
  const byParent = new Map();
  for (const r of rows) {
    if (!byParent.has(r.parent)) byParent.set(r.parent, []);
    byParent.get(r.parent).push(r);
  }
  const items = [];
  const seen = new Set();
  const walk = (dir) => {
    const kids = (byParent.get(dir) || []).slice().sort(explorerOrder);
    for (const k of kids) {
      if (seen.has(k.path)) continue;
      seen.add(k.path);
      items.push(toFileItem(k));
      if (recursive && k.is_dir) walk(k.path);
    }
  };
  walk(folder);
  return { folder: folder, recursive: recursive, count: items.length, items: items };
}

/** files.read — open a file. Port of apiAdapter.ts handleReadFile() plus the explorer's .md gate (FolderPanel.tsx). */
function read(app, p) {
  const asked = requiredPath(p, 'path');
  const rec = findRecord(app, asked);
  if (!rec) throw fail(404, 'File not found');
  if (rec.getBool('is_dir')) throw fail(400, 'Path is not a file');
  const path = rec.getString('path');
  const name = rec.getString('name') || nameOf(path);
  if (!isMarkdownName(name)) throw fail(400, 'Only .md and .markdown files open in the editor');
  return {
    path: path,
    name: name,
    content: rec.getString('content'),
    modified: rec.getFloat('modified'),
    open_in_editor: openInEditor(app, path),
  };
}

/**
 * files.write — Save (Ctrl+S). Port of apiAdapter.ts handleWriteFile(),
 * reached from MainView.tsx handleSave(): content + modified of an existing
 * file; a missing file or a folder is refused, as the editor refuses them.
 */
function write(app, p) {
  const asked = requiredPath(p, 'path');
  const rec = findRecord(app, asked);
  if (!rec) throw fail(404, 'File not found; use files.upload to add a new file');
  if (rec.getBool('is_dir')) throw fail(409, 'A folder has this path', { code: 'conflict', path: rec.getString('path') });
  const path = rec.getString('path');
  if (!isMarkdownName(rec.getString('name') || nameOf(path))) throw fail(400, 'Only .md and .markdown files open in the editor');
  const content = contentParam(p);
  const append = bool(p, 'append', false);
  const expected = num(p, 'expected_modified');
  const stored = rec.getFloat('modified');
  if (expected !== undefined && Math.abs(stored - expected) > 1e-6) {
    throw fail(409, 'The file was saved since you read it (modified is now ' + stored + '); read it again before writing', {
      code: 'conflict',
      modified: stored,
    });
  }
  const next = append ? rec.getString('content') + content : content;
  if (next.length > MAX_CONTENT) throw fail(400, 'The text would be longer than ' + MAX_CONTENT + ' characters');
  const now = nowSeconds();
  rec.set('content', next);
  rec.set('modified', now);
  app.save(rec);
  const open = openInEditor(app, path);
  const out = { status: 'saved', path: path, modified: now, length: next.length, open_in_editor: open };
  if (open) {
    out.note =
      'The person has this file open: their tab keeps the old text until they close and reopen it or reload, and saving that tab would overwrite this write.';
  }
  return out;
}

/**
 * files.create — New File / New Folder. Port of FolderPanel.tsx handleCreate()
 * (the path rules, then ".md" appended unless the path ends in .md or
 * .markdown, any case) and apiAdapter.ts handleCreateItem() (409 when the path
 * exists, ensureDirs, empty node).
 */
function create(app, p) {
  const typed = requiredTrimmed(p, 'path');
  const type = oneOf(p, 'type', ['file', 'folder'], 'file');
  checkNewPath(typed);
  const mdAppended = type === 'file' && !isMarkdownName(typed);
  const path = mdAppended ? typed + '.md' : typed;
  const rows = lightRows(app);
  if (indexByPath(rows).has(path)) throw fail(409, 'Already exists', { code: 'conflict', path: path });
  const dirs = planNewPath(rows, path, null);
  const now = nowSeconds();
  app.runInTransaction((tx) => {
    createDirs(tx, dirs, now);
    const col = tx.findCollectionByNameOrId('nodes');
    tx.save(new Record(col, { path: path, parent: parentOf(path), name: nameOf(path), is_dir: type === 'folder', content: '', modified: now }));
  });
  return { status: 'created', path: path, type: type, md_appended: mdAppended, created_folders: dirs };
}

/**
 * files.upload / files.upload-overwrite — Upload File / Upload Folder, one
 * file per call. Port of apiAdapter.ts handleUpload(): a path the rules refuse,
 * or a folder's path, is not uploaded, with the reason; without `overwrite`,
 * an existing file is a conflict and nothing is written (the UI then asks
 * "Overwrite?"); with it, ensureDirs then create or replace content+modified.
 */
function upload(app, p, overwrite) {
  const path = requiredTrimmed(p, 'path');
  const content = contentParam(p);
  const problem = pathProblem(path);
  if (problem) throw fail(400, 'Not uploaded: ' + path + ' (' + problem + ')');
  const rows = lightRows(app);
  const existing = indexByPath(rows).get(path) || null;
  if (existing && existing.is_dir) {
    throw fail(409, 'Not uploaded: ' + path + ' (A folder has this path)', { code: 'conflict', path: path });
  }
  if (existing && !overwrite) {
    throw fail(409, 'File(s) already exist: ' + path + '. Ask the person, then use files.upload-overwrite', {
      code: 'conflict',
      conflicts: [path],
    });
  }
  // ensureDirs runs for every uploaded file; only a NEW file must also be one
  // the explorer can show.
  let dirs;
  if (existing) {
    dirs = [];
    let prefix = '';
    const byPath = indexByPath(rows);
    for (const seg of parentOf(path).split('/').filter(Boolean)) {
      prefix = prefix ? prefix + '/' + seg : seg;
      if (!byPath.has(prefix)) dirs.push(prefix);
    }
  } else {
    dirs = planNewPath(rows, path, null);
  }
  const now = nowSeconds();
  app.runInTransaction((tx) => {
    createDirs(tx, dirs, now);
    if (existing) {
      const rec = tx.findRecordById('nodes', existing.id);
      rec.set('content', content);
      rec.set('modified', now);
      tx.save(rec);
    } else {
      const col = tx.findCollectionByNameOrId('nodes');
      tx.save(new Record(col, { path: path, parent: parentOf(path), name: nameOf(path), is_dir: false, content: content, modified: now }));
    }
  });
  return { status: 'uploaded', path: path, replaced: !!existing, created_folders: dirs };
}

/**
 * Move a node and its descendants to `newPath`: apiAdapter.ts
 * handleRenameItem() (ensureDirs on the new parent, then path/parent/name of
 * every affected node rewritten; `modified` untouched) and MainView.tsx
 * handleFileRenamed() on the session, in one transaction.
 */
function relocate(app, rows, src, newPath) {
  // A folder moved inside itself would leave its whole subtree without a folder.
  if (newPath.startsWith(src.path + '/')) throw fail(400, 'A folder cannot be moved inside itself');
  const moving = subtree(rows, src.path);
  const gone = new Set(moving.map((r) => r.path));
  const dirs = planNewPath(rows, newPath, gone);
  const byPath = indexByPath(rows);
  const clashes = [];
  for (const r of moving) {
    const np = newPath + r.path.slice(src.path.length);
    if (np.length > MAX_PATH) throw fail(400, 'A moved path would be longer than ' + MAX_PATH + ' characters: ' + np.slice(0, 60) + '…');
    if (byPath.has(np) && !gone.has(np)) clashes.push(np);
  }
  if (clashes.length) throw fail(409, 'Paths already in use', { code: 'conflict', conflicts: clashes });
  const now = nowSeconds();
  let tabsUpdated = 0;
  app.runInTransaction((tx) => {
    createDirs(tx, dirs, now);
    for (const r of moving) {
      const np = newPath + r.path.slice(src.path.length);
      const rec = tx.findRecordById('nodes', r.id);
      rec.set('path', np);
      rec.set('parent', parentOf(np));
      rec.set('name', nameOf(np));
      tx.save(rec);
    }
    tabsUpdated = retab(tx, renameTabs(src.path, newPath));
  });
  return { moved: moving.length, created_folders: dirs, tabs_updated: tabsUpdated };
}

/**
 * files.rename — the Rename modal. Port of FolderPanel.tsx handleRename()
 * (a one-segment name, new path = same folder + trimmed name) and
 * apiAdapter.ts handleRenameItem() (404 source missing, 409 destination
 * exists, descendants move along).
 */
function rename(app, p) {
  const asked = requiredPath(p, 'path');
  const name = requiredTrimmed(p, 'name');
  const problem = nameProblem(name);
  if (problem) throw fail(400, problem + ': ' + name);
  const rows = lightRows(app);
  const src = findRow(indexByPath(rows), asked);
  if (!src) throw fail(404, 'Source not found');
  const dir = src.path.indexOf('/') >= 0 ? src.path.split('/').slice(0, -1).join('/') : '';
  const newPath = dir ? dir + '/' + name : name;
  if (indexByPath(rows).has(newPath)) throw fail(409, 'Name already taken', { code: 'conflict', path: newPath });
  const r = relocate(app, rows, src, newPath);
  const newName = nameOf(newPath);
  return {
    status: 'renamed',
    old_path: src.path,
    new_path: newPath,
    moved: r.moved,
    is_markdown: !src.is_dir && isMarkdownName(newName),
    created_folders: r.created_folders,
    tabs_updated: r.tabs_updated,
  };
}

/**
 * files.move — drag a file onto a folder. Port of FolderPanel.tsx handleDrop()
 * (files only, folders only as targets, dst = folder/filename, same place is a
 * no-op, 409 when the name is taken) then renameItem as in files.rename.
 */
function move(app, p) {
  const asked = requiredPath(p, 'path');
  const toAsked = text(p, 'to');
  const rows = lightRows(app);
  const byPath = indexByPath(rows);
  const src = findRow(byPath, asked);
  if (!src) throw fail(404, 'File not found');
  if (src.is_dir) throw fail(400, 'Only files can be moved; the explorer cannot drag folders');
  if (toAsked === undefined || toAsked.trim() === '') {
    throw fail(400, 'to is required: a folder (the explorer has no drop target at the top level)');
  }
  const target = findRow(byPath, toAsked);
  if (!target) throw fail(404, 'Folder not found');
  if (!target.is_dir) throw fail(400, 'to is not a folder');
  const fileName = src.path.split('/').pop();
  const dst = target.path + '/' + fileName;
  if (dst === src.path) return { status: 'unchanged', old_path: src.path, new_path: dst, tabs_updated: 0 };
  if (byPath.has(dst)) throw fail(409, 'A file with that name already exists in this folder', { code: 'conflict', path: dst });
  const r = relocate(app, rows, src, dst);
  return { status: 'moved', old_path: src.path, new_path: dst, tabs_updated: r.tabs_updated };
}

/**
 * files.delete — the delete confirm. Port of apiAdapter.ts handleDeleteItem()
 * (a missing path answers not_found; the node and every descendant go) and
 * MainView.tsx handleFileDeleted() on the session, in one transaction.
 */
function remove(app, p) {
  const asked = requiredPath(p, 'path');
  const rows = lightRows(app);
  const target = findRow(indexByPath(rows), asked);
  if (!target) return { status: 'not_found', path: asked, deleted: { files: 0, folders: 0 }, tabs_updated: 0 };
  const affected = subtree(rows, target.path);
  let tabsUpdated = 0;
  app.runInTransaction((tx) => {
    for (const r of affected) tx.delete(tx.findRecordById('nodes', r.id));
    tabsUpdated = retab(tx, closeTabs(target.path));
  });
  const folders = affected.filter((r) => r.is_dir).length;
  return {
    status: 'deleted',
    path: target.path,
    deleted: { files: affected.length - folders, folders: folders },
    tabs_updated: tabsUpdated,
  };
}

/**
 * editor.tabs — the tabs the editor restores (MainView.tsx restore()): open
 * paths and the active one, as last saved by the editor. `exists` is false for
 * a tab whose file is gone (restore drops it). Never returns the stored copies
 * of file text.
 */
function tabs(app) {
  const note = 'As last saved by the editor; unsaved edits are not included, and an open editor does not reload these tabs.';
  const rec = sessionRecord(app);
  if (!rec) return { active: null, open: [], note: note };
  const active = rec.getString('active_tab') || null;
  const byPath = indexByPath(lightRows(app));
  const open = [];
  for (const t of sessionTabs(rec)) {
    const path = tabPath(t);
    if (path === null) continue;
    const row = byPath.get(path);
    open.push({ path: path, active: path === active, exists: !!row && !row.is_dir });
  }
  return { active: active, open: open, note: note };
}

module.exports = {
  handle: handle,
  list: list,
  read: read,
  write: write,
  create: create,
  upload: upload,
  rename: rename,
  move: move,
  remove: remove,
  tabs: tabs,
  // exported for tests
  parentOf: parentOf,
  nameOf: nameOf,
  base64Text: base64Text,
  pathProblem: pathProblem,
  isMarkdownName: isMarkdownName,
};
