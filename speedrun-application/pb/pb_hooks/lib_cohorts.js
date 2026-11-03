/// <reference path="../pb_data/types.d.ts" />
/**
 * speedrun's cohorts and their application deadlines.
 *
 * speedrun runs two cohorts a year and closes applications at 11:59 PM PT:
 * an odd cohort in mid-May (SR007: May 17, 2026, residency late July to
 * October) and an even one on November 1 (SR008: November 1, 2026, residency
 * February to April). A deadline is known only once speedrun publishes it on
 * speedrun.a16z.com/apply: KNOWN holds the ones read there. Past the last
 * known one, the next cohort is worked out from that calendar, with two
 * weeks of slack because the dates move from year to year. Such a cohort has
 * no deadline until your AI agent reads it on speedrun.a16z.com/apply
 * (gather recipe) or a founder types it.
 *
 * A new install starts on the next cohort, and an application nobody has
 * touched moves on when its deadline passes (ensure: at start and every
 * hour). Once anyone works on it the cohort is the founders' choice: a
 * passed deadline shows as late, and speedrun considers a late application
 * for the following residency.
 */

/** Deadlines read on speedrun.a16z.com/apply (ISO, UTC). */
const KNOWN = {
  SR007: { deadline: '2026-05-18T06:59:00.000Z', note: 'SR007 closed May 17, 2026 at 11:59 PM PT; the residency ran July 27 to October 11, 2026 in San Francisco (speedrun.a16z.com/apply)' },
  SR008: { deadline: '2026-11-02T07:59:00.000Z', note: 'SR008 closes Sunday, November 1 at 11:59 PM PT; the residency runs February 1 to April 16, 2027 in San Francisco (speedrun.a16z.com/apply)' },
};

/** Where an odd and an even cohort's deadline falls: [month 0-11, day]. */
const USUAL = { odd: [4, 17], even: [10, 1] };
const SLACK_MS = 14 * 86400000;

function checkNote(name) {
  return name + ': speedrun has not published the deadline yet. Check it on speedrun.a16z.com/apply';
}

function parse(name) {
  const m = /^SR0*(\d{1,3})$/i.exec(String(name || '').trim());
  return m ? Number(m[1]) : null;
}

function nameOf(n) {
  return 'SR' + String(n).padStart(3, '0');
}

/** When applications for cohort `n` close (ms): speedrun's date when known, else the usual date plus the slack. */
function closes(n) {
  const k = KNOWN[nameOf(n)];
  if (k) return Date.parse(k.deadline);
  const d = n % 2 === 1 ? USUAL.odd : USUAL.even;
  return Date.UTC(2026 + Math.floor((n - 7) / 2), d[0], d[1] + 1, 8) + SLACK_MS;
}

/** The first cohort from `n` on that still takes applications at `now`. */
function firstOpen(n, now) {
  let cur = n;
  for (let i = 0; i < 12 && closes(cur) <= now; i++) cur++;
  return cur;
}

function view(n) {
  const name = nameOf(n);
  const k = KNOWN[name];
  return { cohort: name, deadline: k ? k.deadline : '', deadline_note: k ? k.note : checkNote(name) };
}

/** The cohort to apply to at `now`, with its deadline when speedrun has published it. */
function upcoming(now) {
  return view(firstOpen(7 + 2 * Math.max(0, new Date(now).getUTCFullYear() - 2026), now));
}

/** The cohort to apply to after `name` ("Apply again"): the next one, or a later one if that has closed. */
function next(name, now) {
  const n = parse(name);
  return n === null ? upcoming(now).cohort : nameOf(firstOpen(n + 1, now));
}

/** The cohorts a founder can pick: the next one open and the three after it. */
function choices(now) {
  const n = parse(upcoming(now).cohort);
  return [n, n + 1, n + 2, n + 3].map(nameOf);
}

/** speedrun's deadline for a cohort, or null when it is not known. */
function known(name) {
  const n = parse(name);
  const k = n === null ? null : KNOWN[nameOf(n)];
  return k ? { deadline: k.deadline, deadline_note: k.note } : null;
}

/**
 * Keep an untouched application on the next cohort: while nobody has added a
 * link, a founder, an answer or a message and the activity trail is empty,
 * the cohort follows the calendar. Returns true when it moved.
 */
function ensure(app) {
  if (!app.hasTable('settings')) return false;
  const S = require(`${__hooks}/lib_store.js`);
  const s = S.settings(app);
  if ((s.getString('status') || 'preparing') !== 'preparing') return false;
  for (const name of ['founders', 'sources', 'messages', 'activity']) {
    if (app.findRecordsByFilter(name, "id != ''", '', 1, 0).length > 0) return false;
  }
  if (app.findRecordsByFilter('answers', "value != '' || need != '' || suggestion != ''", '', 1, 0).length > 0) return false;
  const up = upcoming(Date.now());
  if (s.getString('cohort') === up.cohort && s.getString('deadline') === up.deadline && s.getString('deadline_note') === up.deadline_note) return false;
  s.set('cohort', up.cohort);
  s.set('deadline', up.deadline);
  s.set('deadline_note', up.deadline_note);
  app.save(s);
  return true;
}

module.exports = { checkNote: checkNote, upcoming: upcoming, next: next, choices: choices, known: known, ensure: ensure };
