/// <reference path="../pb_data/types.d.ts" />
/**
 * Activity: every write op as one undoable unit (CRM lib_activity.js,
 * adapted). The dispatcher runs each write op inside one transaction
 * through a tracker that notes every record it creates, changes or
 * deletes; when the op ends, one `activity` row keeps the steps that undo
 * it. Your AI agent's writes carry a run id (one run per burst of calls
 * without a 30 minute gap), so a person can undo a whole run as one unit.
 *
 * Undo steps (newest change first):
 *   { do: 'delete',   c, id, after }          undo a creation
 *   { do: 'restore',  c, id, fields, after }  undo an edit (only the fields that changed)
 *   { do: 'recreate', c, data }               undo a deletion (same id)
 * `after` is the record's state when the unit ended: an undo is refused
 * when something it would touch changed again later (undo the later change
 * first). Machinery (audit, activity, notifications, proposals, members,
 * roles, the PIN vault, snoozes, the platform's trigger queue) is never
 * undone. Raw SQL writes are not tracked.
 */

const SKIP = { audit: 1, activity: 1, notifications: 1, members: 1, roles: 1, pin_vault: 1, proposals: 1, snoozes: 1 };

let _queue = null;
/** Machinery never undone: SKIP and the platform's trigger queue (named by _triggers_lib, never here). */
function skipped(c) {
  if (_queue === null) _queue = require(`${__hooks}/_triggers_lib.js`).TRIGGER_COLLECTION;
  return SKIP[c] === 1 || c === _queue;
}
const META = { id: 1, created: 1, updated: 1, password: 1, tokenKey: 1 };
const RUN_GAP_MS = 30 * 60 * 1000;
const RUN_KEY = 'vo_agent_run';

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

/* --------------------------------------------------------------- values */

function toArray(v) {
  const out = [];
  if (v === null || v === undefined) return out;
  for (let i = 0; i < v.length; i++) out.push(v[i]);
  return out;
}

function value(rec, f) {
  const name = f.getName();
  const type = f.type();
  if (type === 'json') {
    const raw = rec.getString(name);
    if (raw === '' || raw === 'null') return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (type === 'number') return rec.getFloat(name);
  if (type === 'bool') return rec.getBool(name);
  if ((type === 'select' || type === 'relation' || type === 'file') && Number(f.maxSelect || 0) > 1) return toArray(rec.getStringSlice(name));
  return rec.getString(name);
}

/** Plain values of every field of a record (json parsed; id and stamps left out). */
function snapshot(rec) {
  const out = {};
  const fields = rec.collection().fields;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const name = f.getName();
    if (META[name] || f.type() === 'autodate' || f.type() === 'password') continue;
    out[name] = value(rec, f);
  }
  return out;
}

/** JSON with object keys sorted (comparisons that ignore key order). */
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

function find(app, c, id) {
  try {
    return app.findRecordById(c, id);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- tracker */

/**
 * A recording wrapper around a transaction handle: saves and deletes made
 * through it are noted; everything else passes through. Handlers receive
 * it as ctx.app, so they write as usual.
 */
function tracker(app) {
  const steps = [];
  const index = {};
  const keyOf = (rec) => rec.collection().name + ':' + rec.id;
  const note = (rec) => {
    const c = rec.collection().name;
    if (skipped(c)) return false;
    const k = keyOf(rec);
    if (rec.isNew()) return { c: c, k: k, isNew: true };
    if (!index[k]) {
      const step = { do: 'restore', c: c, id: rec.id, before: snapshot(rec.original()) };
      index[k] = { step: step };
      steps.push(step);
    }
    return { c: c, k: k, isNew: false };
  };
  const created = (n, rec) => {
    if (!n || !n.isNew) return;
    index[n.k] = { created: true };
    steps.push({ do: 'delete', c: n.c, id: rec.id });
  };
  const t = {
    save: (rec) => {
      const n = note(rec);
      app.save(rec);
      created(n, rec);
    },
    saveNoValidate: (rec) => {
      const n = note(rec);
      app.saveNoValidate(rec);
      created(n, rec);
    },
    delete: (rec) => {
      const c = rec.collection().name;
      if (skipped(c)) return app.delete(rec);
      const k = keyOf(rec);
      const known = index[k];
      if (known && known.created) {
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].c === c && steps[i].id === rec.id) {
            steps.splice(i, 1);
            break;
          }
        }
      } else if (known && known.step) {
        known.step.do = 'recreate';
        known.step.data = Object.assign({ id: rec.id }, known.step.before);
        delete known.step.before;
        delete known.step.id;
      } else steps.push({ do: 'recreate', c: c, data: Object.assign({ id: rec.id }, snapshot(rec.original())) });
      index[k] = { deleted: true };
      app.delete(rec);
    },
    findRecordById: (c, id) => app.findRecordById(c, id),
    findRecordsByIds: (c, ids) => app.findRecordsByIds(c, ids),
    findRecordsByFilter: (c, f, s, l, o, p) => (p === undefined ? app.findRecordsByFilter(c, f, s || '', l || 0, o || 0) : app.findRecordsByFilter(c, f, s || '', l || 0, o || 0, p)),
    findFirstRecordByFilter: (c, f, p) => (p === undefined ? app.findFirstRecordByFilter(c, f) : app.findFirstRecordByFilter(c, f, p)),
    findFirstRecordByData: (c, k, v) => app.findFirstRecordByData(c, k, v),
    findAllRecords: (c) => app.findAllRecords(c),
    findAuthRecordByEmail: (c, e) => app.findAuthRecordByEmail(c, e),
    findCollectionByNameOrId: (c) => app.findCollectionByNameOrId(c),
    countRecords: (c, ...exprs) => app.countRecords(c, ...exprs),
    expandRecord: (r, ex, f) => app.expandRecord(r, ex, f),
    recordQuery: (c) => app.recordQuery(c),
    hasTable: (n) => app.hasTable(n),
    db: () => app.db(),
    store: () => app.store(),
    settings: () => app.settings(),
    logger: () => app.logger(),
    dataDir: () => app.dataDir(),
    newFilesystem: () => app.newFilesystem(),
    subscriptionsBroker: () => app.subscriptionsBroker(),
    isTransactional: () => true,
    runInTransaction: (fn) => fn(t),
    /** The undo steps, newest change first, with each record's state at the end of the unit. */
    steps: () => {
      const out = [];
      for (const s of steps) {
        if (s.do === 'delete') {
          const rec = find(app, s.c, s.id);
          if (rec === null) continue;
          out.push({ do: 'delete', c: s.c, id: s.id, after: snapshot(rec) });
        } else if (s.do === 'restore') {
          const rec = find(app, s.c, s.id);
          if (rec === null) continue;
          const now = snapshot(rec);
          const fields = {};
          const after = {};
          for (const k of Object.keys(now)) {
            if (canon(now[k]) === canon(s.before[k])) continue;
            fields[k] = s.before[k] === undefined ? null : s.before[k];
            after[k] = now[k];
          }
          if (Object.keys(fields).length === 0) continue;
          out.push({ do: 'restore', c: s.c, id: s.id, fields: fields, after: after });
        } else if (s.do === 'recreate') out.push({ do: 'recreate', c: s.c, data: s.data });
      }
      return out.reverse();
    },
    raw: app,
  };
  return t;
}

/* ------------------------------------------------------------ guard, apply */

function conflict(c, id, why) {
  return L('lib_util').fail(409, 'Not undone: a ' + c + ' record this change touched ' + why + ' since. Undo the later change first.', 'changed_since', { collection: c, id: id });
}

/** Throw when something these steps touch changed again after the unit. */
function guard(app, steps) {
  for (const s of steps) {
    if (s.do === 'delete' || s.do === 'restore') {
      const rec = find(app, s.c, s.id);
      if (rec === null) {
        if (s.do === 'delete') continue;
        throw conflict(s.c, s.id, 'was deleted');
      }
      const now = snapshot(rec);
      for (const k of Object.keys(s.after || {})) if (canon(now[k]) !== canon(s.after[k])) throw conflict(s.c, s.id, 'was changed');
    } else if (s.do === 'recreate') {
      if (find(app, s.c, s.data.id) !== null) throw conflict(s.c, s.data.id, 'was made again');
    }
  }
}

/** Apply undo steps with a transaction handle. */
function apply(tx, steps) {
  const u = L('lib_util');
  for (const s of steps) {
    if (s.do === 'delete') {
      const rec = find(tx, s.c, s.id);
      if (rec !== null) tx.delete(rec);
    } else if (s.do === 'restore') {
      const rec = find(tx, s.c, s.id);
      if (rec === null) continue;
      for (const k of Object.keys(s.fields || {})) rec.set(k, s.fields[k]);
      tx.save(rec);
    } else if (s.do === 'recreate') {
      const rec = new Record(tx.findCollectionByNameOrId(s.c));
      for (const k of Object.keys(s.data)) rec.set(k, s.data[k]);
      tx.save(rec);
    }
  }
}

/* ------------------------------------------------------------------ runs */

/**
 * Your AI agent's current run id: a new one after 30 minutes without a
 * write; kept in the app store (a restart starts a new run).
 */
function agentRun(app) {
  const now = Date.now();
  let r = null;
  try {
    const raw = app.store().get(RUN_KEY);
    r = raw ? JSON.parse(raw) : null;
  } catch {
    r = null;
  }
  if (r === null || now - Number(r.last || 0) > RUN_GAP_MS) r = { id: 'run_' + $security.randomStringWithAlphabet(12, 'abcdefghijklmnopqrstuvwxyz0123456789'), last: now };
  r.last = now;
  app.store().set(RUN_KEY, JSON.stringify(r));
  return r.id;
}

/** Write the activity row of one unit (with the transaction handle). Returns its id ('' when nothing was recorded). */
function record(app, ctx, o) {
  const u = L('lib_util');
  const steps = o.steps || [];
  if (steps.length === 0 && !ctx.isAgent) return '';
  let kept = steps;
  if (JSON.stringify(kept).length > 3800000) kept = [];
  const rec = new Record(app.findCollectionByNameOrId('activity'));
  const actor = ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system';
  rec.set('actor', actor);
  rec.set('member', actor === 'person' ? ctx.memberId || '' : '');
  rec.set('run', ctx.isAgent ? ctx.run || '' : '');
  rec.set('op', u.clip(o.op || '', 80));
  rec.set('summary', u.clip(o.summary || o.op || '', 600));
  rec.set('target_collection', u.clip(o.target_collection || '', 60));
  rec.set('target_id', u.clip(o.target_id || '', 30));
  rec.set('steps', kept);
  rec.set('changes', kept.length);
  rec.set('undone', false);
  app.save(rec);
  return rec.id;
}

/* -------------------------------------------------------------------- ops */

function view(app, r, names) {
  const u = L('lib_util');
  const mid = r.getString('member');
  const ub = r.getString('undone_by');
  for (const id of [mid, ub]) {
    if (id !== '' && names[id] === undefined) {
      const m = u.byId(app, 'members', id);
      names[id] = m === null ? 'Former member' : m.getString('name');
    }
  }
  const actor = r.getString('actor');
  return {
    id: r.id,
    at: r.getString('created'),
    actor: actor,
    member: mid,
    who: actor === 'agent' ? 'Your AI agent' : actor === 'system' ? 'Venture OS' : names[mid] || '',
    run: r.getString('run'),
    op: r.getString('op'),
    summary: r.getString('summary'),
    target_collection: r.getString('target_collection'),
    target_id: r.getString('target_id'),
    changes: r.getInt('changes'),
    undoable: r.getInt('changes') > 0 && !r.getBool('undone'),
    undone: r.getBool('undone'),
    undone_by: ub,
    undone_by_name: ub !== '' ? names[ub] || '' : '',
    undone_at: r.getString('undone_at'),
  };
}

function seesAll(ctx) {
  return ctx.isAgent || L('lib_auth').can(ctx, 'settings', 'view');
}

/* ------------------------------------------------------------- scope */

/** The rights modules a catalog permission names ('signed' and 'public' name none). */
function permModules(perm) {
  const out = [];
  for (const alt of String(perm || 'signed').split('|')) {
    const p = alt === 'admin' ? 'settings:full' : alt;
    const i = p.indexOf(':');
    if (i > 0) out.push(p.slice(0, i));
  }
  return out;
}

/** May ctx see what a module holds: LP data through fundDataVisible, the rest by its view level. */
function seesModule(ctx, m) {
  const auth = L('lib_auth');
  if (m === 'lps') return auth.fundDataVisible(ctx);
  return auth.can(ctx, m, 'view');
}

function anyModule(ctx, mods) {
  return mods.length === 0 || mods.some((m) => seesModule(ctx, m));
}

function str(rec, f) {
  try {
    return rec.getString(f);
  } catch {
    return '';
  }
}

/** The record an entry touched, or what a deletion left in its undo steps (deal and fund only). */
function targetOf(app, row) {
  const u = L('lib_util');
  const rec = u.byId(app, row.target_collection, row.target_id);
  if (rec !== null) return { rec: rec, deal: row.target_collection === 'deals' ? rec.id : str(rec, 'deal'), fund: str(rec, 'fund') };
  const full = u.byId(app, 'activity', row.id);
  const steps = full === null ? [] : u.jsonOf(full, 'steps', []) || [];
  for (const st of steps) {
    if (st && st.do === 'recreate' && st.c === row.target_collection && st.data && st.data.id === row.target_id) return { rec: null, deal: st.data.deal || '', fund: st.data.fund || '', data: st.data };
  }
  return null;
}

/**
 * May ctx see this entry? The owner and the author always. Otherwise the
 * caller needs view rights on a module its op requires, and must be able to
 * see the record it touched: its deal (restricted deals, fund scope), its
 * fund, an outbound message's module.
 */
function entryVisible(ctx, row, memo) {
  const auth = L('lib_auth');
  if (ctx.owner) return true;
  if (row.actor === 'person' && row.member !== '' && row.member === ctx.memberId) return true;
  const opKey = 'op:' + row.op;
  if (memo[opKey] === undefined) {
    let spec = null;
    try {
      spec = row.op !== '' ? L('lib_catalog').get(row.op) : null;
    } catch {
      spec = null;
    }
    memo[opKey] = spec === null ? true : anyModule(ctx, permModules(spec.perm));
  }
  if (!memo[opKey]) return false;
  if (row.target_collection === '' || row.target_id === '') return !ctx.ownOnly;
  const tKey = 't:' + row.target_collection + ':' + row.target_id;
  if (memo[tKey] !== undefined) return memo[tKey];
  const app = ctx.app;
  const t = targetOf(app, row);
  let ok;
  if (t === null) ok = !ctx.ownOnly;
  else if (ctx.ownOnly && (t.rec === null || !auth.owns(ctx, t.rec))) ok = false;
  else if (t.deal !== '' && !auth.dealVisible(ctx, t.deal)) ok = false;
  else if (t.fund !== '' && !auth.inScope(ctx, t.fund)) ok = false;
  else if (row.target_collection === 'entities') ok = t.rec === null || (str(t.rec, 'kind') !== 'fund' && str(t.rec, 'kind') !== 'spv') || auth.inScope(ctx, t.rec.id);
  else if (row.target_collection === 'outbound') ok = t.rec === null || str(t.rec, 'member') === ctx.memberId || seesModule(ctx, str(t.rec, 'module'));
  else ok = t.rec === null || auth.recordVisible(ctx, row.target_collection, row.target_id);
  memo[tKey] = ok;
  return ok;
}

/**
 * activity.list: units newest first; --run, --actor, --target, --op, --mine;
 * --view runs groups your AI agent's runs. Entries about records the caller
 * may not see (module rights, restricted deals, fund scope) are left out and
 * counted as `hidden`.
 */
function list(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const where = ['1 = 1'];
  const bind = {};
  const add = (sql, k, v) => {
    where.push(sql);
    bind[k] = v;
  };
  if (ctx.ownOnly) add('member = {:me}', 'me', ctx.memberId || '-');
  else if (!seesAll(ctx)) add("(member = {:me} OR actor != 'person')", 'me', ctx.memberId || '-');
  if (u.bool(p, 'mine', false)) add('member = {:mine}', 'mine', ctx.memberId || '-');
  const run = u.str(p, 'run', '');
  if (run !== '') add('run = {:run}', 'run', run);
  const actor = u.str(p, 'actor', '');
  if (actor !== '') add('actor = {:a}', 'a', actor);
  const op = u.str(p, 'op', '');
  if (op !== '') add('op = {:op}', 'op', op);
  const target = u.str(p, 'target', '');
  if (target !== '') {
    const i = target.indexOf(':');
    if (i > 0) {
      add('target_collection = {:tc}', 'tc', target.slice(0, i));
      add('target_id = {:ti}', 'ti', target.slice(i + 1));
    } else add('target_id = {:ti}', 'ti', target);
  }
  const w = where.join(' AND ');
  // Light rows, newest first, then the caller's scope (memoised per op and per record).
  const all = u.rows(app, 'SELECT id, created, actor, member, run, op, target_collection, target_id, summary, changes, undone FROM activity WHERE ' + w + ' ORDER BY created DESC, id DESC LIMIT 20000', { id: '', created: '', actor: '', member: '', run: '', op: '', target_collection: '', target_id: '', summary: '', changes: 0, undone: false }, bind);
  const memo = {};
  const rows = [];
  for (let i = 0; i < all.length; i++) if (entryVisible(ctx, all[i], memo)) rows.push(all[i]);
  const hidden = all.length - rows.length;
  if (u.str(p, 'view', '') === 'runs') {
    const runs = [];
    const byRun = {};
    for (const r of rows) {
      if (r.run === '') continue;
      let g = byRun[r.run];
      if (g === undefined) {
        g = byRun[r.run] = { run: r.run, started: r.created, last: r.created, entries: 0, undone: 0, changes: 0, summaries: [] };
        runs.push(g);
      }
      if (r.created < g.started) g.started = r.created;
      if (r.created > g.last) g.last = r.created;
      g.entries++;
      if (r.undone) g.undone++;
      g.changes += Number(r.changes) || 0;
      if (g.summaries.length < 6) g.summaries.push(r.summary);
    }
    return { runs: runs.slice(0, u.int(p, 'limit', 20, 1, 200)), hidden: hidden };
  }
  const pg = u.page(p, 50, 500);
  const names = {};
  return { entries: rows.slice(pg.offset, pg.offset + pg.limit).map((r) => view(app, app.findRecordById('activity', r.id), names)), total: rows.length, hidden: hidden, limit: pg.limit, offset: pg.offset };
}

/** May this person undo this unit? Their own; your AI agent's or the app's when they could run its op; the owner any. */
function mayUndo(ctx, r) {
  if (ctx.owner) return true;
  const actor = r.getString('actor');
  if (actor === 'person') return r.getString('member') === ctx.memberId;
  return L('lib_auth').mayRun(Object.assign({}, ctx, { isAgent: false }), r.getString('op'));
}

/**
 * activity.undo: one unit (--entry) or every unit of a run (--run), newest
 * first, all in one transaction: either everything is undone or nothing.
 */
function undo(ctx, p) {
  const u = L('lib_util');
  const app = ctx.app;
  const entry = u.str(p, 'entry', '');
  const run = u.str(p, 'run', '');
  if ((entry === '') === (run === '')) throw u.fail(400, 'Give --entry (one change) or --run (a run of your AI agent).', 'missing_param', { param: 'entry' });
  let rows;
  if (entry !== '') {
    const r = u.byId(app, 'activity', entry);
    if (r === null) throw u.fail(404, 'No activity entry ' + entry + '. Run activity.list.', 'not_found');
    if (r.getBool('undone')) throw u.fail(409, 'Already undone.', 'conflict');
    if (r.getInt('changes') === 0) throw u.fail(409, '"' + r.getString('summary') + '" has nothing to undo.', 'not_undoable');
    rows = [r];
  } else {
    rows = u.findMany(app, 'activity', 'run = {:r} && undone = false && changes > 0', '-created', 2000, { r: run });
    if (rows.length === 0) throw u.fail(404, 'Nothing left to undo in run ' + run + '.', 'not_found');
  }
  for (const r of rows) if (!mayUndo(ctx, r)) throw u.fail(403, 'You cannot undo "' + r.getString('summary') + '".', 'not_permitted', { entry: r.id });
  const now = u.nowIso();
  app.runInTransaction((tx) => {
    for (const r of rows) {
      const fresh = tx.findRecordById('activity', r.id);
      const steps = u.jsonOf(fresh, 'steps', []) || [];
      guard(tx, steps);
      apply(tx, steps);
      fresh.set('undone', true);
      fresh.set('undone_by', ctx.memberId || '');
      fresh.set('undone_at', now);
      tx.save(fresh);
    }
    L('lib_audit').write(L('lib_auth').withApp(ctx, tx), { op: 'activity.undo', collection: 'activity', record: rows[0].id, summary: 'Undid ' + (run !== '' ? 'run ' + run + ' (' + rows.length + ' changes)' : '"' + rows[0].getString('summary') + '"') });
  });
  ctx.audited = true;
  const names = {};
  return { undone: rows.length, run: run, entries: rows.map((r) => view(app, app.findRecordById('activity', r.id), names)) };
}

/** A trigger fired: your AI agent's next write starts a new run (one task, one undoable run). */
function endRun(app) {
  try {
    app.store().remove(RUN_KEY);
  } catch {
    /* nothing to end */
  }
}

module.exports = { SKIP: SKIP, skipped: skipped, tracker: tracker, snapshot: snapshot, canon: canon, guard: guard, apply: apply, agentRun: agentRun, endRun: endRun, record: record, list: list, undo: undo, view: view };
