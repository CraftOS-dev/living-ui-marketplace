import { useState, useMemo, useRef } from 'react';
import type { AudioSession } from '../types.ts';
import { formatDuration, formatDate } from '../utils.ts';
import {
  Search,
  Star,
  Plus,
  PanelLeftClose,
  PanelLeft,
  Trash2,
  Copy,
  X,
  AudioLines,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button, Dialog } from '../../kit/index.ts';
import { CATEGORY_OPTIONS } from './CategorySelect.tsx';

interface SidebarProps {
  sessions: AudioSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (session: AudioSession) => void;
  onDuplicateSession: (session: AudioSession) => void;
  onToggleStar: (session: AudioSession) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  viewMode?: 'note' | 'weekly-summary';
  onViewModeChange?: (mode: 'note' | 'weekly-summary') => void;
}

const ALL_BASE_CATEGORIES = ['All', 'Starred', ...CATEGORY_OPTIONS];

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onDuplicateSession,
  onToggleStar,
  collapsed,
  onToggleCollapse,
  mobileOpen = false,
  onCloseMobile,
  viewMode = 'note',
  onViewModeChange,
}: SidebarProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sessionToDelete, setSessionToDelete] = useState<AudioSession | null>(null);
  const categoryScrollRef = useRef<HTMLDivElement | null>(null);

  const scrollCategories = (direction: 'left' | 'right') => {
    if (categoryScrollRef.current) {
      const amount = direction === 'left' ? -120 : 120;
      categoryScrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  // Derive complete category list including all standard options + any custom note categories
  const allCategories = useMemo(() => {
    const list = [...ALL_BASE_CATEGORIES];
    for (const s of sessions) {
      if (s.category && !list.some((c) => c.toLowerCase() === s.category.toLowerCase())) {
        list.push(s.category);
      }
    }
    return list;
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (selectedCategory === 'Starred' && !s.is_starred) {
        return false;
      }
      if (
        selectedCategory !== 'All' &&
        selectedCategory !== 'Starred' &&
        s.category?.toLowerCase() !== selectedCategory.toLowerCase()
      ) {
        return false;
      }

      if (searchQuery.trim() === '') return true;
      const query = searchQuery.toLowerCase();
      return (
        s.title?.toLowerCase().includes(query) ||
        s.overview?.toLowerCase().includes(query) ||
        s.summary?.toLowerCase().includes(query) ||
        s.transcript?.toLowerCase().includes(query) ||
        s.category?.toLowerCase().includes(query) ||
        s.attendees?.toLowerCase().includes(query)
      );
    });
  }, [sessions, searchQuery, selectedCategory]);

  const handleSelect = (id: string) => {
    onSelectSession(id);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  // Reusable Sidebar Content for both Desktop and Mobile Drawer
  const renderSidebarBody = (isMobile: boolean = false) => (
    <div className="flex flex-col h-full select-none">
      {/* Brand & Header */}
      <div className="p-4 pb-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AudioLines size={18} className="text-[var(--lui-foreground)] shrink-0" />
            <div>
              <h2 className="text-[14px] lg:text-[15px] font-semibold tracking-tight text-[var(--lui-foreground)]">
                Audio Notes
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                onNewSession();
                if (isMobile && onCloseMobile) onCloseMobile();
              }}
              title="New empty note"
              className="p-1.5 rounded-md bg-[#FF4F18] hover:bg-[#E64515] text-white transition-all shadow-xs flex items-center justify-center active:scale-95"
              aria-label="New empty note"
            >
              <Plus size={15} />
            </button>

            {isMobile ? (
              <button
                onClick={onCloseMobile}
                title="Close sidebar"
                className="p-1.5 rounded-md text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)]/20 transition-colors"
                aria-label="Close sidebar"
              >
                <X size={16} />
              </button>
            ) : (
              <button
                onClick={onToggleCollapse}
                title="Collapse sidebar"
                className="p-1.5 rounded-md hover:bg-[var(--lui-accent)]/20 text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose size={16} />
              </button>
            )}
          </div>
        </div>

        {/* View Mode Switcher: Notes vs Weekly Summary */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[var(--lui-surface)] border border-[var(--lui-border)]/70 text-xs select-none">
          <button
            type="button"
            onClick={() => {
              onViewModeChange?.('note');
              if (isMobile && onCloseMobile) onCloseMobile();
            }}
            className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors duration-150 border ${
              viewMode === 'note'
                ? 'bg-[var(--lui-card)] text-[var(--lui-foreground)] border-[var(--lui-border)]/60 shadow-xs'
                : 'bg-transparent text-[var(--lui-muted)] border-transparent hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-card)]/40'
            }`}
          >
            <AudioLines size={13} className={viewMode === 'note' ? 'text-[#FF4F18]' : 'text-current'} />
            <span>Notes</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onViewModeChange?.('weekly-summary');
              if (isMobile && onCloseMobile) onCloseMobile();
            }}
            className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors duration-150 border ${
              viewMode === 'weekly-summary'
                ? 'bg-[var(--lui-card)] text-[var(--lui-foreground)] border-[var(--lui-border)]/60 shadow-xs'
                : 'bg-transparent text-[var(--lui-muted)] border-transparent hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-card)]/40'
            }`}
          >
            <CalendarDays size={13} className={viewMode === 'weekly-summary' ? 'text-[#FF4F18]' : 'text-current'} />
            <span>Weekly Digest</span>
          </button>
        </div>

        {/* Minimal Search Bar */}
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--lui-muted)]/70 pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md bg-[var(--lui-background)]/80 border border-[var(--lui-border)]/60 text-[var(--lui-foreground)] placeholder:text-[var(--lui-muted)]/60 focus:outline-none focus:border-[var(--lui-primary)] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--lui-muted)] hover:text-[var(--lui-foreground)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Category Pills - Single line with arrows on the sides to move among them */}
        <div className="flex items-center gap-1 text-xs pt-0.5 w-full">
          <button
            onClick={() => scrollCategories('left')}
            className="p-1 rounded text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)]/20 transition-colors shrink-0"
            title="Scroll categories left"
          >
            <ChevronLeft size={13} />
          </button>

          <div
            ref={categoryScrollRef}
            className="flex items-center gap-1.5 flex-nowrap overflow-x-auto no-scrollbar scroll-smooth whitespace-nowrap flex-1 py-0.5"
          >
            {allCategories.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors shrink-0 whitespace-nowrap ${
                    isSelected
                      ? 'bg-[#FF4F18] text-white font-medium'
                      : 'bg-[var(--lui-surface)]/60 text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)]/20 border border-[var(--lui-border)]/40'
                  }`}
                >
                  {cat === 'Starred' ? '★ Starred' : cat}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => scrollCategories('right')}
            className="p-1 rounded text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)]/20 transition-colors shrink-0"
            title="Scroll categories right"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Note List */}
      <div className="flex-1 overflow-y-auto px-2.5 flex flex-col gap-1 pb-4">
        {filteredSessions.length === 0 ? (
          <div className="py-8 px-4 text-center text-[var(--lui-muted)]">
            <p className="text-xs font-medium">No notes found</p>
            <p className="text-[11px] mt-0.5 text-[var(--lui-muted)]/70">
              {searchQuery ? 'Try a different keyword' : 'Create a note to start'}
            </p>
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                onClick={() => handleSelect(session.id)}
                className={`sidebar-note-item group px-3 py-2.5 lg:px-3.5 lg:py-3 cursor-pointer relative flex flex-col gap-1 ${
                  isActive ? 'active' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <h3 className="note-title text-[13px] lg:text-[14px] font-medium tracking-tight line-clamp-1 flex-1 min-w-0 text-[var(--lui-foreground)]">
                    {session.title || 'Untitled note'}
                  </h3>

                  {/* Actions inline */}
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicateSession(session);
                      }}
                      title="Duplicate note"
                      className="p-1 text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Copy size={12} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSessionToDelete(session);
                      }}
                      title="Delete note"
                      className="p-1 text-[var(--lui-muted)] hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={12} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(session);
                      }}
                      title={session.is_starred ? 'Unstar' : 'Star'}
                      className={`p-1 rounded transition-colors ${
                        session.is_starred
                          ? 'text-amber-500'
                          : 'text-[var(--lui-muted)]/40 hover:text-amber-500 opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <Star
                        size={13}
                        fill={session.is_starred ? 'currentColor' : 'none'}
                      />
                    </button>
                  </div>
                </div>

                {/* Preview text */}
                <p className="note-preview text-[11.5px] text-[var(--lui-muted)] line-clamp-2 leading-relaxed font-normal">
                  {session.summary || session.overview || 'No notes added yet.'}
                </p>

                {/* Metadata row */}
                <div className="flex items-center justify-between text-[11px] text-[var(--lui-muted)]/80 pt-1 font-mono tabular-numbers">
                  <div className="flex items-center gap-2">
                    {session.category && (
                      <span className="note-badge text-[10px] font-sans font-medium px-1.5 py-0.2 rounded bg-[var(--lui-background)] border border-[var(--lui-border)]/50 text-[var(--lui-foreground)]/80">
                        {session.category}
                      </span>
                    )}
                    {session.duration > 0 && (
                      <span className="text-[10.5px]">
                        {formatDuration(session.duration)}
                      </span>
                    )}
                  </div>

                  <span className="text-[10.5px]">
                    {formatDate(session.date)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop View: Collapsed Rail vs Expanded Sidebar */}
      {collapsed ? (
        <aside className="hidden md:flex w-14 border-r border-[var(--lui-border)]/60 bg-[var(--lui-card)]/40 flex-col items-center py-4 justify-between transition-all duration-200 h-full flex-shrink-0 select-none">
          <div className="flex flex-col items-center gap-3 w-full">
            <button
              onClick={onToggleCollapse}
              title="Expand sidebar"
              className="p-2 rounded-lg hover:bg-[var(--lui-accent)]/20 text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors"
              aria-label="Expand sidebar"
            >
              <PanelLeft size={18} />
            </button>

            <button
              onClick={onNewSession}
              title="New note"
              className="w-9 h-9 rounded-lg bg-[var(--lui-foreground)] text-[var(--lui-background)] flex items-center justify-center shadow-xs hover:opacity-90 transition-opacity"
              aria-label="New note"
            >
              <Plus size={18} />
            </button>

            <div className="w-6 h-[1px] bg-[var(--lui-border)]/60 my-1" />

            <button
              onClick={() => {
                onViewModeChange?.(viewMode === 'weekly-summary' ? 'note' : 'weekly-summary');
              }}
              title="Weekly Summary Digest"
              className={`p-2 rounded-lg transition-colors ${
                viewMode === 'weekly-summary'
                  ? 'bg-[#FF4F18]/15 text-[#FF4F18]'
                  : 'hover:bg-[var(--lui-accent)]/20 text-[var(--lui-muted)]'
              }`}
            >
              <CalendarDays size={16} />
            </button>

            <button
              onClick={() => {
                setSelectedCategory(selectedCategory === 'Starred' ? 'All' : 'Starred');
                onToggleCollapse();
              }}
              title="Starred notes"
              className={`p-2 rounded-lg transition-colors ${
                selectedCategory === 'Starred'
                  ? 'bg-amber-500/10 text-amber-600'
                  : 'hover:bg-[var(--lui-accent)]/20 text-[var(--lui-muted)]'
              }`}
            >
              <Star size={16} fill={selectedCategory === 'Starred' ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="flex flex-col items-center gap-2">
            <span className="text-[11px] text-[var(--lui-muted)] font-mono tabular-numbers">
              {sessions.length}
            </span>
          </div>
        </aside>
      ) : (
        <aside className="hidden md:flex w-72 lg:w-80 xl:w-84 2xl:w-88 border-r border-[var(--lui-border)]/60 bg-[var(--lui-card)]/30 flex-col h-full flex-shrink-0 transition-all duration-200 select-none">
          {renderSidebarBody(false)}
        </aside>
      )}

      {/* Mobile Drawer (Adaptive Overlay on screens < 768px) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Darkened backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          {/* Slide-out drawer */}
          <aside className="relative z-10 w-78 max-w-[85vw] h-full bg-[var(--lui-card)] border-r border-[var(--lui-border)] shadow-2xl flex flex-col select-none">
            {renderSidebarBody(true)}
          </aside>
        </div>
      )}

      {/* Delete Note Confirmation Dialog */}
      {sessionToDelete && (
        <Dialog
          open={Boolean(sessionToDelete)}
          onOpenChange={(open) => {
            if (!open) setSessionToDelete(null);
          }}
          title="Delete this note?"
          description={`Are you sure you want to delete "${sessionToDelete.title || 'Untitled note'}"? All audio recordings, transcripts, and notes for this session will be permanently removed.`}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setSessionToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (sessionToDelete) {
                    onDeleteSession(sessionToDelete);
                    setSessionToDelete(null);
                  }
                }}
              >
                Delete Note
              </Button>
            </>
          }
        >
          <span />
        </Dialog>
      )}
    </>
  );
}
