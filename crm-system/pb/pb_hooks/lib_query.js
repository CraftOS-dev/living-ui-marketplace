/// <reference path="../pb_data/types.d.ts" />
/**
 * Rows for tables and boards, and the filter grammar the UI and the AI agent
 * share.
 *
 * A filter is a list of conditions {field, op, value} joined by match
 * 'all' or 'any'. Ops: is, is_not, contains, not_contains, starts_with,
 * empty, not_empty, gt, gte, lt, lte, before, after, within_days,
 * older_than_days, in, has_tag. Fields are a row's fields (company,
 * strength, last_interaction, next_touch, open_deals, stage, status,
 * value, ...), `in_list` (a list id) and custom fields as custom.<key>.
 * Dates compare as YYYY-MM-DD; within_days / older_than_days look back
 * from today (and forward for next_touch, expected_close and birthdays).
 *
 * Presets (the sidebars' built-in views):
 *   people:    keep_in_touch, recent, strong, cold, no_company, birthdays
 *   companies: recent, with_deals, cold
 *   deals:     open, won, lost, rotting, no_next_step, closing
 */

const OPS = ['is', 'is_not', 'contains', 'not_contains', 'starts_with', 'empty', 'not_empty', 'gt', 'gte', 'lt', 'lte', 'before', 'after', 'within_days', 'older_than_days', 'in', 'has_tag'];

function U() {
  return require(`${__hooks}/lib_util.js`);
}

/**
 * The modules the serializers need, required once per call: require() costs
 * about 1.6 ms in the hooks runtime, so never inside a per-row loop.
 */
function mods() {
  const dates = require(`${__hooks}/lib_dates.js`);
  return {
    u: require(`${__hooks}/lib_util.js`),
    recs: require(`${__hooks}/lib_records.js`),
    deals: require(`${__hooks}/lib_deals.js`),
    dates: dates,
    review: require(`${__hooks}/lib_review.js`),
    fx: require(`${__hooks}/lib_fx.js`),
    today: dates.today(),
  };
}

function daysSince(iso) {
  const t = Date.parse(String(iso || '').replace(' ', 'T'));
  if (!isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/* ------------------------------------------------------------- contexts */

function companyNames(app) {
  const out = {};
  for (const c of app.findRecordsByFilter('companies', "deleted = ''", '', 0, 0)) out[c.id] = c.getString('name');
  return out;
}

function listMembership(app, field) {
  const out = {};
  for (const e of app.findRecordsByFilter('list_entries', field + " != ''", '', 0, 0)) {
    const k = e.getString(field);
    (out[k] = out[k] || []).push(e.getString('list'));
  }
  return out;
}

function ctxPeople(app, m0) {
  const m = m0 || mods();
  const u = m.u;
  const openDeals = {};
  const openIds = {};
  for (const d of app.findRecordsByFilter('deals', "status = 'open' && deleted = ''", '', 0, 0)) openIds[d.id] = true;
  for (const dp of app.findRecordsByFilter('deal_people', 'id != ""', '', 0, 0)) {
    if (openIds[dp.getString('deal')]) openDeals[dp.getString('person')] = (openDeals[dp.getString('person')] || 0) + 1;
  }
  return { m: m, companies: companyNames(app), lists: listMembership(app, 'person'), openDeals: openDeals, pending: m.review.pendingCounts(app), u: u };
}

function ctxCompanies(app, m0) {
  const m = m0 || mods();
  const fx = m.fx;
  const deals = m.deals;
  const home = fx.home(app);
  const rates = fx.latestMap(app);
  const people = {};
  for (const p of app.findRecordsByFilter('people', "deleted = '' && company != ''", '', 0, 0)) people[p.getString('company')] = (people[p.getString('company')] || 0) + 1;
  const open = {};
  for (const d of app.findRecordsByFilter('deals', "status = 'open' && deleted = '' && company != ''", '', 0, 0)) {
    const k = d.getString('company');
    const x = (open[k] = open[k] || { n: 0, value: 0 });
    x.n++;
    const v = deals.homeValue(d, home, rates);
    if (v !== null) x.value += v;
  }
  return { m: m, people: people, open: open, lists: listMembership(app, 'company'), pending: m.review.pendingCounts(app), home: home };
}

function ctxDeals(app, m0) {
  const m = m0 || mods();
  const fx = m.fx;
  const u = m.u;
  const stages = {};
  for (const s of app.findRecordsByFilter('stages', 'id != ""', '', 0, 0)) stages[s.id] = s;
  const pipes = {};
  for (const p of app.findRecordsByFilter('pipelines', 'id != ""', '', 0, 0)) pipes[p.id] = p.getString('name');
  const people = {};
  const personNames = {};
  for (const p of app.findRecordsByFilter('people', "deleted = ''", '', 0, 0)) personNames[p.id] = m.recs.personName(p);
  for (const dp of app.findRecordsByFilter('deal_people', 'id != ""', 'created', 0, 0)) {
    const pid = dp.getString('person');
    if (personNames[pid] === undefined) continue;
    (people[dp.getString('deal')] = people[dp.getString('deal')] || []).push({ id: pid, name: personNames[pid], role: dp.getString('role') });
  }
  // The next open task per deal (for the board's next-activity icon).
  const next = {};
  for (const t of app.findRecordsByFilter('tasks', "done_at = '' && deal != ''", 'due', 0, 0)) {
    const d = t.getString('deal');
    if (next[d] === undefined || (t.getString('due') !== '' && (next[d].due === '' || t.getString('due') < next[d].due))) next[d] = { id: t.id, title: t.getString('title'), due: t.getString('due') };
  }
  return { m: m, stages: stages, pipes: pipes, people: people, next: next, companies: companyNames(app), home: fx.home(app), rates: fx.latestMap(app), pending: m.review.pendingCounts(app), u: u };
}

/* ------------------------------------------------------------ serializers */

function base(rec, u) {
  return {
    id: rec.id,
    tags: u.json(rec, 'tags', []) || [],
    custom: u.json(rec, 'custom', {}) || {},
    prov: u.json(rec, 'prov', {}) || {},
    deleted: rec.getString('deleted'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
}

function person(rec, ctx) {
  const u = ctx.m.u;
  const recs = ctx.m.recs;
  const cid = rec.getString('company');
  return Object.assign(base(rec, u), {
    name: recs.personName(rec),
    first_name: rec.getString('first_name'),
    last_name: rec.getString('last_name'),
    emails: u.json(rec, 'emails', []) || [],
    email: rec.getString('primary_email'),
    phones: u.json(rec, 'phones', []) || [],
    title: rec.getString('title'),
    company: cid && ctx.companies[cid] !== undefined ? cid : '',
    company_name: (cid && ctx.companies[cid]) || '',
    linkedin: rec.getString('linkedin'),
    location: rec.getString('location'),
    birthday: rec.getString('birthday'),
    how_met: rec.getString('how_met'),
    source: rec.getString('source'),
    keep_in_touch: rec.getInt('keep_in_touch'),
    last_interaction: rec.getString('last_interaction'),
    next_touch: rec.getString('next_touch'),
    strength: rec.getInt('strength'),
    touches: rec.getInt('touches'),
    open_deals: ctx.openDeals[rec.id] || 0,
    lists: ctx.lists[rec.id] || [],
    pending: ctx.pending[rec.id] || 0,
    agent_state: rec.getString('agent_state'),
    agent_note: rec.getString('agent_note'),
  });
}

function company(rec, ctx) {
  const u = ctx.m.u;
  const o = ctx.open[rec.id] || { n: 0, value: 0 };
  return Object.assign(base(rec, u), {
    name: rec.getString('name'),
    domains: u.json(rec, 'domains', []) || [],
    domain: rec.getString('primary_domain'),
    industry: rec.getString('industry'),
    size: rec.getString('size'),
    location: rec.getString('location'),
    description: rec.getString('description'),
    linkedin: rec.getString('linkedin'),
    source: rec.getString('source'),
    last_interaction: rec.getString('last_interaction'),
    strength: rec.getInt('strength'),
    people: ctx.people[rec.id] || 0,
    open_deals: o.n,
    pipeline_value: o.value,
    lists: ctx.lists[rec.id] || [],
    pending: ctx.pending[rec.id] || 0,
    agent_state: rec.getString('agent_state'),
    agent_note: rec.getString('agent_note'),
  });
}

function deal(rec, ctx) {
  const deals = ctx.m.deals;
  const st = ctx.stages[rec.getString('stage')];
  const prob = deals.probability(rec, st);
  const hv = deals.homeValue(rec, ctx.home, ctx.rates);
  const status = rec.getString('status') || 'open';
  const inStage = daysSince(rec.getString('stage_entered'));
  const idle = daysSince(rec.getString('last_activity') > rec.getString('stage_entered') ? rec.getString('last_activity') : rec.getString('stage_entered'));
  const rot = st ? st.getInt('rot_days') : 0;
  const target = st ? st.getInt('target_days') : 0;
  const next = ctx.next[rec.id] || null;
  const t = ctx.m.today;
  let nextState = 'none';
  if (next) nextState = next.due === '' ? 'future' : next.due < t ? 'overdue' : next.due === t ? 'today' : 'future';
  const cid = rec.getString('company');
  return Object.assign(base(rec, ctx.m.u), {
    name: rec.getString('name'),
    pipeline: rec.getString('pipeline'),
    pipeline_name: ctx.pipes[rec.getString('pipeline')] || '',
    stage: rec.getString('stage'),
    stage_name: st ? st.getString('name') : '',
    stage_kind: st ? st.getString('kind') : 'open',
    stage_color: st ? st.getString('color') : '',
    status: status,
    value: rec.getFloat('value'),
    currency: rec.getString('currency') || ctx.home,
    home_value: hv,
    weighted: hv === null ? null : status === 'won' ? hv : status === 'lost' ? 0 : Math.round((hv * prob) / 100),
    probability: prob,
    prob_override: rec.getFloat('prob_override'),
    expected_close: rec.getString('expected_close'),
    closed_at: rec.getString('closed_at'),
    lost_reason: rec.getString('lost_reason'),
    company: cid && ctx.companies[cid] !== undefined ? cid : '',
    company_name: (cid && ctx.companies[cid]) || '',
    people: ctx.people[rec.id] || [],
    source: rec.getString('source'),
    next_step: rec.getString('next_step'),
    next_step_date: rec.getString('next_step_date'),
    stage_entered: rec.getString('stage_entered'),
    days_in_stage: inStage === null ? 0 : inStage,
    last_activity: rec.getString('last_activity'),
    idle_days: idle === null ? 0 : idle,
    rotting: status === 'open' && rot > 0 && idle !== null && idle > rot,
    over_target: status === 'open' && target > 0 && inStage !== null && inStage > target,
    rot_days: rot,
    target_days: target,
    next_task: next,
    next_state: status === 'open' ? (rec.getString('next_step_date') !== '' && nextState === 'none' ? (rec.getString('next_step_date') < t ? 'overdue' : rec.getString('next_step_date') === t ? 'today' : 'future') : nextState) : '',
    position: rec.getFloat('position'),
    pending: ctx.pending[rec.id] || 0,
  });
}

/* -------------------------------------------------------------- filtering */

function fieldValue(row, field) {
  if (field.indexOf('custom.') === 0) {
    const v = row.custom ? row.custom[field.slice(7)] : undefined;
    return v === undefined ? null : v;
  }
  if (field === 'company') return row.company_name !== undefined ? row.company_name : row.company;
  if (field === 'stage') return row.stage_name;
  if (field === 'pipeline') return row.pipeline_name;
  if (field === 'email') return (row.emails || []).join(' ');
  if (field === 'person' || field === 'people') return (row.people && Array.isArray(row.people) ? row.people.map((p) => p.name).join(' ') : '') || '';
  const v = row[field];
  return v === undefined ? null : v;
}

function isBlank(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function asDate(v) {
  return String(v || '').slice(0, 10);
}

/** Days until a birthday (MM-DD or YYYY-MM-DD) from today. */
function birthdayIn(b) {
  const s = String(b || '');
  const md = s.length === 10 ? s.slice(5) : s;
  if (!/^\d{2}-\d{2}$/.test(md)) return null;
  const now = new Date();
  const y = now.getUTCFullYear();
  let next = Date.UTC(y, Number(md.slice(0, 2)) - 1, Number(md.slice(3, 5)));
  const t0 = Date.UTC(y, now.getUTCMonth(), now.getUTCDate());
  if (next < t0) next = Date.UTC(y + 1, Number(md.slice(0, 2)) - 1, Number(md.slice(3, 5)));
  return Math.round((next - t0) / 86400000);
}

const FORWARD = { next_touch: true, expected_close: true, next_step_date: true };

function test(row, c, env) {
  const op = c.op;
  const f = c.field;
  if (f === 'in_list') {
    const has = (row.lists || []).indexOf(String(c.value)) >= 0;
    return op === 'is_not' ? !has : has;
  }
  const v = fieldValue(row, f);
  const want = c.value;
  const str = (x) => (Array.isArray(x) ? x.join(' ') : String(x === null || x === undefined ? '' : x)).toLowerCase();
  switch (op) {
    case 'is':
      return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()).indexOf(str(want)) >= 0 : str(v) === str(want);
    case 'is_not':
      return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()).indexOf(str(want)) < 0 : str(v) !== str(want);
    case 'contains':
      return str(v).indexOf(str(want)) >= 0;
    case 'not_contains':
      return str(v).indexOf(str(want)) < 0;
    case 'starts_with':
      return str(v).indexOf(str(want)) === 0;
    case 'empty':
      return isBlank(v) || v === 0;
    case 'not_empty':
      return !isBlank(v) && v !== 0;
    case 'gt':
      return Number(v) > Number(want);
    case 'gte':
      return Number(v) >= Number(want);
    case 'lt':
      return Number(v) < Number(want);
    case 'lte':
      return Number(v) <= Number(want);
    case 'before':
      return !isBlank(v) && asDate(v) < asDate(want);
    case 'after':
      return !isBlank(v) && asDate(v) > asDate(want);
    case 'within_days': {
      if (isBlank(v)) return false;
      const n = Number(want);
      if (f === 'birthday') {
        const d = birthdayIn(v);
        return d !== null && d <= n;
      }
      const t = env.today;
      if (FORWARD[f]) return asDate(v) >= t && asDate(v) <= env.addDays(t, n);
      return asDate(v) >= env.addDays(t, -n);
    }
    case 'older_than_days': {
      if (isBlank(v)) return true;
      return asDate(v) < env.addDays(env.today, -Number(want));
    }
    case 'in': {
      const list = Array.isArray(want) ? want : String(want).split(',');
      const vals = list.map((x) => String(x).trim().toLowerCase());
      return Array.isArray(v) ? v.some((x) => vals.indexOf(String(x).toLowerCase()) >= 0) : vals.indexOf(str(v)) >= 0;
    }
    case 'has_tag':
      return (row.tags || []).some((t) => t.toLowerCase() === str(want));
    default:
      throw U().fail(400, 'Unknown filter op "' + op + '"; ops: ' + OPS.join(', '));
  }
}

function envOf(m0) {
  const dates = m0 ? m0.dates : require(`${__hooks}/lib_dates.js`);
  return { today: m0 ? m0.today : dates.today(), addDays: dates.addDays };
}

function matches(row, conds, mode, env) {
  if (!conds || conds.length === 0) return true;
  const e = env || envOf(null);
  return mode === 'any' ? conds.some((c) => test(row, c, e)) : conds.every((c) => test(row, c, e));
}

function validate(conds) {
  for (const c of conds || []) {
    if (!c || typeof c !== 'object' || !c.field || !c.op) throw U().fail(400, 'filters is a list of {"field":"..","op":"..","value":".."}');
    if (OPS.indexOf(c.op) < 0) throw U().fail(400, 'Unknown filter op "' + c.op + '"; ops: ' + OPS.join(', '));
  }
}

function preset(object, name, env) {
  const e = env || envOf(null);
  const P = {
    people: {
      keep_in_touch: [{ field: 'keep_in_touch', op: 'gt', value: 0 }, { field: 'next_touch', op: 'not_empty' }, { field: 'next_touch', op: 'before', value: e.addDays(e.today, 1) }],
      recent: [{ field: 'created', op: 'within_days', value: 14 }],
      strong: [{ field: 'strength', op: 'gte', value: 60 }],
      cold: [{ field: 'touches', op: 'gte', value: 3 }, { field: 'last_interaction', op: 'older_than_days', value: 60 }],
      no_company: [{ field: 'company', op: 'empty' }],
      birthdays: [{ field: 'birthday', op: 'within_days', value: 30 }],
    },
    companies: {
      recent: [{ field: 'created', op: 'within_days', value: 14 }],
      with_deals: [{ field: 'open_deals', op: 'gt', value: 0 }],
      cold: [{ field: 'strength', op: 'gt', value: 0 }, { field: 'last_interaction', op: 'older_than_days', value: 60 }],
    },
    deals: {
      open: [{ field: 'status', op: 'is', value: 'open' }],
      won: [{ field: 'status', op: 'is', value: 'won' }],
      lost: [{ field: 'status', op: 'is', value: 'lost' }],
      rotting: [{ field: 'rotting', op: 'is', value: 'true' }],
      no_next_step: [{ field: 'status', op: 'is', value: 'open' }, { field: 'next_state', op: 'is', value: 'none' }],
      closing: [{ field: 'status', op: 'is', value: 'open' }, { field: 'expected_close', op: 'within_days', value: 30 }],
    },
  };
  const o = P[object] || {};
  if (!name || name === 'all') return [];
  if (!o[name]) throw U().fail(400, 'preset for ' + object + ' is one of: all, ' + Object.keys(o).join(', '));
  return o[name];
}

function searchText(object, row) {
  if (object === 'people') return [row.name, row.email, (row.emails || []).join(' '), row.company_name, row.title, row.location, (row.tags || []).join(' ')].join(' ').toLowerCase();
  if (object === 'companies') return [row.name, (row.domains || []).join(' '), row.industry, row.location, (row.tags || []).join(' ')].join(' ').toLowerCase();
  return [row.name, row.company_name, (row.people || []).map((p) => p.name).join(' '), row.stage_name, (row.tags || []).join(' ')].join(' ').toLowerCase();
}

function sortRows(rows, sort, dir) {
  const d = dir === 'desc' ? -1 : 1;
  const key = sort || 'name';
  rows.sort((a, b) => {
    let x = fieldValue(a, key);
    let y = fieldValue(b, key);
    if (key === 'name') {
      x = String(x || '').toLowerCase();
      y = String(y || '').toLowerCase();
    }
    const bx = isBlank(x);
    const by = isBlank(y);
    if (bx && by) return 0;
    if (bx) return 1;
    if (by) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
    return String(x).localeCompare(String(y)) * d;
  });
  return rows;
}

/**
 * List rows. opts: { q, preset, list, filters, match, sort, dir, limit,
 * offset, pipeline, status, deleted (the trash) }.
 */
function list(app, object, opts) {
  const o = opts || {};
  validate(o.filters);
  const recs = require(`${__hooks}/lib_records.js`);
  const c = recs.obj(object).c;
  const parts = [o.deleted ? "deleted != '' && merged_into = ''" : "deleted = ''"];
  const prm = {};
  if (object === 'deals' && o.pipeline) {
    parts.push('pipeline = {:p}');
    prm.p = o.pipeline;
  }
  if (object === 'deals' && o.status) {
    parts.push('status = {:s}');
    prm.s = o.status;
  }
  if (object === 'people' && o.company) {
    parts.push('company = {:c}');
    prm.c = o.company;
  }
  const raw = app.findRecordsByFilter(c, parts.join(' && '), '', 0, 0, prm);
  const m = o.m || mods();
  const env = envOf(m);
  const ctx = object === 'people' ? ctxPeople(app, m) : object === 'companies' ? ctxCompanies(app, m) : ctxDeals(app, m);
  const ser = object === 'people' ? person : object === 'companies' ? company : deal;
  let rows = raw.map((r) => ser(r, ctx));
  if (o.list) rows = rows.filter((r) => (r.lists || []).indexOf(o.list) >= 0);
  const pre = preset(object, o.preset, env);
  if (pre.length > 0) rows = rows.filter((r) => matches(r, pre, 'all', env));
  if (o.filters && o.filters.length > 0) rows = rows.filter((r) => matches(r, o.filters, o.match === 'any' ? 'any' : 'all', env));
  if (o.q) {
    const words = String(o.q).toLowerCase().split(/\s+/).filter((w) => w !== '');
    rows = rows.filter((r) => {
      const t = searchText(object, r);
      return words.every((w) => t.indexOf(w) >= 0);
    });
  }
  const dflt = object === 'deals' ? 'position' : o.preset === 'keep_in_touch' ? 'next_touch' : 'name';
  sortRows(rows, o.sort || dflt, o.dir || (o.sort === 'last_interaction' || o.sort === 'strength' || o.sort === 'created' || o.sort === 'value' ? 'desc' : 'asc'));
  const total = rows.length;
  const off = o.offset || 0;
  const lim = o.limit || 500;
  return { rows: rows.slice(off, off + lim), total: total };
}

/** One record as a row. */
function one(app, object, rec) {
  const ctx = object === 'people' ? ctxPeople(app) : object === 'companies' ? ctxCompanies(app) : ctxDeals(app);
  return object === 'people' ? person(rec, ctx) : object === 'companies' ? company(rec, ctx) : deal(rec, ctx);
}

/** Everything matching q (the palette). */
function search(app, q, limit) {
  const n = limit || 6;
  return {
    people: list(app, 'people', { q: q, limit: n, sort: 'last_interaction', dir: 'desc' }).rows,
    companies: list(app, 'companies', { q: q, limit: n }).rows,
    deals: list(app, 'deals', { q: q, limit: n, sort: 'last_activity', dir: 'desc' }).rows,
  };
}

module.exports = { OPS: OPS, mods: mods, ctxPeople: ctxPeople, ctxCompanies: ctxCompanies, ctxDeals: ctxDeals, person: person, company: company, deal: deal, matches: matches, validate: validate, preset: preset, list: list, one: one, search: search, birthdayIn: birthdayIn, daysSince: daysSince };
