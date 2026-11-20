/// <reference path="../pb_data/types.d.ts" />
/**
 * Tasks: follow-ups with an owner and a due day, optionally on a record
 * (a deal, a company, a holding...). Your AI agent may open tasks (for
 * stated next steps in a note) and change the ones it opened; completing a
 * person's task is people only. Open tasks due today or earlier appear in
 * their owner's Next (kind task).
 *
 *   save(ctx, { task?, title, ref_collection, ref_id, deal, assignee, due_day, note }) -> view
 *   open(app, { ... }) for module code (no rights checks; source system)
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function view(app, r, names) {
  const util = u();
  const nm = (id) => {
    if (id === '') return '';
    if (names[id] === undefined) {
      const m = util.byId(app, 'members', id);
      names[id] = m === null ? 'Former member' : m.getString('name');
    }
    return names[id];
  };
  return {
    id: r.id,
    title: r.getString('title'),
    ref_collection: r.getString('ref_collection'),
    ref_id: r.getString('ref_id'),
    deal: r.getString('deal'),
    assignee: r.getString('assignee'),
    assignee_name: nm(r.getString('assignee')),
    due_day: r.getString('due_day'),
    status: r.getString('status'),
    done_at: r.getString('done_at'),
    done_by: r.getString('done_by'),
    note: r.getString('note'),
    source: r.getString('source'),
    actor: r.getString('actor'),
    member: r.getString('member'),
    created: r.getString('created'),
  };
}

function canSee(ctx, r) {
  if (ctx.ownOnly && r.getString('assignee') !== ctx.memberId && r.getString('member') !== ctx.memberId) return false;
  if (r.getString('deal') !== '' && !L('lib_auth').dealVisible(ctx, r.getString('deal'))) return false;
  if (r.getString('ref_collection') !== '' && r.getString('ref_collection') !== 'deals' && !L('lib_auth').recordVisible(ctx, r.getString('ref_collection'), r.getString('ref_id'))) return false;
  return true;
}

function ref(ctx, id) {
  const r = u().byId(ctx.app, 'tasks', String(id || ''));
  if (r === null || !canSee(ctx, r)) throw u().fail(404, 'No task ' + id + ' you can see. Run tasks.list.', 'not_found');
  return r;
}

function list(ctx, p) {
  const util = u();
  const where = [];
  const bind = {};
  const view0 = util.oneOf(p, 'view', ['mine', 'ref', 'all'], util.str(p, 'ref_id', '') !== '' ? 'ref' : ctx.isAgent ? 'all' : 'mine');
  if (view0 === 'mine') {
    where.push('assignee = {:me}');
    bind.me = ctx.memberId || '-';
  }
  const rc = util.str(p, 'ref_collection', '');
  if (rc !== '') {
    where.push('ref_collection = {:rc}');
    bind.rc = rc;
  }
  let ri = util.str(p, 'ref_id', '');
  if (rc === 'deals' && ri !== '') ri = L('lib_auth').dealId(ctx.app, ri) || ri;
  if (ri !== '') {
    where.push('ref_id = {:ri}');
    bind.ri = ri;
  }
  const deal = util.str(p, 'deal', '');
  if (deal !== '') {
    where.push('deal = {:d}');
    bind.d = L('lib_auth').dealId(ctx.app, deal) || deal;
  }
  const status = util.oneOf(p, 'status', ['open', 'done', 'cancelled', 'all'], 'open');
  if (status !== 'all') {
    where.push('status = {:s}');
    bind.s = status;
  }
  const pg = util.page(p, 100, 500);
  const all = util.findMany(ctx.app, 'tasks', where.length > 0 ? where.join(' && ') : '1=1', status === 'open' ? 'due_day,created' : '-created', pg.offset + pg.limit + 500, bind);
  const rows = all.filter((r) => canSee(ctx, r));
  const names = {};
  return { tasks: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => view(ctx.app, r, names)), total: rows.length, hidden: all.length - rows.length, today: util.today(ctx.app) };
}

function fill(ctx, r, p, isNew) {
  const util = u();
  const auth = L('lib_auth');
  if (isNew || util.has(p, 'title')) {
    const t = util.squash(util.text(p, 'title', 300, ''));
    if (t === '') throw util.fail(400, 'title is required', 'missing_param', { param: 'title' });
    r.set('title', t);
  }
  if (util.has(p, 'ref_collection') || util.has(p, 'ref_id')) {
    const rc = util.str(p, 'ref_collection', '');
    let ri = util.str(p, 'ref_id', '');
    if (rc === 'deals' && ri !== '') ri = auth.needDealId(ctx.app, ri, 'ref_id');
    if ((rc === '') !== (ri === '')) throw util.fail(400, 'Give both ref_collection and ref_id, or neither.', 'missing_param', { param: rc === '' ? 'ref_collection' : 'ref_id' });
    if (rc !== '' && !auth.recordVisible(ctx, rc, ri)) throw util.fail(404, 'No ' + rc + ' record ' + ri + ' you can see.', 'not_found');
    r.set('ref_collection', rc);
    r.set('ref_id', ri);
    if (rc === 'deals') r.set('deal', ri);
  }
  if (util.has(p, 'deal')) {
    const d0 = util.str(p, 'deal', '');
    const d = d0 !== '' ? auth.dealId(ctx.app, d0) : '';
    if ((d0 !== '' && d === '') || (d !== '' && !auth.dealVisible(ctx, d))) throw util.fail(404, 'No deal ' + d0 + ' you can see.', 'not_found', { param: 'deal' });
    r.set('deal', d);
  }
  if (util.has(p, 'assignee')) {
    const a = util.str(p, 'assignee', '');
    r.set('assignee', a === '' ? '' : auth.memberRef(ctx.app, a).id);
  } else if (isNew) r.set('assignee', ctx.memberId || '');
  if (util.has(p, 'due_day')) r.set('due_day', util.day(p, 'due_day', ''));
  if (util.has(p, 'note')) r.set('note', util.text(p, 'note', 4000, ''));
}

function save(ctx, p) {
  const util = u();
  const id = util.str(p, 'task', '');
  let r;
  let before = null;
  if (id !== '') {
    r = ref(ctx, id);
    if (ctx.isAgent && r.getString('actor') !== 'agent') throw util.fail(403, "Your AI agent changes only the tasks it opened; a person's task is theirs.", 'not_permitted');
    before = view(ctx.app, r, {});
    fill(ctx, r, p, false);
  } else {
    r = util.newRecord(ctx.app, 'tasks');
    r.set('status', 'open');
    r.set('source', ctx.isAgent ? 'agent' : 'person');
    r.set('actor', ctx.isAgent ? 'agent' : 'person');
    r.set('member', ctx.memberId || '');
    fill(ctx, r, p, true);
  }
  ctx.app.save(r);
  const after = view(ctx.app, r, {});
  if (id === '' && after.assignee !== '' && after.assignee !== ctx.memberId) L('lib_notify').notify(ctx.app, [after.assignee], { kind: 'task', title: (ctx.isAgent ? 'Your AI agent' : ctx.name) + ' gave you a task', body: after.title, link: '#/next', ref: 'tasks:' + r.id });
  L('lib_audit').note(ctx, { collection: 'tasks', record: r.id, summary: (id === '' ? 'Opened the task: ' : 'Changed the task: ') + util.clip(after.title, 120), before: before === null ? undefined : before, after: after });
  return { task: after };
}

/** Module code: open a task without rights checks (source system). */
function open(app, o) {
  const util = u();
  const r = util.newRecord(app, 'tasks');
  r.set('title', util.clip(util.squash(String(o.title || '')), 300) || 'Task');
  r.set('ref_collection', o.ref_collection || '');
  r.set('ref_id', o.ref_id || '');
  r.set('deal', o.deal || (o.ref_collection === 'deals' ? o.ref_id : ''));
  r.set('assignee', o.assignee || '');
  r.set('due_day', o.due_day || '');
  r.set('note', util.clip(o.note || '', 4000));
  r.set('status', 'open');
  r.set('source', 'system');
  r.set('actor', 'system');
  app.save(r);
  return view(app, r, {});
}

function complete(ctx, p) {
  const util = u();
  const r = ref(ctx, util.req(p, 'task'));
  const done = util.bool(p, 'done', true);
  r.set('status', done ? 'done' : 'open');
  r.set('done_at', done ? util.nowIso() : '');
  r.set('done_by', done ? ctx.memberId || '' : '');
  ctx.app.save(r);
  L('lib_audit').note(ctx, { collection: 'tasks', record: r.id, summary: (done ? 'Completed: ' : 'Reopened: ') + util.clip(r.getString('title'), 120) });
  return { task: view(ctx.app, r, {}) };
}

function remove(ctx, p) {
  const util = u();
  const r = ref(ctx, util.req(p, 'task'));
  if (r.getString('member') !== ctx.memberId && r.getString('assignee') !== ctx.memberId && !ctx.owner) throw util.fail(403, 'Only the person who opened the task, its owner or the firm owner can delete it.', 'not_permitted');
  const title = r.getString('title');
  ctx.app.delete(r);
  L('lib_audit').note(ctx, { collection: 'tasks', record: r.id, summary: 'Deleted the task: ' + util.clip(title, 120) });
  return { deleted: true };
}

/** Next items: my open tasks due today or earlier (kind task; overdue first). */
function nextItems(ctx) {
  const util = u();
  if (ctx.isAgent || !ctx.memberId) return [];
  const today = util.today(ctx.app);
  return util
    .findMany(ctx.app, 'tasks', "assignee = {:m} && status = 'open' && due_day != '' && due_day <= {:d}", 'due_day', 200, { m: ctx.memberId, d: today })
    .filter((r) => canSee(ctx, r))
    .map((r) => ({
      key: 'kernel:task:' + r.id,
      kind: 'task',
      title: r.getString('title'),
      figures: [{ label: 'Due', value: r.getString('due_day') }],
      chips: r.getString('due_day') < today ? [{ label: 'Overdue', tone: 'warn' }] : [],
      agent: r.getString('actor') === 'agent',
      rank: r.getString('due_day') < today ? 50 : 60,
      at: r.getString('due_day') + 'T00:00:00Z',
      href: r.getString('deal') !== '' ? '#/deals/' + r.getString('deal') : '#/next',
      data: { task: r.id, note: r.getString('note'), ref_collection: r.getString('ref_collection'), ref_id: r.getString('ref_id') },
      actions: [
        { label: 'Done', op: 'tasks.complete', params: { task: r.id }, primary: true, done: 'Done', undo: { op: 'tasks.complete', params: { task: r.id, done: false } } },
        { label: 'Snooze', op: 'next.snooze', params: { key: 'kernel:task:' + r.id }, done: 'Snoozed until tomorrow', undo: { op: 'next.snooze', params: { key: 'kernel:task:' + r.id, until: '' } } },
      ],
    }));
}

module.exports = { view: view, list: list, save: save, open: open, complete: complete, remove: remove, nextItems: nextItems };
