/**
 * Toasts are for undo ("Passed. Undo") and for errors. A result belongs on
 * the screen, never in a toast (SPEC 2, U4). The <Toasts/> host in
 * components/ui.tsx draws them.
 *
 *   toast.undo('Passed', () => op('intake.restore', { item }));
 *   toast.error('Could not save');
 */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Note {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
  action?: ToastAction | undefined;
}

let seq = 0;
let notes: Note[] = [];
const subs = new Set<(n: Note[]) => void>();

function emit(): void {
  for (const s of subs) s(notes);
}

function push(text: string, kind: Note['kind'], action?: ToastAction): void {
  if (text === '') return;
  notes = notes.filter((n) => n.text !== text);
  const note: Note = { id: ++seq, text, kind, action };
  notes = [...notes, note].slice(-3);
  emit();
  setTimeout(
    () => {
      notes = notes.filter((n) => n.id !== note.id);
      emit();
    },
    kind === 'error' ? 6500 : action !== undefined ? 6000 : 3000,
  );
}

export const toast = {
  info: (text: string, action?: ToastAction): void => push(text, 'info', action),
  success: (text: string, action?: ToastAction): void => push(text, 'success', action),
  error: (text: string): void => push(text, 'error'),
  /** "Passed. Undo": the word for what happened and the way back. */
  undo: (text: string, run: () => void): void => push(text, 'success', { label: 'Undo', run }),
  dismiss: (id: number): void => {
    notes = notes.filter((n) => n.id !== id);
    emit();
  },
};

export function subscribeToasts(fn: (n: Note[]) => void): () => void {
  subs.add(fn);
  fn(notes);
  return () => {
    subs.delete(fn);
  };
}
