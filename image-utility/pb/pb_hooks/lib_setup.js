/// <reference path="../pb_data/types.d.ts" />
/**
 * Setting up the image engine (lib_engine.js says what each part does). It
 * is too big to ship inside the app, so it is downloaded once into
 * <project>/engine/ from each project's official release, pinned to the
 * exact build the app was made and measured with. Three groups:
 *
 *   core         CPython 3.11.9 embeddable (python.org) and the PyPI wheels
 *                pillow 13.0.0, numpy 2.4.6, pyoxipng 9.1.1,
 *                mozjpeg-lossless-optimization 1.3.2, cffi 2.1.1 (about 44 MB);
 *                installs by itself on first run
 *   bg           background removal: onnxruntime 1.31.1 and the fast u2netp
 *                model (rembg's release, Apache-2.0) (about 19 MB); only
 *                when the person asks
 *   bg_detailed  the detailed isnet-general-use model (179 MB); only when asked
 *
 * Every download is checked against its size and SHA-256 before anything in
 * it is unpacked or used: a mismatch stops the setup with an error, and
 * nothing unchecked is ever run. Only tools every Windows 10/11 ships are
 * used (curl.exe, tar.exe, certutil.exe). Wheels are unpacked straight into
 * engine/ under an "unpacking" mark, so a stopped unpack counts as not
 * installed and runs again; models are moved into engine/models/.
 *
 * Runs on its own cron lane (hooks.pb.js). Shadow instances (CraftBot's
 * verification boots of this same tree) never start it on their own.
 */

const LOCK = 'img.setup.worker';
const STATE = 'img.setup';
const WAKE = 'img.setup.wake';
const REQUEST = 'img.setup.request';
const PROC = 'img.setup.pid';

/** python311._pth: the stdlib, site-packages and engine/ (for img_engine). */
const PTH = 'python311.zip\r\n.\r\n..\\site-packages\r\n..\r\n';

const GROUPS = {
  core: 'The image engine',
  bg: 'Background removal (fast)',
  bg_detailed: 'Background removal (detailed model)',
};

/**
 * into: the engine folder it goes into. top: what an archive holds at its
 * top level. key: [file, size] that is there exactly when it is installed.
 */
const SOURCES = [
  {
    id: 'python',
    group: 'core',
    label: 'Python 3.11.9 (embedded)',
    url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',
    size: 11249023,
    sha256: '009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b',
    into: 'python',
    top: null,
    key: ['python/img-engine.exe', 103192],
  },
  {
    id: 'numpy',
    group: 'core',
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
    group: 'core',
    label: 'Pillow 13.0.0',
    url: 'https://files.pythonhosted.org/packages/7d/f6/6e2d96413e4c9dbec12ea584d9e646d602877d4cce3ea669099f959deac6/pillow-13.0.0-cp311-cp311-win_amd64.whl',
    size: 7278471,
    sha256: 'd7710eb676e9bb68965cb045be0d333b4c0d7f9dfbaa7fbf121385b1588683d3',
    into: 'site-packages',
    top: ['PIL', 'pillow-13.0.0.dist-info'],
    key: ['site-packages/PIL/_imaging.cp311-win_amd64.pyd', 2662400],
  },
  {
    id: 'oxipng',
    group: 'core',
    label: 'oxipng 9.1.1 (PNG optimizer)',
    url: 'https://files.pythonhosted.org/packages/fb/0f/d02062c7f2cfb53fab0484c4095451b72d249134b0252073773e3c2d869f/pyoxipng-9.1.1-cp311-cp311-win_amd64.whl',
    size: 458236,
    sha256: '327d065925cec7972b744f30e890e1c3ca3d47908b5e8474ebba389dbdd627e1',
    into: 'site-packages',
    top: ['oxipng', 'pyoxipng-9.1.1.dist-info'],
    key: ['site-packages/oxipng/oxipng.cp311-win_amd64.pyd', 1059840],
  },
  {
    id: 'cffi',
    group: 'core',
    label: 'cffi 2.1.1',
    url: 'https://files.pythonhosted.org/packages/73/c0/77ba02423c2f7d7091143c45cd49e0e6575c4c1967394bb542bd923a9b74/cffi-2.1.1-cp311-cp311-win_amd64.whl',
    size: 185096,
    sha256: '42f6930c31dc7f50732c9ae793c2786c7b6b044195967bbdde40bb9be81c4cc0',
    into: 'site-packages',
    top: ['cffi', 'cffi-2.1.1.dist-info'],
    key: ['site-packages/_cffi_backend.cp311-win_amd64.pyd', 179712],
  },
  {
    id: 'mozjpeg',
    group: 'core',
    label: 'MozJPEG optimizer 1.3.2',
    url: 'https://files.pythonhosted.org/packages/5d/e1/5390436186cbf7391cd0ae2850e286706dae6094582e8828ee41b1023bcf/mozjpeg_lossless_optimization-1.3.2-cp311-cp311-win_amd64.whl',
    size: 64630,
    sha256: 'b193a91f874b04babac42451f1d530ec165f300d72714f980fe4d58da681d62a',
    into: 'site-packages',
    top: ['mozjpeg_lossless_optimization', 'mozjpeg_lossless_optimization-1.3.2.dist-info'],
    key: ['site-packages/mozjpeg_lossless_optimization/_mozjpeg_opti.pyd', 250368],
  },
  {
    id: 'onnxruntime',
    group: 'bg',
    label: 'onnxruntime 1.31.1',
    url: 'https://files.pythonhosted.org/packages/69/82/2e2bf967ade9567d77c307533566ef56a19c32e2114fc062a405703def88/onnxruntime-1.31.1-cp311-cp311-win_amd64.whl',
    size: 14885761,
    sha256: 'c3d91b5de31e2fc82d71bd65b2b22bddee8b49057a3a36338e9a868e0ea90c05',
    into: 'site-packages',
    top: ['onnxruntime', 'onnxruntime-1.31.1.dist-info'],
    key: ['site-packages/onnxruntime/capi/onnxruntime_pybind11_state.pyd', 19965240],
  },
  {
    id: 'u2netp',
    group: 'bg',
    label: 'the fast background model (u2netp)',
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    size: 4574861,
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    into: 'models',
    file: 'u2netp.onnx',
    key: ['models/u2netp.onnx', 4574861],
  },
  {
    id: 'isnet',
    group: 'bg_detailed',
    label: 'the detailed background model (isnet-general-use)',
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    size: 178648008,
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    into: 'models',
    file: 'isnet-general-use.onnx',
    key: ['models/isnet-general-use.onnx', 178648008],
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

/** SHA-256 of a file (certutil), lowercase hex; '' when it cannot be read. */
function sha256(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) sleep(1000);
    try {
      const out = toString($os.cmd(systemTool('certutil.exe'), '-hashfile', path, 'SHA256').output());
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

function unpackMark(src) {
  return $filepath.join(engineDir(), '.unpacking-' + src.id);
}

/** A source is in place when its key file has its exact size, every top-level entry is there and no unpack is unfinished. */
function inPlace(src) {
  const dir = engineDir();
  if (sizeOf($filepath.join(dir, src.key[0])) !== src.key[1]) return false;
  if (exists(unpackMark(src))) return false;
  if (src.id === 'python') return readText($filepath.join(dir, 'python', 'python311._pth')) === PTH;
  return (src.top || []).every((t) => exists($filepath.join(dir, src.into, t)));
}

/** Sources still to install, of one group or of all. */
function pending(group) {
  return SOURCES.filter((src) => (group === undefined || src.group === group) && !inPlace(src));
}

/** Ids of the core sources not (fully) in place, for lib_engine's missing list. */
function unfinished() {
  return pending('core').map((src) => src.id);
}

function installed(group) {
  return pending(group).length === 0;
}

/** Only the app's own instance downloads by itself, never a shadow boot. */
function autoStart() {
  return $os.getenv('CRAFTBOT_APP_ENV') !== 'shadow';
}

function getState(app) {
  const st = app.store().get(STATE);
  return st === null || st === undefined ? null : st;
}

function failed(app, group) {
  const st = getState(app);
  return st !== null && st.phase === 'failed' && (group === undefined || st.group === group);
}

function running(app) {
  const st = getState(app);
  return st !== null && (st.phase === 'downloading' || st.phase === 'installing');
}

function requested(app) {
  return app.store().get(REQUEST) || [];
}

/** The groups to install now: the core unless it failed (it starts by itself), plus what the person asked for. */
function wantedGroups(app) {
  const out = [];
  const req = requested(app);
  if (!installed('core') && (req.indexOf('core') >= 0 || (autoStart() && !failed(app, 'core')))) out.push('core');
  for (const g of ['bg', 'bg_detailed']) if (req.indexOf(g) >= 0 && !installed(g)) out.push(g);
  return out;
}

/** True while the core is missing but on its way, so queued work stays queued. */
function waiting(app) {
  if (installed('core')) return false;
  return running(app) || wantedGroups(app).indexOf('core') >= 0;
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

/** Run a tool to the end (stderr to a log, stdout to outPath when given); throws with the log's last lines when it fails. */
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

function unpack(app, src, archive, target) {
  const tar = systemTool('tar.exe');
  const what = 'Unpacking ' + src.label;
  if (src.id !== 'python') {
    runTool(app, tar, ['-xf', archive, '-C', target], src.id + '-unpack.log', what);
    return;
  }
  // The engine process is the package's python.exe under its own name, so it
  // can be told apart from (and never kills) another Python.
  runTool(app, tar, ['-xf', archive, '-C', target, '--exclude', 'python.exe', '--exclude', 'pythonw.exe', '--exclude', 'python311._pth'], src.id + '-unpack.log', what);
  runTool(app, tar, ['-xOf', archive, 'python.exe'], src.id + '-exe.log', what, $filepath.join(target, 'img-engine.exe'));
  $os.writeFile($filepath.join(target, 'python311._pth'), PTH, 0o644);
}

/** Put a checked download in place (unpack an archive, move a model file). */
function place(app, src, archive) {
  setState(app, { phase: 'installing', step: src.label, partial: '' });
  const target = $filepath.join(engineDir(), src.into);
  $os.mkdirAll(target, 0o755);
  const patiently = require(`${__hooks}/lib_engine.js`).patiently;
  if (src.file) {
    patiently(() => $os.rename(archive, $filepath.join(target, src.file)), 15000);
    return;
  }
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
  patiently(() => $os.remove(unpackMark(src)));
  try {
    patiently(() => $os.remove(archive));
  } catch {
    /* removed with the download folder at the end */
  }
}

function install(app, groups) {
  const store = app.store();
  const todo = SOURCES.filter((src) => groups.indexOf(src.group) >= 0 && !inPlace(src));
  if (todo.length === 0) return;
  const total = todo.reduce((n, src) => n + src.size, 0);
  const label = groups.map((g) => GROUPS[g]).join(' and ');
  let done = 0;
  store.set(STATE, { phase: 'downloading', group: groups[0], groups: groups, label: label, step: todo[0].label, done_bytes: 0, total_bytes: total, partial: '', error: '' });
  try {
    $os.mkdirAll(downloadDir(), 0o755);
    for (const src of todo) {
      const archive = $filepath.join(downloadDir(), src.id + '.download');
      setState(app, { group: src.group });
      download(app, src, archive, done);
      place(app, src, archive);
      done += src.size;
      setState(app, { done_bytes: done });
    }
    try {
      $os.removeAll(downloadDir());
    } catch (err) {
      console.error('[image-utility] removing engine/.download failed (harmless):', err);
    }
    const left = requested(app).filter((g) => groups.indexOf(g) < 0);
    if (left.length) store.set(REQUEST, left);
    else store.remove(REQUEST);
    store.remove(STATE);
    // A newly installed library (onnxruntime) is picked up by a fresh engine process.
    if (groups.indexOf('bg') >= 0) require(`${__hooks}/lib_engine.js`).stop(app);
    console.log('[image-utility] installed: ' + label);
  } catch (err) {
    console.error('[image-utility] engine setup failed:', err);
    let message = String((err && err.message) || err);
    if (/^Downloading/.test(message)) message = message.replace(/[.\s]*$/, '.') + ' Check the internet connection, then retry.';
    const st = getState(app) || {};
    store.set(STATE, { phase: 'failed', group: st.group || groups[0], groups: groups, label: label, step: '', done_bytes: done, total_bytes: total, partial: '', error: message });
    store.set(REQUEST, requested(app).filter((g) => groups.indexOf(g) < 0));
  }
  store.set('img.wake', true);
}

/** Cron entry point; one setup at a time per process. Returns at once when nothing is wanted. */
function run(app) {
  if (wantedGroups(app).length === 0 && !app.store().has(WAKE)) return;
  const store = app.store();
  const me = $security.randomString(16);
  if (store.getOrSet(LOCK, () => me) !== me) return;
  try {
    for (;;) {
      store.remove(WAKE);
      const groups = wantedGroups(app);
      if (groups.length > 0) {
        install(app, groups);
        if (failed(app)) break;
        continue;
      }
      while (beforeHandover() && !store.has(WAKE)) sleep(500);
      if (!store.has(WAKE)) break;
    }
  } finally {
    store.remove(LOCK);
  }
}

/** engine.install: start (or retry) a group's setup right away. */
function request(app, group) {
  if (!GROUPS[group]) throw require(`${__hooks}/lib_util.js`).fail(400, 'what must be one of: ' + Object.keys(GROUPS).join(', '));
  const store = app.store();
  if (group === 'bg_detailed' && !installed('bg')) request(app, 'bg');
  if (!installed(group) && !running(app)) {
    if (failed(app)) store.remove(STATE);
    const req = requested(app);
    if (req.indexOf(group) < 0) req.push(group);
    store.set(REQUEST, req);
    store.set(WAKE, true);
  } else if (!installed(group)) {
    const req = requested(app);
    if (req.indexOf(group) < 0) req.push(group);
    store.set(REQUEST, req);
  }
  return status(app);
}

function mb(n) {
  return Math.round(n / 100000) / 10;
}

/**
 * The setup as engine.status reports it: per group installed or not and
 * its download size, and the setup in progress (state: ready | pending |
 * off | downloading | installing | failed).
 */
function status(app) {
  const groups = {};
  for (const g of Object.keys(GROUPS)) {
    const todo = pending(g);
    groups[g] = { label: GROUPS[g], installed: todo.length === 0, download_mb: mb(todo.reduce((n, s) => n + s.size, 0)), total_mb: mb(SOURCES.filter((s) => s.group === g).reduce((n, s) => n + s.size, 0)) };
  }
  const st = getState(app);
  let progress = null;
  if (st !== null) {
    let done = st.done_bytes;
    if (st.phase === 'downloading' && st.partial) done += Math.max(0, sizeOf(st.partial));
    progress = { phase: st.phase, group: st.group, label: st.label, step: st.step, done_bytes: Math.min(done, st.total_bytes), total_bytes: st.total_bytes, error: st.error || '' };
  }
  // The engine's own state (the add-ons report through groups and progress).
  let state;
  if (installed('core')) state = 'ready';
  else if (st !== null && st.group === 'core') state = st.phase;
  else state = wantedGroups(app).indexOf('core') >= 0 ? 'pending' : 'off';
  return { state: state, groups: groups, progress: progress, requested: requested(app) };
}

/** Why the engine cannot run yet, as a sentence for the person (lib_engine's error). */
function unavailable(app, missing) {
  const s = status(app);
  const p = s.progress;
  if (p && (p.phase === 'downloading' || p.phase === 'installing') && p.group === 'core') {
    return 'The image engine is still being set up (' + Math.round(p.done_bytes / 1e6) + ' of ' + Math.round(p.total_bytes / 1e6) + ' MB). Try again when it is ready.';
  }
  if (s.state === 'pending') return 'The image engine is being set up for the first time (a one-off download of about ' + Math.round(s.groups.core.download_mb) + ' MB). Try again in a minute or two.';
  if (s.state === 'failed') return 'The image engine could not be set up: ' + (p ? p.error : '') + ' Retry it on the Home page or in Settings.';
  return 'The image engine is not installed (missing ' + missing.join(', ') + ' in the app folder). Install it on the Home page or in Settings.';
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

module.exports = { GROUPS: GROUPS, SOURCES: SOURCES, run: run, request: request, status: status, waiting: waiting, unavailable: unavailable, unfinished: unfinished, installed: installed, killRunning: killRunning };
