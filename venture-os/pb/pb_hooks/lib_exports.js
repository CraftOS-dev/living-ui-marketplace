/// <reference path="../pb_data/types.d.ts" />
/**
 * exports.all: the firm's data as one ZIP (people only, with the PIN):
 * one JSON file per collection (every record as PocketBase exports it
 * publicly: passwords, token keys and sealed values left out) and a
 * manifest with the counts. Stored files (decks, documents) are listed by
 * name in their records, not copied into the ZIP.
 *
 * The ZIP is written here (stored entries, CRC-32, UTF-8 names) and
 * streamed to the person; nothing is kept on disk.
 */

const SKIP = { pin_vault: 1, users: 1 };

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

let _crc = null;
function crcTable() {
  if (_crc !== null) return _crc;
  _crc = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    _crc.push(c >>> 0);
  }
  return _crc;
}

function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** UTF-8 bytes of a string. */
function utf8(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function le(out, v, n) {
  for (let i = 0; i < n; i++) out.push((v >>> (8 * i)) & 0xff);
}

/** A ZIP (stored, no compression) of [{ name, text }] as a Uint8Array. */
function zip(entries) {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const body = [];
  const central = [];
  for (const e of entries) {
    const name = utf8(e.name);
    const data = utf8(e.text);
    const crc = crc32(data);
    const offset = body.length;
    le(body, 0x04034b50, 4);
    le(body, 20, 2);
    le(body, 0x0800, 2);
    le(body, 0, 2);
    le(body, time, 2);
    le(body, date, 2);
    le(body, crc, 4);
    le(body, data.length, 4);
    le(body, data.length, 4);
    le(body, name.length, 2);
    le(body, 0, 2);
    for (const b of name) body.push(b);
    for (const b of data) body.push(b);
    le(central, 0x02014b50, 4);
    le(central, 20, 2);
    le(central, 20, 2);
    le(central, 0x0800, 2);
    le(central, 0, 2);
    le(central, time, 2);
    le(central, date, 2);
    le(central, crc, 4);
    le(central, data.length, 4);
    le(central, data.length, 4);
    le(central, name.length, 2);
    le(central, 0, 2);
    le(central, 0, 2);
    le(central, 0, 2);
    le(central, 0, 2);
    le(central, 0, 4);
    le(central, offset, 4);
    for (const b of name) central.push(b);
  }
  const end = [];
  le(end, 0x06054b50, 4);
  le(end, 0, 2);
  le(end, 0, 2);
  le(end, entries.length, 2);
  le(end, entries.length, 2);
  le(end, central.length, 4);
  le(end, body.length, 4);
  le(end, 0, 2);
  const out = new Uint8Array(body.length + central.length + end.length);
  out.set(body, 0);
  out.set(central, body.length);
  out.set(end, body.length + central.length);
  return out;
}

/** Every app collection name (system and platform ones left out). */
function collections(app) {
  return L('lib_util')
    .rows(app, "SELECT name FROM _collections WHERE name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name", { name: '' })
    .map((r) => r.name)
    .filter((n) => SKIP[n] === undefined && n !== require(`${__hooks}/_triggers_lib.js`).TRIGGER_COLLECTION);
}

/** The records of one collection as plain objects (sealed fields dropped). */
function dump(app, name) {
  const out = [];
  for (const r of app.findRecordsByFilter(name, '1=1', 'created', 0, 0)) {
    const o = JSON.parse(JSON.stringify(r.publicExport()));
    for (const k of Object.keys(o)) if (/_sealed$/.test(k) || k === 'tokenKey' || k === 'password') delete o[k];
    out.push(o);
  }
  return out;
}

function all(ctx) {
  const u = L('lib_util');
  const app = ctx.app;
  const entries = [];
  const counts = {};
  for (const name of collections(app)) {
    const rows = dump(app, name);
    counts[name] = rows.length;
    entries.push({ name: 'collections/' + name + '.json', text: JSON.stringify(rows, null, 1) });
  }
  const firm = L('lib_settings').row(app).getString('firm_name');
  const day = u.today(app);
  entries.unshift({ name: 'manifest.json', text: JSON.stringify({ app: 'Venture OS', firm: firm, exported_at: u.nowIso(), exported_by: ctx.name, units: L('lib_guide').CONVENTIONS, collections: counts }, null, 2) });
  L('lib_audit').write(ctx, { op: 'exports.all', collection: 'settings', summary: 'Exported all data (' + Object.keys(counts).length + ' collections)' });
  const bytes = zip(entries);
  const file = 'venture-os-export-' + day + '.zip';
  if (ctx.e === null || ctx.e === undefined) return { file: file, size: bytes.length, collections: counts };
  ctx.e.response.header().set('Content-Disposition', 'attachment; filename="' + file + '"');
  ctx.e.response.header().set('Cache-Control', 'no-store');
  ctx.e.blob(200, 'application/zip', bytes.buffer);
  return { __streamed: true };
}

module.exports = { all: all, zip: zip, crc32: crc32, utf8: utf8, collections: collections };
