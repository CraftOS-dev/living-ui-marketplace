/// <reference path="../pb_data/types.d.ts" />
/**
 * Reports and the Home dashboard, all in the home currency (minor units).
 *
 * Definitions (shown to the person as tooltips):
 *   open pipeline     sum of open deals' values at the latest rate
 *   weighted          sum of value x probability over open deals
 *   win rate          won / (won + lost) among deals closed in the period
 *   average deal      won value / won deals in the period
 *   sales cycle       average days from a won deal's creation to its close
 *   conversion        share of the deals created in the period that reached
 *                     each stage (first entry counts; a later stage implies
 *                     the earlier ones; won deals passed every open stage)
 *   forecast          per month: won (by close date) plus open deals by
 *                     expected close, weighted (overdue ones count now)
 *   time in stage     days spent per stage (finished stays and the current
 *                     one so far), min / average / max
 * Deals in another currency without a rate are left out and counted.
 *
 * Revenue: the headline numbers, the forecast, won and lost and sources
 * count revenue pipelines only (every kind but fundraising and hiring), so a
 * seed round or a salary never shows up as sales. Those pipelines get their
 * own Home panels (committed against the round target, hires) and every
 * report takes an explicit pipeline.
 */

const NON_REVENUE = { fundraising: true, hiring: true };

function U() {
  return require(`${__hooks}/lib_util.js`);
}

function D() {
  return require(`${__hooks}/lib_dates.js`);
}

function days(a, b) {
  const x = Date.parse(String(a).replace(' ', 'T'));
  const y = Date.parse(String(b).replace(' ', 'T'));
  if (!isFinite(x) || !isFinite(y)) return null;
  return (y - x) / 86400000;
}

function ymd(s) {
  return String(s || '').slice(0, 10);
}

/** Every non-deleted deal as a row (lib_query), optionally in one pipeline. */
function dealRows(app, pipeline) {
  return require(`${__hooks}/lib_query.js`).list(app, 'deals', { pipeline: pipeline || '', limit: 100000 }).rows;
}

/** Ids of the revenue pipelines (archived ones included: their history counts). */
function revenueIds(app) {
  const out = {};
  for (const p of app.findRecordsByFilter('pipelines', 'id != ""', '', 0, 0)) if (!NON_REVENUE[p.getString('kind')]) out[p.id] = true;
  return out;
}

/**
 * The deal rows a report runs on: one pipeline when ref is given, else the
 * revenue pipelines. rows (all deals, already built) saves building them again.
 */
function scoped(app, ref, rows) {
  if (ref) {
    const id = require(`${__hooks}/lib_deals.js`).pipelineByRef(app, ref).id;
    return (rows || dealRows(app, id)).filter((d) => d.pipeline === id);
  }
  const rev = revenueIds(app);
  return (rows || dealRows(app, '')).filter((d) => rev[d.pipeline]);
}

function resolveRange(app, p) {
  const u = U();
  const dates = D();
  const name = u.oneOf(p, 'range', ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'ytd', 'this_year', 'last_year', 'last_12_months', 'custom'], 'this_quarter');
  let r = name === 'custom' ? null : dates.range(name, 1);
  if (!r) r = { from: dates.parse(u.req(p, 'from'), 'from'), to: dates.parse(u.req(p, 'to'), 'to') };
  if (u.str(p, 'from', '') !== '' && name === 'custom') r.from = dates.parse(u.str(p, 'from', ''), 'from');
  const prev = dates.compareRange(r.from, ymd(r.to), name === 'ytd' ? 'previous_year' : 'previous');
  return { name: name, from: r.from, to: ymd(r.to), prev_from: prev.from, prev_to: prev.to };
}

/* ----------------------------------------------------------------- pieces */

function closedIn(rows, from, to, status) {
  return rows.filter((d) => d.status === status && d.closed_at !== '' && d.closed_at >= from && d.closed_at <= to);
}

function sum(rows, f) {
  let s = 0;
  for (const r of rows) if (r[f] !== null && r[f] !== undefined) s += r[f];
  return s;
}

function winStats(rows, from, to) {
  const won = closedIn(rows, from, to, 'won');
  const lost = closedIn(rows, from, to, 'lost');
  const wonValue = sum(won, 'home_value');
  const cycles = won.map((d) => days(d.created, d.closed_at + 'T12:00:00Z')).filter((x) => x !== null && x >= 0);
  return {
    won: won.length,
    lost: lost.length,
    won_value: wonValue,
    lost_value: sum(lost, 'home_value'),
    win_rate: won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 1000) / 10 : null,
    avg_deal: won.length > 0 ? Math.round(wonValue / won.length) : null,
    cycle_days: cycles.length > 0 ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
  };
}

/** A pipeline's target (a round size) in the home currency; null without a rate. */
function targetHome(app, pipe) {
  const fx = require(`${__hooks}/lib_fx.js`);
  const t = pipe.getFloat('target');
  if (!t) return 0;
  const home = fx.home(app);
  const c = pipe.getString('currency') || home;
  return fx.toHome(t, c, home, c === home ? '' : fx.rateFor(app, c, ''));
}

/** Open deals by stage of one pipeline, plus its won and lost to date. */
function pipelineReport(app, pipelineRef, allRows) {
  const deals = require(`${__hooks}/lib_deals.js`);
  const pipe = deals.pipelineByRef(app, pipelineRef || '');
  const stages = deals.stagesOf(app, pipe.id);
  const mine = allRows ? allRows.filter((d) => d.pipeline === pipe.id) : dealRows(app, pipe.id);
  const rows = mine.filter((d) => d.status === 'open');
  const won = mine.filter((d) => d.status === 'won');
  const out = stages
    .filter((s) => s.getString('kind') === 'open')
    .map((s) => {
      const ds = rows.filter((d) => d.stage === s.id);
      return { id: s.id, name: s.getString('name'), color: s.getString('color'), probability: s.getFloat('probability'), count: ds.length, value: sum(ds, 'home_value'), weighted: sum(ds, 'weighted'), rotting: ds.filter((d) => d.rotting).length };
    });
  return {
    pipeline: { id: pipe.id, name: pipe.getString('name'), kind: pipe.getString('kind') || 'other', target: pipe.getFloat('target'), currency: pipe.getString('currency'), target_home: targetHome(app, pipe) },
    stages: out,
    total: { count: rows.length, value: sum(rows, 'home_value'), weighted: sum(rows, 'weighted') },
    won: { count: won.length, value: sum(won, 'home_value') },
    lost: mine.filter((d) => d.status === 'lost').length,
    no_rate: rows.filter((d) => d.home_value === null).length,
    deals: rows,
  };
}

/** Share of the deals created in the period that reached each stage. */
function funnel(app, pipelineRef, from, to) {
  const deals = require(`${__hooks}/lib_deals.js`);
  const pipe = deals.pipelineByRef(app, pipelineRef || '');
  const stages = deals.stagesOf(app, pipe.id);
  const order = {};
  stages.forEach((s, i) => (order[s.id] = { i: i, kind: s.getString('kind') }));
  const openStages = stages.filter((s) => s.getString('kind') === 'open');
  const wonStage = stages.find((s) => s.getString('kind') === 'won');
  const cohort = dealRows(app, pipe.id).filter((d) => ymd(d.created) >= from && ymd(d.created) <= to);
  const reached = {};
  for (const s of stages) reached[s.id] = 0;
  for (const d of cohort) {
    const evs = app.findRecordsByFilter('stage_events', 'deal = {:d}', 'at', 0, 0, { d: d.id });
    let maxOpen = -1;
    for (const e of evs) {
      const o = order[e.getString('to_stage')];
      if (o && o.kind === 'open') maxOpen = Math.max(maxOpen, o.i);
    }
    if (d.status === 'won') maxOpen = 1e9;
    for (const s of openStages) if (order[s.id].i <= maxOpen) reached[s.id]++;
    if (d.status === 'won' && wonStage) reached[wonStage.id]++;
  }
  const n = cohort.length;
  const list = openStages.concat(wonStage ? [wonStage] : []);
  let prev = n;
  return {
    pipeline: { id: pipe.id, name: pipe.getString('name') },
    from: from,
    to: to,
    deals: n,
    win_rate: n > 0 && wonStage ? Math.round((reached[wonStage.id] / n) * 1000) / 10 : null,
    stages: list.map((s) => {
      const r = reached[s.id];
      const row = { id: s.id, name: s.getString('name'), kind: s.getString('kind'), color: s.getString('color'), reached: r, pct: n > 0 ? Math.round((r / n) * 1000) / 10 : 0, from_prev: prev > 0 ? Math.round((r / prev) * 1000) / 10 : 0 };
      prev = r;
      return row;
    }),
  };
}

/** Won plus open (weighted and best case) by month, from this month forward. */
function forecast(app, pipelineRef, months, allRows) {
  const dates = D();
  const t = dates.today();
  const start = dates.monthStart(t);
  const rows = scoped(app, pipelineRef, allRows);
  const n = months || 6;
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = dates.addMonths(start, i);
    const end = dates.monthEnd(m);
    const won = rows.filter((d) => d.status === 'won' && d.closed_at >= m && d.closed_at <= end);
    const open = rows.filter((d) => d.status === 'open' && d.expected_close !== '' && ((d.expected_close >= m && d.expected_close <= end) || (i === 0 && d.expected_close < m)));
    out.push({ month: m.slice(0, 7), won: sum(won, 'home_value'), weighted: sum(open, 'weighted'), best: sum(open, 'home_value'), deals: open.length });
  }
  const undated = rows.filter((d) => d.status === 'open' && d.expected_close === '');
  return { months: out, undated: { count: undated.length, value: sum(undated, 'home_value'), weighted: sum(undated, 'weighted') } };
}

/** Won and lost by month over the range, the win rate and the lost reasons. */
function winloss(app, pipelineRef, from, to, allRows) {
  const dates = D();
  const rows = scoped(app, pipelineRef, allRows);
  const monthsList = [];
  for (let m = dates.monthStart(from); m <= to; m = dates.addMonths(m, 1)) monthsList.push(m);
  const byMonth = monthsList.map((m) => {
    const end = dates.monthEnd(m);
    const s = winStats(rows, m, end);
    return { month: m.slice(0, 7), won: s.won_value, lost: s.lost_value, won_count: s.won, lost_count: s.lost, win_rate: s.win_rate };
  });
  const reasons = {};
  for (const d of closedIn(rows, from, to, 'lost')) {
    const k = d.lost_reason || 'No reason given';
    const x = (reasons[k] = reasons[k] || { reason: k, count: 0, value: 0 });
    x.count++;
    x.value += d.home_value || 0;
  }
  return {
    from: from,
    to: to,
    stats: winStats(rows, from, to),
    months: byMonth,
    reasons: Object.keys(reasons)
      .map((k) => reasons[k])
      .sort((a, b) => b.count - a.count),
    deals: closedIn(rows, from, to, 'won').concat(closedIn(rows, from, to, 'lost')),
  };
}

/** Days per stage: min, average, max over stays that ended in the range or are still running. */
function stageTime(app, pipelineRef, from, to) {
  const deals = require(`${__hooks}/lib_deals.js`);
  const pipe = deals.pipelineByRef(app, pipelineRef || '');
  const stages = deals.stagesOf(app, pipe.id).filter((s) => s.getString('kind') === 'open');
  const spans = {};
  for (const s of stages) spans[s.id] = [];
  const live = {};
  for (const d of dealRows(app, pipe.id)) live[d.id] = true;
  const evs = app.findRecordsByFilter('stage_events', 'pipeline = {:p}', 'deal,at', 0, 0, { p: pipe.id });
  const nowIso = new Date().toISOString();
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (!live[e.getString('deal')]) continue;
    const st = e.getString('to_stage');
    if (!spans[st]) continue;
    const next = evs[i + 1] && evs[i + 1].getString('deal') === e.getString('deal') ? evs[i + 1].getString('at') : null;
    const end = next || nowIso;
    if (ymd(end) < from || ymd(e.getString('at')) > to) continue;
    const d = days(e.getString('at'), end);
    if (d !== null) spans[st].push(d);
  }
  return {
    pipeline: { id: pipe.id, name: pipe.getString('name') },
    stages: stages.map((s) => {
      const v = spans[s.id];
      return {
        id: s.id,
        name: s.getString('name'),
        color: s.getString('color'),
        target_days: s.getInt('target_days'),
        count: v.length,
        min: v.length ? Math.round(Math.min.apply(null, v) * 10) / 10 : null,
        avg: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null,
        max: v.length ? Math.round(Math.max.apply(null, v) * 10) / 10 : null,
      };
    }),
  };
}

/** Deals by source: count, won, win rate and won value; people by source. */
function sources(app, from, to, pipelineRef, allRows) {
  const rows = scoped(app, pipelineRef || '', allRows).filter((d) => ymd(d.created) >= from && ymd(d.created) <= to);
  const by = {};
  for (const d of rows) {
    const k = d.source || 'Unknown';
    const x = (by[k] = by[k] || { source: k, deals: 0, won: 0, lost: 0, won_value: 0, open_value: 0 });
    x.deals++;
    if (d.status === 'won') {
      x.won++;
      x.won_value += d.home_value || 0;
    } else if (d.status === 'lost') x.lost++;
    else x.open_value += d.home_value || 0;
  }
  const people = {};
  for (const p of app.findRecordsByFilter('people', "deleted = '' && created >= {:f} && created <= {:t}", '', 0, 0, { f: from, t: to + ' 23:59:59' })) {
    const k = p.getString('source') || 'Unknown';
    people[k] = (people[k] || 0) + 1;
  }
  return {
    from: from,
    to: to,
    deals: Object.keys(by)
      .map((k) => Object.assign(by[k], { win_rate: by[k].won + by[k].lost > 0 ? Math.round((by[k].won / (by[k].won + by[k].lost)) * 100) : null }))
      .sort((a, b) => b.deals - a.deals),
    people: Object.keys(people)
      .map((k) => ({ source: k, count: people[k] }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Interactions per week by kind, the people touched most, tasks done. */
function activity(app, from, to) {
  const dates = D();
  const rows = app.findRecordsByFilter('interactions', 'at >= {:f} && at <= {:t}', 'at', 0, 0, { f: from, t: to + 'T23:59:59Z' });
  const weekOf = (d) => {
    const dt = new Date(d + 'T00:00:00Z');
    const dow = (dt.getUTCDay() + 6) % 7;
    return dates.addDays(d, -dow);
  };
  const weeks = {};
  for (let w = weekOf(from); w <= to; w = dates.addDays(w, 7)) weeks[w] = { week: w, email: 0, call: 0, meeting: 0, message: 0 };
  const byKind = { email: 0, call: 0, meeting: 0, message: 0 };
  const people = {};
  for (const r of rows) {
    const k = r.getString('kind');
    const w = weekOf(ymd(r.getString('at')));
    if (weeks[w] && weeks[w][k] !== undefined) weeks[w][k]++;
    if (byKind[k] !== undefined) byKind[k]++;
    for (const p of r.getStringSlice('people')) people[p] = (people[p] || 0) + 1;
  }
  const recs = require(`${__hooks}/lib_records.js`);
  const top = Object.keys(people)
    .sort((a, b) => people[b] - people[a])
    .slice(0, 10)
    .map((id) => {
      const p = U().byId(app, 'people', id);
      return p ? { id: id, name: recs.personName(p), count: people[id], strength: p.getInt('strength') } : null;
    })
    .filter((x) => x !== null);
  const done = app.countRecords('tasks', $dbx.exp('done_at >= {:f} AND done_at <= {:t}', { f: from, t: to + 'T23:59:59Z' }));
  const notes = app.countRecords('notes', $dbx.exp('created >= {:f} AND created <= {:t}', { f: from, t: to + ' 23:59:59' }));
  return {
    from: from,
    to: to,
    weeks: Object.keys(weeks)
      .sort()
      .map((k) => weeks[k]),
    by_kind: byKind,
    total: rows.length,
    top_people: top,
    tasks_done: done,
    notes: notes,
  };
}

/** Strength mix, who is going cold, keep-in-touch due, strongest relationships. */
function relationships(app, m) {
  const q = require(`${__hooks}/lib_query.js`);
  const rows = q.list(app, 'people', { limit: 100000, m: m }).rows;
  const mix = { strong: 0, good: 0, weak: 0, none: 0 };
  for (const r of rows) mix[r.strength >= 60 ? 'strong' : r.strength >= 30 ? 'good' : r.strength > 0 ? 'weak' : 'none']++;
  const small = (r) => ({ id: r.id, name: r.name, company_name: r.company_name, title: r.title, strength: r.strength, last_interaction: r.last_interaction, next_touch: r.next_touch, keep_in_touch: r.keep_in_touch, touches: r.touches, birthday: r.birthday });
  const t = D().today();
  return {
    total: rows.length,
    mix: mix,
    cold: rows
      .filter((r) => r.touches >= 3 && r.last_interaction !== '' && q.daysSince(r.last_interaction) > 60)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 12)
      .map(small),
    keep_in_touch: rows
      .filter((r) => r.keep_in_touch > 0 && r.next_touch !== '' && r.next_touch <= t)
      .sort((a, b) => (a.next_touch < b.next_touch ? -1 : 1))
      .slice(0, 20)
      .map(small),
    strongest: rows
      .filter((r) => r.strength > 0)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10)
      .map(small),
    birthdays: rows
      .map((r) => ({ r: r, in: q.birthdayIn(r.birthday) }))
      .filter((x) => x.in !== null && x.in <= 30)
      .sort((a, b) => a.in - b.in)
      .slice(0, 10)
      .map((x) => Object.assign(small(x.r), { in_days: x.in })),
  };
}

/* ------------------------------------------------------------- summaries */

/** Counts for the rail badges and title bar chips. */
function summary(app) {
  const t = D().today();
  const open = app.findRecordsByFilter('tasks', "done_at = ''", '', 0, 0);
  let overdue = 0;
  let today = 0;
  for (const r of open) {
    const sn = r.getString('snoozed_until');
    if (sn !== '' && sn > t) continue;
    const due = r.getString('due');
    if (due !== '' && due < t) overdue++;
    else if (due === t) today++;
  }
  const keep = app.countRecords('people', $dbx.exp("deleted = '' AND keep_in_touch > 0 AND next_touch != '' AND next_touch <= {:t}", { t: t }));
  return {
    proposals: app.countRecords('proposals', $dbx.hashExp({ status: 'pending' })),
    tasks_overdue: overdue,
    tasks_today: today,
    keep_in_touch: keep,
    agent_working:
      app.countRecords('people', $dbx.hashExp({ agent_state: 'working' })) +
      app.countRecords('companies', $dbx.hashExp({ agent_state: 'working' })) +
      app.countRecords('interactions', $dbx.hashExp({ agent_state: 'working' })) +
      app.countRecords('asks', $dbx.hashExp({ status: 'working' })),
    agent_waiting:
      app.countRecords('people', $dbx.hashExp({ agent_state: 'waiting' })) +
      app.countRecords('companies', $dbx.hashExp({ agent_state: 'waiting' })) +
      app.countRecords('interactions', $dbx.hashExp({ agent_state: 'waiting' })) +
      app.countRecords('asks', $dbx.hashExp({ status: 'waiting' })),
    emails_queued: app.countRecords('emails', $dbx.exp("status = 'queued' OR status = 'sending'")),
    emails_failed: app.countRecords('emails', $dbx.hashExp({ status: 'failed' })),
    people: app.countRecords('people', $dbx.hashExp({ deleted: '' })),
    companies: app.countRecords('companies', $dbx.hashExp({ deleted: '' })),
    open_deals: app.countRecords('deals', $dbx.hashExp({ deleted: '', status: 'open' })),
  };
}

/** Everything Home shows, in one call. */
function dashboard(app, p) {
  const u = U();
  const dates = D();
  const fx = require(`${__hooks}/lib_fx.js`);
  const deals = require(`${__hooks}/lib_deals.js`);
  const work = require(`${__hooks}/lib_work.js`);
  const q = require(`${__hooks}/lib_query.js`);
  const m = q.mods();
  const t = m.today;
  const range = resolveRange(app, p);
  const pipes = deals.pipelines(app, false);
  const revPipes = pipes.filter((x) => !NON_REVENUE[x.kind]);
  const asked = u.str(p, 'pipeline', '');
  const pipeRef = asked || (revPipes[0] ? revPipes[0].id : '');
  const every = q.list(app, 'deals', { limit: 100000, m: m }).rows;
  const all = scoped(app, '', every);
  const open = all.filter((d) => d.status === 'open');
  const cur = winStats(all, range.from, range.to);
  const prev = winStats(all, range.prev_from, range.prev_to);
  const peopleNew = app.countRecords('people', $dbx.exp("deleted = '' AND created >= {:f} AND created <= {:t}", { f: range.from, t: range.to + ' 23:59:59' }));
  const peoplePrev = app.countRecords('people', $dbx.exp("deleted = '' AND created >= {:f} AND created <= {:t}", { f: range.prev_from, t: range.prev_to + ' 23:59:59' }));
  const touches = app.countRecords('interactions', $dbx.exp('at >= {:f} AND at <= {:t}', { f: range.from, t: range.to + 'T23:59:59Z' }));
  const touchesPrev = app.countRecords('interactions', $dbx.exp('at >= {:f} AND at <= {:t}', { f: range.prev_from, t: range.prev_to + 'T23:59:59Z' }));
  // Twelve months of won and lost for the trend.
  const mStart = dates.addMonths(dates.monthStart(t), -11);
  const wl = winloss(app, '', mStart, dates.monthEnd(t), every);
  const rel = relationships(app, m);
  const tasks = work.today(app);
  const small = (d) => ({ id: d.id, name: d.name, company_name: d.company_name, stage_name: d.stage_name, stage_color: d.stage_color, pipeline_name: d.pipeline_name, home_value: d.home_value, value: d.value, currency: d.currency, expected_close: d.expected_close, idle_days: d.idle_days, days_in_stage: d.days_in_stage, next_state: d.next_state, probability: d.probability });
  const runs = require(`${__hooks}/lib_activity.js`).runs(app, 3);
  const sum0 = summary(app);
  const act = activity(app, dates.addDays(t, -7 * 11 - ((new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7)), t);
  const trend = act.weeks.map((w) => ({ week: w.week, touches: w.email + w.call + w.meeting + w.message, people: 0, deals: 0, deal_value: 0 }));
  const weekIx = {};
  trend.forEach((w, i) => (weekIx[w.week] = i));
  const weekOf = (d) => {
    const dt = new Date(String(d).slice(0, 10) + 'T00:00:00Z');
    return dates.addDays(String(d).slice(0, 10), -((dt.getUTCDay() + 6) % 7));
  };
  const first = trend.length > 0 ? trend[0].week : t;
  for (const r of app.findRecordsByFilter('people', "deleted = '' && created >= {:f}", '', 0, 0, { f: first })) {
    const i = weekIx[weekOf(r.getString('created'))];
    if (i !== undefined) trend[i].people++;
  }
  for (const d of all) {
    if (ymd(d.created) < first) continue;
    const i = weekIx[weekOf(d.created)];
    if (i === undefined) continue;
    trend[i].deals++;
    trend[i].deal_value += d.home_value || 0;
  }
  return {
    currency: fx.home(app),
    today: t,
    range: range,
    pipelines: revPipes.map((x) => ({ id: x.id, name: x.name, kind: x.kind })),
    kpi: {
      open_value: sum(open, 'home_value'),
      open_count: open.length,
      weighted: sum(open, 'weighted'),
      won_value: cur.won_value,
      won_count: cur.won,
      won_prev_value: prev.won_value,
      won_prev_count: prev.won,
      win_rate: cur.win_rate,
      win_rate_prev: prev.win_rate,
      avg_deal: cur.avg_deal,
      avg_deal_prev: prev.avg_deal,
      cycle_days: cur.cycle_days,
      cycle_prev: prev.cycle_days,
      new_people: peopleNew,
      new_people_prev: peoplePrev,
      touches: touches,
      touches_prev: touchesPrev,
      no_rate: open.filter((d) => d.home_value === null).length,
    },
    pipeline: pipeRef ? pipelineReport(app, pipeRef, every) : null,
    others: pipes
      .filter((x) => NON_REVENUE[x.kind])
      .map((x) => {
        const r = pipelineReport(app, x.id, every);
        return { pipeline: r.pipeline, stages: r.stages, total: r.total, won: r.won, lost: r.lost };
      }),
    forecast: forecast(app, '', 6, every),
    months: wl.months,
    activity: act,
    trend: trend,
    relationships: { mix: rel.mix, cold: rel.cold.slice(0, 6), strongest: rel.strongest.slice(0, 8), total: rel.total },
    sources: sources(app, range.from, range.to, '', every).deals.slice(0, 7),
    attention: {
      overdue: tasks.overdue.length,
      today: tasks.today.length,
      tasks: tasks.overdue.concat(tasks.today).slice(0, 6),
      rotting: open.filter((d) => d.rotting).sort((a, b) => b.idle_days - a.idle_days).slice(0, 6).map(small),
      rotting_count: open.filter((d) => d.rotting).length,
      no_next_step: open.filter((d) => d.next_state === 'none').length,
      keep_in_touch: rel.keep_in_touch.length,
      keep_list: rel.keep_in_touch.slice(0, 6),
      birthdays: rel.birthdays.slice(0, 5),
      proposals: sum0.proposals,
      closing: open
        .filter((d) => d.expected_close !== '' && d.expected_close <= dates.addDays(t, 30))
        .sort((a, b) => (a.expected_close < b.expected_close ? -1 : 1))
        .slice(0, 6)
        .map(small),
    },
    agent: { runs: runs, proposals: sum0.proposals, working: sum0.agent_working },
  };
}

/**
 * One month of dates: open tasks by due date, open deals by expected close,
 * keep-in-touch dates, birthdays, and the meetings and calls logged.
 */
function calendar(app, month) {
  const dates = D();
  const recs = require(`${__hooks}/lib_records.js`);
  const from = month + '-01';
  const to = dates.monthEnd(from);
  const events = [];
  const names = {};
  const personName = (id) => {
    if (!id) return '';
    if (names[id] === undefined) {
      const p = U().byId(app, 'people', id);
      names[id] = p ? recs.personName(p) : '';
    }
    return names[id];
  };
  for (const r of app.findRecordsByFilter('tasks', "done_at = '' && due >= {:f} && due <= {:t}", 'due', 0, 0, { f: from, t: to })) {
    const pid = r.getString('person');
    events.push({ date: r.getString('due'), kind: 'task', title: r.getString('title'), id: r.id, type: 'tasks', sub: personName(pid), person: pid, deal: r.getString('deal') });
  }
  const rows = dealRows(app, '').filter((d) => d.status === 'open' && d.expected_close >= from && d.expected_close <= to);
  for (const d of rows) events.push({ date: d.expected_close, kind: 'close', title: d.name, id: d.id, type: 'deals', sub: d.stage_name, value: d.home_value, pipeline: d.pipeline_name });
  for (const r of app.findRecordsByFilter('people', "deleted = '' && keep_in_touch > 0 && next_touch >= {:f} && next_touch <= {:t}", 'next_touch', 0, 0, { f: from, t: to })) {
    events.push({ date: r.getString('next_touch').slice(0, 10), kind: 'touch', title: recs.personName(r), id: r.id, type: 'people', sub: 'every ' + r.getInt('keep_in_touch') + ' days' });
  }
  const mm = month.slice(5, 7);
  for (const r of app.findRecordsByFilter('people', "deleted = '' && birthday != ''", '', 0, 0)) {
    const b = r.getString('birthday');
    const md = b.length === 10 ? b.slice(5) : b;
    if (md.slice(0, 2) !== mm) continue;
    const day = month + '-' + md.slice(3, 5);
    if (day > to) continue;
    events.push({ date: day, kind: 'birthday', title: recs.personName(r), id: r.id, type: 'people', sub: 'birthday' });
  }
  for (const r of app.findRecordsByFilter('interactions', "(kind = 'meeting' || kind = 'call') && at >= {:f} && at <= {:t}", 'at', 0, 0, { f: from, t: to + 'T23:59:59Z' })) {
    const ppl = r.getStringSlice('people');
    const what = (r.getString('kind') === 'call' ? 'Call' : 'Meeting') + (ppl[0] ? ' with ' + personName(ppl[0]) + (ppl.length > 1 ? ' and ' + (ppl.length - 1) + ' more' : '') : '');
    events.push({ date: r.getString('at').slice(0, 10), kind: 'meeting', title: r.getString('subject') || what, id: ppl[0] || '', type: ppl[0] ? 'people' : '', sub: r.getString('subject') ? what : '' });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { month: month, from: from, to: to, events: events };
}

module.exports = { calendar: calendar, resolveRange: resolveRange, winStats: winStats, pipelineReport: pipelineReport, funnel: funnel, forecast: forecast, winloss: winloss, stageTime: stageTime, sources: sources, activity: activity, relationships: relationships, summary: summary, dashboard: dashboard };
