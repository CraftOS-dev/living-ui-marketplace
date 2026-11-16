/**
 * Small notices at the foot of the page: what happened, why something was
 * refused, and the next step ("Hired. Add their bank account"). One per text;
 * they leave on their own. The <Toasts/> host in components/ui.tsx draws them.
 *
 *   toast.success('Saved');
 *   toast.info('Sent to your AI agent', { label: 'Open', run: () => navigate('/inbox') });
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
  if (text === '' || notes.some((n) => n.text === text)) return;
  const note: Note = { id: ++seq, text, kind, action };
  notes = [...notes, note].slice(-3);
  emit();
  setTimeout(
    () => {
      notes = notes.filter((n) => n.id !== note.id);
      emit();
    },
    kind === 'error' ? 6500 : action !== undefined ? 6000 : 3200,
  );
}

export const toast = {
  info: (text: string, action?: ToastAction): void => push(text, 'info', action),
  success: (text: string, action?: ToastAction): void => push(text, 'success', action),
  error: (text: string): void => push(text, 'error'),
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
