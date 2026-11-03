/// <reference path="../pb_data/types.d.ts" />
/**
 * The models that turn a recording into a song (frontend music/models.ts):
 * Demucs (Meta, MIT) splits the voice from the music, Whisper small (OpenAI,
 * MIT) hears the words. The browser asks for them here in 16 MB parts; each
 * part is fetched once from Hugging Face at a pinned revision (a range
 * request) and kept on disk beside pb_data (pb/model_cache, outside the
 * backups), so the next recording, or another browser, gets it from this
 * computer. Only the files listed below can be asked for.
 */

const PART = 16 * 1024 * 1024;
const DEMUCS = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/';
const WHISPER = 'https://huggingface.co/onnx-community/whisper-small_timestamped/resolve/65caa70f294b46e1c33ff820aae6b16d048ab818/';

const FILES = {
  demucs: { url: DEMUCS + 'htdemucs_embedded.onnx', size: 180534758 },
  'whisper/config.json': { url: WHISPER + 'config.json', size: 2227 },
  'whisper/generation_config.json': { url: WHISPER + 'generation_config.json', size: 3893 },
  'whisper/preprocessor_config.json': { url: WHISPER + 'preprocessor_config.json', size: 339 },
  'whisper/tokenizer.json': { url: WHISPER + 'tokenizer.json', size: 2480466 },
  'whisper/tokenizer_config.json': { url: WHISPER + 'tokenizer_config.json', size: 282683 },
  'whisper/onnx/encoder_model_q4.onnx': { url: WHISPER + 'onnx/encoder_model_q4.onnx', size: 66178491 },
  'whisper/onnx/decoder_model_merged_q4.onnx': { url: WHISPER + 'onnx/decoder_model_merged_q4.onnx', size: 233421212 },
};

function cacheDir(app) {
  return $filepath.join(app.dataDir(), '..', 'model_cache');
}

function errorJson(e, status, message) {
  return e.json(status, { status: status, message: message });
}

/** GET /api/models/part?f=<id>&i=<part>: one part of a model file, as bytes. */
function part(e) {
  const q = e.request.url.query();
  const id = String(q.get('f') || '');
  const f = Object.prototype.hasOwnProperty.call(FILES, id) ? FILES[id] : null;
  if (f === null) return errorJson(e, 404, 'No model file "' + id + '". Known: ' + Object.keys(FILES).join(', '));
  const parts = Math.ceil(f.size / PART);
  const i = parseInt(String(q.get('i') || '0'), 10);
  if (!(i >= 0 && i < parts)) return errorJson(e, 400, 'Part ' + q.get('i') + ' is out of range: ' + id + ' has parts 0 to ' + (parts - 1) + '.');
  const from = i * PART;
  const to = Math.min(f.size, from + PART) - 1;
  const want = to - from + 1;
  const dir = $filepath.join(cacheDir(e.app), id.replace(/[^a-zA-Z0-9._-]+/g, '_'));
  const path = $filepath.join(dir, String(i));
  try {
    const kept = $os.readFile(path);
    if (kept.length === want) return e.blob(200, 'application/octet-stream', kept);
  } catch (_) {
    /* not kept yet */
  }
  let res;
  try {
    res = $http.send({ url: f.url, method: 'GET', headers: { Range: 'bytes=' + from + '-' + to }, timeout: 600 });
  } catch (err) {
    return errorJson(e, 502, 'Hugging Face could not be reached: ' + String((err && err.message) || err));
  }
  const whole = res.statusCode === 200 && from === 0 && to === f.size - 1;
  if (res.statusCode !== 206 && !whole) return errorJson(e, 502, 'Hugging Face answered HTTP ' + res.statusCode + ' for ' + id + '.');
  const body = res.body;
  if (body.length !== want) return errorJson(e, 502, 'Hugging Face sent ' + body.length + ' bytes for part ' + i + ' of ' + id + ', not ' + want + '.');
  try {
    $os.mkdirAll(dir, 0o755);
    const tmp = path + '.' + $security.randomString(8);
    $os.writeFile(tmp, body, 0o644);
    $os.rename(tmp, path);
  } catch (err) {
    console.warn('[singing-coach] could not keep a model part:', err);
  }
  return e.blob(200, 'application/octet-stream', body);
}

module.exports = { part: part, FILES: FILES, PART: PART };
