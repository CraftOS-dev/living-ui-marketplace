/**
 * A song with music, taken apart on this computer (a worker, so the page
 * stays responsive):
 *
 *   separate   Demucs (separate.ts) on the graphics card through WebGPU,
 *              else on the processor (WebAssembly, much slower)
 *   listen     the voice alone for the melody, the drums, bass and other
 *              instruments for the beat, the key and the chords (analysis.ts)
 *   words      Whisper small over the voice alone, a window of whole phrases
 *              (at most 28 s, cut where the voice is silent) at a time, with
 *              the time of every piece of text; the language is the one
 *              Whisper hears first unless the person named it; a window
 *              that comes back as a loop ("ななな…") is heard again phrase
 *              by phrase, and the stock lines Whisper makes up over music
 *              are dropped
 *   keep       the voice and the music as small Opus files (opus.ts)
 *
 * The models come from models.ts (the app's server, then the browser's
 * cache); transformers.js finds Whisper's files in that cache and asks the
 * app's server, never another site, for anything else.
 */
import * as ort from 'onnxruntime-web/webgpu';
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortWasm from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import { analyse, resampleTo, type TranscribeResult } from './analysis.ts';
import type { Heard } from './lyrics.ts';
import { DEMUCS, WHISPER, WHISPER_MODEL, loadModel } from './models.ts';
import { encodeStem } from './opus.ts';
import { DEMUCS_RATE, separateDemucs } from './separate.ts';

export interface StemsRequest {
  /** The recording at 44.1 kHz (one or two channels). */
  channels: Float32Array[];
  /** Hear the words too. */
  words: boolean;
  /** A Whisper language code ("ja", "en"…), or "" to let it tell. */
  language: string;
}

export interface StemsDone {
  result: TranscribeResult;
  heard: Heard[] | null;
  /** The language the words were heard in. */
  language: string | null;
  voice: { blob: Blob; ext: 'ogg' | 'wav' };
  music: { blob: Blob; ext: 'ogg' | 'wav' };
  device: 'webgpu' | 'wasm';
}

export type StemsOut = { type: 'progress'; p: number; stage: string } | { type: 'done'; out: StemsDone } | { type: 'error'; message: string };

const post = (m: StemsOut, transfer: Transferable[] = []): void => (self as unknown as { postMessage: (m: StemsOut, t: Transferable[]) => void }).postMessage(m, transfer);

ort.env.wasm.wasmPaths = { wasm: ortWasm };
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.logLevel = 'error';

/** WebGPU when the browser has a usable adapter. */
async function gpu(): Promise<boolean> {
  try {
    const g = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    return g !== undefined && (await g.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------------- words */

const SR16 = 16000;
const HOP16 = 320;

/** Where the voice sounds, as [start, end) sample ranges at 16 kHz (pauses under 0.6 s joined). */
function phrases(x: Float32Array): [number, number][] {
  const frames = Math.floor(x.length / HOP16);
  const db = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let e = 0;
    for (let k = 0; k < HOP16; k++) e += x[i * HOP16 + k]! ** 2;
    db[i] = 10 * Math.log10(e / HOP16 + 1e-12);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? -20;
  const gate = Math.max(-55, p90 - 35);
  const out: [number, number][] = [];
  let a = -1;
  let last = -1;
  for (let i = 0; i < frames; i++) {
    if (db[i]! <= gate) continue;
    if (a < 0) a = i;
    else if ((i - last) * HOP16 > 0.6 * SR16) {
      out.push([a * HOP16, (last + 1) * HOP16]);
      a = i;
    }
    last = i;
  }
  if (a >= 0) out.push([a * HOP16, (last + 1) * HOP16]);
  // Too short to be words.
  return out.filter(([s, e]) => e - s >= 0.25 * SR16);
}

/** Whole phrases grouped into windows Whisper can take at once (28 s at most); longer phrases are cut. */
function windows(ph: [number, number][]): [number, number][] {
  const MAX = 28 * SR16;
  const out: [number, number][] = [];
  for (const [s, e] of ph) {
    const cur = out[out.length - 1];
    if (cur !== undefined && e - cur[0] <= MAX) cur[1] = e;
    else for (let a = s; a < e; a += MAX) out.push([a, Math.min(e, a + MAX)]);
  }
  return out;
}

/** A loop rather than words: one short pattern over and over, or hardly any different characters. */
function looped(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  const chars = [...t];
  if (chars.length < 12) return false;
  if (new Set(chars).size / chars.length < 0.12) return true;
  return /(.{1,4})\1{5,}/u.test(t);
}

// Lines Whisper is known to make up over music and silence.
const MADE_UP = /ご視聴ありがとうございました|チャンネル登録|字幕|thank(s| you) for watching|subtitles? by|please subscribe|♪/i;

type Chunk = { text: string; timestamp: [number, number | null] };

async function hearWords(asr: AutomaticSpeechRecognitionPipeline, voice16: Float32Array, language: string, onProgress: (p: number) => void): Promise<Heard[]> {
  const ph = phrases(voice16);
  const wins = windows(ph);
  const total = wins.reduce((a, [s, e]) => a + (e - s), 0) || 1;
  let done = 0;
  const heard: Heard[] = [];
  const pad = Math.round(0.3 * SR16);
  const hear = async (s: number, e: number): Promise<Chunk[]> => {
    const a = Math.max(0, s - pad);
    const clip = voice16.slice(a, Math.min(voice16.length, e + pad));
    const secs = clip.length / SR16;
    const out = (await asr(clip, { language, task: 'transcribe', return_timestamps: 'word', max_new_tokens: Math.min(440, Math.ceil(secs * 9) + 8) } as Record<string, unknown>)) as { text: string; chunks?: Chunk[] };
    if (looped(out.text)) return [];
    return (out.chunks ?? []).map((c) => ({ text: c.text, timestamp: [c.timestamp[0] + a / SR16, c.timestamp[1] === null ? null : c.timestamp[1] + a / SR16] }));
  };
  for (const [s, e] of wins) {
    let chunks = await hear(s, e);
    if (chunks.length === 0) {
      // Heard as a loop: try each phrase of the window by itself.
      for (const [ps, pe] of ph) if (ps >= s && pe <= e) chunks = chunks.concat(await hear(ps, pe));
    }
    const text = chunks.map((c) => c.text).join('');
    if (!MADE_UP.test(text))
      for (const c of chunks) {
        const t = c.timestamp[0];
        const end = c.timestamp[1] ?? t + 0.3;
        if (c.text.trim() !== '') heard.push({ t: Math.round(t * 100) / 100, e: Math.round(Math.max(end, t + 0.05) * 100) / 100, text: c.text });
      }
    done += e - s;
    onProgress(done / total);
  }
  return heard;
}

/** The language Whisper hears in the loudest half minute of the voice. */
async function tellLanguage(asr: AutomaticSpeechRecognitionPipeline, voice16: Float32Array): Promise<string> {
  const win = 30 * SR16;
  let best = 0;
  let bestE = -1;
  for (let a = 0; a + SR16 <= voice16.length; a += 5 * SR16) {
    let e = 0;
    for (let i = a; i < Math.min(voice16.length, a + win); i += 4) e += voice16[i]! ** 2;
    if (e > bestE) {
      bestE = e;
      best = a;
    }
  }
  const clip = voice16.slice(best, Math.min(voice16.length, best + win));
  const proc = asr.processor as unknown as (x: Float32Array) => Promise<{ input_features: unknown }>;
  const model = asr.model as unknown as {
    generate: (o: Record<string, unknown>) => Promise<{ tolist: () => bigint[][] } | { sequences: { tolist: () => bigint[][] } }>;
    generation_config: { decoder_start_token_id: number; lang_to_id: Record<string, number> };
  };
  const { input_features } = await proc(clip);
  const cfg = model.generation_config;
  const out = await model.generate({ inputs: input_features, decoder_input_ids: [[cfg.decoder_start_token_id]], max_new_tokens: 1 });
  const seq = 'sequences' in out ? out.sequences.tolist() : out.tolist();
  const id = Number(seq[0]?.[1] ?? -1);
  const hit = Object.entries(cfg.lang_to_id).find(([, v]) => v === id);
  return hit !== undefined ? hit[0].replace(/[<|>]/g, '') : 'en';
}

async function wordListener(device: 'webgpu' | 'wasm', onBytes: (n: number) => void): Promise<AutomaticSpeechRecognitionPipeline> {
  const files = new Map<string, ArrayBuffer>();
  let base = 0;
  for (const [name, f] of Object.entries(WHISPER)) {
    files.set(name, await loadModel(f, (n) => onBytes(base + n)));
    base += f.size;
  }
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = false;
  env.useWasmCache = false;
  // Anything not handed over below is asked of the app's own server (which has no such file).
  env.remoteHost = `${self.location.origin}/api/models/hf/`;
  env.useCustomCache = true;
  env.customCache = {
    match: async (key: string | Request): Promise<Response | undefined> => {
      const url = typeof key === 'string' ? key : key.url;
      for (const [name, buf] of files) if (url.includes(WHISPER_MODEL) && url.endsWith('/' + name)) return new Response(buf, { headers: { 'content-length': String(buf.byteLength) } });
      return undefined;
    },
    put: async (): Promise<void> => undefined,
  } as unknown as typeof env.customCache;
  const asr = (await pipeline('automatic-speech-recognition', WHISPER_MODEL, { device, dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' } })) as AutomaticSpeechRecognitionPipeline;
  files.clear();
  // Word times for every language as the Chinese and Japanese ones are made: by the pieces of the
  // text (words in letters are put back together from their pieces in lyrics.ts).
  const tok = asr.tokenizer as unknown as { combineTokensIntoWords: (tokens: number[], language: string, ...rest: unknown[]) => unknown };
  const combine = tok.combineTokensIntoWords.bind(tok);
  tok.combineTokensIntoWords = (tokens: number[], _language: string, ...rest: unknown[]) => combine(tokens, 'japanese', ...rest);
  return asr;
}

/* ------------------------------------------------------------------- run */

async function run(req: StemsRequest): Promise<void> {
  const device: 'webgpu' | 'wasm' = (await gpu()) ? 'webgpu' : 'wasm';
  // Shares of the bar: the downloads count only when they happen.
  const prog = (a: number, b: number, stage: string) => (p: number) => post({ type: 'progress', p: a + (b - a) * Math.max(0, Math.min(1, p)), stage });

  const getSep = prog(0, 0.1, 'Getting the voice separator (180 MB, the first time only)');
  const model = await loadModel(DEMUCS, (n) => getSep(n / DEMUCS.size));
  let session: ort.InferenceSession;
  let used = device;
  try {
    session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: [device], graphOptimizationLevel: 'all' });
  } catch {
    used = 'wasm';
    session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
  const sepProg = prog(0.1, 0.55, used === 'webgpu' ? 'Separating the voice from the music' : 'Separating the voice from the music (on the processor: this takes a while)');
  sepProg(0);
  const L = req.channels[0]!;
  const R = req.channels[1] ?? L;
  const stems = await separateDemucs([L, R], async (wave, spec) => {
    const out = await session.run({ input: new ort.Tensor('float32', wave, [1, 2, wave.length / 2]), x: new ort.Tensor('float32', spec, [1, 4, 2048, 336]) });
    return { time: out['add_67']!.data as Float32Array, spec: out['output']!.data as Float32Array };
  }, sepProg);
  await session.release();

  const voice = stems.vocals[0].map((v, i) => (v + stems.vocals[1][i]!) / 2);
  const ana = prog(0.55, 0.62, 'Following the voice');
  const result = analyse({ channels: [voice], rate: DEMUCS_RATE, mode: 'stems', stems: { bass: stems.bass, other: stems.other, drums: stems.drums } }, (p) => ana(p));

  let heard: Heard[] | null = null;
  let language: string | null = null;
  if (req.words) {
    const getAsr = prog(0.62, 0.72, 'Getting the word listener (300 MB, the first time only)');
    const total = Object.values(WHISPER).reduce((a, f) => a + f.size, 0);
    const asr = await wordListener(used, (n) => getAsr(n / total));
    const voice16 = resampleTo(voice, DEMUCS_RATE, SR16, 7000);
    language = req.language !== '' ? req.language : await tellLanguage(asr, voice16);
    heard = await hearWords(asr, voice16, language, prog(0.72, 0.95, 'Listening for the words'));
    await asr.dispose();
  }

  const keep = prog(0.95, 1, 'Keeping the voice and the music');
  keep(0);
  const v = await encodeStem(stems.vocals, DEMUCS_RATE);
  keep(0.5);
  const m = await encodeStem(stems.music, DEMUCS_RATE);
  keep(1);
  post({ type: 'done', out: { result, heard, language, voice: v, music: m, device: used } });
}

self.onmessage = (ev: MessageEvent<StemsRequest>): void => {
  run(ev.data).catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
