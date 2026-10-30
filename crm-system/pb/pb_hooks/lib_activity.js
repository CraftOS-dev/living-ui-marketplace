/// <reference path="../pb_data/types.d.ts" />
/**
 * The activity log: every change by the person or the AI agent, with what
 * it takes to undo it (and, once undone, to redo it).
 *
 * An undo is a list of steps applied in one transaction:
 *   { do: 'delete',   c: collection, id }            undo a creation
 *   { do: 'restore',  c: collection, id, fields }    undo an edit
 *   { do: 'recreate', c: collection, data }          undo a deletion (same id)
 * Applying the steps returns the inverse steps, saved as the redo.
 *
 * The AI agent's changes carry a run id (see lib_util.actor): a run can be
 * reviewed and reverted as a whole. Imports and bulk edits are one entry,
 * so they are undone as one.
 */

const SKIP = { created: true, updated: true };

/**
 * Field-level differences between a record's values before and after an
 * edit, for the history panel: [{field, before, after}].
 */
function diff(before, after) {
  const out = [];
  for (const k of Object.keys(after)) {
    const b = before[k];
    const a = after[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ field: k, before: b === undefined ? null : b, after: a === undefined ? null : a });
  }
  return out;
}

/** Plain values of every field of a record (json fields parsed). */
function snapshot(rec) {
  const out = { id: rec.id };
  const fields = rec.collection().fields;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const name = f.getName();
    if (name === 'id' || SKIP[name]) continue;
    out[name] = value(rec, name, f.type());
  }
  return out;
}

function value(rec, name, type) {
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
  return rec.getString(name);
}

/** The current values of some fields, for a 'restore' step. */
function pick(rec, names) {
  const out = {};
  const fields = rec.collection().fields;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const name = f.getName();
    if (names.indexOf(name) >= 0) out[name] = value(rec, name, f.type());
  }
  return out;
}

/** Apply steps in a transaction; returns the inverse steps (newest change first). */
function apply(app, steps) {
  const inverse = [];
  app.runInTransaction((tx) => {
    const lib = require(`${__hooks}/lib_activity.js`);
    for (const s of steps) {
      if (s.do === 'delete') {
        let rec = null;
        try {
          rec = tx.findRecordById(s.c, s.id);
        } catch {
          rec = null;
        }
        if (!rec) continue;
        inverse.unshift({ do: 'recreate', c: s.c, data: lib.snapshot(rec) });
        tx.delete(rec);
      } else if (s.do === 'restore') {
        let rec = null;
        try {
          rec = tx.findRecordById(s.c, s.id);
        } catch {
          rec = null;
        }
        if (!rec) continue;
        inverse.unshift({ do: 'restore', c: s.c, id: s.id, fields: lib.pick(rec, Object.keys(s.fields || {})) });
        for (const k of Object.keys(s.fields || {})) rec.set(k, s.fields[k]);
        tx.save(rec);
      } else if (s.do === 'recreate') {
        let exists = false;
        try {
          tx.findRecordById(s.c, s.data.id);
          exists = true;
        } catch {
          exists = false;
        }
        if (exists) continue;
        const rec = new Record(tx.findCollectionByNameOrId(s.c));
        for (const k of Object.keys(s.data)) rec.set(k, s.data[k]);
        tx.save(rec);
        inverse.unshift({ do: 'delete', c: s.c, id: s.data.id });
      }
    }
  });
  return inverse;
}

/**
 * Log a change. `a`: { who: {actor, run}, op, summary, type, id, changes,
 * undo: [steps], merge: true to fold repeated edits of the same thing into
 * the newest entry from the last 90 seconds (keeps its original undo) }.
 */
function record(app, a) {
  try {
    const who = a.who || { actor: 'user', run: '' };
    if (a.merge && a.id) {
      const since = new Date(Date.now() - 90 * 1000).toISOString().replace('T', ' ');
      const rows = app.findRecordsByFilter(
        'activity',
        'actor = {:a} && op = {:op} && target_id = {:id} && undone = false && created >= {:s}',
        '-created',
        1,
        0,
        { a: who.actor, op: a.op, id: a.id, s: since },
      );
      if (rows.length > 0) {
        rows[0].set('summary', String(a.summary || '').slice(0, 500));
        // The original undo restores the state before the first edit; its
        // stamps move to the newest state so the later edits do not block it.
        const u = require(`${__hooks}/lib_util.js`);
        const old = u.json(rows[0], 'undo', null);
        if (old && old.steps && a.undo) {
          const now = {};
          for (const s of a.undo) if (s.id) now[s.c + ':' + s.id] = s.at;
          for (const s of old.steps) if (s.id && now[s.c + ':' + s.id] !== undefined) s.at = now[s.c + ':' + s.id];
          for (const s of a.undo) if (s.do === 'delete' && !old.steps.some((x) => x.c === s.c && x.id === s.id)) old.steps.unshift(s);
          rows[0].set('undo', old);
        }
        app.save(rows[0]);
        return rows[0];
      }
    }
    const rec = new Record(app.findCollectionByNameOrId('activity'));
    rec.set('actor', who.actor);
    rec.set('run', who.run || '');
    rec.set('op', a.op);
    rec.set('summary', String(a.summary || '').slice(0, 500));
    rec.set('target_type', a.type || '');
    rec.set('target_id', a.id || '');
    rec.set('undo', a.undo && a.undo.length > 0 ? { steps: a.undo } : null);
    rec.set('changes', a.changes && a.changes.length > 0 ? a.changes : null);
    rec.set('undone', false);
    app.save(rec);
    return rec;
  } catch (err) {
    console.error('[crm] logging activity failed:', err);
    return null;
  }
}

function serialize(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const undo = u.json(rec, 'undo', null);
  return {
    id: rec.id,
    actor: rec.getString('actor'),
    run: rec.getString('run'),
    op: rec.getString('op'),
    summary: rec.getString('summary'),
    target_type: rec.getString('target_type'),
    target_id: rec.getString('target_id'),
    changes: u.json(rec, 'changes', null),
    undoable: !!(undo && undo.steps && undo.steps.length > 0) && !rec.getBool('undone'),
    redoable: rec.getBool('undone') && !!u.json(rec, 'redo', null),
    undone: rec.getBool('undone'),
    created: rec.getString('created'),
  };
}

function list(app, f) {
  const parts = [];
  const prm = {};
  if (f.actor) {
    parts.push('actor = {:actor}');
    prm.actor = f.actor;
  }
  if (f.run) {
    parts.push('run = {:run}');
    prm.run = f.run;
  }
  if (f.target) {
    parts.push('target_id = {:tid}');
    prm.tid = f.target;
  }
  const rows = app.findRecordsByFilter('activity', parts.join(' && ') || 'id != ""', '-created', f.limit || 100, f.offset || 0, prm);
  return rows.map(serialize);
}

function mustGet(app, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = u.byId(app, 'activity', id);
  if (!rec) throw u.fail(404, 'No activity entry ' + id + '; see activity.list');
  return rec;
}

/** Undo one entry (its change and nothing else). */
function undo(app, rec, who) {
  const u = require(`${__hooks}/lib_util.js`);
  if (rec.getBool('undone')) throw u.fail(409, 'Already undone');
  const data = u.json(rec, 'undo', null);
  if (!data || !data.steps || data.steps.length === 0) throw u.fail(409, '"' + rec.getString('summary') + '" cannot be undone');
  guardSteps(app, data.steps);
  const inverse = apply(app, data.steps);
  rec.set('undone', true);
  rec.set('redo', { steps: inverse });
  app.save(rec);
  return serialize(rec);
}

function redo(app, rec, who) {
  const u = require(`${__hooks}/lib_util.js`);
  if (!rec.getBool('undone')) throw u.fail(409, 'Only an undone change can be redone');
  const data = u.json(rec, 'redo', null);
  if (!data || !data.steps) throw u.fail(409, 'Nothing to redo');
  guardSteps(app, data.steps);
  const inverse = apply(app, data.steps);
  rec.set('undone', false);
  rec.set('undo', { steps: inverse });
  rec.set('redo', null);
  app.save(rec);
  return serialize(rec);
}

/** The newest change by an actor that can still be undone (Ctrl+Z). */
function latest(app, who, undone) {
  const rows = app.findRecordsByFilter('activity', 'actor = {:a} && undone = {:u}', '-created', 30, 0, { a: who, u: undone });
  const u = require(`${__hooks}/lib_util.js`);
  for (const r of rows) {
    const d = u.json(r, undone ? 'redo' : 'undo', null);
    if (d && d.steps && d.steps.length > 0) return r;
  }
  return null;
}

/** Revert everything an AI agent run changed, newest first. */
function revertRun(app, run, who) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = app.findRecordsByFilter('activity', 'run = {:r} && undone = false', '-created', 500, 0, { r: run });
  if (rows.length === 0) throw u.fail(404, 'Nothing left to revert in run ' + run);
  let n = 0;
  const skipped = [];
  for (const r of rows) {
    const d = u.json(r, 'undo', null);
    if (!d || !d.steps || d.steps.length === 0) continue;
    try {
      undo(app, r, who);
      n++;
    } catch (err) {
      if (!err || !err.status) throw err;
      skipped.push({ entry: r.id, summary: r.getString('summary'), reason: String(err.message || err) });
    }
  }
  return { run: run, reverted: n, skipped: skipped };
}

/** The AI agent's runs, newest first: when, how many changes, what they were. */
function runs(app, limit) {
  const rows = app.findRecordsByFilter('activity', "actor = 'agent' && run != ''", '-created', 600, 0);
  const byRun = {};
  const order = [];
  for (const r of rows) {
    const id = r.getString('run');
    let x = byRun[id];
    if (!x) {
      x = { run: id, started: r.getString('created'), last: r.getString('created'), changes: 0, undone: 0, summaries: [] };
      byRun[id] = x;
      order.push(id);
    }
    x.started = r.getString('created');
    x.changes++;
    if (r.getBool('undone')) x.undone++;
    if (x.summaries.length < 6) x.summaries.push(r.getString('summary'));
  }
  return order.slice(0, limit || 20).map((id) => byRun[id]);
}

/**
 * A recording wrapper around an app or transaction: every save and delete
 * made through it is noted, so a whole operation (a deal with its stage
 * event and people, a merge with every link it moved) is undone as one
 * unit. Records created and then deleted inside the operation leave
 * no trace; a record edited several times is restored to its first state.
 */
function tracker(app) {
  const lib = require(`${__hooks}/lib_activity.js`);
  const steps = [];
  const index = {};
  const keyOf = (rec) => rec.collection().name + ':' + rec.id;
  const t = {
    save: (rec) => {
      if (rec.isNew()) {
        app.save(rec);
        const k = keyOf(rec);
        index[k] = { created: true };
        steps.push({ do: 'delete', c: rec.collection().name, id: rec.id });
        return;
      }
      const k = keyOf(rec);
      if (!index[k]) {
        const snap = lib.snapshot(rec.original());
        delete snap.id;
        const step = { do: 'restore', c: rec.collection().name, id: rec.id, fields: snap };
        index[k] = { step: step };
        steps.push(step);
      }
      app.save(rec);
    },
    delete: (rec) => {
      const k = keyOf(rec);
      const c = rec.collection().name;
      const known = index[k];
      if (known && known.created) {
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].do === 'delete' && steps[i].c === c && steps[i].id === rec.id) {
            steps.splice(i, 1);
            break;
          }
        }
      } else if (known && known.step) {
        known.step.do = 'recreate';
        known.step.data = Object.assign({ id: rec.id }, known.step.fields);
        delete known.step.fields;
        delete known.step.id;
      } else steps.push({ do: 'recreate', c: c, data: lib.snapshot(rec.original()) });
      index[k] = { deleted: true };
      app.delete(rec);
    },
    findRecordById: (c, id) => app.findRecordById(c, id),
    findRecordsByFilter: (c, f, s, l, o, p) => (p === undefined ? app.findRecordsByFilter(c, f, s, l, o) : app.findRecordsByFilter(c, f, s, l, o, p)),
    findFirstRecordByFilter: (c, f, p) => (p === undefined ? app.findFirstRecordByFilter(c, f) : app.findFirstRecordByFilter(c, f, p)),
    findCollectionByNameOrId: (c) => app.findCollectionByNameOrId(c),
    countRecords: (c, ...exprs) => app.countRecords(c, ...exprs),
    db: () => app.db(),
    store: () => app.store(),
    dataDir: () => app.dataDir(),
    newFilesystem: () => app.newFilesystem(),
    runInTransaction: (fn) => fn(t),
    /** Undo steps, newest change first, stamped with each record's state after the change. */
    steps: () => {
      for (const s of steps) {
        if (s.do === 'recreate') continue;
        try {
          s.at = app.findRecordById(s.c, s.id).getString('updated');
        } catch {
          s.at = '';
        }
      }
      return steps.slice().reverse();
    },
    raw: app,
  };
  return t;
}

/** Throw when something these steps touch was changed again after the change being undone. */
function guardSteps(app, steps) {
  for (const s of steps) {
    if (!s.at || s.do === 'recreate') continue;
    let now = '';
    try {
      now = app.findRecordById(s.c, s.id).getString('updated');
    } catch {
      now = '';
    }
    if (now !== '' && now !== s.at) throw require(`${__hooks}/lib_util.js`).fail(409, 'Something this change touched was changed again later; undo the later change first');
  }
}

/**
 * Run fn(trackedTx) in one transaction and log it with its undo.
 * fn returns { summary, type, id, changes?, result, undoable? (default true), merge? }.
 */
function run(app, who, op, fn) {
  const lib = require(`${__hooks}/lib_activity.js`);
  let out = null;
  app.runInTransaction((tx) => {
    const t = lib.tracker(tx);
    out = fn(t) || {};
    let steps = out.undoable === false ? [] : t.steps();
    if (steps.length > 0 && JSON.stringify(steps).length > 7600000) steps = [];
    if (out.summary) lib.record(tx, { who: who, op: op, summary: out.summary, type: out.type || '', id: out.id || '', changes: out.changes, undo: steps, merge: out.merge });
  });
  return out.result;
}

module.exports = {
  tracker: tracker,
  guardSteps: guardSteps,
  run: run,
  diff: diff,
  snapshot: snapshot,
  pick: pick,
  apply: apply,
  record: record,
  serialize: serialize,
  list: list,
  mustGet: mustGet,
  undo: undo,
  redo: redo,
  latest: latest,
  revertRun: revertRun,
  runs: runs,
};
