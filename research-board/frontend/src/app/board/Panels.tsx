/**
 * The board's right-hand panel when a link or several cards are selected:
 * a link's kind, label and direction (or keep / reject when proposed), and
 * what can be done to a selection at once.
 */
import { useState } from 'react';
import { ArrowDown, ArrowLeftRight, Check, Copy, Frame, LayoutGrid, Sparkles, Tags, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { TransferMenu } from '../components/CardPanel.tsx';
import { CircleButton, KindBadge, Label, PillButton, TagEditor, softInput } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { KIND, LINK_LIST, cardName, linkColor } from '../lib/kinds.ts';
import type { Card, Link } from '../lib/types.ts';

export function LinkPanel({ link, from, to, onClose, onSelectCard }: { link: Link; from: Card; to: Card; onClose: () => void; onSelectCard: (id: string) => void }): React.JSX.Element {
  const [label, setLabel] = useState(link.label);
  const proposed = link.status === 'proposed';
  const end = (c: Card): React.JSX.Element => (
    <button type="button" onClick={() => onSelectCard(c.id)} className="flex w-full items-center gap-2.5 rounded-[8px] border border-[var(--rb-line)] p-2.5 text-left hover:bg-[var(--rb-row)]">
      <KindBadge kind={c.kind} size={26} />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-[var(--rb-ink-2)]">{KIND[c.kind].label}</span>
        <span className="block truncate text-[13.5px] font-bold">{cardName(c)}</span>
      </span>
    </button>
  );
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-[26px] items-center justify-center rounded-[7px] border border-[var(--rb-line)]" style={{ color: proposed ? 'var(--rb-accent)' : 'var(--rb-ink)' }}>
          {proposed ? <Sparkles size={16} /> : <ArrowLeftRight size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold">{proposed ? 'Proposed link' : 'Link'}</span>
          <span className="block text-[12px] text-[var(--rb-ink-2)]">{proposed ? 'Your AI agent suggests it' : link.added_by === 'agent' ? 'Added by your AI agent' : 'Between two cards'}</span>
        </span>
        <CircleButton icon={X} label="Close" size={28} onClick={onClose} />
      </div>

      <div className="flex flex-col items-stretch gap-1.5">
        {end(from)}
        <span className="flex items-center justify-center gap-2 py-0.5 text-[12px] font-bold" style={{ color: proposed ? 'var(--rb-accent)' : linkColor(link.kind) }}>
          <ArrowDown size={14} strokeWidth={2.4} />
          {LINK_LIST.find((l) => l.kind === link.kind)?.verb}
        </span>
        {end(to)}
      </div>

      {proposed && (
        <div className="rounded-[8px] border border-dashed border-[var(--rb-accent)] p-3">
          {link.reason !== '' && <p className="text-[13px] leading-5 text-[var(--rb-ink-2)]">{link.reason}</p>}
          <div className={cn('flex gap-2', link.reason !== '' && 'mt-3')}>
            <PillButton variant="dark" size="sm" icon={Check} onClick={() => void api.decideLinks('confirm', { ids: [link.id] }).catch(() => undefined)}>
              Keep it
            </PillButton>
            <PillButton
              variant="light"
              size="sm"
              icon={X}
              onClick={() =>
                void api
                  .decideLinks('reject', { ids: [link.id] })
                  .then(onClose)
                  .catch(() => undefined)
              }
            >
              Reject
            </PillButton>
          </div>
        </div>
      )}

      <div>
        <Label>Kind</Label>
        <div className="grid grid-cols-2 gap-2">
          {LINK_LIST.map((l) => {
            const on = l.kind === link.kind;
            return (
              <button
                key={l.kind}
                type="button"
                aria-pressed={on}
                onClick={() => !on && void api.updateLink(link.id, { kind: l.kind }).catch(() => undefined)}
                className={cn('flex flex-col items-start gap-0.5 rounded-[8px] border px-2.5 py-2 text-left transition-colors', on ? 'border-[var(--rb-ink)] shadow-[0_0_0_1px_var(--rb-ink)]' : 'border-[var(--rb-line)] hover:bg-[var(--rb-row)]')}
              >
                <span className="flex items-center gap-2 text-[13px] font-bold">
                  <span className="h-[3px] w-4 rounded-full" style={{ background: linkColor(l.kind) }} />
                  {l.label}
                </span>
                <span className="text-[11.5px] text-[var(--rb-ink-2)]">{l.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Label</Label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label.trim() !== link.label && void api.updateLink(link.id, { label: label.trim() }).catch(() => undefined)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder="A few words on the line (optional)"
          maxLength={200}
          className={softInput}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <PillButton variant="light" size="sm" icon={ArrowLeftRight} onClick={() => void api.updateLink(link.id, { flip: true }).catch(() => undefined)}>
          Flip direction
        </PillButton>
        <PillButton
          variant="danger"
          size="sm"
          icon={Trash2}
          onClick={() =>
            void api
              .deleteLink(link.id)
              .then(onClose)
              .catch(() => undefined)
          }
        >
          Remove link
        </PillButton>
      </div>
    </div>
  );
}

export function SelectionPanel({
  cards,
  board,
  allTags,
  onClose,
  onDelete,
  onDuplicate,
  onSection,
  onTidy,
}: {
  cards: Card[];
  board: string;
  allTags: string[];
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSection: () => void;
  onTidy: () => void;
}): React.JSX.Element {
  const [tags, setTags] = useState<string[]>([]);
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  const content = cards.filter((c) => c.kind !== 'section');
  const applyTags = async (): Promise<void> => {
    if (tags.length === 0 || content.length === 0) return;
    try {
      await api.tagCards(
        content.map((c) => c.id),
        tags,
      );
      toast.success(`Tagged ${content.length} ${content.length === 1 ? 'card' : 'cards'}`);
      setTags([]);
    } catch {
      /* toasted */
    }
  };
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2.5">
        <span className="num flex size-[26px] items-center justify-center rounded-[7px] bg-[var(--rb-ink)] text-[12px] font-bold text-[var(--rb-card)]">{cards.length}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold">{cards.length} selected</span>
          <span className="block truncate text-[12px] text-[var(--rb-ink-2)]">
            {[...counts.entries()].map(([k, n]) => `${n} ${n === 1 ? KIND[k as Card['kind']].label.toLowerCase() : KIND[k as Card['kind']].plural.toLowerCase()}`).join(', ')}
          </span>
        </span>
        <CircleButton icon={X} label="Clear the selection" size={28} onClick={onClose} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onSection} className="flex flex-col items-start gap-2 rounded-[8px] border border-[var(--rb-line)] p-3 text-left hover:bg-[var(--rb-row)]">
          <Frame size={17} />
          <span className="text-[13px] font-bold">Group in a section</span>
        </button>
        <button type="button" onClick={onTidy} className="flex flex-col items-start gap-2 rounded-[8px] border border-[var(--rb-line)] p-3 text-left hover:bg-[var(--rb-row)]">
          <LayoutGrid size={17} />
          <span className="text-[13px] font-bold">Tidy into a grid</span>
        </button>
      </div>

      {content.length > 0 && (
        <div>
          <Label
            action={
              tags.length > 0 && (
                <button type="button" onClick={() => void applyTags()} className="text-[12px] font-bold text-[var(--rb-ink)] hover:underline">
                  Add to {content.length}
                </button>
              )
            }
          >
            <span className="inline-flex items-center gap-1.5">
              <Tags size={12} /> Add tags
            </span>
          </Label>
          <TagEditor tags={tags} onChange={setTags} suggestions={allTags} placeholder="Tags for every selected card" />
        </div>
      )}

      <div>
        <Label>Other boards</Label>
        <TransferMenu ids={cards.map((c) => c.id)} from={board} onDone={onClose} />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-[var(--rb-line)] pt-4">
        <PillButton variant="light" size="sm" icon={Copy} onClick={onDuplicate}>
          Duplicate
        </PillButton>
        <PillButton variant="danger" size="sm" icon={Trash2} onClick={onDelete}>
          Delete
        </PillButton>
      </div>
      <p className="px-1 text-[12px] leading-5 text-[var(--rb-ink-2)]">Drag any selected card to move them together. Shift and click adds or removes a card; Shift and drag selects an area.</p>
    </div>
  );
}
