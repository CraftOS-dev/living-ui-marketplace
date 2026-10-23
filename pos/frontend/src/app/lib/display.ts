/**
 * The customer display: a second window (on the second screen facing the
 * customer) that follows the register through a BroadcastChannel. Same
 * browser, same machine, no server round trip and no secure context
 * needed. The register posts what the customer should see; the display
 * page (pages/Display.tsx) only renders the last message.
 */

export interface DisplayLine {
  label: string;
  detail: string;
  qty: number;
  total: number;
}

export type DisplayMessage =
  | { type: 'idle'; business: string }
  | {
      type: 'cart';
      business: string;
      currency: string;
      exp: number;
      lines: DisplayLine[];
      subtotal: number;
      discount: number;
      service: number;
      tax: number;
      taxIncluded: boolean;
      total: number;
    }
  | { type: 'pay'; business: string; currency: string; exp: number; due: number; tender: string; qr: string }
  | { type: 'done'; business: string; currency: string; exp: number; total: number; change: number; number: string; orderNo: number }
  | { type: 'hello' };

function channelName(register: string): string {
  return `pos-display-${register}`;
}

let channel: BroadcastChannel | null = null;
let channelFor = '';
let last: DisplayMessage | null = null;

function open(register: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (channel !== null && channelFor === register) return channel;
  channel?.close();
  channel = new BroadcastChannel(channelName(register));
  channelFor = register;
  // A display that opens later asks for the current screen.
  channel.onmessage = (e: MessageEvent<DisplayMessage>) => {
    if (e.data.type === 'hello' && last !== null) channel?.postMessage(last);
  };
  return channel;
}

/** The register tells the display what to show. */
export function post(register: string, msg: DisplayMessage): void {
  last = msg;
  try {
    open(register)?.postMessage(msg);
  } catch {
    /* no display open: nothing to do */
  }
}

/** The display page listens; returns the stop function. */
export function listenDisplay(register: string, onMessage: (m: DisplayMessage) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const ch = new BroadcastChannel(channelName(register));
  ch.onmessage = (e: MessageEvent<DisplayMessage>) => {
    if (e.data.type !== 'hello') onMessage(e.data);
  };
  ch.postMessage({ type: 'hello' } satisfies DisplayMessage);
  return () => ch.close();
}
