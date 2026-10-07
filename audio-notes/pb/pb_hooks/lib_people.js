/// <reference path="../pb_data/types.d.ts" />
/**
 * Speakers: who spoke when, told apart by their VOICES, never guessed from
 * names in the text. The local speaker engine (lib_engine diarizeArgs)
 * splits the recording into voices; each voice becomes a person numbered in
 * order of first speech: Person 1, Person 2, ...
 *
 * Every transcript line gets the person speaking most during it
 * (segment.speaker), people_found holds the people detected, and the
 * attendee list gains each one the user has not removed (people_removed).
 * A person the user renamed keeps that name (speaker_names, by label).
 * A re-detection takes off the list the people an earlier detection added
 * that are no longer heard; names the user typed are never touched.
 *
 * Runs on its own lane (cron + lock + wake flag, like lib_live.js), after a
 * recording or file is transcribed, so it never delays the transcript.
 */

const LOCK = 'audio_notes.people_worker';
const WAKE = 'audio_notes.people_wake';
const JOB = 'audio_notes.people_job';

/**
 * A voice heard for less than max(FRAGMENT_SECONDS, FRAGMENT_SHARE of all
 * speech) is a fragment (a cough, a laugh, one word), never a person. On the
 * real 35-minute 2-person call the fragments were 1-9 s next to minutes.
 */
const FRAGMENT_SECONDS = 3;
const FRAGMENT_SHARE = 0.01;
/** A line no voice overlaps takes the nearest person within this many seconds. */
const NEAR = 3;

function beforeHandover() {
  return new Date().getSeconds() < 58;
}

function lower(list) {
  return list.map((n) => n.toLowerCase());
}

/** Union by case-insensitive name; the first spelling wins. */
function union(a, b) {
  const out = a.slice();
  const seen = lower(a);
  for (const n of b) {
    if (seen.indexOf(n.toLowerCase()) === -1) {
      out.push(n);
      seen.push(n.toLowerCase());
    }
  }
  return out;
}

/** Seconds of speech per voice. */
function talkTimes(rawTurns) {
  const talk = {};
  for (const t of rawTurns) talk[t.voice] = (talk[t.voice] || 0) + (t.end - t.start);
  return talk;
}

/**
 * How many people the voices are. One person's voice can split into
 * clusters: on the user's real 2-person room-mic call the interviewer came
 * out as 336 s + 240 s + 64 s (talking vs pitching) next to the candidate's
 * 1337 s, and no clustering threshold merged them without also merging two
 * different people in clean recordings. So, besides dropping fragments, a
 * voice counts as one of K people only when it, together with the smaller
 * voices that will merge into someone, says at least half of an equal share
 * (1 / 2K of the speech). That counted every test recording right (the real
 * call: 2; clean 2- and 4-speaker recordings: 2 and 4); a quieter person can
 * be under-counted, which the user fixes by setting the number of people.
 * Returns { voices, people }: clusters that are not fragments, and the count.
 */
function countPeople(talk) {
  const times = Object.keys(talk).map((v) => talk[v]).sort((a, b) => b - a);
  const total = times.reduce((a, b) => a + b, 0);
  if (total === 0) return { voices: 0, people: 0 };
  const floor = Math.max(FRAGMENT_SECONDS, total * FRAGMENT_SHARE);
  const voices = Math.max(1, times.filter((t) => t >= floor).length);
  let k = voices;
  let merged = 0;
  while (k > 1 && times[k - 1] + merged < total / (2 * k)) {
    merged += times[k - 1];
    k--;
  }
  return { voices: voices, people: k };
}

/**
 * Raw diarizer turns -> the `keep` voices heard most, numbered by first
 * speech. Returns { turns: [{start, end, speaker}], labels: ['Person 1', ...] }.
 */
function people(rawTurns, keep) {
  const talk = talkTimes(rawTurns);
  const top = Object.keys(talk)
    .sort((a, b) => talk[b] - talk[a])
    .slice(0, keep);
  const kept = rawTurns.filter((t) => top.indexOf(t.voice) !== -1).sort((a, b) => a.start - b.start);
  const label = {};
  const labels = [];
  for (const t of kept) {
    if (!(t.voice in label)) {
      label[t.voice] = 'Person ' + (labels.length + 1);
      labels.push(label[t.voice]);
    }
  }
  return { turns: kept.map((t) => ({ start: t.start, end: t.end, speaker: label[t.voice] })), labels: labels };
}

/** The person speaking most during [start, end]; '' when nobody is near. */
function speakerAt(turns, start, end) {
  const share = {};
  for (const t of turns) {
    const overlap = Math.min(end, t.end) - Math.max(start, t.start);
    if (overlap > 0) share[t.speaker] = (share[t.speaker] || 0) + overlap;
  }
  let best = '';
  for (const k in share) if (best === '' || share[k] > share[best]) best = k;
  if (best !== '') return best;
  let gap = NEAR;
  for (const t of turns) {
    const d = t.end < start ? start - t.end : t.start > end ? t.start - end : 0;
    if (d < gap) {
      gap = d;
      best = t.speaker;
    }
  }
  return best;
}

/** Put detected people on a note (not saved), under the names they were given. */
function apply(rec, found) {
  const lib = require(`${__hooks}/lib_notes.js`);
  const names = lib.speakerNames(rec);
  for (const label of found.labels) if (!(label in names)) names[label] = label;
  rec.set('speaker_names', names);
  const shown = (label) => (label === '' ? '' : names[label]);
  const people = union([], found.labels.map(shown));
  rec.set(
    'segments',
    lib.list(rec, 'segments').map((s) => ({ start: s.start, end: s.end, text: s.text, speaker: shown(speakerAt(found.turns, s.start, s.end)) })),
  );
  const before = lower(lib.list(rec, 'people_found'));
  const now = lower(people);
  const removed = lower(lib.list(rec, 'people_removed'));
  // People an earlier detection added and no longer heard leave the list.
  const kept = lib.list(rec, 'attendees').filter((n) => before.indexOf(n.toLowerCase()) === -1 || now.indexOf(n.toLowerCase()) !== -1);
  rec.set('attendees', union(kept, people.filter((n) => removed.indexOf(n.toLowerCase()) === -1)));
  rec.set('people_found', people);
}

/**
 * Rename a speaker or attendee (not saved): the lines they speak, the
 * attendee, detected and removed lists, and the action items assigned to
 * them. A detected voice keeps the name through later detections. Giving a
 * speaker another speaker's name merges the two (how a voice detected as
 * two people is joined). Returns false when nobody in the note is `from`.
 */
function rename(rec, from, to) {
  const lib = require(`${__hooks}/lib_notes.js`);
  const swap = (n) => (n === from ? to : n);
  const segments = lib.list(rec, 'segments');
  const found = lib.list(rec, 'people_found');
  const attendees = lib.list(rec, 'attendees');
  if (!segments.some((s) => s.speaker === from) && found.indexOf(from) === -1 && attendees.indexOf(from) === -1) return false;
  const names = lib.speakerNames(rec);
  for (const label of Object.keys(names)) names[label] = swap(names[label]);
  rec.set('speaker_names', names);
  rec.set(
    'segments',
    segments.map((s) => ({ start: s.start, end: s.end, text: s.text, speaker: swap(s.speaker || '') })),
  );
  rec.set('people_found', union([], found.map(swap)));
  rec.set('attendees', union([], attendees.map(swap)));
  rec.set('people_removed', union([], lib.list(rec, 'people_removed').map(swap)));
  rec.set(
    'action_items',
    lib.list(rec, 'action_items').map((a) => ({ id: a.id, title: a.title, assignee: swap(a.assignee), due: a.due, done: a.done })),
  );
  return true;
}

/** Queue a detection on a note that has audio (not saved). */
function queue(rec) {
  if (rec.getString('audio') === '') return;
  rec.set('people_status', 'queued');
  rec.set('people_error', '');
}

function detect(app, id) {
  const lib = require(`${__hooks}/lib_notes.js`);
  const eng = require(`${__hooks}/lib_engine.js`);
  const rec = lib.mutate(app, id, (r) => {
    r.set('people_status', 'processing');
    r.set('people_error', '');
  });
  if (rec === null) return;
  const fail = (message) =>
    lib.mutate(app, id, (r) => {
      r.set('people_status', 'failed');
      r.set('people_error', message);
    });

  const missing = eng.speakerMissing();
  if (missing.length > 0) {
    fail('The speaker engine is not installed yet. Download it from the banner above, then detect the speakers again.');
    return;
  }
  const audio = rec.getString('audio');
  if (audio === '') {
    fail('This note has no audio to tell the speakers apart in.');
    return;
  }
  const src = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), audio);
  const dir = eng.workDir(id + '-people');
  $os.removeAll(dir);
  $os.mkdirAll(dir, 0o755);
  try {
    const wav = $filepath.join(dir, 'audio.wav');
    const conv = eng.start(eng.paths().ffmpeg, eng.wavArgs(src, wav), $filepath.join(dir, 'ffmpeg.log'), 'people');
    app.store().set(JOB, { note_id: id, pid: conv.pid });
    const c = eng.finish(conv);
    if (!c.ok) {
      fail('ffmpeg could not read this audio file: ' + (eng.tail(c.log, 3) || 'exit code ' + c.exitCode));
      return;
    }
    // One diarizer pass: clusters = speakers (a fixed number), or by threshold (0).
    let pass = 0;
    const diarize = (speakers) => {
      pass++;
      const out = 'turns-' + pass + '.txt';
      const run = eng.start(eng.paths().diarizer, eng.diarizeArgs(wav, speakers), $filepath.join(dir, 'diarize-' + pass + '.log'), 'people', out);
      app.store().set(JOB, { note_id: id, pid: run.pid });
      const d = eng.finish(run);
      if (!d.ok) throw new Error(eng.tail(d.log, 3) || 'exit code ' + d.exitCode);
      return eng.readTurns(eng.readText($filepath.join(dir, out)));
    };
    const count = rec.getInt('speaker_count');
    let raw;
    let keep;
    try {
      if (count > 0) {
        raw = diarize(count);
        keep = count;
      } else {
        raw = diarize(0);
        const n = countPeople(talkTimes(raw));
        keep = n.people;
        // Voices that are not one person each: cluster again into that many
        // people, so their speech joins the voice it sounds closest to.
        if (n.people < n.voices) raw = diarize(n.people);
      }
    } catch (err) {
      fail('Telling the speakers apart failed: ' + String(err.message || err));
      return;
    }
    const found = people(raw, keep);
    lib.mutate(app, id, (now) => {
      apply(now, found);
      now.set('people_status', 'done');
      now.set('people_error', '');
    });
  } catch (err) {
    console.error('[audio-notes] speaker detection of ' + id + ' failed:', err);
    fail('Telling the speakers apart failed: ' + String(err));
  } finally {
    app.store().remove(JOB);
    $os.removeAll(dir);
  }
}

function run(app) {
  const store = app.store();
  const me = $security.randomString(16);
  if (store.getOrSet(LOCK, () => me) !== me) return;
  try {
    for (;;) {
      store.remove(WAKE);
      // Speaker engine still downloading: detections stay queued until it is in place.
      const holding = require(`${__hooks}/lib_setup.js`).waiting(app, 'speakers');
      const next = holding ? [] : app.findRecordsByFilter('notes', "people_status = 'queued'", 'updated', 1, 0);
      if (next.length > 0) {
        try {
          detect(app, next[0].id);
        } catch (err) {
          console.error('[audio-notes] speaker detection crashed:', err);
          require(`${__hooks}/lib_notes.js`).mutate(app, next[0].id, (rec) => {
            rec.set('people_status', 'failed');
            rec.set('people_error', 'Telling the speakers apart failed: ' + String(err));
          });
        }
        continue;
      }
      while (beforeHandover() && !store.has(WAKE)) sleep(500);
      if (!store.has(WAKE)) break;
    }
  } finally {
    store.remove(LOCK);
  }
}

function wake(app) {
  app.store().set(WAKE, true);
}

/** The speaker engine's state (read by engine status). */
function status(app) {
  const job = app.store().get(JOB);
  const missing = require(`${__hooks}/lib_engine.js`).speakerMissing();
  return {
    installed: missing.length === 0,
    missing: missing,
    busy: job !== null && job !== undefined,
    note_id: job !== null && job !== undefined ? job.note_id : '',
    queued: app.countRecords('notes', $dbx.hashExp({ people_status: 'queued' })),
  };
}

/** Stop the running detection (its note was deleted, or the app stops). */
function killRunning(app, noteId) {
  const job = app.store().get(JOB);
  if (job !== null && job !== undefined && (noteId === undefined || job.note_id === noteId)) {
    require(`${__hooks}/lib_engine.js`).kill(job.pid);
  }
}

module.exports = { run: run, wake: wake, queue: queue, status: status, killRunning: killRunning, rename: rename, countPeople: countPeople, people: people, speakerAt: speakerAt };
