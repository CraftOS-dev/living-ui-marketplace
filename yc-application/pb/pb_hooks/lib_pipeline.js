/// <reference path="../pb_data/types.d.ts" />
/**
 * The pipeline: six steps from links to a submitted application, each with
 * its state worked out from the data (never ticked by hand):
 *
 *   1 Gather   your AI agent reads the founders' links and fills answers
 *   2 Team     founders, roles, technical, full-time, equity, profiles
 *   3 Answers  every question answered and read by a founder
 *   4 Review   the checks pass: no blockers left
 *   5 Video    the one minute founder video, following YC's rules
 *   6 Submit   your AI agent fills YC's form; a founder presses Submit
 *
 * Also the settings (batch, deadline, recommendation, video rules) and the
 * activity trail.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const VIDEO_RULES = ['one_minute', 'all_founders', 'unscripted', 'no_extras'];
const CONFIRM_KEYS = ['one_minute', 'all_founders', 'unscripted', 'no_extras', 'full_time_if_accepted', 'one_application', 'vesting', 'ip_clear', 'goals_aligned', 'revenue_monthly'];

function stages(F, summary, sources) {
  const st = F.settings;
  const c = F.counts;
  const checks = summary.checks;
  const failing = (group, sev) => checks.filter((k) => k.group === group && k.status === 'fail' && (sev === undefined || k.severity === sev));
  const out = [];

  const gatherDone = st.gather_state === 'done' || c.answered >= 8;
  out.push({
    key: 'gather',
    title: 'Gather',
    state: gatherDone ? 'done' : st.gather_state === 'requested' || st.gather_state === 'working' ? 'working' : 'todo',
    line: sources.total === 0 ? 'Give your AI agent your links and files' : sources.total + (sources.total === 1 ? ' source' : ' sources') + (sources.read > 0 ? ', ' + sources.read + ' read' : ''),
    route: 'pipeline',
  });

  const teamBlock = failing('team', 'blocker');
  const teamWarn = failing('team', 'warning');
  out.push({
    key: 'team',
    title: 'Team',
    state: F.founders.length === 0 ? 'todo' : teamBlock.length > 0 ? 'blocked' : teamWarn.length > 0 ? 'warn' : 'done',
    line: F.founders.length === 0 ? 'No founders yet' : F.founders.length + (F.founders.length === 1 ? ' founder' : ' founders') + ', ' + F.founders.filter((f) => f.technical === true).length + ' technical',
    issues: teamBlock.length + teamWarn.length,
    route: 'team',
  });

  out.push({
    key: 'answers',
    title: 'Answers',
    state: c.answered === 0 ? 'todo' : c.missing > 0 || c.unconfirmed > 0 ? 'blocked' : 'done',
    line: c.answered + ' of ' + c.questions + ' answered',
    route: 'application',
  });

  const blockers = summary.totals.blockers;
  out.push({
    key: 'review',
    title: 'Review',
    state: c.answered === 0 ? 'todo' : blockers > 0 ? 'blocked' : summary.totals.warnings > 0 ? 'warn' : summary.totals.wait > 0 ? 'working' : 'done',
    line: summary.totals.pass + ' pass, ' + blockers + (blockers === 1 ? ' blocker' : ' blockers') + ', ' + summary.totals.warnings + (summary.totals.warnings === 1 ? ' warning' : ' warnings') + (summary.totals.wait > 0 ? ', ' + summary.totals.wait + ' being read' : ''),
    route: 'review',
  });

  const video = F.v('f_video') !== '';
  const rules = VIDEO_RULES.filter((r) => (st.confirms || {})[r] === true).length;
  out.push({
    key: 'video',
    title: 'Founder video',
    state: !video ? 'todo' : rules < VIDEO_RULES.length ? 'warn' : 'done',
    line: !video ? 'One minute, all founders, unscripted' : rules + ' of 4 rules confirmed',
    route: 'application',
    anchor: 'f_video',
  });

  const subState = st.status !== 'preparing' ? 'done' : st.fill_state === 'filled' ? 'warn' : st.fill_state === 'requested' || st.fill_state === 'filling' ? 'working' : 'todo';
  out.push({
    key: 'submit',
    title: 'Submit',
    state: subState,
    line: st.status !== 'preparing' ? 'Submitted' + (st.status !== 'submitted' ? ', ' + st.status : '') : st.fill_state === 'filled' ? 'Form filled; press Submit on YC' : st.fill_state === 'filling' ? 'Your AI agent is filling the form' : 'Your AI agent fills YC\'s form; you press Submit',
    route: 'submit',
  });

  let current = '';
  for (const s of out) {
    if (s.state !== 'done') {
      current = s.key;
      break;
    }
  }
  for (const s of out) s.current = s.key === current;

  // How far each step is, 0 to 1, for the pipeline graphic.
  const groupRatio = (groups) => {
    const live = checks.filter((k) => groups.indexOf(k.group) >= 0 && (k.status === 'pass' || k.status === 'fail'));
    return live.length === 0 ? 0 : live.filter((k) => k.status === 'pass').length / live.length;
  };
  const pr = {
    gather: st.gather_state === 'done' || c.answered >= 8 ? 1 : sources.total === 0 ? 0 : 0.25 + 0.5 * (sources.read / sources.total),
    team: F.founders.length === 0 ? 0 : groupRatio(['team']),
    answers: c.questions === 0 ? 0 : c.answered / c.questions,
    review: c.answered === 0 ? 0 : groupRatio(['before', 'team', 'clarity', 'progress', 'idea', 'video', 'form']),
    video: (video ? 0.5 : 0) + (rules / VIDEO_RULES.length) * 0.5,
    submit: st.status !== 'preparing' ? 1 : st.fill_state === 'filled' ? 0.66 : st.fill_state === 'filling' || st.fill_state === 'requested' ? 0.33 : 0,
  };
  for (const s of out) s.progress = Math.round(pr[s.key] * 100) / 100;
  return out;
}

/** Each section of the form: questions asked, answered, missing, to confirm, flagged, waiting on a founder. */
function sections(F) {
  const Q = L('lib_questions');
  const out = Q.SECTIONS.concat([{ key: 'profile', label: 'Founder profiles' }]).map((s) => {
    const items = F.items.filter((a) => a.section === s.key && a.open);
    return {
      key: s.key,
      label: s.label,
      total: items.length,
      answered: items.filter((a) => a.value !== '').length,
      missing: items.filter((a) => a.required && a.value === '').length,
      unconfirmed: items.filter((a) => a.value !== '' && !a.confirmed).length,
      flagged: items.filter((a) => a.flags > 0).length,
      needs: items.filter((a) => a.need !== '').length,
    };
  });
  return out;
}

function sourceCounts(app) {
  const rows = app.findRecordsByFilter('sources', '1=1', '', 0, 0);
  return { total: rows.length, read: rows.filter((r) => r.getString('state') === 'read').length, waiting: rows.filter((r) => r.getString('state') === 'new' || r.getString('state') === 'reading').length };
}

function activity(app, limit) {
  return app.findRecordsByFilter('activity', '1=1', '-created', limit, 0).map((r) => ({ id: r.id, actor: r.getString('actor'), text: r.getString('text'), target: r.getString('target'), created: r.getString('created') }));
}

/** Everything the pipeline page shows, in one read. */
function get(ctx) {
  const C = L('lib_checks');
  const app = ctx.app;
  const summary = C.summary(app);
  const F = summary.facts;
  const sources = sourceCounts(app);
  const st = F.settings;
  return {
    settings: st,
    stages: stages(F, summary, sources),
    sections: sections(F),
    founders: F.founders.map((f) => ({ id: f.id, name: f.name, role: f.role, technical: f.technical, full_time: f.full_time, equity: f.equity, confirmed: f.confirmed })),
    revenue: L('lib_checks').revenueSeries(F),
    odds: L('lib_odds').shown(L('lib_odds').compute(F)),
    totals: summary.totals,
    first: summary.first,
    top: summary.checks.filter((c) => c.status === 'fail').slice(0, 8),
    counts: F.counts,
    sources: L('lib_sources').list(ctx, {}).sources,
    review: { state: F.reviewState, summary: F.review ? F.review.summary : '', fixes: F.review ? F.review.top_fixes : [], progress: F.progress },
    activity: activity(app, 12),
  };
}

/** The screen each pipeline step lives on, as the founders see it. */
const SCREEN = { gather: 'Links & files', team: 'Team', answers: 'Answers', review: 'Polish', video: 'Submit', submit: 'Submit' };
const RANK = { blocker: 0, warning: 1, tip: 2 };

/** What to fix in the application, most important first: severity, then the odds points it is worth. */
function fixNext(summary, odds) {
  const gain = {};
  for (const m of odds.ready ? odds.all_moves || [] : []) if (m.check) gain[m.check] = Math.max(gain[m.check] || 0, m.gain);
  return summary.checks
    .filter((c) => c.status === 'fail')
    .map((c) => ({ id: c.id, title: c.title, severity: c.severity, fix: c.fix, gain: gain[c.id] || 0, keys: Array.isArray(c.keys) && c.keys.length > 0 ? c.keys : undefined, founders_only: c.confirm !== undefined ? true : undefined }))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.gain - a.gain)
    .slice(0, 10);
}

/** A compact status for your AI agent: where the application stands and what to do next. */
function status(ctx) {
  const C = L('lib_checks');
  const app = ctx.app;
  const summary = C.summary(app);
  const F = summary.facts;
  const odds = L('lib_odds').compute(F);
  const st = F.settings;
  return {
    batch: st.batch,
    deadline: st.deadline,
    status: st.status,
    gather_state: st.gather_state,
    fill_state: st.fill_state,
    stages: stages(F, summary, sourceCounts(app)).map((s) => ({ step: s.key, screen: SCREEN[s.key], state: s.state, line: s.line })),
    odds: odds.ready ? { percent: odds.percent, range: odds.range, band: odds.band, rank: odds.rank, score: odds.score, pending: odds.pending, moves: odds.moves } : { ready: false, why: 'Needs the team and at least five answers' },
    counts: F.counts,
    checks: summary.totals,
    blockers: summary.checks.filter((c) => c.status === 'fail' && c.severity === 'blocker').map((c) => ({ id: c.id, title: c.title, detail: c.detail })),
    do_first: summary.first.slice().sort((a, b) => RANK[a.severity] - RANK[b.severity]),
    fix_next: fixNext(summary, odds),
    needs: F.items.filter((a) => a.open && a.need !== '').map((a) => ({ key: a.key, need: a.need, answered: a.value !== '' })),
    review: { state: F.reviewState, progress: F.progress },
  };
}

function settingsGet(ctx) {
  const S = L('lib_store');
  return S.settingsView(S.settings(ctx.app));
}

function settingsUpdate(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const s = S.settings(app);
  const batchBefore = s.getString('batch');
  const deadlineBefore = s.getString('deadline');
  if (p.batch !== undefined) {
    const batch = U.clip(p.batch, 60);
    // Another batch takes YC's deadline for it when known, otherwise none until someone reads it.
    if (batch !== s.getString('batch') && p.deadline === undefined) {
      const k = L('lib_batches').known(batch);
      s.set('deadline', k ? k.deadline : '');
      if (p.deadline_note === undefined) s.set('deadline_note', k ? k.deadline_note : L('lib_batches').CHECK_NOTE);
    }
    s.set('batch', batch);
  }
  if (p.deadline !== undefined) {
    if (p.deadline !== '' && !Number.isFinite(Date.parse(p.deadline))) throw U.fail(400, 'deadline is an ISO date and time in UTC, for example 2027-03-02T04:00:00Z.', 'invalid_param', { param: 'deadline' });
    s.set('deadline', p.deadline === '' ? '' : new Date(Date.parse(p.deadline)).toISOString());
  }
  if (p.deadline_note !== undefined) s.set('deadline_note', U.clip(p.deadline_note, 300));
  if (p.recommended !== undefined) s.set('recommended', p.recommended === true);
  app.save(s);
  if (ctx.isAgent) S.log(app, 'agent', 'Updated the settings', '');
  else if (s.getString('batch') !== batchBefore) S.log(app, 'person', 'Batch: ' + s.getString('batch'), '');
  else if (s.getString('deadline') !== deadlineBefore) S.log(app, 'person', 'Changed the ' + s.getString('batch') + ' deadline', '');
  return S.settingsView(s);
}

/** What only the founders can confirm (video rules, full-time, vesting, IP...). Founders only. */
function confirmsSet(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const app = ctx.app;
  const s = S.settings(app);
  const cf = U.json(s, 'confirms', {});
  let changed = 0;
  for (const r of CONFIRM_KEYS) {
    if (p[r] !== undefined) {
      cf[r] = p[r] === true;
      changed++;
    }
  }
  if (changed === 0) throw U.fail(400, 'Give at least one of: ' + CONFIRM_KEYS.join(', ') + '.', 'missing_param');
  s.set('confirms', cf);
  app.save(s);
  return S.settingsView(s);
}

function activityList(ctx, p) {
  return { activity: activity(ctx.app, Math.min(Math.max(Math.round(p.limit || 30), 1), 200)) };
}

/** Everything waiting on the founders, in one list. */
function todo(ctx) {
  const A = L('lib_answers');
  const S = L('lib_store');
  const app = ctx.app;
  const items = A.all(app).filter((a) => a.open);
  const st = S.settingsView(S.settings(app));
  const asked = items.filter((a) => a.need !== '').map((a) => ({ key: a.key, short: a.short, founder_name: a.founder_name, need: a.need }));
  const aboutFounders = S.founders(app)
    .filter((f) => f.need !== '')
    .map((f) => ({ founder: f.id, name: f.name, need: f.need }));
  const toConfirm = items.filter((a) => a.value !== '' && !a.confirmed).map((a) => ({ key: a.key, short: a.short, founder_name: a.founder_name }));
  const founderOnly = items.filter((a) => a.by === 'founder' && a.value === '' && a.need === '').map((a) => ({ key: a.key, short: a.short, founder_name: a.founder_name, required: a.required }));
  const switches = st.confirm_list.filter((c) => !c.done).map((c) => ({ key: c.key, label: c.label, group: c.group }));
  return {
    total: asked.length + aboutFounders.length + toConfirm.length + founderOnly.length + switches.length,
    asked: asked,
    about_founders: aboutFounders,
    to_confirm: toConfirm,
    founder_only: founderOnly,
    switches: switches,
  };
}

module.exports = { VIDEO_RULES: VIDEO_RULES, CONFIRM_KEYS: CONFIRM_KEYS, get: get, status: status, todo: todo, settingsGet: settingsGet, settingsUpdate: settingsUpdate, confirmsSet: confirmsSet, activityList: activityList };
