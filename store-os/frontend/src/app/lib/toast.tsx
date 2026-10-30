/**
 * Small notices at the bottom of the page: what happened, and why something
 * was refused. One at a time per text; they leave on their own.
 */
import { useEffect, useState } from 'react';

interface Note {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

let seq = 0;
let notes: Note[] = [];
const subs = new Set<(n: Note[]) => void>();

function emit(): void {
  for (const s of subs) s(notes);
}

function push(text: string, kind: Note['kind']): void {
  if (notes.some((n) => n.text === text)) return;
  const note = { id: ++seq, text, kind };
  notes = [...notes, note].slice(-3);
  emit();
  setTimeout(
    () => {
      notes = notes.filter((n) => n.id !== note.id);
      emit();
    },
    kind === 'error' ? 6000 : 3200,
  );
}

export const notify = {
  info: (text: string): void => push(text, 'info'),
  error: (text: string): void => push(text, 'error'),
};

export function Notices(): React.JSX.Element {
  const [list, setList] = useState<Note[]>(notes);
  useEffect(() => {
    subs.add(setList);
    return () => {
      subs.delete(setList);
    };
  }, []);
  return (
    <div className="so-portal fixed bottom-6 left-1/2 z-[80] grid w-max max-w-[calc(100vw-32px)] -translate-x-1/2 gap-2" role="status" aria-live="polite">
      {list.map((n) => (
        <div key={n.id} className={'so-toast rounded-full px-5 py-3 text-[13px] font-semibold shadow-[0_18px_40px_-18px_var(--so-shadow)] ' + (n.kind === 'error' ? 'bg-[var(--so-red)] text-white' : 'bg-[var(--so-ink)] text-[var(--so-card)]')}>
          {n.text}
        </div>
      ))}
    </div>
  );
}
