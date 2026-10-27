/// <reference path="../pb_data/types.d.ts" />
/**
 * YC's batches and their application deadlines.
 *
 * YC runs four batches a year (Winter, Spring, Summer, Fall) and closes
 * on-time applications about every 13 weeks at 8pm PT. A deadline is known
 * only once YC publishes it on ycombinator.com/apply: KNOWN holds the ones
 * read there. Past the last known one, the next batch is worked out from
 * where the 2026 deadlines fell (February 9, May 4, July 27, November 2),
 * with two weeks of slack because the dates move from year to year and YC
 * still reads late applications. Such a batch has no deadline until your AI
 * agent reads it on ycombinator.com/apply (gather recipe) or a founder
 * types it.
 *
 * A new install starts on the next batch, and an application nobody has
 * touched moves on when its deadline passes (ensure: at start and every
 * hour). Once anyone works on it the batch is the founders' choice: a passed
 * deadline shows as late, because YC still reads late applications.
 */

const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'];

/** Deadlines read on ycombinator.com/apply (ISO, UTC). */
const KNOWN = {
  'Winter 2027': { deadline: '2026-11-03T04:00:00.000Z', note: 'Winter 2027: November 2 at 8pm PT (ycombinator.com/apply)' },
};

/** Where each season's deadline fell in 2026: [month 0-11, day]. Winter's falls in the year before the batch. */
const USUAL = { Winter: [10, 2], Spring: [1, 9], Summer: [4, 4], Fall: [6, 27] };
const SLACK_MS = 14 * 86400000;
const CHECK_NOTE = 'Check the deadline on ycombinator.com/apply';

function parse(name) {
  const m = /^(Winter|Spring|Summer|Fall) (\d{4})$/.exec(String(name || '').trim());
  return m ? { season: m[1], year: Number(m[2]) } : null;
}

function nameOf(b) {
  return b.season + ' ' + b.year;
}

function after(b) {
  const i = SEASONS.indexOf(b.season);
  return i === SEASONS.length - 1 ? { season: SEASONS[0], year: b.year + 1 } : { season: SEASONS[i + 1], year: b.year };
}

/** When on-time applications for a batch close (ms): YC's date when known, else the usual date plus the slack. */
function closes(b) {
  const k = KNOWN[nameOf(b)];
  if (k) return Date.parse(k.deadline);
  const d = USUAL[b.season];
  return Date.UTC(b.season === 'Winter' ? b.year - 1 : b.year, d[0], d[1] + 1, 4) + SLACK_MS;
}

/** The first batch from `b` on that still takes on-time applications at `now`. */
function firstOpen(b, now) {
  let cur = b;
  for (let i = 0; i < 12 && closes(cur) <= now; i++) cur = after(cur);
  return cur;
}

function view(b) {
  const k = KNOWN[nameOf(b)];
  return { batch: nameOf(b), deadline: k ? k.deadline : '', deadline_note: k ? k.note : CHECK_NOTE };
}

/** The batch to apply to at `now`, with its deadline when YC has published it. */
function upcoming(now) {
  return view(firstOpen({ season: 'Winter', year: new Date(now).getUTCFullYear() }, now));
}

/** The batch to apply to after `name` ("Apply again"): the next one, or a later one if that has closed. */
function next(name, now) {
  const b = parse(name);
  return b === null ? upcoming(now).batch : nameOf(firstOpen(after(b), now));
}

/** The batches a founder can pick: the next one open and the three after it. */
function choices(now) {
  const out = [];
  let b = parse(upcoming(now).batch);
  for (let i = 0; i < 4; i++) {
    out.push(nameOf(b));
    b = after(b);
  }
  return out;
}

/** YC's deadline for a batch, or null when it is not known. */
function known(name) {
  const k = KNOWN[String(name || '').trim()];
  return k ? { deadline: k.deadline, deadline_note: k.note } : null;
}

/**
 * Keep an untouched application on the next batch: while nobody has added a
 * link, a founder, an answer or a message and the activity trail is empty,
 * the batch follows the calendar. Returns true when it moved.
 */
function ensure(app) {
  if (!app.hasTable('settings')) return false;
  const S = require(`${__hooks}/lib_store.js`);
  const s = S.settings(app);
  if ((s.getString('status') || 'preparing') !== 'preparing') return false;
  for (const name of ['founders', 'sources', 'answers', 'messages', 'activity']) {
    if (app.findRecordsByFilter(name, "id != ''", '', 1, 0).length > 0) return false;
  }
  const up = upcoming(Date.now());
  if (s.getString('batch') === up.batch && s.getString('deadline') === up.deadline && s.getString('deadline_note') === up.deadline_note) return false;
  s.set('batch', up.batch);
  s.set('deadline', up.deadline);
  s.set('deadline_note', up.deadline_note);
  app.save(s);
  return true;
}

module.exports = { CHECK_NOTE: CHECK_NOTE, upcoming: upcoming, next: next, choices: choices, known: known, ensure: ensure };
