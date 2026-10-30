/**
 * Everything about one card: its content (a real player, YouTube's player,
 * the page preview, a PDF viewer), its title and text edited in place, the
 * summary your AI agent wrote (or asking for one), tags, color, the links to
 * other cards (proposals confirmed or rejected here) and its actions.
 *
 * Used as the board's inspector and in the Library's card dialog.
 */
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bot, Check, Copy, ExternalLink, FolderInput, LayoutGrid, RefreshCw, Sparkles, Star, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago } from '../lib/dates.ts';
import { KIND, LINK, cardCaption, hostOf, linkText } from '../lib/kinds.ts';
import { useLive } from '../lib/live.ts';
import type { Card, CardDetail, CardLink } from '../lib/types.ts';
import { MediaView } from './Media.tsx';
import { AutoTextarea, CircleButton, KindBadge, Label, MenuList, MoreMenu, PillButton, Popover, StatusPill, Swatches, TagEditor, softArea, softInput } from './ui.tsx';

export interface PanelHost {
  /** Show another card (a link's other end). */
  onSelect?: (id: string) => void;
  onClose: () => void;
  /** Card deleted (moved to the trash) from the panel. */
  onDeleted?: (card: Card) => void;
  /** Library: open the card on its board. */
  onOpenBoard?: (card: Card) => void;
  /** Board: the card's duplicate was made. */
  onDuplicated?: (ids: string[]) => void;
}

function useAllTags(): string[] {
  const t = useLive(() => api.tags(), ['cards'], []);
  return (t.data?.tags ?? []).map((x) => x.tag);
}

export function CardPanel({ id, host, tall = false }: { id: string; host: PanelHost; tall?: boolean }): React.JSX.Element {
  const live = useLive(() => api.card(id), ['cards', 'links'], [id]);
  if (live.data === null) {
    return (
      <div className="flex flex-col gap-4 p-5" aria-label="Loading the card">
        <span className="rb-skeleton h-8 w-40 rounded-full" />
        <span className="rb-skeleton h-44 w-full rounded-[8px]" />
        <span className="rb-skeleton h-5 w-3/4 rounded-full" />
        <span className="rb-skeleton h-4 w-2/3 rounded-full" />
        {live.error !== null && (
          <p className="text-[13px] text-[var(--rb-red-text)]">
            This card is gone (deleted, or moved to the trash).{' '}
            <button type="button" className="font-semibold underline" onClick={host.onClose}>
              Close
            </button>
          </p>
        )}
      </div>
    );
  }
  return <Panel key={live.data.id} card={live.data} host={host} tall={tall} />;
}

function Panel({ card, host, tall }: { card: CardDetail; host: PanelHost; tall: boolean }): React.JSX.Element {
  const info = KIND[card.kind];
  const allTags = useAllTags();
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const [source, setSource] = useState(card.source);
  const [url, setUrl] = useState(card.url);
  useEffect(() => setTitle(card.title), [card.title]);
  useEffect(() => setBody(card.body), [card.body]);
  useEffect(() => setSource(card.source), [card.source]);
  useEffect(() => setUrl(card.url), [card.url]);

  const save = async (patch: Parameters<typeof api.updateCard>[1]): Promise<void> => {
    try {
      await api.updateCard(card.id, patch);
    } catch {
      /* toasted */
    }
  };

  const remove = async (): Promise<void> => {
    try {
      await api.deleteCards([card.id]);
      host.onDeleted?.(card);
    } catch {
      /* toasted */
    }
  };

  const duplicate = async (): Promise<void> => {
    try {
      const r = await api.duplicateCards([card.id]);
      host.onDuplicated?.(r.ids);
      toast.success('Duplicated');
    } catch {
      /* toasted */
    }
  };

  const items = [
    { label: 'Duplicate', icon: Copy, onClick: () => void duplicate() },
    ...(card.url !== '' ? [{ label: 'Open the source', icon: ExternalLink, onClick: () => window.open(card.url, '_blank', 'noreferrer') }] : []),
    ...(host.onOpenBoard !== undefined ? [{ label: 'Open on the board', icon: LayoutGrid, onClick: () => host.onOpenBoard?.(card) }] : []),
    'divider' as const,
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      hint: 'Del',
      onClick: () => void remove(),
    },
  ];

  const textLabel = card.kind === 'note' ? 'Text' : card.kind === 'quote' ? 'Passage' : card.kind === 'section' ? '' : 'Your note';
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex h-12 items-center gap-2.5 border-b border-[var(--rb-line)] bg-[var(--rb-card)] pl-4 pr-2">
        <KindBadge kind={card.kind} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold">{info.label}</span>
          <span className="block truncate text-[12px] text-[var(--rb-ink-2)]">{cardCaption(card) || `On ${card.board_name}`}</span>
        </span>
        {card.kind !== 'section' && (
          <CircleButton
            icon={Star}
            label={card.starred ? 'Unstar' : 'Star'}
            variant="ghost"
            size={28}
            className={card.starred ? 'text-[var(--rb-ink)] [&_svg]:fill-current' : ''}
            onClick={() => void save({ starred: !card.starred })}
          />
        )}
        <MoreMenu items={items} size={28} />
        <CircleButton icon={X} label="Close" size={28} onClick={host.onClose} />
      </div>

      <div className="flex flex-col gap-4 p-4">
        {card.kind !== 'note' && card.kind !== 'quote' && card.kind !== 'section' && <MediaView card={card} tall={tall} />}

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== card.title && void save({ title: title.trim() === '' && card.kind === 'section' ? 'Section' : title.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder={card.kind === 'quote' ? 'Title (optional)' : 'Title'}
          aria-label="Title"
          className="-mx-1.5 w-[calc(100%+12px)] rounded-[7px] border border-transparent bg-transparent px-1.5 py-1 text-[17px] font-bold leading-6 outline-none placeholder:text-[var(--rb-muted)] hover:border-[var(--rb-line)] focus:border-[var(--rb-ink)]"
        />

        {(card.kind === 'link' || card.kind === 'youtube' || ((card.kind === 'image' || card.kind === 'video' || card.kind === 'doc') && card.file === '')) && (
          <div>
            <Label action={card.url !== '' && <a href={card.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--rb-ink-2)] hover:text-[var(--rb-ink)]">{hostOf(card.url)} <ArrowUpRight size={12} /></a>}>Address</Label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url.trim() !== card.url && void save({ url: url.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Address" spellCheck={false} className={cn(softInput, 'text-[13px]')} />
          </div>
        )}

        {textLabel !== '' && (
          <div>
            <Label>{textLabel}</Label>
            <AutoTextarea
              value={body}
              onChange={setBody}
              onBlur={() => body !== card.body && void save({ body })}
              minRows={card.kind === 'note' || card.kind === 'quote' ? 4 : 2}
              placeholder={card.kind === 'note' ? 'Write the idea, finding or question' : card.kind === 'quote' ? 'The passage' : 'Why it matters'}
              aria-label={textLabel}
              className={cn(softArea, 'text-[13.5px] leading-[21px]', card.kind === 'quote' && 'rb-serif text-[15px] italic leading-[23px]')}
            />
          </div>
        )}

        {card.kind === 'quote' && (
          <div>
            <Label>Source</Label>
            <input value={source} onChange={(e) => setSource(e.target.value)} onBlur={() => source.trim() !== card.source && void save({ source: source.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} placeholder="Author, work, page" aria-label="Source" className={softInput} />
          </div>
        )}

        {card.kind !== 'section' && <Summary card={card} />}

        {card.kind !== 'section' && (
          <div>
            <Label>Tags</Label>
            <TagEditor tags={card.tags} onChange={(tags) => void save({ tags })} suggestions={allTags} />
          </div>
        )}

        {(card.kind === 'note' || card.kind === 'section') && (
          <div>
            <Label>Color</Label>
            <Swatches value={card.color} onChange={(color) => void save({ color })} />
          </div>
        )}

        {card.kind !== 'section' && <Links card={card} onSelect={host.onSelect} />}

        <p className="flex items-center gap-1.5 px-1 text-[12px] text-[var(--rb-ink-2)]">
          {card.added_by === 'agent' ? <Bot size={13} /> : null}
          Added {card.added_by === 'agent' ? 'by your AI agent' : ''} {ago(card.created)} · on {card.board_name}
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- summary */

function Summary({ card }: { card: Card }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const state = card.digest_state;
  useEffect(() => {
    setSlow(false);
    if (state !== 'waiting') return;
    const t = setTimeout(() => setSlow(true), 20000);
    return () => clearTimeout(t);
  }, [state]);
  const ask = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.requestDigest(card.id);
      if (!r.asked_agent) toast.info('Saved. Your AI agent is asked as soon as it can take more work.');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (state === 'waiting' || state === 'reading') {
    return (
      <div className="rounded-[8px] border border-[var(--rb-line)] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <StatusPill tone="info" pulse>
            {state === 'waiting' ? 'Sent to your AI agent' : 'Your AI agent is reading it'}
          </StatusPill>
          {state === 'waiting' && (
            <button type="button" onClick={() => void api.cancelDigest(card.id).catch(() => undefined)} className="text-[12px] font-semibold text-[var(--rb-ink-2)] hover:text-[var(--rb-ink)]">
              Cancel
            </button>
          )}
        </div>
        <p className="mt-3 text-[13px] leading-5 text-[var(--rb-ink-2)]">
          {state === 'waiting' ? (slow ? 'It picks this up while your AI agent is running.' : 'A short summary appears here when it is done.') : 'A short summary appears here in a moment.'}
        </p>
      </div>
    );
  }
  if (card.digest !== '') {
    return (
      <div className="rounded-[8px] border border-[var(--rb-line)] p-3.5">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--rb-accent)]" />
          <span className="flex-1 text-[13px] font-bold">Summary</span>
          <button type="button" title="Ask again" aria-label="Ask for a new summary" onClick={() => void ask()} disabled={busy} className="flex size-7 items-center justify-center rounded-[7px] text-[var(--rb-ink-2)] hover:bg-[var(--rb-row)] hover:text-[var(--rb-ink)]">
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
          </button>
          <button type="button" title="Remove the summary" aria-label="Remove the summary" onClick={() => void api.clearDigest(card.id).catch(() => undefined)} className="flex size-7 items-center justify-center rounded-[7px] text-[var(--rb-ink-2)] hover:bg-[var(--rb-row)] hover:text-[var(--rb-ink)]">
            <X size={13} />
          </button>
        </div>
        <p className="rb-prose text-[13.5px] leading-[21px]">{card.digest}</p>
        <p className="mt-2 text-[12px] text-[var(--rb-ink-2)]">By your AI agent · {ago(card.digest_at)}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--rb-line)] p-3.5">
      {state === 'failed' && (
        <p className="text-[13px] leading-5 text-[var(--rb-red-text)]">
          <span className="font-semibold">Could not summarize it.</span> {card.digest_error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[13px] leading-5 text-[var(--rb-ink-2)]">{state === 'failed' ? 'Fix what it says, then ask again.' : 'Your AI agent reads it and writes the gist here.'}</p>
        <PillButton variant="light" size="sm" icon={Sparkles} loading={busy} onClick={() => void ask()}>
          {state === 'failed' ? 'Try again' : 'Summarize'}
        </PillButton>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- links */

/** How a link reads from the card it points to. */
const INCOMING: Record<CardLink['kind'], string> = {
  relates: 'relates to',
  supports: 'supported by',
  contradicts: 'contradicted by',
  leads: 'follows from',
};

function LinkRow({ l, onSelect }: { l: CardLink; onSelect?: ((id: string) => void) | undefined }): React.JSX.Element {
  const proposed = l.status === 'proposed';
  const Arrow: LucideIcon = l.direction === 'out' ? ArrowRight : ArrowLeft;
  const verb = l.direction === 'out' ? LINK[l.kind].verb : INCOMING[l.kind];
  return (
    <li className={cn('rounded-[8px] border p-2', proposed ? 'border-dashed border-[var(--rb-accent)]' : 'border-[var(--rb-line)]')}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--rb-row)]" style={{ color: proposed ? 'var(--rb-accent)' : linkText(l.kind) }}>
          <Arrow size={14} strokeWidth={2.4} />
        </span>
        <button type="button" onClick={() => onSelect?.(l.other.id)} className="min-w-0 flex-1 text-left">
          <span className="block text-[12px] font-semibold" style={{ color: proposed ? 'var(--rb-ink-2)' : linkText(l.kind) }}>
            {verb}
            {l.label !== '' ? ` · ${l.label}` : ''}
          </span>
          <span className="flex items-center gap-1.5 truncate text-[13px] font-bold hover:underline">
            <span className="truncate">{l.other.title !== '' ? l.other.title : KIND[l.other.kind].label}</span>
          </span>
        </button>
        {!proposed && (
          <button type="button" aria-label="Remove the link" title="Remove the link" onClick={() => void api.deleteLink(l.id).catch(() => undefined)} className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[var(--rb-ink-2)] hover:bg-[var(--rb-card)] hover:text-[var(--rb-ink)]">
            <X size={13} />
          </button>
        )}
      </div>
      {proposed && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-9">
          {l.reason !== '' && <p className="w-full text-[12px] leading-4 text-[var(--rb-ink-2)]">{l.reason}</p>}
          <button type="button" onClick={() => void api.decideLinks('confirm', { ids: [l.id] }).catch(() => undefined)} className="inline-flex h-7 items-center gap-1 rounded-[6px] bg-[var(--rb-ink)] px-2.5 text-[12px] font-semibold text-[var(--rb-card)]">
            <Check size={12} strokeWidth={2.6} /> Keep
          </button>
          <button type="button" onClick={() => void api.decideLinks('reject', { ids: [l.id] }).catch(() => undefined)} className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[var(--rb-line)] px-2.5 text-[12px] font-semibold">
            <X size={12} strokeWidth={2.6} /> Reject
          </button>
          <span className="inline-flex items-center gap-1 text-[12px] text-[var(--rb-ink-2)]">
            <Sparkles size={11} /> proposed
          </span>
        </div>
      )}
    </li>
  );
}

function Links({ card, onSelect }: { card: CardDetail; onSelect?: ((id: string) => void) | undefined }): React.JSX.Element {
  return (
    <div>
      <Label>Links{card.links.length > 0 ? ` · ${card.links.length}` : ''}</Label>
      {card.links.length === 0 ? (
        <p className="px-1 text-[13px] leading-5 text-[var(--rb-ink-2)]">No links yet. On the board, drag the dot on top of a card onto another card.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {card.links.map((l) => (
            <LinkRow key={l.id} l={l} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------- moving between boards */

/** "Move to board" / "Copy to board" for a set of cards. */
export function TransferMenu({ ids, from, onDone }: { ids: string[]; from: string; onDone?: (board: string, mode: 'move' | 'copy') => void }): React.JSX.Element {
  const { boards } = useApp();
  const [open, setOpen] = useState<'move' | 'copy' | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const others = boards.filter((b) => b.id !== from);
  const go = async (board: string, mode: 'move' | 'copy'): Promise<void> => {
    try {
      const r = await api.transferCards(ids, board, mode);
      const name = boards.find((b) => b.id === board)?.name ?? 'the board';
      toast.success(`${mode === 'move' ? 'Moved' : 'Copied'} ${ids.length === 1 ? 'the card' : `${ids.length} cards`} to ${name}${r.links_left_behind > 0 ? `; ${r.links_left_behind} link${r.links_left_behind === 1 ? '' : 's'} to cards left here removed` : ''}`);
      onDone?.(board, mode);
    } catch (err) {
      toast.error(errMessage(err));
    }
  };
  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <PillButton variant="light" size="sm" icon={FolderInput} disabled={others.length === 0} onClick={() => setOpen(open === 'move' ? null : 'move')}>
        Move to
      </PillButton>
      <PillButton variant="light" size="sm" icon={Copy} disabled={others.length === 0} onClick={() => setOpen(open === 'copy' ? null : 'copy')}>
        Copy to
      </PillButton>
      <Popover open={open !== null} onClose={() => setOpen(null)} keep={ref} className="bottom-[calc(100%+8px)] top-auto max-h-72 w-64 overflow-y-auto">
        <p className="px-3 pb-1 pt-1.5 text-[12px] font-bold text-[var(--rb-ink-2)]">{open === 'copy' ? 'Copy to' : 'Move to'}</p>
        <MenuList onPicked={() => setOpen(null)} items={others.map((b) => ({ label: b.name, icon: LayoutGrid, onClick: () => void go(b.id, open ?? 'move') }))} />
      </Popover>
    </div>
  );
}
