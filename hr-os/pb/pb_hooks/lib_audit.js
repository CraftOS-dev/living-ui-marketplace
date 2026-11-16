/// <reference path="../pb_data/types.d.ts" />
/**
 * The audit trail: who (a person, your AI agent or the app) did what to
 * which record, with before and after for corrections.
 *
 * write() is called with the handle that makes the change (the transaction
 * handle inside a transaction, via lib_auth.withApp), so a change and its
 * audit row commit together. The dispatcher writes one row for every write
 * op unless the handler wrote its own (ctx.audited) or left details in
 * ctx.auditInfo ({ collection, record, summary, before, after }).
 *
 * Sealed values never reach the trail: fields ending in _sealed and the
 * secret fields of members are dropped from before/after, and secret
 * params are left out by the dispatcher.
 */

const DROP = ['password', 'passwordConfirm', 'tokenKey', 'invite_hash', 'recovery_hash', 'pin', 'new_pin', 'current_pin', 'recovery_code', 'kiosk_code'];

function clean(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(clean);
  if (typeof v !== 'object') return v;
  const out = {};
  for (const k of Object.keys(v)) {
    if (DROP.indexOf(k) >= 0 || /_sealed$/.test(k)) continue;
    out[k] = clean(v[k]);
  }
  return out;
}

function cap(v, max) {
  if (v === null || v === undefined) return null;
  const s = JSON.stringify(v);
  return s.length > max ? { truncated: true, size: s.length } : v;
}

/** Write one audit row. entry: { op, collection, record, summary, before, after, data }. */
function write(ctx, entry) {
  const u = require(`${__hooks}/lib_util.js`);
  const app = ctx.app;
  const rec = u.newRecord(app, 'audit');
  const actor = ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system';
  rec.set('actor', actor);
  rec.set('member', actor === 'person' ? ctx.memberId || '' : '');
  rec.set('op', u.clip(entry.op || ctx.op || '', 80));
  rec.set('collection', u.clip(entry.collection || '', 60));
  rec.set('record', u.clip(entry.record || '', 30));
  rec.set('summary', u.clip(entry.summary || '', 600));
  if (entry.before !== undefined) rec.set('before', cap(clean(entry.before), 49000));
  if (entry.after !== undefined) rec.set('after', cap(clean(entry.after), 49000));
  if (entry.data !== undefined) rec.set('data', cap(clean(entry.data), 19000));
  app.save(rec);
  ctx.audited = true;
  return rec;
}

/** Leave details for the dispatcher's row (no row written yet). */
function note(ctx, info) {
  ctx.auditInfo = Object.assign({}, ctx.auditInfo || {}, info);
}

function view(app, r, names) {
  const u = require(`${__hooks}/lib_util.js`);
  const mid = r.getString('member');
  if (mid !== '' && names[mid] === undefined) {
    const m = u.byId(app, 'members', mid);
    names[mid] = m === null ? 'Former member' : m.getString('name');
  }
  return {
    id: r.id,
    at: r.getString('created'),
    actor: r.getString('actor'),
    member: mid,
    who: r.getString('actor') === 'agent' ? 'Your AI agent' : r.getString('actor') === 'system' ? 'HR OS' : names[mid] || '',
    op: r.getString('op'),
    collection: r.getString('collection'),
    record: r.getString('record'),
    summary: r.getString('summary'),
    before: u.jsonOf(r, 'before'),
    after: u.jsonOf(r, 'after'),
    data: u.jsonOf(r, 'data'),
  };
}

/** audit.list: the trail, newest first, filtered. */
function list(ctx, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const app = ctx.app;
  const pg = u.page(p, 50, 500);
  const where = ['1 = 1'];
  const bind = {};
  const add = (sql, k, v) => {
    where.push(sql);
    bind[k] = v;
  };
  const collection = u.str(p, 'collection', '');
  if (collection !== '') add('collection = {:c}', 'c', collection);
  const record = u.str(p, 'record', '');
  if (record !== '') add('record = {:r}', 'r', record);
  const member = u.str(p, 'member', '');
  if (member !== '') add('member = {:m}', 'm', require(`${__hooks}/lib_auth.js`).memberRef(app, member).id);
  const actor = u.str(p, 'actor', '');
  if (actor !== '') add('actor = {:a}', 'a', actor);
  const op = u.str(p, 'op', '');
  if (op !== '') add('op = {:o}', 'o', op);
  const q = u.str(p, 'q', '');
  if (q !== '') add("summary LIKE {:q} ESCAPE '\\'", 'q', u.like(q));
  const from = u.day(p, 'from', '');
  if (from !== '') add('created >= {:f}', 'f', from + ' 00:00:00.000Z');
  const to = u.day(p, 'to', '');
  if (to !== '') add('created <= {:t}', 't', to + ' 23:59:59.999Z');
  const w = where.join(' AND ');
  const total = u.count(app, 'SELECT COUNT(*) AS n FROM audit WHERE ' + w, bind);
  const ids = u.rows(app, 'SELECT id FROM audit WHERE ' + w + ' ORDER BY created DESC, id DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const names = {};
  return { entries: ids.map((r) => view(app, app.findRecordById('audit', r.id), names)), total: total, limit: pg.limit, offset: pg.offset };
}

/** The trail of one record (profile timelines), newest first. */
function forRecord(app, collection, id, limit) {
  const u = require(`${__hooks}/lib_util.js`);
  const names = {};
  return u.findMany(app, 'audit', 'collection = {:c} && record = {:r}', '-created', limit || 50, { c: collection, r: id }).map((r) => view(app, r, names));
}

module.exports = { write: write, note: note, list: list, forRecord: forRecord, view: view, clean: clean };
