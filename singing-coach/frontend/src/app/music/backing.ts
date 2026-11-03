/**
 * A song's recording (and the voice and the music separated from it):
 * fetched and decoded once per page life, in an offline context (no sound,
 * no gesture needed); and where a position of the song sits in it.
 */
import type { BackingMap } from '../lib/types.ts';

const cache = new Map<string, Promise<AudioBuffer>>();

export function loadBacking(url: string): Promise<AudioBuffer> {
  let p = cache.get(url);
  if (p === undefined) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => new OfflineAudioContext(2, 1, 44100).decodeAudioData(data));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

/** Seconds into the recording where quarter note q of the song sounds (between the beats found). */
export function secondsAt(map: BackingMap, q: number): number {
  const beats = map.beats;
  const x = map.downbeat + (q - map.bar1_q) / (map.beat_q || 1);
  const n = beats.length;
  if (n < 2) return 0;
  const k = Math.floor(x);
  if (k < 0) return beats[0]! + x * (beats[1]! - beats[0]!);
  if (k >= n - 1) return beats[n - 1]! + (x - (n - 1)) * (beats[n - 1]! - beats[n - 2]!);
  return beats[k]! + (x - k) * (beats[k + 1]! - beats[k]!);
}

/** The inverse: the song's quarter note at a moment of the recording. */
export function quarterAt(map: BackingMap, s: number): number {
  const beats = map.beats;
  const n = beats.length;
  if (n < 2) return 0;
  let x: number;
  if (s <= beats[0]!) x = (s - beats[0]!) / (beats[1]! - beats[0]!);
  else if (s >= beats[n - 1]!) x = n - 1 + (s - beats[n - 1]!) / (beats[n - 1]! - beats[n - 2]!);
  else {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid]! <= s) lo = mid;
      else hi = mid;
    }
    x = lo + (s - beats[lo]!) / (beats[hi]! - beats[lo]!);
  }
  return (x - map.downbeat) * (map.beat_q || 1) + map.bar1_q;
}
