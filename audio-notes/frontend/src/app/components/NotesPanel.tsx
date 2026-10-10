import { FileText, Sparkles } from 'lucide-react';
import { Button } from '../../kit/index.ts';
import type { ActionItem, Note } from '../types.ts';
import { ActionItems } from './ActionItems.tsx';
import { BulletList, TextBlock } from './fields.tsx';
import { SectionTitle } from './ui.tsx';

function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--agent-app-border)] px-6 py-12 text-center">
      <span className="mb-1 flex size-10 items-center justify-center rounded-[var(--agent-app-radius)] bg-[var(--agent-app-surface-2)] text-[var(--agent-app-muted)]">{icon}</span>
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-[var(--agent-app-muted)]">{text}</p>
      {action !== undefined && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** The AI-written notes, every part editable in place. */
export function NotesPanel({
  note,
  onPatch,
  onGenerate,
  onClearDone,
}: {
  note: Note;
  onPatch: (fields: Partial<Note>) => void;
  onGenerate: () => void;
  onClearDone: () => void;
}): React.JSX.Element {
  const keyPoints = note.key_points ?? [];
  const decisions = note.decisions ?? [];
  const actions: ActionItem[] = note.action_items ?? [];
  const hasTranscript = note.transcript.trim() !== '';
  const busy = note.notes_status === 'queued' || note.notes_status === 'processing';
  const empty = note.summary === '' && note.overview === '' && keyPoints.length === 0 && decisions.length === 0 && actions.length === 0;

  if (empty && !busy && note.transcript_status === 'no_speech') {
    return <Empty icon={<FileText size={18} />} title="No notes" text="There was no speech in this recording, so there is nothing to write notes from." />;
  }
  if (empty && !busy) {
    return hasTranscript ? (
      <Empty
        icon={<Sparkles size={18} />}
        title="No notes yet"
        text="CraftBot reads the transcript and writes the summary, key points, decisions, action items and who was there."
        action={
          <Button onClick={onGenerate}>
            <Sparkles size={15} />
            Write notes
          </Button>
        }
      />
    ) : (
      <Empty
        icon={<FileText size={18} />}
        title="Notes come from the transcript"
        text="Once the recording is transcribed, CraftBot writes the summary, key points, decisions and action items here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionTitle>Summary</SectionTitle>
        <TextBlock value={note.summary} onSave={(summary) => onPatch({ summary })} placeholder="What happened, in a few sentences" minRows={2} />
      </section>
      <section>
        <SectionTitle meta={keyPoints.length > 0 ? String(keyPoints.length) : undefined}>Key points</SectionTitle>
        <BulletList items={keyPoints} onSave={(key_points) => onPatch({ key_points })} addLabel="Add a point" emptyText="No key points." />
      </section>
      <section>
        <SectionTitle meta={decisions.length > 0 ? String(decisions.length) : undefined}>Decisions</SectionTitle>
        <BulletList items={decisions} onSave={(next) => onPatch({ decisions: next })} addLabel="Add a decision" emptyText="No decisions recorded." />
      </section>
      <section>
        <SectionTitle meta={actions.length > 0 ? `${actions.filter((a) => a.done).length} of ${actions.length} done` : undefined}>Action items</SectionTitle>
        <ActionItems items={actions} onSave={(action_items) => onPatch({ action_items })} onClearDone={onClearDone} />
      </section>
      <section>
        <SectionTitle>Context</SectionTitle>
        <TextBlock value={note.overview} onSave={(overview) => onPatch({ overview })} placeholder="What this recording is and why it happened" />
      </section>
    </div>
  );
}
