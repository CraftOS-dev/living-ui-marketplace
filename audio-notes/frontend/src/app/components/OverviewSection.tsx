import { useState, useEffect } from 'react';
import type { AudioSession } from '../types.ts';
import { AlignLeft } from 'lucide-react';

interface OverviewSectionProps {
  session: AudioSession;
  onUpdateSession: (fields: Partial<AudioSession>) => void;
}

export function OverviewSection({
  session,
  onUpdateSession,
}: OverviewSectionProps): React.JSX.Element {
  const [overviewText, setOverviewText] = useState(session.overview || '');

  useEffect(() => {
    setOverviewText(session.overview || '');
  }, [session.id, session.overview]);

  const handleBlurOverview = () => {
    if (overviewText !== session.overview) {
      onUpdateSession({ overview: overviewText });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Overview Notes Box */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-[var(--lui-foreground)] flex items-center gap-2">
            <AlignLeft size={15} className="opacity-70" />
            <span>Overview Notes</span>
          </h3>
        </div>

        <textarea
          value={overviewText}
          onChange={(e) => setOverviewText(e.target.value)}
          onBlur={handleBlurOverview}
          placeholder="Write session background, context, and key topics discussed..."
          rows={6}
          className="doc-textarea w-full p-4 sm:p-5 text-[13.5px] sm:text-[14px] font-sans leading-relaxed text-[var(--lui-foreground)] placeholder:text-[var(--lui-muted)]/50 resize-y min-h-[150px] lg:min-h-[190px]"
        />
      </div>
    </div>
  );
}
