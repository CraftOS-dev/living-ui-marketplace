/**
 * One card on the board, drawn like a Research OS map node: a flat card with
 * a hairline border, small corners, a stripe in its kind's color and a small
 * header (kind icon, caption, what the AI agent did), then its content.
 * Sections are dashed frames with their name on top.
 *
 * Hovering shows the link handle (top dot, drag it onto another card) and
 * the resize grip (bottom right). Notes and section names are edited in
 * place on double click; other cards open in the inspector.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Bot, Sparkles, Star } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { DocGlyph, PlayDisc } from '../components/Media.tsx';
import { KIND, cardCaption, tint } from '../lib/kinds.ts';
import type { Card } from '../lib/types.ts';
import type { Box } from './canvas.tsx';

export interface CardActions {
  pointerDown: (e: React.PointerEvent, card: Card) => void;
  linkStart: (e: React.PointerEvent, card: Card) => void;
  resizeStart: (e: React.PointerEvent, card: Card) => void;
  open: (card: Card) => void;
  saveText: (card: Card, patch: { title?: string; body?: string }) => void;
  doneEditing: (card: Card) => void;
}

interface Props {
  card: Card;
  box: Box;
  selected: boolean;
  editing: boolean;
  dim: boolean;
  hit: boolean;
  linkTarget: boolean;
  dragging: boolean;
  fresh: boolean;
  zoom: number;
  act: CardActions;
}

function Header({ card }: { card: Card }): React.JSX.Element {
  const info = KIND[card.kind];
  const Icon = info.icon;
  const caption = cardCaption(card);
  const busy = card.digest_state === 'waiting' || card.digest_state === 'reading';
  return (
    <span className="flex h-5 shrink-0 items-center gap-1.5 text-[11.5px] font-semibold text-[var(--rb-ink-2)]">
      <Icon size={12} strokeWidth={2.2} className="shrink-0" />
      <span className="truncate">{caption !== '' ? caption : info.label}</span>
      <span className="flex-1" />
      {card.digest_state === 'done' && <Sparkles size={12} className="shrink-0 text-[var(--rb-accent)]" aria-label="Summarized by your AI agent" />}
      {busy && <span className="rb-pulse size-2 shrink-0 rounded-full bg-[var(--rb-accent)]" aria-label="With your AI agent" />}
      {card.digest_state === 'failed' && <span className="size-2 shrink-0 rounded-full bg-[var(--rb-red)]" aria-label="The summary could not be made" />}
      {card.added_by === 'agent' && <Bot size={12} className="shrink-0" aria-label="Added by your AI agent" />}
      {card.starred && <Star size={12} className="shrink-0 fill-current" aria-label="Starred" />}
    </span>
  );
}

function Tags({ tags }: { tags: string[] }): React.JSX.Element | null {
  if (tags.length === 0) return null;
  return (
    <span className="mt-auto flex shrink-0 items-center gap-1 overflow-hidden pt-1.5">
      {tags.slice(0, 3).map((t) => (
        <span key={t} className="max-w-[45%] shrink-0 truncate rounded-[4px] bg-[var(--rb-row-hover)] px-1.5 text-[10.5px] font-semibold leading-[17px] text-[var(--rb-ink)]">
          #{t}
        </span>
      ))}
      {tags.length > 3 && <span className="text-[10.5px] font-semibold text-[var(--rb-ink-2)]">+{tags.length - 3}</span>}
    </span>
  );
}

function Still({ src, play = false }: { src: string; play?: boolean }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative block min-h-0 flex-1 overflow-hidden rounded-[6px] bg-[var(--rb-row)]">
      {!failed && <img src={src} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />}
      {play && <PlayDisc size={34} />}
    </span>
  );
}

function NoteEditor({ card, act }: { card: Card; act: CardActions }): React.JSX.Element {
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const done = useRef(false);
  const save = (): void => {
    if (done.current) return;
    done.current = true;
    if (title !== card.title || body !== card.body) act.saveText(card, { title, body });
    act.doneEditing(card);
  };
  useEffect(() => {
    const el = bodyRef.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-1"
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) save();
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className="w-full bg-transparent text-[13.5px] font-bold leading-[18px] outline-none placeholder:text-[var(--rb-ink-2)]" />
      <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write here" aria-label="Text" className="min-h-0 w-full flex-1 resize-none bg-transparent text-[12.5px] leading-[18px] text-[var(--rb-ink-2)] outline-none placeholder:text-[var(--rb-ink-2)]" />
    </div>
  );
}

function SectionTitle({ card, editing, act }: { card: Card; editing: boolean; act: CardActions }): React.JSX.Element {
  const [v, setV] = useState(card.title);
  useEffect(() => setV(card.title), [card.title]);
  const done = useRef(false);
  useEffect(() => {
    if (editing) done.current = false;
  }, [editing]);
  const save = (): void => {
    if (done.current) return;
    done.current = true;
    if (v.trim() !== card.title) act.saveText(card, { title: v.trim() === '' ? 'Section' : v.trim() });
    act.doneEditing(card);
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === 'Escape') save();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Section name"
        className="h-7 w-full max-w-[22rem] rounded-[6px] border border-[var(--rb-ink)] bg-[var(--rb-card)] px-2 text-[14px] font-bold outline-none"
      />
    );
  }
  return <span className="block truncate text-[14px] font-bold tracking-[-0.005em]">{card.title !== '' ? card.title : 'Section'}</span>;
}

function Body({ card, editing, act }: { card: Card; editing: boolean; act: CardActions }): React.JSX.Element {
  switch (card.kind) {
    case 'note':
      if (editing) return <NoteEditor card={card} act={act} />;
      return (
        <>
          {card.title !== '' && <span className="line-clamp-2 shrink-0 text-[13.5px] font-bold leading-[18px]">{card.title}</span>}
          {card.body !== '' ? (
            <span className="rb-prose relative min-h-0 flex-1 overflow-hidden text-[12.5px] leading-[18px] text-[var(--rb-ink-2)] [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">{card.body}</span>
          ) : card.title === '' ? (
            <span className="text-[12.5px] text-[var(--rb-ink-2)]">Double click to write</span>
          ) : null}
        </>
      );
    case 'link':
      return (
        <>
          {card.thumb !== '' && <Still src={card.thumb} />}
          <span className={cn('shrink-0 text-[13px] font-bold leading-[17px]', card.thumb !== '' ? 'line-clamp-2' : 'line-clamp-2')}>{card.title}</span>
          {card.thumb === '' && card.meta.description !== undefined && card.meta.description !== '' && <span className="line-clamp-2 min-h-0 text-[12px] leading-4 text-[var(--rb-ink-2)]">{card.meta.description}</span>}
        </>
      );
    case 'youtube':
      return (
        <>
          {card.thumb !== '' && <Still src={card.thumb} play />}
          <span className="line-clamp-2 shrink-0 text-[13px] font-bold leading-[17px]">{card.title}</span>
        </>
      );
    case 'image':
      return (
        <>
          {card.src !== '' && <Still src={card.src} />}
          <span className="shrink-0 truncate text-[13px] font-bold leading-[17px]">{card.title}</span>
        </>
      );
    case 'video':
      return (
        <>
          <span className="relative block min-h-0 flex-1 overflow-hidden rounded-[6px] bg-black">
            {card.file_url !== '' && <video src={`${card.file_url}#t=0.5`} preload="metadata" muted playsInline className="pointer-events-none h-full w-full object-cover" />}
            <PlayDisc size={34} />
          </span>
          <span className="shrink-0 truncate text-[13px] font-bold leading-[17px]">{card.title}</span>
        </>
      );
    case 'doc':
      return (
        <span className="flex min-h-0 flex-1 items-center gap-3">
          <DocGlyph ext={card.meta.ext ?? ''} size={34} />
          <span className="line-clamp-3 min-w-0 flex-1 text-[13px] font-bold leading-[17px]">{card.title}</span>
        </span>
      );
    case 'quote':
      return (
        <>
          <span className="rb-serif rb-prose relative min-h-0 flex-1 overflow-hidden text-[14px] italic leading-[20px] [mask-image:linear-gradient(to_bottom,black_78%,transparent)]">
            <span aria-hidden className="mr-0.5 text-[20px] font-bold not-italic leading-none text-[var(--rb-ink-2)]">
              “
            </span>
            {card.body}
          </span>
          {card.source !== '' && <span className="shrink-0 truncate text-[11.5px] font-semibold text-[var(--rb-ink-2)]">— {card.source}</span>}
        </>
      );
    default:
      return <></>;
  }
}

function CardViewInner({ card, box, selected, editing, dim, hit, linkTarget, dragging, fresh, zoom, act }: Props): React.JSX.Element {
  const grip = (
    <span
      role="presentation"
      onPointerDown={(e) => act.resizeStart(e, card)}
      className="absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize opacity-0 transition-opacity group-hover:opacity-100"
      style={{ opacity: selected ? 1 : undefined }}
    >
      <svg viewBox="0 0 16 16" className="h-full w-full" aria-hidden>
        <path d="M12 5 L5 12 M12 9 L9 12" stroke="var(--rb-muted)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );

  if (card.kind === 'section') {
    const c = card.color;
    return (
      <div
        data-card={card.id}
        data-section
        onPointerDown={(e) => act.pointerDown(e, card)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          act.open(card);
        }}
        className={cn('group absolute select-none rounded-[10px] border-[1.5px] border-dashed transition-[opacity,box-shadow]', selected && 'ring-2 ring-[var(--rb-ink)] ring-offset-2 ring-offset-[var(--rb-stage)]', dim && 'opacity-40', fresh && 'rb-land')}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderColor: c === 'plain' ? 'var(--rb-ink-2)' : tint(c), background: tint(c, 'wash') }}
      >
        <div className="absolute left-3 top-2.5 right-3 flex items-center gap-2 text-[var(--rb-ink)]">
          <SectionTitle card={card} editing={editing} act={act} />
        </div>
        {grip}
      </div>
    );
  }

  const noteTint = card.kind === 'note' && card.color !== 'plain';
  const stripe = 'var(--rb-ink)';
  return (
    <div
      data-card={card.id}
      onPointerDown={(e) => act.pointerDown(e, card)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        act.open(card);
      }}
      className={cn('group absolute select-none', dragging && 'z-[5]', dim && 'opacity-30', fresh && 'rb-land', editing ? 'cursor-text' : 'cursor-pointer')}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <div
        className={cn(
          'relative flex h-full w-full flex-col gap-1.5 overflow-hidden rounded-[8px] border border-[var(--rb-hair)] px-3 pb-2.5 pt-2 transition-[box-shadow,border-color] duration-150',
          dragging ? 'shadow-[0_18px_36px_-16px_rgba(0,0,0,0.4)]' : 'group-hover:border-[var(--rb-ink-2)]',
          selected && 'ring-2 ring-[var(--rb-ink)]',
          hit && !selected && 'rb-hit',
          linkTarget && 'group-hover:ring-2 group-hover:ring-[var(--rb-accent)]',
        )}
        style={{ background: noteTint ? tint(card.color, 'soft') : 'var(--rb-card)' }}
      >
          <Header card={card} />
        <Body card={card} editing={editing} act={act} />
        {!editing && zoom > 0.45 && <Tags tags={card.tags} />}
      </div>
      {!editing && (
        <span
          role="button"
          aria-label="Drag to link"
          title="Drag onto another card to link them"
          onPointerDown={(e) => act.linkStart(e, card)}
          className="absolute left-1/2 top-0 z-10 size-[18px] -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-[3px] border-[var(--rb-card)] opacity-0 shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-[opacity,scale] hover:scale-125 group-hover:opacity-100"
          style={{ background: stripe, opacity: selected ? 1 : undefined }}
        />
      )}
      {grip}
    </div>
  );
}

export const CardView = memo(CardViewInner);
