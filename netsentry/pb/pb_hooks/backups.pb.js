/// <reference path="../pb_data/types.d.ts" />
/**
 * Backup heartbeat (plan §16.3): the one public route. The backup job opens
 * its private link when it finishes; ?status=fail&note=… reports a failure.
 * Always answers the same way, so the route reveals nothing about tokens.
 * (Handlers run in isolated contexts: each one requires the service itself.)
 */
routerAdd('GET', '/api/netsentry/hb/{token}', (e) => {
  const q = e.request.url.query();
  require(`${__hooks}/lib/services/backups.js`).heartbeat($app, e.request.pathValue('token'), q.get('status'), q.get('note'));
  return e.json(200, { ok: true });
});

routerAdd('POST', '/api/netsentry/hb/{token}', (e) => {
  const q = e.request.url.query();
  require(`${__hooks}/lib/services/backups.js`).heartbeat($app, e.request.pathValue('token'), q.get('status'), q.get('note'));
  return e.json(200, { ok: true });
});
