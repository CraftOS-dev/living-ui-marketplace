import { useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { op } from '../lib/api.ts';
import { changed } from '../lib/live.ts';
import { flushEditors } from '../lib/editors.ts';
import type { ReviewProgress } from '../lib/types.ts';
import { PillButton } from './ui.tsx';

export function ReviewAgain({ progress, locked = false, answerKey }: { progress?: ReviewProgress; locked?: boolean; answerKey?: string }): React.JSX.Element {
  const [sending, setSending] = useState(false);
  const gate = useRef(false);
  const run = async (): Promise<void> => {
    if (gate.current || progress?.active || locked) return;
    gate.current = true;
    setSending(true);
    try {
      await flushEditors();
      await op('answers.recheck', answerKey === undefined ? {} : { key: answerKey });
      changed('answers', 'settings');
    } catch {
      // Operation errors are shown by the app's shared notice system.
    } finally {
      gate.current = false;
      setSending(false);
    }
  };
  return <PillButton variant="row" icon={RotateCw} loading={sending || progress?.active === true} disabled={locked || progress?.active === true} onClick={() => void run()}>{sending ? 'Saving and requesting' : progress?.active ? 'Reviewing saved version' : 'Review again'}</PillButton>;
}

export function ReviewNotice({ progress }: { progress: ReviewProgress }): React.JSX.Element {
  const text = progress.active
    ? 'Reviewing the saved version you requested. Your previous feedback stays visible; you can keep editing.'
    : progress.failed
      ? 'The last review could not finish. Previous feedback is still shown. Click Review again to retry.'
      : progress.stale
        ? 'Changed since review. Previous feedback stays visible while you edit. Click Review again when you are ready.'
        : progress.has_review
          ? 'Showing your last review. Editing saves your changes but does not start another review.'
          : 'Reviews run only when you click Review again. Finish editing first.';
  return <p role="status" className="mb-4 rounded-[18px] border border-[var(--sr-border)] bg-[var(--sr-row)] px-4 py-3 text-[13px] text-[var(--sr-muted)]">{text}</p>;
}
