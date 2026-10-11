/**
 * The phone bar's sale button and the register page are apart in the tree:
 * the button asks for the sale to be shown, the register answers. A request
 * made from another page waits until the register is on screen.
 */
const listeners = new Set<() => void>();
let pending = false;

export const saleSheet = {
  /** Ask the register to show the sale (now, or as soon as it is on screen). */
  request(): void {
    pending = true;
    for (const fn of listeners) fn();
  },
  /** The register takes the request (true once per request). */
  take(): boolean {
    const was = pending;
    pending = false;
    return was;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
