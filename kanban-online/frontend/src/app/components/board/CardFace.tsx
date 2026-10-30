/**
 * A card on the board, sparse like Linear's: key and priority, the title,
 * what the agent is doing right now (a live line and a sweeping bottom edge
 * while it works), labels, due date, checklist and plan progress, the chip
 * that says where the agent is with it, age dots, and who has it: the
 * person or agent it is assigned to, the agent working it, or any agent.
 */
import { memo } from 'react';
import { Ban, CalendarDays, ListChecks, ListTodo } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { due as dueOf } from '../../lib/format.ts';
import type { Card } from '../../lib/types.ts';
import { AgeDots, LabelDot, PriorityIcon, StateChip } from '../marks.tsx';
import { AgentAvatar, PartyAvatar } from '../ui.tsx';

export const CardFace = memo(function CardFace({ card, agingDays, selected, ghost, compact }: { card: Card; agingDays: number; selected?: boolean; ghost?: boolean; compact?: boolean }): React.JSX.Element {
  const d = dueOf(card.due);
  const working = card.agent_state === 'working';
  const closed = card.category === 'done' || card.category === 'canceled';
  // The agent on the card shows while it works, even when the card is formally someone else's.
  const holder = working ? card.claimed_by : null;
  return (
    <div
      className={cn(
        'kb-tile relative overflow-hidden rounded-[var(--kb-radius)] border px-2.5 pb-2 pt-2 text-left',
        selected === true && 'border-[var(--kb-accent)] shadow-[0_0_0_3px_var(--kb-accent-soft)] hover:border-[var(--kb-accent)]',
        ghost === true && 'kb-ghost',
        card.proposed && 'border-dashed',
      )}
    >
      <div className="flex h-4 items-center gap-1.5 text-[11.5px] text-[var(--kb-muted)]">
        {card.priority > 0 && <PriorityIcon priority={card.priority} size={13} />}
        <span className="kb-num font-medium">{card.key}</span>
        <span className="flex-1" />
        {card.blocked && <Ban size={12} strokeWidth={2.2} aria-label="Blocked" className="text-[var(--kb-red)]" />}
        {!closed && <AgeDots days={card.age_days} limit={agingDays} />}
      </div>
      <div className={cn('mt-1 line-clamp-3 text-[13px] font-medium leading-[18px]', closed && 'text-[var(--kb-ink-2)]', card.category === 'canceled' && 'line-through')}>{card.title}</div>
      {working && card.progress !== '' && (
        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--kb-muted)]">
          <span aria-hidden className="h-3 w-px shrink-0 bg-[var(--kb-green)]" />
          <span className="truncate">{card.progress}</span>
        </div>
      )}
      {compact !== true && (card.labels.length > 0 || d.text !== '' || card.checklist.total > 0 || card.plan.total > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {card.labels.slice(0, 3).map((l) => (
            <span key={l.id} className="inline-flex h-5 max-w-[120px] items-center gap-1 rounded-full px-1.5 text-[11.5px] text-[var(--kb-ink-2)] ring-1 ring-inset ring-[var(--kb-hair)]">
              <LabelDot color={l.color} size={7} />
              <span className="truncate">{l.name}</span>
            </span>
          ))}
          {card.labels.length > 3 && <span className="text-[11.5px] text-[var(--kb-muted)]">+{card.labels.length - 3}</span>}
          {d.text !== '' && !closed && (
            <span className={cn('inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11.5px] ring-1 ring-inset ring-[var(--kb-hair)]', d.tone === 'red' ? 'text-[var(--kb-red)]' : d.tone === 'amber' ? 'text-[var(--kb-amber)]' : 'text-[var(--kb-ink-2)]')}>
              <CalendarDays size={11} aria-hidden />
              {d.text}
            </span>
          )}
          {card.checklist.total > 0 && (
            <span className={cn('kb-num inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11.5px] ring-1 ring-inset ring-[var(--kb-hair)]', card.checklist.done === card.checklist.total ? 'text-[var(--kb-green)]' : 'text-[var(--kb-ink-2)]')} title="Checklist">
              <ListChecks size={11} aria-hidden />
              {card.checklist.done}/{card.checklist.total}
            </span>
          )}
          {card.plan.total > 0 && !closed && (
            <span className="kb-num inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11.5px] text-[var(--kb-ink-2)] ring-1 ring-inset ring-[var(--kb-hair)]" title={card.claimed_by ? `${card.claimed_by.name}'s plan` : 'The plan'}>
              <ListTodo size={11} aria-hidden />
              {card.plan.done}/{card.plan.total}
            </span>
          )}
        </div>
      )}
      <div className="mt-2 flex min-h-5 items-center gap-1.5">
        <StateChip card={card} />
        <span className="flex-1" />
        {holder !== null ? <AgentAvatar agent={holder} size={20} dot="bg-[var(--kb-green)] kb-pulse" /> : <PartyAvatar party={card.assignee} size={20} />}
      </div>
      {working && <span aria-hidden className="kb-working-bar absolute bottom-0 left-0 right-0 h-[2px]" />}
    </div>
  );
});
