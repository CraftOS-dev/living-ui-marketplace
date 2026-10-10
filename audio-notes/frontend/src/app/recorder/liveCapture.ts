/**
 * Live transcription capture. A second, 16 kHz AudioContext taps the exact
 * stream being recorded (the browser does the resampling), an AudioWorklet
 * hands the samples over in 100 ms blocks, and the Chunker cuts them into
 * pieces at natural pauses: never shorter than MIN_S, never longer than
 * MAX_S (then it cuts at the quietest moment of the last few seconds). Each
 * piece becomes a 16-bit mono WAV the local speech engine transcribes while
 * the recording continues. Pieces cut at pauses keep words whole.
 */

export const LIVE_RATE = 16000;
const BLOCK = LIVE_RATE / 10; // 100 ms
/** Short pieces cut at the first pause: each sentence shows up ~2 s after it ends. */
const MIN_S = 2.5;
const MAX_S = 8;
/** A pause: this many consecutive quiet blocks. */
const PAUSE_BLOCKS = 3;

const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${BLOCK}); this.n = 0; }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const frames = input[0].length;
      for (let i = 0; i < frames; i++) {
        let v = 0;
        for (let c = 0; c < input.length; c++) v += input[c][i];
        this.buf[this.n++] = v / input.length;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(${BLOCK});
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

export interface Piece {
  wav: Blob;
  seq: number;
  /** Start of the piece within the recording, in seconds (paused time excluded). */
  offset: number;
  seconds: number;
}

function rms(block: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < block.length; i++) {
    const v = block[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / block.length);
}

function encodeWav(blocks: Float32Array[]): Blob {
  const samples = blocks.reduce((n, b) => n + b.length, 0);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, LIVE_RATE, true);
  v.setUint32(28, LIVE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  let o = 44;
  for (const b of blocks) {
    for (let i = 0; i < b.length; i++) {
      const s = Math.max(-1, Math.min(1, b[i] ?? 0));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Cuts a stream of 100 ms blocks into pause-aligned pieces. */
export class Chunker {
  private blocks: Float32Array[] = [];
  private levels: number[] = [];
  private emittedBlocks = 0;
  private seq = 0;
  constructor(private readonly onPiece: (piece: Piece) => void) {}

  push(block: Float32Array): void {
    this.blocks.push(block);
    this.levels.push(rms(block));
    const n = this.blocks.length;
    if (n < MIN_S * 10) return;
    // Quiet = well below this piece's own speech level, so it adapts to the
    // microphone and the room instead of using one fixed threshold.
    const sorted = [...this.levels].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    const loud = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const quiet = floor + (loud - floor) * 0.15;
    const tail = this.levels.slice(-PAUSE_BLOCKS);
    if (tail.every((l) => l <= quiet)) {
      this.cut(n - 1);
      return;
    }
    if (n >= MAX_S * 10) {
      // No pause: cut at the quietest block of the last 3 seconds.
      let at = n - 30;
      for (let i = n - 30; i < n; i++) if ((this.levels[i] ?? 1) < (this.levels[at] ?? 1)) at = i;
      this.cut(at);
    }
  }

  /** Emit everything left (Stop). */
  flush(): void {
    if (this.blocks.length >= 3) this.cut(this.blocks.length - 1);
    this.blocks = [];
    this.levels = [];
  }

  /** Emit blocks [0..last] as one piece; keep the rest for the next one. */
  private cut(last: number): void {
    const taken = this.blocks.slice(0, last + 1);
    this.blocks = this.blocks.slice(last + 1);
    this.levels = this.levels.slice(last + 1);
    const piece: Piece = {
      wav: encodeWav(taken),
      seq: this.seq++,
      offset: (this.emittedBlocks * BLOCK) / LIVE_RATE,
      seconds: (taken.length * BLOCK) / LIVE_RATE,
    };
    this.emittedBlocks += taken.length;
    this.onPiece(piece);
  }
}

/**
 * Tap a stream at 16 kHz. `accept()` decides per block whether it counts
 * (false while paused, so piece offsets follow the recording's own clock).
 */
export async function tapStream(
  stream: MediaStream,
  chunker: Chunker,
  accept: () => boolean,
): Promise<() => void> {
  const ctx = new AudioContext({ sampleRate: LIVE_RATE });
  await ctx.resume().catch(() => undefined);
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(ctx, 'pcm-tap');
  node.port.onmessage = (e: MessageEvent<Float32Array>): void => {
    if (accept()) chunker.push(e.data);
  };
  ctx.createMediaStreamSource(stream).connect(node);
  // Keep the node pulled by the graph; the output itself is silent.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  return () => {
    node.port.onmessage = null;
    void ctx.close().catch(() => undefined);
  };
}
