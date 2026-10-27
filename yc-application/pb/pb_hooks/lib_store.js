/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared reads and writes: the settings row, the answers and the team as
 * plain objects, the activity trail, and the wake flag of the review worker.
 */

const SETTINGS_ID = 'ycsettings00001';

let _u = null;
function u() {
  if (_u === null) _u = require(`${__hooks}/lib_util.js`);
  return _u;
}

/** YC allows no edits after Submit: every write that changes the application calls this first. */
function assertPreparing(app) {
  if (settings(app).getString('status') !== 'preparing') throw u().fail(409, 'The application was submitted; YC does not allow edits. Material changes go through YC\'s update form.', 'submitted_locked');
}

function settings(app) {
  return app.findRecordById('settings', SETTINGS_ID);
}

function settingsView(rec) {
  const U = u();
  const B = require(`${__hooks}/lib_batches.js`);
  const now = Date.now();
  return {
    batch: rec.getString('batch'),
    deadline: rec.getString('deadline'),
    deadline_note: rec.getString('deadline_note'),
    batches: B.choices(now),
    next_batch: B.next(rec.getString('batch'), now),
    status: rec.getString('status') || 'preparing',
    submitted_at: rec.getString('submitted_at'),
    interview_at: rec.getString('interview_at'),
    decided_at: rec.getString('decided_at'),
    recommended: rec.getBool('recommended'),
    confirms: U.json(rec, 'confirms', {}),
    confirm_list: require(`${__hooks}/lib_questions.js`).CONFIRMS.map((c) => ({ key: c.key, group: c.group, label: c.label, done: U.json(rec, 'confirms', {})[c.key] === true })),
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
    console.error('[yc] activity log failed:', err);
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
  return {
    id: r.id,
    name: r.getString('name'),
    role: r.getString('role'),
    email: r.getString('email'),
    linkedin: r.getString('linkedin'),
    github: r.getString('github'),
    x: r.getString('x'),
    website: r.getString('website'),
    location: r.getString('location'),
    education: r.getString('education'),
    work: r.getString('work'),
    technical: tri(r.getString('technical')),
    full_time: tri(r.getString('full_time')),
    // Not given yet is null (stored as 0: no founder applies with no equity).
    equity: r.getFloat('equity') > 0 ? r.getFloat('equity') : null,
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
  app.store().set('yc_judge_wake', true);
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
