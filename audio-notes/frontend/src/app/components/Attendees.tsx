import { useEffect, useRef, useState } from 'react';
import { AudioLines, Loader2, Plus, Users, X } from 'lucide-react';
import { IdentityChip, toast } from '../../kit/index.ts';
import { NameInput } from './fields.tsx';
import { SelectField } from './ui.tsx';

const COUNTS = [
  { value: '0', label: 'Auto count' },
  ...Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? '1 speaker' : `${i + 1} speakers` })),
];

/**
 * People present. The app tells the speakers apart by their voices after a
 * recording is transcribed (or on Detect speakers) and lists them as
 * Person 1, Person 2, ...; no names are guessed. When the number is off,
 * setting how many people speak runs the detection again with that number.
 * The list stays the user's: clicking a name renames that person everywhere
 * (their transcript lines too), removing someone keeps them off, and people
 * detected but not on the list are offered as suggestions.
 */
export function Attendees({
  names,
  found,
  status,
  error,
  speakerCount,
  canDetect,
  onSave,
  onRename,
  onDetect,
}: {
  names: string[];
  /** The people the last detection heard. */
  found: string[];
  status: '' | 'queued' | 'processing' | 'done' | 'failed';
  error: string;
  /** How many people speak (0 = detect the number). */
  speakerCount: number;
  /** The note has a finished recording to listen to. */
  canDetect: boolean;
  onSave: (next: string[]) => void;
  /** Rename someone everywhere in the note. */
  onRename: (from: string, to: string) => void;
  onDetect: (speakers?: number) => void;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const asked = useRef(false);
  const detecting = status === 'queued' || status === 'processing';

  const listed = names.map((n) => n.toLowerCase());
  const suggestions = found.filter((n) => listed.indexOf(n.toLowerCase()) === -1);

  // Report the result of a detection the user asked for.
  useEffect(() => {
    if (detecting || !asked.current) return;
    asked.current = false;
    if (status === 'failed') toast.error(error || 'Telling the speakers apart failed.');
    else toast.info(found.length > 0 ? `Detected ${found.length} ${found.length === 1 ? 'speaker' : 'speakers'}` : 'No speech found to tell speakers apart');
  }, [detecting, status, error, found.length]);

  const detect = (speakers?: number): void => {
    asked.current = true;
    onDetect(speakers);
  };

  const add = (): void => {
    const name = draft.trim();
    if (name !== '' && listed.indexOf(name.toLowerCase()) === -1) onSave([...names, name]);
    setDraft('');
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Users size={15} className="text-[var(--agent-app-muted)]" aria-label="Attendees" />
        {names.map((n) => (
          <span key={n} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] pl-1 pr-1 text-[13px]">
            <IdentityChip name={n} size="sm" />
            {renaming === n ? (
              <NameInput
                value={n}
                ariaLabel={`Rename ${n}`}
                onDone={(next) => {
                  setRenaming(null);
                  if (next !== null) onRename(n, next);
                }}
                className="h-5 rounded-full px-1.5 text-[13px]"
              />
            ) : (
              <button
                type="button"
                onClick={() => setRenaming(n)}
                title={`Rename ${n}`}
                className="rounded-full px-1 transition-colors hover:bg-[var(--agent-app-hover)]"
              >
                {n}
              </button>
            )}
            <button
              type="button"
              aria-label={`Remove ${n}`}
              title={`Remove ${n}`}
              onClick={() => onSave(names.filter((x) => x !== n))}
              className="inline-flex size-5 items-center justify-center rounded-full text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-red-600"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <span className="inline-flex flex-wrap items-center gap-1">
        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
              if (e.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
            placeholder="Name"
            className="h-7 w-40 rounded-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-3 text-[13px] outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]"
          >
            <Plus size={13} />
            {names.length === 0 ? 'Add people' : 'Add'}
          </button>
        )}
        {canDetect && (
          <button
            type="button"
            disabled={detecting}
            onClick={() => detect()}
            title="Tell the speakers apart by their voices and list them as Person 1, Person 2, ..."
            className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)] disabled:opacity-70"
          >
            {detecting ? <Loader2 size={13} className="animate-spin" /> : <AudioLines size={13} />}
            {detecting ? 'Detecting speakers...' : 'Detect speakers'}
          </button>
        )}
        {canDetect && !detecting && (
          <SelectField
            variant="chip"
            ariaLabel="How many people speak"
            value={String(speakerCount)}
            onChange={(v) => detect(Number(v))}
            options={COUNTS}
          />
        )}
        {names.length > 0 && (
          <button
            type="button"
            onClick={() => onSave([])}
            title="Remove everyone from the list"
            className="inline-flex h-7 items-center rounded-full px-2.5 text-[13px] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-red-600"
          >
            Clear all
          </button>
        )}
        </span>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pl-[23px]">
          <span className="text-[13px] text-[var(--agent-app-muted)]">Also heard:</span>
          {suggestions.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onSave([...names, n])}
              title={`Add ${n}`}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[var(--agent-app-border)] px-2.5 text-[13px] text-[var(--agent-app-muted)] transition-colors hover:border-[var(--agent-app-accent)] hover:text-[var(--agent-app-text)]"
            >
              <Plus size={12} />
              {n}
            </button>
          ))}
          {suggestions.length > 1 && (
            <button
              type="button"
              onClick={() => onSave([...names, ...suggestions])}
              className="inline-flex h-7 items-center rounded-full px-2.5 text-[13px] font-medium text-[var(--agent-app-accent)] transition-colors hover:bg-[var(--agent-app-hover)]"
            >
              Add all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
