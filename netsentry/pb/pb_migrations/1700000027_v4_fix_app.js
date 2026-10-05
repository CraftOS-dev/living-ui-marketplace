/// <reference path="../pb_data/types.d.ts" />
/**
 * v4 walk-verify round 6: fixes for an app's problem never recorded the app, so they were missing from
 * that app's "Changes made". New fixes record it (services/remediations.js appOfFinding); this fills in
 * the ones already made, from the problem they fixed. Data only; nothing else changes.
 */
migrate((app) => {
  const rems = app.findRecordsByFilter('remediations', 'app = "" && finding != ""', '', 0, 0);
  for (const r of rems) {
    let f;
    try {
      f = app.findRecordById('findings', r.getString('finding'));
    } catch (_) {
      continue;
    }
    let ev = {};
    try {
      ev = JSON.parse(f.getString('evidence') || '{}') || {};
    } catch (_) {
      ev = {};
    }
    const id = String(ev.app_id || '');
    if (!id) continue;
    try {
      app.findRecordById('apps', id);
    } catch (_) {
      continue;
    }
    r.set('app', id);
    app.save(r);
  }
}, () => {
  // Filling in a missing link is not undone.
});
