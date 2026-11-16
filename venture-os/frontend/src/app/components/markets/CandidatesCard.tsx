/**
 * Focus card body for a radar run's candidates (NextItem card 'candidates',
 * data.candidates from lib_markets.needsYou): each candidate with its one
 * line and source link, and Add to Inbox or Dismiss on its row. A decided
 * row folds away; the card leaves Next when every row is decided (or with
 * the card's own Add all and Dismiss all).
 */
import { SourceLink } from './SourceLink.tsx';
import { useState } from 'react';
import { ExternalLink, Inbox, Sparkle, X } from 'lucide-react';
import { AgentTag, Avatar, Button, IconButton, StatusDot, Tag } from '../ui.tsx';
import { NEXT_READS } from '../next.tsx';
import type { CardProps } from '../../lib/contract.ts';
import { op } from '../../lib/api.ts';
import { act } from '../../lib/live.ts';
import { word } from './types.ts';

interface Brief {
  id: string;
  display: string;
  summary: string;
  title: string;
  source: string;
  source_label: string;
  source_url: string;
  kind: string;
  licence: string;
  status: string;
}

export function CandidatesCard({ item }: CardProps): React.JSX.Element {
  const list = Array.isArray(item.data?.['candidates']) ? (item.data['candidates'] as Brief[]) : [];
  const more = typeof item.data?.['more'] === 'number' ? (item.data['more'] as number) : 0;
  const [gone, setGone] = useState<Set<string>>(new Set());
  const decide = async (id: string, add: boolean): Promise<void> => {
    setGone((g) => new Set(g).add(id));
    const out = await act([], () => (add ? op('signals.to-inbox', { signals: [id] }) : op('signals.dismiss', { signals: [id] })), NEXT_READS);
    if (out === null)
      setGone((g) => {
        const n = new Set(g);
        n.delete(id);
        return n;
      });
  };
  return (
    <ul aria-label="Candidates" className="flex flex-col divide-y divide-[var(--vo-hair)] rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)]">
      {list.map((c) => (
        <li key={c.id} data-gone={gone.has(c.id) ? 'true' : undefined} className="vo-fold">
          <div className="flex min-h-11 min-w-0 items-center gap-2.5 px-3 py-1.5 transition-colors duration-150 hover:bg-[var(--vo-hover)]">
            <Avatar name={c.display} size={24} square />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-[var(--vo-ink)]">{c.display}</span>
                {c.status === 'candidate' && c.source !== 'person' && <AgentTag />}
                {c.status === 'new' && <StatusDot tone="faint" title="Waiting for your AI agent" />}
              </span>
              {(c.summary !== '' || c.title !== c.display) && <span className="vo-wrap text-[12px] leading-4 text-[var(--vo-muted)]">{c.summary !== '' ? c.summary : c.title}</span>}
            </span>
            {c.source_url !== '' ? (
              <SourceLink href={c.source_url} icon={c.source === 'agent' ? Sparkle : ExternalLink} title={word(c.kind)} className="hidden sm:inline-flex">
                {c.source_label}
              </SourceLink>
            ) : (
              <Tag className="hidden sm:inline-flex">{c.source_label}</Tag>
            )}
            <IconButton icon={X} label="Dismiss" onRow size={30} onClick={() => void decide(c.id, false)} />
            <Button size="sm" icon={Inbox} aria-label="Add to Inbox" title="Add to Inbox" onClick={() => void decide(c.id, true)}>
              <span className="hidden sm:inline">Add to Inbox</span>
            </Button>
          </div>
        </li>
      ))}
      {more > 0 && <li className="vo-mono px-3 py-2 text-[12px] text-[var(--vo-muted)]">{`+${more}`}</li>}
    </ul>
  );
}
