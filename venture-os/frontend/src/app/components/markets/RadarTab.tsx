/**
 * New companies (fix 3): the companies this thesis found and nobody has
 * decided on yet, screened ones first. Each row says who it is and what it
 * does, where it was found, and when, with Add to Inbox and Dismiss; a
 * selection does both at once, and a click opens the company in full.
 * Rows your AI agent has not screened yet carry a hollow dot.
 */
import { SourceLink } from './SourceLink.tsx';
import { useCallback, useState } from 'react';
import { ExternalLink, Inbox, Radar as RadarIcon, RefreshCw, Sparkle, X } from 'lucide-react';
import { Avatar, Button, DataTable, Empty, IconButton, LoadError, Skeleton, StatusDot, Tag } from '../ui.tsx';
import type { Column } from '../ui.tsx';
import { useOp } from '../../lib/live.ts';
import { addToInbox, dismiss } from './actions.ts';
import { SignalSheet } from './SignalSheet.tsx';
import type { Signal, ThesisTile } from './types.ts';
import { agoWords } from './types.ts';

const PAGE = 50;

export function RadarTab({ thesis, canEdit, onRun }: { thesis: ThesisTile; canEdit: boolean; onRun: () => void }): React.JSX.Element {
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Signal | null>(null);
  const live = useOp<{ signals: Signal[]; total: number }>('signals.list', { thesis: thesis.id, limit }, ['signals', 'radars'], { name: 'markets.signals', keep: true });
  const more = useCallback(() => setLimit((l) => Math.min(500, l + PAGE)), []);
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />;
  const rows = live.data.signals;
  const columns: Column<Signal>[] = [
    {
      key: 'company',
      label: 'Company',
      fixed: true,
      phone: 'title',
      width: 'minmax(260px,3fr)',
      sort: (r) => r.display.toLowerCase(),
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={r.display} size={22} square />
          <span className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-2">
            <span className="flex min-w-0 shrink-0 items-center gap-2">
              <span className="truncate font-medium text-[var(--vo-ink)]">{r.display}</span>
              {r.status === 'new' && <StatusDot tone="faint" title="Your AI agent has not screened it yet" />}
            </span>
            <span className="min-w-0 truncate text-[12px] text-[var(--vo-muted)] md:text-[13px]">{r.summary !== '' ? r.summary : r.title !== r.display ? r.title : ''}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'source',
      label: 'Where found',
      width: '160px',
      sort: (r) => r.source_label,
      render: (r) =>
        r.source_url !== '' ? (
          <SourceLink href={r.source_url} icon={r.source === 'agent' ? Sparkle : ExternalLink} title="Open where it was found (new tab)">
            {r.source === 'agent' ? 'Your AI agent' : r.source_label}
          </SourceLink>
        ) : (
          <Tag>{r.source === 'agent' ? 'Your AI agent' : r.source_label}</Tag>
        ),
    },
    { key: 'seen', label: 'Found', width: '120px', align: 'right', sort: (r) => r.created, render: (r) => <span className="text-[var(--vo-muted)]">{agoWords(r.created)}</span> },
  ];
  if (canEdit)
    columns.push({
      key: 'act',
      label: '',
      width: '160px',
      fixed: true,
      phone: 'end',
      render: (r) => (
        <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" icon={Inbox} aria-label="Add to Inbox" title="Add it to the Inbox to decide on it like any inbound deal" onClick={() => void addToInbox([r.id])}>
            <span className="hidden md:inline">Add to Inbox</span>
          </Button>
          <IconButton icon={X} label="Dismiss: not for us" onRow size={28} onClick={() => void dismiss([r.id])} />
        </span>
      ),
    });
  return (
    <>
      <DataTable
        label="New companies"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpen(r)}
        selectable={canEdit}
        selected={selected}
        onSelect={setSelected}
        selectionBar={(ids, clear) => (
          <>
            <Button size="sm" icon={Inbox} onClick={() => void addToInbox(ids).then(clear)}>
              Add to Inbox
            </Button>
            <Button size="sm" icon={X} onClick={() => void dismiss(ids).then(clear)}>
              Dismiss
            </Button>
          </>
        )}
        hasMore={live.data.total > rows.length}
        onMore={more}
        stickyTop={56}
        viewScope="markets.radar"
        empty={
          <Empty
            icon={RadarIcon}
            title={thesis.radar === null ? 'This thesis is not looking for companies yet' : 'New companies this thesis finds will appear here'}
            action={
              canEdit && thesis.radar !== null ? (
                <Button icon={RefreshCw} onClick={onRun}>
                  Check now
                </Button>
              ) : undefined
            }
          />
        }
      />
      <SignalSheet signal={open} onClose={() => setOpen(null)} />
    </>
  );
}
