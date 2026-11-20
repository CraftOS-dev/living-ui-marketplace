/// <reference path="../pb_data/types.d.ts" />
/**
 * The pipeline: six steps from links to a submitted application, each with
 * its state worked out from the data (never ticked by hand):
 *
 *   1 Gather   your AI agent reads the founders' links and fills answers
 *   2 Team     founders (CEO first), their form fields, technical, full-time, experience
 *   3 Answers  every question answered and read by a founder
 *   4 Review   the checks pass: no blockers left
 *   5 Video    the optional team video of up to 3 minutes, by speedrun's guide
 *   6 Submit   your AI agent fills speedrun's form; a founder presses Submit
 *
 * Also the settings (cohort, deadline, the founders' confirmations) and the
 * activity trail.
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}

const VIDEO_RULES = ['under_3_min', 'half_on_team', 'covers_rest', 'own_voice'];
const CONFIRM_KEYS = ['under_3_min', 'half_on_team', 'covers_rest', 'own_voice', 'residency', 'full_time_if_accepted', 'one_application', 'ip_clear', 'goals_aligned', 'metrics_true'];

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
    line: summary.totals.pass + ' pass, ' + blockers + (blockers === 1 ? ' blocker' : ' blockers') + ', ' + summary.totals.warnings + (summary.totals.warnings === 1 ? ' warning' : ' warnings') + (summary.totals.wait > 0 ? ', ' + summary.totals.wait + ' need review' : ''),
    route: 'review',
  });

  const video = F.v('x_video') !== '';
  const rules = VIDEO_RULES.filter((r) => (st.confirms || {})[r] === true).length;
  out.push({
    key: 'video',
    title: 'Team video',
    state: !video ? 'todo' : rules < VIDEO_RULES.length ? 'warn' : 'done',
    line: !video ? 'Up to 3 minutes, at least half on the team' : rules + ' of 4 points confirmed',
    route: 'application',
    anchor: 'x_video',
  });

  const subState = st.status !== 'preparing' ? 'done' : st.fill_state === 'filled' ? 'warn' : st.fill_state === 'requested' || st.fill_state === 'filling' ? 'working' : 'todo';
  out.push({
    key: 'submit',
    title: 'Submit',
    state: subState,
    line: st.status !== 'preparing' ? 'Submitted' + (st.status !== 'submitted' ? ', ' + st.status : '') : st.fill_state === 'filled' ? 'Form filled; press Submit application on speedrun' : st.fill_state === 'filling' ? 'Your AI agent is filling the form' : 'Your AI agent fills speedrun\'s form; you press Submit',
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
    review: c.answered === 0 ? 0 : groupRatio(['before', 'team', 'clarity', 'idea', 'traction', 'video', 'form']),
    video: (video ? 0.5 : 0) + (rules / VIDEO_RULES.length) * 0.5,
    submit: st.status !== 'preparing' ? 1 : st.fill_state === 'filled' ? 0.66 : st.fill_state === 'filling' || st.fill_state === 'requested' ? 0.33 : 0,
  };
  for (const s of out) s.progress = Math.round(pr[s.key] * 100) / 100;
  return out;
}

/** Each section of the form: questions asked, answered, missing, to confirm, flagged, waiting on a founder. */
function sections(F) {
  const Q = L('lib_questions');
  const out = Q.SECTIONS.concat([{ key: 'profile', label: 'Founder experience' }]).map((s) => {
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
    founders: F.founders.map((f) => ({ id: f.id, name: f.name, role: f.role, technical: f.technical, full_time: f.full_time, years: f.years, confirmed: f.confirmed })),
    metrics: L('lib_checks').metrics(F),
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
    cohort: st.cohort,
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
  const cohortBefore = s.getString('cohort');
  const deadlineBefore = s.getString('deadline');
  if (p.cohort !== undefined) {
    const cohort = U.clip(p.cohort, 60);
    // Another cohort takes speedrun's deadline for it when known, otherwise none until someone reads it.
    if (cohort !== s.getString('cohort') && p.deadline === undefined) {
      const k = L('lib_cohorts').known(cohort);
      s.set('deadline', k ? k.deadline : '');
      if (p.deadline_note === undefined) s.set('deadline_note', k ? k.deadline_note : L('lib_cohorts').checkNote(cohort));
    }
    s.set('cohort', cohort);
  }
  if (p.deadline !== undefined) {
    if (p.deadline !== '' && !Number.isFinite(Date.parse(p.deadline))) throw U.fail(400, 'deadline is an ISO date and time in UTC, for example 2027-05-03T06:59:00Z.', 'invalid_param', { param: 'deadline' });
    s.set('deadline', p.deadline === '' ? '' : new Date(Date.parse(p.deadline)).toISOString());
  }
  if (p.deadline_note !== undefined) s.set('deadline_note', U.clip(p.deadline_note, 400));
  app.save(s);
  if (ctx.isAgent) S.log(app, 'agent', 'Updated the settings', '');
  else if (s.getString('cohort') !== cohortBefore) S.log(app, 'person', 'Cohort: ' + s.getString('cohort'), '');
  else if (s.getString('deadline') !== deadlineBefore) S.log(app, 'person', 'Changed the ' + s.getString('cohort') + ' deadline', '');
  return S.settingsView(s);
}

/** What only the founders can confirm (the video guide, the residency, full-time, IP, metrics). Founders only. */
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

function reset(ctx, p) {
  const U = L('lib_util');
  const S = L('lib_store');
  const A = L('lib_answers');
  const app = ctx.app;
  // confirm=true is checked by the dispatcher (lib_ops.js), like every destructive operation.
  S.assertPreparing(app);
  // Clear all answers (demo only; agent-written answers can be cleared)
  const recs = S.answerRecords(app);
  for (const key of Object.keys(recs)) {
    const r = recs[key];
    if (r.getString('value') !== '' || r.getString('need') !== '' || r.getString('suggestion') !== '') {
      r.set('value', '');
      r.set('origin', '');
      r.set('confirmed', false);
      r.set('need', '');
      r.set('suggestion', '');
      r.set('suggestion_why', '');
      r.set('source', '');
      r.set('judge_state', 'none');
      r.set('judge', null);
      r.set('judged_hash', '');
      r.set('edited_at', U.now());
      app.save(r);
    }
  }
  // A clean application must not retain old requests or replies in its chat.
  // Removing queued rows also prevents the relay job from firing them later.
  const messages = app.findRecordsByFilter('messages', '1=1', '', 0, 0);
  for (const r of messages) app.delete(r);
  // Clear activity
  for (const r of app.findRecordsByFilter('activity', '1=1', '', 0, 0)) app.delete(r);
  // Reset settings demo fields
  const s = S.settings(app);
  s.set('review', {});
  s.set('review_state', 'none');
  s.set('review_at', '');
  s.set('review_hash', '');
  s.set('review_request', null);
  s.set('gather_state', 'idle');
  s.set('gather_at', '');
  s.set('gather_request', '');
  s.set('gather_summary', '');
  s.set('fill_state', 'idle');
  s.set('fill_at', '');
  s.set('fill_request', '');
  s.set('fill_log', []);
  s.set('sent', {});
  app.save(s);
  S.log(app, 'agent', 'Reset demo data (confirm=true)', '');
  return { ok: true, cleared: 'answers, messages, activity, review, gather/fill state', messages_removed: messages.length };
}

module.exports = { VIDEO_RULES: VIDEO_RULES, CONFIRM_KEYS: CONFIRM_KEYS, get: get, status: status, todo: todo, settingsGet: settingsGet, settingsUpdate: settingsUpdate, confirmsSet: confirmsSet, activityList: activityList, reset: reset };
