import { useState, useMemo } from 'react';
import type { AudioSession, ActionItem } from '../types.ts';
import {
  formatDuration,
  formatDate,
  getStartOfWeek,
  getWeekKey,
  formatWeekRange,
  generateWeeklySummaryMarkdown,
  downloadFile,
} from '../utils.ts';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Download,
  Clock,
  CheckSquare,
  Users,
  ExternalLink,
  BookOpen,
  FileText,
  AlignLeft,
  Sparkles,
  Calendar,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface WeeklySummaryViewProps {
  sessions: AudioSession[];
  onOpenSession: (sessionId: string) => void;
  onUpdateSession: (sessionId: string, fields: Partial<AudioSession>) => void;
  onNewSession: () => void;
}

export function WeeklySummaryView({
  sessions,
  onOpenSession,
  onUpdateSession,
  onNewSession,
}: WeeklySummaryViewProps): React.JSX.Element {
  // Current active week (Monday date string)
  const currentWeekKey = useMemo(() => getWeekKey(new Date().toISOString().split('T')[0]), []);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>(currentWeekKey);
  const [copiedReport, setCopiedReport] = useState(false);

  // Group all available weeks from sessions
  const availableWeeks = useMemo(() => {
    const set = new Set<string>();
    set.add(currentWeekKey);
    sessions.forEach((s) => {
      const key = getWeekKey(s.date || s.created);
      if (key) set.add(key);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [sessions, currentWeekKey]);

  // Filter sessions that took place in the selected week
  const weekSessions = useMemo(() => {
    return sessions
      .filter((s) => {
        const key = getWeekKey(s.date || s.created);
        return key === selectedWeekKey;
      })
      .sort((a, b) => (a.date || a.created || '').localeCompare(b.date || b.created || ''));
  }, [sessions, selectedWeekKey]);

  // Metrics for the week
  const metrics = useMemo(() => {
    const totalDuration = weekSessions.reduce((sum, s) => sum + (s.duration || 0), 0);
    const allActions = weekSessions.flatMap((s) => s.action_items || []);
    const completedActions = allActions.filter((a) => a.completed).length;

    const attendeesSet = new Set<string>();
    weekSessions.forEach((s) => {
      if (s.attendees) {
        s.attendees.split(',').forEach((att) => {
          const trimmed = att.trim();
          if (trimmed) attendeesSet.add(trimmed);
        });
      }
    });

    return {
      meetingCount: weekSessions.length,
      totalDuration,
      actionTotal: allActions.length,
      actionCompleted: completedActions,
      attendeesCount: attendeesSet.size,
    };
  }, [weekSessions]);

  // Week navigation handlers
  const handlePrevWeek = () => {
    const d = new Date(selectedWeekKey);
    d.setDate(d.getDate() - 7);
    setSelectedWeekKey(d.toISOString().split('T')[0] ?? '');
  };

  const handleNextWeek = () => {
    const d = new Date(selectedWeekKey);
    d.setDate(d.getDate() + 7);
    setSelectedWeekKey(d.toISOString().split('T')[0] ?? '');
  };

  const handleCurrentWeek = () => {
    setSelectedWeekKey(currentWeekKey);
  };

  // Copy weekly summary report
  const handleCopyWeeklyReport = () => {
    const label = formatWeekRange(selectedWeekKey);
    const md = generateWeeklySummaryMarkdown(weekSessions, label);
    void navigator.clipboard.writeText(md);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  // Export markdown report file
  const handleExportWeeklyReport = () => {
    const label = formatWeekRange(selectedWeekKey);
    const md = generateWeeklySummaryMarkdown(weekSessions, label);
    downloadFile(md, `Weekly_Summary_${selectedWeekKey}.md`, 'text/markdown');
  };

  // Toggle action item completion directly from weekly summary
  const handleToggleActionItem = (session: AudioSession, actionId: string) => {
    const currentItems = session.action_items || [];
    const updated = currentItems.map((a) =>
      a.id === actionId ? { ...a, completed: !a.completed } : a
    );
    onUpdateSession(session.id, { action_items: updated });
  };

  const weekRangeLabel = formatWeekRange(selectedWeekKey);
  const isThisWeek = selectedWeekKey === currentWeekKey;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[var(--lui-background)] text-[var(--lui-foreground)]">
      <div className="max-w-4xl lg:max-w-5xl xl:max-w-6xl w-full mx-auto px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8 lg:px-12 lg:py-10 flex flex-col gap-6 lg:gap-8">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--lui-border)]/60">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#FF4F18]/10 text-[#FF4F18]">
                <CalendarDays size={22} />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--lui-foreground)]">
                  Weekly Summary & Digest
                </h1>
                <p className="text-xs text-[var(--lui-muted)] mt-0.5">
                  Rollup digest and meeting-by-meeting synthesis for each week
                </p>
              </div>
            </div>
          </div>

          {/* Action Tools */}
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <button
              onClick={handleCopyWeeklyReport}
              disabled={weekSessions.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--lui-border)] bg-[var(--lui-card)] hover:bg-[var(--lui-accent)]/20 text-xs font-medium text-[var(--lui-foreground)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
              title="Copy formatted weekly summary for Slack, Teams, or Email"
            >
              {copiedReport ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              <span>{copiedReport ? 'Copied Digest' : 'Copy Weekly Digest'}</span>
            </button>

            <button
              onClick={handleExportWeeklyReport}
              disabled={weekSessions.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--lui-border)] bg-[var(--lui-card)] hover:bg-[var(--lui-accent)]/20 text-xs font-medium text-[var(--lui-foreground)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
              title="Download weekly summary as Markdown report"
            >
              <Download size={13} />
              <span>Export .MD</span>
            </button>
          </div>
        </div>

        {/* Week Navigator & Metrics Bar */}
        <div className="doc-box p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Week Selector */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevWeek}
              className="p-1.5 rounded-lg border border-[var(--lui-border)] hover:bg-[var(--lui-accent)]/20 text-[var(--lui-foreground)] transition-colors"
              title="Previous week"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="flex items-center gap-2">
              <div className="px-3.5 py-1.5 rounded-lg bg-[var(--lui-surface)] border border-[var(--lui-border)] font-semibold text-xs sm:text-sm text-[var(--lui-foreground)] flex items-center gap-2">
                <Calendar size={14} className="text-[#FF4F18]" />
                <span>{weekRangeLabel}</span>
                {isThisWeek && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#FF4F18]/15 text-[#FF4F18] font-bold">
                    This Week
                  </span>
                )}
              </div>

              {!isThisWeek && (
                <button
                  onClick={handleCurrentWeek}
                  className="text-xs text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] underline underline-offset-2 px-1"
                >
                  Jump to Current Week
                </button>
              )}
            </div>

            <button
              onClick={handleNextWeek}
              className="p-1.5 rounded-lg border border-[var(--lui-border)] hover:bg-[var(--lui-accent)]/20 text-[var(--lui-foreground)] transition-colors"
              title="Next week"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Metrics Badges */}
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap text-xs text-[var(--lui-muted)]">
            <div className="flex items-center gap-1.5">
              <Layers size={14} className="text-[#FF4F18]" />
              <span className="font-semibold text-[var(--lui-foreground)]">{metrics.meetingCount}</span>
              <span>{metrics.meetingCount === 1 ? 'Meeting' : 'Meetings'}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <Clock size={14} className="text-blue-500" />
              <span className="font-semibold text-[var(--lui-foreground)]">{formatDuration(metrics.totalDuration)}</span>
              <span>Recorded</span>
            </div>

            <div className="flex items-center gap-1.5">
              <CheckSquare size={14} className="text-emerald-500" />
              <span className="font-semibold text-[var(--lui-foreground)]">
                {metrics.actionCompleted}/{metrics.actionTotal}
              </span>
              <span>Tasks Done</span>
            </div>

            {metrics.attendeesCount > 0 && (
              <div className="flex items-center gap-1.5">
                <Users size={14} className="text-amber-500" />
                <span className="font-semibold text-[var(--lui-foreground)]">{metrics.attendeesCount}</span>
                <span>People</span>
              </div>
            )}
          </div>
        </div>

        {/* Content: Per-Meeting Sections */}
        {weekSessions.length === 0 ? (
          <div className="doc-box p-12 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[var(--lui-accent)]/30 flex items-center justify-center text-[var(--lui-muted)] mb-1">
              <CalendarDays size={24} />
            </div>
            <h3 className="text-base font-semibold text-[var(--lui-foreground)]">
              No meetings recorded for {weekRangeLabel}
            </h3>
            <p className="text-xs text-[var(--lui-muted)] max-w-md">
              There are no audio recordings or meeting minutes logged for this week. Use the arrows to navigate or start a new note.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={onNewSession}
                className="px-3.5 py-1.5 rounded-lg bg-[#FF4F18] text-white text-xs font-semibold hover:bg-[#E64515] transition-colors shadow-xs"
              >
                + Create New Note
              </button>
              {!isThisWeek && (
                <button
                  onClick={handleCurrentWeek}
                  className="px-3.5 py-1.5 rounded-lg border border-[var(--lui-border)] hover:bg-[var(--lui-accent)]/20 text-xs font-medium text-[var(--lui-foreground)] transition-colors"
                >
                  Go to This Week
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Section Header */}
            <div className="flex items-center justify-between pb-1">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--lui-muted)] flex items-center gap-2">
                <Sparkles size={14} className="text-[#FF4F18]" />
                <span>Meetings in this Week ({weekSessions.length})</span>
              </h2>
              <span className="text-xs text-[var(--lui-muted)]">
                Chronological Order
              </span>
            </div>

            {/* Individual Meeting Sections */}
            {weekSessions.map((session, index) => {
              const actionItems = session.action_items || [];
              const completedCount = actionItems.filter((a) => a.completed).length;

              return (
                <article
                  key={session.id}
                  className="doc-box p-5 sm:p-6 flex flex-col gap-4 border border-[var(--lui-border)] hover:border-[var(--lui-foreground)]/20 transition-all duration-150"
                >
                  {/* Meeting Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--lui-border)]/50">
                    <div className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-md bg-[#FF4F18]/15 text-[#FF4F18] font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 font-mono">
                        {index + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-bold text-[var(--lui-foreground)] tracking-tight">
                            {session.title || 'Untitled Note'}
                          </h3>
                          <span className="px-2 py-0.5 rounded text-[10.5px] font-medium bg-[var(--lui-surface)] border border-[var(--lui-border)] text-[var(--lui-foreground)]">
                            {session.category || 'General'}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-[var(--lui-muted)] mt-1 flex-wrap">
                          <span className="flex items-center gap-1 font-mono">
                            <Calendar size={12} />
                            <span>{formatDate(session.date || session.created)}</span>
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1 font-mono">
                            <Clock size={12} />
                            <span>{formatDuration(session.duration || 0)}</span>
                          </span>
                          {session.attendees && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Users size={12} />
                                <span>{session.attendees}</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => onOpenSession(session.id)}
                      className="self-start sm:self-center flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--lui-border)] bg-[var(--lui-surface)] hover:bg-[var(--lui-accent)]/20 text-xs font-semibold text-[var(--lui-foreground)] transition-colors shrink-0 shadow-2xs"
                      title="Open full editor and audio recording for this meeting"
                    >
                      <span>Open Note</span>
                      <ExternalLink size={12} />
                    </button>
                  </div>

                  {/* Meeting Content Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">
                    {/* 1. Executive Summary */}
                    <div className="flex flex-col gap-1.5 p-3.5 rounded-lg bg-[var(--lui-surface)]/60 border border-[var(--lui-border)]/40">
                      <h4 className="text-xs font-bold text-[var(--lui-foreground)] flex items-center gap-1.5">
                        <BookOpen size={13} className="text-[#FF4F18]" />
                        <span>Executive Summary</span>
                      </h4>
                      <p className="text-[13px] text-[var(--lui-foreground)]/90 leading-relaxed whitespace-pre-wrap">
                        {session.summary ? (
                          session.summary
                        ) : (
                          <span className="text-[var(--lui-muted)]/60 italic text-xs">
                            No executive summary drafted for this meeting.
                          </span>
                        )}
                      </p>
                    </div>

                    {/* 2. Meeting Notes & Decisions */}
                    <div className="flex flex-col gap-1.5 p-3.5 rounded-lg bg-[var(--lui-surface)]/60 border border-[var(--lui-border)]/40">
                      <h4 className="text-xs font-bold text-[var(--lui-foreground)] flex items-center gap-1.5">
                        <FileText size={13} className="text-blue-500" />
                        <span>Meeting Notes & Key Decisions</span>
                      </h4>
                      <p className="text-[13px] text-[var(--lui-foreground)]/90 leading-relaxed whitespace-pre-wrap">
                        {session.meeting_notes ? (
                          session.meeting_notes
                        ) : (
                          <span className="text-[var(--lui-muted)]/60 italic text-xs">
                            No meeting notes or discussion points recorded.
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* 3. Action Items Checklist */}
                  {actionItems.length > 0 && (
                    <div className="pt-2 border-t border-[var(--lui-border)]/40 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[var(--lui-foreground)] flex items-center gap-1.5">
                          <CheckSquare size={13} className="text-emerald-500" />
                          <span>Action Items ({completedCount}/{actionItems.length})</span>
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {actionItems.map((item) => (
                          <label
                            key={item.id}
                            className={`flex items-start gap-2 p-2 rounded-md border text-xs cursor-pointer transition-colors ${
                              item.completed
                                ? 'border-emerald-500/30 bg-emerald-500/5 text-[var(--lui-muted)] line-through'
                                : 'border-[var(--lui-border)] bg-[var(--lui-surface)] text-[var(--lui-foreground)] hover:border-[var(--lui-foreground)]/30'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={item.completed}
                              onChange={() => handleToggleActionItem(session, item.id)}
                              className="mt-0.5 rounded border-gray-400 text-[#FF4F18] focus:ring-[#FF4F18]"
                            />
                            <div className="flex-1 min-w-0">
                              <span className="font-medium">{item.title}</span>
                              {item.assignee && (
                                <span className="ml-1.5 text-[10.5px] text-[var(--lui-muted)] font-mono">
                                  @{item.assignee}
                                </span>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
