/// <reference path="../pb_data/types.d.ts" />
/**
 * Notes lifecycle: record invariants, the background worker, boot recovery.
 * GOJA RULE: callbacks run in isolated VMs; require() libraries inside them.
 */

// Invariants on every save, whoever writes (UI, ops, worker): JSON shapes,
// real dates, transcript derived from segments.
onRecordCreate((e) => {
  try {
    require(`${__hooks}/lib_notes.js`).normalize(e.record);
  } catch (err) {
    throw new BadRequestError(String(err.message || err));
  }
  e.next();
}, 'notes');

onRecordUpdate((e) => {
  try {
    require(`${__hooks}/lib_notes.js`).normalize(e.record);
  } catch (err) {
    throw new BadRequestError(String(err.message || err));
  }
  e.next();
}, 'notes');

// Queued work wakes the idle worker (it waits on this flag, not the DB).
onRecordAfterCreateSuccess((e) => {
  e.next();
  if (e.record.getString('transcript_status') === 'queued' || e.record.getString('notes_status') === 'queued') {
    require(`${__hooks}/lib_worker.js`).wake(e.app);
  }
  if (e.record.getString('people_status') === 'queued') require(`${__hooks}/lib_people.js`).wake(e.app);
  if (e.record.getString('transcript_status') === 'live') require(`${__hooks}/lib_live.js`).warm(e.app);
}, 'notes');

onRecordAfterUpdateSuccess((e) => {
  e.next();
  if (e.record.getString('transcript_status') === 'queued' || e.record.getString('notes_status') === 'queued') {
    require(`${__hooks}/lib_worker.js`).wake(e.app);
  }
  if (e.record.getString('people_status') === 'queued') require(`${__hooks}/lib_people.js`).wake(e.app);
}, 'notes');

// Deleting a note whose audio is being processed stops the process (batch,
// live and speaker lanes alike).
onRecordAfterDeleteSuccess((e) => {
  e.next();
  const job = e.app.store().get('audio_notes.job');
  if (job !== null && job !== undefined && job.note_id === e.record.id) {
    e.app.store().set('audio_notes.cancel', e.record.id);
    require(`${__hooks}/lib_engine.js`).kill(job.pid);
  }
  require(`${__hooks}/lib_live.js`).killRunning(e.app, e.record.id);
  require(`${__hooks}/lib_people.js`).killRunning(e.app, e.record.id);
}, 'notes');

// A recording piece arrived: wake the live lane.
onRecordAfterCreateSuccess((e) => {
  e.next();
  require(`${__hooks}/lib_live.js`).wake(e.app);
}, 'live_chunks');

// The workers: each drains its queue, then waits on its wake flag until just
// before the next tick. Batch = files and AI notes; live = pieces of a running recording.
cronAdd('audio_notes_worker', '* * * * *', () => {
  require(`${__hooks}/lib_worker.js`).run($app);
});

cronAdd('audio_notes_live', '* * * * *', () => {
  require(`${__hooks}/lib_live.js`).run($app);
});

// Speaker detection (its own lane, so it never slows transcription).
cronAdd('audio_notes_people', '* * * * *', () => {
  require(`${__hooks}/lib_people.js`).run($app);
});

// First-run download of the speech engine (lib_setup.js).
cronAdd('audio_notes_setup', '* * * * *', () => {
  require(`${__hooks}/lib_setup.js`).run($app);
});

onBootstrap((e) => {
  e.next();
  try {
    require(`${__hooks}/lib_worker.js`).requeueInterrupted(e.app);
  } catch (err) {
    console.error('[audio-notes] requeue on boot failed:', err);
  }
});

onTerminate((e) => {
  try {
    require(`${__hooks}/lib_worker.js`).killRunning(e.app);
    require(`${__hooks}/lib_live.js`).killRunning(e.app);
    require(`${__hooks}/lib_people.js`).killRunning(e.app);
    require(`${__hooks}/lib_setup.js`).killRunning(e.app);
  } catch (err) {
    console.error('[audio-notes] stopping the engine on shutdown failed:', err);
  }
  e.next();
});
