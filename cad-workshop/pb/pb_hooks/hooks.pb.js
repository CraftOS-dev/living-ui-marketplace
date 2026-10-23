/// <reference path="../pb_data/types.d.ts" />
/**
 * Record guards and background work.
 *
 * Every collection changes only through the app's operations (they keep the
 * tree, its journal, its builds and the engine in step), so direct API
 * writes are refused with a pointer to the operation to use. Hook code
 * writes through its own app handle and is not affected.
 */

const CAD_COLLECTIONS = ['settings', 'parts', 'parameters', 'features', 'builds', 'changes', 'exports', 'selections', 'checks', 'assets', 'briefs', 'compares'];

onRecordCreateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...CAD_COLLECTIONS);
onRecordUpdateRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...CAD_COLLECTIONS);
onRecordDeleteRequest((e) => require(`${__hooks}/lib_rules.js`).refuse(e.record), ...CAD_COLLECTIONS);

// The build worker: drains queued builds, then waits on its wake flag until
// second 59 of the minute (an edit sets the flag), so it never polls.
cronAdd('cad_builds', '* * * * *', () => {
  try {
    require(`${__hooks}/lib_builds.js`).work($app);
  } catch (err) {
    console.error('[cad-workshop] build worker failed:', err);
  }
});

// First-run setup: downloads the geometry engine once (lib_setup.js), then
// returns at once on every later tick.
cronAdd('cad_engine_setup', '* * * * *', () => {
  try {
    require(`${__hooks}/lib_setup.js`).run($app);
  } catch (err) {
    console.error('[cad-workshop] engine setup lane failed:', err);
  }
});

onBootstrap((e) => {
  e.next();
  try {
    require(`${__hooks}/lib_builds.js`).requeueInterrupted(e.app);
  } catch (err) {
    console.error('[cad-workshop] requeue on boot failed:', err);
  }
});

onTerminate((e) => {
  try {
    require(`${__hooks}/lib_engine.js`).stop(e.app);
  } catch (err) {
    console.error('[cad-workshop] stopping the engine failed:', err);
  }
  try {
    require(`${__hooks}/lib_setup.js`).killRunning(e.app);
  } catch (err) {
    console.error('[cad-workshop] stopping the engine setup failed:', err);
  }
  e.next();
});
