import { useState, useEffect } from 'react';
import type { AudioSession, ActiveTab } from '../types.ts';
import {
  Star,
  Download,
  Copy,
  Trash2,
  FileText,
  BookOpen,
  ListChecks,
  Layers,
  Sparkles,
  Check,
  Calendar,
  Users,
  Sun,
  Moon,
  Music,
} from 'lucide-react';
import { Button, Dialog } from '../../kit/index.ts';
import { generateSessionMarkdown, downloadFile, downloadAudioFile, formatDate, formatDuration } from '../utils.ts';
import { CategorySelect } from './CategorySelect.tsx';

interface SessionHeaderProps {
  session: AudioSession;
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onUpdateTitle: (title: string) => void;
  onUpdateCategory?: (category: string) => void;
  onToggleStar: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUpdateSession?: (fields: Partial<AudioSession>) => void;
  themeMode?: 'light' | 'dark' | undefined;
  onToggleTheme?: (() => void) | undefined;
  audioUrl?: string | null | undefined;
}

export function SessionHeader({
  session,
  activeTab,
  onTabChange,
  onUpdateTitle,
  onUpdateCategory,
  onToggleStar,
  onDuplicate,
  onDelete,
  onUpdateSession,
  themeMode = 'dark',
  onToggleTheme,
  audioUrl,
}: SessionHeaderProps): React.JSX.Element {
  const [titleValue, setTitleValue] = useState(session.title || '');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setTitleValue(session.title || '');
  }, [session.id, session.title]);

  const saveTitle = () => {
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== session.title) {
      onUpdateTitle(trimmed);
    } else if (!trimmed) {
      setTitleValue(session.title || 'Untitled note');
    }
  };

  const handleExportMarkdown = () => {
    const md = generateSessionMarkdown(session);
    const safeTitle = (session.title || 'note').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadFile(md, `${safeTitle}.md`, 'text/markdown');
    setShowExportMenu(false);
  };

  const handleExportJSON = () => {
    const json = JSON.stringify(session, null, 2);
    const safeTitle = (session.title || 'note').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadFile(json, `${safeTitle}.json`, 'application/json');
    setShowExportMenu(false);
  };

  return (
    <div className="flex flex-col gap-4 pt-1">
      {/* Top Action & Breadcrumb Bar */}
      <div className="flex items-center justify-between text-xs text-[var(--lui-muted)]">
        {/* Category & Status */}
        <div className="flex items-center gap-2">
          {onUpdateCategory ? (
            <CategorySelect
              value={session.category || 'General'}
              onChange={onUpdateCategory}
              size="sm"
            />
          ) : (
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--lui-card)] border border-[var(--lui-border)] text-[var(--lui-foreground)]">
              {session.category || 'General'}
            </span>
          )}
          <span>•</span>
          <span className="flex items-center gap-1 font-mono text-[11.5px] tabular-numbers">
            <Calendar size={12} className="opacity-70" />
            {formatDate(session.date)}
          </span>
          {session.duration > 0 && (
            <>
              <span>•</span>
              <span className="font-mono text-[11.5px] tabular-numbers">
                {formatDuration(session.duration)}
              </span>
            </>
          )}
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleStar}
            title={session.is_starred ? 'Remove star' : 'Star note'}
            className={`p-1.5 rounded-md hover:bg-[var(--lui-accent)] transition-colors ${
              session.is_starred ? 'text-amber-500' : 'text-[var(--lui-muted)] hover:text-amber-500'
            }`}
          >
            <Star size={15} fill={session.is_starred ? 'currentColor' : 'none'} />
          </button>

          {/* Export */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="p-1.5 rounded-md text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)] transition-colors"
              title="Export note"
            >
              <Download size={15} />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 mt-1 w-44 rounded-lg bg-[var(--lui-card)] border border-[var(--lui-border)] shadow-md z-30 py-1 text-xs">
                <button
                  onClick={handleExportMarkdown}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--lui-accent)] text-[var(--lui-foreground)] flex items-center gap-2 transition-colors"
                >
                  <FileText size={13} />
                  <span>Markdown (.md)</span>
                </button>
                <button
                  onClick={handleExportJSON}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--lui-accent)] text-[var(--lui-foreground)] flex items-center gap-2 transition-colors"
                >
                  <Layers size={13} />
                  <span>JSON (.json)</span>
                </button>

                {audioUrl && (
                  <button
                    onClick={() => {
                      void downloadAudioFile(audioUrl, session.title || 'recording');
                      setShowExportMenu(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--lui-accent)] text-[var(--lui-foreground)] flex items-center gap-2 transition-colors border-t border-[var(--lui-border)]/40 mt-0.5 pt-1.5"
                  >
                    <Music size={13} />
                    <span>Audio Recording</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            onClick={onDuplicate}
            className="p-1.5 rounded-md text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)] transition-colors"
            title="Duplicate note"
          >
            <Copy size={15} />
          </button>

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1.5 rounded-md text-[var(--lui-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
            title="Delete note"
          >
            <Trash2 size={15} />
          </button>

          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              className="p-1.5 rounded-md text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] hover:bg-[var(--lui-accent)]/20 transition-colors"
              title={themeMode === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'}
            >
              {themeMode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          )}
        </div>
      </div>

      {/* Large Clean Document Title - Directly editable */}
      <div className="min-w-0">
        <input
          type="text"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              saveTitle();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Untitled note"
          className="w-full text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight bg-transparent text-[var(--lui-foreground)] placeholder:text-[var(--lui-muted)]/40 focus:outline-none border-b border-transparent hover:border-[var(--lui-border)]/50 focus:border-[var(--lui-border)] transition-colors py-0.5"
          title="Click to edit title"
        />

        {/* Attendees subtitle */}
        <div className="flex items-center gap-1.5 text-xs lg:text-sm text-[var(--lui-muted)] mt-1">
          <Users size={13} className="opacity-70 text-[#FF4F18]" />
          {session.attendees ? (
            <button
              type="button"
              onClick={() => onTabChange('overview')}
              className="truncate hover:text-[var(--lui-foreground)] text-left hover:underline underline-offset-2 transition-colors cursor-pointer"
              title="Click to view or edit members in Overview"
            >
              <span>{session.attendees}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onTabChange('overview')}
              className="text-[11.5px] text-[var(--lui-muted)]/70 hover:text-[#FF4F18] transition-colors cursor-pointer"
              title="Click to add members present in Overview"
            >
              + Add members present
            </button>
          )}
        </div>
      </div>

      {/* Clean Segmented Tab Navigation - Adaptive scroll on mobile */}
      <div className="flex items-center gap-1 border-b border-[var(--lui-border)]/60 pt-2 lg:pt-3 text-xs lg:text-sm overflow-x-auto no-scrollbar scroll-smooth">
        <button
          onClick={() => onTabChange('overview')}
          className={`pb-2.5 px-3 lg:px-4 lg:py-2 font-medium transition-colors border-b-2 -mb-[1px] flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
            activeTab === 'overview'
              ? 'border-[#FF4F18] text-[var(--lui-foreground)] font-semibold'
              : 'border-transparent text-[var(--lui-muted)] hover:text-[var(--lui-foreground)]'
          }`}
        >
          <FileText size={14} className={activeTab === 'overview' ? 'text-[#FF4F18]' : ''} />
          <span>Overview</span>
        </button>

        <button
          onClick={() => onTabChange('summary')}
          className={`pb-2.5 px-3 lg:px-4 lg:py-2 font-medium transition-colors border-b-2 -mb-[1px] flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
            activeTab === 'summary'
              ? 'border-[#FF4F18] text-[var(--lui-foreground)] font-semibold'
              : 'border-transparent text-[var(--lui-muted)] hover:text-[var(--lui-foreground)]'
          }`}
        >
          <BookOpen size={14} className={activeTab === 'summary' ? 'text-[#FF4F18]' : ''} />
          <span>Summary</span>
        </button>

        <button
          onClick={() => onTabChange('highlights')}
          className={`pb-2.5 px-3 lg:px-4 lg:py-2 font-medium transition-colors border-b-2 -mb-[1px] flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
            activeTab === 'highlights'
              ? 'border-[#FF4F18] text-[var(--lui-foreground)] font-semibold'
              : 'border-transparent text-[var(--lui-muted)] hover:text-[var(--lui-foreground)]'
          }`}
        >
          <ListChecks size={14} className={activeTab === 'highlights' ? 'text-[#FF4F18]' : ''} />
          <span>Key Highlights</span>
        </button>

        <button
          onClick={() => onTabChange('all')}
          className={`pb-2.5 px-3 lg:px-4 lg:py-2 font-medium transition-colors border-b-2 -mb-[1px] flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
            activeTab === 'all'
              ? 'border-[#FF4F18] text-[var(--lui-foreground)] font-semibold'
              : 'border-transparent text-[var(--lui-muted)] hover:text-[var(--lui-foreground)]'
          }`}
        >
          <Layers size={14} className={activeTab === 'all' ? 'text-[#FF4F18]' : ''} />
          <span>All Sections</span>
        </button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete this note?"
        description={`"${session.title}" and its associated notes will be permanently removed.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setShowDeleteConfirm(false);
                onDelete();
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
    </div>
  );
}
