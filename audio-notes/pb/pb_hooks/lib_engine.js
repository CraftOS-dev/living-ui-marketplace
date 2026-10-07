/// <reference path="../pb_data/types.d.ts" />
/**
 * The local transcription engine: ffmpeg (any audio/video -> 16 kHz mono WAV)
 * and whisper.cpp (WAV -> timed segments), both in <project>/engine/
 * (downloaded once, checked file by file, by lib_setup.js). Audio never
 * leaves the machine.
 *
 *   engine/bin/ffmpeg.exe          ffmpeg 9.0.2 essentials (gyan.dev)
 *   engine/bin/whisper-cli.exe     whisper.cpp b5130, OpenBLAS build (+ DLLs)
 *   engine/models/<MODEL>          multilingual "small" model, q5_1
 *   engine/models/<VAD_MODEL>      Silero VAD: speech-only decoding, so silence
 *                                  and noise never turn into invented text
 *   engine/bin/<DIARIZER>          sherpa-onnx 1.13.8 speaker diarization (+ onnxruntime.dll)
 *   engine/models/<SEG_MODEL>      pyannote segmentation 3.0: where voices change
 *   engine/models/<VOICE_MODEL>    NeMo TitaNet small: a fingerprint per voice
 *
 * Settings measured on the target i7-6700: greedy decoding (beam 1) runs the
 * small model at ~0.24x real time with the same transcript quality as the
 * 5-beam default (which ran at ~0.65x).
 *
 * Processes run with stderr streamed to a log file, so another request can
 * read progress while the worker blocks in wait().
 */

const MODEL = 'ggml-small-q5_1.bin';
const MODEL_LABEL = 'Whisper small (multilingual)';
const VAD_MODEL = 'ggml-silero-v6.2.0.bin';
const DIARIZER = 'sherpa-onnx-offline-speaker-diarization.exe';
const SEG_MODEL = 'pyannote-segmentation-3-0.onnx';
const VOICE_MODEL = 'nemo_en_titanet_small.onnx';

function projectDir() {
  return $filepath.join(__hooks, '..', '..');
}

function paths() {
  const engine = $filepath.join(projectDir(), 'engine');
  return {
    engine: engine,
    ffmpeg: $filepath.join(engine, 'bin', 'ffmpeg.exe'),
    whisper: $filepath.join(engine, 'bin', 'whisper-cli.exe'),
    model: $filepath.join(engine, 'models', MODEL),
    vad: $filepath.join(engine, 'models', VAD_MODEL),
    diarizer: $filepath.join(engine, 'bin', DIARIZER),
    onnxruntime: $filepath.join(engine, 'bin', 'onnxruntime.dll'),
    segModel: $filepath.join(engine, 'models', SEG_MODEL),
    voiceModel: $filepath.join(engine, 'models', VOICE_MODEL),
  };
}

function exists(path) {
  try {
    $os.stat(path);
    return true;
  } catch {
    return false;
  }
}

function missingOf(keys) {
  const p = paths();
  const missing = [];
  for (const key of keys) {
    if (!exists(p[key])) missing.push($filepath.base(p[key]));
  }
  return missing;
}

/** Which transcription engine files are missing (empty = ready). */
function missingFiles() {
  return missingOf(['ffmpeg', 'whisper', 'model', 'vad']);
}

/** Which speaker engine files are missing (empty = ready). */
function speakerMissing() {
  return missingOf(['ffmpeg', 'diarizer', 'onnxruntime', 'segModel', 'voiceModel']);
}

/** Threads: half the logical CPUs (physical cores on SMT machines), 1..8. */
function threads() {
  const n = parseInt(String($os.getenv('NUMBER_OF_PROCESSORS') || '4'), 10);
  const half = Math.floor((isFinite(n) && n > 0 ? n : 4) / 2);
  return Math.max(1, Math.min(8, half));
}

/** A fresh scratch folder per run (never shared with an orphaned process). */
function workDir(noteId) {
  return $filepath.join($os.tempDir(), 'audio-notes-' + noteId + '-' + $security.randomString(6));
}

/**
 * The running engine process, recorded on disk: a hard stop of the app (the
 * host kills PocketBase) skips onTerminate, and the orphan would keep a CPU
 * busy next to the requeued run. Boot kills it, matching pid AND image name
 * so a reused pid can never take down an unrelated process.
 */
const SLOTS = ['batch', 'live', 'people', 'setup'];

/** One file per lane (the lanes can run at the same time). */
function pidFile(slot) {
  // Per data dir, not per project: a shadow boot of this same tree has its
  // own data dir and must never kill the live instance's process.
  return $filepath.join($app.dataDir(), 'engine-process-' + slot + '.json');
}

function recordProcess(slot, pid, bin) {
  try {
    $os.mkdirAll($filepath.dir(pidFile(slot)), 0o755);
    $os.writeFile(pidFile(slot), JSON.stringify({ pid: pid, image: $filepath.base(bin) }), 0o644);
  } catch (err) {
    console.error('[audio-notes] could not record engine pid:', err);
  }
}

function clearProcess(slot) {
  try {
    $os.remove(pidFile(slot));
  } catch {
    /* none recorded */
  }
}

function killOrphan() {
  for (const slot of SLOTS) {
    const raw = readText(pidFile(slot));
    if (raw === '') continue;
    try {
      const p = JSON.parse(raw);
      $os.cmd('taskkill', '/F', '/T', '/FI', 'PID eq ' + Number(p.pid), '/FI', 'IMAGENAME eq ' + String(p.image)).run();
    } catch {
      /* already gone */
    }
    clearProcess(slot);
  }
}

/**
 * Start a process with stderr written to logPath. Returns a handle for
 * finish(). stdout is discarded (whisper repeats its results there) unless
 * outName names a file next to the log to keep it in (the diarizer's
 * results). `slot` names the lane ('batch' default, 'live', 'people') for
 * orphan tracking.
 */
function start(bin, args, logPath, slot, outName) {
  const lane = slot === undefined ? 'batch' : slot;
  const root = $os.openRoot($filepath.dir(logPath));
  const log = root.create($filepath.base(logPath));
  const out = outName === undefined ? null : root.create(outName);
  const cmd = $os.cmd(bin, ...args);
  cmd.stderr = log;
  if (out !== null) cmd.stdout = out;
  try {
    cmd.start();
  } catch (err) {
    log.close();
    if (out !== null) out.close();
    root.close();
    throw err;
  }
  recordProcess(lane, cmd.process.pid, bin);
  return { cmd: cmd, log: log, out: out, root: root, logPath: logPath, pid: cmd.process.pid, slot: lane };
}

/** Block until the process exits. Returns { ok, exitCode, log }. */
function finish(handle) {
  let exitCode = -1;
  try {
    handle.cmd.wait();
    exitCode = 0;
  } catch {
    try {
      exitCode = handle.cmd.processState.exitCode();
    } catch {
      exitCode = -1;
    }
  }
  clearProcess(handle.slot);
  try {
    handle.log.close();
  } catch {
    /* already closed */
  }
  try {
    if (handle.out) handle.out.close();
  } catch {
    /* already closed */
  }
  try {
    handle.root.close();
  } catch {
    /* already closed */
  }
  return { ok: exitCode === 0, exitCode: exitCode, log: readText(handle.logPath) };
}

function readText(path) {
  try {
    return toString($os.readFile(path));
  } catch {
    return '';
  }
}

/** Kill a process tree by pid (cancel, shutdown). */
function kill(pid) {
  if (!pid) return;
  try {
    $os.cmd('taskkill', '/PID', String(pid), '/T', '/F').run();
  } catch {
    /* already gone */
  }
}

/** Last lines of a tool log, for an error message a person can act on. */
function tail(text, lines) {
  const kept = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return kept.slice(-lines).join('\n');
}

/** Convert to 16 kHz mono WAV, measuring the peak level on the way (volumedetect). */
function ffmpegArgs(src, wav) {
  return ['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info', '-y', '-i', src, '-vn', '-af', 'volumedetect', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav];
}

/** Decode only, to measure the peak (volumedetect) of a finished file. */
function measureArgs(src) {
  return ['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info', '-i', src, '-vn', '-af', 'volumedetect', '-f', 'null', '-'];
}

/** At or below this the audio is digital silence (16-bit floor is -91 dB). */
const SILENT_DB = -90;

/**
 * Peak level in dBFS from ffmpeg's volumedetect report, or null when absent.
 * The line is the pinned ffmpeg build's own format: "max_volume: -91.0 dB".
 */
function peakDb(logText) {
  const re = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/g;
  let last = null;
  let m;
  while ((m = re.exec(String(logText || ''))) !== null) last = Number(m[1]);
  return last;
}

/** Lossless container rewrite: adds the duration and seek index a browser
 *  recording (MediaRecorder WebM) is written without. */
function remuxArgs(src, out) {
  return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-c', 'copy', out];
}

/**
 * whisper-cli arguments. language: '' or 'auto' for detection, else an ISO
 * code. audioSeconds (live pieces): shrink whisper's 30 s encoder window to
 * the piece, which made a 5 s piece take ~1.6 s instead of ~6 s (measured,
 * same text). Whole files keep the full window.
 */
function whisperArgs(wav, outBase, language, audioSeconds) {
  const p = paths();
  const window = [];
  if (audioSeconds !== undefined) {
    const ctx = Math.ceil((((audioSeconds + 1) / 30) * 1500) / 64) * 64;
    window.push('-ac', String(Math.max(128, Math.min(1500, ctx))));
  }
  return [
    ...window,
    '-m', p.model,
    '-f', wav,
    '-l', language === '' ? 'auto' : language,
    '-t', String(threads()),
    '-bs', '1',
    '-bo', '1',
    '--vad',
    '-vm', p.vad,
    '-oj',
    '-of', outBase,
    '-np',
    '-pp',
  ];
}

/** Convert to 16 kHz mono WAV, nothing else (the speaker engine's input). */
function wavArgs(src, wav) {
  return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav];
}

/**
 * Speaker diarization arguments; speakers > 0 fixes the number of clusters.
 * Measured on the target i7-6700 with a real 35-minute, 2-person call: a
 * segmentation window shift of 0.5 ran in 74 s (0.1, the default, took
 * 352 s) and clustered more cleanly. Of the embedding models tried (TitaNet
 * small/large, 3D-Speaker CAM++, ERes2Net v1/v2, WeSpeaker ResNet34), TitaNet small at a
 * cosine-distance threshold of 0.8 kept different people apart in every
 * clean 2- and 4-speaker recording; the clusters it splits one real voice
 * into are merged by lib_people countPeople.
 */
function diarizeArgs(wav, speakers) {
  const p = paths();
  const n = String(threads());
  return [
    '--print-args=false',
    '--segmentation.pyannote-model=' + p.segModel,
    '--segmentation.num-threads=' + n,
    '--segmentation.pyannote-window-shift-ratio=0.5',
    '--embedding.model=' + p.voiceModel,
    '--embedding.num-threads=' + n,
    // A known number of people (the user's setting) beats any threshold.
    speakers > 0 ? '--clustering.num-clusters=' + speakers : '--clustering.cluster-threshold=0.8',
    wav,
  ];
}

/**
 * Speaker turns [{start, end, voice}] from the diarizer's stdout. Each line
 * is the pinned build's own format: "12.345 -- 17.890 speaker_01".
 */
function readTurns(text) {
  const turns = [];
  const re = /^\s*(\d+(?:\.\d+)?) -- (\d+(?:\.\d+)?) (speaker_\d+)\s*$/gm;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (end > start) turns.push({ start: start, end: end, voice: m[3] });
  }
  return turns;
}

/** Exact seconds of audio in a 16 kHz mono 16-bit WAV (44-byte header). */
function wavDuration(wav) {
  try {
    return Math.max(0, ($os.stat(wav).size() - 44) / 32000);
  } catch {
    return 0;
  }
}

/** Seconds of audio in a 16 kHz mono 16-bit WAV (44-byte header). */
function wavSeconds(wav) {
  try {
    const size = $os.stat(wav).size();
    return Math.max(0, Math.round((size - 44) / 32000));
  } catch {
    return 0;
  }
}

/**
 * Latest whisper progress percent from its stderr log, or null before the
 * first report. The line is whisper.cpp's own fixed format
 * ("whisper_print_progress_callback: progress =  27%") from the pinned build.
 */
function whisperProgress(logText) {
  const re = /progress\s*=\s*(\d{1,3})%/g;
  let last = null;
  let m;
  while ((m = re.exec(String(logText || ''))) !== null) last = Number(m[1]);
  return last;
}

/**
 * Parse whisper's JSON output into segments [{start, end, text}] (seconds).
 * Returns { language, segments }.
 */
function readWhisperJson(outBase) {
  const raw = readText(outBase + '.json');
  if (raw === '') throw new Error('whisper wrote no result file');
  const parsed = JSON.parse(raw);
  const segments = [];
  for (const s of parsed.transcription || []) {
    const text = String(s.text || '').trim();
    if (text === '') continue;
    segments.push({
      start: Math.round(Number(s.offsets.from)) / 1000,
      end: Math.round(Number(s.offsets.to)) / 1000,
      text: text,
    });
  }
  const language = String((parsed.result && parsed.result.language) || '');
  return { language: language, segments: segments };
}

module.exports = {
  MODEL_LABEL: MODEL_LABEL,
  paths: paths,
  missingFiles: missingFiles,
  speakerMissing: speakerMissing,
  wavArgs: wavArgs,
  diarizeArgs: diarizeArgs,
  readTurns: readTurns,
  workDir: workDir,
  start: start,
  finish: finish,
  readText: readText,
  kill: kill,
  killOrphan: killOrphan,
  tail: tail,
  ffmpegArgs: ffmpegArgs,
  SILENT_DB: SILENT_DB,
  peakDb: peakDb,
  remuxArgs: remuxArgs,
  measureArgs: measureArgs,
  whisperArgs: whisperArgs,
  wavSeconds: wavSeconds,
  wavDuration: wavDuration,
  whisperProgress: whisperProgress,
  readWhisperJson: readWhisperJson,
};
