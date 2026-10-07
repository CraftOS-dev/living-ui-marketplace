/**
 * Sends a recording's live pieces to the app, one at a time and in order,
 * retrying a failed upload a few times. drain() waits for everything queued,
 * so Stop tells the note to finish only once every piece is on the server.
 */
import { getPbClient } from '../../kit/index.ts';
import type { Piece } from './liveCapture.ts';

export class LiveUploader {
  private chain: Promise<void> = Promise.resolve();
  private sent = 0;

  constructor(readonly noteId: string) {}

  push(piece: Piece): void {
    this.chain = this.chain.then(() => this.send(piece));
  }

  async drain(): Promise<number> {
    await this.chain;
    return this.sent;
  }

  private async send(piece: Piece): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const fd = new FormData();
        fd.append('note', this.noteId);
        fd.append('seq', String(piece.seq));
        fd.append('offset', String(piece.offset));
        fd.append('audio', piece.wav, `piece-${piece.seq}.wav`);
        await getPbClient().call((pb) => pb.collection('live_chunks').create(fd), { silent: true });
        this.sent++;
        return;
      } catch (err) {
        if (attempt === 3) {
          console.warn(`Live transcript: piece ${piece.seq} could not be sent (the audio file still has it):`, err);
          return;
        }
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
}
