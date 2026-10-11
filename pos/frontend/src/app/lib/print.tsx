/**
 * Printing through the browser: what is printed renders into a print-only
 * area (theme.css .ps-print-only) with an @page size for the receipt paper,
 * then the browser's print runs. On a counter PC, Chrome started with
 * --kiosk-printing prints straight to the default (receipt) printer without
 * a dialog.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Job {
  node: ReactNode;
  /** Paper width in mm (receipts); null for a full page (reports). */
  widthMm: number | null;
  id: number;
}

let job: Job | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Print `node` on receipt paper of `widthMm` (58 or 80), or a full page when null. */
export function printNode(node: ReactNode, widthMm: number | null): void {
  job = { node, widthMm, id: nextId++ };
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const snapshot = (): Job | null => job;

/** Mount once at the root: renders the job and runs the print. */
export function PrintHost(): React.JSX.Element | null {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (current === null) return;
    const style = document.createElement('style');
    style.textContent = current.widthMm !== null ? `@page { size: ${current.widthMm}mm auto; margin: 0; }` : '@page { size: auto; margin: 12mm; }';
    document.head.appendChild(style);
    const done = (): void => {
      style.remove();
      if (job !== null && job.id === current.id) {
        job = null;
        emit();
      }
    };
    window.addEventListener('afterprint', done, { once: true });
    // Two frames: the portal is laid out (and images like the logo start) before printing.
    const t = window.setTimeout(() => {
      window.requestAnimationFrame(() => window.print());
    }, 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', done);
      style.remove();
    };
  }, [current]);
  if (current === null) return null;
  return createPortal(
    <div className="ps-print-only" style={current.widthMm !== null ? { width: `${current.widthMm}mm` } : undefined}>
      {current.node}
    </div>,
    document.body,
  );
}
