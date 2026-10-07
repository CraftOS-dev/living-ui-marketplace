/// <reference path="../pb_data/types.d.ts" />
/**
 * The live lane: transcribes recording pieces (`live_chunks`) while the
 * meeting is still going, separate from the batch lane (lib_worker.js) so a
 * long file being transcribed never holds up the live transcript.
 *
 * Per note, pieces are taken in `seq` order. Each one is a 16 kHz mono WAV
 * cut at a pause by the browser; its segments are shifted by the piece's
 * `offset` and appended to the note. After Stop the page uploads every
 * remaining piece, then the note becomes `finishing`; as soon as no piece of
 * it is left it is finalized: the browser recording is remuxed (seek index),
 * its peak measured, and the status set to done / no_speech, which queues
 * the AI notes on the batch lane. Every note write is atomic
 * (lib_notes.mutate), so no writer can undo another's lines.
 *
 * Language: a note left on auto is pinned to the language the first piece
 * detected, so short pieces never flip between languages.
 */

const LOCK = 'audio_notes.live_worker';
const JOB = 'audio_notes.live_job';
const WAKE = 'audio_notes.live_wake';
const WARM = 'audio_notes.live_warm';
/** Idle until 2 s before the next cron tick, then hand over (see lib_worker). */
function beforeHandover() {
  return new Date().getSeconds() < 58;
}

function engine() {
  return require(`${__hooks}/lib_engine.js`);
}

function fresh(app, id) {
  try {
    return app.findRecordById('notes', id);
  } catch {
    return null;
  }
}

function nextChunk(app) {
  const oldest = app.findRecordsByFilter('live_chunks', '', 'created', 1, 0);
  if (oldest.length === 0) return null;
  const noteId = oldest[0].getString('note');
  return app.findRecordsByFilter('live_chunks', 'note = {:n}', 'seq,created', 1, 0, { n: noteId })[0];
}

function pendingFor(app, noteId) {
  return app.countRecords('live_chunks', $dbx.hashExp({ note: noteId }));
}

function transcribeChunk(app, chunk) {
  const eng = engine();
  const lib = require(`${__hooks}/lib_notes.js`);
  const noteId = chunk.getString('note');
  const note = fresh(app, noteId);
  if (note === null) {
    app.delete(chunk);
    return;
  }
  const wav = $filepath.join(app.dataDir(), 'storage', chunk.baseFilesPath(), chunk.getString('audio'));
  let language = note.getString('language');
  if (language === '' || language === 'auto') language = note.getString('detected_language');

  let segments = [];
  let detected = '';
  if (eng.missingFiles().length === 0) {
    const dir = eng.workDir(noteId + '-live');
    $os.mkdirAll(dir, 0o755);
    try {
      const outBase = $filepath.join(dir, 'out');
      const run = eng.start(eng.paths().whisper, eng.whisperArgs(wav, outBase, language, eng.wavDuration(wav)), $filepath.join(dir, 'whisper.log'), 'live');
      app.store().set(JOB, { note_id: noteId, pid: run.pid, seq: chunk.getInt('seq') });
      const w = eng.finish(run);
      if (w.ok) {
        const result = eng.readWhisperJson(outBase);
        const offset = chunk.getFloat('offset');
        segments = result.segments.map((s) => ({
          start: Math.round((s.start + offset) * 100) / 100,
          end: Math.round((s.end + offset) * 100) / 100,
          text: s.text,
        }));
        detected = result.language;
      } else {
        // One piece failing leaves a gap, not a broken recording.
        console.error('[audio-notes] live piece ' + chunk.getInt('seq') + ' of ' + noteId + ' failed: ' + eng.tail(w.log, 3));
      }
    } catch (err) {
      console.error('[audio-notes] live piece of ' + noteId + ' failed:', err);
    } finally {
      app.store().remove(JOB);
      $os.removeAll(dir);
    }
  }

  lib.mutate(app, noteId, (now) => {
    if (segments.length > 0) now.set('segments', lib.list(now, 'segments').concat(segments));
    if (now.getString('detected_language') === '' && segments.length > 0 && detected !== '') now.set('detected_language', detected);
    return segments.length > 0;
  });
  try {
    app.delete(chunk);
  } catch {
    /* already deleted with its note */
  }
}

/**
 * A recording just started: run the engine once on half a second of silence
 * so the model and libraries are loaded before the first real piece arrives
 * (measured: the first live line came ~3 s later than the rest when cold).
 */
function warmUp(app) {
  const eng = engine();
  if (eng.missingFiles().length > 0) return;
  const dir = eng.workDir('warm');
  $os.mkdirAll(dir, 0o755);
  try {
    const wav = $filepath.join(dir, 'silence.wav');
    const made = eng.finish(
      eng.start(eng.paths().ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.5', '-c:a', 'pcm_s16le', wav], $filepath.join(dir, 'ffmpeg.log'), 'live'),
    );
    if (made.ok) eng.finish(eng.start(eng.paths().whisper, eng.whisperArgs(wav, $filepath.join(dir, 'out'), 'en', 0.5), $filepath.join(dir, 'whisper.log'), 'live'));
  } catch (err) {
    console.error('[audio-notes] engine warm-up failed:', err);
  } finally {
    $os.removeAll(dir);
  }
}

/** Remux the browser recording and measure its peak; then settle the status. */
function finalize(app, note) {
  const eng = engine();
  const lib = require(`${__hooks}/lib_notes.js`);
  const id = note.id;
  const audio = note.getString('audio');
  let peak = null;
  if (audio !== '' && eng.missingFiles().length === 0) {
    const src = $filepath.join(app.dataDir(), 'storage', note.baseFilesPath(), audio);
    const dir = eng.workDir(id + '-final');
    $os.mkdirAll(dir, 0o755);
    try {
      const fixed = $filepath.join(dir, 'recording' + audio.slice(audio.lastIndexOf('.')));
      const r = eng.finish(eng.start(eng.paths().ffmpeg, eng.remuxArgs(src, fixed), $filepath.join(dir, 'remux.log'), 'live'));
      const measured = eng.finish(eng.start(eng.paths().ffmpeg, eng.measureArgs(r.ok ? fixed : src), $filepath.join(dir, 'measure.log'), 'live'));
      peak = eng.peakDb(measured.log);
      if (r.ok) lib.mutate(app, id, (now) => now.set('audio', $filesystem.fileFromPath(fixed)));
    } catch (err) {
      console.error('[audio-notes] finishing ' + id + ' (remux/measure) failed:', err);
    } finally {
      $os.removeAll(dir);
    }
  }
  lib.mutate(app, id, (now) => {
    const hasSpeech = lib.list(now, 'segments').length > 0;
    now.set('transcript_status', hasSpeech ? 'done' : 'no_speech');
    now.set('transcript_error', '');
    if (peak !== null) now.set('peak_db', peak);
    if (hasSpeech && now.getString('notes_status') === '') now.set('notes_status', 'queued');
    // The whole recording is on the server now: tell the speakers apart.
    if (hasSpeech) require(`${__hooks}/lib_people.js`).queue(now);
  });
}

/**
 * Notes whose recording stopped and that have no piece left. (The page
 * uploads every piece before it finishes, so an empty queue is complete.)
 */
function finalizeReady(app) {
  let any = false;
  for (const note of app.findRecordsByFilter('notes', "transcript_status = 'finishing'", 'updated', 0, 0)) {
    if (pendingFor(app, note.id) === 0) {
      finalize(app, note);
      any = true;
    }
  }
  return any;
}

/** Cron entry point; one live worker at a time. */
function run(app) {
  const store = app.store();
  const me = $security.randomString(16);
  if (store.getOrSet(LOCK, () => me) !== me) return;
  try {
    for (;;) {
      store.remove(WAKE);
      // Engine still downloading: keep the pieces (and the notes waiting on
      // them) until it is in place; setup wakes this lane then.
      const holding = require(`${__hooks}/lib_setup.js`).waiting(app, 'transcribe');
      const chunk = holding ? null : nextChunk(app);
      if (chunk !== undefined && chunk !== null) {
        transcribeChunk(app, chunk);
        continue;
      }
      if (!holding && finalizeReady(app)) continue;
      if (store.has(WARM)) {
        store.remove(WARM);
        warmUp(app);
        continue;
      }
      while (beforeHandover() && !store.has(WAKE)) sleep(250);
      if (!store.has(WAKE)) break;
    }
  } finally {
    store.remove(JOB);
    store.remove(LOCK);
  }
}

function wake(app) {
  app.store().set(WAKE, true);
}

/** Ask the live lane to warm the engine (a recording started). */
function warm(app) {
  app.store().set(WARM, true);
  wake(app);
}

/**
 * The recording stopped: attach its audio file (when the page sent one),
 * mark the note finishing, and let the lane finish the remaining pieces.
 * Returns the note, or null when it is gone.
 */
function finish(app, id, audioFile, seconds) {
  const lib = require(`${__hooks}/lib_notes.js`);
  const rec = lib.mutate(app, id, (note) => {
    if (note.getString('transcript_status') !== 'live') return false;
    if (audioFile !== null) note.set('audio', audioFile);
    if (seconds !== null) note.set('duration', seconds);
    note.set('transcript_status', 'finishing');
  });
  wake(app);
  return rec;
}

function status(app) {
  const job = app.store().get(JOB);
  return {
    busy: job !== null && job !== undefined,
    note_id: job !== null && job !== undefined ? job.note_id : '',
    pending: app.countRecords('live_chunks'),
  };
}

function killRunning(app, noteId) {
  const job = app.store().get(JOB);
  if (job !== null && job !== undefined && (noteId === undefined || job.note_id === noteId)) engine().kill(job.pid);
}

module.exports = { run: run, wake: wake, warm: warm, finish: finish, status: status, killRunning: killRunning };
