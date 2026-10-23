/// <reference path="../pb_data/types.d.ts" />
/**
 * The activity trail: one row per write, in the same transaction, saying
 * who (you, your AI agent, the system), what and on which record. Rows that
 * can be undone carry `data.undo = { fn: 'lib_x.fn', args }`; activity.undo
 * runs that function once and marks the row undone.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

/**
 * Write one activity row with `app` (pass the transaction inside one).
 * entry: { op, label, target, record, data, undo, project, batch }
 */
function write(app, ctx, entry) {
  const r = u().newRecord(app, 'activity');
  r.set('actor', ctx.actor);
  r.set('op', entry.op || ctx.op || '');
  r.set('label', String(entry.label || '').slice(0, 600));
  r.set('target', entry.target || '');
  r.set('record', entry.record || '');
  r.set('batch', entry.batch || ctx.batch || '');
  const data = Object.assign({}, entry.data || {});
  if (entry.undo) data.undo = entry.undo;
  r.set('data', data);
  r.set('undoable', entry.undo !== undefined);
  r.set('undone', false);
  r.set('project', entry.project || '');
  app.save(r);
  return r;
}

function out(r) {
  const data = u().jsonOf(r, 'data') || {};
  return {
    id: r.id,
    actor: r.getString('actor'),
    op: r.getString('op'),
    label: r.getString('label'),
    target: r.getString('target'),
    record: r.getString('record'),
    batch: r.getString('batch'),
    project: r.getString('project'),
    undoable: r.getBool('undoable') && !r.getBool('undone'),
    undone: r.getBool('undone'),
    detail: data.detail || null,
    created: r.getString('created'),
  };
}

/** activity.list: newest first, filtered by who, kind of record, project or record. */
function list(ctx, p) {
  const util = u();
  const pg = util.page(p, 50, 1000);
  const where = ['1=1'];
  const bind = {};
  const actor = util.oneOf(p, 'actor', ['person', 'agent', 'system'], '');
  if (actor !== '') {
    where.push('actor = {:a}');
    bind.a = actor;
  }
  const target = util.str(p, 'target', '');
  if (target !== '') {
    where.push('target = {:t}');
    bind.t = target;
  }
  const record = util.str(p, 'record', '');
  if (record !== '') {
    where.push('record = {:r}');
    bind.r = record;
  }
  const proj = util.str(p, 'project', '');
  if (proj !== '') {
    require(`${__hooks}/lib_core.js`).guardProjectId(ctx, proj);
    where.push('project = {:p}');
    bind.p = proj;
  } else if (ctx.isAgent) {
    // Nothing from confidential projects reaches your AI agent.
    ctx.app.findRecordsByFilter('projects', "confidentiality = 'confidential'", '', 0, 0).forEach((pr, i) => {
      where.push('project != {:c' + i + '}');
      bind['c' + i] = pr.id;
    });
  }
  const since = util.str(p, 'since', '');
  if (since !== '') {
    where.push('created >= {:s}');
    bind.s = since;
  }
  const recs = ctx.app.findRecordsByFilter('activity', where.join(' && '), '-created', pg.limit + 1, pg.offset, bind);
  const more = recs.length > pg.limit;
  return { entries: recs.slice(0, pg.limit).map(out), more: more };
}

/** activity.undo: reverse one undoable write (or a whole batch). */
function undo(ctx, p) {
  const util = u();
  const id = util.str(p, 'entry', '');
  const batch = util.str(p, 'batch', '');
  let targets = [];
  if (id !== '') targets = [require(`${__hooks}/lib_core.js`).need(ctx.app, 'activity', id, 'activity entry')];
  else if (batch !== '') targets = ctx.app.findRecordsByFilter('activity', 'batch = {:b} && undoable = true && undone = false', '-created', 0, 0, { b: batch });
  else throw util.fail(400, 'Give --entry <activity id> or --batch <batch>.', 'missing_param');
  if (targets.length === 0) throw util.fail(409, 'Nothing there can be undone.', 'nothing_to_undo');
  let done = 0;
  for (const t of targets) {
    if (!t.getBool('undoable') || t.getBool('undone')) continue;
    const data = util.jsonOf(t, 'data') || {};
    const spec = data.undo;
    if (!spec || typeof spec.fn !== 'string') continue;
    if (ctx.isAgent && t.getString('actor') !== 'agent') throw util.fail(403, 'Your AI agent can only undo what it did itself.', 'agent_not_permitted');
    const parts = spec.fn.split('.');
    const fn = require(`${__hooks}/${parts[0]}.js`)[parts[1]];
    if (typeof fn !== 'function') continue;
    fn(ctx, spec.args || {});
    t.set('undone', true);
    ctx.app.save(t);
    done++;
  }
  return { undone: done };
}

module.exports = { write: write, out: out, list: list, undo: undo };
