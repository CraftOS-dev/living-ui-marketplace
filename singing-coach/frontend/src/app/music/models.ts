/**
 * The two models that turn a recording into a song: Demucs splits the voice
 * from the music, Whisper hears the words. They are fetched once, through
 * the app's own server (pb_hooks/lib_models.js keeps the allow-list of
 * pinned files and a copy on disk), in 16 MB parts so the download shows its
 * progress, and kept in the browser's cache for the next recording.
 */

export interface ModelFile {
  /** The id the server knows the file by. */
  id: string;
  size: number;
}

export const PART = 16 * 1024 * 1024;

/** htdemucs v4 (Meta, MIT), as ONNX with its normalisation inside. */
export const DEMUCS: ModelFile = { id: 'demucs', size: 180534758 };

/** Whisper small (OpenAI, MIT) with cross-attention for word times, 4-bit weights. */
export const WHISPER_MODEL = 'onnx-community/whisper-small_timestamped';
export const WHISPER: Record<string, ModelFile> = {
  'config.json': { id: 'whisper/config.json', size: 2227 },
  'generation_config.json': { id: 'whisper/generation_config.json', size: 3893 },
  'preprocessor_config.json': { id: 'whisper/preprocessor_config.json', size: 339 },
  'tokenizer.json': { id: 'whisper/tokenizer.json', size: 2480466 },
  'tokenizer_config.json': { id: 'whisper/tokenizer_config.json', size: 282683 },
  'onnx/encoder_model_q4.onnx': { id: 'whisper/onnx/encoder_model_q4.onnx', size: 66178491 },
  'onnx/decoder_model_merged_q4.onnx': { id: 'whisper/onnx/decoder_model_merged_q4.onnx', size: 233421212 },
};

export const WHISPER_BYTES = Object.values(WHISPER).reduce((a, f) => a + f.size, 0);

const CACHE = 'singing-coach-models-v1';

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches !== 'undefined' ? await caches.open(CACHE) : null;
  } catch {
    return null;
  }
}

const keyOf = (f: ModelFile): string => `${self.location.origin}/models/${f.id}`;

/** Whether a file is already on this computer (no download needed). */
export async function haveModel(f: ModelFile): Promise<boolean> {
  const c = await openCache();
  if (c === null) return false;
  try {
    const r = await c.match(keyOf(f));
    return r !== undefined && Number(r.headers.get('content-length') ?? '0') === f.size;
  } catch {
    return false;
  }
}

/** A model file's bytes: from the cache, else downloaded in parts (onBytes reports what has arrived). */
export async function loadModel(f: ModelFile, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  const c = await openCache();
  if (c !== null) {
    try {
      const hit = await c.match(keyOf(f));
      if (hit !== undefined) {
        const buf = await hit.arrayBuffer();
        if (buf.byteLength === f.size) {
          onBytes(f.size);
          return buf;
        }
      }
    } catch {
      /* fetch it again */
    }
  }
  const out = new Uint8Array(f.size);
  const parts = Math.ceil(f.size / PART);
  let got = 0;
  for (let i = 0; i < parts; i++) {
    let data: ArrayBuffer | null = null;
    for (let attempt = 0; attempt < 3 && data === null; attempt++) {
      try {
        const r = await fetch(`/api/models/part?f=${encodeURIComponent(f.id)}&i=${i}`);
        if (r.ok) data = await r.arrayBuffer();
        else if (r.status === 404 || r.status === 400) throw new Error(`The model file ${f.id} is not available (HTTP ${r.status}).`);
        else if (attempt === 2) throw new Error(`The model could not be downloaded (HTTP ${r.status}). Check the internet connection and try again.`);
      } catch (err) {
        if (attempt === 2 || (err instanceof Error && /not available/.test(err.message))) throw err instanceof Error && /HTTP|available/.test(err.message) ? err : new Error('The model could not be downloaded. Check the internet connection and try again.');
      }
    }
    const expect = Math.min(PART, f.size - i * PART);
    if (data === null || data.byteLength !== expect) throw new Error('The model download was cut short. Try again.');
    out.set(new Uint8Array(data), i * PART);
    got += data.byteLength;
    onBytes(got);
  }
  if (c !== null) {
    try {
      await c.put(keyOf(f), new Response(out, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(f.size) } }));
    } catch {
      /* no room to keep it: it downloads again next time */
    }
  }
  return out.buffer;
}
