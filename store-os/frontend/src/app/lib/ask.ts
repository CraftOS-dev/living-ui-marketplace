/**
 * Requests to your AI agent from the screens. Every request op answers
 * { task, asked, already, message }: asked once, already asked for that
 * record (nothing fired), or not sent (the platform's cooldown or hourly
 * cap; the task shows a Retry).
 */
import { notify } from './toast.tsx';
import type { AskResult } from './types.ts';

/** Tell the seller how a request went. */
export function askNotice(r: Partial<AskResult> | null | undefined, asked = 'Asked your AI agent'): void {
  if (!r) return;
  if (r.asked === true) notify.info(asked);
  else if (r.already === true) notify.info(r.message || 'Your AI agent was already asked for this.');
  else notify.error(r.message || 'Your AI agent could not be asked. Retry shortly.');
}
