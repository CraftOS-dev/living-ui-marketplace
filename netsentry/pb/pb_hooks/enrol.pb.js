/// <reference path="../pb_data/types.d.ts" />
/**
 * Rolling monitors out (plan §4.2 S5): public routes a new machine uses.
 *   POST /api/netsentry/join               join token + name → that machine's own monitor token
 *   POST /api/netsentry/join-aws           keyless: an EC2 instance's signed sts:GetCallerIdentity → its token
 *   GET  /api/netsentry/sensor/files       the monitor's code (text files, no secrets in it)
 *   GET  /api/netsentry/sensor/install.sh  the Linux install script (systemd)
 * (Handlers run in isolated contexts: each one requires the service itself.)
 */
routerAdd('POST', '/api/netsentry/join', (e) => {
  const body = e.requestInfo().body || {};
  try {
    const out = require(`${__hooks}/lib/services/enrol.js`).join($app, body.join, body.name);
    return e.json(200, out);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (status === 500) console.error('[netsentry] join failed:', err);
    return e.json(status, { message: status === 500 ? 'Enrolment failed.' : String(err.message || err) });
  }
});

// NetSentry's own console says what it is, so its monitors recognise it like any other app.
routerAdd('GET', '/api/netsentry/whoami', (e) => e.json(200, { app: 'netsentry', role: 'console' }));

routerAdd('GET', '/api/netsentry/sensor/files', (e) => {
  // The code changes only with an update: keep it a minute instead of reading the disk on every request.
  const cached = $app.store().get('netsentry.sensor_files');
  if (cached && cached.at > Date.now() - 60000) return e.json(200, { files: cached.files });
  const files = require(`${__hooks}/lib/services/enrol.js`).sensorFiles();
  $app.store().set('netsentry.sensor_files', { at: Date.now(), files });
  return e.json(200, { files });
});

routerAdd('GET', '/api/netsentry/sensor/install.sh', (e) => {
  // Always the configured address — never the one this request came in on (a proxy or an attacker shapes that).
  const enrol = require(`${__hooks}/lib/services/enrol.js`);
  const url = enrol.consoleUrl($app);
  if (!url) return e.string(409, "echo \"NetSentry's address is not saved yet: in NetSentry open Home -> Reconnect the monitor (or Settings -> Monitor), then run the command it shows.\"; exit 1\n");
  return e.string(200, enrol.installScript(url));
});

routerAdd('GET', '/api/netsentry/sensor/install.ps1', (e) => {
  // Always the configured address — never the one this request came in on.
  const enrol = require(`${__hooks}/lib/services/enrol.js`);
  const url = enrol.consoleUrl($app);
  if (!url) return e.string(409, "Write-Host \"NetSentry's address is not saved yet: in NetSentry open Home -> Reconnect the monitor (or Settings -> Monitor), then run the command it shows.\"; return\n");
  return e.string(200, enrol.installPs1(url));
});
