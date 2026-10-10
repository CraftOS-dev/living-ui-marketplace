/// <reference path="../pb_data/types.d.ts" />
/**
 * Notes: record shape, validation, derived fields, exports and the weekly
 * digest. One implementation behind the UI and the CLI ops alike.
 *
 * Shapes (JSON fields):
 *   segments      [{ start: seconds, end: seconds, text, speaker }]
 *                 from whisper; speaker ('Person 1', ... or '') from the
 *                 voices (lib_people.js)
 *   key_points    [string]
 *   decisions     [string]
 *   attendees     [string]
 *   speaker_names { detection label: name }   e.g. {"Person 2": "Aiko"}
 *   action_items  [{ id, title, assignee, due: 'YYYY-MM-DD' | '', done }]
 *
 * `transcript` is DERIVED from segments whenever segments exist (one line
 * per segment, "Person 1: ..." once speakers are known); without segments it
 * is the text a person pasted.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

class OpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Parse a JSON field; null/empty JSON means "unset" and yields []. */
function list(rec, name) {
  const raw = rec.getString(name);
  if (raw === '' || raw === 'null') return [];
  const v = JSON.parse(raw);
  return Array.isArray(v) ? v : [];
}

function isDay(s) {
  if (typeof s !== 'string' || !DAY.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function weekday(day) {
  return isDay(day) ? WEEKDAYS[new Date(day + 'T00:00:00Z').getUTCDay()] : '';
}

/** Monday of the week containing `day` (YYYY-MM-DD). */
function weekStart(day) {
  const d = new Date(day + 'T00:00:00Z');
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function stringList(v, field) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new OpError(400, field + ' must be a list of strings');
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') throw new OpError(400, field + ' must be a list of strings');
    const t = item.trim();
    if (t !== '') out.push(t);
  }
  return out;
}

/** { label: name }, both non-empty text. */
function nameMap(v) {
  if (v === null || v === undefined) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new OpError(400, 'speaker_names must be an object of names');
  const out = {};
  for (const k of Object.keys(v)) {
    if (typeof v[k] !== 'string' || v[k].trim() === '' || k.trim() === '') throw new OpError(400, 'speaker_names must map labels to names');
    out[k.trim()] = v[k].trim();
  }
  return out;
}

/** A note's speaker names by detection label. */
function speakerNames(rec) {
  const raw = rec.getString('speaker_names');
  return raw === '' || raw === 'null' ? {} : nameMap(JSON.parse(raw));
}

function segmentList(v) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new OpError(400, 'segments must be a list');
  return v.map((s) => {
    if (s === null || typeof s !== 'object' || typeof s.text !== 'string' || typeof s.start !== 'number' || typeof s.end !== 'number') {
      throw new OpError(400, 'each segment needs start (seconds), end (seconds) and text');
    }
    if (s.speaker !== undefined && s.speaker !== null && typeof s.speaker !== 'string') {
      throw new OpError(400, 'a segment speaker must be a string');
    }
    return { start: s.start, end: s.end, text: s.text, speaker: typeof s.speaker === 'string' ? s.speaker.trim() : '' };
  });
}

/** One transcript line: "Person 1: text" when the speaker is known. */
function spoken(s) {
  return s.speaker ? s.speaker + ': ' + s.text.trim() : s.text.trim();
}

function actionList(v) {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new OpError(400, 'action_items must be a list');
  return v.map((a) => {
    if (a === null || typeof a !== 'object' || typeof a.id !== 'string' || a.id === '' || typeof a.title !== 'string') {
      throw new OpError(400, 'each action item needs an id and a title');
    }
    // completed / dueDate: the first version's names, still accepted.
    const due = typeof a.due === 'string' ? a.due : typeof a.dueDate === 'string' ? a.dueDate : '';
    if (due !== '' && !isDay(due)) throw new OpError(400, 'action item due date must be YYYY-MM-DD');
    return {
      id: a.id,
      title: a.title,
      assignee: typeof a.assignee === 'string' ? a.assignee : '',
      due: due,
      done: typeof a.done === 'boolean' ? a.done : a.completed === true,
    };
  });
}

function deriveTranscript(segments) {
  return segments.map(spoken).join('\n');
}

/**
 * Record invariants, run on every save (UI writes, ops and the worker):
 * JSON fields keep their shapes, dates are real days, and the transcript
 * follows the segments.
 */
function normalize(rec) {
  const segments = segmentList(JSON.parse(rec.getString('segments') || 'null'));
  rec.set('segments', segments);
  if (segments.length > 0) rec.set('transcript', deriveTranscript(segments));
  rec.set('key_points', stringList(JSON.parse(rec.getString('key_points') || 'null'), 'key_points'));
  rec.set('decisions', stringList(JSON.parse(rec.getString('decisions') || 'null'), 'decisions'));
  rec.set('attendees', stringList(JSON.parse(rec.getString('attendees') || 'null'), 'attendees'));
  rec.set('people_found', stringList(JSON.parse(rec.getString('people_found') || 'null'), 'people_found'));
  rec.set('people_removed', stringList(JSON.parse(rec.getString('people_removed') || 'null'), 'people_removed'));
  rec.set('speaker_names', nameMap(JSON.parse(rec.getString('speaker_names') || 'null')));
  rec.set('action_items', actionList(JSON.parse(rec.getString('action_items') || 'null')));
  const date = rec.getString('date');
  if (date !== '' && !isDay(date)) throw new OpError(400, 'date must be YYYY-MM-DD');
}

/**
 * The attendee list is the user's: a name the user takes off it is
 * remembered in people_removed (so speaker detection never adds it back),
 * and a name put back on it is forgotten there. Called by the update op
 * (the user's edits) with the list before the edit; detection's own changes
 * to the list are not the user's and are not tracked.
 */
function trackAttendeeEdits(rec, prev) {
  const next = stringList(JSON.parse(rec.getString('attendees') || 'null'), 'attendees');
  const nextLower = next.map((n) => n.toLowerCase());
  const prevLower = prev.map((n) => n.toLowerCase());
  const dropped = prev.filter((n) => nextLower.indexOf(n.toLowerCase()) === -1);
  const added = next.filter((n) => prevLower.indexOf(n.toLowerCase()) === -1).map((n) => n.toLowerCase());
  if (dropped.length === 0 && added.length === 0) return;
  let removed = stringList(JSON.parse(rec.getString('people_removed') || 'null'), 'people_removed');
  removed = removed.filter((n) => added.indexOf(n.toLowerCase()) === -1);
  const removedLower = removed.map((n) => n.toLowerCase());
  for (const n of dropped) if (removedLower.indexOf(n.toLowerCase()) === -1) removed.push(n);
  rec.set('people_removed', removed);
}

/**
 * Change a note atomically: read, change and save in ONE transaction.
 * PocketBase runs write transactions one at a time, so writers never save
 * over each other (a full-record save from a stale copy once dropped two
 * transcribed pieces and left a recording stuck). fn(rec) changes the record
 * and must not touch the app itself; returning false skips the save.
 * Returns the saved record, or null when the note no longer exists.
 */
function mutate(app, id, fn) {
  let saved = null;
  app.runInTransaction((txApp) => {
    let rec;
    try {
      rec = txApp.findRecordById('notes', id);
    } catch {
      return;
    }
    if (fn(rec) === false) return;
    txApp.save(rec);
    saved = rec;
  });
  return saved;
}

/** A note by id, or by exact (case-insensitive) title when that is unique. */
function resolve(app, ref) {
  const key = String(ref || '').trim();
  if (key === '') throw new OpError(400, 'note_id is required');
  try {
    return app.findRecordById('notes', key);
  } catch {
    /* not an id: try the title */
  }
  const hits = app.findRecordsByFilter('notes', 'title ~ {:t}', '-created', 0, 0, { t: key });
  const exact = hits.filter((r) => r.getString('title').toLowerCase() === key.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new OpError(409, 'Several notes are titled "' + key + '"; use an id: ' + exact.map((r) => r.id).join(', '));
  }
  throw new OpError(404, 'No note with id or title "' + key + '". List them with notes.list.');
}

function audioUrl(rec) {
  const file = rec.getString('audio');
  return file === '' ? '' : '/api/files/notes/' + rec.id + '/' + file;
}

/** API shape. Long fields (segments, transcript) only when asked for. */
function toApi(rec, full) {
  const out = {
    id: rec.id,
    title: rec.getString('title'),
    date: rec.getString('date'),
    category: rec.getString('category'),
    starred: rec.getBool('starred'),
    source: rec.getString('source'),
    duration_seconds: rec.getInt('duration'),
    peak_db: rec.getFloat('peak_db'),
    has_audio: rec.getString('audio') !== '',
    audio_url: audioUrl(rec),
    language: rec.getString('language'),
    detected_language: rec.getString('detected_language'),
    transcript_status: rec.getString('transcript_status'),
    transcript_error: rec.getString('transcript_error'),
    notes_status: rec.getString('notes_status'),
    notes_error: rec.getString('notes_error'),
    overview: rec.getString('overview'),
    summary: rec.getString('summary'),
    key_points: list(rec, 'key_points'),
    decisions: list(rec, 'decisions'),
    action_items: list(rec, 'action_items'),
    attendees: list(rec, 'attendees'),
    people_found: list(rec, 'people_found'),
    people_removed: list(rec, 'people_removed'),
    people_status: rec.getString('people_status'),
    people_error: rec.getString('people_error'),
    speaker_count: rec.getInt('speaker_count'),
    speaker_names: speakerNames(rec),
    my_notes: rec.getString('my_notes'),
    created: rec.getString('created'),
    updated: rec.getString('updated'),
  };
  if (full) {
    out.transcript = rec.getString('transcript');
    out.segments = list(rec, 'segments');
  }
  return out;
}

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return (h > 0 ? h + ':' + pad(m) : pad(m)) + ':' + pad(s % 60);
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n, w) => String(n).padStart(w, '0');
  return (
    pad(Math.floor(ms / 3600000), 2) + ':' + pad(Math.floor((ms % 3600000) / 60000), 2) + ':' +
    pad(Math.floor((ms % 60000) / 1000), 2) + ',' + pad(ms % 1000, 3)
  );
}

function transcriptText(rec) {
  const segments = list(rec, 'segments');
  if (segments.length === 0) return rec.getString('transcript');
  return segments.map((s) => '[' + clock(s.start) + '] ' + spoken(s)).join('\n');
}

function bullets(items) {
  return items.map((t) => '- ' + t).join('\n');
}

function actionLine(a) {
  let line = '- [' + (a.done ? 'x' : ' ') + '] ' + a.title;
  if (a.assignee) line += ' (' + a.assignee + ')';
  if (a.due) line += ', due ' + a.due;
  return line;
}

function markdown(rec) {
  const n = toApi(rec, false);
  const parts = ['# ' + n.title, ''];
  const meta = [];
  if (n.date) meta.push('**Date:** ' + n.date);
  if (n.duration_seconds > 0) meta.push('**Length:** ' + clock(n.duration_seconds));
  if (n.category) meta.push('**Category:** ' + n.category);
  if (n.attendees.length > 0) meta.push('**Attendees:** ' + n.attendees.join(', '));
  if (meta.length > 0) parts.push(meta.join('  \n'), '');
  if (n.overview) parts.push('## Overview', '', n.overview, '');
  if (n.summary) parts.push('## Summary', '', n.summary, '');
  if (n.key_points.length > 0) parts.push('## Key points', '', bullets(n.key_points), '');
  if (n.decisions.length > 0) parts.push('## Decisions', '', bullets(n.decisions), '');
  if (n.action_items.length > 0) parts.push('## Action items', '', n.action_items.map(actionLine).join('\n'), '');
  if (n.my_notes) parts.push('## My notes', '', n.my_notes, '');
  const transcript = transcriptText(rec);
  if (transcript) parts.push('## Transcript', '', transcript, '');
  return parts.join('\n');
}

function srt(rec) {
  const segments = list(rec, 'segments');
  if (segments.length === 0) throw new OpError(409, 'Subtitles need a timed transcript; this note has none.');
  return segments.map((s, i) => i + 1 + '\n' + srtTime(s.start) + ' --> ' + srtTime(s.end) + '\n' + spoken(s) + '\n').join('\n');
}

function fileBase(rec) {
  const t = rec.getString('title').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return t === '' ? 'note' : t.slice(0, 80);
}

/** { filename, mime, content } for format md | txt | srt. */
function exportNote(rec, format) {
  if (format === 'md') return { filename: fileBase(rec) + '.md', mime: 'text/markdown', content: markdown(rec) };
  if (format === 'txt') {
    const text = transcriptText(rec);
    if (text === '') throw new OpError(409, 'This note has no transcript yet.');
    return { filename: fileBase(rec) + ' (transcript).txt', mime: 'text/plain', content: text + '\n' };
  }
  if (format === 'srt') return { filename: fileBase(rec) + '.srt', mime: 'application/x-subrip', content: srt(rec) };
  throw new OpError(400, 'format must be md, txt or srt');
}

/** Week digest for the Monday-start week containing `day`. */
function digest(app, day) {
  const start = weekStart(day);
  const end = addDays(start, 6);
  const recs = app.findRecordsByFilter('notes', 'date >= {:a} && date <= {:b}', 'date,created', 0, 0, { a: start, b: end });
  const notes = recs.map((r) => toApi(r, false));
  const people = {};
  let seconds = 0;
  let open = 0;
  let done = 0;
  for (const n of notes) {
    seconds += n.duration_seconds;
    for (const p of n.attendees) people[p.toLowerCase()] = p;
    for (const a of n.action_items) a.done ? done++ : open++;
  }
  const md = ['# Week of ' + start + ' to ' + end, ''];
  md.push(notes.length + ' notes, ' + clock(seconds) + ' recorded, ' + open + ' open action items, ' + done + ' done.', '');
  for (const n of notes) {
    md.push('## ' + n.title + (n.date ? ' (' + n.date + ')' : ''), '');
    if (n.attendees.length > 0) md.push('**Attendees:** ' + n.attendees.join(', '), '');
    if (n.summary) md.push(n.summary, '');
    if (n.decisions.length > 0) md.push('**Decisions**', '', bullets(n.decisions), '');
    if (n.action_items.length > 0) md.push('**Action items**', '', n.action_items.map(actionLine).join('\n'), '');
  }
  return {
    week_start: start,
    week_end: end,
    totals: {
      notes: notes.length,
      recorded_seconds: seconds,
      open_actions: open,
      done_actions: done,
      people: Object.keys(people).length,
    },
    notes: notes,
    markdown: md.join('\n'),
  };
}

module.exports = {
  OpError: OpError,
  list: list,
  isDay: isDay,
  weekday: weekday,
  weekStart: weekStart,
  stringList: stringList,
  speakerNames: speakerNames,
  actionList: actionList,
  deriveTranscript: deriveTranscript,
  normalize: normalize,
  mutate: mutate,
  trackAttendeeEdits: trackAttendeeEdits,
  resolve: resolve,
  toApi: toApi,
  clock: clock,
  exportNote: exportNote,
  digest: digest,
};
