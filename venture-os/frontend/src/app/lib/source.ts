/**
 * Citations open ONE reader, whoever cites (a memo block, a diligence
 * answer, a KPI value, a proposal's evidence):
 *
 *   openSource({ file, page: 4, anchor, quote });            // over the current page
 *   <Citation label="p.4" source={{ file, page: 4, anchor }} /> // the same, from a chip
 *   sourceHref(ref)                                          // '#/source?file=...' (a link, a new tab)
 *
 * The shell mounts the registered reader (registry `reader`, a module's page
 * view) and opens it here. With only an anchor, the shell resolves its file,
 * page and quote through anchors.resolve first.
 */
import { useSyncExternalStore } from 'react';
import { href } from './router.ts';

export interface SourceRef {
  /** The file record id (files collection). */
  file: string;
  /** 1-based page. */
  page?: number | undefined;
  /** The anchor id (lib_text anchors): the reader marks its exact passage. */
  anchor?: string | undefined;
  /** The quoted words (the tooltip; a reader may mark them). */
  quote?: string | undefined;
  /** The file's name, when known (the reader shows it before it loads). */
  name?: string | undefined;
}

let current: SourceRef | null = null;
const subs = new Set<() => void>();

function set(next: SourceRef | null): void {
  current = next;
  for (const fn of subs) fn();
}

/** Open the reader at a citation, over the current page. */
export function openSource(ref: SourceRef): void {
  set({ ...ref });
}

export function closeSource(): void {
  set(null);
}

export function useSource(): SourceRef | null {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => current,
  );
}

/** The shared reader route for a citation: '#/source?file=<id>&page=<n>&anchor=<id>&quote=<text>'. */
export function sourceHref(ref: SourceRef): string {
  return href('/source', { file: ref.file, page: ref.page, anchor: ref.anchor, quote: ref.quote !== undefined && ref.quote.length <= 300 ? ref.quote : undefined, name: ref.name });
}

/** A SourceRef from the #/source route's query. */
export function sourceFromQuery(q: URLSearchParams): SourceRef | null {
  const file = q.get('file') ?? '';
  const anchor = q.get('anchor') ?? '';
  if (file === '' && anchor === '') return null;
  const page = Number(q.get('page') ?? '');
  return { file, page: Number.isInteger(page) && page > 0 ? page : undefined, anchor: anchor !== '' ? anchor : undefined, quote: q.get('quote') ?? undefined, name: q.get('name') ?? undefined };
}
