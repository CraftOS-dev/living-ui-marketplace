/**
 * Work handed to the sell screen from another page: open a ticket there,
 * start a return from a receipt, or start a sale for a customer. The sell
 * screen takes it once when it mounts.
 */
export type SellIntent = { kind: 'open'; order: string } | { kind: 'return'; from: string } | { kind: 'customer'; customer: string };

let pending: SellIntent | null = null;

export function handToSell(intent: SellIntent): void {
  pending = intent;
  window.location.hash = '/';
}

export function takeSellIntent(): SellIntent | null {
  const x = pending;
  pending = null;
  return x;
}
