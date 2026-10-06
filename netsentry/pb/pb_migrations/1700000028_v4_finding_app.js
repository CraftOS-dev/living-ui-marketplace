/// <reference path="../pb_data/types.d.ts" />
/**
 * v4 walk-verify round 8: a server check that names a container (Docker publishing a port, …) never
 * recorded the app, so the problem was missing from that app's page and tile. New results record it
 * (services/findings.js withApp); this fills it in on the problems already stored. Data only.
 */
migrate((app) => {
  const ids = {};
  for (const a of app.findRecordsByFilter('apps', 'container != ""', '', 0, 0)) {
    if (a.getString('status') === 'active') ids[a.getString('asset') + '|' + a.getString('container')] = a.id;
  }
  const open = app.findRecordsByFilter('findings', 'status = "open" || status = "acknowledged"', '', 0, 0);
  for (const f of open) {
    let ev = {};
    try {
      ev = JSON.parse(f.getString('evidence') || '{}') || {};
    } catch (_) {
      continue;
    }
    if (!ev || ev.app_id || !ev.container) continue;
    const id = ids[f.getString('asset') + '|' + ev.container];
    if (!id) continue;
    ev.app_id = id;
    f.set('evidence', ev);
    app.save(f);
  }
}, () => {
  // Filling in a missing link is not undone.
});
