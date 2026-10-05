/**
 * Sensors service — registration, check-in, reports, liveness.
 *
 * A sensor is a record in the `sensors` AUTH collection. Its token is
 * "ns1.<local>.<password>": the sensor signs in as <local>@sensor.netsentry.invalid
 * with that password, and sends the resulting JWT on every call. Revoking
 * flips status (blocked by the collection's authRule) and rotates tokenKey
 * (invalidates issued JWTs immediately).
 */
const repo = require('../infra/repo.js');
const audit = require('./audit.js');
const collectors = require('../collectors/index.js');
const { OpError } = require('../core/util.js');

const EMAIL_DOMAIN = 'sensor.netsentry.invalid';
const OFFLINE_AFTER_MS = 10 * 60000;
const MAX_PAYLOAD = 1000000;
const MAX_OBSERVATIONS = 5000;
const MAX_SIGNALS = 2000;

function requireSensor(app, id) {
  const s = repo.byId(app, 'sensors', id);
  if (!s) throw new OpError(404, 'Sensor not found.', 'not_found');
  return s;
}

function register(app, actor, p) {
  const name = String(p.name || '').trim();
  if (!name || name.length > 80) throw new OpError(400, 'Give the server a name (1–80 characters), e.g. its hostname.');
  const taken = repo.find(app, 'sensors', 'status != "revoked"').some((s) => s.getString('name').toLowerCase() === name.toLowerCase());
  if (taken) {
    throw new OpError(409, `A server called "${name}" is already set up. Use a different name, or remove the old one in Settings → Monitor.`, 'duplicate');
  }
  const local = 's' + $security.randomStringWithAlphabet(20, 'abcdefghijklmnopqrstuvwxyz0123456789');
  const password = $security.randomString(40);
  const rec = new Record(app.findCollectionByNameOrId('sensors'));
  rec.set('email', `${local}@${EMAIL_DOMAIN}`);
  rec.setPassword(password);
  rec.set('name', name);
  rec.set('status', 'pending');
  rec.set('config', {});
  rec.set('dropped', 0);
  rec.set('registered_by', actor.label);
  app.save(rec);
  audit.append(app, actor, 'sensor.registered', { collection: 'sensors', id: rec.id }, `Added server monitor "${name}"`, null);
  return {
    ok: true,
    sensor_id: rec.id,
    token: `ns1.${local}.${password}`,
    message: 'Copy the token now — it is shown only once.',
  };
}

/**
 * "Check now" for a machine: leave a request its monitor picks up at the next
 * check-in (every 30 s); it then runs every check straight away.
 */
function requestRun(app, assetId) {
  const live = repo.find(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: assetId });
  for (const s of live) repo.update(app, s, { run_requested: repo.nowIso() });
  return { monitors: live.length, online: live.some((s) => s.getString('status') === 'online') };
}

/** Where the Sensor code sits next to this app (pb/pb_hooks → app root → sensor). */
/** This NetSentry's own folder (pb_hooks/../..): its code and its database. */
function appRoot() {
  const hooks = String(__hooks).replace(/[\\/]+$/, '');
  const sep = hooks.indexOf('\\') >= 0 ? '\\' : '/';
  return hooks.split(/[\\/]/).slice(0, -2).join(sep);
}

function installInfo() {
  const hooks = String(__hooks).replace(/[\\/]+$/, '');
  const sep = hooks.indexOf('\\') >= 0 ? '\\' : '/';
  const root = hooks.split(/[\\/]/).slice(0, -2).join(sep);
  return { ok: true, sensor_dir: root + sep + 'sensor', windows: sep === '\\', version: require('./enrol.js').sensorVersion() };
}

function revoke(app, actor, p) {
  const s = requireSensor(app, p.sensor_id);
  if (s.getString('status') === 'revoked') throw new OpError(409, 'This sensor is already revoked.');
  s.set('status', 'revoked');
  try {
    s.refreshTokenKey(); // invalidates every token already issued to it
  } catch (_) {
    /* older PocketBase: the authRule still blocks new sign-ins */
  }
  app.save(s);
  for (const src of repo.find(app, 'sources', 'sensor = {:s}', { s: s.id })) repo.update(app, src, { enabled: false });
  audit.append(app, actor, 'sensor.revoked', { collection: 'sensors', id: s.id }, `Removed server monitor "${s.getString('name')}"`, null);
  return { ok: true, sensor_id: s.id, status: 'revoked' };
}

function parseJson(raw, what) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw || {});
  if (text.length > MAX_PAYLOAD) throw new OpError(413, `${what} is larger than 1 MB — send smaller batches.`);
  try {
    const v = JSON.parse(text);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch (_) {
    throw new OpError(400, `${what} must be a JSON object.`);
  }
}

function clipStr(v, n) {
  return String(v === undefined || v === null ? '' : v).slice(0, n);
}

/** Link (or create) the host asset this sensor watches, and its sources. */
function ensureHost(app, sensor, hostname, actor) {
  const linked = sensor.getString('asset') ? repo.byId(app, 'assets', sensor.getString('asset')) : null;
  if (linked) {
    require('./assets.js').createSources(app, linked, sensor.id); // new sensor collectors after an upgrade
    return linked;
  }
  const assets = require('./assets.js');
  let identifier = clipStr(hostname || sensor.getString('name'), 200).toLowerCase() || 'host-' + sensor.id;
  const same = repo.first(app, 'assets', 'identifier = {:i} && kind = "host"', { i: identifier });
  // A monitor that enrolled ITSELF (join token, cloud role) never takes over an existing machine's
  // record by claiming its name — that record may hold keys and fixes for a different computer.
  // Only a monitor an admin registered by hand for that machine does (security review 2026-09-30).
  if (same && sensor.getString('joined_with')) {
    identifier = `${identifier} (${sensor.id.slice(0, 5)})`;
  } else if (same) {
    // Same computer, and no other active monitor owns it (e.g. its monitor was removed and
    // added again): the new monitor takes over the machine and its history — no duplicate.
    const owners = repo.find(app, 'sensors', 'asset = {:a} && status != "revoked" && id != {:s}', { a: same.id, s: sensor.id });
    if (owners.length === 0) {
      repo.update(app, same, { label: sensor.getString('name'), status: 'active' });
      for (const src of repo.find(app, 'sources', 'target = {:t} && sensor != ""', { t: same.id })) {
        repo.update(app, src, { sensor: sensor.id, enabled: true, consecutive_failures: 0 });
      }
      assets.createSources(app, same, sensor.id);
      sensor.set('asset', same.id);
      audit.append(app, actor, 'sensor.connected', { collection: 'sensors', id: sensor.id },
        `Server monitor "${sensor.getString('name')}" took over ${identifier} (it replaces a removed monitor)`, null);
      return same;
    }
    identifier = `${identifier} (${sensor.id.slice(0, 5)})`;
  } else if (repo.first(app, 'assets', 'identifier = {:i}', { i: identifier })) {
    identifier = `${identifier} (${sensor.id.slice(0, 5)})`;
  }
  const asset = repo.create(app, 'assets', {
    kind: 'host',
    identifier,
    label: sensor.getString('name'),
    ownership: 'verified', // the sensor runs on it
    status: 'active',
    added_by: 'sensor ' + sensor.getString('name'),
    first_seen: repo.nowIso(),
  });
  assets.createSources(app, asset, sensor.id);
  sensor.set('asset', asset.id);
  audit.append(app, actor, 'sensor.connected', { collection: 'sensors', id: sensor.id }, `Server monitor "${sensor.getString('name')}" connected from ${identifier}`, null);
  return asset;
}

/** Did anything but the heartbeat change on this sensor record? */
function sensorChanged(sensor) {
  try {
    const original = sensor.original();
    for (const f of ['hostname', 'platform', 'os', 'version', 'is_admin', 'environment', 'capabilities', 'status']) {
      if (JSON.stringify(sensor.get(f)) !== JSON.stringify(original.get(f))) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** The sensor says hello: record what it is and can do; answer with its config. */
function checkin(app, actor, p) {
  const info = parseJson(p.info, 'info');
  let result;
  // One transaction: a failure part-way must not leave a host asset without its sensor link.
  app.runInTransaction((tx) => {
    result = checkinTx(tx, actor, info);
  });
  return result;
}

function checkinTx(app, actor, info) {
  const sensor = requireSensor(app, actor.id);
  if (sensor.getString('status') === 'revoked') throw new OpError(403, 'This sensor has been revoked.');
  const asset = ensureHost(app, sensor, info.hostname, actor);
  sensor.set('hostname', clipStr(info.hostname, 255));
  sensor.set('platform', clipStr(info.platform, 40));
  sensor.set('os', clipStr(info.os, 200));
  sensor.set('version', clipStr(info.version, 40));
  sensor.set('is_admin', info.is_admin === true);
  sensor.set('environment', info.environment && typeof info.environment === 'object' ? info.environment : {});
  // A check-in without capabilities (first contact, before any collector ran) keeps what is known.
  if (info.capabilities && typeof info.capabilities === 'object' && Object.keys(info.capabilities).length) {
    sensor.set('capabilities', info.capabilities);
  }
  const cameBack = sensor.getString('status') !== 'online';
  // A watched machine checks in every 2 s: write last_seen at most every 15 s unless something else changed.
  const seenMs = Date.parse(repo.isoOf(sensor, 'last_seen') || 0);
  const quiet = !cameBack && Date.now() - seenMs < 15000;
  sensor.set('status', 'online');
  sensor.set('last_seen', repo.nowIso());
  if (!quiet || sensorChanged(sensor)) app.save(sensor);
  if (cameBack) recheckLiveness(app, asset.id);

  const intervals = {};
  const disabled = [];
  for (const src of repo.find(app, 'sources', 'sensor = {:s}', { s: sensor.id })) {
    const c = collectors.get(src.getString('collector'));
    if (!c || !c.remote) continue;
    if (!src.getBool('enabled')) disabled.push(c.id);
    else intervals[c.id] = c.intervalSeconds;
  }
  const cfg = repo.jsonOf(sensor, 'config') || {};
  return {
    ok: true,
    asset_id: asset.id,
    intervals,
    disabled,
    fim_paths: Array.isArray(cfg.fim_paths) ? cfg.fim_paths : [],
    // v2: what the app catalogue asks this machine to probe and read (set by services/v2.js)
    probe_targets: Array.isArray(cfg.probe_targets) ? cfg.probe_targets : [],
    // NetSentry's own approved fixes for this machine (only when fixing is switched on here)
    fix_jobs: require('./fixjobs.js').jobsFor(app, sensor),
    app_config: Array.isArray(cfg.app_config) ? cfg.app_config : [],
    // D12: read-only app keys for account lists (organisation mode; only this machine's apps)
    app_accounts: require('./accounts.js').configFor(app, asset.id),
    // v3 §8.3: fast while someone watches this machine or a change waits for it.
    checkin_seconds: require('./changes.js').checkinSeconds(app, asset.id),
    // v4 §16 (N-B24): someone has this server on screen — sample every 2 s and send the latest.
    live: require('./changes.js').watching(asset.id),
    // v4 §17: NetSentry's own folder (database, code), never shown in Files when it runs on this server.
    protect: [appRoot()],
    // v3 §9: logs a person (or the agent, when asked) wants to read — never stored by the console.
    log_requests: require('./changes.js').logRequestsFor(asset.id),
    // v4 N-B9: what a person (or the agent) asked to see — files, settings, disk, programs, firewall…
    read_requests: require('./serverreads.js').requestsFor(asset.id),
    // v4 §6: terminals an admin opened (started only if the terminal is switched on at this machine)
    terminal_sessions: require('./terminal.js').sessionsFor(app, asset.id),
    run_requested: repo.isoOf(sensor, 'run_requested') || '',
  };
}

/**
 * v4 §16 (N-B24): the monitor's latest live sample while someone watches this server. Answers
 * whether anyone still is, so the monitor stops sampling when nobody looks.
 */
function live(app, actor, p) {
  const sensor = requireSensor(app, actor.id);
  if (sensor.getString('status') === 'revoked') throw new OpError(403, 'This sensor has been revoked.');
  const assetId = sensor.getString('asset');
  if (!assetId) throw new OpError(409, 'Check in first.');
  const raw = String(p.sample || '');
  if (raw.length > 65536) throw new OpError(413, 'A live sample is at most 64 KB.');
  const ok = require('./live.js').store(app, assetId, parseJson(raw, 'sample'));
  if (!ok) throw new OpError(400, 'Not a live sample.');
  return { ok: true, live: require('./changes.js').watching(assetId) };
}

/** One collector's results from the sensor → validated → the shared pipeline. */
function report(app, actor, p) {
  const started = Date.now();
  const sensor = requireSensor(app, actor.id);
  if (sensor.getString('status') === 'revoked') throw new OpError(403, 'This sensor has been revoked.');
  const payload = parseJson(p.payload, 'payload');
  const collector = collectors.get(String(payload.collector || ''));
  if (!collector || !collector.remote) throw new OpError(400, `Unknown sensor collector "${payload.collector}".`);
  const assetId = sensor.getString('asset');
  if (!assetId) throw new OpError(409, 'Check in before reporting.');
  const src = repo.first(app, 'sources', 'sensor = {:s} && collector = {:c}', { s: sensor.id, c: collector.id });
  if (!src) throw new OpError(409, `No source for ${collector.id} on this sensor.`);
  const assetRec = repo.byId(app, 'assets', assetId);

  repo.update(app, sensor, {
    last_seen: repo.nowIso(),
    status: 'online',
    dropped: sensor.getInt('dropped') + Math.max(0, Number(payload.dropped) || 0),
  });
  if (!src.getBool('enabled')) return { ok: true, status: 'skipped', note: 'source disabled in NetSentry' };
  if (!assetRec || assetRec.getString('status') !== 'active') return { ok: true, status: 'skipped', note: 'host asset retired' };

  const pipeline = require('./pipeline.js');
  if (payload.unavailable) {
    // Not a failure: this host cannot provide it (platform, tool missing, needs admin).
    repo.update(app, src, {
      health: 'unknown',
      last_run: repo.nowIso(),
      last_error: 'Not available on this host: ' + clipStr(payload.unavailable, 900),
      consecutive_failures: 0,
    });
    return { ok: true, status: 'unavailable', note: clipStr(payload.unavailable, 300) };
  }
  if (payload.error) {
    return Object.assign({ ok: true }, pipeline.recordFailure(app, src, collector, assetRec.getString('identifier'), 'sensor', started, clipStr(payload.error, 900)));
  }

  const kinds = collector.kinds({ id: assetId, kind: 'host' });
  const result = { note: clipStr(payload.note, 500), partial: payload.complete === false };
  if (kinds.length) {
    const obs = Array.isArray(payload.observations) ? payload.observations : [];
    if (obs.length > MAX_OBSERVATIONS) throw new OpError(413, `At most ${MAX_OBSERVATIONS} observations per report.`);
    result.observations = obs.map((o, i) => {
      if (!o || kinds.indexOf(o.kind) < 0) throw new OpError(400, `observations[${i}].kind must be one of ${kinds.join(', ')}.`);
      const subject = clipStr(o.subject, 255);
      if (!subject) throw new OpError(400, `observations[${i}].subject is required.`);
      const data = o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : {};
      return { kind: o.kind, subject, data };
    });
  }
  if (collector.signalKinds.length) {
    const sig = Array.isArray(payload.signals) ? payload.signals : [];
    if (sig.length > MAX_SIGNALS) throw new OpError(413, `At most ${MAX_SIGNALS} signals per report.`);
    result.signals = sig.map((s, i) => {
      if (!s || collector.signalKinds.indexOf(s.kind) < 0) throw new OpError(400, `signals[${i}].kind must be one of ${collector.signalKinds.join(', ')}.`);
      const t = Date.parse(String(s.window_start || ''));
      if (isNaN(t) || t > Date.now() + 300000) throw new OpError(400, `signals[${i}].window_start must be a past ISO timestamp.`);
      const count = Math.floor(Number(s.count));
      if (!(count >= 0 && count < 1e7)) throw new OpError(400, `signals[${i}].count must be a non-negative number.`);
      return { kind: s.kind, key: clipStr(s.key, 255), window_start: new Date(t).toISOString(), count, data: s.data && typeof s.data === 'object' ? s.data : {} };
    });
  }

  if (!pipeline.lock(app, src.id)) return { ok: true, status: 'skipped', note: 'previous report still being applied' };
  try {
    return Object.assign({ ok: true }, pipeline.applyResult(app, src, collector, assetRec, result, 'sensor', started));
  } finally {
    pipeline.unlock(app, src.id);
  }
}

/** Mark sensors that stopped checking in as offline (the liveness source turns that into RES-002). */
function markOffline(app) {
  const cutoff = repo.pbDate(new Date(Date.now() - OFFLINE_AFTER_MS).toISOString());
  for (const s of repo.find(app, 'sensors', 'status = "online" && last_seen < {:c}', { c: cutoff })) {
    repo.update(app, s, { status: 'offline' });
    recheckLiveness(app, s.getString('asset'));
  }
}

/** A monitor went quiet or came back: re-run the host's liveness check on the next tick, not in up to 5 minutes. */
function recheckLiveness(app, assetId) {
  if (!assetId) return;
  const src = repo.first(app, 'sources', 'target = {:a} && collector = "sensor.liveness"', { a: assetId });
  if (src) repo.update(app, src, { next_run: repo.nowIso() });
}

/** Read-only lookups for collectors (sensor.liveness). */
function lookup(app) {
  return {
    forAsset(assetId) {
      // A re-added machine keeps its old, revoked monitor record: the live one counts.
      const s =
        repo.first(app, 'sensors', 'asset = {:a} && status != "revoked"', { a: assetId }, '-last_seen') ||
        repo.first(app, 'sensors', 'asset = {:a}', { a: assetId }, '-last_seen');
      if (!s) return null;
      const last = repo.isoOf(s, 'last_seen');
      return {
        online: s.getString('status') !== 'revoked' && !!last && Date.now() - Date.parse(last) < OFFLINE_AFTER_MS,
        revoked: s.getString('status') === 'revoked',
        last_seen: last,
      };
    },
  };
}

module.exports = { register, installInfo, requestRun, revoke, checkin, live, report, markOffline, lookup };
