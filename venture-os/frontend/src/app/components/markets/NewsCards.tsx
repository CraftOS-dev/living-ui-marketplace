/**
 * News stories as cards (fix 4): the lead story (picture beside the
 * headline), featured stories (picture above), grid cards (thumbnail) and
 * plain rows. A card without a picture stays a clean typographic card;
 * nothing is ever drawn in place of a picture. The whole card opens the
 * article in a new tab; Save and Hide sit in its corner.
 */
import { Bookmark, BookmarkCheck, EyeOff, Sparkle } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../kit/index.ts';
import { fmtDay } from '../../lib/format.ts';
import { IconButton } from '../ui.tsx';
import type { NewsRow } from './news.ts';
import { CATEGORY_LABEL, hideNews, saveNews } from './news.ts';
import { agoWords } from './types.ts';

export type StoryVariant = 'lead' | 'featured' | 'card' | 'row';

/** The publisher and when, one line. */
export function NewsMeta({ n, className, category = true }: { n: NewsRow; className?: string | undefined; category?: boolean | undefined }): React.JSX.Element {
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-4 text-[var(--vo-muted)]', className)}>
      {category && <span className="shrink-0 font-medium text-[var(--vo-ink-2)]">{CATEGORY_LABEL[n.category] ?? n.category_label}</span>}
      {category && n.source !== '' && <span aria-hidden>·</span>}
      {n.source !== '' && <span className="min-w-0 truncate">{n.source}</span>}
      <span aria-hidden>·</span>
      <span className="shrink-0" title={fmtDay(n.published_at, { year: 'auto' })}>
        {agoWords(n.published_at)}
      </span>
    </span>
  );
}

/** The picture of a story, or nothing; a broken one disappears instead of showing a broken image. */
function Picture({ src, className }: { src: string | null; className?: string | undefined }): React.JSX.Element | null {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) return null;
  return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className={cn('block w-full bg-[var(--vo-sunk)] object-cover', className)} />;
}

/** Save and Hide, in a story's corner (Hide only for people who edit Markets). */
export function StoryActions({ n, canHide, className }: { n: NewsRow; canHide: boolean; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cn('flex shrink-0 items-center gap-0.5', className)}>
      <IconButton icon={n.saved ? BookmarkCheck : Bookmark} label={n.saved ? 'Saved. Take it out of Saved' : 'Save for later'} size={28} active={n.saved} onClick={() => void saveNews(n.id, !n.saved)} />
      {canHide && <IconButton icon={EyeOff} label="Hide from the news" size={28} onClick={() => void hideNews(n.id)} />}
    </div>
  );
}

/** "In your AI agent's take": the story is cited by an insight. */
function TakeMark({ n }: { n: NewsRow }): React.JSX.Element | null {
  if (n.insight_ids.length === 0) return null;
  return <Sparkle size={12} strokeWidth={2} aria-label="Cited in your AI agent's take" className="shrink-0 text-[var(--vo-ink-2)]" />;
}

const LINK = 'vo-focus block min-w-0 cursor-pointer rounded-[var(--vo-radius)] text-left';

/** One story. */
export function StoryCard({ n, variant, canHide, category = true }: { n: NewsRow; variant: StoryVariant; canHide: boolean; category?: boolean | undefined }): React.JSX.Element {
  const lines = n.summary !== '' ? n.summary : n.snippet;
  if (variant === 'row')
    return (
      <div className="group/story flex min-w-0 items-start gap-3 py-2.5">
        <a href={n.url} target="_blank" rel="noreferrer" title="Open the article in a new tab" className={cn(LINK, 'flex min-w-0 flex-1 gap-3')}>
          {n.image_url !== null && <Picture src={n.image_url} className="aspect-[4/3] w-[72px] shrink-0 rounded-[6px]" />}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="vo-wrap line-clamp-2 text-[13px] font-medium leading-[18px] text-[var(--vo-ink)] group-hover/story:underline group-hover/story:decoration-[var(--vo-line-2)] group-hover/story:underline-offset-[3px]">{n.title}</span>
            <NewsMeta n={n} category={category} />
          </span>
        </a>
        <StoryActions n={n} canHide={canHide} className="opacity-100 md:opacity-0 md:focus-within:opacity-100 md:group-hover/story:opacity-100" />
      </div>
    );
  if (variant === 'lead')
    return (
      <article className="vo-in vo-panel group/story relative min-w-0 overflow-hidden transition-colors duration-150 hover:border-[var(--vo-line-2)]">
        <a href={n.url} target="_blank" rel="noreferrer" title="Open the article in a new tab" className={cn(LINK, 'grid min-w-0 grid-cols-1 md:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]', n.image_url === null && 'md:grid-cols-1')}>
          {n.image_url !== null && <Picture src={n.image_url} className="aspect-[16/9] h-full max-h-[340px] border-b border-[var(--vo-line)] md:border-b-0 md:border-r" />}
          <span className="flex min-w-0 flex-col gap-3 p-5">
            <span className="flex items-center gap-2">
              <NewsMeta n={n} />
              <TakeMark n={n} />
            </span>
            <span className="vo-wrap text-[26px] font-semibold leading-[32px] tracking-[-0.01em] text-[var(--vo-ink)] group-hover/story:underline group-hover/story:decoration-[var(--vo-line-2)] group-hover/story:underline-offset-[4px]">{n.title}</span>
            {lines !== '' && <span className="vo-wrap line-clamp-4 text-[14px] leading-[21px] text-[var(--vo-ink-2)]">{lines}</span>}
            {n.about.kind === 'company' && n.about.name !== '' && <span className="text-[12px] text-[var(--vo-muted)]">{`About ${n.about.name}`}</span>}
          </span>
        </a>
        <StoryActions n={n} canHide={canHide} className="absolute right-2 top-2 rounded-[6px] bg-[var(--vo-panel)] opacity-100 md:opacity-0 md:focus-within:opacity-100 md:group-hover/story:opacity-100" />
      </article>
    );
  const featured = variant === 'featured';
  return (
    <article className="vo-in vo-panel group/story relative flex min-w-0 flex-col overflow-hidden transition-colors duration-150 hover:border-[var(--vo-line-2)]">
      <a href={n.url} target="_blank" rel="noreferrer" title="Open the article in a new tab" className={cn(LINK, 'flex min-w-0 flex-1 flex-col')}>
        {n.image_url !== null && <Picture src={n.image_url} className="aspect-[16/9] border-b border-[var(--vo-line)]" />}
        <span className={cn('flex min-w-0 flex-1 flex-col gap-2', featured ? 'p-4' : 'p-3')}>
          <span className="flex items-center gap-2">
            <NewsMeta n={n} category={category} />
            <TakeMark n={n} />
          </span>
          <span className={cn('vo-wrap font-semibold text-[var(--vo-ink)] group-hover/story:underline group-hover/story:decoration-[var(--vo-line-2)] group-hover/story:underline-offset-[3px]', featured ? 'line-clamp-3 text-[15px] leading-[21px]' : 'line-clamp-3 text-[14px] leading-[19px]')}>{n.title}</span>
          {lines !== '' && <span className={cn('vo-wrap text-[13px] leading-[18px] text-[var(--vo-ink-2)]', n.image_url !== null ? 'line-clamp-2' : 'line-clamp-4')}>{lines}</span>}
        </span>
      </a>
      <StoryActions n={n} canHide={canHide} className="absolute right-2 top-2 rounded-[6px] bg-[var(--vo-panel)] opacity-100 md:opacity-0 md:focus-within:opacity-100 md:group-hover/story:opacity-100" />
    </article>
  );
}

/** A grid of story cards (1, 2 or 3 columns by width). */
export function StoryGrid({ items, canHide, cols = 3, category = true }: { items: NewsRow[]; canHide: boolean; cols?: 2 | 3 | undefined; category?: boolean | undefined }): React.JSX.Element {
  return (
    <div className={cn('grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2', cols === 3 && 'xl:grid-cols-3')}>
      {items.map((n) => (
        <StoryCard key={n.id} n={n} variant="card" canHide={canHide} category={category} />
      ))}
    </div>
  );
}
