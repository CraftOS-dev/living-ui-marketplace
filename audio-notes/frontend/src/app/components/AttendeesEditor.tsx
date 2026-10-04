import { useState, useMemo, type KeyboardEvent } from 'react';
import { Users, UserPlus, X, User, Check } from 'lucide-react';
import { extractNamesFromTranscript, mergeAttendees } from '../utils.ts';
import { toast } from '../../kit/index.ts';

interface AttendeesEditorProps {
  attendees: string;
  onUpdateAttendees: (attendees: string) => void;
  transcript?: string;
  className?: string;
}

export function AttendeesEditor({
  attendees,
  onUpdateAttendees,
  transcript = '',
  className = '',
}: AttendeesEditorProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  // Parse comma-separated attendees into a clean array
  const memberList = attendees
    ? attendees
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // Extract candidate names from transcript that are not yet in memberList
  const detectedSuggestions = useMemo(() => {
    if (!transcript.trim()) return [];
    return extractNamesFromTranscript(transcript, attendees);
  }, [transcript, attendees]);

  const handleAddMember = (nameToAdd?: string) => {
    const name = (nameToAdd || inputValue).trim();
    if (!name) return;

    // Avoid duplicates (case-insensitive)
    if (memberList.some((m) => m.toLowerCase() === name.toLowerCase())) {
      setInputValue('');
      return;
    }

    const updated = [...memberList, name];
    onUpdateAttendees(updated.join(', '));
    setInputValue('');
  };

  const handleRemoveMember = (indexToRemove: number) => {
    const updated = memberList.filter((_, idx) => idx !== indexToRemove);
    onUpdateAttendees(updated.join(', '));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      handleAddMember();
    } else if (e.key === 'Backspace' && !inputValue && memberList.length > 0) {
      handleRemoveMember(memberList.length - 1);
    }
  };

  const handleAutoScan = () => {
    if (!transcript.trim()) {
      toast.info('No transcript available to scan yet.');
      return;
    }

    setIsScanning(true);
    setTimeout(() => {
      const extracted = extractNamesFromTranscript(transcript, attendees);
      if (extracted.length === 0) {
        toast.info('No new attendee names detected in transcript.');
      } else {
        const merged = mergeAttendees(attendees, extracted);
        onUpdateAttendees(merged);
        toast.success(`Detected & added ${extracted.length} member(s): ${extracted.join(', ')}`);
      }
      setIsScanning(false);
    }, 300);
  };

  const handleAddAllSuggestions = () => {
    if (detectedSuggestions.length === 0) return;
    const merged = mergeAttendees(attendees, detectedSuggestions);
    onUpdateAttendees(merged);
    toast.success(`Added ${detectedSuggestions.length} member(s) to attendance`);
  };

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className={`doc-box p-4 sm:p-5 flex flex-col gap-3.5 ${className}`}>
      {/* Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-[var(--lui-foreground)] flex items-center gap-2">
          <Users size={16} className="text-[#FF4F18]" />
          <span>Members Present / Attendees</span>
          {memberList.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FF4F18]/10 text-[#FF4F18] border border-[#FF4F18]/20">
              {memberList.length}
            </span>
          )}
        </h4>

        <div className="flex items-center gap-2">
          {transcript.trim().length > 0 && (
            <button
              type="button"
              onClick={handleAutoScan}
              disabled={isScanning}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium bg-[#FF4F18]/10 hover:bg-[#FF4F18]/20 text-[#FF4F18] border border-[#FF4F18]/30 transition-colors cursor-pointer active:scale-95"
              title="Automatically detect speaker and attendee names mentioned in transcript"
            >
              <span>{isScanning ? 'Scanning...' : 'Auto-scan'}</span>
            </button>
          )}

          {memberList.length > 0 && (
            <button
              type="button"
              onClick={() => onUpdateAttendees('')}
              className="text-[11.5px] text-[var(--lui-muted)] hover:text-red-500 transition-colors"
              title="Clear all members"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Clean Theme-matched Chips Container */}
      <div className="flex flex-wrap items-center gap-2 min-h-[32px]">
        {memberList.map((member, index) => (
          <span
            key={`${member}-${index}`}
            className="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-lg text-xs font-medium bg-[var(--lui-surface)] border border-[var(--lui-border)]/80 text-[var(--lui-foreground)] hover:border-[var(--lui-border)] transition-all shadow-2xs"
          >
            <span className="w-5 h-5 rounded-md bg-[#FF4F18]/10 border border-[#FF4F18]/20 text-[#FF4F18] flex items-center justify-center font-bold text-[10px] select-none">
              {getInitials(member)}
            </span>
            <span className="truncate max-w-[150px] sm:max-w-[200px]">{member}</span>
            <button
              type="button"
              onClick={() => handleRemoveMember(index)}
              className="p-0.5 rounded-md text-[var(--lui-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
              title={`Remove ${member}`}
              aria-label={`Remove ${member}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}

        {memberList.length === 0 && (
          <p className="text-xs text-[var(--lui-muted)]/70 italic flex items-center gap-1.5 py-0.5">
            <User size={13} className="opacity-50" />
            <span>No members noted yet. Type names below or auto-detect from transcribed speech.</span>
          </p>
        )}
      </div>

      {/* Detected Suggestions Bar */}
      {detectedSuggestions.length > 0 && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--lui-surface)]/70 border border-[#FF4F18]/30 text-xs">
          <span className="text-[var(--lui-muted)] shrink-0 font-medium">Detected in transcript:</span>
          <div className="flex items-center gap-1.5 flex-wrap flex-1">
            {detectedSuggestions.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => handleAddMember(name)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--lui-background)] hover:bg-[#FF4F18]/15 border border-[var(--lui-border)] hover:border-[#FF4F18]/40 text-[var(--lui-foreground)] text-[11.5px] transition-colors"
                title={`Click to add ${name}`}
              >
                <span>+ {name}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleAddAllSuggestions}
            className="text-[11px] font-semibold text-[#FF4F18] hover:underline shrink-0 flex items-center gap-1"
            title="Add all detected names to members present"
          >
            <Check size={12} />
            <span>Add All</span>
          </button>
        </div>
      )}

      {/* Input Field */}
      <div className="flex items-center gap-2 pt-1 border-t border-[var(--lui-border)]/40">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type member name and press Enter (e.g. Alex Rivera, Sarah Chen)..."
            className="w-full pl-3 pr-8 py-2 text-xs sm:text-[13px] rounded-lg bg-[var(--lui-surface)] border border-[var(--lui-border)] text-[var(--lui-foreground)] placeholder:text-[var(--lui-muted)]/50 focus:outline-none focus:border-[#FF4F18] transition-colors"
          />
          {inputValue && (
            <button
              type="button"
              onClick={() => setInputValue('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--lui-muted)] hover:text-[var(--lui-foreground)]"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleAddMember()}
          disabled={!inputValue.trim()}
          className="px-3.5 py-2 rounded-lg bg-[#FF4F18] hover:bg-[#E64515] disabled:opacity-40 disabled:hover:bg-[#FF4F18] text-white text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 shadow-xs active:scale-95"
        >
          <UserPlus size={14} />
          <span>Add</span>
        </button>
      </div>
    </div>
  );
}
