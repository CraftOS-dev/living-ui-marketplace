import { useMemo } from 'react';
import {
  AlertTriangle,
  AudioLines,
  CalendarDays,
  FileText,
  Loader2,
  Mic,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Star,
  Upload,
  VolumeX,
  X,
} from 'lucide-react';
import { Button, DropdownMenu, cn } from '../../kit/index.ts';
import { clock, dayGroup, fmtDay, length } from '../format.ts';
import type { EngineStatus, NoteSummary, View } from '../types.ts';
import { SelectField } from './ui.tsx';

function StatusIcon({ note, recording }: { note: NoteSummary; recording: boolean }): React.JSX.Element | null {
  const t = note.transcript_status;
  const n = note.notes_status;
  if (recording) return <span className="size-2 animate-pulse rounded-full bg-red-500" aria-label="Recording" />;
  if (t === 'queued' || t === 'processing' || t === 'finishing' || n === 'queued' || n === 'processing') {
    return <Loader2 size={14} className="animate-spin text-[var(--agent-app-accent)]" aria-label="Processing" />;
  }
  if (t === 'failed' || n === 'failed') return <AlertTriangle size={14} className="text-red-500" aria-label="Failed" />;
  if (t === 'no_speech') return <VolumeX size={14} className="text-amber-500" aria-label="No speech found" />;
  return null;
}

function SourceIcon({ note }: { note: NoteSummary }): React.JSX.Element {
  const cls = 'shrink-0 text-[var(--agent-app-muted)]';
  if (note.source === 'text') return <FileText size={16} className={cls} />;
  if (note.source === 'upload' || note.source === 'import') return <AudioLines size={16} className={cls} />;
  return <Mic size={16} className={cls} />;
}

export function Sidebar({
  notes,
  matchIds,
  query,
  onQuery,
  filter,
  onFilter,
  view,
  onSelect,
  onDigest,
  onRecord,
  onUpload,
  onNewText,
  recordingNoteId,
  recordingMs,
  engine,
  collapsed,
  onToggleCollapse,
  className,
}: {
  notes: NoteSummary[];
  matchIds: Set<string> | null;
  query: string;
  onQuery: (q: string) => void;
  filter: string;
  onFilter: (f: string) => void;
  view: View;
  onSelect: (id: string) => void;
  onDigest: () => void;
  onRecord: () => void;
  onUpload: () => void;
  onNewText: () => void;
  recordingNoteId: string | null;
  recordingMs: number;
  engine: EngineStatus | null;
  /** Desktop only: the sidebar folds into a narrow rail of icons. */
  collapsed: boolean;
  onToggleCollapse: () => void;
  className?: string | undefined;
}): React.JSX.Element {
  const categories = useMemo(() => [...new Set(notes.map((n) => n.category).filter((c) => c !== ''))].sort(), [notes]);
  const visible = notes.filter((n) => {
    if (filter === 'starred' && !n.starred) return false;
    if (filter.startsWith('cat:') && n.category !== filter.slice(4)) return false;
    return matchIds === null || matchIds.has(n.id);
  });
  const groups: Array<{ label: string; notes: NoteSummary[] }> = [];
  for (const n of visible) {
    const label = dayGroup(n.date);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.label === label) last.notes.push(n);
    else groups.push({ label, notes: [n] });
  }
  const selectedId = view.kind === 'note' ? view.id : '';
  const recording = recordingNoteId !== null;
  const setup = engine?.setup ?? null;
  const downloading = setup !== null && (setup.state === 'pending' || setup.state === 'downloading' || setup.state === 'installing');
  const engineDot = cn(
    'size-1.5 shrink-0 rounded-full',
    engine === null
      ? 'bg-[var(--agent-app-muted)]'
      : downloading
        ? 'animate-pulse bg-amber-500'
        : engine.installed && setup?.state === 'ready'
          ? 'bg-emerald-500'
          : 'bg-red-500',
  );
  let engineText = 'Checking speech engine...';
  if (engine !== null && setup !== null) {
    if (setup.state === 'downloading' || setup.state === 'installing') {
      const percent = setup.total_bytes > 0 ? Math.floor((setup.done_bytes / setup.total_bytes) * 100) : 0;
      engineText = `Downloading speech engine... ${percent}%`;
    } else if (setup.state === 'pending') engineText = 'Preparing speech engine download...';
    else if (setup.state === 'failed') engineText = 'Speech engine download failed';
    else if (engine.installed && setup.state === 'ready') engineText = `${engine.model}, on this PC`;
    else engineText = 'Speech engine not installed';
  }
  const railButton =
    'inline-flex size-9 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]';

  return (
    <>
    {collapsed && (
      <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] md:flex" aria-label="Sidebar (collapsed)">
        <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-[var(--agent-app-border)]">
          <span className="flex size-7 items-center justify-center rounded-[var(--agent-app-radius)] bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)]">
            <AudioLines size={16} />
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5 py-3">
          <button type="button" onClick={onToggleCollapse} aria-label="Expand sidebar" title="Expand sidebar" className={railButton}>
            <PanelLeftOpen size={17} />
          </button>
          <button
            type="button"
            onClick={onRecord}
            aria-label={recording ? 'Open the recording' : 'New recording'}
            title={recording ? `Recording ${clock(recordingMs / 1000)}` : 'New recording'}
            className="mt-1 inline-flex size-9 items-center justify-center rounded-[var(--agent-app-radius)] bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)] transition-opacity hover:opacity-90"
          >
            <span aria-hidden className={cn('size-2.5 rounded-full bg-current', recording && 'animate-pulse')} />
          </button>
          <button type="button" onClick={onUpload} aria-label="Upload audio or video" title="Upload audio or video" className={railButton}>
            <Upload size={17} />
          </button>
          <span className="my-1 h-px w-6 bg-[var(--agent-app-border)]" aria-hidden />
          <button
            type="button"
            onClick={() => {
              onFilter('starred');
              onToggleCollapse();
            }}
            aria-label="Starred notes"
            title="Starred notes"
            className={railButton}
          >
            <Star size={17} />
          </button>
          <button
            type="button"
            onClick={onDigest}
            aria-label="Weekly digest"
            title="Weekly digest"
            className={cn(railButton, view.kind === 'digest' && 'bg-[var(--agent-app-selected)] text-[var(--agent-app-accent)]')}
          >
            <CalendarDays size={17} />
          </button>
        </div>
        <span className="mt-auto mb-4" title={engineText}>
          <span aria-hidden className={cn(engineDot, 'block size-2')} />
        </span>
      </aside>
    )}
    <aside
      className={cn(
        'w-full flex-col border-r border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] md:w-72 md:shrink-0',
        className,
        collapsed && 'md:hidden',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[var(--agent-app-border)] pl-4 pr-2">
        <span className="flex size-7 items-center justify-center rounded-[var(--agent-app-radius)] bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)]">
          <AudioLines size={16} />
        </span>
        <span className="flex-1 text-[15px] font-semibold tracking-tight">Audio Notes</span>
        <button type="button" onClick={onToggleCollapse} aria-label="Collapse sidebar" title="Collapse sidebar" className={cn(railButton, 'hidden size-8 md:inline-flex')}>
          <PanelLeftClose size={17} />
        </button>
      </div>

      <div className="flex flex-col gap-2.5 px-3 pb-3 pt-3">
        <div className="flex gap-2">
          <Button className="flex-1 whitespace-nowrap tabular-nums" onClick={onRecord} aria-label={recording ? 'Open the recording' : 'New recording'}>
            <span aria-hidden className={cn('size-2 rounded-full bg-current', recording && 'animate-pulse')} />
            {recording ? `Recording ${clock(recordingMs / 1000)}` : 'Record'}
          </Button>
          <Button variant="secondary" size="icon" onClick={onUpload} aria-label="Upload audio or video" title="Upload audio or video">
            <Upload size={16} />
          </Button>
          <DropdownMenu
            trigger={
              <span
                role="button"
                aria-label="More ways to add"
                title="More ways to add"
                className="inline-flex size-9 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]"
              >
                <MoreHorizontal size={16} />
              </span>
            }
            items={[
              { label: 'Upload audio or video', icon: <Upload size={14} />, onSelect: onUpload },
              { label: 'New note from text', icon: <FileText size={14} />, onSelect: onNewText },
            ]}
          />
        </div>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--agent-app-muted)]" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search notes and transcripts"
            aria-label="Search"
            className="h-9 w-full rounded-[var(--agent-app-radius)] border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-[var(--agent-app-muted)]/80 hover:border-[var(--agent-app-muted)]/50 focus:border-[var(--agent-app-accent)]"
          />
          {query !== '' && (
            <button
              type="button"
              onClick={() => onQuery('')}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <SelectField
          ariaLabel="Filter"
          value={filter}
          onChange={onFilter}
          options={[
            { value: 'all', label: `All notes (${notes.length})` },
            { value: 'starred', label: 'Starred' },
            ...categories.map((c) => ({ value: `cat:${c}`, label: c })),
          ]}
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--agent-app-border)] px-2 pb-2" aria-label="Notes">
        {visible.length === 0 && (
          <p className="px-3 py-10 text-center text-[13px] text-[var(--agent-app-muted)]">{notes.length === 0 ? 'No notes yet.' : 'Nothing matches.'}</p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-3 pb-1.5 pt-4 text-xs font-medium text-[var(--agent-app-muted)]">{g.label}</p>
            {g.notes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelect(n.id)}
                aria-current={n.id === selectedId ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-3 rounded-[var(--agent-app-radius)] px-3 py-2.5 text-left transition-colors',
                  n.id === selectedId ? 'bg-[var(--agent-app-selected)]' : 'hover:bg-[var(--agent-app-hover)]',
                )}
              >
                <span className="mt-0.5">
                  <SourceIcon note={n} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{n.title}</span>
                  <span className="truncate text-xs text-[var(--agent-app-muted)]">
                    {n.id === recordingNoteId
                      ? 'Recording now'
                      : [fmtDay(n.date, false), n.duration > 0 ? length(n.duration) : '', n.category].filter((x) => x !== '').join(' · ')}
                  </span>
                </span>
                <span className="mt-1 flex shrink-0 items-center gap-1.5">
                  <StatusIcon note={n} recording={n.id === recordingNoteId} />
                  {n.starred && <Star size={13} className="text-amber-500" fill="currentColor" aria-label="Starred" />}
                </span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-1 border-t border-[var(--agent-app-border)] p-2">
        <button
          type="button"
          onClick={onDigest}
          aria-current={view.kind === 'digest' ? 'page' : undefined}
          className={cn(
            'flex h-9 items-center gap-2.5 rounded-[var(--agent-app-radius)] px-3 text-sm transition-colors',
            view.kind === 'digest' ? 'bg-[var(--agent-app-selected)] font-medium text-[var(--agent-app-accent)]' : 'hover:bg-[var(--agent-app-hover)]',
          )}
        >
          <CalendarDays size={16} />
          Weekly digest
        </button>
        <p className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--agent-app-muted)]">
          <span aria-hidden className={engineDot} />
          <span className="truncate">{engineText}</span>
        </p>
      </div>
    </aside>
    </>
  );
}
