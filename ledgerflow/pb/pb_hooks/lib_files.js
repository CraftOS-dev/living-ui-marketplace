/// <reference path="../pb_data/types.d.ts" />
/**
 * Receipts and documents: files dropped into the inbox.
 *
 * A file arrives in `inbox`. The AI agent (or the person) reads it, stores
 * what it says in `extracted` ({ vendor, date, total, tax, currency, number,
 * lines }) and links it: to an entry already in the books, to a bill it
 * drafts from the receipt, or to an invoice. Linked files show on their
 * entry or document; archived files are kept but out of the way.
 */

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', csv: 'text/csv', txt: 'text/plain', ofx: 'application/x-ofx', qif: 'application/qif', xml: 'application/xml', eml: 'message/rfc822' };

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function mimeOf(name) {
  const ext = String(name || '')
    .split('.')
    .pop()
    .toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function filePath(app, rec) {
  const p = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), rec.getString('file'));
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

function serialize(app, rec, forAgent) {
  const u = require(`${__hooks}/lib_util.js`);
  const out = {
    id: rec.id,
    name: rec.getString('name'),
    mime: rec.getString('mime'),
    size: rec.getInt('size'),
    kind: rec.getString('kind') || 'receipt',
    status: rec.getString('status') || 'inbox',
    extracted: u.json(rec, 'extracted', null),
    linked_type: rec.getString('linked_type'),
    linked_id: rec.getString('linked_id'),
    added_by: rec.getString('added_by') || 'user',
    run: rec.getString('run'),
    note: rec.getString('note'),
    agent_state: rec.getString('agent_state'),
    agent_at: rec.getString('agent_at'),
    image: /^image\//.test(rec.getString('mime')),
    created: rec.getString('created'),
  };
  if (forAgent && rec.getString('file')) out.path = filePath(app, rec);
  return out;
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'files', id);
  if (!rec) throw fail(404, 'No file ' + id + '; see files.list');
  return rec;
}

/** A local file named by the AI agent (never one inside the app's own folder, except uploads). */
function localFile(path) {
  let real = '';
  try {
    real = $filepath.clean($filepath.isAbs(path) ? path : $filepath.join($os.getwd(), path));
  } catch {
    throw fail(400, 'Give the absolute path of the file');
  }
  const appDir = $filepath.clean($filepath.join(__hooks, '..', '..'));
  const uploads = $filepath.clean($filepath.join(__hooks, '..', 'pb_data', 'storage'));
  const sep = $filepath.join('a', 'b').charAt(1);
  const under = (dir) => String(real).toLowerCase().indexOf(String(dir).toLowerCase() + sep) === 0;
  if ((under(appDir) || String(real).toLowerCase() === String(appDir).toLowerCase()) && !under(uploads)) throw fail(403, "Files inside the app's own folder cannot be added");
  try {
    if ($os.stat(real).isDir()) throw fail(400, path + ' is a folder, not a file');
  } catch (err) {
    if (err && err.status) throw err;
    throw fail(400, 'No file at "' + path + '"');
  }
  return $filesystem.fileFromPath(real);
}

/** Store uploaded (or local) files. Returns the new records. */
function add(app, files, opts, who) {
  const o = opts || {};
  const col = app.findCollectionByNameOrId('files');
  const out = [];
  for (const f of files) {
    const name = String(f.originalName || f.name || 'file').slice(0, 255);
    if (f.size > 25 * 1024 * 1024) throw fail(413, name + ' is larger than 25 MB');
    const rec = new Record(col);
    rec.set('file', f);
    rec.set('name', name);
    rec.set('mime', mimeOf(name));
    rec.set('size', Number(f.size || 0));
    rec.set('kind', ['receipt', 'invoice', 'statement', 'other'].indexOf(o.kind) >= 0 ? o.kind : 'receipt');
    rec.set('status', o.link_type ? 'linked' : 'inbox');
    rec.set('linked_type', o.link_type || '');
    rec.set('linked_id', o.link_id || '');
    rec.set('added_by', who.actor === 'agent' ? 'agent' : 'user');
    rec.set('run', who.run || '');
    rec.set('note', String(o.note || '').slice(0, 1000));
    // The AI agent reads what the person drops in (not what it added itself).
    rec.set('agent_state', who.actor !== 'agent' && !o.link_type && o.agent !== false ? 'waiting' : '');
    rec.set('agent_at', '');
    app.save(rec);
    out.push(rec);
  }
  return out;
}

/** Link a file to an entry, a document or a statement line (or unlink with type ''). */
function link(app, rec, type, id) {
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const docs = require(`${__hooks}/lib_docs.js`);
  if (type === '' || type === null || type === undefined) {
    rec.set('linked_type', '');
    rec.set('linked_id', '');
    rec.set('status', 'inbox');
    app.save(rec);
    return rec;
  }
  if (type === 'transaction') ledger.mustTxn(app, id);
  else if (type === 'document') {
    const d = docs.mustGet(app, id);
    id = d.id;
    if (!d.getString('file')) {
      d.set('file', rec.id);
      app.save(d);
    }
  } else if (type === 'line') require(`${__hooks}/lib_inbox.js`).mustLine(app, id);
  else throw fail(400, 'type must be transaction, document or line');
  rec.set('linked_type', type);
  rec.set('linked_id', id);
  rec.set('status', 'linked');
  if (rec.getString('agent_state') === 'waiting' || rec.getString('agent_state') === 'working') rec.set('agent_state', 'done');
  app.save(rec);
  return rec;
}

/** Files linked to something. */
function linkedTo(app, type, id) {
  return app.findRecordsByFilter('files', 'linked_type = {:t} && linked_id = {:i}', '-created', 50, 0, { t: type, i: id }).map((r) => serialize(app, r, false));
}

/**
 * Entries that could be the purchase on a receipt: same total on a bank,
 * card or cash account within a week of its date, with no file yet.
 */
function candidates(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const dates = require(`${__hooks}/lib_dates.js`);
  const money = require(`${__hooks}/lib_money.js`);
  const ledger = require(`${__hooks}/lib_ledger.js`);
  const x = u.json(rec, 'extracted', null);
  if (!x || !x.total || !x.date) return [];
  let total;
  try {
    total = Math.abs(money.amount(x.total, x.currency || ledger.home(app), 'total'));
  } catch {
    return [];
  }
  const d = dates.valid(x.date) ? x.date : '';
  if (!d) return [];
  const posts = app.findRecordsByFilter('postings', "status = 'posted' && (amount = {:a} || amount = {:b}) && date >= {:f} && date <= {:t}", 'date', 40, 0, { a: total, b: -total, f: dates.addDays(d, -7), t: dates.addDays(d, 7) });
  const out = [];
  const seen = {};
  for (const p of posts) {
    const acc = app.findRecordById('accounts', p.getString('account'));
    if (!require(`${__hooks}/lib_inbox.js`).cashLike(acc)) continue;
    if (seen[p.getString('txn')]) continue;
    seen[p.getString('txn')] = true;
    const t = app.findRecordById('transactions', p.getString('txn'));
    const has = app.findRecordsByFilter('files', "linked_type = 'transaction' && linked_id = {:t}", '', 1, 0, { t: t.id }).length > 0;
    out.push({ txn: t.id, date: t.getString('date'), narration: t.getString('narration'), amount: p.getInt('amount'), account: acc.getString('name'), days: Math.abs(dates.daysBetween(d, t.getString('date'))), has_file: has });
  }
  out.sort((a, b) => a.days - b.days);
  return out.slice(0, 8);
}

module.exports = { mimeOf: mimeOf, filePath: filePath, serialize: serialize, mustGet: mustGet, localFile: localFile, add: add, link: link, linkedTo: linkedTo, candidates: candidates };
