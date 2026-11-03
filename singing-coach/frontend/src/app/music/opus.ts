/**
 * The separated voice and music, kept small: Opus (WebCodecs AudioEncoder,
 * 128 kb/s stereo) in an Ogg file (RFC 7845: an OpusHead page, an OpusTags
 * page, then the packets, the granule position counting 48 kHz samples
 * after the pre-skip). Where the browser has no Opus encoder, a 16-bit WAV.
 */

const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
  CRC[i] = r >>> 0;
}

function crc32(b: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ b[i]!) & 0xff]!) >>> 0;
  return c >>> 0;
}

class OggWriter {
  private pages: Uint8Array[] = [];
  private seq = 0;
  private readonly serial = (Math.random() * 0xffffffff) >>> 0;

  /** One page holding whole packets (each under 255 × 255 bytes). */
  page(packets: Uint8Array[], granule: number, flags: number): void {
    const lacing: number[] = [];
    for (const p of packets) {
      let n = p.length;
      while (n >= 255) {
        lacing.push(255);
        n -= 255;
      }
      lacing.push(n);
    }
    const bodyLen = packets.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(27 + lacing.length + bodyLen);
    const v = new DataView(out.buffer);
    out.set([0x4f, 0x67, 0x67, 0x53], 0);
    out[4] = 0;
    out[5] = flags;
    v.setUint32(6, granule % 0x100000000, true);
    v.setUint32(10, Math.floor(granule / 0x100000000), true);
    v.setUint32(14, this.serial, true);
    v.setUint32(18, this.seq++, true);
    out[26] = lacing.length;
    out.set(lacing, 27);
    let o = 27 + lacing.length;
    for (const p of packets) {
      out.set(p, o);
      o += p.length;
    }
    v.setUint32(22, crc32(out), true);
    this.pages.push(out);
  }

  blob(): Blob {
    return new Blob(this.pages as BlobPart[], { type: 'audio/ogg' });
  }
}

function opusHead(channels: number, preSkip: number, rate: number): Uint8Array {
  const b = new Uint8Array(19);
  const v = new DataView(b.buffer);
  b.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);
  b[8] = 1;
  b[9] = channels;
  v.setUint16(10, preSkip, true);
  v.setUint32(12, rate, true);
  v.setInt16(16, 0, true);
  b[18] = 0;
  return b;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode('Singing Coach');
  const b = new Uint8Array(8 + 4 + vendor.length + 4);
  const v = new DataView(b.buffer);
  b.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0);
  v.setUint32(8, vendor.length, true);
  b.set(vendor, 12);
  v.setUint32(12 + vendor.length, 0, true);
  return b;
}

/** The pre-skip from an OpusHead the encoder describes itself with, if any. */
function preSkipOf(desc: AllowSharedBufferSource | undefined): number | null {
  if (desc === undefined) return null;
  const b = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc);
  if (b.length < 19 || String.fromCharCode(...b.subarray(0, 8)) !== 'OpusHead') return null;
  return b[10]! | (b[11]! << 8);
}

const OPUS_CONFIG = (rate: number, channels: number): AudioEncoderConfig => ({ codec: 'opus', sampleRate: rate, numberOfChannels: channels, bitrate: 128000 });

/** Whether this browser can write Opus at this rate. */
export async function canOpus(rate: number, channels: number): Promise<boolean> {
  try {
    if (typeof AudioEncoder === 'undefined') return false;
    const s = await AudioEncoder.isConfigSupported(OPUS_CONFIG(rate, channels));
    return s.supported === true;
  } catch {
    return false;
  }
}

async function encodeOpus(ch: Float32Array[], rate: number): Promise<Blob> {
  const channels = ch.length;
  const packets: { data: Uint8Array; dur: number }[] = [];
  let preSkip: number | null = null;
  let failure: Error | null = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      // Samples at 48 kHz (Opus's own clock).
      packets.push({ data, dur: Math.round(((chunk.duration ?? 20000) * 48000) / 1e6) });
      if (preSkip === null) preSkip = preSkipOf(meta?.decoderConfig?.description);
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  enc.configure(OPUS_CONFIG(rate, channels));
  const len = ch[0]!.length;
  const block = 4800;
  for (let o = 0; o < len; o += block) {
    const n = Math.min(block, len - o);
    const planar = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) planar.set(ch[c]!.subarray(o, o + n), c * n);
    const data = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((o / rate) * 1e6), data: planar });
    enc.encode(data);
    data.close();
    // Let the encoder catch up now and then.
    if (enc.encodeQueueSize > 64) await new Promise((r) => setTimeout(r, 0));
    if (failure !== null) throw failure;
  }
  await enc.flush();
  enc.close();
  if (failure !== null) throw failure;
  // libopus looks 6.5 ms ahead (312 samples at 48 kHz) unless the encoder says otherwise.
  const skip: number = preSkip ?? 312;
  const ogg = new OggWriter();
  ogg.page([opusHead(channels, skip, rate)], 0, 0x02);
  ogg.page([opusTags()], 0, 0);
  const total = Math.round((len * 48000) / rate);
  let granule = 0;
  for (let i = 0; i < packets.length; ) {
    const group: Uint8Array[] = [];
    let lace = 0;
    while (i < packets.length && group.length < 50) {
      const p = packets[i]!;
      const l = Math.floor(p.data.length / 255) + 1;
      if (lace + l > 255) break;
      group.push(p.data);
      lace += l;
      granule += p.dur;
      i++;
    }
    const last = i >= packets.length;
    // The last page's granule ends the stream at the true length.
    ogg.page(group, last ? skip + total : Math.min(granule, skip + total), last ? 0x04 : 0);
  }
  return ogg.blob();
}

/** 16-bit PCM WAV. */
export function encodeWav(ch: Float32Array[], rate: number): Blob {
  const channels = ch.length;
  const len = ch[0]!.length;
  const buf = new ArrayBuffer(44 + len * channels * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + len * channels * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, len * channels * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++)
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, ch[c]![i]!));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  return new Blob([buf], { type: 'audio/wav' });
}

/** A stem as a small file: Ogg Opus where the browser can write it, else WAV. */
export async function encodeStem(ch: Float32Array[], rate: number): Promise<{ blob: Blob; ext: 'ogg' | 'wav' }> {
  if (await canOpus(rate, ch.length)) {
    try {
      return { blob: await encodeOpus(ch, rate), ext: 'ogg' };
    } catch {
      /* fall through to WAV */
    }
  }
  return { blob: encodeWav(ch, rate), ext: 'wav' };
}
