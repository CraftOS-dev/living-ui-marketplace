import { useState, useEffect } from 'react';
import type { AudioSession } from '../types.ts';
import { Copy, Check, Eye, Edit3, BookOpen, Users, Plus, CalendarDays } from 'lucide-react';

interface SummarySectionProps {
  session: AudioSession;
  onUpdateSession: (fields: Partial<AudioSession>) => void;
  onOpenWeeklySummary?: () => void;
}

const DEFAULT_MEETING_TEMPLATE = `## 📅 Meeting Objectives & Agenda
• Main goal: 
• Topics to cover: 

## 💬 Key Discussion & Notes
• 
• 

## 🎯 Decisions Reached & Agreements
• 
• 

## 📌 Follow-up & Next Steps
• [ ] 
• [ ] `;

export function SummarySection({
  session,
  onUpdateSession,
  onOpenWeeklySummary,
}: SummarySectionProps): React.JSX.Element {
  // Executive Summary State
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [isPreviewSummary, setIsPreviewSummary] = useState(false);
  const [summaryText, setSummaryText] = useState(session.summary || '');

  // Meeting Notes State
  const [copiedNotes, setCopiedNotes] = useState(false);
  const [isPreviewNotes, setIsPreviewNotes] = useState(false);
  const [meetingNotesText, setMeetingNotesText] = useState(session.meeting_notes || '');

  useEffect(() => {
    setSummaryText(session.summary || '');
    setMeetingNotesText(session.meeting_notes || '');
    setIsPreviewSummary(false);
    setIsPreviewNotes(false);
  }, [session.id, session.summary, session.meeting_notes]);

  // Executive Summary Handlers
  const handleCopySummary = () => {
    if (!session.summary) return;
    void navigator.clipboard.writeText(session.summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const handleBlurSummary = () => {
    if (summaryText !== (session.summary || '')) {
      onUpdateSession({ summary: summaryText });
    }
  };

  // Meeting Notes Handlers
  const handleCopyNotes = () => {
    if (!meetingNotesText) return;
    void navigator.clipboard.writeText(meetingNotesText);
    setCopiedNotes(true);
    setTimeout(() => setCopiedNotes(false), 2000);
  };

  const handleBlurNotes = () => {
    if (meetingNotesText !== (session.meeting_notes || '')) {
      onUpdateSession({ meeting_notes: meetingNotesText });
    }
  };

  const handleInsertMeetingTemplate = () => {
    const updated = meetingNotesText
      ? meetingNotesText + '\n\n' + DEFAULT_MEETING_TEMPLATE
      : DEFAULT_MEETING_TEMPLATE;
    setMeetingNotesText(updated);
    onUpdateSession({ meeting_notes: updated });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Executive Summary Section */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-[var(--lui-foreground)] flex items-center gap-2">
              <BookOpen size={15} className="opacity-70 text-[#FF4F18]" />
              <span>Executive Summary</span>
            </h3>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[var(--lui-accent)]/30 text-[var(--lui-muted)]">
              Synthesis
            </span>
          </div>

          <div className="flex items-center gap-2">
            {onOpenWeeklySummary && (
              <button
                onClick={onOpenWeeklySummary}
                className="flex items-center gap-1 text-[11px] text-[var(--lui-muted)] hover:text-[#FF4F18] transition-colors px-2 py-1 rounded hover:bg-[var(--lui-accent)]/20"
                title="View weekly summary digest for all meetings in this week"
              >
                <CalendarDays size={12} className="text-[#FF4F18]" />
                <span>Weekly Rollup</span>
              </button>
            )}

            <button
              onClick={() => setIsPreviewSummary(!isPreviewSummary)}
              className="flex items-center gap-1 text-[11px] text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors px-2 py-1 rounded hover:bg-[var(--lui-accent)]/20"
            >
              {isPreviewSummary ? <Edit3 size={12} /> : <Eye size={12} />}
              <span>{isPreviewSummary ? 'Edit' : 'Preview'}</span>
            </button>

            {summaryText && (
              <button
                onClick={handleCopySummary}
                className="flex items-center gap-1 text-[11px] text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors px-2 py-1 rounded hover:bg-[var(--lui-accent)]/20"
                title="Copy Executive Summary"
              >
                {copiedSummary ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedSummary ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
        </div>

        {isPreviewSummary ? (
          <div className="doc-box p-3.5 sm:p-4 text-[13.5px] sm:text-[14px] font-sans leading-relaxed whitespace-pre-wrap min-h-[90px] lg:min-h-[110px]">
            {summaryText || (
              <span className="text-[var(--lui-muted)]/60 italic text-xs lg:text-sm">
                No summary drafted. Switch to Edit or write your core takeaways.
              </span>
            )}
          </div>
        ) : (
          <textarea
            value={summaryText}
            onChange={(e) => setSummaryText(e.target.value)}
            onBlur={handleBlurSummary}
            placeholder="Write the core takeaways, meeting outcome, and strategic conclusion..."
            rows={4}
            className="doc-textarea w-full p-3.5 sm:p-4 text-[13.5px] sm:text-[14px] font-sans leading-relaxed text-[var(--lui-foreground)] placeholder:text-[var(--lui-muted)]/50 resize-y font-normal min-h-[90px] lg:min-h-[110px]"
          />
        )}
      </div>

      {/* 2. Detailed Meeting Notes Section */}
      <div className="flex flex-col gap-2.5 pt-2 border-t border-[var(--lui-border)]/50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-[var(--lui-foreground)] flex items-center gap-2">
              <Users size={15} className="opacity-70 text-blue-500" />
              <span>Meeting Notes</span>
            </h3>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[var(--lui-accent)]/30 text-[var(--lui-muted)]">
              Discussion & Minutes
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleInsertMeetingTemplate}
              className="flex items-center gap-1 text-[11px] text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors px-2 py-1 rounded border border-[var(--lui-border)]/60 hover:bg-[var(--lui-accent)]/20"
              title="Insert a structured meeting notes template with agenda, discussions, and decisions"
            >
              <Plus size={11} className="text-[#FF4F18]" />
              <span>+ Meeting Template</span>
            </button>

            <button
              onClick={() => setIsPreviewNotes(!isPreviewNotes)}
              className="flex items-center gap-1 text-[11px] text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors px-2 py-1 rounded hover:bg-[var(--lui-accent)]/20"
            >
              {isPreviewNotes ? <Edit3 size={12} /> : <Eye size={12} />}
              <span>{isPreviewNotes ? 'Edit' : 'Preview'}</span>
            </button>

            {meetingNotesText && (
              <button
                onClick={handleCopyNotes}
                className="flex items-center gap-1 text-[11px] text-[var(--lui-muted)] hover:text-[var(--lui-foreground)] transition-colors px-2 py-1 rounded hover:bg-[var(--lui-accent)]/20"
                title="Copy Meeting Notes"
              >
                {copiedNotes ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedNotes ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
        </div>

        {isPreviewNotes ? (
          <div className="doc-box p-4 sm:p-5 text-[13.5px] sm:text-[14px] font-sans leading-relaxed whitespace-pre-wrap min-h-[180px] lg:min-h-[260px]">
            {meetingNotesText || (
              <span className="text-[var(--lui-muted)]/60 italic text-xs lg:text-sm">
                No meeting notes recorded. Click "+ Meeting Template" or switch to Edit to add agenda, discussion points, and decisions.
              </span>
            )}
          </div>
        ) : (
          <textarea
            value={meetingNotesText}
            onChange={(e) => setMeetingNotesText(e.target.value)}
            onBlur={handleBlurNotes}
            placeholder="Record detailed meeting minutes, attendee contributions, discussion topics, and agreed decisions..."
            rows={10}
            className="doc-textarea w-full p-4 sm:p-5 text-[13.5px] sm:text-[14px] font-sans leading-relaxed text-[var(--lui-foreground)] placeholder:text-[var(--lui-muted)]/50 resize-y font-normal min-h-[180px] lg:min-h-[260px]"
          />
        )}
      </div>
    </div>
  );
}
