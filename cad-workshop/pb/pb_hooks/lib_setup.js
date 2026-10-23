/// <reference path="../pb_data/types.d.ts" />
/**
 * First-run setup of the geometry engine (lib_engine.js says what each part
 * does). Unpacked, the engine is about 250 MB (the OpenCascade kernel alone
 * is one 105 MB file), too big to ship inside the app, so this lane downloads
 * it once (about 79 MB) into <project>/engine/ from each project's official
 * release, pinned to the exact build the app was made and measured with:
 *
 *   python.org     CPython 3.11.9 Windows embeddable package (amd64)
 *   PyPI wheels    cadquery-ocp-novtk 8.0.1.1.0 (OCCT 8.0.1) with
 *                  cadquery-ocp-proxy 8.0.1.1.0, numpy 2.4.6, pillow 12.3.0
 *
 * Every download is checked against its size and SHA-256 before anything in
 * it is unpacked: a mismatch stops the setup with an error, and nothing
 * unchecked is ever run. Only tools every Windows 10/11 ships are used
 * (curl.exe, tar.exe, certutil.exe). Each download is unpacked straight into
 * engine/ (moving freshly unpacked folders fails while a virus scanner reads
 * them) under an "unpacking" mark, so a stopped unpack counts as not
 * installed and runs again. The result is the same tree
 * engine/licenses/NOTICE.md describes (pip's own bookkeeping files aside).
 *
 * Runs on its own cron lane (hooks.pb.js): on a fresh install it starts by
 * itself within a minute, a failed attempt waits for jobs.run engine_install
 * (the Retry button), and a partial download resumes where it stopped.
 * Shadow instances (CraftBot's verification boots of this same tree) never
 * start it on their own. While it runs, queued builds stay queued (waiting())
 * instead of failing, and the build worker is woken once the engine is in.
 */

const LOCK = 'cad.setup.worker';
const STATE = 'cad.setup';
const WAKE = 'cad.setup.wake';
const REQUEST = 'cad.setup.request';
const PROC = 'cad.setup.pid';

/** python311._pth as NOTICE.md describes it: the stdlib, site-packages and engine/ (for cad_engine). */
const PTH = 'python311.zip\r\n.\r\n..\\site-packages\r\n..\r\n';

/**
 * into: the engine folder the archive unpacks into. top: what the archive
 * holds at its top level (each moved into place whole). key: [file, size]
 * that is there exactly when the source is installed.
 */
const SOURCES = [
  {
    id: 'python',
    label: 'Python 3.11.9 (embedded)',
    url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',
    size: 11249023,
    sha256: '009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b',
    into: 'python',
    top: null,
    key: ['python/cad-engine.exe', 103192],
  },
  {
    id: 'numpy',
    label: 'NumPy 2.4.6',
    url: 'https://files.pythonhosted.org/packages/c5/31/7fc6239c12bce7e931463251cca4426c465e1876ba3cc785402ef4dd8f4e/numpy-2.4.6-cp311-cp311-win_amd64.whl',
    size: 12608406,
    sha256: '1e254a00cdf42b1e4d5b3d68d33af63268d41340d8885df2ab6470f2e1500147',
    into: 'site-packages',
    top: ['numpy', 'numpy.libs', 'numpy-2.4.6.dist-info'],
    key: ['site-packages/numpy/_core/_multiarray_umath.cp311-win_amd64.pyd', 3703296],
  },
  {
    id: 'pillow',
    label: 'Pillow 12.3.0',
    url: 'https://files.pythonhosted.org/packages/63/c6/4bad1b18d132a50b27e1365e1ab163616f7a5bb56d330f66f9d1d9d4f9d4/pillow-12.3.0-cp311-cp311-win_amd64.whl',
    size: 7233653,
    sha256: '8e95e1385e4998ae9694eeaa4730ba5457ff61185b3a55e2e7bea0880aef452a',
    into: 'site-packages',
    top: ['PIL', 'pillow-12.3.0.dist-info'],
    key: ['site-packages/PIL/_imaging.cp311-win_amd64.pyd', 2632704],
  },
  {
    id: 'ocp_proxy',
    label: 'the OCP loader (cadquery-ocp-proxy)',
    url: 'https://files.pythonhosted.org/packages/13/5e/29c3d8c4b290dee82387468a33ac06c663518a167963cdb9ff48e6bbd8f9/cadquery_ocp_proxy-8.0.1.1.0-py3-none-any.whl',
    size: 3250,
    sha256: '98c71bb60cfb651afe179b134ab88580fd75384fce0cc6d633f727002cd18abd',
    into: 'site-packages',
    top: ['cadquery_ocp_proxy', 'cadquery_ocp_proxy-8.0.1.1.0.dist-info'],
    key: ['site-packages/cadquery_ocp_proxy/__init__.py', 179],
  },
  {
    id: 'ocp',
    label: 'the OpenCascade kernel (OCP 8.0.1)',
    url: 'https://files.pythonhosted.org/packages/4c/e4/d83068851eebe80128ec819f8dcac7e75b7eef38c3dba721b72ca2c51171/cadquery_ocp_novtk-8.0.1.1.0-cp311-cp311-win_amd64.whl',
    size: 47528110,
    sha256: 'e2010a034a90eea87f4c22b5c4dd018afb1a76eb711045399266f0ad9d23f9a9',
    into: 'site-packages',
    top: ['OCP', 'cadquery_ocp_novtk.libs', 'cadquery_ocp_novtk-8.0.1.1.0.dist-info'],
    key: ['site-packages/OCP/OCP.cp311-win_amd64.pyd', 105538560],
  },
];

/** Idle until 2 s before the next cron tick, then hand over. */
function beforeHandover() {
  return new Date().getSeconds() < 58;
}

/** Absolute, like lib_engine's paths (the tools run with their own working folders). */
function engineDir() {
  const p = $filepath.join(__hooks, '..', '..', 'engine');
  return $filepath.isAbs(p) ? p : $filepath.join($os.getwd(), p);
}

function downloadDir() {
  return $filepath.join(engineDir(), '.download');
}

function systemTool(name) {
  return $filepath.join($os.getenv('SystemRoot') || 'C:\\Windows', 'System32', name);
}

function sizeOf(path) {
  try {
    return $os.stat(path).size();
  } catch {
    return -1;
  }
}

function exists(path) {
  return sizeOf(path) >= 0;
}

function readText(path) {
  try {
    return toString($os.readFile(path));
  } catch {
    return '';
  }
}

/**
 * SHA-256 of a file (certutil), lowercase hex; '' when it cannot be read.
 * Retried briefly: a virus scanner can hold a just-written file for a moment.
 */
function sha256(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) sleep(1000);
    try {
      const out = toString($os.cmd(systemTool('certutil.exe'), '-hashfile', path, 'SHA256').output());
      // Older Windows builds print the hash with a space between bytes.
      const m = /^\s*([0-9a-fA-F]{2}(?: ?[0-9a-fA-F]{2}){31})\s*$/m.exec(out);
      if (m !== null) return m[1].replace(/ /g, '').toLowerCase();
    } catch {
      /* not readable right now */
    }
  }
  return '';
}

/** Throws unless the download at path is exactly the expected one. */
function check(path, src) {
  const what = 'The download of ' + src.label;
  const actual = sizeOf(path);
  if (actual !== src.size) {
    throw new Error(what + ' is not the expected file (' + actual + ' bytes instead of ' + src.size + '), so it was not used. Retry to download it again.');
  }
  const hash = sha256(path);
  if (hash === '') throw new Error(what + ' could not be read to check it (' + path + ').');
  if (hash !== src.sha256) throw new Error(what + ' did not match the expected file (checksum), so it was not used. Retry to download it again.');
}

/** Present while a source is being unpacked (and after an unpack that stopped). */
function unpackMark(src) {
  return $filepath.join(engineDir(), '.unpacking-' + src.id);
}

/** A source is in place when its key file has its exact size, every top-level folder is there and no unpack is unfinished. */
function inPlace(src) {
  const dir = engineDir();
  if (sizeOf($filepath.join(dir, src.key[0])) !== src.key[1]) return false;
  if (exists(unpackMark(src))) return false;
  if (src.id === 'python') return readText($filepath.join(dir, 'python', 'python311._pth')) === PTH;
  return src.top.every((t) => exists($filepath.join(dir, src.into, t)));
}

/** Sources still to install (empty = the whole engine is in place). */
function pending() {
  return SOURCES.filter((src) => !inPlace(src));
}

/** Ids of the sources not (fully) in place, for lib_engine's missing list. */
function unfinished() {
  return pending().map((src) => src.id);
}

/** Only the app's own instance downloads by itself, never a shadow boot. */
function autoStart() {
  return $os.getenv('CRAFTBOT_APP_ENV') !== 'shadow';
}

function failed(app) {
  const st = app.store().get(STATE);
  return st !== null && st !== undefined && st.phase === 'failed';
}

function running(app) {
  const st = app.store().get(STATE);
  return st !== null && st !== undefined && (st.phase === 'downloading' || st.phase === 'installing');
}

/** Whether setup should run now (and, from the build lane: is about to). */
function wanted(app) {
  if (pending().length === 0) return false;
  if (app.store().has(REQUEST)) return true;
  return autoStart() && !failed(app);
}

/** True while the engine is missing but on its way, so queued builds stay queued. */
function waiting(app) {
  if (require(`${__hooks}/lib_engine.js`).missing(app).length === 0) return false;
  return running(app) || wanted(app);
}

function setState(app, patch) {
  const store = app.store();
  const prev = store.get(STATE) || {};
  const next = {};
  for (const k of Object.keys(prev)) next[k] = prev[k];
  for (const k of Object.keys(patch)) next[k] = patch[k];
  store.set(STATE, next);
}

function tail(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .slice(-2)
    .join(' ');
}

/**
 * Run a tool to the end (stderr to a log, stdout to outPath when given);
 * throws with the log's last lines when it fails.
 */
function runTool(app, bin, args, logName, what, outPath) {
  const logPath = $filepath.join(downloadDir(), logName);
  const root = $os.openRoot(downloadDir());
  const log = root.create(logName);
  let outRoot = null;
  let out = null;
  const cmd = $os.cmd(bin, ...args);
  cmd.stderr = log;
  let ok = false;
  try {
    if (outPath) {
      outRoot = $os.openRoot($filepath.dir(outPath));
      out = outRoot.create($filepath.base(outPath));
      cmd.stdout = out;
    }
    cmd.start();
    app.store().set(PROC, cmd.process.pid);
    try {
      cmd.wait();
      ok = true;
    } catch {
      ok = false;
    }
  } finally {
    app.store().remove(PROC);
    log.close();
    root.close();
    if (out !== null) out.close();
    if (outRoot !== null) outRoot.close();
  }
  if (!ok) throw new Error(what + ' failed: ' + (tail(readText(logPath)) || 'the tool stopped with an error') + '.');
}

/** Download one source (resuming a partial download) and check it. */
function download(app, src, archive, doneBytes) {
  if (sizeOf(archive) === src.size && sha256(archive) === src.sha256) return;
  if (exists(archive)) $os.remove(archive);
  const part = archive + '.part';
  if (sizeOf(part) > src.size) $os.remove(part);
  setState(app, { phase: 'downloading', step: src.label, done_bytes: doneBytes, partial: part });
  if (sizeOf(part) !== src.size) {
    runTool(
      app,
      systemTool('curl.exe'),
      // -C - resumes a partial file; --speed-* aborts a stalled connection
      // instead of waiting forever.
      ['-L', '--fail', '--silent', '--show-error', '--retry', '3', '--retry-delay', '3', '--connect-timeout', '30', '--speed-limit', '1024', '--speed-time', '60', '-C', '-', '-o', part, src.url],
      src.id + '.log',
      'Downloading ' + src.label,
    );
  }
  $os.rename(part, archive);
  try {
    check(archive, src);
  } catch (err) {
    $os.remove(archive);
    throw err;
  }
}

/** Unpack one try (tar replaces files a stopped unpack left behind). */
function unpack(app, src, archive, target) {
  const tar = systemTool('tar.exe');
  const what = 'Unpacking ' + src.label;
  if (src.id !== 'python') {
    runTool(app, tar, ['-xf', archive, '-C', target], src.id + '-unpack.log', what);
    return;
  }
  // The engine process is the package's python.exe under its own name, so
  // it can be told apart from (and never kills) another Python; it is
  // written under that name directly (Windows' tar cannot rename, and
  // renaming a just-written file can fail while it is being scanned).
  // pythonw.exe is not used, and python311._pth is the app's own.
  runTool(app, tar, ['-xf', archive, '-C', target, '--exclude', 'python.exe', '--exclude', 'pythonw.exe', '--exclude', 'python311._pth'], src.id + '-unpack.log', what);
  runTool(app, tar, ['-xOf', archive, 'python.exe'], src.id + '-exe.log', what, $filepath.join(target, 'cad-engine.exe'));
  $os.writeFile($filepath.join(target, 'python311._pth'), PTH, 0o644);
}

/**
 * Unpack a checked download straight into engine/, under its unpacking
 * mark. Tried three times: a virus scanner can hold a just-written file for
 * a moment, which makes replacing it fail.
 */
function place(app, src, archive) {
  setState(app, { phase: 'installing', step: src.label, partial: '' });
  const target = $filepath.join(engineDir(), src.into);
  $os.mkdirAll(target, 0o755);
  $os.writeFile(unpackMark(src), src.sha256, 0o644);
  for (let attempt = 1; ; attempt++) {
    try {
      unpack(app, src, archive, target);
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      sleep(3000);
    }
  }
  for (const t of src.top || []) {
    if (!exists($filepath.join(target, t))) throw new Error('Unpacking ' + src.label + ' failed: ' + t + ' is not in the download.');
  }
  const patiently = require(`${__hooks}/lib_engine.js`).patiently;
  patiently(() => $os.remove(unpackMark(src)));
  try {
    patiently(() => $os.remove(archive));
  } catch {
    /* removed with the download folder at the end */
  }
}

function install(app) {
  const store = app.store();
  store.remove(REQUEST);
  const todo = pending();
  if (todo.length === 0) return;
  const total = todo.reduce((n, src) => n + src.size, 0);
  let done = 0;
  store.set(STATE, { phase: 'downloading', step: todo[0].label, done_bytes: 0, total_bytes: total, partial: '', error: '' });
  try {
    $os.mkdirAll(downloadDir(), 0o755);
    for (const src of todo) {
      const archive = $filepath.join(downloadDir(), src.id + '.download');
      download(app, src, archive, done);
      place(app, src, archive);
      done += src.size;
      setState(app, { done_bytes: done });
    }
    try {
      $os.removeAll(downloadDir());
    } catch (err) {
      console.error('[cad-workshop] removing engine/.download failed (harmless):', err);
    }
    store.remove(STATE);
    console.log('[cad-workshop] geometry engine installed');
  } catch (err) {
    console.error('[cad-workshop] geometry engine setup failed:', err);
    let message = String((err && err.message) || err);
    if (/^Downloading/.test(message)) message = message.replace(/[.\s]*$/, '.') + ' Check the internet connection, then retry.';
    store.set(STATE, { phase: 'failed', step: '', done_bytes: done, total_bytes: total, partial: '', error: message });
  }
  // Builds queued while the engine was on its way run now (or fail with the reason).
  store.set('cad.wake', true);
}

/** Cron entry point; one setup at a time per process. Returns at once when the engine is in place. */
function run(app) {
  if (pending().length === 0) return;
  const store = app.store();
  const me = $security.randomString(16);
  if (store.getOrSet(LOCK, () => me) !== me) return;
  try {
    for (;;) {
      store.remove(WAKE);
      if (wanted(app)) {
        install(app);
        continue;
      }
      if (pending().length === 0) break;
      while (beforeHandover() && !store.has(WAKE)) sleep(500);
      if (!store.has(WAKE)) break;
    }
  } finally {
    store.remove(LOCK);
  }
}

/** jobs.run engine_install: start the setup (or retry a failed one) right away. */
function request(app) {
  const store = app.store();
  if (pending().length > 0 && !running(app)) {
    if (failed(app)) store.remove(STATE);
    store.set(REQUEST, true);
    store.set(WAKE, true);
  }
  return status(app);
}

/**
 * The setup as engine status reports it. state: ready | pending (starts by
 * itself within a minute) | off (waits for jobs.run engine_install) |
 * downloading | installing | failed.
 */
function status(app) {
  const todo = pending();
  if (todo.length === 0) return { state: 'ready', step: '', done_bytes: 0, total_bytes: 0, error: '' };
  const st = app.store().get(STATE);
  if (st !== null && st !== undefined) {
    let done = st.done_bytes;
    if (st.phase === 'downloading' && st.partial) done += Math.max(0, sizeOf(st.partial));
    return { state: st.phase, step: st.step, done_bytes: Math.min(done, st.total_bytes), total_bytes: st.total_bytes, error: st.error || '' };
  }
  const total = todo.reduce((n, src) => n + src.size, 0);
  return { state: wanted(app) ? 'pending' : 'off', step: '', done_bytes: 0, total_bytes: total, error: '' };
}

/** Why the engine cannot run yet, as a sentence for the person (lib_engine's error). */
function unavailable(app, missing) {
  const s = status(app);
  const mb = (n) => Math.round(n / 1000000);
  if (s.state === 'downloading' || s.state === 'installing') {
    return 'The geometry engine is still being set up (' + mb(s.done_bytes) + ' of ' + mb(s.total_bytes) + ' MB). Try again when it is ready.';
  }
  if (s.state === 'pending') return 'The geometry engine is being set up for the first time (a one-off download of about ' + mb(s.total_bytes) + ' MB). Try again in a few minutes.';
  if (s.state === 'failed') return 'The geometry engine could not be set up: ' + s.error + ' Retry it on the Home page or in Settings.';
  return 'The geometry engine is not installed (missing ' + missing.join(', ') + ' in the app folder). Install it on the Home page or in Settings.';
}

/** Shutdown: do not leave a download running without its lane. */
function killRunning(app) {
  const pid = app.store().get(PROC);
  if (!pid) return;
  try {
    $os.cmd('taskkill', '/PID', String(pid), '/T', '/F').run();
  } catch {
    /* already gone */
  }
}

module.exports = { run: run, request: request, status: status, waiting: waiting, unavailable: unavailable, unfinished: unfinished, killRunning: killRunning };
