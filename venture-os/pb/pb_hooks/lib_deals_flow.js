/// <reference path="../pb_data/types.d.ts" />
/**
 * Deals module: the pipeline views kernel-records leaves to it (the stage
 * funnel, stalled deals), deal merges, the stall Next items and the daily
 * stall cron. Deals, pipelines and stage events are kernel-records'
 * collections: this module reads them and writes through lib_deals.
 *
 *   funnel(ctx, { pipeline?, quarter?, fund? }) -> funnel answer (deals.funnel)
 *   opReorder (deals.reorder): a deal's place in its board column (lib_deals.reorder)
 *   stalled(ctx, { pipeline?, point? }) -> [deal card + stall_days]
 *
 * Stall: a deal is stalled when its days in stage pass the stage's stall
 * days (lib_eng_days.stall through lib_deals.cardOut, calendar days in the
 * firm's zone; stall_days 0 never stalls). The point partner gets one Next
 * item per stalled deal (kind stall: Move, Pass, Snooze) and one
 * notification the morning it stalls (cron 08:00).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function D() {
  return L('lib_deals');
}

const PASS_REASONS = ['Team', 'Market', 'Product', 'Traction', 'Valuation', 'Fit with thesis', 'Timing', 'Other'];
const SNOOZE_HOURS = 168;
const ROUND = { pre_seed: 'Pre-seed', seed: 'Seed', seed_extension: 'Seed ext', series_a: 'Series A', series_b: 'Series B', series_c: 'Series C', series_d_plus: 'Series D+', bridge: 'Bridge', other: 'Other' };
const DAY_MS = 86400000;

/* --------------------------------------------------------------- funnel */

/** The window of a quarter in the firm's zone: { key, start_day, end_day, from_at, to_at }. */
function windowOf(app, quarterText) {
  const util = u();
  const F = L('lib_deals_funnel');
  let q = null;
  if (quarterText) {
    q = F.parseQuarter(quarterText);
    if (q === null) throw util.fail(400, 'quarter is written YYYY-Qn, e.g. 2026-Q4.', 'invalid_param', { param: 'quarter' });
  } else q = F.quarterOf(util.today(app));
  return Object.assign({}, q, { from_at: util.atOf(app, q.start_day, '00:00'), to_at: util.atOf(app, q.end_day, '00:00') });
}

/**
 * funnel(ctx, { pipeline, quarter, fund }) -> { pipeline, quarter, stages: [bar], cohort, open, hidden }
 * One cohort funnel per period (default this quarter, firm zone; lib_deals_funnel). Deal flow: the
 * first bar Inbound is the intake items received in the period (not merged; a fund scope leaves out
 * items whose deal is in another fund), then per stage how many of THAT cohort ever reached it. Other
 * pipelines: the deals created in the period. A deal the caller may not see counts as not reached.
 * Bars only shrink; conversion_ppm is a bar over the bar before it. Each stage bar also carries now
 * (open and held deals in it now). open and hidden: open deals the caller sees and does not see.
 */
function funnel(ctx, o) {
  const util = u();
  const app = ctx.app;
  const pl = D().pipelineOf(app, o.pipeline || 'deal_flow');
  const stages = D().stagesOf(pl);
  const index = {};
  stages.forEach((s, i) => {
    index[s.key] = i;
  });
  const win = windowOf(app, o.quarter || '');
  const fa = String(win.from_at).replace('T', ' ');
  const ta = String(win.to_at).replace('T', ' ');
  const vis = D().visibleSql(ctx, 'd');
  const where = ["d.deleted_at = ''", 'd.pipeline = {:pl}'];
  const bind = { pl: pl.id };
  if (o.fund) {
    where.push('d.fund = {:fd}');
    bind.fd = o.fund;
  }
  const base = where.join(' AND ');
  const all = Object.assign({}, bind, vis.bind);
  const counts = {};
  for (const r of util.rows(app, "SELECT d.stage AS stage, COUNT(*) AS n FROM deals d WHERE " + base + " AND d.status IN ('open', 'hold') AND " + vis.sql + ' GROUP BY d.stage', { stage: '', n: 0 }, all)) counts[r.stage] = r.n;
  const allOpen = util.count(app, "SELECT COUNT(*) AS n FROM deals d WHERE " + base + " AND d.status IN ('open', 'hold')", bind);
  let open = 0;
  for (const k of Object.keys(counts)) open += counts[k];
  const inWin = (col) => "REPLACE(" + col + ", 'T', ' ') >= {:fa} AND REPLACE(" + col + ", 'T', ' ') < {:ta}";
  const reachedSql = "COALESCE((SELECT GROUP_CONCAT(DISTINCT e.to_stage) FROM stage_events e WHERE e.deal = d.id AND e.kind IN ('created', 'moved')), '')";
  const inbound = pl.getString('key') === 'deal_flow';
  const winBind = Object.assign({ fa: fa, ta: ta }, all);
  let rows;
  if (inbound) {
    const own = ctx.ownOnly ? ' AND i.submitted_by = {:own}' : '';
    if (ctx.ownOnly) winBind.own = ctx.memberId || '-';
    rows = util.rows(
      app,
      "SELECT i.id AS id, CASE WHEN d.id IS NULL THEN 0 WHEN " + vis.sql + " THEN 1 ELSE 0 END AS seen, COALESCE(d.stage, '') AS stage, CASE WHEN d.id IS NULL THEN '' ELSE " + reachedSql + " END AS reached FROM intake_items i LEFT JOIN deals d ON d.id = i.deal AND " + base + " WHERE i.status != 'merged' AND " + inWin("COALESCE(NULLIF(i.received_at, ''), i.created)") + own + (o.fund ? " AND (i.deal = '' OR d.id IS NOT NULL OR i.deal NOT IN (SELECT id FROM deals WHERE fund != {:fd}))" : ''),
      { id: '', seen: 0, stage: '', reached: '' },
      winBind,
    );
  } else {
    rows = util.rows(app, "SELECT d.id AS id, 1 AS seen, d.stage AS stage, " + reachedSql + " AS reached FROM deals d WHERE " + base + ' AND ' + vis.sql + ' AND ' + inWin('d.created'), { id: '', seen: 0, stage: '', reached: '' }, winBind);
  }
  const cohort = rows.map((r) => {
    let at = -1;
    if (r.seen === 1) {
      for (const k of [r.stage].concat(String(r.reached || '').split(','))) if (index[k] !== undefined && index[k] > at) at = index[k];
    }
    return { id: r.id, reached: at };
  });
  const moves = util.rows(app, "SELECT e.from_stage AS from_stage, e.days_in_from AS days_in_from FROM stage_events e JOIN deals d ON d.id = e.deal WHERE " + base + ' AND ' + vis.sql + " AND e.kind = 'moved' AND " + inWin('e.at'), { from_stage: '', days_in_from: 0 }, winBind);
  const f = L('lib_deals_funnel').funnel({ stages: stages, cohort: cohort, inbound: inbound, counts: counts, moves: moves });
  const out = f.stages.map((b) => Object.assign(b, { stall_days: index[b.key] !== undefined ? stages[index[b.key]].stall_days : null }));
  return { pipeline: { key: pl.getString('key'), name: pl.getString('name'), kind: pl.getString('kind') }, quarter: { key: win.key, start_day: win.start_day, end_day: win.end_day }, stages: out, cohort: f.cohort, open: open, hidden: allOpen - open };
}

function opFunnel(ctx, p) {
  const util = u();
  let fund = '';
  const fr = util.str(p, 'fund', '');
  if (fr !== '') {
    const f = util.byId(ctx.app, 'entities', fr) || util.findOne(ctx.app, 'entities', 'name = {:n}', { n: fr });
    if (f === null) throw util.fail(404, 'No fund "' + fr + '". Run entities.list.', 'not_found', { param: 'fund' });
    fund = f.id;
  }
  return funnel(ctx, { pipeline: util.str(p, 'pipeline', '') || 'deal_flow', quarter: util.str(p, 'quarter', ''), fund: fund });
}

/* --------------------------------------------------------------- stalls */

/**
 * Open deals past their stage's stall days that ctx may see: [card + stall_days].
 * o.pipeline: one pipeline (default every pipeline); o.point: a member id.
 */
function stalled(ctx, o) {
  const util = u();
  const app = ctx.app;
  const vis = D().visibleSql(ctx, 'd');
  const pls = o.pipeline ? [D().pipelineOf(app, o.pipeline)] : app.findRecordsByFilter('pipelines', 'archived = false', 'sort', 0, 0);
  const zone = L('lib_settings').row(app).getString('zone') || 'UTC';
  const now = Date.now();
  const out = [];
  let hidden = 0;
  const over = Number(o.days) > 0 ? Math.floor(Number(o.days)) : 0;
  for (const pl of pls) {
    for (const s of D().stagesOf(pl)) {
      // --days N: every stage, in it more than N days, whatever its stall setting.
      const limitDays = over > 0 ? over : s.stall_days;
      if (limitDays <= 0) continue;
      // Days in stage are local calendar days: a deal entered more than stall_days - 1 days ago may have stalled.
      const cutoff = new Date(now - (limitDays - 1) * DAY_MS).toISOString();
      const where = "d.deleted_at = '' AND d.status = 'open' AND d.pipeline = {:pl} AND d.stage = {:sk} AND d.stage_entered_at != '' AND d.stage_entered_at < {:cut}" + (o.point ? ' AND d.point = {:pt}' : '');
      const bind = { pl: pl.id, sk: s.key, cut: cutoff, pt: o.point || '' };
      const ids = util.rows(app, 'SELECT d.id AS id FROM deals d WHERE ' + where + ' AND ' + vis.sql + ' ORDER BY d.stage_entered_at LIMIT 500', { id: '' }, Object.assign({}, bind, vis.bind));
      if (!o.point) hidden += util.count(app, 'SELECT COUNT(*) AS n FROM deals d WHERE ' + where, bind) - ids.length;
      for (const r of ids) {
        const card = D().cardOut(app, app.findRecordById('deals', r.id), zone);
        if (over > 0 ? card.days_in_stage > over : card.stalled) out.push(Object.assign(card, { stall_days: s.stall_days }));
      }
    }
  }
  if (over > 0) out.sort((a, b) => b.days_in_stage - a.days_in_stage);
  else out.sort((a, b) => b.days_in_stage - b.stall_days - (a.days_in_stage - a.stall_days));
  return { deals: out, hidden: Math.max(0, hidden) };
}

function opStalls(ctx, p) {
  const util = u();
  const point = util.str(p, 'point', '');
  let pid = '';
  if (point !== '') pid = point === 'me' ? ctx.memberId || '-' : L('lib_auth').memberRef(ctx.app, point).id;
  const days = util.int(p, 'days', 0, 0, 3650);
  const r = stalled(ctx, { pipeline: util.str(p, 'pipeline', ''), point: pid, days: days });
  const limit = util.int(p, 'limit', 100, 1, 500);
  const out = { deals: r.deals.slice(0, limit), total: r.deals.length, hidden: r.hidden };
  if (days > 0) out.rule = 'Open deals in their current stage more than ' + days + ' days (calendar days in the firm zone), longest first.';
  else out.rule = "Open deals past their stage's stall days (stall_days per stage, from pipelines.list); --days N lists every deal in its stage more than N days.";
  return out;
}

/** The Next key of a stalled deal: a new stage (or a new entry into it) gives a new key, so an old snooze never hides it. */
function stallKey(card) {
  return 'deals:stall:' + card.id + ':' + card.stage;
}

/** Next items (kind stall) for the point partner: Move (to a chosen later stage), Pass (reason chip), Snooze a week. */
function needsYou(ctx) {
  if (ctx.isAgent || !ctx.memberId) return [];
  const app = ctx.app;
  const out = [];
  for (const c of stalled(ctx, { point: ctx.memberId }).deals) {
    const pl = D().pipelineOf(app, c.pipeline);
    const stages = D().stagesOf(pl);
    const later = stages.slice(c.stage_index + 1);
    const actions = [];
    // done and undo: the toast's word and its way back (passed through once the kernel's lib_next keeps them).
    if (later.length > 0) actions.push({ label: 'Move', op: 'deals.move', params: { deal: c.id }, primary: true, choose: { param: 'stage', options: later.map((s) => ({ value: s.key, label: s.label })) }, done: 'Moved', undo: { op: 'deals.move', params: { deal: c.id, stage: c.stage } } });
    actions.push({ label: 'Pass', op: 'passes.create', params: { deal: c.id }, choose: { param: 'reason', options: PASS_REASONS.map((x) => ({ value: x, label: x })) }, done: 'Passed', undo: { op: 'deals.status', params: { deal: c.id, status: 'open' } } });
    actions.push({ label: 'Snooze', op: 'next.snooze', params: { key: stallKey(c), hours: SNOOZE_HOURS }, done: 'Snoozed', undo: { op: 'next.snooze', params: { key: stallKey(c), until: '' } } });
    out.push({
      key: stallKey(c),
      kind: 'stall',
      card: 'stall',
      title: c.title,
      figures: [
        { label: 'Stage', value: c.stage_label },
        { label: 'Days', value: String(c.days_in_stage) },
        { label: 'Stall at', value: String(c.stall_days) },
      ],
      chips: [{ label: 'Stalled', tone: 'warn' }].concat(c.round_type && ROUND[c.round_type] ? [{ label: ROUND[c.round_type], tone: 'neutral' }] : []),
      agent: false,
      rank: 60,
      at: c.stalls_on ? c.stalls_on + 'T00:00:00Z' : '',
      href: '#/deals/' + c.number,
      data: { deal: c.id, number: c.number, stage: c.stage, days_in_stage: c.days_in_stage, stall_days: c.stall_days, pipeline: c.pipeline, stages: stages.map((s) => ({ key: s.key, label: s.label })), company: c.company ? c.company.name : '', point: c.point ? c.point.name : '' },
      actions: actions,
    });
  }
  return out;
}

/** Cron 08:00 (firm zone): tell each point partner once when a deal of theirs stalls. */
function stallCron(app) {
  const util = u();
  const ctx = L('lib_auth').systemCtx(app);
  let told = 0;
  for (const c of stalled(ctx, {}).deals) {
    const point = c.point ? c.point.id : '';
    if (point === '') continue;
    const d = util.byId(app, 'deals', c.id);
    if (d === null) continue;
    const ref = 'deals:stall:' + c.id + ':' + d.getString('stage_entered_at');
    if (util.findOne(app, 'notifications', 'member = {:m} && ref = {:r}', { m: point, r: ref }) !== null) continue;
    told += L('lib_notify').notify(app, [point], { kind: 'stall', title: c.title + ' stalled in ' + c.stage_label, body: c.days_in_stage + ' days in ' + c.stage_label + ' (stall at ' + c.stall_days + ').', link: '#/deals/' + c.number, ref: ref }).length;
  }
  L('lib_deals_notes').sweepDrafts(app);
  return told;
}

/* ------------------------------------------------------------ decisions */

const DECISION_WORD = { invest: 'invest', pass: 'pass', more_diligence: 'more diligence', hold: 'hold' };

/**
 * decision.recorded { decision, deal, outcome, corrects } (committee): the
 * deal follows the committee. invest: to Term sheet; pass: status passed;
 * more_diligence: back to Diligence; hold: status hold. A correction is
 * handled the same way (the latest decision wins). A deal already closed
 * as invested is left alone; a held deal is reopened before it moves.
 */
function onDecision(ctx, payload) {
  const util = u();
  const app = ctx.app;
  const D = L('lib_deals');
  const id = payload && payload.deal ? String(payload.deal) : '';
  const outcome = payload && payload.outcome ? String(payload.outcome) : '';
  if (id === '' || DECISION_WORD[outcome] === undefined) return null;
  const d = util.byId(app, 'deals', id);
  if (d === null || d.getString('deleted_at') !== '' || d.getString('status') === 'invested') return null;
  const why = 'IC decision: ' + DECISION_WORD[outcome] + (payload.corrects ? ' (correction)' : '');
  const sys = L('lib_auth').systemCtx(app);
  const keys = D.stagesOf(D.pipelineOf(app, d.getString('pipeline'))).map((s) => s.key);
  const status = d.getString('status');
  if (outcome === 'pass') return status === 'passed' ? null : D.setStatus(sys, id, 'passed', why).status;
  if (outcome === 'hold') return status === 'hold' ? null : D.setStatus(sys, id, 'hold', why).status;
  const to = outcome === 'invest' ? 'term_sheet' : 'diligence';
  if (keys.indexOf(to) < 0) return null;
  if (status !== 'open') D.setStatus(sys, id, 'open', why);
  return D.move(sys, id, to, why).stage;
}

/* -------------------------------------------------------------- members */

/** deals.members: the active members who work the pipeline (point partners and deal teams are chosen from them). */
function opMembers(ctx) {
  const util = u();
  const app = ctx.app;
  const out = [];
  for (const id of L('lib_auth').membersWith(app, 'pipeline', 'view')) {
    const m = util.byId(app, 'members', id);
    if (m === null) continue;
    const role = util.byId(app, 'roles', m.getString('role'));
    out.push({ id: m.id, name: m.getString('name'), email: m.getString('email'), title: m.getString('title'), role: role ? role.getString('name') : '', me: m.id === ctx.memberId });
  }
  out.sort((a, b) => (a.me === b.me ? (a.name < b.name ? -1 : 1) : a.me ? -1 : 1));
  return { members: out };
}

/* ---------------------------------------------------------------- merge */

/**
 * deals.merge: fold a duplicate deal (drop) into the one kept. Notes, tasks,
 * files tied to the drop, its team and its founders and contacts move to
 * the kept deal; the dropped deal is soft deleted and its id resolves to
 * the kept one (aliases). Emits record.merged { kind: 'deals', keep, drop }
 * inside the op, so other modules re-point their rows in the same undo unit.
 */
function merge(ctx, keepRef, dropRef) {
  const util = u();
  const app = ctx.app;
  const keep = D().ref(app, keepRef);
  const drop = D().ref(app, dropRef);
  D().guard(ctx, keep);
  D().guard(ctx, drop);
  if (keep.id === drop.id) throw util.fail(400, 'keep and drop are the same deal.', 'invalid_param', { param: 'drop' });
  if (keep.getString('pipeline') !== drop.getString('pipeline')) throw util.fail(409, 'Only deals of the same pipeline merge.', 'conflict');
  const moved = { notes: 0, tasks: 0, files: 0, team: 0, people: 0 };
  // Team and people first, with the deal library (its own rules).
  const rows = app.findRecordsByFilter('deal_people', 'deal = {:d}', 'created', 0, 0, { d: drop.id });
  const members = rows.filter((r) => r.getString('member') !== '' && r.getBool('team')).map((r) => r.getString('member'));
  const people = rows.filter((r) => r.getString('person') !== '').map((r) => ({ person: r.getString('person'), role: r.getString('role') }));
  const addMembers = members.filter((m) => !D().isTeam(app, keep.id, m));
  if (addMembers.length > 0 && !ctx.dryRun) {
    D().team(ctx, keep.id, { add: addMembers });
    moved.team = addMembers.length;
  }
  if (people.length > 0 && !ctx.dryRun) {
    D().people(ctx, keep.id, { add: people });
    moved.people = people.length;
  }
  for (const n of app.findRecordsByFilter('notes', 'deal = {:d}', '', 0, 0, { d: drop.id })) {
    n.set('deal', keep.id);
    n.set('company', keep.getString('company'));
    app.save(n);
    moved.notes++;
  }
  for (const t of app.findRecordsByFilter('tasks', 'deal = {:d}', '', 0, 0, { d: drop.id })) {
    t.set('deal', keep.id);
    if (t.getString('ref_collection') === 'deals' && t.getString('ref_id') === drop.id) t.set('ref_id', keep.id);
    app.save(t);
    moved.tasks++;
  }
  const files = util.rows(app, "SELECT id FROM files WHERE deal = {:d} AND current = TRUE AND deleted_at = ''", { id: '' }, { d: drop.id });
  for (const f of files) {
    const rec = app.findRecordById('files', f.id);
    const own = rec.getString('owner_collection') === 'deals' && rec.getString('owner_id') === drop.id;
    if (!ctx.dryRun) L('lib_files').move(ctx, f.id, own ? { owner_collection: 'deals', owner_id: keep.id, deal: keep.id } : { deal: keep.id });
    moved.files++;
  }
  const d = app.findRecordById('deals', drop.id);
  d.set('deleted_at', util.nowIso());
  d.set('status_reason', util.clip('Merged into ' + keep.getString('number'), 600));
  app.save(d);
  const al = util.newRecord(app, 'aliases');
  al.set('kind', 'deals');
  al.set('old_id', drop.id);
  al.set('new_id', keep.id);
  al.set('run', ctx.run || '');
  L('lib_records').stampWritten(ctx, al);
  app.save(al);
  const k = app.findRecordById('deals', keep.id);
  k.set('last_activity_at', util.nowIso());
  app.save(k);
  L('lib_records').emit(ctx, 'record.merged', { kind: 'deals', keep: keep.id, drop: drop.id });
  L('lib_audit').note(ctx, { collection: 'deals', record: keep.id, summary: 'Merged ' + drop.getString('number') + ' into ' + keep.getString('number') });
  return { kept: D().dealOut(app, app.findRecordById('deals', keep.id), true), dropped: drop.getString('number'), moved: moved };
}

function opMerge(ctx, p) {
  const util = u();
  return merge(ctx, util.req(p, 'keep'), util.req(p, 'drop'));
}

function previewMerge(ctx, params) {
  const app = ctx.app;
  const keep = D().ref(app, params.keep);
  const drop = D().ref(app, params.drop);
  return { label: 'Merge ' + drop.getString('number') + ' into ' + keep.getString('number'), target: 'deals:' + keep.id, fields: [{ name: 'merged', before: drop.getString('number'), after: keep.getString('number') }], notes: [], risk: 'medium' };
}

/* --------------------------------------------------------------- order */

/** deals.reorder (people): put a deal at a place in a board column, moving it to that stage first when it differs. */
function opReorder(ctx, p) {
  const util = u();
  const o = { stage: util.str(p, 'stage', ''), before: util.str(p, 'before', ''), note: util.text(p, 'note', 1000, '') };
  if (util.has(p, 'index')) o.index = util.int(p, 'index', 0, 0, 100000);
  return D().reorder(ctx, util.req(p, 'deal'), o);
}

module.exports = {
  opReorder: opReorder,
  PASS_REASONS: PASS_REASONS,
  windowOf: windowOf,
  funnel: funnel,
  opFunnel: opFunnel,
  stalled: stalled,
  opStalls: opStalls,
  stallKey: stallKey,
  needsYou: needsYou,
  stallCron: stallCron,
  onDecision: onDecision,
  opMembers: opMembers,
  merge: merge,
  opMerge: opMerge,
  previewMerge: previewMerge,
};
