/**
 * Shared pieces for papers: the cover (the first page's picture, or a
 * typographic cover while there is none), status badges, read state, tags,
 * and opening a paper (the reader when it has a PDF, its page otherwise).
 */
import { BookOpen, CircleAlert, FileText, Sparkles } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { opUrl } from '../lib/api.ts';
import { TYPE_LABEL, clip } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { WorkRow } from '../lib/types.ts';
import { Badge, Spinner } from './ui.tsx';

const COVER_TINTS = ['blue', 'green', 'amber', 'red', 'violet', 'teal', 'accent', 'ink'];

function tintOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_TINTS[h % COVER_TINTS.length] as string;
}

/** A paper's cover at a given width (3:4). */
export function Cover({ work, width = 120, className }: { work: WorkRow; width?: number; className?: string }): React.JSX.Element {
  const f = work.file ?? null;
  const height = Math.round((width * 4) / 3);
  const progress = f !== null && f.pages > 0 ? Math.min(1, f.max_page / f.pages) : 0;
  if (f !== null && f.has_thumb) {
    return (
      <span style={{ width, height }} className={cn('relative block shrink-0 overflow-hidden rounded-[var(--ro-r-sm)] border border-[var(--ro-line)] bg-white shadow-[var(--ro-shadow-sm)]', className)}>
        <img src={opUrl('files.thumb', { file: f.id })} alt="" loading="lazy" className="size-full object-cover object-top" />
        {progress > 0 && progress < 1 && <span className="absolute inset-x-0 bottom-0 h-1 bg-black/10"><span className="block h-full bg-[var(--ro-accent)]" style={{ width: `${progress * 100}%` }} /></span>}
      </span>
    );
  }
  const tint = tintOf(work.id);
  const small = width < 80;
  if (width <= 48) {
    // Too small for a title: the first letter, on the paper's tint.
    return (
      <span aria-hidden style={{ width, height, background: `var(--ro-pc-${tint}-soft)` }} className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-[var(--ro-line)]', className)}>
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `var(--ro-pc-${tint})` }} />
        <span className="serif pl-0.5 text-[13px] font-bold text-[var(--ro-ink-2)]">{(work.title.trim()[0] ?? '?').toUpperCase()}</span>
      </span>
    );
  }
  return (
    <span style={{ width, height, background: `var(--ro-pc-${tint}-soft)` }} className={cn('relative flex shrink-0 flex-col justify-between overflow-hidden rounded-[var(--ro-r-sm)] border border-[var(--ro-line)] shadow-[var(--ro-shadow-sm)]', small ? 'p-1' : 'p-2', className)}>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: `var(--ro-pc-${tint})` }} />
      {!small && <span className="truncate pl-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--ro-muted)]">{TYPE_LABEL[work.type] ?? work.type}</span>}
      <span className={cn('serif pl-1 font-semibold text-[var(--ro-ink)]', small ? 'text-[12px] leading-[13px]' : 'text-[13px] leading-[16px]')} style={{ display: '-webkit-box', WebkitLineClamp: small ? 3 : 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {clip(work.title, 140)}
      </span>
      {!small && <span className="truncate pl-1 text-[12px] text-[var(--ro-ink-2)]">{[work.authors_short, work.year > 0 ? work.year : ''].filter(Boolean).join(' ')}</span>}
      {f === null && !small && (
        <span className="absolute right-1.5 top-1.5 text-[var(--ro-muted)]" title="No PDF yet">
          <FileText size={12} />
        </span>
      )}
    </span>
  );
}

/** What is going on with a paper's metadata (identification, registry, integrity), as one badge. */
export function PaperState({ work }: { work: WorkRow }): React.JSX.Element | null {
  if (work.integrity === 'retracted') return <Badge tone="bad" title="A retraction notice exists for this paper">Retracted</Badge>;
  if (work.integrity === 'concern') return <Badge tone="warn" title="An expression of concern exists for this paper">Concern</Badge>;
  if (work.resolution === 'resolving') return <Badge tone="neutral" pulse>Filling in</Badge>;
  if (work.resolution === 'pending') {
    if (work.identify === 'working') return <Badge tone="agent">Being identified</Badge>;
    if (work.identify === 'failed') return <Badge tone="warn" title="Your AI agent could not identify it">Not identified</Badge>;
    return <Badge tone="neutral" title="Waiting to be identified">To identify</Badge>;
  }
  if (work.resolution === 'not_found') return <Badge tone="warn" title="The registry has no record for its identifier">Not found</Badge>;
  if (work.resolution === 'unreachable') return <Badge tone="warn" title="The registry did not answer; it is tried again">Offline</Badge>;
  if (work.identity === 'agent_proposed') return <Badge tone="agent" title="Your AI agent identified this paper; confirm it">Check identity</Badge>;
  if (work.integrity === 'corrected') return <Badge tone="neutral" title="A correction was published">Corrected</Badge>;
  return null;
}

export function TextState({ state }: { state: string }): React.JSX.Element | null {
  if (state === 'waiting' || state === 'extracting') return <Badge tone="neutral"><Spinner size={9} className="text-[var(--ro-muted)]" />Reading</Badge>;
  if (state === 'needs_ocr') return <Badge tone="agent" title="Scanned pages wait for your AI agent to read them">Scanned</Badge>;
  if (state === 'failed') return <Badge tone="bad">Unreadable</Badge>;
  return null;
}

export function ReadDot({ state, className }: { state: string; className?: string }): React.JSX.Element {
  return (
    <span
      title={state === 'read' ? 'Read' : state === 'reading' ? 'Reading' : 'Unread'}
      className={cn('inline-block size-2 shrink-0 rounded-full', state === 'read' ? 'bg-[var(--ro-muted)]/40' : state === 'reading' ? 'bg-[var(--ro-amber)]' : 'bg-[var(--ro-accent)]', className)}
    />
  );
}

export function TagDots({ tags }: { tags: { id: string; name: string; color_slot: number }[] }): React.JSX.Element | null {
  if (tags.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {tags.slice(0, 4).map((t) => (
        <span key={t.id} title={t.name} className="inline-flex h-4 items-center gap-1 rounded-[3px] bg-[var(--ro-row)] px-1 text-[12px] font-semibold text-[var(--ro-ink-2)]">
          {t.color_slot > 0 && <span className="size-1.5 rounded-full" style={{ background: `var(--ro-hl-${HUE_OF[t.color_slot] ?? 'gray'})` }} />}
          {t.name}
        </span>
      ))}
    </span>
  );
}

const HUE_OF: Record<number, string> = { 1: 'yellow', 2: 'red', 3: 'green', 4: 'blue', 5: 'violet', 6: 'orange', 7: 'teal', 8: 'gray' };

export function hueOfSlot(slot: number): string {
  return HUE_OF[slot] ?? 'yellow';
}

/** Made by your AI agent (a small mark next to things). */
export function AgentMark({ title = 'Added by your AI agent' }: { title?: string }): React.JSX.Element {
  return (
    <span title={title} className="inline-flex shrink-0 text-[var(--ro-accent-text)]">
      <Sparkles size={12} aria-label={title} />
    </span>
  );
}

/** Open a paper: the reader at the place you reached, or its page when it has no PDF. */
export function openPaper(work: WorkRow, page?: number): void {
  if (work.file) navigate('read', { file: work.file.id, page: page !== undefined ? String(page) : undefined });
  else navigate('paper', { id: work.id });
}

export function NoPdfBadge(): React.JSX.Element {
  return (
    <span title="No PDF" className="inline-flex text-[var(--ro-muted)]">
      <BookOpen size={13} />
    </span>
  );
}

export function WarnIcon({ title }: { title: string }): React.JSX.Element {
  return (
    <span title={title} className="inline-flex text-[var(--ro-amber-text)]">
      <CircleAlert size={13} />
    </span>
  );
}
