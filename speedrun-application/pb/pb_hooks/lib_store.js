/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared reads and writes: the settings row, the answers and the team as
 * plain objects, the activity trail, and the wake flag of the review worker.
 */

const SETTINGS_ID = 'srsettings00001';

let _u = null;
function u() {
  if (_u === null) _u = require(`${__hooks}/lib_util.js`);
  return _u;
}

/** speedrun allows no edits after Submit: every write that changes the application calls this first. */
function assertPreparing(app) {
  if (settings(app).getString('status') !== 'preparing') throw u().fail(409, 'The application was submitted; speedrun does not allow edits. Email new traction, an updated deck or a demo to sr-team@a16z.com instead.', 'submitted_locked');
}

function settings(app) {
  return app.findRecordById('settings', SETTINGS_ID);
}

function settingsView(rec) {
  const U = u();
  const cf = U.json(rec, 'confirms', {});
  const C = require(`${__hooks}/lib_cohorts.js`);
  const now = Date.now();
  return {
    cohort: rec.getString('cohort'),
    deadline: rec.getString('deadline'),
    deadline_note: rec.getString('deadline_note'),
    cohorts: C.choices(now),
    next_cohort: C.next(rec.getString('cohort'), now),
    status: rec.getString('status') || 'preparing',
    submitted_at: rec.getString('submitted_at'),
    interview_at: rec.getString('interview_at'),
    decided_at: rec.getString('decided_at'),
    confirms: cf,
    confirm_list: require(`${__hooks}/lib_questions.js`).CONFIRMS.map((c) => ({ key: c.key, group: c.group, label: c.label, done: cf[c.key] === true })),
    gather_state: rec.getString('gather_state') || 'idle',
    gather_request: rec.getString('gather_request'),
    gather_at: rec.getString('gather_at'),
    gather_summary: rec.getString('gather_summary'),
    fill_state: rec.getString('fill_state') || 'idle',
    fill_request: rec.getString('fill_request'),
    fill_at: rec.getString('fill_at'),
    fill_log: U.json(rec, 'fill_log', []),
    review_state: rec.getString('review_state') || 'none',
    review_at: rec.getString('review_at'),
  };
}

function log(app, actor, text, target) {
  try {
    const rec = u().newRecord(app, 'activity');
    rec.set('actor', actor);
    rec.set('text', u().clip(text, 600));
    rec.set('target', target || '');
    app.save(rec);
  } catch (err) {
    console.error('[speedrun] activity log failed:', err);
  }
}

/** Every answer record by key. */
function answerRecords(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('answers', '1=1', '', 0, 0)) out[r.getString('key')] = r;
  return out;
}

/** The answer value of each key, as text ('' when empty). */
function values(app) {
  const out = {};
  for (const r of app.findRecordsByFilter('answers', '1=1', '', 0, 0)) out[r.getString('key')] = r.getString('value');
  return out;
}

function founderRecords(app) {
  return app.findRecordsByFilter('founders', '1=1', 'sort,created', 0, 0);
}

/** 'yes' / 'no' / '' as true / false / null (not given yet). */
function tri(v) {
  return v === 'yes' ? true : v === 'no' ? false : null;
}

function founderView(r) {
  const years = r.getString('years');
  return {
    id: r.id,
    name: r.getString('name'),
    first_name: r.getString('first_name'),
    last_name: r.getString('last_name'),
    role: r.getString('role'),
    email: r.getString('email'),
    phone: r.getString('phone'),
    linkedin: r.getString('linkedin'),
    github: r.getString('github'),
    x: r.getString('x'),
    website: r.getString('website'),
    country: r.getString('country'),
    state: r.getString('state'),
    city: r.getString('city'),
    citizenship: r.getString('citizenship'),
    college: r.getString('college'),
    education: r.getString('education'),
    // Not given yet is null: a founder with no work experience says 0.
    years: years === '' ? null : Number(years),
    technical: tri(r.getString('technical')),
    full_time: tri(r.getString('full_time')),
    origin: r.getString('origin'),
    confirmed: r.getBool('confirmed'),
    need: r.getString('need'),
    sort: r.getInt('sort'),
  };
}

function founders(app) {
  return founderRecords(app).map(founderView);
}

/** Ask the review worker to look for queued answers now. */
function wake(app) {
  app.store().set('sr_judge_wake', true);
}

module.exports = {
  assertPreparing: assertPreparing,
  SETTINGS_ID: SETTINGS_ID,
  settings: settings,
  settingsView: settingsView,
  log: log,
  answerRecords: answerRecords,
  values: values,
  founderRecords: founderRecords,
  founderView: founderView,
  founders: founders,
  wake: wake,
};
