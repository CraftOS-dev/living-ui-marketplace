/// <reference path="../pb_data/types.d.ts" />
/**
 * The record operations shared by people, companies and deals (the route
 * files stay thin): list, get, create, upsert, update, delete, restore,
 * merge and bulk actions. Every change runs in one transaction and is
 * logged with its undo (lib_activity.run); the AI agent's changes follow
 * the policy (lib_setup) and may come back as proposals.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function R() {
  return require(`${__hooks}/lib_records.js`);
}

const ONE = { people: 'person', companies: 'company', deals: 'deal' };

/** Field values present in params (built-in and custom.<key>). */
function valuesOf(app, object, p) {
  const u = U();
  const defs = R().fieldMap(app, object);
  const out = {};
  for (const k of Object.keys(defs)) {
    // --source is where a fact came from (provenance); the lead source field is --lead_source.
    if (k === 'source') {
      if (u.has(p, 'lead_source')) out.source = p.lead_source;
      continue;
    }
    if (!u.has(p, k)) continue;
    const t = defs[k].type;
    out[k] = t === 'emails' || t === 'phones' || t === 'domains' || t === 'tags' || t === 'custom_multi_select' ? u.list(p, k, true) : p[k];
  }
  // Short forms: email, phone, domain, name (people).
  if (object === 'people') {
    if (u.has(p, 'email') && out.emails === undefined) out.emails = u.list(p, 'email', true);
    if (u.has(p, 'phone') && out.phones === undefined) out.phones = u.list(p, 'phone', true);
    if (u.has(p, 'name') && out.first_name === undefined && out.last_name === undefined) {
      const parts = require(`${__hooks}/lib_norm.js`).splitName(u.str(p, 'name', ''));
      out.first_name = parts[0];
      out.last_name = parts[1];
    }
  }
  if (object === 'companies' && u.has(p, 'domain') && out.domains === undefined) out.domains = u.list(p, 'domain', true);
  if (u.has(p, 'values')) Object.assign(out, u.obj(p, 'values') || {});
  return out;
}

function listOpts(p) {
  const u = U();
  return {
    q: u.str(p, 'q', ''),
    preset: u.str(p, 'preset', ''),
    list: u.str(p, 'list', ''),
    filters: u.has(p, 'filters') ? u.list(p, 'filters') : [],
    match: u.oneOf(p, 'match', ['all', 'any'], 'all'),
    sort: u.str(p, 'sort', ''),
    dir: u.oneOf(p, 'dir', ['asc', 'desc'], ''),
    limit: u.int(p, 'limit', 500, 1, 5000),
    offset: u.int(p, 'offset', 0, 0, 1000000),
    pipeline: u.str(p, 'pipeline', ''),
    status: u.oneOf(p, 'status', ['open', 'won', 'lost'], ''),
    company: u.str(p, 'company', ''),
    deleted: u.bool(p, 'deleted', false),
  };
}

function list(app, object, p) {
  const u = U();
  const o = listOpts(p);
  // A saved view brings its own filters and sort.
  if (u.str(p, 'view', '') !== '') {
    const v = u.byId(app, 'views', u.str(p, 'view', ''));
    if (!v) throw u.fail(404, 'No view ' + u.str(p, 'view', ''));
    o.filters = (u.json(v, 'filters', []) || []).concat(o.filters);
    o.match = v.getString('match') || o.match;
    if (!o.sort) o.sort = v.getString('sort');
    if (!o.dir) o.dir = v.getString('dir');
    if (!o.pipeline) o.pipeline = v.getString('pipeline');
  }
  if (object === 'deals' && o.pipeline) o.pipeline = require(`${__hooks}/lib_deals.js`).pipelineByRef(app, o.pipeline).id;
  const res = require(`${__hooks}/lib_query.js`).list(app, object, o);
  const out = { total: res.total };
  out[object] = res.rows;
  return out;
}

/** A record with what its page shows next to its fields. */
function get(app, object, ref) {
  const u = U();
  const recs = R();
  const q = require(`${__hooks}/lib_query.js`);
  const deals = require(`${__hooks}/lib_deals.js`);
  const rec = recs.resolve(app, object, ref, { deleted: true });
  const row = q.one(app, object, rec);
  const out = { record: row };
  const proposals = require(`${__hooks}/lib_review.js`).list(app, { status: 'pending', target: rec.id });
  out.proposals = proposals;
  const lists = (field) =>
    app.findRecordsByFilter('list_entries', field + ' = {:id}', '', 0, 0, { id: rec.id }).map((e) => {
      const l = u.byId(app, 'lists', e.getString('list'));
      return l ? { id: l.id, name: l.getString('name'), color: l.getString('color') } : null;
    }).filter((x) => x !== null);
  const smallDeal = (d) => ({ id: d.id, name: d.name, stage_name: d.stage_name, stage_color: d.stage_color, stage_kind: d.stage_kind, status: d.status, value: d.value, currency: d.currency, home_value: d.home_value, pipeline_name: d.pipeline_name, expected_close: d.expected_close, closed_at: d.closed_at, rotting: d.rotting });
  if (object === 'people') {
    out.employments = app.findRecordsByFilter('employments', 'person = {:id}', '-current,-start', 0, 0, { id: rec.id }).map((e) => {
      const c = u.byId(app, 'companies', e.getString('company'));
      return { id: e.id, company: c ? { id: c.id, name: c.getString('name'), deleted: c.getString('deleted') !== '' } : null, title: e.getString('title'), start: e.getString('start'), end: e.getString('end'), current: e.getBool('current') };
    });
    const ctx = q.ctxDeals(app);
    out.deals = app.findRecordsByFilter('deal_people', 'person = {:id}', '', 0, 0, { id: rec.id })
      .map((dp) => {
        const d = u.byId(app, 'deals', dp.getString('deal'));
        return d && d.getString('deleted') === '' ? Object.assign(smallDeal(q.deal(d, ctx)), { role: dp.getString('role') }) : null;
      })
      .filter((x) => x !== null);
    out.lists = lists('person');
  } else if (object === 'companies') {
    const pctx = q.ctxPeople(app);
    out.people = app.findRecordsByFilter('people', "company = {:id} && deleted = ''", '-strength', 0, 0, { id: rec.id }).map((p) => q.person(p, pctx));
    out.alumni = app
      .findRecordsByFilter('employments', 'company = {:id} && current = false', '-end', 50, 0, { id: rec.id })
      .map((e) => {
        const p = u.byId(app, 'people', e.getString('person'));
        return p && p.getString('deleted') === '' ? { id: p.id, name: recs.personName(p), title: e.getString('title'), end: e.getString('end') } : null;
      })
      .filter((x) => x !== null);
    const ctx = q.ctxDeals(app);
    out.deals = app.findRecordsByFilter('deals', "company = {:id} && deleted = ''", '-created', 0, 0, { id: rec.id }).map((d) => smallDeal(q.deal(d, ctx)));
    out.lists = lists('company');
  } else {
    const st = deals.stagesOf(app, rec.getString('pipeline'));
    const spent = deals.stageDays(app, rec);
    out.stages = st.map((s) => Object.assign(deals.serializeStage(s), { days: Math.round((spent[s.id] || 0) * 10) / 10 }));
    const pctx = q.ctxPeople(app);
    out.people = app.findRecordsByFilter('deal_people', 'deal = {:id}', 'created', 0, 0, { id: rec.id })
      .map((dp) => {
        const p = u.byId(app, 'people', dp.getString('person'));
        return p && p.getString('deleted') === '' ? Object.assign(q.person(p, pctx), { role: dp.getString('role') }) : null;
      })
      .filter((x) => x !== null);
    const c = rec.getString('company') ? u.byId(app, 'companies', rec.getString('company')) : null;
    out.company = c && c.getString('deleted') === '' ? q.company(c, q.ctxCompanies(app)) : null;
  }
  const work = require(`${__hooks}/lib_work.js`);
  const field = ONE[object];
  out.tasks = app.findRecordsByFilter('tasks', field + " = {:id} && done_at = ''", 'due', 0, 0, { id: rec.id }).map((t) => work.serializeTask(app, t));
  out.pinned = app.findRecordsByFilter('notes', field + ' = {:id} && pinned = true', '-created', 0, 0, { id: rec.id }).map((n) => work.serializeNote(app, n));
  out.counts = {
    notes: app.countRecords('notes', $dbx.hashExp({ [field]: rec.id })),
    tasks: app.countRecords('tasks', $dbx.hashExp({ [field]: rec.id })),
    emails: object === 'companies' ? 0 : app.countRecords('emails', $dbx.hashExp({ [field]: rec.id })),
  };
  return out;
}

/** Run a change as one logged unit and hand the agent work queued by it. */
function run(app, who, op, fn) {
  return require(`${__hooks}/lib_activity.js`).run(app, who, op, fn);
}

function create(app, e, object, p) {
  const u = U();
  const recs = R();
  const q = require(`${__hooks}/lib_query.js`);
  const who = u.actor(e);
  const meta = require(`${__hooks}/lib_review.js`).metaOf(p);
  const out = run(app, who, object + '.create', (t) => {
    let rec;
    if (object === 'deals') rec = require(`${__hooks}/lib_deals.js`).create(t, who, p, meta);
    else {
      const v = valuesOf(t, object, p);
      rec = object === 'people' ? recs.createPerson(t, who, v, meta, { auto_company: u.bool(p, 'auto_company', true) }) : recs.createCompany(t, who, v, meta);
    }
    if (u.str(p, 'list', '') !== '' && object !== 'deals') addToList(t, u.str(p, 'list', ''), [rec.id]);
    if (u.str(p, 'note', '') !== '') require(`${__hooks}/lib_work.js`).createNote(t, who, { [ONE[object]]: rec.id, body: u.text(p, 'note', '') });
    return { summary: 'Added ' + recs.nameOf(object, rec), type: object, id: rec.id, result: rec.id };
  });
  maybeResearch(app, who, object, [out]);
  const r = { created: true };
  r[ONE[object]] = q.one(app, object, recs.resolve(app, object, out));
  return r;
}

/** New people and companies the person adds go to research when auto research is on. */
function maybeResearch(app, who, object, ids) {
  if (who.actor === 'agent' || object === 'deals' || ids.length === 0) return;
  const setup = require(`${__hooks}/lib_setup.js`);
  if (!setup.policy(setup.row(app)).auto_research) return;
  const agent = require(`${__hooks}/lib_agent.js`);
  const n = agent.queueResearch(app, object, ids, '');
  if (n > 0) agent.nudge(app, 'research');
}

/** Add or update by natural key: people by email, companies by domain (or name). */
function upsert(app, e, object, p) {
  const u = U();
  const recs = R();
  const q = require(`${__hooks}/lib_query.js`);
  const norm = require(`${__hooks}/lib_norm.js`);
  const who = u.actor(e);
  const meta = require(`${__hooks}/lib_review.js`).metaOf(p);
  const v = valuesOf(app, object, p);
  let found = null;
  const cands = {};
  if (object === 'people') {
    let keys = 0;
    for (const em of recs.listOf(v.emails)) {
      const n = norm.email(em);
      if (!norm.validEmail(n)) continue;
      keys++;
      const o = recs.emailOwner(app, n, '');
      if (o) cands[o.id] = o;
    }
    if (keys === 0) throw u.fail(400, 'people.upsert needs an --email to match on');
  } else {
    for (const d of recs.listOf(v.domains)) {
      const n = norm.domain(d);
      if (n === '') continue;
      const o = recs.domainOwner(app, n, '');
      if (o) cands[o.id] = o;
    }
    if (Object.keys(cands).length === 0 && v.name) {
      const key = norm.companyKey(v.name);
      for (const c of app.findRecordsByFilter('companies', "deleted = ''", '', 0, 0)) if (norm.companyKey(c.getString('name')) === key) cands[c.id] = c;
    }
  }
  const ids = Object.keys(cands);
  if (ids.length > 1) throw Object.assign(u.fail(409, 'Several ' + object + ' match; pass the id of the right one to ' + object + '.update'), { extra: { candidates: ids.map((id) => ({ id: id, name: recs.nameOf(object, cands[id]), deleted: cands[id].getString('deleted') !== '' })) } });
  if (ids.length === 1) found = cands[ids[0]];
  if (found && found.getString('deleted') !== '') throw Object.assign(u.fail(409, recs.nameOf(object, found) + ' is in the trash; restore it first'), { extra: { candidates: [{ id: found.id, name: recs.nameOf(object, found), deleted: true }] } });
  if (!found) return create(app, e, object, p);
  // Lists add to what is there (an upsert never drops an email).
  for (const k of ['emails', 'phones', 'domains', 'tags']) if (v[k] !== undefined) v[k] = (u.json(found, k, []) || []).concat(recs.listOf(v[k]));
  let res = null;
  run(app, who, object + '.update', (t) => {
    const rec = recs.resolve(t, object, found.id);
    res = recs.update(t, who, object, rec, v, meta);
    return { summary: res.changes.length > 0 ? 'Updated ' + recs.nameOf(object, rec) + ': ' + res.changes.map((c) => c.label.toLowerCase()).join(', ') : res.proposal ? 'Proposed changes to ' + recs.nameOf(object, rec) : '', type: object, id: rec.id, changes: res.changes.map((c) => ({ field: c.label, before: c.from, after: c.to })) };
  });
  const out = { created: false, changes: res.changes, proposed: !!res.proposal, proposal: res.proposal ? require(`${__hooks}/lib_review.js`).serialize(app, res.proposal) : null };
  out[ONE[object]] = q.one(app, object, recs.resolve(app, object, found.id));
  return out;
}

function update(app, e, object, p) {
  const u = U();
  const recs = R();
  const q = require(`${__hooks}/lib_query.js`);
  const who = u.actor(e);
  const meta = require(`${__hooks}/lib_review.js`).metaOf(p);
  const ref = u.str(p, 'id', '') || u.str(p, ONE[object], '');
  const target = recs.resolve(app, object, ref);
  const v = valuesOf(app, object, p);
  if (Object.keys(v).length === 0) throw u.fail(400, 'Nothing to change; pass the fields to set (see app.guide fields)');
  let res = null;
  run(app, who, object + '.update', (t) => {
    const rec = recs.resolve(t, object, target.id);
    res = recs.update(t, who, object, rec, v, meta);
    return { summary: res.changes.length > 0 ? 'Changed ' + res.changes.map((c) => c.label.toLowerCase()).join(', ') + ' of ' + recs.nameOf(object, rec) : '', type: object, id: rec.id, changes: res.changes.map((c) => ({ field: c.label, before: c.from, after: c.to })), merge: true };
  });
  const out = { changes: res.changes, proposed: !!res.proposal, proposal: res.proposal ? require(`${__hooks}/lib_review.js`).serialize(app, res.proposal) : null };
  out[ONE[object]] = q.one(app, object, recs.resolve(app, object, target.id));
  return out;
}

function remove(app, e, object, p) {
  const u = U();
  const recs = R();
  const setup = require(`${__hooks}/lib_setup.js`);
  const who = u.actor(e);
  const meta = require(`${__hooks}/lib_review.js`).metaOf(p);
  const rec = recs.resolve(app, object, u.str(p, 'id', '') || u.str(p, ONE[object], ''));
  if (setup.mustPropose(app, who, 'delete')) {
    let prop = null;
    app.runInTransaction((tx) => {
      prop = require(`${__hooks}/lib_review.js`).create(tx, who, { kind: 'delete', object: object, target: rec.id, title: 'Delete ' + recs.nameOf(object, rec), changes: [], payload: { op: 'records.delete', object: object, id: rec.id }, meta: meta });
    });
    return { deleted: false, proposed: true, proposal: require(`${__hooks}/lib_review.js`).serialize(app, prop) };
  }
  run(app, who, object + '.delete', (t) => {
    const r = recs.resolve(t, object, rec.id);
    recs.softDelete(t, object, r);
    return { summary: 'Moved ' + recs.nameOf(object, r) + ' to the trash', type: object, id: r.id };
  });
  return { deleted: true, proposed: false };
}

function restore(app, e, object, p) {
  const u = U();
  const recs = R();
  const who = u.actor(e);
  const rec = recs.resolve(app, object, u.str(p, 'id', '') || u.str(p, ONE[object], ''), { deleted: true });
  if (rec.getString('deleted') === '') throw u.fail(409, recs.nameOf(object, rec) + ' is not in the trash');
  run(app, who, object + '.restore', (t) => {
    const r = recs.resolve(t, object, rec.id, { deleted: true });
    recs.restore(t, object, r);
    return { summary: 'Restored ' + recs.nameOf(object, r), type: object, id: r.id };
  });
  const out = { restored: true };
  out[ONE[object]] = require(`${__hooks}/lib_query.js`).one(app, object, recs.resolve(app, object, rec.id));
  return out;
}

function merge(app, e, object, p) {
  const u = U();
  const recs = R();
  const setup = require(`${__hooks}/lib_setup.js`);
  const who = u.actor(e);
  const meta = require(`${__hooks}/lib_review.js`).metaOf(p);
  const a = recs.resolve(app, object, u.req(p, 'primary'));
  const b = recs.resolve(app, object, u.req(p, 'secondary'));
  if (a.id === b.id) throw u.fail(400, 'Pick two different records to merge');
  if (setup.mustPropose(app, who, 'merge')) {
    let prop = null;
    app.runInTransaction((tx) => {
      prop = require(`${__hooks}/lib_review.js`).create(tx, who, { kind: 'merge', object: object, target: a.id, title: 'Merge ' + recs.nameOf(object, b) + ' into ' + recs.nameOf(object, a), changes: [{ field: 'merge', label: 'Merge', from: recs.nameOf(object, b), to: recs.nameOf(object, a) }], payload: { op: 'records.merge', object: object, primary: a.id, secondary: b.id }, meta: meta });
    });
    return { merged: false, proposed: true, proposal: require(`${__hooks}/lib_review.js`).serialize(app, prop) };
  }
  let res = null;
  run(app, who, object + '.merge', (t) => {
    const pa = recs.resolve(t, object, a.id);
    const pb = recs.resolve(t, object, b.id);
    res = recs.merge(t, object, pa, pb);
    return { summary: 'Merged ' + recs.nameOf(object, pb) + ' into ' + recs.nameOf(object, pa), type: object, id: pa.id };
  });
  const out = { merged: true, proposed: false, filled: res.filled };
  out[ONE[object]] = require(`${__hooks}/lib_query.js`).one(app, object, recs.resolve(app, object, a.id));
  return out;
}

function addToList(app, listRef, ids) {
  const u = U();
  const l = u.byId(app, 'lists', listRef) || u.findOne(app, 'lists', 'name = {:n}', { n: listRef });
  if (!l) throw u.fail(404, 'No list ' + listRef + '; see lists.list');
  const f = l.getString('object') === 'companies' ? 'company' : 'person';
  let n = 0;
  for (const id of ids) {
    if (u.findOne(app, 'list_entries', 'list = {:l} && ' + f + ' = {:r}', { l: l.id, r: id })) continue;
    const r = new Record(app.findCollectionByNameOrId('list_entries'));
    r.set('list', l.id);
    r.set(f, id);
    app.save(r);
    n++;
  }
  return { list: l, added: n };
}

/**
 * Bulk actions on many records: tag, untag, add_to_list, remove_from_list,
 * set (field + value), delete, research. One logged change.
 */
function bulk(app, e, object, p) {
  const u = U();
  const recs = R();
  const setup = require(`${__hooks}/lib_setup.js`);
  const who = u.actor(e);
  const meta = require(`${__hooks}/lib_review.js`).metaOf(p);
  const action = u.oneOf(p, 'action', ['tag', 'untag', 'add_to_list', 'remove_from_list', 'set', 'delete', 'research'], '');
  if (action === '') throw u.fail(400, 'action is one of: tag, untag, add_to_list, remove_from_list, set, delete, research');
  const ids = (u.list(p, 'ids', true) || []).map((x) => String(x).trim()).filter((x) => x !== '');
  if (ids.length === 0) throw u.fail(400, 'ids is required');
  if (ids.length > 2000) throw u.fail(400, 'At most 2,000 at a time');
  const targets = ids.map((id) => recs.resolve(app, object, id));
  if (action === 'research') {
    if (object === 'deals') throw u.fail(400, 'Research is for people and companies');
    let n = 0;
    app.runInTransaction((tx) => {
      n = require(`${__hooks}/lib_agent.js`).queueResearch(tx, object, targets.map((r) => r.id), u.text(p, 'note', ''));
    });
    const fired = require(`${__hooks}/lib_agent.js`).nudge(app, 'research');
    return { queued: n, asked: fired.fired === true || fired.reason === 'already asked' };
  }
  if (action === 'delete' && setup.mustPropose(app, who, 'delete')) {
    const props = [];
    app.runInTransaction((tx) => {
      for (const r of targets) props.push(require(`${__hooks}/lib_review.js`).create(tx, who, { kind: 'delete', object: object, target: r.id, title: 'Delete ' + recs.nameOf(object, r), changes: [], payload: { op: 'records.delete', object: object, id: r.id }, meta: meta }).id);
    });
    return { proposed: props.length, proposals: props };
  }
  const tag = u.str(p, 'tag', '');
  const listRef = u.str(p, 'list', '');
  let proposed = 0;
  const done = run(app, who, object + '.bulk', (t) => {
    let n = 0;
    if (action === 'add_to_list') n = addToList(t, listRef, targets.map((r) => r.id)).added;
    for (const r0 of targets) {
      const r = recs.resolve(t, object, r0.id);
      if (action === 'tag' || action === 'untag') {
        if (tag === '') throw u.fail(400, 'tag is required');
        const cur = u.json(r, 'tags', []) || [];
        const next = action === 'tag' ? cur.concat([tag]) : cur.filter((x) => x.toLowerCase() !== tag.toLowerCase());
        const res = recs.update(t, who, object, r, { tags: next }, meta);
        if (res.changes.length > 0) n++;
        if (res.proposal) proposed++;
      } else if (action === 'remove_from_list') {
        const f = object === 'companies' ? 'company' : 'person';
        for (const le of t.findRecordsByFilter('list_entries', 'list = {:l} && ' + f + ' = {:r}', '', 0, 0, { l: listRef, r: r.id })) {
          t.delete(le);
          n++;
        }
      } else if (action === 'set') {
        const field = u.req(p, 'field');
        const vals = {};
        vals[field] = u.has(p, 'value') ? p.value : '';
        const res = recs.update(t, who, object, r, vals, meta);
        if (res.changes.length > 0) n++;
        if (res.proposal) proposed++;
      } else if (action === 'delete') {
        recs.softDelete(t, object, r);
        n++;
      }
    }
    const label = { tag: 'Tagged', untag: 'Untagged', add_to_list: 'Added to the list', remove_from_list: 'Removed from the list', set: 'Changed', delete: 'Moved to the trash' }[action];
    return { summary: n > 0 ? label + ' ' + n + ' ' + (n === 1 ? ONE[object] : object) + (action === 'tag' || action === 'untag' ? ' (' + tag + ')' : '') : '', type: object, result: n };
  });
  return { changed: done, proposed: proposed };
}

module.exports = { ONE: ONE, valuesOf: valuesOf, list: list, get: get, create: create, upsert: upsert, update: update, remove: remove, restore: restore, merge: merge, bulk: bulk, addToList: addToList, maybeResearch: maybeResearch };
