/**
 * News as a readable list (fix 3): the headline (opens the article in a new
 * tab), what it is about as one chip (the company opens its page), the
 * publisher and when, and your AI agent's one sentence when it wrote one.
 * NewsList draws rows it is given (Home, a company page); NewsFeed loads a
 * scope itself (Markets) with its empty state and Check now.
 */
import { Newspaper, RefreshCw, Sparkle, X } from 'lucide-react';
import { useState } from 'react';
import { Button, Empty, IconButton, LoadError, Skeleton, Tag } from '../ui.tsx';
import { can, useMe } from '../../lib/auth.ts';
import { fmtDay } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { cn } from '../../../kit/index.ts';
import type { NewsAnswer, NewsRow, NewsScope } from './news.ts';
import { hideNews, NEWS_READS, newsParams, refreshNews } from './news.ts';
import { agoWords } from './types.ts';

/** What an item is about, as a chip: a company opens its page; a sector or thesis is a plain chip. */
function AboutChip({ about }: { about: NewsRow['about'] }): React.JSX.Element | null {
  if (about.name === '') return null;
  if (about.kind === 'company' && about.id !== '')
    return (
      <a href={`#/companies/${about.id}`} title={`Open ${about.name}`} className="vo-focus group inline-flex min-w-0 max-w-[200px] shrink-0 rounded-[4px]">
        <Tag className="min-w-0 max-w-full transition-colors duration-150 group-hover:border-[var(--vo-line-2)] group-hover:bg-[var(--vo-active)] group-hover:text-[var(--vo-ink)]">
          <span className="truncate">{about.name}</span>
        </Tag>
      </a>
    );
  return (
    <Tag tone="faint" title={about.kind === 'sector' ? 'Sector of one of your theses' : 'Thesis'} className="min-w-0 max-w-[200px]">
      <span className="truncate">{about.name}</span>
    </Tag>
  );
}

export function NewsList({ items, compact, onHide }: { items: NewsRow[]; compact?: boolean | undefined; onHide?: ((id: string) => void) | undefined }): React.JSX.Element {
  return (
    <ul aria-label="News" className="flex min-w-0 flex-col">
      {items.map((n) => (
        <li key={n.id} className={cn('group/news relative flex min-w-0 gap-2 border-b border-[var(--vo-hair)] last:border-b-0', compact === true ? 'py-2' : 'py-2.5')}>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <a href={n.url} target="_blank" rel="noreferrer" title="Open the article in a new tab" className="vo-focus vo-wrap min-w-0 self-start rounded-[3px] text-[13px] font-medium leading-[18px] text-[var(--vo-ink)] hover:underline hover:decoration-[var(--vo-line-2)] hover:underline-offset-[3px]">
              {n.title}
            </a>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--vo-muted)]">
              <AboutChip about={n.about} />
              {n.source !== '' && <span className="min-w-0 truncate">{n.source}</span>}
              <span title={fmtDay(n.published_at, { year: 'auto' })} className="shrink-0">
                {agoWords(n.published_at)}
              </span>
            </div>
            {n.summary !== '' && (
              <p className={cn('vo-wrap flex min-w-0 gap-1.5 text-[12px] leading-[17px] text-[var(--vo-ink-2)]', compact === true && 'line-clamp-2')}>
                <Sparkle size={11} aria-label="Your AI agent's summary" className="mt-[3px] shrink-0 text-[var(--vo-muted)]" />
                <span className="min-w-0">{n.summary}</span>
              </p>
            )}
          </div>
          {onHide !== undefined && (
            <IconButton icon={X} label="Hide from the news" size={26} onClick={() => onHide(n.id)} className="hidden shrink-0 self-start opacity-0 focus-visible:opacity-100 group-hover/news:opacity-100 md:inline-flex" />
          )}
        </li>
      ))}
    </ul>
  );
}

/** A refresh button: Check now (the news also refreshes every 2 hours). */
export function NewsRefresh({ checkedAt }: { checkedAt?: string | undefined }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const title = checkedAt !== undefined && checkedAt !== '' ? `Checked ${agoWords(checkedAt)}; it checks every 2 hours` : 'It checks every 2 hours';
  return (
    <IconButton
      icon={RefreshCw}
      label={`Check the news now. ${title}`}
      disabled={busy}
      size={28}
      onClick={() => {
        setBusy(true);
        void refreshNews().finally(() => setBusy(false));
      }}
    />
  );
}

/** A scope's news, loaded here: the list, its empty state, more on demand. */
export function NewsFeed({ scope, refId = '', limit = 8, empty, compact }: { scope: NewsScope; refId?: string | undefined; limit?: number | undefined; empty: string; compact?: boolean | undefined }): React.JSX.Element {
  const me = useMe();
  const [n, setN] = useState(limit);
  const live = useOp<NewsAnswer>('news.list', newsParams(scope, refId, n), NEWS_READS, { name: `markets.news.${scope}`, keep: true });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" />;
  const d = live.data;
  if (d.items.length === 0)
    return (
      <Empty
        icon={Newspaper}
        title={empty}
        action={
          <Button
            icon={RefreshCw}
            onClick={() => {
              void refreshNews();
            }}
          >
            Check now
          </Button>
        }
      />
    );
  return (
    <div className="flex min-w-0 flex-col">
      <NewsList items={d.items} compact={compact} onHide={can(me, 'markets', 'edit') ? (id) => void hideNews(id) : undefined} />
      {d.total > d.items.length && n < 50 && (
        <button
          type="button"
          onClick={() => setN((x) => Math.min(50, x + 12))}
          className="vo-focus vo-tap mt-1 inline-flex h-8 cursor-pointer items-center self-start rounded-[var(--vo-radius-sm)] px-2 text-[12px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]"
        >
          {`Show ${Math.min(12, d.total - d.items.length)} more`}
        </button>
      )}
    </div>
  );
}
