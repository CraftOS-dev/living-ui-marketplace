/**
 * The one citation reader, shared by every module (lib/source.ts):
 * `SourceHost` is mounted once in the frame and shows the registered reader
 * (registry `reader`) over the current page when `openSource(ref)` is
 * called; `SourcePage` is the #/source route (a link, a new tab) showing the
 * same reader. A citation known only by its anchor is resolved first
 * (anchors.resolve: file, page, quote). Until a module registers a reader,
 * the file itself opens (files.download).
 */
import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { download, op } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { navigate, previousRoute } from '../../lib/router.ts';
import { closeSource, sourceFromQuery, useSource } from '../../lib/source.ts';
import type { SourceRef } from '../../lib/source.ts';
import { reader } from '../../registry.ts';
import { Empty, LoadError, PageBody, PageHeader, Spinner } from '../ui.tsx';

interface Resolved {
  ok: boolean;
  reason?: string | undefined;
  file?: string | undefined;
  page?: number | undefined;
  quote?: string | undefined;
}

/** Fill file, page and quote from the anchor when the citation names only the anchor. */
function useResolved(given: SourceRef | null): { source: SourceRef | null; error: string | null } {
  // Keyed by value: the route builds a new object on every render.
  const key = JSON.stringify(given);
  const ref = useMemo(() => JSON.parse(key) as SourceRef | null, [key]);
  const needs = ref !== null && ref.anchor !== undefined && ref.anchor !== '' && (ref.file === '' || ref.page === undefined);
  const [state, setState] = useState<{ source: SourceRef | null; error: string | null }>({ source: needs ? null : ref, error: null });
  useEffect(() => {
    if (ref === null || !needs) {
      setState({ source: ref, error: null });
      return;
    }
    let gone = false;
    setState({ source: null, error: null });
    op<{ anchors?: Resolved[] } & Resolved>('anchors.resolve', { anchor: ref.anchor }, { quiet: true })
      .then((r) => {
        if (gone) return;
        const a = r.anchors?.[0] ?? r;
        if (a.ok !== true || a.file === undefined) setState({ source: null, error: a.reason === 'not_visible' ? 'This source is not open to you.' : 'This source is gone.' });
        else setState({ source: { ...ref, file: a.file, page: ref.page ?? a.page, quote: ref.quote ?? a.quote }, error: null });
      })
      .catch((e: unknown) => !gone && setState({ source: null, error: (e as Error).message }));
    return () => {
      gone = true;
    };
  }, [ref, needs]);
  return state;
}

function Reader({ source, onClose }: { source: SourceRef; onClose: () => void }): React.JSX.Element | null {
  const Registered = reader();
  useEffect(() => {
    if (Registered !== null) return;
    void download('files.download', { file: source.file }, 'open', source.name ?? 'source').catch(() => undefined);
    onClose();
  }, [Registered, source, onClose]);
  if (Registered === null) return null;
  return <Registered source={source} onClose={onClose} />;
}

/** Mounted once in the frame: the reader over the current page. */
export function SourceHost(): React.JSX.Element | null {
  const ref = useSource();
  const { source } = useResolved(ref);
  if (ref === null || source === null) return null;
  return <Reader source={source} onClose={closeSource} />;
}

/** #/source?file=<id>&page=<n>&anchor=<id>&quote=<text>: the same reader as a page. */
export function SourcePage({ query }: PageProps): React.JSX.Element {
  const ref = sourceFromQuery(query);
  const [shown, setShown] = useState(true);
  const { source, error } = useResolved(ref);
  const leave = (): void => {
    setShown(false);
    const prev = previousRoute();
    if (prev !== null && prev.path !== '/source') navigate(prev.path, Object.fromEntries(prev.query));
  };
  return (
    <>
      <PageHeader title={source?.name ?? 'Source'} />
      <PageBody>
        {ref === null ? (
          <Empty icon={FileText} title="No source" />
        ) : error !== null ? (
          <LoadError message={error} />
        ) : source === null ? (
          <div className="flex h-40 items-center justify-center text-[var(--vo-muted)]">
            <Spinner />
          </div>
        ) : shown ? (
          <Reader source={source} onClose={leave} />
        ) : (
          <Empty icon={FileText} title="Source closed" />
        )}
      </PageBody>
    </>
  );
}
