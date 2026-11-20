/// <reference path="../pb_data/types.d.ts" />
/**
 * Deals and pipelines (kernel-records, SPEC 4.5).
 *
 * A deal is one company in one pipeline: its stage (a key of the pipeline's
 * stages JSON, each with stall days), status (open, invested, passed, lost,
 * hold), point partner and deal team (deal_people with team = true), the
 * founders and contacts (deal_people with a person), round terms and check
 * in minor units of the deal's currency, the fund, and the restriction: a
 * restricted deal is visible only to its deal team and the owner; your AI
 * agent sees it only when agent_allowed is on. Every stage move and status
 * change is an append-only stage_events row.
 *
 * Visibility is the kernel's lib_auth.dealVisible (fund scope, then a
 * restricted deal to its team and the owner, your AI agent when
 * agent_allowed) plus this module's rule: a person needs pipeline view
 * rights or a seat on the deal team.
 *
 * Rules for your AI agent (REPORT Table 34): reads within scope; creating an
 * open deal at the pipeline's first stage, filling empty fields
 * (records.enrich) and adding founders and contacts are direct; other
 * updates (kind note_fields: promotable for non-financial fields only),
 * moves (kind stage_moves: promotable, and then only a move to Screen runs
 * directly) and assignment (kind deals) are proposals; restricting and
 * status changes are people only.
 *
 * Exports for other modules (exact signatures):
 *   create(ctx, { company, pipeline?, stage?, source?, source_person?, point?, round?, check_minor?, currency?, instrument?, fund?, name?, restricted?, agent_allowed?, intake_item?, people?, tags?, source_ref? }) -> deal view   (emits deal.created { deal, company, pipeline, stage })
 *   move(ctx, dealId, stageKey, note) -> deal view                  (emits deal.moved { deal, from, to, pipeline }; the deal goes to the end of its new column)
 *   reorder(ctx, dealId, { stage?, before?, index?, note? }) -> { deal, stage, index }   (its place in a board column; moves first when stage differs)
 *   setStatus(ctx, dealId, status, reason) -> deal view             (emits deal.closed { deal, status, reason } for every status but open)
 *   assign(ctx, dealId, memberRef) -> deal view
 *   team(ctx, dealId, { add?: [memberRef], remove?: [memberRef] }) -> deal view
 *   people(ctx, dealId, { add?: [{ person, role }], remove?: [personRef] }) -> deal view
 *   restrict(ctx, dealId, restricted, agentAllowed) -> deal view
 *   visible(ctx, deal) -> boolean            visibleSql(ctx, alias) -> { sql, bind } (the same rule in SQL)
 *   get(ctx, ref) -> deal view (403 restricted when not visible)     ref(app, ref) -> deal record (id, D-0001 or a merged id)
 *   pipelineOf(app, ref) -> pipeline record (spv, lp_raise and program are created on first use)
 *   stagesOf(pipelineRecord) -> [{ key, label, stall_days }]
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function R() {
  return L('lib_records');
}

const STATUSES = ['open', 'invested', 'passed', 'lost', 'hold'];
const SOURCES = ['inbound', 'referral', 'outbound', 'scout', 'event', 'sourced', 'co_investor', 'portfolio', 'other'];
const ROUND_TYPES = ['pre_seed', 'seed', 'seed_extension', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'bridge', 'other'];
const INSTRUMENTS = ['safe_cap', 'safe_discount', 'safe_mfn', 'note', 'priced', 'other'];
const PIPELINE_KINDS = ['deal_flow', 'spv', 'lp_raise', 'program'];
const PEOPLE_ROLES = ['founder', 'contact', 'co_investor', 'advisor', 'referrer'];

// Default stages of the pipelines created on first use (deal_flow is seeded by the migration).
const DEFAULTS = {
  spv: {
    name: 'SPV',
    stages: [
      { key: 'sourced', label: 'Sourced', stall_days: 7 },
      { key: 'allocation', label: 'Allocation', stall_days: 14 },
      { key: 'documents', label: 'Documents', stall_days: 14 },
      { key: 'funding', label: 'Funding', stall_days: 14 },
      { key: 'closed', label: 'Closed', stall_days: 0 },
    ],
  },
  lp_raise: {
    name: 'Fund raise',
    stages: [
      { key: 'target', label: 'Target', stall_days: 14 },
      { key: 'contacted', label: 'Contacted', stall_days: 14 },
      { key: 'meeting', label: 'Meeting', stall_days: 14 },
      { key: 'diligence', label: 'Diligence', stall_days: 21 },
      { key: 'soft_circle', label: 'Soft circle', stall_days: 21 },
      { key: 'committed', label: 'Committed', stall_days: 30 },
      { key: 'closed', label: 'Closed', stall_days: 0 },
    ],
  },
  program: {
    name: 'Program',
    stages: [
      { key: 'applied', label: 'Applied', stall_days: 7 },
      { key: 'screen', label: 'Screen', stall_days: 7 },
      { key: 'interview', label: 'Interview', stall_days: 7 },
      { key: 'selected', label: 'Selected', stall_days: 7 },
      { key: 'enrolled', label: 'Enrolled', stall_days: 0 },
    ],
  },
};

// Fields of a deal that update and fill write (money in major units in, minor units stored).
const DEAL_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', max: 200 },
  { key: 'source', label: 'Source', type: 'select', options: SOURCES },
  { key: 'source_person', label: 'Source person', type: 'person' },
  { key: 'round_type', label: 'Round', type: 'select', options: ROUND_TYPES, round: 'type' },
  { key: 'raise', label: 'Raise', type: 'money', round: 'raise_minor' },
  { key: 'pre_money', label: 'Pre-money', type: 'money', round: 'pre_money_minor' },
  { key: 'post_money', label: 'Post-money', type: 'money', round: 'post_money_minor' },
  { key: 'currency', label: 'Currency', type: 'currency' },
  { key: 'check', label: 'Check', type: 'money', column: 'check_minor' },
  { key: 'instrument', label: 'Instrument', type: 'select', options: INSTRUMENTS },
  { key: 'fund', label: 'Fund', type: 'fund' },
  { key: 'tags', label: 'Tags', type: 'tags' },
];
// The words people see for the choices (the deal page uses the same).
const OPTION_LABELS = {
  source: { inbound: 'Inbound', referral: 'Referral', outbound: 'Outbound', scout: 'Scout', event: 'Event', sourced: 'Sourced', co_investor: 'Co-investor', portfolio: 'Portfolio', other: 'Other' },
  round_type: { pre_seed: 'Pre-seed', seed: 'Seed', seed_extension: 'Seed ext', series_a: 'Series A', series_b: 'Series B', series_c: 'Series C', series_d_plus: 'Series D+', bridge: 'Bridge', other: 'Other' },
  instrument: { safe_cap: 'SAFE (cap)', safe_discount: 'SAFE (discount)', safe_mfn: 'SAFE (MFN)', note: 'Note', priced: 'Priced', other: 'Other' },
};

function nowIso() {
  return new Date().toISOString();
}

/* ---------------------------------------------------------- pipelines */

function stagesOf(pl) {
  return (u().jsonOf(pl, 'stages', []) || []).map((s) => ({ key: String(s.key), label: String(s.label), stall_days: Number(s.stall_days) || 0 }));
}

/** A pipeline by id or key (deal_flow, spv, lp_raise, program); the built-in kinds are created on first use. */
function pipelineOf(app, ref) {
  const util = u();
  const r = String(ref || 'deal_flow').trim() || 'deal_flow';
  const rec = util.byId(app, 'pipelines', r) || util.findOne(app, 'pipelines', 'key = {:k}', { k: r });
  if (rec !== null) return rec;
  if (DEFAULTS[r] === undefined) {
    const keys = util.rows(app, 'SELECT key FROM pipelines WHERE archived = FALSE ORDER BY sort', { key: '' }).map((x) => x.key);
    throw util.fail(404, 'No pipeline "' + r + '". Pipelines: ' + keys.concat(Object.keys(DEFAULTS).filter((k) => keys.indexOf(k) < 0)).join(', ') + '.', 'not_found', { param: 'pipeline' });
  }
  const pl = util.newRecord(app, 'pipelines');
  pl.set('key', r);
  pl.set('name', DEFAULTS[r].name);
  pl.set('kind', r);
  pl.set('stages', DEFAULTS[r].stages);
  pl.set('archived', false);
  pl.set('sort', util.count(app, 'SELECT COUNT(*) AS n FROM pipelines') + 1);
  pl.set('actor', 'system');
  app.save(pl);
  return pl;
}

function stageOf(pl, ref) {
  const util = u();
  const stages = stagesOf(pl);
  const r = String(ref || '').trim();
  const hit = stages.filter((s) => s.key === r)[0] || stages.filter((s) => s.label.toLowerCase() === r.toLowerCase())[0];
  if (hit === undefined) throw util.fail(400, 'stage must be one of: ' + stages.map((s) => s.key).join(', ') + '.', 'invalid_param', { param: 'stage', allowed: stages.map((s) => s.key) });
  return Object.assign({ index: stages.indexOf(hit) }, hit);
}

function pipelineOut(app, pl, counts) {
  const out = { id: pl.id, key: pl.getString('key'), name: pl.getString('name'), kind: pl.getString('kind'), stages: stagesOf(pl), archived: pl.getBool('archived') };
  if (counts) out.open = counts[pl.id] || 0;
  return out;
}

/* --------------------------------------------------------- visibility */

function isTeam(app, dealId, memberId) {
  if (!memberId) return false;
  return u().findOne(app, 'deal_people', 'deal = {:d} && member = {:m} && team = true', { d: dealId, m: memberId }) !== null;
}

/** A SQL condition on deals alias `a` with the same rule as visible(): { sql, bind }. */
function visibleSql(ctx, a) {
  const auth = L('lib_auth');
  if (ctx.actor === 'system') return { sql: '1 = 1', bind: {} };
  if (ctx.isAgent) return { sql: '(' + a + '.restricted = FALSE OR ' + a + '.agent_allowed = TRUE)', bind: {} };
  const bind = { vis_me: ctx.memberId || '-' };
  const team = a + '.id IN (SELECT deal FROM deal_people WHERE member = {:vis_me} AND team = TRUE)';
  const parts = [];
  const sc = auth.scope(ctx);
  if (sc.length > 0) parts.push('(' + a + ".fund = '' OR " + a + '.fund IN (' + sc.map((x, i) => ((bind['vis_f' + i] = x), '{:vis_f' + i + '}')).join(', ') + '))');
  if (!ctx.owner) parts.push('(' + a + '.restricted = FALSE OR ' + team + ')');
  if (!auth.can(ctx, 'pipeline', 'view')) parts.push('(' + team + ')');
  return { sql: parts.length === 0 ? '1 = 1' : '(' + parts.join(' AND ') + ')', bind: bind };
}

/** visible(ctx, deal): the kernel's dealVisible, and for a person pipeline view rights or a seat on the team. */
function visible(ctx, deal) {
  const d = typeof deal === 'string' ? u().byId(ctx.app, 'deals', deal) : deal;
  if (d === null || d === undefined) return false;
  const auth = L('lib_auth');
  if (!auth.dealVisible(ctx, d)) return false;
  if (ctx.isAgent || ctx.actor === 'system') return true;
  return auth.can(ctx, 'pipeline', 'view') || isTeam(ctx.app, d.id, ctx.memberId);
}

/** Throw unless ctx may see the deal. */
function guard(ctx, d) {
  if (visible(ctx, d)) return;
  if (d.getBool('restricted')) throw u().fail(403, ctx.isAgent ? 'This deal is restricted to its deal team; your AI agent may work on it only when the team allows it.' : 'This deal is restricted to its deal team.', 'restricted', { deal: d.getString('number') });
  throw u().fail(403, 'You cannot see this deal.', 'not_permitted', { deal: d.getString('number') });
}

/**
 * A deal record by id, display id (D-0012) or a merged id. A merged deal
 * (soft deleted, with an alias) resolves to the deal it was merged into,
 * through every later merge; any other deleted deal is 404.
 */
function ref(app, r0) {
  const util = u();
  const r = String(r0 || '').trim();
  if (r === '') throw util.fail(400, 'deal is required.', 'missing_param', { param: 'deal' });
  let d = util.byId(app, 'deals', r);
  if (d === null) d = util.findOne(app, 'deals', 'number = {:n}', { n: r.toUpperCase() });
  if (d === null) {
    const al = util.findOne(app, 'aliases', "kind = 'deals' && old_id = {:id}", { id: r });
    if (al !== null) d = util.byId(app, 'deals', al.getString('new_id'));
  }
  for (let i = 0; i < 10 && d !== null && d.getString('deleted_at') !== ''; i++) {
    const al = util.findOne(app, 'aliases', "kind = 'deals' && old_id = {:id}", { id: d.id });
    if (al === null) break;
    d = util.byId(app, 'deals', al.getString('new_id'));
  }
  if (d === null) d = byCompanyName(app, r);
  if (d === null || d.getString('deleted_at') !== '') {
    const refs = L('lib_refs');
    const found = refs.matches(app, 'deals', 'name', r, { number: 'number', where: "deleted_at = ''" });
    if (found.length < 5) {
      // Deals are named by their company: look there too, and answer the deal of each company found.
      for (const c of refs.matches(app, 'companies', 'name', r, { where: "deleted_at = '' AND merged_into = ''" })) {
        const dd = util.findMany(app, 'deals', "company = {:c} && deleted_at = ''", '-created', 2, { c: c.id });
        for (const x of dd) if (found.length < 5 && found.filter((f) => f.id === x.id).length === 0) found.push({ id: x.id, name: c.name, number: x.getString('number') });
      }
    }
    throw refs.notFound('deal', r, found, 'deals.list --q <name>');
  }
  return d;
}

/**
 * A deal by its company (exact name or domain): the company's one open deal,
 * else its only deal; 409 with the candidates when it has several open ones.
 */
function byCompanyName(app, r) {
  const util = u();
  if (/^d-\d+$/i.test(r) || r.length < 2) return null;
  let c = null;
  try {
    c = L('lib_records').resolve(app, 'companies', r);
  } catch (err) {
    if (err && err.status === 409) throw err;
    return null;
  }
  const all = util.findMany(app, 'deals', "company = {:c} && deleted_at = ''", '-created', 20, { c: c.id });
  const open = all.filter((x) => x.getString('status') === 'open' || x.getString('status') === 'hold');
  if (open.length === 1) return open[0];
  if (open.length > 1) throw L('lib_refs').ambiguous('open deals of ' + c.getString('name'), r, open.map((x) => ({ id: x.id, name: x.getString('name') || c.getString('name'), number: x.getString('number'), pipeline: x.getString('pipeline'), stage: x.getString('stage') })), 'Pass the deal number (D-0012).');
  if (all.length === 1) return all[0];
  if (all.length > 1) throw L('lib_refs').ambiguous('deals of ' + c.getString('name'), r, all.map((x) => ({ id: x.id, name: x.getString('name') || c.getString('name'), number: x.getString('number'), status: x.getString('status') })), 'Pass the deal number (D-0012).');
  return null;
}

/* ---------------------------------------------------------------- views */

function roundOf(d) {
  const r = u().jsonOf(d, 'round', {}) || {};
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  return { type: r.type || '', raise_minor: num(r.raise_minor), pre_money_minor: num(r.pre_money_minor), post_money_minor: num(r.post_money_minor) };
}

let _days = null;
function DAYS() {
  if (_days === null) _days = require(`${__hooks}/lib_eng_days.js`);
  return _days;
}

/** The firm's zone (settings), for days in stage. */
function zoneOf(app) {
  return L('lib_settings').row(app).getString('zone') || 'UTC';
}

/** Days in the current stage and the stall (the days engine, calendar days in the firm's zone). */
function stallOf(app, d, stallDays, zone) {
  const at = d.getString('stage_entered_at');
  if (at === '') return { days_in_stage: 0, stalled: false, stalls_on: null };
  return DAYS().stall({ entered_at: at, now: nowIso(), zone: zone || zoneOf(app), stall_days: Math.max(0, Math.min(3650, Number(stallDays) || 0)) });
}

function daysIn(app, d) {
  return Math.max(0, stallOf(app, d, 0).days_in_stage);
}

/** A compact deal for boards and lists. */
function cardOut(app, d, zone) {
  const pl = u().byId(app, 'pipelines', d.getString('pipeline'));
  const stages = pl ? stagesOf(pl) : [];
  const st = stages.filter((s) => s.key === d.getString('stage'))[0] || { key: d.getString('stage'), label: d.getString('stage'), stall_days: 0 };
  const company = R().mini(app, 'companies', d.getString('company'));
  const st0 = stallOf(app, d, st.stall_days, zone);
  const round = roundOf(d);
  const check = d.getInt('check_minor');
  return {
    id: d.id,
    number: d.getString('number'),
    title: d.getString('name') || (company ? company.name : ''),
    company: company,
    pipeline: pl ? pl.getString('key') : '',
    stage: st.key,
    stage_label: st.label,
    stage_index: stages.indexOf(st),
    days_in_stage: Math.max(0, st0.days_in_stage),
    stalled: d.getString('status') === 'open' && st0.stalled === true,
    stalls_on: st0.stalls_on,
    status: d.getString('status'),
    point: R().mini(app, 'members', d.getString('point')),
    round_type: round.type,
    raise_minor: round.raise_minor,
    currency: d.getString('currency'),
    check_minor: check > 0 ? check : null,
    restricted: d.getBool('restricted'),
    last_activity_at: d.getString('last_activity_at'),
  };
}

/* Cards in one query: the board and the lists read every field a card shows
 * with the deal (company and point partner joined), never one read per card. */
const CARD_SELECT =
  "SELECT d.id AS id, d.number AS number, d.name AS name, d.pipeline AS pipeline, d.stage AS stage, d.stage_entered_at AS entered, d.status AS status, d.point AS point, COALESCE(json_extract(d.round, '$.type'), '') AS round_type, COALESCE(json_extract(d.round, '$.raise_minor'), -1) AS raise_minor, d.currency AS currency, d.check_minor AS check_minor, d.restricted AS restricted, d.last_activity_at AS last_activity_at, d.company AS company, COALESCE(c.name, '') AS company_name, COALESCE(c.domain, '') AS company_domain, COALESCE(c.logo, '') AS company_logo, COALESCE(m.name, '') AS point_name FROM deals d LEFT JOIN companies c ON c.id = d.company LEFT JOIN members m ON m.id = d.point";
const CARD_SHAPE = { id: '', number: '', name: '', pipeline: '', stage: '', entered: '', status: '', point: '', round_type: '', raise_minor: 0, currency: '', check_minor: 0, restricted: false, last_activity_at: '', company: '', company_name: '', company_domain: '', company_logo: '', point_name: '' };
const DAY_MS = 86400000;

/** Every pipeline by id: { key, stages, byKey } (read once per call). */
function pipelineMap(app) {
  const out = {};
  for (const pl of app.findRecordsByFilter('pipelines', '1=1', 'sort', 0, 0)) {
    const stages = stagesOf(pl);
    const byKey = {};
    stages.forEach((st, i) => (byKey[st.key] = Object.assign({ index: i }, st)));
    out[pl.id] = { key: pl.getString('key'), stages: stages, byKey: byKey };
  }
  return out;
}

/**
 * Days in stage and the stall, as lib_eng_days.stall answers them (calendar
 * days in the firm's zone; stalled after stall_days; stalls_on the first
 * stalled day), from day numbers: the engine's zone offset of each instant,
 * no text parsing per card.
 */
function stallFast(enteredIso, stallDays, zone, todayNum) {
  if (enteredIso === '') return { days_in_stage: 0, stalled: false, stalls_on: null };
  const ms = Date.parse(enteredIso.replace(' ', 'T'));
  if (!Number.isFinite(ms)) return { days_in_stage: 0, stalled: false, stalls_on: null };
  const enteredNum = Math.floor((ms + DAYS().offsetMinutes(zone, ms) * 60000) / DAY_MS);
  const days = todayNum - enteredNum;
  const sd = Math.max(0, Math.min(3650, Number(stallDays) || 0));
  if (sd === 0) return { days_in_stage: days, stalled: false, stalls_on: null };
  return { days_in_stage: days, stalled: days > sd, stalls_on: new Date((enteredNum + sd + 1) * DAY_MS).toISOString().slice(0, 10) };
}

/** A card from a CARD_SELECT row (the same shape as cardOut). */
function cardOfRow(row, plMap, zone, todayNum, demo) {
  const pl = plMap[row.pipeline];
  const st = (pl && pl.byKey[row.stage]) || { key: row.stage, label: row.stage, stall_days: 0, index: -1 };
  const stall = stallFast(row.entered, st.stall_days, zone, todayNum);
  const raise = row.raise_minor < 0 ? null : row.raise_minor;
  const company = row.company !== '' && row.company_name !== '' ? { id: row.company, name: row.company_name, domain: row.company_domain, logo_url: L('lib_logos').companyUrlOf(row.company, row.company_logo), logo_domain: demo ? '' : row.company_domain } : null;
  return {
    id: row.id,
    number: row.number,
    title: row.name || (company ? company.name : ''),
    company: company,
    pipeline: pl ? pl.key : '',
    stage: st.key,
    stage_label: st.label,
    stage_index: st.index,
    days_in_stage: Math.max(0, stall.days_in_stage),
    stalled: row.status === 'open' && stall.stalled === true,
    stalls_on: stall.stalls_on,
    status: row.status,
    point: row.point !== '' && row.point_name !== '' ? { id: row.point, name: row.point_name } : null,
    round_type: row.round_type,
    raise_minor: raise,
    currency: row.currency,
    check_minor: row.check_minor > 0 ? row.check_minor : null,
    restricted: row.restricted === true,
    last_activity_at: row.last_activity_at,
  };
}

/** Cards of the deals a WHERE clause (on alias d) selects, in one query. */
function cards(app, where, bind, order, limit, offset) {
  const sql = CARD_SELECT + ' WHERE ' + where + (order ? ' ORDER BY ' + order : '') + (limit ? ' LIMIT ' + limit + ' OFFSET ' + (offset || 0) : '');
  const rows = u().rows(app, sql, CARD_SHAPE, bind);
  const plMap = pipelineMap(app);
  const zone = zoneOf(app);
  const nowMs = Date.now();
  const todayNum = Math.floor((nowMs + DAYS().offsetMinutes(zone, nowMs) * 60000) / DAY_MS);
  const demo = L('lib_logos').demo(app);
  return rows.map((r) => cardOfRow(r, plMap, zone, todayNum, demo));
}

/** The whole deal (detail adds the stages, team, people and counts). */
function dealOut(app, d, detail) {
  const util = u();
  const card = cardOut(app, d);
  const round = roundOf(d);
  const check = d.getInt('check_minor');
  const ownership = check > 0 && round.post_money_minor !== null && round.post_money_minor > 0 ? Math.round((check * 1000000) / round.post_money_minor) : null;
  const fund = d.getString('fund') !== '' ? util.byId(app, 'entities', d.getString('fund')) : null;
  const out = Object.assign(card, {
    name: d.getString('name'),
    stage_entered_at: d.getString('stage_entered_at'),
    status_reason: d.getString('status_reason'),
    status_at: d.getString('status_at'),
    source: d.getString('source'),
    source_person: R().mini(app, 'people', d.getString('source_person')),
    round: round,
    ownership_ppm: ownership,
    instrument: d.getString('instrument'),
    fund: fund ? { id: fund.id, name: fund.getString('name') } : null,
    agent_allowed: d.getBool('agent_allowed'),
    tags: util.jsonOf(d, 'tags', []) || [],
    intake_item: d.getString('intake_item'),
    prov: util.jsonOf(d, 'prov', {}) || {},
    actor: d.getString('actor'),
    created: d.getString('created'),
    updated: d.getString('updated'),
  });
  if (detail) {
    const pl = util.byId(app, 'pipelines', d.getString('pipeline'));
    out.pipeline = pl ? pipelineOut(app, pl) : null;
    const rows = app.findRecordsByFilter('deal_people', 'deal = {:d}', 'created', 0, 0, { d: d.id });
    out.team = rows.filter((r) => r.getString('member') !== '').map((r) => Object.assign(R().mini(app, 'members', r.getString('member')) || { id: r.getString('member') }, { role: r.getString('role'), link: r.id }));
    out.people = rows.filter((r) => r.getString('person') !== '').map((r) => Object.assign(R().mini(app, 'people', r.getString('person')) || { id: r.getString('person') }, { role: r.getString('role'), link: r.id }));
    out.files = util.count(app, "SELECT COUNT(*) AS n FROM files WHERE deal = {:d} AND current = TRUE AND deleted_at = ''", { d: d.id });
  }
  return out;
}

/** get(ctx, ref) -> the deal in full; 403 when the caller may not see it. */
function get(ctx, r) {
  const d = ref(ctx.app, r);
  guard(ctx, d);
  return dealOut(ctx.app, d, true);
}

/* -------------------------------------------------------------- writes */

/** Who wrote a deal_people row (its `member` is the team member). */
function stampAdded(ctx, r) {
  const w = R().who(ctx);
  r.set('actor', w.actor);
  r.set('added_by', w.actor === 'person' ? w.member : '');
}

function teamRow(t, ctx, dealId, memberId, role) {
  const util = u();
  let r = util.findOne(t, 'deal_people', 'deal = {:d} && member = {:m}', { d: dealId, m: memberId });
  if (r === null) {
    r = util.newRecord(t, 'deal_people');
    r.set('deal', dealId);
    r.set('member', memberId);
  } else if (r.getString('role') === role && r.getBool('team')) return r;
  r.set('role', role);
  r.set('team', true);
  stampAdded(ctx, r);
  t.save(r);
  return r;
}

function personRow(t, ctx, dealId, personId, role) {
  const util = u();
  if (PEOPLE_ROLES.indexOf(role) < 0) throw util.fail(400, 'role must be one of: ' + PEOPLE_ROLES.join(', ') + '.', 'invalid_param', { param: 'role' });
  let r = util.findOne(t, 'deal_people', 'deal = {:d} && person = {:p}', { d: dealId, p: personId });
  if (r === null) {
    r = util.newRecord(t, 'deal_people');
    r.set('deal', dealId);
    r.set('person', personId);
  } else if (r.getString('role') === role) return r;
  r.set('role', role);
  r.set('team', false);
  stampAdded(ctx, r);
  t.save(r);
  return r;
}

function stageEvent(t, ctx, d, o) {
  const e = u().newRecord(t, 'stage_events');
  e.set('deal', d.id);
  e.set('pipeline', d.getString('pipeline'));
  e.set('kind', o.kind);
  e.set('from_stage', o.from_stage || '');
  e.set('to_stage', o.to_stage || '');
  e.set('from_status', o.from_status || '');
  e.set('to_status', o.to_status || '');
  e.set('days_in_from', o.days_in_from || 0);
  e.set('note', u().clip(o.note || '', 1000));
  e.set('at', o.at || nowIso());
  e.set('run', ctx.run || '');
  R().stampWritten(ctx, e);
  t.save(e);
  return e;
}

function memberRef(app, r0) {
  const util = u();
  const m = L('lib_auth').memberRef(app, r0);
  if (m.getString('status') !== 'active') throw util.fail(409, m.getString('name') + ' is not an active member.', 'inactive_member');
  return m;
}

function fundRef(ctx, app, r0) {
  const util = u();
  const r = String(r0 || '').trim();
  if (r === '') return '';
  const f = util.byId(app, 'entities', r) || util.findOne(app, 'entities', 'name = {:n}', { n: r });
  if (f === null || (f.getString('kind') !== 'fund' && f.getString('kind') !== 'spv')) throw util.fail(404, 'No fund "' + r + '". Run entities.list.', 'not_found', { param: 'fund' });
  if (!ctx.isAgent && !L('lib_auth').inScope(ctx, f.id)) throw util.fail(403, 'That fund is outside your scope.', 'not_permitted', { param: 'fund' });
  return f.id;
}

function companyIdFor(ctx, t, company, meta, state) {
  if (company === undefined || company === null || company === '') throw u().fail(400, 'company is required (an id, a domain or a name).', 'missing_param', { param: 'company' });
  const I = R();
  if (typeof company === 'object') return I.upsertCompanyIn(ctx, t, company, meta, state).rec.id;
  const r = String(company).trim();
  try {
    return I.resolve(t, 'companies', r).id;
  } catch (err) {
    if (!err || err.status !== 404) throw err;
  }
  const looksDomain = r.indexOf(' ') < 0 && r.indexOf('.') > 0;
  return I.upsertCompanyIn(ctx, t, looksDomain ? { domain: r } : { name: r }, meta, state).rec.id;
}

function personIdFor(ctx, t, person, meta, state) {
  const I = R();
  if (person === undefined || person === null || person === '') return '';
  if (typeof person === 'object') return I.upsertPersonIn(ctx, t, person, meta, state).rec.id;
  return I.resolve(t, 'people', String(person)).id;
}

function finish(ctx, state) {
  for (const c of state.created) R().emit(ctx, c.kind === 'people' ? 'person.created' : 'company.created', c.kind === 'people' ? { person: c.id } : { company: c.id });
}

/** Store your AI agent's call as a proposal of `op` (when the rule asks for a person). */
function proposeOp(ctx, op, kind, params) {
  const spec = L('lib_catalog').get(op);
  return L('lib_proposals').fromCall(ctx, spec.agent === 'propose' ? spec : Object.assign({}, spec, { kind: kind }), params);
}

function cleanRound(o, currency) {
  const r = o || {};
  const out = {};
  if (r.type !== undefined && r.type !== null && r.type !== '') {
    if (ROUND_TYPES.indexOf(String(r.type)) < 0) throw u().fail(400, 'round type must be one of: ' + ROUND_TYPES.join(', ') + '.', 'invalid_param', { param: 'round_type' });
    out.type = String(r.type);
  }
  for (const k of ['raise_minor', 'pre_money_minor', 'post_money_minor']) {
    if (r[k] === undefined || r[k] === null || r[k] === '') continue;
    const v = Number(r[k]);
    if (!Number.isInteger(v) || v < 0) throw u().fail(400, k + ' is a whole number of minor units of ' + currency + '.', 'invalid_param', { param: k });
    out[k] = v;
  }
  return out;
}

/**
 * create(ctx, o) -> deal view. o.company is an id, a domain, a name or an
 * object for upsertCompany; o.people is [{ person: id|email|{name,email}, role }].
 */
function create(ctx, o) {
  const util = u();
  const app = ctx.app;
  const pl = pipelineOf(app, o.pipeline || 'deal_flow');
  const stages = stagesOf(pl);
  const st = o.stage ? stageOf(pl, o.stage) : Object.assign({ index: 0 }, stages[0]);
  const meta = { origin: '', source_ref: o.source_ref || '', mode: 'fill' };
  if (ctx.isAgent && st.index !== 0) throw util.fail(403, 'Your AI agent opens deals at ' + stages[0].label + ' only; a later stage is a proposal (deals.create proposes it).', 'agent_first_stage_only');
  const source = o.source === undefined || o.source === null ? '' : String(o.source);
  if (source !== '' && SOURCES.indexOf(source) < 0) throw util.fail(400, 'source must be one of: ' + SOURCES.join(', ') + '.', 'invalid_param', { param: 'source' });
  const instrument = o.instrument === undefined || o.instrument === null ? '' : String(o.instrument);
  if (instrument !== '' && INSTRUMENTS.indexOf(instrument) < 0) throw util.fail(400, 'instrument must be one of: ' + INSTRUMENTS.join(', ') + '.', 'invalid_param', { param: 'instrument' });
  const currency = L('lib_norm').currency(o.currency || L('lib_settings').row(app).getString('base_currency') || 'USD', 'currency');
  const round = cleanRound(o.round, currency);
  const check = o.check_minor === undefined || o.check_minor === null || o.check_minor === '' ? 0 : Number(o.check_minor);
  if (!Number.isInteger(check) || check < 0) throw util.fail(400, 'check_minor is a whole number of minor units.', 'invalid_param', { param: 'check' });
  let pointId = '';
  if (o.point) pointId = memberRef(app, o.point === 'me' ? ctx.memberId : o.point).id;
  else if (ctx.actor === 'person') pointId = ctx.memberId;
  const fundId = fundRef(ctx, app, o.fund);
  const state = { created: [] };
  let dealId = '';
  R().inRun(ctx, 'deals.create', (t) => {
    const companyId = companyIdFor(ctx, t, o.company, meta, state);
    const dup = t.findRecordsByFilter('deals', "company = {:c} && pipeline = {:p} && deleted_at = '' && (status = 'open' || status = 'hold')", '', 1, 0, { c: companyId, p: pl.id });
    if (dup.length > 0) throw util.fail(409, 'There is already an open deal for this company: ' + dup[0].getString('number') + '.', 'duplicate', { deal: dup[0].getString('number'), id: dup[0].id });
    const d = util.newRecord(t, 'deals');
    const now = nowIso();
    d.set('number', util.nextId(t, 'D', 4));
    d.set('name', util.clip(util.squash(o.name || ''), 200));
    d.set('company', companyId);
    d.set('pipeline', pl.id);
    d.set('stage', st.key);
    d.set('stage_entered_at', now);
    d.set('status', 'open');
    d.set('point', pointId);
    d.set('source', source);
    d.set('source_person', personIdFor(ctx, t, o.source_person, meta, state));
    d.set('round', round);
    d.set('currency', currency);
    d.set('check_minor', check);
    d.set('instrument', instrument);
    d.set('fund', fundId);
    d.set('restricted', o.restricted === true);
    d.set('agent_allowed', o.agent_allowed === true);
    d.set('tags', L('lib_norm').tags(Array.isArray(o.tags) ? o.tags : []));
    d.set('intake_item', util.clip(String(o.intake_item || ''), 20));
    const prov = {};
    for (const k of ['source', 'source_person', 'instrument', 'check', 'fund'].concat(Object.keys(round).map((x) => (x === 'type' ? 'round_type' : x.replace('_minor', ''))))) prov[k] = R().provEntry(ctx, meta.source_ref);
    d.set('prov', prov);
    d.set('last_activity_at', now);
    d.set('deleted_at', '');
    R().stampWritten(ctx, d);
    t.save(d);
    if (pointId !== '') teamRow(t, ctx, d.id, pointId, 'point');
    if (o.restricted === true && ctx.actor === 'person' && ctx.memberId !== pointId) teamRow(t, ctx, d.id, ctx.memberId, 'team');
    for (const x of o.people || []) {
      const pid = personIdFor(ctx, t, x.person, meta, state);
      if (pid !== '') personRow(t, ctx, d.id, pid, x.role || 'founder');
    }
    stageEvent(t, ctx, d, { kind: 'created', to_stage: st.key, to_status: 'open' });
    dealId = d.id;
    return { summary: 'Opened deal ' + d.getString('number'), type: 'deals', id: d.id };
  });
  finish(ctx, state);
  const d = app.findRecordById('deals', dealId);
  R().emit(ctx, 'deal.created', { deal: d.id, company: d.getString('company'), pipeline: pl.getString('key'), stage: st.key });
  return dealOut(app, d, true);
}

/** move(ctx, dealId, stageKey, note, at?) -> deal view; writes a stage event and emits deal.moved. `at`: when it really moved (a person logging an earlier move). */
function move(ctx, dealId, stageKey, note, at) {
  const util = u();
  const app = ctx.app;
  const d0 = ref(app, dealId);
  guard(ctx, d0);
  if (d0.getString('status') !== 'open') throw util.fail(409, 'This deal is ' + d0.getString('status') + '. Reopen it first (deals.status --status open).', 'not_open', { status: d0.getString('status') });
  const pl = pipelineOf(app, d0.getString('pipeline'));
  const st = stageOf(pl, stageKey);
  const from = d0.getString('stage');
  if (st.key === from) return dealOut(app, d0, true);
  R().inRun(ctx, 'deals.move', (t) => {
    const d = t.findRecordById('deals', d0.id);
    const now = at || nowIso();
    const entered = Date.parse(String(d.getString('stage_entered_at')).replace(' ', 'T'));
    const daysFrom = at ? (Number.isFinite(entered) ? Math.max(0, Math.floor((Date.parse(at) - entered) / 86400000)) : 0) : daysIn(app, d);
    stageEvent(t, ctx, d, { kind: 'moved', from_stage: from, to_stage: st.key, days_in_from: daysFrom, note: note, at: now });
    d.set('stage', st.key);
    d.set('stage_entered_at', now);
    d.set('last_activity_at', now);
    // Unplaced in the new column: it follows the placed deals, newest in stage last (the end).
    d.set('board_rank', 0);
    t.save(d);
    return { summary: d.getString('number') + ' moved to ' + st.label, type: 'deals', id: d.id };
  });
  R().emit(ctx, 'deal.moved', { deal: d0.id, from: from, to: st.key, pipeline: pl.getString('key') });
  return dealOut(app, app.findRecordById('deals', d0.id), true);
}

/**
 * The order of a board column: the deals a person placed (board_rank 1, 2, ...) first,
 * then the unplaced ones (board_rank 0) longest in stage first.
 */
const BOARD_ORDER = 'CASE WHEN d.board_rank > 0 THEN 0 ELSE 1 END, d.board_rank, d.stage_entered_at ASC, d.id';

/**
 * reorder(ctx, dealId, { stage?, before?, index?, note? }) -> { deal, stage, index }
 *
 * Put a deal at a place in its board column, moving it to `stage` first when
 * that differs (move() and its rules). `before`: the deal it lands in front
 * of (absent: the end of the column); `index`: its place among the deals ctx
 * sees in that column (0 = the top). Every open or held deal of the column
 * then carries board_rank 1..n in the new order.
 */
function reorder(ctx, dealId, o) {
  const util = u();
  const app = ctx.app;
  const opt = o || {};
  let d = ref(app, dealId);
  guard(ctx, d);
  let movedTo = '';
  const status = d.getString('status');
  if (status !== 'open' && status !== 'hold') throw util.fail(409, 'This deal is ' + status + '; only open and held deals are on the board.', 'not_open', { status: status });
  const pl = pipelineOf(app, d.getString('pipeline'));
  const want = String(opt.stage || '').trim();
  if (want !== '') {
    const st = stageOf(pl, want);
    if (st.key !== d.getString('stage')) {
      const moved = move(ctx, d.id, st.key, opt.note || '');
      if (moved && moved.proposed) return moved;
      d = app.findRecordById('deals', d.id);
      movedTo = st.label;
    }
  }
  const stage = d.getString('stage');
  const colSql = "SELECT d.id AS id, d.board_rank AS r FROM deals d WHERE d.pipeline = {:pl} AND d.stage = {:sg} AND d.status IN ('open', 'hold') AND d.deleted_at = '' AND d.id != {:me}";
  const bind = { pl: pl.id, sg: stage, me: d.id };
  const col = util.rows(app, colSql + ' ORDER BY ' + BOARD_ORDER, { id: '', r: 0 }, bind);
  let pos = col.length;
  const before = String(opt.before || '').trim();
  if (before !== '') {
    const b = ref(app, before);
    const i = col.findIndex((x) => x.id === b.id);
    if (i >= 0) pos = i;
  } else if (opt.index !== null && opt.index !== undefined && opt.index !== '') {
    const vis = visibleSql(ctx, 'd');
    const seen = util.rows(app, colSql + ' AND ' + vis.sql + ' ORDER BY ' + BOARD_ORDER, { id: '', r: 0 }, Object.assign({}, bind, vis.bind));
    const at = Math.max(0, Math.floor(Number(opt.index) || 0));
    if (at < seen.length) pos = col.findIndex((x) => x.id === seen[at].id);
    else if (seen.length > 0) pos = col.findIndex((x) => x.id === seen[seen.length - 1].id) + 1;
  }
  const order = col.map((x) => x.id);
  order.splice(pos, 0, d.id);
  const had = {};
  for (const x of col) had[x.id] = x.r;
  had[d.id] = d.getInt('board_rank');
  order.forEach((id, i) => {
    if (had[id] === i + 1) return;
    const rec = id === d.id ? d : app.findRecordById('deals', id);
    rec.set('board_rank', i + 1);
    app.save(rec);
  });
  L('lib_audit').note(ctx, { collection: 'deals', record: d.id, summary: d.getString('number') + (movedTo !== '' ? ' moved to ' + movedTo + ', ' : ' placed ') + (pos + 1) + ' of ' + order.length + (movedTo !== '' ? '' : ' in ' + stageOf(pl, stage).label) });
  return { deal: cardOut(app, app.findRecordById('deals', d.id)), stage: stage, index: pos };
}

/** setStatus(ctx, dealId, status, reason) -> deal view; emits deal.closed { deal, status, reason } unless reopened. */
function setStatus(ctx, dealId, status, reason) {
  const util = u();
  const app = ctx.app;
  if (STATUSES.indexOf(status) < 0) throw util.fail(400, 'status must be one of: ' + STATUSES.join(', ') + '.', 'invalid_param', { param: 'status' });
  const d0 = ref(app, dealId);
  guard(ctx, d0);
  const from = d0.getString('status');
  if (from === status) return dealOut(app, d0, true);
  const why = util.clip(util.squash(reason || ''), 600);
  R().inRun(ctx, 'deals.status', (t) => {
    const d = t.findRecordById('deals', d0.id);
    stageEvent(t, ctx, d, { kind: 'status', from_stage: d.getString('stage'), to_stage: d.getString('stage'), from_status: from, to_status: status, note: why });
    d.set('status', status);
    d.set('status_reason', why);
    d.set('status_at', nowIso());
    d.set('last_activity_at', nowIso());
    t.save(d);
    return { summary: d.getString('number') + ' marked ' + status, type: 'deals', id: d.id };
  });
  if (status !== 'open') R().emit(ctx, 'deal.closed', { deal: d0.id, status: status, reason: why });
  else R().emit(ctx, 'deal.reopened', { deal: d0.id, from: from });
  return dealOut(app, app.findRecordById('deals', d0.id), true);
}

/** assign(ctx, dealId, memberRef) -> deal view: the point partner (kept on the deal team). */
function assign(ctx, dealId, mref) {
  const app = ctx.app;
  const d0 = ref(app, dealId);
  guard(ctx, d0);
  const m = memberRef(app, mref === 'me' ? ctx.memberId : mref);
  if (d0.getString('point') === m.id) return dealOut(app, d0, true);
  R().inRun(ctx, 'deals.assign', (t) => {
    const d = t.findRecordById('deals', d0.id);
    const old = d.getString('point');
    if (old !== '') teamRow(t, ctx, d.id, old, 'team');
    teamRow(t, ctx, d.id, m.id, 'point');
    d.set('point', m.id);
    d.set('last_activity_at', nowIso());
    t.save(d);
    return { summary: d.getString('number') + ': point partner ' + m.getString('name'), type: 'deals', id: d.id };
  });
  return dealOut(app, app.findRecordById('deals', d0.id), true);
}

/** team(ctx, dealId, { add, remove }) -> deal view: members on the firm's deal team. */
function team(ctx, dealId, change) {
  const util = u();
  const app = ctx.app;
  const d0 = ref(app, dealId);
  guard(ctx, d0);
  const add = (change.add || []).map((x) => memberRef(app, x === 'me' ? ctx.memberId : x).id);
  const remove = (change.remove || []).map((x) => L('lib_auth').memberRef(app, x === 'me' ? ctx.memberId : x).id);
  if (remove.indexOf(d0.getString('point')) >= 0) throw util.fail(409, 'The point partner stays on the team; assign another point partner first.', 'is_point');
  R().inRun(ctx, 'deals.team', (t) => {
    for (const id of add) teamRow(t, ctx, d0.id, id, 'team');
    for (const id of remove) {
      const r = util.findOne(t, 'deal_people', 'deal = {:d} && member = {:m}', { d: d0.id, m: id });
      if (r !== null) t.delete(t.findRecordById('deal_people', r.id));
    }
    if (d0.getBool('restricted') && util.count(t, 'SELECT COUNT(*) AS n FROM deal_people WHERE deal = {:d} AND team = TRUE', { d: d0.id }) === 0) throw util.fail(409, 'A restricted deal keeps at least one person on its team.', 'empty_team');
    return { summary: d0.getString('number') + ': deal team changed', type: 'deals', id: d0.id };
  });
  return dealOut(app, app.findRecordById('deals', d0.id), true);
}

/** people(ctx, dealId, { add: [{ person, role }], remove: [personRef] }) -> deal view: founders and contacts. */
function people(ctx, dealId, change) {
  const util = u();
  const app = ctx.app;
  const d0 = ref(app, dealId);
  guard(ctx, d0);
  const state = { created: [] };
  const meta = { origin: '', source_ref: change.source_ref || '', mode: 'fill' };
  R().inRun(ctx, 'deals.people', (t) => {
    for (const x of change.add || []) {
      if (x === null || typeof x !== 'object') throw util.fail(400, 'add is a JSON list of {"person": "<id, email or {name,email}>", "role": "founder"}.', 'invalid_param', { param: 'add' });
      util.keysOnly(x, ['person', 'role'], 'add');
      const pid = personIdFor(ctx, t, x.person, meta, state);
      if (pid === '') throw util.fail(400, 'Each added person needs "person".', 'invalid_param', { param: 'add' });
      personRow(t, ctx, d0.id, pid, x.role || 'founder');
    }
    for (const x of change.remove || []) {
      const pid = R().resolve(t, 'people', String(x), { deleted: true }).id;
      const r = util.findOne(t, 'deal_people', 'deal = {:d} && person = {:p}', { d: d0.id, p: pid });
      if (r !== null) t.delete(t.findRecordById('deal_people', r.id));
    }
    return { summary: d0.getString('number') + ': people changed', type: 'deals', id: d0.id };
  });
  finish(ctx, state);
  return dealOut(app, app.findRecordById('deals', d0.id), true);
}

/** restrict(ctx, dealId, restricted, agentAllowed) -> deal view (people only). */
function restrict(ctx, dealId, restricted, agentAllowed) {
  const util = u();
  const app = ctx.app;
  if (ctx.isAgent) throw util.fail(403, 'Your AI agent cannot restrict or open a deal.', 'agent_not_permitted');
  const d0 = ref(app, dealId);
  guard(ctx, d0);
  R().inRun(ctx, 'deals.restrict', (t) => {
    const d = t.findRecordById('deals', d0.id);
    if (restricted && ctx.actor === 'person' && !isTeam(t, d.id, ctx.memberId)) teamRow(t, ctx, d.id, ctx.memberId, 'team');
    d.set('restricted', restricted === true);
    d.set('agent_allowed', agentAllowed === true);
    t.save(d);
    return { summary: d.getString('number') + (restricted ? ' restricted to its deal team' : ' open to the firm') + (agentAllowed ? ', your AI agent allowed' : ''), type: 'deals', id: d.id };
  });
  return dealOut(app, app.findRecordById('deals', d0.id), true);
}

/* -------------------------------------------------- update and fill */

function dealVal(d, def) {
  if (def.round) {
    const r = roundOf(d);
    return def.round === 'type' ? r.type : r[def.round];
  }
  if (def.column) {
    const v = d.getInt(def.column);
    return v > 0 ? v : null;
  }
  if (def.type === 'tags') return u().jsonOf(d, 'tags', []) || [];
  return d.getString(def.key);
}

function emptyVal(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/** The stored value of an input field (money in major units -> minor units of `currency`). */
function dealCoerce(ctx, app, def, raw, currency) {
  const util = u();
  const s = raw === null || raw === undefined ? '' : raw;
  if (def.type === 'text') {
    const v = util.squash(String(s));
    if (v.length > def.max) throw util.fail(400, def.key + ' is too long (at most ' + def.max + ' characters).', 'invalid_param', { param: def.key });
    return v;
  }
  if (def.type === 'select') {
    const v = String(s).trim();
    if (v !== '' && def.options.indexOf(v) < 0) throw util.fail(400, def.key + ' must be one of: ' + def.options.join(', ') + '.', 'invalid_param', { param: def.key });
    return v;
  }
  if (def.type === 'currency') return L('lib_norm').currency(s, def.key);
  if (def.type === 'money') {
    if (String(s).trim() === '') return null;
    const o = {};
    o[def.key] = typeof s === 'number' ? String(s) : s;
    return util.money(o, def.key, currency, {});
  }
  if (def.type === 'person') return String(s).trim() === '' ? '' : R().resolve(app, 'people', String(s)).id;
  if (def.type === 'fund') return fundRef(ctx, app, s);
  if (def.type === 'tags') return L('lib_norm').tags(Array.isArray(s) ? s : String(s).trim() === '' ? [] : String(s).trim().charAt(0) === '[' ? JSON.parse(String(s)) : [String(s)]);
  return s;
}

function dealInput(def, v, currency) {
  if (def.type === 'money') return v === null ? '' : L('lib_money').fromMinor(v, currency);
  if (def.type === 'tags') return JSON.stringify(v || []);
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Write deal fields. mode 'update' writes all; 'fill' writes empty fields
 * (and your AI agent's own earlier values); the rest is kept for people or
 * returned as `proposed` for your AI agent.
 */
function applyFields(ctx, t, d, input, mode, sourceRef) {
  const util = u();
  const app = ctx.app;
  const defs = {};
  for (const df of DEAL_FIELDS) defs[df.key] = df;
  for (const k of Object.keys(input)) if (defs[k] === undefined) throw util.fail(400, 'Unknown deal field "' + k + '". Fields: ' + DEAL_FIELDS.map((x) => x.key).join(', ') + '.', 'unknown_key', { key: k });
  const prov = util.jsonOf(d, 'prov', {}) || {};
  const changes = [];
  const proposed = {};
  const kept = [];
  const oldCur = d.getString('currency');
  let cur = oldCur;
  const keys = Object.keys(input).sort((a, b) => (a === 'currency' ? -1 : b === 'currency' ? 1 : 0));
  const round = u().jsonOf(d, 'round', {}) || {};
  // Field changes promoted to automatic (note_fields) cover the non-financial fields only.
  const autoNF = ctx.isAgent && L('lib_settings').autoAllowed(ctx.app, 'note_fields');
  for (const k of keys) {
    const def = defs[k];
    const nv = dealCoerce(ctx, app, def, input[k], cur);
    const ov = dealVal(d, def);
    if (JSON.stringify(ov) === JSON.stringify(nv)) continue;
    const pv = prov[k];
    const own = pv && (pv.by === 'agent' || pv.by === 'system');
    const promoted = autoNF && NON_FINANCIAL.indexOf(k) >= 0;
    const allowed = mode === 'update' || emptyVal(ov) || (ctx.isAgent && (own || promoted));
    if (!allowed) {
      if (ctx.isAgent) proposed[k] = dealInput(def, nv, cur);
      else kept.push(k);
      continue;
    }
    if (def.round) {
      if (nv === null || nv === '') delete round[def.round];
      else round[def.round] = nv;
      d.set('round', round);
    } else if (def.column) d.set(def.column, nv === null ? 0 : nv);
    else if (k === 'currency') {
      // The same amounts in the new currency's minor unit (a change of exponent rescales them).
      const m = L('lib_money');
      const diff = m.exponent(nv) - m.exponent(oldCur || nv);
      if (diff !== 0) {
        const scale = (v) => (v === undefined || v === null ? v : diff > 0 ? v * Math.pow(10, diff) : Math.round(v / Math.pow(10, -diff)));
        for (const rk of ['raise_minor', 'pre_money_minor', 'post_money_minor']) if (round[rk] !== undefined) round[rk] = scale(round[rk]);
        d.set('round', round);
        if (d.getInt('check_minor') > 0) d.set('check_minor', scale(d.getInt('check_minor')));
      }
      d.set('currency', nv);
      cur = nv;
    } else d.set(k, nv);
    prov[k] = R().provEntry(ctx, sourceRef);
    changes.push({ field: k, from: ov, to: nv });
  }
  // Post-money follows raise and pre-money (pre + raise) unless a person entered it (qa-cli RULING CLI-23): never stale.
  const touched = changes.some((c) => c.field === 'raise' || c.field === 'pre_money');
  const personPost = !!(prov.post_money && prov.post_money.by === 'person');
  if (touched && typeof round.raise_minor === 'number' && typeof round.pre_money_minor === 'number' && !personPost && !changes.some((c) => c.field === 'post_money')) {
    const post = round.pre_money_minor + round.raise_minor;
    if (round.post_money_minor !== post) {
      changes.push({ field: 'post_money', from: round.post_money_minor === undefined ? null : round.post_money_minor, to: post });
      round.post_money_minor = post;
      d.set('round', round);
      prov.post_money = Object.assign(R().provEntry(ctx, sourceRef), { by: 'system', computed: 'pre-money + raise' });
    }
  }
  if (changes.length > 0) {
    d.set('prov', prov);
    d.set('last_activity_at', nowIso());
    t.save(d);
  }
  return { changes: changes, proposed: proposed, kept: kept, currency: cur };
}

function writeDeal(ctx, r0, input, mode, sourceRef, op) {
  const app = ctx.app;
  const d0 = ref(app, r0);
  guard(ctx, d0);
  let res = null;
  R().inRun(ctx, op, (t) => {
    const d = t.findRecordById('deals', d0.id);
    res = applyFields(ctx, t, d, input, mode, sourceRef);
    if (res.changes.length === 0) return { result: null };
    return { summary: d.getString('number') + ': ' + (mode === 'fill' ? 'filled ' : 'changed ') + res.changes.map((c) => c.field).join(', '), type: 'deals', id: d.id };
  });
  let proposal = null;
  if (ctx.isAgent && Object.keys(res.proposed).length > 0) {
    const params = Object.assign({ deal: d0.id }, res.proposed);
    if (sourceRef) params.source_ref = sourceRef;
    const p = proposeOp(ctx, 'deals.update', 'deals', params);
    proposal = { id: p.proposal, fields: Object.keys(res.proposed), message: p.message };
    // A raise or pre-money that no longer adds up to the post-money a person entered: say so (the app never recomputes a person's value).
    const d1 = app.findRecordById('deals', d0.id);
    const rd = roundOf(d1);
    const money = (k, cur) => (res.proposed[k] !== undefined ? u().money({ v: String(res.proposed[k]) }, 'v', d1.getString('currency')) : cur);
    const raise = money('raise', rd.raise_minor);
    const pre = money('pre_money', rd.pre_money_minor);
    if ((res.proposed.raise !== undefined || res.proposed.pre_money !== undefined) && res.proposed.post_money === undefined && raise !== null && pre !== null && rd.post_money_minor !== null && rd.post_money_minor !== raise + pre) {
      const fmt = (m) => L('lib_money').format(m, d1.getString('currency'));
      proposal.note = 'Post-money stays ' + fmt(rd.post_money_minor) + ' (a person entered it) while pre-money plus raise would be ' + fmt(raise + pre) + '; tell the person so they update it.';
    }
  }
  return Object.assign(dealOut(app, app.findRecordById('deals', d0.id), true), { changed: res.changes.map((c) => c.field), kept: res.kept, proposal: proposal });
}

/** records.enrich for a deal: fill empty fields; your AI agent's other changes become a deals.update proposal. */
function fill(ctx, r0, fields, sourceRef) {
  L('lib_auth').need(ctx, 'pipeline', 'edit');
  return writeDeal(ctx, r0, fields, 'fill', sourceRef, 'records.enrich');
}

/* ------------------------------------------------------------------ ops */

function inputFromParams(p) {
  const out = {};
  for (const df of DEAL_FIELDS) if (u().has(p, df.key)) out[df.key] = p[df.key];
  return out;
}

function opCreate(ctx, p) {
  const util = u();
  if (ctx.isAgent && !ctx.dryRun && util.str(p, 'stage', '') !== '') {
    const pl = pipelineOf(ctx.app, util.str(p, 'pipeline', '') || 'deal_flow');
    const st = stageOf(pl, util.str(p, 'stage', ''));
    if (st.index !== 0) {
      const params = {};
      for (const k of Object.keys(p)) if (p[k] !== undefined && p[k] !== '') params[k] = p[k];
      const prop = proposeOp(ctx, 'deals.create', 'deals', params);
      return { proposed: true, proposal: prop.proposal, message: 'Your AI agent opens deals at ' + stagesOf(pl)[0].label + '; opening at ' + st.label + ' waits for a person. ' + prop.message };
    }
  }
  const round = {};
  const currency = L('lib_norm').currency(util.str(p, 'currency', '') || L('lib_settings').row(ctx.app).getString('base_currency') || 'USD', 'currency');
  if (util.str(p, 'round_type', '') !== '') round.type = util.oneOf(p, 'round_type', ROUND_TYPES, '');
  const raise = util.money(p, 'raise', currency);
  if (raise !== null) round.raise_minor = raise;
  const pre = util.money(p, 'pre_money', currency);
  if (pre !== null) round.pre_money_minor = pre;
  const post = util.money(p, 'post_money', currency);
  if (post !== null) round.post_money_minor = post;
  const check = util.money(p, 'check', currency);
  const ppl = util.list(p, 'people');
  return {
    deal: create(ctx, {
      company: util.req(p, 'company'),
      pipeline: util.str(p, 'pipeline', '') || 'deal_flow',
      stage: util.str(p, 'stage', ''),
      source: util.oneOf(p, 'source', SOURCES, ''),
      source_person: util.str(p, 'source_person', ''),
      point: util.str(p, 'point', ''),
      round: round,
      check_minor: check,
      currency: currency,
      instrument: util.oneOf(p, 'instrument', INSTRUMENTS, ''),
      fund: util.str(p, 'fund', ''),
      name: util.str(p, 'name', ''),
      restricted: util.bool(p, 'restricted', false),
      agent_allowed: util.bool(p, 'agent_allowed', false),
      people: ppl === undefined ? [] : ppl,
      source_ref: util.str(p, 'source_ref', ''),
    }),
  };
}

function opUpdate(ctx, p) {
  const util = u();
  const input = inputFromParams(p);
  if (Object.keys(input).length === 0) throw util.fail(400, 'Give at least one field to change: ' + DEAL_FIELDS.map((x) => x.key).join(', ') + '.', 'missing_param');
  return { deal: writeDeal(ctx, util.req(p, 'deal'), input, 'update', util.str(p, 'source_ref', ''), 'deals.update') };
}

function opMove(ctx, p) {
  const util = u();
  const day = util.day(p, 'on_day', '');
  let at = '';
  if (day !== '') {
    // A person logs a move made earlier (the deal's days in stage count from then); never your AI agent, never the future.
    if (ctx.isAgent) throw util.fail(400, 'on_day is for a person logging a move made earlier; propose the move without it.', 'invalid_param', { param: 'on_day' });
    if (day > util.today(ctx.app)) throw util.fail(400, 'on_day cannot be in the future.', 'invalid_param', { param: 'on_day' });
    if (day < util.dayAdd(util.today(ctx.app), -730)) throw util.fail(400, 'on_day is at most two years back.', 'invalid_param', { param: 'on_day' });
    at = util.atOf(ctx.app, day, '10:00');
  }
  const out = move(ctx, util.req(p, 'deal'), util.req(p, 'stage'), util.text(p, 'note', 1000, ''), at);
  return out.proposed ? out : { deal: out };
}

function opStatus(ctx, p) {
  const util = u();
  const status = util.oneOf(p, 'status', STATUSES, '');
  const reason = util.text(p, 'reason', 600, '');
  if (status === 'passed') {
    // One pass flow for every deal (qa-cli RULING CLI-03): the pass is kept with its reason chip; no email from here (passes.create sends one).
    const P = L('lib_intake_pass');
    const key = P.reasonKey(reason);
    const out = P.opCreate(ctx, { deal: util.req(p, 'deal'), reason: key !== '' ? key : 'other', criterion: key !== '' ? '' : reason, email: false });
    return { deal: dealOut(ctx.app, ref(ctx.app, out.deal.id), true), pass: out.pass };
  }
  return { deal: setStatus(ctx, util.req(p, 'deal'), status, reason) };
}

function opAssign(ctx, p) {
  return { deal: assign(ctx, u().req(p, 'deal'), u().req(p, 'point')) };
}

function opTeam(ctx, p) {
  const util = u();
  const add = util.list(p, 'add') || [];
  const remove = util.list(p, 'remove') || [];
  if (add.length === 0 && remove.length === 0) throw util.fail(400, 'Give --add or --remove (JSON lists of member ids or emails).', 'missing_param');
  return { deal: team(ctx, util.req(p, 'deal'), { add: add, remove: remove }) };
}

function opPeople(ctx, p) {
  const util = u();
  const add = util.list(p, 'add') || [];
  const remove = util.list(p, 'remove') || [];
  if (add.length === 0 && remove.length === 0) throw util.fail(400, 'Give --add (JSON list of {"person","role"}) or --remove (JSON list of person ids or emails).', 'missing_param');
  return { deal: people(ctx, util.req(p, 'deal'), { add: add, remove: remove, source_ref: util.str(p, 'source_ref', '') }) };
}

function opRestrict(ctx, p) {
  const util = u();
  const d = ref(ctx.app, util.req(p, 'deal'));
  return { deal: restrict(ctx, d.id, util.bool(p, 'restricted', d.getBool('restricted')), util.bool(p, 'agent_allowed', d.getBool('agent_allowed'))) };
}

function opGet(ctx, p) {
  const out = { deal: get(ctx, u().req(p, 'deal')) };
  // Your AI agent sees what already waits for a person on this deal, so it does not propose it twice.
  if (ctx.isAgent) out.pending_proposals = L('lib_proposals').pendingFor(ctx.app, 'deals', out.deal.id);
  return out;
}

/** Filters shared by deals.list and deals.board: { where, bind }. */
function filters(ctx, p) {
  const util = u();
  const app = ctx.app;
  const where = ["d.deleted_at = ''"];
  const bind = {};
  const status = util.oneOf(p, 'status', ['active', 'all'].concat(STATUSES), 'active');
  if (status === 'active') where.push("d.status IN ('open', 'hold')");
  else if (status !== 'all') {
    where.push('d.status = {:st}');
    bind.st = status;
  }
  const point = util.str(p, 'point', '');
  if (point !== '') {
    where.push('d.point = {:pt}');
    bind.pt = point === 'me' ? ctx.memberId || '-' : L('lib_auth').memberRef(app, point).id;
  }
  const fund = util.str(p, 'fund', '');
  if (fund !== '') {
    where.push('d.fund = {:fd}');
    bind.fd = fundRef(ctx, app, fund);
  }
  const company = util.str(p, 'company', '');
  if (company !== '') {
    where.push('d.company = {:co}');
    bind.co = R().resolve(app, 'companies', company, { deleted: true }).id;
  }
  const q = util.str(p, 'q', '');
  if (q !== '') {
    where.push("(d.number LIKE {:q} ESCAPE '\\' OR d.name LIKE {:q} ESCAPE '\\' OR d.company IN (SELECT id FROM companies WHERE name LIKE {:q} ESCAPE '\\' OR domain LIKE {:q} ESCAPE '\\'))");
    bind.q = util.like(q);
  }
  if (util.has(p, 'restricted')) {
    where.push('d.restricted = {:rs}');
    bind.rs = util.bool(p, 'restricted', false);
  }
  return { where: where, bind: bind };
}

function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = filters(ctx, p);
  const pipeline = util.str(p, 'pipeline', '');
  if (pipeline !== '') {
    f.where.push('d.pipeline = {:pl}');
    f.bind.pl = pipelineOf(app, pipeline).id;
  }
  const stage = util.str(p, 'stage', '');
  if (stage !== '') {
    f.where.push('d.stage = {:sg}');
    f.bind.sg = stage;
  }
  const minDays = util.int(p, 'min_days', 0, 0, 3650);
  if (minDays > 0) {
    f.where.push("d.stage_entered_at != '' AND d.stage_entered_at <= {:md}");
    f.bind.md = new Date(Date.now() - minDays * 86400000).toISOString();
  }
  const vis = visibleSql(ctx, 'd');
  const pg = util.page(p, 50, 500);
  const sort = util.oneOf(p, 'sort', ['updated', 'created', 'stage_entered_at', 'number', 'days_in_stage'], 'updated');
  // days_in_stage: longest in its stage first.
  const order = sort === 'number' ? 'd.number DESC' : sort === 'days_in_stage' ? 'd.stage_entered_at ASC' : 'd.' + sort + ' DESC';
  const base = f.where.join(' AND ');
  const all = util.count(app, 'SELECT COUNT(*) AS n FROM deals d WHERE ' + base, f.bind);
  const bind = Object.assign({}, f.bind, vis.bind);
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM deals d WHERE ' + base + ' AND ' + vis.sql, bind);
  let rows = cards(app, base + ' AND ' + vis.sql, bind, order + ', d.id', pg.limit, pg.offset);
  // Your AI agent's rows: the deal in one line of fields (deals.get --deal <number> has the rest; --full true the cards).
  if (ctx.isAgent && !util.bool(p, 'full', false)) rows = rows.map((c) => ({ number: c.number, title: c.title, company: c.company ? c.company.name : '', pipeline: c.pipeline, stage: c.stage_label, status: c.status, days_in_stage: c.days_in_stage, stalled: c.stalled, point: c.point ? c.point.name : '', round_type: c.round_type, raise_minor: c.raise_minor, check_minor: c.check_minor, currency: c.currency }));
  return { deals: rows, total: total, hidden: all - total, limit: pg.limit, offset: pg.offset };
}

/** deals.board: one pipeline as columns of stages, each with its count and deals in board order (BOARD_ORDER). */
function opBoard(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pl = pipelineOf(app, util.str(p, 'pipeline', '') || 'deal_flow');
  const f = filters(ctx, p);
  f.where.push('d.pipeline = {:pl}');
  f.bind.pl = pl.id;
  const vis = visibleSql(ctx, 'd');
  const per = util.int(p, 'limit', 100, 1, 500);
  const base = f.where.join(' AND ');
  const bind = Object.assign({}, f.bind, vis.bind);
  const all = util.count(app, 'SELECT COUNT(*) AS n FROM deals d WHERE ' + base, f.bind);
  // One query for every visible card of the pipeline; columns, counts and the per-stage limit from it.
  const byStage = {};
  for (const c of cards(app, base + ' AND ' + vis.sql, bind, BOARD_ORDER, 0, 0)) {
    if (byStage[c.stage] === undefined) byStage[c.stage] = [];
    byStage[c.stage].push(c);
  }
  let total = 0;
  const columns = stagesOf(pl).map((s) => {
    const list = byStage[s.key] || [];
    total += list.length;
    return { key: s.key, label: s.label, stall_days: s.stall_days, count: list.length, deals: list.slice(0, per) };
  });
  return { pipeline: pipelineOut(app, pl), stages: columns, total: total, hidden: all - total };
}

function opPipelines(ctx) {
  const util = u();
  const app = ctx.app;
  const vis = visibleSql(ctx, 'd');
  const counts = {};
  for (const r of util.rows(app, "SELECT d.pipeline AS p, COUNT(*) AS n FROM deals d WHERE d.deleted_at = '' AND d.status IN ('open', 'hold') AND " + vis.sql + ' GROUP BY d.pipeline', { p: '', n: 0 }, vis.bind)) counts[r.p] = r.n;
  const rows = app.findRecordsByFilter('pipelines', 'archived = false', 'sort', 0, 0);
  return { pipelines: rows.map((pl) => pipelineOut(app, pl, counts)), kinds: PIPELINE_KINDS };
}

/** pipelines.save: a pipeline's name and stages (key, label, stall days); a stage holding deals cannot go. */
function opPipelineSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r0 = util.req(p, 'pipeline');
  let pl = util.byId(app, 'pipelines', r0) || util.findOne(app, 'pipelines', 'key = {:k}', { k: r0 });
  if (pl === null) {
    if (DEFAULTS[r0] === undefined) throw util.fail(404, 'No pipeline "' + r0 + '". Pipelines can be deal_flow, spv, lp_raise or program.', 'not_found', { param: 'pipeline' });
    pl = pipelineOf(app, r0);
  }
  const before = pipelineOut(app, pl);
  if (util.has(p, 'name')) {
    const n = util.squash(util.text(p, 'name', 80, ''));
    if (n === '') throw util.fail(400, 'name cannot be empty.', 'invalid_param', { param: 'name' });
    pl.set('name', n);
  }
  const raw = util.list(p, 'stages');
  if (raw !== undefined) {
    if (raw.length < 2 || raw.length > 12) throw util.fail(400, 'A pipeline has 2 to 12 stages.', 'invalid_param', { param: 'stages' });
    const out = [];
    raw.forEach((s, i) => {
      if (s === null || typeof s !== 'object') throw util.fail(400, 'stages is a JSON list of {"label","stall_days"} (with "key" to keep an existing stage).', 'invalid_param', { param: 'stages' });
      util.keysOnly(s, ['key', 'label', 'stall_days'], 'Stage ' + (i + 1));
      const label = util.squash(String(s.label || ''));
      if (label === '' || label.length > 40) throw util.fail(400, 'Stage ' + (i + 1) + ': a label of 1 to 40 characters.', 'invalid_param', { param: 'stages' });
      const key = s.key ? String(s.key) : util.slug(label).replace(/-/g, '_');
      if (!/^[a-z0-9_]{1,40}$/.test(key)) throw util.fail(400, 'Stage ' + (i + 1) + ': key is lower case letters, digits and _.', 'invalid_param', { param: 'stages' });
      const days = s.stall_days === undefined || s.stall_days === null || s.stall_days === '' ? 0 : Number(s.stall_days);
      if (!Number.isInteger(days) || days < 0 || days > 365) throw util.fail(400, 'Stage ' + (i + 1) + ': stall_days is a whole number from 0 (never stalls) to 365.', 'invalid_param', { param: 'stages' });
      if (out.some((x) => x.key === key || x.label.toLowerCase() === label.toLowerCase())) throw util.fail(400, 'Stage ' + (i + 1) + ': "' + label + '" is there twice.', 'invalid_param', { param: 'stages' });
      out.push({ key: key, label: label, stall_days: days });
    });
    for (const old of stagesOf(pl)) {
      if (out.some((x) => x.key === old.key)) continue;
      const n = util.count(app, "SELECT COUNT(*) AS n FROM deals WHERE pipeline = {:p} AND stage = {:s} AND deleted_at = ''", { p: pl.id, s: old.key });
      if (n > 0) throw util.fail(409, old.label + ' holds ' + n + (n === 1 ? ' deal' : ' deals') + '; move them before removing the stage.', 'stage_in_use', { stage: old.key, deals: n });
    }
    pl.set('stages', out);
  }
  app.save(pl);
  const after = pipelineOut(app, pl);
  L('lib_audit').note(ctx, { collection: 'pipelines', record: pl.id, summary: 'Changed the pipeline ' + pl.getString('name'), before: before, after: after });
  return { pipeline: after };
}

/* ------------------------------------------------- automatic checks (op `auto`) */

/** deals.move promoted to automatic: only a move to Screen runs directly for your AI agent. */
function autoMove(ctx, params) {
  return String(params.stage || '') === 'screen';
}

const NON_FINANCIAL = ['name', 'source', 'source_person', 'tags'];

/** deals.update promoted (note_fields): only non-financial fields run directly for your AI agent. */
function autoUpdate(ctx, params) {
  const keys = DEAL_FIELDS.map((f) => f.key).filter((k) => params[k] !== undefined && params[k] !== '');
  return keys.length > 0 && keys.every((k) => NON_FINANCIAL.indexOf(k) >= 0);
}

/* -------------------------------------------------------------- previews */

/** The name people know a deal by: its company. */
function companyName(app, d) {
  const c = d.getString('company') !== '' ? u().byId(app, 'companies', d.getString('company')) : null;
  return c !== null ? c.getString('name') : d.getString('name') || d.getString('number');
}

/** A deal field's value as people read it, for a proposal line (money stays in major units: line() formats it). */
function shownField(app, def, v) {
  if (v === null || v === undefined || v === '') return '';
  if (def.type === 'select') return (OPTION_LABELS[def.key] || {})[String(v)] || String(v);
  if (def.type === 'person') {
    const p = u().byId(app, 'people', String(v));
    return p !== null ? p.getString('name') || p.getString('email') : String(v);
  }
  if (def.type === 'fund') {
    const e = u().byId(app, 'entities', String(v)) || u().findOne(app, 'entities', 'name = {:n}', { n: String(v) });
    return e !== null ? e.getString('name') : String(v);
  }
  return v;
}

function previewUpdate(ctx, params) {
  const app = ctx.app;
  const P = L('lib_proposals');
  const d = ref(app, params.deal);
  const cur = d.getString('currency');
  const next = params.currency !== undefined && String(params.currency).trim() !== '' ? String(params.currency).trim().toUpperCase() : cur;
  const fields = [];
  for (const df of DEAL_FIELDS) {
    if (params[df.key] === undefined) continue;
    const before = dealVal(d, df);
    const after = params[df.key];
    let ln;
    if (df.type === 'money' && next === cur) ln = P.line(df.label, before === null ? '' : L('lib_money').fromMinor(before, cur), after, 'money:' + cur, df.key);
    else if (df.type === 'money') ln = P.line(df.label, before === null ? '' : L('lib_money').format(before, cur), String(after).trim() === '' ? '' : next + ' ' + String(after).trim(), 'text', df.key);
    else if (df.type === 'person') ln = P.line(df.label, shownField(app, df, before), String(after).trim() === '' ? '' : shownField(app, df, R().resolve(app, 'people', String(after)).id), 'text', df.key);
    else ln = P.line(df.label, shownField(app, df, before), shownField(app, df, after), df.type === 'tags' ? 'list' : 'text', df.key);
    if (ln !== null) fields.push(ln);
  }
  return { label: P.titleOf(companyName(app, d), fields), ref: d.getString('number'), target: 'deals:' + d.id, fields: fields, notes: params.source_ref ? ['Source: ' + params.source_ref] : [], risk: 'medium' };
}

function previewMove(ctx, params) {
  const app = ctx.app;
  const P = L('lib_proposals');
  const d = ref(app, params.deal);
  const pl = pipelineOf(app, d.getString('pipeline'));
  const to = stageOf(pl, params.stage);
  const from = stagesOf(pl).filter((s) => s.key === d.getString('stage'))[0];
  const ln = P.line('Stage', from ? from.label : d.getString('stage'), to.label, 'text', 'stage');
  const fields = ln === null ? [] : [ln];
  return { label: P.titleOf(companyName(app, d), fields), ref: d.getString('number'), target: 'deals:' + d.id, fields: fields, notes: params.note ? [String(params.note)] : [], risk: 'medium' };
}

function previewAssign(ctx, params) {
  const app = ctx.app;
  const P = L('lib_proposals');
  const d = ref(app, params.deal);
  const m = L('lib_auth').memberRef(app, params.point);
  const was = d.getString('point') !== '' ? u().byId(app, 'members', d.getString('point')) : null;
  const ln = P.line('Point partner', was !== null ? was.getString('name') : '', m.getString('name'), 'text', 'point');
  const fields = ln === null ? [] : [ln];
  return { label: P.titleOf(companyName(app, d), fields), ref: d.getString('number'), target: 'deals:' + d.id, fields: fields, notes: [], risk: 'medium' };
}

function previewTeam(ctx, params) {
  const app = ctx.app;
  const P = L('lib_proposals');
  const d = ref(app, params.deal);
  const names = (raw) =>
    (u().list({ v: raw }, 'v') || []).map((x) => {
      try {
        return L('lib_auth').memberRef(app, String(x)).getString('name');
      } catch {
        return String(x);
      }
    });
  const fields = [P.line('Add to team', '', names(params.add), 'list', 'add'), P.line('Remove from team', '', names(params.remove), 'list', 'remove')].filter((x) => x !== null);
  return { label: P.titleOf(companyName(app, d), fields), ref: d.getString('number'), target: 'deals:' + d.id, fields: fields, notes: [], risk: 'medium' };
}

module.exports = {
  STATUSES: STATUSES,
  SOURCES: SOURCES,
  ROUND_TYPES: ROUND_TYPES,
  INSTRUMENTS: INSTRUMENTS,
  PIPELINE_KINDS: PIPELINE_KINDS,
  PEOPLE_ROLES: PEOPLE_ROLES,
  DEAL_FIELDS: DEAL_FIELDS,
  create: create,
  move: move,
  reorder: reorder,
  BOARD_ORDER: BOARD_ORDER,
  setStatus: setStatus,
  assign: assign,
  team: team,
  people: people,
  restrict: restrict,
  visible: visible,
  visibleSql: visibleSql,
  guard: guard,
  isTeam: isTeam,
  get: get,
  ref: ref,
  fill: fill,
  pipelineOf: pipelineOf,
  stagesOf: stagesOf,
  cardOut: cardOut,
  cards: cards,
  dealOut: dealOut,
  opCreate: opCreate,
  opUpdate: opUpdate,
  opMove: opMove,
  opStatus: opStatus,
  opAssign: opAssign,
  opTeam: opTeam,
  opPeople: opPeople,
  opRestrict: opRestrict,
  opGet: opGet,
  opList: opList,
  opBoard: opBoard,
  opPipelines: opPipelines,
  opPipelineSave: opPipelineSave,
  autoMove: autoMove,
  autoUpdate: autoUpdate,
  previewUpdate: previewUpdate,
  previewMove: previewMove,
  previewAssign: previewAssign,
  previewTeam: previewTeam,
};
