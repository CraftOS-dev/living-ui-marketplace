/**
 * The board's small marks: a column category icon (drawn like a progress
 * ring, so the stage reads at a glance), priority bars, label dots, and the
 * one chip that says where the agent on a card is with it.
 */
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Ban, Clock, Eye, Lightbulb, ListChecks, MessageCircleQuestion, ShieldQuestion } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import type { Card, Category, LabelColor } from '../lib/types.ts';
import type { ChipTone } from './ui.tsx';
import { Chip } from './ui.tsx';

export const CATEGORY_LABEL: Record<Category, string> = {
  triage: 'Proposed',
  backlog: 'Backlog',
  todo: 'To do',
  doing: 'In progress',
  review: 'Review',
  done: 'Done',
  canceled: 'Canceled',
};

export const CATEGORY_HINT: Record<Category, string> = {
  triage: 'Cards agents propose wait here until a person accepts them',
  backlog: 'Not planned yet',
  todo: 'Ready to start',
  doing: 'Being worked on (by people or agents)',
  review: 'Waits for a person\'s review: approve, request changes or reject',
  done: 'Finished (only people move cards here)',
  canceled: 'Dropped',
};

export function CategoryIcon({ category, size = 14, className }: { category: Category; size?: number; className?: string }): React.JSX.Element {
  const s = size;
  const c = s / 2;
  const r = s / 2 - 1.25;
  const common = { width: s, height: s, viewBox: `0 0 ${s} ${s}`, className: cn('shrink-0', className), 'aria-hidden': true } as const;
  if (category === 'triage')
    return (
      <svg {...common} style={{ color: 'var(--kb-violet)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.5 2" />
        <circle cx={c} cy={c} r={s / 7} fill="currentColor" />
      </svg>
    );
  if (category === 'backlog')
    return (
      <svg {...common} style={{ color: 'var(--kb-muted)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.8" />
      </svg>
    );
  if (category === 'todo')
    return (
      <svg {...common} style={{ color: 'var(--kb-ink-2)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  if (category === 'doing' || category === 'review') {
    const frac = category === 'doing' ? 0.5 : 0.75;
    const ir = r - 2;
    const a = frac * Math.PI * 2;
    const x = c + ir * Math.sin(a);
    const y = c - ir * Math.cos(a);
    return (
      <svg {...common} style={{ color: category === 'doing' ? 'var(--kb-amber)' : 'var(--kb-blue)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d={`M ${c} ${c} L ${c} ${c - ir} A ${ir} ${ir} 0 ${frac > 0.5 ? 1 : 0} 1 ${x} ${y} Z`} fill="currentColor" />
      </svg>
    );
  }
  if (category === 'done')
    return (
      <svg {...common} style={{ color: 'var(--kb-green)' }}>
        <circle cx={c} cy={c} r={r + 0.75} fill="currentColor" />
        <path d={`M ${s * 0.3} ${s * 0.52} L ${s * 0.45} ${s * 0.66} L ${s * 0.71} ${s * 0.38}`} fill="none" stroke="var(--kb-main)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  return (
    <svg {...common} style={{ color: 'var(--kb-muted)' }}>
      <circle cx={c} cy={c} r={r + 0.75} fill="currentColor" />
      <path d={`M ${s * 0.36} ${s * 0.36} L ${s * 0.64} ${s * 0.64} M ${s * 0.64} ${s * 0.36} L ${s * 0.36} ${s * 0.64}`} stroke="var(--kb-main)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export const PRIORITY_LABEL = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

export function PriorityIcon({ priority, size = 14 }: { priority: number; size?: number }): React.JSX.Element {
  const s = size;
  if (priority === 1)
    return (
      <svg width={s} height={s} viewBox="0 0 14 14" aria-label="Urgent" className="shrink-0" style={{ color: 'var(--kb-red)' }}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <rect x="6.25" y="3.5" width="1.5" height="4.5" rx="0.75" fill="var(--kb-main)" />
        <circle cx="7" cy="10" r="0.9" fill="var(--kb-main)" />
      </svg>
    );
  if (priority === 0)
    return (
      <svg width={s} height={s} viewBox="0 0 14 14" aria-label="No priority" className="shrink-0" style={{ color: 'var(--kb-faint)' }}>
        {[2, 6, 10].map((x) => (
          <rect key={x} x={x - 0.5} y="6.25" width="2.5" height="1.5" rx="0.5" fill="currentColor" />
        ))}
      </svg>
    );
  const lit = priority === 2 ? 3 : priority === 3 ? 2 : 1;
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" aria-label={PRIORITY_LABEL[priority]} className="shrink-0" style={{ color: 'var(--kb-ink-2)' }}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={4 + i * 3} rx="0.75" fill="currentColor" opacity={i < lit ? 1 : 0.25} />
      ))}
    </svg>
  );
}

export function LabelDot({ color, size = 8 }: { color: LabelColor; size?: number }): React.JSX.Element {
  return <span aria-hidden className={`kb-dot-${color} inline-block shrink-0 rounded-full`} style={{ width: size, height: size, background: 'var(--d)' }} />;
}

/** Where the agent on a card is with it, as one chip (or null when no agent is involved). */
export function stateOf(card: Card): { tone: ChipTone; icon?: LucideIcon; label: string; pulse?: boolean; title?: string | undefined } | null {
  if (card.agent_state === 'working') return { tone: 'green', pulse: true, label: 'Working', title: card.progress || undefined };
  if (card.agent_state === 'needs_input') {
    const k = card.question?.kind;
    return { tone: 'amber', icon: k === 'plan' ? ListChecks : k === 'criteria' ? ShieldQuestion : MessageCircleQuestion, label: k === 'plan' ? 'Plan to approve' : k === 'criteria' ? 'Needs criteria' : 'Question', title: card.question?.text };
  }
  if (card.agent_state === 'needs_attention') return { tone: 'red', icon: AlertTriangle, label: 'Needs attention', title: card.attention };
  if (card.review_state === 'pending') return { tone: 'blue', icon: Eye, label: 'In review' };
  if (card.agent_state === 'queued') return { tone: 'neutral', icon: Clock, label: 'Queued', title: card.assignee?.kind === 'pool' ? 'Waiting for any agent' : card.assignee ? `Waiting for ${card.assignee.name}` : undefined };
  if (card.proposed) return { tone: 'violet', icon: Lightbulb, label: 'Proposed' };
  return null;
}

export function StateChip({ card }: { card: Card }): React.JSX.Element | null {
  const s = stateOf(card);
  if (s === null) return card.blocked ? <Chip tone="red" icon={Ban} title={card.blocked_reason}>Blocked</Chip> : null;
  return (
    <Chip tone={s.tone} icon={s.icon} pulse={s.pulse ?? false} title={s.title}>
      {s.label}
    </Chip>
  );
}

/** Days in the current column as Jira-style dots: quiet at first, amber, then red. */
export function AgeDots({ days, limit }: { days: number; limit: number }): React.JSX.Element | null {
  if (days < 1) return null;
  const warn = limit > 0 ? limit : 3;
  const tone = days >= warn * 1.7 ? 'var(--kb-red)' : days >= warn ? 'var(--kb-amber)' : 'var(--kb-faint)';
  const n = days >= warn * 4 ? 4 : days >= warn * 1.7 ? 3 : days >= warn ? 2 : 1;
  return (
    <span title={`${days} day${days === 1 ? '' : 's'} in this column`} className="inline-flex items-center gap-[2px]">
      {[0, 1, 2, 3].slice(0, Math.max(n, 1)).map((i) => (
        <span key={i} className="size-[5px] rounded-full" style={{ background: tone }} />
      ))}
    </span>
  );
}
