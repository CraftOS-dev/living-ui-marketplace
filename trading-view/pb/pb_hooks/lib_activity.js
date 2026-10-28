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
 * reviewed and reverted as a whole.
 */

const SKIP = { created: true, updated: true };

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
 * Log a change. `a`: { who: {actor, run}, op, summary, type, id, symbol,
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
    rec.set('symbol', a.symbol || '');
    rec.set('undo', a.undo && a.undo.length > 0 ? { steps: a.undo } : null);
    rec.set('undone', false);
    app.save(rec);
    return rec;
  } catch (err) {
    console.error('[trading-view] logging activity failed:', err);
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
    symbol: rec.getString('symbol'),
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
  if (f.symbol) {
    parts.push('symbol = {:sym}');
    prm.sym = f.symbol;
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
function undo(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  if (rec.getBool('undone')) throw u.fail(409, 'Already undone');
  const data = u.json(rec, 'undo', null);
  if (!data || !data.steps || data.steps.length === 0) throw u.fail(409, '"' + rec.getString('summary') + '" cannot be undone');
  const inverse = apply(app, data.steps);
  rec.set('undone', true);
  rec.set('redo', { steps: inverse });
  app.save(rec);
  return serialize(rec);
}

function redo(app, rec) {
  const u = require(`${__hooks}/lib_util.js`);
  if (!rec.getBool('undone')) throw u.fail(409, 'Only an undone change can be redone');
  const data = u.json(rec, 'redo', null);
  if (!data || !data.steps) throw u.fail(409, 'Nothing to redo');
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
function revertRun(app, run) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = app.findRecordsByFilter('activity', 'run = {:r} && undone = false', '-created', 500, 0, { r: run });
  if (rows.length === 0) throw u.fail(404, 'Nothing left to revert in run ' + run);
  let n = 0;
  for (const r of rows) {
    const d = u.json(r, 'undo', null);
    if (!d || !d.steps || d.steps.length === 0) continue;
    undo(app, r);
    n++;
  }
  return { run: run, reverted: n };
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
      x = { run: id, started: r.getString('created'), last: r.getString('created'), changes: 0, undone: 0, symbols: [], summaries: [] };
      byRun[id] = x;
      order.push(id);
    }
    x.started = r.getString('created');
    x.changes++;
    if (r.getBool('undone')) x.undone++;
    const sym = r.getString('symbol');
    if (sym && x.symbols.indexOf(sym) < 0) x.symbols.push(sym);
    if (x.summaries.length < 6) x.summaries.push(r.getString('summary'));
  }
  return order.slice(0, limit || 20).map((id) => byRun[id]);
}

module.exports = {
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
