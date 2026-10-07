/// <reference path="../pb_data/types.d.ts" />
/**
 * First-run setup of the speech engine (lib_engine.js lists what each file
 * does). The engine is ~420 MB, too big to ship inside the app, so this lane
 * downloads it once into <project>/engine/ from each project's own official
 * release, pinned to the exact build the app was measured with:
 *
 *   whisper.cpp b5130 (GitHub release zip)     whisper-cli.exe + DLLs
 *   Hugging Face (pinned commits)              Whisper small, Silero VAD,
 *                                              pyannote segmentation 3.0
 *   ffmpeg 9.0.2 essentials (GitHub release)   ffmpeg.exe
 *   sherpa-onnx 1.13.8 (PyPI wheels, GitHub)   speaker diarizer, onnxruntime.dll,
 *                                              TitaNet small
 *
 * Every download, and every file taken out of one, is checked against its
 * SHA-256 before it is moved into engine/: a mismatch stops the setup with
 * an error, and nothing unchecked is ever run. Only tools every Windows 10/11
 * ships are used (curl.exe, tar.exe, certutil.exe). The sherpa-onnx diarizer
 * and runtime come from its PyPI wheels (zip files) because Windows' tar
 * cannot open the GitHub .tar.bz2 (it is built without bzip2); the wheel's
 * diarizer is the release build apart from its link timestamp.
 *
 * Runs on its own cron lane (notes.pb.js): on a fresh install it starts by
 * itself, a failed attempt waits for engine.install (the Retry button), and
 * a partial download resumes where it stopped. Shadow instances (CraftBot's
 * verification boots of this same tree) never start it on their own. While
 * it runs, the other lanes leave their queued work queued (waiting()) instead
 * of failing it, and each lane is woken as soon as its files are in place.
 */

const LOCK = 'audio_notes.setup_worker';
const STATE = 'audio_notes.setup';
const WAKE = 'audio_notes.setup_wake';
const REQUEST = 'audio_notes.setup_request';

/**
 * [member path in the download (null: the download is the file), engine path,
 *  size, sha256]. Transcription parts come first so recording works before
 * the speaker parts arrive.
 */
const SOURCES = [
  {
    id: 'whisper',
    label: 'the speech recognizer (whisper.cpp)',
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-blas-bin-x64.zip',
    size: 21360234,
    sha256: '55c06d09e8b9b6cfb2b0b47ddedc71803054f0e48be1f41848b3141c06c703a9',
    files: [
      ['Release/whisper-cli.exe', 'bin/whisper-cli.exe', 479232, '98d0df798385cc7ba713b56b2bdb7ffb5b3133cc1cfa63506fa2152d8b4d7f50'],
      ['Release/whisper.dll', 'bin/whisper.dll', 1368576, '46b55dbd3da3e23338143ddce8055921c88879ad0cf8feb8ba6971b26d32a7f1'],
      ['Release/ggml.dll', 'bin/ggml.dll', 62464, 'bd06e8795b0a4c60ae545727ade9d830430dc997d9f2e46d03f9308494526e1c'],
      ['Release/ggml-base.dll', 'bin/ggml-base.dll', 689664, '7ed3fb85624b44059cc3d092779818bdac7d8c4855ff11fd538eaa3ee7c88aed'],
      ['Release/ggml-blas.dll', 'bin/ggml-blas.dll', 55296, '3c185dcd9285b2d0c1986c034c07c37d0410ab5922df23dedff37cbe12cabe36'],
      ['Release/ggml-cpu-alderlake.dll', 'bin/ggml-cpu-alderlake.dll', 864256, 'd942768d3178d53fb9927d1f53b49330349fee690e60693dd411fdb31ec4d3ba'],
      ['Release/ggml-cpu-cannonlake.dll', 'bin/ggml-cpu-cannonlake.dll', 908288, 'b1700e9c7ce85a873f79ca2461d83ec9fede8b2352a40ad74639e89b78240890'],
      ['Release/ggml-cpu-cascadelake.dll', 'bin/ggml-cpu-cascadelake.dll', 904704, '86937ae3f419c3761adcacdd4e5d7244d2db3ae74570918567350173a05b1afd'],
      ['Release/ggml-cpu-haswell.dll', 'bin/ggml-cpu-haswell.dll', 866304, 'fe620acfd0ef167f9b275ed816c44226bad0f9925a9b3726d374c3adb94e63b5'],
      ['Release/ggml-cpu-icelake.dll', 'bin/ggml-cpu-icelake.dll', 904704, 'a96558846c9625b463add0ef4fa0ed0b4fcb05cb6b69834f368c99337a571e5a'],
      ['Release/ggml-cpu-sandybridge.dll', 'bin/ggml-cpu-sandybridge.dll', 860672, '2e289078ea57e152ed44298f7917b5e3cad9166e0a11dc7c6e8ff142c69972f0'],
      ['Release/ggml-cpu-skylakex.dll', 'bin/ggml-cpu-skylakex.dll', 908288, '5aa6793948f828addd0419d19eac0ffd6d8d0f8d45590c4a57a4e6687247a7db'],
      ['Release/ggml-cpu-sse42.dll', 'bin/ggml-cpu-sse42.dll', 846848, '1300c89a0377fef297d195ccfd41fe5068e5e9db0aa91a2904f02431bb7e76a6'],
      ['Release/ggml-cpu-x64.dll', 'bin/ggml-cpu-x64.dll', 850432, '32d6a0df82cafca971d46bf000d50479b965258dc73380d522e305aa753fcde1'],
      ['Release/libopenblas.dll', 'bin/libopenblas.dll', 51126150, '4c7fb23e900bd637cf771ad4ae3d1b51112a897385906433f2f1e58fe053ff70'],
    ],
  },
  {
    id: 'vad',
    label: 'the voice activity model (Silero VAD)',
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin',
    size: 885098,
    sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987',
    files: [[null, 'models/ggml-silero-v6.2.0.bin', 885098, '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987']],
  },
  {
    id: 'model',
    label: 'the Whisper small model',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin',
    size: 190085487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    files: [[null, 'models/ggml-small-q5_1.bin', 190085487, 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb']],
  },
  {
    id: 'ffmpeg',
    label: 'the audio converter (ffmpeg)',
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
    size: 114768076,
    sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    files: [['ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe', 'bin/ffmpeg.exe', 105423872, '3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec']],
  },
  {
    id: 'runtime',
    label: 'the speaker engine runtime (onnxruntime)',
    url: 'https://files.pythonhosted.org/packages/94/38/64356ad97f68fffcf01fe7545407ad18a2ea86c1ffae5b0950f7fac73638/sherpa_onnx_core-1.13.8-py3-none-win_amd64.whl',
    size: 16903581,
    sha256: '5579e80196d516e6dae23c8f629292ce3142ab8869925d32b94612fd86f93733',
    files: [['sherpa_onnx_core-1.13.8.data/data/Scripts/onnxruntime.dll', 'bin/onnxruntime.dll', 17799168, '7f66f939a881baf4f46a2216496798edf4a1429878b646d12674aa62f27d8a25']],
  },
  {
    id: 'diarizer',
    label: 'the speaker detector (sherpa-onnx)',
    url: 'https://files.pythonhosted.org/packages/38/b9/ad8cd468f0adb37f2701c5067d5b19b141bf815c6434a8749b02d688f3b9/sherpa_onnx_bin-1.13.8-py3-none-win_amd64.whl',
    size: 18148074,
    sha256: '9549d3c1a9ec325fb7315006407ffde5bdeee99f3625c03d0b7967009e869a9a',
    files: [
      [
        'sherpa_onnx_bin-1.13.8.data/data/Scripts/sherpa-onnx-offline-speaker-diarization.exe',
        'bin/sherpa-onnx-offline-speaker-diarization.exe',
        651264,
        '1b717d439356715c336af2e42360a9a7e1312a70d0f6b55d4a446b992b4e1acf',
      ],
    ],
  },
  {
    id: 'segmentation',
    label: 'the speaker segmentation model (pyannote)',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.onnx',
    size: 5992913,
    sha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079',
    files: [[null, 'models/pyannote-segmentation-3-0.onnx', 5992913, '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079']],
  },
  {
    id: 'voices',
    label: 'the voice fingerprint model (TitaNet small)',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx',
    size: 40257283,
    sha256: 'ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e',
    files: [[null, 'models/nemo_en_titanet_small.onnx', 40257283, 'ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e']],
  },
];

/** Idle until 2 s before the next cron tick, then hand over (see lib_worker). */
function beforeHandover() {
  return new Date().getSeconds() < 58;
}

function engine() {
  return require(`${__hooks}/lib_engine.js`);
}

function engineDir() {
  return engine().paths().engine;
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

/** Throws unless the file at path is exactly the expected one. */
function check(path, size, sum, what) {
  const actual = sizeOf(path);
  if (actual !== size) {
    throw new Error(what + ' is not the expected file (' + actual + ' bytes instead of ' + size + '), so it was not used. Retry to download it again.');
  }
  const hash = sha256(path);
  if (hash === '') throw new Error(what + ' could not be read to check it (' + path + ').');
  if (hash !== sum) throw new Error(what + ' did not match the expected file (checksum), so it was not used. Retry to download it again.');
}

/**
 * A source is in place when each of its files is there at its exact size
 * (checked against SHA-256 when it was installed; sizes keep this cheap
 * enough for every status poll).
 */
function inPlace(src) {
  const dir = engineDir();
  return src.files.every((f) => sizeOf($filepath.join(dir, f[1])) === f[2]);
}

/** Sources still to install (empty = the whole engine is in place). */
function pending() {
  return SOURCES.filter((src) => !inPlace(src));
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

/** Whether setup should run now (and, from other lanes: is about to). */
function wanted(app) {
  if (pending().length === 0) return false;
  if (app.store().has(REQUEST)) return true;
  return autoStart() && !failed(app);
}

/**
 * True while the files a lane needs are missing but on their way, so the
 * lane leaves its queued work queued. part: 'transcribe' or 'speakers'.
 */
function waiting(app, part) {
  const eng = engine();
  const missing = part === 'speakers' ? eng.speakerMissing() : eng.missingFiles();
  if (missing.length === 0) return false;
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

/** Run a tool to the end; throws with the tail of its output when it fails. */
function runTool(bin, args, logName, what) {
  const eng = engine();
  const handle = eng.start(bin, args, $filepath.join(downloadDir(), logName), 'setup');
  const result = eng.finish(handle);
  if (!result.ok) throw new Error(what + ' failed: ' + (eng.tail(result.log, 2) || 'exit code ' + result.exitCode));
}

/** Put a verified file at its engine path (replacing a wrong or partial one). */
function moveInto(from, rel) {
  const target = $filepath.join(engineDir(), rel);
  $os.mkdirAll($filepath.dir(target), 0o755);
  if (sizeOf(target) >= 0) $os.remove(target);
  $os.rename(from, target);
}

/** Download one source (resuming a partial download) and check it. */
function download(app, src, archive, doneBytes) {
  if (sizeOf(archive) === src.size && sha256(archive) === src.sha256) return;
  if (sizeOf(archive) >= 0) $os.remove(archive);
  const part = archive + '.part';
  if (sizeOf(part) > src.size) $os.remove(part);
  setState(app, { phase: 'downloading', step: src.label, done_bytes: doneBytes, partial: part });
  if (sizeOf(part) !== src.size) {
    runTool(
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
    check(archive, src.size, src.sha256, 'The download of ' + src.label);
  } catch (err) {
    $os.remove(archive);
    throw err;
  }
}

/** Take a checked download's files out and move each, checked, into engine/. */
function place(app, src, archive) {
  setState(app, { phase: 'installing', step: src.label, partial: '' });
  if (src.files.length === 1 && src.files[0][0] === null) {
    moveInto(archive, src.files[0][1]);
    return;
  }
  const stage = $filepath.join(downloadDir(), src.id);
  $os.removeAll(stage);
  $os.mkdirAll(stage, 0o755);
  // Unpacked flat (a source's members share one folder depth): the staged
  // paths stay short, as certutil cannot open a path over 260 characters.
  const depth = src.files[0][0].split('/').length - 1;
  const staged = (f) => $filepath.join(stage, $filepath.base(f[0]));
  try {
    runTool(
      systemTool('tar.exe'),
      ['-xf', archive, '-C', stage, '--strip-components', String(depth), ...src.files.map((f) => f[0])],
      src.id + '-extract.log',
      'Unpacking ' + src.label,
    );
    for (const f of src.files) check(staged(f), f[2], f[3], $filepath.base(f[1]) + ' from ' + src.label);
    for (const f of src.files) moveInto(staged(f), f[1]);
  } finally {
    $os.removeAll(stage);
  }
  $os.remove(archive);
}

/** Wake the lanes whose queued work was waiting on the engine. */
function wakeLanes(app) {
  require(`${__hooks}/lib_worker.js`).wake(app);
  require(`${__hooks}/lib_live.js`).wake(app);
  require(`${__hooks}/lib_people.js`).wake(app);
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
      wakeLanes(app);
    }
    $os.removeAll(downloadDir());
    store.remove(STATE);
    console.log('[audio-notes] speech engine installed');
  } catch (err) {
    console.error('[audio-notes] speech engine setup failed:', err);
    let message = String((err && err.message) || err);
    if (/curl/.test(message)) message = message.replace(/[.\s]*$/, '.') + ' Check the internet connection, then retry.';
    store.set(STATE, { phase: 'failed', step: '', done_bytes: done, total_bytes: total, partial: '', error: message });
  }
  wakeLanes(app);
}

/** Cron entry point; one setup at a time per process. */
function run(app) {
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
      while (beforeHandover() && !store.has(WAKE)) sleep(500);
      if (!store.has(WAKE)) break;
    }
  } finally {
    store.remove(LOCK);
  }
}

/** engine.install: start the setup (or retry a failed one) right away. */
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
 * itself within a minute) | off (waits for engine.install) | downloading |
 * installing | failed.
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

/** Shutdown: do not leave a download running without its lane. */
function killRunning(app) {
  const raw = engine().readText($filepath.join(app.dataDir(), 'engine-process-setup.json'));
  if (raw === '') return;
  try {
    engine().kill(JSON.parse(raw).pid);
  } catch {
    /* already gone */
  }
}

module.exports = { run: run, request: request, status: status, waiting: waiting, killRunning: killRunning };
