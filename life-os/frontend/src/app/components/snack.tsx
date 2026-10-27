/**
 * A small bar at the bottom after something is done ("Ticked off Buy
 * flowers"), with Undo when the step can be taken back. Undo reverses the
 * person's newest undoable write (activity.last), the same thing Ctrl Z does.
 */
import { useEffect, useState } from 'react';
import { CornerUpLeft, X } from 'lucide-react';
import { op } from '../lib/api.ts';
import { ALL, changed, idle } from '../lib/live.ts';
import type { ActivityEntry } from '../lib/types.ts';

interface Snack {
  id: number;
  text: string;
  undo: boolean;
}

let next = 1;
let current: Snack | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(s: Snack | null) => void>();

function emit(): void {
  for (const l of listeners) l(current);
}

export function snack(text: string, opts: { undo?: boolean | undefined } = {}): void {
  current = { id: next++, text, undo: opts.undo !== false };
  emit();
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    emit();
  }, 6000);
}

export async function undoLast(): Promise<void> {
  // What was just done may still be on its way to the server: undo that, not the step before.
  await idle();
  const r = await op<{ entry: ActivityEntry | null }>('activity.last');
  if (r.entry === null) return;
  await op('activity.undo', { entry: r.entry.id });
  changed(...ALL);
}

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return t !== null && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}

export function Snackbar(): React.JSX.Element | null {
  const [s, setS] = useState<Snack | null>(current);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing(e)) {
        e.preventDefault();
        void undoLast().then(() => snack('Undone', { undo: false }));
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  if (s === null) return null;
  const close = (): void => {
    current = null;
    emit();
  };
  return (
    <div key={s.id} role="status" className="lo-in fixed bottom-20 left-1/2 z-[70] flex max-w-[92vw] -translate-x-1/2 items-center gap-1 rounded-[var(--lo-r)] bg-[var(--lo-grove)] py-1.5 pl-4 pr-1.5 text-[14px] font-semibold text-[var(--lo-on-grove)] shadow-[var(--lo-shadow-lg)] md:bottom-6">
      <span className="min-w-0 truncate pr-2">{s.text}</span>
      {s.undo && (
        <button
          type="button"
          onClick={() => {
            close();
            void undoLast();
          }}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--lo-r-sm)] px-3 text-[13px] font-extrabold text-[var(--lo-grove-accent)] hover:bg-[var(--lo-grove-2)]"
        >
          <CornerUpLeft size={14} /> Undo
        </button>
      )}
      <button type="button" aria-label="Close" onClick={close} className="flex size-8 shrink-0 items-center justify-center rounded-[var(--lo-r-sm)] text-[var(--lo-on-grove-muted)] hover:bg-[var(--lo-grove-2)]">
        <X size={14} />
      </button>
    </div>
  );
}
