/// <reference path="../pb_data/types.d.ts" />
/**
 * Record guards and background work.
 *
 * Every collection changes only through the app's operations (they keep the
 * edit stacks, their journal and the previews in step), so direct API writes
 * are refused with a pointer to the operation to use. Hook code writes
 * through its own app handle and is not affected.
 */

const IMG_COLLECTIONS = ['settings', 'images', 'edits', 'changes', 'proposals', 'exports', 'presets', 'batches', 'assets', 'requests'];

onRecordCreateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...IMG_COLLECTIONS);
onRecordUpdateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...IMG_COLLECTIONS);
onRecordDeleteRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...IMG_COLLECTIONS);

// First-run setup of the image engine (and the background add-on on request).
cronAdd('img_engine_setup', '* * * * *', () => {
  try {
    require(`${__hooks}/lib_setup.js`).run($app);
  } catch (err) {
    console.error('[image-utility] engine setup lane failed:', err);
  }
});

// The worker: images waiting for the engine, then queued batches; between
// jobs it waits on its wake flag until the minute's end, so it never polls the database.
cronAdd('img_worker', '* * * * *', () => {
  try {
    require(`${__hooks}/lib_batch.js`).lane($app);
  } catch (err) {
    console.error('[image-utility] worker failed:', err);
  }
});

// Nightly: previews and work files older than a week (they are made again on demand).
cronAdd('img_prune', '41 3 * * *', () => {
  try {
    const R = require(`${__hooks}/lib_render.js`);
    R.prune($app, 7);
    const work = R.workDir($app);
    const cut = Date.now() - 2 * 86400000;
    for (const d of $os.readDir(work)) {
      try {
        if (d.info().modTime().unixMilli() < cut) $os.removeAll($filepath.join(work, d.name()));
      } catch {
        /* in use */
      }
    }
  } catch (err) {
    console.error('[image-utility] prune failed:', err);
  }
});

onBootstrap((e) => {
  e.next();
  try {
    require(`${__hooks}/lib_batch.js`).requeueInterrupted(e.app);
  } catch (err) {
    console.error('[image-utility] requeue on boot failed:', err);
  }
});

onTerminate((e) => {
  try {
    require(`${__hooks}/lib_engine.js`).stop(e.app);
  } catch (err) {
    console.error('[image-utility] stopping the engine failed:', err);
  }
  try {
    require(`${__hooks}/lib_setup.js`).killRunning(e.app);
  } catch (err) {
    console.error('[image-utility] stopping the engine setup failed:', err);
  }
  e.next();
});
