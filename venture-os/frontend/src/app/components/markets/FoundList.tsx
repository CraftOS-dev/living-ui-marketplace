/**
 * "New companies found" (fix 3): the newest candidates across every
 * thesis, each with its one line, where it was found (the source opens in
 * a new tab, and the thesis that found it) and Add to Inbox. Dismiss sits
 * beside it; the full list of a thesis is one click away.
 */
import { Inbox, Radar as RadarIcon, Sparkle, ExternalLink, X } from 'lucide-react';
import { Avatar, Button, Empty, IconButton, LoadError, Skeleton, StatusDot } from '../ui.tsx';
import { useOp } from '../../lib/live.ts';
import { addToInbox, dismiss } from './actions.ts';
import { SourceLink } from './SourceLink.tsx';
import type { Signal, ThesisTile } from './types.ts';
import { agoWords } from './types.ts';

const READS = ['signals', 'radars', 'theses'];

export function FoundList({ tiles, canEdit, limit = 6, onOpenThesis, emptyAction }: { tiles: ThesisTile[]; canEdit: boolean; limit?: number | undefined; onOpenThesis: (id: string) => void; emptyAction?: React.ReactNode }): React.JSX.Element {
  const live = useOp<{ signals: Signal[]; total: number }>('signals.list', { status: 'candidate', limit }, READS, { name: 'markets.found', keep: true });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" />;
  const rows = live.data.signals;
  const thesisName = (id: string): string => tiles.find((t) => t.id === id)?.name ?? '';
  if (rows.length === 0) return <Empty icon={RadarIcon} title="Companies your theses find will appear here" action={emptyAction} />;
  return (
    <ul aria-label="New companies found" className="flex min-w-0 flex-col">
      {rows.map((s) => (
        <li key={s.id} className="flex min-w-0 items-start gap-3 border-b border-[var(--vo-hair)] py-2.5 last:border-b-0">
          <Avatar name={s.display} size={28} square />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2">
              {s.website !== '' ? (
                <a href={s.website} target="_blank" rel="noreferrer" title="Open the website" className="vo-focus vo-wrap min-w-0 rounded-[3px] text-[13px] font-semibold text-[var(--vo-ink)] hover:underline hover:decoration-[var(--vo-line-2)] hover:underline-offset-[3px]">
                  {s.display}
                </a>
              ) : (
                <span className="vo-wrap min-w-0 text-[13px] font-semibold text-[var(--vo-ink)]">{s.display}</span>
              )}
              {s.status === 'new' && <StatusDot tone="faint" title="Your AI agent has not screened it yet" />}
            </span>
            {(s.summary !== '' || s.title !== s.display) && <span className="vo-wrap text-[12px] leading-[17px] text-[var(--vo-ink-2)]">{s.summary !== '' ? s.summary : s.title}</span>}
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--vo-muted)]">
              {s.source_url !== '' ? (
                <SourceLink href={s.source_url} tone="faint" icon={s.source === 'agent' ? Sparkle : ExternalLink} title="Where it was found (opens in a new tab)">
                  {s.source === 'agent' ? 'Found by your AI agent' : `Found on ${s.source_label}`}
                </SourceLink>
              ) : (
                <span>{s.source === 'agent' ? 'Found by your AI agent' : `Found on ${s.source_label}`}</span>
              )}
              {thesisName(s.thesis) !== '' && (
                <button type="button" onClick={() => onOpenThesis(s.thesis)} className="vo-focus vo-wrap min-w-0 cursor-pointer rounded-[3px] text-left hover:text-[var(--vo-ink)] hover:underline hover:decoration-[var(--vo-line-2)] hover:underline-offset-[3px]">
                  {`for ${thesisName(s.thesis)}`}
                </button>
              )}
              <span className="shrink-0">{agoWords(s.created)}</span>
            </span>
          </div>
          {canEdit && (
            <span className="flex shrink-0 items-center gap-1">
              <Button size="sm" icon={Inbox} aria-label="Add to Inbox" onClick={() => void addToInbox([s.id])} title="Add it to the Inbox to decide on it like any inbound deal">
                <span className="hidden sm:inline">Add to Inbox</span>
              </Button>
              <IconButton icon={X} label="Dismiss: not for us" size={28} onClick={() => void dismiss([s.id])} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
