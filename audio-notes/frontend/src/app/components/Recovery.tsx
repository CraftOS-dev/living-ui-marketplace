import { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { Button } from '../../kit/index.ts';
import { clock } from '../format.ts';
import { deleteTake, listTakes, loadTake, type StoredTake, type Take } from '../recorder/takes.ts';

/**
 * Recordings whose page died before they were saved (closed tab, CraftBot
 * restart, crash) are still in this browser; offer to save each as a note.
 * `skip` is the take being recorded right now, which is not lost.
 */
export function Recovery({
  skip,
  onSave,
}: {
  skip: string | null;
  onSave: (blob: Blob, take: Take) => Promise<void>;
}): React.JSX.Element | null {
  const [takes, setTakes] = useState<StoredTake[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void listTakes().then((all) => {
      const usable = all.filter((t) => t.bytes > 0);
      for (const t of all) if (t.bytes === 0) void deleteTake(t.take.id);
      setTakes(usable);
    });
  }, []);

  const shown = takes.filter((t) => t.take.id !== skip);
  if (shown.length === 0) return null;

  return (
    <div className="mx-auto mt-4 flex w-full max-w-4xl flex-col gap-2 px-4 md:px-8">
      {shown.map(({ take }) => (
        <div key={take.id} role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <LifeBuoy size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">Unsaved recording</span> from{' '}
            {new Date(take.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {take.elapsedMs > 0 && <> ({clock(take.elapsedMs / 1000)})</>} was recovered.
          </p>
          <Button
            size="sm"
            loading={busy === take.id}
            onClick={() => {
              setBusy(take.id);
              void loadTake(take.id)
                .then(async (blob) => {
                  if (blob !== null) await onSave(blob, take);
                  setTakes((all) => all.filter((t) => t.take.id !== take.id));
                })
                .catch(() => undefined)
                .finally(() => setBusy(null));
            }}
          >
            Save as note
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void deleteTake(take.id);
              setTakes((all) => all.filter((t) => t.take.id !== take.id));
            }}
          >
            Discard
          </Button>
        </div>
      ))}
    </div>
  );
}
