/**
 * Listening to a recording off the main thread (analysis.ts does the work):
 * a voice memo, or a song with music when the voice is not separated first.
 */
import { analyse, type TranscribeRequest, type TranscribeResult } from './analysis.ts';

type Out = { type: 'progress'; p: number; stage: string } | { type: 'done'; result: TranscribeResult } | { type: 'error'; message: string };
const post = (m: Out): void => (self as unknown as { postMessage: (m: Out) => void }).postMessage(m);

self.onmessage = (ev: MessageEvent<TranscribeRequest>): void => {
  try {
    post({ type: 'done', result: analyse(ev.data, (p, stage) => post({ type: 'progress', p, stage })) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
