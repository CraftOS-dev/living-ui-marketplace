/**
 * What a form will post, shown live under it: the preview operation runs
 * (debounced) whenever the inputs change, and its plain summary, any
 * warning and the journal lines appear. A refusal (a locked month, a
 * control account) shows here before anyone presses the button.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, BookOpen } from 'lucide-react';
import { errMessage, op } from '../../lib/api.ts';
import type { OpName, Params } from '../../lib/api.ts';
import { JournalLines } from '../Books.tsx';
import type { PreviewResult } from '../Books.tsx';
import { Notice, Skeleton } from '../ui.tsx';

export function useLivePreview(previewOp: OpName, params: Params | null): { preview: PreviewResult | null; error: string | null; loading: boolean } {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = params === null ? '' : JSON.stringify(params);
  useEffect(() => {
    if (params === null) {
      setPreview(null);
      setError(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      op<PreviewResult>(previewOp, params, { quiet: true })
        .then((p) => {
          if (!live) return;
          setPreview(p);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!live) return;
          setPreview(null);
          setError(errMessage(e));
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOp, key]);
  return { preview, error, loading };
}

export function PreviewPane({ state, empty }: { state: { preview: PreviewResult | null; error: string | null; loading: boolean }; empty?: string | undefined }): React.JSX.Element {
  const { preview, error, loading } = state;
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--erp-ink-2)]">
        <BookOpen size={14} aria-hidden /> What this posts to the books
      </p>
      {error !== null ? (
        <Notice tone="bad" icon={AlertTriangle}>
          {error}
        </Notice>
      ) : preview === null ? (
        loading ? (
          <Skeleton className="h-24" />
        ) : (
          <p className="rounded-[18px] bg-[var(--erp-row)] px-4 py-3 text-[13px] text-[var(--erp-muted)]">{empty ?? 'Fill in the details to see it.'}</p>
        )
      ) : (
        <>
          {typeof preview.warning === 'string' && preview.warning !== '' && (
            <Notice tone="warn" icon={AlertTriangle}>
              {preview.warning}
            </Notice>
          )}
          <JournalLines lines={preview.lines ?? []} currency={preview.currency ?? ''} compact />
        </>
      )}
    </div>
  );
}
