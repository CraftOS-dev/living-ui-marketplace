/// <reference path="../pb_data/types.d.ts" />
/**
 * The geometry engine: an embedded Python with the OpenCascade (OCCT 8)
 * kernel, in <project>/engine/ and run as ONE long-lived process per
 * data folder, so the kernel loads once and built features stay cached in
 * memory between edits.
 *
 *   engine/python/cad-engine.exe   embedded CPython 3.11 (renamed so the
 *                                  process is recognisable and killable by name)
 *   engine/site-packages/          cadquery-ocp-novtk 8.0.1 (OCCT 8.0.1), numpy, Pillow
 *   engine/cad_engine/             the app's engine code
 *
 * python/ and site-packages/ are downloaded on first run (lib_setup.js);
 * cad_engine/ ships with the app.
 *
 * Jobs are JSON files: written to <data>/cad-engine/inbox as .tmp then
 * renamed; the engine writes <data>/cad-engine/outbox/<id>.json the same way.
 * One job at a time (an in-memory lock), so the engine never sees two.
 * The engine exits by itself when this PocketBase is gone, when asked to
 * stop, or after 20 idle minutes; the next job starts it again.
 */

const LOCK = 'cad.engine.lock';
const PID = 'cad.engine.pid';
const IMAGE = 'cad-engine.exe';

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function projectDir() {
  return $filepath.join(__hooks, '..', '..');
}

/** An absolute path (the engine runs in its own folder, so relative paths would point elsewhere). */
function abs(p) {
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

function paths(app) {
  const engine = abs($filepath.join(projectDir(), 'engine'));
  const ipc = abs($filepath.join(app.dataDir(), 'cad-engine'));
  return {
    engine: engine,
    exe: $filepath.join(engine, 'python', IMAGE),
    pkg: $filepath.join(engine, 'cad_engine', 'server.py'),
    occt: $filepath.join(engine, 'site-packages', 'OCP', '__init__.py'),
    ipc: ipc,
    inbox: $filepath.join(ipc, 'inbox'),
    outbox: $filepath.join(ipc, 'outbox'),
    out: $filepath.join(ipc, 'out'),
    ready: $filepath.join(ipc, 'ready'),
    heartbeat: $filepath.join(ipc, 'heartbeat'),
    stop: $filepath.join(ipc, 'stop'),
    log: $filepath.join(ipc, 'engine.log'),
    pidFile: $filepath.join(ipc, 'engine-process.json'),
  };
}

/** Which engine files are missing (empty = installed). */
function missing(app) {
  const p = paths(app);
  const out = [];
  if (!u().exists(p.exe)) out.push('engine/python/' + IMAGE);
  if (!u().exists(p.pkg)) out.push('engine/cad_engine');
  if (!u().exists(p.occt)) out.push('engine/site-packages/OCP');
  // A first-run setup that stopped part way (lib_setup.js) is not installed either.
  if (out.length === 0) for (const id of require(`${__hooks}/lib_setup.js`).unfinished()) out.push('engine setup: ' + id);
  return out;
}

function engineError(code, message) {
  return u().fail(503, message, { code: code });
}

/** True when the process with this pid is running and is the engine. */
function processAlive(pid) {
  if (!pid) return false;
  try {
    const out = toString($os.cmd('tasklist', '/FI', 'PID eq ' + Number(pid), '/NH', '/FO', 'CSV').output());
    // CSV rows: "image","pid","session","#","memory" (tasklist's fixed format).
    for (const line of out.split(/\r?\n/)) {
      const f = line.split('","');
      if (f.length >= 2 && f[1].replace(/"/g, '') === String(pid) && f[0].replace(/"/g, '').toLowerCase() === IMAGE) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function readPid(app) {
  const raw = u().readText(paths(app).pidFile);
  if (raw === '') return 0;
  try {
    return Number(JSON.parse(raw).pid) || 0;
  } catch {
    return 0;
  }
}

/** Kill the engine recorded for this data folder (by pid AND image name). */
function kill(app) {
  const pid = readPid(app);
  if (pid) {
    try {
      $os.cmd('taskkill', '/F', '/T', '/FI', 'PID eq ' + pid, '/FI', 'IMAGENAME eq ' + IMAGE).run();
    } catch {
      /* already gone */
    }
  }
  try {
    $os.remove(paths(app).pidFile);
  } catch {
    /* none */
  }
  app.store().remove(PID);
}

function heartbeatAge(app) {
  const raw = u().readText(paths(app).heartbeat);
  const t = Number(raw);
  if (!isFinite(t) || t <= 0) return Infinity;
  return Date.now() / 1000 - t;
}

/** Start the engine unless it is already up. Waits until the kernel is loaded. */
function ensure(app) {
  const p = paths(app);
  const miss = missing(app);
  if (miss.length) throw engineError('engine_unavailable', require(`${__hooks}/lib_setup.js`).unavailable(app, miss));
  const known = app.store().get(PID);
  if (known && heartbeatAge(app) < 4 && u().exists(p.ready)) return known;
  if (known && processAlive(known) && u().exists(p.ready)) return known;
  kill(app);
  for (const dir of [p.inbox, p.outbox, p.out]) {
    $os.removeAll(dir);
    $os.mkdirAll(dir, 0o755);
  }
  for (const f of [p.ready, p.stop, p.heartbeat]) {
    try {
      $os.remove(f);
    } catch {
      /* not there */
    }
  }
  // Keep the previous engine's log (it explains a crash or a hang).
  try {
    $os.rename(p.log, $filepath.join(p.ipc, 'engine.previous.log'));
  } catch {
    /* no log yet */
  }
  const root = $os.openRoot(p.ipc);
  const log = root.create('engine.log');
  // The engine watches its parent (this PocketBase) and exits when it is gone.
  const cmd = $os.cmd(p.exe, '-I', '-m', 'cad_engine.server', '--ipc', p.ipc);
  cmd.dir = p.engine;
  cmd.stderr = log;
  try {
    cmd.start();
  } finally {
    log.close();
    root.close();
  }
  const pid = cmd.process.pid;
  $os.writeFile(p.pidFile, JSON.stringify({ pid: pid, image: IMAGE }), 0o644);
  app.store().set(PID, pid);
  const started = Date.now();
  let nextCheck = started + 2000;
  while (!u().exists(p.ready)) {
    const now = Date.now();
    if (now - started > 60000) {
      kill(app);
      throw engineError('engine_unavailable', 'The geometry engine did not start within 60 s. ' + tail(u().readText(p.log)));
    }
    if (now > nextCheck) {
      nextCheck = now + 1000;
      if (!processAlive(pid)) {
        app.store().remove(PID);
        throw engineError('engine_unavailable', 'The geometry engine stopped while starting. ' + tail(u().readText(p.log)));
      }
    }
    sleep(25);
  }
  return pid;
}

function tail(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lines.slice(-4).join(' | ');
}

/**
 * Run a file operation, trying again for a few seconds when it fails:
 * Windows briefly refuses access to a file that was just written or renamed
 * (a virus scan holds it open).
 */
function patiently(fn, ms) {
  const deadline = Date.now() + (ms || 10000);
  for (;;) {
    try {
      return fn();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      sleep(20);
    }
  }
}

function acquire(app, deadline) {
  const me = $security.randomString(12);
  for (;;) {
    const got = app.store().getOrSet(LOCK, () => me);
    if (got === me) return me;
    if (Date.now() > deadline) throw engineError('busy', 'The geometry engine is busy with a long job; try again in a moment.');
    sleep(8);
  }
}

function release(app, me) {
  if (app.store().get(LOCK) === me) app.store().remove(LOCK);
}

/** True while another job holds the engine. */
function busy(app) {
  return app.store().has(LOCK);
}

/**
 * Run one job and return the engine's answer { ok, result | error, ms }.
 * The job's output folder (job.out_dir) is created here; the caller removes it.
 */
function call(app, job, timeoutMs) {
  const p = paths(app);
  const budget = timeoutMs || 120000;
  const me = acquire(app, Date.now() + budget);
  try {
    const pid = ensure(app);
    const id = job.id || $security.randomString(15);
    job.id = id;
    if (!job.out_dir) job.out_dir = $filepath.join(p.out, id);
    $os.mkdirAll(job.out_dir, 0o755);
    const tmp = $filepath.join(p.inbox, id + '.json.tmp');
    $os.writeFile(tmp, JSON.stringify(job), 0o644);
    patiently(() => $os.rename(tmp, $filepath.join(p.inbox, id + '.json')));
    const result = $filepath.join(p.outbox, id + '.json');
    const started = Date.now();
    let nextCheck = started + 3000;
    for (;;) {
      if (u().exists(result)) break;
      const now = Date.now();
      if (now - started > budget) {
        kill(app);
        throw engineError('timeout', 'The geometry engine took longer than ' + Math.round(budget / 1000) + ' s on this ' + job.kind + ' and was restarted. Simplify the model (fewer or smaller features) and try again.');
      }
      if (now > nextCheck) {
        nextCheck = now + 2000;
        if (!processAlive(pid)) {
          app.store().remove(PID);
          throw engineError('engine_crashed', 'The geometry engine stopped while working on this ' + job.kind + '. The last feature is probably the cause; change its dimensions. ' + tail(u().readText(p.log)));
        }
      }
      sleep(now - started < 200 ? 3 : 12);
    }
    const raw = patiently(() => {
      const text = toString($os.readFile(result));
      JSON.parse(text);
      return text;
    });
    try {
      patiently(() => $os.remove(result));
    } catch {
      /* left for the next engine start to clear */
    }
    return JSON.parse(raw);
  } finally {
    release(app, me);
  }
}

/** Ask the engine to exit (app shutdown). */
function stop(app) {
  const p = paths(app);
  try {
    $os.writeFile(p.stop, '1', 0o644);
  } catch {
    /* the folder is gone */
  }
  kill(app);
}

/** Engine facts for app.status and Settings. */
function status(app) {
  const p = paths(app);
  const miss = missing(app);
  const pid = app.store().get(PID) || 0;
  let ready = null;
  try {
    ready = JSON.parse(u().readText(p.ready) || 'null');
  } catch {
    ready = null;
  }
  return {
    installed: miss.length === 0,
    missing: miss,
    running: pid !== 0 && heartbeatAge(app) < 4,
    busy: busy(app),
    pid: pid || null,
    load_ms: ready ? ready.load_ms : null,
    folder: p.engine,
    log: p.log,
    setup: require(`${__hooks}/lib_setup.js`).status(app),
  };
}

module.exports = { paths: paths, missing: missing, ensure: ensure, call: call, kill: kill, stop: stop, status: status, busy: busy, processAlive: processAlive, tail: tail, patiently: patiently };
