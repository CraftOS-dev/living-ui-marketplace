/// <reference path="../pb_data/types.d.ts" />
/**
 * Pipelines, stages and deals.
 *
 * A stage has a kind (open, won, lost), a win probability, a rotting limit
 * (days without activity before a deal turns stale) and a target time in
 * stage. Every stage change is a stage event (from, to, when, who): time in
 * stage, funnels and cycle length come from them. Won and lost set the
 * deal's status and close date and freeze its home-currency value; reopening
 * clears them. Weighted value = value x probability (the stage's unless the
 * deal overrides it).
 *
 * The AI agent's stage moves, closes and reopens are proposals unless the
 * person made them automatic.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function fail(status, message) {
  return U().fail(status, message);
}

function nowIso() {
  return new Date().toISOString();
}

/* -------------------------------------------------------------- pipelines */

function stagesOf(app, pipelineId) {
  return app.findRecordsByFilter('stages', 'pipeline = {:p}', 'position', 0, 0, { p: pipelineId });
}

function serializeStage(rec) {
  return {
    id: rec.id,
    pipeline: rec.getString('pipeline'),
    name: rec.getString('name'),
    position: rec.getInt('position'),
    kind: rec.getString('kind') || 'open',
    probability: rec.getFloat('probability'),
    rot_days: rec.getInt('rot_days'),
    target_days: rec.getInt('target_days'),
    color: rec.getString('color'),
  };
}

function serializePipeline(app, rec) {
  return {
    id: rec.id,
    name: rec.getString('name'),
    kind: rec.getString('kind') || 'other',
    currency: rec.getString('currency'),
    target: rec.getFloat('target'),
    position: rec.getInt('position'),
    archived: rec.getBool('archived'),
    stages: stagesOf(app, rec.id).map(serializeStage),
    open_deals: app.countRecords('deals', $dbx.hashExp({ pipeline: rec.id, status: 'open', deleted: '' })),
  };
}

function pipelines(app, archived) {
  return app.findRecordsByFilter('pipelines', archived ? 'id != ""' : 'archived = false', 'position,name', 0, 0).map((p) => serializePipeline(app, p));
}

/** A pipeline by id, name or kind (sales, fundraising, ...); '' = the first. */
function pipelineByRef(app, ref) {
  const u = U();
  const r = String(ref || '').trim();
  const all = app.findRecordsByFilter('pipelines', 'archived = false', 'position,name', 0, 0);
  if (r === '') {
    if (all.length === 0) throw fail(409, 'There is no pipeline yet; create one with pipelines.create');
    return all[0];
  }
  const byId = u.byId(app, 'pipelines', r);
  if (byId) return byId;
  const hit = all.find((p) => p.getString('name').toLowerCase() === r.toLowerCase()) || all.find((p) => p.getString('kind') === r.toLowerCase());
  if (!hit) throw fail(404, 'No pipeline "' + r + '"; pipelines: ' + all.map((p) => p.getString('name')).join(', '));
  return hit;
}

/** A stage by id or name within a pipeline (or across pipelines for an id). */
function stageIn(app, pipelineId, ref) {
  const u = U();
  const r = String(ref || '').trim();
  const byId = u.byId(app, 'stages', r);
  if (byId) return byId;
  const list = stagesOf(app, pipelineId);
  const hit = list.find((s) => s.getString('name').toLowerCase() === r.toLowerCase());
  if (!hit) throw fail(404, 'No stage "' + r + '"; stages: ' + list.map((s) => s.getString('name')).join(', '));
  return hit;
}

function stageByRef(app, deal, ref) {
  return stageIn(app, deal.getString('pipeline'), ref);
}

/** The first won (or lost) stage of a pipeline. */
function outcomeStage(app, pipelineId, outcome) {
  const st = stagesOf(app, pipelineId).find((s) => s.getString('kind') === outcome);
  if (!st) throw fail(409, 'This pipeline has no ' + outcome + ' stage; add one in Setup');
  return st;
}

/** Where a reopened deal goes: the given stage, else the open stage it was last in. */
function reopenStage(app, deal, ref) {
  if (ref) {
    const st = stageByRef(app, deal, ref);
    if (st.getString('kind') !== 'open') throw fail(400, 'Reopen into an open stage');
    return st;
  }
  const evs = app.findRecordsByFilter('stage_events', 'deal = {:d}', '-at', 50, 0, { d: deal.id });
  for (const e of evs) {
    const st = U().byId(app, 'stages', e.getString('to_stage'));
    if (st && st.getString('kind') === 'open' && st.getString('pipeline') === deal.getString('pipeline')) return st;
  }
  const first = stagesOf(app, deal.getString('pipeline')).find((s) => s.getString('kind') === 'open');
  if (!first) throw fail(409, 'This pipeline has no open stage');
  return first;
}

/* ---------------------------------------------------------------- values */

function probability(deal, stage) {
  const o = deal.getFloat('prob_override');
  if (o >= 0) return o;
  return stage ? stage.getFloat('probability') : 0;
}

/** The home-currency value: frozen once closed; open deals at the latest rate (null without one). */
function homeValue(deal, home, rates) {
  if (deal.getString('status') !== 'open') return deal.getFloat('home_value');
  const fx = require(`${__hooks}/lib_fx.js`);
  const c = deal.getString('currency') || home;
  return fx.toHome(deal.getFloat('value'), c, home, rates[c] || '');
}

function freeze(app, deal) {
  const fx = require(`${__hooks}/lib_fx.js`);
  const home = fx.home(app);
  const c = deal.getString('currency') || home;
  const v = fx.toHome(deal.getFloat('value'), c, home, fx.rateFor(app, c, ''));
  deal.set('home_value', v === null ? 0 : v);
}

/* ------------------------------------------------------------ stage moves */

function event(app, who, deal, from, to) {
  const e = new Record(app.findCollectionByNameOrId('stage_events'));
  e.set('deal', deal.id);
  e.set('pipeline', deal.getString('pipeline'));
  e.set('from_stage', from || '');
  e.set('to_stage', to);
  e.set('at', nowIso());
  e.set('actor', who.actor);
  e.set('run', who.run || '');
  app.save(e);
}

/** Put a deal in a stage (no policy check): event, status, close date, frozen value. */
function setStage(app, who, deal, stage, opts) {
  const dates = require(`${__hooks}/lib_dates.js`);
  const from = deal.getString('stage');
  if (from === stage.id) return deal;
  const kind = stage.getString('kind') || 'open';
  deal.set('pipeline', stage.getString('pipeline'));
  deal.set('stage', stage.id);
  deal.set('stage_entered', nowIso());
  deal.set('last_activity', nowIso());
  const wasOpen = deal.getString('status') === 'open' || deal.getString('status') === '';
  deal.set('status', kind);
  if (kind === 'open') {
    deal.set('closed_at', '');
    deal.set('home_value', 0);
    deal.set('lost_reason', '');
  } else {
    if (wasOpen || deal.getString('closed_at') === '') deal.set('closed_at', dates.today());
    freeze(app, deal);
    if (kind === 'lost' && opts && opts.lost_reason) deal.set('lost_reason', String(opts.lost_reason).slice(0, 300));
    if (kind === 'won') deal.set('lost_reason', '');
  }
  // To the bottom of the new column unless placed.
  if (!(opts && opts.position !== undefined)) deal.set('position', nextPosition(app, stage.id));
  app.save(deal);
  event(app, who, deal, from, stage.id);
  return deal;
}

function nextPosition(app, stageId) {
  const rows = app.findRecordsByFilter('deals', "stage = {:s} && deleted = ''", '-position', 1, 0, { s: stageId });
  return rows.length > 0 ? rows[0].getFloat('position') + 1 : 0;
}

/** A position between two cards (before `beforeId` in the stage, or last). */
function positionBefore(app, stageId, beforeId, selfId) {
  if (!beforeId) return nextPosition(app, stageId);
  const rows = app.findRecordsByFilter('deals', "stage = {:s} && deleted = '' && id != {:x}", 'position', 0, 0, { s: stageId, x: selfId });
  const i = rows.findIndex((r) => r.id === beforeId);
  if (i < 0) return nextPosition(app, stageId);
  const after = rows[i].getFloat('position');
  const before = i > 0 ? rows[i - 1].getFloat('position') : after - 2;
  return (before + after) / 2;
}

/**
 * Move a deal (drag on the board, or the agent). A different stage is
 * subject to the policy (stage, or close for won/lost); reordering within a
 * stage is not. Returns { deal, proposal }.
 */
function move(app, who, deal, stageRef, opts) {
  const setup = require(`${__hooks}/lib_setup.js`);
  const o = opts || {};
  const stage = stageRef ? stageByRef(app, deal, stageRef) : U().byId(app, 'stages', deal.getString('stage'));
  if (!stage) throw fail(400, 'stage is required');
  const kind = stage.getString('kind') || 'open';
  if (stage.id !== deal.getString('stage')) {
    const gate = kind === 'open' && deal.getString('status') === 'open' ? 'stage' : 'close';
    if (setup.mustPropose(app, who, gate)) {
      const cur = U().byId(app, 'stages', deal.getString('stage'));
      const proposal = require(`${__hooks}/lib_review.js`).create(app, who, {
        kind: gate,
        object: 'deals',
        target: deal.id,
        title: (kind === 'won' ? 'Mark ' + deal.getString('name') + ' won' : kind === 'lost' ? 'Mark ' + deal.getString('name') + ' lost' : 'Move ' + deal.getString('name') + ' to ' + stage.getString('name')),
        changes: [{ field: 'stage', label: 'Stage', from: cur ? cur.getString('name') : '', to: stage.getString('name') }].concat(o.lost_reason ? [{ field: 'lost_reason', label: 'Lost reason', from: deal.getString('lost_reason'), to: o.lost_reason }] : []),
        payload: { op: 'deals.move', deal: deal.id, stage: stage.id, lost_reason: o.lost_reason || '' },
        meta: o.meta,
      });
      return { deal: deal, proposal: proposal };
    }
    setStage(app, who, deal, stage, { lost_reason: o.lost_reason, position: o.before !== undefined ? 1 : undefined });
  }
  if (o.before !== undefined) {
    deal.set('position', positionBefore(app, stage.id, o.before, deal.id));
    app.save(deal);
  }
  return { deal: deal, proposal: null };
}

/* ------------------------------------------------------------------ deals */

/** Link people to a deal: list of ids/emails or [{person, role}]. */
function addPeople(app, who, deal, list, defaultRole) {
  const recs = require(`${__hooks}/lib_records.js`);
  const u = U();
  for (const item of list || []) {
    const ref = item && typeof item === 'object' ? item.person || item.id || item.email : item;
    const role = item && typeof item === 'object' && item.role ? String(item.role).slice(0, 60) : defaultRole || '';
    if (!ref) continue;
    let person = null;
    try {
      person = recs.resolve(app, 'people', String(ref));
    } catch (err) {
      if (err && err.status === 404 && String(ref).indexOf('@') > 0) person = recs.createPerson(app, who, { emails: [String(ref)] }, { source: 'deal' }, {});
      else throw err;
    }
    const ex = u.findOne(app, 'deal_people', 'deal = {:d} && person = {:p}', { d: deal.id, p: person.id });
    if (ex) {
      if (role && ex.getString('role') !== role) {
        ex.set('role', role);
        app.save(ex);
      }
      continue;
    }
    const r = new Record(app.findCollectionByNameOrId('deal_people'));
    r.set('deal', deal.id);
    r.set('person', person.id);
    r.set('role', role);
    app.save(r);
  }
}

/**
 * Create a deal. params: name, pipeline, stage, value, currency,
 * expected_close, probability, company, people, role, source, next_step,
 * next_step_date, tags. The AI agent creates deals in open stages only
 * unless closing is automatic for it.
 */
function create(app, who, p, meta) {
  const u = U();
  const recs = require(`${__hooks}/lib_records.js`);
  const setup = require(`${__hooks}/lib_setup.js`);
  const fx = require(`${__hooks}/lib_fx.js`);
  const pipe = pipelineByRef(app, u.str(p, 'pipeline', ''));
  const stage = u.str(p, 'stage', '') !== '' ? stageIn(app, pipe.id, u.str(p, 'stage', '')) : stagesOf(app, pipe.id).find((s) => s.getString('kind') === 'open');
  if (!stage) throw fail(409, 'The pipeline ' + pipe.getString('name') + ' has no open stage');
  if (stage.getString('pipeline') !== pipe.id) throw fail(400, 'That stage belongs to another pipeline');
  if (stage.getString('kind') !== 'open' && setup.mustPropose(app, who, 'close')) throw fail(403, 'Create the deal in an open stage, then propose closing it with deals.close');
  const name = u.squash(u.str(p, 'name', '')).slice(0, 200);
  if (name === '') throw fail(400, 'name is required');
  const rec = new Record(app.findCollectionByNameOrId('deals'));
  rec.set('name', name);
  rec.set('pipeline', pipe.id);
  rec.set('stage', stage.id);
  rec.set('status', stage.getString('kind') || 'open');
  rec.set('currency', pipe.getString('currency') || fx.home(app));
  rec.set('value', 0);
  rec.set('home_value', 0);
  rec.set('prob_override', -1);
  rec.set('tags', []);
  rec.set('custom', {});
  rec.set('prov', {});
  rec.set('deleted', '');
  rec.set('merged_into', '');
  rec.set('stage_entered', nowIso());
  rec.set('last_activity', nowIso());
  rec.set('position', nextPosition(app, stage.id));
  const defs = recs.fieldMap(app, 'deals');
  const ctx = { currency: u.str(p, 'currency', '') !== '' ? u.str(p, 'currency', '').toUpperCase() : rec.getString('currency'), home: fx.home(app), who: who, create: true };
  const prov = { name: { by: who.actor, at: nowIso(), run: who.run || '', source: (meta && meta.source) || '' } };
  for (const key of Object.keys(defs)) {
    const param = key === 'source' ? 'lead_source' : key;
    if (key === 'name' || !u.has(p, param)) continue;
    const v = recs.coerce(app, defs[key], key === 'tags' ? u.list(p, param, true) : p[param], ctx);
    if (recs.isEmpty(defs[key], v)) continue;
    recs.put(rec, defs[key], v);
    prov[key] = { by: who.actor, at: nowIso(), run: who.run || '', source: (meta && meta.source) || '' };
  }
  rec.set('prov', prov);
  if (rec.getString('status') !== 'open') {
    rec.set('closed_at', require(`${__hooks}/lib_dates.js`).today());
    freeze(app, rec);
  }
  app.save(rec);
  event(app, who, rec, '', stage.id);
  const people = u.has(p, 'people') ? u.list(p, 'people', true) : [];
  if (u.str(p, 'person', '') !== '') people.push(u.str(p, 'person', ''));
  addPeople(app, who, rec, people, u.str(p, 'role', ''));
  // The company of the first person when none was given.
  if (rec.getString('company') === '') {
    const first = app.findRecordsByFilter('deal_people', 'deal = {:d}', 'created', 1, 0, { d: rec.id });
    if (first.length > 0) {
      const person = u.byId(app, 'people', first[0].getString('person'));
      if (person && person.getString('company')) {
        rec.set('company', person.getString('company'));
        app.save(rec);
      }
    }
  }
  return rec;
}

/** Won or lost (subject to the close policy for the AI agent). */
function close(app, who, deal, outcome, reason, meta) {
  const stage = outcomeStage(app, deal.getString('pipeline'), outcome);
  return move(app, who, deal, stage.id, { lost_reason: outcome === 'lost' ? reason : '', meta: meta });
}

function reopen(app, who, deal, stageRef, meta) {
  const setup = require(`${__hooks}/lib_setup.js`);
  if (deal.getString('status') === 'open') throw fail(409, deal.getString('name') + ' is open');
  const stage = reopenStage(app, deal, stageRef);
  if (setup.mustPropose(app, who, 'close')) {
    const proposal = require(`${__hooks}/lib_review.js`).create(app, who, {
      kind: 'close',
      object: 'deals',
      target: deal.id,
      title: 'Reopen ' + deal.getString('name') + ' in ' + stage.getString('name'),
      changes: [{ field: 'status', label: 'Status', from: deal.getString('status'), to: 'open (' + stage.getString('name') + ')' }],
      payload: { op: 'deals.reopen', deal: deal.id, stage: stage.id },
      meta: meta,
    });
    return { deal: deal, proposal: proposal };
  }
  setStage(app, who, deal, stage, {});
  return { deal: deal, proposal: null };
}

/** Days spent in each stage, from the stage events (the current stage counts until now). */
function stageDays(app, deal) {
  const evs = app.findRecordsByFilter('stage_events', 'deal = {:d}', 'at', 0, 0, { d: deal.id });
  const out = {};
  for (let i = 0; i < evs.length; i++) {
    const st = evs[i].getString('to_stage');
    const start = Date.parse(String(evs[i].getString('at')).replace(' ', 'T'));
    const end = i + 1 < evs.length ? Date.parse(String(evs[i + 1].getString('at')).replace(' ', 'T')) : Date.now();
    if (!isFinite(start) || !isFinite(end)) continue;
    out[st] = (out[st] || 0) + Math.max(0, end - start) / 86400000;
  }
  return out;
}

module.exports = {
  stagesOf: stagesOf,
  serializeStage: serializeStage,
  serializePipeline: serializePipeline,
  pipelines: pipelines,
  pipelineByRef: pipelineByRef,
  stageIn: stageIn,
  stageByRef: stageByRef,
  outcomeStage: outcomeStage,
  reopenStage: reopenStage,
  probability: probability,
  homeValue: homeValue,
  freeze: freeze,
  setStage: setStage,
  nextPosition: nextPosition,
  move: move,
  addPeople: addPeople,
  create: create,
  close: close,
  reopen: reopen,
  stageDays: stageDays,
};
