/**
 * A record's timeline from every module (records.timeline), newest first,
 * paged by scroll (never "Show more").
 */
import { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { Empty, LoadError, Skeleton, Spinner } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { iconOf, NET_READS } from './parts.tsx';
import type { TimelineItem } from './types.ts';

interface Page {
  items: TimelineItem[];
  hidden: number;
  next_before: string | null;
}

export function Timeline({ target }: { target: { company?: string | undefined; person?: string | undefined; deal?: string | undefined } }): React.JSX.Element {
  const [extra, setExtra] = useState<TimelineItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(target);
  const live = useLive<Page>((signal) => op<Page>('records.timeline', { ...target, limit: 40 }, { quiet: true, signal }), NET_READS.concat(['stage_events', 'files', 'notes']), [key], { name: 'net.timeline' });
  useEffect(() => {
    setExtra([]);
    setNext(live.data?.next_before ?? null);
  }, [live.data]);
  const sentinel = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (el === null || next === null) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || busy || next === null) return;
      setBusy(true);
      void op<Page>('records.timeline', { ...target, limit: 40, before: next }, { quiet: true })
        .then((p) => {
          setExtra((x) => x.concat(p.items));
          setNext(p.next_before);
        })
        .finally(() => setBusy(false));
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, busy, key]);
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-48 w-full" />;
  const items = live.data.items.concat(extra);
  if (items.length === 0) return <Empty icon={History} title="Nothing yet" />;
  return (
    <ol className="flex min-w-0 flex-col">
      {items.map((it, i) => {
        const Icon = iconOf(it.icon);
        const row = (
          <>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] border border-[var(--vo-line)] bg-[var(--vo-sunk)] text-[var(--vo-ink-2)]">
              <Icon size={12} strokeWidth={1.9} aria-hidden />
            </span>
            <span className="vo-wrap min-w-0 flex-1 text-[13px] text-[var(--vo-ink)]">{it.title}</span>
            <span className="vo-mono vo-num shrink-0 text-[12px] text-[var(--vo-muted)]">{ago(it.at)}</span>
          </>
        );
        return (
          <li key={it.kind + it.at + i} className="min-w-0">
            {it.href !== undefined && it.href !== '' ? (
              <a href={it.href} className="vo-focus vo-tap flex min-h-9 min-w-0 items-center gap-3 rounded-[var(--vo-radius-sm)] px-1.5 py-1 transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                {row}
              </a>
            ) : (
              <div className="flex min-h-9 min-w-0 items-center gap-3 px-1.5 py-1">{row}</div>
            )}
          </li>
        );
      })}
      <li ref={sentinel} aria-hidden className="flex h-6 items-center justify-center">
        {busy && <Spinner />}
      </li>
    </ol>
  );
}
