import type { Message } from './types.ts';

/** Terminal request states must never fall back to waiting. */
export function messageStatus(m: Message, requestStatus?: string): string | null {
  if (m.role !== 'person' || m.state === 'answered') return null;
  if (requestStatus === 'rejected' || m.state === 'canceled') return 'canceled';
  if (requestStatus === 'done' || m.state === 'completed') return 'completed';
  if (m.state === 'failed') return 'not delivered';
  if (requestStatus === 'claimed') return 'working on it';
  return 'waiting';
}
