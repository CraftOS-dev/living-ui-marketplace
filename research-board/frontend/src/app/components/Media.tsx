/**
 * How a card's content shows outside the board: a tile thumbnail (Library,
 * Home) and the full view (inspector, card dialog) with a real player for
 * videos, YouTube's own player, a page preview for links and an inline
 * viewer for PDFs.
 */
import { useState } from 'react';
import { ArrowUpRight, Download, Play } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { KIND, cardCaption, hostOf, kindColor, tint, youtubeId } from '../lib/kinds.ts';
import type { Card } from '../lib/types.ts';

/** A small dark play disc over a still. */
export function PlayDisc({ size = 40 }: { size?: number }): React.JSX.Element {
  return (
    <span className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-[2px]" style={{ width: size, height: size }}>
      <Play size={Math.round(size * 0.42)} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />
    </span>
  );
}

/** A document glyph: a folded sheet in the kind color with the file type on it. */
export function DocGlyph({ ext, size = 56 }: { ext: string; size?: number }): React.JSX.Element {
  const label = (ext || 'file').slice(0, 4).toUpperCase();
  return (
    <svg width={size} height={size * 1.22} viewBox="0 0 46 56" aria-hidden>
      <path d="M6 2 h24 l14 14 v34 a4 4 0 0 1 -4 4 h-34 a4 4 0 0 1 -4 -4 v-44 a4 4 0 0 1 4 -4 z" fill="var(--rb-card)" stroke="var(--rb-line)" strokeWidth="1.5" />
      <path d="M30 2 v10 a4 4 0 0 0 4 4 h10" fill="var(--rb-row)" stroke="var(--rb-line)" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="2" y="30" width="34" height="14" rx="3.5" fill={kindColor('doc')} />
      <text x="19" y="40.2" textAnchor="middle" fontSize="9" fontWeight="800" fill="var(--rb-card)" fontFamily="Manrope Variable, Manrope, sans-serif" letterSpacing="0.4">
        {label}
      </text>
    </svg>
  );
}

function Broken({ card }: { card: Card }): React.JSX.Element {
  const Icon = KIND[card.kind].icon;
  return (
    <span className="flex h-full w-full items-center justify-center" style={{ background: `var(--rb-kind-${card.kind}-soft)`, color: kindColor(card.kind) }}>
      <Icon size={26} strokeWidth={1.8} />
    </span>
  );
}

/** The full view of a card's content. */
export function MediaView({ card, tall = false }: { card: Card; tall?: boolean }): React.JSX.Element | null {
  const [failed, setFailed] = useState(false);
  const frame = 'overflow-hidden rounded-[8px] bg-[var(--rb-row)]';
  if (card.kind === 'image' && card.src !== '') {
    return (
      <a href={card.src} target="_blank" rel="noreferrer" className={cn(frame, 'block')} title="Open the image">
        {failed ? (
          <span className="flex h-40 items-center justify-center">
            <Broken card={card} />
          </span>
        ) : (
          <img src={card.src} alt={card.title} referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn('w-full object-contain', tall ? 'max-h-[60vh]' : 'max-h-72')} />
        )}
      </a>
    );
  }
  if (card.kind === 'video' && card.src !== '') {
    return <video src={card.src} controls preload="metadata" playsInline className={cn(frame, 'aspect-video w-full bg-black')} />;
  }
  if (card.kind === 'youtube') {
    const id = card.meta.video_id ?? youtubeId(card.url);
    if (id === '') return null;
    return (
      <div className={cn(frame, 'aspect-video w-full bg-black')}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?rel=0`}
          title={card.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }
  if (card.kind === 'link') {
    return (
      <a href={card.url} target="_blank" rel="noreferrer" className={cn(frame, 'group block border border-[var(--rb-line)] bg-[var(--rb-card)] transition-colors hover:border-[var(--rb-ink)]')}>
        {card.thumb !== '' && !failed && <img src={card.thumb} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="aspect-[1.91/1] w-full object-cover" />}
        <span className="flex items-start gap-3 p-4">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-[var(--rb-ink-2)]">{card.meta.site ?? hostOf(card.url)}</span>
            {card.meta.description !== undefined && card.meta.description !== '' && <span className="mt-1 line-clamp-3 block text-[13px] leading-5 text-[var(--rb-ink-2)]">{card.meta.description}</span>}
          </span>
          <ArrowUpRight size={18} className="mt-0.5 shrink-0 text-[var(--rb-ink-2)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--rb-ink)]" />
        </span>
      </a>
    );
  }
  if (card.kind === 'doc' && card.src !== '') {
    const pdf = (card.meta.ext ?? '') === 'pdf' && card.file_url !== '';
    return (
      <div className="flex flex-col gap-3">
        {pdf && <iframe src={`${card.file_url}#view=FitH&toolbar=0`} title={card.title} className={cn(frame, 'w-full bg-white', tall ? 'h-[62vh]' : 'h-80')} />}
        <div className="flex items-center gap-3 rounded-[8px] border border-[var(--rb-line)] p-2.5">
          <DocGlyph ext={card.meta.ext ?? ''} size={30} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold">{card.meta.filename ?? card.title}</span>
            <span className="text-[12px] font-semibold text-[var(--rb-ink-2)]">{cardCaption(card)}</span>
          </span>
          <a href={card.src} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--rb-line)] px-2.5 text-[13px] font-semibold hover:bg-[var(--rb-row)]">
            Open <ArrowUpRight size={14} />
          </a>
          {card.file_url !== '' && (
            <a href={card.file_url} download={card.meta.filename ?? true} aria-label="Download" title="Download" className="flex size-8 items-center justify-center rounded-[7px] border border-[var(--rb-line)] hover:bg-[var(--rb-row)]">
              <Download size={15} />
            </a>
          )}
        </div>
      </div>
    );
  }
  return null;
}
