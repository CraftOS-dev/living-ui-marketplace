import { useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Clock, Copy, Download, FileDown, FileText, Languages, MoreHorizontal, Sparkles, Star, Subtitles, Trash2 } from 'lucide-react';
import { Button, Dialog, DropdownMenu, Select, Spinner, cn, toast, useConfirm, useRecord } from '../../kit/index.ts';
import { api, audioUrl, saveFile } from '../api.ts';
import { CATEGORIES, LANGUAGES, languageName, length, recall, remember } from '../format.ts';
import type { Recorder } from '../recorder/useRecorder.ts';
import type { EngineStatus, Note } from '../types.ts';
import { Attendees } from './Attendees.tsx';
import { TextBlock, TitleField } from './fields.tsx';
import { NotesPanel } from './NotesPanel.tsx';
import { Pipeline } from './Pipeline.tsx';
import { Player, type PlayerHandle } from './Player.tsx';
import { RecorderPanel } from './Recorder.tsx';
import { TranscriptPanel } from './TranscriptPanel.tsx';
import { DateChip, IconButton, MetaItem, SelectField, UnderlineTabs } from './ui.tsx';

type Tab = 'notes' | 'transcript' | 'mine';

function TranscribeDialog({ note, open, onOpenChange }: { note: Note; open: boolean; onOpenChange: (open: boolean) => void }): React.JSX.Element {
  const [language, setLanguage] = useState(note.language || recall('language', 'auto'));
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={note.transcript_status === '' ? 'Transcribe recording' : 'Transcribe again'}
      description="Runs on this PC. The current transcript stays until the new one is ready."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              setBusy(true);
              remember('language', language);
              api
                .transcribe(note.id, language)
                .then(() => onOpenChange(false))
                .catch(() => undefined)
                .finally(() => setBusy(false));
            }}
          >
            Start
          </Button>
        </>
      }
    >
      <Select label="Spoken language" value={language} onChange={(e) => setLanguage(e.target.value)} options={LANGUAGES} />
      {note.summary !== '' && (
        <p className="mt-3 text-[13px] text-[var(--agent-app-muted)]">Your notes stay as they are. Use "Rewrite notes" afterwards to update them from the new transcript.</p>
      )}
    </Dialog>
  );
}

/**
 * One note. While it is being recorded in this window the page IS the
 * recorder: controls on top, the live transcript and your own notes below.
 */
export function NoteView({
  noteId,
  engine,
  rec,
  onBack,
  onDeleted,
  onOpen,
  onDiscardRecording,
}: {
  noteId: string;
  engine: EngineStatus | null;
  rec: Recorder;
  onBack: () => void;
  onDeleted: () => void;
  onOpen: (id: string) => void;
  onDiscardRecording: () => void;
}): React.JSX.Element {
  const { record: note, loading, error } = useRecord<Note>('notes', noteId);
  const player = useRef<PlayerHandle | null>(null);
  const [time, setTime] = useState(0);
  const [tab, setTab] = useState<Tab | null>(null);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner />
      </div>
    );
  }
  if (note === null) {
    return <p className="py-24 text-center text-sm text-[var(--agent-app-muted)]">{error ?? 'This note was deleted.'}</p>;
  }

  const recordingHere = rec.noteId === note.id && (rec.phase === 'recording' || rec.phase === 'paused');
  const live = note.transcript_status === 'live' ? (recordingHere ? 'recording' : 'interrupted') : note.transcript_status === 'finishing' ? 'finishing' : null;
  const tabs: ReadonlyArray<{ value: Tab; label: string; badge?: React.ReactNode }> =
    live !== null
      ? [
          {
            value: 'transcript',
            label: live === 'recording' ? 'Live transcript' : 'Transcript',
            badge: live === 'recording' ? <span className="size-1.5 animate-pulse rounded-full bg-red-500" aria-hidden /> : undefined,
          },
          { value: 'mine', label: 'My notes' },
        ]
      : [
          { value: 'notes', label: 'Notes' },
          { value: 'transcript', label: 'Transcript' },
          { value: 'mine', label: 'My notes' },
        ];
  const activeTab: Tab = tab !== null && tabs.some((t) => t.value === tab) ? tab : live !== null ? 'transcript' : 'notes';

  const patch = (fields: Partial<Note>): void => {
    void api.updateNote(note.id, fields).catch(() => undefined);
  };
  const generate = async (): Promise<void> => {
    if (note.summary !== '' && !(await confirm('The summary, key points, decisions and action items will be replaced. Attendees and your own notes are kept.', 'Rewrite the notes?'))) {
      return;
    }
    void api.generate(note.id).catch(() => undefined);
  };
  const remove = (): void => {
    void confirm(`"${note.title}" and its recording will be deleted for good.`, 'Delete this note?').then((ok) => {
      if (!ok) return;
      if (recordingHere) {
        onDiscardRecording();
        return;
      }
      void api
        .deleteNote(note.id)
        .then(() => {
          toast.success('Note deleted');
          onDeleted();
        })
        .catch(() => undefined);
    });
  };
  const exportAs = (format: 'md' | 'txt' | 'srt'): void => {
    void api
      .exportNote(note.id, format)
      .then(saveFile)
      .catch(() => undefined);
  };
  const src = audioUrl(note);
  const pipelineBusy =
    ['queued', 'processing', 'live', 'finishing'].includes(note.transcript_status) || note.notes_status === 'queued' || note.notes_status === 'processing';
  const categories = CATEGORIES.includes(note.category) || note.category === '' ? CATEGORIES : [...CATEGORIES, note.category];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pb-20 pt-8 md:px-10">
      {confirmEl}

      {/* Meta row: chips share one height and one size. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to notes"
          className="-ml-2 inline-flex size-8 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-hover)] md:hidden"
        >
          <ArrowLeft size={16} />
        </button>
        <SelectField
          variant="chip"
          ariaLabel="Category"
          value={note.category}
          onChange={(category) => patch({ category })}
          options={[...(note.category === '' ? [{ value: '', label: 'No category' }] : []), ...categories.map((c) => ({ value: c, label: c }))]}
        />
        <DateChip value={note.date} onChange={(date) => patch({ date })} />
        {note.duration > 0 && live === null && <MetaItem icon={<Clock size={14} />}>{length(note.duration)}</MetaItem>}
        {note.detected_language !== '' && <MetaItem icon={<Languages size={14} />}>{languageName(note.detected_language)}</MetaItem>}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label={note.starred ? 'Unstar' : 'Star'}
            active={note.starred}
            onClick={() => patch({ starred: !note.starred })}
            className={cn(note.starred && 'text-amber-500 hover:text-amber-500')}
          >
            <Star size={16} fill={note.starred ? 'currentColor' : 'none'} />
          </IconButton>
          <DropdownMenu
            trigger={
              <span
                role="button"
                aria-label="More actions"
                title="More actions"
                className="inline-flex size-8 items-center justify-center rounded-[var(--agent-app-radius)] text-[var(--agent-app-muted)] transition-colors hover:bg-[var(--agent-app-hover)] hover:text-[var(--agent-app-text)]"
              >
                <MoreHorizontal size={16} />
              </span>
            }
            items={[
              { label: 'Export as Markdown', icon: <FileDown size={14} />, onSelect: () => exportAs('md'), disabled: live !== null },
              { label: 'Download transcript (.txt)', icon: <FileText size={14} />, onSelect: () => exportAs('txt'), disabled: note.transcript === '' },
              { label: 'Download subtitles (.srt)', icon: <Subtitles size={14} />, onSelect: () => exportAs('srt'), disabled: (note.segments ?? []).length === 0 },
              {
                label: 'Download audio',
                icon: <Download size={14} />,
                disabled: src === '',
                onSelect: () => {
                  const a = document.createElement('a');
                  a.href = `${src}?download=1`;
                  a.download = note.audio;
                  a.click();
                },
              },
              { label: 'Transcribe again...', icon: <Languages size={14} />, onSelect: () => setTranscribeOpen(true), disabled: src === '' || pipelineBusy },
              { label: 'Rewrite notes', icon: <Sparkles size={14} />, onSelect: () => void generate(), disabled: note.transcript === '' || pipelineBusy },
              {
                label: 'Duplicate',
                icon: <Copy size={14} />,
                disabled: live !== null,
                onSelect: () => {
                  void api
                    .duplicate(note.id)
                    .then((copy) => {
                      toast.success('Note duplicated');
                      onOpen(copy.id);
                    })
                    .catch(() => undefined);
                },
              },
              { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onSelect: remove },
            ]}
          />
        </div>
      </div>

      <TitleField value={note.title} onSave={(title) => patch({ title, title_auto: false })} className="mt-3 text-[26px] font-semibold leading-tight tracking-tight" />
      <div className="mt-3">
        <Attendees
          names={note.attendees ?? []}
          found={note.people_found ?? []}
          status={note.people_status}
          error={note.people_error}
          speakerCount={note.speaker_count}
          canDetect={note.audio !== '' && live === null}
          onSave={(attendees) => patch({ attendees })}
          onRename={(from, to) => void api.renameSpeaker(note.id, from, to).catch(() => undefined)}
          onDetect={(speakers) => void api.detectPeople(note.id, speakers).catch(() => undefined)}
        />
      </div>

      <div className="mt-6 flex flex-col gap-4 empty:hidden">
        {live === 'recording' && <RecorderPanel rec={rec} onDiscard={onDiscardRecording} />}
        {live === 'interrupted' && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold">This recording is not running in this window</p>
                <p className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
                  If it stopped unexpectedly, finish it with what was transcribed so far. If this browser kept a backup of the audio, it is offered at the top of the
                  page.
                </p>
              </div>
            </div>
            <div className="flex gap-2 pl-7">
              <Button size="sm" onClick={() => void api.finishLive(note.id).catch(() => undefined)}>
                Finish with the transcript so far
              </Button>
              <Button size="sm" variant="ghost" onClick={remove}>
                Delete
              </Button>
            </div>
          </div>
        )}
        {live !== 'recording' && live !== 'interrupted' && (
          <Pipeline
            note={note}
            engine={engine}
            onTranscribe={() => setTranscribeOpen(true)}
            onGenerate={() => void api.generate(note.id).catch(() => undefined)}
            onCancel={() => void api.cancel(note.id).catch(() => undefined)}
            onDelete={remove}
          />
        )}
        {src !== '' && live === null && <Player ref={player} src={src} knownSeconds={note.duration} onTime={setTime} />}
      </div>

      <div className="mt-8">
        <UnderlineTabs tabs={tabs} value={activeTab} onChange={setTab} />
      </div>
      <div className="mt-6">
        {activeTab === 'notes' && (
          <NotesPanel note={note} onPatch={patch} onGenerate={() => void generate()} onClearDone={() => void api.clearDone(note.id).catch(() => undefined)} />
        )}
        {activeTab === 'transcript' && (
          <TranscriptPanel
            note={note}
            live={live === 'recording' ? 'recording' : live === 'finishing' ? 'finishing' : null}
            currentTime={time}
            onSeek={(s) => player.current?.seek(s)}
            onPatch={patch}
            onGenerate={() => void generate()}
            onExport={exportAs}
            onRename={(from, to) => void api.renameSpeaker(note.id, from, to).catch(() => undefined)}
          />
        )}
        {activeTab === 'mine' && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-[var(--agent-app-muted)]">
              Your own notes{live === 'recording' ? ', written while you record' : ''}. CraftBot reads them as context but never changes them.
            </p>
            <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-2">
              <TextBlock value={note.my_notes} onSave={(my_notes) => patch({ my_notes })} placeholder="Write anything" minRows={10} />
            </div>
          </div>
        )}
      </div>

      {transcribeOpen && <TranscribeDialog note={note} open={transcribeOpen} onOpenChange={setTranscribeOpen} />}
    </div>
  );
}
