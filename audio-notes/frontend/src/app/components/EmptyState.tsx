import { Mic } from 'lucide-react';
import { Button } from '../../kit/index.ts';

interface EmptyStateProps {
  onNewSession: () => void;
}

export function EmptyState({ onNewSession }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none">
      <div className="w-16 h-16 rounded-2xl bg-[var(--lui-primary)]/10 text-[var(--lui-primary)] flex items-center justify-center mb-4 shadow-inner">
        <Mic size={32} />
      </div>

      <h2 className="text-lg font-bold text-[var(--lui-foreground)] mb-1">
        Capture Your First Audio Note
      </h2>
      <p className="text-xs text-[var(--lui-muted)] max-w-md mb-6 leading-relaxed">
        Record voice memos, meetings, or interviews directly from your microphone or upload pre-recorded audio files. Keep organized overviews, structured summaries, and action checklists.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Button onClick={onNewSession} className="flex items-center gap-2 shadow-sm">
          <Mic size={16} />
          <span>Start New Recording</span>
        </Button>
      </div>
    </div>
  );
}
