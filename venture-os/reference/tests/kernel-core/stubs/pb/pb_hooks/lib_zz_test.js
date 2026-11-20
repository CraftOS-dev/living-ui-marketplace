/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH ONLY: a fake module that exercises every kernel contract (ops,
 * proposals with diff and auto, Next items, a trigger, search, settings keys,
 * imports, today, events, cron). Never shipped.
 */
function U() {
  return require(`${__hooks}/lib_util.js`);
}

function view(r) {
  const A = require(`${__hooks}/lib_agent.js`);
  return { id: r.id, name: r.getString('name'), value: r.getFloat('value'), note: r.getString('note'), deal: r.getString('deal'), agent: A.view(r, ['zz_review']), pending: A.pending(r, 'zz_review') };
}

function dealOf(app, r) {
  return r.getString('deal');
}

function make(ctx, p) {
  const u = U();
  const r = u.newRecord(ctx.app, 'zz_things');
  r.set('name', u.req(p, 'name'));
  r.set('value', u.num(p, 'value', {}) || 0);
  r.set('deal', u.str(p, 'deal', ''));
  ctx.app.save(r);
  let request = '';
  if (u.bool(p, 'ask', false) && !ctx.isAgent) request = require(`${__hooks}/lib_agent.js`).ask(ctx.app, 'zz_review', ctx.app.findRecordById('zz_things', r.id), {}, { by: ctx.memberId || '' });
  require(`${__hooks}/lib_audit.js`).note(ctx, { collection: 'zz_things', record: r.id, summary: 'Made ' + r.getString('name') });
  return { thing: view(ctx.app.findRecordById('zz_things', r.id)), request: request };
}

function save(ctx, p) {
  const u = U();
  const r = u.byId(ctx.app, 'zz_things', u.req(p, 'thing'));
  if (r === null) throw u.fail(404, 'No thing ' + p.thing, 'not_found');
  if (u.has(p, 'name')) r.set('name', u.str(p, 'name', ''));
  if (u.has(p, 'value')) {
    const v = u.num(p, 'value', {});
    if (v < 0) throw u.fail(400, 'value cannot be negative', 'invalid_param', { param: 'value' });
    r.set('value', v);
  }
  ctx.app.save(r);
  require(`${__hooks}/lib_audit.js`).note(ctx, { collection: 'zz_things', record: r.id, summary: 'Saved ' + r.getString('name') });
  return { thing: view(r) };
}

/** A promoted kind applies only to small values (tests the op's auto hook). */
function autoOk(ctx, p) {
  return Number(p.value || 0) < 100;
}

function half(ctx, p) {
  const u = U();
  const r = u.newRecord(ctx.app, 'zz_things');
  r.set('name', 'half ' + u.str(p, 'name', 'x'));
  ctx.app.save(r);
  throw u.fail(409, 'Refused after a write (the write must not stay).', 'conflict');
}

function get(ctx, p) {
  const u = U();
  const r = u.byId(ctx.app, 'zz_things', u.req(p, 'thing'));
  if (r === null) throw u.fail(404, 'No thing', 'not_found');
  if (r.getString('deal') !== '' && !require(`${__hooks}/lib_auth.js`).dealVisible(ctx, r.getString('deal'))) throw u.fail(404, 'No thing you can see', 'not_found');
  return { thing: view(r) };
}

function stats(ctx) {
  const s = ctx.app.store();
  return { entity_events: Number(s.get('zz_entity_events') || 0), cron_ran: String(s.get('zz_cron_ran') || ''), things: U().count(ctx.app, 'SELECT COUNT(*) AS n FROM zz_things') };
}

/** Scratch helper: a deal (stand-in for kernel-records) with a team. */
function deal(ctx, p) {
  const u = U();
  const r = u.newRecord(ctx.app, 'deals');
  r.set('number', u.nextId(ctx.app, 'D', 4));
  r.set('company_name', u.req(p, 'company'));
  r.set('fund', u.str(p, 'fund', ''));
  r.set('restricted', u.bool(p, 'restricted', false));
  r.set('agent_allowed', u.bool(p, 'agent_allowed', false));
  ctx.app.save(r);
  for (const m of u.list(p, 'team') || []) {
    const dp = u.newRecord(ctx.app, 'deal_people');
    dp.set('deal', r.id);
    dp.set('member', require(`${__hooks}/lib_auth.js`).memberRef(ctx.app, m).id);
    dp.set('team', true);
    ctx.app.save(dp);
  }
  return { deal: { id: r.id, display_id: r.getString('number') } };
}

/** Scratch helper: a files record from text (stand-in for kernel-records). */
function file(ctx, p) {
  const u = U();
  const r = u.newRecord(ctx.app, 'files');
  const name = u.req(p, 'name');
  r.set('name', name);
  r.set('deal', u.str(p, 'deal', ''));
  r.set('file', $filesystem.fileFromBytes(u.str(p, 'text', 'sample'), name));
  ctx.app.save(r);
  return { file: { id: r.id, name: name } };
}

/** Scratch helper: remove a file's bytes from disk (an attachment gone missing). */
function rmfile(ctx, p) {
  const u = U();
  const path = require(`${__hooks}/lib_files.js`).pathOf(ctx.app, u.req(p, 'file'));
  $os.remove(path);
  ctx.audited = true;
  return { removed: path };
}

function needsYou(ctx) {
  const u = U();
  if (ctx.isAgent) return [];
  const out = [];
  for (const r of u.findMany(ctx.app, 'zz_things', "name != ''", 'created', 50)) {
    if (r.getString('deal') !== '' && !require(`${__hooks}/lib_auth.js`).dealVisible(ctx, r.getString('deal'))) continue;
    out.push({ key: 'zz:' + r.id, kind: 'verdict', card: 'zz', title: r.getString('name'), figures: [{ label: 'Value', value: String(r.getFloat('value')) }], chips: [{ label: 'Test', tone: 'good' }, { label: 'Bad tone', tone: 'purple' }], steps: { labels: ['Received', 'Reading', 'Facts', 'Ready'], at: 2 }, rank: 20, at: r.getString('created'), href: '#/zz/' + r.id, actions: [{ label: 'Bump', op: 'zz.make', params: { name: r.getString('name') + '+' }, primary: true, done: 'Bumped', undo: { op: 'zz.save', params: { thing: r.id, value: r.getFloat('value') } }, tone: 'good' }, { label: 'Invite', op: 'members.invite', params: {}, pin: true, tone: 'purple' }] });
  }
  out.push({ key: 'zz:bad', kind: 'bogus', title: 'Bad kind', actions: [] });
  if (out.length > 1) out.push({ key: out[0].key, kind: 'alert', title: 'Duplicate key', actions: [] });
  return out;
}

function search(ctx, q, limit) {
  const u = U();
  return u.rows(ctx.app, "SELECT id, name FROM zz_things WHERE name LIKE {:q} ESCAPE '\\' LIMIT " + limit, { id: '', name: '' }, { q: u.like(q) }).map((r) => ({ kind: 'thing', id: r.id, title: r.name, href: '#/zz/' + r.id, icon: 'Box' }));
}

function importRow(ctx, row, info) {
  const u = U();
  if (row.value !== undefined && row.value < 0) throw u.fail(400, 'value cannot be negative', 'invalid_param');
  const cur = u.findOne(ctx.app, 'zz_things', 'name = {:n}', { n: row.name });
  if (cur !== null) {
    if (row.value === undefined || cur.getFloat('value') === row.value) return { action: 'skipped', id: cur.id, message: 'unchanged' };
    cur.set('value', row.value);
    ctx.app.save(cur);
    return { action: 'updated', id: cur.id };
  }
  const r = u.newRecord(ctx.app, 'zz_things');
  r.set('name', row.name);
  r.set('value', row.value || 0);
  r.set('note', [row.day || '', row.email || '', (row.tags || []).join('|')].join(' ').trim());
  ctx.app.save(r);
  return { action: 'created', id: r.id };
}

function today(ctx) {
  return { key: 'zz', things: U().count(ctx.app, 'SELECT COUNT(*) AS n FROM zz_things') };
}

function onEntity(ctx, payload) {
  const s = $app.store();
  s.set('zz_entity_events', Number(s.get('zz_entity_events') || 0) + 1);
  return { seen: payload.entity };
}

function tick(app) {
  app.store().set('zz_cron_ran', new Date().toISOString());
}

/** Test clock: move a proposal's creation back (then run the kernel's sweep), or a thing's ask of zz_review. */
function age(ctx, p) {
  const u = U();
  const minutes = u.num(p, 'minutes', {}) || 0;
  const t = new Date(Date.now() - minutes * 60000).toISOString();
  const what = u.req(p, 'what');
  const id = u.req(p, 'id');
  if (what === 'proposal') {
    u.exec(ctx.app, 'UPDATE proposals SET created = {:t} WHERE id = {:id}', { t: t.replace('T', ' '), id: id });
    return { expired: require(`${__hooks}/lib_proposals.js`).expire(ctx.app) };
  }
  if (what !== 'asked') throw u.fail(400, 'what is proposal or asked', 'invalid_param', { param: 'what' });
  const r = ctx.app.findRecordById('zz_things', id);
  const m = u.jsonOf(r, 'agent', {}) || {};
  if (!m.zz_review) throw u.fail(409, 'This thing was never asked about.', 'not_asked');
  m.zz_review.at = t;
  u.exec(ctx.app, 'UPDATE zz_things SET agent = {:a} WHERE id = {:id}', { a: JSON.stringify(m), id: id });
  ctx.audited = true;
  return { thing: view(ctx.app.findRecordById('zz_things', id)) };
}

function nda(ctx, p) {
  const u = U();
  return { allowed: require(`${__hooks}/lib_agent.js`).ndaAllowed(ctx.app, u.req(p, 'deal')) };
}

/** The mail helpers through the bridge: search a label, read the first message, save its first attachment. */
function mail(ctx, p) {
  const u = U();
  const m = require(`${__hooks}/lib_mail.js`);
  const s = m.search(ctx.app, u.str(p, 'query', 'label:"Venture OS/Deals" has:attachment'), 10);
  if (!s.ok) return { search: s };
  const id = u.str(p, 'id', '') || (s.messages[0] ? s.messages[0].id : '');
  const g = m.get(ctx.app, id);
  let a = null;
  if (g.ok && g.message.attachments.length > 0) a = m.attachment(ctx.app, id, g.message.attachments[0].attachment_id, g.message.attachments[0].filename);
  ctx.audited = true;
  return { search: s, get: g, attachment: a, labels: m.labels(ctx.app) };
}

/** Test clock: the platform's per-trigger cooldowns pass. */
function cool(ctx) {
  for (const t of Object.keys(require(`${__hooks}/lib_events.js`).triggers())) ctx.app.store().remove('trig_rate:' + t);
  ctx.audited = true;
  return { ok: true };
}

module.exports = { cool: cool, dealOf: dealOf, age: age, nda: nda, mail: mail, make: make, save: save, autoOk: autoOk, half: half, get: get, stats: stats, deal: deal, file: file, rmfile: rmfile, needsYou: needsYou, search: search, importRow: importRow, today: today, onEntity: onEntity, tick: tick };
