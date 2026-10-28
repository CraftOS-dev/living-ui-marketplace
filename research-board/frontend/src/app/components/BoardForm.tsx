/** Create a board, or change a board's name, description and color. */
import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { BOARD_COLORS, boardColor } from '../lib/kinds.ts';
import type { Board, BoardColor } from '../lib/types.ts';
import { AutoTextarea, Field, Modal, PillButton, softArea, softInput } from './ui.tsx';

const COLOR_LABEL: Record<BoardColor, string> = { ink: 'Ink', accent: 'Accent', amber: 'Amber', green: 'Green', blue: 'Blue', violet: 'Violet', red: 'Red', teal: 'Teal' };

export function BoardColors({ value, onChange }: { value: BoardColor; onChange: (c: BoardColor) => void }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="Board color" className="flex flex-wrap gap-2">
      {BOARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_LABEL[c]}
          title={COLOR_LABEL[c]}
          onClick={() => onChange(c)}
          className={cn('flex size-8 items-center justify-center rounded-[7px] transition-transform hover:scale-110', value === c && 'ring-2 ring-[var(--rb-ink)] ring-offset-2 ring-offset-[var(--rb-shell)]')}
          style={{ background: boardColor(c) }}
        >
          {value === c && <Check size={14} strokeWidth={3} className="text-[var(--rb-card)]" />}
        </button>
      ))}
    </div>
  );
}

export function BoardForm({ board, onClose, onSaved }: { board?: Board | undefined; onClose: () => void; onSaved?: ((id: string) => void) | undefined }): React.JSX.Element {
  const [name, setName] = useState(board?.name ?? '');
  const [description, setDescription] = useState(board?.description ?? '');
  const [color, setColor] = useState<BoardColor>(board?.color ?? 'ink');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    if (name.trim() === '') {
      setError('Give the board a name');
      return;
    }
    setBusy(true);
    try {
      const r = board === undefined ? await api.createBoard({ name: name.trim(), description, color }) : await api.updateBoard(board.id, { name: name.trim(), description, color });
      toast.success(board === undefined ? 'Board created' : 'Board saved');
      onSaved?.(r.board.id);
      onClose();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={board === undefined ? 'New board' : 'Board details'}
      description={board === undefined ? 'A board holds the notes, sources and links of one question or project.' : undefined}
      footer={
        <>
          <PillButton variant="light" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton variant="dark" loading={busy} onClick={() => void save()}>
            {board === undefined ? 'Create board' : 'Save'}
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && void save()}>
        <Field label="Name" error={error}>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            placeholder="e.g. Urban heat islands"
            maxLength={120}
            className={softInput}
          />
        </Field>
        <Field label="Description" hint="Optional. Your AI agent reads it when it reviews the board.">
          <AutoTextarea value={description} onChange={setDescription} minRows={2} placeholder="The question this board answers" className={softArea} />
        </Field>
      </div>
    </Modal>
  );
}
