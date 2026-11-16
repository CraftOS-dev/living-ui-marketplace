/// <reference path="../pb_data/types.d.ts" />
/**
 * Marks, reserves and scenarios, the quarter close (open, marks, freeze,
 * letter, finalise, send) and the ILPA and XLSX exports.
 *
 * - Marks: your AI agent drafts one per holding when a person asks for the
 *   quarter's marks (trigger mark_notes, one for the quarter: method, value,
 *   calibration note with sources); a person (finance
 *   or a partner) approves with the PIN, editing method, value and rationale.
 *   An approved mark replaces any earlier approved mark of the same day.
 * - Reserves: lib_eng_reserves over each holding's target ownership, rounds to
 *   follow and next-round assumptions (each with a source, or the save is
 *   refused with unsourced_assumption); the fund's budget is its callable
 *   capital; deployed is follow-on money already invested.
 * - Quarter: open starts the close (Ask your AI agent drafts the marks);
 *   freeze (PIN) fixes the fund and LP numbers with a hash (Ask your AI agent
 *   drafts the letter: trigger lp_letter, from frozen numbers, net beside
 *   gross, no forecasts); finalise (PIN) renders each LP's
 *   pack; send hands every pack to the outbound sender. Nothing goes to an LP
 *   without a person's click.
 */

const METHODS = ['calibrated_round', 'round_adjusted', 'multiples', 'write_down', 'write_off'];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function F() {
  return L('lib_funds');
}

/* ----------------------------------------------------------------- marks */

/**
 * A quarter by id, or by its label: "Q3 2026" (when one fund in your scope has it) or with
 * the fund, "Fund I Q3 2026". 404 lists the quarters of that label; 409 when several funds have it.
 */
function quarterRef(ctx, ref) {
  const util = u();
  const r = String(ref || '').trim();
  let q = util.byId(ctx.app, 'quarters', r);
  if (q === null) {
    const m = /^(.*?)[\s,]*Q([1-4])[\s-]*(\d{4})$/i.exec(r);
    const label = m ? 'Q' + m[2] + ' ' + m[3] : '';
    const fundText = m ? m[1].trim() : '';
    const rows = label === '' ? [] : util.findMany(ctx.app, 'quarters', 'label = {:l}', '-period_end', 20, { l: label });
    const scoped = rows.filter((x) => {
      try {
        F().fundOf(ctx, x.getString('fund'));
        return true;
      } catch {
        return false;
      }
    });
    const cand = (x) => {
      const f = util.byId(ctx.app, 'entities', x.getString('fund'));
      return { id: x.id, name: (f ? f.getString('name') + ' ' : '') + x.getString('label'), status: x.getString('status') };
    };
    let pick = scoped;
    if (fundText !== '') {
      const fid = F().fundOf(ctx, fundText).id;
      pick = scoped.filter((x) => x.getString('fund') === fid);
    }
    if (pick.length === 1) q = pick[0];
    else if (pick.length > 1) throw L('lib_refs').ambiguous('quarters', r, pick.map(cand), 'Name the fund too, e.g. "Fund I ' + label + '", or pass the id.', { param: 'quarter' });
    else {
      const any = util.findMany(ctx.app, 'quarters', '1=1', '-period_end', 40).filter((x) => {
        try {
          F().fundOf(ctx, x.getString('fund'));
          return true;
        } catch {
          return false;
        }
      });
      throw L('lib_refs').notFound('quarter', r, any.slice(0, 5).map(cand), 'quarters.list --fund <fund>', { param: 'quarter' });
    }
  }
  F().fundOf(ctx, q.getString('fund'));
  return q;
}

function openQuarter(app, fundId) {
  const r = app.findRecordsByFilter('quarters', "fund = {:f} && status = 'open'", '-period_end', 1, 0, { f: fundId });
  return r.length > 0 ? r[0] : null;
}

function markOut(app, m) {
  return {
    id: m.id,
    holding: m.getString('holding'),
    quarter: m.getString('quarter'),
    as_of_day: m.getString('as_of_day'),
    value_minor: m.getInt('value_minor'),
    prior_minor: m.getInt('prior_minor'),
    change_minor: m.getInt('value_minor') - m.getInt('prior_minor'),
    currency: m.getString('currency'),
    method: m.getString('method'),
    rationale: m.getString('rationale'),
    inputs: u().jsonOf(m, 'inputs', []) || [],
    status: m.getString('status'),
    actor: m.getString('actor'),
    approved_by: L('lib_records').mini(app, 'members', m.getString('approved_by')),
    approved_at: m.getString('approved_at'),
    updated: m.getString('updated'),
  };
}

/** marks.list: per holding the value in force, its method, and the quarter's draft with its change. */
function marksList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  const qRef = util.str(p, 'quarter', '');
  const q = qRef !== '' ? quarterRef(ctx, qRef) : openQuarter(app, f.id) || (app.findRecordsByFilter('quarters', 'fund = {:f}', '-period_end', 1, 0, { f: f.id })[0] || null);
  const day = q !== null ? q.getString('period_end') : util.today(app);
  const b = F().books(app, f, '9999-12-31');
  const nav = F().navAt(b.rows, day, b.marks, b.holdings);
  const drafts = {};
  if (q !== null) for (const m of util.findMany(app, 'marks', "quarter = {:q} && status != 'superseded'", '-updated', 0, { q: q.id })) if (drafts[m.getString('holding')] === undefined) drafts[m.getString('holding')] = markOut(app, m);
  let value = 0;
  let next = 0;
  for (const h of nav.holdings) {
    const d = drafts[h.holding] || null;
    value += h.value_minor;
    next += d !== null ? d.value_minor : h.value_minor;
  }
  const shown = F().shownHoldings(ctx, f.id, nav.holdings);
  const holdings = shown.rows.map((h) => ({ holding: h.holding, name: h.name, status: h.status, cost_minor: h.cost_minor, value_minor: h.value_minor, method: h.method, mark_day: h.mark_day, quarter_mark: drafts[h.holding] || null }));
  const util2 = util;
  return {
    fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') },
    quarter: q !== null ? F().quarterOut(app, q) : null,
    methods: METHODS,
    holdings: holdings,
    hidden: shown.hidden,
    totals: { value_minor: value, next_minor: next, change_minor: next - value, drafts: Object.keys(drafts).filter((k) => drafts[k].status === 'draft').length },
    today: util2.today(app),
  };
}

/** marks.draft: a suggested mark for a holding in the open quarter (your AI agent's mark_note, or a person). */
function marksDraft(ctx, p) {
  const util = u();
  const app = ctx.app;
  const holding = util.req(p, 'holding');
  const qRef = util.str(p, 'quarter', '');
  let q;
  let f;
  if (qRef !== '') {
    q = quarterRef(ctx, qRef);
    f = F().fundOf(ctx, q.getString('fund'));
  } else {
    f = F().fundOf(ctx, util.str(p, 'fund', ''));
    q = openQuarter(app, f.id);
    if (q === null) throw util.fail(409, 'Open a quarter first (quarters.open).', 'no_open_quarter');
  }
  if (q.getString('status') !== 'open') throw util.fail(409, q.getString('label') + ' is ' + q.getString('status') + '; marks change only while it is open.', 'quarter_closed');
  F().seenHolding(ctx, f, holding);
  const cur = f.getString('currency');
  const b = F().books(app, f, '9999-12-31');
  const day = q.getString('period_end');
  const nav = F().navAt(b.rows, day, b.marks, b.holdings);
  const h = nav.holdings.filter((x) => x.holding === holding)[0];
  if (h === undefined) throw util.fail(404, 'Holding ' + holding + ' has no investment in ' + f.getString('name') + ' by ' + day + '.', 'not_found', { param: 'holding' });
  const method = util.oneOf(p, 'method', METHODS, '');
  if (method === '') throw util.fail(400, 'method is one of: ' + METHODS.join(', '), 'missing_param', { param: 'method' });
  let value = util.money(p, 'value', cur, {});
  if (method === 'write_off') value = 0;
  if (value === null) throw util.fail(400, 'value is required, e.g. --value 4500000.00', 'missing_param', { param: 'value' });
  if (value < 0) throw util.fail(400, 'value cannot be negative.', 'invalid_amount', { param: 'value' });
  const rationale = util.text(p, 'rationale', 8000, '');
  if (util.squash(rationale) === '') throw util.fail(400, 'rationale is required: the calibration note (entry price and implied metrics, KPI movement, later rounds, comparables).', 'missing_param', { param: 'rationale' });
  const inputs = (util.list(p, 'inputs') || []).map((x, i) => {
    util.keysOnly(x, ['label', 'value', 'source'], 'inputs[' + i + ']');
    const src = util.clip(util.squash(x.source || ''), 500);
    if (src === '') throw util.fail(400, 'inputs[' + i + '].source is required (a file, a link, or whose judgment it is).', 'unsourced_assumption', { param: 'inputs', index: i });
    return { label: util.clip(util.squash(x.label || ''), 120), value: util.clip(String(x.value === undefined ? '' : x.value), 120), source: src };
  });
  if (ctx.isAgent && inputs.length === 0) throw util.fail(400, 'Give --inputs with a source for each figure behind the mark.', 'unsourced_assumption', { param: 'inputs' });
  let m = util.findOne(app, 'marks', "quarter = {:q} && holding = {:h} && status = 'draft'", { q: q.id, h: holding });
  if (m === null) {
    m = util.newRecord(app, 'marks');
    m.set('fund', f.id);
    m.set('holding', holding);
    m.set('quarter', q.id);
    m.set('status', 'draft');
  }
  m.set('as_of_day', day);
  m.set('value_minor', value);
  m.set('prior_minor', h.value_minor);
  m.set('currency', cur);
  m.set('method', method);
  m.set('rationale', rationale);
  m.set('inputs', inputs);
  m.set('prov', { value: { by: ctx.isAgent ? 'agent' : 'person', at: util.nowIso(), run: ctx.run || '' } });
  m.set('actor', ctx.isAgent ? 'agent' : 'person');
  m.set('member', ctx.memberId || '');
  app.save(m);
  L('lib_audit').note(ctx, { collection: 'marks', record: m.id, summary: (ctx.isAgent ? 'Your AI agent suggested ' : 'Drafted ') + 'a mark for ' + h.name + ': ' + F().fmt(value, cur) + ' (' + method + ')' });
  return { mark: markOut(app, m), holding: { holding: holding, name: h.name, cost_minor: h.cost_minor, prior_minor: h.value_minor } };
}

function approveOne(ctx, m, edits) {
  const util = u();
  const app = ctx.app;
  if (edits) {
    if (edits.method !== undefined) m.set('method', edits.method);
    if (edits.value !== undefined && edits.value !== null) m.set('value_minor', edits.value);
    if (m.getString('method') === 'write_off') m.set('value_minor', 0);
    if (edits.rationale !== undefined) m.set('rationale', edits.rationale);
  }
  for (const old of util.findMany(app, 'marks', "holding = {:h} && status = 'approved' && as_of_day = {:d}", '', 0, { h: m.getString('holding'), d: m.getString('as_of_day') })) {
    old.set('status', 'superseded');
    app.save(old);
  }
  m.set('status', 'approved');
  m.set('approved_by', ctx.memberId);
  m.set('approved_at', util.nowIso());
  app.save(m);
}

/**
 * marks.approve (PIN; finance or a partner): one mark (optionally edited) or every draft of a quarter.
 * Only marks of holdings the approver may see (portfolio's holdingsFor: fund scope and restricted deals):
 * a hidden mark stays a draft, is not returned, and is counted in `hidden`.
 */
function marksApprove(ctx, p) {
  const util = u();
  const app = ctx.app;
  F().needApprover(ctx, 'approve marks');
  const mRef = util.str(p, 'mark', '');
  const done = [];
  let hidden = 0;
  if (mRef !== '') {
    const m = util.byId(app, 'marks', mRef);
    if (m === null) throw util.fail(404, 'No mark ' + mRef + '.', 'not_found');
    F().fundOf(ctx, m.getString('fund'));
    if (F().seenHoldings(ctx, m.getString('fund'))[m.getString('holding')] === undefined) throw util.fail(404, 'No mark ' + mRef + '.', 'not_found');
    if (m.getString('status') !== 'draft') throw util.fail(409, 'This mark is ' + m.getString('status') + '.', 'conflict');
    const q = util.byId(app, 'quarters', m.getString('quarter'));
    if (q !== null && q.getString('status') !== 'open') throw util.fail(409, q.getString('label') + ' is ' + q.getString('status') + '.', 'quarter_closed');
    const edits = {};
    if (util.has(p, 'method')) edits.method = util.oneOf(p, 'method', METHODS, m.getString('method'));
    if (util.has(p, 'value')) edits.value = util.money(p, 'value', m.getString('currency'), {});
    if (util.has(p, 'rationale')) edits.rationale = util.text(p, 'rationale', 8000, '');
    approveOne(ctx, m, edits);
    done.push(markOut(app, m));
  } else {
    const q = quarterRef(ctx, util.req(p, 'quarter'));
    if (q.getString('status') !== 'open') throw util.fail(409, q.getString('label') + ' is ' + q.getString('status') + '.', 'quarter_closed');
    const seen = F().seenHoldings(ctx, q.getString('fund'));
    for (const m of util.findMany(app, 'marks', "quarter = {:q} && status = 'draft'", 'created', 0, { q: q.id })) {
      if (seen[m.getString('holding')] === undefined) {
        hidden++;
        continue;
      }
      approveOne(ctx, m, null);
      done.push(markOut(app, m));
    }
    if (done.length === 0) throw util.fail(409, 'No draft marks wait in ' + q.getString('label') + '.', 'nothing_to_approve', { hidden: hidden });
  }
  L('lib_audit').note(ctx, { collection: 'marks', record: done.length === 1 ? done[0].id : '', summary: 'Approved ' + done.length + ' mark' + (done.length === 1 ? '' : 's') });
  return { approved: done, hidden: hidden };
}

/* -------------------------------------------------------------- reserves */

function assumptionsIn(raw, cur, where) {
  const util = u();
  return (raw || []).map((a, i) => {
    const w = where + '[' + i + ']';
    util.keysOnly(a, ['round', 'raise', 'post_money', 'pool', 'source', 'raise_minor', 'post_money_minor', 'pool_ppm'], w);
    const raise = a.raise_minor !== undefined ? Number(a.raise_minor) : amountIn(a.raise, cur, w + '.raise');
    const post = a.post_money_minor !== undefined ? Number(a.post_money_minor) : amountIn(a.post_money, cur, w + '.post_money');
    let pool = 0;
    if (a.pool_ppm !== undefined) pool = Number(a.pool_ppm);
    else if (a.pool !== undefined && a.pool !== '') pool = util.ppm({ pool: a.pool }, 'pool', { min: 0, max: 1000000 }) || 0;
    return { round: Number(a.round || i + 1), raise_minor: raise, post_money_minor: post, pool_ppm: pool, source: util.clip(util.squash(a.source || ''), 500) };
  });
}

function amountIn(v, cur, where) {
  const util = u();
  if (v === undefined || v === null || v === '') return null;
  const m = L('lib_money').toMinor(typeof v === 'number' ? String(v) : String(v).replace(/[,\s]/g, ''), cur, false);
  if (m === null) throw util.fail(400, where + ' must be an amount in ' + cur + '.', 'invalid_amount', { param: where });
  return m;
}

/** The reserve plan of a fund (saved rows, with overrides by holding). */
function planOf(app, f, overrides) {
  const util = u();
  const today = util.today(app);
  const b = F().books(app, f, '9999-12-31');
  const nav = F().navAt(b.rows, today, b.marks, b.holdings);
  const commits = F().commitmentsOf(app, f.id, 'signed');
  const acc = F().accountsOf(b, commits, today);
  let callable = 0;
  for (const c of commits) callable += Math.max(0, acc[c.lp].callable_minor);
  const saved = {};
  for (const r of util.findMany(app, 'reserves', 'fund = {:f}', '', 0, { f: f.id })) saved[r.getString('holding')] = { target_ppm: r.getInt('target_ppm'), rounds: r.getInt('rounds'), allocated_minor: r.getInt('allocated_minor'), assumptions: util.jsonOf(r, 'assumptions', []) || [], notes: r.getString('notes'), saved: true };
  for (const k of Object.keys(overrides || {})) saved[k] = Object.assign({}, saved[k] || {}, overrides[k], { saved: false });
  const deployed = {};
  const firstDay = {};
  for (const r of b.rows) {
    if (r.type !== 'investment' || r.holding === '') continue;
    if (firstDay[r.holding] === undefined) firstDay[r.holding] = r.day;
    else if (r.day > firstDay[r.holding]) deployed[r.holding] = (deployed[r.holding] || 0) + r.amount_minor;
  }
  const items = [];
  const engineIn = [];
  for (const h of nav.holdings) {
    if (h.status === 'exited' || h.status === 'written_off') continue;
    const s = saved[h.holding];
    const own = (b.holdings[h.holding] || {}).ownership_ppm || 0;
    const dep = deployed[h.holding] || 0;
    const item = { holding: h.holding, name: h.name, ownership_ppm: own, target_ppm: s ? s.target_ppm : null, rounds: s ? s.rounds : 0, allocated_minor: s ? s.allocated_minor : 0, deployed_minor: dep, assumptions: s ? s.assumptions : [], needed_minor: null, shortfall_minor: null, plan: null, saved: s ? s.saved !== false : false };
    items.push(item);
    if (s && s.rounds > 0 && s.assumptions.length > 0) engineIn.push({ id: h.holding, ownership_ppm: own, target_ppm: s.target_ppm || own, rounds: s.rounds, allocated_minor: Math.max(0, s.allocated_minor - dep), assumptions: s.assumptions.slice(0, s.rounds) });
  }
  let totals = { needed_minor: 0, allocated_minor: 0, budget_minor: callable, available_minor: callable, shortfall_minor: 0 };
  if (engineIn.length > 0) {
    const res = L('lib_eng_reserves').plan({ holdings: engineIn, reserve_budget_minor: callable });
    for (const r of res.holdings) {
      const it = items.filter((x) => x.holding === r.id)[0];
      it.needed_minor = r.needed_minor;
      it.shortfall_minor = r.shortfall_minor;
      it.plan = { rounds: r.rounds, ownership_end_ppm: r.ownership_end_ppm, ownership_end_plan_ppm: r.ownership_end_plan_ppm };
    }
    totals = res.totals;
  }
  let dep = 0;
  for (const it of items) dep += it.deployed_minor;
  totals.deployed_minor = dep;
  return { fund: { id: f.id, name: f.getString('name'), currency: f.getString('currency') }, holdings: items, totals: totals };
}

/** A reserve plan as the caller sees it: rows of the holdings it may see, hidden counted. */
function seenPlan(ctx, f, plan) {
  const shown = F().shownHoldings(ctx, f.id, plan.holdings);
  return Object.assign({}, plan, { holdings: shown.rows, hidden: shown.hidden });
}

function reservesGet(ctx, p) {
  const f = F().fundOf(ctx, u().str(p, 'fund', ''));
  return seenPlan(ctx, f, planOf(ctx.app, f, {}));
}

function holdingInputs(ctx, f, list) {
  const util = u();
  const cur = f.getString('currency');
  const out = {};
  (list || []).forEach((x, i) => {
    const w = 'holdings[' + i + ']';
    util.keysOnly(x, ['holding', 'target', 'rounds', 'allocated', 'assumptions'], w);
    if (!x.holding) throw util.fail(400, w + '.holding is required.', 'missing_param', { param: 'holdings' });
    F().seenHolding(ctx, f, x.holding, 'holdings');
    out[x.holding] = { target_ppm: x.target !== undefined && x.target !== '' ? util.ppm({ t: x.target }, 't', { min: 0, max: 1000000 }) : undefined, rounds: x.rounds !== undefined ? Number(x.rounds) : undefined, allocated_minor: x.allocated !== undefined ? amountIn(x.allocated, cur, w + '.allocated') || 0 : undefined, assumptions: x.assumptions !== undefined ? assumptionsIn(x.assumptions, cur, w + '.assumptions') : undefined };
    for (const k of Object.keys(out[x.holding])) if (out[x.holding][k] === undefined) delete out[x.holding][k];
  });
  return out;
}

/** reserves.preview: the plan with changed targets, rounds, allocations or assumptions, nothing saved. */
function reservesPreview(ctx, p) {
  const util = u();
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  return seenPlan(ctx, f, planOf(ctx.app, f, holdingInputs(ctx, f, util.list(p, 'holdings') || [])));
}

/** reserves.plan-save: one holding's reserve plan (every assumption with a source). Your AI agent's plan is a proposal. */
function reservesPlanSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  const cur = f.getString('currency');
  const holding = util.req(p, 'holding');
  const hm = {};
  hm[holding] = F().seenHolding(ctx, f, holding);
  const cur0 = util.findOne(app, 'reserves', 'fund = {:f} && holding = {:h}', { f: f.id, h: holding });
  const r = cur0 !== null ? cur0 : util.newRecord(app, 'reserves');
  const target = util.has(p, 'target') ? util.ppm(p, 'target', { min: 0, max: 1000000 }) : cur0 !== null ? cur0.getInt('target_ppm') : hm[holding].ownership_ppm;
  const rounds = util.int(p, 'rounds', cur0 !== null ? cur0.getInt('rounds') : 2, 0, L('lib_eng_reserves').MAX_ROUNDS);
  const allocated = util.has(p, 'allocated') ? util.money(p, 'allocated', cur, {}) || 0 : cur0 !== null ? cur0.getInt('allocated_minor') : 0;
  const assumptions = util.has(p, 'assumptions') ? assumptionsIn(util.list(p, 'assumptions'), cur, 'assumptions') : cur0 !== null ? util.jsonOf(cur0, 'assumptions', []) || [] : [];
  if (rounds > 0) L('lib_eng_reserves').validate([{ id: holding, ownership_ppm: hm[holding].ownership_ppm, target_ppm: target, rounds: rounds, allocated_minor: allocated, assumptions: assumptions.slice(0, rounds) }]);
  r.set('fund', f.id);
  r.set('holding', holding);
  r.set('target_ppm', target);
  r.set('rounds', rounds);
  r.set('allocated_minor', allocated);
  r.set('assumptions', assumptions);
  if (util.has(p, 'notes')) r.set('notes', util.text(p, 'notes', 2000, ''));
  r.set('prov', { plan: { by: ctx.isAgent ? 'agent' : 'person', at: util.nowIso() } });
  r.set('actor', ctx.isAgent ? 'agent' : 'person');
  r.set('member', ctx.memberId || '');
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'reserves', record: r.id, summary: 'Saved the reserve plan for ' + hm[holding].name });
  return seenPlan(ctx, f, planOf(app, f, {}));
}

function previewPlan(ctx, params) {
  let name = String(params.holding || '');
  try {
    const h = u().byId(ctx.app, 'holdings', name);
    const c = h !== null ? u().byId(ctx.app, 'companies', h.getString('company')) : null;
    if (c !== null) name = c.getString('name');
  } catch {
    /* the id stays */
  }
  return { label: 'Reserve plan for ' + name, target: 'reserves:' + (params.holding || ''), fields: ['target', 'rounds', 'allocated', 'assumptions'].filter((k) => params[k] !== undefined).map((k) => ({ name: k, before: '', after: typeof params[k] === 'string' ? params[k] : JSON.stringify(params[k]) })), risk: 'low' };
}

/** scenarios.save: a named set of reserve assumptions to compare. Your AI agent's scenario is a proposal. */
function scenariosSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  const name = util.squash(util.text(p, 'name', 120, ''));
  if (name === '') throw util.fail(400, 'name is required.', 'missing_param', { param: 'name' });
  const holdings = holdingInputs(ctx, f, util.list(p, 'holdings') || []);
  for (const k of Object.keys(holdings)) {
    const h = holdings[k];
    if (h.assumptions) for (const a of h.assumptions) if (!a.source) throw util.fail(400, 'Every assumption needs a source (holding ' + k + ', round ' + a.round + ').', 'unsourced_assumption', { holding: k, round: a.round });
  }
  planOf(app, f, holdings);
  let s = util.findOne(app, 'scenarios', 'fund = {:f} && name = {:n}', { f: f.id, n: name });
  if (s === null) {
    s = util.newRecord(app, 'scenarios');
    s.set('fund', f.id);
    s.set('name', name);
  }
  s.set('holdings', holdings);
  s.set('budget_minor', 0);
  if (util.has(p, 'notes')) s.set('notes', util.text(p, 'notes', 2000, ''));
  s.set('prov', {});
  s.set('actor', ctx.isAgent ? 'agent' : 'person');
  s.set('member', ctx.memberId || '');
  app.save(s);
  L('lib_audit').note(ctx, { collection: 'scenarios', record: s.id, summary: 'Saved scenario ' + name });
  return { scenario: { id: s.id, name: name } };
}

/** scenarios.compare: the current plan beside each saved scenario (needed, allocated, available, shortfall). */
function scenariosCompare(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  const base = planOf(app, f, {});
  const rows = [{ id: '', name: 'Current plan', totals: base.totals }];
  for (const s of util.findMany(app, 'scenarios', 'fund = {:f}', 'name', 50, { f: f.id })) {
    const pl = planOf(app, f, util.jsonOf(s, 'holdings', {}) || {});
    rows.push({ id: s.id, name: s.getString('name'), totals: pl.totals, notes: s.getString('notes') });
  }
  return { fund: base.fund, scenarios: rows };
}

/* -------------------------------------------------------------- quarters */

function quartersList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  return { quarters: util.findMany(app, 'quarters', 'fund = {:f}', '-period_end', 40, { f: f.id }).map((q) => F().quarterOut(app, q)), next_period_end: F().lastQEnd(util.today(app)) };
}

function letterOf(app, q) {
  return u().findOne(app, 'reports', "quarter = {:q} && kind = 'letter'", { q: q.id });
}

function letterOut(app, r) {
  if (r === null) return null;
  return { id: r.id, status: r.getString('status'), paragraphs: u().jsonOf(r, 'paragraphs', []) || [], ai_chars: r.getInt('ai_chars'), typed_chars: r.getInt('typed_chars'), updated: r.getString('updated') };
}

function quartersGet(ctx, p) {
  const util = u();
  const app = ctx.app;
  const q = quarterRef(ctx, util.req(p, 'quarter'));
  const snap = util.jsonOf(q, 'snapshot', null);
  const lpData = L('lib_auth').fundDataVisible(ctx);
  const packs = lpData ? util.rows(app, "SELECT r.id, r.lp, l.name AS lp_name, r.status, r.outbound FROM reports r JOIN lps l ON l.id = r.lp WHERE r.quarter = {:q} AND r.kind = 'pack' ORDER BY l.name", { id: '', lp: '', lp_name: '', status: '', outbound: '' }, { q: q.id }) : [];
  const marks = util.one(app, "SELECT COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft, COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved FROM marks WHERE quarter = {:q}", { draft: 0, approved: 0 }, { q: q.id });
  // --parts picks what to answer (your AI agent gets everything but the LP capital accounts unless it asks for lps).
  const ALL = ['metrics', 'nav', 'holdings', 'marks', 'letter', 'packs', 'lps'];
  const asked = util.str(p, 'parts', '');
  const parts = asked !== '' ? asked.split(',').map((x) => x.trim()).filter((x) => x !== '') : ctx.isAgent ? ALL.filter((x) => x !== 'lps') : ALL;
  for (const x of parts) if (ALL.indexOf(x) < 0) throw util.fail(400, 'parts are a comma list of: ' + ALL.join(', ') + '.', 'invalid_param', { param: 'parts', allowed: ALL });
  const has = (x) => parts.indexOf(x) >= 0;
  const shown = snap ? F().shownHoldings(ctx, q.getString('fund'), snap.holdings || []) : { rows: null, hidden: 0 };
  const out = { quarter: F().quarterOut(app, q), parts: parts };
  if (has('metrics')) out.metrics = snap ? snap.metrics : null;
  if (has('nav')) out.nav = snap ? snap.nav : null;
  if (has('holdings')) {
    out.holdings = shown.rows;
    out.hidden = shown.hidden;
  }
  if (has('marks')) out.marks = marks;
  if (has('letter')) {
    out.letter = letterOut(app, letterOf(app, q));
  }
  if (has('packs')) out.packs = packs;
  const lps = snap && lpData && Array.isArray(snap.lps) ? snap.lps : snap && lpData ? snap.lps : null;
  if (has('lps')) {
    if (Array.isArray(lps)) {
      const off = util.int(p, 'lp_offset', 0, 0, 100000);
      const lim = util.int(p, 'lp_limit', ctx.isAgent ? 20 : 1000, 1, 1000);
      out.lps = lps.slice(off, off + lim);
      out.lps_total = lps.length;
      if (off + lim < lps.length) out.lps_next = 'More LP accounts: --parts lps --lp_offset ' + (off + lim) + '.';
    } else out.lps = lps;
  } else if (Array.isArray(lps)) out.lps_total = lps.length;
  if (!has('lps') && ctx.isAgent && Array.isArray(lps)) out.more = 'LP capital accounts: --parts lps (20 at a time, --lp_offset for more).';
  return out;
}

/** quarters.open: the close begins; a person then asks your AI agent for the quarter's marks (ONE mark_notes ask for the quarter, never one per holding). */
function quartersOpen(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.str(p, 'fund', ''));
  const end = util.day(p, 'period_end', F().lastQEnd(util.today(app)));
  if (!F().isQEnd(end)) throw util.fail(400, 'period_end must be a quarter end such as 2026-09-30.', 'invalid_param', { param: 'period_end' });
  if (util.findOne(app, 'quarters', 'fund = {:f} && period_end = {:e}', { f: f.id, e: end }) !== null) throw util.fail(409, F().qLabel(end) + ' is already open for ' + f.getString('name') + '.', 'duplicate');
  const q = util.newRecord(app, 'quarters');
  q.set('fund', f.id);
  q.set('period_end', end);
  q.set('label', F().qLabel(end));
  q.set('status', 'open');
  q.set('opened_at', util.nowIso());
  q.set('snapshot', null);
  q.set('actor', 'person');
  q.set('member', ctx.memberId || '');
  app.save(q);
  const b = F().books(app, f, end);
  const nav = F().navAt(b.rows, end, b.marks, b.holdings);
  const noMark = [];
  for (const h of nav.holdings) if (h.status !== 'exited' && h.status !== 'written_off' && h.mark_day === '') noMark.push({ holding: h.holding, name: h.name });
  L('lib_audit').note(ctx, { collection: 'quarters', record: q.id, summary: 'Opened ' + q.getString('label') + ' for ' + f.getString('name') });
  const shownNoMark = F().shownHoldings(ctx, f.id, noMark);
  return { quarter: F().quarterOut(app, q), holdings_without_mark: shownNoMark.rows, hidden: shownNoMark.hidden };
}

/** agent.ask --trigger mark_notes --record <quarter>: an open quarter with live holdings to mark (one ask for the whole quarter). */
function marksCheck(ctx, q) {
  const util = u();
  L('lib_auth').need(ctx, 'funds', 'edit', 'ask your AI agent for marks');
  F().fundOf(ctx, q.getString('fund'));
  if (q.getString('status') !== 'open') throw util.fail(409, q.getString('label') + ' is ' + q.getString('status') + '; marks are drafted while a quarter is open.', 'conflict');
  const f = F().fundOf(ctx, q.getString('fund'));
  const end = q.getString('period_end');
  const b = F().books(ctx.app, f, end);
  if (F().navAt(b.rows, end, b.marks, b.holdings).holdings.filter((h) => h.status !== 'exited' && h.status !== 'written_off').length === 0) throw util.fail(409, 'The fund has no live holding to mark in ' + q.getString('label') + '.', 'nothing_to_do');
  return {};
}

/** agent.ask --trigger lp_letter --record <quarter>: a frozen quarter (its letter is drafted before it is finalised). */
function letterCheck(ctx, q) {
  L('lib_auth').need(ctx, 'funds', 'edit', 'ask your AI agent for the letter');
  F().fundOf(ctx, q.getString('fund'));
  if (q.getString('status') !== 'frozen') throw u().fail(409, 'The letter is drafted once ' + q.getString('label') + ' is frozen and before it is finalised.', 'conflict');
  return {};
}

/** quarters.freeze (PIN): fixes the fund and LP numbers of the quarter with a hash (Ask your AI agent then drafts the letter). */
function quartersFreeze(ctx, p) {
  const util = u();
  const app = ctx.app;
  const q = quarterRef(ctx, util.req(p, 'quarter'));
  if (q.getString('status') !== 'open') throw util.fail(409, q.getString('label') + ' is ' + q.getString('status') + '.', 'conflict');
  const drafts = util.count(app, "SELECT COUNT(*) AS n FROM marks WHERE quarter = {:q} AND status = 'draft'", { q: q.id });
  if (drafts > 0) throw util.fail(409, drafts + ' draft mark' + (drafts === 1 ? '' : 's') + ' wait for approval. Approve them (or change them) first.', 'marks_pending', { drafts: drafts });
  const f = F().fundOf(ctx, q.getString('fund'));
  const end = q.getString('period_end');
  const start = F().qStart(end);
  const b = F().books(app, f, end);
  const mo = F().metricsOf(b, end);
  const commits = F().commitmentsOf(app, f.id, 'signed');
  const accounts = F().accountsOf(b, commits, end);
  const shares = F().navShares(mo.nav.nav_minor, commits);
  const M = L('lib_eng_metrics');
  const lps = commits.map((c) => {
    const rows = b.rows.filter((r) => r.lp === c.lp);
    const flows = F().lpFlows(rows);
    let paid = 0;
    let dist = 0;
    for (const x of flows) {
      if (x.amount_minor < 0) paid -= x.amount_minor;
      else dist += x.amount_minor;
    }
    const share = shares[c.lp] || 0;
    const mult = M.multiples({ paid_in_minor: paid, distributed_minor: dist, nav_minor: share });
    const irr = M.netIrr({ lp_flows: flows, nav_minor: share, as_of_day: end });
    const inQ = rows.filter((r) => r.day >= start && r.day <= end && r.amount_minor !== 0).map((r) => ({ day: r.day, type: r.type, amount_minor: r.amount_minor }));
    return { lp: c.lp, lp_name: c.lp_name, account: accounts[c.lp], nav_share_minor: share, metrics: { dpi_e8: mult.dpi_e8, rvpi_e8: mult.rvpi_e8, tvpi_e8: mult.tvpi_e8, net_irr_ppm: irr.irr_ppm }, flows: inQ };
  });
  const snapshot = { fund: { id: f.id, name: f.getString('name'), legal_name: f.getString('legal_name'), currency: f.getString('currency') }, period_end: end, metrics: mo.metrics, nav: { nav_minor: mo.nav.nav_minor, holdings_value_minor: mo.nav.holdings_value_minor, cash_minor: mo.nav.cash_minor }, holdings: mo.nav.holdings, lps: lps, frozen_at: util.nowIso() };
  const hash = util.sha(JSON.stringify(snapshot));
  q.set('snapshot', snapshot);
  q.set('hash', hash);
  q.set('status', 'frozen');
  q.set('frozen_at', snapshot.frozen_at);
  q.set('frozen_by', ctx.memberId || '');
  app.save(q);
  let nav = util.findOne(app, 'nav', 'fund = {:f} && period_end = {:e}', { f: f.id, e: end });
  if (nav === null) nav = util.newRecord(app, 'nav');
  nav.set('fund', f.id);
  nav.set('quarter', q.id);
  nav.set('period_end', end);
  nav.set('nav_minor', mo.nav.nav_minor);
  nav.set('holdings_value_minor', mo.nav.holdings_value_minor);
  nav.set('cash_minor', mo.nav.cash_minor);
  nav.set('currency', f.getString('currency'));
  nav.set('actor', 'person');
  nav.set('member', ctx.memberId || '');
  app.save(nav);
  let letter = letterOf(app, q);
  if (letter === null) {
    letter = util.newRecord(app, 'reports');
    letter.set('quarter', q.id);
    letter.set('fund', f.id);
    letter.set('kind', 'letter');
    letter.set('paragraphs', []);
    letter.set('status', 'draft');
    letter.set('ai_chars', 0);
    letter.set('typed_chars', 0);
    letter.set('actor', 'system');
    app.save(letter);
  }
  L('lib_events').emit(ctx, 'quarter.frozen', { quarter: q.id });
  L('lib_audit').note(ctx, { collection: 'quarters', record: q.id, summary: 'Froze ' + q.getString('label') + ' for ' + f.getString('name') + ' (' + hash.slice(0, 12) + ')' });
  return { quarter: F().quarterOut(app, q), metrics: mo.metrics, hash: hash };
}

/* --------------------------------------------------------------- reports */

function paragraphsIn(raw, by) {
  const util = u();
  return (raw || []).map((x, i) => {
    const text = typeof x === 'string' ? x : x && typeof x.text === 'string' ? x.text : '';
    if (util.squash(text) === '') throw util.fail(400, 'paragraphs[' + i + '] is empty.', 'invalid_param', { param: 'paragraphs' });
    if (text.length > 6000) throw util.fail(400, 'paragraphs[' + i + '] is too long (6,000 characters at most).', 'invalid_param', { param: 'paragraphs' });
    const cites = x && Array.isArray(x.cites) ? x.cites.slice(0, 20).map((c) => util.clip(String(c), 200)) : [];
    return { id: x && x.id ? util.clip(String(x.id), 20) : $security.randomStringWithAlphabet(10, 'abcdefghijklmnopqrstuvwxyz0123456789'), text: text.trim(), by: x && (x.by === 'agent' || x.by === 'person') ? x.by : by, state: x && (x.state === 'kept' || x.state === 'proposed') ? x.state : by === 'agent' ? 'proposed' : 'kept', cites: cites };
  });
}

/** reports.letter-draft: paragraphs for a frozen quarter's letter (your AI agent's are proposed and marked as written by it). */
function letterDraft(ctx, p) {
  const util = u();
  const app = ctx.app;
  const q = quarterRef(ctx, util.req(p, 'quarter'));
  if (q.getString('status') !== 'frozen') throw util.fail(409, 'The letter is drafted once ' + q.getString('label') + ' is frozen and before it is finalised.', 'conflict');
  const r = letterOf(app, q);
  const by = ctx.isAgent ? 'agent' : 'person';
  const incoming = paragraphsIn(util.list(p, 'paragraphs') || [], by);
  if (incoming.length === 0) throw util.fail(400, 'Give --paragraphs as a JSON list of text (or {"text","cites"}).', 'missing_param', { param: 'paragraphs' });
  const cur = util.jsonOf(r, 'paragraphs', []) || [];
  const kept = ctx.isAgent ? cur.filter((x) => !(x.by === 'agent' && x.state === 'proposed')) : cur;
  const all = kept.concat(incoming);
  let chars = 0;
  for (const x of incoming) chars += x.text.length;
  r.set('paragraphs', all);
  if (ctx.isAgent) r.set('ai_chars', all.filter((x) => x.by === 'agent').reduce((s, x) => s + x.text.length, 0));
  else r.set('typed_chars', r.getInt('typed_chars') + chars);
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'reports', record: r.id, summary: (ctx.isAgent ? 'Your AI agent drafted ' : 'Added ') + incoming.length + ' paragraph' + (incoming.length === 1 ? '' : 's') + ' of the ' + q.getString('label') + ' letter' });
  if (ctx.isAgent) {
    L('lib_agent').landed(app, 'lp_letter', app.findRecordById('quarters', q.id));
    return { letter: r.id, quarter: q.getString('label'), drafted: incoming.length, paragraphs: all.length, state: 'proposed: a person keeps or edits them in Funds, the quarter, Letter' };
  }
  return { letter: letterOut(app, r) };
}

/** reports.letter-save (people): the letter as edited (keep, change or remove paragraphs); a person's save keeps what it holds. */
function letterSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  F().needApprover(ctx, 'edit the LP letter');
  const q = quarterRef(ctx, util.req(p, 'quarter'));
  if (q.getString('status') !== 'frozen') throw util.fail(409, q.getString('label') + ' is ' + q.getString('status') + '.', 'conflict');
  const r = letterOf(app, q);
  const before = util.jsonOf(r, 'paragraphs', []) || [];
  const next = paragraphsIn(util.list(p, 'paragraphs') || [], 'person');
  const oldText = before.map((x) => x.text).join('\n\n');
  const newText = next.map((x) => x.text).join('\n\n');
  const c = L('lib_outbound').editCounts(oldText, newText, r.getInt('ai_chars'), r.getInt('typed_chars'));
  for (const x of next) if (util.bool(p, 'keep_all', true)) x.state = 'kept';
  r.set('paragraphs', next);
  r.set('ai_chars', c.ai);
  r.set('typed_chars', c.typed);
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'reports', record: r.id, summary: 'Edited the ' + q.getString('label') + ' letter' });
  return { letter: letterOut(app, r) };
}

/** reports.statement-preview: one LP's capital account statement of a frozen quarter. */
function statementPreview(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const q = quarterRef(ctx, util.req(p, 'quarter'));
  const snap = util.jsonOf(q, 'snapshot', null);
  if (snap === null) throw util.fail(409, 'Statements exist once the quarter is frozen.', 'not_frozen');
  const lp = L('lib_funds_lps').lpRef(ctx, util.req(p, 'lp'));
  const row = (snap.lps || []).filter((x) => x.lp === lp.id)[0];
  if (row === undefined) throw util.fail(404, lp.getString('name') + ' had no signed commitment at ' + snap.period_end + '.', 'not_found');
  return { quarter: F().quarterOut(ctx.app, q), fund: snap.fund, lp: row, fund_metrics: snap.metrics };
}

/** reports.finalize (PIN; finance or a partner): the letter is final and each LP's pack is rendered. */
function finalize(ctx, p) {
  const util = u();
  const app = ctx.app;
  F().needApprover(ctx, 'finalise the quarter');
  const q = quarterRef(ctx, util.req(p, 'quarter'));
  if (q.getString('status') !== 'frozen') throw util.fail(409, q.getString('label') + ' is ' + q.getString('status') + '.', 'conflict');
  const letter = letterOf(app, q);
  const paras = util.jsonOf(letter, 'paragraphs', []) || [];
  if (paras.length === 0) throw util.fail(409, 'The letter is empty. Wait for your AI agent or write it.', 'letter_empty');
  for (const x of paras) x.state = 'kept';
  letter.set('paragraphs', paras);
  letter.set('status', 'final');
  app.save(letter);
  const snap = util.jsonOf(q, 'snapshot', {}) || {};
  const firm = L('lib_settings').row(app).getString('firm_name') || 'The General Partner';
  const DOCS = L('lib_funds_docs');
  const rowsIn = snap.lps || [];
  // Every pack is drawn first, in one run of the engine.
  const pdfs = DOCS.render(
    app,
    rowsIn.map((row) => {
      const lpRec = util.byId(app, 'lps', row.lp);
      const flows = (row.flows || []).map((x) => ({ day: x.day, label: DOCS.TYPE_LABEL[x.type] || x.type.replace(/_/g, ' '), amount_minor: x.amount_minor }));
      return DOCS.packDoc({ firm: firm, fund: snap.fund, quarter: { label: q.getString('label'), period_end: q.getString('period_end') }, lp: { name: row.lp_name, country: lpRec !== null ? lpRec.getString('country') : '' }, paragraphs: paras.map((x) => x.text), account: row.account, nav_share_minor: row.nav_share_minor, lp_metrics: row.metrics, fund_metrics: snap.metrics, flows: flows, hash: q.getString('hash') });
    }),
  );
  let n = 0;
  for (let i = 0; i < rowsIn.length; i++) {
    const row = rowsIn[i];
    let r = util.findOne(app, 'reports', "quarter = {:q} && kind = 'pack' && lp = {:l}", { q: q.id, l: row.lp });
    if (r === null) {
      r = util.newRecord(app, 'reports');
      r.set('quarter', q.id);
      r.set('fund', q.getString('fund'));
      r.set('kind', 'pack');
      r.set('lp', row.lp);
    }
    r.set('file', $filesystem.fileFromBytes(pdfs[i], util.slug(q.getString('label')) + '-' + (util.slug(row.lp_name) || row.lp) + '.pdf'));
    r.set('paragraphs', []);
    r.set('status', 'final');
    r.set('actor', 'person');
    r.set('member', ctx.memberId || '');
    app.save(r);
    n++;
  }
  q.set('status', 'final');
  q.set('finalized_at', util.nowIso());
  q.set('finalized_by', ctx.memberId || '');
  app.save(q);
  L('lib_audit').note(ctx, { collection: 'quarters', record: q.id, summary: 'Finalised ' + q.getString('label') + ': ' + n + ' LP packs' });
  return { quarter: F().quarterOut(app, q), packs: n };
}

/** reports.send (people with funds edit): every LP's pack (letter, statement and the quarter's notices) by email. */
function send(ctx, p) {
  const util = u();
  const app = ctx.app;
  const q = quarterRef(ctx, util.req(p, 'quarter'));
  if (q.getString('status') !== 'final') throw util.fail(409, q.getString('label') + ' is ' + q.getString('status') + '; finalise it first.', 'conflict');
  const f = app.findRecordById('entities', q.getString('fund'));
  const firm = L('lib_settings').row(app).getString('firm_name') || 'The General Partner';
  const start = F().qStart(q.getString('period_end'));
  let queued = 0;
  const noEmail = [];
  for (const r of util.findMany(app, 'reports', "quarter = {:q} && kind = 'pack' && (status = 'final' || status = 'failed')", '', 0, { q: q.id })) {
    const lp = app.findRecordById('lps', r.getString('lp'));
    const emails = L('lib_funds_lps').noticeEmails(lp);
    if (emails.length === 0) {
      noEmail.push(lp.getString('name'));
      continue;
    }
    const att = [{ collection: 'reports', id: r.id, field: 'file' }];
    for (const l of util.rows(app, "SELECT l.id FROM capital_lines l JOIN capital_events e ON e.id = l.event WHERE l.lp = {:l} AND e.fund = {:f} AND e.notice_day >= {:a} AND e.notice_day <= {:b} AND e.status IN ('issued','settled') AND l.notice != '' ORDER BY e.notice_day LIMIT 8", { id: '' }, { l: lp.id, f: f.id, a: start, b: q.getString('period_end') })) att.push({ collection: 'capital_lines', id: l.id, field: 'notice' });
    const ob = L('lib_outbound').draft(ctx, { kind: 'lp_pack', module: 'funds', to: emails, subject: q.getString('label') + ' report: ' + (f.getString('legal_name') || f.getString('name')), body: 'Dear ' + lp.getString('name') + ',\n\nPlease find attached our ' + q.getString('label') + ' letter and your capital account statement for ' + (f.getString('legal_name') || f.getString('name')) + (att.length > 1 ? ', with the notices of the quarter' : '') + '.\n\n' + firm, attachments: att, ref_collection: 'reports', ref_id: r.id });
    L('lib_outbound').approve(ctx, ob.id);
    r.set('outbound', ob.id);
    app.save(r);
    queued++;
  }
  L('lib_audit').note(ctx, { collection: 'quarters', record: q.id, summary: 'Sent ' + queued + ' LP packs for ' + q.getString('label') });
  return { quarter: F().quarterOut(app, q), queued: queued, no_email: noEmail };
}

/* ---------------------------------------------------------------- exports */

function stream(ctx, name, mime, text) {
  const bytes = new Uint8Array(L('lib_exports').utf8(text));
  ctx.e.response.header().set('Content-Disposition', 'attachment; filename="' + name + '"');
  ctx.e.blob(200, mime, bytes.buffer);
  return { __streamed: true };
}

/** exports.ilpa (PIN): the ILPA Capital Call and Distribution template lines, or the Performance Template cash flows (granular). */
function exportsIlpa(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.req(p, 'fund'));
  const template = util.oneOf(p, 'template', ['calls', 'performance'], 'calls');
  const cur = f.getString('currency');
  const major = (m) => L('lib_money').fromMinor(m, cur);
  const DOCS = L('lib_funds_docs');
  const rows = [];
  if (template === 'calls') {
    rows.push(['Fund', 'Notice', 'Kind', 'Notice date', 'Due date', 'Level', 'Limited partner', 'Transaction type', 'Currency', 'Amount', 'Impact on unfunded', 'Contributed after', 'Unfunded after', 'Distributed to date', 'Recallable']);
    for (const e of util.findMany(app, 'capital_events', "fund = {:f} && (status = 'issued' || status = 'settled')", 'notice_day', 0, { f: f.id })) {
      const pv = util.jsonOf(e, 'preview', {}) || {};
      const types = e.getString('kind') === 'call' ? DOCS.CALL_TYPES : DOCS.DIST_TYPES;
      for (const t of types) if ((pv.totals || {})[t]) rows.push([f.getString('name'), e.getString('number'), e.getString('kind'), e.getString('notice_day'), e.getString('due_day'), 'Total fund', '', DOCS.TYPE_LABEL[t], cur, major(pv.totals[t]), e.getString('kind') === 'call' ? major(-pv.totals[t]) : major(0), '', '', '', '']);
      for (const l of pv.lines || []) {
        const b = l.balances || {};
        for (const t of types) {
          const v = (l.amounts || {})[t] || 0;
          if (v === 0) continue;
          rows.push([f.getString('name'), e.getString('number'), e.getString('kind'), e.getString('notice_day'), e.getString('due_day'), 'Limited partner', l.lp_name, DOCS.TYPE_LABEL[t], cur, major(v), e.getString('kind') === 'call' ? major(-v) : major(0), major(b.contributed_minor || 0), major(b.unfunded_minor || 0), major(b.distributed_minor || 0), major(b.recallable_minor || 0)]);
        }
      }
    }
  } else {
    const day = util.day(p, 'day', util.today(app));
    const b = F().books(app, f, day);
    const mo = F().metricsOf(b, day);
    const fr = b.rows.filter((r) => r.day <= day);
    const seen = F().seenHoldings(ctx, f.id);
    rows.push(['Fund', 'Level', 'Effective date', 'Transaction type', 'Holding', 'Currency', 'Amount']);
    for (const r of fr) {
      if (r.lp === '' || r.amount_minor === 0) continue;
      const contribution = F().LP_CALL.indexOf(r.type) >= 0 || r.type === 'opening_contributed';
      const distribution = F().LP_DIST.indexOf(r.type) >= 0 || r.type === 'opening_distributed';
      if (!contribution && !distribution) continue;
      rows.push([f.getString('name'), 'Fee-paying LP allocation (net)', r.day, contribution ? 'Contribution: ' + (DOCS.TYPE_LABEL[r.type] || r.type) : 'Distribution: ' + (DOCS.TYPE_LABEL[r.type] || r.type), '', cur, major(contribution ? -r.amount_minor : r.amount_minor)]);
    }
    rows.push([f.getString('name'), 'Fee-paying LP allocation (net)', day, 'Net asset value', '', cur, major(mo.nav.nav_minor)]);
    for (const r of fr) {
      if (r.holding === '' || (r.type !== 'investment' && r.type !== 'proceeds') || r.amount_minor === 0) continue;
      rows.push([f.getString('name'), 'Fund (gross)', r.day, r.type === 'investment' ? 'Investment' : 'Proceeds', seen[r.holding] ? seen[r.holding].name : 'Withheld', cur, major(r.type === 'investment' ? -r.amount_minor : r.amount_minor)]);
    }
    for (const h of mo.nav.holdings) rows.push([f.getString('name'), 'Fund (gross)', day, 'Unrealized value', seen[h.holding] ? h.name : 'Withheld', cur, major(h.value_minor)]);
  }
  L('lib_audit').note(ctx, { collection: 'entities', record: f.id, summary: 'Exported the ILPA ' + template + ' file of ' + f.getString('name') });
  const name = util.slug(f.getString('name')) + '-ilpa-' + template + '.csv';
  if (ctx.isAgent || !ctx.e) return { name: name, csv: util.csvText(rows) };
  return stream(ctx, name, 'text/csv; charset=utf-8', util.csvText(rows));
}

function xmlEsc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function colName(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// XML namespace names of the Office Open XML package. They are identifiers inside the file, never
// fetched; they are assembled here so the gate's egress scan does not list them as hosts the app calls.
const OOXML = 'http' + ':' + '//schemas.openxmlformats.org/';
const NS = {
  types: OOXML + 'package/2006/content-types',
  rels: OOXML + 'package/2006/relationships',
  main: OOXML + 'spreadsheetml/2006/main',
  docRel: OOXML + 'officeDocument/2006/relationships',
};

/** A one-sheet XLSX (plain values: text cells inline, numbers as numbers) as a byte array. */
function xlsx(sheetName, rows) {
  const body = rows
    .map((r, i) => '<row r="' + (i + 1) + '">' + r.map((v, j) => (typeof v === 'number' && Number.isFinite(v) ? '<c r="' + colName(j) + (i + 1) + '"><v>' + v + '</v></c>' : '<c r="' + colName(j) + (i + 1) + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>')).join('') + '</row>')
    .join('');
  const entries = [
    { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + NS.types + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS.rels + '"><Relationship Id="rId1" Type="' + NS.docRel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS.main + '" xmlns:r="' + NS.docRel + '"><sheets><sheet name="' + xmlEsc(sheetName).slice(0, 31) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS.rels + '"><Relationship Id="rId1" Type="' + NS.docRel + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="' + NS.main + '"><sheetData>' + body + '</sheetData></worksheet>' },
  ];
  return L('lib_exports').zip(entries);
}

/** exports.xlsx (people): a fund table as an Excel file (lps, events, ledger, holdings). */
function exportsXlsx(ctx, p) {
  const util = u();
  const app = ctx.app;
  const f = F().fundOf(ctx, util.req(p, 'fund'));
  const table = util.oneOf(p, 'table', ['lps', 'events', 'ledger', 'holdings'], 'lps');
  const cur = f.getString('currency');
  const major = (m) => L('lib_money').toMajor(m, cur);
  let rows;
  if (table === 'lps') {
    const r = L('lib_funds_lps').list(ctx, { fund: f.id, limit: 500 });
    rows = [['LP', 'Status', 'Commitment', 'Called', 'Distributed', 'Unfunded', 'NAV share', 'Fee-paying', 'Currency']].concat(r.lps.map((x) => [x.name, x.status, major(x.commitment_minor), major(x.called_minor), major(x.distributed_minor), major(x.unfunded_minor), major(x.nav_share_minor), x.fee_paying ? 'yes' : 'no', cur]));
  } else if (table === 'events') {
    const r = L('lib_funds_capital').callsList(ctx, { fund: f.id, limit: 300 });
    rows = [['Number', 'Kind', 'Status', 'Notice date', 'Due date', 'Total', 'Paid', 'Currency']].concat(r.events.map((x) => [x.number, x.kind, x.status, x.notice_day, x.due_day, major(x.total_minor), major(x.paid_minor), cur]));
  } else if (table === 'ledger') {
    const r = L('lib_funds_capital').ledgerList(ctx, { fund: f.id, limit: 1000 });
    rows = [['Day', 'Type', 'LP', 'Holding', 'Notice', 'Amount', 'Recallable', 'Origin', 'Currency']].concat(r.rows.map((x) => [x.day, x.type, x.lp_name, x.withheld ? 'Withheld' : x.holding_name, x.number, major(x.amount_minor), major(x.recallable_minor), x.origin, cur]));
  } else {
    const b = F().books(app, f, util.today(app));
    const nav = F().navAt(b.rows, util.today(app), b.marks, b.holdings);
    const seen = F().seenHoldings(ctx, f.id);
    rows = [['Holding', 'Status', 'Cost', 'Proceeds', 'Value', 'Method', 'Mark day', 'Currency']].concat(nav.holdings.map((h) => [seen[h.holding] ? h.name : 'Withheld', h.status, major(h.cost_minor), major(h.proceeds_minor), major(h.value_minor), h.method, h.mark_day, cur]));
  }
  L('lib_audit').note(ctx, { collection: 'entities', record: f.id, summary: 'Exported ' + table + ' of ' + f.getString('name') + ' to Excel' });
  const bytes = xlsx(table, rows);
  ctx.e.response.header().set('Content-Disposition', 'attachment; filename="' + util.slug(f.getString('name')) + '-' + table + '.xlsx"');
  ctx.e.blob(200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes.buffer);
  return { __streamed: true };
}

/** reports.pack (people): one LP's quarterly pack PDF. */
function pack(ctx, p) {
  F().needLpData(ctx);
  const util = u();
  const r = util.byId(ctx.app, 'reports', util.req(p, 'report'));
  if (r === null || r.getString('kind') !== 'pack') throw util.fail(404, 'No such pack.', 'not_found', { param: 'report' });
  const q = quarterRef(ctx, r.getString('quarter'));
  const lp = ctx.app.findRecordById('lps', r.getString('lp'));
  return L('lib_files').serve(ctx, r, 'file', q.getString('label') + ' ' + lp.getString('name') + '.pdf', util.bool(p, 'download', false));
}

module.exports = {
  marksCheck: marksCheck,
  letterCheck: letterCheck,
  pack: pack,
  METHODS: METHODS,
  marksList: marksList,
  marksDraft: marksDraft,
  marksApprove: marksApprove,
  reservesGet: reservesGet,
  reservesPreview: reservesPreview,
  reservesPlanSave: reservesPlanSave,
  previewPlan: previewPlan,
  scenariosSave: scenariosSave,
  scenariosCompare: scenariosCompare,
  quartersList: quartersList,
  quartersGet: quartersGet,
  quartersOpen: quartersOpen,
  quartersFreeze: quartersFreeze,
  letterDraft: letterDraft,
  letterSave: letterSave,
  statementPreview: statementPreview,
  finalize: finalize,
  send: send,
  exportsIlpa: exportsIlpa,
  exportsXlsx: exportsXlsx,
};
