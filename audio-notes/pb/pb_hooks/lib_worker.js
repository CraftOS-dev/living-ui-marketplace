/// <reference path="../pb_data/types.d.ts" />
/**
 * The background worker. A queue in the data (transcript_status /
 * notes_status = 'queued'), drained one job at a time:
 *
 *   transcribe: ffmpeg -> whisper -> segments; then queues notes the first
 *               time a note gets a transcript
 *   notes:      CraftBot LLM (JSON mode) -> summary, points, decisions,
 *               action items (and the title while it is automatic)
 *
 * A cron tick starts the worker every minute. After its last job it stays up
 * until just before the next tick, waiting on a WAKE flag that every save
 * queuing work sets (notes.pb.js),
 * so new work starts within a second without querying the database while
 * idle. One worker at a time: the lock is an atomic getOrSet in the app store
 * (process memory, so a crash can never leave a stale lock behind).
 *
 * The running job lives in the store too ({note_id, stage, pid, log, ...}),
 * which is how engine status reports progress and how cancel finds the
 * process to kill.
 */

const LOCK = 'audio_notes.worker';
const JOB = 'audio_notes.job';
const CANCEL = 'audio_notes.cancel';
const WAKE = 'audio_notes.wake';
/**
 * An idle worker stays up until 2 s before the next minute's cron tick, then
 * hands over to it: there is never more than ~2 s without a worker waiting
 * for its wake flag (a fixed idle span left gaps of up to a minute when a
 * long job ended late in a minute).
 */
function beforeHandover() {
  return new Date().getSeconds() < 58;
}

function engine() {
  return require(`${__hooks}/lib_engine.js`);
}
function notesLib() {
  return require(`${__hooks}/lib_notes.js`);
}

function setJob(app, job) {
  app.store().set(JOB, job);
}

function cancelled(app, noteId) {
  return app.store().get(CANCEL) === noteId;
}

/** Re-read a note; null when it was deleted while the job ran. */
function fresh(app, id) {
  try {
    return app.findRecordById('notes', id);
  } catch {
    return null;
  }
}

/** Set fields atomically (see lib_notes.mutate); null when the note is gone. */
function save(app, id, fields) {
  return notesLib().mutate(app, id, (rec) => {
    for (const k of Object.keys(fields)) rec.set(k, fields[k]);
  });
}

function nextJob(app) {
  // While the engine is still being downloaded, transcriptions stay queued
  // (setup wakes this lane when its files are in place); AI notes go on.
  if (!require(`${__hooks}/lib_setup.js`).waiting(app, 'transcribe')) {
    const t = app.findRecordsByFilter('notes', "transcript_status = 'queued'", 'updated', 1, 0);
    if (t.length > 0) return { kind: 'transcribe', id: t[0].id };
  }
  const n = app.findRecordsByFilter('notes', "notes_status = 'queued'", 'updated', 1, 0);
  if (n.length > 0) return { kind: 'notes', id: n[0].id };
  return null;
}

/** Status a step falls back to when it is cancelled: what the data says. */
function settledTranscriptStatus(rec) {
  return notesLib().list(rec, 'segments').length > 0 ? 'done' : '';
}
function settledNotesStatus(rec) {
  return rec.getString('summary') !== '' ? 'done' : '';
}

function transcribe(app, id) {
  const eng = engine();
  const rec = save(app, id, { transcript_status: 'processing', transcript_error: '' });
  if (rec === null) return;
  const fail = (message) => save(app, id, { transcript_status: 'failed', transcript_error: message });

  const missing = eng.missingFiles();
  if (missing.length > 0) {
    fail('The speech engine is not installed yet. Download it from the banner above, then retry this note.');
    return;
  }
  const audio = rec.getString('audio');
  if (audio === '') {
    fail('This note has no audio to transcribe.');
    return;
  }
  const src = $filepath.join(app.dataDir(), 'storage', rec.baseFilesPath(), audio);
  const dir = eng.workDir(id);
  $os.removeAll(dir);
  $os.mkdirAll(dir, 0o755);
  const started = Date.now();
  try {
    const wav = $filepath.join(dir, 'audio.wav');
    const conv = eng.start(eng.paths().ffmpeg, eng.ffmpegArgs(src, wav), $filepath.join(dir, 'ffmpeg.log'));
    setJob(app, { note_id: id, kind: 'transcribe', stage: 'converting', pid: conv.pid, log: '', seconds: 0, started: started });
    const c = eng.finish(conv);
    if (cancelled(app, id)) return;
    if (!c.ok) {
      fail('ffmpeg could not read this audio file: ' + (eng.tail(c.log, 3) || 'exit code ' + c.exitCode));
      return;
    }
    const peak = eng.peakDb(c.log);

    // Browser recordings have no duration or seek index in the file, so the
    // player cannot seek well and downloads show no length. A lossless remux
    // adds both. Optional: when it fails the original file stays as it is.
    if (rec.getString('source') === 'recording') {
      const fixed = $filepath.join(dir, 'recording' + audio.slice(audio.lastIndexOf('.')));
      const rm = eng.start(eng.paths().ffmpeg, eng.remuxArgs(src, fixed), $filepath.join(dir, 'remux.log'));
      setJob(app, { note_id: id, kind: 'transcribe', stage: 'converting', pid: rm.pid, log: '', seconds: 0, started: started });
      const r = eng.finish(rm);
      if (cancelled(app, id)) return;
      if (r.ok) {
        if (save(app, id, { audio: $filesystem.fileFromPath(fixed) }) === null) return;
      } else {
        console.error('[audio-notes] remux of ' + id + ' failed, keeping the original file: ' + eng.tail(r.log, 3));
      }
    }

    const seconds = eng.wavSeconds(wav);
    // Nothing to listen to: too short, or digital silence (no sound ever
    // reached the recorder). No need to run the speech engine on it.
    if (seconds < 1 || (peak !== null && peak <= eng.SILENT_DB)) {
      save(app, id, { transcript_status: 'no_speech', transcript_error: '', duration: seconds, peak_db: peak === null ? 0 : peak });
      return;
    }

    const language = rec.getString('language');
    const outBase = $filepath.join(dir, 'out');
    const whisperLog = $filepath.join(dir, 'whisper.log');
    const run = eng.start(eng.paths().whisper, eng.whisperArgs(wav, outBase, language === 'auto' ? '' : language), whisperLog);
    setJob(app, { note_id: id, kind: 'transcribe', stage: 'transcribing', pid: run.pid, log: whisperLog, seconds: seconds, started: started });
    const w = eng.finish(run);
    if (cancelled(app, id)) return;
    if (!w.ok) {
      fail('Transcription failed: ' + (eng.tail(w.log, 3) || 'exit code ' + w.exitCode));
      return;
    }
    const result = eng.readWhisperJson(outBase);

    notesLib().mutate(app, id, (now) => {
      now.set('segments', result.segments);
      now.set('detected_language', result.language);
      now.set('duration', seconds);
      if (peak !== null) now.set('peak_db', peak);
      now.set('transcript_error', '');
      if (result.segments.length === 0) {
        now.set('transcript_status', 'no_speech');
      } else {
        now.set('transcript_status', 'done');
        if (now.getString('notes_status') === '') now.set('notes_status', 'queued');
        // New lines: tell the speakers apart again.
        require(`${__hooks}/lib_people.js`).queue(now);
      }
    });
  } catch (err) {
    console.error('[audio-notes] transcription of ' + id + ' failed:', err);
    fail('Transcription failed: ' + String(err));
  } finally {
    $os.removeAll(dir);
  }
}

function writeNotes(app, id) {
  const lib = notesLib();
  const ai = require(`${__hooks}/lib_ai.js`);
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const rec = save(app, id, { notes_status: 'processing', notes_error: '' });
  if (rec === null) return;
  const fail = (message) => save(app, id, { notes_status: 'failed', notes_error: message });
  if (rec.getString('transcript').trim() === '') {
    fail('There is no transcript to write notes from.');
    return;
  }
  setJob(app, { note_id: id, kind: 'notes', stage: 'writing_notes', pid: 0, log: '', seconds: 0, started: Date.now() });

  const prompt = ai.buildPrompt(rec, lib);
  const reply = bridge.callLLM(prompt.user, prompt.system, { json: true });
  if (cancelled(app, id)) return;
  if (reply === '') {
    fail("CraftBot's AI did not answer. Check that CraftBot is running and its model works, then retry.");
    return;
  }
  let notes;
  try {
    notes = ai.parseReply(reply, lib);
  } catch (err) {
    console.error('[audio-notes] unusable AI reply for ' + id + ': ' + String(err) + '\n' + String(reply).slice(0, 2000));
    fail('The AI reply could not be used (' + String(err.message || err) + '). Retry to ask again.');
    return;
  }

  lib.mutate(app, id, (now) => {
    if (now.getBool('title_auto') && notes.title !== '') now.set('title', notes.title);
    now.set('overview', notes.overview);
    now.set('summary', notes.summary);
    now.set('key_points', notes.key_points);
    now.set('decisions', notes.decisions);
    now.set('action_items', notes.action_items);
    now.set('notes_status', 'done');
    now.set('notes_error', '');
  });
}

function runJob(app, job) {
  // A cancel is only ever for the job running when it was asked; one that
  // landed as the previous job was finishing must not hit this one.
  app.store().remove(CANCEL);
  try {
    if (job.kind === 'transcribe') transcribe(app, job.id);
    else writeNotes(app, job.id);
  } catch (err) {
    console.error('[audio-notes] job ' + job.kind + ' ' + job.id + ' crashed:', err);
    const field = job.kind === 'transcribe' ? 'transcript' : 'notes';
    const fields = {};
    fields[field + '_status'] = 'failed';
    fields[field + '_error'] = 'Unexpected error: ' + String(err);
    save(app, job.id, fields);
  }
  const store = app.store();
  if (store.get(CANCEL) === job.id) {
    // The cancel op killed the process (or the LLM answer arrived late):
    // settle the status from what the note actually holds.
    notesLib().mutate(app, job.id, (rec) => {
      if (job.kind === 'transcribe') {
        rec.set('transcript_status', settledTranscriptStatus(rec));
        rec.set('transcript_error', '');
      } else {
        rec.set('notes_status', settledNotesStatus(rec));
        rec.set('notes_error', '');
      }
    });
    store.remove(CANCEL);
  }
  store.remove(JOB);
}

/** Cron entry point. Returns immediately when another worker holds the lock. */
function run(app) {
  const store = app.store();
  const me = $security.randomString(16);
  if (store.getOrSet(LOCK, () => me) !== me) return;
  try {
    for (;;) {
      // Consume the signal BEFORE looking: anything queued after this point
      // sets it again and is seen by the wait below.
      store.remove(WAKE);
      const job = nextJob(app);
      if (job !== null) {
        runJob(app, job);
        continue;
      }
      while (beforeHandover() && !store.has(WAKE)) sleep(500);
      if (!store.has(WAKE)) break;
    }
  } finally {
    store.remove(JOB);
    store.remove(LOCK);
  }
}

/**
 * Cancel a note's queued or running work. Queued work goes back to what the
 * note holds; running work is flagged and its process killed (the worker
 * settles the status when the process returns).
 */
function cancel(app, id) {
  const store = app.store();
  const job = store.get(JOB);
  const running = job !== null && job !== undefined && job.note_id === id;
  if (running) {
    store.set(CANCEL, id);
    if (job.pid) engine().kill(job.pid);
  }
  let changed = false;
  notesLib().mutate(app, id, (rec) => {
    if (rec.getString('transcript_status') === 'queued') {
      rec.set('transcript_status', settledTranscriptStatus(rec));
      changed = true;
    }
    if (rec.getString('notes_status') === 'queued') {
      rec.set('notes_status', settledNotesStatus(rec));
      changed = true;
    }
    return changed;
  });
  return { running_cancelled: running, queued_cancelled: changed };
}

/** What the engine is doing right now (read by engine status). */
function status(app) {
  const eng = engine();
  const job = app.store().get(JOB);
  let current = null;
  if (job !== null && job !== undefined) {
    let percent = null;
    if (job.stage === 'transcribing' && job.log) percent = eng.whisperProgress(eng.readText(job.log));
    current = {
      note_id: job.note_id,
      stage: job.stage,
      percent: percent,
      audio_seconds: job.seconds,
      elapsed_seconds: Math.round((Date.now() - job.started) / 1000),
    };
  }
  const queuedT = app.countRecords('notes', $dbx.hashExp({ transcript_status: 'queued' }));
  const queuedN = app.countRecords('notes', $dbx.hashExp({ notes_status: 'queued' }));
  const missing = eng.missingFiles();
  return {
    installed: missing.length === 0,
    missing: missing,
    model: eng.MODEL_LABEL,
    busy: current !== null,
    job: current,
    queued: { transcriptions: queuedT, notes: queuedN },
    live: require(`${__hooks}/lib_live.js`).status(app),
    speakers: require(`${__hooks}/lib_people.js`).status(app),
    setup: require(`${__hooks}/lib_setup.js`).status(app),
  };
}

/** Boot: work that was running when the app stopped goes back in the queue. */
function requeueInterrupted(app) {
  engine().killOrphan();
  try {
    app.findCollectionByNameOrId('notes');
  } catch {
    return; // first boot of a fresh data dir: migrations have not run yet
  }
  for (const field of ['transcript_status', 'notes_status', 'people_status']) {
    const stuck = app.findRecordsByFilter('notes', field + " = 'processing'", '', 0, 0);
    for (const rec of stuck) {
      notesLib().mutate(app, rec.id, (now) => {
        if (now.getString(field) !== 'processing') return false;
        now.set(field, 'queued');
      });
    }
  }
}

/** Shutdown: do not leave a whisper process running without its worker. */
function killRunning(app) {
  const job = app.store().get(JOB);
  if (job !== null && job !== undefined && job.pid) engine().kill(job.pid);
}

/** Called by the record hooks whenever a save leaves work queued. */
function wake(app) {
  app.store().set(WAKE, true);
}

module.exports = { run: run, wake: wake, cancel: cancel, status: status, requeueInterrupted: requeueInterrupted, killRunning: killRunning };
