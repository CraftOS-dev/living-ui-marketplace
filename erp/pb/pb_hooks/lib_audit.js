/// <reference path="../pb_data/types.d.ts" />
/**
 * The audit trail, notes and attachments on any record.
 *
 * write() is called with the same handle that makes the change (the
 * transaction handle inside a transaction), so a change and its audit row
 * commit together. Audit rows are never edited or deleted.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/** Who did it, from a context ({actor, memberId}) or a plain {actor, member}. */
function who(ctx) {
  const actor = ctx && ctx.actor ? ctx.actor : 'system';
  const member = ctx ? ctx.memberId || ctx.member || '' : '';
  return { actor: actor === 'person' || actor === 'agent' ? actor : 'system', member: typeof member === 'string' ? member : member && member.id ? member.id : '' };
}

function write(app, ctx, entry) {
  const util = u();
  const w = who(ctx);
  const rec = util.newRecord(app, 'audit');
  rec.set('actor', w.actor);
  rec.set('member', w.member);
  rec.set('kind', String(entry.kind || 'update').slice(0, 40));
  rec.set('entity', String(entry.entity || '').slice(0, 40));
  rec.set('ref', String(entry.ref || '').slice(0, 30));
  rec.set('label', String(entry.label || '').slice(0, 80));
  rec.set('summary', String(entry.summary || '').slice(0, 600));
  if (entry.data !== undefined) {
    let data = entry.data;
    if (JSON.stringify(data).length > 49000) data = { truncated: true };
    rec.set('data', data);
  }
  app.save(rec);
  return rec;
}

function memberName(app, id, cache) {
  if (id === '') return '';
  if (cache[id] !== undefined) return cache[id];
  const m = u().byId(app, 'members', id);
  cache[id] = m === null ? 'Former member' : m.getString('name');
  return cache[id];
}

function auditOut(app, r, cache) {
  return {
    id: r.id,
    at: r.getString('created'),
    actor: r.getString('actor'),
    member: r.getString('member'),
    who: r.getString('actor') === 'agent' ? 'Your AI agent' : r.getString('actor') === 'system' ? 'The app' : memberName(app, r.getString('member'), cache),
    kind: r.getString('kind'),
    entity: r.getString('entity'),
    ref: r.getString('ref'),
    label: r.getString('label'),
    summary: r.getString('summary'),
    data: u().jsonOf(r, 'data'),
  };
}

/** audit.list: the whole trail, filtered (administrators and accountants). */
function list(ctx, p) {
  const util = u();
  const auth = require(`${__hooks}/lib_auth.js`);
  if (!ctx.isAgent && !ctx.admin && !auth.can(ctx, 'accounting', 'view')) throw util.fail(403, 'The audit trail is for administrators and accountants.', 'not_permitted');
  const app = ctx.app;
  const pg = util.page(p, 50, 500);
  const where = ['1 = 1'];
  const bind = {};
  const add = (sql, k, v) => {
    where.push(sql);
    bind[k] = v;
  };
  const entity = util.str(p, 'entity', '');
  if (entity !== '') add('entity = {:en}', 'en', entity);
  const ref = util.str(p, 'ref', '');
  if (ref !== '') add('ref = {:rf}', 'rf', ref);
  const actor = util.str(p, 'actor', '');
  if (actor !== '') add('actor = {:ac}', 'ac', actor);
  const kind = util.str(p, 'kind', '');
  if (kind !== '') add('kind = {:k}', 'k', kind);
  const member = util.str(p, 'member', '');
  if (member !== '') add('member = {:m}', 'm', require(`${__hooks}/lib_core.js`).resolve(app, 'members', member).id);
  const from = util.day(p, 'from', '');
  if (from !== '') add('created >= {:f}', 'f', util.dayStartTs(from));
  const to = util.day(p, 'to', '');
  if (to !== '') add('created < {:t}', 't', util.dayStartTs(util.addDays(to, 1)));
  const q = util.str(p, 'q', '');
  if (q !== '') add("(summary LIKE {:q} ESCAPE '\\' OR label LIKE {:q} ESCAPE '\\')", 'q', util.like(q));
  const total = util.one(app, 'SELECT COUNT(id) AS n FROM audit WHERE ' + where.join(' AND '), { n: 0 }, bind).n;
  const ids = util.rows(app, 'SELECT id FROM audit WHERE ' + where.join(' AND ') + ' ORDER BY created DESC LIMIT ' + pg.limit + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const cache = {};
  return { entries: ids.map((x) => auditOut(app, app.findRecordById('audit', x.id), cache)), total: total };
}

/** What may be read about a record (entity, ref): its module's view right, or self. */
function canSee(ctx, entity, ref) {
  const auth = require(`${__hooks}/lib_auth.js`);
  const util = u();
  if (ctx.isAgent || ctx.admin) return true;
  const app = ctx.app;
  switch (entity) {
    case 'documents': {
      const d = util.byId(app, 'documents', ref);
      if (d === null) return false;
      try {
        auth.needDoc(ctx, d.getString('type'), 'view');
        return true;
      } catch {
        return false;
      }
    }
    case 'payments': {
      const pay = util.byId(app, 'payments', ref);
      if (pay === null) return false;
      try {
        auth.needPay(ctx, pay.getString('direction'), 'view');
        return true;
      } catch {
        return false;
      }
    }
    case 'parties':
      return auth.can(ctx, 'sales', 'view') || auth.can(ctx, 'purchasing', 'view');
    case 'items':
    case 'stock_changes':
    case 'warehouses':
      return auth.can(ctx, 'inventory', 'view') || auth.can(ctx, 'sales', 'view') || auth.can(ctx, 'purchasing', 'view');
    case 'journals':
    case 'accounts':
    case 'assets':
      return auth.can(ctx, 'accounting', 'view');
    case 'banks':
    case 'bank_lines':
      return auth.can(ctx, 'banking', 'view');
    case 'employees': {
      if (auth.can(ctx, 'people', 'view')) return true;
      return ref === ctx.employeeId;
    }
    case 'expense_claims': {
      if (auth.can(ctx, 'people', 'view')) return true;
      const c = util.byId(app, 'expense_claims', ref);
      return c !== null && (c.getString('employee') === ctx.employeeId || require(`${__hooks}/lib_people.js`).manages(app, ctx.employeeId, c.getString('employee')));
    }
    case 'leave_requests': {
      if (auth.can(ctx, 'people', 'view')) return true;
      const r = util.byId(app, 'leave_requests', ref);
      return r !== null && (r.getString('employee') === ctx.employeeId || require(`${__hooks}/lib_people.js`).manages(app, ctx.employeeId, r.getString('employee')));
    }
    case 'payroll_runs':
      return auth.can(ctx, 'payroll', 'view');
    case 'projects':
    case 'project_tasks':
      return auth.can(ctx, 'projects', 'view') || require(`${__hooks}/lib_projects.js`).isMember(app, ctx, ref);
    case 'builds':
    case 'boms':
      return auth.can(ctx, 'manufacturing', 'view');
    default:
      return false;
  }
}

/** Entities that take notes and attachments. */
const ENTITIES = [
  'documents', 'payments', 'parties', 'items', 'stock_changes', 'journals', 'accounts', 'banks', 'employees', 'expense_claims',
  'leave_requests', 'payroll_runs', 'projects', 'project_tasks', 'builds', 'boms', 'assets', 'warehouses',
];

function target(ctx, p, needEdit) {
  const util = u();
  const entity = util.oneOf(p, 'entity', ENTITIES, '');
  if (entity === '') throw util.fail(400, 'entity is required: one of ' + ENTITIES.join(', '), 'missing_param');
  let ref = util.req(p, 'ref');
  if (entity === 'documents') ref = require(`${__hooks}/lib_core.js`).resolveDoc(ctx.app, ref).id;
  else if (entity === 'payments') ref = require(`${__hooks}/lib_core.js`).resolvePayment(ctx.app, ref).id;
  else ref = require(`${__hooks}/lib_core.js`).resolve(ctx.app, entity, ref).id;
  if (!canSee(ctx, entity, ref)) throw util.fail(403, 'You cannot see that record.', 'not_permitted');
  void needEdit;
  return { entity: entity, ref: ref };
}

function noteOut(app, n, cache) {
  return {
    id: n.id,
    kind: 'note',
    at: n.getString('created'),
    actor: n.getString('actor'),
    member: n.getString('member'),
    who: n.getString('actor') === 'agent' ? 'Your AI agent' : memberName(app, n.getString('member'), cache),
    body: n.getString('body'),
  };
}

/** activity.list: one record's notes and audit entries, newest first. */
function activity(ctx, p) {
  const util = u();
  const t = target(ctx, p, false);
  const app = ctx.app;
  const cache = {};
  const limit = util.int(p, 'limit', 100, 1, 500);
  const notes = app.findRecordsByFilter('notes', 'entity = {:e} && ref = {:r}', '-created', limit, 0, { e: t.entity, r: t.ref }).map((n) => noteOut(app, n, cache));
  const audit = app.findRecordsByFilter('audit', 'entity = {:e} && ref = {:r}', '-created', limit, 0, { e: t.entity, r: t.ref }).map((r) => {
    const a = auditOut(app, r, cache);
    return { id: a.id, kind: 'event', event: a.kind, at: a.at, actor: a.actor, member: a.member, who: a.who, body: a.summary };
  });
  const all = notes.concat(audit).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const marks = app.findRecordsByFilter('field_marks', 'entity = {:e} && ref = {:r}', '-created', 200, 0, { e: t.entity, r: t.ref }).map((m) => ({
    field: m.getString('field'),
    confidence: m.getString('confidence'),
    reason: m.getString('reason'),
    at: m.getString('created'),
  }));
  const files = listFiles(app, t.entity, t.ref);
  return { entity: t.entity, ref: t.ref, items: all.slice(0, limit), marks: marks, attachments: files };
}

function addNote(ctx, p) {
  const util = u();
  const t = target(ctx, p, false);
  const body = util.text(p, 'body', 4000, '');
  if (body.trim() === '') throw util.fail(400, 'body is required', 'missing_param');
  const n = util.newRecord(ctx.app, 'notes');
  n.set('entity', t.entity);
  n.set('ref', t.ref);
  n.set('member', ctx.memberId);
  n.set('actor', ctx.isAgent ? 'agent' : 'person');
  n.set('body', body.trim());
  ctx.app.save(n);
  return noteOut(ctx.app, n, {});
}

function deleteNote(ctx, p) {
  const util = u();
  const n = require(`${__hooks}/lib_core.js`).resolve(ctx.app, 'notes', util.req(p, 'note'));
  const own = ctx.isAgent ? n.getString('actor') === 'agent' : n.getString('member') === ctx.memberId;
  if (!own && !ctx.admin) throw util.fail(403, 'You can delete only your own notes.', 'not_permitted');
  if (util.bool(p, 'preview', false)) return { preview: true };
  ctx.app.delete(n);
  return { deleted: true };
}

/* -------------------------------------------------------- attachments */

function fileOut(app, a) {
  return {
    id: a.id,
    name: a.getString('name'),
    size: a.getInt('size'),
    mime: a.getString('mime'),
    at: a.getString('created'),
    actor: a.getString('actor'),
    who: a.getString('actor') === 'agent' ? 'Your AI agent' : memberName(app, a.getString('member'), {}),
    file_path: u().filePath(app, a, 'file'),
    image: /^image\//.test(a.getString('mime')),
  };
}

function listFiles(app, entity, ref) {
  return app.findRecordsByFilter('attachments', 'entity = {:e} && ref = {:r}', '-created', 200, 0, { e: entity, r: ref }).map((a) => fileOut(app, a));
}

function listAttachments(ctx, p) {
  const t = target(ctx, p, false);
  return { attachments: listFiles(ctx.app, t.entity, t.ref) };
}

function mimeOf(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  const map = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    csv: 'text/csv',
    txt: 'text/plain',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

/** Store one file on a record (in the caller's handle). */
function attach(app, ctx, entity, ref, file, name) {
  const util = u();
  const a = util.newRecord(app, 'attachments');
  a.set('entity', entity);
  a.set('ref', ref);
  a.set('file', file);
  const nm = String(name || file.originalName || file.name || 'file').slice(0, 200);
  a.set('name', nm);
  a.set('size', Number(file.size || 0));
  a.set('mime', mimeOf(nm));
  a.set('member', ctx.memberId || '');
  a.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  app.save(a);
  return a;
}

function addAttachment(ctx, p) {
  const util = u();
  const t = target(ctx, p, true);
  const files = ctx.e ? util.uploadedAll(ctx.e, 'file') : [];
  const path = util.str(p, 'path', '');
  if (files.length === 0 && path === '') throw util.fail(400, 'Upload a file, or give --path "<absolute path>".', 'missing_param');
  const out = [];
  ctx.app.runInTransaction((tx) => {
    for (const f of files) out.push(attach(tx, ctx, t.entity, t.ref, f, f.originalName));
    if (path !== '') out.push(attach(tx, ctx, t.entity, t.ref, util.localFile(ctx, path, 'path'), $filepath.base(path)));
    write(tx, ctx, { kind: 'attach', entity: t.entity, ref: t.ref, label: out.map((a) => a.getString('name')).join(', '), summary: 'Attached ' + out.map((a) => a.getString('name')).join(', ') });
  });
  return { attachments: out.map((a) => fileOut(ctx.app, ctx.app.findRecordById('attachments', a.id))) };
}

function deleteAttachment(ctx, p) {
  const util = u();
  const a = require(`${__hooks}/lib_core.js`).resolve(ctx.app, 'attachments', util.req(p, 'attachment'));
  if (!canSee(ctx, a.getString('entity'), a.getString('ref'))) throw util.fail(403, 'You cannot see that record.', 'not_permitted');
  if (util.bool(p, 'preview', false)) return { preview: true, name: a.getString('name') };
  ctx.app.runInTransaction((tx) => {
    tx.delete(tx.findRecordById('attachments', a.id));
    write(tx, ctx, { kind: 'detach', entity: a.getString('entity'), ref: a.getString('ref'), label: a.getString('name'), summary: 'Removed the attachment ' + a.getString('name') });
  });
  return { deleted: true };
}

/** Stream a protected file to the browser (the caller's rights are checked). */
function streamFile(ctx, rec, field, name, mime, download) {
  const key = rec.baseFilesPath() + '/' + rec.getString(field);
  const fsys = ctx.app.newFilesystem();
  try {
    const reader = fsys.getReader(key);
    try {
      const safe = String(name || rec.getString(field)).replace(/["\\\r\n]/g, '_');
      ctx.e.response.header().set('Content-Disposition', (download ? 'attachment' : 'inline') + '; filename="' + safe + '"');
      ctx.e.response.header().set('Cache-Control', 'private, max-age=300');
      ctx.e.stream(200, mime || mimeOf(name || ''), reader);
    } finally {
      reader.close();
    }
  } finally {
    fsys.close();
  }
  return { __streamed: true };
}

/** attachments.get: download one file (screens use it as an image or link source). */
function getAttachment(ctx, p) {
  const util = u();
  const a = require(`${__hooks}/lib_core.js`).resolve(ctx.app, 'attachments', util.req(p, 'attachment'));
  if (!canSee(ctx, a.getString('entity'), a.getString('ref'))) throw util.fail(403, 'You cannot see that record.', 'not_permitted');
  if (ctx.isAgent) return fileOut(ctx.app, a);
  return streamFile(ctx, a, 'file', a.getString('name'), a.getString('mime'), util.bool(p, 'download', false));
}

module.exports = {
  write: write,
  who: who,
  auditOut: auditOut,
  memberName: memberName,
  list: list,
  canSee: canSee,
  ENTITIES: ENTITIES,
  activity: activity,
  addNote: addNote,
  deleteNote: deleteNote,
  listAttachments: listAttachments,
  addAttachment: addAttachment,
  deleteAttachment: deleteAttachment,
  getAttachment: getAttachment,
  attach: attach,
  fileOut: fileOut,
  streamFile: streamFile,
  mimeOf: mimeOf,
};
